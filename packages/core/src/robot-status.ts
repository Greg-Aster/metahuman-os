import fs from 'node:fs'
import path from 'node:path'
import { getProfilePaths } from './paths.js'

const ROBOT_STATUS_FILE = 'robot-status.json'
const ROBOT_STATUS_HISTORY_LIMIT = 8

export interface RobotStatusDesireSummary {
  id: string
  title: string
  description: string
  reason: string
  status: string
  strength: number
  updatedAt: string
}

export interface RobotStatusAction {
  actionId: string
  type: string
  command: string
  description: string
  status: string
  message: string
  completedAt: string
}

export interface RobotStatusMotion {
  available: boolean | null
  activity: string
  observedAt: string
}

export interface RobotStatusBattery {
  voltage: number | null
  observedAt: string
}

export interface RobotStatusBody {
  sessionId: string
  environmentId: string
  connectionStatus: string
  observationAt: string
  telemetryAt: string
  battery: RobotStatusBattery
  motion: RobotStatusMotion
  state: Record<string, unknown>
  telemetry: Record<string, unknown>
  capabilities: Record<string, unknown>
}

export interface RobotStatusSituation {
  situationalSummary: string
  environmentDescription: string
  currentGoal: string
  currentIntent: string
  userContext: string
  uncertainties: string[]
}

export interface RobotStatusTaskDecision {
  outcome: string
  reason: string
  objectiveComplete: boolean
  continuationPolicy?: string
  requiredCompletionBasis?: string
  motionClass?: string
  actionPurpose?: string
  observationSummary?: string
  visualEvidenceMode?: string
  completionEvidence?: string
  nextInstruction?: string
}

export interface RobotStatusTaskAction {
  type: string
  command?: string
  direction?: string
  target?: string
  description?: string
}

export interface RobotStatusTaskFeedback {
  type: string
  actionId: string
  message: string
  observedAt: string
}

export interface RobotStatusTaskFrame {
  id: string
  timestamp: string
  source?: string
  correlationId?: string
}

export interface RobotStatusTask {
  objective: string
  instruction: string
  source: string
  decision: RobotStatusTaskDecision
  selectedAction: RobotStatusTaskAction | null
  actionId: string
  actionStatus: string
  feedback: RobotStatusTaskFeedback | null
  baselineFrame: RobotStatusTaskFrame | null
  updatedAt: string
}

export interface RobotStatusHistoryEntry {
  updatedAt: string
  situationalSummary: string
  currentGoal: string
  currentIntent: string
  lastActionStatus: string
}

export interface RobotStatusSnapshot {
  version: 1
  updatedAt: string
  sourceUpdatedAt: {
    environment: string
    telemetry: string
    conversation: string
    robotHistory: string
    agency: string
  }
  body: RobotStatusBody | null
  lastAction: RobotStatusAction | null
  task: RobotStatusTask | null
  agency: {
    activeDesires: RobotStatusDesireSummary[]
  }
  situation: RobotStatusSituation
  history: RobotStatusHistoryEntry[]
}

export interface RobotStatusSourceFacts {
  sourceUpdatedAt: RobotStatusSnapshot['sourceUpdatedAt']
  body: RobotStatusBody | null
  lastAction: RobotStatusAction | null
  task?: RobotStatusTask | null
  activeDesires: RobotStatusDesireSummary[]
}

export const ROBOT_STATUS_SEMANTIC_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'situationalSummary',
    'environmentDescription',
    'currentGoal',
    'currentIntent',
    'userContext',
    'uncertainties',
  ],
  properties: {
    situationalSummary: { type: 'string', minLength: 1, maxLength: 1_000 },
    environmentDescription: { type: 'string', minLength: 1, maxLength: 1_000 },
    currentGoal: { type: 'string', maxLength: 500 },
    currentIntent: { type: 'string', maxLength: 500 },
    userContext: { type: 'string', maxLength: 500 },
    uncertainties: {
      type: 'array',
      maxItems: 6,
      items: { type: 'string', minLength: 1, maxLength: 300 },
    },
  },
} as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength)
    : ''
}

function finiteStrength(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : 0
}

function boundedRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {}
  return Object.fromEntries(Object.entries(value).slice(0, 32))
}

function normalizeMotion(value: unknown): RobotStatusMotion {
  const motion = isRecord(value) ? value : {}
  return {
    available: typeof motion.available === 'boolean' ? motion.available : null,
    activity: cleanText(motion.activity, 80),
    observedAt: cleanText(motion.observedAt, 80),
  }
}

function normalizeBattery(value: unknown): RobotStatusBattery {
  const battery = isRecord(value) ? value : {}
  return {
    voltage: typeof battery.voltage === 'number' && Number.isFinite(battery.voltage)
      ? battery.voltage
      : null,
    observedAt: cleanText(battery.observedAt, 80),
  }
}

