#!/usr/bin/env tsx
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  isMaintainedSourcePath,
  loadMaintainedSourcePolicy,
  MAINTAINED_SURFACE_DOCUMENT,
} from './maintained-source-policy.js';

type AuditItem = {
  path: string;
  area: string;
  kind: string;
  priority: number;
  lineCount?: number;
};

const ROOT = process.cwd();
const args = process.argv.slice(2);
const unknownArgs = args.filter(arg => arg !== '--dry-run' && arg !== '--list');
if (unknownArgs.length > 0) throw new Error(`Unknown argument: ${unknownArgs[0]}`);
const DRY_RUN = args.includes('--dry-run');
const LIST = args.includes('--list');
if (DRY_RUN && LIST) throw new Error('--dry-run and --list cannot be combined');
const OUT_DIR = path.join(ROOT, 'docs/audits');
const JSON_OUT = path.join(OUT_DIR, 'maintained-source-inventory.json');
const MD_OUT = path.join(OUT_DIR, 'maintained-source-inventory.md');
const maintainedPolicy = loadMaintainedSourcePolicy(ROOT);

function gitSourceFiles(): string[] {
  return execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard'],
    { cwd: ROOT, encoding: 'utf8' },
  )
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function isMaintained(file: string): boolean {
  return existsSync(path.join(ROOT, file)) && isMaintainedSourcePath(file, maintainedPolicy);
}

const maintainedFiles = gitSourceFiles().filter(isMaintained);
if (LIST) {
  process.stdout.write(maintainedFiles.join('\n') + (maintainedFiles.length > 0 ? '\n' : ''));
  process.exit(0);
}

function areaFor(file: string): string {
  if (file.startsWith('packages/core/')) return 'core-engine';
  if (file.startsWith('apps/site/')) return 'web-interface';
  if (file.startsWith('brain/agents/')) return 'agents';
  if (file.startsWith('brain/services/')) return 'brain-services';
  if (file.startsWith('brain/training/')) return 'training';
  if (file === 'brain/mobile-agents.ts' || file === 'brain/mobile-handlers.ts') return 'mobile-runtime';
  if (file.startsWith('packages/cli/')) return 'cli';
  if (file.startsWith('packages/agent-runtime/')) return 'agent-runtime';
  if (file.startsWith('packages/local-model-service/')) return 'local-model-service';
  if (file.startsWith('apps/react-native/')) return 'mobile-interface';
  if (file.startsWith('external/')) return 'external-integration';
  if (file.startsWith('scripts/')) return 'scripts';
  if (file.startsWith('bin/')) return 'bin';
  if (file.startsWith('tests/')) return 'tests';
  if (file.startsWith('docs/')) return 'docs';
  if (file.startsWith('etc/')) return 'config';
  return 'repo-root';
}

function kindFor(file: string): string {
  if (/\.(ts|tsx|js|jsx|mjs|svelte|astro|py)$/.test(file)) return 'code';
  if (/\.md$/.test(file)) return 'docs';
  if (/\.json$/.test(file)) return 'json';
  if (/\.ya?ml$/.test(file)) return 'yaml';
  if (/\.sh$/.test(file) || file.startsWith('bin/')) return 'shell';
  return 'other';
}

function priorityFor(area: string, kind: string): number {
  if (kind === 'code' && area === 'core-engine') return 1;
  if (kind === 'code' && (area === 'web-interface' || area === 'agents')) return 2;
  if (kind === 'code' && (area === 'cli' || area === 'agent-runtime' || area === 'brain-services')) return 3;
  if (kind === 'code') return 4;
  if (area === 'docs' || area === 'config') return 5;
  return 6;
}

function lineCount(file: string): number | undefined {
  if (!/\.(ts|tsx|js|jsx|mjs|svelte|astro|py|md|json|ya?ml|sh)$/.test(file)) return undefined;
  try {
    return readFileSync(path.join(ROOT, file), 'utf8').split('\n').length - 1;
  } catch {
    return undefined;
  }
}

function groupCount(items: AuditItem[], selector: (item: AuditItem) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = selector(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return new Map([...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

const items: AuditItem[] = maintainedFiles
  .map((file) => {
    const area = areaFor(file);
    const kind = kindFor(file);
    return {
      path: file,
      area,
      kind,
      priority: priorityFor(area, kind),
      lineCount: lineCount(file),
    };
  })
  .sort((a, b) => a.priority - b.priority || a.area.localeCompare(b.area) || a.path.localeCompare(b.path));

const generatedAt = new Date().toISOString();
const byArea = groupCount(items, (item) => item.area);
const byKind = groupCount(items, (item) => item.kind);
const codeItems = items.filter((item) => item.kind === 'code');
const oversized = codeItems
  .filter((item) => (item.lineCount ?? 0) >= 800)
  .sort((a, b) => (b.lineCount ?? 0) - (a.lineCount ?? 0));

const md: string[] = [];
md.push('# Maintained Source Inventory');
md.push('');
md.push(`Generated: ${generatedAt}`);
md.push('');
md.push(`Total maintained files: ${items.length}`);
md.push(`Code files: ${codeItems.length}`);
md.push(`Policy: \`${MAINTAINED_SURFACE_DOCUMENT}\``);
md.push('');
md.push('## By Area');
md.push('');
for (const [area, count] of byArea) {
  md.push(`- ${area}: ${count}`);
}
md.push('');
md.push('## By Kind');
md.push('');
for (const [kind, count] of byKind) {
  md.push(`- ${kind}: ${count}`);
}
md.push('');
md.push('## First Audit Batches');
md.push('');
md.push('1. `packages/core` boundary and storage engine files.');
md.push('2. `apps/site/src/pages/api` transport routes and handlers.');
md.push('3. `brain/agents`, `brain/services`, and `brain/training` deep-import cleanup.');
md.push('4. `packages/cli` command ownership and smoke behavior.');
md.push('5. Oversized UI/core files and orphan candidates.');
md.push('');
md.push('## Oversized Code Files');
md.push('');
for (const item of oversized.slice(0, 80)) {
  md.push(`- ${item.path}: ${item.lineCount} lines`);
}
md.push('');
md.push('Full machine-readable inventory: `docs/audits/maintained-source-inventory.json`.');
md.push('');

if (DRY_RUN) {
  console.log(`Validated maintained source policy: ${MAINTAINED_SURFACE_DOCUMENT}`);
} else {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(JSON_OUT, `${JSON.stringify({ generatedAt, total: items.length, byArea: Object.fromEntries(byArea), byKind: Object.fromEntries(byKind), items }, null, 2)}\n`);
  writeFileSync(MD_OUT, md.join('\n'));
  console.log(`Wrote ${path.relative(ROOT, JSON_OUT)}`);
  console.log(`Wrote ${path.relative(ROOT, MD_OUT)}`);
}
console.log(`Maintained files: ${items.length}`);
console.log(`Code files: ${codeItems.length}`);
