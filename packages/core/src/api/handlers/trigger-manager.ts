import { audit } from '../../audit.js';
import {
  ensureQueueSystemStarted,
  getTriggerConfigService,
  type TriggerConfigPatch,
} from '../../queue/index.js';
import type { UnifiedRequest, UnifiedResponse } from '../types.js';

function success(data: Record<string, unknown>, status = 200): UnifiedResponse {
  return { status, data: { success: true, ...data } };
}

function failure(error: string, status = 500): UnifiedResponse {
  return { status, data: { success: false, error } };
}

function requireOwner(req: UnifiedRequest): UnifiedResponse | null {
  if (!req.user.isAuthenticated) return failure('Authentication required', 401);
  if (req.user.role !== 'owner') return failure('Owner permission required', 403);
  return null;
}

export async function handleGetTriggerManager(req: UnifiedRequest): Promise<UnifiedResponse> {
  const authError = requireOwner(req);
  if (authError) return authError;
  try {
    const system = await ensureQueueSystemStarted();
    return success({ snapshot: system.triggers.getSnapshot() });
  } catch (error) {
    return failure((error as Error).message, 503);
  }
}

export async function handlePatchTriggerManagerConfig(req: UnifiedRequest): Promise<UnifiedResponse> {
  const authError = requireOwner(req);
  if (authError) return authError;
  try {
    const system = await ensureQueueSystemStarted();
    const patch = (req.body || {}) as TriggerConfigPatch;
    const applied = getTriggerConfigService().update(patch, req.user.username);
    return success({
      applied: {
        scope: applied.scope,
        revision: applied.revision,
        loadedAt: applied.loadedAt,
      },
      snapshot: system.triggers.getSnapshot(),
    });
  } catch (error) {
    return failure((error as Error).message, 400);
  }
}

export async function handleTriggerManagerControl(req: UnifiedRequest): Promise<UnifiedResponse> {
  const authError = requireOwner(req);
  if (authError) return authError;
  const action = req.body?.action as 'pause-admission' | 'resume-admission' | 'reload-config' | 'run-now' | undefined;
  if (!action || !['pause-admission', 'resume-admission', 'reload-config', 'run-now'].includes(action)) {
    return failure('Unknown Trigger Manager action', 400);
  }
  try {
    const system = await ensureQueueSystemStarted();
    let taskId: string | undefined;
    if (action === 'pause-admission' || action === 'resume-admission') {
      getTriggerConfigService().update({
        globalSettings: { pauseAll: action === 'pause-admission' },
      }, req.user.username);
    } else if (action === 'reload-config') {
      getTriggerConfigService().reload();
    } else {
      const triggerId = req.body?.triggerId;
      if (typeof triggerId !== 'string' || !triggerId.trim()) return failure('triggerId is required', 400);
      const state = system.triggers.getTriggerState(triggerId);
      if (!state) return failure(`Unknown trigger: ${triggerId}`, 404);
      if (state.config.lifecycle === 'service') {
        return failure(`${triggerId} is a persistent service and must be controlled from Agent Monitor`, 409);
      }
      const args = Array.isArray(req.body?.args)
        ? req.body.args.filter((value: unknown): value is string => typeof value === 'string')
        : [];
      taskId = system.triggerAgent(triggerId, req.user.username, args) ?? undefined;
      if (!taskId) return failure(`Trigger ${triggerId} did not admit work`, 409);
    }
    audit({
      level: 'info',
      category: 'action',
      event: 'trigger_manager_control',
      actor: req.user.username,
      details: { action, taskId },
    });
    return success({ action, taskId, snapshot: system.triggers.getSnapshot() });
  } catch (error) {
    return failure((error as Error).message, 500);
  }
}
