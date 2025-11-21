import type { APIRoute } from 'astro';
import { loadPersonaCore, loadDecisionRules } from '@metahuman/core/identity';
import { listActiveTasks, searchMemory } from '@metahuman/core/memory';
import { getActiveAdapter } from '@metahuman/core';
import { listAvailableRoles, resolveModelForCognitiveMode, loadModelRegistry } from '@metahuman/core/model-resolver';
import { loadCognitiveMode } from '@metahuman/core/cognitive-mode';
import { getIndexStatus } from '@metahuman/core/vector-index';
import { listAvailableAgents, getProcessingStatus } from '@metahuman/core/agent-monitor';
import { isRunning as isOllamaRunning } from '@metahuman/core/ollama';
import { getRuntimeMode } from '@metahuman/core/runtime-mode';
import { getUserOrAnonymous, getProfilePaths, systemPaths } from '@metahuman/core';
import { loadCuriosityConfig } from '@metahuman/core/config';
import { getMemoryMetrics } from '@metahuman/core/memory-metrics-cache';
import fs from 'node:fs';
import path from 'node:path';

// Cache implementation for /api/status
// Note: Cache key now includes cognitive mode to ensure accurate status per mode
const statusCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 5000; // 5 seconds

// Export function to invalidate status cache (called when models.json changes)
export function invalidateStatusCache(): void {
  statusCache.clear();
}

