import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getProfilePaths } from './path-builder.js';
import {
  loadPersonaFacetConfig,
  PersonaFacetConfigurationError,
  type PersonaFacetConfigurationErrorCode,
} from './persona-facets.js';

const username = `_persona-facets-spec-${process.pid}-${Date.now()}`;
const paths = getProfilePaths(username);
const facetsPath = paths.personaFacets;

function expectConfigurationError(code: PersonaFacetConfigurationErrorCode): void {
  assert.throws(
    () => loadPersonaFacetConfig(username),
    (error: unknown) => error instanceof PersonaFacetConfigurationError && error.code === code,
  );
}

function write(value: unknown): void {
  fs.writeFileSync(facetsPath, typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
}

function validConfig(): Record<string, unknown> {
  return {
    version: '0.2.0',
    lastUpdated: new Date().toISOString(),
    activeFacet: 'default',
    facets: {
      default: {
        name: 'Default',
        description: 'Core identity',
        personaFile: 'core.json',
        enabled: true,
      },
      inactive: {
        name: 'Persona Off',
        personaFile: null,
        enabled: true,
      },
    },
  };
}

try {
  expectConfigurationError('missing');

  fs.mkdirSync(paths.persona, { recursive: true });
  fs.writeFileSync(path.join(paths.persona, 'core.json'), '{}\n', 'utf8');

  write('');
  expectConfigurationError('empty');

  write('{');
  expectConfigurationError('invalid_json');

  const withoutDefault = validConfig();
  (withoutDefault.facets as Record<string, unknown>).default = undefined;
  delete (withoutDefault.facets as Record<string, unknown>).default;
  write(withoutDefault);
  expectConfigurationError('default_missing');

  write({ ...validConfig(), activeFacet: 'missing' });
  expectConfigurationError('active_facet_invalid');

  const valid = validConfig();
  write(valid);
  const loaded = loadPersonaFacetConfig(username);
  assert.equal(loaded.activeFacet, 'default');
  assert.equal(loaded.facets.default.personaFile, 'core.json');
} finally {
  fs.rmSync(paths.root, { recursive: true, force: true });
}

console.log('persona facets contract passed');
