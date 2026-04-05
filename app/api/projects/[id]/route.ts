// app/api/projects/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET — Buscar projeto por ID com words[]
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 });
  }

  const project = await prisma.project.findFirst({
    where: { id: params.id, userId: session.user.id },
    include: {
      words: {
        orderBy: { position: "asc" },
      },
      jobs: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          type: true,
          status: true,
          progress: true,
          errorMsg: true,
          completedAt: true,
        },
      },
      items: true,
      projectMusic: true,
    },
  });

  if (!project) {
    return NextResponse.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
  }

  // Serializar BigInt
  return NextResponse.json({
    ...project,
    videoSize: project.videoSize.toString(),
  });
}

// PUT — Atualizar projeto (texto das legendas, template, etc.)
export async function PUT(
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

  const body = await req.json();
  const { title, templateName, words } = body;

  // Atualizar metadados do projeto
  const updateData: Record<string, any> = {};
  if (title !== undefined) updateData.title = title;
  if (templateName !== undefined) updateData.templateName = templateName;

  const updated = await prisma.$transaction(async (tx) => {
    // Atualizar projeto
    const proj = Object.keys(updateData).length
      ? await tx.project.update({ where: { id: params.id }, data: updateData })
      : project;

    // Atualizar words em batch (apenas campos enviados)
    if (words?.length) {
      for (const wordUpdate of words) {
        const { id, ...updates } = wordUpdate;
        await tx.word.updateMany({
          where: { id, projectId: params.id },
          data: updates,
        });
      }
    }

    return proj;
  });

  return NextResponse.json({
    ...updated,
    videoSize: updated.videoSize.toString(),
  });
}

// DELETE — Remover projeto
export async function DELETE(
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

  // Cascade delete via Prisma (words, jobs, items já configurados)
  await prisma.project.delete({ where: { id: params.id } });

  // TODO: deletar assets do S3 em background job

  return new NextResponse(null, { status: 204 });
}
