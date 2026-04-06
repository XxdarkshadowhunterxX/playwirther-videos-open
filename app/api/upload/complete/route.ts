// app/api/upload/complete/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { completeS3MultipartUpload } from "@/lib/s3";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 });
  }

  const body = await req.json();
  const { uploadId, key, parts } = body as {
    uploadId: string;
    key: string;
    parts: { partNumber: number; etag: string }[];
  };

  if (!uploadId || !key || !parts?.length) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Missing required fields" } },
      { status: 422 }
    );
  }

  await completeS3MultipartUpload(
    key,
    uploadId,
    parts.map((p) => ({ PartNumber: p.partNumber, ETag: `"${p.etag}"` }))
  );

  return NextResponse.json({ key, status: "uploaded" });
}
