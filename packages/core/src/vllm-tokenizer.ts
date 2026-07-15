import fs from 'node:fs'
import path from 'node:path'

export interface ResolvedVLLMTokenizerReference {
  reference: string
  recoveredFromStaleCachePath: boolean
}

function recoverHuggingFaceRepoId(cachePath: string): string | null {
  const modelCacheSegment = cachePath
    .split(/[\\/]+/)
    .find(segment => segment.startsWith('models--'))

  if (!modelCacheSegment) return null

  const encodedRepoId = modelCacheSegment.slice('models--'.length)
  const namespaceSeparator = encodedRepoId.indexOf('--')
  if (namespaceSeparator <= 0 || namespaceSeparator >= encodedRepoId.length - 2) {
    return null
  }

  const namespace = encodedRepoId.slice(0, namespaceSeparator)
  const repository = encodedRepoId.slice(namespaceSeparator + 2)
  return `${namespace}/${repository}`
}

/**
 * Keep vLLM tokenizer configuration independent from disposable HF cache hashes.
 * A deleted snapshot can be recovered as its stable Hugging Face repository ID.
 */
export function resolveVLLMTokenizerReference(
  tokenizer: string | undefined,
): ResolvedVLLMTokenizerReference | undefined {
  if (!tokenizer) return undefined

  if (!path.isAbsolute(tokenizer) || fs.existsSync(tokenizer)) {
    return {
      reference: tokenizer,
      recoveredFromStaleCachePath: false,
    }
  }

  const recoveredRepoId = recoverHuggingFaceRepoId(tokenizer)
  if (recoveredRepoId) {
    return {
      reference: recoveredRepoId,
      recoveredFromStaleCachePath: true,
    }
  }

  throw new Error(
    `Configured vLLM tokenizer path does not exist: ${tokenizer}. ` +
    'Use a stable Hugging Face model ID instead of a disposable cache path.',
  )
}
