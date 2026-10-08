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
  // Opt-in operator-selected demonstration, not person identity tracking.
  singlePersonDemo?: boolean
  personLoss?: {
    startedAt: number
    expiresAt: number
    reason: 'absent' | 'ambiguous'
    lastFrame?: string
    lastObservedAt?: number
    lastExpiresAt?: number
    firstObservedAt?: number
    consecutive: number
    candidateFrame?: string
    windowExpired?: boolean
    resumeRejection?: string
  }
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
  capturedFrameIds?: string[]
  evidence: string[]
}

/** A source-frame identity, scoped across gateway restarts and reconnects. */
export function personFrameKey(perception: EnvironmentPerception): string {
  return JSON.stringify([perception.gatewayInstance, perception.robotId, perception.epoch, perception.frameCounter])
}

/** Update only the existing execution checkpoint; recognition never grants resume. */
export function observeSinglePersonDemo(state: ActiveTaskState, now: number): void {
  const perception = state.perception
  const fresh = perception && Date.parse(perception.observedAt) <= now && now < Date.parse(perception.expiresAt)
  const people = fresh ? perception.objects.filter(object => object.label.toLowerCase() === 'person') : []
  if (!state.personLoss && fresh && people.length !== 1) {
    state.personLoss = { startedAt: now, expiresAt: now + 3000,
      reason: people.length === 0 ? 'absent' : 'ambiguous', consecutive: 0 }
    state.identificationError = 'Single-person demonstration lost an unambiguous candidate; owned cancellation required'
    state.objectiveComplete = false
  }
  const loss = state.personLoss
  if (!loss) return
  if (now >= loss.expiresAt) loss.windowExpired = true
  if (!fresh || loss.windowExpired) {
    loss.consecutive = 0; delete loss.firstObservedAt; delete loss.candidateFrame
    return
  }
  const key = personFrameKey(perception)
  // Re-reading a frame cannot count as more evidence or renew the window.
  if (key === loss.lastFrame) return
  const observedAt = Date.parse(perception.observedAt)
  const sameSource = loss.lastFrame && JSON.parse(loss.lastFrame).slice(0, 3).join() === JSON.parse(key).slice(0, 3).join()
  const advance = loss.lastFrame ? (perception.frameCounter - JSON.parse(loss.lastFrame)[3]) >>> 0 : 1
  if (sameSource && (advance === 0 || advance >= 0x80000000 || observedAt <= loss.lastObservedAt!)) return
  const consecutive = loss.lastObservedAt !== undefined && observedAt > loss.lastObservedAt
    && observedAt <= loss.lastExpiresAt!
    && sameSource
  if (people.length !== 1 || !people[0].box || !consecutive) {
    loss.consecutive = 0; delete loss.firstObservedAt; delete loss.candidateFrame
  }
  // An older source frame cannot qualify a candidate, even if delivered late.
  if (people.length === 1 && people[0].box && (loss.lastObservedAt === undefined || observedAt > loss.lastObservedAt)) {
    loss.firstObservedAt ??= observedAt
    loss.consecutive += 1
    if (loss.consecutive >= 3 && observedAt - loss.firstObservedAt >= 1000) loss.candidateFrame = key
  }
  loss.lastFrame = key; loss.lastObservedAt = observedAt; loss.lastExpiresAt = Date.parse(perception.expiresAt)
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
