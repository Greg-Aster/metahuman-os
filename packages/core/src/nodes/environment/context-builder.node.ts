import { readRobotStatusLive } from '../../robot-status-live.js';
import { serializeContext } from '../../context-serialization.js';
import { selectedEnvironmentRoutes } from './context-routing.js';
import { resolveMemoryWork } from '../memory/memory-router.node.js';
import { defineNode } from '../types.js';
import { PLANNING_DELEGATION_DESCRIPTION } from './planning-contract.js';
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
    { name: 'toolWork', type: 'object', optional: true, description: 'Attributed delegated-work identity, state, result, and error.' },
    { name: 'plannerDecision', type: 'object', optional: true, description: 'Internally authored intention with its recorded observation, reason and time' },
    { name: 'robotObserver', type: 'object', optional: true, description: 'Source and cycle identity of the internally authored intention' },
    { name: 'sourceObservationAt', type: 'string', optional: true, description: 'Recorded observation time supplied with the planner intention' },
    { name: 'delegatedMemories', type: 'array', optional: true, description: 'Historical memories supplied with the planner intention' },
    { name: 'memoryWork', type: 'object', optional: true, description: 'Coordinator lookup selected by intent' },
    { name: 'sourceObservation', type: 'object', optional: true, description: 'Environment observation supplied before task execution' },
    { name: 'sourceExecution', type: 'object', optional: true, description: 'Execution context supplied before task execution' },
    { name: 'selectedContext', type: 'object', optional: true, description: 'Already selected evidence package from the task context builder' },
    { name: 'selectedTask', type: 'object', optional: true, description: 'Parsed task selection and its admission result' },
    { name: 'program', type: 'object', optional: true, description: 'Program admitted by the task parser for execution, or null' },
    { name: 'taskResult', type: 'object', optional: true, description: 'Returned program progress, evidence and failure from the execution owner' },
    { name: 'resultImages', type: 'array', optional: true, description: 'Validated camera images returned by the selected program' },
    { name: 'resultFrames', type: 'array', optional: true, description: 'Recorded identities and times of the returned images' },
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
    { name: 'routingAnalysis', type: 'object', optional: true, description: 'Intent Orchestrator route switches for this turn' },
    { name: 'robotStatus', type: 'object', optional: true, description: 'Reusable Robot Status supporting context' },
  ],
  outputs: [
    { name: 'activeExecutions', type: 'array', description: 'Execution targets supplied to this task decision and its parser' },
    { name: 'currentVisualEvidence', type: 'boolean', description: 'Current images supplied to this task decision' },
    { name: 'receivedInput', type: 'object', description: 'Input received while awaiting selected context' },
    { name: 'selectedContext', type: 'object', description: 'Selected evidence reused by the conversation context builder without new retrieval' },
    { name: 'precomputedResponse', type: 'string', optional: true, description: 'Saved task interpretation for the connected task model only' },
    { name: 'frames', type: 'array', description: 'Exact source frames attached to this model call' },
    { name: 'message', type: 'string', description: 'Prompt-ready environment message' },
    { name: 'messages', type: 'array', description: 'Compact action-selector message array' },
    { name: 'planningMessages', type: 'array', description: 'Original task messages for optional larger-model planning' },
    { name: 'planningSchema', type: 'object', description: 'Original task schema without delegation' },
    { name: 'jsonSchema', type: 'object', description: 'Provider schema constrained to currently advertised capabilities' },
    { name: 'context', type: 'object', description: 'Structured environment context package' },
    { name: 'currentInstruction', type: 'string', description: 'Current user message or internally authored intention' },
    { name: 'instructionSource', type: 'string', description: 'Instruction provenance: user or autonomy' },
    { name: 'location', type: 'object', description: 'Resolved location data' },
    { name: 'map', type: 'object', description: 'Resolved map data' },
    { name: 'images', type: 'array', description: 'Visual frames suitable for image-capable models' },
    { name: 'availableActions', type: 'array', description: 'Available action types' },
  ],
  properties: {
    purpose: 'combined',
    planningDelegation: false,
    systemPrompt: '',
  },
  propertySchemas: {
    planningDelegation: { type: 'boolean', default: false, label: 'Allow Planning Delegation', description: 'Expose the approved optional larger-model planning output for task-only decisions.' },
    purpose: { type: 'select', default: 'combined', label: 'Context Purpose',
      description: 'Task and conversation select their own evidence. Combined preserves the contract of existing saved graphs.',
      options: [{ value: 'combined', label: 'Combined Selection' }, { value: 'task', label: 'Task Decision' }, { value: 'conversation', label: 'Conversation' }] },
    systemPrompt: {
      type: 'text_multiline',
      default: '',
      label: 'System Prompt',
      description: 'Editable instructions for the connected model call.',
      rows: 5,
    },
  },
  description: 'Builds independently selected task or conversation context from shared sources and correlated recall. Conversation includes the validated selection and returned evidence.',
  async execute(inputs, context, properties) {

    // An interrupted program hands input to continuation before conversation recall.
    if (properties?.purpose === 'conversation' && inputs.program && inputs.taskResult?.done !== true) return {};
    const consumer = properties?.purpose === 'conversation' ? 'conversation' : 'task';
    const routingAnalysis = selectedEnvironmentRoutes(isRecord(inputs.routingAnalysis) ? inputs.routingAnalysis : {}, consumer);
    const recalled = routingAnalysis.needsMemory === true && inputs.memoryWork
      ? await resolveMemoryWork(inputs.memoryWork, context) : undefined;
    const environmentSelected = routingAnalysis.needsEnvironment === true || routingAnalysis.needsVision === true
      || (!Array.isArray(inputs.routingAnalysis?.taskContext) && routingAnalysis.needsAction === true);
    const initialObservation = consumer === 'conversation' ? inputs.sourceObservation : inputs.observation;
    const suppliedObservation = isRecord(initialObservation)
      ? initialObservation as unknown as EnvironmentObservation
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
    const personaText = (Array.isArray(inputs.routingAnalysis?.taskContext) ? routingAnalysis.needsPersona : true) && typeof inputs.personaText === 'string'
      ? inputs.personaText.trim().slice(0, 2_000)
      : '';
    const liveStatus = (routingAnalysis.needsRobotStatus === true || environmentSelected
      || (consumer === 'conversation' && Array.isArray(inputs.resultImages) && inputs.resultImages.length > 0)) && typeof context.username === 'string'
      ? await readRobotStatusLive(context.username, suppliedObservation?.sessionId ?? inputs.robotStatus?.body?.sessionId) : undefined;
    const robotStatus = routingAnalysis.needsRobotStatus === true
      ? { ...(isRecord(inputs.robotStatus) ? inputs.robotStatus : {}), ...(liveStatus ? { live: liveStatus } : {}) } : null;
    const userInstruction = typeof inputs.userInstruction === 'string'
      ? inputs.userInstruction.trim()
      : '';
    const plannerDecision = !userInstruction && !conversationalInstruction && isRecord(inputs.plannerDecision)
      && typeof inputs.plannerDecision.instruction === 'string' ? inputs.plannerDecision : null;
    const rawInstruction = conversationalInstruction || userInstruction
      || (typeof plannerDecision?.instruction === 'string' ? plannerDecision.instruction : '');
    const inputSource = plannerDecision ? 'autonomy' : 'user';
    const directUserTurn = Boolean(userInstruction);
    const replyToContent = directUserTurn && typeof context.replyToContent === 'string'
      ? context.replyToContent.trim().slice(0, 500)
      : '';
    const includeRecentHistory = routingAnalysis.needsConversationHistory === true
      && (directUserTurn || Boolean(plannerDecision));
    const useImages = routingAnalysis.needsVision === true
      && images.length > 0;
    const selectedImages = useImages ? images : [];
    const selectedFrames = useImages && Array.isArray(inputs.frames)
      ? inputs.frames as EnvironmentVisualFrame[] : [];
    const execution = routingAnalysis.needsExecutionContext === true ? (consumer === 'conversation' ? inputs.sourceExecution : inputs.execution) : null;
    const activeExecutions = routingAnalysis.needsExecutionContext === true && Array.isArray(inputs.activeExecutions)
      ? inputs.activeExecutions as EnvironmentExecutionTarget[] : [];
    const observationFrameIds = new Set([
      suppliedObservation?.visual?.id,
      ...(suppliedObservation?.visuals ?? []).map(frame => frame.id),
    ].filter(Boolean));
    const currentVision = useImages && inputs.observationCurrent === true
      && selectedFrames.some(frame => observationFrameIds.has(frame.id));
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
    const routedMemories = routingAnalysis.needsMemory === true ? (recalled?.memories ?? inputs.memories) : [];
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
    const envelope = buildEnvironmentSelectorEnvelope({
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
      robotStatus,
      liveStatus: robotStatus || !environmentSelected ? undefined : liveStatus,
      recognition: liveStatus?.recognition,
      replyToContent,
      inputSource,
      routing: routingAnalysis as Record<string, boolean>,
      currentObservation: inputs.observationCurrent === true,
      currentVisionAvailable: currentVision,
    });
    const message = plannerDecision ? JSON.stringify({ ...JSON.parse(envelope), plannerDecision,
      robotObserver: inputs.robotObserver ?? null,
      sourceObservationAt: inputs.sourceObservationAt ?? null,
      delegatedMemories: relevantMemoryItems(inputs.delegatedMemories),
    }) : envelope;
    if (properties?.purpose === 'conversation') {
      const selected = Array.isArray(inputs.routingAnalysis?.conversationContext) ? JSON.parse(message) : inputs.selectedContext;
      const { capabilityRules: _rules, ...evidence } = selected;
      if (evidence.robotStatus?.live && liveStatus) evidence.robotStatus = { ...evidence.robotStatus, live: liveStatus };
      if (evidence.currentEnvironment && liveStatus) {
        // Rebuild frame association and ages for this model call, including saved
        // task context. A recent detection is not necessarily in an attached still.
        evidence.currentEnvironment.recognition = JSON.parse(buildEnvironmentSelectorEnvelope({
          instruction: rawInstruction, observation: suppliedObservation,
          visualFrames: selectedFrames.length ? selectedFrames : (inputs.frames ?? []),
          recognition: liveStatus.recognition,
        })).currentEnvironment?.recognition;
      }
      const environment = evidence.currentEnvironment;
      const catalog = environment?.capabilities?.robotCommandCatalog ?? {};
      const selectedTask = inputs.selectedTask ?? {};
      const commands = (selectedTask.program?.steps ?? [])
        .filter((step: any) => step.kind === 'action' && step.action.type === 'robotCommand')
        .map((step: any) => step.action.command as string);
      const commandDescriptions = Object.fromEntries(commands
        .filter((command: string) => typeof catalog[command] === 'string')
        .map((command: string) => [command, catalog[command]]));
      const taskResult = inputs.taskResult;
      const hasReturnedImages = Array.isArray(inputs.resultImages) && inputs.resultImages.length > 0;
      const returned = taskResult && isRecord(inputs.observation)
        ? JSON.parse(buildEnvironmentSelectorEnvelope({ instruction: evidence.currentInstruction,
            observation: inputs.observation as unknown as EnvironmentObservation,
            visualFrames: hasReturnedImages ? inputs.resultFrames : (selectedFrames.length ? selectedFrames : (inputs.frames ?? [])),
            recognition: liveStatus?.recognition }))
        : undefined;
      // Retain dated input images when this program returned none. Their old
      // frame times remain explicit alongside the new action evidence.
      if (returned && !hasReturnedImages) returned.currentEnvironment.visualFrames = environment?.visualFrames ?? [];
      const conversationMessage = serializeContext({ ...evidence,
        ...(inputs.toolWork ? { toolWork: inputs.toolWork } : inputs.routingAnalysis?.needsToolUse === true
          ? { toolWork: { state: 'selected', request: rawInstruction } } : {}),
        ...(returned ? { currentEnvironment: returned.currentEnvironment,
          evidenceAvailability: returned.evidenceAvailability } : {}),
        ...(taskResult ? { execution: inputs.execution ?? evidence.execution,
          taskResult: { done: taskResult.done, objectiveComplete: taskResult.objectiveComplete,
            stepIndex: taskResult.stepIndex, evidence: taskResult.evidence,
            failure: taskResult.failure, capturedFrameIds: taskResult.capturedFrameIds } } : {}),
        selectedTask: { ...selectedTask, commandDescriptions } });
      const images = hasReturnedImages ? inputs.resultImages : Array.isArray(inputs.routingAnalysis?.conversationContext)
        ? selectedImages : (Array.isArray(inputs.images) ? inputs.images : []);
      return { receivedInput: recalled?.receivedInput, selectedContext: evidence, message: conversationMessage, messages: [
        { role: 'system', content: String(properties.systemPrompt ?? '').trim() },
        { role: 'user', content: images.length ? [
          { type: 'text', text: `The attached images are what you saw at the corresponding visualFrames times.\n${conversationMessage}` }, ...images,
        ] : conversationMessage },
      ] };
    }

    const jsonSchema = buildEnvironmentSelectorJsonSchema({
      includeResponse: properties?.purpose !== 'task',
      activeExecutions,
      actions: promptObservation?.capabilities.actions ?? [],
      robotCommands: promptObservation?.capabilities.robotCommands ?? [],
      expressions: promptObservation?.capabilities.expressionLibrary?.map(entry => entry.name) ?? [],
      actionRouteSelected,
    });

    const modelMessage = serializeContext(JSON.parse(message));
    const planningSchema = withVisualObservationSchema(jsonSchema, selectedFrames);
    const planningMessages = [
      { role: 'system', content: selectorContext },
      { role: 'user', content: renderedContent(modelMessage) },
    ];
    const delegation = properties?.purpose === 'task' && properties.planningDelegation === true;
    const delegatedSchema = delegation ? { ...planningSchema, anyOf: [...planningSchema.anyOf, {
      type: 'object', description: PLANNING_DELEGATION_DESCRIPTION,
      properties: { delegatePlanning: { const: true } }, required: ['delegatePlanning'], additionalProperties: false,
    }] } : planningSchema;
    return {
      planningMessages, planningSchema,
      activeExecutions, currentVisualEvidence: currentVision,
      receivedInput: recalled?.receivedInput,
      selectedContext: JSON.parse(message),
      precomputedResponse: context.environmentInterpretation?.response
        ?? (routingAnalysis.needsToolUse === true && routingAnalysis.needsAction !== true
          ? JSON.stringify({ taskDecision: null, program: null }) : undefined),
      message,
      jsonSchema: delegatedSchema,
      frames: selectedFrames,
      messages: [
        { role: 'system', content: delegation ? `${selectorContext}\n\n${PLANNING_DELEGATION_DESCRIPTION}` : selectorContext },
        {
          role: 'user',
          content: renderedContent(modelMessage),
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
