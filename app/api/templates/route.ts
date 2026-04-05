// app/api/templates/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const presets = await prisma.preset.findMany({
    orderBy: { sortOrder: "asc" },
  });
  return NextResponse.json({ templates: presets });
}
