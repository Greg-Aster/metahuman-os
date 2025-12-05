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

import { spawn, execSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './path-builder.js';
import { audit } from './audit.js';

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
  /** GPU memory utilization (0.0-1.0, default: 0.9). Set to 0 or 'auto' for dynamic detection. */
  gpuMemoryUtilization: number;
  /** Maximum model context length */
  maxModelLen?: number;
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
  content: string;
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
    } catch {
      // Try the models endpoint as fallback (some vLLM versions)
      try {
        const response = await fetch(`${this.endpoint}/v1/models`, {
          method: 'GET',
          signal: AbortSignal.timeout(3000),
        });
        return response.ok;
      } catch {
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
    } catch {
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
      } catch {
        try { fs.unlinkSync(pidFile); } catch { }
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
      console.warn('[vllm] Could not check GPU memory, proceeding anyway');
      return { available: true, freeGB: 0, totalGB: 0, requiredGB: 0 };
    }
  }

  /**
   * Calculate optimal GPU memory utilization based on available memory
   * Returns a utilization value (0.0-1.0) that leaves headroom for other processes
   */
  async calculateOptimalUtilization(modelSizeHint?: number): Promise<{
    utilization: number;
    freeGB: number;
    totalGB: number;
    recommendation: string;
  }> {
    try {
      const output = execSync(
        'nvidia-smi --query-gpu=memory.free,memory.total,memory.used --format=csv,noheader,nounits',
        { encoding: 'utf-8' }
      ).trim();

      const [freeStr, totalStr, usedStr] = output.split(',').map(s => s.trim());
      const freeMB = parseInt(freeStr);
      const totalMB = parseInt(totalStr);
      const usedMB = parseInt(usedStr);

      const freeGB = freeMB / 1024;
      const totalGB = totalMB / 1024;
      const usedGB = usedMB / 1024;

      // Reserve 1GB for system/other apps + headroom for CUDA graphs/eager mode
      const reserveGB = 1.5;
      const availableForVLLM = Math.max(0, freeGB - reserveGB);

      // Calculate utilization as percentage of TOTAL GPU
      // (vLLM's --gpu-memory-utilization is based on total, not free)
      const utilization = Math.min(0.95, availableForVLLM / totalGB);

      let recommendation: string;
      if (usedGB > 1) {
        recommendation = `Other processes using ${usedGB.toFixed(1)}GB. Capped utilization to ${(utilization * 100).toFixed(0)}%`;
      } else if (utilization < 0.5) {
        recommendation = `Low available memory (${freeGB.toFixed(1)}GB free). Consider closing other GPU apps.`;
      } else {
        recommendation = `Optimal: ${(utilization * 100).toFixed(0)}% of ${totalGB.toFixed(1)}GB GPU`;
      }

      return { utilization, freeGB, totalGB, recommendation };
    } catch (error) {
      // Fallback to conservative default
      return {
        utilization: 0.7,
        freeGB: 0,
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
    // STEP 1: Clean up any zombie vLLM processes first
    console.log('[vllm] Cleaning up any existing processes...');
    await this.cleanupZombieProcesses();

    // STEP 2: Check if already running with same model
    if (await this.isRunning()) {
      const loadedModel = await this.getLoadedModel();
      if (loadedModel === config.model) {
        console.log('[vllm] Server already running with requested model');
        return { pid: this.serverProcess?.pid || 0, success: true };
      }
      // Different model - need to stop first
      console.log('[vllm] Stopping existing server (different model)...');
      await this.stopServer();
    }

    // STEP 2.5: Auto-detect optimal GPU utilization if enabled
    let effectiveUtilization = config.gpuMemoryUtilization || 0.9;
    if (config.autoUtilization) {
      const optimal = await this.calculateOptimalUtilization();
      effectiveUtilization = optimal.utilization;
      console.log(`[vllm] Auto-utilization: ${optimal.recommendation}`);
      console.log(`[vllm] Using ${(effectiveUtilization * 100).toFixed(0)}% GPU memory (${optimal.freeGB.toFixed(1)}GB free of ${optimal.totalGB.toFixed(1)}GB)`);
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
      console.log(`[vllm] GPU memory check passed: ${gpuCheck.freeGB.toFixed(1)}GB free of ${gpuCheck.totalGB.toFixed(1)}GB`);
    }

    // Build command arguments
    const args = [
      '-m', 'vllm.entrypoints.openai.api_server',
      '--model', config.model,
      '--host', '0.0.0.0',
      '--port', new URL(config.endpoint).port || '8000',
      '--gpu-memory-utilization', String(effectiveUtilization),
    ];

    if (config.maxModelLen) {
      args.push('--max-model-len', String(config.maxModelLen));
    }

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
      console.log('[vllm] Eager mode enabled (CUDA graphs disabled for memory stability)');
    }

    // Spawn vLLM server process
    return new Promise((resolve) => {
      try {
        const pythonPath = getVLLMPython();
        console.log(`[vllm] Starting server with model: ${config.model}`);
        console.log(`[vllm] Config: maxModelLen=${config.maxModelLen}, enforceEager=${config.enforceEager}, gpuUtil=${effectiveUtilization}`);
        console.log(`[vllm] Full args: ${args.join(' ')}`);
        console.log(`[vllm] Using Python: ${pythonPath}`);

        // Set up log file
        const logDir = path.join(ROOT, 'logs', 'run');
        fs.mkdirSync(logDir, { recursive: true });
        const logFile = path.join(logDir, 'vllm-server.log');
        const logStream = fs.createWriteStream(logFile, { flags: 'w' });
        logStream.write(`=== vLLM Server Log - ${new Date().toISOString()} ===\n`);
        logStream.write(`Model: ${config.model}\n`);
        logStream.write(`Python: ${pythonPath}\n`);
        logStream.write(`Args: ${args.join(' ')}\n`);
        logStream.write(`=== Output ===\n\n`);

        this.serverProcess = spawn(pythonPath, args, {
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: true,
        });

        this.currentModel = config.model;

        // Save PID for later management
        const pidFile = path.join(ROOT, 'logs', 'run', 'vllm.pid');
        fs.writeFileSync(pidFile, String(this.serverProcess.pid));

        // Handle stdout - write to log file
        this.serverProcess.stdout?.on('data', (data: Buffer) => {
          const msg = data.toString();
          logStream.write(`[stdout] ${msg}`);
          if (msg.includes('Uvicorn running')) {
            console.log('[vllm] Server started successfully');
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
            console.log('[vllm] 📥', msg);
          } else if (msg.includes('%|') || msg.includes('B/s')) {
            // Progress bar or speed indicator
            process.stdout.write(`\r[vllm] ${msg}`);
          } else if (msg.includes('Fetching') || msg.includes('Loading')) {
            console.log('[vllm] 📦', msg);
          } else if (msg.includes('error') || msg.includes('Error') || msg.includes('ERROR') || msg.includes('CUDA') || msg.includes('OOM') || msg.includes('OutOfMemory')) {
            console.error('[vllm] ❌', msg);
          } else if (msg.includes('INFO') || msg.includes('Uvicorn')) {
            console.log('[vllm]', msg);
          }
          // Other messages are written to log but not console
        });

        // Handle exit
        this.serverProcess.on('exit', (code) => {
          console.log(`[vllm] Server exited with code ${code}`);
          logStream.write(`\n=== Server exited with code ${code} at ${new Date().toISOString()} ===\n`);
          logStream.end();
          this.serverProcess = null;
          this.currentModel = null;
          // Clean up PID file
          try { fs.unlinkSync(pidFile); } catch { }
        });

        // Wait for server to be ready
        this.waitForReady(config.endpoint, 120000)
          .then(() => {
            audit({
              level: 'info',
              category: 'system',
              event: 'vllm_started',
              actor: 'system',
              details: { model: config.model, pid: this.serverProcess?.pid },
            });
            resolve({ pid: this.serverProcess?.pid || 0, success: true });
          })
          .catch((error) => {
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
    console.log('[vllm] Stopping server...');

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

    console.log('[vllm] Server stopped');
  }

  /**
   * Wait for server to become ready
   */
  private async waitForReady(endpoint: string, timeoutMs: number): Promise<void> {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      try {
        const response = await fetch(`${endpoint}/v1/models`, {
          signal: AbortSignal.timeout(2000),
        });
        if (response.ok) {
          return;
        }
      } catch {
        // Not ready yet
      }
      await new Promise(r => setTimeout(r, 2000));
    }

    throw new Error('vLLM server failed to start within timeout');
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
    } catch {
      return [];
    }
  }

  /**
   * Switch to a different model (requires server restart)
   */
  async switchModel(model: string, config?: Partial<VLLMConfig>): Promise<{ success: boolean; error?: string }> {
    const fullConfig: VLLMConfig = {
      endpoint: this.endpoint,
      model,
      gpuMemoryUtilization: config?.gpuMemoryUtilization || 0.9,
      maxModelLen: config?.maxModelLen,
      tensorParallelSize: config?.tensorParallelSize,
      dtype: config?.dtype,
      quantization: config?.quantization,
    };

    console.log(`[vllm] Switching to model: ${model}`);
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
    options?: {
      model?: string;
      temperature?: number;
      maxTokens?: number;
      topP?: number;
      stream?: boolean;
    }
  ): Promise<VLLMChatResponse> {
    const response = await fetch(`${this.endpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: options?.model || this.currentModel || 'default',
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        max_tokens: options?.maxTokens ?? 2048,
        temperature: options?.temperature ?? 0.7,
        top_p: options?.topP ?? 0.95,
        stream: false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`vLLM request failed (${response.status}): ${errorText}`);
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>;
      model: string;
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };

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
    }
  ): Promise<void> {
    const response = await fetch(`${this.endpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: options?.model || this.currentModel || 'default',
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        max_tokens: options?.maxTokens ?? 2048,
        temperature: options?.temperature ?? 0.7,
        stream: true,
      }),
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
          } catch {
            // Skip invalid JSON
          }
        }
      }
    }
  }

  /**
   * Text embeddings (if model supports)
   */
  async embeddings(text: string, model?: string): Promise<number[]> {
    const response = await fetch(`${this.endpoint}/v1/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model || this.currentModel || 'default',
        input: text,
      }),
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
    const response = await fetch(`${this.endpoint}/v1/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.currentModel || 'default',
        prompt,
        max_tokens: options?.maxTokens ?? 256,
        temperature: options?.temperature ?? 0.7,
      }),
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
export async function calculateOptimalVLLMUtilization(): Promise<{
  utilization: number;
  freeGB: number;
  totalGB: number;
  recommendation: string;
}> {
  return vllm.calculateOptimalUtilization();
}
