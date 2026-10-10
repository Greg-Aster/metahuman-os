import assert from 'node:assert/strict';
import test from 'node:test';
import { MODEL_ROLES } from '@metahuman/core/model-roles';
import { buildModelRoleSections, type WorkflowModelSummary } from './model-role-presentation.js';

const workflows: WorkflowModelSummary[] = [
  { key: 'environment', name: 'Environment Mode', models: [
    { nodeId: 'intent', label: 'Intent Orchestrator', role: 'environmentIntent', selection: 'role' },
    { nodeId: 'task', label: 'Task Decision', role: 'environmentActionSelector', selection: 'role' },
    { nodeId: 'plan', label: 'Delegated planning', role: 'persona', selection: 'role' },
    { nodeId: 'conversation', label: 'Conversation', role: 'persona', selection: 'role' },
  ] },
  { key: 'review', name: 'Goal Review', models: [
    { nodeId: 'review', label: 'Review', role: 'orchestrator', selection: 'role' },
    { nodeId: 'conversation', label: 'Conversation', role: 'persona', selection: 'role' },
  ] },
];

test('Environment shows its intent specialist first without substituting the general orchestrator', () => {
  const sections = buildModelRoleSections(workflows, 'environment');
  assert.deepEqual(sections[0].roles.map(item => item.role), [
    'environmentIntent', 'environmentActionSelector', 'persona',
  ]);
  assert.equal(sections[0].roles[0].label, 'Intent orchestrator');
  assert.equal(sections[1].roles.find(item => item.role === 'orchestrator')?.label, 'General orchestrator');
});

test('repeated workflow consumers share one selector while all saved roles remain available', () => {
  const snapshot = JSON.stringify(workflows);
  const roles = buildModelRoleSections(workflows, 'environment').flatMap(section => section.roles);
  assert.deepEqual(roles.map(item => item.role).sort(), [...MODEL_ROLES].sort());
  const persona = roles.find(item => item.role === 'persona')!;
  assert.match(persona.description, /Environment Mode: Delegated planning/);
  assert.match(persona.description, /Environment Mode: Conversation/);
  assert.match(persona.description, /Goal Review: Conversation/);
  assert.equal(JSON.stringify(workflows), snapshot);
});

test('presentation follows changed graph roles and does not assume an Environment model', () => {
  const changed = structuredClone(workflows);
  changed[0].models[0].role = 'planner';
  const sections = buildModelRoleSections(changed, 'environment');
  assert.equal(sections[0].roles[0].role, 'planner');
  assert.equal(sections[0].roles.some(item => item.role === 'environmentIntent'), false);
  assert.equal(buildModelRoleSections(workflows, 'review')[0].roles[0].role, 'orchestrator');
});

test('missing graphs and runtime-selected roles do not fabricate fixed workflow assignments', () => {
  assert.equal(buildModelRoleSections([], 'environment')[0].label, 'Other saved roles');
  const runtime = structuredClone(workflows);
  runtime[0].models[0].selection = 'runtime-role';
  assert.equal(buildModelRoleSections(runtime, 'environment')[0].roles.some(item => item.role === 'environmentIntent'), false);
});
