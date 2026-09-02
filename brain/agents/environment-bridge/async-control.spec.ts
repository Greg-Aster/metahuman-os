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
  const queue = createSerialTaskQueue(error => errors.push(error), 2);

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
  const queue = createSerialTaskQueue(error => errors.push(error), 2);

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

test('serial task queue rejects overflow without accumulating more work', async () => {
  const first = deferred();
  const errors: unknown[] = [];
  let ranQueuedTask = false;
  const queue = createSerialTaskQueue(error => errors.push(error), 2);

  queue.enqueue(async () => {
    await first.promise;
  });
  await Promise.resolve();
  queue.enqueue(async () => {
    ranQueuedTask = true;
  });
  queue.enqueue(async () => {
    throw new Error('overflow task must not be accepted');
  });

  assert.equal(errors.length, 1);
  assert.match(String(errors[0]), /exceeded 2 pending tasks/);
  first.resolve();
  await queue.drain();
  assert.equal(ranQueuedTask, false);
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
