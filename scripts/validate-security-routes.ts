import fs from 'node:fs';
import path from 'node:path';

type Check = {
  name: string;
  pass: boolean;
  details?: string;
};

type RouteLine = {
  line: number;
  text: string;
};

const ROOT = process.cwd();
const ROUTER_PATH = path.join(ROOT, 'packages/core/src/api/router.ts');
const ASTRO_CONFIG_PATH = path.join(ROOT, 'apps/site/astro.config.mjs');
const ASTRO_ADAPTER_PATH = path.join(ROOT, 'packages/core/src/api/adapters/astro.ts');
const SITE_MIDDLEWARE_PATH = path.join(ROOT, 'apps/site/src/middleware.ts');
const WEB_API_CONFIG_PATH = path.join(ROOT, 'apps/site/src/lib/client/api-config.ts');
const START_SCRIPT_PATH = path.join(ROOT, 'start.sh');
const SOURCE = fs.readFileSync(ROUTER_PATH, 'utf8');
const ASTRO_CONFIG_SOURCE = fs.readFileSync(ASTRO_CONFIG_PATH, 'utf8');
const ASTRO_ADAPTER_SOURCE = fs.readFileSync(ASTRO_ADAPTER_PATH, 'utf8');
const SITE_MIDDLEWARE_SOURCE = fs.readFileSync(SITE_MIDDLEWARE_PATH, 'utf8');
const WEB_API_CONFIG_SOURCE = fs.readFileSync(WEB_API_CONFIG_PATH, 'utf8');
const START_SCRIPT_SOURCE = fs.readFileSync(START_SCRIPT_PATH, 'utf8');
const ROUTE_LINES: RouteLine[] = SOURCE
  .split('\n')
  .map((text, index) => ({ line: index + 1, text: text.trim() }))
  .filter(route => route.text.startsWith('{ method:'));

const AUTH_BOOTSTRAP_PATTERNS = [
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/register',
  '/api/auth/guest',
  '/api/auth/sync-user',
  '/api/auth/reset-password',
  '/api/profile-sync/export-priority',
  '/api/profile-sync/memories',
  '/api/environment-bridge/observation',
  '/api/environment-bridge/action-result',
  '/api/internal/work-coordinator/enqueue',
];

const OWNER_ROUTE_PATTERNS = [
  '/api/terminal/',
  '/api/active-operator/config',
  '/api/active-operator/control',
  '/api/active-operator/approvals',
  '/api/agents/',
  '/api/unified-queue/control',
  '/api/unified-queue/clear',
  '/api/unified-queue/trigger',
  '/api/queue/lane-control',
  '/api/cloudflare/',
  '/api/training/launch',
  '/api/training/load-model',
  '/api/lifeline/trigger',
  '/api/execute',
  '/api/file_operations',
];

const HIGH_RISK_READ_PATTERNS = [
  '/api/big-brother',
  '/api/astro-servers',
  '/api/node-pipeline',
  '/api/terminal/',
  '/api/active-operator/config',
  '/api/active-operator/approvals',
  '/api/conversation-buffer',
  '/api/training-config',
  '/api/adapters',
  '/api/voice-training',
  '/api/rvc-training',
  '/api/sovits-training',
  '/api/profiles/list',
  '/api/trust',
  '/api/audit',
  '/api/functions',
  '/api/template-watch',
  '/api/monitor',
  '/api/runtime/mode',
  '/api/scheduler-config',
  '/api/big-brother-config',
  '/api/storage-status',
  '/api/unified-queue',
  '/api/queue',
  '/api/memory-content',
  '/api/cognitive-graph',
  '/api/graph-traces',
  '/api/llm-backend/config',
  '/api/cloudflare/status',
  '/api/training/',
  '/api/file_operations',
  '/api/local-models/config',
];

function check(name: string, pass: boolean, details?: string): Check {
  return { name, pass, details };
}

function isMutatingRoute(text: string): boolean {
  return /method: ('POST'|'PUT'|'PATCH'|'DELETE|\[[^\]]*'POST'|\[[^\]]*'PUT'|\[[^\]]*'PATCH'|\[[^\]]*'DELETE')/.test(text);
}

function routeHasPublicReason(text: string): boolean {
  return /public:\s*true/.test(text) && /publicReason:\s*'[^']+'/.test(text);
}

function routeRequiresAuth(text: string): boolean {
  return /requiresAuth:\s*true/.test(text);
}

