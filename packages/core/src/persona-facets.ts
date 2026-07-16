import fs from 'node:fs';
import path from 'node:path';
import { audit } from './audit.js';
import { getProfilePaths } from './path-builder.js';

export interface PersonaFacetDefinition {
  name: string;
  description?: string;
  personaFile: string | null;
  enabled: boolean;
  color?: string;
  usageHints?: string[];
  [key: string]: unknown;
}

export interface PersonaFacetConfig {
  version: string;
  lastUpdated: string;
  activeFacet: string;
  description?: string;
  facets: Record<string, PersonaFacetDefinition>;
  [key: string]: unknown;
}

export type PersonaFacetConfigurationErrorCode =
  | 'missing'
  | 'empty'
  | 'invalid_json'
  | 'invalid_structure'
  | 'default_missing'
  | 'active_facet_invalid'
  | 'persona_file_invalid';

export class PersonaFacetConfigurationError extends Error {
  constructor(
    public readonly code: PersonaFacetConfigurationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PersonaFacetConfigurationError';
  }
}

const INACTIVE_FACET: PersonaFacetDefinition = {
  name: 'Persona Off',
  description: 'Disable persona context and use raw model behavior',
  personaFile: null,
  enabled: true,
  color: 'gray',
  usageHints: ['Use when persona context should remain disabled.'],
};

export function createDefaultPersonaFacetConfig(): PersonaFacetConfig {
  return {
    version: '0.2.0',
    lastUpdated: new Date().toISOString(),
    activeFacet: 'default',
    description: 'Persona facets configuration',
    facets: {
      default: {
        name: 'Default',
        description: 'Balanced baseline persona',
        personaFile: 'core.json',
        enabled: true,
        color: 'violet',
        usageHints: [],
      },
      inactive: { ...INACTIVE_FACET },
    },
  };
}

function configurationError(
  code: PersonaFacetConfigurationErrorCode,
  subject: string,
  detail: string,
): PersonaFacetConfigurationError {
  return new PersonaFacetConfigurationError(
    code,
    `Persona facet configuration ${subject} ${detail}. Persona loading is blocked until facets.json is repaired.`,
  );
}

function validateConfig(raw: unknown, filePath: string, subject: string): PersonaFacetConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw configurationError('invalid_structure', subject, 'must be a JSON object');
  }

  const candidate = raw as Record<string, unknown>;
  if (typeof candidate.version !== 'string' || !candidate.version.trim()) {
    throw configurationError('invalid_structure', subject, 'is missing a valid version');
  }
  if (typeof candidate.lastUpdated !== 'string' || !candidate.lastUpdated.trim()) {
    throw configurationError('invalid_structure', subject, 'is missing a valid lastUpdated timestamp');
  }
  if (!candidate.facets || typeof candidate.facets !== 'object' || Array.isArray(candidate.facets)) {
    throw configurationError('invalid_structure', subject, 'is missing the facets object');
  }

  const rawFacets = candidate.facets as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(rawFacets, 'default')) {
    throw configurationError('default_missing', subject, 'does not define the required default facet');
  }

  const personaDir = path.dirname(filePath);
  const facets: Record<string, PersonaFacetDefinition> = {};
  for (const [facetId, rawFacet] of Object.entries(rawFacets)) {
    if (!rawFacet || typeof rawFacet !== 'object' || Array.isArray(rawFacet)) {
      throw configurationError('invalid_structure', subject, `contains an invalid "${facetId}" facet`);
    }
    const facet = rawFacet as Record<string, unknown>;
    if (typeof facet.name !== 'string' || !facet.name.trim()) {
      throw configurationError('invalid_structure', subject, `contains a "${facetId}" facet without a name`);
    }
    if (typeof facet.enabled !== 'boolean') {
      throw configurationError('invalid_structure', subject, `contains a "${facetId}" facet without an enabled flag`);
    }
    if (facet.personaFile !== null && (typeof facet.personaFile !== 'string' || !facet.personaFile.trim())) {
      throw configurationError('invalid_structure', subject, `contains a "${facetId}" facet without a valid personaFile`);
    }
    if (facetId === 'default' && (facet.enabled !== true || typeof facet.personaFile !== 'string')) {
      throw configurationError('default_missing', subject, 'does not define an enabled default persona file');
    }

    if (typeof facet.personaFile === 'string') {
      const resolved = path.resolve(personaDir, facet.personaFile);
      const personaPrefix = `${path.resolve(personaDir)}${path.sep}`;
      if (!resolved.startsWith(personaPrefix)) {
        throw configurationError('persona_file_invalid', subject, `contains an unsafe personaFile for "${facetId}"`);
      }
      if (facet.enabled && (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile())) {
        throw configurationError('persona_file_invalid', subject, `references a missing persona file for "${facetId}"`);
      }
    }

    facets[facetId] = { ...facet } as PersonaFacetDefinition;
  }

  if (typeof candidate.activeFacet !== 'string' || !candidate.activeFacet.trim()) {
    throw configurationError('active_facet_invalid', subject, 'is missing activeFacet');
  }
  const activeFacet = facets[candidate.activeFacet];
  if (!activeFacet || !activeFacet.enabled) {
    throw configurationError('active_facet_invalid', subject, `selects an unavailable active facet: "${candidate.activeFacet}"`);
  }
  if (candidate.activeFacet !== 'inactive' && !activeFacet.personaFile) {
    throw configurationError('active_facet_invalid', subject, `selects a facet without a persona file: "${candidate.activeFacet}"`);
  }

  return {
    ...candidate,
    version: candidate.version,
    lastUpdated: candidate.lastUpdated,
    activeFacet: candidate.activeFacet,
    facets,
  } as PersonaFacetConfig;
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, filePath);
}