function normalizeBody(value: unknown): RobotStatusBody | null {
  if (!isRecord(value)) return null
  const sessionId = cleanText(value.sessionId, 160)
  if (!sessionId) return null
  return {
    sessionId,
    environmentId: cleanText(value.environmentId, 160),
    connectionStatus: cleanText(value.connectionStatus, 40),
    observationAt: cleanText(value.observationAt, 80),
    telemetryAt: cleanText(value.telemetryAt, 80),
    battery: normalizeBattery(value.battery),
    motion: normalizeMotion(value.motion),
    state: boundedRecord(value.state),
    telemetry: boundedRecord(value.telemetry),
    capabilities: boundedRecord(value.capabilities),
  }
}

function normalizeAction(value: unknown): RobotStatusAction | null {
  if (!isRecord(value)) return null
  const actionId = cleanText(value.actionId, 200)
  if (!actionId) return null
  return {
    actionId,
    type: cleanText(value.type, 80),
    command: cleanText(value.command, 160),
    description: cleanText(value.description, 300),
    status: cleanText(value.status, 80),
    message: cleanText(value.message, 500),
    completedAt: cleanText(value.completedAt, 80),
  }
}

function optionalText(value: unknown, maxLength: number): string | undefined {
  const normalized = cleanText(value, maxLength)
  return normalized || undefined
}

function normalizeTaskAction(value: unknown): RobotStatusTaskAction | null {
  if (!isRecord(value)) return null
  const type = cleanText(value.type, 80)
  if (!type) return null
  return {
    type,
    ...(optionalText(value.command, 160) ? { command: optionalText(value.command, 160) } : {}),
    ...(optionalText(value.direction, 80) ? { direction: optionalText(value.direction, 80) } : {}),
    ...(optionalText(value.target, 200) ? { target: optionalText(value.target, 200) } : {}),
    ...(optionalText(value.description, 500) ? { description: optionalText(value.description, 500) } : {}),
  }
}

function normalizeTaskDecision(value: unknown): RobotStatusTaskDecision | null {
  if (!isRecord(value)) return null
  const outcome = cleanText(value.outcome, 80)
  const reason = cleanText(value.reason, 1_000)
  if (!outcome || !reason || typeof value.objectiveComplete !== 'boolean') return null
  return {
    outcome,
    reason,
    objectiveComplete: value.objectiveComplete,
    ...(optionalText(value.continuationPolicy, 80) ? { continuationPolicy: optionalText(value.continuationPolicy, 80) } : {}),
    ...(optionalText(value.requiredCompletionBasis, 80) ? { requiredCompletionBasis: optionalText(value.requiredCompletionBasis, 80) } : {}),
    ...(optionalText(value.motionClass, 80) ? { motionClass: optionalText(value.motionClass, 80) } : {}),
    ...(optionalText(value.actionPurpose, 80) ? { actionPurpose: optionalText(value.actionPurpose, 80) } : {}),
    ...(optionalText(value.observationSummary, 500) ? { observationSummary: optionalText(value.observationSummary, 500) } : {}),
    ...(optionalText(value.visualEvidenceMode, 80) ? { visualEvidenceMode: optionalText(value.visualEvidenceMode, 80) } : {}),
    ...(optionalText(value.completionEvidence, 1_000) ? { completionEvidence: optionalText(value.completionEvidence, 1_000) } : {}),
    ...(optionalText(value.nextInstruction, 1_000) ? { nextInstruction: optionalText(value.nextInstruction, 1_000) } : {}),
  }
}

function normalizeTaskFeedback(value: unknown): RobotStatusTaskFeedback | null {
  if (!isRecord(value)) return null
  const type = cleanText(value.type, 80)
  if (!type) return null
  return {
    type,
    actionId: cleanText(value.actionId, 200),
    message: cleanText(value.message, 500),
    observedAt: cleanText(value.observedAt, 80),
  }
}

function normalizeTaskFrame(value: unknown): RobotStatusTaskFrame | null {
  if (!isRecord(value)) return null
  const id = cleanText(value.id, 200)
  const timestamp = cleanText(value.timestamp, 80)
  if (!id || !timestamp) return null
  return {
    id,
    timestamp,
    ...(optionalText(value.source, 160) ? { source: optionalText(value.source, 160) } : {}),
    ...(optionalText(value.correlationId, 200) ? { correlationId: optionalText(value.correlationId, 200) } : {}),
  }
}

