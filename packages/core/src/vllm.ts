/**
 * vLLM Client - Manages vLLM server lifecycle and API calls
 *
 * vLLM exposes an OpenAI-compatible API at /v1/chat/completions.
 * Unlike Ollama, vLLM loads ONE model at a time and requires server restart to switch.
 *
 * Key differences from Ollama:
 * - Uses HuggingFace model IDs (not GGUF files)
 * - Higher throughput via PagedAttention
 * - Better for large models (30B+) and multi-GPU
 * - Requires CUDA and more VRAM
 */

import { spawn, execSync, execFileSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from './path-builder.js';
import { audit } from './audit.js';
import { eventBus, EventTypes, generateRequestId } from './infrastructure/event-bus/index.js';
import { resolveVLLMTokenizerReference } from './vllm-tokenizer.js';
import type { ProviderMessageContent } from './providers/types.js';
import type { LocalModelArtifact } from './model-artifacts.js';

const LOG_PREFIX = '[vllm]';

// ============================================================================
// Python Environment Detection
// ============================================================================

/**
 * Get the Python executable path for vLLM
 * Checks for venv first, then falls back to system python
 */
function getVLLMPython(): string {
  // Check for venv in project root
  const venvPython = path.join(ROOT, '.venv-vllm', 'bin', 'python');
  if (fs.existsSync(venvPython)) {
    return venvPython;
  }

  // Check for venv in vendor directory
  const vendorVenvPython = path.join(ROOT, 'vendor', '.venv-vllm', 'bin', 'python');
  if (fs.existsSync(vendorVenvPython)) {
    return vendorVenvPython;
  }

  // Fall back to system python
  return 'python';
}

// ============================================================================
// Types
// ============================================================================

export interface VLLMConfig {
  /** vLLM server endpoint (default: http://localhost:8000) */
  endpoint: string;
  /** HuggingFace model ID to serve */
  model: string;
  /** Optional explicit local model file path. */
  modelPath?: string;
  /** vLLM load format (auto, gguf, safetensors, etc.). */
  loadFormat?: string;
  /** Optional tokenizer repo or local tokenizer path. Useful for GGUF files. */
  tokenizer?: string;
  /** Public model name exposed by the OpenAI-compatible API. */
  servedModelName?: string;
  /** How long to wait for vLLM to bind before treating startup as failed. */
  startupTimeoutMs?: number;
  /** GPU memory utilization (0.0-1.0, default: 0.9). */
  gpuMemoryUtilization: number;
  /** Leave this much physical VRAM free when automatic allocation is enabled. */
  gpuMemoryHeadroomGiB?: number;
  /** Upper bound for automatically calculated GPU utilization. */
  autoUtilizationMax?: number;
  /** Maximum model context length, or auto to fit the largest length in the KV budget. */
  maxModelLen?: number | 'auto';
  /** Explicit GPU KV-cache budget. When set, vLLM ignores gpuMemoryUtilization for KV sizing. */
  kvCacheMemoryGiB?: number | null;
  /** Model-weight memory to offload to CPU RAM. */
  cpuOffloadGiB?: number;
  /** CPU RAM reserved for KV-cache offloading. */
  kvOffloadingGiB?: number;
  /** KV-cache offload implementation. */
  kvOffloadingBackend?: 'native' | 'lmcache';
  /** Maximum output tokens per response (default: 2048). Increase when thinking is enabled. */
  maxTokens?: number;
  /** Number of GPUs for tensor parallelism */
  tensorParallelSize?: number;
  /** Data type: auto, float16, bfloat16 */
  dtype?: string;
  /** Quantization method: awq, gptq, squeezellm, or null */
  quantization?: string | null;
  /** Disable CUDA graphs to save GPU memory (trades performance for stability) */
  enforceEager?: boolean;
  /** Auto-detect optimal GPU utilization based on available memory */
  autoUtilization?: boolean;
  /** Enable thinking mode for Qwen3 models (default: true, set false to disable <think> tags) */
  enableThinking?: boolean;
  /** LoRA adapters to load at startup (format: { name: string, path: string }[]) */
  loraModules?: Array<{ name: string; path: string }>;
  /** Maximum LoRA rank (default: 64) */
  maxLoraRank?: number;
  /** Maximum number of distinct LoRAs active in one batch. */
  maxLoras?: number;
  /** Maximum number of LoRAs retained in CPU memory. */
  maxCpuLoras?: number;
  /** LoRA compute dtype. */
  loraDtype?: 'auto' | 'float16' | 'bfloat16';
  /** Shared artifact selected through the backend registry, when applicable. */
  artifact?: LocalModelArtifact;
}

export type VLLMArtifactCompatibilityStatus = 'compatible' | 'incompatible' | 'unknown';

export interface VLLMArtifactCompatibility {
  artifactId: string;
  status: VLLMArtifactCompatibilityStatus;
  compatible: boolean;
  architecture?: string;
  quantization?: string;
  reason: string;
  vllmVersion?: string;
  transformersVersion?: string;
}

const artifactCompatibilityCache = new Map<string, VLLMArtifactCompatibility>();

/** vLLM may write informational startup lines to stdout before script output. */
export function parseVLLMPreflightOutput<T>(output: string): T {
  const lines = output.trim().split(/\r?\n/).reverse();
  for (const line of lines) {
    try {
      return JSON.parse(line) as T;
    } catch {
      // Continue past vLLM/transformers informational output.
    }
  }
  throw new Error('vLLM preflight did not return a JSON result')
}

export interface VLLMMemoryPlan {
  utilization: number;
  allocatedGB: number;
  headroomGB: number;
  freeGB: number;
  usedGB: number;
  totalGB: number;
  recommendation: string;
}

/**
 * Convert live GPU memory into vLLM's total-device utilization fraction.
 * vLLM profiles model weights first and uses the remaining allocation for KV
 * cache, so this plan does not need to guess weight size from a file on disk.
 */
export function calculateVLLMMemoryPlan(input: {
  freeGB: number;
  totalGB: number;
  usedGB?: number;
  headroomGB?: number;
  maxUtilization?: number;
}): VLLMMemoryPlan {
  const totalGB = Number.isFinite(input.totalGB) ? Math.max(0, input.totalGB) : 0;
  const freeGB = Number.isFinite(input.freeGB) ? Math.max(0, Math.min(input.freeGB, totalGB)) : 0;
  const usedGB = Number.isFinite(input.usedGB)
    ? Math.max(0, input.usedGB!)
    : Math.max(0, totalGB - freeGB);
  const headroomGB = Number.isFinite(input.headroomGB)
    ? Math.max(0, input.headroomGB!)
    : 1.5;
  const maxUtilization = Number.isFinite(input.maxUtilization)
    ? Math.max(0.1, Math.min(0.99, input.maxUtilization!))
    : 0.95;
  const availableForVLLM = Math.max(0, freeGB - headroomGB);
  const utilization = totalGB > 0
    ? Math.min(maxUtilization, availableForVLLM / totalGB)
    : 0;
  const allocatedGB = utilization * totalGB;

  let recommendation: string;
  if (totalGB <= 0) {
    recommendation = 'GPU memory could not be detected.';
  } else if (utilization < 0.1) {
    recommendation = `Only ${availableForVLLM.toFixed(1)} GiB remains after headroom; free GPU memory before starting vLLM.`;
  } else if (usedGB > 1) {
    recommendation = `Reserve ${allocatedGB.toFixed(1)} GiB for vLLM and leave ${headroomGB.toFixed(1)} GiB free; other processes currently use ${usedGB.toFixed(1)} GiB.`;
  } else {
    recommendation = `Reserve ${allocatedGB.toFixed(1)} GiB for model weights and KV cache while leaving ${headroomGB.toFixed(1)} GiB free.`;
  }

  return {
    utilization,
    allocatedGB,
    headroomGB,
    freeGB,
    usedGB,
    totalGB,
    recommendation,
  };
}

/** Build the vLLM arguments that control context, GPU KV cache, and CPU offload. */
export function buildVLLMMemoryArgs(config: VLLMConfig): string[] {
  const args: string[] = [];
  if (config.maxModelLen) {
    args.push('--max-model-len', String(config.maxModelLen));
  }
  if (config.kvCacheMemoryGiB && config.kvCacheMemoryGiB > 0) {
    args.push('--kv-cache-memory-bytes', String(Math.round(config.kvCacheMemoryGiB * 1024 ** 3)));
  }
  if (config.cpuOffloadGiB && config.cpuOffloadGiB > 0) {
    args.push('--cpu-offload-gb', String(config.cpuOffloadGiB));
  }
  if (config.kvOffloadingGiB && config.kvOffloadingGiB > 0) {
    args.push('--kv-offloading-size', String(config.kvOffloadingGiB));
    args.push('--kv-offloading-backend', config.kvOffloadingBackend || 'native');
  }
  return args;
}

/** Build LoRA startup arguments for PEFT/safetensors model launches. */
export function buildVLLMLoraArgs(config: VLLMConfig, loadFormat?: string): string[] {
  const loraModules = loadFormat === 'gguf' ? [] : config.loraModules || [];
  if (loraModules.length === 0) return [];
  return [
    '--enable-lora',
    '--lora-modules',
    ...loraModules.map(lora => `${lora.name}=${lora.path}`),
    '--max-lora-rank', String(config.maxLoraRank ?? 64),
    '--max-loras', String(config.maxLoras ?? 1),
    '--max-cpu-loras', String(config.maxCpuLoras ?? config.maxLoras ?? 1),
    '--lora-dtype', config.loraDtype || 'auto',
  ];
}

/**
 * Verify discovered artifacts against MetaHuman's active vLLM environment.
 * This is deliberately explicit and cached: importing vLLM's model registry
 * and GGUF readers during every ordinary status request is slow.
 */
export function preflightVLLMArtifacts(
  artifacts: LocalModelArtifact[],
): VLLMArtifactCompatibility[] {
  const results = new Map<string, VLLMArtifactCompatibility>();
  const pending = artifacts.filter(artifact => {
    const cacheKey = `${artifact.digest}:${artifact.format}:${artifact.architecture || 'unknown'}:${artifact.quantization || 'none'}`;
    const cached = artifactCompatibilityCache.get(cacheKey);
    if (cached) {
      results.set(artifact.id, { ...cached, artifactId: artifact.id });
      return false;
    }

    if (!artifact.architecture) {
      const result: VLLMArtifactCompatibility = {
        artifactId: artifact.id,
        status: 'unknown',
        compatible: false,
        quantization: artifact.quantization,
        reason: 'The artifact does not expose an architecture in its model metadata.',
      };
      artifactCompatibilityCache.set(cacheKey, result);
      results.set(artifact.id, result);
      return false;
    }

    return true;
  });

  if (pending.length > 0) {
    const requested = pending.map(artifact => ({
      key: `${artifact.format}:${artifact.architecture}:${artifact.quantization || 'none'}`,
      format: artifact.format,
      architecture: artifact.architecture!,
      quantization: artifact.quantization || null,
    }));
    try {
      const python = [
        'import importlib.metadata, json, sys',
        'from transformers.modeling_gguf_pytorch_utils import GGUF_SUPPORTED_ARCHITECTURES',
        'from gguf import MODEL_ARCH_NAMES',
        'from vllm.model_executor.models import ModelRegistry',
        'from vllm.model_executor.layers.quantization import QUANTIZATION_METHODS',
        'requested = json.loads(sys.argv[1])',
        'transformers_supported = set(GGUF_SUPPORTED_ARCHITECTURES)',
        'loader_supported = set(MODEL_ARCH_NAMES.values())',
        'registered_architectures = set(ModelRegistry.get_supported_archs())',
        'print(json.dumps({',
        '  "vllmVersion": importlib.metadata.version("vllm"),',
        '  "transformersVersion": importlib.metadata.version("transformers"),',
        '  "results": {item["key"]: {',
        '    "transformers": item["architecture"] in transformers_supported,',
        '    "loader": item["architecture"] in loader_supported,',
        '    "registered": item["architecture"] in registered_architectures,',
        '    "quantization": item["quantization"] is None or item["quantization"] in QUANTIZATION_METHODS,',
        '  } for item in requested},',
        '}))',
      ].join('\n');
      const output = execFileSync(getVLLMPython(), ['-c', python, JSON.stringify(requested)], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 12000,
      });
      const inspection = parseVLLMPreflightOutput<{
        vllmVersion: string;
        transformersVersion: string;
        results: Record<string, { transformers: boolean; loader: boolean; registered: boolean; quantization: boolean }>;
      }>(output);

      for (const artifact of pending) {
        const architecture = artifact.architecture!;
        const support = inspection.results[
          `${artifact.format}:${architecture}:${artifact.quantization || 'none'}`
        ];
        const compatible = artifact.format === 'gguf'
          ? support?.transformers === true && support.loader === true
          : support?.registered === true && support.quantization === true;
        let reason = artifact.format === 'gguf'
          ? `Verified GGUF architecture ${architecture} against the installed vLLM environment.`
          : artifact.quantization
            ? `vLLM ${inspection.vllmVersion} registers ${architecture} and supports ${artifact.quantization} checkpoints.`
            : `vLLM ${inspection.vllmVersion} registers ${architecture} for ${artifact.format} checkpoints.`;
        if (artifact.format === 'gguf' && !support?.transformers) {
          reason = `Transformers ${inspection.transformersVersion} cannot read GGUF architecture ${architecture}.`;
        } else if (artifact.format === 'gguf' && !support?.loader) {
          reason = `vLLM ${inspection.vllmVersion} has no GGUF loader mapping for architecture ${architecture}.`;
        } else if (artifact.format !== 'gguf' && !support?.registered) {
          reason = `vLLM ${inspection.vllmVersion} does not register checkpoint architecture ${architecture}.`;
        } else if (artifact.format !== 'gguf' && artifact.quantization && !support?.quantization) {
          reason = `vLLM ${inspection.vllmVersion} does not support checkpoint quantization ${artifact.quantization}.`;
        }
        const result: VLLMArtifactCompatibility = {
          artifactId: artifact.id,
          status: compatible ? 'compatible' : 'incompatible',
          compatible,
          architecture,
          quantization: artifact.quantization,
          reason,
          vllmVersion: inspection.vllmVersion,
          transformersVersion: inspection.transformersVersion,
        };
        artifactCompatibilityCache.set(
          `${artifact.digest}:${artifact.format}:${architecture}:${artifact.quantization || 'none'}`,
          result,
        );
        results.set(artifact.id, result);
      }
    } catch (error) {
      const reason = error instanceof Error
        ? `vLLM compatibility preflight failed: ${error.message}`
        : 'vLLM compatibility preflight failed.';
      for (const artifact of pending) {
        const result: VLLMArtifactCompatibility = {
          artifactId: artifact.id,
          status: 'unknown',
          compatible: false,
          architecture: artifact.architecture,
          quantization: artifact.quantization,
          reason,
        };
        results.set(artifact.id, result);
      }
    }
  }

  return artifacts.map(artifact => results.get(artifact.id)!);
}

