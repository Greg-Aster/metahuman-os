import { timingSafeEqual } from 'node:crypto';
import {
  badRequestResponse,
  errorResponse,
  streamResponse,
  successResponse,
  unauthorizedResponse,
  type UnifiedRequest,
  type UnifiedResponse,
} from '../types.js';
import {
  dispatchEnvironmentActions,
  publishEnvironmentObservation,
  readEnvironmentBridgeState,
  recordEnvironmentActionResult,
  setEnvironmentBridgeEnabled,
  summarizeEnvironmentBridgeState,
  subscribeEnvironmentActions,
  touchEnvironmentSession,
  type EnvironmentFeedback,
  type EnvironmentObservation,
} from '../../environment-interface/index.js';

const STREAM_HEARTBEAT_MS = 15_000;
const BRIDGE_TOKEN_ENV = 'MH_ENVIRONMENT_BRIDGE_TOKEN';
const FEEDBACK_TYPES = new Set<EnvironmentFeedback['type']>([
  'accepted',
  'rejected',
  'completed',
  'cancelled',
  'expired',
  'failed',
  'status',
]);

function requestHeader(req: UnifiedRequest, name: string): string | undefined {
  const target = name.toLowerCase();
  return Object.entries(req.headers ?? {}).find(([key]) => key.toLowerCase() === target)?.[1];
}

function bridgeAuthorizationFailure(req: UnifiedRequest): UnifiedResponse | null {
  const expected = process.env[BRIDGE_TOKEN_ENV]?.trim();
  if (!expected) {
    return errorResponse(`Environment bridge is unavailable until ${BRIDGE_TOKEN_ENV} is configured`, 503);
  }

  const authorization = requestHeader(req, 'authorization');
  const supplied = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  if (expectedBytes.length !== suppliedBytes.length || !timingSafeEqual(expectedBytes, suppliedBytes)) {
    return unauthorizedResponse('Valid environment bridge service token required');
  }
  return null;
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
  if (
    typeof value.type !== 'string' ||
    !FEEDBACK_TYPES.has(value.type as EnvironmentFeedback['type']) ||
    typeof value.message !== 'string'
  ) {
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
  return successResponse(summarizeEnvironmentBridgeState());
}

export async function handleEnvironmentBridgeObservation(req: UnifiedRequest): Promise<UnifiedResponse> {
  const authorizationFailure = bridgeAuthorizationFailure(req);
  if (authorizationFailure) return authorizationFailure;

  const body = bodyRecord(req);
  if (!isObservation(body)) {
    return badRequestResponse('Invalid environment observation payload');
  }

  try {
    const observation = body as unknown as EnvironmentObservation;
    const username = requestHeader(req, 'x-metahuman-environment-user')?.trim() ?? '';
    const graph = requestHeader(req, 'x-metahuman-environment-graph')?.trim() || 'environment';
    const graphQueued = Boolean(username) && /^[a-zA-Z0-9_-]{1,80}$/.test(graph);
    const published = publishEnvironmentObservation(observation, {
      username: graphQueued ? username : undefined,
      graph: graphQueued ? graph : undefined,
    });
    return successResponse({ success: true, bridge: published.summary, graphQueued, workId: published.workId });
  } catch (error) {
    return errorResponse((error as Error).message);
  }
}

export async function handleEnvironmentBridgeStream(req: UnifiedRequest): Promise<UnifiedResponse> {
  const authorizationFailure = bridgeAuthorizationFailure(req);
  if (authorizationFailure) return authorizationFailure;

  const sessionId = req.query?.sessionId;
  if (!sessionId) {
    return badRequestResponse('Missing sessionId');
  }

  const limit = req.query?.limit ? Math.max(1, Math.min(50, Number(req.query.limit))) : 10;
  const response = streamResponse(streamEnvironmentActions(
    sessionId,
    Number.isFinite(limit) ? limit : 10,
    req.signal,
  ));

  return {
    ...response,
    headers: {
      ...response.headers,
      'X-Accel-Buffering': 'no',
    },
  };
}

export async function handleEnvironmentBridgeActionResult(req: UnifiedRequest): Promise<UnifiedResponse> {
  const authorizationFailure = bridgeAuthorizationFailure(req);
  if (authorizationFailure) return authorizationFailure;

  const feedback = buildFeedback(bodyRecord(req));
  if (!feedback) {
    return badRequestResponse('Invalid action result payload');
  }

  const action = recordEnvironmentActionResult(feedback);
  return successResponse({ success: true, action });
}

export async function handleEnvironmentBridgeControl(req: UnifiedRequest): Promise<UnifiedResponse> {
  const body = bodyRecord(req);
  if (typeof body.enabled !== 'boolean') {
    return badRequestResponse('Missing enabled boolean');
  }

  const state = setEnvironmentBridgeEnabled(body.enabled);
  return successResponse({ success: true, bridge: summarizeEnvironmentBridgeState(state) });
}

function sse(event: string, data: Record<string, unknown>): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function* streamEnvironmentActions(
  sessionId: string,
  limit: number,
  signal: AbortSignal | undefined,
): AsyncGenerator<string> {
  const queue: string[] = [];
  let wake: (() => void) | undefined;
  let closed = false;

  const push = (event: string, data: Record<string, unknown>) => {
    if (closed) {
      return;
    }
    queue.push(sse(event, data));
    wake?.();
    wake = undefined;
  };

  const close = () => {
    closed = true;
    wake?.();
    wake = undefined;
  };

  const dispatch = () => {
    if (closed) {
      return;
    }

    const state = readEnvironmentBridgeState();
    if (!state.enabled) {
      push('status', { enabled: false, actions: [] });
      return;
    }

    const actions = dispatchEnvironmentActions(sessionId, limit);
    if (actions.length > 0) {
      push('actions', { enabled: true, actions });
    }
  };

  const unsubscribe = subscribeEnvironmentActions(sessionId, dispatch);
  signal?.addEventListener('abort', close, { once: true });
  touchEnvironmentSession(sessionId);

  push('connected', {
    sessionId,
    enabled: readEnvironmentBridgeState().enabled,
    serverTime: new Date().toISOString(),
  });
  dispatch();

  try {
    while (!closed || queue.length > 0) {
      if (queue.length === 0) {
        await Promise.race([
          new Promise<void>((resolve) => {
            wake = resolve;
          }),
          new Promise<void>((resolve) => setTimeout(resolve, STREAM_HEARTBEAT_MS)),
        ]);
        if (!closed && queue.length === 0) {
          touchEnvironmentSession(sessionId);
          push('heartbeat', {
            sessionId,
            enabled: readEnvironmentBridgeState().enabled,
            serverTime: new Date().toISOString(),
          });
        }
        if (wake) {
          wake = undefined;
        }
        continue;
      }
      yield queue.shift()!;
    }
  } finally {
    unsubscribe();
    signal?.removeEventListener('abort', close);
    close();
  }
}
