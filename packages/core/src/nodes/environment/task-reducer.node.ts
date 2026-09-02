import {
  validEnvironmentJpegDataUrl,
  type EnvironmentAction,
  type EnvironmentFeedback,
  type EnvironmentVisualFrame,
} from '../../environment-interface/index.js';
import { defineNode } from '../types.js';
import {
  encodeEnvironmentTaskState,
  type EnvironmentActionPurpose,
  type EnvironmentCompletionBasis,
  type EnvironmentPendingMovementContract,
  type EnvironmentTaskDecision,
  type EnvironmentTaskState,
} from './helpers.js';
import {
  cleanEnvironmentText,
  currentEnvironmentEvidenceFrame,
  environmentEvidenceMode,
  environmentLifecycleDecision,
  environmentMovementPreparationRequest,
  environmentSelectedAction,
  environmentTaskFrameRef,
  environmentVisualEvidenceAvailable,
  isEnvironmentRecord,
} from './task-lifecycle.js';

export const environmentTaskReducerNode = defineNode({
  id: 'environment_task_reducer',
  name: 'Environment Task Reducer',
  category: 'environment',
  inputs: [
    { name: 'taskState', type: 'object', description: 'Prepared task state' },
    { name: 'userInstruction', type: 'string', optional: true, description: 'Current human-authored instruction, when present' },
    { name: 'inputSource', type: 'string', description: 'Instruction provenance: user or autonomy' },
    { name: 'terminalFeedback', type: 'object', optional: true, description: 'Exact feedback from Environment Feedback Correlator' },
    { name: 'environmentState', type: 'object', optional: true, description: 'Current state from Environment Bridge Input' },
    { name: 'operatorActionRequired', type: 'boolean', description: 'Whether Robot Operator requested a physical consequence' },
    { name: 'deterministicComplete', type: 'boolean', description: 'Exact one-step user action completion from Prepare Environment Decision' },
    { name: 'actions', type: 'array', optional: true, description: 'Capability-validated semantic actions' },
    { name: 'movementRequest', type: 'object', optional: true, description: 'Body-local movement request' },
    { name: 'generatedActions', type: 'array', optional: true, description: 'Movement Generator result' },
    { name: 'generatedResponse', type: 'string', optional: true, description: 'Movement Generator response' },
    { name: 'response', type: 'string', optional: true, description: 'Environment LLM conversational response' },
    { name: 'taskDecision', type: 'object', optional: true, description: 'Environment LLM task decision' },
    { name: 'taskDecisionError', type: 'string', optional: true, description: 'Task decision parse failure' },
    { name: 'actionAdmission', type: 'object', optional: true, description: 'Capability validation result' },
    { name: 'frames', type: 'array', optional: true, description: 'Validated baseline/current visual frames' },
  ],
  outputs: [
    { name: 'taskState', type: 'object', description: 'Reduced Environment task state' },
    { name: 'actions', type: 'array', description: 'At most one admitted action for this task step' },
    { name: 'response', type: 'string', description: 'Model-authored outward response' },
    { name: 'familiarityQuery', type: 'string', description: 'Optional scene summary for asynchronous familiarity matching' },
    { name: 'decision', type: 'object', description: 'Typed lifecycle result' },
    { name: 'taskInstruction', type: 'string', description: 'Serialized state persisted with an admitted action' },
    { name: 'complete', type: 'boolean', description: 'Whether the whole task is complete' },
  ],
  description: 'Applies one parsed Environment LLM decision to task state and serializes state only when an action is admitted.',
  async execute(inputs) {
    const preparedState = isEnvironmentRecord(inputs.taskState)
      ? inputs.taskState as unknown as EnvironmentTaskState
      : null;
    if (!preparedState) throw new Error('Environment Task Reducer requires taskState');
    const autonomous = inputs.inputSource === 'autonomy';
    const currentUserInstruction = cleanEnvironmentText(inputs.userInstruction, 4_000);
    const terminal = isEnvironmentRecord(inputs.terminalFeedback)
      ? inputs.terminalFeedback as unknown as EnvironmentFeedback
      : null;
    const frames = Array.isArray(inputs.frames)
      ? inputs.frames.filter(isEnvironmentRecord) as unknown as EnvironmentVisualFrame[]
      : [];
    const response = cleanEnvironmentText(inputs.response, 4_000);

    if (inputs.deterministicComplete === true) {
      const completeState: EnvironmentTaskState = { ...preparedState, phase: 'complete' };
      return {
        taskState: completeState,
        actions: [],
        response,
        familiarityQuery: '',
        decision: environmentLifecycleDecision(completeState, {
          complete: true,
          completionBasis: 'action_result',
          completionEvidence: cleanEnvironmentText(terminal?.message, 500),
          terminalFeedback: terminal?.type ?? null,
          actionId: terminal?.actionId ?? null,
        }),
        taskInstruction: '',
        complete: true,
      };
    }

    const parsedActions = Array.isArray(inputs.actions)
      ? inputs.actions.filter(isEnvironmentRecord) as Array<Partial<EnvironmentAction>>
      : [];
    const generatedActions = Array.isArray(inputs.generatedActions)
      ? inputs.generatedActions.filter(isEnvironmentRecord) as Array<Partial<EnvironmentAction>>
      : [];
    const taskDecision = isEnvironmentRecord(inputs.taskDecision)
      ? inputs.taskDecision as unknown as EnvironmentTaskDecision
      : null;
    const objective = autonomous
      ? cleanEnvironmentText(taskDecision?.objective, 1_000) || preparedState.objective
      : preparedState.objective;
    const actionAdmission = isEnvironmentRecord(inputs.actionAdmission) ? inputs.actionAdmission : null;
    const taskDecisionError = cleanEnvironmentText(inputs.taskDecisionError, 500);
    const persistedPass = Boolean(terminal);
    const userVisualStoppingContract = !autonomous
      && preparedState.continuationPolicy === 'bounded'
      && preparedState.requiredCompletionBasis === 'visual_observation';
    const currentFrame = currentEnvironmentEvidenceFrame(frames);
    const claimedComplete = taskDecision?.objectiveComplete === true || taskDecision?.outcome === 'complete';
    const completionEvidence = cleanEnvironmentText(taskDecision?.completionEvidence, 1_000);
    const groundedVisualCompletion = Boolean(
      claimedComplete
      && taskDecision?.requiredCompletionBasis === 'visual_observation'
      && currentFrame?.id
      && completionEvidence.includes(currentFrame.id)
    );
    const admissionBlocked = actionAdmission?.admitted === false;
    const preparedMotionContinuation = Boolean(
      terminal?.type === 'completed'
      && preparedState.pendingMovementRequest
    );
    const preparedMovementContract = preparedMotionContinuation
      ? preparedState.pendingMovementContract
      : undefined;
    const availableActionPurpose = preparedMovementContract?.actionPurpose
      ?? taskDecision?.actionPurpose
      ?? preparedState.actionPurpose;
    const modelCandidateActions = admissionBlocked
      ? []
      : (parsedActions.length > 0 ? parsedActions : generatedActions).slice(0, 1);
    const candidateActions = preparedMotionContinuation
      ? generatedActions.slice(0, 1)
      : modelCandidateActions;
    const action = candidateActions[0];
    const preparationRequest = environmentMovementPreparationRequest(action);
    const selectedWorkExists = candidateActions.length > 0;
    const generatedResponse = cleanEnvironmentText(inputs.generatedResponse, 2_000);
    const movementGenerationFailed = (
      isEnvironmentRecord(inputs.movementRequest)
      || preparedMotionContinuation
    )
      && generatedActions.length === 0
      && Boolean(generatedResponse);
    const modelResponse = movementGenerationFailed
      ? generatedResponse
      : response || generatedResponse;
    const familiarityQuery = autonomous
      ? cleanEnvironmentText(taskDecision?.observationSummary, 300)
        || (frames.some(frame => validEnvironmentJpegDataUrl(frame.dataUrl))
          ? cleanEnvironmentText(taskDecision?.reason, 300)
          : '')
      : '';
    const operatorActionRequired = inputs.operatorActionRequired === true && !persistedPass;
    const revisingAction = persistedPass && Boolean(action);
    const contractLocked = Boolean(preparedMovementContract)
      || (persistedPass && !revisingAction)
      || userVisualStoppingContract;
    const actionPurpose: EnvironmentActionPurpose | undefined = preparedMovementContract?.actionPurpose
      ?? (persistedPass && !revisingAction
        ? preparedState.actionPurpose
        : selectedWorkExists
          ? availableActionPurpose
          : undefined);
    let requiredCompletionBasis: Exclude<EnvironmentCompletionBasis, 'none'> = preparedMovementContract?.requiredCompletionBasis
      ?? (contractLocked
        ? preparedState.requiredCompletionBasis
        : taskDecision?.requiredCompletionBasis && taskDecision.requiredCompletionBasis !== 'none'
          ? taskDecision.requiredCompletionBasis
          : action
            ? 'action_result'
            : 'response');
    if (action && requiredCompletionBasis === 'response') requiredCompletionBasis = 'action_result';
    let continuationPolicy = preparedMovementContract?.continuationPolicy
      ?? (contractLocked
        ? preparedState.continuationPolicy
        : taskDecision?.continuationPolicy ?? (requiredCompletionBasis === 'action_result' ? 'none' : 'bounded'));
    if (!contractLocked && action && requiredCompletionBasis === 'visual_observation') {
      continuationPolicy = 'bounded';
    }
    if (!contractLocked && actionPurpose === 'information_gain') {
      continuationPolicy = 'bounded';
      requiredCompletionBasis = 'visual_observation';
    } else if (!contractLocked && actionPurpose === 'expression') {
      continuationPolicy = autonomous ? 'bounded' : 'none';
      requiredCompletionBasis = 'action_result';
    }
    if (!contractLocked && autonomous && action) continuationPolicy = 'bounded';
    const intendedVisualEvidenceMode = preparedMovementContract?.visualEvidenceMode
      ?? environmentEvidenceMode(
        taskDecision,
        preparedState,
        requiredCompletionBasis,
        contractLocked,
      );
    const movementContractToPersist: EnvironmentPendingMovementContract | undefined = preparationRequest
      ? {
          continuationPolicy,
          requiredCompletionBasis,
          ...(actionPurpose ? { actionPurpose } : {}),
          ...(intendedVisualEvidenceMode ? { visualEvidenceMode: intendedVisualEvidenceMode } : {}),
        }
      : undefined;
    if (preparationRequest) {
      continuationPolicy = 'bounded';
      requiredCompletionBasis = 'action_result';
    }
    const motionClass = persistedPass && !revisingAction
      ? preparedState.motionClass
      : taskDecision?.motionClass ?? preparedState.motionClass;
    const visualEvidenceMode = preparationRequest ? undefined : intendedVisualEvidenceMode;
    const actionQueued = candidateActions.length > 0;
    const baselineFrame = preparedState.baselineFrame
      ?? environmentTaskFrameRef(frames.find(frame => validEnvironmentJpegDataUrl(frame.dataUrl)));
    const pendingMovementRequest = preparationRequest
      ?? (preparedMotionContinuation && action?.type === 'robotMotionPlan'
        ? undefined
        : preparedState.pendingMovementRequest);
    const pendingMovementContract = movementContractToPersist
      ?? (preparedMotionContinuation && action?.type === 'robotMotionPlan'
        ? undefined
        : preparedState.pendingMovementContract);
    const nextState: EnvironmentTaskState = {
      ...preparedState,
      objective,
      phase: actionQueued ? 'awaiting_action' : preparedState.phase,
      step: actionQueued ? preparedState.step + 1 : preparedState.step,
      continuationPolicy,
      requiredCompletionBasis,
      ...(motionClass ? { motionClass } : {}),
      ...(actionPurpose ? { actionPurpose } : {}),
      ...(visualEvidenceMode ? { visualEvidenceMode } : {}),
      ...(baselineFrame ? { baselineFrame } : {}),
      pendingMovementRequest,
      pendingMovementContract,
      ...(actionQueued && environmentSelectedAction(candidateActions[0])
        ? { selectedAction: environmentSelectedAction(candidateActions[0]) }
        : {}),
    };

    if (actionQueued) {
      return {
        taskState: nextState,
        actions: candidateActions,
        response: preparedMotionContinuation ? '' : modelResponse,
        familiarityQuery,
        decision: environmentLifecycleDecision(nextState, {
          complete: false,
          actionQueued: true,
          admittedActionCount: candidateActions.length,
          terminalFeedback: terminal?.type ?? null,
          actionId: terminal?.actionId ?? null,
        }),
        taskInstruction: encodeEnvironmentTaskState(nextState),
        complete: false,
      };
    }

    const visualAvailable = environmentVisualEvidenceAvailable(
      visualEvidenceMode,
      preparedState,
      frames,
    );
    const completionEvidenceAvailable = requiredCompletionBasis === 'response'
      ? autonomous && claimedComplete
        ? true
        : Boolean(modelResponse)
      : requiredCompletionBasis === 'action_result'
        ? terminal?.type === 'completed'
        : requiredCompletionBasis === 'visual_observation'
          ? visualAvailable && groundedVisualCompletion
          : requiredCompletionBasis === 'environment_state'
            ? isEnvironmentRecord(inputs.environmentState)
              && Object.keys(inputs.environmentState).length > 0
            : requiredCompletionBasis === 'user_input'
              ? Boolean(currentUserInstruction)
              : false;
    const complete = Boolean(
      claimedComplete
      && completionEvidenceAvailable
    ) || Boolean(
      !action
      && !operatorActionRequired
      && modelResponse
      && completionEvidenceAvailable
      && (!terminal || autonomous)
    );
    const finalState: EnvironmentTaskState = {
      ...nextState,
      phase: complete ? 'complete' : 'blocked',
    };
    const verifiedCompletionEvidence = complete
      ? requiredCompletionBasis === 'response'
        ? modelResponse
        : requiredCompletionBasis === 'action_result'
          ? cleanEnvironmentText(terminal?.message, 500)
          : requiredCompletionBasis === 'visual_observation'
            ? completionEvidence
            : requiredCompletionBasis === 'environment_state'
              ? 'Current environment state was available to the selector.'
              : requiredCompletionBasis === 'user_input'
                ? currentUserInstruction.slice(0, 500)
                : ''
      : '';
    return {
      taskState: finalState,
      actions: [],
      response: modelResponse,
      familiarityQuery,
      decision: environmentLifecycleDecision(finalState, {
        complete,
        actionQueued: false,
        admittedActionCount: 0,
        terminalFeedback: terminal?.type ?? null,
        actionId: terminal?.actionId ?? null,
        completionBasis: complete ? requiredCompletionBasis : 'none',
        completionEvidence: verifiedCompletionEvidence,
        blockedReason: complete
          ? ''
          : admissionBlocked
            ? cleanEnvironmentText(actionAdmission?.reason, 200) || 'action_not_admitted'
            : movementGenerationFailed
              ? 'movement_generation_failed'
              : operatorActionRequired
                ? 'required_action_missing'
                : requiredCompletionBasis === 'visual_observation' && !visualAvailable
                  ? 'visual_evidence_unavailable'
                  : taskDecisionError
                    ? 'invalid_task_decision'
                    : 'no_completion_or_action',
      }),
      taskInstruction: '',
      complete,
    };
  },
});
