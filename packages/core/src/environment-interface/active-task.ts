import type { EnvironmentAction, EnvironmentFeedback, EnvironmentObservation, EnvironmentVisualFrame } from './types.js'
import type { EnvironmentPerception } from './perception.js'
import { callLLM } from '../model-router.js'

/** One complete program, owned by the existing MetaHuman execution. */
export type EnvironmentTaskStep =
  | { kind: 'action'; action: Partial<EnvironmentAction> }
  | { kind: 'generatedMotion'; description: string }
  | { kind: 'behavior'; target: string; completionCriteria: string;
      motion: Partial<EnvironmentAction>; candidateLabels: string[];
      identifyEveryFrames: number; steering: { label: string; gain: number } | null }
export interface EnvironmentTaskProgram { steps: EnvironmentTaskStep[] }
export interface ActiveTaskIdentification {
  matchesTarget: boolean
  completionSatisfied: boolean
  outcome: 'positive' | 'negative' | 'ambiguous'
  description: string
  evidence: string
}
export interface ActiveTaskContinuation {
  program: EnvironmentTaskProgram
  decision: import('../nodes/environment/helpers.js').EnvironmentTaskDecision
  state: ActiveTaskState
}
export interface ActiveTaskState {
  stepIndex: number
  completedActionId?: string
  motionId?: string
  action?: Partial<EnvironmentAction>
  accepted?: boolean
  snapshotId?: string
  identificationEffectId?: string
  generationEffectId?: string
  image?: EnvironmentVisualFrame
  perception?: EnvironmentPerception
  lastIdentifiedFrame?: number
  identification?: ActiveTaskIdentification
  updateRevision: number
  desiredControls?: string
  acknowledgedControls?: string
  pendingControls?: { commandId: string; motionId: string; revision: number; controls: string }
  awaitingReplacement?: boolean
  steeringResult?: EnvironmentFeedback
  retrySteering?: boolean
  captureCompleted?: boolean
  captureRequestedAt?: string
  identificationRequest?: { effectId: string; frameId: string; stepIndex: number; gatewayInstance?: unknown; epoch?: unknown; expiresAt?: string }
  perceptionOutcome?: ActiveTaskIdentification['outcome'] | 'failed' | 'stale'
  visualCompletionSatisfied?: boolean
  objectiveComplete?: boolean
  finishRequestedAt?: number
  cancellationRequestedAt?: number
  feedbackRequiredSince?: number
  deadlineEffectId?: string
  deadlineAt?: number
  done?: boolean
  interpretationFence?: string
  instructionRevision?: number
  interpretation?: import('./interpretation.js').InstructionInterpretation & { effectId: string }
  interpretationResult?: import('./interpretation.js').InstructionInterpretation
  interpretationError?: string
  userInput?: Record<string, unknown>
  observation?: EnvironmentObservation
  feedback?: EnvironmentFeedback
  failure?: EnvironmentFeedback
  identificationError?: unknown
  pendingEvents?: Array<{ kind: string; payload: unknown; actionId?: string }>
  evidence: string[]
}

/** One finite Coordinator job; it has no command or task-completion authority. */
export async function identifyActiveTaskImage(input: {
  target: string; objective: string; completionCriteria: string
  image: EnvironmentVisualFrame; perception?: EnvironmentPerception
}, signal: AbortSignal): Promise<ActiveTaskIdentification> {
  if (!input.image.dataUrl) throw new Error('Image identification requires the correlated image bytes')
  const response = await callLLM({
    role: 'orchestrator', cognitiveMode: 'environment', signal, executionTarget: 'remote',
    messages: [
      { role: 'system', content: 'Evaluate the supplied target and completion criteria using this image. Detector labels are hints, never evidence of identity. Return matchesTarget, completionSatisfied, outcome (positive, negative, or ambiguous), description, and evidence. Positive requires visible evidence of the target AND satisfaction of the supplied completion criteria. Negative and ambiguous cannot satisfy completion. A capture receipt is not evidence of finding a target. Describe uncertainty explicitly. You do not command the robot.' },
      { role: 'user', content: [
        { type: 'text', text: JSON.stringify({ target: input.target, objective: input.objective,
          completionCriteria: input.completionCriteria, perception: input.perception,
          frame: { id: input.image.id, timestamp: input.image.timestamp } }) },
        { type: 'image_url', image_url: { url: input.image.dataUrl! } },
      ] },
    ],
    options: { format: 'json', jsonSchema: { type: 'object', additionalProperties: false,
      required: ['matchesTarget', 'completionSatisfied', 'outcome', 'description', 'evidence'], properties: {
        matchesTarget: { type: 'boolean' }, description: { type: 'string' }, evidence: { type: 'string' },
        completionSatisfied: { type: 'boolean' }, outcome: { type: 'string', enum: ['positive', 'negative', 'ambiguous'] },
      } } },
  })
  const result = JSON.parse(response.content) as ActiveTaskIdentification
  if (!result || typeof result.matchesTarget !== 'boolean' || typeof result.description !== 'string' || !result.description.trim()
    || typeof result.evidence !== 'string' || !result.evidence.trim() || typeof result.completionSatisfied !== 'boolean'
    || !['positive', 'negative', 'ambiguous'].includes(result.outcome)
    || (result.outcome === 'positive' ? !result.matchesTarget || !result.completionSatisfied : result.completionSatisfied)) {
    throw new Error('Image identification returned an invalid or contradictory result')
  }
  return result
}
