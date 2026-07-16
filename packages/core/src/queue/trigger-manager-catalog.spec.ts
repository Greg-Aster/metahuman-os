import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { systemPaths } from '../path-builder.js';
import { ExecutionEngine } from './execution-engine.js';
import { TriggerConfigService } from './trigger-config-service.js';
import { TriggerManager } from './trigger-manager.js';
import { UnifiedQueueManager } from './unified-queue-manager.js';

const queue = new UnifiedQueueManager();
const engine = new ExecutionEngine({}, queue);
const manager = new TriggerManager(queue);
const read = new TriggerConfigService(path.join(systemPaths.etc, 'agents.json')).load(false);

for (const [agentId, config] of Object.entries(read.config.agents)) {
  if (config.lifecycle !== 'service' && config.handler.startsWith('agent.')) {
    engine.registerAgentHandler(agentId, config.handler);
  }
}
manager.setHandlerInspector(config => ({
  registered: engine.hasHandler(config.handler),
  sourceResolvable: config.handler.startsWith('agent.')
    ? engine.isAgentSourceResolvable(config.id)
    : engine.hasHandler(config.handler),
}));
manager.applyConfig(read);

const snapshot = manager.getSnapshot();
assert.equal(snapshot.config.persistedRevision, snapshot.config.runtimeRevision);
assert.deepEqual(snapshot.healthFindings, [], `trigger catalog health findings: ${snapshot.healthFindings.join(', ')}`);
assert.equal(snapshot.triggers.some(trigger => trigger.lifecycle === 'service'), false);

const audio = snapshot.triggers.find(trigger => trigger.id === 'audio-organizer');
assert.ok(audio, 'Audio Organizer must remain explicitly user-runnable');
assert.equal(audio?.type, 'manual');
assert.equal(audio?.lifecycle, 'scheduled-work');
assert.equal(audio?.startupPolicy, 'skip');
assert.equal(audio?.handlerRegistered, true);
assert.equal(audio?.sourceResolvable, true);

const serviceConfig = JSON.parse(fs.readFileSync(path.join(systemPaths.etc, 'services.json'), 'utf8')) as {
  services: Record<string, { startOnSystemBoot?: boolean }>;
};
assert.deepEqual(
  Object.entries(serviceConfig.services)
    .filter(([, service]) => service.startOnSystemBoot)
    .map(([id]) => id)
    .sort(),
  ['environment-bridge', 'maintenance-service'],
);

manager.dispose();
console.log(`trigger manager catalog contract passed (${snapshot.triggers.length} finite triggers)`);
