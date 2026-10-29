import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { AppError } from './rbac';

function store() {
  const {
    BACKUP_S3_ENDPOINT: endpoint,
    BACKUP_S3_BUCKET: bucket,
    BACKUP_S3_ACCESS_KEY_ID: accessKeyId,
    BACKUP_S3_SECRET_ACCESS_KEY: secretAccessKey,
  } = process.env;
  if (
    !endpoint ||
    !bucket ||
    !accessKeyId ||
    !secretAccessKey ||
    new URL(endpoint).protocol !== 'https:'
  )
    throw new AppError(503, 'Configure private HTTPS object storage for cloud backups.');
  return {
    bucket,
    client: new S3Client({
      endpoint,
      region: process.env.BACKUP_S3_REGION || 'auto',
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    }),
  };
}

export async function uploadBackup(
  file: string,
  metadata: { name: string; sha256: string; size: number },
) {
  const { bucket, client } = store();
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: metadata.name,
        Body: createReadStream(file),
        ContentLength: metadata.size,
        ContentType: 'application/octet-stream',
        Metadata: { sha256: metadata.sha256 },
      }),
    );
    const saved = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: metadata.name }));
    if (saved.ContentLength !== metadata.size || saved.Metadata?.sha256 !== metadata.sha256)
      throw new Error('Archive verification failed');
  } catch {
    throw new AppError(
      503,
      'Cloud backup upload or verification failed. No successful backup was recorded.',
    );
  } finally {
    client.destroy();
  }
}

export async function downloadBackup(name: string, file: string) {
  const { bucket, client } = store();
  try {
    const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: name }));
    if (!object.Body) throw new Error('Archive not found');
    await pipeline(
      object.Body as NodeJS.ReadableStream,
      createWriteStream(file, { flags: 'wx', mode: 0o600 }),
    );
  } catch {
    throw new AppError(503, 'Cloud backup download failed. The archive was not restored.');
  } finally {
    client.destroy();
  }
}
