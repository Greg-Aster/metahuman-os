import fs from 'node:fs'
import path from 'node:path'
import { audit } from './audit.js'
import { storageClient, type StorageRequest } from './storage-client.js'

export const PROFILE_SYNC_BUNDLE_VERSION = '1.0.0'
export const MAX_PROFILE_SYNC_FILES = 256
export const MAX_PROFILE_SYNC_FILE_BYTES = 2 * 1024 * 1024
export const MAX_PROFILE_SYNC_BUNDLE_BYTES = 20 * 1024 * 1024

const SYNC_CONFIG_FILE = 'sync-server.json'
const TEXT_EXTENSIONS = new Set(['.json', '.md', '.txt', '.yaml', '.yml', '.toml', '.csv'])
const PERSONA_BINARY_EXTENSIONS = new Set(['.gif', '.jpeg', '.jpg', '.png', '.webp'])
const EXCLUDED_CONFIG_FILES = new Set([
  'etc/llm-backend.json',
  'etc/llm-credentials.json',
  'etc/operator.json',
  'etc/remote-server.json',
  'etc/runpod.json',
  `etc/${SYNC_CONFIG_FILE}`,
])

export interface ProfileSyncConfig {
  serverUrl: string
  username: string
  password: string
  lastSyncAt?: string
  lastMemorySyncAt?: string
}

export interface ProfileSyncConfigSummary {
  configured: boolean
  serverUrl?: string
  username?: string
  lastSyncAt?: string
  lastMemorySyncAt?: string
}

export interface ProfileSyncFile {
  path: string
  content: string
  isBase64?: boolean
}

export interface ProfileSyncBundle {
  version: string
  exportedAt: string
  username: string
  files: ProfileSyncFile[]
  stats?: {
    totalFiles: number
    totalSize: number
    excludedFiles: number
  }
}

export interface ProfileImportOutcome {
  path: string
  status: 'imported' | 'skipped' | 'failed'
  bytes: number
  error?: string
}

export interface ProfileImportResult {
  success: boolean
  imported: number
  skipped: number
  failed: number
  outcomes: ProfileImportOutcome[]
  errors: string[]
}

export interface ProfileImportOptions {
  skipConfig?: boolean
  skipPersona?: boolean
  expectedSourceUsername?: string
}

export interface SyncableCredentials {
  runpod?: {
    apiKey: string | null
    endpointId: string | null
    templateId: string | null
    gpuType: string | null
  }
  bigBrother?: {
    enabled: boolean
    provider: string
    delegateAll: boolean
    escalateOnStuck: boolean
    escalateOnRepeatedFailures: boolean
    maxRetries: number
    includeFullScratchpad: boolean
    autoApplySuggestions: boolean
  }
  remote?: {
    provider: string
    serverUrl: string
    model: string
  }
}

export interface CredentialsApplyResult {
  success: boolean
  saved: string[]
  errors: string[]
}

export interface ProfileSyncDependencies {
  write: typeof storageClient.write
  read: typeof storageClient.read
  remove: typeof storageClient.delete
  resolveProfileRoot: typeof storageClient.resolveProfileRoot
}

const DEFAULT_DEPENDENCIES: ProfileSyncDependencies = {
  write: storageClient.write,
  read: storageClient.read,
  remove: storageClient.delete,
  resolveProfileRoot: storageClient.resolveProfileRoot,
}

function configRequest(username: string, relativePath: string): StorageRequest {
  return { username, category: 'config', subcategory: 'etc', relativePath }
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !Number.isNaN(Date.parse(value))
}

function normalizeServerUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Sync server URL is required')
  let parsed: URL
  try {
    parsed = new URL(value.trim())
  } catch {
    throw new Error('Sync server URL must be a valid URL')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Sync server URL must use http or https')
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, '')
  parsed.search = ''
  parsed.hash = ''
  return parsed.toString().replace(/\/$/, '')
}