export interface VLLMModel {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

export interface VLLMHealth {
  status: 'healthy' | 'starting' | 'unhealthy' | 'stopped';
  model?: string;
  version?: string;
  gpuMemoryUsed?: number;
  gpuMemoryTotal?: number;
}

export interface VLLMChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: ProviderMessageContent;
}

export interface VLLMChatResponse {
  content: string;
  model: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface VLLMChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stream?: boolean;
  enableThinking?: boolean;
  frequencyPenalty?: number;
  presencePenalty?: number;
  repetitionPenalty?: number;
}

export function buildVLLMChatMessages(messages: VLLMChatMessage[]): VLLMChatMessage[] {
  return messages.map(message => ({
    role: message.role,
    content: message.content,
  }));
}

export function buildVLLMChatRequest(
  messages: VLLMChatMessage[],
  options: VLLMChatOptions = {},
  currentModel: string | null = null
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: options.model || currentModel || 'default',
    messages: buildVLLMChatMessages(messages),
    max_tokens: options.maxTokens ?? 2048,
    temperature: options.temperature ?? 0.7,
    top_p: options.topP ?? 0.95,
    stream: false,
  };

  if (options.frequencyPenalty !== undefined) body.frequency_penalty = options.frequencyPenalty;
  if (options.presencePenalty !== undefined) body.presence_penalty = options.presencePenalty;
  if (options.repetitionPenalty !== undefined) body.repetition_penalty = options.repetitionPenalty;
  if (options.enableThinking !== undefined) {
    body.chat_template_kwargs = { enable_thinking: options.enableThinking };
  }

  return body;
}

