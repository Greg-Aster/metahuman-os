/**
 * Local Model Service Manager
 *
 * Handles lifecycle management (start/stop) for the local model service.
 * Used by both web server and mobile app to auto-start the service.
 */

import { spawn, type ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { systemPaths } from './path-builder.js';
import { isLocalModelServiceRunning } from './providers/local-models.js';
import { loadBackendConfig, type LocalModelsBackendConfig } from './llm-backend.js';

// Service process reference
let serviceProcess: ChildProcess | null = null;
let isStarting = false;

// Default configuration
const DEFAULT_PORT = 4324;
const DEFAULT_HOST = '127.0.0.1';
const STARTUP_TIMEOUT_MS = 30000;
const HEALTH_CHECK_INTERVAL_MS = 1000;

export interface LocalModelServiceOptions {
  port?: number;
  host?: string;
  modelsDir: string;
  configPath?: string;
  preloadEmbeddings?: boolean;
  preloadLLM?: boolean;
}

/**
 * Load local models configuration from llm-backend.json
 * (Consolidated - no longer uses separate local-models.json)
 */
export function loadLocalModelsConfig(): {
  enabled: boolean;
  endpoint: string;
  port: number;
  autoStart: boolean;
  downloadOnWifiOnly: boolean;
  embeddings: { model: string; preloadAtStartup: boolean };
  llm: { model: string; preloadAtStartup: boolean };
} {
  const backendConfig = loadBackendConfig();
  const localModels = backendConfig.localModels;

  // Extract port from endpoint URL
  const endpoint = localModels?.endpoint || `http://${DEFAULT_HOST}:${DEFAULT_PORT}`;
  let port = DEFAULT_PORT;
  try {
    const url = new URL(endpoint);
    port = parseInt(url.port, 10) || DEFAULT_PORT;
  } catch { }

  return {
    enabled: localModels?.enabled ?? true,
    endpoint,
    port,
    autoStart: localModels?.autoStart ?? false,
    downloadOnWifiOnly: localModels?.downloadOnWifiOnly ?? true,
    embeddings: localModels?.embeddings ?? { model: 'qwen3-embedding-0.6b', preloadAtStartup: true },
    llm: localModels?.llm ?? { model: 'qwen3-1.7b', preloadAtStartup: false }
  };
}

/**
 * Wait for the service to become healthy
 */
async function waitForService(endpoint: string, timeoutMs: number): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    if (await isLocalModelServiceRunning(endpoint)) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, HEALTH_CHECK_INTERVAL_MS));
  }

  return false;
}

/**
 * Start the local model service
 *
 * @param options - Service configuration
 * @returns true if service started successfully
 */
export async function startLocalModelService(options: LocalModelServiceOptions): Promise<boolean> {
  const config = loadLocalModelsConfig();

  // Check if service is disabled
  if (!config.enabled) {
    console.log('[local-model-manager] Service is disabled in config');
    return false;
  }

  const port = options.port || config.port || DEFAULT_PORT;
  const host = options.host || DEFAULT_HOST;
  const endpoint = `http://${host}:${port}`;

  // Check if already running
  if (await isLocalModelServiceRunning(endpoint)) {
    console.log('[local-model-manager] Service already running');
    return true;
  }

  // Check if we're already trying to start
  if (isStarting) {
    console.log('[local-model-manager] Service startup already in progress');
    return false;
  }

  isStarting = true;

  try {
    // Find the service entry point
    const servicePath = path.join(systemPaths.root, 'packages', 'local-model-service');
    const entryPoint = path.join(servicePath, 'dist', 'index.js');

    // Check if built
    if (!fs.existsSync(entryPoint)) {
      // Try running with tsx directly if not built
      const srcEntry = path.join(servicePath, 'src', 'index.ts');
      if (!fs.existsSync(srcEntry)) {
        console.error('[local-model-manager] Service not found. Run `pnpm build` in packages/local-model-service');
        return false;
      }

      console.log('[local-model-manager] Starting service with tsx (dev mode)...');
      serviceProcess = spawn('npx', ['tsx', srcEntry], {
        cwd: servicePath,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PORT: String(port),
          HOST: host,
          MODELS_DIR: options.modelsDir,
          CONFIG_PATH: options.configPath || path.join(systemPaths.etc, 'llm-backend.json')
        },
        detached: false
      });
    } else {
      console.log('[local-model-manager] Starting service...');
      serviceProcess = spawn('node', [entryPoint], {
        cwd: servicePath,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PORT: String(port),
          HOST: host,
          MODELS_DIR: options.modelsDir,
          CONFIG_PATH: options.configPath || path.join(systemPaths.etc, 'llm-backend.json')
        },
        detached: false
      });
    }

    // Log stdout/stderr
    serviceProcess.stdout?.on('data', (data) => {
      process.stdout.write(`[local-models] ${data}`);
    });

    serviceProcess.stderr?.on('data', (data) => {
      process.stderr.write(`[local-models] ${data}`);
    });

    // Handle process exit
    serviceProcess.on('exit', (code, signal) => {
      console.log(`[local-model-manager] Service exited with code ${code}, signal ${signal}`);
      serviceProcess = null;
    });

    serviceProcess.on('error', (error) => {
      console.error('[local-model-manager] Service error:', error);
      serviceProcess = null;
    });

    // Wait for service to become healthy
    console.log(`[local-model-manager] Waiting for service on ${endpoint}...`);
    const isHealthy = await waitForService(endpoint, STARTUP_TIMEOUT_MS);

    if (!isHealthy) {
      console.error('[local-model-manager] Service failed to start within timeout');
      await stopLocalModelService();
      return false;
    }

    console.log(`[local-model-manager] Service started successfully on ${endpoint}`);
    return true;
  } catch (error) {
    console.error('[local-model-manager] Failed to start service:', error);
    return false;
  } finally {
    isStarting = false;
  }
}

/**
 * Stop the local model service
 */
export async function stopLocalModelService(): Promise<void> {
  if (!serviceProcess) {
    console.log('[local-model-manager] No service process to stop');
    return;
  }

  console.log('[local-model-manager] Stopping service...');

  return new Promise((resolve) => {
    if (!serviceProcess) {
      resolve();
      return;
    }

    // Set up exit handler
    serviceProcess.once('exit', () => {
      serviceProcess = null;
      console.log('[local-model-manager] Service stopped');
      resolve();
    });

    // Send SIGTERM first
    serviceProcess.kill('SIGTERM');

    // Force kill after timeout
    setTimeout(() => {
      if (serviceProcess) {
        console.log('[local-model-manager] Force killing service...');
        serviceProcess.kill('SIGKILL');
        serviceProcess = null;
        resolve();
      }
    }, 5000);
  });
}

/**
 * Check if the service process is running
 */
export function isServiceProcessRunning(): boolean {
  return serviceProcess !== null && !serviceProcess.killed;
}

/**
 * Get the service process PID
 */
export function getServicePid(): number | null {
  return serviceProcess?.pid ?? null;
}

/**
 * Auto-start the service if configured
 */
export async function autoStartLocalModelService(modelsDir: string): Promise<boolean> {
  const config = loadLocalModelsConfig();

  if (!config.enabled || !config.autoStart) {
    console.log('[local-model-manager] Auto-start disabled');
    return false;
  }

  return startLocalModelService({ modelsDir });
}
