import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AgentCatalogService, getAgentCatalogSnapshot } from './agent-catalog.js';
import { AGENT_CATALOG_DEFINITIONS } from './agent-catalog-definitions.js';
import { eventBus } from './infrastructure/event-bus/client.js';
import { TriggerConfigService } from './queue/trigger-config-service.js';
import { setAuditEnabled } from './audit.js';

setAuditEnabled(false);

const live = getAgentCatalogSnapshot();
assert.equal(live.counts.total, Object.keys(AGENT_CATALOG_DEFINITIONS).length, 'every maintained definition must appear exactly once');
assert.equal(live.counts.triggerRegistered, 19, 'the maintained system trigger catalog should expose 19 registered finite jobs');
assert.equal(live.counts.services, 2, 'persistent lifecycle must expose exactly the two configured services');
assert.equal(live.counts.missingSource, 0, 'every maintained catalog item must have a resolvable implementation');
assert.deepEqual(
  live.agents.filter(agent => agent.canRegister).map(agent => agent.id),
  ['coder', 'digest', 'dreamer', 'ingestor', 'memory-pruner', 'summarizer', 'train-of-thought', 'transcriber'],
  'installed but unscheduled agents must remain visible and registerable',
);
assert.equal(live.agents.find(agent => agent.id === 'curiosity')?.sourceAgentId, 'curiosity-service', 'source aliases must not create duplicate catalog entries');
assert.equal(live.agents.some(agent => agent.id === 'curiosity-service'), false, 'aliased source id must not appear as a second agent');
assert.equal(live.agents.find(agent => agent.id === 'coder')?.canRun, false, 'privileged agents must be registered explicitly before use');
assert.equal(live.agents.find(agent => agent.id === 'memory-pruner')?.canRun, false, 'destructive agents must be registered explicitly before use');
assert.equal(live.agents.find(agent => agent.id === 'mood')?.enabled, false, 'Mood must remain opt-in even while registered');
assert.equal(AGENT_CATALOG_DEFINITIONS.mood.defaultTrigger?.enabled, false, 're-registering Mood must preserve its disabled default');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-agent-catalog-'));
const brainDir = path.join(root, 'brain');
const agentsDir = path.join(brainDir, 'agents');
const etcDir = path.join(root, 'etc');
fs.mkdirSync(path.join(agentsDir, 'organizer'), { recursive: true });
fs.mkdirSync(path.join(agentsDir, 'summarizer'), { recursive: true });
fs.mkdirSync(path.join(agentsDir, 'curiosity-service'), { recursive: true });
fs.mkdirSync(path.join(brainDir, 'services'), { recursive: true });
fs.mkdirSync(etcDir, { recursive: true });
for (const file of [
  path.join(agentsDir, 'organizer', 'index.ts'),
  path.join(agentsDir, 'summarizer', 'index.ts'),
  path.join(agentsDir, 'curiosity-service', 'index.ts'),
  path.join(brainDir, 'services', 'maintenance-service.ts'),
]) fs.writeFileSync(file, 'export {};\n');

const triggerPath = path.join(etcDir, 'agents.json');
fs.writeFileSync(triggerPath, `${JSON.stringify({
  version: '1.0.0',
  revision: 4,
  globalSettings: { pauseAll: false, timezone: 'UTC' },
  agents: {
    organizer: {
      id: 'organizer',
      enabled: true,
      type: 'manual',
      lifecycle: 'scheduled-work',
      handler: 'agent.organizer',
      priority: 'normal',
      allowedModes: ['reactive', 'semi', 'full'],
      startupPolicy: 'skip',
    },
  },
}, null, 2)}\n`);
const servicesPath = path.join(etcDir, 'services.json');
fs.writeFileSync(servicesPath, `${JSON.stringify({
  services: {
    'maintenance-service': {
      id: 'maintenance-service',
      enabled: true,
      agentPath: 'services/maintenance-service.ts',
      priority: 'normal',
    },
  },
}, null, 2)}\n`);

const triggerConfig = new TriggerConfigService(triggerPath);
let revisions = 0;
triggerConfig.subscribe(() => revisions += 1);
const catalog = new AgentCatalogService({ agentsDir, brainDir, servicesConfigPath: servicesPath, triggerConfigService: triggerConfig });
const before = catalog.getSnapshot();
assert.equal(before.agents.find(agent => agent.id === 'summarizer')?.canRegister, true);
assert.equal(before.agents.find(agent => agent.id === 'curiosity')?.sourceReady, true, 'custom roots must honor source aliases');
assert.equal(before.agents.find(agent => agent.id === 'maintenance-service')?.serviceRegistered, true);

const registered = catalog.register('summarizer', 'catalog-spec');
assert.equal(registered.revision, 5);
assert.equal(registered.agents.find(agent => agent.id === 'summarizer')?.triggerRegistered, true);
const persisted = triggerConfig.load(false).config.agents.summarizer;
assert.equal(persisted.type, 'interval');
assert.equal(persisted.interval, 3600);
assert.deepEqual(persisted.allowedModes, ['semi', 'full']);

const unregistered = catalog.unregister('summarizer', 'catalog-spec');
assert.equal(unregistered.revision, 6);
assert.equal(unregistered.agents.find(agent => agent.id === 'summarizer')?.canRegister, true, 'unregistering must preserve installed source');
assert.equal(triggerConfig.load(false).config.agents.summarizer, undefined);
assert.equal(revisions, 2, 'register and unregister must each live-notify configuration subscribers');
assert.throws(() => catalog.register('maintenance-service', 'catalog-spec'), /persistent service/);
assert.throws(() => catalog.register('../escape', 'catalog-spec'), /lowercase kebab-case/);

fs.rmSync(root, { recursive: true, force: true });
eventBus.disconnect();
setAuditEnabled(true);
console.log('agent-catalog.spec.ts passed');
