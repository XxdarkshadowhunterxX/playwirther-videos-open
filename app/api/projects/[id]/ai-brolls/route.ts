import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface Params { params: { id: string } }

export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: projectId } = params;
  const body = await req.json();
  const percentage = body.percentage || 50;
  const layout = body.layout || "cover";
  
  // Duração ideal dinâmica baseada no "pace" (Rápido: 2.5, Médio: 3.5, Longo: 5.5)
  const targetSegmentDuration = body.pace || 3.5;
  const maxBrollDuration = targetSegmentDuration + 1.5;

  if (!process.env.PEXELS_API_KEY) {
    return NextResponse.json({ error: "Pexels API Key não configurada no servidor." }, { status: 500 });
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId, userId: session.user.id },
  });

  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  // 1. Limpar B-rolls automáticos anteriores
  await prisma.projectItem.deleteMany({
    where: { projectId, type: "ai_broll" }
  });

  // 2. Extrair palavras ativas
  const words = await prisma.word.findMany({
    where: { projectId, isRemoved: false, type: "word" },
    orderBy: { position: "asc" },
  });

  if (words.length === 0) {
    return NextResponse.json({ success: true, count: 0 });
  }

  // 3. Agrupar palavras em blocos de tempo
  const allSegments = [];
  let currentGroup = [];

  for (const w of words) {
    currentGroup.push(w);
    const duration = w.endTime - currentGroup[0].startTime;

    if (duration >= targetSegmentDuration) {
      const segStart = currentGroup[0].startTime;
      const segEnd = Math.min(segStart + maxBrollDuration, w.endTime);
      
      allSegments.push({
        start: segStart,
        end: segEnd,
        text: currentGroup.map(x => x.text).join(" "),
      });
      currentGroup = [];
    }
  }
  // Pegar rastro do final se for maior que 3 segundos
  if (currentGroup.length > 0) {
    const dur = currentGroup[currentGroup.length - 1].endTime - currentGroup[0].startTime;
    if (dur >= 3) {
      allSegments.push({
        start: currentGroup[0].startTime,
        end: Math.min(currentGroup[0].startTime + maxBrollDuration, currentGroup[currentGroup.length - 1].endTime),
        text: currentGroup.map(x => x.text).join(" "),
      });
    }
  }

  // 4. Selecionar blocos baseados na porcentagem (%)
  const brollCount = Math.floor(allSegments.length * (percentage / 100));
  if (brollCount === 0) {
    return NextResponse.json({ success: true, count: 0 });
  }

  // Pular segmentos para distribuir uniformemente
  const step = allSegments.length / brollCount;
  const selectedSegments = [];
  for (let i = 0; i < brollCount; i++) {
    const idx = Math.floor(i * step);
    selectedSegments.push(allSegments[idx]);
  }

  console.log(`[B-Roll] Generating ${selectedSegments.length} AI B-Rolls...`);

  // 5. Gerar Queries com OpenAI em paralelo
  const queriesProm = selectedSegments.map(async (seg) => {
    try {
      const aiResponse = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{
          role: "user",
          content: `Generate a 3-5 word Pexels search query in English for this video topic spoken in portuguese: '${seg.text}'. Return ONLY the exact search terms, without quotes or explanation.`
        }]
      });
      return aiResponse.choices[0].message.content?.trim() || "cinematic";
    } catch (e) {
      return "cinematic abstract";
    }
  });

  const queries = await Promise.all(queriesProm);

  // 6. Buscar vídeos no Pexels
  const pexelsProm = queries.map(async (query) => {
    try {
      const res = await fetch(`https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=3&orientation=portrait&size=medium`, {
        headers: { Authorization: process.env.PEXELS_API_KEY as string }
      });
      const data = await res.json();
      if (data.videos && data.videos.length > 0) {
        // Pega link em HD (720 ou 1080)
        let link = data.videos[0].video_files[0].link;
        const hdFile = data.videos[0].video_files.find((f: any) => f.quality === 'hd' && f.width >= 720);
        if (hdFile) link = hdFile.link;

        return { query, assetUrl: link };
      }
      return null;
    } catch (e) {
      return null;
    }
  });

  const pexelsResults = await Promise.all(pexelsProm);

  // 7. Salvar ProjectItems e descontar Créditos
  let brollsCreated = 0;
  for (let i = 0; i < selectedSegments.length; i++) {
    const pex = pexelsResults[i];
    if (pex) {
      await prisma.projectItem.create({
        data: {
          projectId,
          type: "ai_broll",
          prompt: pex.query,
          assetUrl: pex.assetUrl,
          startTime: selectedSegments[i].start,
          endTime: selectedSegments[i].end,
          layout: layout,
          creditsConsumed: 3, // Regra estabelecida na eng reversa
        }
      });
      brollsCreated++;

      // Simular débito de créditos se CreditLedger existir no futuro aqui
    }
  }

  // Update magic property
  await prisma.project.update({
    where: { id: projectId },
    data: { magicBrolls: true, magicBrollsPercentage: percentage }
  });

  return NextResponse.json({ success: true, count: brollsCreated });
}
