/**
 * LLM Backend Manager
 *
 * Manages switching between local LLM backends (Ollama and vLLM).
 * This is SEPARATE from server providers (RunPod, HuggingFace) which are
 * managed by packages/server/provider-bridge.ts.
 *
 * Local backends: Run on the user's machine, toggled in Settings UI
 * Server providers: Cloud services for deployment, controlled by etc/deployment.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './path-builder.js';
import { audit } from './audit.js';
import { ollama, isRunning as isOllamaRunning, stopOllamaService, startOllamaService } from './ollama.js';
import { vllm, isVLLMRunning } from './vllm.js';

/**
 * Get the Python executable path for vLLM venv
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

/**
 * Backend types:
 * - 'ollama' | 'vllm': Local LLM backends (require GPU)
 * - 'remote': Cloud provider (RunPod, Claude, OpenRouter, OpenAI)
 * - 'auto': Intelligent selection - prefer local if available, fallback to remote
 */
export type BackendType = 'ollama' | 'vllm' | 'remote' | 'auto';

/** Local backend type (for when using 'auto' or 'remote' with local fallback) */
export type LocalBackendType = 'ollama' | 'vllm';

/** Remote provider types supported */
export type RemoteProviderType = 'claude' | 'runpod' | 'openrouter' | 'openai' | 'server';

export interface OllamaBackendConfig {
  endpoint: string;
  autoStart: boolean;
  defaultModel: string;
}

export interface VLLMBackendConfig {
  endpoint: string;
  autoStart: boolean;
  model: string;
  gpuMemoryUtilization: number;
  maxModelLen?: number;
  tensorParallelSize?: number;
  dtype?: string;
  quantization?: string | null;
  /** Disable CUDA graphs to save GPU memory (trades performance for stability) */
  enforceEager?: boolean;
  /** Auto-detect optimal GPU utilization based on available memory */
  autoUtilization?: boolean;
  /** Enable thinking mode for Qwen3 models (default: true, set false to disable <think> tags) */
  enableThinking?: boolean;
}

export interface RemoteBackendConfig {
  /** Active remote provider */
  provider: RemoteProviderType;
  /** Remote server URL (for 'server' provider - e.g., Cloudflare tunnel to desktop) */
  serverUrl?: string;
  /** Default model for remote provider */
  model?: string;
}

export interface BackendConfig {
  activeBackend: BackendType;
  /** Preferred local backend when using 'auto' mode */
  preferredLocalBackend?: LocalBackendType;
  ollama: OllamaBackendConfig;
  vllm: VLLMBackendConfig;
  /** Remote/cloud provider configuration */
  remote?: RemoteBackendConfig;
}

export interface BackendStatus {
  /** Configured backend type */
  backend: BackendType;
  /** Actual active backend (resolved from 'auto') */
  resolvedBackend: 'ollama' | 'vllm' | 'remote' | 'offline';
  /** Remote provider if using remote */
  remoteProvider?: RemoteProviderType;
  running: boolean;
  model?: string;
  endpoint?: string;
  health: 'healthy' | 'starting' | 'degraded' | 'offline';
  /** Why this backend was selected (for 'auto' mode) */
  reason?: string;
}

export interface AvailableBackends {
  ollama: { installed: boolean; running: boolean; model?: string };
  vllm: { installed: boolean; running: boolean; model?: string };
  remote: { configured: boolean; provider?: RemoteProviderType; hasCredentials: boolean };
}

// ============================================================================
// Configuration
// ============================================================================

const CONFIG_PATH = path.join(ROOT, 'etc', 'llm-backend.json');

let cachedConfig: BackendConfig | null = null;
let cacheTime = 0;
const CACHE_TTL = 5000; // 5 seconds

/**
 * Load backend configuration
 */
export function loadBackendConfig(forceFresh = false): BackendConfig {
  const now = Date.now();

  if (!forceFresh && cachedConfig && now - cacheTime < CACHE_TTL) {
    return cachedConfig;
  }

  const defaultConfig: BackendConfig = {
    activeBackend: 'ollama',
    ollama: {
      endpoint: 'http://localhost:11434',
      autoStart: false,
      defaultModel: 'qwen3:14b',
    },
    vllm: {
      endpoint: 'http://localhost:8000',
      autoStart: false,
      model: 'Qwen/Qwen2.5-14B-Instruct',
      gpuMemoryUtilization: 0.7,
      maxModelLen: 4096,
      tensorParallelSize: 1,
      dtype: 'auto',
      quantization: null,
      enforceEager: true, // Disable CUDA graphs to save GPU memory (recommended for 16GB GPUs)
      autoUtilization: false, // Set true to auto-detect optimal GPU allocation
    },
  };

  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      // Deep merge to ensure all default fields are present
      cachedConfig = {
        ...defaultConfig,
        ...parsed,
        ollama: { ...defaultConfig.ollama, ...parsed.ollama },
        vllm: { ...defaultConfig.vllm, ...parsed.vllm },
      };
    } else {
      cachedConfig = defaultConfig;
    }
  } catch (error) {
    console.error('[llm-backend] Error loading config:', error);
    cachedConfig = defaultConfig;
  }

  cacheTime = now;
  return cachedConfig!;
}

