import assert from 'node:assert/strict';
import test from 'node:test';
import { readServerEvents } from './sse.js';

const text = ': heartbeat\r\nevent: phase\r\ndata: {"text":"猫"}\r\n\r\nevent: result\ndata: first\ndata: second\n\ndata: last\n\n';
const bytes = new TextEncoder().encode(text);
const expected = [{ event: 'phase', data: '{"text":"猫"}' },
  { event: 'result', data: 'first\nsecond' }, { event: 'message', data: 'last' }];

test('SSE framing survives every byte split, CRLF and multiple data lines', async () => {
  for (let split = 1; split < bytes.length; split++) {
    const response = new Response(new ReadableStream({ start(controller) {
      controller.enqueue(bytes.slice(0, split)); controller.enqueue(bytes.slice(split)); controller.close();
    } }));
    const received = [];
    for await (const event of readServerEvents(response)) received.push(event);
    assert.deepEqual(received, expected, `split ${split}`);
    assert.equal(response.body!.locked, false);
  }
});

test('abort releases a pending read and its lock', async () => {
  let cancelled = 0;
  const response = new Response(new ReadableStream({ cancel() { cancelled++; } }));
  const abort = new AbortController();
  const iterator = readServerEvents(response, abort.signal);
  const waiting = iterator.next();
  abort.abort();
  await assert.rejects(waiting, /abort/i);
  assert.equal(cancelled, 1);
  assert.equal(response.body!.locked, false);
});

test('already-aborted reads and early consumer exits release transport ownership', async () => {
  for (const preAborted of [true, false]) {
    let cancelled = 0;
    const response = new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode('data: invalid-json\n\n')); },
      cancel() { cancelled++; },
    }));
    const abort = new AbortController();
    if (preAborted) abort.abort();
    await assert.rejects(async () => {
      for await (const event of readServerEvents(response, abort.signal)) JSON.parse(event.data);
    });
    assert.equal(cancelled, 1);
    assert.equal(response.body!.locked, false);
  }
});
