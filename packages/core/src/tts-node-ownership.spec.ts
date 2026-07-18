import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './paths.js';

const read = (relative: string) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

const chat = read('apps/site/src/components/ChatInterface.svelte');

assert.ok(
  !chat.includes('speakAssistantResponse'),
  'ChatInterface must not infer TTS admission from assistant response text',
);
assert.ok(
  !chat.includes('lastAutoSpoken'),
  'ChatInterface must not retain timer/text deduplication for duplicate TTS admissions',
);
assert.equal(
  (chat.match(/playAdmittedTTSItem\(/g) || []).length,
  2,
  'node-admitted browser playback must be defined once and called only by the TTS queue consumer',
);
assert.equal(
  (chat.match(/ttsApi\.speak\(/g) || []).length,
  2,
  'ChatInterface may call TTS only for a node-admitted queue item or an explicit user speak action',
);
assert.ok(
  chat.includes('on:speakMessage='),
  'the second allowed TTS call must remain the explicit user speak-message control',
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
    edge.source === '8'
    && edge.sourceHandle === 'response'
    && edge.target === ttsNodeId
    && edge.targetHandle === 'conversation'
  ),
  'Environment Mode single bridge-resolved response must enter the standard TTS conversation input',
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