/**
 * Save backend configuration
 */
export function saveBackendConfig(updates: Partial<BackendConfig>): void {
  const config = loadBackendConfig(true);
  const newConfig = { ...config, ...updates };

  // Merge nested objects
  if (updates.ollama) {
    newConfig.ollama = { ...config.ollama, ...updates.ollama };
  }
  if (updates.vllm) {
    newConfig.vllm = { ...config.vllm, ...updates.vllm };
  }
  if (updates.remote) {
    newConfig.remote = { ...config.remote, ...updates.remote };
  }

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(newConfig, null, 2));
  cachedConfig = newConfig;
  cacheTime = Date.now();
}

/**
 * Get the currently active backend type
 */
export function getActiveBackend(): BackendType {
  return loadBackendConfig().activeBackend;
}

// ============================================================================
// Status & Detection
// ============================================================================

/**
 * Get status of the active backend
 */
export async function getBackendStatus(): Promise<BackendStatus> {
  const config = loadBackendConfig();
  const backend = config.activeBackend;

  // Handle 'auto' mode - resolve to actual backend
  if (backend === 'auto') {
    return resolveAutoBackend(config);
  }

  // Handle 'remote' mode
  if (backend === 'remote') {
    const remoteConfig = config.remote;
    return {
      backend: 'remote',
      resolvedBackend: 'remote',
      remoteProvider: remoteConfig?.provider,
      running: true, // Remote is always "running" if configured
      model: remoteConfig?.model,
      endpoint: remoteConfig?.serverUrl,
      health: remoteConfig?.provider ? 'healthy' : 'offline',
      reason: 'Configured for remote provider',
    };
  }

  if (backend === 'ollama') {
    const running = await isOllamaRunning();
    let model: string | undefined;

    if (running) {
      try {
        const result = await ollama.getRunningModels();
        model = result.models[0]?.name;
      } catch { }
    }

    return {
      backend: 'ollama',
      // If not running, resolve to 'offline' so UI shows correct status
      resolvedBackend: running ? 'ollama' : 'offline',
      running,
      model,
      endpoint: config.ollama.endpoint,
      health: running ? 'healthy' : 'offline',
      // Provide helpful reason when backend is unavailable
      reason: running ? undefined : 'Ollama server is not running. Configure a different LLM backend in Settings.',
    };
  }

  // vLLM
  const running = await isVLLMRunning();
  let model: string | undefined;

  if (running) {
    model = await vllm.getLoadedModel() || undefined;
  }

  return {
    backend: 'vllm',
    // If not running, resolve to 'offline' so UI shows correct status
    resolvedBackend: running ? 'vllm' : 'offline',
    running,
    model,
    endpoint: config.vllm.endpoint,
    health: running ? 'healthy' : 'offline',
    // Provide helpful reason when backend is unavailable
    reason: running ? undefined : 'vLLM server is not running. Configure a different LLM backend in Settings.',
  };
}

/**
 * Resolve 'auto' backend to actual backend based on availability
 *
 * Priority:
 * 1. Preferred local backend if running
 * 2. Any local backend if running
 * 3. Remote provider if configured
 * 4. Offline
 */
