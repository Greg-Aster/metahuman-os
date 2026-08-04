import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './paths.js';

const read = (relative: string) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

const chat = read('apps/site/src/components/ChatInterface.svelte');
const centerContent = read('apps/site/src/components/CenterContent.svelte');
const queueConsumer = read('apps/site/src/components/TTSQueueConsumer.svelte');
const ttsComposable = read('apps/site/src/lib/client/composables/useTTS.ts');
const speechPreference = read('apps/site/src/lib/client/assistant-speech-preference.ts');

assert.ok(
  !chat.includes('speakAssistantResponse'),
  'ChatInterface must not infer TTS admission from assistant response text',
);
assert.ok(
  !chat.includes('lastAutoSpoken'),
  'ChatInterface must not retain timer/text deduplication for duplicate TTS admissions',
);
assert.doesNotMatch(
  chat,
  /tts-queue-stream|playAdmittedTTSItem|connectTTSQueueStream/,
  'ChatInterface must not own the node-admitted TTS queue lifecycle',
);
assert.equal(
  (chat.match(/ttsApi\.speak\(/g) || []).length,
  1,
  'ChatInterface may call TTS only for the explicit user speak action',
);
assert.ok(
  chat.includes('on:speakMessage='),
  'the explicit user speak-message control must remain available',
);
assert.match(
  chat,
  /let ttsEnabled = true;/,
  'node-admitted speech must be enabled by default',
);
assert.match(
  chat,
  /ttsEnabled = p\.speechDisabled !== true;/,
  'only the explicit disable-speech preference may suppress node-admitted playback',
);
assert.match(
  chat,
  /speechDisabled: !ttsEnabled/,
  'the main chat speech button must persist the explicit disable-speech preference',
);
assert.match(
  chat,
  /syncSpeechDisabledPreference\(!ttsEnabled\)/,
  'the main chat speech button must synchronize its disable state for server-owned robot speech',
);
assert.match(
  chat,
  /on:click=\{toggleAssistantSpeech\}/,
  'the main chat speech button must use the canonical speech toggle',
);
assert.match(
  chat,
  /function toggleAssistantSpeech\(\): void \{[\s\S]*?ttsEnabled = !ttsEnabled;[\s\S]*?ttsApi\.stopActiveAudio\(\);[\s\S]*?ttsApi\.cancelInFlightTts\(\);[\s\S]*?saveChatPrefs\(\);[\s\S]*?\}/,
  'disabling speech from the main chat must stop current audio, cancel synthesis, and persist the choice',
);
assert.doesNotMatch(
  chat,
  /enableAssistantSpeech/,
  'microphone modes must not override the explicit disable-speech preference',
);
assert.match(
  centerContent,
  /import TTSQueueConsumer from ['"]\.\/TTSQueueConsumer\.svelte['"]/,
  'the always-mounted application center must import the admitted TTS queue consumer',
);
assert.ok(
  centerContent.indexOf('<TTSQueueConsumer />') >= 0
  && centerContent.indexOf('<TTSQueueConsumer />') < centerContent.indexOf("{#if $activeView === 'chat'}"),
  'the admitted TTS queue consumer must mount outside the Chat view condition',
);
assert.match(
  queueConsumer,
  /apiEventSource\(['"]\/api\/tts-queue-stream['"]\)/,
  'the app-level consumer must listen to the existing node-owned local TTS queue',
);
assert.match(
  queueConsumer,
  /readAssistantSpeechEnabled\(\)[\s\S]*?ttsApi\.speak\(/,
  'the app-level consumer must honor the explicit speech disable preference before playback',
);
assert.doesNotMatch(
  queueConsumer,
  /viewDependency|document\.hidden|connectionPool/,
  'automatic playback must not stop when Chat unmounts, the tab hides, or passive Chat streams suspend',
);
assert.match(
  speechPreference,
  /speechDisabled[^]*?=== true/,
  'only speechDisabled=true may suppress app-level admitted playback',
);
assert.match(
  ttsComposable,
  /const sharedTTSApi = createTTS\(\);[\s\S]*?export function useTTS\(\) \{[\s\S]*?return sharedTTSApi;/,
  'manual and automatic speech must share one audio channel and browser unlock state',
);

const ttsNode = read('packages/core/src/nodes/output/tts.node.ts');
assert.match(
  ttsNode,
  /settings\.outputTarget === 'robot'[\s\S]*?renderRobot\([\s\S]*?dependencies\.queue/,
  'the standard TTS node must route robot output before the existing local browser queue',
);

const environmentGraph = JSON.parse(
  read('etc/cognitive-graphs/environment-mode.json'),
) as {
  nodes: Array<{
    id: string;
    type?: string;
    data?: { nodeType?: string; label?: string; title?: string; properties?: Record<string, unknown> };
  }>;
  edges: Array<{
    source?: string;
    target?: string;
    sourceHandle?: string;
    targetHandle?: string;
  }>;
};

const ttsNodes = environmentGraph.nodes.filter(node => node.data?.nodeType === 'tts');
assert.equal(ttsNodes.length, 1, 'Environment Mode must contain exactly one standard TTS Output node');
assert.equal(ttsNodes[0]?.type, 'outputNode');
assert.equal(ttsNodes[0]?.data?.properties?.source, 'environment-mode');

const ttsNodeId = ttsNodes[0]!.id;
assert.ok(
  environmentGraph.edges.some(edge =>
    edge.source === 'conversation-buffer'
    && edge.sourceHandle === 'response'
    && edge.target === ttsNodeId
    && edge.targetHandle === 'conversation'
  ),
  'Environment Mode responses and refinement updates must pass through the canonical Conversation Buffer before the standard TTS input',
);

for (const node of environmentGraph.nodes) {
  const displayName = `${node.data?.label || ''} ${node.data?.title || ''}`;
  if (/\b(?:speech|tts)\b/i.test(displayName)) {
    assert.equal(
      node.data?.nodeType,
      'tts',
      `speech-labelled Environment Mode node ${node.id} must use the standard TTS executor`,
    );
  }
}

console.log('tts-node-ownership.spec.ts passed');
