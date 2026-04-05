"use client";
// app/(app)/upload/page.tsx
import { useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useUploadStore } from "@/stores/uploadStore";

const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB

export default function UploadPage() {
  const router = useRouter();
  const { startUpload, updatePartProgress, completeUpload, setError, totalProgress, isUploading, fileName, error } = useUploadStore();
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    if (!file.type.match(/video\/(mp4|quicktime)/)) {
      setError("Only MP4 and MOV files are supported.");
      return;
    }
    if (file.size > 2 * 1024 * 1024 * 1024) {
      setError("File must be under 2GB.");
      return;
    }

    const partCount = Math.ceil(file.size / CHUNK_SIZE);
    startUpload(file.name, file.size, partCount);

    try {
      // 1. Get presigned URLs
      const presignRes = await fetch("/api/upload/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type,
          fileSize: file.size,
          duration: 0, // será detectado pelo worker
          width: 1080,
          height: 1920,
          fps: 30,
        }),
      }).then((r) => r.json());

      if (presignRes.error) throw new Error(presignRes.error.message);

      const { uploadId, key, projectId: preProjectId, parts } = presignRes;

      // 2. Upload all parts
      const etags: { partNumber: number; etag: string }[] = [];

      await Promise.all(
        parts.map(async ({ partNumber, url }: { partNumber: number; url: string }) => {
          const start = (partNumber - 1) * CHUNK_SIZE;
          const end = Math.min(partNumber * CHUNK_SIZE, file.size);
          const chunk = file.slice(start, end);

          const xhr = new XMLHttpRequest();
          await new Promise<void>((resolve, reject) => {
            xhr.upload.onprogress = (e) => {
              if (e.lengthComputable) {
                updatePartProgress(partNumber, (e.loaded / e.total) * 100);
              }
            };
            xhr.onload = () => {
              const etag = xhr.getResponseHeader("ETag")?.replace(/"/g, "") ?? "";
              etags.push({ partNumber, etag });
              updatePartProgress(partNumber, 100, etag);
              resolve();
            };
            xhr.onerror = () => reject(new Error(`Part ${partNumber} upload failed`));
            xhr.open("PUT", url);
            xhr.setRequestHeader("Content-Type", "application/octet-stream");
            xhr.send(chunk);
          });
        })
      );

      // 3. Complete multipart
      await fetch("/api/upload/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadId, key, parts: etags }),
      });

      completeUpload(key);

      // 4. Create project
      const projectRes = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: file.name.replace(/\.[^/.]+$/, ""),
          language: "pt",
          sourceKey: key,
          fileSize: file.size,
          removeSilencePace: "fast",
          templateName: "Karl",
        }),
      }).then((r) => r.json());

      if (projectRes.error) throw new Error(projectRes.error.message);

      // 5. Redirect to editor
      router.push(`/editor/${projectRes.id}/captions`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    }
  }, [startUpload, updatePartProgress, completeUpload, setError, router]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-display font-black text-text-primary">
          Upload your video
        </h1>
        <p className="mt-2 text-sm text-text-secondary">
          MP4 or MOV • Up to 2GB • Up to 2 hours
        </p>
      </div>

      {/* Drop zone */}
      {!isUploading && (
        <div
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className={`
            relative cursor-pointer rounded-2xl border-2 border-dashed p-16 text-center transition-all
            ${isDragging
              ? "border-brand-accent bg-brand-accent/5 scale-[1.02]"
              : "border-border-default hover:border-brand-accent/50 hover:bg-surface-elevated/50"
            }
          `}
        >
          <input
            ref={inputRef}
            type="file"
            accept="video/mp4,video/quicktime"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />

          <div className="flex flex-col items-center gap-4">
            <div className="w-16 h-16 bg-surface-elevated rounded-2xl flex items-center justify-center">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-brand-accent">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </div>
            <div>
              <p className="font-semibold text-text-primary">
                Drop your video here
              </p>
              <p className="mt-1 text-sm text-text-secondary">
                or <span className="text-brand-accent">click to browse</span>
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Upload progress */}
      {isUploading && (
        <div className="bg-surface-card rounded-2xl p-8 border border-border-subtle">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-surface-elevated rounded-xl flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-brand-accent">
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <path d="M8 21h8M12 17v4" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-text-primary truncate">{fileName}</p>
              <p className="text-xs text-text-muted mt-0.5">
                {totalProgress < 100 ? `Uploading… ${Math.round(totalProgress)}%` : "Processing…"}
              </p>
            </div>
          </div>

          {/* Progress bar */}
          <div className="h-2 bg-surface-elevated rounded-full overflow-hidden">
            <div
              className="h-full bg-brand-accent rounded-full transition-all duration-300"
              style={{ width: `${totalProgress}%` }}
            />
          </div>

          {totalProgress >= 100 && (
            <div className="mt-4 flex items-center gap-2 text-sm text-text-secondary">
              <div className="w-4 h-4 border-2 border-brand-accent border-t-transparent rounded-full animate-spin" />
              Creating project and starting transcription…
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mt-4 p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Tips */}
      {!isUploading && (
        <div className="mt-6 grid grid-cols-3 gap-3">
          {[
            { emoji: "🎙️", text: "Transcription in 100+ languages" },
            { emoji: "✂️", text: "Silence auto-removed" },
            { emoji: "🎬", text: "Export in 1080p" },
          ].map((tip) => (
            <div key={tip.text} className="p-3 bg-surface-card rounded-xl border border-border-subtle text-center">
              <span className="text-xl">{tip.emoji}</span>
              <p className="mt-2 text-xs text-text-secondary leading-relaxed">{tip.text}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
