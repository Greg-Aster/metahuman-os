import { defineNode, type NodeExecutionContext } from '../types.js'
import { modelRouterDefinition } from '../llm/model-router.schema.js'
import { graphContextSnapshot } from '../../durable-execution/graph-contract.js'
import { loadGraphForMode } from '../../graph-streaming.js'
import { workResultWaitNode } from '../utility/work-result-wait.node.js'

/** Deliver already selected words through the editable conversation workflow. */
async function deliverEnvironmentConversation(
  context: NodeExecutionContext,
  response: string,
  metadata?: Record<string, unknown>,
) {
  const loaded = await loadGraphForMode('environment-conversation', context.username)
  const delivered = await context.graphExecution!.callGraph(loaded.graph, {
    ...context, graphExecution: undefined,
    environmentConversationResponse: response,
    environmentConversationMetadata: metadata,
  })
  const completed = [...delivered.nodes.values()].filter(node => node.status === 'completed')
  const responseEntry = completed
    .filter(node => node.definition?.type === 'conversation_buffer')
    .flatMap(node => node.outputs?.persisted ? node.outputs.entries ?? [] : [])
    .find(entry => entry.role === 'assistant' && typeof entry.content === 'string' && entry.content.trim())
  return { responseEntry }
}

/** The Coordinator owns finite inference; the active program retains its execution. */
export const environmentConversationNode = defineNode({
  id: 'environment_conversation', name: 'Generate Environment Conversation', category: 'environment',
  inputs: [...modelRouterDefinition.inputs,
    { name: 'instructionEntry', type: 'message', optional: true, description: 'Original admitted user input answered by this conversation.' },
    { name: 'metadata', type: 'object', optional: true, description: 'Recorded origin metadata for the assistant response' }],
  outputs: [{ name: 'effectId', type: 'string', description: 'Durable conversation work identity' },
    { name: 'work', type: 'object', description: 'Identified conversation work for the existing result wait' }],
  properties: modelRouterDefinition.properties,
  propertySchemas: modelRouterDefinition.propertySchemas,
  description: 'Queues conversation generation without delaying the selected task. Model settings use the existing Model Router; delivery uses the conversation workflow in this execution.',
  async execute(inputs, context, properties) {
    const entry = inputs.instructionEntry
    const inReplyTo = entry?.role === 'user' ? entry.meta?.idempotencyKey : undefined
    const metadata = { ...inputs.metadata, ...(inReplyTo ? { inReplyTo } : {}) }
    const work = context.graphExecution!.dispatch({ kind: 'coordinator_work', payload: {
      type: 'generic', handler: 'environment.conversation', resource: 'environment-conversation', source: 'environment',
      username: context.username, maxAttempts: 1,
      input: { messages: inputs, properties,
        graphContext: graphContextSnapshot({ ...context, graphExecution: undefined }) },
    } })
    return { effectId: work.effectId, work: { effectId: work.effectId, metadata } }
  },
})

export const environmentConversationDeliveryNode = defineNode({
  id: 'environment_conversation_delivery', name: 'Deliver Environment Conversation', category: 'environment',
  inputs: workResultWaitNode.inputs,
  outputs: [...workResultWaitNode.outputs,
    { name: 'responseEntry', type: 'message', description: 'Persisted assistant response, with its original identity and time' }],
  properties: {},
  description: 'Receives the saved inference result and runs conversation delivery under this workflow’s execution owner.',
  async execute(inputs, context) {
    const joined = await workResultWaitNode.execute(inputs, context, {})
    const result = joined.result.result
    let responseEntry
    if (result.state === 'completed') {
      const delivered = await deliverEnvironmentConversation(context, result.result.response, inputs.work.metadata)
      responseEntry = delivered.responseEntry
    }
    return { ...joined, responseEntry }
  },
})

export const environmentConversationResultNode = defineNode({
  id: 'environment_conversation_result', name: 'Conversation Work Result', category: 'environment',
  inputs: [],
  outputs: [{ name: 'response', type: 'string', description: 'Generated conversation text from this finite work item' },
    { name: 'metadata', type: 'object', description: 'Recorded origin metadata for the assistant response' }],
  description: 'Supplies the completed inference to the existing buffer, memory and speech owners.',
  async execute(_inputs, context) { return { response: context.environmentConversationResponse,
    metadata: context.environmentConversationMetadata } },
})
