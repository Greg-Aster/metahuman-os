import fs from 'node:fs'
import path from 'node:path'

import { systemPaths } from './path-builder.js'

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/
const CHECKSUM_PATTERN = /^[a-f0-9]{64}$/i
const RELEASE_FIELDS = new Set([
  'version',
  'versionCode',
  'releaseDate',
  'releaseNotes',
  'minAndroidVersion',
  'fileSize',
  'checksum',
])

export interface MobileReleaseMetadata {
  version: string
  versionCode: number
  releaseDate: string
  releaseNotes: string
  minAndroidVersion: number
  fileSize: number
  checksum?: string
}

export interface MobileRelease extends MobileReleaseMetadata {
  apkPath: string
}

export class MobileReleaseError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 500) {
    super(message)
    this.name = 'MobileReleaseError'
  }
}

function requireObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new MobileReleaseError('Mobile release metadata must be a JSON object', 500)
  }
  return value as Record<string, unknown>
}

function requireString(record: Record<string, unknown>, field: string): string {
  const value = record[field]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new MobileReleaseError(`Mobile release ${field} must be a non-empty string`, 500)
  }
  return value.trim()
}

function requirePositiveInteger(record: Record<string, unknown>, field: string): number {
  const value = record[field]
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new MobileReleaseError(`Mobile release ${field} must be a positive integer`, 500)
  }
  return value as number
}

function parseMetadata(value: unknown): Omit<MobileReleaseMetadata, 'fileSize'> & { fileSize?: number } {
  const record = requireObject(value)
  const unknownFields = Object.keys(record).filter(field => !RELEASE_FIELDS.has(field))
  if (unknownFields.length > 0) {
    throw new MobileReleaseError(`Mobile release metadata contains unsupported fields: ${unknownFields.join(', ')}`, 500)
  }

  const version = requireString(record, 'version')
  if (!VERSION_PATTERN.test(version)) {
    throw new MobileReleaseError('Mobile release version must use semantic version syntax', 500)
  }

  const releaseDate = requireString(record, 'releaseDate')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(releaseDate) || Number.isNaN(Date.parse(`${releaseDate}T00:00:00Z`))) {
    throw new MobileReleaseError('Mobile release releaseDate must use YYYY-MM-DD syntax', 500)
  }

  const checksum = record.checksum
  if (checksum !== undefined && (typeof checksum !== 'string' || !CHECKSUM_PATTERN.test(checksum))) {
    throw new MobileReleaseError('Mobile release checksum must be a SHA-256 hex digest', 500)
  }

  const declaredSize = record.fileSize
  if (declaredSize !== undefined && (!Number.isInteger(declaredSize) || (declaredSize as number) <= 0)) {
    throw new MobileReleaseError('Mobile release fileSize must be a positive integer', 500)
  }

  return {
    version,
    versionCode: requirePositiveInteger(record, 'versionCode'),
    releaseDate,
    releaseNotes: requireString(record, 'releaseNotes'),
    minAndroidVersion: requirePositiveInteger(record, 'minAndroidVersion'),
    fileSize: declaredSize as number | undefined,
    checksum: checksum as string | undefined,
  }
}

export function loadLatestMobileRelease(): MobileRelease {
  const versionPath = path.join(systemPaths.mobileReleases, 'version.json')
  if (!fs.existsSync(versionPath)) {
    throw new MobileReleaseError('No mobile release has been published', 404)
  }

  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(versionPath, 'utf8'))
  } catch (error) {
    throw new MobileReleaseError(
      `Mobile release metadata is unreadable: ${error instanceof Error ? error.message : String(error)}`,
      500,
    )
  }

  const metadata = parseMetadata(raw)
  const apkPath = path.join(systemPaths.mobileReleases, `metahuman-${metadata.version}.apk`)
  if (!fs.existsSync(apkPath)) {
    throw new MobileReleaseError(`Mobile release ${metadata.version} APK is missing`, 404)
  }

  const fileSize = fs.statSync(apkPath).size
  if (metadata.fileSize !== undefined && metadata.fileSize !== fileSize) {
    throw new MobileReleaseError(
      `Mobile release ${metadata.version} size does not match version metadata`,
      500,
    )
  }

  return {
    ...metadata,
    fileSize,
    apkPath,
  }
}

export function readMobileReleaseApk(requestedVersion?: string): { release: MobileRelease; binary: Buffer } {
  if (requestedVersion !== undefined && !VERSION_PATTERN.test(requestedVersion)) {
    throw new MobileReleaseError('Requested mobile version must use semantic version syntax', 400)
  }

  const release = loadLatestMobileRelease()
  if (requestedVersion !== undefined && requestedVersion !== release.version) {
    throw new MobileReleaseError(`Mobile release ${requestedVersion} is not available`, 404)
  }

  return {
    release,
    binary: fs.readFileSync(release.apkPath),
  }
}