export function validateProfileSyncConfig(value: unknown): ProfileSyncConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Sync server configuration must be an object')
  }
  const input = value as Record<string, unknown>
  if (typeof input.username !== 'string' || !input.username.trim()) {
    throw new Error('Sync server username is required')
  }
  if (typeof input.password !== 'string' || !input.password) {
    throw new Error('Sync server password is required')
  }
  if (input.lastSyncAt !== undefined && !isIsoTimestamp(input.lastSyncAt)) {
    throw new Error('Sync server lastSyncAt must be an ISO timestamp')
  }
  if (input.lastMemorySyncAt !== undefined && !isIsoTimestamp(input.lastMemorySyncAt)) {
    throw new Error('Sync server lastMemorySyncAt must be an ISO timestamp')
  }
  return {
    serverUrl: normalizeServerUrl(input.serverUrl),
    username: input.username.trim(),
    password: input.password,
    lastSyncAt: input.lastSyncAt as string | undefined,
    lastMemorySyncAt: input.lastMemorySyncAt as string | undefined,
  }
}

export async function loadProfileSyncConfig(
  username: string,
  dependencies: ProfileSyncDependencies = DEFAULT_DEPENDENCIES,
): Promise<ProfileSyncConfig | null> {
  const response = await dependencies.read({ ...configRequest(username, SYNC_CONFIG_FILE), encoding: 'utf8' })
  if (!response.success) {
    if (response.error?.startsWith('File not found:')) return null
    throw new Error(response.error || 'Cannot read sync server configuration')
  }
  try {
    return validateProfileSyncConfig(JSON.parse(String(response.data)))
  } catch (error) {
    throw new Error(`Invalid sync server configuration: ${(error as Error).message}`)
  }
}

export async function saveProfileSyncConfig(
  username: string,
  input: unknown,
  dependencies: ProfileSyncDependencies = DEFAULT_DEPENDENCIES,
): Promise<ProfileSyncConfigSummary> {
  const config = validateProfileSyncConfig(input)
  const result = await dependencies.write({
    ...configRequest(username, SYNC_CONFIG_FILE),
    data: JSON.stringify(config, null, 2),
    encoding: 'utf8',
  })
  if (!result.success) throw new Error(result.error || 'Cannot save sync server configuration')
  audit({
    level: 'info',
    category: 'data_change',
    event: 'profile_sync_config_saved',
    actor: username,
    details: { username, serverUrl: config.serverUrl },
  })
  return profileSyncConfigSummary(config)
}

export async function clearProfileSyncConfig(
  username: string,
  dependencies: ProfileSyncDependencies = DEFAULT_DEPENDENCIES,
): Promise<void> {
  const result = await dependencies.remove(configRequest(username, SYNC_CONFIG_FILE))
  if (!result.success) throw new Error(result.error || 'Cannot clear sync server configuration')
  audit({
    level: 'info',
    category: 'data_change',
    event: 'profile_sync_config_cleared',
    actor: username,
    details: { username },
  })
}

export function profileSyncConfigSummary(config: ProfileSyncConfig | null): ProfileSyncConfigSummary {
  if (!config) return { configured: false }
  return {
    configured: true,
    serverUrl: config.serverUrl,
    username: config.username,
    lastSyncAt: config.lastSyncAt,
    lastMemorySyncAt: config.lastMemorySyncAt,
  }
}

export async function updateProfileSyncCheckpoint(
  username: string,
  completedAt: string,
  memoryCompletedAt: string | undefined,
  dependencies: ProfileSyncDependencies = DEFAULT_DEPENDENCIES,
): Promise<void> {
  if (!isIsoTimestamp(completedAt)) throw new Error('Sync completion timestamp must be valid')
  if (memoryCompletedAt !== undefined && !isIsoTimestamp(memoryCompletedAt)) {
    throw new Error('Memory sync completion timestamp must be valid')
  }
  const current = await loadProfileSyncConfig(username, dependencies)
  if (!current) throw new Error('Cannot update a missing sync server configuration')
  await saveProfileSyncConfig(username, {
    ...current,
    lastSyncAt: completedAt,
    lastMemorySyncAt: memoryCompletedAt ?? current.lastMemorySyncAt,
  }, dependencies)
}

