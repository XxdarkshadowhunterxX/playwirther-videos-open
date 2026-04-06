// app/api/projects/[id]/export/route.ts
// POST — dispara job de export para a fila video-export

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { enqueueExport } from "@/lib/bullmq";

interface Params { params: { id: string } }

export async function POST(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 });
  }

  const project = await prisma.project.findUnique({
    where: { id: params.id, userId: session.user.id },
    select: { id: true, status: true, transcriptionStatus: true },
  });

  if (!project) {
    return NextResponse.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
  }

  // Só pode exportar projetos prontos para edição ou completados
  const exportableStatuses = ["ready_to_edit", "completed", "failed"];
  if (!exportableStatuses.includes(project.status)) {
    return NextResponse.json(
      { error: { code: "INVALID_STATUS", message: `Cannot export with status "${project.status}"` } },
      { status: 409 }
    );
  }

  if (project.transcriptionStatus !== "COMPLETED") {
    return NextResponse.json(
      { error: { code: "TRANSCRIPTION_INCOMPLETE", message: "Transcription must complete before export" } },
      { status: 409 }
    );
  }

  await prisma.project.update({
    where: { id: params.id },
    data: { status: "processing" },
  });

  await enqueueExport({ projectId: params.id, userId: session.user.id });

  return NextResponse.json({ status: "exporting", projectId: params.id });
}
