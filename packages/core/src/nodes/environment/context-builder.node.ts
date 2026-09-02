import { defineNode } from '../types.js';
import type {
  EnvironmentLocationData,
  EnvironmentMapData,
  EnvironmentObservation,
  EnvironmentVisualFrame,
} from '../../environment-interface/index.js';
import { parseRobotObserverCycle } from '../../robot-operator.js';
import {
  buildEnvironmentSelectorEnvelope,
  buildEnvironmentSelectorJsonSchema,
  buildEnvironmentSelectorSystemPrompt,
  type EnvironmentTaskState,
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

function coerceVisualFrames(visual: unknown, visuals: unknown): EnvironmentVisualFrame[] {
  const frames: EnvironmentVisualFrame[] = [];
  if (isRecord(visual)) {
    frames.push(visual as unknown as EnvironmentVisualFrame);
  }
  if (Array.isArray(visuals)) {
    frames.push(...visuals.filter(isRecord).map(frame => frame as unknown as EnvironmentVisualFrame));
  }

  const seen = new Set<string>();
  return frames.filter(frame => {
    const key = frame.id ?? frame.url ?? frame.dataUrl;
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export const environmentContextBuilderNode = defineNode({
  id: 'environment_context_builder',
  name: 'Environment Context Builder',
  category: 'environment',
  inputs: [
    { name: 'observation', type: 'object', description: 'Environment observation' },
    { name: 'instruction', type: 'string', optional: true, description: 'Additional task instruction' },
    { name: 'userInstruction', type: 'string', optional: true, description: 'Current human-authored instruction, when present' },
    { name: 'inputSource', type: 'string', optional: true, description: 'Explicit instruction provenance from Instruction Resolver' },
    { name: 'location', type: 'object', optional: true, description: 'Optional graph-supplied location data' },
    { name: 'map', type: 'object', optional: true, description: 'Optional graph-supplied map data' },
    { name: 'visual', type: 'object', optional: true, description: 'Optional graph-supplied visual frame' },
    { name: 'visuals', type: 'array', optional: true, description: 'Optional graph-supplied visual frames' },
    { name: 'images', type: 'array', optional: true, description: 'Validated model image content parts' },
    { name: 'conversationHistory', type: 'array', optional: true, description: 'Shared rolling conversation history' },
    { name: 'memories', type: 'array', optional: true, description: 'Relevant long-term conversational memories' },
    { name: 'personaText', type: 'string', optional: true, description: 'Formatted active persona supplied once to the selector' },
    { name: 'routingAnalysis', type: 'object', optional: true, description: 'LLM-selected context policy for the current instruction' },
    { name: 'taskState', type: 'object', optional: true, description: 'Single typed Environment objective lifecycle state' },
    { name: 'preparedMovementRequest', type: 'object', optional: true, description: 'Already-authorized off-script request ready for Movement Generator' },
    { name: 'robotStatus', type: 'object', optional: true, description: 'Reusable Robot Status supporting context' },
    { name: 'robotObserver', type: 'object', optional: true, description: 'Robot Operator cycle from its dedicated input node' },
  ],
  outputs: [
    { name: 'message', type: 'string', description: 'Prompt-ready environment message' },
    { name: 'messages', type: 'array', description: 'Compact action-selector message array' },
    { name: 'jsonSchema', type: 'object', description: 'Provider schema constrained to currently advertised capabilities' },
    { name: 'context', type: 'object', description: 'Structured environment context package' },
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
  description: 'Builds environment context and attaches only fresh event-correlated robot vision.',
  async execute(inputs, context, properties) {
    const observation = inputs.observation as EnvironmentObservation | undefined;
    if (!observation) {
      return {
        message: '',
        messages: [],
        jsonSchema: null,
        context: null,
        location: null,
        map: null,
        images: [],
        availableActions: [],
      };
    }

    const location = isRecord(inputs.location)
      ? inputs.location as EnvironmentLocationData
      : observation.location ?? null;
    const map = isRecord(inputs.map)
      ? inputs.map as EnvironmentMapData
      : observation.map ?? null;
    const visualFrames = coerceVisualFrames(inputs.visual ?? observation.visual, inputs.visuals ?? observation.visuals);
    const images = Array.isArray(inputs.images)
      ? inputs.images.filter(part => isRecord(part) && part.type === 'image_url')
      : [];
    const effectiveObservation: EnvironmentObservation = {
      ...observation,
      ...(location ? { location } : {}),
      ...(map ? { map } : {}),
      ...(visualFrames[0] ? { visual: visualFrames[0] } : {}),
      ...(visualFrames.length ? { visuals: visualFrames } : {}),
    };

    const systemPrompt = String(properties?.systemPrompt ?? '');
    const conversationalInstruction = typeof inputs.instruction === 'string'
      ? inputs.instruction.trim()
      : '';
    const rawInstruction = conversationalInstruction;
    const routingAnalysis = isRecord(inputs.routingAnalysis) ? inputs.routingAnalysis : {};
    const taskState = isRecord(inputs.taskState)
      ? inputs.taskState as unknown as EnvironmentTaskState
      : null;
    const resumePreparedMovement = isRecord(inputs.preparedMovementRequest);
    const personaText = typeof inputs.personaText === 'string'
      ? inputs.personaText.trim().slice(0, 2_000)
      : '';
    const robotStatus = isRecord(inputs.robotStatus) ? inputs.robotStatus : null;
    const inputSource = inputs.inputSource === 'autonomy' ? 'autonomy' : 'user';
    const autonomous = inputSource === 'autonomy';
    const userInstruction = typeof inputs.userInstruction === 'string'
      ? inputs.userInstruction.trim()
      : '';
    const directUserTurn = inputSource === 'user' && Boolean(userInstruction);
    const replyToContent = directUserTurn && typeof context.replyToContent === 'string'
      ? context.replyToContent.trim().slice(0, 500)
      : '';
    const queuedContinuation = Boolean(taskState?.phase === 'evaluating_evidence' || taskState?.phase === 'awaiting_action');
    const boundedContinuation = queuedContinuation
      && taskState?.continuationPolicy === 'bounded';
    // Context routing may select history, memory, and vision, but it never owns
    // semantic action authority. The Environment LLM must always see the
    // adapter-advertised action contract so it can decide whether and how to act.
    const hasTypedContextAdmission = typeof routingAnalysis.needsAction === 'boolean'
      && typeof routingAnalysis.needsEnvironment === 'boolean'
      && typeof routingAnalysis.needsVision === 'boolean';
    const includeActionContracts = true;
    const includeEnvironmentContext = !hasTypedContextAdmission
      || routingAnalysis.needsEnvironment === true
      || routingAnalysis.needsVision === true
      || includeActionContracts;
    const requestedRecentHistory = routingAnalysis.isFollowUp === true && !queuedContinuation;
    const includeSemanticMemory = routingAnalysis.needsMemory === true;
    const recentHistoryLimit = Number.isInteger(properties?.recentHistoryLimit)
      ? Math.max(0, Number(properties?.recentHistoryLimit))
      : 4;
    const correlatedVisual = visualFrames.some(frame => (
      typeof frame.metadata?.correlationId === 'string'
    )) || typeof effectiveObservation.metadata?.correlationId === 'string';
    const robotObserver = parseRobotObserverCycle(inputs.robotObserver);
    const includeRecentHistory = requestedRecentHistory && !autonomous;
    // environment-perception metadata is attached to ordinary correlated audio
    // so later work can retain lifecycle identity. It is not, by itself, a request
    // to inspect the camera. Only an explicit boredom observation run bypasses typed
    // vision admission; ordinary audio remains owned by needsVision.
    const observerVisualEvidence = !directUserTurn
      && robotObserver?.requestedBy === 'boredom-observer';
    const visualRequiredByTask = taskState?.requiredCompletionBasis === 'visual_observation';
    const visualContinuation = queuedContinuation && visualRequiredByTask;
    const useImages = correlatedVisual && (
      !hasTypedContextAdmission
      || routingAnalysis.needsVision === true
      || visualRequiredByTask
      || observerVisualEvidence
    );
    const selectedImages = useImages ? images : [];
    const visualPromptObservation = useImages
      ? effectiveObservation
      : { ...effectiveObservation, visual: undefined, visuals: undefined };
    // Direct conversation starts a new Environment objective. Retain current
    // body state and capabilities, but do not project unrelated action lineage
    // from the adapter's latest observation into the selector prompt. During a
    // visual continuation, Task State owns motor lifecycle feedback; exposing
    // "completed" or "done" beside the frame can be mistaken for visual proof.
    const promptObservation = directUserTurn
      ? {
          ...visualPromptObservation,
          feedback: [],
          metadata: {},
        }
      : visualContinuation
        ? {
            ...visualPromptObservation,
            feedback: [],
          }
      : visualPromptObservation;
    const history = conversationMessages(
      inputs.conversationHistory,
      includeRecentHistory,
      recentHistoryLimit,
      rawInstruction,
    );
    const routedMemories = includeSemanticMemory ? inputs.memories : [];
    const memoryItems = [...new Set([
      ...relevantMemoryItems(routedMemories),
    ])].slice(0, 3);
    const selectorContext = buildEnvironmentSelectorSystemPrompt({
      systemPrompt,
      queuedContinuation,
      mustAdvanceTask: boundedContinuation,
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
      taskState,
      recentConversation: history,
      memories: memoryItems,
      personaText,
      robotStatus,
      replyToContent,
      mustSelectAction: routingAnalysis.needsAction === true,
      mustAdvanceTask: boundedContinuation,
      inputSource,
    });
    const jsonSchema = resumePreparedMovement
      ? null
      : buildEnvironmentSelectorJsonSchema({
          actions: promptObservation.capabilities.actions,
          robotCommands: promptObservation.capabilities.robotCommands,
          requireAction: routingAnalysis.needsAction === true,
          requireObjective: autonomous,
          requireProgress: boundedContinuation,
        });

    return {
      message,
      jsonSchema,
      messages: resumePreparedMovement
        ? []
        : [
            { role: 'system', content: selectorContext },
            {
              role: 'user',
              content: renderedContent(message),
            },
          ],
      context: {
        kind: 'environment',
        observation: effectiveObservation,
        state: effectiveObservation.state ?? {},
        text: effectiveObservation.text ?? [],
        location,
        map,
        visual: effectiveObservation.visual ?? null,
        visuals: effectiveObservation.visuals ?? [],
        feedback: effectiveObservation.feedback ?? [],
        conversationHistory: history,
        memories: Array.isArray(routedMemories)
          ? routedMemories
          : isRecord(routedMemories) && Array.isArray(routedMemories.memories)
            ? routedMemories.memories
            : [],
        personaIncluded: Boolean(personaText),
        robotStatusIncluded: Boolean(robotStatus),
        routingAnalysis,
        contextSelection: {
          recentHistory: includeRecentHistory,
          recentHistoryCount: history.length,
          semanticMemory: includeSemanticMemory,
        },
        contextAdmission: {
          typed: hasTypedContextAdmission,
          environment: includeEnvironmentContext,
          vision: useImages,
          actionContracts: includeActionContracts,
          selector: !resumePreparedMovement,
        },
        imageSelection: {
          requested: routingAnalysis.needsVision === true || visualRequiredByTask || observerVisualEvidence,
          available: images.length,
          used: selectedImages.length,
        },
      },
      location,
      map,
      images: selectedImages,
      availableActions: effectiveObservation.capabilities.actions,
    };
  },
});