function normalizedBundlePath(value: unknown): string {
  if (typeof value !== 'string' || !value || value.includes('\0') || value.includes('\\')) {
    throw new Error('Profile bundle paths must be non-empty POSIX paths')
  }
  if (path.posix.isAbsolute(value)) throw new Error(`Profile bundle path must be relative: ${value}`)
  const normalized = path.posix.normalize(value)
  if (normalized !== value || normalized === '.' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw new Error(`Profile bundle path escapes the profile root: ${value}`)
  }
  if (normalized.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error(`Invalid profile bundle path: ${value}`)
  }
  return normalized
}

function isAllowedProfilePath(relativePath: string): boolean {
  if (relativePath.includes('/.backups/') || relativePath.startsWith('.backups/')) return false
  if (EXCLUDED_CONFIG_FILES.has(relativePath)) return false
  const extension = path.posix.extname(relativePath).toLowerCase()
  if (relativePath.startsWith('persona/')) {
    return TEXT_EXTENSIONS.has(extension) || PERSONA_BINARY_EXTENSIONS.has(extension)
  }
  if (relativePath.startsWith('etc/')) return TEXT_EXTENSIONS.has(extension)
  return /^state\/conversation-buffer(?:\.[a-z0-9-]+)?\.json$/i.test(relativePath)
}

function decodeBundleFile(file: ProfileSyncFile): Buffer {
  let content: Buffer
  if (file.isBase64) {
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(file.content) || file.content.length % 4 !== 0) {
      throw new Error(`Invalid base64 content for ${file.path}`)
    }
    content = Buffer.from(file.content, 'base64')
    if (content.toString('base64') !== file.content) throw new Error(`Invalid base64 content for ${file.path}`)
  } else {
    content = Buffer.from(file.content, 'utf8')
    const extension = path.posix.extname(file.path).toLowerCase()
    if (!TEXT_EXTENSIONS.has(extension)) throw new Error(`Binary profile file must use base64: ${file.path}`)
    if (content.includes(0)) throw new Error(`Profile text file contains binary data: ${file.path}`)
    if (extension === '.json') {
      try {
        JSON.parse(file.content)
      } catch {
        throw new Error(`Profile JSON file is malformed: ${file.path}`)
      }
    }
  }
  if (content.byteLength > MAX_PROFILE_SYNC_FILE_BYTES) {
    throw new Error(`Profile file exceeds ${MAX_PROFILE_SYNC_FILE_BYTES} bytes: ${file.path}`)
  }
  return content
}

