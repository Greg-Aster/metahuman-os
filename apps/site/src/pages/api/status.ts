import type { APIRoute } from 'astro';
import { loadPersonaCore, loadDecisionRules } from '@metahuman/core/identity';
import { listActiveTasks } from '@metahuman/core/memory';
import { ROOT, getActiveAdapter } from '@metahuman/core';
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

    return new Response(
      JSON.stringify({
        identity: {
          name: persona.identity.name,
          role: persona.identity.role,
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
        model: {
          current: currentModel,
          base: baseModel,
          useAdapter,
          adapterMode,
          personaSummary: personaSummaryStatus,
          adapter,
        },
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
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
