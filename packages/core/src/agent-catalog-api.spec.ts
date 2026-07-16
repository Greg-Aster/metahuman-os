import assert from 'node:assert/strict';
import { handleAgentCatalogControl, handleGetAgentCatalog } from './api/handlers/agent-catalog.js';
import { eventBus } from './infrastructure/event-bus/client.js';
import type { UnifiedRequest } from './api/types.js';

function request(role?: 'owner' | 'user', body?: Record<string, unknown>): UnifiedRequest {
  return {
    method: body ? 'POST' : 'GET',
    path: body ? '/api/agent-catalog/control' : '/api/agent-catalog',
    params: {},
    query: {},
    headers: {},
    body,
    user: role
      ? { isAuthenticated: true, username: `${role}-spec`, role }
      : { isAuthenticated: false, username: '', role: 'guest' },
  } as UnifiedRequest;
}

const unauthenticated = await handleGetAgentCatalog(request());
assert.equal(unauthenticated.status, 401);
const nonOwner = await handleGetAgentCatalog(request('user'));
assert.equal(nonOwner.status, 403);
const owner = await handleGetAgentCatalog(request('owner'));
assert.equal(owner.status, 200);
assert.equal((owner.data as any).snapshot.counts.total, 29);

const invalidAction = await handleAgentCatalogControl(request('owner', { action: 'delete-source', agentId: 'organizer' }));
assert.equal(invalidAction.status, 400, 'catalog API must not expose source deletion');
const missingAgent = await handleAgentCatalogControl(request('owner', { action: 'register' }));
assert.equal(missingAgent.status, 400);

eventBus.disconnect();
console.log('agent-catalog-api.spec.ts passed');
