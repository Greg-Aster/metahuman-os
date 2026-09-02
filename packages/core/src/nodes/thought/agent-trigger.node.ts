/** Work Coordinator admission node for bounded, probabilistic agent follow-ons. */

import { createHash } from 'node:crypto'
import { submitAgentFollowOn } from '../../queue/work-submission.js'
import type { QueuedTask } from '../../queue/types.js'
import { defineNode, type NodeDefinition, type NodeExecutionContext } from '../types.js'

const MAX_SEED_CHARS = 12_000

export interface AgentTriggerDependencies {
  random: () => number
  submit: typeof submitAgentFollowOn
}

const DEFAULT_DEPENDENCIES: AgentTriggerDependencies = {
  random: Math.random,
  submit: submitAgentFollowOn,
}

function boundedProbability(value: unknown): number {
  const probability = value === undefined ? 0.2 : Number(value)
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new Error('Agent trigger probability must be between 0 and 1')
  }
  return probability
}

function resolveSeed(inputs: Record<string, any>): string {
  const value = inputs.seed ?? inputs.text ?? inputs.result
  if (typeof value === 'string') return value.trim()
  if (!value || typeof value !== 'object') return ''
  for (const key of ['text', 'content', 'reflection', 'answer', 'insight', 'consolidatedChain']) {
    if (typeof value[key] === 'string' && value[key].trim()) return value[key].trim()
  }
  return ''
}

function deterministicRoll(identity: string, fallback: () => number): number {
  if (!identity) {
    const roll = fallback()
    if (!Number.isFinite(roll) || roll < 0 || roll >= 1) {
      throw new Error('Agent trigger random source must return a number from 0 up to 1')
    }
    return roll
  }
  return createHash('sha256').update(identity).digest().readUInt32BE(0) / 0x1_0000_0000
}

function safeIdentityPart(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export async function executeAgentTrigger(
  inputs: Record<string, any>,
  context: NodeExecutionContext,
  properties: Record<string, any> = {},
  dependencies: AgentTriggerDependencies = DEFAULT_DEPENDENCIES,
): Promise<Record<string, any>> {
  const seed = resolveSeed(inputs)
  if (!seed) return { admitted: false, skipped: true, reason: 'empty-seed' }
  if (seed.length > MAX_SEED_CHARS) {
    throw new Error(`Agent trigger seed must not exceed ${MAX_SEED_CHARS} characters`)
  }

  const username = safeIdentityPart(context.username)
  if (!username || username === 'anonymous') {
    throw new Error('Agent trigger requires an authenticated username')
  }
  const agentName = safeIdentityPart(properties.agentName)
  const sourceAgent = safeIdentityPart(properties.sourceAgent)
  if (!agentName) throw new Error('Agent trigger requires agentName')
  if (!sourceAgent) throw new Error('Agent trigger requires sourceAgent')

  const probability = boundedProbability(properties.probability)
  const parentIdentity = safeIdentityPart(context.idempotencyKey)
    || safeIdentityPart(context.executionId)
    || safeIdentityPart(context.requestId)
    || safeIdentityPart(context.sessionId)
  const sourceIdentity = parentIdentity || seed
  const sourceDigest = createHash('sha256').update(sourceIdentity).digest('hex').slice(0, 32)
  const executionId = `${sourceAgent}:${sourceDigest}`
  const idempotencyKey = `agent-follow-on:${sourceAgent}:${agentName}:${executionId}`
  const roll = deterministicRoll(idempotencyKey, dependencies.random)

  if (probability === 0 || roll >= probability) {
    return {
      admitted: false,
      skipped: true,
      reason: 'probability',
      probability,
      roll,
      agentName,
    }
  }

  const task: QueuedTask = await dependencies.submit({
    agentId: agentName,
    username,
    seed,
    sourceAgent,
    executionId,
    idempotencyKey,
    parentTaskId: safeIdentityPart(context.parentTaskId) || undefined,
    correlationId: safeIdentityPart(context.correlationId) || undefined,
  })

  return {
    admitted: true,
    skipped: false,
    taskId: task.id,
    probability,
    roll,
    agentName,
  }
}

export const AgentTriggerNode: NodeDefinition = defineNode({
  id: 'agent_trigger',
  name: 'Agent Follow-on Trigger',
  category: 'thought',
  inputs: [
    { name: 'seed', type: 'any', description: 'Persisted result that seeds the follow-on agent' },
  ],
  outputs: [
    { name: 'admitted', type: 'boolean', description: 'Whether follow-on work was admitted' },
    { name: 'taskId', type: 'string', optional: true, description: 'Admitted Work Coordinator task' },
    { name: 'skipped', type: 'boolean', description: 'Whether the probability or input gate skipped work' },
    { name: 'reason', type: 'string', optional: true, description: 'Skip reason' },
  ],
  properties: {
    agentName: 'train-of-thought',
    sourceAgent: '',
    probability: 0.2,
  },
  propertySchemas: {
    agentName: {
      type: 'text',
      default: 'train-of-thought',
      label: 'Follow-on Agent',
      required: true,
    },
    sourceAgent: {
      type: 'text',
      default: '',
      label: 'Source Agent',
      required: true,
    },
    probability: {
      type: 'slider',
      default: 0.2,
      label: 'Trigger Probability',
      min: 0,
      max: 1,
      step: 0.05,
    },
  },
  description: 'Probabilistically admits a seeded follow-on agent through the Work Coordinator',
  execute: (inputs, context, properties) => executeAgentTrigger(inputs, context, properties),
})
