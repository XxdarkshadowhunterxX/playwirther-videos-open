// app/api/projects/[id]/export/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { enqueueExport } from "@/lib/bullmq";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 });
  }

  const project = await prisma.project.findFirst({
    where: { id: params.id, userId: session.user.id },
  });

  if (!project) {
    return NextResponse.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
  }

  if (project.status !== "ready_to_edit") {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Project must be in ready_to_edit status to export" } },
      { status: 422 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const resolution = body.resolution ?? "1080p";

  // Atualizar status para exporting
  await prisma.project.update({
    where: { id: params.id },
    data: { status: "exporting" },
  });

  // Criar job de export no banco
  const job = await prisma.job.create({
    data: {
      projectId: params.id,
      type: "export",
      status: "queued",
    },
  });

  // Enfileirar no BullMQ [CONFIRMADO: export é assíncrono]
  await enqueueExport({
    projectId: params.id,
    userId: session.user.id,
    resolution,
  });

  return NextResponse.json(
    {
      status: "exporting",
      jobId: job.id,
      estimatedSeconds: Math.ceil(project.videoDuration * 0.5),
    },
    { status: 202 }
  );
}
