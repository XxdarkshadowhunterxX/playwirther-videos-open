// workers/transcriptionWorker.ts
// Pipeline: S3 download → FFmpeg audio extract → OpenAI Whisper → DB save → Pusher notify

import { Worker, Job } from "bullmq";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { WordType } from "@prisma/client";
import { s3Client } from "../lib/s3";
import { prisma } from "../lib/prisma";
import { pusherServer, getUserChannel, PUSHER_EVENTS } from "../lib/pusher";
import OpenAI from "openai";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Readable } from "stream";

// ── Setup ──────────────────────────────────────────────────────────────

// Apontar FFmpeg para o binário estático incluído no pacote
if (ffmpegStatic) ffmpeg.setFfmpegPath(ffmpegStatic);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Filler words PT-BR [CONFIRMADO: expandido para PT-BR]
const PT_BR_FILLERS = new Set([
  "ahn", "ahm", "ah", "eh", "hm", "hmm", "uh", "um",
  "né", "ne", "sabe", "tipo", "assim", "então", "cara", "gente",
  "olha", "bom", "bem", "enfim", "ok", "tá", "viu", "certo",
  "basicamente", "literalmente", "praticamente", "realmente",
  "efetivamente", "simplesmente", "obviamente",
]);

function isFillerWord(word: string): boolean {
  return PT_BR_FILLERS.has(word.toLowerCase().replace(/[.,!?;:]/g, ""));
}

function classifyWord(text: string): "word" | "silence" | "punctuation" {
  if (!text.trim()) return "silence";
  if ([",", ".", "!", "?", ":", ";", "...", "—"].includes(text.trim())) return "punctuation";
  return "word";
}

// ── S3 Download ────────────────────────────────────────────────────────

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

// ── FFmpeg Audio Extract ───────────────────────────────────────────────

async function extractAudio(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .noVideo()
      .audioCodec("libmp3lame")
      .audioBitrate("16k")      // 16kbps mono → ~117KB/min → 2h ~14MB (well under 25MB)
      .audioChannels(1)
      .audioFrequency(16000)    // 16kHz — ideal para Whisper
      .output(outputPath)
      .on("end", () => resolve())
      .on("error", (err: Error) => reject(err))
      .run();
  });
}

// ── BullMQ Connection (IORedis via Upstash TLS) ────────────────────────

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

