import type { APIRoute } from 'astro';
import { loadPersonaCore, loadDecisionRules } from '@metahuman/core/identity';
import { listActiveTasks } from '@metahuman/core/memory';
import { ROOT, getActiveAdapter } from '@metahuman/core';
import { listAvailableRoles, resolveModel, loadModelRegistry } from '@metahuman/core/model-resolver';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const GET: APIRoute = async () => {
  try {
    const persona = loadPersonaCore();
    const rules = loadDecisionRules();
    const tasks = listActiveTasks();

    // Determine base model and active adapter from single config file
    let agentCfg: any = {};
    let currentModel: string | null = null;
    let baseModel: string | null = null;
    let adapter: any = null;
    let adapterMode: 'none' | 'adapter' | 'merged' | 'dual' = 'none';
    let useAdapter = false;
    let includePersonaSummary = false;
    try {
      const agentCfgPath = path.join(ROOT, 'etc', 'agent.json');
      if (existsSync(agentCfgPath)) {
        agentCfg = JSON.parse(readFileSync(agentCfgPath, 'utf-8'));
        currentModel = agentCfg.model || null;
        baseModel = agentCfg.baseModel || agentCfg.model || null;
        useAdapter = !!agentCfg.useAdapter;
        includePersonaSummary = !!agentCfg.includePersonaSummary;
      }
    } catch {}

    const adapterModelName = agentCfg.adapterModel ?? null;
    const adapterMetaCfg = agentCfg.adapterMeta ?? {};

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
    let modelRoles: Record<string, any> = {};
    let registryVersion: string | null = null;
    try {
      const registry = loadModelRegistry();
      registryVersion = registry.version;

      const roles = listAvailableRoles();
      for (const role of roles) {
        try {
          const resolved = resolveModel(role);
          modelRoles[role] = {
            modelId: resolved.id,
            provider: resolved.provider,
            model: resolved.model,
            adapters: resolved.adapters,
            baseModel: resolved.baseModel,
            temperature: resolved.options.temperature,
          };
        } catch (error) {
          // Role may be disabled or misconfigured
          modelRoles[role] = {
            error: (error as Error).message,
          };
        }
      }
    } catch (error) {
      // Registry not available or invalid - fall back to legacy behavior
      modelRoles = {};
    }

    return new Response(
      JSON.stringify({
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
        // New multi-model registry information
        modelRoles,
        registryVersion,
      }),
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
