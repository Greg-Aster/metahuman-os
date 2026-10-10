import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, systemPaths } from './path-builder.js';
import { getAgentCatalogDefinition, sourceAgentId } from './agent-catalog-definitions.js';

declare const __METAHUMAN_AGENT_EXECUTABLES__: Record<string, string> | undefined;

function compiledExecutables(): Record<string, string> | undefined {
  return typeof __METAHUMAN_AGENT_EXECUTABLES__ === 'undefined' ? undefined : __METAHUMAN_AGENT_EXECUTABLES__;
}

export function resolveAgentBootstrapPath(): string {
  const compiled = compiledExecutables();
  return compiled ? fileURLToPath(compiled.$bootstrap) : path.join(ROOT, 'packages/core/src/agent-bootstrap.ts');
}

export function resolveAgentRunner(executable: string): string {
  return executable.endsWith('.mjs') ? process.execPath : resolveTsx();
}

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
  const compiled = compiledExecutables();
  if (compiled) {
    const executable = compiled[agentName] ?? compiled[sourceAgentId(agentName)];
    return executable ? fileURLToPath(executable) : null;
  }
  const definition = getAgentCatalogDefinition(agentName);
  if (definition?.servicePath) {
    const servicePath = path.join(systemPaths.brain, definition.servicePath);
    return fs.existsSync(servicePath) ? servicePath : null;
  }

  const directoryName = sourceAgentId(agentName);
  const candidates = [
    path.join(systemPaths.brain, 'agents', directoryName, 'cli.ts'),
    path.join(systemPaths.brain, 'agents', directoryName, 'index.ts'),
  ];

  return candidates.find(candidate => fs.existsSync(candidate)) ?? null;
}