export function validateProfileSyncBundle(
  value: unknown,
  options: { expectedSourceUsername?: string } = {},
): ProfileSyncBundle {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Profile bundle must be an object')
  }
  const input = value as Record<string, unknown>
  if (input.version !== PROFILE_SYNC_BUNDLE_VERSION) {
    throw new Error(`Unsupported profile bundle version: ${String(input.version)}`)
  }
  if (!isIsoTimestamp(input.exportedAt)) throw new Error('Profile bundle exportedAt must be an ISO timestamp')
  if (typeof input.username !== 'string' || !input.username.trim()) throw new Error('Profile bundle username is required')
  if (options.expectedSourceUsername && input.username !== options.expectedSourceUsername) {
    throw new Error(`Profile bundle belongs to ${input.username}, not ${options.expectedSourceUsername}`)
  }
  if (!Array.isArray(input.files) || input.files.length > MAX_PROFILE_SYNC_FILES) {
    throw new Error(`Profile bundle must contain at most ${MAX_PROFILE_SYNC_FILES} files`)
  }

  const seen = new Set<string>()
  let totalBytes = 0
  const files = input.files.map((raw, index): ProfileSyncFile => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(`Profile bundle file ${index} must be an object`)
    }
    const record = raw as Record<string, unknown>
    const relativePath = normalizedBundlePath(record.path)
    if (!isAllowedProfilePath(relativePath)) throw new Error(`Unsupported profile bundle path: ${relativePath}`)
    if (seen.has(relativePath)) throw new Error(`Duplicate profile bundle path: ${relativePath}`)
    seen.add(relativePath)
    if (typeof record.content !== 'string') throw new Error(`Profile bundle content must be a string: ${relativePath}`)
    if (record.isBase64 !== undefined && typeof record.isBase64 !== 'boolean') {
      throw new Error(`Profile bundle isBase64 must be boolean: ${relativePath}`)
    }
    const file = { path: relativePath, content: record.content, isBase64: record.isBase64 as boolean | undefined }
    totalBytes += decodeBundleFile(file).byteLength
    if (totalBytes > MAX_PROFILE_SYNC_BUNDLE_BYTES) {
      throw new Error(`Profile bundle exceeds ${MAX_PROFILE_SYNC_BUNDLE_BYTES} bytes`)
    }
    return file
  })
  return {
    version: PROFILE_SYNC_BUNDLE_VERSION,
    exportedAt: input.exportedAt,
    username: input.username.trim(),
    files,
    stats: input.stats as ProfileSyncBundle['stats'],
  }
}

function storageRequestForProfileFile(username: string, relativePath: string): StorageRequest {
  if (relativePath.startsWith('persona/')) {
    return { username, category: 'config', subcategory: 'persona', relativePath: relativePath.slice('persona/'.length) }
  }
  if (relativePath.startsWith('etc/')) {
    return { username, category: 'config', subcategory: 'etc', relativePath: relativePath.slice('etc/'.length) }
  }
  return { username, category: 'state', relativePath: relativePath.slice('state/'.length) }
}

export async function importProfileSyncBundle(
  username: string,
  value: unknown,
  options: ProfileImportOptions = {},
  dependencies: ProfileSyncDependencies = DEFAULT_DEPENDENCIES,
): Promise<ProfileImportResult> {
  const bundle = validateProfileSyncBundle(value, { expectedSourceUsername: options.expectedSourceUsername })
  const outcomes: ProfileImportOutcome[] = []
  const errors: string[] = []

  for (const file of bundle.files) {
    const content = decodeBundleFile(file)
    if ((options.skipConfig && file.path.startsWith('etc/'))
      || (options.skipPersona && file.path.startsWith('persona/'))) {
      outcomes.push({ path: file.path, status: 'skipped', bytes: content.byteLength })
      continue
    }
    const write = await dependencies.write({
      ...storageRequestForProfileFile(username, file.path),
      data: content,
    })
    if (!write.success) {
      const error = `${file.path}: ${write.error || 'profile write failed'}`
      errors.push(error)
      outcomes.push({ path: file.path, status: 'failed', bytes: content.byteLength, error })
    } else {
      outcomes.push({ path: file.path, status: 'imported', bytes: content.byteLength })
    }
  }

  const imported = outcomes.filter(outcome => outcome.status === 'imported').length
  const skipped = outcomes.filter(outcome => outcome.status === 'skipped').length
  const failed = outcomes.filter(outcome => outcome.status === 'failed').length
  return { success: failed === 0, imported, skipped, failed, outcomes, errors }
}

function parseOptionalJson(value: string | Buffer | undefined, label: string): Record<string, unknown> | null {
  if (value === undefined) return null
  try {
    const parsed = JSON.parse(String(value))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('must be an object')
    return parsed as Record<string, unknown>
  } catch (error) {
    throw new Error(`Invalid ${label}: ${(error as Error).message}`)
  }
}

