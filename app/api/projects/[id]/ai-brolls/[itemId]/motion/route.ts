import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Queue } from "bullmq";

const motionQueue = new Queue("motion-graphics", {
  connection: {
    host: process.env.UPSTASH_REDIS_REST_URL?.replace("https://", "").replace("http://", "") ?? "",
    port: 6379,
    password: process.env.UPSTASH_REDIS_REST_TOKEN ?? "",
    tls: {},
  },
});

export async function POST(req: NextRequest, { params }: { params: { id: string, itemId: string } }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: projectId, itemId } = params;
  const { imgUrl } = await req.json();

  if (!imgUrl) {
    return NextResponse.json({ error: "Imagem local do produto ausente" }, { status: 400 });
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId, userId: session.user.id },
  });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const item = await prisma.projectItem.findUnique({
    where: { id: itemId }
  });

  if (!item) return NextResponse.json({ error: "Item not found" }, { status: 404 });

  // Disparar worker que irá gerar o MP4
  const duration = Math.max(3, (item.endTime - item.startTime) + 2); // duração + 2s sobra para garantir

  await motionQueue.add("render-motion", {
    projectId,
    itemId,
    userId: session.user.id,
    imgUrl,
    duration
  });

  return NextResponse.json({ success: true, message: "Job queued" });
}
