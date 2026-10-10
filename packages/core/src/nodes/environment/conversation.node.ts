import { defineNode } from '../types.js'
import { modelRouterDefinition } from '../llm/model-router.schema.js'
import { graphContextSnapshot } from '../../durable-execution/graph-contract.js'
import { loadGraphForMode } from '../../graph-streaming.js'

/** The Coordinator owns finite inference; the active program retains its execution. */
export const environmentConversationNode = defineNode({
  id: 'environment_conversation', name: 'Generate Environment Conversation', category: 'environment',
  inputs: [...modelRouterDefinition.inputs,
    { name: 'metadata', type: 'object', optional: true, description: 'Recorded origin metadata for the assistant response' }],
  outputs: [{ name: 'effectId', type: 'string', description: 'Durable conversation work identity' },
    { name: 'work', type: 'object', description: 'Identified conversation work for the existing result wait' }],
  properties: modelRouterDefinition.properties,
  propertySchemas: modelRouterDefinition.propertySchemas,
  description: 'Queues conversation generation without delaying the selected task. Model settings use the existing Model Router; delivery uses the conversation workflow in this execution.',
  async execute(inputs, context, properties) {
    const loaded = await loadGraphForMode('environment-conversation', context.username)
    const work = context.graphExecution!.dispatch({ kind: 'coordinator_work', payload: {
      type: 'generic', handler: 'environment.conversation', resource: 'environment-conversation', source: 'environment',
      username: context.username, maxAttempts: 1,
      input: { messages: inputs, properties, graph: loaded.graph,
        graphContext: graphContextSnapshot({ ...context, graphExecution: undefined,
          environmentConversationMetadata: inputs.metadata }) },
    } })
    return { effectId: work.effectId, work: { effectId: work.effectId } }
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