function routeRequiresOwner(text: string): boolean {
  return /requiresAuth:\s*true/.test(text) && /guard:\s*'owner'/.test(text);
}

function containsAny(text: string, patterns: string[]): boolean {
  return patterns.some(pattern => text.includes(pattern));
}

function formatRoutes(routes: RouteLine[]): string {
  return routes.map(route => `${route.line}: ${route.text}`).join('\n');
}

const mutatingRoutes = ROUTE_LINES.filter(route => isMutatingRoute(route.text));
const publicMutatingRoutes = mutatingRoutes.filter(route => /public:\s*true/.test(route.text));
const unsafeMutatingRoutes = mutatingRoutes.filter(route => !routeRequiresAuth(route.text) && !routeHasPublicReason(route.text));
const unexpectedPublicRoutes = publicMutatingRoutes.filter(route => !containsAny(route.text, AUTH_BOOTSTRAP_PATTERNS));
const ownerRoutesMissingOwner = ROUTE_LINES
  .filter(route => containsAny(route.text, OWNER_ROUTE_PATTERNS))
  .filter(route => /method: 'GET'/.test(route.text) ? routeRequiresAuth(route.text) && !route.text.includes('/api/cloudflare/status') : true)
  .filter(route => !routeRequiresOwner(route.text));
const highRiskPublicReads = ROUTE_LINES
  .filter(route => /method: 'GET'|method: \[[^\]]*'GET'/.test(route.text))
  .filter(route => containsAny(route.text, HIGH_RISK_READ_PATTERNS))
  .filter(route => !routeRequiresAuth(route.text));

const checks: Check[] = [
  check(
    'mutating routes are authenticated or explicitly public',
    unsafeMutatingRoutes.length === 0,
    formatRoutes(unsafeMutatingRoutes),
  ),
  check(
    'public mutating routes are on the bootstrap/bridge allowlist',
    unexpectedPublicRoutes.length === 0,
    formatRoutes(unexpectedPublicRoutes),
  ),
  check(
    'public mutating routes carry publicReason',
    publicMutatingRoutes.every(route => routeHasPublicReason(route.text)),
    formatRoutes(publicMutatingRoutes.filter(route => !routeHasPublicReason(route.text))),
  ),
  check(
    'high-impact routes require owner',
    ownerRoutesMissingOwner.length === 0,
    formatRoutes(ownerRoutesMissingOwner),
  ),
  check(
    'high-risk read routes require auth',
    highRiskPublicReads.length === 0,
    formatRoutes(highRiskPublicReads),
  ),
  check(
    'retired route guards are removed',
    !/writeMode|operatorMode/.test(SOURCE),
  ),
  check(
    'router has local/shared request boundary',
    /function requestExposureMode/.test(SOURCE) && /function checkRequestBoundary/.test(SOURCE),
  ),
  check(
    'Astro config defaults to local exposure',
    /exposureMode/.test(ASTRO_CONFIG_SOURCE) && !/mh\.dndiy\.org|\.dndiy\.org/.test(ASTRO_CONFIG_SOURCE),
  ),
  check(
    'web API config has no baked-in personal sync domain',
    !/mh\.dndiy\.org|\.dndiy\.org/.test(WEB_API_CONFIG_SOURCE),
  ),
  check(
    'Astro adapter exposes only the maintained handler path',
    !/createAstroHandler/.test(ASTRO_ADAPTER_SOURCE),
  ),
  check(
    'site middleware does not echo arbitrary credentialed CORS origins',
    /function isCorsAllowed/.test(SITE_MIDDLEWARE_SOURCE) && !/Access-Control-Allow-Origin':\s*origin\s*\|\|\s*'null'/.test(SITE_MIDDLEWARE_SOURCE),
  ),
  check(
    'startup defaults to local exposure',
    /MH_EXPOSURE_MODE/.test(START_SCRIPT_SOURCE) && /HOST=\"\$\{HOST:-127\.0\.0\.1\}\"/.test(START_SCRIPT_SOURCE),
  ),
];

let failed = 0;
for (const result of checks) {
  if (result.pass) {
    console.log(`PASS ${result.name}`);
    continue;
  }
  failed += 1;
  console.error(`FAIL ${result.name}`);
  if (result.details) {
    console.error(result.details);
  }
}

console.log(`security route checks: ${checks.length - failed}/${checks.length} passed`);

if (failed > 0) {
  process.exit(1);
}
