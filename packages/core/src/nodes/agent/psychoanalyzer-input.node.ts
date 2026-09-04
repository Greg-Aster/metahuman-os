import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js'

const execute: NodeExecutor = async (_inputs, context) => {
  const input = context.psychoanalyzerInput
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Psychoanalyzer graph requires canonical agent input')
  }
  const record = input as Record<string, unknown>
  if (!Array.isArray(record.memories) || record.memories.length === 0) {
    throw new Error('Psychoanalyzer graph requires selected memories')
  }
  if (!record.persona || typeof record.persona !== 'object' || Array.isArray(record.persona)) {
    throw new Error('Psychoanalyzer graph requires the active persona')
  }
  if (!record.config || typeof record.config !== 'object' || Array.isArray(record.config)) {
    throw new Error('Psychoanalyzer graph requires validated configuration')
  }
  return {
    memories: record.memories,
    persona: record.persona,
    config: record.config,
  }
}

export const PsychoanalyzerInputNode: NodeDefinition = defineNode({
  id: 'psychoanalyzer_input',
  name: 'Psychoanalyzer Input',
  category: 'agent',
  inputs: [],
  outputs: [
    { name: 'memories', type: 'array', description: 'Canonical agent-selected evidence' },
    { name: 'persona', type: 'object', description: 'Active profile persona' },
    { name: 'config', type: 'object', description: 'Validated psychoanalyzer configuration' },
  ],
  properties: {},
  description: 'Accepts one evidence set selected by the canonical Psychoanalyzer agent',
  execute,
})