// ============================================================================
// Hugging Face Cache Checks
// ============================================================================

function getHuggingFaceHubCache(): string {
  if (process.env.HF_HUB_CACHE) {
    return process.env.HF_HUB_CACHE;
  }
  if (process.env.HF_HOME) {
    return path.join(process.env.HF_HOME, 'hub');
  }
  return path.join(os.homedir(), '.cache', 'huggingface', 'hub');
}

function getHuggingFaceModelCacheDir(model: string): string {
  return path.join(getHuggingFaceHubCache(), `models--${model.replace(/\//g, '--')}`);
}

function getCachedSafetensorsIndex(model: string): string | null {
  const modelCacheDir = getHuggingFaceModelCacheDir(model);
  const refsMain = path.join(modelCacheDir, 'refs', 'main');
  const snapshotRoot = path.join(modelCacheDir, 'snapshots');

  const candidates: string[] = [];
  try {
    if (fs.existsSync(refsMain)) {
      const revision = fs.readFileSync(refsMain, 'utf-8').trim();
      if (revision) {
        candidates.push(path.join(snapshotRoot, revision, 'model.safetensors.index.json'));
      }
    }

    if (fs.existsSync(snapshotRoot)) {
      for (const entry of fs.readdirSync(snapshotRoot)) {
        candidates.push(path.join(snapshotRoot, entry, 'model.safetensors.index.json'));
      }
    }
  } catch {
    return null;
  }

  return candidates.find(candidate => fs.existsSync(candidate)) ?? null;
}

