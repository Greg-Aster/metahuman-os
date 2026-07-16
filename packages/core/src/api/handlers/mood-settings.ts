import {
  loadMoodSettings,
  loadMoodState,
  saveMoodSettings,
  type MoodSettings,
} from '../../mood-settings.js';
import { loadPersonaFacetConfig } from '../../persona-facets.js';
import { getTriggerConfigService } from '../../queue/trigger-config-service.js';
import type { UnifiedRequest, UnifiedResponse } from '../types.js';

function response(status: number, data: Record<string, unknown>): UnifiedResponse {
  return { status, data };
}

function requireAuthenticated(req: UnifiedRequest): UnifiedResponse | null {
  if (!req.user.isAuthenticated) return response(401, { success: false, error: 'Authentication required' });
  return null;
}

function snapshot(username: string): Record<string, unknown> {
  const trigger = getTriggerConfigService().load(false).config.agents.mood;
  const facets = loadPersonaFacetConfig(username);
  return {
    success: true,
    settings: loadMoodSettings(username),
    state: loadMoodState(username),
    trigger: trigger ? {
      enabled: trigger.enabled,
      eventCountThreshold: trigger.eventCountThreshold ?? 10,
      idleResetSeconds: trigger.idleResetSeconds ?? 1800,
      eventPattern: trigger.eventPattern,
    } : null,
    facets: Object.fromEntries(Object.entries(facets.facets).map(([id, facet]) => [id, {
      name: facet.name,
      description: facet.description,
      enabled: facet.enabled,
      personaFile: facet.personaFile,
    }])),
    activeFacet: facets.activeFacet,
  };
}

export async function handleGetMoodSettings(req: UnifiedRequest): Promise<UnifiedResponse> {
  const authError = requireAuthenticated(req);
  if (authError) return authError;
  try {
    return response(200, snapshot(req.user.username));
  } catch (error) {
    return response(500, { success: false, error: (error as Error).message });
  }
}

export async function handleUpdateMoodSettings(req: UnifiedRequest): Promise<UnifiedResponse> {
  const authError = requireAuthenticated(req);
  if (authError) return authError;
  try {
    const body = req.body && typeof req.body === 'object' ? req.body as Record<string, any> : {};
    if (body.settings !== undefined) {
      if (!body.settings || typeof body.settings !== 'object' || Array.isArray(body.settings)) {
        return response(400, { success: false, error: 'settings must be an object' });
      }
      const allowed = new Set<keyof MoodSettings>([
        'bufferSource',
        'maxMessagesPerBuffer',
        'maxContextChars',
        'baselineFacet',
        'overridePersonaDisabled',
        'minimumConfidence',
      ]);
      for (const key of Object.keys(body.settings)) {
        if (!allowed.has(key as keyof MoodSettings)) return response(400, { success: false, error: `Unknown Mood setting: ${key}` });
      }
      saveMoodSettings(req.user.username, body.settings, req.user.username);
    }
    if (body.trigger !== undefined) {
      if (req.user.role !== 'owner') return response(403, { success: false, error: 'Owner permission required to change Mood trigger admission' });
      if (!body.trigger || typeof body.trigger !== 'object' || Array.isArray(body.trigger)) {
        return response(400, { success: false, error: 'trigger must be an object' });
      }
      const patch: Record<string, unknown> = {};
      for (const key of ['enabled', 'eventCountThreshold', 'idleResetSeconds'] as const) {
        if (body.trigger[key] !== undefined) patch[key] = body.trigger[key];
      }
      if (Object.keys(patch).length > 0) {
        getTriggerConfigService().update({ agents: { mood: patch } }, req.user.username);
      }
    }
    return response(200, snapshot(req.user.username));
  } catch (error) {
    return response(400, { success: false, error: (error as Error).message });
  }
}
