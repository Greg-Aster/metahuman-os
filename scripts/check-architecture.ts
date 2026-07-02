#!/usr/bin/env tsx
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

type Violation = {
  id: string;
  rule: string;
  file: string;
  message: string;
};

type Baseline = {
  version: 1;
  generatedAt: string;
  violations: Violation[];
};

type Options = {
  baselinePath: string;
  updateBaseline: boolean;
  strict: boolean;
  failOnStaleBaseline: boolean;
};

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = findRepoRoot();
const DEFAULT_BASELINE_PATH = path.join(ROOT, 'docs/technical/architecture-guardrail-baseline.json');

function findRepoRoot(): string {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return path.resolve(SCRIPT_DIR, '..');
  }
}

function usage(): never {
  console.log(`Usage: check-architecture [--baseline <path>] [--update-baseline] [--strict] [--fail-on-stale-baseline]

Options:
  --baseline <path>       Baseline JSON path. Defaults to docs/technical/architecture-guardrail-baseline.json.
  --update-baseline       Write the current violations to the baseline and exit.
  --strict                Fail if any current violations exist, even when baselined.
  --fail-on-stale-baseline
                           Fail when the baseline still contains resolved violations.
  --help                  Show this help.
`);
  process.exit(0);
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    baselinePath: DEFAULT_BASELINE_PATH,
    updateBaseline: false,
    strict: false,
    failOnStaleBaseline: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') usage();
    if (arg === '--update-baseline') {
      options.updateBaseline = true;
      continue;
    }
    if (arg === '--strict') {
      options.strict = true;
      continue;
    }
    if (arg === '--fail-on-stale-baseline') {
      options.failOnStaleBaseline = true;
      continue;
    }
    if (arg === '--baseline') {
      const value = argv[index + 1];
      if (!value) fail('Missing value for --baseline');
      options.baselinePath = resolveRepoPath(value);
      index += 1;
      continue;
    }
    if (arg.startsWith('--baseline=')) {
      options.baselinePath = resolveRepoPath(arg.slice('--baseline='.length));
      continue;
    }
    fail(`Unknown argument: ${arg}`);
  }

  return options;
}

function resolveRepoPath(value: string): string {
  return path.isAbsolute(value) ? value : path.join(ROOT, value);
}

function repoRelative(file: string): string {
  const relative = path.relative(ROOT, file);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return file;
  return relative.split(path.sep).join('/');
}

function gitLsFiles(): string[] {
  return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
}

function readText(file: string): string | null {
  const fullPath = path.join(ROOT, file);
  if (!existsSync(fullPath)) return null;
  return readFileSync(fullPath, 'utf8');
}

function isSource(file: string): boolean {
  return /\.(ts|tsx|js|jsx|mjs|svelte|astro)$/.test(file);
}

function isIgnoredSource(file: string): boolean {
  const segments = file.split('/');
  return file.startsWith('apps/code-oss/')
    || segments.includes('node_modules')
    || segments.includes('dist')
    || segments.includes('build')
    || file.startsWith('vendor/')
    || file.startsWith('external/');
}

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

function add(list: Violation[], seen: Set<string>, rule: string, file: string, message: string): void {
  const id = `${rule}:${file}:${message}`;
  if (seen.has(id)) return;
  seen.add(id);
  list.push({ id, rule, file, message });
}

