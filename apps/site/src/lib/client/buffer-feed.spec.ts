import assert from 'node:assert/strict';
import {
  projectBufferFeed,
  replaceBufferSlice,
  stampBufferSource,
  type BufferView,
} from './buffer-feed.js';

type TestMessage = {
  role: string;
  content: string;
  timestamp: number;
  meta?: Record<string, any>;
};

const conversation = stampBufferSource<TestMessage>({
  role: 'user', content: 'spoken', timestamp: 30,
}, 'conversation');
const inner = stampBufferSource<TestMessage>({
  role: 'thought', content: 'unvoiced', timestamp: 10,
}, 'inner');
const system = stampBufferSource<TestMessage>({
  role: 'system', content: 'service started', timestamp: 40,
}, 'system');
const robot = stampBufferSource<TestMessage>({
  role: 'robot', content: 'wave queued', timestamp: 20,
}, 'robot');
const all = [conversation, inner, system, robot];

assert.deepEqual(
  projectBufferFeed(all, new Set<BufferView>(['conversation'])).map(message => message.content),
  ['spoken'],
  'Conversation reads only Conversation Buffer',
);
assert.deepEqual(
  projectBufferFeed(all, new Set<BufferView>(['inner'])).map(message => message.content),
  ['unvoiced'],
  'Inner reads only Inner Dialogue Buffer',
);
assert.deepEqual(
  projectBufferFeed(all, new Set<BufferView>(['system'])).map(message => message.content),
  ['wave queued', 'service started'],
  'System chronologically merges Robot Buffer and System Buffer',
);
assert.deepEqual(
  projectBufferFeed(all, new Set<BufferView>(['conversation', 'inner'])).map(message => message.content),
  ['unvoiced', 'spoken'],
  'Multi-select combines reads without selecting a write target',
);

const replaced = replaceBufferSlice(all, 'robot', [
  { role: 'robot', content: 'sit queued', timestamp: 5 },
]);
assert.deepEqual(
  replaced.filter(message => message.meta?.bufferSource === 'robot').map(message => message.content),
  ['sit queued'],
  'An authoritative stream update replaces only its own buffer slice',
);
assert.deepEqual(
  replaced.map(message => message.content),
  ['sit queued', 'unvoiced', 'spoken', 'service started'],
  'Replacement preserves global chronological order',
);

console.log('buffer-feed.spec.ts: all assertions passed');
