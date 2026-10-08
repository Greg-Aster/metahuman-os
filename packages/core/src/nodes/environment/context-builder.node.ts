import { defineNode } from '../types.js';
import { withVisualObservationSchema } from '../../visual-observation.js';
import type { EnvironmentObservation, EnvironmentVisualFrame } from '../../environment-interface/index.js';
import {
  buildEnvironmentSelectorEnvelope,
  buildEnvironmentSelectorJsonSchema,
  buildEnvironmentSelectorSystemPrompt,
  projectEnvironmentHistory,
  type EnvironmentExecutionTarget,
} from './helpers.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function conversationMessages(
  value: unknown,
  includeRecent: boolean,
  currentInstruction: string,
): Array<{ role: string; content: string; timestamp?: string | number }> {
  if (!includeRecent) return [];
  const candidates = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.messages)
      ? value.messages
      : [];

  const messages = candidates
    .filter(isRecord)
    .map(message => ({
      role: typeof message.role === 'string' ? message.role : 'user',
      content: typeof message.content === 'string' ? message.content.trim() : '',
      ...(message.timestamp !== undefined ? { timestamp: message.timestamp as string | number } : {}),
    }))
    .filter(message => ['user', 'assistant'].includes(message.role) && message.content);

  // persona-chat persists the current user message before graph execution.
  // Do not send that same instruction twice when recent context is selected.
  const last = messages.at(-1);
  if (last?.role === 'user' && last.content === currentInstruction) messages.pop();
  return messages;
}

function relevantMemoryItems(value: unknown): Array<string | Record<string, unknown>> {
  const candidates = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.memories)
      ? value.memories
      : [];

  return candidates
    .flatMap(memory => typeof memory === 'string' && memory.trim()
      ? [memory.trim() as string | Record<string, unknown>]
      : isRecord(memory) && typeof memory.content === 'string' && memory.content.trim()
        ? [{ id: memory.id, type: memory.type, timestamp: memory.timestamp, content: memory.content.trim() }]
        : [])
    .slice(0, 3);
}

