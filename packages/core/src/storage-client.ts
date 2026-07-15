/**
 * Storage Router Client
 *
 * Centralized storage API for profile file I/O. Routes reads/writes to the
 * correct profile location based on user context, storage configuration, and
 * file category.
 */

import fs from 'node:fs'
import path from 'node:path'
import { audit } from './audit.js'
import { getUserContext } from './context.js'
import {
  decrypt,
  encrypt,
  ENCRYPTED_EXTENSION,
  getCachedKey,
  isProfileUnlocked,
} from './encryption.js'
import {
  getDefaultProfilePath,
  resolveProfileRoot as pathBuilderResolveProfileRoot,
  systemPaths,
} from './path-builder.js'
import { getProfileStorageConfig, type ProfileStorageConfig } from './users.js'

/**
 * File categories supported by the storage router
 */
export type FileCategory =
  | 'memory'
  | 'voice'
  | 'config'
  | 'output'
  | 'training'
  | 'cache'
  | 'state'

export type MemorySubcategory = 'episodic' | 'semantic' | 'procedural' | 'tasks' | 'inbox' | 'agency'
export type ConfigSubcategory = 'persona' | 'etc' | 'sessions' | 'desires'
export type VoiceSubcategory = 'inbox' | 'transcripts' | 'archive' | 'training-data' | 'models' | 'cache'
export type TrainingSubcategory = 'datasets' | 'adapters' | 'runs' | 'models'
export type OutputSubcategory = 'fine-tuned-models' | 'drafts' | 'artifacts' | 'cache'
export type StateSubcategory = 'agency' | 'curiosity' | 'sessions' | 'operator-policy'

/**
 * Storage request for routing
 */
export interface StorageRequest {
  username?: string
  category: FileCategory
  subcategory?: string
  relativePath?: string
}

/**
 * Storage response with resolved path
 */
export interface StorageResponse {
  success: boolean
  path?: string
  profileRoot?: string
  storageType?: ProfileStorageConfig['type']
  error?: string
}

/**
 * Write request
 */
export interface WriteRequest extends StorageRequest {
  data: Buffer | string
  encoding?: BufferEncoding
}

/**
 * Read request
 */
export interface ReadRequest extends StorageRequest {
  encoding?: BufferEncoding
}

/**
 * Write result
 */
export interface WriteResult {
  success: boolean
  path?: string
  bytesWritten?: number
  error?: string
}

/**
 * Read result
 */
export interface ReadResult {
  success: boolean
  data?: Buffer | string
  path?: string
  error?: string
}

function resolveUsername(username?: string): string | null {
  if (username) {
    return username
  }

  const context = getUserContext()
  if (context?.username && context.username !== 'anonymous') {
    return context.username
  }

  return null
}

function isAesEncryptionEnabled(username: string): boolean {
  const storageConfig = getProfileStorageConfig(username)
  return storageConfig?.encryption?.type === 'aes256'
}

function isProfileReady(username: string): { ready: boolean; error?: string } {
  const storageConfig = getProfileStorageConfig(username)
  const encType = storageConfig?.encryption?.type

  if (!encType || encType === 'none' || encType === 'luks' || encType === 'veracrypt') {
    return { ready: true }
  }

  if (encType === 'aes256') {
    if (isProfileUnlocked(username)) {
      return { ready: true }
    }
    return { ready: false, error: 'Profile is locked. Please unlock with your encryption password.' }
  }

  return { ready: true }
}

/**
 * Resolve the profile root for a user based on their storage configuration.
 */
export function resolveProfileRoot(username?: string): StorageResponse {
  const resolvedUsername = resolveUsername(username)

  if (!resolvedUsername) {
    return {
      success: false,
      error: 'No username provided and no user context available',
    }
  }

  try {
    const resolution = pathBuilderResolveProfileRoot(resolvedUsername)
    const storageType = resolution.storageType === 'unknown' ? 'internal' : resolution.storageType

    return {
      success: true,
      path: resolution.root,
      profileRoot: resolution.root,
      storageType,
      error: resolution.usingFallback ? resolution.fallbackReason : undefined,
    }
  } catch (error) {
    return {
      success: false,
      error: `Failed to resolve profile root: ${(error as Error).message}`,
    }
  }
}

/**
 * Build the full path for a storage request.
 */
