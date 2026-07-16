import fs from 'node:fs';
import path from 'node:path';
import {
  clearAgentFailure,
  getAgentFailures,
  getAgentMonitorSnapshot,
  recordAgentFailure,
} from '@metahuman/core/agent-monitor';
import { getAgentCatalogSnapshot, startAgentProcess } from '@metahuman/core';
import {
  getEnvironmentBridgeStatePath,
  readEnvironmentBridgeState,
} from '@metahuman/core/environment-interface';
import { ROOT } from '@metahuman/core/paths';
import { handleSetMonitorAgentVariable } from '../packages/core/src/api/handlers/monitor';
import type { UnifiedRequest } from '../packages/core/src/api/types';

type Check = {
  name: string;
  pass: boolean;
  details?: string;
};

const SYNTHETIC_AGENT = '__agent-monitor-validation__';

function check(name: string, pass: boolean, details?: string): Check {
  return { name, pass, details };
}

function failDetails(values: string[]): string | undefined {
  return values.length ? values.join(', ') : undefined;
}

function sourceDoesNotContain(file: string, pattern: RegExp): boolean {
  return !pattern.test(fs.readFileSync(file, 'utf8'));
}

function sourceContains(file: string, pattern: RegExp): boolean {
  return pattern.test(fs.readFileSync(file, 'utf8'));
}

function ownerRequest(path: string, body: Record<string, unknown>): UnifiedRequest {
  return {
    path,
    method: 'POST',
    body,
    user: {
      userId: 'agent-monitor-validation',
      username: 'agent-monitor-validation',
      role: 'owner',
      isAuthenticated: true,
    },
  };
}

async function withRestoredFiles<T>(files: string[], callback: () => Promise<T> | T): Promise<T> {
  const snapshots = files.map(file => ({
    file,
    existed: fs.existsSync(file),
    content: fs.existsSync(file) ? fs.readFileSync(file) : undefined,
  }));

  try {
    return await callback();
  } finally {
    for (const snapshot of snapshots) {
      if (snapshot.existed && snapshot.content !== undefined) {
        fs.mkdirSync(path.dirname(snapshot.file), { recursive: true });
        fs.writeFileSync(snapshot.file, snapshot.content);
      } else if (!snapshot.existed && fs.existsSync(snapshot.file)) {
        fs.unlinkSync(snapshot.file);
      }
    }
  }
}

async function withSuppressedConsoleError<T>(callback: () => Promise<T>): Promise<T> {
  const original = console.error;
  console.error = () => {};
  try {
    return await callback();
  } finally {
    console.error = original;
  }
}

