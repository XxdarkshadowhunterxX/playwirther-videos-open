// app/(app)/dashboard/page.tsx
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const session = await auth();

  const projects = await prisma.project.findMany({
    where: { userId: session!.user.id },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      title: true,
      status: true,
      videoDuration: true,
      templateName: true,
      directUrl: true,
      createdAt: true,
    },
  });

  const statusColors: Record<string, string> = {
    uploading: "text-blue-400",
    processing: "text-yellow-400",
    transcribing: "text-yellow-400",
    ready_to_edit: "text-green-400",
    exporting: "text-orange-400",
    completed: "text-green-400",
    failed: "text-red-400",
  };

  const statusLabels: Record<string, string> = {
    uploading: "Uploading",
    processing: "Processing",
    transcribing: "Transcribing",
    ready_to_edit: "Ready to edit",
    exporting: "Exporting",
    completed: "Completed",
    failed: "Failed",
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-display font-black text-text-primary">
            My Projects
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            {projects.length} project{projects.length !== 1 ? "s" : ""}
          </p>
        </div>

        <Link
          href="/upload"
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-brand-accent hover:bg-brand-accent-hover text-white font-semibold rounded-xl transition-all hover:scale-105 text-sm"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M12 5v14M5 12h14" />
          </svg>
          New Video
        </Link>
      </div>

      {/* Empty state */}
      {projects.length === 0 && (
        <div className="flex flex-col items-center justify-center py-32 text-center">
          <div className="w-16 h-16 bg-surface-elevated rounded-2xl flex items-center justify-center mb-4">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-muted">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <path d="M8 21h8M12 17v4" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-text-primary">No videos yet</h2>
          <p className="mt-2 text-sm text-text-secondary max-w-xs">
            Upload your first video and let AI generate captions automatically.
          </p>
          <Link
            href="/upload"
            className="mt-6 px-6 py-3 bg-brand-accent hover:bg-brand-accent-hover text-white font-semibold rounded-xl transition-colors text-sm"
          >
            Upload first video
          </Link>
        </div>
      )}

      {/* Projects grid */}
      {projects.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {projects.map((project) => (
            <Link
              key={project.id}
              href={`/editor/${project.id}/captions`}
              className="group block bg-surface-card border border-border-subtle hover:border-border-default rounded-2xl overflow-hidden transition-all hover:scale-[1.02] hover:shadow-xl hover:shadow-black/20 animate-fade-in"
            >
              {/* Thumbnail */}
              <div className="aspect-[9/16] bg-surface-elevated relative overflow-hidden max-h-48">
                {project.directUrl ? (
                  <video
                    src={project.directUrl}
                    className="w-full h-full object-cover"
                    muted
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-muted">
                      <polygon points="5,3 19,12 5,21" />
                    </svg>
                  </div>
                )}

                {/* Status overlay for non-complete */}
                {project.status !== "completed" && project.status !== "ready_to_edit" && (
                  <div className="absolute inset-0 bg-surface-bg/80 flex items-center justify-center">
                    <div className="text-center">
                      <div className="w-8 h-8 border-2 border-brand-accent border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                      <span className="text-xs text-text-secondary">
                        {statusLabels[project.status]}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="p-3">
                <p className="text-sm font-medium text-text-primary truncate">
                  {project.title}
                </p>
                <div className="flex items-center justify-between mt-1.5">
                  <span className={`text-xs ${statusColors[project.status] ?? "text-text-muted"}`}>
                    {statusLabels[project.status]}
                  </span>
                  <span className="text-xs text-text-muted">
                    {project.videoDuration
                      ? `${Math.floor(project.videoDuration / 60)}:${String(Math.floor(project.videoDuration % 60)).padStart(2, "0")}`
                      : "--"}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
