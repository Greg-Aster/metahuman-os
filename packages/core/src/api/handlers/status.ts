/**
 * Status Handler - Unified system status endpoint
 *
 * SINGLE implementation used by both web (Astro) and mobile (nodejs-mobile).
 * Provides identity, tasks, model info, memory stats, and system health.
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse, errorResponse } from '../types.js';
import { loadPersonaCore, loadDecisionRules } from '../../identity.js';
import { listActiveTasks } from '../../memory.js';
import { getActiveAdapter } from '../../adapters.js';
import { listAvailableRoles, resolveModelForCognitiveMode, loadModelRegistry } from '../../model-resolver.js';
import { loadCognitiveMode } from '../../cognitive-mode.js';
import { getIndexStatus } from '../../vector-index.js';
import { listAvailableAgents } from '../../agent-monitor.js';
import { getBackendStatus, detectAvailableBackends } from '../../llm-backend.js';
import { getRuntimeMode } from '../../runtime-mode.js';
import { getProfilePaths, systemPaths } from '../../index.js';
import { loadCuriosityConfig, loadOperatorConfig } from '../../config.js';
import { getMemoryMetrics } from '../../memory-metrics-cache.js';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================================
// Backend Availability Types
// ============================================================================

interface BackendAvailability {
  ollama: { available: boolean; running: boolean; active: boolean; model?: string };
  vllm: { available: boolean; running: boolean; active: boolean; model?: string };
  runpod: { available: boolean; configured: boolean; active: boolean };
  bigBrother: { available: boolean; enabled: boolean; provider?: string };
  remoteServer: { available: boolean; configured: boolean; serverUrl?: string };
}

/**
 * Detect RunPod configuration availability
 * Checks env vars, etc/runpod.json, and .env file
 */
function detectRunPodAvailability(): { available: boolean; configured: boolean } {
  let hasApiKey = false;

  // 1. Check environment variables
  if (process.env.RUNPOD_API_KEY) {
    hasApiKey = true;
  }

  // 2. Check etc/runpod.json
  if (!hasApiKey) {
    const configPath = path.join(systemPaths.root, 'etc', 'runpod.json');
    if (fs.existsSync(configPath)) {
      try {
        const fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        if (fileConfig.apiKey) {
          hasApiKey = true;
        }
      } catch {
        // Invalid JSON, ignore
      }
    }
  }

  // 3. Check .env file in root directory
  if (!hasApiKey) {
    const envPath = path.join(systemPaths.root, '.env');
    if (fs.existsSync(envPath)) {
      try {
        const envContent = fs.readFileSync(envPath, 'utf-8');
        const lines = envContent.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('RUNPOD_API_KEY=')) {
            const value = trimmed.substring('RUNPOD_API_KEY='.length).trim().replace(/^["']|["']$/g, '');
            if (value) {
              hasApiKey = true;
              break;
            }
          }
        }
      } catch {
        // Can't read .env, ignore
      }
    }
  }

  return {
    available: hasApiKey, // Available if API key is configured
    configured: hasApiKey,
  };
}

/**
 * Detect Big Brother configuration availability
 * Big Brother requires terminal access, so it's only "available" on desktop
 */
function detectBigBrotherAvailability(): { available: boolean; enabled: boolean; provider?: string } {
  try {
    const config = loadOperatorConfig();
    const bigBrotherConfig = config.bigBrotherMode || { enabled: false, provider: 'claude-code' };

    // Big Brother is available if we're not on mobile (mobile has no terminal)
    // For now, always mark as available since server-side can't detect mobile
    // The UI will hide it on mobile if needed
    return {
      available: true,
      enabled: bigBrotherConfig.enabled ?? false,
      provider: bigBrotherConfig.provider || 'claude-code',
    };
  } catch {
    return {
      available: true,
      enabled: false,
      provider: 'claude-code',
    };
  }
}

/**
 * Detect Remote Server (Cloudflare tunnel) configuration
 * Future feature - placeholder for now
 */
function detectRemoteServerAvailability(): { available: boolean; configured: boolean; serverUrl?: string } {
  try {
    const backendConfig = JSON.parse(
      fs.readFileSync(path.join(systemPaths.root, 'etc', 'llm-backend.json'), 'utf-8')
    );
    const remote = backendConfig.remote || {};

    return {
      available: remote.provider === 'server' && !!remote.serverUrl,
      configured: !!remote.serverUrl,
      serverUrl: remote.serverUrl,
    };
  } catch {
    return {
      available: false,
      configured: false,
    };
  }
}

