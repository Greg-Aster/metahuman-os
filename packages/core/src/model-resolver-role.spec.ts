import assert from 'node:assert/strict';
import test from 'node:test';
import { MODEL_ROLES, normalizeModelRole, parseModelRegistry, migrateModelRegistry } from './model-resolver.js';

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


test('separate autonomy assignment preserves prior persona choices and explicit overrides', () => {
  const source = parseModelRegistry({
    version: '1.0.0', description: 'Autonomy split fixture',
    defaults: { persona: 'base' },
    models: { base: { provider: 'llama-cpp', model: 'base', roles: ['persona'], options: {} } },
    cognitiveModeMappings: {
      environment: { persona: 'environment-base' },
      agent: { persona: null },
      dual: {},
      emulation: { persona: 'expression', autonomy: 'trained' },
    },
  });
  const { registry } = migrateModelRegistry(source);
  assert.equal(registry.defaults.autonomy, 'base');
  assert.equal(registry.defaults.persona, 'base');
  assert.equal(registry.cognitiveModeMappings?.environment?.autonomy, 'environment-base');
  assert.equal(registry.cognitiveModeMappings?.agent?.autonomy, null);
  assert.equal(Object.hasOwn(registry.cognitiveModeMappings!.dual, 'autonomy'), false);
  assert.equal(registry.cognitiveModeMappings?.emulation?.autonomy, 'trained');
  assert.equal(registry.cognitiveModeMappings?.emulation?.persona, 'expression');
  assert.equal(Object.hasOwn(source.defaults, 'autonomy'), false);
  assert.equal(migrateModelRegistry(registry).changed, false);
  registry.defaults.autonomy = 'explicit-autonomy';
  assert.equal(migrateModelRegistry(registry).registry.defaults.autonomy, 'explicit-autonomy');
  delete registry.cognitiveModeMappings!.environment.autonomy;
  const inherited = migrateModelRegistry(registry).registry;
  assert.equal(Object.hasOwn(inherited.cognitiveModeMappings!.environment, 'autonomy'), false,
    'A later explicit choice to inherit Autonomy must not be replaced by Persona again');
});
