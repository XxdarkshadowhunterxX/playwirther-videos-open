// app/(app)/editor/[id]/captions/page.tsx
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect, notFound } from "next/navigation";
import { CaptionsEditor } from "./CaptionsEditor";
import { getCloudFrontUrl } from "@/lib/s3";

interface Props {
  params: { id: string };
}

export default async function CaptionsPage({ params }: Props) {
  const session = await auth();
  if (!session) redirect("/login");

  const project = await prisma.project.findUnique({
    where: { id: params.id, userId: session.user.id },
    select: {
      id: true,
      status: true,
      transcriptionStatus: true,
      templateName: true,
      videoDuration: true,
      sourceKey: true,
      items: {
        where: { type: "ai_broll" },
        orderBy: { startTime: "asc" }
      },
      words: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          text: true,
          type: true,
          startTime: true,
          endTime: true,
          confidence: true,
          isFiller: true,
          isRemoved: true,
          position: true,
        },
      },
    },
  });

  if (!project) notFound();

  // Serializar para o client component (Prisma retorna Decimal — converter para number)
  const words = project.words.map((w) => ({
    ...w,
    projectId: params.id,
    type: w.type as "word" | "silence" | "punctuation",
    startTime: Number(w.startTime),
    endTime: Number(w.endTime),
    confidence: w.confidence !== null ? Number(w.confidence) : null,
  }));

  return (
    <CaptionsEditor
      projectId={params.id}
      userId={session.user.id}
      videoUrl={getCloudFrontUrl(project.sourceKey)}
      initialWords={words}
      initialItems={project.items}
      templateName={project.templateName}
      initialStatus={project.status}
    />
  );
}
