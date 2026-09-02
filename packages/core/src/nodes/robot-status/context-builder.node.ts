import type { RobotStatusAction, RobotStatusBody, RobotStatusSourceFacts } from '../../robot-status.js'
import { ROBOT_STATUS_SEMANTIC_JSON_SCHEMA } from '../../robot-status.js'
import { defineNode } from '../types.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength)
    : ''
}

function projected(value: unknown, budget = { leaves: 48 }, depth = 0): unknown {
  if (budget.leaves <= 0 || depth > 4) return undefined
  if (typeof value === 'string') {
    budget.leaves -= 1
    return value.slice(0, 500)
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    budget.leaves -= 1
    return value
  }
  if (Array.isArray(value)) {
    return value.slice(0, 10).flatMap(item => {
      const next = projected(item, budget, depth + 1)
      return next === undefined ? [] : [next]
    })
  }
  if (!isRecord(value)) return undefined
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['data', 'dataUrl', 'audio', 'image', 'base64'].includes(key))
    .slice(0, 24)
    .flatMap(([key, item]) => {
      const next = projected(item, budget, depth + 1)
      return next === undefined ? [] : [[key, next]]
    }))
}

function recordProjection(value: unknown, leaves = 48): Record<string, unknown> {
  const result = projected(value, { leaves })
  return isRecord(result) ? result : {}
}

function timestamp(value: unknown): string {
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return value
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString()
  return ''
}

function latestMessageTimestamp(value: unknown): string {
  if (!Array.isArray(value)) return ''
  return value.map(item => isRecord(item) ? timestamp(item.timestamp) : '')
    .filter(Boolean)
    .sort()
    .at(-1) ?? ''
}

function latestSession(summary: unknown): Record<string, unknown> | null {
  if (!isRecord(summary) || !Array.isArray(summary.sessions)) return null
  const sessions = summary.sessions.filter(isRecord)
  return sessions.sort((a, b) => {
    const connected = Number(b.status === 'connected') - Number(a.status === 'connected')
    return connected || cleanText(b.lastSeenAt, 80).localeCompare(cleanText(a.lastSeenAt, 80))
  })[0] ?? null
}

function matchingTelemetry(value: unknown, sessionId: string): Record<string, unknown> | null {
  if (!Array.isArray(value)) return null
  return value.filter(isRecord).find(item => cleanText(item.sessionId, 160) === sessionId) ?? null
}

function environmentEvidence(summary: unknown): Record<string, unknown> | null {
  const session = latestSession(summary)
  if (!session) return null
  const observation = isRecord(session.latestObservation) ? session.latestObservation : null
  if (!observation) return null
  const visuals = Array.isArray(observation.visuals)
    ? observation.visuals.filter(isRecord)
    : isRecord(observation.visual)
      ? [observation.visual]
      : []
  return {
    text: projected(observation.text, { leaves: 20 }),
    location: projected(observation.location, { leaves: 20 }),
    map: projected(observation.map, { leaves: 28 }),
    visualFrames: visuals.slice(-3).map(frame => ({
      id: cleanText(frame.id, 200),
      timestamp: cleanText(frame.timestamp, 80),
      source: cleanText(frame.source, 160),
      description: cleanText(frame.description, 500),
    })),
  }
}

function motionFacts(
  observation: Record<string, unknown> | null,
  robotTelemetry: Record<string, unknown>,
): RobotStatusBody['motion'] {
  const state = isRecord(observation?.state) ? observation.state : {}
  const body = isRecord(state.body) ? state.body : {}
  return {
    available: typeof body.motionAvailable === 'boolean' ? body.motionAvailable : null,
    activity: cleanText(robotTelemetry.state, 80),
    observedAt: cleanText(observation?.timestamp, 80),
  }
}

function batteryFacts(
  robotTelemetry: Record<string, unknown>,
  observedAt: string,
): RobotStatusBody['battery'] {
  return {
    voltage: typeof robotTelemetry.vbat === 'number' && Number.isFinite(robotTelemetry.vbat)
      ? robotTelemetry.vbat
      : null,
    observedAt,
  }
}

