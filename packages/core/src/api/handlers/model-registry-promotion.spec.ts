import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-promotion-'));
process.env.METAHUMAN_ROOT = root;
const { migrateModelRegistry, parseModelRegistry } = await import('../../model-resolver.js');
const { promoteEnvironmentSpecialist } = await import('./model-registry.js');
const { setAuditEnabled } = await import('../../audit.js');
const { eventBus } = await import('../../infrastructure/event-bus/client.js');
setAuditEnabled(false);
eventBus.disconnect();

test('promotion records the new artifact identity and preserves the previous deployment', async (t) => {
  t.after(() => { eventBus.disconnect(); fs.rmSync(root, { recursive: true, force: true }); });
  let loadedAdapters: Array<{ id: number; path: string; scale: number }> = [];
  const server = createServer((_request, response) => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(loadedAdapters)); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const endpoint = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
  const registryPath = path.join(root, 'profiles/fixture/etc/models.json');
  fs.mkdirSync(path.dirname(registryPath), { recursive: true });
  const before = migrateModelRegistry(parseModelRegistry({
    version: '1.0.0', description: 'Promotion fixture', defaults: { environmentActionSelector: 'task' },
    models: { task: { provider: 'llama-cpp', model: 'shared', baseModel: 'unsloth/Qwen3.5-2B', adapters: ['/old.gguf'],
      roles: ['environmentActionSelector'], options: { endpoint, lora: [{ path: '/old.gguf', scale: 1 }] },
      metadata: { artifactSha256: 'previous-hash', baseArtifactSha256: 'unchanged-base',
        trainingProvenance: '/old/run-provenance.json', qualificationStatus: 'previous comparison pending' } } },
    cognitiveModeMappings: { environment: { environmentActionSelector: 'task' } },
  })).registry;
  fs.writeFileSync(registryPath, JSON.stringify(before));
  const artifactPath = path.join(root, 'candidate.gguf');
  fs.writeFileSync(artifactPath, 'candidate artifact fixture');
  const report = { owner: 'environment-action-selector', specialist: 'task', split: 'evaluation',
    coverage: { expected: 2, recordsDigest: 'same-cases' }, providers: ['llama-cpp'], devices: ['fixture'], batchSizes: [1],
    aggregate: { total: 2, coreValid: { count: 2 }, acceptableRouting: { count: 1 },
      missedPhysicalActions: 0, unsafeActionAuthorityErrors: 0, wrongPhysicalActions: 0,
      falseCompletions: 0, p95LatencyMs: 100 } };
  const currentReport = path.join(root, 'current.json');
  const evaluationReport = path.join(root, 'candidate.json');
  fs.writeFileSync(currentReport, JSON.stringify(report));
  fs.writeFileSync(evaluationReport, JSON.stringify({ ...report,
    aggregate: { ...report.aggregate, acceptableRouting: { count: 2 } } }));
  loadedAdapters = [{ id: 1, path: artifactPath, scale: 0 }];
  const id = await promoteEnvironmentSpecialist({ username: 'fixture', specialist: 'task',
    previousModelId: 'task', artifactPath, run: 'candidate', currentReport, evaluationReport });
  const after = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  assert.equal(after.models[id].metadata.artifactSha256, createHash('sha256').update(fs.readFileSync(artifactPath)).digest('hex'));
  assert.equal(after.models[id].metadata.baseArtifactSha256, 'unchanged-base');
  assert.equal(after.models[id].baseModel, 'unsloth/Qwen3.5-2B');
  assert.equal(after.models[id].metadata.trainingProvenance, undefined);
  assert.equal(after.models[id].metadata.qualificationStatus, undefined);
  assert.deepEqual(after.models.task, before.models.task);
  assert.equal(after.cognitiveModeMappings.environment.environmentActionSelector, id);
  assert.deepEqual(after.models[id].options.lora, [{ path: artifactPath, scale: 1 }]);

  // Intent activation uses the same canonical routing role after migration.
  const intentRegistry = structuredClone(before);
  intentRegistry.cognitiveModeMappings!.environment!.orchestrator = 'task';
  fs.writeFileSync(registryPath, JSON.stringify(intentRegistry));
  fs.writeFileSync(currentReport, JSON.stringify({ ...report, specialist: 'intent' }));
  fs.writeFileSync(evaluationReport, JSON.stringify({ ...report, specialist: 'intent',
    aggregate: { ...report.aggregate, acceptableRouting: { count: 2 } } }));
  const intentId = await promoteEnvironmentSpecialist({ username: 'fixture', specialist: 'intent',
    previousModelId: 'task', artifactPath, run: 'intent-candidate', currentReport, evaluationReport });
  const intentActivated = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  assert.equal(intentActivated.cognitiveModeMappings.environment.orchestrator, intentId);
  assert.equal(intentActivated.cognitiveModeMappings.environment.environmentActionSelector, 'task');
  assert.deepEqual(intentActivated.models[intentId].roles, ['orchestrator']);
  assert.equal(intentActivated.cognitiveModeMappings.environment.environmentIntent, undefined);
  fs.writeFileSync(currentReport, JSON.stringify(report));

  // Explicit owner deployment retains the failed automatic decision rather than altering evidence.
  fs.writeFileSync(registryPath, JSON.stringify(before));
  const regressed = { ...report, aggregate: { ...report.aggregate,
    acceptableRouting: { count: 2 }, missedPhysicalActions: 1 } };
  fs.writeFileSync(evaluationReport, JSON.stringify(regressed));
  const input = { username: 'fixture', specialist: 'task' as const, previousModelId: 'task',
    artifactPath, run: 'candidate', currentReport, evaluationReport };
  await assert.rejects(promoteEnvironmentSpecialist(input), /does not beat/);
  await assert.rejects(promoteEnvironmentSpecialist({ ...input, ownerApproval: { reason: ' ' } }), /does not beat/);
  assert.deepEqual(JSON.parse(fs.readFileSync(registryPath, 'utf8')), before);
  const ownerApproval = { reason: 'Owner reviewed and accepted the measured regressions.' };
  const approvedId = await promoteEnvironmentSpecialist({ ...input, ownerApproval });
  const approved = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  assert.deepEqual(approved.models[approvedId].metadata.promotionDecision.ownerApproval, ownerApproval);
  assert.equal(approved.models[approvedId].metadata.promotionDecision.comparison.promote, false);
  assert.deepEqual(approved.models.task, before.models.task);

  fs.writeFileSync(registryPath, JSON.stringify(before));
  fs.writeFileSync(evaluationReport, JSON.stringify({ ...regressed, coverage: { expected: 2, recordsDigest: 'different' } }));
  await assert.rejects(promoteEnvironmentSpecialist({ ...input, ownerApproval }), /not comparable/);
  fs.writeFileSync(evaluationReport, JSON.stringify(regressed));
  loadedAdapters = [];
  await assert.rejects(promoteEnvironmentSpecialist({ ...input, ownerApproval }), /not loaded/);
  assert.deepEqual(JSON.parse(fs.readFileSync(registryPath, 'utf8')), before);
});
