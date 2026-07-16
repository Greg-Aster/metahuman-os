import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

const definitions = read('packages/core/src/agent-catalog-definitions.ts');
const workCatalog = read('packages/core/src/queue/agent-work-catalog.ts');
const execution = read('packages/core/src/queue/execution-engine.ts');
assert.ok(definitions.includes('AGENT_CATALOG_DEFINITIONS'), 'built-in metadata must have one canonical owner');
assert.ok(workCatalog.includes('getAgentCatalogDefinition'), 'work mappings must derive from canonical catalog metadata');
assert.ok(execution.includes('AGENT_CATALOG_DEFINITIONS'), 'default executable handlers must derive from canonical catalog metadata');

const agentHandler = read('packages/core/src/api/handlers/agent.ts');
assert.ok(!agentHandler.includes('ALLOWED_AGENTS'), 'agent API must not keep a second hard-coded catalog');
assert.ok(agentHandler.includes('getAgentCatalogService'), 'agent API authorization must use Agent Catalog');

const monitor = read('apps/site/src/components/AgentMonitor.svelte');
assert.ok(monitor.includes("apiFetch('/api/agents/run'"), 'Agent Monitor must use the catalog-aware finite/service run route');
assert.ok(!monitor.includes('runTriggerNow'), 'Agent Monitor must not send unregistered discovered agents to Trigger Manager');

const center = read('apps/site/src/components/CenterContent.svelte');
assert.ok(center.includes("dashboardSection.set('agent-catalog')"), 'Dashboard must expose the complete catalog');
assert.ok(center.includes("systemSection.set('agent-catalog')"), 'System Settings must expose catalog controls');
const settings = read('apps/site/src/components/AgentCatalogSettings.svelte');
assert.ok(settings.includes('registerCatalogAgent') && settings.includes('unregisterCatalogAgent'), 'settings must support safe register and unregister controls');
assert.ok(settings.includes('never deletes agent source or history'), 'removal semantics must be explicit to the user');
const moodSettings = read('apps/site/src/components/MoodAgentSettings.svelte');
assert.ok(moodSettings.includes('Enable automatic Mood reviews'), 'Mood settings must expose an explicit opt-in trigger control');

for (const route of [
  'apps/site/src/pages/api/agent-catalog/index.ts',
  'apps/site/src/pages/api/agent-catalog/control.ts',
]) {
  const source = read(route);
  assert.ok(source.includes('astroHandler'), `${route} must remain thin transport`);
  assert.ok(!source.includes('node:fs'), `${route} must not own catalog persistence`);
}

console.log('agent-catalog-ui-architecture.spec.ts passed');