// NOTE: statusCache was REMOVED - it was redundant with model-resolver's registryCache
// and caused cache invalidation bugs. Model data is already cached by registryCache (1 min TTL).

/**
 * GET /api/status - Full system status
 *
 * Returns identity, tasks, model info, memory stats, agent activity, system health.
 * Works identically on web and mobile.
 */
export async function handleGetStatus(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const { user } = req;
    const isAuthenticated = user.isAuthenticated;

    // Load cognitive mode
    let cognitiveMode = 'emulation';
    try {
      const cognitiveConfig = loadCognitiveMode();
      cognitiveMode = isAuthenticated ? cognitiveConfig.currentMode : 'emulation';
    } catch {
      // Default to emulation if can't load
    }

    // Load user-specific data only for authenticated users
    let persona: any;
    let rules: any;
    let tasks: any[];

    if (isAuthenticated) {
      try {
        persona = loadPersonaCore();
      } catch {
        persona = {
          identity: { name: user.username, role: 'User', purpose: '' },
          values: { core: [] },
          goals: { shortTerm: [] },
          lastUpdated: new Date().toISOString(),
        };
      }
      try {
        rules = loadDecisionRules();
      } catch {
        rules = { trustLevel: 'observe' };
      }
      try {
        tasks = listActiveTasks();
      } catch {
        tasks = [];
      }
    } else {
      persona = {
        identity: { name: 'Anonymous', role: 'Guest', purpose: '' },
        values: { core: [] },
        goals: { shortTerm: [] },
        lastUpdated: new Date().toISOString(),
      };
      rules = { trustLevel: 'observe' };
      tasks = [];
    }

    // Model info
    let currentModel: string | null = null;
    let baseModel: string | null = null;
    let adapter: any = null;
    let adapterMode: 'none' | 'adapter' | 'merged' | 'dual' = 'none';
    let useAdapter = false;
    let includePersonaSummary = false;
    let adapterModelName: string | null = null;
    let adapterMetaCfg: any = {};

    try {
      const username = isAuthenticated ? user.username : undefined;
      const registry = loadModelRegistry(false, username);
      const globalSettings = registry.globalSettings || {};

      const fallbackId = registry.defaults?.fallback || 'default.fallback';
      const fallbackModel = registry.models?.[fallbackId];
      currentModel = fallbackModel?.model || null;
      baseModel = fallbackModel?.baseModel || currentModel;

      useAdapter = !!globalSettings.useAdapter;
      includePersonaSummary = globalSettings.includePersonaSummary ?? true;

      if (globalSettings.activeAdapter) {
        if (typeof globalSettings.activeAdapter === 'string') {
          adapterModelName = globalSettings.activeAdapter;
        } else {
          adapterModelName = globalSettings.activeAdapter.modelName;
          adapterMetaCfg = globalSettings.activeAdapter;
        }
      }
    } catch {}

    const active = getActiveAdapter();
    const isMergedActive = !useAdapter && adapterModelName && currentModel && adapterModelName === currentModel;

    if (useAdapter && adapterModelName) {
      const isDual = !!(adapterMetaCfg.isDualAdapter || adapterMetaCfg.dual);
      adapterMode = isDual ? 'dual' : 'adapter';
      const status = active?.status || 'configured';
      adapter = {
        status,
        modelName: adapterModelName,
        isDualAdapter: isDual,
        activatedAt: active?.activatedAt,
        source: active ? 'active' : 'config',
      };
      if (active?.baseModel) baseModel = active.baseModel;
    } else if (isMergedActive) {
      const isDual = !!(adapterMetaCfg.isDualAdapter || adapterMetaCfg.dual);
      adapterMode = isDual ? 'dual' : 'merged';
      adapter = {
        status: 'merged',
        modelName: adapterModelName,
        isDualAdapter: isDual,
        activatedAt: adapterMetaCfg.activatedAt,
        source: 'merged',
      };
    }

    if (adapterMode !== 'adapter') {
      baseModel = null;
    } else if (!baseModel) {
      baseModel = currentModel;
    }

    const personaSummaryStatus = includePersonaSummary ? 'enabled' : 'disabled';

    // Model roles
    let modelRoles: Record<string, any> = {};
    let registryVersion: string | null = null;
    const modelUsername = isAuthenticated ? user.username : undefined;

    // Get backend status to know which providers are available
    const backendStatus = await getBackendStatus();
    const availableProviders = new Set<string>();

    // Add available providers based on what's actually running
    if (backendStatus.resolvedBackend === 'ollama' && backendStatus.running) {
      availableProviders.add('ollama');
    }
    if (backendStatus.resolvedBackend === 'vllm' && backendStatus.running) {
      availableProviders.add('vllm');
    }
    // Remote providers are always "available" (RunPod, OpenAI, etc.)
    // The actual API call will fail if credentials are wrong, but they're selectable
    availableProviders.add('runpod_serverless');
    availableProviders.add('openai');
    availableProviders.add('openrouter');
    availableProviders.add('huggingface');
    availableProviders.add('claude-code');
    availableProviders.add('anthropic');

    try {
      const registry = loadModelRegistry(false, modelUsername);
      registryVersion = registry.version;

      const modeMappings = registry.cognitiveModeMappings?.[cognitiveMode];

      if (modeMappings) {
        for (const [role, modelId] of Object.entries(modeMappings)) {
          if (role === 'description' || modelId === null) continue;
          try {
            const resolved = resolveModelForCognitiveMode(cognitiveMode, role as any, modelUsername);

            // Only include if the provider is available
            if (availableProviders.has(resolved.provider)) {
              modelRoles[role] = {
                modelId: resolved.id,
                provider: resolved.provider,
                model: resolved.model,
                adapters: resolved.adapters,
                baseModel: resolved.baseModel,
                temperature: resolved.options.temperature,
              };
            } else {
              // Provider not available - mark as needing configuration
              // Don't show as "error" - user just needs to select an available model
              modelRoles[role] = {
                modelId: resolved.id,
                provider: resolved.provider,
                model: null, // NULL means no model available
                needsConfig: true, // User should select an available model
                unavailableReason: `${resolved.provider} not available`,
              };
            }
          } catch {}
        }
      } else {
        const roles = listAvailableRoles(modelUsername);
        for (const role of roles) {
          try {
            const resolved = resolveModelForCognitiveMode(cognitiveMode, role, modelUsername);

            // Only include if the provider is available
            if (availableProviders.has(resolved.provider)) {
              modelRoles[role] = {
                modelId: resolved.id,
                provider: resolved.provider,
                model: resolved.model,
                adapters: resolved.adapters,
                baseModel: resolved.baseModel,
                temperature: resolved.options.temperature,
              };
            } else {
              // Provider not available - mark as needing configuration
              // Don't show as "error" - user just needs to select an available model
              modelRoles[role] = {
                modelId: resolved.id,
                provider: resolved.provider,
                model: null, // NULL means no model available
                needsConfig: true, // User should select an available model
                unavailableReason: `${resolved.provider} not available`,
              };
            }
          } catch {}
        }
      }
    } catch {}

    // Memory stats
    let memoryStats: any = getDefaultMemoryStats();
    if (isAuthenticated) {
      try {
        const metrics = await getMemoryMetrics(user.username);

        const categories: Record<string, string[]> = {
          Internal: ['inner_dialogue', 'reflection', 'dream'],
          Conversational: ['conversation', 'chat'],
          Knowledge: ['observation', 'action', 'journal', 'summary'],
          System: ['tool_invocation', 'file_read', 'file_write', 'unknown'],
        };

        const byCategory: Record<string, number> = {
          Internal: 0,
          Conversational: 0,
          Knowledge: 0,
          System: 0,
        };

        for (const [type, count] of Object.entries(metrics.memoriesByType)) {
          let categorized = false;
          for (const [cat, types] of Object.entries(categories)) {
            if (types.includes(type)) {
              byCategory[cat] = (byCategory[cat] || 0) + (count as number);
              categorized = true;
              break;
            }
          }
          if (!categorized) {
            byCategory['System'] = (byCategory['System'] || 0) + (count as number);
          }
        }

        const percentages: Record<string, number> = {};
        if (metrics.totalMemories > 0) {
          for (const [category, count] of Object.entries(byCategory)) {
            percentages[category] = Math.round((count / metrics.totalMemories) * 100);
          }
        }

        let indexStatus: any = { exists: false, items: 0 };
        try {
          indexStatus = await getIndexStatus();
        } catch {}

        memoryStats = {
          totalFiles: metrics.totalMemories,
          byType: metrics.memoriesByType,
          lastCapture: metrics.lastCaptureTimestamp,
          byCategory,
          percentages,
          totalIndexed: indexStatus.items || 0,
          indexAvailable: indexStatus.exists,
          indexModel: indexStatus.model || null,
          lastIndexed: indexStatus.createdAt || null,
        };
      } catch {
        // Keep default
      }
    }

    // Agent activity
    let agentActivity: any = { available: [] };
    try {
      const agentNames = listAvailableAgents();
      agentActivity.available = agentNames.map((name: string) => ({
        name,
        lastRun: null,
        runCount: 0,
      }));
    } catch {}

    // System health - use intelligent backend detection
    let systemHealth: any = {
      activeBackend: 'unknown',
      resolvedBackend: 'offline',
      llmBackend: 'unknown',
      auditLogSize: 0,
      storageUsed: 0,
    };

    try {
      const backendStatus = await getBackendStatus();
      systemHealth.activeBackend = backendStatus.backend;
      systemHealth.resolvedBackend = backendStatus.resolvedBackend;
      systemHealth.llmBackend = backendStatus.health === 'healthy' ? 'connected' : 'disconnected';
      systemHealth.backendModel = backendStatus.model;
      systemHealth.backendEndpoint = backendStatus.endpoint;
      systemHealth.backendReason = backendStatus.reason;

      // Set specific backend status
      if (backendStatus.resolvedBackend === 'ollama') {
        systemHealth.ollama = backendStatus.running ? 'connected' : 'disconnected';
      } else if (backendStatus.resolvedBackend === 'vllm') {
        systemHealth.vllm = backendStatus.running ? 'connected' : 'disconnected';
      } else if (backendStatus.resolvedBackend === 'remote') {
        systemHealth.remote = 'connected';
        systemHealth.remoteProvider = backendStatus.remoteProvider;
      }

      // Load cloud models from user's profile models.json
      const cloudUsername = isAuthenticated ? user.username : undefined;
      systemHealth.cloudModels = loadCloudModelsFromRegistry(cloudUsername);

      // Build backend availability for status widget icons
      const availableBackends = await detectAvailableBackends();
      const runpodStatus = detectRunPodAvailability();
      const bigBrotherStatus = detectBigBrotherAvailability();
      const remoteServerStatus = detectRemoteServerAvailability();

      // Determine which backend is the "active" one
      const activeBackendType = backendStatus.resolvedBackend;
      const isRunPodActive = activeBackendType === 'remote' && backendStatus.remoteProvider === 'runpod';

      systemHealth.backendAvailability = {
        ollama: {
          available: availableBackends.ollama.installed,
          running: availableBackends.ollama.running,
          active: activeBackendType === 'ollama',
          model: availableBackends.ollama.model,
        },
        vllm: {
          available: availableBackends.vllm.installed,
          running: availableBackends.vllm.running,
          active: activeBackendType === 'vllm',
          model: availableBackends.vllm.model,
        },
        runpod: {
          available: runpodStatus.available,
          configured: runpodStatus.configured,
          active: isRunPodActive,
        },
        bigBrother: {
          available: bigBrotherStatus.available,
          enabled: bigBrotherStatus.enabled,
          provider: bigBrotherStatus.provider,
        },
        remoteServer: {
          available: remoteServerStatus.available,
          configured: remoteServerStatus.configured,
          serverUrl: remoteServerStatus.serverUrl,
        },
      } as BackendAvailability;
    } catch {
      systemHealth.llmBackend = 'error';
    }

    try {
      const today = new Date().toISOString().split('T')[0];
      const auditFile = path.join(systemPaths.logs, 'audit', `${today}.ndjson`);
      if (fs.existsSync(auditFile)) {
        const stats = fs.statSync(auditFile);
        systemHealth.auditLogSize = stats.size;
      }
    } catch {}

    // Recent activity
    let recentActivity: any[] = [];
    if (isAuthenticated) {
      try {
        const profilePaths = getProfilePaths(user.username);
        const episodicPath = profilePaths.episodic;
        const recentFiles: Array<{ path: string; mtime: Date }> = [];
        const nowDate = new Date();

        for (let daysAgo = 0; daysAgo < 7 && recentFiles.length < 10; daysAgo++) {
          const date = new Date(nowDate);
          date.setDate(date.getDate() - daysAgo);
          const year = date.getFullYear();
          const month = String(date.getMonth() + 1).padStart(2, '0');
          const day = String(date.getDate()).padStart(2, '0');
          const dayPath = path.join(episodicPath, String(year), month, day);

          if (fs.existsSync(dayPath)) {
            const entries = fs.readdirSync(dayPath, { withFileTypes: true });
            for (const entry of entries) {
              if (entry.isFile() && entry.name.endsWith('.json')) {
                const fullPath = path.join(dayPath, entry.name);
                try {
                  const mtime = fs.statSync(fullPath).mtime;
                  recentFiles.push({ path: fullPath, mtime });
                } catch {}
              }
            }
          }
        }

        const topFiles = recentFiles
          .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
          .slice(0, 5);

        recentActivity = topFiles.map(({ path: filePath }) => {
          try {
            const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            return {
              type: content.type || 'episodic',
              content: content.content?.substring(0, 100) || '',
              timestamp: content.timestamp || new Date(fs.statSync(filePath).mtime).toISOString(),
            };
          } catch {
            return null;
          }
        }).filter(Boolean);
      } catch {}
    }

    // Curiosity stats (simplified)
    let curiosityConfig: any = { maxOpenQuestions: 0, researchMode: 'off' };
    try {
      curiosityConfig = loadCuriosityConfig(isAuthenticated ? user.username : undefined);
    } catch {}

    // Runtime mode
    let runtimeMode: any = { headless: false };
    try {
      runtimeMode = getRuntimeMode();
    } catch {}

    // Build response
    const responseData = {
      identity: {
        name: persona.identity?.name || 'Unknown',
        role: persona.identity?.role || 'User',
        icon: persona.identity?.icon || null,
        trustLevel: rules.trustLevel || 'observe',
      },
      tasks: {
        active: tasks.length,
        byStatus: {
          todo: tasks.filter((t: any) => t.status === 'todo').length,
          in_progress: tasks.filter((t: any) => t.status === 'in_progress').length,
          blocked: tasks.filter((t: any) => t.status === 'blocked').length,
        },
      },
      values: persona.values?.core?.slice(0, 3) || [],
      goals: persona.goals?.shortTerm || [],
      lastUpdated: persona.lastUpdated,
      model: {
        current: currentModel,
        base: baseModel,
        useAdapter,
        adapterMode,
        personaSummary: personaSummaryStatus,
        adapter,
      },
      modelRoles,
      registryVersion,
      cognitiveMode,
      isAuthenticated,
      memoryStats,
      agentActivity,
      systemHealth,
      recentActivity,
      runtime: {
        headless: runtimeMode.headless,
        lastChangedBy: runtimeMode.lastChangedBy,
        changedAt: runtimeMode.changedAt,
      },
      curiosity: {
        enabled: (curiosityConfig.maxOpenQuestions || 0) > 0,
        openQuestions: 0,
        maxOpenQuestions: curiosityConfig.maxOpenQuestions || 0,
        lastAsked: null,
        researchMode: curiosityConfig.researchMode || 'off',
      },
    };

    return successResponse(responseData);
  } catch (error) {
    console.error('[status] Error:', error);
    return errorResponse(`System error: ${(error as Error).message}`, 500);
  }
}

