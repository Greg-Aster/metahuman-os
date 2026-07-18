import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../path-builder.js';
import {
  buildOllamaChatMessages,
  buildOllamaChatRequest,
  normalizeOllamaChatResponse,
  resolveOllamaThinkingMode,
} from '../ollama.js';
import { buildVLLMChatMessages } from '../vllm.js';
import { environmentImageInputNode } from '../nodes/environment/image-input.node.js';
import { environmentContextBuilderNode } from '../nodes/environment/context-builder.node.js';
import { stringifyEnvironmentObservation } from '../nodes/environment/helpers.js';
import { resolveModelForCognitiveMode } from '../model-resolver.js';
import { normalizeProviderReasoningResponse } from '../model-router.js';
import { assertAdapterPreservesImageInput, callProvider } from './bridge.js';
import {
  ProviderInputError,
  inspectProviderMessages,
  parseProviderImageDataUrl,
  providerImagePolicyFromOptions,
  providerMessagesContainImages,
  type ProviderMessage,
} from './types.js';

const dataUrl = 'data:image/jpeg;base64,/9j/2Q==';
const environmentDataUrl = `data:image/jpeg;base64,${fs.readFileSync(new URL(
  '../../../../vendor/whisper.cpp/examples/whisper.android.java/README_files/1.jpg',
  import.meta.url,
)).toString('base64')}`;
const policy = providerImagePolicyFromOptions({
  maxImages: 2,
  maxImageBytes: 1024,
  allowedImageMimeTypes: ['image/jpeg', 'image/png'],
});
const messages: ProviderMessage[] = [{
  role: 'user',
  content: [
    { type: 'text', text: 'Describe the attached frame.' },
    { type: 'image_url', image_url: { url: dataUrl } },
  ],
}];

assert.deepEqual(parseProviderImageDataUrl(dataUrl, policy), {
  mimeType: 'image/jpeg',
  base64: '/9j/2Q==',
  bytes: 4,
});
assert.equal(providerMessagesContainImages(messages), true);
assert.deepEqual(inspectProviderMessages(messages, policy), {
  imageCount: 1,
  totalImageBytes: 4,
  mimeTypes: ['image/jpeg'],
});

assert.deepEqual(buildOllamaChatMessages(messages, policy), [{
  role: 'user',
  content: 'Describe the attached frame.',
  images: ['/9j/2Q=='],
}]);
assert.deepEqual(buildVLLMChatMessages(messages), messages);

const capturedOllamaRequest = buildOllamaChatRequest(
  'selected-image-model',
  buildOllamaChatMessages(messages, policy),
);
assert.equal(capturedOllamaRequest.model, 'selected-image-model');
assert.deepEqual(capturedOllamaRequest.messages, [{
  role: 'user',
  content: 'Describe the attached frame.',
  images: ['/9j/2Q=='],
}]);

assert.equal(resolveOllamaThinkingMode(undefined), false);
assert.equal(resolveOllamaThinkingMode(false), false);
assert.equal(resolveOllamaThinkingMode(true), true);
assert.equal(buildOllamaChatRequest('thinking-model', [], {
  think: resolveOllamaThinkingMode(undefined),
}).think, false);
const configuredOllamaRequest = buildOllamaChatRequest('configured-model', [], {
  num_ctx: 8192,
  num_predict: 2048,
  top_k: 40,
  min_p: 0.05,
  seed: 7,
  keep_alive: '5m',
});
assert.deepEqual(configuredOllamaRequest.options, {
  temperature: 0.7,
  top_k: 40,
  min_p: 0.05,
  seed: 7,
  num_ctx: 8192,
  num_predict: 2048,
});
assert.equal(configuredOllamaRequest.keep_alive, '5m');

const nativeThinkingResponse = normalizeOllamaChatResponse({
  model: 'thinking-model',
  created_at: new Date().toISOString(),
  message: { role: 'assistant', content: '', thinking: 'Reasoning consumed the output budget.' },
  done: true,
  done_reason: 'length',
});
assert.deepEqual(nativeThinkingResponse, {
  content: '',
  thinking: 'Reasoning consumed the output budget.',
});
assert.deepEqual(normalizeProviderReasoningResponse(nativeThinkingResponse), {
  thinking: 'Reasoning consumed the output budget.',
  stripped: '[Response incomplete - thinking exceeded token limit]',
});