async function readOptionalConfig(
  username: string,
  fileName: string,
  dependencies: ProfileSyncDependencies,
): Promise<Record<string, unknown> | null> {
  const result = await dependencies.read({ ...configRequest(username, fileName), encoding: 'utf8' })
  if (!result.success) {
    if (result.error?.startsWith('File not found:')) return null
    throw new Error(result.error || `Cannot read ${fileName}`)
  }
  return parseOptionalJson(result.data, fileName)
}

async function writeConfig(
  username: string,
  fileName: string,
  value: unknown,
  dependencies: ProfileSyncDependencies,
): Promise<void> {
  const result = await dependencies.write({
    ...configRequest(username, fileName),
    data: JSON.stringify(value, null, 2),
    encoding: 'utf8',
  })
  if (!result.success) throw new Error(result.error || `Cannot write ${fileName}`)
}

export async function getSyncableCredentials(
  username: string,
  dependencies: ProfileSyncDependencies = DEFAULT_DEPENDENCIES,
): Promise<SyncableCredentials> {
  const credentials: SyncableCredentials = {}
  const runpod = await readOptionalConfig(username, 'runpod.json', dependencies)
  if (runpod?.apiKey) {
    credentials.runpod = {
      apiKey: typeof runpod.apiKey === 'string' ? runpod.apiKey : null,
      endpointId: typeof runpod.endpointId === 'string' ? runpod.endpointId : null,
      templateId: typeof runpod.templateId === 'string' ? runpod.templateId : null,
      gpuType: typeof runpod.gpuType === 'string' ? runpod.gpuType : null,
    }
  }
  const operator = await readOptionalConfig(username, 'operator.json', dependencies)
  const bigBrother = operator?.bigBrotherMode
  if (bigBrother && typeof bigBrother === 'object' && !Array.isArray(bigBrother)) {
    const value = bigBrother as Record<string, unknown>
    credentials.bigBrother = {
      enabled: value.enabled === true,
      provider: typeof value.provider === 'string' ? value.provider : 'claude-code',
      delegateAll: value.delegateAll === true,
      escalateOnStuck: value.escalateOnStuck !== false,
      escalateOnRepeatedFailures: value.escalateOnRepeatedFailures !== false,
      maxRetries: Number.isInteger(value.maxRetries) ? Number(value.maxRetries) : 1,
      includeFullScratchpad: value.includeFullScratchpad !== false,
      autoApplySuggestions: value.autoApplySuggestions === true,
    }
  }
  const backend = await readOptionalConfig(username, 'llm-backend.json', dependencies)
  const remote = backend?.remote
  if (remote && typeof remote === 'object' && !Array.isArray(remote)) {
    const value = remote as Record<string, unknown>
    credentials.remote = {
      provider: typeof value.provider === 'string' ? value.provider : 'runpod',
      serverUrl: typeof value.serverUrl === 'string' ? value.serverUrl : '',
      model: typeof value.model === 'string' ? value.model : '',
    }
  }
  return credentials
}

export async function applySyncableCredentials(
  username: string,
  credentials: SyncableCredentials,
  dependencies: ProfileSyncDependencies = DEFAULT_DEPENDENCIES,
): Promise<CredentialsApplyResult> {
  if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials)) {
    throw new Error('Synced credentials must be an object')
  }
  const saved: string[] = []
  const errors: string[] = []
  const attempt = async (name: string, operation: () => Promise<void>) => {
    try {
      await operation()
      saved.push(name)
    } catch (error) {
      errors.push(`${name}: ${(error as Error).message}`)
    }
  }
  if (credentials.runpod) {
    await attempt('runpod', () => writeConfig(username, 'runpod.json', credentials.runpod, dependencies))
  }
  if (credentials.remote) {
    await attempt('remote', async () => {
      const current = await readOptionalConfig(username, 'llm-backend.json', dependencies) ?? {}
      await writeConfig(username, 'llm-backend.json', { ...current, remote: credentials.remote }, dependencies)
    })
  }
  if (credentials.bigBrother) {
    await attempt('bigBrother', async () => {
      const current = await readOptionalConfig(username, 'operator.json', dependencies) ?? {}
      await writeConfig(username, 'operator.json', { ...current, bigBrotherMode: credentials.bigBrother }, dependencies)
    })
  }
  return { success: errors.length === 0, saved, errors }
}

