/**
 * Provider Types
 *
 * Unified interface for ALL LLM providers (local and cloud).
 * Both core (Ollama) and server (RunPod, HuggingFace) implement this.
 */

export interface ProviderTextContentPart {
  type: 'text';
  text: string;
}

export interface ProviderImageContentPart {
  type: 'image_url';
  image_url: {
    url: string;
    detail?: 'auto' | 'low' | 'high';
  };
}

export type ProviderContentPart = ProviderTextContentPart | ProviderImageContentPart;
export type ProviderMessageContent = string | ProviderContentPart[];

export interface ProviderMessage {
  role: 'system' | 'user' | 'assistant';
  content: ProviderMessageContent;
}

export interface ProviderImagePolicy {
  maxImages: number;
  maxImageBytes: number;
  allowedMimeTypes: string[];
}

export interface ParsedProviderImage {
  mimeType: string;
  base64: string;
  bytes: number;
}

export interface ProviderMessageInspection {
  imageCount: number;
  totalImageBytes: number;
  mimeTypes: string[];
}

export const DEFAULT_PROVIDER_IMAGE_POLICY: ProviderImagePolicy = {
  maxImages: 4,
  maxImageBytes: 5 * 1024 * 1024,
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
}

const MAX_PROVIDER_IMAGES = 16
const MAX_PROVIDER_IMAGE_BYTES = 20 * 1024 * 1024

export class ProviderInputError extends Error {
  readonly code = 'invalid_provider_input'

  constructor(message: string) {
    super(message)
    this.name = 'ProviderInputError'
  }
}

function normalizeMimeType(value: string): string {
  const normalized = value.toLowerCase()
  return normalized === 'image/jpg' ? 'image/jpeg' : normalized
}

export function providerImagePolicyFromOptions(options: ProviderOptions): ProviderImagePolicy {
  const maxImages = options.maxImages ?? DEFAULT_PROVIDER_IMAGE_POLICY.maxImages
  const maxImageBytes = options.maxImageBytes ?? DEFAULT_PROVIDER_IMAGE_POLICY.maxImageBytes
  const allowedMimeTypes = options.allowedImageMimeTypes ?? DEFAULT_PROVIDER_IMAGE_POLICY.allowedMimeTypes

  if (!Number.isInteger(maxImages) || maxImages < 1 || maxImages > MAX_PROVIDER_IMAGES) {
    throw new ProviderInputError(`maxImages must be an integer between 1 and ${MAX_PROVIDER_IMAGES}.`)
  }
  if (!Number.isInteger(maxImageBytes) || maxImageBytes < 1 || maxImageBytes > MAX_PROVIDER_IMAGE_BYTES) {
    throw new ProviderInputError(`maxImageBytes must be an integer between 1 and ${MAX_PROVIDER_IMAGE_BYTES}.`)
  }
  if (!Array.isArray(allowedMimeTypes) || allowedMimeTypes.length === 0
    || allowedMimeTypes.some(value => typeof value !== 'string' || !value.startsWith('image/'))) {
    throw new ProviderInputError('allowedImageMimeTypes must contain one or more image MIME types.')
  }

  return {
    maxImages,
    maxImageBytes,
    allowedMimeTypes: allowedMimeTypes.map(normalizeMimeType),
  }
}

export function parseProviderImageDataUrl(
  value: unknown,
  policy: ProviderImagePolicy
): ParsedProviderImage {
  if (typeof value !== 'string') {
    throw new ProviderInputError('Image content must use a base64 data URL.')
  }

  const match = /^data:([^;,]+);base64,([a-zA-Z0-9+/]*={0,2})$/.exec(value)
  if (!match) {
    throw new ProviderInputError('Image content must be a valid base64 data URL; remote image URLs are not accepted.')
  }

  const mimeType = normalizeMimeType(match[1])
  const allowedMimeTypes = policy.allowedMimeTypes.map(normalizeMimeType)
  if (!allowedMimeTypes.includes(mimeType)) {
    throw new ProviderInputError(`Unsupported image type ${mimeType}. Allowed types: ${allowedMimeTypes.join(', ')}.`)
  }

  const base64 = match[2]
  if (!base64 || base64.length % 4 !== 0) {
    throw new ProviderInputError('Image content contains invalid base64 data.')
  }

  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  const bytes = Math.floor((base64.length * 3) / 4) - padding
  if (bytes <= 0) {
    throw new ProviderInputError('Image content is empty.')
  }
  if (bytes > policy.maxImageBytes) {
    throw new ProviderInputError(`Image exceeds the selected model's ${policy.maxImageBytes}-byte limit.`)
  }

  return { mimeType, base64, bytes }
}

