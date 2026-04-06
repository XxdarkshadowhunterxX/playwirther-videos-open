import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { generateS3UploadUrl } from "@/lib/s3";

export async function POST(req: NextRequest, { params }: { params: { id: string, itemId: string } }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { contentType } = await req.json();
    const ext = contentType.split("/")[1] || "mp4";
    const key = `uploads/${session.user.id}/${params.id}/brolls/${params.itemId}.${ext}`;

    const url = await generateS3UploadUrl(key, contentType);
    
    // Convert to CloudFront URL for read mapping (matches logic elsewhere in the app if applicable)
    // Actually we just return the direct URL and let the client upload. 
    // And we return the expected CloudFront URL so the client can save it.
    const baseUrl = process.env.CLOUDFRONT_DOMAIN 
      ? `https://${process.env.CLOUDFRONT_DOMAIN}` 
      : `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com`;
    const finalAssetUrl = `${baseUrl}/${key}`;

    return NextResponse.json({ url, finalAssetUrl });
  } catch (error) {
    console.error("Presign error:", error);
    return NextResponse.json({ error: "Failed to generate upload URL" }, { status: 500 });
  }
}
