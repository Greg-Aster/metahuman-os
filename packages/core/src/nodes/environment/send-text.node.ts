import { defineNode } from '../types.js';
import { enqueueEnvironmentAction } from '../../environment-interface/index.js';

export const environmentSendTextNode = defineNode({
  id: 'environment_send_text',
  name: 'Environment Send Text',
  category: 'environment',
  inputs: [
    { name: 'text', type: 'string', description: 'Text to send into the environment' },
    { name: 'sessionId', type: 'string', optional: true, description: 'Target environment session' },
  ],
  outputs: [
    { name: 'action', type: 'object', description: 'Queued sendText action' },
    { name: 'queued', type: 'boolean', description: 'Whether text was queued' },
  ],
  description: 'Queues chat/speech text for the active environment adapter.',
  async execute(inputs) {
    const text = typeof inputs.text === 'string' ? inputs.text.trim() : '';
    if (!text) {
      return { action: null, queued: false };
    }

    const action = enqueueEnvironmentAction({
      type: 'sendText',
      text,
      sessionId: typeof inputs.sessionId === 'string' ? inputs.sessionId : undefined,
    });

    return { action, queued: true };
  },
});