const handler: APIRoute = async ({ cookies }) => {
  try {
    // Explicit auth - allow anonymous users to view system status (limited data)
    const user = getUserOrAnonymous(cookies);
    const isAuthenticated = user.role !== 'anonymous';

    const now = Date.now();

    // Load cognitive mode, but override for unauthenticated users
    const cognitiveConfig = loadCognitiveMode();
    const cognitiveMode = isAuthenticated ? cognitiveConfig.currentMode : 'emulation';

    // Cache key includes cognitive mode for accurate per-mode caching
    const cacheKey = `status-${cognitiveMode}`;

    // Return cached if fresh for this cognitive mode
    const cached = statusCache.get(cacheKey);
    if (cached && now - cached.timestamp < CACHE_TTL) {
      return new Response(
        JSON.stringify(cached.data),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store' // Still no-store to avoid browser caching, but we have server-side caching
          }
        }
      );
    }

    // Load user-specific data only for authenticated users
    const persona = isAuthenticated ? loadPersonaCore() : {
      identity: { name: 'Anonymous', role: 'Guest', purpose: '' },
      values: { core: [] },
      goals: { shortTerm: [] },
      lastUpdated: new Date().toISOString(),
    };
    const rules = isAuthenticated ? loadDecisionRules() : { trustLevel: 'observe' };
    const tasks = isAuthenticated ? listActiveTasks() : [];

    // Determine base model and active adapter from single config file
    let currentModel: string | null = null;
    let baseModel: string | null = null;
    let adapter: any = null;
    let adapterMode: 'none' | 'adapter' | 'merged' | 'dual' = 'none';
    let useAdapter = false;
    let includePersonaSummary = false;
    let adapterModelName: string | null = null;
    let adapterMetaCfg: any = {};

    try {
      const registry = loadModelRegistry();
      const globalSettings = registry.globalSettings || {};

      // Get model info from registry
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
    } else {
      adapterMode = 'none';
      adapter = null;
    }

    if (adapterMode !== 'adapter') {
      baseModel = null;
    } else if (!baseModel) {
      baseModel = currentModel;
    }

    const personaSummaryStatus = includePersonaSummary ? 'enabled' : 'disabled';

    // Build model roles information from registry
    // Only show roles that are defined for the current cognitive mode
    let modelRoles: Record<string, any> = {};
    let registryVersion: string | null = null;
    try {
      const registry = loadModelRegistry();
      registryVersion = registry.version;

      // Get roles defined for this cognitive mode
      const modeMappings = registry.cognitiveModeMappings?.[cognitiveMode];
      if (modeMappings) {
        // Only include roles that are explicitly mapped (not null) for this mode
        for (const [role, modelId] of Object.entries(modeMappings)) {
          // Skip non-role fields like 'description'
          if (role === 'description') continue;

          // Skip roles that are explicitly disabled (null)
          if (modelId === null) continue;

          try {
            // Use cognitive-mode-aware resolution to show what's actually being used
            const resolved = resolveModelForCognitiveMode(cognitiveMode, role as any);
            modelRoles[role] = {
              modelId: resolved.id,
              provider: resolved.provider,
              model: resolved.model,
              adapters: resolved.adapters,
              baseModel: resolved.baseModel,
              temperature: resolved.options.temperature,
            };
          } catch (error) {
            // Role failed to resolve - skip it
            console.error(`[status] Failed to resolve role ${role} for mode ${cognitiveMode}:`, error);
          }
        }
      } else {
        // Fallback: show all available roles if mode mappings not found
        const roles = listAvailableRoles();
        for (const role of roles) {
          try {
            const resolved = resolveModelForCognitiveMode(cognitiveMode, role);
            modelRoles[role] = {
              modelId: resolved.id,
              provider: resolved.provider,
              model: resolved.model,
              adapters: resolved.adapters,
              baseModel: resolved.baseModel,
              temperature: resolved.options.temperature,
            };
          } catch (error) {
            // Skip roles that can't be resolved
          }
        }
      }
    } catch (error) {
      // Registry not available or invalid - fall back to legacy behavior
      modelRoles = {};
    }

    // MEMORY SYSTEM STATUS - only for authenticated users
    let memoryStats: any;
    let byCategory: Record<string, number>;

    if (isAuthenticated) {
      const metrics = await getMemoryMetrics(user.username);
      memoryStats = {
        totalFiles: metrics.totalMemories,
        byType: metrics.memoriesByType,
        lastCapture: metrics.lastCaptureTimestamp,
      };

      // Group types into categories for the UI
      const categories: Record<string, string[]> = {
        Internal: ['inner_dialogue', 'reflection', 'dream'],
        Conversational: ['conversation', 'chat'],
        Knowledge: ['observation', 'action', 'journal', 'summary'],
        System: ['tool_invocation', 'file_read', 'file_write', 'unknown'],
      };

      byCategory = {
        Internal: 0,
        Conversational: 0,
        Knowledge: 0,
        System: 0,
      };

      for (const [type, count] of Object.entries(metrics.memoriesByType)) {
        let categorized = false;
        for (const [cat, types] of Object.entries(categories)) {
          if (types.includes(type)) {
            byCategory[cat] = (byCategory[cat] || 0) + count;
            categorized = true;
            break;
          }
        }
        if (!categorized) {
          byCategory['System'] = (byCategory['System'] || 0) + count;
        }
      }

      memoryStats.byCategory = byCategory;

      // Calculate percentages
      const percentages: Record<string, number> = {};
      if (metrics.totalMemories > 0) {
        for (const [category, count] of Object.entries(byCategory)) {
          percentages[category] = Math.round((count / metrics.totalMemories) * 100);
        }
      }
      memoryStats.percentages = percentages;

      // Add index status from metrics if available
      const indexStatus = await getIndexStatus();
      memoryStats.totalIndexed = indexStatus.items || 0;
      memoryStats.indexAvailable = indexStatus.exists;
      memoryStats.indexModel = indexStatus.model || null;
      memoryStats.lastIndexed = indexStatus.createdAt || null;
    } else {
      // Anonymous users - return default empty memory stats
      memoryStats = {
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
      byCategory = memoryStats.byCategory;
    }



    // AGENT ACTIVITY
    let agentActivity: any = {
      available: [],
      processing: null,
    };

    try {
      const agentNames = listAvailableAgents(); // Returns string[]
      const processing = getProcessingStatus();

      // listAvailableAgents returns just names, not full objects
      // We'll need to get run stats from audit logs or processing status
      agentActivity.available = agentNames.map((name: string) => ({
        name,
        lastRun: null, // TODO: Parse from audit logs
        runCount: 0,   // TODO: Parse from audit logs
      }));

      // Only show processing if it has actual data
      if (processing && processing.agent) {
        agentActivity.processing = {
          agent: processing.agent,
          status: processing.status || 'processing',
          lastActivity: processing.lastActivity,
        };
      } else {
        agentActivity.processing = null;
      }
    } catch {}

    // SYSTEM HEALTH
    let systemHealth: any = {
      ollama: 'unknown',
      auditLogSize: 0,
      storageUsed: 0,
    };

    try {
      systemHealth.ollama = await isOllamaRunning() ? 'connected' : 'disconnected';
    } catch {
      systemHealth.ollama = 'error';
    }

    try {
      const today = new Date().toISOString().split('T')[0];
      const auditFile = path.join(systemPaths.logs, 'audit', `${today}.ndjson`);
      if (fs.existsSync(auditFile)) {
        const stats = fs.statSync(auditFile);
        systemHealth.auditLogSize = stats.size;
      }
    } catch {}

    try {
      const getDirSize = (dir: string): number => {
        if (!fs.existsSync(dir)) return 0;
        let size = 0;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            size += getDirSize(fullPath);
          } else {
            try {
              size += fs.statSync(fullPath).size;
            } catch {}
          }
        }
        return size;
      };

      systemHealth.storageUsed = getDirSize(systemPaths.root);
    } catch {}

    // RECENT ACTIVITY
    let recentActivity: any[] = [];

    if (isAuthenticated) {
      try {
        // Get last 5 episodic memories by reading files directly
        const profilePaths = getProfilePaths(user.username);
        const episodicPath = profilePaths.episodic;
      const walkDir = (dir: string): string[] => {
        if (!fs.existsSync(dir)) return [];
        let files: string[] = [];
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            files = files.concat(walkDir(fullPath));
          } else if (entry.isFile() && entry.name.endsWith('.json')) {
            files.push(fullPath);
          }
        }
        return files;
      };

      const allFiles = walkDir(episodicPath);

      // Get last 5 files sorted by modification time
      const recentFiles = allFiles
        .map(f => ({ path: f, mtime: fs.statSync(f).mtime }))
        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
        .slice(0, 5);

      recentActivity = recentFiles.map(({ path: filePath }) => {
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

    // CURIOSITY STATS
    const curiosityConfig = loadCuriosityConfig();
    let openQuestionCount = 0;
    let lastAskedTimestamp: string | null = null;

    if (isAuthenticated) {
      const profilePaths = getProfilePaths(user.username);
      const pendingQuestionsDir = profilePaths.curiosityQuestionsPending;

      if (fs.existsSync(pendingQuestionsDir)) {
      const files = fs.readdirSync(pendingQuestionsDir).filter(f => f.endsWith('.json'));
      openQuestionCount = files.length;

      // Find most recent question
      files.forEach(file => {
        try {
          const q = JSON.parse(fs.readFileSync(path.join(pendingQuestionsDir, file), 'utf-8'));
          if (!lastAskedTimestamp || q.askedAt > lastAskedTimestamp) {
            lastAskedTimestamp = q.askedAt;
          }
        } catch {}
      });
      }
    }

    // RUNTIME MODE STATUS
    const runtimeMode = getRuntimeMode();

    // Cache the response
    const responseData = {
      identity: {
        name: persona.identity.name,
        role: persona.identity.role,
        icon: persona.identity.icon || null,
        trustLevel: rules.trustLevel,
      },
      tasks: {
        active: tasks.length,
        byStatus: {
          todo: tasks.filter(t => t.status === 'todo').length,
          in_progress: tasks.filter(t => t.status === 'in_progress').length,
          blocked: tasks.filter(t => t.status === 'blocked').length,
        },
      },
      values: persona.values.core.slice(0, 3),
      goals: persona.goals.shortTerm,
      lastUpdated: persona.lastUpdated,
      // Legacy model field (deprecated, kept for backward compatibility)
      model: {
        current: currentModel,
        base: baseModel,
        useAdapter,
        adapterMode,
        personaSummary: personaSummaryStatus,
        adapter,
      },
      // New multi-model registry information (cognitive-mode-aware)
      modelRoles,
      registryVersion,
      cognitiveMode,
      isAuthenticated,
      // New dashboard metrics
      memoryStats,
      agentActivity,
      systemHealth,
      recentActivity,
      // Runtime mode (headless state)
      runtime: {
        headless: runtimeMode.headless,
        lastChangedBy: runtimeMode.lastChangedBy,
        changedAt: runtimeMode.changedAt,
      },
      // Curiosity system stats
      curiosity: {
        enabled: curiosityConfig.maxOpenQuestions > 0,
        openQuestions: openQuestionCount,
        maxOpenQuestions: curiosityConfig.maxOpenQuestions,
        lastAsked: lastAskedTimestamp,
        researchMode: curiosityConfig.researchMode,
      },
    };

    // Cache the response with cognitive-mode-specific key
    statusCache.set(cacheKey, { data: responseData, timestamp: now });

    return new Response(
      JSON.stringify(responseData),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
      }
    );
  } catch (error) {
    console.error('[status] Error:', error);
    return new Response(
      JSON.stringify({ error: 'System not initialized', details: (error as Error).message }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
  }
};

// MIGRATED: 2025-11-20 - Explicit authentication pattern
// Anonymous users allowed (limited system status)
// Authenticated users see full status with user-specific data
export const GET = handler;
