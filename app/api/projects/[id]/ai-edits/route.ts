import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Thresholds reais mapeados do Submagic
const SILENCE_THRESHOLDS = {
  extra_fast: 0.1,
  fast: 0.2, // Default
  natural: 0.6,
};

const BAD_TAKES_CONFIDENCE_THRESHOLD = 0.6;
const BAD_TAKES_MIN_SEQUENCE = 3; // Mínimo de palavras ruins seguidas para considerar um take ruim

interface Params { params: { id: string } }

export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: projectId } = params;
  const body = await req.json();
  const { action, pace } = body; // action: 'remove-silence' | 'remove-bad-takes' | 'restore-all'

  const project = await prisma.project.findUnique({
    where: { id: projectId, userId: session.user.id },
  });

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  // 1. Restore all cuts before applying new logic (to prevent overlapping state issues)
  await prisma.word.updateMany({
    where: { projectId, isRemoved: true, type: { in: ["word", "silence", "punctuation"] } },
    data: { isRemoved: false },
  });

  const words = await prisma.word.findMany({
    where: { projectId },
    orderBy: { position: "asc" },
  });

  let removedCount = 0;
  const idsToRemove: string[] = [];

  if (action === "remove-silence") {
    const paceKey = pace as keyof typeof SILENCE_THRESHOLDS;
    const threshold = SILENCE_THRESHOLDS[paceKey] || SILENCE_THRESHOLDS.fast;

    for (const word of words) {
      if (word.type === "silence") {
        const duration = word.endTime - word.startTime;
        if (duration >= threshold) {
          idsToRemove.push(word.id);
        }
      }
    }

    // Update DB
    await prisma.project.update({
      where: { id: projectId },
      data: { removeSilencePace: paceKey },
    });

  } else if (action === "remove-bad-takes") {
    
    let badWordSequence: string[] = [];

    for (const word of words) {
      if (word.type === "word" && word.confidence !== null && word.confidence < BAD_TAKES_CONFIDENCE_THRESHOLD) {
        badWordSequence.push(word.id);
      } else if (word.type === "word") {
        // Se quebrou a sequência, verificamos se era grande o suficiente para ser um "bad take"
        if (badWordSequence.length >= BAD_TAKES_MIN_SEQUENCE) {
          idsToRemove.push(...badWordSequence);
        }
        badWordSequence = [];
      }
    }
    // Verifica o final do loop
    if (badWordSequence.length >= BAD_TAKES_MIN_SEQUENCE) {
      idsToRemove.push(...badWordSequence);
    }

    // Update DB
    await prisma.project.update({
      where: { id: projectId },
      data: { removeBadTakes: true },
    });

  } else if (action === "restore-all") {
    // Already did restore logic at the top
    await prisma.project.update({
      where: { id: projectId },
      data: { removeBadTakes: false, removeSilencePace: null },
    });
  }

  // Final apply
  if (idsToRemove.length > 0) {
    await prisma.word.updateMany({
      where: { id: { in: idsToRemove } },
      data: { isRemoved: true },
    });
    removedCount = idsToRemove.length;
  }

  return NextResponse.json({
    success: true,
    action,
    removedSegmentsCount: removedCount,
  });
}
