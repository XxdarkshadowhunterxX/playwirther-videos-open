import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

interface Params { params: { id: string, itemId: string } }

export async function DELETE(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: projectId, itemId } = params;

  // Verifica dono do projeto
  const project = await prisma.project.findUnique({
    where: { id: projectId, userId: session.user.id },
  });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  await prisma.projectItem.delete({
    where: { id: itemId }
  });

  return NextResponse.json({ success: true });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: projectId, itemId } = params;
  const { prompt, startTime, endTime, localAssetUrl, mediaOffset } = await req.json();

  const project = await prisma.project.findUnique({
    where: { id: projectId, userId: session.user.id },
  });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const existingItem = await prisma.projectItem.findUnique({
    where: { id: itemId }
  });
  if (!existingItem) return NextResponse.json({ error: "Item not found" }, { status: 404 });

  let updateData: any = {};

  if (localAssetUrl) {
    updateData = {
      assetUrl: localAssetUrl,
      type: "user_broll",
      prompt: prompt || "Mídia Local"
    };
  } else if (prompt && prompt !== existingItem.prompt) {
    // Busca normal Pexels porque o Prompt de pesquisa mudou explicitamente
    if (!process.env.PEXELS_API_KEY) {
      return NextResponse.json({ error: "Pexels API Key not found" }, { status: 500 });
    }

    const res = await fetch(`https://api.pexels.com/videos/search?query=${encodeURIComponent(prompt)}&per_page=3&orientation=portrait&size=medium`, {
      headers: { Authorization: process.env.PEXELS_API_KEY }
    });
    const data = await res.json();
    
    if (!data.videos || data.videos.length === 0) {
      return NextResponse.json({ error: "No videos found for this prompt" }, { status: 404 });
    }

    let link = data.videos[0].video_files[0].link;
    const hdFile = data.videos[0].video_files.find((f: any) => f.quality === 'hd' && f.width >= 720);
    if (hdFile) link = hdFile.link;

    updateData = {
      prompt: prompt,
      assetUrl: link,
      type: "ai_broll"
    };
  } else {
    // Apenas atualizando as métricas de Corte / Timestamps sem descartar o Vídeo atual!
    updateData = {
      prompt: prompt || existingItem.prompt
    };
  }

  if (typeof startTime === 'number') updateData.startTime = startTime;
  if (typeof endTime === 'number') updateData.endTime = endTime;
  if (typeof mediaOffset === 'number') updateData.mediaOffset = mediaOffset;

  const updatedItem = await prisma.projectItem.update({
    where: { id: itemId },
    data: updateData
  });

  return NextResponse.json({ success: true, item: updatedItem });
}
