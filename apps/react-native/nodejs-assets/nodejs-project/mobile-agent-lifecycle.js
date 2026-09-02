'use strict';

/**
 * Serialize mobile agent registration changes around one authenticated profile.
 * Queue execution remains owned by Core's Work Coordinator; this owner only
 * handles app/profile lifecycle transitions for the embedded Node process.
 */
function createMobileAgentLifecycle({ initializeAgents, stopAgents }) {
  if (typeof initializeAgents !== 'function' || typeof stopAgents !== 'function') {
    throw new TypeError('Mobile agent lifecycle requires initializeAgents and stopAgents');
  }

  let desiredUsername = null;
  let runningUsername = null;
  let transition = Promise.resolve();

  function state() {
    return { desiredUsername, runningUsername };
  }

  function enqueue(operation) {
    const next = transition.then(operation, operation);
    transition = next.catch(() => undefined);
    return next;
  }

  function ensure(username) {
    const normalized = typeof username === 'string' ? username.trim() : '';
    if (!normalized) {
      return Promise.reject(new Error('Mobile agents require an authenticated username'));
    }

    desiredUsername = normalized;
    return enqueue(async () => {
      if (runningUsername === normalized) return state();

      if (runningUsername) {
        await stopAgents();
        runningUsername = null;
      }

      await initializeAgents(normalized);
      runningUsername = normalized;
      return state();
    });
  }

  function stop({ retainUsername = false } = {}) {
    if (!retainUsername) desiredUsername = null;
    return enqueue(async () => {
      if (runningUsername) {
        await stopAgents();
        runningUsername = null;
      }
      return state();
    });
  }

  function resume() {
    return desiredUsername ? ensure(desiredUsername) : Promise.resolve(state());
  }

  return {
    ensure,
    stop,
    resume,
    getState: state,
  };
}

module.exports = { createMobileAgentLifecycle };
