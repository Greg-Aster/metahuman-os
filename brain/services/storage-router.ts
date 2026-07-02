/**
 * Compatibility adapter for the core storage router.
 *
 * Storage routing is owned by packages/core. Brain services may import this
 * legacy path during migration, but the implementation must stay in core.
 */

import {
  storageClient,
  type FileCategory,
  type ReadRequest,
  type ReadResult,
  type StorageRequest,
  type StorageResponse,
  type WriteRequest,
  type WriteResult,
} from '@metahuman/core/storage-client'

export type {
  FileCategory,
  ReadRequest,
  ReadResult,
  StorageRequest,
  StorageResponse,
  WriteRequest,
  WriteResult,
}

export const storage = storageClient

export const resolvePath = storageClient.resolvePath
export const resolveProfileRoot = storageClient.resolveProfileRoot
export const writeFile = storageClient.write
export const readFile = storageClient.read
export const deleteFile = storageClient.delete
export const exists = storageClient.exists
export const listFiles = storageClient.list
export const getStorageStatus = storageClient.status

export default storage
