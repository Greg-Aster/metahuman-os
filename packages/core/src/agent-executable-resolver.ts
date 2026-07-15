import fs from 'node:fs';
import path from 'node:path';
import { ROOT, systemPaths } from './path-builder.js';

const agentScriptOverrides: Record<string, string> = {
  curiosity: 'curiosity-service.ts',
};

const serviceOverrides: Record<string, string> = {
  'scheduler-service': 'services/scheduler-service.ts',
};

export function resolveTsx(): string {
  const executable = process.platform === 'win32' ? 'tsx.cmd' : 'tsx';
  const candidates = [
    path.join(ROOT, 'apps', 'site', 'node_modules', '.bin', executable),
    path.join(ROOT, 'node_modules', '.bin', executable),
  ];

  return candidates.find(candidate => fs.existsSync(candidate)) ?? 'tsx';
}

export function buildAgentNodePath(): string {
  return [
    path.join(ROOT, 'node_modules'),
    path.join(ROOT, 'packages/cli/node_modules'),
    path.join(ROOT, 'apps/site/node_modules'),
  ].join(':');
}

export function resolveAgentExecutablePath(agentName: string): string | null {
  if (serviceOverrides[agentName]) {
    const servicePath = path.join(systemPaths.brain, serviceOverrides[agentName]);
    return fs.existsSync(servicePath) ? servicePath : null;
  }

  const candidates = [
    path.join(systemPaths.brain, 'agents', agentName, 'cli.ts'),
    path.join(systemPaths.brain, 'agents', agentName, `${agentName}.ts`),
    path.join(systemPaths.brain, 'agents', agentName, 'index.ts'),
    path.join(systemPaths.brain, 'agents', agentScriptOverrides[agentName] ?? `${agentName}.ts`),
  ];

  return candidates.find(candidate => fs.existsSync(candidate)) ?? null;
}
