import {
  badRequestResponse,
  errorResponse,
  successResponse,
  type UnifiedRequest,
  type UnifiedResponse,
} from '../types.js';
import {
  claimEnvironmentActions,
  publishEnvironmentObservation,
  readEnvironmentBridgeState,
  recordEnvironmentActionResult,
  setEnvironmentBridgeEnabled,
  summarizeEnvironmentBridgeState,
  type EnvironmentFeedback,
  type EnvironmentObservation,
} from '../../environment-interface/index.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function withCors(response: UnifiedResponse): UnifiedResponse {
  return {
    ...response,
    headers: {
      ...CORS_HEADERS,
      ...response.headers,
    },
  };
}

function bodyRecord(req: UnifiedRequest): Record<string, unknown> {
  return req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
}

function isObservation(value: Record<string, unknown>): boolean {
  return (
    typeof value.environmentId === 'string' &&
    typeof value.adapter === 'string' &&
    typeof value.sessionId === 'string' &&
    typeof value.timestamp === 'string' &&
    Boolean(value.capabilities) &&
    typeof value.capabilities === 'object'
  );
}

function buildFeedback(value: Record<string, unknown>): EnvironmentFeedback | null {
  if (typeof value.type !== 'string' || typeof value.message !== 'string') {
    return null;
  }

  return {
    id: typeof value.id === 'string' ? value.id : `env-feedback-${Date.now()}`,
    timestamp: typeof value.timestamp === 'string' ? value.timestamp : new Date().toISOString(),
    type: value.type as EnvironmentFeedback['type'],
    message: value.message,
    actionId: typeof value.actionId === 'string' ? value.actionId : undefined,
    data: value.data && typeof value.data === 'object' ? value.data as Record<string, unknown> : undefined,
  };
}

export async function handleEnvironmentBridgeStatus(_req: UnifiedRequest): Promise<UnifiedResponse> {
  return withCors(successResponse(summarizeEnvironmentBridgeState()));
}

export async function handleEnvironmentBridgeObservation(req: UnifiedRequest): Promise<UnifiedResponse> {
  const body = bodyRecord(req);
  if (!isObservation(body)) {
    return withCors(badRequestResponse('Invalid environment observation payload'));
  }

  try {
    const summary = publishEnvironmentObservation(body as unknown as EnvironmentObservation);
    return withCors(successResponse({ success: true, bridge: summary }));
  } catch (error) {
    return withCors(errorResponse((error as Error).message));
  }
}

export async function handleEnvironmentBridgeActions(req: UnifiedRequest): Promise<UnifiedResponse> {
  const sessionId = req.query?.sessionId;
  if (!sessionId) {
    return withCors(badRequestResponse('Missing sessionId'));
  }

  const state = readEnvironmentBridgeState();
  if (!state.enabled) {
    return withCors(successResponse({ enabled: false, actions: [] }));
  }

  const limit = req.query?.limit ? Math.max(1, Math.min(50, Number(req.query.limit))) : 10;
  const actions = claimEnvironmentActions(sessionId, Number.isFinite(limit) ? limit : 10);
  return withCors(successResponse({ enabled: true, actions }));
}

export async function handleEnvironmentBridgeActionResult(req: UnifiedRequest): Promise<UnifiedResponse> {
  const feedback = buildFeedback(bodyRecord(req));
  if (!feedback) {
    return withCors(badRequestResponse('Invalid action result payload'));
  }

  const action = recordEnvironmentActionResult(feedback);
  return withCors(successResponse({ success: true, action }));
}

export async function handleEnvironmentBridgeControl(req: UnifiedRequest): Promise<UnifiedResponse> {
  const body = bodyRecord(req);
  if (typeof body.enabled !== 'boolean') {
    return badRequestResponse('Missing enabled boolean');
  }

  const state = setEnvironmentBridgeEnabled(body.enabled);
  return successResponse({ success: true, bridge: summarizeEnvironmentBridgeState(state) });
}
