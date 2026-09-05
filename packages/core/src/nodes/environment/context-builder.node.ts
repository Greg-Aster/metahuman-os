import { defineNode } from '../types.js';
import type { EnvironmentObservation } from '../../environment-interface/index.js';
import {
  buildEnvironmentSelectorEnvelope,
  buildEnvironmentSelectorJsonSchema,
  buildEnvironmentSelectorSystemPrompt,
} from './helpers.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function conversationMessages(
  value: unknown,
  includeRecent: boolean,
  recentLimit: number,
  currentInstruction: string,
): Array<{ role: string; content: string }> {
  if (!includeRecent || recentLimit <= 0) return [];
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
    }))
    .filter(message => ['user', 'assistant'].includes(message.role) && message.content);

  // persona-chat persists the current user message before graph execution.
  // Do not send that same instruction twice when recent context is selected.
  const last = messages.at(-1);
  if (last?.role === 'user' && last.content === currentInstruction) messages.pop();
  return messages.slice(-recentLimit);
}

function relevantMemoryItems(value: unknown): string[] {
  const candidates = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.memories)
      ? value.memories
      : [];

  return candidates
    .map(memory => typeof memory === 'string'
      ? memory.trim()
      : isRecord(memory) && typeof memory.content === 'string'
        ? memory.content.trim()
        : '')
    .filter(Boolean)
    .slice(0, 3);
}

export const environmentContextBuilderNode = defineNode({
  id: 'environment_context_builder',
  name: 'Environment Context Builder',
  category: 'environment',
  inputs: [
    { name: 'observation', type: 'object', optional: true, description: 'Environment observation selected for this turn' },
    { name: 'observationCurrent', type: 'boolean', optional: true, description: 'Whether the observation directly triggered this graph execution' },
    { name: 'instruction', type: 'string', optional: true, description: 'Additional task instruction' },
    { name: 'userInstruction', type: 'string', optional: true, description: 'Current human-authored instruction, when present' },
    { name: 'images', type: 'array', optional: true, description: 'Validated model image content parts' },
    { name: 'conversationHistory', type: 'array', optional: true, description: 'Shared rolling conversation history' },
    { name: 'memories', type: 'array', optional: true, description: 'Relevant long-term conversational memories' },
    { name: 'personaText', type: 'string', optional: true, description: 'Formatted active persona supplied once to the selector' },
    { name: 'routingAnalysis', type: 'object', description: 'Intent Orchestrator route switches for this turn' },
    { name: 'robotStatus', type: 'object', optional: true, description: 'Reusable Robot Status supporting context' },
  ],
  outputs: [
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
    recentHistoryLimit: 4,
  },
  propertySchemas: {
    systemPrompt: {
      type: 'text_multiline',
      default: '',
      label: 'System Prompt',
      rows: 5,
    },
    recentHistoryLimit: {
      type: 'slider',
      default: 4,
      label: 'Recent History Limit',
      description: 'Maximum dialogue messages included when the context router marks the instruction as a follow-up.',
      min: 0,
      max: 12,
      step: 1,
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
    const observation = environmentSelected && isRecord(inputs.observation)
      ? inputs.observation as unknown as EnvironmentObservation
      : null;

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
    const recentHistoryLimit = Number.isInteger(properties?.recentHistoryLimit)
      ? Math.max(0, Number(properties?.recentHistoryLimit))
      : 4;
    const includeRecentHistory = routingAnalysis.needsConversationHistory === true
      && directUserTurn;
    const useImages = routingAnalysis.needsVision === true
      && inputs.observationCurrent === true
      && images.length > 0;
    const selectedImages = useImages ? images : [];
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
    const history = conversationMessages(
      inputs.conversationHistory,
      includeRecentHistory,
      recentHistoryLimit,
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
          text: selectedImages.length === 1
            ? `The attached image is what you currently see.\n${content}`
            : `The attached images are what you saw at the corresponding visualFrames times.\n${content}`,
        }, ...selectedImages]
      : content;
    const message = buildEnvironmentSelectorEnvelope({
      instruction: rawInstruction,
      observation: promptObservation,
      recentConversation: history,
      memories: memoryItems,
      personaText,
      robotStatus: routingAnalysis.needsRobotStatus === true ? robotStatus : null,
      replyToContent,
      inputSource,
      routing: routingAnalysis as Record<string, boolean>,
      currentObservation: inputs.observationCurrent === true,
      currentVisionAvailable: selectedImages.length > 0,
    });
    const jsonSchema = buildEnvironmentSelectorJsonSchema({
      actions: promptObservation?.capabilities.actions ?? [],
      robotCommands: promptObservation?.capabilities.robotCommands ?? [],
      actionRouteSelected: routingAnalysis.needsAction === true
        || (routingAnalysis.needsVision === true && selectedImages.length === 0),
      taskLifecycleSelected: routingAnalysis.needsTaskLifecycle === true,
    });

    return {
      message,
      jsonSchema,
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
        visual: useImages ? effectiveObservation?.visual ?? null : null,
        visuals: useImages ? effectiveObservation?.visuals ?? [] : [],
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
          actionContracts: routingAnalysis.needsAction === true
            || (routingAnalysis.needsVision === true && !useImages),
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