async function runVariableChecks(): Promise<Check[]> {
  const checks: Check[] = [];
  const bridgeStatePath = getEnvironmentBridgeStatePath();
  const serviceConfigPath = path.join(ROOT, 'etc', 'services.json');

  await withRestoredFiles([bridgeStatePath, serviceConfigPath], async () => {
    const enabledResponse = await handleSetMonitorAgentVariable(ownerRequest('/api/monitor/agent-variable', {
      agent: 'environment-bridge',
      key: 'deliveryEnabled',
      value: true,
    }));
    const enabledData = enabledResponse.data as { agentData?: { variables?: Array<{ key: string; value: unknown; applyMode: string }> } } | undefined;
    const enabledVariable = enabledData?.agentData?.variables?.find(variable => variable.key === 'deliveryEnabled');
    checks.push(check(
      'Environment Bridge action-delivery edit persists through monitor API',
      enabledResponse.status === 200 && enabledVariable?.value === true && readEnvironmentBridgeState().enabled,
      `status=${enabledResponse.status} value=${String(enabledVariable?.value ?? '')}`,
    ));
    checks.push(check(
      'Environment Bridge action-delivery control is labeled live',
      enabledVariable?.applyMode === 'live',
      enabledVariable?.applyMode,
    ));

    const adapterUrlResponse = await handleSetMonitorAgentVariable(ownerRequest(
      '/api/monitor/agent-variable',
      {
        agent: 'environment-bridge',
        key: 'adapterUrl',
        value: 'ws://127.0.0.1:8790/environment',
      },
    ));
    checks.push(check(
      'Environment Bridge persists its adapter URL',
      adapterUrlResponse.status === 200,
      'status=' + adapterUrlResponse.status,
    ));

    const bootResponse = await handleSetMonitorAgentVariable(ownerRequest('/api/monitor/agent-variable', {
      agent: 'maintenance-service',
      key: 'startOnSystemBoot',
      value: true,
    }));
    const bootData = bootResponse.data as { agentData?: { variables?: Array<{ key: string; value: unknown; applyMode: string }> } } | undefined;
    const bootVariable = bootData?.agentData?.variables?.find(variable => variable.key === 'startOnSystemBoot');
    const bootEnabledVariable = bootData?.agentData?.variables?.find(variable => variable.key === 'enabled');
    checks.push(check(
      'boot-manager variable edit persists through monitor API',
      bootResponse.status === 200 && bootVariable?.value === true,
      `status=${bootResponse.status} value=${String(bootVariable?.value ?? '')}`,
    ));
    checks.push(check(
      'boot-manager start-on-boot enables service for startup',
      bootResponse.status === 200 && bootEnabledVariable?.value === true,
      `status=${bootResponse.status} enabled=${String(bootEnabledVariable?.value ?? '')}`,
    ));
    checks.push(check(
      'boot-manager variable is labeled next-boot',
      bootVariable?.applyMode === 'nextBoot',
      bootVariable?.applyMode,
    ));
  });

  return checks;
}

async function runPreflightFailureChecks(): Promise<Check[]> {
  const checks: Check[] = [];
  const agentName = '__agent-monitor-missing-agent__';
  clearAgentFailure(agentName);

  try {
    const result = await startAgentProcess(agentName, {
      source: 'validate-agent-monitor-preflight',
      useBootstrap: true,
    });
    const failure = getAgentFailures().find(entry => entry.agent === agentName);

    checks.push(check(
      'shared runner returns preflight failures',
      result.started === false && result.success === false && result.error === 'Agent file not found',
      JSON.stringify(result),
    ));
    checks.push(check(
      'shared runner records preflight failures for Agent Monitor',
      failure?.source === 'validate-agent-monitor-preflight' && failure.error === 'Agent file not found',
      JSON.stringify(failure ?? null),
    ));
  } finally {
    clearAgentFailure(agentName);
  }

  return checks;
}

