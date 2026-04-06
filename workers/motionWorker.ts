import { Worker, Job } from "bullmq";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import path from "path";
import os from "os";
import fs from "fs";
import { prisma } from "../lib/prisma";
import { s3Client, getCloudFrontUrl } from "../lib/s3";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { pusherServer } from "../lib/pusher";
import fetch from "node-fetch";

if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic);
}

// ── BullMQ Connection ──────────────────────────────────────────────────
function getConnection() {
  const restUrl = process.env.UPSTASH_REDIS_REST_URL ?? "";
  const host = restUrl.replace("https://", "").replace("http://", "");
  return {
    host,
    port: 6379,
    password: process.env.UPSTASH_REDIS_REST_TOKEN ?? "",
    tls: {},
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────
async function downloadFile(url: string, destPath: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Falha ao baixar imagem: ${res.statusText}`);
  const fileStream = fs.createWriteStream(destPath);
  return new Promise((resolve, reject) => {
    res.body?.pipe(fileStream);
    res.body?.on("error", reject);
    fileStream.on("finish", resolve);
    fileStream.on("error", reject);
  });
}

async function uploadToS3(localPath: string, key: string, contentType = "video/mp4"): Promise<void> {
  const fileStream = fs.createReadStream(localPath);
  const fileSize = fs.statSync(localPath).size;
  await s3Client.send(
    new PutObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET!,
      Key: key,
      Body: fileStream,
      ContentType: contentType,
      ContentLength: fileSize,
    })
  );
}

// ── Worker ─────────────────────────────────────────────────────────────
export const motionWorker = new Worker(
  "motion-graphics",
  async (job: Job) => {
    const { projectId, itemId, userId, imgUrl, duration = 8 } = job.data;
    const tmpDir = os.tmpdir();
    
    // Obter formato para dar download
    const ext = imgUrl.split('.').pop()?.split('?')[0] || "jpg";
    const localImgPath = path.join(tmpDir, `${itemId}-input.${ext}`);
    const outputPath = path.join(tmpDir, `${itemId}-motion.mp4`);

    console.log(`[Motion] Starting FFmpeg Kinematic Engine for ${itemId}`);

    await pusherServer.trigger(`private-user-${userId}`, "motion_progress", {
      itemId, status: "rendering", progress: 10
    });

    try {
      // 1. Download source image
      await downloadFile(imgUrl, localImgPath);
      
      console.log(`[Motion] Imagem baixada. Rodando filtro Zoompan...`);
      await pusherServer.trigger(`private-user-${userId}`, "motion_progress", {
        itemId, status: "rendering", progress: 40
      });

      // 2. FFmpeg Ken Burns Effect
      // Um unico frame de entrada gera video com o zoompan:
      // fps=30, t=8 -> 240 frames. d=240 para gerar exatamente.
      await new Promise((resolve, reject) => {
        ffmpeg(localImgPath)
          .complexFilter([
            // Duplica o stream original para o fundo blur e o objeto em foco
            '[0:v]split=2[bg_src][fg_src]',
            // Cria um fundo borrado esticado e escurecido (color mixer)
            '[bg_src]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=40:5,colorchannelmixer=rr=0.5:gg=0.5:bb=0.5[bg]',
            // Mantem a imagem ajustada no centro
            '[fg_src]scale=1080:1920:force_original_aspect_ratio=decrease[fg]',
            // Sobrepoe a imagem com margem correta
            '[bg][fg]overlay=(W-w)/2:(H-h)/2[merged]',
            // Aplica um Zoom suave sobre o quadro mesclado, preenchendo a tela toda
            "[merged]zoompan=z='min(zoom+0.0015,1.15)':d=240:x='iw/2-(iw/zoom)/2':y='ih/2-(ih/zoom)/2':s=1080x1920[out]"
          ])
          .outputOptions([
            '-map', '[out]',
            '-c:v', 'libx264',
            '-t', String(duration),
            '-r', '30',
            '-pix_fmt', 'yuv420p',
            '-preset', 'fast',
            '-crf', '18'
          ])
          .output(outputPath)
          .on('end', () => resolve(true))
          .on('error', (err) => reject(err))
          .run();
      });

      console.log(`[Motion] Rendering finished. Uploading to S3...`);
      await pusherServer.trigger(`private-user-${userId}`, "motion_progress", {
        itemId, status: "uploading", progress: 80
      });

      // 3. Upload to S3
      const outExt = "mp4";
      const key = `uploads/${userId}/${projectId}/brolls/${itemId}-motion.${outExt}`;
      await uploadToS3(outputPath, key);

      const finalAssetUrl = getCloudFrontUrl(key);

      // 4. Update Database
      const updatedItem = await prisma.projectItem.update({
        where: { id: itemId },
        data: {
          assetUrl: finalAssetUrl,
          type: "motion_broll",
          prompt: "Motion Graphics (Cinematic FFmpeg)"
        }
      });

      await pusherServer.trigger(`private-user-${userId}`, "motion_progress", {
        itemId, status: "completed", progress: 100, item: updatedItem
      });

      console.log(`[Motion] ✅ Job ${job.id} completed! URL: ${finalAssetUrl}`);
      return { finalAssetUrl };

    } catch (error: any) {
      console.error(`[Motion] ❌ Job ${job.id} failed:`, error.message);
      await pusherServer.trigger(`private-user-${userId}`, "motion_progress", {
        itemId, status: "error", error: error.message
      });
      throw error;
    } finally {
      try { fs.unlinkSync(localImgPath); } catch {}
      try { fs.unlinkSync(outputPath); } catch {}
    }
  },
  {
    connection: getConnection(),
    concurrency: 2, 
  }
);

motionWorker.on("failed", async (job, error) => {
  console.error(`[Motion Worker] Job ${job?.id} failed ultimately:`, error.message);
});
