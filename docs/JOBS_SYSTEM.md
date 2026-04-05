# JOBS_SYSTEM.md
**Versão:** v0.1.0 | **Data:** 2026-04-05 | **Status:** DRAFT

> Sistema de jobs assíncronos com BullMQ + Redis (Upstash).
> Orquestra todo o pipeline de vídeo com retry, progress e realtime via Pusher.

---

## Arquitetura das Queues

```
                    ┌─────────────────────────────────┐
                    │    Upstash Redis (Serverless)    │
                    └──────────────┬──────────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │                    │                    │
   ┌──────────▼────────┐  ┌────────▼──────────┐  ┌─────▼────────────────┐
   │  video-processing  │  │  video-export      │  │  video-failed        │
   │  (main queue)      │  │  (render queue)    │  │  (dead letter queue) │
   │                    │  │                    │  │                      │
   │  Workers: 4        │  │  Workers: 2 GPU    │  │  Logging + alerting  │
   │  Concurrency: 4    │  │  Concurrency: 2    │  │                      │
   └──────────┬─────────┘  └────────┬───────────┘  └──────────────────────┘
              │                     │
   ┌──────────▼─────────────────────▼──────────────┐
   │              Job Handlers (Node.js)             │
   │                                               │
   │  transcriptionHandler    exportHandler         │
   │  silenceRemovalHandler   magicClipsHandler     │
   │  badTakesHandler         hookTitleHandler      │
   │  cleanAudioHandler       magicZoomsHandler     │
   │  brollGenerationHandler                        │
   └───────────────────────────────────────────────┘
                    │
         Calls Python worker via HTTP
         (Modal.com GPU instance)
```

---

## Definição das Queues

```typescript
// lib/queues.ts
import { Queue, Worker, QueueEvents } from 'bullmq';
import { redisConnection } from './redis';

const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: {
    type: 'exponential' as const,
    delay: 1000,  // 1s → 5s → 30s
  },
  removeOnComplete: { count: 100 },  // manter últimos 100 completos
  removeOnFail: { count: 1000 },     // manter últimos 1000 falhos
};

// Queue principal — transcrição e AI edits
export const videoProcessingQueue = new Queue('video-processing', {
  connection: redisConnection,
  defaultJobOptions: DEFAULT_JOB_OPTIONS,
});

// Queue de export — rendering FFmpeg (GPU-intensive)
export const videoExportQueue = new Queue('video-export', {
  connection: redisConnection,
  defaultJobOptions: {
    ...DEFAULT_JOB_OPTIONS,
    attempts: 2,  // render tem menos retries (caro)
  },
});

// Dead letter queue
export const videoFailedQueue = new Queue('video-failed', {
  connection: redisConnection,
});
```

---

## Job Types e Payload

```typescript
// types/jobs.ts

export type JobType =
  | 'transcription'
  | 'silence_removal'
  | 'bad_takes'
  | 'clean_audio'
  | 'broll_generation'
  | 'magic_zooms'
  | 'export'
  | 'magic_clips'
  | 'hook_title';

// [CONFIRMADO: todos os job types via API Submagic]

export interface TranscriptionJobData {
  projectId: string;
  userId: string;
  s3Key: string;           // key do arquivo original no R2/S3
  language?: string;       // null = auto-detect
  dictionary?: string[];   // palavras customizadas para o Whisper
}

export interface SilenceRemovalJobData {
  projectId: string;
  userId: string;
  pace: 'extra_fast' | 'fast' | 'natural';
  // Thresholds: extra_fast=0.1s / fast=0.2s / natural=0.6s [CONFIRMADO]
}

export interface BadTakesJobData {
  projectId: string;
  userId: string;
  confidenceThreshold: number;  // default: 0.6
}

export interface CleanAudioJobData {
  projectId: string;
  userId: string;
  s3Key: string;
}

export interface BrollGenerationJobData {
  projectId: string;
  userId: string;
  percentage: number;         // 0-100 % de cobertura B-roll
  defaultLayout: string;      // default: "cover"
}

export interface MagicZoomsJobData {
  projectId: string;
  userId: string;
}

export interface ExportJobData {
  projectId: string;
  userId: string;
  resolution: '720p' | '1080p' | '4k';
}

export interface MagicClipsJobData {
  projectId: string;
  userId: string;
  s3Key: string;
  minClipLength: number;  // segundos, default: 30
  maxClipLength: number;  // segundos, default: 90
  faceTracking: boolean;  // [CONFIRMADO: parâmetro magic-clips]
  language?: string;
}

export interface HookTitleJobData {
  projectId: string;
  userId: string;
  config: boolean | {
    text?: string;
    template?: string;
    top?: number;   // 0-80 [CONFIRMADO]
    size?: number;  // 0-80 [CONFIRMADO]
  };
}
```

