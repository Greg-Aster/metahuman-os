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
    { name: 'command', type: 'object', description: 'Coordinator work for the sendText command' },
    { name: 'accepted', type: 'boolean', description: 'Whether command work was created' },
  ],
  description: 'Queues chat/speech text for the active environment adapter.',
  async execute(inputs, context) {
    const text = typeof inputs.text === 'string' ? inputs.text.trim() : '';
    if (!text) {
      return { command: null, accepted: false };
    }

    const command = enqueueEnvironmentAction({
      type: 'sendText',
      text,
      sessionId: typeof inputs.sessionId === 'string' ? inputs.sessionId : undefined,
    }, { username: context.username, correlationId: context.sessionId, source: 'user' });

    return { command, accepted: true };
  },
});
