// Cloudflare R2 (S3 API) client shared by the document storage module and the worker.
// No "server-only" marker so the standalone worker process can import it.
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export const r2Configured = () => Boolean(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET);

let client: S3Client | null = null;
export function s3() {
  if (!client) {
    client = new S3Client({
      region: "auto",
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! },
    });
  }
  return client;
}

/** Write an object at an exact key (content-addressed storage). Returns the storage key, or null without R2. */
export async function putR2Object(key: string, body: Buffer, contentType: string): Promise<string | null> {
  if (!r2Configured()) return null;
  await s3().send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET!, Key: key, Body: body, ContentType: contentType }));
  return `r2:${key}`;
}
