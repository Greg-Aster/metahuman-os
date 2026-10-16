import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AgentCatalogService } from '../agent-catalog.js';
import { AGENT_CATALOG_DEFINITIONS } from '../agent-catalog-definitions.js';
import { resolveAgentExecutablePath } from '../agent-executable-resolver.js';
import { buildAgentDescriptor, defaultAgentCatalogEntry } from '../agent-monitor-descriptors.js';
import { TriggerConfigService } from '../queue/trigger-config-service.js';
import { ROOT } from '../path-builder.js';

test('Active Operator has one persistent agent identity, with existing child ownership and lifecycle controls', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'active-operator-catalog-'));
  try {
    const brainDir = path.join(root, 'brain');
    const agentsDir = path.join(brainDir, 'agents');
    fs.mkdirSync(path.join(agentsDir, 'active-operator'), { recursive: true });
    fs.writeFileSync(path.join(agentsDir, 'active-operator/index.ts'), 'export {};');
    const servicesConfigPath = path.join(root, 'services.json');
    const config = defaultAgentCatalogEntry('robot-operator', 'service');
    assert.equal(config.agentPath, 'active-operator/index.ts');
    fs.writeFileSync(servicesConfigPath, JSON.stringify({ services: { 'robot-operator': config } }));
    const triggerPath = path.join(root, 'agents.json');
    const childIds = Object.values(AGENT_CATALOG_DEFINITIONS)
      .filter(item => item.parentIds?.includes('robot-operator')).map(item => item.id);
    assert.deepEqual(childIds.sort(), ['boredom-movement', 'boredom-observer', 'boredom-reflection', 'robot-autonomy-controller', 'robot-goal-review', 'robot-status']);
    fs.writeFileSync(triggerPath, fs.readFileSync(path.join(ROOT, 'etc/agents.json')));
    const catalog = new AgentCatalogService({ brainDir, agentsDir, servicesConfigPath,
      triggerConfigService: new TriggerConfigService(triggerPath) });
    const snapshot = catalog.getSnapshot();
    const operator = snapshot.agents.find(agent => agent.id === 'robot-operator')!;
    assert.equal(operator.displayName, 'Active Operator');
    assert.equal(operator.sourceAgentId, 'active-operator');
    assert.equal(operator.sourcePath, 'agents/active-operator/index.ts');
    assert.equal(operator.sourceReady, true);
    assert.equal(operator.lifecycle, 'service');
    assert.equal(operator.canRun, true);
    assert.equal(operator.canRegister, false, 'the agent must not gain a second Trigger Manager schedule');
    assert.equal(snapshot.agents.filter(agent => agent.sourceAgentId === 'active-operator').length, 1);
    assert.equal(snapshot.agents.some(agent => agent.id === 'active-operator'), false, 'source discovery must not duplicate its durable identity');
    for (const id of childIds) {
      const child = snapshot.agents.find(agent => agent.id === id)!;
      assert.deepEqual(child.parentIds, [operator.id]);
      assert.equal(child.owner, operator.id);
      assert.equal(child.triggerRegistered, false);
    }
    const descriptor = buildAgentDescriptor(operator.id, config, operator);
    assert.equal(descriptor.name, 'Active Operator');
    assert.equal(descriptor.startable, true);
    assert.equal(descriptor.bootEligible, true);
    assert.ok(descriptor.variables.some(variable => variable.key === 'robotAutonomyControllerGraph'));
    assert.equal(resolveAgentExecutablePath(operator.id), path.join(ROOT, 'brain/agents/active-operator/index.ts'));
    assert.equal(fs.existsSync(path.join(ROOT, 'brain/services/robot-operator.ts')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
