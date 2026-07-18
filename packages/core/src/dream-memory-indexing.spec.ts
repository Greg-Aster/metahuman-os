import assert from 'node:assert/strict';
import { extractMemoryContent } from './memory-content-filter.js';
import { normalizeRequestedMemoryTypes } from './nodes/memory/memory-router.node.js';
import { SmartRouterNode } from './nodes/routing/smart-router.node.js';

const dream = { type: 'dream', content: 'A remembered dream.' };
const daydream = { type: 'daydream', content: 'A remembered daydream.' };
const innerDialogue = { type: 'inner_dialogue', content: 'A private reflection.' };

assert.equal(extractMemoryContent(dream, 'user'), dream.content);
assert.equal(extractMemoryContent(daydream, 'user'), daydream.content);
assert.equal(extractMemoryContent(dream, 'agent'), dream.content);
assert.equal(extractMemoryContent(daydream, 'agent'), daydream.content);
assert.equal(extractMemoryContent(innerDialogue, 'user'), null);

assert.deepEqual(normalizeRequestedMemoryTypes(['Dream', ' daydream ', 'dream']), ['dream', 'daydream']);
assert.deepEqual(normalizeRequestedMemoryTypes('reflection'), ['reflection']);
assert.equal(normalizeRequestedMemoryTypes([]), undefined);

const routing = await SmartRouterNode.execute({
  orchestratorAnalysis: {
    needsMemory: true,
    memoryTier: 'high',
    memoryQuery: 'dreams from last night',
    memoryTypes: ['dream'],
    complexity: 0.4,
  },
}, {}, {});

assert.deepEqual(routing.memoryHints, {
  needsMemory: true,
  memoryTier: 'high',
  memoryQuery: 'dreams from last night',
  memoryTypes: ['dream'],
});

console.log('dream-memory-indexing.spec.ts passed');
