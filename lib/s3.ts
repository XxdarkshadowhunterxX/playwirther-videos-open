// lib/s3.ts
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// ─── AWS S3 (output / delivery) ────────────────────────────────────
export const s3Client = new S3Client({
  region: process.env.AWS_REGION ?? "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

// ─── Cloudflare R2 (upload ingestão — sem egress fee) ──────────────
export const r2Client = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT!, // https://{accountId}.r2.cloudflarestorage.com
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

// ─── Helpers ────────────────────────────────────────────────────────

export async function generateS3PresignedGet(
  key: string,
  expiresIn = 86400
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: process.env.AWS_S3_BUCKET!,
    Key: key,
  });
  return getSignedUrl(s3Client, command, { expiresIn });
}

export async function generateR2MultipartUpload(
  key: string,
  contentType: string,
  partCount: number
): Promise<{ uploadId: string; presignedUrls: string[] }> {
  // 1. Iniciar multipart
  const createResponse = await r2Client.send(
    new CreateMultipartUploadCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: key,
      ContentType: contentType,
    })
  );

  const uploadId = createResponse.UploadId!;

  // 2. Gerar URL presigned para cada parte
  const presignedUrls = await Promise.all(
    Array.from({ length: partCount }, async (_, i) => {
      const partCommand = new UploadPartCommand({
        Bucket: process.env.R2_BUCKET_NAME!,
        Key: key,
        UploadId: uploadId,
        PartNumber: i + 1,
      });
      return getSignedUrl(r2Client, partCommand, { expiresIn: 3600 });
    })
  );

  return { uploadId, presignedUrls };
}

export async function completeR2MultipartUpload(
  key: string,
  uploadId: string,
  parts: { PartNumber: number; ETag: string }[]
): Promise<void> {
  await r2Client.send(
    new CompleteMultipartUploadCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: parts.sort((a, b) => a.PartNumber - b.PartNumber),
      },
    })
  );
}

export function getCloudFrontUrl(key: string): string {
  return `https://${process.env.CLOUDFRONT_DOMAIN}/${key}`;
}

export function getR2PublicUrl(key: string): string {
  return `${process.env.R2_PUBLIC_URL}/${key}`;
}

// Calc number of parts for 10MB chunks
export function calcPartCount(fileSizeBytes: number): number {
  const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB
  return Math.ceil(fileSizeBytes / CHUNK_SIZE);
}
