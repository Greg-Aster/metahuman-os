import assert from 'node:assert/strict';
import { isSessionAuthenticationFailure } from './api-config.js';

assert.equal(
  isSessionAuthenticationFailure(401),
  true,
  '401 must send the user back through the authentication gate',
);
assert.equal(
  isSessionAuthenticationFailure(403),
  false,
  '403 is an authorization denial and must not destroy a valid session',
);

console.log('API auth/session boundary contract passed');
