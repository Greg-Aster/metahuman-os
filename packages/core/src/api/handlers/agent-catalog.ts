import { getAgentCatalogService } from '../../agent-catalog.js';
import { ensureQueueSystemStarted } from '../../queue/index.js';
import type { UnifiedRequest, UnifiedResponse } from '../types.js';

function success(data: Record<string, unknown>, status = 200): UnifiedResponse {
  return { status, data: { success: true, ...data } };
}

function failure(error: string, status: number): UnifiedResponse {
  return { status, data: { success: false, error } };
}

function requireOwner(req: UnifiedRequest): UnifiedResponse | null {
  if (!req.user.isAuthenticated) return failure('Authentication required', 401);
  if (req.user.role !== 'owner') return failure('Owner permission required', 403);
  return null;
}

export async function handleGetAgentCatalog(req: UnifiedRequest): Promise<UnifiedResponse> {
  const authError = requireOwner(req);
  if (authError) return authError;
  try {
    return success({ snapshot: getAgentCatalogService().getSnapshot() });
  } catch (error) {
    return failure((error as Error).message, 503);
  }
}

export async function handleAgentCatalogControl(req: UnifiedRequest): Promise<UnifiedResponse> {
  const authError = requireOwner(req);
  if (authError) return authError;
  const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
  const action = body.action;
  const agentId = typeof body.agentId === 'string' ? body.agentId.trim() : '';
  if (action !== 'register' && action !== 'unregister') {
    return failure('Agent Catalog action must be register or unregister', 400);
  }
  if (!agentId) return failure('agentId is required', 400);
  try {
    await ensureQueueSystemStarted();
    const catalog = getAgentCatalogService();
    const snapshot = action === 'register'
      ? catalog.register(agentId, req.user.username)
      : catalog.unregister(agentId, req.user.username);
    return success({ action, agentId, snapshot });
  } catch (error) {
    const message = (error as Error).message;
    const status = message.startsWith('Unknown installed agent') ? 404 : 409;
    return failure(message, status);
  }
}
