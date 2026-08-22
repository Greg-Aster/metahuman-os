import type {
  EnvironmentObservation,
  EnvironmentVisualFrame,
} from '../../environment-interface/index.js';
import { defineNode } from '../types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength)
    : '';
}

function correlationId(observation: EnvironmentObservation): string {
  const direct = cleanText(observation.metadata?.correlationId, 200);
  if (direct) return direct;
  const cycle = isRecord(observation.metadata?.robotObserver)
    ? observation.metadata.robotObserver
    : null;
  return cleanText(cycle?.cycleId, 200);
}

function frameSummary(frame: EnvironmentVisualFrame): Record<string, unknown> {
  return {
    id: frame.id,
    timestamp: frame.timestamp,
    mimeType: frame.mimeType,
    width: frame.width,
    height: frame.height,
    correlationId: cleanText(frame.metadata?.correlationId, 200) || undefined,
  };
}

function normalizedTags(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((tag): tag is string => typeof tag === 'string' && Boolean(tag.trim()))
        .map(tag => tag.trim().toLowerCase())
    : [];
}

function consolidatedHistory(value: unknown): Array<Record<string, unknown>> {
  const messages = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.messages)
      ? value.messages
      : [];
  const history: Array<Record<string, unknown>> = [];
  for (const message of messages.filter(isRecord)) {
    const meta = isRecord(message.meta) ? message.meta : null;
    const sourceRole = cleanText(message.role, 40).toLowerCase();
    const originalRole = cleanText(meta?.originalRole, 40).toLowerCase();
    const isInnerDialogue = meta?.isInnerDialogue === true;
    const role = isInnerDialogue
      ? 'assistant'
      : sourceRole === 'system' || sourceRole === 'user' || sourceRole === 'assistant'
        ? sourceRole
        : '';
    const content = cleanText(message.content, 4_000);
    if (!role || !content) continue;
    history.push({
      role,
      content,
      ...(typeof message.timestamp === 'number' || typeof message.timestamp === 'string'
        ? { timestamp: message.timestamp }
        : {}),
      ...(meta
        ? {
            context: {
              isInnerDialogue,
              originalRole: originalRole || null,
              dialogueSource: cleanText(meta.dialogueSource, 100) || null,
              tags: normalizedTags(meta.tags),
              taskLifecycle: boundedObject(meta.taskLifecycle, 2_000),
            },
          }
        : {}),
    });
  }
  return history;
}

function boundedObject(value: unknown, maxLength = 8_000): unknown {
  if (!isRecord(value) && !Array.isArray(value)) return value ?? null;
  try {
    const encoded = JSON.stringify(value);
    if (encoded.length <= maxLength) return value;
    return { truncatedJson: encoded.slice(0, maxLength) };
  } catch {
    return null;
  }
}

function selectedImageParts(
  observation: EnvironmentObservation,
  images: unknown,
  frames: unknown,
): Array<Record<string, unknown>> {
  if (!Array.isArray(images) || !Array.isArray(frames)) return [];
  const expectedCorrelationId = correlationId(observation);
  if (!expectedCorrelationId) return [];
  const frameList = frames.filter(isRecord) as unknown as EnvironmentVisualFrame[];
  const index = frameList.findIndex(frame => (
    cleanText(frame.metadata?.correlationId, 200) === expectedCorrelationId
  ));
  if (index < 0 || !isRecord(images[index]) || images[index].type !== 'image_url') return [];
  return [images[index]];
}

function robotTrigger(observation: EnvironmentObservation): Record<string, unknown> {
  const metadata = isRecord(observation.metadata) ? observation.metadata : null;
  const observer = isRecord(metadata?.robotObserver) ? metadata.robotObserver : null;
  const perceptionEvent = cleanText(metadata?.perceptionEvent, 100);
  const triggerSource = cleanText(observer?.triggerSource, 40);
  const requestedBy = cleanText(observer?.requestedBy, 100);
  return {
    type: perceptionEvent || (observer ? 'robot_observer' : 'environment_observation'),
    source: triggerSource || null,
    requestedBy: requestedBy || null,
    correlationId: correlationId(observation) || null,
    cycleId: cleanText(observer?.cycleId, 200) || null,
    step: typeof observer?.step === 'number' ? observer.step : null,
    maxSteps: typeof observer?.maxSteps === 'number' ? observer.maxSteps : null,
  };
}

