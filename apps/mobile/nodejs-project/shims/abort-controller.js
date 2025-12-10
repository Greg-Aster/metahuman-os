/**
 * AbortController Polyfill for Node.js v12
 *
 * Node.js v12 (used by nodejs-mobile) doesn't have AbortController.
 * It was added in Node.js 15.
 *
 * This is a minimal implementation that supports the basic use case
 * of aborting fetch requests with a timeout.
 */

class AbortSignal {
  constructor() {
    this.aborted = false;
    this.onabort = null;
    this._listeners = [];
  }

  addEventListener(type, listener) {
    if (type === 'abort') {
      this._listeners.push(listener);
    }
  }

  removeEventListener(type, listener) {
    if (type === 'abort') {
      const index = this._listeners.indexOf(listener);
      if (index > -1) {
        this._listeners.splice(index, 1);
      }
    }
  }

  dispatchEvent(event) {
    if (event.type === 'abort') {
      this.aborted = true;
      if (this.onabort) {
        this.onabort(event);
      }
      for (const listener of this._listeners) {
        listener(event);
      }
    }
  }
}

class AbortController {
  constructor() {
    this.signal = new AbortSignal();
  }

  abort() {
    if (!this.signal.aborted) {
      this.signal.dispatchEvent({ type: 'abort' });
    }
  }
}

// Also provide AbortSignal.timeout() which is used by some fetch implementations
AbortSignal.timeout = function(ms) {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
};

module.exports = { AbortController, AbortSignal };

// If running directly, export to global
if (typeof globalThis !== 'undefined') {
  if (!globalThis.AbortController) {
    globalThis.AbortController = AbortController;
  }
  if (!globalThis.AbortSignal) {
    globalThis.AbortSignal = AbortSignal;
  }
}