async function main() {
  const checks: Check[] = [];
  clearAgentFailure(SYNTHETIC_AGENT);

  const snapshot = getAgentMonitorSnapshot();
  const activeIds = new Set(snapshot.runningAgents.map(agent => agent.name));
  const startableOverlap = snapshot.startableAgents
    .map(agent => agent.id)
    .filter(id => activeIds.has(id));

  checks.push(check(
    'runningAgents contains only running cards',
    snapshot.runningAgents.every(agent => agent.status === 'running'),
    failDetails(snapshot.runningAgents.filter(agent => agent.status !== 'running').map(agent => `${agent.name}:${agent.status}`)),
  ));

  checks.push(check(
    'recentCompletions contains only completed one-shot cards',
    snapshot.recentCompletions.every(agent => agent.kind === 'one-shot' && agent.status === 'stopped' && agent.metrics.successfulRuns > 0),
    failDetails(snapshot.recentCompletions.map(agent => `${agent.name}:${agent.kind}:${agent.status}`)),
  ));

  checks.push(check(
    'startableAgents excludes active agents',
    startableOverlap.length === 0,
    failDetails(startableOverlap),
  ));

  for (const expectedStartableAgent of ['curator', 'profile-sync']) {
    checks.push(check(
      `startableAgents includes runnable ${expectedStartableAgent}`,
      snapshot.startableAgents.some(agent => agent.id === expectedStartableAgent),
      `startable=${snapshot.startableAgents.map(agent => agent.id).join(',')}`,
    ));
  }

  const coderCatalogEntry = getAgentCatalogSnapshot().agents.find(agent => agent.id === 'coder');
  checks.push(check(
    'privileged coder requires explicit catalog registration before Agent Monitor can run it',
    Boolean(coderCatalogEntry)
      && snapshot.startableAgents.some(agent => agent.id === 'coder') === coderCatalogEntry?.canRun,
    `catalogCanRun=${coderCatalogEntry?.canRun} startable=${snapshot.startableAgents.some(agent => agent.id === 'coder')}`,
  ));

  checks.push(check(
    'bootAgents are exposed for System Settings',
    snapshot.bootAgents.length > 0,
    `count=${snapshot.bootAgents.length}`,
  ));

  for (const requiredBootAgent of ['maintenance-service']) {
    checks.push(check(
      `bootAgents includes ${requiredBootAgent}`,
      snapshot.bootAgents.some(agent => agent.agentId === requiredBootAgent),
    ));
  }
  checks.push(check(
    'bootAgents includes the Environment Bridge process',
    snapshot.bootAgents.some(agent => agent.agentId === 'environment-bridge'),
  ));
  checks.push(check(
    'Environment Bridge has runnable process source',
    fs.existsSync(path.join(ROOT, 'brain', 'agents', 'environment-bridge', 'core.ts'))
      && fs.existsSync(path.join(ROOT, 'brain', 'agents', 'environment-bridge', 'index.ts')),
  ));

  for (const legacyAgent of ['update-check', 'babysitter']) {
    checks.push(check(
      `startableAgents excludes removed legacy ${legacyAgent}`,
      !snapshot.startableAgents.some(agent => agent.id === legacyAgent),
    ));
    checks.push(check(
      `bootAgents excludes removed legacy ${legacyAgent}`,
      !snapshot.bootAgents.some(agent => agent.agentId === legacyAgent),
    ));
  }

  const environmentBridge = snapshot.agentData['environment-bridge'];
  checks.push(check(
    'environment-bridge Agent Data exists',
    Boolean(environmentBridge),
  ));
  checks.push(check(
    'environment-bridge Agent Data exposes readiness state',
    Boolean(environmentBridge?.readiness),
    environmentBridge?.readiness,
  ));
  checks.push(check(
    'environment-bridge Agent Data exposes dependency health',
    Boolean(environmentBridge?.dependencyHealth),
    environmentBridge?.dependencyHealth,
  ));

  const bridgeVariableKeys = new Set(environmentBridge?.variables.map(variable => variable.key) ?? []);
  for (const key of ['enabled', 'startOnSystemBoot', 'autoRestart', 'adapterUrl', 'graph', 'deliveryEnabled', 'serviceToken', 'adapterToken', 'activeSessions', 'actionStreams', 'connectedRobots', 'lastContact']) {
    checks.push(check(
      `environment-bridge exposes ${key}`,
      bridgeVariableKeys.has(key),
    ));
  }

  checks.push(check(
    'Environment Bridge contains no environment-specific adapter implementation',
    !fs.existsSync(path.join(ROOT, 'brain', 'agents', 'environment-bridge', 'adapters', 'megameal.ts'))
      && sourceDoesNotContain(path.join(ROOT, 'brain', 'agents', 'environment-bridge', 'core.ts'), /ainekio|megameal/i),
  ));
  checks.push(check(
    'obsolete outbound environment nodes are removed',
    !fs.existsSync(path.join(ROOT, 'packages', 'core', 'src', 'nodes', 'environment', 'connect.node.ts'))
      && sourceDoesNotContain(path.join(ROOT, 'packages', 'core', 'src', 'nodes', 'schemas.ts'), /environment_connect/),
  ));

  const agentMonitorComponent = path.join(ROOT, 'apps', 'site', 'src', 'components', 'AgentMonitor.svelte');
  checks.push(check(
    'Agent Monitor UI does not truncate Agent Data variables',
    sourceDoesNotContain(agentMonitorComponent, /variables\.slice\(/),
  ));
  checks.push(check(
    'Agent Monitor UI has no duplicate compact mode branch',
    sourceDoesNotContain(agentMonitorComponent, /export\s+let\s+compact|{#if\s+compact}/),
  ));
  checks.push(check(
    'Agent Monitor UI exposes refresh and failed-agent retry controls',
    sourceContains(agentMonitorComponent, /on:click={refreshNow}/)
      && sourceContains(agentMonitorComponent, /runAgent\(agent\.name\)/)
      && sourceContains(agentMonitorComponent, /Dismiss Failure/),
  ));
  checks.push(check(
    'Agent Monitor UI bounds start requests without periodic polling',
    sourceContains(agentMonitorComponent, /controller\.abort\(\)/)
      && sourceDoesNotContain(agentMonitorComponent, /setInterval\s*\(/),
  ));

  const siteStylesheet = path.join(ROOT, 'apps', 'site', 'src', 'styles', 'tailwind.css');
  checks.push(check(
    'Agent Monitor legacy global CSS is removed',
    sourceDoesNotContain(siteStylesheet, /agent-monitor-container|agent-monitor-header|agent-card|agent-action-btn|agent-expand-toggle|agent-sparkline|agent-status-dot|agent-progress-bar|agent-progress-fill/),
  ));

  const monitorStream = path.join(ROOT, 'packages', 'core', 'src', 'api', 'handlers', 'monitor-stream.ts');
  checks.push(check(
    'monitor stream has no periodic reconciliation loop',
    sourceDoesNotContain(monitorStream, /setInterval\s*\(|scheduleReconciliation|reconciliationTimer/),
  ));
  checks.push(check(
    'monitor stream subscribes to bridge state changes',
    sourceContains(monitorStream, /subscribeEnvironmentBridgeState\(scheduleSnapshot\)/),
  ));
  const router = path.join(ROOT, 'packages', 'core', 'src', 'api', 'router.ts');
  checks.push(check(
    'legacy POST /api/agent route is removed',
    sourceDoesNotContain(router, /pattern:\s*['"]\/api\/agent['"]/),
  ));

  const agentHandler = path.join(ROOT, 'packages', 'core', 'src', 'api', 'handlers', 'agent.ts');
  checks.push(check(
    'agent restart uses boot-manager snapshot',
    sourceContains(agentHandler, /getAgentMonitorSnapshot\(\)\.bootAgents/),
  ));
  checks.push(check(
    'agent restart excludes deprecated headless-watcher',
    sourceDoesNotContain(agentHandler, /headless-watcher/),
  ));

  const agentRunner = path.join(ROOT, 'packages', 'core', 'src', 'agent-process-runner.ts');
  const agentRegistry = path.join(ROOT, 'packages', 'core', 'src', 'agent-monitor-registry.ts');
  const agentResolver = path.join(ROOT, 'packages', 'core', 'src', 'agent-executable-resolver.ts');
  const cli = path.join(ROOT, 'packages', 'cli', 'src', 'mh-new.ts');
  const systemHandler = path.join(ROOT, 'packages', 'core', 'src', 'api', 'handlers', 'system.ts');
  const bootstrap = path.join(ROOT, 'brain', 'scripts', '_bootstrap.ts');
  const environmentBridgeAgent = path.join(ROOT, 'brain', 'agents', 'environment-bridge', 'core.ts');
  const runtimeMode = path.join(ROOT, 'packages', 'core', 'src', 'runtime-mode.ts');
  checks.push(check(
    'shared agent process runner owns spawn lifecycle',
    sourceContains(agentRunner, /export async function startAgentProcess/)
      && sourceContains(agentRunner, /recordAgentFailure/)
      && sourceContains(agentRunner, /registerAgent/),
  ));
  checks.push(check(
    'shared agent process runner imports filesystem dependency',
    sourceContains(agentRunner, /import fs from ['"]node:fs['"]/),
  ));
  checks.push(check(
    'shared agent executable resolver owns path resolution',
    sourceContains(agentResolver, /export function resolveAgentExecutablePath/)
      && sourceContains(agentRunner, /resolveAgentExecutablePath/)
      && sourceContains(bootstrap, /resolveAgentExecutablePath/)
      && sourceDoesNotContain(bootstrap, /agentScriptOverrides|serviceOverrides|systemPaths\.brain/),
  ));
  checks.push(check(
    'agent child exit cannot unregister a newer process',
    sourceContains(agentRegistry, /expectedPid/)
      && sourceContains(agentRunner, /unregisterAgent\(agentName,\s*pid\)/),
  ));
  checks.push(check(
    'user-context bootstrap exports the selected owner to connection agents',
    sourceContains(bootstrap, /process\.env\.MH_TRIGGER_USERNAME\s*=\s*owner\.username/),
  ));
  checks.push(check(
    'Environment Bridge holds a process-lifetime singleton lock',
    sourceContains(environmentBridgeAgent, /acquireLock\(['"]agent-environment-bridge['"]\)/)
      && sourceContains(environmentBridgeAgent, /lock\.release\(\)/),
  ));
  checks.push(check(
    'shared runner has no obsolete outbound bridge diagnosis',
    sourceDoesNotContain(agentRunner, /Environment Bridge adapter endpoint|endpoint URL/),
  ));
  checks.push(check(
    'agent API uses shared process runner',
    sourceContains(agentHandler, /startAgentProcess\(/)
      && sourceDoesNotContain(agentHandler, /spawn\s*\(/),
  ));
  checks.push(check(
    'agent API uses user-context bootstrap',
    sourceContains(agentHandler, /useBootstrap:\s*true/)
      && sourceContains(bootstrap, /MH_TRIGGER_USERNAME/)
      && sourceContains(bootstrap, /process\.argv\s*=\s*\[process\.argv\[0\],\s*agentPath,\s*\.\.\.agentArgs\]/),
  ));
  checks.push(check(
    'agent API waits for early process failures',
    sourceContains(agentHandler, /waitForMs:\s*5000/)
      && sourceContains(agentRunner, /options\.readyPattern\?\.test\(text\)/),
  ));
  checks.push(check(
    'agent API supports individual stop restart and failure clearing',
    sourceContains(agentHandler, /'clear-failure'/)
      && sourceContains(agentHandler, /stopAgent\(agent\)/)
      && sourceContains(agentHandler, /waitForProcessExit/),
  ));
  checks.push(check(
    'boot API does not relaunch boot-managed agents',
    sourceDoesNotContain(systemHandler, /startAgentProcess\(|getAgentMonitorSnapshot\(|spawn\s*\(/),
  ));
  checks.push(check(
    'boot API imports filesystem dependency',
    sourceContains(systemHandler, /import fs from ['"]node:fs['"]/),
  ));
  checks.push(check(
    'CLI agent startup uses shared process runner',
    sourceContains(cli, /startAgentProcess\(/)
      && sourceDoesNotContain(cli, /spawn\(['"]tsx['"]/),
  ));
  checks.push(check(
    'deprecated headless-watcher service is removed from startup resolvers',
    !fs.existsSync(path.join(ROOT, 'brain', 'services', 'headless-watcher.ts'))
      && sourceDoesNotContain(agentRunner, /headless-watcher/)
      && sourceDoesNotContain(bootstrap, /headless-watcher/)
      && sourceDoesNotContain(cli, /headless-watcher/),
  ));
  checks.push(check(
    'runtime-mode resumes from boot-manager snapshot',
    sourceContains(runtimeMode, /getAgentMonitorSnapshot\(\)\.bootAgents/)
      && sourceContains(runtimeMode, /startAgentProcess\(/)
      && sourceDoesNotContain(runtimeMode, /boredom-service|headless-watcher/),
  ));

  const descriptorSource = path.join(ROOT, 'packages', 'core', 'src', 'agent-monitor-descriptors.ts');
  checks.push(check(
    'Robot Bridge monitor uses inbound session and stream state',
    sourceContains(descriptorSource, /getEnvironmentActionSubscriberCount/)
      && sourceContains(descriptorSource, /activeSessions/)
      && sourceDoesNotContain(descriptorSource, /endpointUrl|roomName|graphName/),
  ));

  checks.push(check(
    'active docs no longer instruct headless-watcher runtime use',
    !fs.existsSync(path.join(ROOT, 'docs', 'SYSTEM-CODER-ANALYSIS.md'))
      && sourceDoesNotContain(path.join(ROOT, 'docs', 'user-guide', 'advanced-features', 'headless-mode.md'), /headless-watcher/)
      && sourceDoesNotContain(path.join(ROOT, 'docs', 'user-guide', 'advanced-features', 'autonomous-agents.md'), /headless-watcher/)
      && sourceDoesNotContain(path.join(ROOT, 'docs', 'user-guide', 'configuration-admin', 'configuration-files.md'), /headless-watcher/),
  ));

  recordAgentFailure({
    agent: SYNTHETIC_AGENT,
    error: 'synthetic validation failure',
    stderr: 'agent monitor validation stderr',
    source: 'validate-agent-monitor',
  });

  const failureSnapshot = getAgentMonitorSnapshot();
  const syntheticFailure = failureSnapshot.recentFailures.find(agent => agent.name === SYNTHETIC_AGENT);
  checks.push(check(
    'failure registry surfaces current failed agents',
    Boolean(syntheticFailure && syntheticFailure.status === 'error'),
    syntheticFailure ? `${syntheticFailure.name}:${syntheticFailure.status}` : 'missing synthetic failure',
  ));

  checks.push(check(
    'Agent Data reflects failure lifecycle',
    failureSnapshot.agentData[SYNTHETIC_AGENT]?.lifecycle === 'error',
    failureSnapshot.agentData[SYNTHETIC_AGENT]?.lifecycle,
  ));
  checks.push(check(
    'Agent Data exposes structured failure details',
    failureSnapshot.agentData[SYNTHETIC_AGENT]?.errors?.[0]?.source === 'validate-agent-monitor'
      && failureSnapshot.agentData[SYNTHETIC_AGENT]?.errors?.[0]?.stderr === 'agent monitor validation stderr',
    JSON.stringify(failureSnapshot.agentData[SYNTHETIC_AGENT]?.errors?.[0] ?? null),
  ));

  clearAgentFailure(SYNTHETIC_AGENT);
  const clearedSnapshot = getAgentMonitorSnapshot();
  checks.push(check(
    'clearing failure removes failed card',
    !clearedSnapshot.recentFailures.some(agent => agent.name === SYNTHETIC_AGENT),
  ));

  checks.push(...await runPreflightFailureChecks());

  checks.push(...await runVariableChecks());

  let failed = 0;
  for (const item of checks) {
    if (item.pass) {
      console.log(`PASS ${item.name}${item.details ? ` (${item.details})` : ''}`);
    } else {
      failed += 1;
      console.error(`FAIL ${item.name}${item.details ? ` (${item.details})` : ''}`);
    }
  }

  if (failed > 0) {
    console.error(`\nAgent Monitor validation failed: ${failed}/${checks.length} checks failed`);
    process.exit(1);
  }

  console.log(`\nAgent Monitor validation passed: ${checks.length}/${checks.length} checks`);
  process.exit(0);
}

main().catch(error => {
  clearAgentFailure(SYNTHETIC_AGENT);
  console.error(error);
  process.exit(1);
});
