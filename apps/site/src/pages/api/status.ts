import type { APIRoute } from 'astro';
import { loadPersonaCore, loadDecisionRules } from '@metahuman/core/identity';
import { listActiveTasks } from '@metahuman/core/memory';
import { getActiveAdapter } from '@metahuman/core';
import { listAvailableRoles, resolveModelForCognitiveMode, loadModelRegistry } from '@metahuman/core/model-resolver';
import { loadCognitiveMode } from '@metahuman/core/cognitive-mode';

// Cache implementation for /api/status
// Note: Cache key now includes cognitive mode to ensure accurate status per mode
const statusCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 5000; // 5 seconds

export const GET: APIRoute = async ({ cookies }) => {
  try {
    const now = Date.now();

    // Check authentication to determine effective cognitive mode
    const sessionCookie = cookies?.get('mh_session');
    const isAuthenticated = !!sessionCookie;

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

    const persona = loadPersonaCore();
    const rules = loadDecisionRules();
    const tasks = listActiveTasks();

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
    return new Response(
      JSON.stringify({ error: 'System not initialized' }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
  }
};
