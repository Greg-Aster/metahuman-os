import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const sourceRoot = fileURLToPath(new URL('../../../', import.meta.url));
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-bridge-switch-'));
process.env.METAHUMAN_ROOT = fixture;
fs.mkdirSync(path.join(fixture, 'etc'), { recursive: true });
fs.symlinkSync(path.join(sourceRoot, 'node_modules'), path.join(fixture, 'node_modules'), 'dir');
const ids = ['environment-bridge-local', 'environment-bridge-remote'];
fs.writeFileSync(path.join(fixture, 'etc/agents.json'), JSON.stringify({ agents: {} }));
fs.writeFileSync(path.join(fixture, 'etc/services.json'), JSON.stringify({ services: Object.fromEntries(ids.map(id => [id, {
  id, enabled: true, type: 'manual', startOnSystemBoot: id.endsWith('local'), agentPath: `environment-bridge/${id.split('-').at(-1)}.ts`,
}])) }));
for (const id of ids) {
  const directory = path.join(fixture, 'brain/agents/environment-bridge');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, `${id.split('-').at(-1)}.ts`), `
import { acquireLock } from ${JSON.stringify(path.join(sourceRoot, 'packages/core/src/locks.ts'))};
const lock = acquireLock('agent-environment-bridge', { exitOnSignal: false });
const timer = setInterval(() => {}, 1000);
process.once('SIGTERM', () => { clearInterval(timer); lock.release(); });
`);
}
const { startAgentProcess } = await import('./agent-process-runner.js');
const { getRunningAgents, stopAgent, waitForProcessExit } = await import('./agent-monitor-registry.js');
const { setAuditEnabled } = await import('./audit.js');
const { eventBus } = await import('./infrastructure/event-bus/client.js');
setAuditEnabled(false);

test('connection settings use the existing service owner and retain both remote routes', async () => {
  const { setAgentVariable } = await import('./agent-monitor.js');
  setAgentVariable(ids[1], 'cloudflareHostname', 'bridge.example.invalid');
  setAgentVariable(ids[1], 'sshTarget', 'operator@workshop-host');
  setAgentVariable(ids[1], 'sshGatewayPort', 9876);
  setAgentVariable(ids[1], 'transport', 'ssh');
  setAgentVariable(ids[1], 'adapterUrl', 'ws://127.0.0.1:18790/environment');
  let config = JSON.parse(fs.readFileSync(path.join(fixture, 'etc/services.json'), 'utf8'));
  assert.equal(config.services[ids[1]].transport, 'ssh');
  assert.equal(config.services[ids[1]].sshTarget, 'operator@workshop-host');
  assert.equal(config.services[ids[1]].sshGatewayPort, 9876);
  assert.equal(config.services[ids[1]].cloudflareHostname, 'bridge.example.invalid');
  setAgentVariable(ids[1], 'transport', 'cloudflare');
  config = JSON.parse(fs.readFileSync(path.join(fixture, 'etc/services.json'), 'utf8'));
  assert.equal(config.services[ids[1]].sshTarget, 'operator@workshop-host');
  assert.equal(config.services[ids[1]].transport, 'cloudflare');
  assert.equal(getRunningAgents().length, 0, 'saving alone must not start a connection');
});

test('starting either Bridge switches the existing owner and persists only that startup choice', async () => {
  let previousPid: number | undefined;
  for (const id of [ids[1], ids[0], ids[1]]) {
    const result = await startAgentProcess(id, { source: 'connection-switch-fixture', useBootstrap: false,
      waitForMs: 3000, checkLock: true });
    assert.equal(result.success, true, result.error);
    assert.notEqual(result.pid, previousPid);
    const running = getRunningAgents().filter(agent => ids.includes(agent.name));
    assert.equal(running.length, 1);
    assert.equal(running[0].name, id);
    const config = JSON.parse(fs.readFileSync(path.join(fixture, 'etc/services.json'), 'utf8'));
    assert.deepEqual(ids.filter(candidate => config.services[candidate].startOnSystemBoot), [id]);
    const again = await startAgentProcess(id, { source: 'connection-switch-fixture', checkLock: true });
    assert.equal(again.alreadyRunning, true);
    assert.equal(getRunningAgents().filter(agent => ids.includes(agent.name)).length, 1);
    previousPid = result.pid;
  }
});

test.after(async () => {
  for (const agent of getRunningAgents()) {
    const stopped = stopAgent(agent.name);
    if (stopped.pid) await waitForProcessExit(stopped.pid, 5000);
  }
  eventBus.disconnect();
  fs.rmSync(fixture, { recursive: true, force: true });
});
