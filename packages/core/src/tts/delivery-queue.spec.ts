import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  TTSDeliveryQueueStore,
  TTS_DELIVERY_LEASE_MS,
  TTS_DELIVERY_RETRY_DELAY_MS,
} from './delivery-queue.js';

function createTestStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-tts-delivery-'));
  let now = 1_000;
  let tokenSequence = 0;
  const store = new TTSDeliveryQueueStore({
    queuePath: path.join(root, 'tts-queue.json'),
    notificationPath: path.join(root, 'notifications', 'test.notify'),
    now: () => now,
    createToken: () => `lease-token-${++tokenSequence}-0123456789`,
  });
  return {
    root,
    store,
    setNow(value: number) {
      now = value;
    },
    getNow() {
      return now;
    },
  };
}

test('claimed speech remains durable until its matching lease completes', () => {
  const fixture = createTestStore();
  try {
    const queued = fixture.store.enqueue('Speak this automatically.', 'conversation', 'environment-mode');
    assert.ok(queued);

    const firstClaim = fixture.store.claimNext('current-client');
    assert.equal(firstClaim.item?.id, queued.id);
    assert.equal(firstClaim.item?.deliveryAttempts, 1);
    assert.equal(fixture.store.peek().length, 1, 'claiming must not remove queued speech');

    const competingClaim = fixture.store.claimNext('stale-client');
    assert.equal(competingClaim.item, null, 'a second client must not steal an active lease');
    assert.equal(competingClaim.nextCheckAt, firstClaim.item?.leaseExpiresAt);

    const wrongLease = fixture.store.updateDelivery(queued.id, 'lease-token-wrong-0123456789', 'complete');
    assert.equal(wrongLease.state, 'lease-mismatch');
    assert.equal(fixture.store.peek().length, 1);

    const completed = fixture.store.updateDelivery(
      queued.id,
      firstClaim.item!.leaseToken,
      'complete',
    );
    assert.equal(completed.state, 'completed');
    assert.deepEqual(fixture.store.peek(), []);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('an abandoned browser delivery is reclaimed after its lease expires', () => {
  const fixture = createTestStore();
  try {
    const queued = fixture.store.enqueue('Recover this response.', 'conversation', 'environment-mode');
    assert.ok(queued);
    const abandoned = fixture.store.claimNext('pre-restart-client');
    assert.ok(abandoned.item);

    fixture.setNow(fixture.getNow() + TTS_DELIVERY_LEASE_MS + 1);
    const recovered = fixture.store.claimNext('post-restart-client');
    assert.equal(recovered.item?.id, queued.id);
    assert.equal(recovered.item?.deliveryAttempts, 2);
    assert.notEqual(recovered.item?.leaseToken, abandoned.item?.leaseToken);

    const completed = fixture.store.updateDelivery(
      queued.id,
      recovered.item!.leaseToken,
      'complete',
    );
    assert.equal(completed.state, 'completed');
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('failed playback retries in order and stops at the bounded retry limit', () => {
  const fixture = createTestStore();
  try {
    const first = fixture.store.enqueue('First response.', 'conversation', 'environment-mode');
    const second = fixture.store.enqueue('Second response.', 'conversation', 'environment-mode');
    assert.ok(first && second);

    for (let attempt = 1; attempt <= 3; attempt++) {
      const claim = fixture.store.claimNext('current-client');
      assert.equal(claim.item?.id, first.id);
      assert.equal(claim.item?.deliveryAttempts, attempt);
      const retry = fixture.store.updateDelivery(first.id, claim.item!.leaseToken, 'retry');

      if (attempt < 3) {
        assert.equal(retry.state, 'retrying');
        assert.equal(fixture.store.claimNext('current-client').item, null);
        fixture.setNow(fixture.getNow() + TTS_DELIVERY_RETRY_DELAY_MS + 1);
      } else {
        assert.equal(retry.state, 'failed');
      }
    }

    const nextClaim = fixture.store.claimNext('current-client');
    assert.equal(nextClaim.item?.id, second.id, 'a failed item must not permanently block later speech');
    const queue = fixture.store.readQueue();
    assert.equal(queue.failed?.length, 1);
    assert.equal(queue.failed?.[0]?.id, first.id);
    assert.equal(queue.failed?.[0]?.failureReason, 'retry-limit');
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('a user interruption atomically removes active and pending speech across restart', () => {
  const fixture = createTestStore();
  try {
    const active = fixture.store.enqueue('Currently speaking.', 'conversation', 'environment-mode');
    const pending = fixture.store.enqueue('Still waiting.', 'conversation', 'environment-mode');
    assert.ok(active && pending);
    const claim = fixture.store.claimNext('current-client');
    assert.equal(claim.item?.id, active.id);

    const interruption = fixture.store.interrupt('barge-in', { advanceGeneration: true });
    assert.equal(interruption.interruptedCount, 2);
    assert.equal(interruption.activeCount, 1);
    assert.equal(interruption.generation, 1);
    assert.deepEqual(fixture.store.peek(), []);
    assert.equal(
      fixture.store.updateDelivery(active.id, claim.item!.leaseToken, 'retry').state,
      'missing',
      'a late playback callback must not resurrect interrupted speech',
    );

    const restarted = new TTSDeliveryQueueStore({
      queuePath: path.join(fixture.root, 'tts-queue.json'),
      notificationPath: path.join(fixture.root, 'notifications', 'test.notify'),
      now: () => fixture.getNow(),
    });
    assert.deepEqual(restarted.peek(), [], 'interrupted speech must remain gone after restart');
    assert.equal(restarted.readState().lastInterruption?.reason, 'barge-in');
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('a newer user turn rejects speech produced by an older graph generation', () => {
  const fixture = createTestStore();
  try {
    const originalGeneration = fixture.store.readState().generation;
    const turn = fixture.store.interrupt('user-input', { advanceGeneration: true });
    assert.equal(turn.generation, originalGeneration + 1);

    const stale = fixture.store.enqueue(
      'Late response from the old turn.',
      'conversation',
      'environment-mode',
      originalGeneration,
    );
    assert.equal(stale, null);

    const current = fixture.store.enqueue(
      'Response for the current turn.',
      'conversation',
      'environment-mode',
      turn.generation,
    );
    assert.ok(current);
    assert.equal(current.generation, turn.generation);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('an explicit playback interruption is terminal rather than retryable', () => {
  const fixture = createTestStore();
  try {
    const queued = fixture.store.enqueue('Do not replay me.', 'conversation', 'environment-mode');
    assert.ok(queued);
    const claim = fixture.store.claimNext('current-client');
    const result = fixture.store.updateDelivery(
      queued.id,
      claim.item!.leaseToken,
      'interrupt',
    );
    assert.equal(result.state, 'interrupted');
    assert.deepEqual(fixture.store.peek(), []);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});
