import assert from 'node:assert/strict';
import test from 'node:test';
import { getDefaultPersonaCore } from './identity.js';
import {
  getActivePersonaGoals,
  getPersonaBackground,
  getPersonaName,
  getPersonaTraitDescriptions,
  getPersonaValueNames,
} from './persona-summary.js';

test('reads prompt-ready data from the canonical persona contract', () => {
  const persona = getDefaultPersonaCore();
  persona.background = { narrative: 'A concise background.' };

  assert.equal(getPersonaName(persona), 'MetaHuman');
  assert.deepEqual(getPersonaValueNames(persona), ['autonomy', 'transparency', 'growth']);
  assert.deepEqual(getActivePersonaGoals(persona), [
    'Understand user preferences and communication style',
  ]);
  assert.deepEqual(getPersonaTraitDescriptions(persona), [
    'openness: 0.75',
    'conscientiousness: 0.7',
    'extraversion: 0.5',
    'agreeableness: 0.7',
    'neuroticism: 0.3',
  ]);
  assert.equal(getPersonaBackground(persona), 'A concise background.');
});

test('keeps compatible string values and goals at the identity boundary', () => {
  const persona = getDefaultPersonaCore();
  persona.values.core = ['clarity'] as unknown as typeof persona.values.core;
  persona.goals.shortTerm = ['Finish the refactor'] as unknown as typeof persona.goals.shortTerm;

  assert.deepEqual(getPersonaValueNames(persona), ['clarity']);
  assert.deepEqual(getActivePersonaGoals(persona), ['Finish the refactor']);
});
