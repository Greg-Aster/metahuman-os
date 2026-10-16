import type { EnvironmentAction, EnvironmentFeedback, EnvironmentObservation, EnvironmentVisualFrame, EnvironmentNormalizedBox, EnvironmentLocomotionGoal, EnvironmentLocomotionMeasurement } from './types.js'
import { recognitionImageAssociation, type EnvironmentPerception } from './perception.js'
import { normalizeEnvironmentTargetBox } from './visual-approach.js'
import { callLLM } from '../model-router.js'

/** Parse the goal-bearing action contract without deriving targets or units. */
export function normalizeLocomotionGoal(value: unknown): EnvironmentLocomotionGoal {
  const g = value as any
  const number = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
  const positive = (v: unknown) => number(v) && (v as number) > 0
  if (!g || typeof g !== 'object') throw new Error('Locomotion requires locomotionGoal')
  if (g.kind === 'distance' && ['forward', 'back', 'left', 'right'].includes(g.direction)
    && positive(g.metres) && positive(g.tolerance)) return { kind: g.kind, direction: g.direction, metres: g.metres, tolerance: g.tolerance }
  if (g.kind === 'relativeTurn' && number(g.degrees) && positive(g.tolerance))
    return { kind: g.kind, degrees: g.degrees, tolerance: g.tolerance }
  if (g.kind === 'visual' && typeof g.target === 'string' && g.target.trim()
    && typeof g.completionCriteria === 'string' && g.completionCriteria.trim())
    return { kind: g.kind, target: g.target, completionCriteria: g.completionCriteria }
  if (g.kind === 'approach' || g.kind === 'follow') {
    const t = g.target, p = g.proximity
    if (!t || typeof t.frameId !== 'string' || !t.frameId || !Number.isFinite(Date.parse(t.frameTimestamp))
      || !p || !positive(p.tolerance)) throw new Error('Locomotion target requires retained frame evidence and proximity')
    const target = { frameId: t.frameId, frameTimestamp: t.frameTimestamp, box: normalizeEnvironmentTargetBox(t.box),
      ...(typeof t.trackId === 'string' ? { trackId: t.trackId } : {}),
      ...(typeof t.queryId === 'string' ? { queryId: t.queryId } : {}),
      ...(t.groundContact ? { groundContact: { x: t.groundContact.x, y: t.groundContact.y } } : {}) }
    if (p.kind === 'metric' && (!positive(p.metres) || !target.groundContact
      || ![target.groundContact.x, target.groundContact.y].every(v => number(v) && v >= 0 && v <= 1)))
      throw new Error('Metric target proximity requires a selected ground contact point')
    if (p.kind !== 'metric' && !(p.kind === 'imageRelative' && positive(p.boxHeight) && p.boxHeight <= 1))
      throw new Error('Invalid locomotion proximity')
    const proximity = p.kind === 'metric' ? { kind: 'metric' as const, metres: p.metres, tolerance: p.tolerance }
      : { kind: 'imageRelative' as const, boxHeight: p.boxHeight, tolerance: p.tolerance }
    if (g.kind === 'follow') {
      if (typeof g.endingCondition !== 'string' || !g.endingCondition.trim()) throw new Error('Follow requires endingCondition')
      return { kind: 'follow', target, proximity, endingCondition: g.endingCondition }
    }
    return { kind: 'approach', target, proximity }
  }
  throw new Error('Invalid locomotionGoal')
}

