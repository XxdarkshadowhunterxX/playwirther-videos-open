// workers/exportWorker.ts
// Pipeline: S3 download → ASS generate → FFmpeg burn-in → S3 upload → Pusher

import { Worker, Job } from "bullmq";
import {
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { s3Client, getCloudFrontUrl } from "../lib/s3";
import { prisma } from "../lib/prisma";
import { pusherServer, getUserChannel, PUSHER_EVENTS } from "../lib/pusher";
import { generateAssFile } from "../lib/assGenerator";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Readable } from "stream";

if (ffmpegStatic) ffmpeg.setFfmpegPath(ffmpegStatic);

// ── Helpers ────────────────────────────────────────────────────────────

async function downloadFromS3(key: string, destPath: string): Promise<void> {
  const response = await s3Client.send(
    new GetObjectCommand({ Bucket: process.env.AWS_S3_BUCKET!, Key: key })
  );
  const body = response.Body as Readable;
  const fileStream = fs.createWriteStream(destPath);
  await new Promise<void>((resolve, reject) => {
    body.pipe(fileStream);
    body.on("error", reject);
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

// ── Gera arquivo SRT a partir dos eventos do ASS ──────────────────────
function generateSRTFromAss(assContent: string): string {
  const lines = assContent.split("\n");
  const events: { index: number; start: string; end: string; text: string }[] = [];
  let index = 1;

  for (const line of lines) {
    if (!line.startsWith("Dialogue:")) continue;
    const match = line.match(
      /^Dialogue:\s*\d+,(\d+:\d{2}:\d{2}\.\d{2}),(\d+:\d{2}:\d{2}\.\d{2}),Default,,\d+,\d+,\d+,,(.+)$/
    );
    if (!match) continue;
    const [, startTs, endTs, rawText] = match;
    const text = rawText.replace(/\{[^}]+\}/g, "").trim();
    if (!text) continue;

    // SRT usa H:MM:SS,cs → H:MM:SS,mmm (ms)
    const toSRT = (ts: string) => {
      const [hms, cs] = ts.split(".");
      return `${hms},${cs.padEnd(3, "0")}`;
    };

    events.push({ index: index++, start: toSRT(startTs), end: toSRT(endTs), text });
  }

  return events.map(e => `${e.index}\n${e.start} --> ${e.end}\n${e.text}\n`).join("\n");
}

export interface BrollOverlay { url: string; start: number; end: number; layout: string; mediaOffset?: number; }

async function runFFmpegWithCaptions(
  inputPath: string,
  assPath: string,
  outputPath: string,
  isConcatList: boolean = false,
  brolls: BrollOverlay[] = []
): Promise<void> {
  const assContent = fs.readFileSync(assPath, "utf-8");

  // Salvar SRT no mesmo dir com path simples (sem espaços)
  const srtPath = assPath.replace(".ass", ".srt");
  const srtContent = generateSRTFromAss(assContent);
  fs.writeFileSync(srtPath, srtContent, "utf-8");

  // Estratégia 1: ASS nativo (libass) — melhor qualidade
  const success = await tryFFmpegFilter(inputPath, outputPath, `ass='${escapeFilterPath(assPath)}'`, isConcatList, brolls);
  if (success) { cleanup(srtPath); return; }

  // Estratégia 2: subtitles filter com SRT — compatível cross-platform
  const success2 = await tryFFmpegFilter(inputPath, outputPath, `subtitles='${escapeFilterPath(srtPath)}'`, isConcatList, brolls);
  if (success2) { cleanup(srtPath); return; }

  // Estratégia 3: sem captions (edge case extremo)
  console.warn("[Export] ⚠️  Todas as estratégias de captions falharam. Exportando sem legendas.");
  cleanup(srtPath);
  await tryFFmpegFilter(inputPath, outputPath, null, isConcatList, brolls);
}

function escapeFilterPath(filePath: string): string {
  // Normalizar para forward slashes
  let p = filePath.replace(/\\/g, "/");
  // Escapar dois-pontos do drive letter no Windows: C:/ → C\:/
  p = p.replace(/^([A-Za-z]):/, "$1\\:");
  // Escapar espaços e caracteres especiais
  p = p.replace(/ /g, "\\ ");
  return p;
}

function cleanup(filePath: string) {
  try { fs.unlinkSync(filePath); } catch {}
}

async function tryFFmpegFilter(
  inputPath: string,
  outputPath: string,
  videoFilter: string | null,
  isConcatList: boolean,
  brolls: BrollOverlay[]
): Promise<boolean> {
  return new Promise((resolve) => {
    const opts: string[] = [];
    opts.push(
      `-c:v`, `libx264`,
      `-crf`, `23`,
      `-preset`, `ultrafast`,
      `-c:a`, `aac`,
      `-b:a`, `128k`,
      `-movflags`, `+faststart`,
      `-pix_fmt`, `yuv420p`,
    );

    let cmd = ffmpeg(inputPath);
    if (isConcatList) {
      cmd = cmd.inputOptions(["-f", "concat", "-safe", "0"]);
    }

    const isImage = (url: string) => /\.(jpg|jpeg|png|gif|webp)$/i.test((url || "").split('?')[0]);

    // Injetar as Origens dos B-Rolls
    brolls.forEach(b => {
      cmd.input(b.url);
      if (isImage(b.url)) {
        cmd.inputOptions(["-loop", "1"]);
      }
    });

    let filtergraph = "";
    let lastV = "0:v";
    const mappedOutputs = [];

    if (videoFilter || brolls.length > 0) {
      if (brolls.length > 0) {
        brolls.forEach((broll, idx) => {
          const inputId = idx + 1; // 0 é o main
          let scaleFilter = `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920`;
          if (broll.layout === "pip-top-right") scaleFilter = "scale=300:-1";
          else if (broll.layout === "split-50-50") scaleFilter = "scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960";

          let brollTrim = "";
          if (broll.mediaOffset && broll.mediaOffset > 0) {
            brollTrim = `trim=start=${broll.mediaOffset},setpts=PTS-STARTPTS,`;
          }

          filtergraph += `[${inputId}:v]${brollTrim}${scaleFilter}[b${idx}];`;
          
          const outV = `[v${idx+1}]`;
          let x = "(W-w)/2", y = "(H-h)/2";
          if (broll.layout === "pip-top-right") { x = "W-w-50"; y = "50"; }
          else if (broll.layout === "split-50-50") { x = "0"; y = "0"; } // Em cima

          filtergraph += `${lastV}[b${idx}]overlay=x='${x}':y='${y}':enable='between(t,${broll.start},${broll.end})'${outV};`;
          lastV = outV;
        });
      }

      if (videoFilter) {
        filtergraph += `${lastV}${videoFilter}[outv]`;
      } else {
        filtergraph += `${lastV}format=yuv420p[outv]`;
      }

      cmd.complexFilter(filtergraph, ["outv"]);
      opts.push("-map", "0:a"); // Nao perder o áudio base!
    }

    cmd
      .outputOptions(opts)
      .output(outputPath)
      .on("start", (cmd) => console.log(`[Export] Trying: ${videoFilter ?? "no-filter"} ...`))
      .on("end", () => {
        console.log(`[Export] ✅ ${videoFilter ?? "passthrough"} → sucesso`);
        resolve(true);
      })
      .on("error", (err: Error) => {
        console.warn(`[Export] ❌ ${videoFilter} falhou: ${err.message.slice(0, 120)}`);
        // Apagar output parcial se existir
        try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch {}
        resolve(false);
      })
      .run();
  });
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

// ── Worker ─────────────────────────────────────────────────────────────
export const exportWorker = new Worker(
  "video-export",
  async (job: Job) => {
    const { projectId, userId } = job.data;
    const tmpDir = os.tmpdir();
    const videoPath = path.join(tmpDir, `${projectId}-export-input.mp4`);
    // Removendo trimmedPath para fazer tudo em 1 único encode!
    const assPath = path.join(tmpDir, `${projectId}-captions.ass`);
    const outputPath = path.join(tmpDir, `${projectId}-export-output.mp4`);

    console.log(`[Export] Starting job ${job.id} for project ${projectId}`);

    try {
      // ── 1. Buscar projeto + words ──────────────────────────────────
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: {
          sourceKey: true,
          templateName: true,
          videoWidth: true,
          videoHeight: true,
          status: true,
          words: {
            orderBy: { position: "asc" },
            select: {
              id: true,
              text: true,
              type: true,
              startTime: true,
              endTime: true,
              isFiller: true,
              isRemoved: true,
            },
          },
          items: {
            where: { type: { in: ["ai_broll", "user_broll", "motion_broll"] } },
          },
        },
      });

      if (!project) throw new Error(`Project ${projectId} not found`);

      // ── 2. Atualizar status → exporting ───────────────────────────
      await prisma.project.update({
        where: { id: projectId },
        data: { status: "exporting" },
      });

      await pusherServer.trigger(getUserChannel(userId), PUSHER_EVENTS.PROJECT_STATUS_UPDATED, {
        projectId,
        status: "exporting",
        previousStatus: project.status,
      });

      await job.updateProgress(5);

      // ── 3. Download vídeo original ─────────────────────────────────
      console.log(`[Export] Downloading source: ${project.sourceKey}`);
      await downloadFromS3(project.sourceKey, videoPath);
      await job.updateProgress(20);

      await pusherServer.trigger(getUserChannel(userId), PUSHER_EVENTS.JOB_PROGRESS, {
        projectId,
        jobType: "export",
        progress: 20,
      });

      // ── 4. Processar Cortes Mágicos (Trim) ──────────────────────────
      // Filtramos o que não foi cortado
      const keptSegments: { start: number; end: number }[] = [];
      let activeKeep: { start: number; end: number } | null = null;
      for (const w of project.words) {
        if (!w.isRemoved) {
          if (!activeKeep) activeKeep = { start: Number(w.startTime), end: Number(w.endTime) };
          else if (Number(w.startTime) <= activeKeep.end + 0.1) activeKeep.end = Math.max(activeKeep.end, Number(w.endTime));
          else { keptSegments.push(activeKeep); activeKeep = { start: Number(w.startTime), end: Number(w.endTime) }; }
        }
      }
      if (activeKeep) keptSegments.push(activeKeep);

      // Existe alguma remoção real? (Se keptSegments < palavras originais ou buracos enormes)
      const hasCuts = keptSegments.length > 0 && keptSegments.length < project.words.length && project.words.some(w => w.isRemoved);

      let finalInputPath = videoPath;
      let isConcatList = false;

      if (hasCuts) {
        console.log(`[Export] Setup AI Cuts... ${keptSegments.length} segments to keep.`);
        await job.updateProgress(30);

        const listPath = path.join(tmpDir, `${projectId}-concat-list.txt`);
        const listContent = keptSegments
          .map((seg) => `file '${videoPath.replace(/\\/g, "/")}'\ninpoint ${seg.start}\noutpoint ${seg.end}`)
          .join("\n");
        fs.writeFileSync(listPath, listContent, "utf-8");

        finalInputPath = listPath;
        isConcatList = true;
      }

      await job.updateProgress(45);

      // ── 5. Recalcular Timestamps (Shift) ───────────────────────────
      // O vídeo diminuiu. Precisamos adiantar as palavras para sincronizar.
      let currentShiftSecs = 0;
      let checkIndex = 0;

      const shiftedWords = project.words.map((w) => {
        const wStart = Number(w.startTime);
        const wEnd = Number(w.endTime);

        // Somar os buracos de silêncio que ficaram PRA TRÁS dessa palavra
        while (checkIndex < project.words.length && Number(project.words[checkIndex].endTime) <= wStart) {
          const pastWord = project.words[checkIndex];
          if (pastWord.isRemoved) {
            currentShiftSecs += (Number(pastWord.endTime) - Number(pastWord.startTime));
          }
          checkIndex++;
        }

        return {
          ...w,
          type: w.type as "word" | "silence" | "punctuation",
          startTime: Math.max(0, wStart - currentShiftSecs),
          endTime: Math.max(0, wEnd - currentShiftSecs),
        };
      });

      // Shifta os B-Rolls tambem (eles usam o timestamp original como base)
      const shiftedBrolls: BrollOverlay[] = (project.items || []).map((item) => {
        let shift = 0;
        let cIdx = 0;
        while (cIdx < project.words.length && Number(project.words[cIdx].endTime) <= Number(item.startTime)) {
          const pastWord = project.words[cIdx];
          if (pastWord.isRemoved) {
            shift += (Number(pastWord.endTime) - Number(pastWord.startTime));
          }
          cIdx++;
        }
        return {
          url: item.assetUrl || "",
          start: Math.max(0, Number(item.startTime) - shift),
          end: Math.max(0, Number(item.endTime) - shift),
          layout: item.layout || "cover",
          mediaOffset: (item as any).mediaOffset || 0,
        };
      });

      // ── 6. Gerar arquivo .ASS ──────────────────────────────────────
      console.log(`[Export] Generating ASS subtitles (template: ${project.templateName})...`);
      const activeWordCount = shiftedWords.filter((w) => !w.isRemoved && w.type === "word").length;
      
      const assContent = generateAssFile(
        shiftedWords,
        project.templateName,
        project.videoWidth,
        project.videoHeight
      );
      fs.writeFileSync(assPath, assContent, "utf-8");
      await job.updateProgress(65);

      // ── 7. FFmpeg render final (Captions burn-in + Cuts + B-Rolls in 1 pass!) ──
      console.log(`[Export] Rendering video with ${activeWordCount} visible words and ${shiftedBrolls.length} B-Roll overlays...`);
      await runFFmpegWithCaptions(finalInputPath, assPath, outputPath, isConcatList, shiftedBrolls);
      await job.updateProgress(85);

      await pusherServer.trigger(getUserChannel(userId), PUSHER_EVENTS.JOB_PROGRESS, {
        projectId,
        jobType: "export",
        progress: 80,
      });

      // ── 6. Upload do output para S3 ────────────────────────────────
      const outputKey = `outputs/${userId}/${projectId}/output.mp4`;
      console.log(`[Export] Uploading output to S3: ${outputKey}`);
      await uploadToS3(outputPath, outputKey);
      await job.updateProgress(95);

      const directUrl = getCloudFrontUrl(outputKey);
      const downloadUrl = directUrl; // mesmo URL para o beta

      // ── 7. Atualizar projeto como completed ────────────────────────
      await prisma.project.update({
        where: { id: projectId },
        data: {
          status: "completed",
          outputKey,
          directUrl,
          downloadUrl,
        },
      });

      await job.updateProgress(100);

      // ── 8. Notificar via Pusher ────────────────────────────────────
      await pusherServer.trigger(getUserChannel(userId), PUSHER_EVENTS.EXPORT_COMPLETED, {
        projectId,
        directUrl,
        downloadUrl,
      });

      await pusherServer.trigger(getUserChannel(userId), PUSHER_EVENTS.PROJECT_STATUS_UPDATED, {
        projectId,
        status: "completed",
        previousStatus: "exporting",
      });

      console.log(`[Export] ✅ Job ${job.id} completed — ${outputKey}`);
      return { outputKey, directUrl };
    } finally {
      [videoPath, assPath, outputPath].forEach((f) => {
        try { fs.unlinkSync(f); } catch {}
      });
      try { fs.unlinkSync(path.join(tmpDir, `${projectId}-concat-list.txt`)); } catch {}
    }
  },
  {
    connection: getConnection(),
    concurrency: 2,
  }
);

// ── Error handler ──────────────────────────────────────────────────────
exportWorker.on("failed", async (job, error) => {
  if (!job) return;
  const { projectId, userId } = job.data;
  const isLastAttempt = job.attemptsMade >= (job.opts.attempts ?? 2);
  console.error(`[Export] ❌ Job ${job.id} failed:`, error.message);

  if (isLastAttempt) {
    try {
      await prisma.project.update({
        where: { id: projectId },
        data: { status: "failed", failureReason: error.message },
      });
      await pusherServer.trigger(getUserChannel(userId), PUSHER_EVENTS.EXPORT_FAILED, {
        projectId,
        error: error.message,
      });
    } catch {}
  }
});

exportWorker.on("completed", (job) => {
  console.log(`[Export] ✅ Job ${job?.id} done`);
});
