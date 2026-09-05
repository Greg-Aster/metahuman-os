/**
 * Response Context Writer Node
 *
 * Writes card-response context to the response buffer.
 * The downstream Conversation Buffer node exclusively owns chat persistence.
 *
 * This separation allows:
 * - Chat display (conversation buffer)
 * - Rolling context for follow-up messages (response buffer)
 *
 * Inputs:
 *   - response: LLM response text
 *   - responseBuffer: Response buffer to update
 *   - userId: User ID
 *   - actionTaken: Description of action taken
 *   - message: Original user message
 *
 * Outputs:
 *   - responseBufferId: ID of the response buffer
 *   - persisted: Whether both exchanges were durably written
 */

import { defineNode, type NodeDefinition } from '../types.js';
import {
  appendExchangeToResponseBuffer,
  type ResponseBuffer,
} from '../../response-buffer.js';

export const ResponseContextWriterNode: NodeDefinition = defineNode({
  id: 'response_context_writer',
  name: 'Response Context Writer',
  category: 'output',
  inputs: [
    { name: 'response', type: 'string', description: 'LLM response text' },
    { name: 'responseBuffer', type: 'object', description: 'Response buffer' },
    { name: 'userId', type: 'string', description: 'User ID' },
    { name: 'actionTaken', type: 'string', description: 'Action taken' },
    { name: 'message', type: 'string', description: 'Original user message' },
  ],
  outputs: [
    { name: 'responseBufferId', type: 'string', description: 'Response buffer ID' },
    { name: 'persisted', type: 'boolean', description: 'Both exchanges were persisted' },
    { name: 'exchangeCount', type: 'number', description: 'Number of exchanges written' },
    { name: 'response', type: 'string', description: 'Pass-through response' },
  ],
  properties: {},
  description: 'Persists card-specific rolling context before canonical conversation nodes save the exchange.',

  execute: async (inputs) => {
    const response = typeof inputs.response === 'string' ? inputs.response : '';
    const responseBuffer = inputs.responseBuffer as ResponseBuffer | undefined;
    const userId = typeof inputs.userId === 'string' ? inputs.userId : '';
    const actionTaken = typeof inputs.actionTaken === 'string' ? inputs.actionTaken : '';
    const message = typeof inputs.message === 'string' ? inputs.message : '';

    if (!response.trim()) throw new Error('Response Context Writer requires generated response text');
    if (!responseBuffer?.id) throw new Error('Response Context Writer requires a response buffer');
    if (!userId || userId === 'anonymous') throw new Error('Response Context Writer requires an authenticated user');
    if (!message.trim()) throw new Error('Response Context Writer requires the original user message');
    if (!actionTaken.trim()) throw new Error('Response Context Writer requires an action receipt');

    const exchange = appendExchangeToResponseBuffer(
      userId,
      responseBuffer.id,
      message,
      response,
      actionTaken,
    );
    if (!exchange) throw new Error(`Failed to persist exchange to response buffer ${responseBuffer.id}`);

    console.log(`[response-context-writer] Updated response buffer: ${responseBuffer.id}`);

    return {
      responseBufferId: responseBuffer.id,
      persisted: true,
      exchangeCount: 2,
      response: response.trim(),
    };
  },
});

export default ResponseContextWriterNode;
