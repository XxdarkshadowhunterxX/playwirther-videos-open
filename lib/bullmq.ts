// lib/bullmq.ts
// BullMQ requer conexão IORedis (TCP) — não funciona com REST API do Upstash
// Upstash suporta IORedis via TLS na porta 6379

import { Queue } from "bullmq";

// Extrai host da URL REST do Upstash
// REST URL: https://clear-goshawk-92591.upstash.io
// IORedis URL: clear-goshawk-92591.upstash.io:6379 (TLS)
function getRedisConnection() {
  const restUrl = process.env.UPSTASH_REDIS_REST_URL ?? "";
  const host = restUrl.replace("https://", "").replace("http://", "");
  const password = process.env.UPSTASH_REDIS_REST_TOKEN ?? "";

  return {
    host,
    port: 6379,
    password,
    tls: {},
    maxRetriesPerRequest: null, // obrigatório para BullMQ
    enableReadyCheck: false,
  };
}

const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: {
    type: "exponential" as const,
    delay: 1000, // 1s → 5s → 30s
  },
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 500 },
};

// ─── Queues ────────────────────────────────────────────────────────

export const videoProcessingQueue = new Queue("video-processing", {
  connection: getRedisConnection(),
  defaultJobOptions: DEFAULT_JOB_OPTIONS,
});

export const videoExportQueue = new Queue("video-export", {
  connection: getRedisConnection(),
  defaultJobOptions: {
    ...DEFAULT_JOB_OPTIONS,
    attempts: 2,
  },
});

// ─── Enqueue helpers ───────────────────────────────────────────────

export async function enqueueTranscription(data: {
  projectId: string;
  userId: string;
  s3Key: string;
  language?: string;
  dictionary?: string[];
}) {
  return videoProcessingQueue.add("transcription", data, {
    jobId: `transcription-${data.projectId}`,
  });
}

export async function enqueueExport(data: {
  projectId: string;
  userId: string;
  resolution?: string;
}) {
  return videoExportQueue.add("export", data, {
    jobId: `export-${data.projectId}`,
  });
}

export async function enqueueSilenceRemoval(data: {
  projectId: string;
  userId: string;
  pace: string;
}) {
  return videoProcessingQueue.add("silence_removal", data, {
    jobId: `silence-${data.projectId}`,
  });
}

export async function enqueueBrollGeneration(data: {
  projectId: string;
  userId: string;
  percentage: number;
}) {
  return videoProcessingQueue.add("broll_generation", data, {
    jobId: `broll-${data.projectId}`,
  });
}
