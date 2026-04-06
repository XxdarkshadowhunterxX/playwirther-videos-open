// app/api/upload/presign/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { generateS3MultipartUpload, calcPartCount } from "@/lib/s3";
import { v4 as uuidv4 } from "uuid";

const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2GB [CONFIRMADO Submagic]
const MAX_DURATION  = 7200;                     // 2h  [CONFIRMADO Submagic]
const ALLOWED_TYPES = ["video/mp4", "video/quicktime"];

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Not authenticated" } },
      { status: 401 }
    );
  }

  const body = await req.json();
  const { filename, contentType, fileSize, duration = 0, width = 1080, height = 1920, fps = 30 } = body;

  if (!ALLOWED_TYPES.includes(contentType)) {
    return NextResponse.json(
      { error: { code: "UNSUPPORTED_FORMAT", message: "Only MP4 and MOV files are supported" } },
      { status: 415 }
    );
  }

  if (fileSize > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: { code: "FILE_TOO_LARGE", message: "File must be under 2GB" } },
      { status: 413 }
    );
  }

  if (duration > MAX_DURATION) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Video must be under 2 hours" } },
      { status: 422 }
    );
  }

  const projectId = uuidv4();
  const ext = contentType === "video/quicktime" ? "mov" : "mp4";
  const key = `inputs/${session.user.id}/${projectId}/original.${ext}`;
  const partCount = calcPartCount(fileSize);

  const { uploadId, presignedUrls } = await generateS3MultipartUpload(key, contentType, partCount);

  return NextResponse.json({
    uploadId,
    key,
    projectId,
    parts: presignedUrls.map((url, i) => ({ partNumber: i + 1, url })),
    expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    metadata: { width, height, fps, duration },
  });
}
