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
export interface ActiveTaskIdentification { matchesTarget: boolean; description: string; evidence: string }
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
  image?: EnvironmentVisualFrame
  perception?: EnvironmentPerception
  lastIdentifiedFrame?: number
  identification?: ActiveTaskIdentification
  updateId?: string
  updateRevision: number
  lastControls?: string
  stopId?: string
  done?: boolean
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
  const response = await callLLM({
    role: 'orchestrator', cognitiveMode: 'environment', signal,
    messages: [
      { role: 'system', content: 'Identify objects of interest for the supplied target and phase criteria from this image. Detector labels are hints and may omit the target. Return matchesTarget, description, and evidence. Describe uncertainty in evidence. You do not command the robot.' },
      { role: 'user', content: [
        { type: 'text', text: JSON.stringify({ target: input.target, objective: input.objective,
          completionCriteria: input.completionCriteria, perception: input.perception,
          frame: { id: input.image.id, timestamp: input.image.timestamp } }) },
        { type: 'image_url', image_url: { url: input.image.dataUrl! } },
      ] },
    ],
    options: { format: 'json', jsonSchema: { type: 'object', additionalProperties: false,
      required: ['matchesTarget', 'description', 'evidence'], properties: {
        matchesTarget: { type: 'boolean' }, description: { type: 'string' }, evidence: { type: 'string' },
      } } },
  })
  const result = JSON.parse(response.content) as ActiveTaskIdentification
  if (typeof result.matchesTarget !== 'boolean' || typeof result.description !== 'string'
    || typeof result.evidence !== 'string') throw new Error('Image identification returned an invalid result')
  return result
}