export function loadPersonaFacetConfig(username: string): PersonaFacetConfig {
  const filePath = getProfilePaths(username).personaFacets;
  return loadPersonaFacetConfigFile(filePath, `for "${username}"`);
}

export function loadPersonaFacetConfigFile(
  filePath: string,
  subject = `at "${filePath}"`,
): PersonaFacetConfig {
  if (!fs.existsSync(filePath)) {
    throw configurationError('missing', subject, 'is missing');
  }

  let contents: string;
  try {
    contents = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    throw configurationError('missing', subject, `could not be read: ${(error as Error).message}`);
  }
  if (!contents.trim()) {
    throw configurationError('empty', subject, 'is empty');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    throw configurationError('invalid_json', subject, `contains invalid JSON: ${(error as Error).message}`);
  }
  return validateConfig(parsed, filePath, subject);
}

export function savePersonaFacetConfig(
  username: string,
  raw: unknown,
  actor: string,
): PersonaFacetConfig {
  const filePath = getProfilePaths(username).personaFacets;
  const candidate = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? { ...(raw as Record<string, unknown>), lastUpdated: new Date().toISOString() }
    : raw;
  const config = validateConfig(candidate, filePath, `for "${username}"`);
  writeJsonAtomic(filePath, config);
  audit({
    level: 'info',
    category: 'data_change',
    event: 'persona_facets_updated',
    actor,
    details: {
      username,
      activeFacet: config.activeFacet,
      facetCount: Object.keys(config.facets).length,
    },
  });
  return config;
}

export interface PersonaFacetChange {
  changed: boolean;
  previousFacet: string;
  activeFacet: string;
  facet: PersonaFacetDefinition;
}

export function setActivePersonaFacet(
  username: string,
  facetId: string,
  actor: string,
  reason = 'Explicit persona facet selection',
): PersonaFacetChange {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(facetId)) throw new Error('Invalid persona facet id');
  const paths = getProfilePaths(username);
  const config = loadPersonaFacetConfig(username);
  const facet = config.facets[facetId];
  if (!facet) throw new Error(`Persona facet not found: ${facetId}`);
  if (!facet.enabled) throw new Error(`Persona facet is disabled: ${facetId}`);

  const previousFacet = config.activeFacet;
  if (previousFacet === facetId) {
    return { changed: false, previousFacet, activeFacet: facetId, facet };
  }

  config.activeFacet = facetId;
  config.lastUpdated = new Date().toISOString();
  writeJsonAtomic(paths.personaFacets, config);
  audit({
    level: 'info',
    category: 'system',
    event: 'persona_facet_changed',
    actor,
    details: {
      username,
      previousFacet,
      newFacet: facetId,
      facetName: facet.name,
      reason,
    },
  });
  return { changed: true, previousFacet, activeFacet: facetId, facet };
}

export function personaFacetResolvedPath(username: string, facet: PersonaFacetDefinition): string | null {
  return resolvePersonaFacetPath(getProfilePaths(username).persona, facet);
}

export function resolvePersonaFacetPath(
  personaDir: string,
  facet: PersonaFacetDefinition,
): string | null {
  if (!facet.personaFile) return null;
  const resolved = path.resolve(personaDir, facet.personaFile);
  const prefix = `${path.resolve(personaDir)}${path.sep}`;
  if (!resolved.startsWith(prefix)) return null;
  return resolved;
}
