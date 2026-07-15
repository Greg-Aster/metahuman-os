/**
 * System Handlers
 *
 * Unified handlers for system status and boot endpoints.
 * These work identically on web and mobile.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { isRunning as isOllamaRunning, checkOllamaHealth } from '../../ollama.js';
import { systemPaths } from '../../path-builder.js';
import { audit } from '../../audit.js';
import { loadPersonaCore } from '../../identity.js';
import { isHeadless } from '../../runtime-mode.js';
import { loadBackendConfig } from '../../llm-backend.js';
import { isVLLMRunning } from '../../vllm.js';
import { autoStartLocalModelService } from '../../local-model-service-manager.js';
import { bigBrotherTerminal } from '../../big-brother-terminal.js';
import { loadCognitiveMode } from '../../cognitive-mode.js';
import { loadOperatorConfig } from '../../config.js';
import { loadModelRegistry } from '../../model-resolver.js';

/**
 * GET /api/status - Basic system status
 */
export async function handleStatus(req: UnifiedRequest): Promise<UnifiedResponse> {
  const ollamaRunning = await isOllamaRunning().catch(() => false);

  return successResponse({
    status: 'ok',
    ollamaRunning,
    timestamp: new Date().toISOString(),
    platform: process.env.METAHUMAN_MOBILE ? 'mobile' : 'server',
  });
}

/**
 * GET /api/boot - Boot information for UI initialization
 */