async function resolveAutoBackend(config: BackendConfig): Promise<BackendStatus> {
  const preferredLocal = config.preferredLocalBackend || 'ollama';

  // Check preferred local backend first
  if (preferredLocal === 'vllm') {
    const vllmRunning = await isVLLMRunning();
    if (vllmRunning) {
      const model = await vllm.getLoadedModel() || undefined;
      return {
        backend: 'auto',
        resolvedBackend: 'vllm',
        running: true,
        model,
        endpoint: config.vllm.endpoint,
        health: 'healthy',
        reason: 'vLLM is running (preferred local backend)',
      };
    }
  } else {
    const ollamaRunning = await isOllamaRunning();
    if (ollamaRunning) {
      let model: string | undefined;
      try {
        const result = await ollama.getRunningModels();
        model = result.models[0]?.name;
      } catch { }
      return {
        backend: 'auto',
        resolvedBackend: 'ollama',
        running: true,
        model,
        endpoint: config.ollama.endpoint,
        health: 'healthy',
        reason: 'Ollama is running (preferred local backend)',
      };
    }
  }

  // Check alternate local backend
  if (preferredLocal === 'ollama') {
    const vllmRunning = await isVLLMRunning();
    if (vllmRunning) {
      const model = await vllm.getLoadedModel() || undefined;
      return {
        backend: 'auto',
        resolvedBackend: 'vllm',
        running: true,
        model,
        endpoint: config.vllm.endpoint,
        health: 'healthy',
        reason: 'vLLM is running (fallback local backend)',
      };
    }
  } else {
    const ollamaRunning = await isOllamaRunning();
    if (ollamaRunning) {
      let model: string | undefined;
      try {
        const result = await ollama.getRunningModels();
        model = result.models[0]?.name;
      } catch { }
      return {
        backend: 'auto',
        resolvedBackend: 'ollama',
        running: true,
        model,
        endpoint: config.ollama.endpoint,
        health: 'healthy',
        reason: 'Ollama is running (fallback local backend)',
      };
    }
  }

  // No local backend available - check remote
  if (config.remote?.provider) {
    return {
      backend: 'auto',
      resolvedBackend: 'remote',
      remoteProvider: config.remote.provider,
      running: true,
      model: config.remote.model,
      endpoint: config.remote.serverUrl,
      health: 'healthy',
      reason: `No local LLM available, using remote (${config.remote.provider})`,
    };
  }

  // Nothing available
  return {
    backend: 'auto',
    resolvedBackend: 'offline',
    running: false,
    health: 'offline',
    reason: 'No local LLM running and no remote provider configured',
  };
}

/**
 * Detect which backends are available on this system
 */
export async function detectAvailableBackends(): Promise<AvailableBackends> {
  const config = loadBackendConfig();

  const [ollamaRunning, vllmRunning] = await Promise.all([
    isOllamaRunning(),
    isVLLMRunning(),
  ]);

  // Check if Ollama is installed (by checking if it's running or if ollama command exists)
  let ollamaInstalled = ollamaRunning;
  if (!ollamaInstalled) {
    try {
      const { execSync } = await import('node:child_process');
      execSync('which ollama', { stdio: 'ignore' });
      ollamaInstalled = true;
    } catch {
      ollamaInstalled = false;
    }
  }

  // Check if vLLM is installed (by checking if venv python can import vllm)
  let vllmInstalled = vllmRunning;
  if (!vllmInstalled) {
    try {
      const { execSync } = await import('node:child_process');
      const pythonPath = getVLLMPython();
      execSync(`${pythonPath} -c "import vllm"`, { stdio: 'ignore' });
      vllmInstalled = true;
    } catch {
      vllmInstalled = false;
    }
  }

  // Get loaded models if running
  let ollamaModel: string | undefined;
  let vllmModel: string | undefined;

  if (ollamaRunning) {
    try {
      const result = await ollama.getRunningModels();
      ollamaModel = result.models[0]?.name;
    } catch { }
  }

  if (vllmRunning) {
    vllmModel = await vllm.getLoadedModel() || undefined;
  }

  // Check remote configuration
  const remoteConfigured = !!config.remote?.provider;
  // TODO: Check if credentials exist for the remote provider
  const hasCredentials = remoteConfigured; // For now, assume configured = has credentials

  return {
    ollama: { installed: ollamaInstalled, running: ollamaRunning, model: ollamaModel },
    vllm: { installed: vllmInstalled, running: vllmRunning, model: vllmModel },
    remote: { configured: remoteConfigured, provider: config.remote?.provider, hasCredentials },
  };
}

// ============================================================================
// Backend Switching
// ============================================================================

/**
 * Switch to a different backend
 *
 * This will:
 * 1. Stop the currently running backend (optional, based on config)
 * 2. Start the new backend (if autoStart is enabled)
 * 3. Update the configuration
 */
