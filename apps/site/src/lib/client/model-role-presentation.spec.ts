import assert from 'node:assert/strict';
import test from 'node:test';
import { MODEL_ROLES, MODEL_ROLE_OPTIONS } from '@metahuman/core/model-roles';
import { buildModelRoleSections, type WorkflowModelSummary } from './model-role-presentation.js';

const workflows: WorkflowModelSummary[] = [
  { key: 'environment', name: 'Environment Mode', models: [
    { nodeId: 'intent', label: 'Intent Orchestrator', role: 'orchestrator', selection: 'role' },
    { nodeId: 'task', label: 'Task Decision', role: 'environmentActionSelector', selection: 'role' },
    { nodeId: 'plan', label: 'Delegated planning', role: 'persona', selection: 'role' },
    { nodeId: 'conversation', label: 'Conversation', role: 'persona', selection: 'role' },
  ] },
  { key: 'review', name: 'Goal Review', models: [
    { nodeId: 'review', label: 'Review', role: 'orchestrator', selection: 'role' },
    { nodeId: 'conversation', label: 'Conversation', role: 'persona', selection: 'role' },
  ] },
];

test('Environment uses the single canonical Orchestrator category', () => {
  const sections = buildModelRoleSections(workflows, 'environment');
  assert.deepEqual(sections[0].roles.map(item => item.role), [
    'orchestrator', 'environmentActionSelector', 'persona',
  ]);
  assert.equal(sections[0].roles[0].label, 'Orchestrator');
  assert.equal(sections[1].roles.some(item => item.role === 'orchestrator'), false);
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
  assert.equal(sections[0].roles.some(item => item.role === 'orchestrator'), false);
  assert.equal(buildModelRoleSections(workflows, 'review')[0].roles[0].role, 'orchestrator');
});

test('missing graphs and runtime-selected roles do not fabricate fixed workflow assignments', () => {
  assert.equal(buildModelRoleSections([], 'environment')[0].label, 'Other saved roles');
  const runtime = structuredClone(workflows);
  runtime[0].models[0].selection = 'runtime-role';
  assert.equal(buildModelRoleSections(runtime, 'environment')[0].roles.some(item => item.role === 'orchestrator'), false);
});

test('every category presents its exact shared definition and label', () => {
  const roles = buildModelRoleSections(workflows, 'environment').flatMap(section => section.roles);
  for (const definition of MODEL_ROLE_OPTIONS) {
    const presentation = roles.find(item => item.role === definition.value)!;
    assert.equal(presentation.label, definition.label);
    assert.equal(presentation.description.split('\n')[0], definition.description);
  }
  assert.equal(roles.some(item => String(item.role) === 'environmentIntent'), false);
});

test('Lightweight remains independently selectable and shows its configured body-event usage', () => {
  const withBodyEvents = [...workflows, {
    key: 'robot-body-response', name: 'Robot Body Response', models: [
      { nodeId: 'response', label: 'Body Response', role: 'lightweight', selection: 'role' },
    ],
  }];
  const sections = buildModelRoleSections(withBodyEvents, 'environment');
  const roles = sections.flatMap(section => section.roles);
  assert.equal(roles.filter(item => item.role === 'lightweight').length, 1);
  const lightweight = roles.find(item => item.role === 'lightweight')!;
  assert.equal(lightweight.label, 'Lightweight');
  assert.match(lightweight.description, /Robot Body Response: Body Response/);
  assert.equal(sections[1].roles.includes(lightweight), true);
  assert.deepEqual(buildModelRoleSections(withBodyEvents, 'robot-body-response')[0].roles
    .map(item => item.role), ['lightweight']);
  assert.equal(buildModelRoleSections([], 'environment').flatMap(section => section.roles)
    .some(item => item.role === 'lightweight'), true);
});
