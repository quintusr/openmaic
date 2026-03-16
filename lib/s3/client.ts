// ABOUTME: S3 client for OpenMAIC - upload, download, and list operations
// Uploads generated classrooms to s3://hello-content-factory/openmaic/

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';

const BUCKET = 'hello-content-factory';
const PREFIX = 'openmaic';

export interface S3Result {
  success: boolean;
  key?: string;
  error?: string;
}

export function createS3Client(
  region: string = 'eu-west-1',
): S3Client {
  return new S3Client({ region });
}

/**
 * Check if S3 is available by attempting to resolve credentials.
 * Supports all AWS credential sources: env vars, SSO, IAM roles, profiles.
 * Tries GetObject on subjects.json as a lightweight probe (works even
 * without ListBucket permission).
 */
export async function checkS3Available(): Promise<boolean> {
  try {
    const client = createS3Client();
    // Try GetObject on a known key — works with minimal IAM permissions
    await client.send(
      new GetObjectCommand({
        Bucket: BUCKET,
        Key: PREFIX + '/subjects.json',
      }),
    );
    return true;
  } catch (err: unknown) {
    const name = err instanceof Error && 'name' in err ? err.name : '';
    // NoSuchKey means credentials work but file doesn't exist yet — S3 is available
    if (name === 'NoSuchKey') return true;
    // AccessDenied or credential errors mean S3 is not available
    return false;
  }
}

export function s3Key(...segments: string[]): string {
  return [PREFIX, ...segments].join('/');
}

export async function uploadJson(
  client: S3Client,
  key: string,
  data: unknown,
): Promise<S3Result> {
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: JSON.stringify(data, null, 2),
        ContentType: 'application/json',
      }),
    );
    return { success: true, key };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, key, error: message };
  }
}

export async function downloadJson<T = unknown>(
  client: S3Client,
  key: string,
): Promise<T | null> {
  try {
    const response = await client.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: key }),
    );
    if (!response.Body) return null;
    const body = await response.Body.transformToString('utf-8');
    return JSON.parse(body) as T;
  } catch (error: unknown) {
    const code =
      error instanceof Error && 'name' in error ? error.name : '';
    if (code === 'NoSuchKey' || code === 'AccessDenied') return null;
    throw error;
  }
}

export async function uploadBlob(
  client: S3Client,
  key: string,
  body: Uint8Array | Buffer,
  contentType: string,
): Promise<S3Result> {
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    return { success: true, key };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, key, error: message };
  }
}

export async function downloadBlob(
  client: S3Client,
  key: string,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  try {
    const response = await client.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: key }),
    );
    if (!response.Body) return null;
    const bytes = await response.Body.transformToByteArray();
    return {
      bytes,
      contentType: response.ContentType || 'application/octet-stream',
    };
  } catch (error: unknown) {
    const code =
      error instanceof Error && 'name' in error ? error.name : '';
    if (code === 'NoSuchKey' || code === 'AccessDenied') return null;
    throw error;
  }
}

export async function listKeys(
  client: S3Client,
  prefix: string,
): Promise<string[]> {
  const keys: string[] = [];
  let continuationToken: string | undefined;

  do {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    for (const obj of response.Contents ?? []) {
      if (obj.Key) keys.push(obj.Key);
    }
    continuationToken = response.IsTruncated
      ? response.NextContinuationToken
      : undefined;
  } while (continuationToken);

  return keys;
}
