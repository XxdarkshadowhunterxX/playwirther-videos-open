// lib/pusher.ts — Server-side Pusher trigger
import Pusher from "pusher";

const globalForPusher = globalThis as unknown as {
  pusherServer: Pusher | undefined;
};

export const pusherServer =
  globalForPusher.pusherServer ??
  new Pusher({
    appId: process.env.PUSHER_APP_ID!,
    key: process.env.PUSHER_KEY!,
    secret: process.env.PUSHER_SECRET!,
    cluster: process.env.PUSHER_CLUSTER!,
    useTLS: true,
  });

if (process.env.NODE_ENV !== "production")
  globalForPusher.pusherServer = pusherServer;

// ─── Event helpers ──────────────────────────────────────────────────

export const PUSHER_EVENTS = {
  PROJECT_STATUS_UPDATED: "project.status.updated",
  TRANSCRIPTION_COMPLETED: "transcription.completed",
  TRANSCRIPTION_FAILED: "transcription.failed",
  JOB_PROGRESS: "job.progress",
  EXPORT_COMPLETED: "export.completed",
  EXPORT_FAILED: "export.failed",
  MAGIC_CLIPS_COMPLETED: "magic_clips.completed",
} as const;

export function getUserChannel(userId: string): string {
  return `private-user-${userId}`;
}

export async function triggerProjectStatusUpdate(
  userId: string,
  data: { projectId: string; status: string; previousStatus: string }
) {
  return pusherServer.trigger(
    getUserChannel(userId),
    PUSHER_EVENTS.PROJECT_STATUS_UPDATED,
    data
  );
}

export async function triggerJobProgress(
  userId: string,
  data: { projectId: string; jobType: string; progress: number }
) {
  return pusherServer.trigger(
    getUserChannel(userId),
    PUSHER_EVENTS.JOB_PROGRESS,
    data
  );
}

export async function triggerExportCompleted(
  userId: string,
  data: { projectId: string; downloadUrl: string; directUrl: string }
) {
  return pusherServer.trigger(
    getUserChannel(userId),
    PUSHER_EVENTS.EXPORT_COMPLETED,
    data
  );
}

export async function triggerTranscriptionCompleted(
  userId: string,
  data: { projectId: string; wordCount: number; accuracy: number; language: string }
) {
  return pusherServer.trigger(
    getUserChannel(userId),
    PUSHER_EVENTS.TRANSCRIPTION_COMPLETED,
    data
  );
}