export const environmentContextBuilderNode = defineNode({
  id: 'environment_context_builder',
  name: 'Environment Context Builder',
  category: 'environment',
  inputs: [
    { name: 'activeExecutions', type: 'array', optional: true, description: 'Unfinished executions available for steering or cancellation' },
    { name: 'observationHistory', type: 'array', optional: true, description: 'Image-linked interpretations supplied by Observation History' },
    { name: 'execution', type: 'object', optional: true, description: 'Checkpointed objective and execution events' },
    { name: 'observation', type: 'object', optional: true, description: 'Environment observation selected for this turn' },
    { name: 'observationCurrent', type: 'boolean', optional: true, description: 'Whether the observation directly triggered this graph execution' },
    { name: 'instruction', type: 'string', optional: true, description: 'Additional task instruction' },
    { name: 'userInstruction', type: 'string', optional: true, description: 'Current human-authored instruction, when present' },
    { name: 'images', type: 'array', optional: true, description: 'Validated model image content parts' },
    { name: 'frames', type: 'array', optional: true, description: 'Frames selected alongside images, in the same order' },
    { name: 'conversationHistory', type: 'array', optional: true, description: 'Shared rolling conversation history' },
    { name: 'memories', type: 'array', optional: true, description: 'Relevant long-term conversational memories' },
    { name: 'personaText', type: 'string', optional: true, description: 'Formatted active persona supplied once to the selector' },
    { name: 'routingAnalysis', type: 'object', description: 'Intent Orchestrator route switches for this turn' },
    { name: 'robotStatus', type: 'object', optional: true, description: 'Reusable Robot Status supporting context' },
  ],
  outputs: [
    { name: 'frames', type: 'array', description: 'Exact source frames attached to this model call' },
    { name: 'message', type: 'string', description: 'Prompt-ready environment message' },
    { name: 'messages', type: 'array', description: 'Compact action-selector message array' },
    { name: 'jsonSchema', type: 'object', description: 'Provider schema constrained to currently advertised capabilities' },
    { name: 'context', type: 'object', description: 'Structured environment context package' },
    { name: 'currentInstruction', type: 'string', description: 'Current unchanged user instruction' },
    { name: 'instructionSource', type: 'string', description: 'Instruction provenance for this interactive workflow: user' },
    { name: 'location', type: 'object', description: 'Resolved location data' },
    { name: 'map', type: 'object', description: 'Resolved map data' },
    { name: 'images', type: 'array', description: 'Visual frames suitable for image-capable models' },
    { name: 'availableActions', type: 'array', description: 'Available action types' },
  ],
  properties: {
    systemPrompt: '',
  },
  propertySchemas: {
    systemPrompt: {
      type: 'text_multiline',
      default: '',
      label: 'System Prompt',
      rows: 5,
    },
  },
  description: 'Packages only the context selected by Intent Orchestrator for one Environment Action Selector call.',
  async execute(inputs, context, properties) {
    const routingAnalysis = isRecord(inputs.routingAnalysis)
      ? Object.fromEntries(Object.entries(inputs.routingAnalysis).filter(([, value]) => typeof value === 'boolean'))
      : {};
    const environmentSelected = routingAnalysis.needsEnvironment === true
      || routingAnalysis.needsVision === true
      || routingAnalysis.needsAction === true;
    const suppliedObservation = isRecord(inputs.observation)
      ? inputs.observation as unknown as EnvironmentObservation
      : null;
    // Intent selects optional evidence, not the interfaces the informed model
    // may use. Keep the adapter's capability catalog available after retrieval.
    const observation = suppliedObservation && (environmentSelected ? suppliedObservation : {
      adapter: suppliedObservation.adapter, environmentId: suppliedObservation.environmentId,
      sessionId: suppliedObservation.sessionId, timestamp: suppliedObservation.timestamp,
      capabilities: suppliedObservation.capabilities,
    });

    const location = observation?.location ?? null;
    const map = observation?.map ?? null;
    const images = Array.isArray(inputs.images)
      ? inputs.images.filter(part => isRecord(part) && part.type === 'image_url')
      : [];
    const effectiveObservation: EnvironmentObservation | null = observation;

    const systemPrompt = String(properties?.systemPrompt ?? '');
    const conversationalInstruction = typeof inputs.instruction === 'string'
      ? inputs.instruction.trim()
      : '';
    const personaText = typeof inputs.personaText === 'string'
      ? inputs.personaText.trim().slice(0, 2_000)
      : '';
    const robotStatus = isRecord(inputs.robotStatus) ? inputs.robotStatus : null;
    const userInstruction = typeof inputs.userInstruction === 'string'
      ? inputs.userInstruction.trim()
      : '';
    const rawInstruction = conversationalInstruction || userInstruction;
    const inputSource = 'user';
    const directUserTurn = Boolean(userInstruction);
    const replyToContent = directUserTurn && typeof context.replyToContent === 'string'
      ? context.replyToContent.trim().slice(0, 500)
      : '';
    const includeRecentHistory = routingAnalysis.needsConversationHistory === true
      && directUserTurn;
    const useImages = routingAnalysis.needsVision === true
      && images.length > 0;
    const selectedImages = useImages ? images : [];
    const selectedFrames = useImages && Array.isArray(inputs.frames)
      ? inputs.frames as EnvironmentVisualFrame[] : [];
    const execution = routingAnalysis.needsExecutionContext === true ? inputs.execution : null;
    const activeExecutions = routingAnalysis.needsExecutionContext === true && Array.isArray(inputs.activeExecutions)
      ? inputs.activeExecutions as EnvironmentExecutionTarget[] : [];
    const currentVision = useImages && inputs.observationCurrent === true;
    const actionRouteSelected = Boolean(observation?.capabilities.actions.length);
    const withoutUnselectedVision = effectiveObservation
      ? useImages
        ? effectiveObservation
        : { ...effectiveObservation, visual: undefined, visuals: undefined }
      : null;
    const promptObservation = withoutUnselectedVision && inputs.observationCurrent !== true
      ? {
          ...withoutUnselectedVision,
          feedback: [],
          metadata: {},
        }
      : withoutUnselectedVision;
    const suppliedHistory = projectEnvironmentHistory(inputs.conversationHistory);
    const history = conversationMessages(
      suppliedHistory.conversation,
      includeRecentHistory,
      rawInstruction,
    );
    const routedMemories = routingAnalysis.needsMemory === true ? inputs.memories : [];
    const memoryItems = [...new Set([
      ...relevantMemoryItems(routedMemories),
    ])].slice(0, 3);
    const selectorContext = buildEnvironmentSelectorSystemPrompt({
      systemPrompt,
    });
    const renderedContent = (content: string) => selectedImages.length
      ? [{
          type: 'text' as const,
          text: `The attached images are what you saw at the corresponding visualFrames times.\n${content}`,
        }, ...selectedImages]
      : content;
    const message = buildEnvironmentSelectorEnvelope({
      execution: execution ?? null,
      activeExecutions,
      instruction: rawInstruction,
      observation: promptObservation,
      visualFrames: selectedFrames,
      observationHistory: environmentSelected && Array.isArray(inputs.observationHistory) ? inputs.observationHistory : [],
      recentConversation: history,
      innerDialogue: includeRecentHistory ? suppliedHistory.innerDialogue : [],
      currentTime: typeof context.currentTime === 'string' ? context.currentTime : undefined,
      memories: memoryItems,
      personaText,
      robotStatus: routingAnalysis.needsRobotStatus === true ? robotStatus : null,
      replyToContent,
      inputSource,
      routing: routingAnalysis as Record<string, boolean>,
      currentObservation: inputs.observationCurrent === true,
      currentVisionAvailable: currentVision,
    });
    const jsonSchema = buildEnvironmentSelectorJsonSchema({
      activeExecutions,
      actions: promptObservation?.capabilities.actions ?? [],
      robotCommands: promptObservation?.capabilities.robotCommands ?? [],
      actionRouteSelected,
    });

    return {
      message,
      jsonSchema: withVisualObservationSchema(jsonSchema, selectedFrames),
      frames: selectedFrames,
      messages: [
        { role: 'system', content: selectorContext },
        {
          role: 'user',
          content: renderedContent(message),
        },
      ],
      context: {
        kind: 'environment',
        observation: effectiveObservation,
        state: effectiveObservation?.state ?? {},
        text: effectiveObservation?.text ?? [],
        location,
        map,
        visual: selectedFrames.at(-1) ?? null,
        visuals: selectedFrames,
        feedback: effectiveObservation?.feedback ?? [],
        conversationHistory: history,
        memories: Array.isArray(routedMemories)
          ? routedMemories
          : isRecord(routedMemories) && Array.isArray(routedMemories.memories)
            ? routedMemories.memories
            : [],
        personaIncluded: Boolean(personaText),
        robotStatusIncluded: routingAnalysis.needsRobotStatus === true && Boolean(robotStatus),
        routingAnalysis,
        contextSelection: {
          recentHistory: includeRecentHistory,
          recentHistoryCount: history.length,
          semanticMemory: memoryItems.length > 0,
        },
        contextAdmission: {
          environment: Boolean(effectiveObservation),
          vision: useImages,
          actionContracts: actionRouteSelected,
          selector: true,
        },
        imageSelection: {
          requested: routingAnalysis.needsVision === true,
          available: images.length,
          used: selectedImages.length,
        },
      },
      currentInstruction: rawInstruction,
      instructionSource: inputSource,
      location,
      map,
      images: selectedImages,
      availableActions: effectiveObservation?.capabilities.actions ?? [],
    };
  },
});
