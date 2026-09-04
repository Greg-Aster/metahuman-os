import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setAuditEnabled } from './audit.js';
import { invalidateModelCache } from './model-resolver.js';
import { isPersonaSummaryGloballyEnabled, loadMoodState } from './mood-settings.js';
import { getProfilePaths, systemPaths } from './path-builder.js';
import { loadPersonaFacetConfig, PersonaFacetConfigurationError } from './persona-facets.js';
import { MoodClassifierNode } from './nodes/persona/mood-classifier.node.js';
import { MoodContextLoaderNode } from './nodes/persona/mood-context-loader.node.js';
import { MoodPersonaSwitchNode } from './nodes/persona/mood-persona-switch.node.js';

const username = `_mood-spec-${process.pid}-${Date.now()}`;
const paths = getProfilePaths(username);
const profileRoot = paths.root;

setAuditEnabled(false);
try {
  const profileModels = JSON.parse(fs.readFileSync(path.join(systemPaths.etc, 'models.json'), 'utf8'));
  const rootPersonaSummaryEnabled = typeof profileModels.globalSettings?.includePersonaSummary === 'boolean'
    ? profileModels.globalSettings.includePersonaSummary
    : true;
  const profilePersonaSummaryEnabled = !rootPersonaSummaryEnabled;
  profileModels.globalSettings = {
    ...profileModels.globalSettings,
    includePersonaSummary: profilePersonaSummaryEnabled,
  };
  fs.mkdirSync(paths.etc, { recursive: true });
  fs.writeFileSync(path.join(paths.etc, 'models.json'), `${JSON.stringify(profileModels, null, 2)}\n`, 'utf8');
  invalidateModelCache();
  assert.equal(
    isPersonaSummaryGloballyEnabled(username),
    profilePersonaSummaryEnabled,
    'Mood must read the target profile model registry instead of the root template',
  );

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

  fs.writeFileSync(paths.personaCore, '{"identity":{"name":"Default"}}\n', 'utf8');
  fs.writeFileSync(path.join(paths.persona, 'friend.json'), '{"identity":{"name":"Friend"}}\n', 'utf8');
  fs.writeFileSync(facetsPath, `${JSON.stringify({
    version: '1.0.0',
    lastUpdated: new Date().toISOString(),
    activeFacet: 'default',
    facets: {
      default: { name: 'Default', enabled: true, personaFile: 'core.json' },
      friend: { name: 'Friend', enabled: true, personaFile: 'friend.json' },
      inactive: { name: 'Persona Off', enabled: true, personaFile: null },
    },
  }, null, 2)}\n`, 'utf8');

  const reviewContext = {
    activeFacet: 'default',
    eligible: true,
    candidates: [{ id: 'default' }, { id: 'friend' }],
    forceBaseline: false,
    settings: { minimumConfidence: 0.6 },
  };
  const switched = await MoodPersonaSwitchNode.execute({
    decision: {
      selectedFacet: 'friend',
      detectedMood: 'social',
      confidence: 0.9,
      reason: 'Conversation is social.',
    },
    reviewContext,
  }, { username } as any, {});
  assert.equal(switched.changed, true);
  assert.equal(loadPersonaFacetConfig(username).activeFacet, 'friend');

  const repeated = await MoodPersonaSwitchNode.execute({
    decision: {
      selectedFacet: 'friend',
      detectedMood: 'social',
      confidence: 0.9,
      reason: 'Conversation remains social.',
    },
    reviewContext: { ...reviewContext, activeFacet: 'friend' },
  }, { username } as any, {});
  assert.equal(repeated.changed, false);

  fs.writeFileSync(path.join(paths.persona, 'friend.json'), '{invalid', 'utf8');
  await assert.rejects(
    MoodContextLoaderNode.execute({}, { username } as any, {}),
    /JSON|Expected property name|Unexpected token/,
  );

  fs.mkdirSync(paths.state, { recursive: true });
  fs.writeFileSync(path.join(paths.state, 'mood-state.json'), '{invalid', 'utf8');
  assert.throws(() => loadMoodState(username), /JSON|Expected property name|Unexpected token/);
} finally {
  invalidateModelCache();
  setAuditEnabled(true);
  fs.rmSync(profileRoot, { recursive: true, force: true });
}

console.log('mood contract passed');
