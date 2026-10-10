import type { EnvironmentObservation } from '@metahuman/core'

export type Specialist = 'intent' | 'task'
export type CaseSplit = 'development' | 'evaluation' | 'regression'
export interface ContextRequirement {
  required: string[]
  optional: string[]
  anyOf?: string[][]
}
export type IntentRequirements = Partial<Record<'taskContext' | 'conversationContext', ContextRequirement>>
export interface SpecialistCase {
  id: string
  specialist: Specialist
  suite: string
  risk: 'low' | 'high'
  fold: number
  split: CaseSplit
  instructions: string[]
  routes: Record<string, boolean | string | string[]>
  inputs?: Record<string, unknown>
  expected: Record<string, any>
  targets?: Record<number, Record<string, any>>
  contextRequirements?: IntentRequirements
  responseOptional?: true
}
export const ROUTE_FIELDS = ['needsResponse', 'needsAction', 'taskContext', 'conversationContext'] as const
export const intentOutput = (task: string[], conversation: string[], response = true, action = false) => ({
  needsResponse: response, needsAction: action, taskContext: task, conversationContext: conversation,
})
// Synthetic corpus annotations only; runtime route decisions belong to the model.
export function routes(selected: string[], memoryQuery?: string, personaSections = ['personality']): SpecialistCase['routes'] {
  const fields: Record<string, string> = { needsConversationHistory: 'conversationHistory', needsMemory: 'memory',
    needsRobotStatus: 'robotStatus', needsEnvironment: 'environment', needsVision: 'vision', needsExecutionContext: 'executionContext' }
  const sources = selected.flatMap(field => fields[field] ? [fields[field]!] : [])
  const persona = selected.includes('needsPersona') ? personaSections.map(section => `persona.${section}`) : []
  const needsResponse = selected.includes('needsResponse'), needsAction = selected.includes('needsAction')
  return { needsResponse, needsAction,
    taskContext: needsAction || !needsResponse ? [...sources, ...(!needsResponse ? persona : [])] : [],
    conversationContext: needsResponse ? [...(needsAction ? [] : sources), ...persona] : [],
    ...(memoryQuery ? { memoryQuery } : {}) }
}
export const cases: SpecialistCase[] = []
/** Reviewed corpus choice; never a runtime routing rule or prompt directive. */
export function allowResponseChoice(source: SpecialistCase): void {
  source.responseOptional = true
  source.contextRequirements = { ...source.contextRequirements,
    conversationContext: { required: [], optional: ['persona.personality'] } }
}
export function addCase(specialist: Specialist, suite: string, instructions: string[], selected: string[],
  expected: Record<string, any> | null, inputs: Record<string, unknown> = {}, split: CaseSplit = 'development', memoryQuery?: string, personaSections?: string[]) {
  const familyIndex = cases.filter(item => item.specialist === specialist && item.split === split).length
  const routing = specialist === 'intent' && expected ? expected : routes(selected, memoryQuery, personaSections)
  cases.push({ id: `${specialist}-${split}-${String(familyIndex + 1).padStart(3, '0')}`, specialist, suite,
    risk: routing.needsAction === true || (Array.isArray(routing.taskContext) && routing.taskContext.includes('executionContext')) ? 'high' : 'low',
    fold: familyIndex % 4, split, instructions, routes: routing, inputs, expected: expected ?? routing })
  return cases[cases.length - 1]!
}
export const TIME = '2030-01-15T12:00:00.000Z'
export const COMMAND_DESCRIPTIONS: Record<string, string> = {
  stand: 'Rise into the standard upright four-leg standing pose.',
  sit: 'Lower the body into the built-in seated pose.',
  wave: 'Lift and wave one front limb, then return it.',
  bow: 'Lower the front of the body into a bow, then recover.',
  pushup: 'Lower and raise the body once in the built-in push-up motion.',
  nod: 'Dip and raise the front of the body once in a nodding gesture.',
  turn_left: 'Rotate the body approximately 90 degrees to the left.',
  turn_right: 'Rotate the body approximately 90 degrees to the right.',
  walk_forward: 'Advance forward using the built-in walking gait.',
  walk_backward: 'Move backward using the built-in reverse gait.',
}
export function observation(): EnvironmentObservation {
  return { adapter: 'synthetic-training-adapter', environmentId: 'training-room', sessionId: 'training-body', timestamp: TIME,
    state: { batteryPercent: 72, posture: 'standing' }, capabilities: {
      actions: ['robotCommand', 'move', 'stop', 'captureImage', 'robotMotionPlan'],
      robotCommands: Object.keys(COMMAND_DESCRIPTIONS), robotCommandDescriptions: { ...COMMAND_DESCRIPTIONS },
      movement: true, visual: true,
    } }
}
export const task = (objective: string, steps: unknown[], extra: Record<string, unknown> = {}) => ({
  taskDecision: { objective, completionCriteria: 'The selected program receives correlated completion results.',
    outcome: 'act', reason: 'The current request selects this activity.', continuationPolicy: 'none',
    requiredCompletionBasis: 'action_result', ...extra }, program: { steps },
})
export const action = (command: string) => ({ kind: 'action', action: { type: 'robotCommand', command } })
export const noTask = () => ({ taskDecision: null, program: null })
