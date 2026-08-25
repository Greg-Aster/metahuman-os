import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  parseFeasibilityResponse,
  parseDesirePlannerArgs,
  parsePlannerConfig,
} from './core.js';

const ROOT = path.resolve(import.meta.dirname, '../../..');

test('tracked Desire Planner configuration satisfies the strict owner contract', () => {
  const configPath = path.join(ROOT, 'etc', 'desire-planner.json');
  const parsed = parsePlannerConfig(JSON.parse(fs.readFileSync(configPath, 'utf8')));

  assert.equal(parsed.enabled, true);
  assert.equal(parsed.graph.planner, 'desire-planner.json');

  assert.throws(
    () => parsePlannerConfig({ ...parsed, graph: { ...parsed.graph, planner: '../escape.json' } }),
    /local planner and reviewer JSON filenames/,
  );
  assert.throws(
    () => parsePlannerConfig({ ...parsed, processing: { ...parsed.processing, batchSize: 0 } }),
    /processing configuration is invalid/,
  );
  assert.throws(
    () => parsePlannerConfig({ ...parsed, enabled: 'yes' }),
    /requires boolean enabled/,
  );
});

test('planner accepts only an explicit profile selector', () => {
  assert.deepEqual(parseDesirePlannerArgs(['--username', 'profile-a']), { username: 'profile-a' });
  assert.throws(() => parseDesirePlannerArgs(['--single-user']), /accepts only/);
  assert.throws(() => parseDesirePlannerArgs(['--username']), /accepts only/);
});

test('planner consumes canonical capabilities and stable graph node contracts', () => {
  const source = fs.readFileSync(path.join(ROOT, 'brain/agents/desire-planner/core.ts'), 'utf8');
  assert.match(source, /getCachedCatalog\(\)/);
  assert.match(source, /requireGraphNodeOutput\(planResult, 'desire_plan_generator'\)/);
  assert.match(source, /requireGraphNodeOutput\(reviewResult, 'desire_verdict'\)/);
  assert.doesNotMatch(source, /Full computer access/);
  assert.doesNotMatch(source, /planResult\.nodes\.get\('5'\)/);
  assert.doesNotMatch(source, /reviewResult\.nodes\.get\('7'\)/);
  assert.doesNotMatch(source, /username: 'default'/);
});

test('feasibility parser fails closed on missing or malformed model decisions', () => {
  const accepted = parseFeasibilityResponse(`Assessment:
{
  "feasible": false,
  "confidence": 0.92,
  "reasoning": "Required authorization is unavailable.",
  "blockers": ["Missing authorization"]
}`);
  assert.equal(accepted.feasible, false);
  assert.equal(accepted.confidence, 0.92);
  assert.deepEqual(accepted.blockers, ['Missing authorization']);

  assert.throws(
    () => parseFeasibilityResponse('No structured assessment was returned.'),
    /did not contain a JSON object/,
  );
  assert.throws(
    () => parseFeasibilityResponse('{"confidence":0.5,"reasoning":"Unknown"}'),
    /missing required typed fields/,
  );
  assert.throws(
    () => parseFeasibilityResponse('{"feasible":true,"confidence":1.2,"reasoning":"Certain"}'),
    /missing required typed fields/,
  );
});