function normalizeTask(value: unknown): RobotStatusTask | null {
  if (!isRecord(value)) return null
  const decision = normalizeTaskDecision(value.decision)
  const objective = cleanText(value.objective, 1_000)
  if (!decision || !objective) return null
  return {
    objective,
    instruction: cleanText(value.instruction, 4_000),
    source: cleanText(value.source, 80),
    decision,
    selectedAction: normalizeTaskAction(value.selectedAction),
    actionId: cleanText(value.actionId, 200),
    actionStatus: cleanText(value.actionStatus, 80),
    feedback: normalizeTaskFeedback(value.feedback),
    baselineFrame: normalizeTaskFrame(value.baselineFrame),
    updatedAt: cleanText(value.updatedAt, 80),
  }
}

function normalizeDesires(value: unknown): RobotStatusDesireSummary[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).slice(0, 5).flatMap(item => {
    const id = cleanText(item.id, 160)
    const title = cleanText(item.title, 200)
    if (!id || !title) return []
    return [{
      id,
      title,
      description: cleanText(item.description, 500),
      reason: cleanText(item.reason, 500),
      status: cleanText(item.status, 80),
      strength: finiteStrength(item.strength),
      updatedAt: cleanText(item.updatedAt, 80),
    }]
  })
}

export function parseRobotStatusSituation(value: unknown): RobotStatusSituation {
  if (!isRecord(value)) throw new Error('Robot Status model output must be a JSON object')
  const expected = new Set([
    'situationalSummary',
    'environmentDescription',
    'currentGoal',
    'currentIntent',
    'userContext',
    'uncertainties',
  ])
  if (Object.keys(value).some(key => !expected.has(key)) || Object.keys(value).length !== expected.size) {
    throw new Error('Robot Status model output must contain exactly the six situation fields')
  }
  const situationalSummary = cleanText(value.situationalSummary, 1_000)
  const environmentDescription = cleanText(value.environmentDescription, 1_000)
  if (!situationalSummary) throw new Error('Robot Status requires a situationalSummary')
  if (!environmentDescription) throw new Error('Robot Status requires an environmentDescription')
  if (!Array.isArray(value.uncertainties)) throw new Error('Robot Status uncertainties must be an array')
  const uncertainties = value.uncertainties
    .map(item => cleanText(item, 300))
    .filter(Boolean)
    .slice(0, 6)
  return {
    situationalSummary,
    environmentDescription,
    currentGoal: cleanText(value.currentGoal, 500),
    currentIntent: cleanText(value.currentIntent, 500),
    userContext: cleanText(value.userContext, 500),
    uncertainties,
  }
}

export function robotStatusPath(username: string): string {
  return path.join(getProfilePaths(username).state, ROBOT_STATUS_FILE)
}

export function loadRobotStatus(username: string): RobotStatusSnapshot | null {
  const filePath = robotStatusPath(username)
  if (!fs.existsSync(filePath)) return null
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as RobotStatusSnapshot
  if (parsed.version !== 1 || !parsed.updatedAt || !parsed.situation) {
    throw new Error(`Invalid Robot Status snapshot for ${username}`)
  }
  return {
    ...parsed,
    task: normalizeTask(parsed.task),
  }
}

function previousHistoryEntry(snapshot: RobotStatusSnapshot): RobotStatusHistoryEntry {
  return {
    updatedAt: snapshot.updatedAt,
    situationalSummary: cleanText(snapshot.situation.situationalSummary, 500),
    currentGoal: cleanText(snapshot.situation.currentGoal, 300),
    currentIntent: cleanText(snapshot.situation.currentIntent, 300),
    lastActionStatus: cleanText(snapshot.lastAction?.status, 80),
  }
}

export function saveRobotStatus(
  username: string,
  situation: RobotStatusSituation,
  sources: RobotStatusSourceFacts,
): RobotStatusSnapshot {
  const previous = loadRobotStatus(username)
  const now = new Date().toISOString()
  const history = previous
    ? [...previous.history, previousHistoryEntry(previous)].slice(-ROBOT_STATUS_HISTORY_LIMIT)
    : []
  const snapshot: RobotStatusSnapshot = {
    version: 1,
    updatedAt: now,
    sourceUpdatedAt: {
      environment: cleanText(sources.sourceUpdatedAt.environment, 80),
      telemetry: cleanText(sources.sourceUpdatedAt.telemetry, 80),
      conversation: cleanText(sources.sourceUpdatedAt.conversation, 80),
      robotHistory: cleanText(sources.sourceUpdatedAt.robotHistory, 80),
      agency: cleanText(sources.sourceUpdatedAt.agency, 80),
    },
    body: normalizeBody(sources.body),
    lastAction: normalizeAction(sources.lastAction),
    task: sources.task === undefined
      ? previous?.task ?? null
      : normalizeTask(sources.task),
    agency: { activeDesires: normalizeDesires(sources.activeDesires) },
    situation: parseRobotStatusSituation(situation),
    history,
  }
  const filePath = robotStatusPath(username)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
  fs.renameSync(temporary, filePath)
  return snapshot
}