export function evaluateLocomotionGoal(goal: EnvironmentLocomotionGoal, measurement: EnvironmentLocomotionMeasurement,
  initial: EnvironmentLocomotionMeasurement = measurement, now = Date.now(), gait?: EnvironmentAction['gait']): {
    reached: boolean; reason?: string; forward?: number; turn?: number; lateral?: number; progress: Record<string, unknown>
  } {
  const valid = (value: EnvironmentLocomotionMeasurement['position'] | EnvironmentLocomotionMeasurement['yaw'] | EnvironmentLocomotionMeasurement['target']) =>
    value?.available === true && Number.isFinite(Date.parse(value.observedAt)) && Date.parse(value.observedAt) <= now
      && (!value.expiresAt || now < Date.parse(value.expiresAt))
  const unavailable = (reason: string) => ({ reached: false, reason, progress: { measurement } })
  if (goal.kind === 'distance') {
    const p = measurement.position, start = initial.position
    if (!valid(p) || !start || ![p?.xMetres, p?.yMetres, p?.headingDegrees, start.xMetres, start.yMetres, start.headingDegrees].every(v => typeof v === 'number' && Number.isFinite(v)) || p!.referenceId !== start.referenceId || p!.robotId !== start.robotId)
      return unavailable(p?.reason ?? 'Position evidence unavailable or reference changed')
    const angle = (start.headingDegrees + ({ forward: 0, back: 180, left: 90, right: -90 }[goal.direction])) * Math.PI / 180
    const targetX = start.xMetres + Math.cos(angle) * goal.metres, targetY = start.yMetres + Math.sin(angle) * goal.metres
    const dx = targetX - p!.xMetres, dy = targetY - p!.yMetres, remainingMetres = Math.hypot(dx, dy)
    if (gait === 'crab') {
      const heading = p!.headingDegrees * Math.PI / 180
      const scale = remainingMetres ? 100 / remainingMetres : 0
      return { reached: remainingMetres <= goal.tolerance,
        forward: Math.max(-100, Math.min(100, (dx * Math.cos(heading) + dy * Math.sin(heading)) * scale)),
        lateral: Math.max(-100, Math.min(100, (-dx * Math.sin(heading) + dy * Math.cos(heading)) * scale)), turn: 0,
        progress: { remainingMetres, targetX, targetY, measurement } }
    }
    const bearing = Math.atan2(dy, dx) * 180 / Math.PI
    const reverse = goal.direction === 'back'
    const headingError = ((bearing - p!.headingDegrees - (reverse ? 180 : 0) + 540) % 360) - 180
    return { reached: remainingMetres <= goal.tolerance, forward: (reverse ? -1 : 1) * Math.cos(headingError * Math.PI / 180) * 100,
      turn: Math.max(-100, Math.min(100, headingError)), progress: { remainingMetres, targetX, targetY, measurement } }
  }
  if (goal.kind === 'relativeTurn') {
    const y = measurement.yaw, start = initial.yaw
    if (!valid(y) || !start || ![y?.degrees, start.degrees].every(v => typeof v === 'number' && Number.isFinite(v)) || y!.referenceId !== start.referenceId || y!.robotId !== start.robotId)
      return unavailable(y?.reason ?? 'Orientation evidence unavailable or reference changed')
    const turnedDegrees = y!.degrees - start.degrees, remainingDegrees = goal.degrees - turnedDegrees
    return { reached: Math.abs(remainingDegrees) <= goal.tolerance, forward: 0, turn: Math.sign(remainingDegrees) * 100,
      progress: { turnedDegrees, remainingDegrees, measurement } }
  }
  if (goal.kind === 'visual') return { reached: false, progress: { measurement } }
  const t = measurement.target
  if (!valid(t) || !t || (goal.target.trackId ? t.trackId !== goal.target.trackId : t.frameId !== goal.target.frameId)
    || goal.target.queryId && t.queryId !== goal.target.queryId)
    return unavailable(t?.reason ?? 'Selected target evidence unavailable')
  const actual = goal.proximity.kind === 'metric' ? t.rangeMetres : t.boxHeight
  if (typeof actual !== 'number' || !Number.isFinite(actual)) return unavailable('Selected target proximity is unavailable')
  if (goal.proximity.kind === 'metric' && (!t.groundContact || !goal.target.groundContact
    || t.groundContact.x !== goal.target.groundContact.x || t.groundContact.y !== goal.target.groundContact.y))
    return unavailable('Selected ground-contact evidence is unavailable')
  const error = goal.proximity.kind === 'metric' ? actual - goal.proximity.metres : goal.proximity.boxHeight - actual
  const satisfied = Math.abs(error) <= goal.proximity.tolerance
  return { reached: goal.kind === 'approach' && satisfied, forward: satisfied ? 0 : Math.sign(error) * 100,
    turn: typeof t.horizontalOffset === 'number' ? t.horizontalOffset * 100 : 0, progress: { proximity: actual, satisfied, measurement } }
}

export type EnvironmentVisionStep =
  | { kind: 'vision'; operation: 'acquire'; target: string; referenceFrameId?: string }
  | { kind: 'vision'; operation: 'search'; labels: string[] }
  | { kind: 'vision'; operation: 'select'; frameId: string; box: EnvironmentNormalizedBox; description: string }
  | { kind: 'vision'; operation: 'release' }