export async function handleBoot(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user } = req;

  if (!user.isAuthenticated) {
    return {
      status: 401,
      data: {
        success: false,
        error: 'Authentication required',
        started: [],
        already: [],
        missing: [],
      },
    };
  }

  if (user.role !== 'owner') {
    return {
      status: 403,
      data: {
        success: false,
        error: 'Owner role required to manage agents',
        started: [],
        already: [],
        missing: [],
      },
    };
  }

  // Boot-managed agents are started once by start.sh -> bin/start-services -> mh start.
  // This UI initialization endpoint must not relaunch completed one-shot agents.
  const started: string[] = [];
  const already: string[] = [];
  const missing: string[] = [];
  const headlessMode = isHeadless();
  const isAuthenticated = user.isAuthenticated;

  let localModelServiceStatus: Record<string, unknown> | null = null;
  try {
    const modelsDir = path.join(systemPaths.root, 'data', 'models');
    const serviceStarted = await autoStartLocalModelService(modelsDir);
    localModelServiceStatus = {
      attempted: true,
      started: serviceStarted,
      modelsDir,
    };
    if (serviceStarted) {
      audit({
        level: 'info',
        category: 'system',
        event: 'local_model_service_started',
        details: { modelsDir, source: 'api/boot' },
        actor: 'system',
      });
    }
  } catch (error) {
    localModelServiceStatus = {
      attempted: true,
      started: false,
      error: String(error),
    };
  }

  let bigBrotherStatus: Record<string, unknown> | null = null;
  try {
    const operatorConfig = loadOperatorConfig(user.username, true);
    const bigBrotherProvider = operatorConfig.bigBrotherMode?.provider || 'claude-code';
    console.log(`[boot] Big Brother config check: enabled=${operatorConfig.bigBrotherMode?.enabled}, provider=${bigBrotherProvider}, headless=${headlessMode}`);

    if (operatorConfig.bigBrotherMode?.enabled && bigBrotherProvider === 'claude-code' && !headlessMode) {
      const currentState = bigBrotherTerminal.getState();

      if (currentState.isRunning) {
        bigBrotherStatus = {
          attempted: false,
          running: true,
          alreadyRunning: true,
          port: currentState.port,
          pid: currentState.pid,
        };
      } else {
        audit({
          level: 'info',
          category: 'system',
          event: 'big_brother_terminal_auto_starting',
          details: { source: 'api/boot' },
          actor: 'system',
        });

        const terminalStarted = await bigBrotherTerminal.start();
        const newState = bigBrotherTerminal.getState();

        bigBrotherStatus = {
          attempted: true,
          running: terminalStarted,
          alreadyRunning: false,
          port: newState.port,
          pid: newState.pid,
        };

        if (terminalStarted) {
          audit({
            level: 'info',
            category: 'system',
            event: 'big_brother_terminal_auto_started',
            details: { port: newState.port, pid: newState.pid, source: 'api/boot' },
            actor: 'system',
          });
        }
      }
    } else {
      const currentState = bigBrotherTerminal.getState();
      if (currentState.isRunning && bigBrotherProvider !== 'claude-code') {
        await bigBrotherTerminal.stop();
      }
      bigBrotherStatus = {
        attempted: false,
        running: false,
        reason: headlessMode ? 'headless_mode' : (operatorConfig.bigBrotherMode?.enabled ? 'non_claude_provider' : 'disabled_in_config'),
      };
    }
  } catch (error) {
    bigBrotherStatus = {
      attempted: true,
      running: false,
      error: String(error),
    };
  }

  let persona: unknown = null;
  let version = '1.0.0';
  let modelInfo: Record<string, unknown> | null = null;
  let cognitiveMode = 'emulation';
  let ollamaStatus: unknown = null;
  let backendStatus: Record<string, unknown> | null = null;

  try {
    persona = loadPersonaCore();

    const cognitiveConfig = loadCognitiveMode();
    cognitiveMode = isAuthenticated ? cognitiveConfig.currentMode : 'emulation';

    try {
      const pkgPath = path.join(systemPaths.root, 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        version = pkg.version || version;
      }
    } catch {
      // Keep default version.
    }

    try {
      const registry = loadModelRegistry(false, user.username);
      const defaults = registry.defaults as Record<string, string> | undefined;
      const models = registry.models as Record<string, { model?: string }> | undefined;
      const fallbackId = defaults?.fallback || 'default.fallback';
      const fallbackModel = models?.[fallbackId];
      modelInfo = { model: fallbackModel?.model || 'Local Models' };
    } catch {
      // Model info is optional on boot.
    }

    const backendConfig = loadBackendConfig();
    const activeBackend = backendConfig.activeBackend;

    if (activeBackend === 'vllm') {
      const vllmRunning = await isVLLMRunning();
      backendStatus = {
        activeBackend: 'vllm',
        running: vllmRunning,
        hasModels: vllmRunning,
        modelCount: vllmRunning ? 1 : 0,
        models: vllmRunning ? [backendConfig.vllm.model] : [],
        error: vllmRunning ? null : 'vLLM is not running',
      };
      ollamaStatus = {
        running: false,
        hasModels: false,
        modelCount: 0,
        models: [],
        error: null,
      };
    } else {
      backendStatus = { activeBackend: 'ollama' };
      try {
        ollamaStatus = await checkOllamaHealth();
        backendStatus = {
          ...backendStatus,
          ...(ollamaStatus as Record<string, unknown>),
          activeBackend: 'ollama',
        };
      } catch (error) {
        ollamaStatus = {
          running: false,
          hasModels: false,
          modelCount: 0,
          models: [],
          error: String(error),
        };
        backendStatus = { ...backendStatus, ...(ollamaStatus as Record<string, unknown>) };
      }
    }
  } catch {
    // Continue without optional boot data if loading fails.
  }

  return {
    status: 200,
    headers: { 'Cache-Control': 'no-store' },
    data: {
      started,
      already,
      missing,
      persona,
      version,
      modelInfo,
      cognitiveMode,
      isAuthenticated,
      headlessMode,
      ollamaStatus,
      backendStatus,
      localModelServiceStatus,
      bigBrotherStatus,
    },
  };
}

/**
 * GET /api/app-info - Mobile app version information
 *
 * Returns the current app version for update checking.
 * On mobile, this reads from the bundled version file.
 * On web, returns a static version (web always uses latest server code).
 */
export async function handleAppInfo(_req: UnifiedRequest): Promise<UnifiedResponse> {
  // Read version from environment or use defaults
  // These are set during build time in React Native
  const version = process.env.APP_VERSION || '1.0.0';
  const versionCode = parseInt(process.env.APP_VERSION_CODE || '1', 10);
  const buildDate = process.env.APP_BUILD_DATE || new Date().toISOString();

  return successResponse({
    version,
    versionCode,
    buildDate,
    platform: process.env.METAHUMAN_MOBILE ? 'mobile' : 'server',
  });
}
