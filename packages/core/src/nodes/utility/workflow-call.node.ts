import { defineNode } from '../types.js'
import { loadGraphForMode } from '../../graph-streaming.js'
import { collectNodeOutputs, extractGraphOutput } from '../../graph-runtime.js'

export const workflowCallNode = defineNode({
  id: 'workflow_call', name: 'Run Child Workflow', category: 'utility',
  execution: { timeoutOwner: 'children' },
  description: 'Runs the selected editable workflow inside this execution and returns its outputs. A waiting child releases the worker and resumes here when its result arrives.',
  inputs: [
    { name: 'invocation', type: 'object', optional: true, description: 'Selected workflow name and its input context' },
    { name: 'context', type: 'object', optional: true, description: 'Explicit inputs for the configured child workflow' },
  ],
  outputs: [
    { name: 'childResult', type: 'object', description: 'Child workflow output' },
    { name: 'nodeOutputs', type: 'object', description: 'Saved outputs from the child nodes' },
    { name: 'completed', type: 'boolean', description: 'Child workflow reached its end' },
  ],
  properties: { graph: '' },
  propertySchemas: { graph: { type: 'text', default: '', label: 'Child Workflow', description: 'Configured workflow; a connected invocation can select it instead.' } },
  async execute(inputs, context, properties) {
    const name = inputs.invocation?.graph || properties?.graph
    if (typeof name !== 'string' || !name) throw new Error('Run Child Workflow requires a selected graph')
    if (!context.graphExecution) throw new Error('Child workflows require the durable graph runtime')
    const loaded = await loadGraphForMode(name, context.username)
    const child = await context.graphExecution.callGraph(loaded.graph, {
      ...context, ...inputs.context, ...inputs.invocation?.context, graphExecution: undefined,
    })
    return { childResult: extractGraphOutput(child), nodeOutputs: collectNodeOutputs(child), completed: child.status === 'completed' }
  },
})
