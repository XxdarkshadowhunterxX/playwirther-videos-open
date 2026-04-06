// app/(app)/editor/[id]/layout.tsx
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";

interface Props {
  children: React.ReactNode;
  params: { id: string };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const project = await prisma.project.findUnique({
    where: { id: params.id },
    select: { title: true },
  });
  return { title: project?.title ?? "Editor" };
}

export default async function EditorLayout({ children, params }: Props) {
  const session = await auth();
  if (!session) redirect("/login");

  const project = await prisma.project.findUnique({
    where: { id: params.id, userId: session.user.id },
    select: {
      id: true,
      title: true,
      status: true,
      videoDuration: true,
    },
  });

  if (!project) notFound();

  const tabs = [
    { label: "Captions", href: `/editor/${params.id}/captions` },
    { label: "Silence", href: `/editor/${params.id}/trim` },
    { label: "B-Roll", href: `/editor/${params.id}/broll` },
  ];

  const isProcessing = !["ready_to_edit", "completed", "failed"].includes(project.status);

  return (
    <div className="min-h-screen bg-surface-bg flex flex-col">
      {/* Editor Header */}
      <header className="sticky top-14 z-40 glass border-b border-border-subtle">
        <div className="max-w-screen-2xl mx-auto px-4 flex items-center h-11 gap-4">
          {/* Back */}
          <Link
            href="/dashboard"
            className="flex items-center gap-1.5 text-sm text-text-muted hover:text-text-primary transition-colors shrink-0"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 5l-7 7 7 7" />
            </svg>
            Projetos
          </Link>

          <span className="text-border-subtle">|</span>

          {/* Title */}
          <p className="text-sm font-medium text-text-primary truncate flex-1 min-w-0">
            {project.title}
          </p>

          {/* Status badge */}
          {isProcessing && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-yellow-500/10 border border-yellow-500/20 rounded-full shrink-0">
              <div className="w-1.5 h-1.5 bg-yellow-400 rounded-full animate-pulse" />
              <span className="text-xs text-yellow-400 font-medium">
                {project.status === "transcribing" ? "Transcrevendo..." : "Processando..."}
              </span>
            </div>
          )}

          {/* Tabs */}
          <nav className="flex items-center gap-1">
            {tabs.map((tab) => (
              <Link
                key={tab.href}
                href={tab.href}
                className="px-3 py-1.5 text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-surface-elevated rounded-lg transition-colors"
              >
                {tab.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1">{children}</div>
    </div>
  );
}
