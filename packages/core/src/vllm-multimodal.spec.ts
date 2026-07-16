import assert from 'node:assert/strict';
import { buildVLLMChatMessages, buildVLLMChatRequest } from './vllm.js';

const imageUrl = 'data:image/jpeg;base64,/9j/2Q==';
const messages = buildVLLMChatMessages([
  {
    role: 'user',
    content: [
      { type: 'text', text: 'Inspect this returned camera still.' },
      { type: 'image_url', image_url: { url: imageUrl } },
    ],
  },
]);

assert.equal(Array.isArray(messages[0]?.content), true);
assert.deepEqual(messages[0]?.content, [
  { type: 'text', text: 'Inspect this returned camera still.' },
  { type: 'image_url', image_url: { url: imageUrl } },
]);

const capturedRequest = buildVLLMChatRequest(messages, { model: 'selected-vllm-model' });
assert.equal(capturedRequest.model, 'selected-vllm-model');
assert.deepEqual(capturedRequest.messages, messages);

console.log('vLLM multimodal message checks passed');
