import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { getAgentMonitorSnapshot } from '../agent-monitor.js';
import { getRunningAgents, stopAgent } from '../agent-monitor-registry.js';
import { handleAgentsControl } from '../api/handlers/agent.js';
import { eventBus } from '../infrastructure/event-bus/client.js';

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for service lifecycle state');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

async function startThroughBoundedLauncher() {
  const source = [
    "import { startAgentProcess } from './packages/core/src/agent-process-runner.ts'",
    "const result = await startAgentProcess('maintenance-service', { actor: 'validation', source: 'validation/bounded-launcher', useBootstrap: true, detached: true, waitForMs: 5000, checkLock: true })",
    "console.log('SERVICE_START_RESULT=' + JSON.stringify(result))",
  ].join(';');
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', source], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => stdout += chunk.toString());
  child.stderr.on('data', (chunk: Buffer) => stderr += chunk.toString());
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  assert.equal(code, 0, stderr || stdout);
  const line = stdout.split('\n').find(candidate => candidate.startsWith('SERVICE_START_RESULT='));
  assert.ok(line, `bounded launcher did not return a result: ${stdout} ${stderr}`);
  return JSON.parse(line.slice('SERVICE_START_RESULT='.length));
}

const prior = getRunningAgents().find(agent => agent.name === 'maintenance-service');
if (prior) {
  stopAgent('maintenance-service');
  await waitFor(() => !getRunningAgents().some(agent => agent.name === 'maintenance-service'));
}

try {
  const started = await startThroughBoundedLauncher();
  assert.equal(started.started, true, started.error);
  await waitFor(() => getAgentMonitorSnapshot().runningAgents.some(agent => agent.name === 'maintenance-service'));
  const first = getAgentMonitorSnapshot().runningAgents.find(agent => agent.name === 'maintenance-service');
  assert.equal(first?.kind, 'service');

  const response = await handleAgentsControl({
    path: '/api/agents/control',
    method: 'POST',
    body: { action: 'restart', agent: 'maintenance-service' },
    user: {
      userId: 'owner',
      username: 'validation-owner',
      role: 'owner',
      isAuthenticated: true,
    },
  });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  await waitFor(() => getAgentMonitorSnapshot().runningAgents.some(agent =>
    agent.name === 'maintenance-service' && agent.pid !== first?.pid,
  ));
  const afterRestart = getAgentMonitorSnapshot().runningAgents.filter(agent => agent.name === 'maintenance-service');
  assert.equal(afterRestart.length, 1);
  assert.notEqual(afterRestart[0]?.pid, first?.pid);
  console.log(`maintenance service lifecycle contract passed (${first?.pid} -> ${afterRestart[0]?.pid})`);
} finally {
  const running = getRunningAgents().find(agent => agent.name === 'maintenance-service');
  if (running) {
    stopAgent('maintenance-service');
    await waitFor(() => !getRunningAgents().some(agent => agent.name === 'maintenance-service')).catch(() => {
      stopAgent('maintenance-service', true);
    });
  }
  eventBus.disconnect();
}
