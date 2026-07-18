import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  listCuratedConversations,
  listCuriosityQuestions,
  mergeCuriosityQuestions,
  scanEpisodicInventory,
} from './memories-all.js';

const profileRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-memory-browser-'));
const memoryRoot = path.join(profileRoot, 'memory');
const stateRoot = path.join(profileRoot, 'state');
const episodicRoot = path.join(memoryRoot, 'episodic');
const datedRoot = path.join(episodicRoot, '2026', '07', '18');

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value), 'utf8');
}

function event(id: string, type: string, extras: Record<string, unknown> = {}) {
  return {
    id,
    timestamp: `2026-07-18T00:00:0${id.slice(-1)}.000Z`,
    content: `${type} content`,
    type,
    tags: [],
    links: [],
    ...extras,
  };
}

try {
  writeJson(path.join(datedRoot, 'conversation.json'), event('evt-1', 'conversation'));
  writeJson(path.join(datedRoot, 'reflection.json'), event('evt-2', 'inner_dialogue', {
    tags: ['idle-thought', 'self-reflection'],
    metadata: { dialogueSource: 'reflector' },
  }));
  writeJson(path.join(datedRoot, 'daydream.json'), event('evt-3', 'daydream'));
  writeJson(path.join(datedRoot, 'ingested.json'), event('evt-4', 'observation', { tags: ['ingested'] }));
  writeJson(path.join(episodicRoot, 'audio', '2026', '07', '18', 'audio.json'), event('evt-5', 'audio', { tags: ['transcript'] }));
  writeJson(path.join(datedRoot, '_pruned', 'pruned.json'), event('evt-6', 'conversation'));
  writeJson(path.join(datedRoot, 'curiosity.json'), event('evt-7', 'inner_dialogue', {
    content: 'What did you notice?',
    tags: ['curiosity', 'question'],
    metadata: { dialogueSource: 'curiosity' },
  }));
  writeJson(path.join(datedRoot, 'agency.json'), event('evt-8', 'inner_dialogue', {
    tags: ['agency', 'planning'],
  }));

  const inventory = scanEpisodicInventory(profileRoot, episodicRoot);
  assert.deepEqual(inventory.episodic.map(item => item.id), ['evt-8', 'evt-1']);
  assert.deepEqual(inventory.reflections.map(item => item.id), ['evt-2']);
  assert.deepEqual(inventory.dreams.map(item => item.id), ['evt-3']);
  assert.deepEqual(inventory.curiosity.map(item => item.id), ['evt-7']);
  assert.deepEqual(inventory.aiIngestor.map(item => item.id), ['evt-4']);
  assert.deepEqual(inventory.audio.map(item => item.id), ['evt-5']);
  assert.deepEqual(inventory.pruned.map(item => item.id), ['evt-6']);
  assert.equal(inventory.activeTotal, 7);

  const curatedPath = path.join(memoryRoot, 'curated', 'conversations', 'curated.json');
  writeJson(curatedPath, {
    id: 'evt-curated',
    conversationalEssence: 'A concise curated memory',
    originalTimestamp: '2026-07-18T01:00:00.000Z',
  });
  assert.deepEqual(listCuratedConversations(profileRoot, memoryRoot), [{
    name: 'A concise curated memory',
    relPath: 'profile:memory/curated/conversations/curated.json',
    timestamp: '2026-07-18T01:00:00.000Z',
  }]);

  const questionPath = path.join(stateRoot, 'curiosity', 'questions', 'pending', 'question.json');
  writeJson(questionPath, {
    id: 'cur-q-1',
    question: 'What did you notice?',
    askedAt: '2026-07-18T02:00:00.000Z',
    status: 'pending',
  });
  const persistedQuestions = listCuriosityQuestions(profileRoot, stateRoot);
  assert.deepEqual(persistedQuestions, [{
    id: 'cur-q-1',
    question: 'What did you notice?',
    askedAt: '2026-07-18T02:00:00.000Z',
    status: 'pending',
    relPath: 'profile:state/curiosity/questions/pending/question.json',
    seedMemories: undefined,
    answeredAt: undefined,
  }]);
  assert.equal(mergeCuriosityQuestions(persistedQuestions, inventory.curiosity).length, 1);

  console.log('memories-all.spec.ts passed');
} finally {
  fs.rmSync(profileRoot, { recursive: true, force: true });
}