export function resolvePath(request: StorageRequest): StorageResponse {
  const { username, category, subcategory, relativePath } = request
  const profileResponse = resolveProfileRoot(username)

  if (!profileResponse.success) {
    return profileResponse
  }

  const profileRoot = profileResponse.profileRoot!
  let categoryPath: string

  switch (category) {
    case 'memory':
      categoryPath = subcategory === 'agency'
        ? path.join(profileRoot, 'persona', 'desires')
        : path.join(profileRoot, 'memory', subcategory || 'episodic')
      break
    case 'voice':
      categoryPath = subcategory === 'inbox' || subcategory === 'transcripts' || subcategory === 'archive'
        ? path.join(profileRoot, 'memory', 'audio', subcategory)
        : path.join(profileRoot, subcategory || 'training-data')
      break
    case 'config':
      if (subcategory === 'persona') {
        categoryPath = path.join(profileRoot, 'persona')
      } else if (subcategory === 'desires') {
        categoryPath = path.join(profileRoot, 'persona', 'desires')
      } else if (subcategory === 'etc') {
        categoryPath = path.join(profileRoot, 'etc')
      } else if (subcategory === 'sessions') {
        categoryPath = path.join(profileRoot, 'sessions')
      } else {
        categoryPath = path.join(profileRoot, 'etc')
      }
      break
    case 'output':
      categoryPath = path.join(profileRoot, 'out', subcategory || '')
      break
    case 'training':
      categoryPath = path.join(profileRoot, 'training-data', subcategory || '')
      break
    case 'cache':
      categoryPath = path.join(profileRoot, 'out', 'cache', subcategory || '')
      break
    case 'state':
      categoryPath = path.join(profileRoot, 'state', subcategory || '')
      break
    default:
      return {
        success: false,
        error: `Unknown file category: ${category}`,
      }
  }

  return {
    success: true,
    path: relativePath ? path.join(categoryPath, relativePath) : categoryPath,
    profileRoot,
    storageType: profileResponse.storageType,
  }
}

/**
 * Write data to storage.
 */
export async function writeFile(request: WriteRequest): Promise<WriteResult> {
  const { username, data, encoding = 'utf8' } = request
  const resolvedUsername = resolveUsername(username)
  const pathResponse = resolvePath(request)

  if (!pathResponse.success) {
    return {
      success: false,
      error: pathResponse.error,
    }
  }

  if (resolvedUsername) {
    const readyStatus = isProfileReady(resolvedUsername)
    if (!readyStatus.ready) {
      return {
        success: false,
        error: readyStatus.error,
      }
    }
  }

  let filePath = pathResponse.path!
  const useAesEncryption = Boolean(resolvedUsername && isAesEncryptionEnabled(resolvedUsername))

  try {
    const dir = path.dirname(filePath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    let bytesWritten: number

    if (useAesEncryption) {
      const key = getCachedKey(resolvedUsername!)
      if (!key) {
        return {
          success: false,
          error: 'Profile is locked. Please unlock first.',
        }
      }

      const dataBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data, encoding)
      const encrypted = encrypt(dataBuffer, key)
      const encryptedPath = filePath + ENCRYPTED_EXTENSION
      fs.writeFileSync(encryptedPath, JSON.stringify(encrypted), 'utf8')
      filePath = encryptedPath
      bytesWritten = dataBuffer.length
    } else {
      if (Buffer.isBuffer(data)) {
        fs.writeFileSync(filePath, data)
      } else {
        fs.writeFileSync(filePath, data, encoding)
      }
      bytesWritten = Buffer.isBuffer(data) ? data.length : Buffer.byteLength(data, encoding)
    }

    audit({
      level: 'info',
      category: 'data',
      event: 'storage_write',
      details: {
        username: resolvedUsername,
        category: request.category,
        subcategory: request.subcategory,
        path: filePath,
        bytesWritten,
        storageType: pathResponse.storageType,
        encrypted: useAesEncryption,
      },
      actor: resolvedUsername || 'system',
    })

    return {
      success: true,
      path: filePath,
      bytesWritten,
    }
  } catch (error) {
    audit({
      level: 'error',
      category: 'data',
      event: 'storage_write_failed',
      details: {
        username: resolvedUsername,
        category: request.category,
        path: filePath,
        error: (error as Error).message,
      },
      actor: resolvedUsername || 'system',
    })

    return {
      success: false,
      error: `Failed to write file: ${(error as Error).message}`,
    }
  }
}

/**
 * Read data from storage.
 */
