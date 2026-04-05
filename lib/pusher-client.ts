"use client";
// lib/pusher-client.ts — Browser-side Pusher subscription
import PusherJS from "pusher-js";

let pusherInstance: PusherJS | null = null;

export function getPusherClient(): PusherJS {
  if (typeof window === "undefined") {
    throw new Error("Pusher client must be used in browser context");
  }

  if (!pusherInstance) {
    pusherInstance = new PusherJS(process.env.NEXT_PUBLIC_PUSHER_KEY!, {
      cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER!,
      authEndpoint: "/api/pusher/auth",
      auth: {
        headers: {
          "Content-Type": "application/json",
        },
      },
    });
  }

  return pusherInstance;
}

export const PUSHER_EVENTS = {
  PROJECT_STATUS_UPDATED: "project.status.updated",
  TRANSCRIPTION_COMPLETED: "transcription.completed",
  TRANSCRIPTION_FAILED: "transcription.failed",
  JOB_PROGRESS: "job.progress",
  EXPORT_COMPLETED: "export.completed",
  EXPORT_FAILED: "export.failed",
  MAGIC_CLIPS_COMPLETED: "magic_clips.completed",
} as const;
