import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../paths.js';

function source(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

assert.ok(
  !source('packages/core/src/api/handlers/unified-queue.ts').includes('userTaskExecutions'),
  'unified-queue API must not own chat execution state',
);

assert.ok(
  !fs.existsSync(path.join(ROOT, 'packages/core/src/nodes/active-operator/task-execution.node.ts')),
  'legacy direct execution node must be deleted',
);

assert.ok(
  !fs.existsSync(path.join(ROOT, 'packages/core/src/active-operator/unified-queue.ts')),
  'legacy Active Operator queue must be deleted',
);

for (const removedPath of [
  'packages/core/src/active-operator/task-executor.ts',
  'packages/core/src/active-operator/service-manager.ts',
  'packages/core/src/agent-scheduler.ts',
  'packages/core/src/mobile-handlers/mobile-scheduler.ts',
  'packages/core/src/vector-index-queue.ts',
  'packages/server/src/queue/index.ts',
  'etc/cognitive-graphs/lizard-brain.json',
]) {
  assert.ok(!fs.existsSync(path.join(ROOT, removedPath)), `superseded owner must be deleted: ${removedPath}`);
}

assert.ok(
  !source('packages/core/src/queue/trigger-manager.ts').includes('this.queueManager.pause()'),
  'timer admission must not pause the global coordinator',
);

assert.ok(
  !fs.existsSync(path.join(ROOT, 'packages/core/src/nodes/thought/agent-trigger.node.ts')),
  'placeholder agent trigger node must not report success without durable work',
);

assert.ok(
  !fs.existsSync(path.join(ROOT, 'apps/site/src/components/SchedulerSettings.svelte')),
  'duplicate Scheduler settings surface must be removed',
);

assert.ok(
  !fs.existsSync(path.join(ROOT, 'brain/services/scheduler-service.ts'))
    && fs.existsSync(path.join(ROOT, 'brain/services/maintenance-service.ts')),
  'maintenance process must not claim scheduling ownership',
);

const triggerCatalogSource = source('etc/agents.json');
assert.ok(
  !triggerCatalogSource.includes('runOnBoot')
    && !triggerCatalogSource.includes('autoRestart')
    && !triggerCatalogSource.includes('"services"'),
  'finite trigger catalog must not own service boot or restart lifecycle',
);

assert.ok(
  source('etc/services.json').includes('startOnSystemBoot'),
  'persistent service lifecycle must have its own configuration owner',
);
assert.ok(
  source('brain/agents/environment-bridge/core.ts').includes("'etc', 'services.json'")
    && !source('brain/agents/environment-bridge/core.ts').includes("'etc', 'agents.json'"),
  'Environment Bridge runtime configuration must come from the persistent service owner',
);
assert.ok(
  source('packages/core/src/infrastructure/event-bus/client.ts').includes('_socket?.unref?.()')
    && source('packages/core/src/agent-process-runner.ts').includes('child.stdout')
    && source('packages/cli/src/mh-new.ts').includes('detached: true'),
  'service startup and event-bus observability must not leave a hidden terminal owner',
);

for (const finiteUiPath of [
  'apps/site/src/components/AuthGate.svelte',
  'apps/site/src/components/MemoryControls.svelte',
  'apps/site/src/components/SyncManager.svelte',
  'apps/site/src/components/TaskManager.svelte',
]) {
  assert.ok(
    !source(finiteUiPath).includes('/api/agents/run'),
    `finite UI work must not use the process runner: ${finiteUiPath}`,
  );
}

assert.ok(
  source('apps/site/src/components/AgentMonitor.svelte').includes('/api/agents/run')
    && source('packages/core/src/api/handlers/agent.ts').includes("catalogAgent.lifecycle === 'service'")
    && source('packages/core/src/api/handlers/agent.ts').includes('system.enqueueFiniteAgent'),
  'Agent Monitor control must derive service lifecycle from Agent Catalog and send finite work through the coordinator',
);

assert.ok(
  !source('packages/core/src/api/handlers/config.ts').includes('writeFileSync'),
  'domain settings must delegate trigger writes to TriggerConfigService',
);

assert.ok(
  source('packages/core/src/queue/queue-system.ts').includes('eventBus.subscribe'),
  'configured event triggers must be attached once to the canonical event bus',
);

assert.ok(
  !source('packages/core/src/api/handlers/active-operator.ts').includes("case 'toggle'"),
  'Active Operator control must use explicit three-state mode changes',
);

assert.ok(
  !source('packages/core/src/environment-interface/store.ts').includes('queuedActions'),
  'environment state must not own an executable action queue',
);

assert.ok(
  !fs.existsSync(path.join(ROOT, 'packages/core/src/environment-interface/coordinator.ts')),
  'environment graph execution must not use a private promise-chain coordinator',
);

assert.ok(
  !source('packages/core/src/api/handlers/environment-bridge.ts').includes('runGraph('),
  'environment transport must not execute the graph directly',
);

assert.ok(
  source('packages/core/src/queue/execution-engine.ts').includes("registerHandler('environment.observation'"),
  'environment observations must execute through a registered coordinator handler',
);

assert.ok(
  source('packages/core/src/queue/queue-system.ts').includes('if (!isWorkCoordinatorOwner())'),
  'only an explicitly claimed server or mobile owner may start a coordinator',
);

assert.ok(
  source('packages/core/src/queue/queue-system.ts').includes('if (!started)'),
  'startup failure must be surfaced rather than returning a stopped coordinator',
);

assert.ok(
  !source('packages/core/src/memory.ts').includes('getQueueSystem().enqueue'),
  'memory producers in CLI and brain processes must not create process-local coordinator ledgers',
);

assert.ok(
  source('packages/core/src/memory.ts').includes('submitCoordinatorWork'),
  'memory index work must use the server-owned coordinator handoff',
);

assert.ok(
  fs.existsSync(path.join(ROOT, 'apps/site/src/pages/api/internal/work-coordinator/enqueue.ts')),
  'the server-owned coordinator handoff must have a thin site transport route',
);

assert.ok(
  !source('scripts/process-desire-review.ts').includes('active-operator/task-executor'),
  'maintenance scripts must not import the deleted direct executor',
);

const managerSource = source('packages/core/src/queue/unified-queue-manager.ts');
for (const legacyImportPath of [
  'normalizeImportedTask',
  'task.queuedAt',
  'task.payload',
  'task.resourceLane',
  'task.retryCount',
  'task.maxRetries',
  'dequeue(taskId',
]) {
  assert.ok(!managerSource.includes(legacyImportPath), `legacy queue compatibility path must be removed: ${legacyImportPath}`);
}

assert.ok(
  !source('packages/core/src/queue/types.ts').includes('payload: Record<string, any>;'),
  'new work submissions must use the canonical input field',
);

for (const staleCompatibilityToken of [
  'isActiveOperatorEnabled',
  'markProposalExecuted',
]) {
  assert.ok(
    !source('packages/core/src/index.ts').includes(staleCompatibilityToken),
    `unused root compatibility export must be removed: ${staleCompatibilityToken}`,
  );
}

for (const staleControlPath of [
  'packages/core/src/api/handlers/adapters.ts',
  'apps/site/src/components/SystemControls.svelte',
  'apps/site/src/components/AdapterDashboard.svelte',
]) {
  assert.ok(
    !source(staleControlPath).includes('runNightProcessor'),
    `removed night processor must not retain a compatibility control: ${staleControlPath}`,
  );
}

console.log('work owner architecture contract passed');
