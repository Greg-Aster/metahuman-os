import { readFileSync } from 'node:fs';
import path from 'node:path';

export const MAINTAINED_SURFACE_DOCUMENT = 'docs/technical/MAINTAINED_SURFACE.md';

const POLICY_START = '<!-- maintained-source-policy:start -->';
const POLICY_END = '<!-- maintained-source-policy:end -->';

export interface MaintainedSourcePolicy {
  version: 1;
  default: 'include-tracked-existing';
  includePaths: string[];
  excludePaths: string[];
  excludePrefixes: string[];
  excludeDirectoryNames: string[];
  excludeFilenameMarkers: string[];
  excludeExtensions: string[];
}

function stringArray(value: unknown, field: keyof MaintainedSourcePolicy): string[] {
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string' && item.length > 0)) {
    throw new Error(`Maintained source policy ${field} must be an array of non-empty strings`);
  }
  return value;
}

function validateRelativePath(value: string, field: string): void {
  if (path.isAbsolute(value) || value.startsWith('./') || value.includes('\\') || value.split('/').includes('..')) {
    throw new Error(`Maintained source policy ${field} contains an invalid repository path: ${value}`);
  }
}

function validatePolicy(value: unknown): MaintainedSourcePolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Maintained source policy must be a JSON object');
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1) throw new Error('Maintained source policy version must be 1');
  if (candidate.default !== 'include-tracked-existing') {
    throw new Error('Maintained source policy default must be include-tracked-existing');
  }

  const policy: MaintainedSourcePolicy = {
    version: 1,
    default: 'include-tracked-existing',
    includePaths: stringArray(candidate.includePaths, 'includePaths'),
    excludePaths: stringArray(candidate.excludePaths, 'excludePaths'),
    excludePrefixes: stringArray(candidate.excludePrefixes, 'excludePrefixes'),
    excludeDirectoryNames: stringArray(candidate.excludeDirectoryNames, 'excludeDirectoryNames'),
    excludeFilenameMarkers: stringArray(candidate.excludeFilenameMarkers, 'excludeFilenameMarkers'),
    excludeExtensions: stringArray(candidate.excludeExtensions, 'excludeExtensions'),
  };

  for (const value of [...policy.includePaths, ...policy.excludePaths]) {
    validateRelativePath(value, 'path list');
  }
  for (const prefix of policy.excludePrefixes) {
    validateRelativePath(prefix, 'excludePrefixes');
    if (!prefix.endsWith('/')) throw new Error(`Maintained source policy prefix must end with "/": ${prefix}`);
  }
  for (const extension of policy.excludeExtensions) {
    if (!extension.startsWith('.') || extension.includes('/')) {
      throw new Error(`Maintained source policy extension is invalid: ${extension}`);
    }
  }

  return policy;
}

export function loadMaintainedSourcePolicy(root: string): MaintainedSourcePolicy {
  const documentPath = path.join(root, MAINTAINED_SURFACE_DOCUMENT);
  const document = readFileSync(documentPath, 'utf8');
  const start = document.indexOf(POLICY_START);
  const end = document.indexOf(POLICY_END);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`${MAINTAINED_SURFACE_DOCUMENT} is missing its maintained-source policy markers`);
  }

  const policySection = document.slice(start + POLICY_START.length, end);
  const jsonFence = policySection.match(/```json\s*([\s\S]*?)```/);
  if (!jsonFence) {
    throw new Error(`${MAINTAINED_SURFACE_DOCUMENT} policy markers must contain one JSON code block`);
  }

  try {
    return validatePolicy(JSON.parse(jsonFence[1]));
  } catch (error) {
    throw new Error(`Invalid maintained source policy in ${MAINTAINED_SURFACE_DOCUMENT}: ${(error as Error).message}`);
  }
}

export function isMaintainedSourcePath(file: string, policy: MaintainedSourcePolicy): boolean {
  const normalized = file.replaceAll('\\', '/').replace(/^\.\//, '');
  if (policy.includePaths.includes(normalized)) return true;
  if (policy.excludePaths.includes(normalized)) return false;
  if (policy.excludePrefixes.some(prefix => normalized.startsWith(prefix))) return false;

  const segments = normalized.split('/');
  const directories = segments.slice(0, -1);
  if (directories.some(segment => policy.excludeDirectoryNames.includes(segment))) return false;

  const filename = segments.at(-1) ?? normalized;
  if (policy.excludeFilenameMarkers.some(marker => filename.includes(marker))) return false;

  const lower = normalized.toLowerCase();
  if (policy.excludeExtensions.some(extension => lower.endsWith(extension.toLowerCase()))) return false;
  return true;
}
