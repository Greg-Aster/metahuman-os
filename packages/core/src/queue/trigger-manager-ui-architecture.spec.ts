import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../paths.js';

const read = (relativePath: string) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
const exists = (relativePath: string) => fs.existsSync(path.join(ROOT, relativePath));

for (const component of [
  'apps/site/src/components/TriggerManagerDashboard.svelte',
  'apps/site/src/components/TriggerManagerOverviewCard.svelte',
  'apps/site/src/components/TriggerManagerSummary.svelte',
  'apps/site/src/components/TriggerManagerSettings.svelte',
]) {
  assert.ok(exists(component), `required Trigger Manager UI is missing: ${component}`);
}

const center = read('apps/site/src/components/CenterContent.svelte');
assert.ok(center.includes("dashboardSection.set('trigger-manager')"), 'Dashboard must expose a Trigger Manager tab');
assert.ok(center.includes("systemSection.set('trigger-manager')"), 'System Settings must expose Trigger Manager configuration');
assert.ok(!center.includes('SchedulerSettings'), 'legacy Scheduler settings must not remain routable');

const queue = read('apps/site/src/components/QueuePanel.svelte');
assert.ok(queue.includes('<TriggerManagerSummary />'), 'Queue panel must explain its Trigger Manager producer');

const chat = read('apps/site/src/components/ChatInterface.svelte');
assert.ok(chat.includes('nextAutonomyMode'), 'conversation control must implement all three Active Operator modes');
assert.ok(chat.includes('setActiveOperatorMode'), 'conversation control must issue explicit set-mode actions');
assert.ok(!chat.includes('activeOperatorEnabled'), 'conversation control must not retain a boolean mode model');

const settings = read('apps/site/src/components/TriggerManagerSettings.svelte');
for (const field of ['timezone', 'allowedModes', 'startupPolicy', 'maxRetries', 'jitterMs', 'probability']) {
  assert.ok(settings.includes(field), `Trigger Manager settings must expose ${field}`);
}
for (const queueField of ['maxConcurrentAgents', 'maxConcurrentLLMAgents', 'pauseQueueOnActivity']) {
  assert.ok(!settings.includes(queueField), `queue-owned field must not appear in Trigger Manager settings: ${queueField}`);
}

const store = read('apps/site/src/lib/stores/trigger-manager.ts');
assert.equal((store.match(/connectionPool\.request\(/g) || []).length, 1, 'shared Trigger Manager store must own exactly one SSE request');
for (const mutation of ['setTriggerAdmissionPaused', 'reloadTriggerConfig', 'runTriggerNow', 'patchTriggerConfig', 'setActiveOperatorMode']) {
  assert.ok(store.includes(`function ${mutation}`), `shared Trigger Manager store is missing ${mutation}`);
}

for (const route of [
  'apps/site/src/pages/api/trigger-manager/index.ts',
  'apps/site/src/pages/api/trigger-manager/stream.ts',
  'apps/site/src/pages/api/trigger-manager/control.ts',
  'apps/site/src/pages/api/trigger-manager/config.ts',
]) {
  assert.ok(exists(route), `thin Trigger Manager transport is missing: ${route}`);
  assert.ok(read(route).includes('astroHandler'), `Trigger Manager transport must delegate to the core router: ${route}`);
}

console.log('trigger manager UI architecture contract passed');