function compactFeedback(observation: EnvironmentObservation): Array<Record<string, unknown>> {
  return (observation.feedback ?? []).slice(-8).map(feedback => ({
    id: feedback.id,
    timestamp: feedback.timestamp,
    type: feedback.type,
    message: cleanText(feedback.message, 1_000),
    actionId: feedback.actionId ?? null,
    data: boundedObject(feedback.data, 2_000),
  }));
}

export const robotOperatorContextBuilderNode = defineNode({
  id: 'robot_operator_context_builder',
  name: 'Robot Operator Context',
  category: 'operator',
  inputs: [
    { name: 'instruction', type: 'string', description: 'Graph-owned Robot Operator instructions' },
    { name: 'observation', type: 'object', description: 'Current correlated robot observation or agent-produced stimulus' },
    { name: 'images', type: 'array', optional: true, description: 'Validated image content parts' },
    { name: 'frames', type: 'array', optional: true, description: 'Validated visual frame metadata' },
    { name: 'conversationHistory', type: 'array', optional: true, description: 'Canonical recent conversation with unified inner context when enabled' },
    { name: 'personaText', type: 'string', optional: true, description: 'Formatted active persona' },
  ],
  outputs: [
    { name: 'messages', type: 'array', description: 'Multimodal messages for the configured Robot Operator LLM' },
    { name: 'context', type: 'object', description: 'Structured high-level deliberation context' },
    { name: 'valid', type: 'boolean', description: 'Whether the configured context is ready for deliberation' },
    { name: 'error', type: 'string', description: 'Visible configuration or input error' },
  ],
  properties: {},
  propertySchemas: {},
  description: 'Consolidates separately supplied instructions, conversation, inner context, persona, trigger metadata, and current robot perception for the Robot Operator LLM.',
  async execute(inputs) {
    const observation = isRecord(inputs.observation)
      ? inputs.observation as unknown as EnvironmentObservation
      : null;
    const instruction = cleanText(inputs.instruction, 8_000);
    const invalid = (error: string) => ({
      messages: [],
      context: null,
      valid: false,
      error,
    });
    if (!observation?.sessionId) return invalid('Robot Operator context requires a robot observation with a session ID.');
    if (!instruction) return invalid('Robot Operator context requires instructions from a connected text input node.');

    const recentContext = consolidatedHistory(inputs.conversationHistory);
    const innerContextCount = recentContext.filter(entry => (
      isRecord(entry.context) && entry.context.isInnerDialogue === true
    )).length;
    console.log(
      `[RobotOperatorContext] Consolidated context entries: ${recentContext.length}; inner entries: ${innerContextCount}`,
    );
    const personaText = typeof inputs.personaText === 'string'
      ? inputs.personaText.trim().slice(0, 12_000)
      : '';
    const images = selectedImageParts(observation, inputs.images, inputs.frames);
    const frames = [observation.visual, ...(observation.visuals ?? [])]
      .filter((frame): frame is EnvironmentVisualFrame => Boolean(frame))
      .map(frameSummary);
    const stimulus = {
      observedAt: observation.timestamp,
      trigger: robotTrigger(observation),
      state: boundedObject(observation.state, 8_000),
      location: boundedObject(observation.location, 4_000),
      map: boundedObject(observation.map, 4_000),
      capabilities: boundedObject(observation.capabilities, 4_000),
      feedback: compactFeedback(observation),
      text: (observation.text ?? []).slice(-8).map(event => ({
        source: event.source,
        sender: event.senderName ?? event.senderId ?? null,
        text: cleanText(event.text, 2_000),
        timestamp: event.timestamp,
      })),
      visualFrames: frames,
    };
    const stimulusText = JSON.stringify({ robotStimulus: stimulus });
    const userContent = images.length > 0
      ? [{ type: 'text', text: stimulusText }, ...images]
      : stimulusText;
    const supportingContext = personaText || recentContext.length > 0
      ? {
          role: 'assistant',
          content: JSON.stringify({
            robotOperatorContext: {
              activePersona: personaText || null,
              recentContext: {
                provenance: 'canonical_conversation_history',
                includesUnifiedInnerContext: innerContextCount > 0,
                entries: recentContext,
              },
              currentEvidence: false,
            },
          }),
        }
      : null;

    return {
      messages: [
        { role: 'system', content: instruction },
        ...(supportingContext ? [supportingContext] : []),
        { role: 'user', content: userContent },
      ],
      context: {
        instruction,
        stimulus,
        recentContext,
        personaIncluded: Boolean(personaText),
        recentContextCount: recentContext.length,
        innerContextCount,
        imageCount: images.length,
      },
      valid: true,
      error: '',
    };
  },
});