export async function readFile(request: ReadRequest): Promise<ReadResult> {
  const { username, encoding } = request
  const resolvedUsername = resolveUsername(username)
  const pathResponse = resolvePath(request)

  if (!pathResponse.success) {
    return {
      success: false,
      error: pathResponse.error,
    }
  }

  if (resolvedUsername) {
    const readyStatus = isProfileReady(resolvedUsername)
    if (!readyStatus.ready) {
      return {
        success: false,
        error: readyStatus.error,
      }
    }
  }

  const filePath = pathResponse.path!
  const useAesEncryption = Boolean(resolvedUsername && isAesEncryptionEnabled(resolvedUsername))

  try {
    if (useAesEncryption) {
      const encryptedPath = filePath + ENCRYPTED_EXTENSION

      if (fs.existsSync(encryptedPath)) {
        const key = getCachedKey(resolvedUsername!)
        if (!key) {
          return {
            success: false,
            error: 'Profile is locked. Please unlock first.',
          }
        }

        const encryptedContent = fs.readFileSync(encryptedPath, 'utf8')
        const encryptedData = JSON.parse(encryptedContent)
        const decrypted = decrypt(encryptedData, key)

        return {
          success: true,
          data: encoding ? decrypted.toString(encoding) : decrypted,
          path: encryptedPath,
        }
      }
    }

    if (!fs.existsSync(filePath)) {
      return {
        success: false,
        error: `File not found: ${filePath}`,
      }
    }

    return {
      success: true,
      data: encoding ? fs.readFileSync(filePath, encoding) : fs.readFileSync(filePath),
      path: filePath,
    }
  } catch (error) {
    return {
      success: false,
      error: `Failed to read file: ${(error as Error).message}`,
    }
  }
}

/**
 * Check if a path exists in storage.
 */
export function exists(request: StorageRequest): boolean {
  const pathResponse = resolvePath(request)
  if (!pathResponse.success || !pathResponse.path) {
    return false
  }
  return fs.existsSync(pathResponse.path)
}

/**
 * Delete a file from storage.
 */
export async function deleteFile(request: StorageRequest): Promise<WriteResult> {
  const { username } = request
  const pathResponse = resolvePath(request)

  if (!pathResponse.success) {
    return {
      success: false,
      error: pathResponse.error,
    }
  }

  const filePath = pathResponse.path!

  try {
    if (!fs.existsSync(filePath)) {
      return {
        success: true,
        path: filePath,
      }
    }

    fs.unlinkSync(filePath)

    audit({
      level: 'info',
      category: 'data',
      event: 'storage_delete',
      details: {
        username,
        category: request.category,
        path: filePath,
      },
      actor: username,
    })

    return {
      success: true,
      path: filePath,
    }
  } catch (error) {
    return {
      success: false,
      error: `Failed to delete file: ${(error as Error).message}`,
    }
  }
}

/**
 * List files in a storage directory.
 */
export async function listFiles(request: StorageRequest): Promise<{
  success: boolean
  files?: string[]
  error?: string
}> {
  const pathResponse = resolvePath(request)

  if (!pathResponse.success) {
    return {
      success: false,
      error: pathResponse.error,
    }
  }

  const dirPath = pathResponse.path!

  try {
    if (!fs.existsSync(dirPath)) {
      return {
        success: true,
        files: [],
      }
    }

    return {
      success: true,
      files: fs.readdirSync(dirPath, { withFileTypes: true }).map(entry => entry.name),
    }
  } catch (error) {
    return {
      success: false,
      error: `Failed to list files: ${(error as Error).message}`,
    }
  }
}

/**
 * Get storage status for a user.
 */
export function getStorageStatus(username?: string): {
  configured: boolean
  available: boolean
  path?: string
  type?: ProfileStorageConfig['type']
  error?: string
} {
  const resolvedUsername = resolveUsername(username)

  if (!resolvedUsername) {
    return {
      configured: false,
      available: true,
      path: systemPaths.root,
      type: 'internal',
    }
  }

  const storageConfig = getProfileStorageConfig(resolvedUsername)

  if (!storageConfig?.path) {
    return {
      configured: false,
      available: true,
      path: getDefaultProfilePath(resolvedUsername),
      type: 'internal',
    }
  }

  const available = fs.existsSync(storageConfig.path)

  return {
    configured: true,
    available,
    path: storageConfig.path,
    type: storageConfig.type,
    error: available ? undefined : 'Storage path not available (drive may be unmounted)',
  }
}

export const storage = {
  resolvePath,
  resolveProfileRoot,
  getProfileRoot: resolveProfileRoot,
  write: writeFile,
  read: readFile,
  delete: deleteFile,
  exists,
  list: listFiles,
  status: getStorageStatus,
  getStatus: getStorageStatus,
}

export const storageClient = storage

export default storageClient
