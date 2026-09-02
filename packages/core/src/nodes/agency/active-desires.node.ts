import { listActiveDesires } from '../../agency/storage.js'
import { defineNode } from '../types.js'

export const activeDesiresNode = defineNode({
  id: 'active_desires',
  name: 'Active Desires',
  category: 'agency',
  inputs: [],
  outputs: [
    { name: 'desires', type: 'array', description: 'Bounded active Desire summaries ordered by strength' },
    { name: 'count', type: 'number', description: 'Number of active desires loaded before the graph limit' },
    { name: 'updatedAt', type: 'string', description: 'Time the Agency snapshot was read' },
  ],
  properties: { limit: 5 },
  propertySchemas: {
    limit: {
      type: 'slider',
      default: 5,
      label: 'Desire Limit',
      description: 'Maximum active Desire summaries exposed to this graph',
      min: 1,
      max: 10,
      step: 1,
    },
  },
  description: 'Reads bounded active Desire summaries from the canonical Agency storage owner.',
  async execute(_inputs, context, properties) {
    const username = typeof context.username === 'string' ? context.username.trim() : ''
    if (!username) return { desires: [], count: 0, updatedAt: new Date().toISOString() }
    const desires = await listActiveDesires(username)
    const configuredLimit = properties?.limit
    const limit = Number.isInteger(configuredLimit)
      ? Math.max(1, Math.min(10, Number(configuredLimit)))
      : 5
    const summaries = desires
      .sort((a, b) => b.strength - a.strength || b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit)
      .map(desire => ({
        id: desire.id,
        title: desire.title.slice(0, 200),
        description: desire.description.slice(0, 500),
        reason: desire.reason.slice(0, 500),
        status: desire.status,
        strength: desire.strength,
        updatedAt: desire.updatedAt,
      }))
    return {
      desires: summaries,
      count: desires.length,
      updatedAt: new Date().toISOString(),
    }
  },
})
