import { ollama } from './ollama.js'
import fs from 'node:fs'
import path from 'node:path'
import { paths } from './paths.js'

export type EmbeddingProvider = 'ollama' | 'mock'

export interface EmbeddingConfig {
  enabled: boolean
  model: string
  provider: EmbeddingProvider
  preloadAtStartup: boolean
  description?: string
}

const CONFIG_PATH = path.join(paths.root, 'etc', 'embeddings.json')

let configCache: EmbeddingConfig | null = null

/**
 * Load embedding configuration from etc/embeddings.json
 */
export function loadEmbeddingConfig(): EmbeddingConfig {
  if (configCache) return configCache

  if (!fs.existsSync(CONFIG_PATH)) {
    // Default config if file doesn't exist
    const defaultConfig: EmbeddingConfig = {
      enabled: true,
      model: 'nomic-embed-text',
      provider: 'ollama',
      preloadAtStartup: true,
    }
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaultConfig, null, 2))
    configCache = defaultConfig
    return defaultConfig
  }

  const raw = fs.readFileSync(CONFIG_PATH, 'utf-8')
  configCache = JSON.parse(raw) as EmbeddingConfig
  return configCache
}

/**
 * Save embedding configuration
 */
export function saveEmbeddingConfig(config: EmbeddingConfig): void {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
  configCache = config
}

/**
 * Preload the embedding model to keep it in memory
 */
export async function preloadEmbeddingModel(): Promise<void> {
  const config = loadEmbeddingConfig()

  if (!config.enabled || !config.preloadAtStartup) {
    console.log('[embeddings] Preload disabled in config')
    return
  }

  if (config.provider !== 'ollama') {
    console.log('[embeddings] Preload only supported for Ollama provider')
    return
  }

  try {
    console.log(`[embeddings] Preloading model "${config.model}"...`)
    await ensureEmbeddingModelAvailable(config.model)

    // Run a dummy embedding to load the model into memory
    await ollama.embeddings(config.model, 'warmup')
    console.log(`[embeddings] ✓ Model "${config.model}" preloaded and ready`)
  } catch (error) {
    console.error(`[embeddings] Failed to preload model:`, error)
  }
}

export async function embedText(
  text: string,
  opts: { provider?: EmbeddingProvider; model?: string } = {}
): Promise<number[]> {
  const config = loadEmbeddingConfig()

  // If embeddings are disabled, use mock provider
  if (!config.enabled) {
    opts.provider = 'mock'
  }

  const provider = opts.provider || config.provider
  if (provider === 'ollama') {
    const model = opts.model || config.model
    const prompt = typeof text === 'string' ? text : JSON.stringify(text)
    await ensureEmbeddingModelAvailable(model)
    const res = await ollama.embeddings(model, prompt)
    return res.embedding
  }

  // Mock embedding (hash trick) for environments without Ollama
  const dim = 256
  const vec = new Array(dim).fill(0)
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i)
    const idx = (ch + i) % dim
    vec[idx] += 1
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1
  return vec.map(v => v / norm)
}

/**
 * Ensure the requested embedding model is available locally.
 * If missing, automatically pull it once, then mark it verified.
 */
const verifiedEmbeddingModels = new Set<string>()

async function ensureEmbeddingModelAvailable(model: string) {
  if (verifiedEmbeddingModels.has(model)) return

  // Check installed models (handle both "model:tag" and "model" formats)
  const models = await ollama.listModels().catch(() => [])
  const modelBase = model.split(':')[0] // Strip tag if present
  const found = models.some(m => {
    const mBase = (m.model || m.name || '').split(':')[0]
    return mBase === modelBase
  })

  if (!found) {
    console.info(`[embeddings] Pulling missing embedding model "${model}" from Ollama...`)
    await ollama.pullModel(model)
    console.info(`[embeddings] ✓ Model "${model}" installed`)
  }

  verifiedEmbeddingModels.add(model)
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length)
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb) || 1
  return dot / denom
}
