import assert from 'node:assert/strict';
import test from 'node:test';
import { isProfileStorageConfig } from './encryption-manager.js';

test('accepts complete profile storage configurations', () => {
  assert.equal(isProfileStorageConfig({
    path: '/profiles/example',
    type: 'encrypted',
    encryption: {
      type: 'luks',
      unlocked: false,
      volumePath: '/volumes/example.img',
    },
  }), true);
});

test('rejects partial or unknown storage and encryption contracts', () => {
  assert.equal(isProfileStorageConfig({ type: 'encrypted' }), false);
  assert.equal(isProfileStorageConfig({ path: '/profiles/example' }), false);
  assert.equal(isProfileStorageConfig({
    path: '/profiles/example',
    type: 'unknown',
  }), false);
  assert.equal(isProfileStorageConfig({
    path: '/profiles/example',
    type: 'encrypted',
    encryption: { type: 'unknown' },
  }), false);
});
