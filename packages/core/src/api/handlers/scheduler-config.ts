/**
 * Compatibility API for the former scheduler settings surface.
 *
 * The TriggerConfigService is the sole configuration owner. New clients should
 * use /api/trigger-manager/config.
 */

import { audit } from '../../audit.js';
import { ensureQueueSystemStarted, getTriggerConfigService } from '../../queue/index.js';
import type { UnifiedRequest, UnifiedResponse } from '../types.js';

function failure(error: string, status = 500): UnifiedResponse {
  return { status, data: { success: false, error } };
}

export async function handleGetSchedulerConfig(req: UnifiedRequest): Promise<UnifiedResponse> {
  if (!req.user.isAuthenticated) return failure('Authentication required', 401);
  if (req.user.role !== 'owner') return failure('Owner permission required', 403);
  try {
    const system = await ensureQueueSystemStarted();
    const read = getTriggerConfigService().load(false);
    return {
      status: 200,
      data: {
        success: true,
        globalSettings: read.config.globalSettings,
        agents: read.config.agents,
        scope: read.scope,
        persistedRevision: read.revision,
        runtimeRevision: system.triggers.getSnapshot().config.runtimeRevision,
        loadedAt: read.loadedAt,
      },
    };
  } catch (error) {
    return failure((error as Error).message);
  }
}

export async function handleSetSchedulerConfig(req: UnifiedRequest): Promise<UnifiedResponse> {
  if (!req.user.isAuthenticated) return failure('Authentication required', 401);
  if (req.user.role !== 'owner') return failure('Owner permission required', 403);
  try {
    const system = await ensureQueueSystemStarted();
    const read = getTriggerConfigService().update(req.body || {}, req.user.username);
    audit({
      level: 'info',
      category: 'system',
      event: 'scheduler_config_compatibility_api_used',
      actor: req.user.username,
      details: { revision: read.revision },
    });
    return {
      status: 200,
      data: {
        success: true,
        globalSettings: read.config.globalSettings,
        agents: read.config.agents,
        scope: read.scope,
        persistedRevision: read.revision,
        runtimeRevision: system.triggers.getSnapshot().config.runtimeRevision,
        loadedAt: read.loadedAt,
      },
    };
  } catch (error) {
    return failure((error as Error).message, 400);
  }
}
