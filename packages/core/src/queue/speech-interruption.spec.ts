import assert from 'node:assert/strict';
import test from 'node:test';
import { UnifiedQueueManager } from './unified-queue-manager.js';

function fixture() {
  const manager = new UnifiedQueueManager();
  const render = (requestId: string, sessionId = 'robot') => manager.enqueue({
    type: 'generic', handler: 'tts.robot-speech', username: 'fixture', resource: 'robot-speech-render',
    input: { requestId, sessionId },
  });
  const chunk = (requestId: string, index: number, sessionId = 'robot') => manager.enqueue({
    type: 'environment_command', handler: 'environment.command', username: 'fixture',
    resource: `environment-speech:${sessionId}`, input: { type: 'speak', sessionId,
      id: `${sessionId}:${requestId}:${index}`, metadata: { speechRequestId: requestId, speechChunkIndex: index } },
  });
  return { manager, render, chunk };
}

test('new utterance replaces current speech without waiting for its receipt; chunks stay together', () => {
  const { manager, render, chunk } = fixture();
  const old = render('old'); manager.claim(old.id);
  const speaking = chunk('old', 0); assert.ok(manager.claim(speaking.id));
  const unsent = chunk('old', 1);
  const otherRobot = chunk('other', 0, 'second-robot'); manager.claim(otherRobot.id);
  const movement = manager.enqueue({ type: 'environment_command', username: 'fixture', resource: 'body:robot',
    input: { type: 'robotCommand', sessionId: 'robot', command: 'walk' } });
  manager.claim(movement.id);
  render('new');
  assert.ok(old.cancellationRequestedAt);
  assert.ok(speaking.cancellationRequestedAt);
  assert.equal(unsent.state, 'cancelled');
  assert.equal(chunk('old', 2).state, 'cancelled', 'A late synthesis chunk cannot resurrect replaced speech');
  const next = chunk('new', 0); assert.ok(manager.claim(next.id), 'No old playback receipt has arrived');
  const remainder = chunk('new', 1); assert.equal(manager.claim(remainder.id), null);
  manager.acknowledgeCancellation(speaking.id);
  assert.ok(manager.hasCurrentBodyLease(next.id), 'Late old feedback cannot release the new speaker');
  assert.equal(movement.state, 'leased'); assert.equal(otherRobot.state, 'leased');
  manager.complete(next.id, true); assert.ok(manager.claim(remainder.id));
});

test('restored unknown speech requests reconciliation without blocking the next utterance', () => {
  const { manager, chunk } = fixture();
  const old = chunk('old', 0); manager.claim(old.id);
  const unsent = chunk('old', 1);
  for (const savedWaiting of [false, true]) {
    const saved = JSON.parse(JSON.stringify(manager.exportState()));
    if (savedWaiting) { saved.items[0].state = 'waiting'; saved.items[0].waitingReason = 'outcome_unknown'; }
    const restored = new UnifiedQueueManager(); restored.importState(saved);
    const pending = restored.getTask(old.id)!;
    assert.ok(pending.cancellationRequestedAt);
    assert.equal(restored.getTask(unsent.id)?.state, 'cancelled');
    assert.notEqual(pending.state, 'completed');
    const fresh = restored.enqueue({ type: 'environment_command', username: 'fixture', resource: 'environment-speech:robot',
      input: { type: 'speak', sessionId: 'robot', id: 'fresh' } });
    assert.ok(restored.claim(fresh.id));
    const restarted = new UnifiedQueueManager(); restarted.importState(JSON.parse(JSON.stringify(restored.exportState())));
    assert.equal(restarted.getTask(old.id)?.cancellationRequestedAt, pending.cancellationRequestedAt);
  }
});

test('direct prepared utterances replace speech without allowing delayed old chunks back in', () => {
  const { manager, chunk } = fixture();
  const old = chunk('old', 0); manager.claim(old.id);
  const newSpeech = chunk('new', 0);
  assert.ok(manager.claim(newSpeech.id));
  assert.ok(old.cancellationRequestedAt);
  assert.equal(chunk('old', 1).state, 'cancelled');
  assert.equal(newSpeech.cancellationRequestedAt, undefined);
  const same = chunk('new', 1); assert.equal(same.state, 'queued');
  assert.equal(manager.claim(same.id), null);
});