function getDefaultMemoryStats() {
  return {
    totalFiles: 0,
    byType: {},
    lastCapture: null,
    byCategory: {
      Internal: 0,
      Conversational: 0,
      Knowledge: 0,
      System: 0,
    },
    percentages: {},
    totalIndexed: 0,
    indexAvailable: false,
    indexModel: null,
    lastIndexed: null,
  };
}

/**
 * Load cloud models from user's profile models.json
 * Used for mobile to get the list of available cloud providers in dropdowns
 */
function loadCloudModelsFromRegistry(username?: string): Array<{ id: string; model: string; provider: string }> {
  const cloudProviders = ['runpod_serverless', 'huggingface', 'openai', 'openrouter'];
  const cloudModels: Array<{ id: string; model: string; provider: string }> = [];

  // Must have a username to load profile-specific models
  if (!username) {
    return cloudModels;
  }

  try {
    const profilePaths = getProfilePaths(username);
    const modelsPath = path.join(profilePaths.etc, 'models.json');
    if (!fs.existsSync(modelsPath)) {
      return cloudModels;
    }

    const registry = JSON.parse(fs.readFileSync(modelsPath, 'utf-8'));

    for (const [id, config] of Object.entries(registry.models || {})) {
      const modelConfig = config as { provider?: string; model?: string };
      if (modelConfig.provider && cloudProviders.includes(modelConfig.provider)) {
        cloudModels.push({
          id,
          model: modelConfig.model || id,
          provider: modelConfig.provider,
        });
      }
    }
  } catch (err) {
    console.error('[status] Failed to load cloud models:', err);
  }

  return cloudModels;
}
