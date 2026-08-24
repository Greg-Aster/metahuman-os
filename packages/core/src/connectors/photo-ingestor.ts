/**
 * Photo Ingestor Connector
 *
 * Ingests photos into the memory system with EXIF metadata extraction.
 * Extracts: date taken, GPS coordinates, camera info, and basic image stats.
 *
 * Part of Phase 3: Massive Greg-Centric Grounding
 */

import * as fs from 'fs';
import * as path from 'path';
import ExifReader from 'exif-reader';
import { getProfilePaths } from '../paths.js';
import { audit } from '../audit.js';
import { captureEventWithDetails, toToolParameters } from '../memory.js';

// ============================================================================
// Types
// ============================================================================

export interface PhotoMetadata {
  // File info
  filename: string;
  filepath: string;
  fileSize: number;
  mimeType: string;

  // Date/Time
  dateTaken?: string;
  dateOriginal?: string;
  dateModified?: string;

  // Camera info
  cameraMake?: string;
  cameraModel?: string;
  lens?: string;
  focalLength?: number;
  aperture?: number;
  shutterSpeed?: string;
  iso?: number;

  // GPS
  gps?: {
    latitude: number;
    longitude: number;
    altitude?: number;
  };

  // Image dimensions
  width?: number;
  height?: number;
  orientation?: number;

  // Additional
  software?: string;
  artist?: string;
  copyright?: string;
  description?: string;
}

export interface PhotoIngestionResult {
  success: boolean;
  filepath: string;
  memoryId?: string;
  metadata?: PhotoMetadata;
  error?: string;
}

export interface PhotoIngestionOptions {
  /** Copy photo to profile's media directory */
  copyToProfile?: boolean;
  /** Generate a caption/description using LLM (requires separate node) */
  generateCaption?: boolean;
  /** Additional tags to add */
  additionalTags?: string[];
  /** Source context (e.g., "phone sync", "manual upload") */
  source?: string;
}

// ============================================================================
// EXIF Extraction
// ============================================================================

/**
 * Extract EXIF metadata from a photo file.
 */
export async function extractExifMetadata(filepath: string): Promise<PhotoMetadata> {
  const stats = fs.statSync(filepath);
  const filename = path.basename(filepath);
  const ext = path.extname(filepath).toLowerCase();

  const metadata: PhotoMetadata = {
    filename,
    filepath,
    fileSize: stats.size,
    mimeType: getMimeType(ext),
    dateModified: stats.mtime.toISOString(),
  };

  // Read file and extract EXIF
  try {
    const buffer = fs.readFileSync(filepath);

    // Find EXIF data in JPEG/TIFF
    const exifOffset = findExifOffset(buffer);
    if (exifOffset !== -1) {
      const exifBuffer = buffer.slice(exifOffset);
      const exif = ExifReader(exifBuffer);
      const image = exif.Image || {};
      const photo = exif.Photo || {};
      const gps = exif.GPSInfo || {};

      // Date/Time
      const dateOriginal = parseExifDate(photo.DateTimeOriginal);
      const dateTaken = dateOriginal || parseExifDate(image.DateTime);
      if (dateOriginal) {
        metadata.dateOriginal = dateOriginal;
      }
      if (dateTaken) {
        metadata.dateTaken = dateTaken;
      }

      // Camera info
      if (image.Make) metadata.cameraMake = String(image.Make).trim();
      if (image.Model) metadata.cameraModel = String(image.Model).trim();
      if (photo.LensModel) metadata.lens = String(photo.LensModel).trim();
      if (photo.FocalLength) metadata.focalLength = photo.FocalLength;
      if (photo.FNumber) metadata.aperture = photo.FNumber;
      if (photo.ExposureTime) {
        metadata.shutterSpeed = formatShutterSpeed(photo.ExposureTime);
      }
      if (photo.ISOSpeedRatings) {
        metadata.iso = photo.ISOSpeedRatings;
      }

      // GPS
      if (gps.GPSLatitude && gps.GPSLongitude) {
        const lat = parseGPSCoordinate(gps.GPSLatitude, gps.GPSLatitudeRef);
        const lon = parseGPSCoordinate(gps.GPSLongitude, gps.GPSLongitudeRef);
        if (lat !== null && lon !== null) {
          metadata.gps = {
            latitude: lat,
            longitude: lon,
            altitude: gps.GPSAltitude,
          };
        }
      }

      // Dimensions
      if (photo.PixelXDimension) metadata.width = photo.PixelXDimension;
      if (photo.PixelYDimension) metadata.height = photo.PixelYDimension;
      if (image.Orientation) metadata.orientation = image.Orientation;

      // Additional
      if (image.Software) metadata.software = String(image.Software).trim();
      if (image.Artist) metadata.artist = String(image.Artist).trim();
      if (image.Copyright) metadata.copyright = String(image.Copyright).trim();
      if (image.ImageDescription) {
        metadata.description = String(image.ImageDescription).trim();
      }
    }
  } catch (error) {
    // EXIF extraction failed, but we still have basic file info
    console.warn(`[photo-ingestor] EXIF extraction failed for ${filepath}:`, error);
  }

  return metadata;
}

