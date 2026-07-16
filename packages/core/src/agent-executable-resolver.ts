import fs from 'node:fs';
import path from 'node:path';
import { ROOT, systemPaths } from './path-builder.js';
import { getAgentCatalogDefinition, sourceAgentId } from './agent-catalog-definitions.js';

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
  const definition = getAgentCatalogDefinition(agentName);
  if (definition?.servicePath) {
    const servicePath = path.join(systemPaths.brain, definition.servicePath);
    return fs.existsSync(servicePath) ? servicePath : null;
  }

  const directoryName = sourceAgentId(agentName);
  const candidates = [
    path.join(systemPaths.brain, 'agents', directoryName, 'cli.ts'),
    path.join(systemPaths.brain, 'agents', directoryName, `${directoryName}.ts`),
    path.join(systemPaths.brain, 'agents', directoryName, 'index.ts'),
    path.join(systemPaths.brain, 'agents', `${directoryName}.ts`),
  ];

  return candidates.find(candidate => fs.existsSync(candidate)) ?? null;
}
