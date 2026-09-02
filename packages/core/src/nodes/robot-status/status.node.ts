import { loadRobotStatus } from '../../robot-status.js'
import { defineNode } from '../types.js'

function decisionContext(
  status: NonNullable<ReturnType<typeof loadRobotStatus>>,
  historyLimit: number,
): Record<string, unknown> {
  return {
    version: status.version,
    updatedAt: status.updatedAt,
    body: status.body
      ? {
          sessionId: status.body.sessionId,
          environmentId: status.body.environmentId,
          connectionStatus: status.body.connectionStatus,
          observationAt: status.body.observationAt,
          telemetryAt: status.body.telemetryAt,
          battery: status.body.battery,
          motion: status.body.motion,
        }
      : null,
    lastAction: status.lastAction,
    situation: status.situation,
    agency: {
      activeDesires: status.agency.activeDesires.map(desire => ({
        id: desire.id,
        title: desire.title,
        description: desire.description,
        reason: desire.reason,
        status: desire.status,
        strength: desire.strength,
      })),
    },
    history: historyLimit > 0 ? status.history.slice(-historyLimit) : [],
  }
}

export const robotStatusNode = defineNode({
  id: 'robot_status',
  name: 'Robot Status',
  category: 'context',
  inputs: [],
  outputs: [
    { name: 'status', type: 'object', description: 'Current typed Robot Status snapshot' },
    { name: 'context', type: 'object', description: 'Bounded Robot Status context for downstream cognition' },
    { name: 'historyContext', type: 'object', description: 'Prior semantic situation and bounded history for status refresh' },
    { name: 'summary', type: 'string', description: 'Current situational summary' },
    { name: 'updatedAt', type: 'string', description: 'Snapshot update time' },
    { name: 'found', type: 'boolean', description: 'Whether a Robot Status snapshot exists' },
  ],
  properties: { historyLimit: 3 },
  propertySchemas: {
    historyLimit: {
      type: 'slider',
      default: 3,
      label: 'History Limit',
      description: 'Number of compact prior status summaries supplied to this graph',
      min: 0,
      max: 8,
      step: 1,
    },
  },
  description: 'Reads the current profile-resolved Robot Status snapshot without updating it.',
  async execute(_inputs, context, properties) {
    const username = typeof context.username === 'string' ? context.username.trim() : ''
    if (!username) return { status: null, context: null, historyContext: null, summary: '', updatedAt: '', found: false }
    const status = loadRobotStatus(username)
    if (!status) return { status: null, context: null, historyContext: null, summary: '', updatedAt: '', found: false }
    const configuredHistoryLimit = properties?.historyLimit
    const historyLimit = Number.isInteger(configuredHistoryLimit)
      ? Math.max(0, Math.min(8, Number(configuredHistoryLimit)))
      : 3
    const boundedContext = decisionContext(status, historyLimit)
    return {
      status,
      context: boundedContext,
      historyContext: {
        updatedAt: status.updatedAt,
        situation: status.situation,
        history: boundedContext.history,
      },
      summary: status.situation.situationalSummary,
      updatedAt: status.updatedAt,
      found: true,
    }
  },
})
