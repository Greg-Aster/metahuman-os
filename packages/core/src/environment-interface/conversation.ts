import type { SvelteFlowGraph } from '../cognitive-graph-schema.js'
import { executeNodeByType } from '../graph-executor.js'
import { runGraph, requireGraphNodeOutput } from '../graph-runtime.js'

export interface EnvironmentConversationWork {
  messages: Record<string, any>
  properties: Record<string, any>
  graph: SvelteFlowGraph
  graphContext: Record<string, any>
}

/** Generate without holding the execution lease; delivery is a checkpointed child. */
export async function runEnvironmentConversationWork(input: EnvironmentConversationWork, username: string, signal: AbortSignal) {
  const context = { ...input.graphContext, username, userId: username, graphExecution: undefined }
  const output = await executeNodeByType({ id: 'conversation-model', type: 'modelNode', position: { x: 0, y: 0 },
    data: { label: 'Conversation Model', nodeType: 'model_router', properties: input.properties } }, input.messages, { ...context, abortSignal: signal })
  signal.throwIfAborted()
  const result = await runGraph({ graph: input.graph, signal,
    context: { ...context, environmentConversationResponse: output.response } })
  if (result.status !== 'completed') throw result.error ?? new Error('Conversation delivery did not complete')
  return { response: requireGraphNodeOutput(result, 'environment_conversation_result').response }
}
