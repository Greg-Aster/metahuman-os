import assert from 'node:assert/strict';
import test from 'node:test';
import { MODEL_ROLES, normalizeModelRole, parseModelRegistry } from './model-resolver.js';

test('normalizes model roles against the canonical role vocabulary', () => {
  for (const role of MODEL_ROLES) {
    assert.equal(normalizeModelRole(role, 'persona'), role);
  }

  assert.equal(normalizeModelRole('unknown-role', 'curator'), 'curator');
  assert.equal(normalizeModelRole(null, 'orchestrator'), 'orchestrator');
});

test('parses the required model-registry boundary and rejects malformed data', () => {
  const registry = parseModelRegistry({
    version: '1.0.0',
    description: 'Test registry',
    defaults: {},
    models: {},
  });

  assert.equal(registry.version, '1.0.0');
  assert.throws(
    () => parseModelRegistry({ version: '1.0.0', description: 'Missing models', defaults: {} }),
    /defaults, models/,
  );
  assert.throws(
    () => parseModelRegistry({ version: 1, description: 'Bad version', defaults: {}, models: {} }),
    /version/,
  );
});