function bodyFacts(summary: unknown, telemetry: unknown): RobotStatusBody | null {
  const session = latestSession(summary)
  if (!session) return null
  const sessionId = cleanText(session.sessionId, 160)
  if (!sessionId) return null
  const observation = isRecord(session.latestObservation) ? session.latestObservation : null
  const telemetrySession = matchingTelemetry(telemetry, sessionId)
  const robotTelemetry = isRecord(telemetrySession?.robotStatus) ? telemetrySession.robotStatus : {}
  const capabilities = isRecord(observation?.capabilities) ? observation.capabilities : {}
  const telemetryAt = cleanText(telemetrySession?.updatedAt, 80)
  return {
    sessionId,
    environmentId: cleanText(session.environmentId, 160),
    connectionStatus: cleanText(session.status, 40),
    observationAt: cleanText(observation?.timestamp, 80),
    telemetryAt,
    battery: batteryFacts(robotTelemetry, telemetryAt),
    motion: motionFacts(observation, robotTelemetry),
    state: recordProjection(observation?.state, 40),
    telemetry: recordProjection(robotTelemetry, 32),
    capabilities: {
      actions: Array.isArray(capabilities.actions) ? capabilities.actions.slice(0, 32) : [],
      robotCommands: Array.isArray(capabilities.robotCommands) ? capabilities.robotCommands.slice(0, 64) : [],
      motionClasses: Array.isArray(capabilities.motionClasses) ? capabilities.motionClasses.slice(0, 16) : [],
      visual: capabilities.visual === true,
      movement: capabilities.movement === true,
    },
  }
}

function actionDescription(action: Record<string, unknown> | null): string {
  if (!action) return ''
  const metadata = isRecord(action.metadata) ? action.metadata : null
  const motionSummary = cleanText(metadata?.motionSummary, 300)
  if (motionSummary) return motionSummary
  const command = cleanText(action.command, 160)
  if (command) return command
  if (action.type !== 'robotMotionPlan') return cleanText(action.type, 80)
  const frames = Array.isArray(action.frames) ? action.frames.filter(isRecord) : []
  const durationMs = frames.reduce((total, frame) => (
    total + (typeof frame.durationMs === 'number' && Number.isFinite(frame.durationMs)
      ? Math.max(0, frame.durationMs)
      : 0)
  ), 0)
  const endPose = cleanText(action.endPose, 40)
  return [
    `Generated motion plan with ${frames.length} frame${frames.length === 1 ? '' : 's'}`,
    durationMs > 0 ? `${durationMs} ms total` : '',
    endPose ? `ending in ${endPose}` : '',
  ].filter(Boolean).join(', ')
}

function latestAction(value: unknown): RobotStatusAction | null {
  if (!Array.isArray(value)) return null
  for (const message of [...value].reverse()) {
    if (!isRecord(message)) continue
    const meta = isRecord(message.meta) ? message.meta : null
    const bridge = isRecord(meta?.bridgeRecord) ? meta.bridgeRecord : null
    if (!bridge) continue
    const action = isRecord(bridge.action) ? bridge.action : null
    const feedback = isRecord(bridge.feedback) ? bridge.feedback : null
    const actionId = cleanText(bridge.actionId, 200) || cleanText(action?.id, 200)
    if (!actionId) continue
    return {
      actionId,
      type: cleanText(action?.type, 80),
      command: cleanText(action?.command, 160),
      description: actionDescription(action),
      status: cleanText(bridge.status, 80) || cleanText(feedback?.type, 80),
      message: cleanText(bridge.message, 500) || cleanText(feedback?.message, 500),
      completedAt: cleanText(action?.completedAt, 80) || timestamp(message.timestamp),
    }
  }
  return null
}

