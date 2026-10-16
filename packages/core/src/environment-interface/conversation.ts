import { executeNodeByType } from '../graph-executor.js'

export interface EnvironmentConversationWork {
  messages: Record<string, any>
  properties: Record<string, any>
  graphContext: Record<string, any>
}

/** Finite inference returns a durable work result; the owning graph performs delivery. */
export async function runEnvironmentConversationWork(input: EnvironmentConversationWork, username: string, signal: AbortSignal) {
  const context = { ...input.graphContext, username, userId: username, graphExecution: undefined }
  const output = await executeNodeByType({ id: 'conversation-model', type: 'modelNode', position: { x: 0, y: 0 },
    data: { label: 'Conversation Model', nodeType: 'model_router', properties: input.properties } }, input.messages, { ...context, abortSignal: signal })
  signal.throwIfAborted()
  return { response: output.response }
}
