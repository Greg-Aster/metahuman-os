import assert from 'node:assert/strict';
import test from 'node:test';

import { getDefaultPersonaCore } from '../../identity.js';
import { getNodeSchema } from '../schemas.js';
import { PersonaLoaderNode } from '../persona/persona-loader.node.js';
import { PersonaFormatterNode } from './persona-formatter.node.js';

test('Persona Formatter uses the canonical persona shape', async () => {
  const output = await PersonaFormatterNode.execute(
    { persona: getDefaultPersonaCore() },
    {},
    {},
  );

  assert.equal(output.inactive, false);
  assert.match(output.formatted, /Name: MetaHuman/);
  assert.match(output.formatted, /autonomy: Act with agency/);
  assert.match(output.formatted, /transparency: Make decisions visible/);
  assert.doesNotMatch(output.formatted, /- Value:/);
});

test('Persona Formatter distinguishes explicit inactive mode from malformed input', async () => {
  assert.deepEqual(
    await PersonaFormatterNode.execute({ persona: null }, {}, {}),
    { formatted: '', sectionCount: 0, inactive: true },
  );
  await assert.rejects(
    () => PersonaFormatterNode.execute({}, {}, {}),
    /requires the canonical persona object/,
  );
});

test('Persona Formatter preserves editable identity prose and conversational character', async () => {
  const persona = getDefaultPersonaCore();
  persona.background = 'You are Rowan, a curious companion who enjoys shared discoveries.';
  persona.personality.communicationStyle = {
    tone: ['warm', 'wry'], humor: 'quietly mischievous', verbosity: 'brief', emphasis: 'shared curiosity',
  };
  persona.personality.narrativeStyle = 'Reflective and playful';
  persona.writingStyle = { structure: 'Informal and unhurried' };
  const output = await PersonaFormatterNode.execute({ persona }, {}, {});
  assert.match(output.formatted, /You are Rowan, a curious companion/);
  assert.match(output.formatted, /warm, wry/);
  assert.match(output.formatted, /quietly mischievous/);
  assert.match(output.formatted, /Reflective and playful/);
  assert.match(output.formatted, /Informal and unhurried/);

  const identityOnly = await PersonaFormatterNode.execute({ persona }, {}, {
    includePersonality: false, includeValues: false, includeGoals: false,
  });
  assert.match(identityOnly.formatted, /You are Rowan/);
  assert.doesNotMatch(identityOnly.formatted, /quietly mischievous|Reflective and playful|Informal and unhurried/);
});

test('Persona Formatter browser schema matches the executable handle contract', () => {
  const schema = getNodeSchema('persona_formatter');
  assert.deepEqual(schema?.inputs.map(input => input.name), PersonaFormatterNode.inputs.map(input => input.name));
  assert.deepEqual(schema?.outputs.map(output => output.name), PersonaFormatterNode.outputs.map(output => output.name));
  assert.equal(schema?.category, PersonaFormatterNode.category);
});

test('Persona Loader browser schema matches the executable handle contract', () => {
  const schema = getNodeSchema('persona_loader');
  assert.deepEqual(schema?.inputs.map(input => input.name), PersonaLoaderNode.inputs.map(input => input.name));
  assert.deepEqual(schema?.outputs.map(output => output.name), PersonaLoaderNode.outputs.map(output => output.name));
  assert.equal(schema?.category, PersonaLoaderNode.category);
});

test('standing goal context retains complete recorded identity, horizon and status without changing default conversation context', async () => {
  const persona = getDefaultPersonaCore();
  persona.goals = {
    shortTerm: Array.from({ length: 13 }, (_, index) => ({ id: `proposed-${index}`, status: 'proposed', goal: `Recorded proposal ${index} suffix` })),
    midTerm: [{ id: 'planning', status: 'planning', goal: 'Recorded plan' }],
    longTerm: [{ id: 'aspiration', status: 'aspirational', goal: 'Recorded aspiration' }, { id: 'finished', status: 'completed', goal: 'Finished goal' }],
  };
  const standing = await PersonaFormatterNode.execute({ persona, sections: ['goals'] }, {}, { goalContext: 'standing' });
  assert.match(standing.formatted, /## Standing Persona Goals/);
  assert.match(standing.formatted, /Their presence does not establish an active task, new evidence, or reinforcement\./);
  for (const goal of persona.goals.shortTerm) assert.ok(standing.formatted.includes(`id=${goal.id} | tier=shortTerm | status=proposed | ${goal.goal}`));
  assert.match(standing.formatted, /id=planning \| tier=midTerm \| status=planning/);
  assert.match(standing.formatted, /id=aspiration \| tier=longTerm \| status=aspirational/);
  assert.doesNotMatch(standing.formatted, /Finished goal/);
  assert.equal((await PersonaFormatterNode.execute({ persona, sections: ['goals'] }, {}, {})).formatted, '');
  assert.equal((await PersonaFormatterNode.execute({ persona, sections: [] }, {}, { goalContext: 'standing' })).formatted, '');
  assert.equal(getNodeSchema('persona_formatter')?.properties?.goalContext, 'active');
  assert.deepEqual(getNodeSchema('persona_formatter')?.propertySchemas?.goalContext, PersonaFormatterNode.propertySchemas?.goalContext);
});