function conversation(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).slice(-10).flatMap(message => {
    const content = cleanText(message.content, 1_000)
    if (!content) return []
    return [{
      role: cleanText(message.role, 40),
      content,
      timestamp: timestamp(message.timestamp),
    }]
  })
}

function desires(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).slice(0, 5).map(desire => ({
    id: cleanText(desire.id, 160),
    title: cleanText(desire.title, 200),
    description: cleanText(desire.description, 500),
    reason: cleanText(desire.reason, 500),
    status: cleanText(desire.status, 80),
    strength: typeof desire.strength === 'number' ? desire.strength : 0,
    updatedAt: cleanText(desire.updatedAt, 80),
  }))
}

export const robotStatusContextBuilderNode = defineNode({
  id: 'robot_status_context_builder',
  name: 'Robot Status Context Builder',
  category: 'context',
  inputs: [
    { name: 'instruction', type: 'string', description: 'Editable Robot Status instructions' },
    { name: 'environmentSummary', type: 'object', optional: true, description: 'Current Environment Bridge summary' },
    { name: 'robotTelemetry', type: 'array', optional: true, description: 'Current bounded robot telemetry' },
    { name: 'conversationHistory', type: 'array', optional: true, description: 'Recent canonical conversation entries' },
    { name: 'robotHistory', type: 'array', optional: true, description: 'Recent canonical Robot Buffer entries' },
    { name: 'activeDesires', type: 'array', optional: true, description: 'Bounded active Agency Desire summaries' },
    { name: 'previousStatus', type: 'object', optional: true, description: 'Previous bounded Robot Status context' },
  ],
  outputs: [
    { name: 'messages', type: 'array', description: 'Bounded model messages for one status update' },
    { name: 'jsonSchema', type: 'object', description: 'Strict Robot Status semantic result schema' },
    { name: 'sourceFacts', type: 'object', description: 'Deterministic facts persisted beside the semantic result' },
    { name: 'context', type: 'object', description: 'Inspectible bounded Robot Status generation context' },
  ],
  properties: {},
  description: 'Builds one bounded Robot Status update from canonical robot, conversation, and Agency sources.',
  async execute(inputs) {
    const instruction = cleanText(inputs.instruction, 4_000)
    if (!instruction) throw new Error('Robot Status Context Builder requires editable instructions')
    const body = bodyFacts(inputs.environmentSummary, inputs.robotTelemetry)
    const recentConversation = conversation(inputs.conversationHistory)
    const activeDesires = desires(inputs.activeDesires)
    const sourceFacts: RobotStatusSourceFacts = {
      sourceUpdatedAt: {
        environment: body?.observationAt ?? '',
        telemetry: body?.telemetryAt ?? '',
        conversation: latestMessageTimestamp(inputs.conversationHistory),
        robotHistory: latestMessageTimestamp(inputs.robotHistory),
        agency: activeDesires.map(desire => cleanText(desire.updatedAt, 80)).filter(Boolean).sort().at(-1) ?? '',
      },
      body,
      lastAction: latestAction(inputs.robotHistory),
      activeDesires: activeDesires as unknown as RobotStatusSourceFacts['activeDesires'],
    }
    const previousStatus = isRecord(inputs.previousStatus)
      ? recordProjection(inputs.previousStatus, 36)
      : null
    const context = {
      sourceFacts,
      environmentEvidence: environmentEvidence(inputs.environmentSummary),
      recentConversation,
      previousStatus,
      evidenceRules: {
        bridgeAndRobotBufferAreFacts: true,
        conversationAndPriorStatusAreNarrativeContext: true,
        activeDesiresMayInfluenceButDoNotProveCurrentActions: true,
        missingDataMustRemainUncertain: true,
      },
    }
    return {
      messages: [
        { role: 'system', content: instruction },
        { role: 'user', content: JSON.stringify(context) },
      ],
      jsonSchema: ROBOT_STATUS_SEMANTIC_JSON_SCHEMA,
      sourceFacts,
      context,
    }
  },
})
