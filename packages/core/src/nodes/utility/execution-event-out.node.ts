import { defineNode } from '../types.js'

export const executionEventOutNode = defineNode({
  id: 'execution_event_out', name: 'Send Input to Existing Execution', category: 'output',
  description: 'Appends the unchanged input to the execution selected by the intent LLM. It neither interprets the message nor creates an objective.',
  inputs: [
    { name: 'selection', type: 'object', description: 'Existing execution and event kind selected by the LLM' },
    { name: 'message', type: 'string', description: 'Original user input' },
    { name: 'entry', type: 'message', optional: true, description: 'Original Conversation Buffer admission, preserving identity through the handoff' },
  ],
  outputs: [{ name: 'sent', type: 'boolean', description: 'Input handoff committed with this node output' }],
  properties: {},
  async execute(inputs, context) {
    if (!context.graphExecution) throw new Error('Execution input handoff requires durable execution')
    const turns = context.pendingInstructionTurns as Array<Record<string, any>> | undefined
    if (turns?.length) {
      for (const turn of turns) await executionEventOutNode.execute({ ...inputs, message: turn.userMessage, entry: turn.userMessageEntry },
        { ...context, ...turn, pendingInstructionTurns: undefined }, {})
      return { sent: true }
    }
    const selected = inputs.selection
    if (!selected?.executionId || !['user_steering', 'user_cancelled'].includes(selected.kind)) throw new Error('Invalid execution input selection')
    if (inputs.entry && (inputs.entry.role !== 'user' || inputs.entry.content !== inputs.message)) {
      throw new Error('Execution input entry must match the original user message')
    }
    context.graphExecution.dispatch({ kind: 'execution_event', payload: {
      executionId: selected.executionId, kind: selected.kind,
      // A continuation inherits execution context. Carry this turn's metadata
      // explicitly, including empty optional fields, so the older turn cannot
      // supply its speech generation, reply target, or response timestamp.
      context: {
        userMessage: inputs.message,
        conversationInput: inputs.message,
        userMessageEntry: inputs.entry ?? null,
        sessionId: context.sessionId ?? null,
        memoryTimestamp: context.memoryTimestamp ?? inputs.entry?.timestamp ?? null,
        ttsGeneration: context.ttsGeneration ?? null,
        idempotencyKey: context.idempotencyKey ?? null,
        replyToQuestionId: context.replyToQuestionId ?? null,
        replyToContent: context.replyToContent ?? null,
        replyToDesireId: context.replyToDesireId ?? null,
        replyToDesireTitle: context.replyToDesireTitle ?? null,
        desireContext: context.desireContext ?? null,
        environmentObservation: context.environmentObservation ?? null,
        environmentObservationCurrent: context.environmentObservationCurrent === true,
      },
    } })
    return { sent: true }
  },
})