/**
 * Find the offset of EXIF data in a JPEG buffer.
 */
function findExifOffset(buffer: Buffer): number {
  // JPEG with EXIF: starts with FFD8, then has APP1 marker (FFE1) with "Exif\0\0"
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return -1; // Not a JPEG
  }

  let offset = 2;
  while (offset < buffer.length - 4) {
    if (buffer[offset] !== 0xff) {
      offset++;
      continue;
    }

    const marker = buffer[offset + 1];

    // APP1 marker (EXIF)
    if (marker === 0xe1) {
      const length = buffer.readUInt16BE(offset + 2);
      // Check for "Exif\0\0" signature
      if (
        buffer[offset + 4] === 0x45 && // E
        buffer[offset + 5] === 0x78 && // x
        buffer[offset + 6] === 0x69 && // i
        buffer[offset + 7] === 0x66 && // f
        buffer[offset + 8] === 0x00 &&
        buffer[offset + 9] === 0x00
      ) {
        return offset + 10; // Return offset to TIFF header
      }
    }

    // Skip to next marker
    if (marker >= 0xd0 && marker <= 0xd9) {
      offset += 2; // Markers without length
    } else {
      const length = buffer.readUInt16BE(offset + 2);
      offset += 2 + length;
    }
  }

  return -1;
}

/**
 * Parse EXIF date string to ISO format.
 */
export function parseExifDate(value: Date | string | undefined): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value !== 'string') return null;

  const match = value.match(/(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!match) return null;

  const [, year, month, day, hour, minute, second] = match;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
}

/**
 * Parse GPS coordinate from EXIF format.
 */
export function parseGPSCoordinate(
  coord: number[] | undefined,
  ref: string | undefined
): number | null {
  if (!coord || coord.length < 3) return null;

  const [degrees, minutes, seconds] = coord;
  let decimal = degrees + minutes / 60 + seconds / 3600;

  if (ref === 'S' || ref === 'W') {
    decimal = -decimal;
  }

  return decimal;
}

/**
 * Format shutter speed for display.
 */
function formatShutterSpeed(exposure: number): string {
  if (exposure >= 1) {
    return `${exposure}s`;
  }
  return `1/${Math.round(1 / exposure)}s`;
}

/**
 * Get MIME type from file extension.
 */
