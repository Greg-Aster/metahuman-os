import type { UnifiedRequest, UnifiedResponse, UnifiedUser } from '../api/types.js';
import { withUserContext } from '../context.js';
import type { WorkHandlerContext } from './execution-engine.js';
import type { QueuedTask } from './types.js';

type ChatKind = 'persona' | 'response-pipeline';

function sse(type: string, data: Record<string, any>): string {
  return `data: ${JSON.stringify({ type, data })}\n\n`;
}

function streamError(chunk: string): string | undefined {
  for (const line of chunk.split('\n')) {
    if (!line.startsWith('data:')) continue;
    try {
      const event = JSON.parse(line.slice(5).trim());
      if (event?.type === 'error') {
        return String(event?.data?.message || event?.error || 'Chat work failed');
      }
    } catch {
      // A later chunk may finish a split event.
    }
  }
  return undefined;
}

function requestFor(
  task: QueuedTask,
  body: Record<string, any>,
  signal: AbortSignal,
): UnifiedRequest {
  const storedUser = task.metadata?.requestUser as UnifiedUser | undefined;
  const user: UnifiedUser = storedUser || {
    userId: task.username,
    id: task.username,
    username: task.username,
    role: 'standard',
    isAuthenticated: true,
  };
  return {
    path: task.handler === 'chat.response-pipeline' ? '/api/response-pipeline' : '/api/persona_chat',
    method: 'POST',
    body,
    user,
    signal,
    sessionId: task.metadata?.requestSessionId,
    metadata: task.metadata?.requestMetadata,
  };
}

async function drainResponse(
  response: UnifiedResponse,
  context: WorkHandlerContext,
): Promise<Record<string, any>> {
  let emittedError: string | undefined;
  if (response.stream) {
    for await (const chunk of response.stream) {
      if (context.signal.aborted) throw new DOMException('Chat work cancelled', 'AbortError');
      emittedError ||= streamError(chunk);
      context.emit(chunk);
    }
  } else if (response.status >= 400 || response.error || response.data?.error) {
    throw new Error(response.error || String(response.data?.error || `Chat work failed (${response.status})`));
  } else if (response.data) {
    context.emit(sse('answer', response.data));
  }
  if (emittedError) throw new Error(emittedError);
  return { status: response.status };
}

export async function executeChatWork(
  kind: ChatKind,
  task: QueuedTask,
  context: WorkHandlerContext,
): Promise<Record<string, any>> {
  const sessionId = String(
    kind === 'response-pipeline'
      ? task.input.responsePipeline?.sessionId || ''
      : task.input.personaChat?.sessionId || '',
  );
  const abort = async () => {
    if (!sessionId) return;
    const { requestCancellation } = await import('../graph-streaming.js');
    requestCancellation(sessionId, 'Coordinator work cancelled');
  };
  context.signal.addEventListener('abort', () => { void abort(); }, { once: true });

  const request = requestFor(
    task,
    kind === 'response-pipeline'
      ? { ...(task.input.responsePipeline || {}), streaming: true }
      : task.input.personaChat || {},
    context.signal,
  );

  return withUserContext(
    {
      userId: request.user.userId,
      username: request.user.username,
      role: request.user.role,
    },
    async () => {
      const response = kind === 'response-pipeline'
        ? await import('../api/handlers/response-pipeline.js').then(({ handleResponsePipelineApi }) =>
            handleResponsePipelineApi(request))
        : await import('../api/handlers/persona-chat.js').then(({ handlePersonaChat }) =>
            handlePersonaChat(request));

      return drainResponse(response, context);
    },
  );
}