export const transcriptionWorker = new Worker(
  "video-processing",
  async (job: Job) => {
    // Filtrar apenas jobs de transcrição
    if (job.name !== "transcription") return;

    const { projectId, userId, s3Key, language } = job.data;
    const tmpDir = os.tmpdir();
    const videoPath = path.join(tmpDir, `${projectId}-video`);
    const audioPath = path.join(tmpDir, `${projectId}-audio.mp3`);

    console.log(`[Transcription] Starting job ${job.id} for project ${projectId}`);

    try {
      // ── 1. Atualizar status → transcribing ────────────────────────
      await Promise.all([
        prisma.project.update({
          where: { id: projectId },
          data: { status: "transcribing", transcriptionStatus: "PROCESSING" },
        }),
        pusherServer.trigger(getUserChannel(userId), PUSHER_EVENTS.PROJECT_STATUS_UPDATED, {
          projectId,
          status: "transcribing",
          previousStatus: "processing",
        }),
      ]);

      await job.updateProgress(5);
      console.log(`[Transcription] Downloading from S3: ${s3Key}`);

      // ── 2. Download do S3 ─────────────────────────────────────────
      await downloadFromS3(s3Key, videoPath);
      await job.updateProgress(25);

      // Reportar progresso ao Pusher
      await pusherServer.trigger(getUserChannel(userId), PUSHER_EVENTS.JOB_PROGRESS, {
        projectId,
        jobType: "transcription",
        progress: 25,
      });

      console.log(`[Transcription] Extracting audio...`);

      // ── 3. Extrair áudio com FFmpeg ────────────────────────────────
      await extractAudio(videoPath, audioPath);
      await job.updateProgress(40);

      await pusherServer.trigger(getUserChannel(userId), PUSHER_EVENTS.JOB_PROGRESS, {
        projectId,
        jobType: "transcription",
        progress: 40,
      });

      console.log(`[Transcription] Sending to OpenAI Whisper...`);

      // ── 4. Transcrição com OpenAI Whisper ─────────────────────────
      const audioFile = fs.createReadStream(audioPath);
      const transcription = await openai.audio.transcriptions.create({
        file: audioFile,
        model: "whisper-1",
        response_format: "verbose_json",
        timestamp_granularities: ["word"],
        language: language ?? undefined, // undefined = auto-detect
      });

      await job.updateProgress(80);

      await pusherServer.trigger(getUserChannel(userId), PUSHER_EVENTS.JOB_PROGRESS, {
        projectId,
        jobType: "transcription",
        progress: 80,
      });

      // ── 5. Construir array words[] com silences ────────────────────
      const whisperWords = transcription.words ?? [];
      const totalDuration = transcription.duration ?? 0;
      const words: {
        projectId: string;
        text: string;
        type: WordType;
        startTime: number;
        endTime: number;
        confidence: number | null;
        isFiller: boolean;
        isRemoved: boolean;
        position: number;
      }[] = [];

      let position = 0;
      let lastEnd = 0;

      for (const w of whisperWords) {
        const start = w.start ?? lastEnd;
        const end = w.end ?? start + 0.1;
        const text = w.word?.trim() ?? "";

        // Inserir silêncio se gap > 50ms
        if (start > lastEnd + 0.05) {
          words.push({
            projectId,
            text: "",
            type: "silence",
            startTime: Math.round(lastEnd * 1000) / 1000,
            endTime: Math.round(start * 1000) / 1000,
            confidence: null,
            isFiller: false,
            isRemoved: false,
            position: position++,
          });
        }

        words.push({
          projectId,
          text,
          type: classifyWord(text),
          startTime: Math.round(start * 1000) / 1000,
          endTime: Math.round(end * 1000) / 1000,
          confidence: null, // Whisper API não retorna confidence por palavra
          isFiller: isFillerWord(text),
          isRemoved: false,
          position: position++,
        });

        lastEnd = end;
      }

      // Silêncio final
      if (totalDuration > 0 && lastEnd < totalDuration - 0.1) {
        words.push({
          projectId,
          text: "",
          type: "silence",
          startTime: Math.round(lastEnd * 1000) / 1000,
          endTime: Math.round(totalDuration * 1000) / 1000,
          confidence: null,
          isFiller: false,
          isRemoved: false,
          position: position++,
        });
      }

      console.log(`[Transcription] Saving ${words.length} words to DB...`);

      // ── 6. Salvar no banco e atualizar projeto ─────────────────────
      await prisma.$transaction([
        prisma.word.createMany({ data: words.map(w => ({ ...w, type: w.type as WordType })), skipDuplicates: true }),
        prisma.project.update({
          where: { id: projectId },
          data: {
            status: "ready_to_edit",
            transcriptionStatus: "COMPLETED",
            videoDuration: totalDuration,
            language: transcription.language ?? language ?? "pt",
          },
        }),
      ]);

      await job.updateProgress(100);

      // ── 7. Notificar via Pusher ────────────────────────────────────
      await Promise.all([
        pusherServer.trigger(getUserChannel(userId), PUSHER_EVENTS.TRANSCRIPTION_COMPLETED, {
          projectId,
          wordCount: whisperWords.length,
          accuracy: 98, // placeholder — Whisper API não retorna accuracy
          language: transcription.language ?? language ?? "pt",
        }),
        pusherServer.trigger(getUserChannel(userId), PUSHER_EVENTS.PROJECT_STATUS_UPDATED, {
          projectId,
          status: "ready_to_edit",
          previousStatus: "transcribing",
        }),
      ]);

      console.log(`[Transcription] ✅ Job ${job.id} completed — ${words.length} words`);

      return { wordCount: whisperWords.length, language: transcription.language };
    } finally {
      // Limpar arquivos temporários
      [videoPath, audioPath].forEach((f) => {
        try { fs.unlinkSync(f); } catch {}
      });
    }
  },
  {
    connection: getConnection(),
    concurrency: 2, // processar 2 vídeos em paralelo
    limiter: { max: 10, duration: 60_000 }, // máx 10 jobs/min
  }
);

// ── Error handler ──────────────────────────────────────────────────────

transcriptionWorker.on("failed", async (job, error) => {
  if (!job) return;
  const { projectId, userId } = job.data;
  const isLastAttempt = job.attemptsMade >= (job.opts.attempts ?? 3);

  console.error(`[Transcription] ❌ Job ${job.id} failed (attempt ${job.attemptsMade}):`, error.message);

  if (isLastAttempt) {
    try {
      await prisma.project.update({
        where: { id: projectId },
        data: { status: "failed", transcriptionStatus: "FAILED" },
      });

      await pusherServer.trigger(getUserChannel(userId), PUSHER_EVENTS.TRANSCRIPTION_FAILED, {
        projectId,
        error: error.message,
      });
    } catch (dbErr) {
      console.error("[Transcription] Failed to update project status:", dbErr);
    }
  }
});

transcriptionWorker.on("completed", (job) => {
  console.log(`[Transcription] ✅ Job ${job?.id} done`);
});