export function providerMessagesContainImages(messages: ProviderMessage[]): boolean {
  return messages.some(message => Array.isArray(message.content)
    && message.content.some(part => part?.type === 'image_url'))
}

export function inspectProviderMessages(
  messages: ProviderMessage[],
  policy: ProviderImagePolicy
): ProviderMessageInspection {
  let imageCount = 0
  let totalImageBytes = 0
  const mimeTypes = new Set<string>()

  for (const message of messages) {
    if (typeof message.content === 'string') continue
    if (!Array.isArray(message.content)) {
      throw new ProviderInputError('Message content must be text or an array of supported content parts.')
    }

    for (const part of message.content) {
      if (!part || typeof part !== 'object') {
        throw new ProviderInputError('Message content contains an invalid part.')
      }
      if (part.type === 'text') {
        if (typeof part.text !== 'string') {
          throw new ProviderInputError('Text content parts must contain text.')
        }
        continue
      }
      if (part.type !== 'image_url') {
        throw new ProviderInputError(`Unsupported message content part: ${String((part as { type?: unknown }).type)}.`)
      }

      imageCount += 1
      if (imageCount > policy.maxImages) {
        throw new ProviderInputError(`Request contains more than the selected model's ${policy.maxImages}-image limit.`)
      }
      const parsed = parseProviderImageDataUrl(part.image_url?.url, policy)
      totalImageBytes += parsed.bytes
      mimeTypes.add(parsed.mimeType)
    }
  }

  return {
    imageCount,
    totalImageBytes,
    mimeTypes: [...mimeTypes],
  }
}

export interface ProviderOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  topK?: number;
  minP?: number;
  repeatPenalty?: number;
  seed?: number;
  format?: 'text' | 'json';
  keepAlive?: string;
  /** Normal model options, applied regardless of input modality. */
  contextWindow?: number;
  enableThinking?: boolean;
  maxImages?: number;
  maxImageBytes?: number;
  allowedImageMimeTypes?: string[];
  /** Capabilities declared/discovered for the already-selected model. */
  modelCapabilities?: string[];
  // Cloud-specific
  endpointTier?: string;
  // Big Brother hybrid mode - request Big Brother for this specific call
  useBigBrother?: boolean;
}

export interface ProviderResponse {
  content: string;
  /** Provider-native reasoning channel, separate from user-visible content. */
  thinking?: string | null;
  model: string;
  provider: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface ProviderProgressEvent {
  phase: 'queued' | 'loading' | 'running' | 'completed' | 'failed';
  message: string;
  elapsedMs?: number;
}

export type ProviderProgressCallback = (event: ProviderProgressEvent) => void;

/**
 * Provider configuration passed to the bridge
 */
export interface ProviderConfig {
  // Local config
  ollama?: {
    endpoint: string;
  };
  // Local model service config (Transformers.js)
  localModels?: {
    endpoint: string;
    embeddingModel?: string;
    llmModel?: string;
  };
  // Cloud config (only used if server package is installed)
  runpod?: {
    apiKey: string;
    endpoints: Record<string, string | undefined>;
    endpointTiers?: Record<string, any>;
  };
  huggingface?: {
    apiKey: string;
    endpointUrl: string;
  };
}

/**
 * Provider type - determines where requests are routed
 *
 * Local providers: ollama, vllm, mock, local-models (handled by core bridge)
 * Cloud providers: runpod_serverless, huggingface (handled by @metahuman/server)
 */
export type ProviderType = 'ollama' | 'vllm' | 'mock' | 'runpod_serverless' | 'huggingface' | 'openai' | 'local' | 'remote-server' | 'local-models';

/**
 * Check if a provider is a cloud provider (requires server package)
 */
export function isCloudProvider(provider: ProviderType): boolean {
  return provider === 'runpod_serverless' || provider === 'huggingface';
}

/**
 * Check if a provider is a remote server provider (proxies to another MetaHuman server)
 */
export function isRemoteServerProvider(provider: ProviderType): boolean {
  return provider === 'remote-server';
}

/**
 * Check if a provider is a local provider (handled by core)
 */
export function isLocalProvider(provider: ProviderType): boolean {
  return provider === 'ollama' || provider === 'vllm' || provider === 'mock' || provider === 'local-models';
}

/**
 * Check if a provider is the local models service (Transformers.js)
 */
export function isLocalModelsProvider(provider: ProviderType): boolean {
  return provider === 'local-models';
}