function importSpecifiers(content: string): Array<{ statement: string; specifier: string; typeOnly: boolean }> {
  const imports: Array<{ statement: string; specifier: string; typeOnly: boolean }> = [];
  const code = stripComments(content);
  const staticImport = /(^|[;\n\r])\s*import\s+(type\s+)?(?:[^'";]*?\s+from\s*)?['"]([^'"]+)['"]/g;
  const exportFrom = /(^|[;\n\r])\s*export\s+(type\s+)?[^'";]*?\s+from\s+['"]([^'"]+)['"]/g;
  const dynamicImport = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

  for (const match of code.matchAll(staticImport)) {
    imports.push({ statement: match[0], specifier: match[3], typeOnly: Boolean(match[2]) });
  }
  for (const match of code.matchAll(exportFrom)) {
    imports.push({ statement: match[0], specifier: match[3], typeOnly: Boolean(match[2]) });
  }
  for (const match of code.matchAll(dynamicImport)) {
    imports.push({ statement: match[0], specifier: match[1], typeOnly: false });
  }

  return imports;
}

function stripComments(content: string): string {
  let output = '';
  let index = 0;
  let quote: '"' | "'" | '`' | null = null;

  while (index < content.length) {
    const current = content[index];
    const next = content[index + 1];

    if (quote) {
      output += current;
      if (current === '\\') {
        output += next ?? '';
        index += 2;
        continue;
      }
      if (current === quote) quote = null;
      index += 1;
      continue;
    }

    if (current === '"' || current === "'" || current === '`') {
      quote = current;
      output += current;
      index += 1;
      continue;
    }

    if (current === '/' && next === '/') {
      output += '  ';
      index += 2;
      while (index < content.length && content[index] !== '\n') {
        output += ' ';
        index += 1;
      }
      continue;
    }

    if (current === '/' && next === '*') {
      output += '  ';
      index += 2;
      while (index < content.length) {
        const char = content[index];
        const following = content[index + 1];
        if (char === '*' && following === '/') {
          output += '  ';
          index += 2;
          break;
        }
        output += char === '\n' ? '\n' : ' ';
        index += 1;
      }
      continue;
    }

    output += current;
    index += 1;
  }

  return output;
}

function isSiteClientFile(file: string): boolean {
  return file.startsWith('apps/site/src/components/')
    || file.startsWith('apps/site/src/lib/client/')
    || file.startsWith('apps/site/src/stores/')
    || (file.startsWith('apps/site/src/pages/') && !file.startsWith('apps/site/src/pages/api/'));
}

function isAllowedClientCoreImport(specifier: string, typeOnly: boolean): boolean {
  if (!specifier.startsWith('@metahuman/core')) return true;
  if (!typeOnly) return false;
  return specifier === '@metahuman/core/nodes/types'
    || specifier === '@metahuman/core/nodes/schemas';
}

function isCoreImportFromSiteClient(file: string, specifier: string, typeOnly: boolean): boolean {
  if (specifier.startsWith('@metahuman/core')) return !isAllowedClientCoreImport(specifier, typeOnly);
  const resolved = resolveImportPath(file, specifier);
  return resolved !== null && resolved.startsWith('packages/core/src/');
}

function hasApiAdapterPattern(content: string): boolean {
  return content.includes('astroHandler')
    || content.includes('routeRequest')
    || content.includes('handleExecuteGraphStream');
}

function resolveImportPath(file: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
  return resolved.startsWith('../') ? null : resolved;
}

function collectViolations(files: string[]): Violation[] {
  const violations: Violation[] = [];
  const seen = new Set<string>();

  const forbiddenTrackedPatterns: Array<{ pattern: RegExp; reason: string }> = [
    { pattern: /^apps\/code-oss\//, reason: 'legacy Studio bulk is outside maintained source' },
    { pattern: /^apps\/mobile\//, reason: 'deprecated Capacitor app is outside maintained source' },
    { pattern: /^data\/user-data\//, reason: 'browser profile/runtime cache must not be tracked' },
    { pattern: /^data\/argv\.json$/, reason: 'runtime argument capture must not be tracked' },
    { pattern: /^credentials\.txt$/, reason: 'credential-like local file must not be tracked' },
    { pattern: /^\.claude\//, reason: 'local Claude tool state must not be tracked' },
    { pattern: /^\.obsidian\//, reason: 'local editor workspace state must not be tracked' },
    { pattern: /^tmp\//, reason: 'temporary runtime files must not be tracked' },
    { pattern: /^apps\/site\/logs\//, reason: 'site runtime logs must not be tracked' },
    { pattern: /^backups\/.*\.tar\.gz$/, reason: 'local backup archives must not be tracked' },
    { pattern: /^apps\/react-native\/android\/app\/debug\.keystore$/, reason: 'debug signing key artifact must not be tracked' },
    { pattern: /^persona\//, reason: 'root persona runtime/profile data must not be tracked' },
    { pattern: /^profiles\/(?!README\.md$|\.gitkeep$)/, reason: 'profile data must be sanitized before tracking' },
    { pattern: /^logs\//, reason: 'runtime logs must not be tracked' },
    { pattern: /^out\//, reason: 'generated output must not be tracked' },
    { pattern: /^memory\//, reason: 'runtime memory must not be tracked' },
    { pattern: /^metahuman-runs\//, reason: 'runtime runs must not be tracked' },
    { pattern: /^audit-state\.json$/, reason: 'local audit coordination state must not be tracked' },
    { pattern: /^docs\/audit-scratchpad\.md$/, reason: 'local audit scratchpad must not be tracked' },
    { pattern: /^report\.json$/, reason: 'generated report must not be tracked' },
    { pattern: /\.(gguf|ggml|safetensors|pth|pt|onnx|apk)$/i, reason: 'model/build artifact must not be tracked' },
  ];

  for (const file of files) {
    for (const { pattern, reason } of forbiddenTrackedPatterns) {
      if (pattern.test(file)) add(violations, seen, 'forbidden-tracked-path', file, reason);
    }
  }

  const sourceFiles = files.filter((file) => isSource(file) && !isIgnoredSource(file));

  for (const file of sourceFiles) {
    const content = readText(file);
    if (content === null) continue;
    const imports = importSpecifiers(content);

    if (file.startsWith('packages/core/')) {
      for (const imp of imports) {
        const spec = imp.specifier;
        const resolved = resolveImportPath(file, spec);
        const crossesToBrain = spec.includes('/brain/') || resolved?.startsWith('brain/');
        const crossesToApps = spec.includes('/apps/') || resolved?.startsWith('apps/');
        const importsUiRuntime = spec === 'astro' || spec.startsWith('astro') || spec === 'svelte' || spec.startsWith('svelte');
        if (crossesToBrain || crossesToApps || importsUiRuntime) {
          add(violations, seen, 'core-layer-inversion', file, `core imports forbidden dependency "${spec}"`);
        }
      }
    }

    if (file.startsWith('brain/')) {
      for (const imp of imports) {
        const resolved = resolveImportPath(file, imp.specifier);
        if (imp.specifier.includes('packages/core/src') || resolved?.startsWith('packages/core/src/')) {
          add(violations, seen, 'brain-deep-core-import', file, `brain imports core source directly "${imp.specifier}"`);
        }
      }
    }

    if (isSiteClientFile(file)) {
      for (const imp of imports) {
        if (isCoreImportFromSiteClient(file, imp.specifier, imp.typeOnly)) {
          add(violations, seen, 'site-client-core-import', file, `client/importable UI code imports runtime core "${imp.specifier}"`);
        }
      }
    }

    if (file.startsWith('apps/site/src/pages/api/') && file.endsWith('.ts') && !hasApiAdapterPattern(content)) {
      add(violations, seen, 'custom-api-route', file, 'API route does not use the unified adapter pattern');
    }
  }

  const agentDirs = files
    .filter((file) => file.startsWith('brain/agents/') && file.split('/').length >= 3)
    .map((file) => file.split('/')[2])
    .filter((name, index, all) => all.indexOf(name) === index);

  for (const dir of agentDirs) {
    const prefix = `brain/agents/${dir}/`;
    const dirFiles = files.filter((file) => file.startsWith(prefix));
    if (dirFiles.length === 0) continue;
    const hasCore = files.includes(`${prefix}core.ts`);
    const hasCli = files.includes(`${prefix}cli.ts`);
    const hasIndex = files.includes(`${prefix}index.ts`);
    if (!hasCore || !hasCli || !hasIndex) {
      add(
        violations,
        seen,
        'agent-contract',
        prefix.slice(0, -1),
        `agent directory must contain core.ts, cli.ts, and index.ts (core=${hasCore}, cli=${hasCli}, index=${hasIndex})`
      );
    }
  }

  return violations.sort((a, b) => a.id.localeCompare(b.id));
}

function loadBaseline(baselinePath: string): Baseline {
  if (!existsSync(baselinePath)) {
    fail(`Architecture baseline not found: ${repoRelative(baselinePath)}
Create it with: pnpm check:architecture:update-baseline
Or provide one with: pnpm check:architecture -- --baseline <path>`);
  }

  let baseline: unknown;
  try {
    baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  } catch (error) {
    fail(`Could not parse architecture baseline ${repoRelative(baselinePath)}: ${(error as Error).message}`);
  }

  if (!isBaseline(baseline)) {
    fail(`Invalid architecture baseline schema: ${repoRelative(baselinePath)}`);
  }

  return baseline;
}

function isBaseline(value: unknown): value is Baseline {
  if (typeof value !== 'object' || value === null) return false;
  const baseline = value as Baseline;
  return baseline.version === 1
    && typeof baseline.generatedAt === 'string'
    && Array.isArray(baseline.violations)
    && baseline.violations.every((violation) => {
      return typeof violation?.id === 'string'
        && typeof violation.rule === 'string'
        && typeof violation.file === 'string'
        && typeof violation.message === 'string';
    });
}

function normalizedViolations(violations: Violation[]): Violation[] {
  const seen = new Set<string>();
  const normalized: Violation[] = [];
  for (const violation of violations) {
    if (seen.has(violation.id)) continue;
    seen.add(violation.id);
    normalized.push(violation);
  }
  return normalized.sort((a, b) => a.id.localeCompare(b.id));
}

function groupByRule(violations: Violation[]): Map<string, number> {
  const grouped = new Map<string, number>();
  for (const violation of violations) {
    grouped.set(violation.rule, (grouped.get(violation.rule) ?? 0) + 1);
  }
  return grouped;
}

function printSummary(label: string, violations: Violation[]): void {
  console.log(`${label}: ${violations.length}`);
  for (const [rule, count] of groupByRule(violations)) {
    console.log(`  ${rule}: ${count}`);
  }
}

function writeBaseline(baselinePath: string, violations: Violation[]): void {
  mkdirSync(path.dirname(baselinePath), { recursive: true });
  const baseline: Baseline = {
    version: 1,
    generatedAt: process.env.SOURCE_DATE_EPOCH
      ? new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString()
      : 'manual',
    violations,
  };
  const tempPath = `${baselinePath}.tmp-${process.pid}`;
  writeFileSync(tempPath, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
  renameSync(tempPath, baselinePath);
}

const options = parseArgs(process.argv.slice(2));
const files = gitLsFiles();
const violations = collectViolations(files);

if (options.updateBaseline) {
  writeBaseline(options.baselinePath, violations);
  console.log(`Wrote architecture baseline: ${repoRelative(options.baselinePath)}`);
  printSummary('Current violations recorded', violations);
  process.exit(0);
}

const baseline = loadBaseline(options.baselinePath);
const baselineViolations = normalizedViolations(baseline.violations);
const baselineIds = new Set(baselineViolations.map((violation) => violation.id));
const currentIds = new Set(violations.map((violation) => violation.id));
const newViolations = violations.filter((violation) => !baselineIds.has(violation.id));
const resolvedViolations = baselineViolations.filter((violation) => !currentIds.has(violation.id));

console.log(`Architecture baseline: ${repoRelative(options.baselinePath)}`);
printSummary('Current architecture violations', violations);
if (resolvedViolations.length > 0) {
  printSummary('Stale baseline violations', resolvedViolations);
}

if (options.strict && violations.length > 0) {
  console.error('\nStrict architecture check failed. Existing violations remain.');
  process.exit(1);
}

if (newViolations.length > 0) {
  console.error('\nNew architecture violations:');
  for (const violation of newViolations.slice(0, 50)) {
    console.error(`- [${violation.rule}] ${violation.file}: ${violation.message}`);
  }
  if (newViolations.length > 50) {
    console.error(`... ${newViolations.length - 50} more`);
  }
  console.error('\nFix the drift or intentionally refresh the baseline with: pnpm check:architecture:update-baseline');
  process.exit(1);
}

if (options.failOnStaleBaseline && resolvedViolations.length > 0) {
  console.error('\nArchitecture baseline is stale: current cleanup resolved violations that remain in the baseline.');
  for (const violation of resolvedViolations.slice(0, 50)) {
    console.error(`- [${violation.rule}] ${violation.file}: ${violation.message}`);
  }
  if (resolvedViolations.length > 50) {
    console.error(`... ${resolvedViolations.length - 50} more`);
  }
  console.error('\nRefresh the baseline after intentional cleanup with: pnpm check:architecture:update-baseline');
  process.exit(1);
}

if (resolvedViolations.length > 0) {
  console.log('\nArchitecture guardrail passed: no new drift beyond baseline. Stale baseline entries were detected.');
} else {
  console.log('\nArchitecture guardrail passed: no new or stale drift beyond baseline.');
}
