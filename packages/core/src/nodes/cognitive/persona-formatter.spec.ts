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
