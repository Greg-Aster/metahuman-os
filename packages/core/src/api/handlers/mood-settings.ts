import {
  loadMoodSettings,
  loadMoodState,
  saveMoodSettings,
  validateMoodSettingsUpdate,
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
  if (req.user.role === 'guest') {
    return response(403, { success: false, error: 'Write access is required to change Mood settings' });
  }
  try {
    if (req.body !== undefined && (!req.body || typeof req.body !== 'object' || Array.isArray(req.body))) {
      return response(400, { success: false, error: 'Mood update body must be an object' });
    }
    const body = (req.body || {}) as Record<string, any>;
    for (const key of Object.keys(body)) {
      if (key !== 'settings' && key !== 'trigger') {
        return response(400, { success: false, error: `Unknown Mood update field: ${key}` });
      }
    }
    if (body.trigger !== undefined && req.user.role !== 'owner') {
      return response(403, { success: false, error: 'Owner permission required to change Mood trigger admission' });
    }
    let settingsPatch: Partial<MoodSettings> | undefined;
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
      if (Object.keys(body.settings).length > 0) {
        settingsPatch = body.settings as Partial<MoodSettings>;
        validateMoodSettingsUpdate(req.user.username, settingsPatch);
      }
    }
    let triggerPatch: Record<string, unknown> | undefined;
    if (body.trigger !== undefined) {
      if (!body.trigger || typeof body.trigger !== 'object' || Array.isArray(body.trigger)) {
        return response(400, { success: false, error: 'trigger must be an object' });
      }
      const allowed = new Set(['enabled', 'eventCountThreshold', 'idleResetSeconds']);
      for (const key of Object.keys(body.trigger)) {
        if (!allowed.has(key)) return response(400, { success: false, error: `Unknown Mood trigger setting: ${key}` });
      }
      triggerPatch = {};
      for (const key of ['enabled', 'eventCountThreshold', 'idleResetSeconds'] as const) {
        if (body.trigger[key] !== undefined) triggerPatch[key] = body.trigger[key];
      }
      if (Object.keys(triggerPatch).length > 0) {
        getTriggerConfigService().validateUpdate({ agents: { mood: triggerPatch } });
      }
    }
    snapshot(req.user.username);
    if (triggerPatch && Object.keys(triggerPatch).length > 0) {
      getTriggerConfigService().update({ agents: { mood: triggerPatch } }, req.user.username);
    }
    if (settingsPatch) saveMoodSettings(req.user.username, settingsPatch, req.user.username);
    return response(200, snapshot(req.user.username));
  } catch (error) {
    return response(400, { success: false, error: (error as Error).message });
  }
}