export async function switchBackend(
  to: BackendType,
  options?: {
    stopCurrent?: boolean;
    startNew?: boolean;
    actor?: string;
  }
): Promise<{ success: boolean; error?: string }> {
  const config = loadBackendConfig();
  const from = config.activeBackend;

  if (from === to) {
    return { success: true };
  }

  console.log(`[llm-backend] Switching from ${from} to ${to}`);

  try {
    // Stop/unload current backend to free GPU memory
    if (options?.stopCurrent !== false) {
      if (from === 'vllm') {
        console.log('[llm-backend] Stopping vLLM...');
        await vllm.stopServer();
      } else if (from === 'ollama' && to === 'vllm') {
        // Stop the Ollama service completely to free GPU memory for vLLM
        console.log('[llm-backend] Stopping Ollama service to free GPU memory...');
        const stopResult = await stopOllamaService();
        if (stopResult.success) {
          console.log('[llm-backend] Ollama service stopped');
        } else {
          console.warn('[llm-backend] Failed to stop Ollama:', stopResult.error);
          // Fall back to unloading models
          console.log('[llm-backend] Attempting to unload models instead...');
          const unloadResult = await ollama.unloadAllModels();
          if (unloadResult.unloaded.length > 0) {
            console.log(`[llm-backend] Unloaded: ${unloadResult.unloaded.join(', ')}`);
          }
        }
        // Give GPU a moment to release memory
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    // Start new backend if requested
    if (options?.startNew !== false) {
      if (to === 'vllm') {
        console.log('[llm-backend] Starting vLLM...');
        const result = await vllm.startServer({
          endpoint: config.vllm.endpoint,
          model: config.vllm.model,
          gpuMemoryUtilization: config.vllm.gpuMemoryUtilization,
          maxModelLen: config.vllm.maxModelLen,
          tensorParallelSize: config.vllm.tensorParallelSize,
          dtype: config.vllm.dtype,
          quantization: config.vllm.quantization,
          enforceEager: config.vllm.enforceEager,
          autoUtilization: config.vllm.autoUtilization,
          enableThinking: config.vllm.enableThinking,
        });

        if (!result.success) {
          return { success: false, error: result.error };
        }
      } else if (to === 'ollama' && from === 'vllm') {
        // Restart Ollama service when switching back from vLLM
        console.log('[llm-backend] Starting Ollama service...');
        const result = await startOllamaService();
        if (!result.success) {
          console.warn('[llm-backend] Failed to start Ollama:', result.error);
          // Not fatal - user can start it manually
        }
      }
    }

    // Update configuration
    saveBackendConfig({ activeBackend: to });

    // Audit the switch
    audit({
      level: 'info',
      category: 'system',
      event: 'backend_switch',
      actor: options?.actor || 'system',
      details: { from, to },
    });

    console.log(`[llm-backend] Successfully switched to ${to}`);
    return { success: true };

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[llm-backend] Switch failed:`, message);
    return { success: false, error: message };
  }
}

/**
 * Auto-select the best available backend
 */
export async function autoSelectBackend(): Promise<BackendType> {
  const available = await detectAvailableBackends();

  // Prefer vLLM if it's already running (higher throughput)
  if (available.vllm.running) {
    return 'vllm';
  }

  // If Ollama is running, use it
  if (available.ollama.running) {
    return 'ollama';
  }

  // Neither running - check what's installed, prefer Ollama (simpler)
  if (available.ollama.installed) {
    return 'ollama';
  }

  if (available.vllm.installed) {
    return 'vllm';
  }

  // Default to Ollama
  return 'ollama';
}

/**
 * Ensure the active backend is running
 */
export async function ensureBackendRunning(): Promise<{ running: boolean; error?: string }> {
  const config = loadBackendConfig();
  const backend = config.activeBackend;

  if (backend === 'ollama') {
    const running = await isOllamaRunning();
    if (!running) {
      return {
        running: false,
        error: 'Ollama is not running. Start it with: ollama serve',
      };
    }
    return { running: true };
  }

  // vLLM
  const running = await isVLLMRunning();
  if (!running && config.vllm.autoStart) {
    const result = await vllm.startServer({
      endpoint: config.vllm.endpoint,
      model: config.vllm.model,
      gpuMemoryUtilization: config.vllm.gpuMemoryUtilization,
      maxModelLen: config.vllm.maxModelLen,
      tensorParallelSize: config.vllm.tensorParallelSize,
      dtype: config.vllm.dtype,
      quantization: config.vllm.quantization,
      enforceEager: config.vllm.enforceEager,
      autoUtilization: config.vllm.autoUtilization,
      enableThinking: config.vllm.enableThinking,
    });

    if (!result.success) {
      return { running: false, error: result.error };
    }
    return { running: true };
  }

  if (!running) {
    return {
      running: false,
      error: 'vLLM is not running. Start it with: mh vllm start',
    };
  }

  return { running: true };
}