interface CollectedProfileFile {
  logicalPath: string
  storageRequest: StorageRequest
}

function collectProfileFiles(root: string, username: string): { files: CollectedProfileFile[]; excluded: number } {
  const files: CollectedProfileFile[] = []
  const seen = new Set<string>()
  let excluded = 0
  const roots = [
    { directory: path.join(root, 'persona'), prefix: 'persona' },
    { directory: path.join(root, 'etc'), prefix: 'etc' },
    { directory: path.join(root, 'state'), prefix: 'state' },
  ]
  const walk = (directory: string, prefix: string): void => {
    if (!fs.existsSync(directory)) return
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === '.backups' || entry.name.startsWith('.')) {
        excluded++
        continue
      }
      const fullPath = path.join(directory, entry.name)
      if (entry.isSymbolicLink()) {
        excluded++
        continue
      }
      if (entry.isDirectory()) {
        walk(fullPath, `${prefix}/${entry.name}`)
        continue
      }
      if (!entry.isFile()) continue
      const rawPath = `${prefix}/${entry.name}`
      const logicalPath = rawPath.endsWith('.enc') ? rawPath.slice(0, -'.enc'.length) : rawPath
      if (!isAllowedProfilePath(logicalPath) || seen.has(logicalPath)) {
        excluded++
        continue
      }
      seen.add(logicalPath)
      files.push({ logicalPath, storageRequest: storageRequestForProfileFile(username, logicalPath) })
    }
  }
  for (const item of roots) walk(item.directory, item.prefix)
  files.sort((left, right) => left.logicalPath.localeCompare(right.logicalPath))
  return { files, excluded }
}

export async function exportProfileSyncBundle(
  username: string,
  dependencies: ProfileSyncDependencies = DEFAULT_DEPENDENCIES,
): Promise<ProfileSyncBundle> {
  const root = dependencies.resolveProfileRoot(username)
  if (!root.success || !root.path) throw new Error(root.error || 'Cannot resolve profile root')
  const collected = collectProfileFiles(root.path, username)
  if (collected.files.length > MAX_PROFILE_SYNC_FILES) {
    throw new Error(`Profile contains more than ${MAX_PROFILE_SYNC_FILES} supported sync files`)
  }
  const files: ProfileSyncFile[] = []
  let totalSize = 0
  let excluded = collected.excluded
  for (const item of collected.files) {
    const read = await dependencies.read(item.storageRequest)
    if (!read.success || read.data === undefined) throw new Error(read.error || `Cannot read ${item.logicalPath}`)
    const content = Buffer.isBuffer(read.data) ? read.data : Buffer.from(read.data)
    if (content.byteLength > MAX_PROFILE_SYNC_FILE_BYTES) {
      excluded++
      continue
    }
    totalSize += content.byteLength
    if (totalSize > MAX_PROFILE_SYNC_BUNDLE_BYTES) {
      throw new Error(`Profile bundle exceeds ${MAX_PROFILE_SYNC_BUNDLE_BYTES} bytes`)
    }
    const extension = path.posix.extname(item.logicalPath).toLowerCase()
    const isBase64 = !TEXT_EXTENSIONS.has(extension)
    files.push({
      path: item.logicalPath,
      content: isBase64 ? content.toString('base64') : content.toString('utf8'),
      isBase64: isBase64 || undefined,
    })
  }
  return {
    version: PROFILE_SYNC_BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    username,
    files,
    stats: { totalFiles: files.length, totalSize, excludedFiles: excluded },
  }
}
