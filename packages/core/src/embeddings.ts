import { ollama } from './ollama.js'

export type EmbeddingProvider = 'ollama' | 'mock'

export async function embedText(
  text: string,
  opts: { provider?: EmbeddingProvider; model?: string } = {}
): Promise<number[]> {
  const provider = opts.provider || 'ollama'
  if (provider === 'ollama') {
    const model = opts.model || 'nomic-embed-text'
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

  // Check installed models
  const models = await ollama.listModels().catch(() => [])
  const found = models.some(m => m.model === model || m.name === model)

  if (!found) {
    console.info(`[embeddings] Pulling missing embedding model "${model}" from Ollama...`)
    await ollama.pullModel(model)
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
