// app/api/projects/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { enqueueTranscription } from "@/lib/bullmq";

// GET — Listar projetos do usuário
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const page = parseInt(searchParams.get("page") ?? "1");
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "20"), 100);
  const status = searchParams.get("status") ?? undefined;
  const skip = (page - 1) * limit;

  const where = {
    userId: session.user.id,
    ...(status ? { status: status as any } : {}),
  };

  const [projects, total] = await Promise.all([
    prisma.project.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      select: {
        id: true,
        title: true,
        status: true,
        templateName: true,
        videoDuration: true,
        videoWidth: true,
        videoHeight: true,
        directUrl: true,
        downloadUrl: true,
        thumbnailKey: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.project.count({ where }),
  ]);

  return NextResponse.json({
    projects,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

// POST — Criar projeto e iniciar pipeline
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 });
  }

  const body = await req.json();
  const {
    title,
    language = "pt",
    sourceKey,
    videoWidth = 1080,
    videoHeight = 1920,
    videoDuration = 0,
    videoFps = 30,
    videoSize = 0,
    templateName = "Karl",
    webhookUrl,
    dictionary = [],
    magicZooms = false,
    magicBrolls = false,
    magicBrollsPercentage = 50,
    removeSilencePace,
    removeBadTakes = false,
    cleanAudio = false,
    disableCaptions = false,
    hookTitle,
    music,
  } = body;

  if (!sourceKey) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "sourceKey is required", field: "sourceKey" } },
      { status: 422 }
    );
  }

  // Criar projeto no banco
  const project = await prisma.project.create({
    data: {
      userId: session.user.id,
      title: title || "Untitled Video",
      status: "processing",
      language,
      sourceKey,
      videoWidth,
      videoHeight,
      videoDuration,
      videoFps,
      videoSize: BigInt(videoSize),
      templateName,
      webhookUrl,
      magicZooms,
      magicBrolls,
      magicBrollsPercentage,
      removeSilencePace,
      removeBadTakes,
      cleanAudio,
      disableCaptions,
      hookTitleText: hookTitle?.text,
      hookTitleTemplate: hookTitle?.template,
      hookTitleTop: hookTitle?.top,
      hookTitleSize: hookTitle?.size,
      transcriptionStatus: "PENDING",
      // Dicionário de palavras customizadas
      dictionary: {
        create: dictionary.map((w: string) => ({ word: w })),
      },
      // Música de fundo
      ...(music
        ? {
            projectMusic: {
              create: {
                userMediaId: music.userMediaId,
                volume: music.volume ?? 30,
                startFromTime: music.startFromTime ?? 0,
                fade: music.fade ?? true,
              },
            },
          }
        : {}),
      // Criar job de transcrição no banco
      jobs: {
        create: {
          type: "transcription",
          status: "queued",
        },
      },
    },
  });

  // Enfileirar job de transcrição no BullMQ
  await enqueueTranscription({
    projectId: project.id,
    userId: session.user.id,
    s3Key: sourceKey,
    language: language === "auto" ? undefined : language,
    dictionary,
  });

  return NextResponse.json(
    {
      id: project.id,
      title: project.title,
      status: project.status,
      language: project.language,
      templateName: project.templateName,
      videoWidth: project.videoWidth,
      videoHeight: project.videoHeight,
      videoDuration: project.videoDuration,
      createdAt: project.createdAt,
    },
    { status: 201 }
  );
}