export type EnvironmentTaskSteering = { label: string; gain: number; trackId?: string }

/** One complete program, owned by the existing MetaHuman execution. */
export type EnvironmentTaskStep =
  | EnvironmentVisionStep
  | { kind: 'action'; action: Partial<EnvironmentAction> }
  | { kind: 'generatedMotion'; description: string }
  | { kind: 'behavior'; target: string; completionCriteria: string;
      motion: Partial<EnvironmentAction> | null; candidateLabels: string[];
      identifyEveryFrames: number; steering: EnvironmentTaskSteering | null }
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
  locomotionTargetAcquired?: boolean;
  locomotion?: { initial: EnvironmentLocomotionMeasurement; latest: EnvironmentLocomotionMeasurement;
    reached: boolean; incomplete?: string; progress?: Record<string, unknown> };

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
  visionEffectId?: string
  planningRequired?: boolean
  acquisition?: ActiveTaskAcquisition
  visionResult?: Record<string, unknown>
  queryId?: string
  generationEffectId?: string
  image?: EnvironmentVisualFrame
  perception?: EnvironmentPerception
  trackingFeedback?: { status: 'current' | 'unavailable'; queryId?: string; observedAt?: string; expiresAt?: string }
  steeringOffset?: number
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
export function observeSinglePerson(state: ActiveTaskState, now: number): void {
  const perception = state.perception
  const fresh = perception && Date.parse(perception.observedAt) <= now && now < Date.parse(perception.expiresAt)
  const people = fresh ? perception.objects.filter(object => object.label.toLowerCase() === 'person') : []
  if (!state.personLoss && fresh && people.length !== 1) {
    state.personLoss = { startedAt: now, expiresAt: now + 3000,
      reason: people.length === 0 ? 'absent' : 'ambiguous', consecutive: 0 }
    state.identificationError = 'Single-person behavior lost an unambiguous candidate; owned cancellation required'
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

export interface ActiveTaskImageRequest {
  target: string; objective: string; completionCriteria: string
  image: EnvironmentVisualFrame; perception?: EnvironmentPerception
  purpose?: 'evaluate' | 'locate'
  referenceImage?: EnvironmentVisualFrame
}
export interface ActiveTaskAcquisition {
  purpose: 'locate'
  frame: Pick<EnvironmentVisualFrame, 'id' | 'timestamp' | 'metadata'>
  outcome: 'found' | 'not_found' | 'ambiguous'
  candidates: Array<{ box: EnvironmentNormalizedBox; description: string; evidence: string }>
}

// Owner-approved wording: Ainekio docs/audits/VISION_TRACKING_INTEGRATION.md.
const TARGET_ACQUISITION_INSTRUCTION = 'Locate the requested target in the supplied robot image. The target description and any supplied reference image describe what is being sought. Return an outcome of found, not_found, or ambiguous, and candidates with normalized image boxes (x, y, width, height), a description, and visible supporting evidence. Coordinates refer to the supplied robot image. Distinguish identifying an object category from identifying the particular object requested. Use the supplied image association when interpreting detector metadata. Report ambiguity when the image does not establish which candidate is intended. This result describes this image; it does not establish current tracking, physical location, task completion, or robot movement. For every box, x and y are the left and top edges divided by the image width and height; width and height are the box dimensions divided by those same image dimensions. All four values are fractions between 0 and 1, and x + width and y + height must not exceed 1. For example, a box covering the middle half of the image is {"x":0.25,"y":0.25,"width":0.5,"height":0.5}. Do not return pixel coordinates, a 0–1000 coordinate scale, or right/bottom edges in the width/height fields.';

export function identifyActiveTaskImage(input: ActiveTaskImageRequest & { purpose: 'locate' }, signal: AbortSignal): Promise<ActiveTaskAcquisition>
export function identifyActiveTaskImage(input: ActiveTaskImageRequest & { purpose?: 'evaluate' }, signal: AbortSignal): Promise<ActiveTaskIdentification>
export function identifyActiveTaskImage(input: ActiveTaskImageRequest, signal: AbortSignal): Promise<ActiveTaskIdentification | ActiveTaskAcquisition>
/** One finite Coordinator job; it has no command or task-completion authority. */
export async function identifyActiveTaskImage(input: ActiveTaskImageRequest, signal: AbortSignal): Promise<ActiveTaskIdentification | ActiveTaskAcquisition> {
  if (!input.image.dataUrl) throw new Error('Image identification requires the correlated image bytes')
  const response = await callLLM({
    role: 'environmentVision', cognitiveMode: 'environment', signal,
    messages: [
      { role: 'system', content: input.purpose === 'locate' ? TARGET_ACQUISITION_INSTRUCTION : 'Evaluate the supplied target and completion criteria using this image. Detector labels are hints, never evidence of identity. Return matchesTarget, completionSatisfied, outcome (positive, negative, or ambiguous), description, and evidence. Positive requires visible evidence of the target AND satisfaction of the supplied completion criteria. Negative and ambiguous cannot satisfy completion. A capture receipt is not evidence of finding a target. Describe uncertainty explicitly. You do not command the robot.' },
      { role: 'user', content: [
        { type: 'text', text: JSON.stringify({ target: input.target, objective: input.objective,
          completionCriteria: input.completionCriteria, perception: input.perception,
          ...recognitionImageAssociation(input.perception ? {
            robotId: input.perception.robotId, gatewayInstance: input.perception.gatewayInstance,
            epoch: input.perception.epoch, counter: input.perception.frameCounter,
          } : null, [input.image]),
          frame: { id: input.image.id, timestamp: input.image.timestamp, metadata: input.image.metadata },
          ...(input.referenceImage ? { referenceImage: { id: input.referenceImage.id, timestamp: input.referenceImage.timestamp } } : {}) }) },
        { type: 'image_url', image_url: { url: input.image.dataUrl! } },
        ...(input.referenceImage?.dataUrl ? [{ type: 'image_url' as const, image_url: { url: input.referenceImage.dataUrl } }] : []),
      ] },
    ],
    options: { format: 'json', jsonSchema: input.purpose === 'locate' ? {
      type: 'object', additionalProperties: false, required: ['outcome', 'candidates'],
      properties: {
        outcome: { type: 'string', enum: ['found', 'not_found', 'ambiguous'] },
        candidates: { type: 'array', items: { type: 'object', additionalProperties: false,
          required: ['box', 'description', 'evidence'], properties: {
            box: { type: 'object', additionalProperties: false, required: ['x', 'y', 'width', 'height'],
              properties: Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, { type: 'number', minimum: 0, maximum: 1 }])) },
            description: { type: 'string' }, evidence: { type: 'string' },
          } } },
      },
    } : { type: 'object', additionalProperties: false,
      required: ['matchesTarget', 'completionSatisfied', 'outcome', 'description', 'evidence'], properties: {
        matchesTarget: { type: 'boolean' }, description: { type: 'string' }, evidence: { type: 'string' },
        completionSatisfied: { type: 'boolean' }, outcome: { type: 'string', enum: ['positive', 'negative', 'ambiguous'] },
      } } },
  })
  if (input.purpose === 'locate') {
    const result = JSON.parse(response.content) as ActiveTaskAcquisition
    if (!result || !['found', 'not_found', 'ambiguous'].includes(result.outcome)
      || !Array.isArray(result.candidates) || result.candidates.some(candidate => !candidate
        || typeof candidate.description !== 'string' || typeof candidate.evidence !== 'string')) {
      throw new Error('Target acquisition returned an invalid result')
    }
    return { purpose: 'locate', outcome: result.outcome,
      frame: { id: input.image.id, timestamp: input.image.timestamp, metadata: input.image.metadata },
      candidates: result.candidates.map(candidate => ({ box: normalizeEnvironmentTargetBox(candidate.box),
        description: candidate.description, evidence: candidate.evidence })) }
  }
  const result = JSON.parse(response.content) as ActiveTaskIdentification
  if (!result || typeof result.matchesTarget !== 'boolean' || typeof result.description !== 'string' || !result.description.trim()
    || typeof result.evidence !== 'string' || !result.evidence.trim() || typeof result.completionSatisfied !== 'boolean'
    || !['positive', 'negative', 'ambiguous'].includes(result.outcome)
    || (result.outcome === 'positive' ? !result.matchesTarget || !result.completionSatisfied : result.completionSatisfied)) {
    throw new Error('Image identification returned an invalid or contradictory result')
  }
  return result
}