function getMimeType(ext: string): string {
  const mimeTypes: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.heic': 'image/heic',
    '.heif': 'image/heif',
    '.tiff': 'image/tiff',
    '.tif': 'image/tiff',
    '.bmp': 'image/bmp',
    '.raw': 'image/raw',
    '.cr2': 'image/x-canon-cr2',
    '.nef': 'image/x-nikon-nef',
    '.arw': 'image/x-sony-arw',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

// ============================================================================
// Memory Integration
// ============================================================================

/**
 * Generate tags from photo metadata.
 */
function generateTagsFromMetadata(metadata: PhotoMetadata): string[] {
  const tags: string[] = ['photo'];

  if (metadata.cameraMake) {
    tags.push(metadata.cameraMake.toLowerCase());
  }
  if (metadata.cameraModel) {
    tags.push(metadata.cameraModel.toLowerCase());
  }
  if (metadata.gps) {
    tags.push('geotagged');
  }
  if (metadata.dateTaken) {
    const date = new Date(metadata.dateTaken);
    const year = date.getFullYear();
    const month = date.toLocaleString('default', { month: 'long' }).toLowerCase();
    tags.push(`${year}`, month);
  }

  return [...new Set(tags)]; // Deduplicate
}

/**
 * Generate a content description for the memory.
 */
function generateContentFromMetadata(
  metadata: PhotoMetadata,
  options?: PhotoIngestionOptions
): string {
  const parts: string[] = [];

  parts.push(`Photo: ${metadata.filename}`);

  if (metadata.dateTaken) {
    const date = new Date(metadata.dateTaken);
    parts.push(`Taken: ${date.toLocaleDateString()} ${date.toLocaleTimeString()}`);
  }

  if (metadata.cameraMake || metadata.cameraModel) {
    const camera = [metadata.cameraMake, metadata.cameraModel].filter(Boolean).join(' ');
    parts.push(`Camera: ${camera}`);
  }

  if (metadata.gps) {
    parts.push(`Location: ${metadata.gps.latitude.toFixed(6)}, ${metadata.gps.longitude.toFixed(6)}`);
  }

  if (metadata.description) {
    parts.push(`Description: ${metadata.description}`);
  }

  if (options?.source) {
    parts.push(`Source: ${options.source}`);
  }

  return parts.join('\n');
}

/**
 * Ingest a single photo into the memory system.
 */
export async function ingestPhoto(
  filepath: string,
  username: string,
  options?: PhotoIngestionOptions
): Promise<PhotoIngestionResult> {
  const profilePaths = getProfilePaths(username);

  try {
    // Check file exists
    if (!fs.existsSync(filepath)) {
      return {
        success: false,
        filepath,
        error: `File not found: ${filepath}`,
      };
    }

    // Extract metadata
    const metadata = await extractExifMetadata(filepath);

    // Copy to profile media directory if requested
    let storedPath = filepath;
    if (options?.copyToProfile) {
      const mediaDir = path.join(profilePaths.root, 'media', 'photos');
      if (!fs.existsSync(mediaDir)) {
        fs.mkdirSync(mediaDir, { recursive: true });
      }

      const destFilename = `${Date.now()}-${metadata.filename}`;
      storedPath = path.join(mediaDir, destFilename);
      fs.copyFileSync(filepath, storedPath);
    }

    // Generate content and tags
    const content = generateContentFromMetadata(metadata, options);
    const tags = [
      ...generateTagsFromMetadata(metadata),
      ...(options?.additionalTags || []),
    ];

    // Create memory event
    const capture = captureEventWithDetails(content, {
      type: 'observation',
      tags,
      metadata: {
        photo: toToolParameters({
          filepath: storedPath,
          exif: metadata,
        }),
        consent: true, // User initiated ingestion
        provenance: 'local-file',
        source: options?.source || 'photo-ingestor',
      },
    });
    const eventId = capture.eventId;

    // Audit the ingestion
    audit({
      category: 'data_change',
      level: 'info',
      event: 'photo_ingested',
      actor: 'photo-ingestor',
      details: {
        filepath,
        storedPath,
        username,
        eventId,
        hasGps: !!metadata.gps,
        dateTaken: metadata.dateTaken,
      },
    });

    return {
      success: true,
      filepath,
      memoryId: eventId,
      metadata,
    };
  } catch (error) {
    audit({
      category: 'system',
      level: 'error',
      event: 'photo_ingestion_failed',
      actor: 'photo-ingestor',
      details: {
        filepath,
        error: (error as Error).message,
      },
    });

    return {
      success: false,
      filepath,
      error: (error as Error).message,
    };
  }
}

/**
 * Ingest multiple photos from a directory.
 */
export async function ingestPhotosFromDirectory(
  directory: string,
  username: string,
  options?: PhotoIngestionOptions & { recursive?: boolean }
): Promise<{
  total: number;
  successful: number;
  failed: number;
  results: PhotoIngestionResult[];
}> {
  const results: PhotoIngestionResult[] = [];
  const photoExtensions = ['.jpg', '.jpeg', '.png', '.heic', '.heif', '.tiff', '.tif'];

  function scanDirectory(dir: string): string[] {
    const files: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory() && options?.recursive) {
        files.push(...scanDirectory(fullPath));
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (photoExtensions.includes(ext)) {
          files.push(fullPath);
        }
      }
    }

    return files;
  }

  const photoFiles = scanDirectory(directory);

  for (const filepath of photoFiles) {
    const result = await ingestPhoto(filepath, username, options);
    results.push(result);
  }

  return {
    total: results.length,
    successful: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).length,
    results,
  };
}

// ============================================================================
// Export
// ============================================================================

export const photoIngestor = {
  extractExifMetadata,
  ingestPhoto,
  ingestPhotosFromDirectory,
  generateTagsFromMetadata,
};
