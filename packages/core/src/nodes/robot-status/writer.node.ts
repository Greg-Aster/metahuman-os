import {
  parseRobotStatusSituation,
  robotStatusPath,
  saveRobotStatus,
  type RobotStatusSnapshot,
  type RobotStatusSourceFacts,
} from '../../robot-status.js'
import { defineNode } from '../types.js'

function modelContent(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const content = (value as Record<string, unknown>).content
    if (typeof content === 'string') return content.trim()
  }
  return ''
}

function systemReport(status: RobotStatusSnapshot): string {
  const body = status.body
  const motion = body?.motion.available === true
    ? 'available'
    : body?.motion.available === false
      ? 'unavailable'
      : 'unknown'
  const motionActivity = body?.motion.activity ? ` (${body.motion.activity})` : ''
  const action = status.lastAction
  const actionDescription = action
    ? action.description || action.command || action.type || 'unnamed action'
    : 'none recorded'
  const actionStatus = action?.status ? ` — ${action.status}` : ''
  const desires = status.agency.activeDesires.length > 0
    ? status.agency.activeDesires
      .map(desire => `${desire.title}${desire.status ? ` (${desire.status})` : ''}`)
      .join('; ')
    : 'none active'

  return [
    'Robot Status saved.',
    `Updated: ${status.updatedAt}`,
    `Robot: ${body?.sessionId || 'none reported'} (${body?.connectionStatus || 'connection unknown'})`,
    `Battery: ${body?.battery.voltage === null || body?.battery.voltage === undefined ? 'unknown' : `${body.battery.voltage} V`}`,
    `Motion: ${motion}${motionActivity}`,
    `Last action: ${actionDescription}${actionStatus}`,
    `Environment: ${status.situation.environmentDescription}`,
    `Goal: ${status.situation.currentGoal || 'none reported'}`,
    `Intent: ${status.situation.currentIntent || 'none reported'}`,
    `User context: ${status.situation.userContext || 'none reported'}`,
    `Active desires: ${desires}`,
    `Uncertainties: ${status.situation.uncertainties.join('; ') || 'none reported'}`,
  ].join('\n')
}

export const robotStatusWriterNode = defineNode({
  id: 'robot_status_writer',
  name: 'Robot Status Writer',
  category: 'output',
  inputs: [
    { name: 'response', type: 'any', description: 'Strict semantic Robot Status JSON from the model' },
    { name: 'sourceFacts', type: 'object', description: 'Deterministic source facts from the Robot Status Context Builder' },
  ],
  outputs: [
    { name: 'status', type: 'object', description: 'Saved Robot Status snapshot' },
    { name: 'context', type: 'object', description: 'Saved snapshot for optional downstream use' },
    { name: 'event', type: 'message', description: 'Concise System Buffer event' },
    { name: 'summary', type: 'string', description: 'Saved situational summary' },
    { name: 'path', type: 'string', description: 'Profile-resolved Robot Status path' },
    { name: 'persisted', type: 'boolean', description: 'Whether the snapshot was saved' },
  ],
  properties: {},
  description: 'Validates one semantic Robot Status result and atomically persists it with deterministic source facts.',
  async execute(inputs, context) {
    const username = typeof context.username === 'string' ? context.username.trim() : ''
    if (!username) throw new Error('Robot Status Writer requires an authenticated username')
    const raw = modelContent(inputs.response)
    if (!raw) throw new Error('Robot Status model returned no JSON response')
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new Error('Robot Status model response was not valid JSON')
    }
    const situation = parseRobotStatusSituation(parsed)
    const sources = inputs.sourceFacts as RobotStatusSourceFacts | undefined
    if (!sources?.sourceUpdatedAt || !Array.isArray(sources.activeDesires)) {
      throw new Error('Robot Status Writer requires deterministic source facts')
    }
    const status = saveRobotStatus(username, situation, sources)
    return {
      status,
      context: status,
      event: {
        role: 'system',
        content: systemReport(status),
        meta: {
          type: 'robot_status',
          source: 'robot-status',
          dialogueSource: 'robot-status',
          updatedAt: status.updatedAt,
          currentGoal: status.situation.currentGoal,
        },
      },
      summary: status.situation.situationalSummary,
      path: robotStatusPath(username),
      persisted: true,
    }
  },
})
