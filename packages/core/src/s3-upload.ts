/**
 * S3 Upload Helper for RunPod S3-compatible storage
 * Uploads training models to S3 to avoid keeping expensive GPU pods running during download
 */

import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import fs from 'node:fs';
import path from 'node:path';
import { createReadStream } from 'node:fs';

export interface S3Config {
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: string;
  bucket: string;
  region?: string;
}

export interface S3UploadResult {
  success: boolean;
  s3Key?: string;
  s3Url?: string;
  error?: string;
  uploadedBytes?: number;
}

/**
 * Create S3 client from config
 */
export function createS3Client(config: S3Config): S3Client {
  return new S3Client({
    region: config.region || 'us-east-1',
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: true, // Required for RunPod S3
  });
}

/**
 * Load S3 config from environment variables
 */
export function loadS3ConfigFromEnv(): S3Config | null {
  const accessKeyId = process.env.RUNPOD_S3_ACCESS_KEY;
  const secretAccessKey = process.env.RUNPOD_S3_SECRET_KEY;
  const endpoint = process.env.RUNPOD_S3_ENDPOINT || 'https://storage.runpod.io';
  const bucket = process.env.RUNPOD_S3_BUCKET || 'metahuman-training';

  if (!accessKeyId || !secretAccessKey) {
    return null;
  }

  return {
    accessKeyId,
    secretAccessKey,
    endpoint,
    bucket,
  };
}

/**
 * Upload a single file to S3
 */
export async function uploadFileToS3(
  filePath: string,
  s3Key: string,
  config: S3Config,
  onProgress?: (uploadedBytes: number, totalBytes: number) => void
): Promise<S3UploadResult> {
  try {
    const client = createS3Client(config);
    const fileStats = fs.statSync(filePath);
    const fileStream = createReadStream(filePath);

    const upload = new Upload({
      client,
      params: {
        Bucket: config.bucket,
        Key: s3Key,
        Body: fileStream,
      },
      // 10MB parts for faster parallel uploads
      partSize: 10 * 1024 * 1024,
      queueSize: 4, // 4 parallel uploads
    });

    if (onProgress) {
      upload.on('httpUploadProgress', (progress) => {
        if (progress.loaded) {
          onProgress(progress.loaded, fileStats.size);
        }
      });
    }

    await upload.done();

    const s3Url = `${config.endpoint}/${config.bucket}/${s3Key}`;

    return {
      success: true,
      s3Key,
      s3Url,
      uploadedBytes: fileStats.size,
    };
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message,
    };
  }
}

/**
 * Upload a directory to S3 recursively
 */
export async function uploadDirectoryToS3(
  localDir: string,
  s3Prefix: string,
  config: S3Config,
  excludePatterns: string[] = [],
  onProgress?: (currentFile: string, filesComplete: number, totalFiles: number) => void
): Promise<S3UploadResult> {
  try {
    const client = createS3Client(config);
    const files = getAllFiles(localDir, excludePatterns);
    let filesComplete = 0;

    console.log(`📤 Uploading ${files.length} files to S3...`);

    for (const file of files) {
      const relativePath = path.relative(localDir, file);
      const s3Key = path.join(s3Prefix, relativePath).replace(/\\/g, '/'); // Normalize path separators

      if (onProgress) {
        onProgress(relativePath, filesComplete, files.length);
      }

      const fileStream = createReadStream(file);
      const fileStats = fs.statSync(file);

      const upload = new Upload({
        client,
        params: {
          Bucket: config.bucket,
          Key: s3Key,
          Body: fileStream,
        },
        partSize: 10 * 1024 * 1024,
        queueSize: 4,
      });

      await upload.done();
      filesComplete++;

      const sizeMB = (fileStats.size / (1024 * 1024)).toFixed(2);
      console.log(`  ✓ ${relativePath} (${sizeMB}MB)`);
    }

    const s3Url = `${config.endpoint}/${config.bucket}/${s3Prefix}`;

    return {
      success: true,
      s3Key: s3Prefix,
      s3Url,
      uploadedBytes: files.reduce((sum, f) => sum + fs.statSync(f).size, 0),
    };
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message,
    };
  }
}

/**
 * Check if a file exists in S3
 */
export async function checkS3FileExists(s3Key: string, config: S3Config): Promise<boolean> {
  try {
    const client = createS3Client(config);
    await client.send(new HeadObjectCommand({
      Bucket: config.bucket,
      Key: s3Key,
    }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Get all files in a directory recursively, excluding patterns
 */
function getAllFiles(dirPath: string, excludePatterns: string[] = []): string[] {
  const files: string[] = [];

  function walk(currentPath: string) {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      const relativePath = path.relative(dirPath, fullPath);

      // Check if this path matches any exclude pattern
      const shouldExclude = excludePatterns.some(pattern => {
        const regex = new RegExp(pattern.replace(/\*/g, '.*'));
        return regex.test(relativePath) || regex.test(entry.name);
      });

      if (shouldExclude) {
        continue;
      }

      if (entry.isDirectory()) {
        walk(fullPath);
      } else {
        files.push(fullPath);
      }
    }
  }

  walk(dirPath);
  return files;
}