---

## Handlers dos Workers

```typescript
// workers/transcriptionWorker.ts

import { Worker, Job } from 'bullmq';
import { TranscriptionJobData } from '../types/jobs';
import { prisma } from '../lib/prisma';
import { pusher } from '../lib/pusher';
import { callPythonWorker } from '../lib/pythonWorker';

const transcriptionWorker = new Worker<TranscriptionJobData>(
  'video-processing',
  async (job: Job<TranscriptionJobData>) => {
    const { projectId, userId, s3Key, language } = job.data;

    // Atualizar job no banco
    await prisma.job.update({
      where: { bullmqJobId: job.id },
      data: { status: 'processing', startedAt: new Date() },
    });

    // Atualizar status do projeto
    await prisma.project.update({
      where: { id: projectId },
      data: { status: 'transcribing' },
    });

    // Notificar via Pusher
    await pusher.trigger(`private-user-${userId}`, 'project.status.updated', {
      projectId,
      status: 'transcribing',
      previousStatus: 'processing',
    });

    // Reportar progresso
    await job.updateProgress(10);

    // Chamar Python worker (GPU)
    const result = await callPythonWorker('/transcribe', {
      project_id: projectId,
      s3_key: s3Key,
      language: language,
    });

    await job.updateProgress(90);

    // Atualizar projeto como pronto para editar
    await prisma.project.update({
      where: { id: projectId },
      data: { status: 'ready_to_edit' },
    });

    // Atualizar job como completo
    await prisma.job.update({
      where: { bullmqJobId: job.id },
      data: {
        status: 'completed',
        progress: 100,
        completedAt: new Date(),
      },
    });

    // Notificar conclusão via Pusher
    await pusher.trigger(`private-user-${userId}`, 'transcription.completed', {
      projectId,
      wordCount: result.wordCount,
      accuracy: result.accuracy,
      language: result.language,
    });

    return result;
  },
  {
    connection: redisConnection,
    concurrency: 4,
    limiter: {
      max: 10,
      duration: 60000,  // max 10 jobs/min por instância
    },
  }
);

// Handler de erros e falhas
transcriptionWorker.on('failed', async (job, error) => {
  if (!job) return;
  const { projectId, userId } = job.data;

  const isLastAttempt = job.attemptsMade >= (job.opts.attempts ?? 3);

  if (isLastAttempt) {
    // Mover para failed definitivo
    await prisma.project.update({
      where: { id: projectId },
      data: {
        status: 'failed',
        failureReason: error.message,
      },
    });

    await pusher.trigger(`private-user-${userId}`, 'transcription.failed', {
      projectId,
      error: error.message,
    });
  }
});
```

```typescript
// workers/exportWorker.ts

const exportWorker = new Worker<ExportJobData>(
  'video-export',
  async (job: Job<ExportJobData>) => {
    const { projectId, userId } = job.data;

    await prisma.project.update({
      where: { id: projectId },
      data: { status: 'exporting' },
    });

    await pusher.trigger(`private-user-${userId}`, 'project.status.updated', {
      projectId,
      status: 'exporting',
      previousStatus: 'ready_to_edit',
    });

    await job.updateProgress(5);

    const result = await callPythonWorker('/export', {
      project_id: projectId,
    });

    await prisma.project.update({
      where: { id: projectId },
      data: {
        status: 'completed',
        directUrl: result.directUrl,
        downloadUrl: result.downloadUrl,
        outputKey: result.outputKey,
      },
    });

    await pusher.trigger(`private-user-${userId}`, 'export.completed', {
      projectId,
      downloadUrl: result.downloadUrl,
      directUrl: result.directUrl,
    });

    // Disparar webhook se configurado
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { webhookUrl: true },
    });

    if (project?.webhookUrl) {
      await deliverWebhook(project.webhookUrl, {
        projectId,
        status: 'completed',
        downloadUrl: result.downloadUrl,
        directUrl: result.directUrl,
        timestamp: new Date().toISOString(),
      });
    }

    return result;
  },
  {
    connection: redisConnection,
    concurrency: 2,  // GPU é gargalo, limitar concorrência
  }
);
```

---

## Progress Tracking

```typescript
// lib/jobProgress.ts

// BullMQ emite progress events automaticamente
// O frontend ouve via Pusher (não via polling do BullMQ)

async function reportProgress(
  job: Job,
  userId: string,
  projectId: string,
  progress: number,
  jobType: string
) {
  await job.updateProgress(progress);

  await pusher.trigger(`private-user-${userId}`, 'job.progress', {
    projectId,
    jobType,
    progress,
  });
}

// Uso dentro do worker:
await reportProgress(job, userId, projectId, 25, 'transcription');
// → Emite evento Pusher → Browser atualiza barra de progresso
```

