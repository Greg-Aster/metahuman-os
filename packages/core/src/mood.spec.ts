import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getProfilePaths } from './path-builder.js';
import { loadPersonaFacetConfig, PersonaFacetConfigurationError } from './persona-facets.js';
import { MoodClassifierNode } from './nodes/persona/mood-classifier.node.js';

const username = `_mood-spec-${process.pid}-${Date.now()}`;
const profileRoot = getProfilePaths(username).root;

try {
  const facetsPath = path.join(profileRoot, 'persona', 'facets.json');
  fs.mkdirSync(path.dirname(facetsPath), { recursive: true });
  fs.writeFileSync(facetsPath, '', 'utf8');

  assert.throws(
    () => loadPersonaFacetConfig(username),
    (error: unknown) => error instanceof PersonaFacetConfigurationError && error.code === 'empty',
  );

  const result = await MoodClassifierNode.execute({
    reviewContext: {
      activeFacet: 'friend',
      candidates: [
        { id: 'default', name: 'Default' },
        { id: 'friend', name: 'Friend' },
      ],
      buffers: [],
      eligible: true,
      forceBaseline: true,
      settings: { baselineFacet: 'default' },
    },
  }, { username } as any, {});

  assert.equal(result.selectedFacet, 'default');
  assert.equal(result.confidence, 1);
  assert.equal((result.decision as Record<string, unknown>).forcedBaseline, true);
} finally {
  fs.rmSync(profileRoot, { recursive: true, force: true });
}

console.log('mood contract passed');
