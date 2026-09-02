export interface ReplyToMetadata {
  questionId?: string;
  content?: string;
  desireId?: string;
  desireTitle?: string;
}

export interface ConversationParamsInput {
  message: string;
  mode: string;
  reasoningDepth: number;
  sessionId: string;
  yoloMode: boolean;
  llmOptions?: Record<string, unknown>;
  replyTo?: ReplyToMetadata;
}

export interface ConversationStreamEvent<T = any> {
  type: string;
  data: T;
}

export interface ResponsePipelineRequestBody {
  message: string;
  cardType: string;
  cardData: Record<string, any>;
  responseBufferId?: string;
}

export interface SelectedReplyRouteInput {
  cognitiveMode: string;
  cardType?: string | null;
  questionId?: string | null;
  desireId?: string | null;
  dialogueSource?: string | null;
  isAgencyMessage?: boolean;
}

export interface EventSourceConnectionRef {
  name: string;
  source: EventSource | null;
  clear: () => void;
}

export function readLlmOptions(storage: Storage | undefined = globalThis.localStorage): Record<string, unknown> {
  if (!storage) return {};

  try {
    const raw = storage.getItem('llmOptions');
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function buildConversationParams(input: ConversationParamsInput): URLSearchParams {
  const params = new URLSearchParams({
    message: input.message,
    mode: input.mode,
    reason: String(input.reasoningDepth > 0),
    reasoningDepth: String(input.reasoningDepth),
    llm: JSON.stringify(input.llmOptions ?? {}),
    sessionId: input.sessionId,
    graph: 'true',
    yolo: String(input.yoloMode),
  });

  if (input.replyTo?.questionId) {
    params.set('replyToQuestionId', input.replyTo.questionId);
  }

  if (input.replyTo?.desireId) {
    params.set('replyToDesireId', input.replyTo.desireId);
    if (input.replyTo.desireTitle) {
      params.set('replyToDesireTitle', input.replyTo.desireTitle);
    }
  }

  if (input.replyTo?.content) {
    params.set('replyToContent', input.replyTo.content.substring(0, 500));
  }

  return params;
}

export function parseConversationStreamEvent(raw: string): ConversationStreamEvent {
  return JSON.parse(raw) as ConversationStreamEvent;
}

export function buildResponsePipelineRequestBody(
  message: string,
  cardType: string,
  cardData: Record<string, any>,
  responseBufferId?: string | null
): ResponsePipelineRequestBody {
  return {
    message: message.trim(),
    cardType,
    cardData,
    responseBufferId: responseBufferId || undefined,
  };
}

export function responsePipelineCardTypeForReply(input: SelectedReplyRouteInput): string | null {
  if (input.questionId) return 'curiosity_response';

  const agencyReply = input.isAgencyMessage === true || input.dialogueSource === 'agency-system';
  if (agencyReply) {
    if (input.cardType && input.cardType !== 'selected_card') return input.cardType;
    return input.desireId ? 'desire_awaiting_input' : 'agency_notification';
  }

  if (input.cognitiveMode === 'environment') return null;
  return input.cardType || 'selected_card';
}

export function closeEventSourceConnections(logPrefix: string, connections: EventSourceConnectionRef[]): number {
  let closedCount = 0;

  for (const connection of connections) {
    if (!connection.source) continue;

    console.log(`${logPrefix} → Closing ${connection.name}`);
    try {
      connection.source.close();
      connection.clear();
      closedCount++;
    } catch (error) {
      console.error(`${logPrefix} ❌ Error closing ${connection.name}:`, error);
    }
  }

  return closedCount;
}
