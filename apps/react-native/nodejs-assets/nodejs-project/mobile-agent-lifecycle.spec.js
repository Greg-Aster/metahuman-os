'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createMobileAgentLifecycle } = require('./mobile-agent-lifecycle.js');

test('repeated initialization for one profile is idempotent', async () => {
  const events = [];
  const lifecycle = createMobileAgentLifecycle({
    initializeAgents: async username => events.push(`start:${username}`),
    stopAgents: async () => events.push('stop'),
  });

  await lifecycle.ensure('alice');
  await lifecycle.ensure('alice');

  assert.deepEqual(events, ['start:alice']);
  assert.deepEqual(lifecycle.getState(), {
    desiredUsername: 'alice',
    runningUsername: 'alice',
  });
});

test('profile switches stop the previous registration before starting the next', async () => {
  const events = [];
  const lifecycle = createMobileAgentLifecycle({
    initializeAgents: async username => events.push(`start:${username}`),
    stopAgents: async () => events.push('stop'),
  });

  await lifecycle.ensure('alice');
  await lifecycle.ensure('bob');

  assert.deepEqual(events, ['start:alice', 'stop', 'start:bob']);
  assert.equal(lifecycle.getState().runningUsername, 'bob');
});

test('concurrent profile transitions are serialized', async () => {
  const events = [];
  let releaseAlice;
  const aliceReady = new Promise(resolve => {
    releaseAlice = resolve;
  });
  const lifecycle = createMobileAgentLifecycle({
    initializeAgents: async username => {
      events.push(`start:${username}`);
      if (username === 'alice') await aliceReady;
      events.push(`ready:${username}`);
    },
    stopAgents: async () => events.push('stop'),
  });

  const alice = lifecycle.ensure('alice');
  const bob = lifecycle.ensure('bob');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, ['start:alice']);

  releaseAlice();
  await Promise.all([alice, bob]);

  assert.deepEqual(events, ['start:alice', 'ready:alice', 'stop', 'start:bob', 'ready:bob']);
  assert.equal(lifecycle.getState().runningUsername, 'bob');
});

test('failed initialization is visible and can be retried', async () => {
  let attempts = 0;
  const lifecycle = createMobileAgentLifecycle({
    initializeAgents: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('registration failed');
    },
    stopAgents: async () => {},
  });

  await assert.rejects(lifecycle.ensure('alice'), /registration failed/);
  assert.deepEqual(lifecycle.getState(), {
    desiredUsername: 'alice',
    runningUsername: null,
  });

  await lifecycle.ensure('alice');
  assert.equal(attempts, 2);
  assert.equal(lifecycle.getState().runningUsername, 'alice');
});

test('pause preserves the authenticated profile and resume restores registration', async () => {
  const events = [];
  const lifecycle = createMobileAgentLifecycle({
    initializeAgents: async username => events.push(`start:${username}`),
    stopAgents: async () => events.push('stop'),
  });

  await lifecycle.ensure('alice');
  await lifecycle.stop({ retainUsername: true });
  assert.deepEqual(lifecycle.getState(), {
    desiredUsername: 'alice',
    runningUsername: null,
  });

  await lifecycle.resume();
  assert.deepEqual(events, ['start:alice', 'stop', 'start:alice']);
  await lifecycle.stop();
  assert.deepEqual(lifecycle.getState(), {
    desiredUsername: null,
    runningUsername: null,
  });
});
