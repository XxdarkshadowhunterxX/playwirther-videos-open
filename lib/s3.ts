// lib/s3.ts
import {
  S3Client,
  GetObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// ─── AWS S3 Client ──────────────────────────────────────────────────
export const s3Client = new S3Client({
  region: process.env.AWS_REGION ?? "sa-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

const S3_BUCKET = process.env.AWS_S3_BUCKET!;

// ─── Direct Upload (S3) ──────────────────────────────────────────────
export async function generateS3UploadUrl(
  key: string,
  contentType: string
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(s3Client, command, { expiresIn: 3600 });
}

// ─── Multipart Upload (S3) ──────────────────────────────────────────

export async function generateS3MultipartUpload(
  key: string,
  contentType: string,
  partCount: number
): Promise<{ uploadId: string; presignedUrls: string[] }> {
  // 1. Iniciar multipart
  const createResponse = await s3Client.send(
    new CreateMultipartUploadCommand({
      Bucket: S3_BUCKET,
      Key: key,
      ContentType: contentType,
    })
  );

  const uploadId = createResponse.UploadId!;

  // 2. Gerar URL presigned para cada parte (10MB cada)
  const presignedUrls = await Promise.all(
    Array.from({ length: partCount }, async (_, i) => {
      const partCommand = new UploadPartCommand({
        Bucket: S3_BUCKET,
        Key: key,
        UploadId: uploadId,
        PartNumber: i + 1,
      });
      return getSignedUrl(s3Client, partCommand, { expiresIn: 3600 });
    })
  );

  return { uploadId, presignedUrls };
}

export async function completeS3MultipartUpload(
  key: string,
  uploadId: string,
  parts: { PartNumber: number; ETag: string }[]
): Promise<void> {
  await s3Client.send(
    new CompleteMultipartUploadCommand({
      Bucket: S3_BUCKET,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: parts.sort((a, b) => a.PartNumber - b.PartNumber),
      },
    })
  );
}

// ─── Download URL ───────────────────────────────────────────────────

export async function generateS3PresignedGet(
  key: string,
  expiresIn = 86400
): Promise<string> {
  const command = new GetObjectCommand({ Bucket: S3_BUCKET, Key: key });
  return getSignedUrl(s3Client, command, { expiresIn });
}

// ─── CloudFront URL (entrega pública via CDN) ───────────────────────

export function getCloudFrontUrl(key: string): string {
  return `https://${process.env.CLOUDFRONT_DOMAIN}/${key}`;
}

// ─── Calc part count (chunks de 10MB) ──────────────────────────────

export function calcPartCount(fileSizeBytes: number): number {
  const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB
  return Math.max(1, Math.ceil(fileSizeBytes / CHUNK_SIZE));
}
