// app/api/projects/[id]/words/route.ts
// PATCH — toggle isRemoved de uma ou múltiplas palavras

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

interface Params { params: { id: string } }

// PATCH /api/projects/[id]/words
// Body: { wordIds: string[], isRemoved: boolean }
//    ou { toggleFillers: true }
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 });
  }

  // Verificar ownership
  const project = await prisma.project.findUnique({
    where: { id: params.id, userId: session.user.id },
    select: { id: true },
  });
  if (!project) return NextResponse.json({ error: { code: "NOT_FOUND" } }, { status: 404 });

  const body = await req.json();
  const { wordIds, isRemoved, toggleFillers } = body;

  // Toggle global de filler words
  if (toggleFillers === true) {
    const fillerCount = await prisma.word.count({
      where: { projectId: params.id, isFiller: true, isRemoved: false },
    });
    const shouldRemove = fillerCount > 0;

    await prisma.word.updateMany({
      where: { projectId: params.id, isFiller: true },
      data: { isRemoved: shouldRemove },
    });

    return NextResponse.json({ removed: shouldRemove, affected: fillerCount });
  }

  // Toggle individual/batch
  if (!Array.isArray(wordIds) || wordIds.length === 0) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "wordIds must be a non-empty array" } },
      { status: 422 }
    );
  }

  await prisma.word.updateMany({
    where: { id: { in: wordIds }, projectId: params.id },
    data: { isRemoved: Boolean(isRemoved) },
  });

  return NextResponse.json({ updated: wordIds.length });
}

// GET /api/projects/[id]/words — retorna todas as palavras do projeto
export async function GET(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 });
  }

  const words = await prisma.word.findMany({
    where: { projectId: params.id, project: { userId: session.user.id } },
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
  });

  return NextResponse.json({ words });
}
