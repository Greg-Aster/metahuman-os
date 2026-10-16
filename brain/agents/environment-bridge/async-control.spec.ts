import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCoalescedTaskRunner,
  createSerialTaskQueue,
} from './async-control.js';

function deferred(): {
  promise: Promise<void>
  resolve: () => void
  reject: (error: Error) => void
} {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test('serial task queue preserves adapter message order', async () => {
  const first = deferred();
  const order: string[] = [];
  const errors: unknown[] = [];
  const queue = createSerialTaskQueue(error => errors.push(error));

  queue.enqueue(async () => {
    order.push('first:start');
    await first.promise;
    order.push('first:end');
  });
  queue.enqueue(async () => {
    order.push('second');
  });

  await Promise.resolve();
  assert.deepEqual(order, ['first:start']);
  first.resolve();
  await queue.drain();

  assert.deepEqual(order, ['first:start', 'first:end', 'second']);
  assert.deepEqual(errors, []);
});

test('serial task queue reports the first failure and skips queued work', async () => {
  const expected = new Error('invalid adapter message');
  const errors: unknown[] = [];
  let ranAfterFailure = false;
  const queue = createSerialTaskQueue(error => errors.push(error));

  queue.enqueue(async () => {
    throw expected;
  });
  queue.enqueue(async () => {
    ranAfterFailure = true;
  });
  await queue.drain();

  assert.deepEqual(errors, [expected]);
  assert.equal(ranAfterFailure, false);
});

test('independent actions progress while each action and its dependent observation stay ordered', async () => {
  const held = deferred();
  const order: string[] = [];
  const errors: unknown[] = [];
  const queue = createSerialTaskQueue(error => errors.push(error));
  queue.enqueue(async () => { order.push('face:start'); await held.promise; order.push('face:end'); }, 'face');
  queue.enqueue(async () => { order.push('face:next'); }, 'face');
  queue.enqueue(async () => { order.push('observation'); }, 'adapter', queue.pending('face'));
  await queue.enqueue(async () => { order.push('wave:accepted'); }, 'wave');
  assert.deepEqual(order, ['face:start', 'wave:accepted']);
  let drained = false;
  const draining = queue.drain().then(() => { drained = true; });
  await Promise.resolve();
  assert.equal(drained, false, 'Drain retains pending work across all ordering keys');
  held.resolve(); await draining;
  assert.deepEqual(order, ['face:start', 'wave:accepted', 'face:end', 'face:next', 'observation']);
  assert.deepEqual(errors, []);
});

test('a reconnect backlog drains in order without blocking independent receipts', async () => {
  const held = deferred();
  const errors: unknown[] = [];
  const order: number[] = [];
  const queue = createSerialTaskQueue(error => errors.push(error));
  queue.enqueue(async () => { await held.promise; });
  for (let index = 0; index < 7200; index++) {
    queue.enqueue(async () => { order.push(index); });
  }
  let acknowledged = false;
  await queue.enqueue(async () => { acknowledged = true; }, 'action:new');
  assert.equal(acknowledged, true);
  assert.deepEqual(order, []);
  held.resolve();
  await queue.drain();
  assert.deepEqual(order, Array.from({ length: 7200 }, (_, index) => index));
  assert.deepEqual(errors, []);
});

test('coalesced runner bounds repeated requests to one pending task', async () => {
  const runs = [deferred(), deferred()];
  let runCount = 0;
  const run = createCoalescedTaskRunner(async () => {
    await runs[runCount++].promise;
  });

  const initial = run();
  const repeated = run();
  run();
  assert.equal(initial, repeated);
  assert.equal(runCount, 1);

  runs[0].resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(runCount, 2);

  runs[1].resolve();
  await initial;
  assert.equal(runCount, 2);
});

test('coalesced runner permits a later retry after failure', async () => {
  let runCount = 0;
  const run = createCoalescedTaskRunner(async () => {
    runCount += 1;
    if (runCount === 1) throw new Error('temporary failure');
  });

  await assert.rejects(run(), /temporary failure/);
  await run();
  assert.equal(runCount, 2);
});
