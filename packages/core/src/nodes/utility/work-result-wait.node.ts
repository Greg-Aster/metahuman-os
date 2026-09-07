import { defineNode } from '../types.js'

export const workResultWaitNode = defineNode({
  id: 'work_result_wait', name: 'Wait for Agent Result', category: 'utility',
  description: 'Releases the workflow worker until the selected finite agent returns its correlated Coordinator result.',
  inputs: [{ name: 'work', type: 'object', description: 'Checkpointed finite-agent dispatch' }],
  outputs: [{ name: 'result', type: 'object', description: 'Agent result, including failure or cancellation' }],
  properties: {},
  async execute(inputs, context) {
    if (!context.graphExecution || !inputs.work?.effectId) throw new Error('Agent result wait requires an identified dispatch')
    for (;;) {
      const event = context.graphExecution.waitForEvent('agent_result')
      const payload = event.payload as Record<string, any>
      if (event.kind === 'work_result' && payload.effectId === inputs.work.effectId) return { result: payload }
    }
  },
})