assert.throws(
  () => parseProviderImageDataUrl('https://example.test/frame.jpg', policy),
  (error: unknown) => error instanceof ProviderInputError && /remote image URLs are not accepted/.test(error.message),
);
assert.throws(
  () => inspectProviderMessages([...messages, ...messages, ...messages], policy),
  (error: unknown) => error instanceof ProviderInputError && /2-image limit/.test(error.message),
);
assert.throws(
  () => assertAdapterPreservesImageInput('Big Brother', 1),
  (error: unknown) => error instanceof ProviderInputError && /does not preserve image content/.test(error.message),
);
assert.doesNotThrow(() => assertAdapterPreservesImageInput('Big Brother', 0));
await assert.rejects(
  () => callProvider('mock', messages, { model: 'configured-text-model', modelCapabilities: ['text'] }),
  (error: unknown) => error instanceof ProviderInputError
    && /selected model configured-text-model is not configured for image input/.test(error.message),
);

const visual = {
  id: 'generic-camera-1',
  timestamp: new Date().toISOString(),
  mimeType: 'image/jpeg',
  dataUrl: environmentDataUrl,
  width: 1,
  height: 1,
};
const observation = {
  environmentId: 'generic-camera-environment',
  adapter: 'generic-adapter',
  sessionId: 'session-1',
  timestamp: new Date().toISOString(),
  capabilities: { actions: [] },
  visual,
};

const prompt = stringifyEnvironmentObservation(observation, 'Inspect the environment.');
assert.match(prompt, /generic-camera-1, image\/jpeg, 1x1/);
assert.doesNotMatch(prompt, /data:image|\/9j\/2Q==/);

const imageOutput = await environmentImageInputNode.execute({ visual }, {} as never, {});
const contextOutput = await environmentContextBuilderNode.execute({
  observation,
  instruction: 'Inspect the environment in front of the robot.',
  images: imageOutput.images,
}, {} as never, {});
const currentTaskContent = contextOutput.messages.at(-1)?.content;
assert.equal(Array.isArray(currentTaskContent), true);
assert.deepEqual(currentTaskContent[1], {
  type: 'image_url',
  image_url: { url: environmentDataUrl },
});

// Message modality is deliberately absent from model resolution. Text and
// image calls therefore enter the provider bridge with the same normal target.
const textTarget = resolveModelForCognitiveMode('environment', 'persona', 'test');
const imageTarget = resolveModelForCognitiveMode('environment', 'persona', 'test');
assert.deepEqual(
  { id: imageTarget.id, provider: imageTarget.provider, model: imageTarget.model },
  { id: textTarget.id, provider: textTarget.provider, model: textTarget.model },
);

const backendConfig = JSON.parse(fs.readFileSync(path.join(ROOT, 'etc', 'llm-backend.json'), 'utf8'));
assert.equal(Object.prototype.hasOwnProperty.call(backendConfig, 'vision'), false);

const graph = JSON.parse(fs.readFileSync(path.join(ROOT, 'etc', 'cognitive-graphs', 'environment-mode.json'), 'utf8'));
assert.ok(graph.edges.some((edge: Record<string, unknown>) => edge.source === '11'
  && edge.target === '3'
  && edge.sourceHandle === 'images'
  && edge.targetHandle === 'images'));

for (const relativePath of [
  'packages/core/src/providers/bridge.ts',
  'packages/core/src/model-router.ts',
  'packages/core/src/llm-backend.ts',
]) {
  const source = fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
  for (const forbiddenSymbol of [
    `resolve${'Vision'}ModelRoute`,
    `get${'Vision'}ModelStatus`,
    `require${'Vision'}`,
    `${'Vision'}ModelConfig`,
    `${'Vision'}InputError`,
  ]) {
    assert.equal(source.includes(forbiddenSymbol), false);
  }
}

const smokeSource = fs.readFileSync(path.join(ROOT, 'scripts', 'smoke-vision.ts'), 'utf8');
assert.match(smokeSource, /callLLM\(/);
assert.match(smokeSource, /cognitiveMode: 'environment'/);
assert.doesNotMatch(smokeSource, /callProvider\(|qwen|ollama\.chat|vllm\.chat/i);

console.log('provider multimodal checks passed');