function getFilesystemFileSizeBits(dir: string): number | null {
  try {
    const existingDir = fs.existsSync(dir) ? dir : path.dirname(dir);
    const output = execFileSync('getconf', ['FILESIZEBITS', existingDir], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const bits = Number.parseInt(output, 10);
    return Number.isFinite(bits) ? bits : null;
  } catch {
    return null;
  }
}

function formatGB(bytes: number): string {
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}GB`;
}

function checkModelCacheFileSizeSupport(model: string): string | null {
  const indexPath = getCachedSafetensorsIndex(model);
  if (!indexPath) {
    return null;
  }

  try {
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8')) as {
      metadata?: { total_size?: number };
      weight_map?: Record<string, string>;
    };
    const totalSize = index.metadata?.total_size;
    const shards = new Set(Object.values(index.weight_map ?? {}));
    if (!totalSize || shards.size === 0) {
      return null;
    }

    const fileSizeBits = getFilesystemFileSizeBits(indexPath);
    if (!fileSizeBits || fileSizeBits > 32) {
      return null;
    }

    // FILESIZEBITS=32 is not safe for multi-GB Hugging Face shards. Use signed
    // 32-bit as the conservative limit; eCryptfs commonly fails around here.
    const conservativeMaxFileSize = 2 ** (fileSizeBits - 1);
    const estimatedShardSize = Math.ceil(totalSize / shards.size);
    if (estimatedShardSize <= conservativeMaxFileSize) {
      return null;
    }

    const hubCache = getHuggingFaceHubCache();
    return [
      `Hugging Face cache filesystem cannot hold ${model} weight shards.`,
      `Cache: ${hubCache}`,
      `Filesystem FILESIZEBITS=${fileSizeBits}; estimated shard size ${formatGB(estimatedShardSize)} across ${shards.size} shard(s).`,
      'Set HF_HOME or HF_HUB_CACHE to a non-eCryptfs filesystem with enough free space, or use a model whose shards fit this filesystem.',
    ].join(' ');
  } catch {
    return null;
  }
}

// ============================================================================
// vLLM Client
// ============================================================================

export class VLLMClient {
  private endpoint: string;
  private serverProcess: ChildProcess | null = null;
  private currentModel: string | null = null;

  constructor(endpoint = 'http://localhost:8000') {
    this.endpoint = endpoint.replace(/\/$/, '');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Server Status
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Check if vLLM server is running and responsive
   */
  async isRunning(): Promise<boolean> {
    try {
      const response = await fetch(`${this.endpoint}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      });
      return response.ok;
    } catch (error) {
      // Try the models endpoint as fallback (some vLLM versions)
      try {
        const response = await fetch(`${this.endpoint}/v1/models`, {
          method: 'GET',
          signal: AbortSignal.timeout(3000),
        });
        return response.ok;
      } catch {
        // Connection refused or timeout is expected when vLLM isn't running - no need to log
        return false;
      }
    }
  }

  /**
   * Get detailed health status
   */
  async getHealth(): Promise<VLLMHealth> {
    const running = await this.isRunning();

    if (!running) {
      return { status: 'stopped' };
    }

    try {
      // Get loaded models
      const modelsResponse = await fetch(`${this.endpoint}/v1/models`, {
        signal: AbortSignal.timeout(5000),
      });

      if (!modelsResponse.ok) {
        return { status: 'unhealthy' };
      }

      const modelsData = await modelsResponse.json() as { data: VLLMModel[] };
      const model = modelsData.data?.[0]?.id;

      return {
        status: 'healthy',
        model,
      };
    } catch (error) {
      return { status: 'unhealthy' };
    }
  }

  /**
   * Get the currently loaded model
   */
  async getLoadedModel(): Promise<string | null> {
    try {
      const response = await fetch(`${this.endpoint}/v1/models`, {
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json() as { data: VLLMModel[] };
      return data.data?.[0]?.id || null;
    } catch (error) {
      console.warn(`${LOG_PREFIX} Failed to get loaded model:`, error);
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Pre-flight Checks
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Clean up any zombie vLLM processes that might be holding GPU memory
   */
  async cleanupZombieProcesses(): Promise<void> {
    try {
      // Kill any orphaned vLLM processes
      execSync('pkill -9 -f "vllm.entrypoints"', { stdio: 'ignore' });
    } catch { /* No processes found - that's fine */ }

    try {
      execSync('pkill -9 -f "VLLM::EngineCore"', { stdio: 'ignore' });
    } catch { /* No processes found */ }

    // Clean up stale PID file
    const pidFile = path.join(ROOT, 'logs', 'run', 'vllm.pid');
    if (fs.existsSync(pidFile)) {
      try {
        const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim());
        // Check if process is actually running
        try {
          process.kill(pid, 0); // Signal 0 just checks if process exists
        } catch {
          // Process doesn't exist, remove stale PID file
          fs.unlinkSync(pidFile);
        }
      } catch (error) {
        console.warn(`${LOG_PREFIX} Error cleaning stale PID file:`, error);
        try { fs.unlinkSync(pidFile); } catch { /* File doesn't exist */ }
      }
    }

    // Give GPU time to release memory
    await new Promise(r => setTimeout(r, 1000));
  }

  /**
   * Check if there's enough GPU memory available
   */
  async checkGPUMemory(utilizationTarget: number): Promise<{
    available: boolean;
    freeGB: number;
    totalGB: number;
    requiredGB: number;
  }> {
    try {
      const output = execSync(
        'nvidia-smi --query-gpu=memory.free,memory.total --format=csv,noheader,nounits',
        { encoding: 'utf-8' }
      ).trim();

      const [freeStr, totalStr] = output.split(',').map(s => s.trim());
      const freeMB = parseInt(freeStr);
      const totalMB = parseInt(totalStr);

      const freeGB = freeMB / 1024;
      const totalGB = totalMB / 1024;
      const requiredGB = totalGB * utilizationTarget;

      // Need at least the required amount plus a small buffer
      const available = freeGB >= requiredGB * 0.95;

      return { available, freeGB, totalGB, requiredGB };
    } catch (error) {
      // nvidia-smi not available or failed - assume OK and let vLLM handle it
      console.warn(`${LOG_PREFIX} Could not check GPU memory, proceeding anyway:`, error);
      return { available: true, freeGB: 0, totalGB: 0, requiredGB: 0 };
    }
  }

  /**
   * Calculate optimal GPU memory utilization based on available memory
   * Returns a utilization value (0.0-1.0) that leaves headroom for other processes
   */
  async calculateOptimalUtilization(
    headroomGB = 1.5,
    maxUtilization = 0.95,
  ): Promise<VLLMMemoryPlan> {
    try {
      const output = execFileSync('nvidia-smi', [
        '--query-gpu=memory.free,memory.total,memory.used',
        '--format=csv,noheader,nounits',
      ], { encoding: 'utf-8' }).trim();

      const [freeStr, totalStr, usedStr] = output.split(',').map(s => s.trim());
      const freeMB = parseInt(freeStr);
      const totalMB = parseInt(totalStr);
      const usedMB = parseInt(usedStr);

      const freeGB = freeMB / 1024;
      const totalGB = totalMB / 1024;
      const usedGB = usedMB / 1024;

      return calculateVLLMMemoryPlan({
        freeGB,
        totalGB,
        usedGB,
        headroomGB,
        maxUtilization,
      });
    } catch (error) {
      // Fallback to conservative default
      return {
        utilization: Math.min(0.7, maxUtilization),
        allocatedGB: 0,
        headroomGB,
        freeGB: 0,
        usedGB: 0,
        totalGB: 0,
        recommendation: 'Could not detect GPU memory, using conservative 70% allocation',
      };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Server Lifecycle
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Start vLLM server with specified configuration
   *
   * Spawns: python -m vllm.entrypoints.openai.api_server --model <model> [options]
   */
  async startServer(config: VLLMConfig): Promise<{ pid: number; success: boolean; error?: string }> {
    console.log(`${LOG_PREFIX} ========== startServer HIT ==========`);
    const effectiveModel = config.modelPath || config.model;
    const effectiveLoadFormat = config.loadFormat;
    const servedModelName = config.servedModelName || config.model;
    let effectiveTokenizer: string | undefined;

    if (config.artifact) {
      const compatibility = preflightVLLMArtifacts([config.artifact])[0];
      if (!compatibility?.compatible) {
        return {
          pid: 0,
          success: false,
          error: compatibility?.reason || 'The selected artifact is not compatible with this vLLM environment.',
        };
      }
    }

    try {
      const resolvedTokenizer = resolveVLLMTokenizerReference(config.tokenizer);
      effectiveTokenizer = resolvedTokenizer?.reference;
      if (resolvedTokenizer?.recoveredFromStaleCachePath) {
        console.warn(
          `${LOG_PREFIX} Configured tokenizer cache path no longer exists; ` +
          `using stable Hugging Face model ID ${effectiveTokenizer}`,
        );
      }
    } catch (error) {
      return {
        pid: 0,
        success: false,
        error: error instanceof Error ? error.message : 'Invalid vLLM tokenizer configuration',
      };
    }

    console.log(`${LOG_PREFIX} Input: model=${effectiveModel}, endpoint=${config.endpoint}, gpuUtil=${config.gpuMemoryUtilization}`);
    
    const cacheError = checkModelCacheFileSizeSupport(effectiveModel);
    if (cacheError) {
      return {
        pid: 0,
        success: false,
        error: cacheError,
      };
    }

    // STEP 1: Reuse an already healthy server before any cleanup. This avoids
    // killing a working vLLM instance when duplicate startup paths call start.
    if (await this.isRunning()) {
      const loadedModel = await this.getLoadedModel();
      if (loadedModel === servedModelName || loadedModel === effectiveModel) {
        console.log(`${LOG_PREFIX} Server already running with requested model`);
        return { pid: this.serverProcess?.pid || 0, success: true };
      }
      // Different model - need to stop first
      console.log(`${LOG_PREFIX} Stopping existing server (different model)...`);
      await this.stopServer();
    }

    // STEP 2: Clean up any zombie vLLM processes before launching a new one.
    console.log(`${LOG_PREFIX} Cleaning up any existing processes...`);
    await this.cleanupZombieProcesses();

    // STEP 2.5: Auto-detect optimal GPU utilization if enabled
    let effectiveUtilization = config.gpuMemoryUtilization ?? 0.9;
    if (config.autoUtilization) {
      const optimal = await this.calculateOptimalUtilization(
        config.gpuMemoryHeadroomGiB ?? 1.5,
        config.autoUtilizationMax ?? 0.95,
      );
      effectiveUtilization = optimal.utilization;
      console.log(`${LOG_PREFIX} Auto-utilization: ${optimal.recommendation}`);
      console.log(`${LOG_PREFIX} Using ${(effectiveUtilization * 100).toFixed(0)}% GPU memory (${optimal.freeGB.toFixed(1)}GB free of ${optimal.totalGB.toFixed(1)}GB)`);
    }

    if (effectiveUtilization < 0.1) {
      return {
        pid: 0,
        success: false,
        error: 'Automatic GPU allocation left less than 10% of VRAM available for vLLM. Reduce configured headroom or close other GPU applications.',
      };
    }

    // STEP 3: Check GPU memory availability
    const gpuCheck = await this.checkGPUMemory(effectiveUtilization);
    if (!gpuCheck.available) {
      return {
        pid: 0,
        success: false,
        error: `Insufficient GPU memory: ${gpuCheck.freeGB.toFixed(1)}GB free, need ${gpuCheck.requiredGB.toFixed(1)}GB (${Math.round(effectiveUtilization * 100)}% of ${gpuCheck.totalGB.toFixed(1)}GB). Free GPU memory first.`,
      };
    }
    if (!config.autoUtilization) {
      console.log(`${LOG_PREFIX} GPU memory check passed: ${gpuCheck.freeGB.toFixed(1)}GB free of ${gpuCheck.totalGB.toFixed(1)}GB)`);
    }

    // Build command arguments
    const args = [
      '-m', 'vllm.entrypoints.openai.api_server',
      '--model', effectiveModel,
      '--host', '0.0.0.0',
      '--port', new URL(config.endpoint).port || '8000',
      '--gpu-memory-utilization', String(effectiveUtilization),
    ];

    if (effectiveLoadFormat) {
      args.push('--load-format', effectiveLoadFormat);
    }

    if (effectiveTokenizer) {
      args.push('--tokenizer', effectiveTokenizer);
    }

    if (config.servedModelName) {
      args.push('--served-model-name', config.servedModelName);
    }

    args.push(...buildVLLMMemoryArgs(config));

    if (config.tensorParallelSize && config.tensorParallelSize > 1) {
      args.push('--tensor-parallel-size', String(config.tensorParallelSize));
    }

    if (config.dtype) {
      args.push('--dtype', config.dtype);
    }

    if (config.quantization) {
      args.push('--quantization', config.quantization);
    }

    // Enforce eager mode disables CUDA graph compilation
    // This trades performance for stability on memory-constrained GPUs
    if (config.enforceEager) {
      args.push('--enforce-eager');
      console.log(`${LOG_PREFIX} Eager mode enabled (CUDA graphs disabled for memory stability)`);
    }

    // Note: Thinking mode for Qwen3 is controlled per-request via chat_template_kwargs
    // in the API request body, not via server startup flags. See chat() method.
    if (config.enableThinking === false) {
      console.log(`${LOG_PREFIX} Thinking mode will be disabled in API requests`);
    }

    // LoRA adapters - load multiple adapters at startup
    // vLLM routes requests to correct adapter based on model parameter
    const loraModules = effectiveLoadFormat === 'gguf' ? [] : config.loraModules;
    if (effectiveLoadFormat === 'gguf' && config.loraModules && config.loraModules.length > 0) {
      console.warn(`${LOG_PREFIX} Skipping ${config.loraModules.length} LoRA adapter(s): GGUF startup path does not load PEFT adapters`);
    }
    if (loraModules && loraModules.length > 0) {
      args.push(...buildVLLMLoraArgs(config, effectiveLoadFormat));
      console.log(`${LOG_PREFIX} Loading ${loraModules.length} LoRA adapter(s): ${loraModules.map(l => l.name).join(', ')}`);
    }

    // Spawn vLLM server process
    return new Promise((resolve) => {
      try {
        const pythonPath = getVLLMPython();
        console.log(`${LOG_PREFIX} Starting server with model: ${effectiveModel}`);
        const startupTimeoutMs = config.startupTimeoutMs ?? 120000;
        console.log(`${LOG_PREFIX} Config: maxModelLen=${config.maxModelLen}, enforceEager=${config.enforceEager}, gpuUtil=${effectiveUtilization}, startupTimeoutMs=${startupTimeoutMs}`);
        console.log(`${LOG_PREFIX} Full args: ${args.join(' ')}`);
        console.log(`${LOG_PREFIX} Using Python: ${pythonPath}`);

        // Set up log file
        const logDir = path.join(ROOT, 'logs', 'run');
        fs.mkdirSync(logDir, { recursive: true });
        const logFile = path.join(logDir, 'vllm-server.log');
        const logStream = fs.createWriteStream(logFile, { flags: 'w' });
        logStream.write(`=== vLLM Server Log - ${new Date().toISOString()} ===\n`);
        logStream.write(`Model: ${effectiveModel}\n`);
        logStream.write(`Python: ${pythonPath}\n`);
        logStream.write(`Args: ${args.join(' ')}\n`);
        logStream.write(`=== Output ===\n\n`);

        this.serverProcess = spawn(pythonPath, args, {
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: true,
        });

        // Handle spawn errors (e.g., python not found - ENOENT)
        this.serverProcess.on('error', (error: NodeJS.ErrnoException) => {
          console.error(`${LOG_PREFIX} Failed to spawn process:`, error.message);
          logStream.write(`\n=== Spawn error: ${error.message} ===\n`);
          logStream.end();
          this.serverProcess = null;
          this.currentModel = null;

          // Resolve with error instead of crashing
          if (error.code === 'ENOENT') {
            resolve({
              pid: 0,
              success: false,
              error: `Python not found: ${pythonPath}. vLLM requires Python with vLLM installed. This is expected on mobile devices.`,
            });
          } else {
            resolve({
              pid: 0,
              success: false,
              error: `Failed to start vLLM: ${error.message}`,
            });
          }
        });

        this.currentModel = servedModelName;

        // Save PID for later management
        const pidFile = path.join(ROOT, 'logs', 'run', 'vllm.pid');
        fs.writeFileSync(pidFile, String(this.serverProcess.pid));

        // Handle stdout - write to log file
        this.serverProcess.stdout?.on('data', (data: Buffer) => {
          const msg = data.toString();
          logStream.write(`[stdout] ${msg}`);
          if (msg.includes('Uvicorn running')) {
            console.log(`${LOG_PREFIX} Server started successfully`);
          }
        });

        // Handle stderr - vLLM logs to stderr by default
        this.serverProcess.stderr?.on('data', (data: Buffer) => {
          const msg = data.toString().trim();
          if (!msg) return;

          // Always write to log file
          logStream.write(`${msg}\n`);

          // HuggingFace download progress
          if (msg.includes('Downloading') || msg.includes('downloading')) {
            console.log(`${LOG_PREFIX} 📥`, msg);
          } else if (msg.includes('%|') || msg.includes('B/s')) {
            // Progress bar or speed indicator
            process.stdout.write(`\r${LOG_PREFIX} ${msg}`);
          } else if (msg.includes('Fetching') || msg.includes('Loading')) {
            console.log(`${LOG_PREFIX} 📦`, msg);
          } else if (msg.includes('error') || msg.includes('Error') || msg.includes('ERROR') || msg.includes('CUDA') || msg.includes('OOM') || msg.includes('OutOfMemory')) {
            console.error(`${LOG_PREFIX} ❌`, msg);
          } else if (msg.includes('INFO') || msg.includes('Uvicorn')) {
            console.log(`${LOG_PREFIX}`, msg);
          }
          // Other messages are written to log but not console
        });

        // Handle exit
        this.serverProcess.on('exit', (code) => {
          console.log(`${LOG_PREFIX} Server exited with code ${code}`);
          logStream.write(`\n=== Server exited with code ${code} at ${new Date().toISOString()} ===\n`);
          logStream.end();
          this.serverProcess = null;
          this.currentModel = null;
          // Clean up PID file
          try { fs.unlinkSync(pidFile); } catch { }
        });

        // Wait for server to be ready
        const startupProcess = this.serverProcess;
        this.waitForReady(config.endpoint, startupTimeoutMs, startupProcess)
          .then(() => {
            audit({
              level: 'info',
              category: 'system',
              event: 'vllm_started',
              actor: 'system',
              details: { model: servedModelName, pid: this.serverProcess?.pid },
            });

            // Publish server started event to event bus
            eventBus.emit('vllm', EventTypes.VLLM_SERVER_STARTED, {
              model: servedModelName,
              pid: this.serverProcess?.pid,
              gpuMemoryUtilization: effectiveUtilization,
              maxModelLen: config.maxModelLen,
              loraModules: loraModules?.map(l => l.name),
            });

            resolve({ pid: this.serverProcess?.pid || 0, success: true });
          })
          .catch(async (error) => {
            await this.stopServer();
            resolve({ pid: 0, success: false, error: error.message });
          });

      } catch (error) {
        resolve({
          pid: 0,
          success: false,
          error: error instanceof Error ? error.message : 'Failed to start vLLM',
        });
      }
    });
  }

  /**
   * Stop vLLM server
   */
  async stopServer(): Promise<void> {
    console.log(`${LOG_PREFIX} ========== stopServer HIT ==========`);
    console.log(`${LOG_PREFIX} Stopping server...`);

    // Try to kill our managed process
    if (this.serverProcess) {
      this.serverProcess.kill('SIGTERM');
      this.serverProcess = null;
      this.currentModel = null;
    }

    // Also check for PID file (for processes started in previous sessions)
    const pidFile = path.join(ROOT, 'logs', 'run', 'vllm.pid');
    if (fs.existsSync(pidFile)) {
      try {
        const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim());
        process.kill(pid, 'SIGTERM');
      } catch {
        // Process may not exist
      }
      try { fs.unlinkSync(pidFile); } catch { }
    }

    // Kill ALL vLLM-related processes (they spawn subprocesses)
    try {
      execSync('pkill -f "vllm.entrypoints"', { stdio: 'ignore' });
    } catch { /* No processes found */ }

    // Wait a moment for graceful shutdown
    await new Promise(r => setTimeout(r, 2000));

    // Force kill any remaining vLLM processes
    try {
      execSync('pkill -9 -f "vllm.entrypoints"', { stdio: 'ignore' });
      execSync('pkill -9 -f "VLLM::EngineCore"', { stdio: 'ignore' });
    } catch { /* No processes found */ }

    // Give GPU time to release memory
    await new Promise(r => setTimeout(r, 1000));

    audit({
      level: 'info',
      category: 'system',
      event: 'vllm_stopped',
      actor: 'system',
    });

    // Publish server stopped event to event bus
    eventBus.emit('vllm', EventTypes.VLLM_SERVER_STOPPED, {});

    console.log(`${LOG_PREFIX} Server stopped`);
  }

  /**
   * Wait for server to become ready
   */
  private async waitForReady(endpoint: string, timeoutMs: number, startupProcess?: ChildProcess | null): Promise<void> {
    const normalizedEndpoint = endpoint.replace(/\/$/, '');
    const start = Date.now();
    let lastError: unknown = null;
    let lastStatus: { health?: number; models?: number } = {};
    let lastLogAt = 0;

    while (Date.now() - start < timeoutMs) {
      // If process died during startup, fail fast with actionable context.
      const observedProcess = startupProcess || this.serverProcess;
      if (observedProcess?.exitCode !== null && observedProcess?.exitCode !== undefined) {
        throw new Error(
          `vLLM process exited during startup (code ${observedProcess.exitCode}). Check logs/run/vllm-server.log`
        );
      }
      if (observedProcess?.signalCode) {
        throw new Error(
          `vLLM process exited during startup (signal ${observedProcess.signalCode}). Check logs/run/vllm-server.log`
        );
      }

      try {
        const health = await fetch(`${normalizedEndpoint}/health`, {
          signal: AbortSignal.timeout(2000),
        });
        lastStatus.health = health.status;

        if (health.ok) {
          return;
        }

        const models = await fetch(`${normalizedEndpoint}/v1/models`, {
          signal: AbortSignal.timeout(2000),
        });
        lastStatus.models = models.status;

        if (models.ok) {
          return;
        }

        lastError = new Error(`health=${health.status}, models=${models.status}`);
      } catch (error) {
        // Not ready yet - expected during startup.
        lastError = error;
      }

      const now = Date.now();
      if (now - lastLogAt >= 10000) {
        const elapsedSec = Math.floor((now - start) / 1000);
        const timeoutSec = Math.floor(timeoutMs / 1000);
        let reason = 'starting';

        if (lastError instanceof Error) {
          reason = lastError.message;
          const cause = (lastError as Error & {
            cause?: { code?: string; address?: string; port?: number };
          }).cause;
          if (cause?.code && cause?.address && cause?.port) {
            reason = `${cause.code} ${cause.address}:${cause.port}`;
          }
        } else if (lastStatus.health || lastStatus.models) {
          reason = `health=${lastStatus.health ?? 'n/a'}, models=${lastStatus.models ?? 'n/a'}`;
        }

        console.log(`${LOG_PREFIX} Waiting for server (${elapsedSec}s/${timeoutSec}s): ${reason}`);
        lastLogAt = now;
      }

      await new Promise(r => setTimeout(r, 2000));
    }

    const timeoutSec = Math.floor(timeoutMs / 1000);
    let detail = 'unknown startup error';
    if (lastError instanceof Error) {
      detail = lastError.message;
      const cause = (lastError as Error & {
        cause?: { code?: string; address?: string; port?: number };
      }).cause;
      if (cause?.code && cause?.address && cause?.port) {
        detail = `${cause.code} ${cause.address}:${cause.port}`;
      }
    } else if (lastStatus.health || lastStatus.models) {
      detail = `health=${lastStatus.health ?? 'n/a'}, models=${lastStatus.models ?? 'n/a'}`;
    }

    throw new Error(
      `vLLM server failed to start within ${timeoutSec}s (${detail}). Check logs/run/vllm-server.log`
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Model Operations
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * List available models (from /v1/models)
   */
  async listModels(): Promise<VLLMModel[]> {
    try {
      const response = await fetch(`${this.endpoint}/v1/models`, {
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        return [];
      }

      const data = await response.json() as { data: VLLMModel[] };
      return data.data || [];
    } catch (error) {
      console.warn(`${LOG_PREFIX} Failed to list models:`, error);
      return [];
    }
  }

  /**
   * Get list of loaded LoRA adapters
   *
   * vLLM returns the base model plus all loaded LoRAs in /v1/models.
   * We filter out the base model to get just the LoRA names.
   */
  async getLoadedLoras(): Promise<string[]> {
    try {
      const models = await this.listModels();
      // The base model is typically the first entry, LoRAs are additional entries
      // LoRA names are the ones we specified in --lora-modules
      if (models.length <= 1) {
        return [];  // Only base model, no LoRAs
      }
      // Skip the first (base model) and return the rest as LoRA names
      return models.slice(1).map(m => m.id);
    } catch (error) {
      console.warn(`${LOG_PREFIX} Failed to get loaded LoRAs:`, error);
      return [];
    }
  }

  /**
   * Switch to a different model (requires server restart)
   */
  async switchModel(model: string, config?: Partial<VLLMConfig>): Promise<{ success: boolean; error?: string }> {
    const fullConfig: VLLMConfig = {
      ...config,
      endpoint: this.endpoint,
      model,
      gpuMemoryUtilization: config?.gpuMemoryUtilization ?? 0.9,
    };

    console.log(`${LOG_PREFIX} Switching to model: ${model}`);
    await this.stopServer();
    const result = await this.startServer(fullConfig);
    return { success: result.success, error: result.error };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Inference
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Chat completion (OpenAI-compatible)
   */
  async chat(
    messages: VLLMChatMessage[],
    options?: VLLMChatOptions
  ): Promise<VLLMChatResponse> {
    const requestId = generateRequestId();
    const startTime = Date.now();
    const modelName = options?.model || this.currentModel || 'default';

    console.log(`${LOG_PREFIX} ========== chat HIT ==========`);
    console.log(`${LOG_PREFIX} Input: messages=${messages.length}, model=${options?.model}, maxTokens=${options?.maxTokens}`);

    // Publish chat started event
    eventBus.emit('vllm', EventTypes.VLLM_CHAT_STARTED, {
      model: modelName,
      messageCount: messages.length,
      temperature: options?.temperature ?? 0.7,
      maxTokens: options?.maxTokens ?? 2048,
      enableThinking: options?.enableThinking,
    }, { requestId });

    const body = buildVLLMChatRequest(messages, options, this.currentModel);

    // 2 minute timeout for LLM generation (large models can take time)
    const response = await fetch(`${this.endpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      const error = `vLLM request failed (${response.status}): ${errorText}`;

      // Publish chat failed event
      eventBus.emit('vllm', EventTypes.VLLM_CHAT_FAILED, {
        model: modelName,
        error,
      }, { requestId, level: 'error', durationMs: Date.now() - startTime });

      throw new Error(error);
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>;
      model: string;
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };

    // Publish chat completed event
    eventBus.emit('vllm', EventTypes.VLLM_CHAT_COMPLETED, {
      model: data.model,
      responseLength: data.choices[0]?.message?.content?.length || 0,
      promptTokens: data.usage?.prompt_tokens,
      completionTokens: data.usage?.completion_tokens,
      totalTokens: data.usage?.total_tokens,
    }, { requestId, durationMs: Date.now() - startTime });

    return {
      content: data.choices[0]?.message?.content || '',
      model: data.model,
      usage: data.usage,
    };
  }

  /**
   * Streaming chat completion
   */
  async chatStream(
    messages: VLLMChatMessage[],
    onToken: (token: string) => void,
    options?: {
      model?: string;
      temperature?: number;
      maxTokens?: number;
      /** Control Qwen3 thinking mode. Set false to disable <think> tags. */
      enableThinking?: boolean;
      /** Penalize tokens based on frequency (0.0-2.0, higher = less repetition) */
      frequencyPenalty?: number;
      /** Penalize tokens that have appeared at all (0.0-2.0, higher = more variety) */
      presencePenalty?: number;
      /** Repetition penalty (1.0 = no penalty, >1.0 = less repetition) */
      repetitionPenalty?: number;
    }
  ): Promise<void> {
    const body: Record<string, unknown> = {
      model: options?.model || this.currentModel || 'default',
      messages: buildVLLMChatMessages(messages),
      max_tokens: options?.maxTokens ?? 2048,
      temperature: options?.temperature ?? 0.7,
      stream: true,
    };

    // Add repetition control parameters
    if (options?.frequencyPenalty !== undefined) {
      body.frequency_penalty = options.frequencyPenalty;
    }
    if (options?.presencePenalty !== undefined) {
      body.presence_penalty = options.presencePenalty;
    }
    if (options?.repetitionPenalty !== undefined) {
      body.repetition_penalty = options.repetitionPenalty;
    }

    // Add chat_template_kwargs for Qwen3 thinking mode control
    if (options?.enableThinking !== undefined) {
      body.chat_template_kwargs = { enable_thinking: options.enableThinking };
    }

    // 5 minute timeout for streaming (longer since stream can take a while)
    const response = await fetch(`${this.endpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(300000),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`vLLM stream request failed (${response.status}): ${errorText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') break;

          try {
            const parsed = JSON.parse(data) as {
              choices: Array<{ delta: { content?: string } }>;
            };
            const content = parsed.choices[0]?.delta?.content;
            if (content) {
              onToken(content);
            }
          } catch (error) {
            // Skip invalid JSON - this is normal during streaming
            console.debug(`${LOG_PREFIX} Skipping invalid JSON in stream:`, error);
          }
        }
      }
    }
  }

  /**
   * Text embeddings (if model supports)
   */
  async embeddings(text: string, model?: string): Promise<number[]> {
    // 30 second timeout for embeddings
    const response = await fetch(`${this.endpoint}/v1/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model || this.currentModel || 'default',
        input: text,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      throw new Error(`vLLM embeddings failed: ${response.status}`);
    }

    const data = await response.json() as {
      data: Array<{ embedding: number[] }>;
    };

    return data.data[0]?.embedding || [];
  }

  /**
   * Simple text generation (non-chat)
   */
  async generate(
    prompt: string,
    options?: {
      maxTokens?: number;
      temperature?: number;
    }
  ): Promise<string> {
    // 2 minute timeout for generation
    const response = await fetch(`${this.endpoint}/v1/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.currentModel || 'default',
        prompt,
        max_tokens: options?.maxTokens ?? 256,
        temperature: options?.temperature ?? 0.7,
      }),
      signal: AbortSignal.timeout(120000),
    });

    if (!response.ok) {
      throw new Error(`vLLM generate failed: ${response.status}`);
    }

    const data = await response.json() as {
      choices: Array<{ text: string }>;
    };

    return data.choices[0]?.text || '';
  }
}

// ============================================================================
// Singleton & Helpers
// ============================================================================

/** Singleton vLLM client instance */
export const vllm = new VLLMClient();

/**
 * Check if vLLM is running
 */
export async function isVLLMRunning(): Promise<boolean> {
  return vllm.isRunning();
}

/**
 * Check vLLM health status
 */
export async function checkVLLMHealth(): Promise<VLLMHealth> {
  return vllm.getHealth();
}

/**
 * Clean up zombie vLLM processes
 */
export async function cleanupVLLMProcesses(): Promise<void> {
  return vllm.cleanupZombieProcesses();
}

/**
 * Check GPU memory availability for vLLM
 */
export async function checkVLLMGPUMemory(utilizationTarget = 0.8): Promise<{
  available: boolean;
  freeGB: number;
  totalGB: number;
  requiredGB: number;
}> {
  return vllm.checkGPUMemory(utilizationTarget);
}

/**
 * Calculate optimal GPU utilization based on available memory
 */
export async function calculateOptimalVLLMUtilization(
  headroomGB = 1.5,
  maxUtilization = 0.95,
): Promise<VLLMMemoryPlan> {
  return vllm.calculateOptimalUtilization(headroomGB, maxUtilization);
}

/**
 * Get list of currently loaded LoRA adapters from vLLM
 */
export async function getVLLMLoadedLoras(): Promise<string[]> {
  return vllm.getLoadedLoras();
}