---

## Pusher Events Completos

```typescript
// lib/pusherEvents.ts
// Channel: private-user-{userId}
// [CONFIRMADO: Pusher detectado via análise dinâmica]

export const PUSHER_EVENTS = {
  PROJECT_STATUS_UPDATED: 'project.status.updated',
  TRANSCRIPTION_COMPLETED: 'transcription.completed',
  TRANSCRIPTION_FAILED: 'transcription.failed',
  JOB_PROGRESS: 'job.progress',
  EXPORT_COMPLETED: 'export.completed',    // [CONFIRMADO: evento esperado]
  EXPORT_FAILED: 'export.failed',
  MAGIC_CLIPS_COMPLETED: 'magic_clips.completed',
} as const;

// Payloads:
// project.status.updated: { projectId, status, previousStatus }
// transcription.completed: { projectId, wordCount, accuracy, language }
// job.progress: { projectId, jobType, progress: 0-100 }
// export.completed: { projectId, downloadUrl, directUrl }
// magic_clips.completed: { projectId, clips: MagicClip[] }
```

---

## Pipeline de Jobs por Tipo de Projeto

### Projeto Standard (Generate Captions)

```
enqueue("transcription")
    ↓ completed
[ if removeSilencePace ] → enqueue("silence_removal")
[ if removeBadTakes    ] → enqueue("bad_takes")
[ if cleanAudio        ] → enqueue("clean_audio")
[ if magicZooms        ] → enqueue("magic_zooms")
[ if magicBrolls       ] → enqueue("broll_generation")
[ if hookTitle         ] → enqueue("hook_title")
    ↓ all completed
Project status → "ready_to_edit"
    ↓ user clicks Export
enqueue("export") → videoExportQueue
```

### Magic Clips

```
enqueue("magic_clips") → videoProcessingQueue
    ↓ completed
clips[] com viralityScores salvo no banco
Pusher: "magic_clips.completed"
```

---

## Retry Logic e Dead Letter Queue

```typescript
// Retry por tipo de job:
const RETRY_CONFIG: Record<JobType, { attempts: number; backoff: number }> = {
  transcription:    { attempts: 3, backoff: 1000 },  // 1s → 5s → 30s
  silence_removal:  { attempts: 3, backoff: 500 },
  bad_takes:        { attempts: 3, backoff: 500 },
  clean_audio:      { attempts: 3, backoff: 500 },
  broll_generation: { attempts: 2, backoff: 2000 },  // GPT-4o-mini pode ter timeout
  magic_zooms:      { attempts: 3, backoff: 500 },
  export:           { attempts: 2, backoff: 5000 },  // render é caro, menos retries
  magic_clips:      { attempts: 2, backoff: 2000 },
  hook_title:       { attempts: 3, backoff: 1000 },
};

// Quando job esgota retries → Dead Letter Queue
videoProcessingQueue.on('failed', async (job, error) => {
  if (job && job.attemptsMade >= (job.opts.attempts ?? 3)) {
    await videoFailedQueue.add('failed-job', {
      originalJob: job.data,
      error: error.message,
      jobType: job.name,
      failedAt: new Date().toISOString(),
    });
  }
});
```

---

## Monitoramento

```typescript
// BullMQ dashboard: bull-board (opcional para dev)
// Produção: métricas via Upstash Redis Dashboard

// Health check de queues
async function checkQueuesHealth() {
  const [processingWaiting, exportWaiting] = await Promise.all([
    videoProcessingQueue.getWaitingCount(),
    videoExportQueue.getWaitingCount(),
  ]);

  return {
    videoProcessing: {
      waiting: processingWaiting,
      active: await videoProcessingQueue.getActiveCount(),
      failed: await videoProcessingQueue.getFailedCount(),
    },
    videoExport: {
      waiting: exportWaiting,
      active: await videoExportQueue.getActiveCount(),
      failed: await videoExportQueue.getFailedCount(),
    },
  };
}
```

---

## Referências

- [CONFIRMADO] Job types: `transcription, silence_removal, bad_takes, clean_audio, broll_generation, magic_zooms, export, magic_clips, hook_title` — API Submagic
- [CONFIRMADO] Job status flow: `queued → processing → completed | failed`
- [CONFIRMADO] Pusher para realtime updates — detectado via `window.Pusher`
- [CONFIRMADO] Export é assíncrono e retorna imediatamente `{ status: "exporting" }`
- [DECISÃO PRÓPRIA] Upstash Redis (serverless) em vez de Redis próprio

> Ver: [ARCHITECTURE.md](./ARCHITECTURE.md) | [VIDEO_PIPELINE.md](./VIDEO_PIPELINE.md) | [API_SPECIFICATION.md](./API_SPECIFICATION.md)
