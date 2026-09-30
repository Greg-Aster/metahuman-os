import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { after, test } from 'node:test'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-candidate-review-'))
process.env.METAHUMAN_ROOT = root
const adapters = await import('./adapters.js')
const { OllamaClient } = await import('./ollama.js')
const { VLLMClient } = await import('./vllm.js')
const { eventBus } = await import('./infrastructure/event-bus/client.js')
eventBus.disconnect()
const { setAuditEnabled } = await import('./audit.js')
setAuditEnabled(false)
const { handleAssignModelRole } = await import('./api/handlers/model-registry.js')
const { withUserContext } = await import('./context.js')
const { getProfilePaths } = await import('./path-builder.js')
const { migrateModelRegistry } = await import('./model-resolver.js')
after(() => { eventBus.disconnect(); fs.rmSync(root, { recursive: true, force: true }) })

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
function fixture(username: string, target: 'ollama' | 'vllm' = 'ollama', method = 'local-lora') {
  const runLabel = '2026-09-09T01-02-03-000Z'
  const directory = path.join(getProfilePaths(username).out, 'adapters', runLabel.slice(0, 10), runLabel)
  const artifact = path.join(directory, method === 'fine-tune' ? 'model' : 'adapter')
  fs.mkdirSync(artifact, { recursive: true })
  const config = JSON.stringify({ trainingTarget: target })
  const manifest = { version: 2, baseModel: 'fixture/base', systemPrompt: 'Fixture persona', evaluation: { sha256: hash('evaluation') } }
  const datasetId = hash(JSON.stringify(manifest))
  const inventory: Record<string, string> = {}
  for (const [file, data] of Object.entries({ 'adapter_model.safetensors': 'weights', 'tokenizer_config.json': '{}' })) {
    fs.writeFileSync(path.join(artifact, file), data)
    inventory[file] = hash(data)
  }
  const evaluation = JSON.stringify({ version: 1, loss: 1, count: 3, evaluationSha256: manifest.evaluation.sha256, artifacts: { ...inventory } })
  fs.writeFileSync(path.join(artifact, 'artifact-evaluation.json'), evaluation)
  inventory['artifact-evaluation.json'] = hash(evaluation)
  fs.writeFileSync(path.join(artifact, 'model.gguf'), 'GGUFfixture')
  inventory['model.gguf'] = hash('GGUFfixture')
  const result = { version: 1, status: 'candidate', datasetId, baseModel: manifest.baseModel, configSha256: hash(config),
    templateSha256: hash('fixture template'), trainingMode: method === 'fine-tune' ? 'full_finetune' : 'lora',
    trainingSamples: 30, evaluationSamples: 3, supervisedTokens: 100, baselineLoss: 2, candidateLoss: 1, qualityGate: 'passed',
    evaluationPolicy: 'independent', supervision: 'final-assistant-only', activation: 'not-activated', servingValidation: 'required', artifacts: inventory }
  fs.writeFileSync(path.join(artifact, 'training-result.json'), JSON.stringify(result))
  fs.writeFileSync(path.join(directory, 'config.json'), config)
  fs.writeFileSync(path.join(directory, 'dataset-manifest.json'), JSON.stringify({ ...manifest, datasetId }))
  fs.writeFileSync(path.join(directory, 'run.json'), JSON.stringify({ username, runLabel, method, trainingTarget: target,
    baseModel: manifest.baseModel, status: 'candidate', datasetId }))
  return { username, runLabel, directory, artifact, result, model: adapters.trainingCandidateModelName(username, runLabel, target) }
}

test('actual review and role assignment require verified files, serving identity and an explicit decision', async t => {
  const run = fixture('review-owner')
  let template = 'fixture template'
  t.mock.method(OllamaClient.prototype, 'showModel', async (model: string) => ({
    template, modelfile: model === run.model ? 'FROM sha256-' + run.result.artifacts['model.gguf'] : 'FROM baseline',
  }))
  t.mock.method(OllamaClient.prototype, 'chat', async (model: string, messages: any[]) => ({
    model, message: { role: 'assistant', content: model + ': ' + messages.at(-1).content },
  }))
  const modelId = 'ollama.' + run.model
  const etc = getProfilePaths(run.username).etc
  fs.mkdirSync(etc, { recursive: true })
  const registry = { version: '1.0.0', description: 'Synthetic fixture registry', models: {
    base: { provider: 'ollama', description: 'Baseline fixture', model: 'baseline:latest', roles: ['persona'], capabilities: ['text'], adapters: [], options: {} },
    controller: { provider: 'ollama', description: 'Controller fixture', model: 'controller:latest', roles: ['orchestrator'], capabilities: ['text'], adapters: [], options: {} },
  }, defaults: { persona: 'base', orchestrator: 'controller' } }
  const registryFile = path.join(etc, 'models.json')
  fs.writeFileSync(registryFile, JSON.stringify(migrateModelRegistry(registry as any).registry))
  const assign = (selected: string) => withUserContext({ username: run.username, userId: run.username, role: 'owner' },
    () => handleAssignModelRole({ user: { username: run.username, userId: run.username, role: 'owner', isAuthenticated: true },
      body: { role: 'persona', modelId: selected } } as any))
  const before = fs.readFileSync(registryFile, 'utf8')
  const denied = await assign(modelId)
  assert.notEqual(denied.status, 200)
  assert.match(denied.error!, /Review and accept/)
  assert.equal(fs.readFileSync(registryFile, 'utf8'), before)
  await assert.rejects(adapters.prepareTrainingCandidate(run.username, '../../escape'), /Invalid training run/)
  const review = await adapters.testTrainingCandidate(run.username, run.runLabel, { baselineProvider: 'ollama', baselineModel: 'baseline:latest', prompts: ['Normal task', 'Correct a mistake', 'Edge case'] })
  assert.equal(review.cases.length, 3)
  assert.ok(review.cases.every(item => item.candidate.includes(item.prompt) && item.baseline.includes(item.prompt)))
  await assert.rejects(adapters.decideTrainingCandidate(run.username, run.runLabel, { reviewId: review.id, decision: 'accepted', notes: 'checked', checks: [true] }), /every candidate response/)
  template = 'changed template'
  await assert.rejects(adapters.decideTrainingCandidate(run.username, run.runLabel, { reviewId: review.id, decision: 'accepted', notes: 'checked', checks: [true, true, true] }), /identity changed/)
  template = 'fixture template'
  await adapters.decideTrainingCandidate(run.username, run.runLabel, { reviewId: review.id, decision: 'accepted', notes: 'Synthetic review meets fixture criteria.', checks: [true, true, true] })
  assert.equal((await assign(modelId)).status, 200)
  const assigned = JSON.parse(fs.readFileSync(registryFile, 'utf8'))
  assert.equal(assigned.defaults.persona, modelId)
  assert.equal(assigned.defaults.orchestrator, 'controller')
  assert.equal(adapters.getActiveAdapter(run.username)?.runLabel, run.runLabel)
  const { handleGetModelInfo } = await import('./api/handlers/model-info.js')
  const info = await handleGetModelInfo({ user: { username: run.username, isAuthenticated: true } } as any)
  assert.equal(info.data?.activeModel, run.model)
  assert.equal(info.data?.adapter.runLabel, run.runLabel)
  assert.equal((await assign('base')).status, 200)
  assert.equal(adapters.getActiveAdapter(run.username), null)
  const reopened = await adapters.reopenTrainingCandidateReview(run.username, run.runLabel)
  assert.ok(reopened.reopenedAt)
  await assert.rejects(adapters.assertTrainingModelApproved(run.username, 'ollama', run.model), /Review and accept/)
  await assert.rejects(adapters.decideTrainingCandidate(run.username, run.runLabel, { reviewId: reopened.id, decision: 'accepted', notes: 'Reuse old review', checks: [true, true, true] }), /fresh comparison/)
  const fresh = await adapters.testTrainingCandidate(run.username, run.runLabel, { baselineProvider: 'ollama', baselineModel: 'baseline:latest', prompts: ['Normal task', 'Correct a mistake', 'Edge case'] })
  assert.equal(fresh.reopenedAt, undefined)
  await adapters.decideTrainingCandidate(run.username, run.runLabel, { reviewId: fresh.id, decision: 'accepted', notes: 'Fresh serving identity checked', checks: [true, true, true] })
  assert.equal((await adapters.assertTrainingModelApproved(run.username, 'ollama', run.model))?.runLabel, run.runLabel)
  fs.writeFileSync(registryFile, '{broken')
  const unreadable = await assign('base')
  assert.notEqual(unreadable.status, 200)
  assert.match(unreadable.error!, /existing assignments were preserved/)
  assert.equal(fs.readFileSync(registryFile, 'utf8'), '{broken')
  fs.writeFileSync(path.join(run.artifact, 'adapter_model.safetensors'), 'tampered')
  await assert.rejects(adapters.assertTrainingModelApproved(run.username, 'ollama', run.model), /checksum mismatch/)
  await assert.rejects(adapters.assertTrainingModelApproved('other-owner', 'ollama', run.model), /no review owned/)
})

test('vLLM preparation loads the exact adapter and full candidates can compare with an Ollama baseline', async t => {
  const run = fixture('vllm-owner', 'vllm')
  const cards = [{ id: 'fixture/base', root: 'fixture/base', parent: null as string | null }]
  t.mock.method(VLLMClient.prototype, 'listModels', async () => cards)
  t.mock.method(VLLMClient.prototype, 'tokenizerInfo', async () => ({ chat_template: 'fixture template' }))
  t.mock.method(VLLMClient.prototype, 'loadLoraAdapter', async (name: string, directory: string, base: string) => {
    assert.deepEqual([name, directory, base], [run.model, run.artifact, 'fixture/base'])
    cards.push({ id: name, root: directory, parent: base })
  })
  assert.deepEqual(await adapters.prepareTrainingCandidate(run.username, run.runLabel), { model: run.model })
  const full = fixture('full-owner', 'vllm', 'fine-tune')
  cards.push({ id: 'full-candidate', root: full.artifact, parent: null })
  t.mock.method(VLLMClient.prototype, 'chat', async (_messages: any[], options: any) => ({ model: options.model, content: 'Candidate answer' }))
  t.mock.method(OllamaClient.prototype, 'showModel', async () => ({ template: 'baseline template' }))
  t.mock.method(OllamaClient.prototype, 'chat', async () => ({ message: { content: 'Baseline answer' } }))
  const review = await adapters.testTrainingCandidate(full.username, full.runLabel, { baselineProvider: 'ollama', baselineModel: 'baseline:latest', prompts: ['One', 'Two', 'Three'] })
  assert.equal(review.model, 'full-candidate')
  assert.equal(review.baselineProvider, 'ollama')
  await adapters.decideTrainingCandidate(full.username, full.runLabel, { reviewId: review.id, decision: 'rejected', notes: 'Does not meet fixture criteria', checks: [] })
  await assert.rejects(adapters.assertTrainingModelApproved(full.username, 'vllm', 'full-candidate'), /Review and accept/)
})

test('canonical provider dispatch selects the approved LoRA and blocks unreviewed backend aliases', async t => {
  const run = fixture('dispatch-owner', 'vllm')
  const cards = [{ id: 'fixture/base', root: 'fixture/base', parent: null }, { id: run.model, root: run.artifact, parent: 'fixture/base' }]
  const { vllm } = await import('./vllm.js')
  const { loadBackendConfig } = await import('./llm-backend.js')
  const { callProvider } = await import('./providers/bridge.js')
  fs.mkdirSync(path.join(root, 'etc'), { recursive: true })
  const configFile = path.join(root, 'etc', 'llm-backend.json')
  const configure = (model: string) => {
    fs.writeFileSync(configFile, JSON.stringify({ activeBackend: 'vllm', vllm: { endpoint: 'http://fixture.invalid', model, servedModelName: model } }))
    loadBackendConfig(true)
  }
  configure('fixture/base')
  t.mock.method(VLLMClient.prototype, 'listModels', async () => cards)
  t.mock.method(VLLMClient.prototype, 'tokenizerInfo', async () => ({ chat_template: 'fixture template' }))
  t.mock.method(VLLMClient.prototype, 'isRunning', async () => true)
  t.mock.method(VLLMClient.prototype, 'getLoadedModel', async () => 'fixture/base')
  const sent: string[] = []
  t.mock.method(VLLMClient.prototype, 'chat', async (_messages: any[], options: any) => {
    sent.push(options.model)
    return { model: options.model, content: 'Fixture response' }
  })
  const context = { username: run.username, userId: run.username, role: 'owner' as const }
  fs.mkdirSync(getProfilePaths(run.username).etc, { recursive: true })
  fs.writeFileSync(path.join(getProfilePaths(run.username).etc, 'operator.json'), JSON.stringify({ bigBrotherMode: { enabled: false, delegateAll: false } }))
  const call = (provider: 'vllm' | 'ollama', model: string) => withUserContext(context,
    () => callProvider(provider, [{ role: 'user', content: 'Fixture prompt' }], { model }))
  await assert.rejects(call('vllm', run.model), /Review and accept/)
  assert.deepEqual(sent, [])
  const review = await adapters.testTrainingCandidate(run.username, run.runLabel, { baselineProvider: 'vllm', baselineModel: 'fixture/base', prompts: ['One', 'Two', 'Three'] })
  await adapters.decideTrainingCandidate(run.username, run.runLabel, { reviewId: review.id, decision: 'accepted', notes: 'Fixture criteria passed', checks: [true, true, true] })
  sent.length = 0
  assert.equal((await call('vllm', run.model)).model, run.model)
  assert.equal((await call('ollama', 'ordinary:latest')).model, 'fixture/base')
  assert.deepEqual(sent, [run.model, 'fixture/base'])
  await adapters.reopenTrainingCandidateReview(run.username, run.runLabel)
  cards.push({ id: 'backend-alias', root: run.artifact, parent: 'fixture/base' })
  configure('backend-alias')
  await assert.rejects(call('ollama', 'ordinary:latest'), /Review and accept/)
  await assert.rejects(callProvider('vllm', [{ role: 'user', content: 'No profile' }], { model: 'backend-alias' }), /no review owned/)
  assert.deepEqual(sent, [run.model, 'fixture/base'])
  assert.ok(vllm)
})

test('legacy adapter toggles cannot bypass role selection and persona controls share one profile owner', async () => {
  const username = 'settings-owner'
  const { loadBackendConfig } = await import('./llm-backend.js')
  fs.writeFileSync(path.join(root, 'etc', 'llm-backend.json'), JSON.stringify({ activeBackend: 'ollama' }))
  loadBackendConfig(true)
  const paths = getProfilePaths(username)
  fs.mkdirSync(paths.etc, { recursive: true })
  const file = path.join(paths.etc, 'models.json')
  const registry = { version: '1.0.0', description: 'Fixture settings', globalSettings: { includePersonaSummary: true, useAdapter: true, activeAdapter: 'unreviewed-old-model' },
    defaults: { persona: 'base' }, models: { base: { provider: 'ollama', model: 'baseline:latest', roles: ['persona'], capabilities: ['text'], adapters: [], options: {} } } }
  fs.writeFileSync(file, JSON.stringify(migrateModelRegistry(registry as any).registry))
  const { ModelResolverNode } = await import('./nodes/llm/model-resolver.node.js')
  const { handleGetAgentConfig, handleSetAgentConfig } = await import('./api/handlers/agent-config.js')
  const { handleSetPersonaToggle, handleGetPersonaToggle } = await import('./api/handlers/persona-toggle.js')
  const { handleUpdateModelSettings } = await import('./api/handlers/model-registry.js')
  const user = { username, userId: username, role: 'owner', isAuthenticated: true }
  const persona = path.join(root, 'profiles', username, 'persona')
  fs.mkdirSync(persona, { recursive: true })
  fs.writeFileSync(path.join(persona, 'core.json'), '{}')
  const { createDefaultPersonaFacetConfig } = await import('./persona-facets.js')
  fs.writeFileSync(path.join(persona, 'facets.json'), JSON.stringify({ ...createDefaultPersonaFacetConfig(), activeFacet: 'inactive' }))
  const resolved = await withUserContext({ username, userId: username, role: 'owner' }, () => ModelResolverNode.execute({ role: 'persona' }, { username } as any, {}))
  assert.equal(resolved.model, 'baseline:latest')
  assert.equal(resolved.modelId, 'base')
  assert.equal(resolved.usingLora, false)
  const initial = fs.readFileSync(file, 'utf8')
  assert.equal((await handleSetAgentConfig({ user, body: { useAdapter: true } } as any)).status, 400)
  assert.equal(fs.readFileSync(file, 'utf8'), initial)
  assert.equal((await handleSetPersonaToggle({ user, body: { enabled: false } } as any)).status, 200)
  assert.equal((await handleGetAgentConfig({ user } as any)).data?.config.includePersonaSummary, false)
  assert.equal((await handleUpdateModelSettings({ user, body: { globalSettings: { includePersonaSummary: true } } } as any)).status, 200)
  assert.equal((await handleGetPersonaToggle({ user } as any)).data?.includePersonaSummary, true)
  const final = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.deepEqual(final.globalSettings, { includePersonaSummary: true })
  assert.deepEqual(final.defaults, JSON.parse(initial).defaults)
  assert.equal((await handleGetPersonaToggle({ user: { isAuthenticated: false } } as any)).status, 401)
})
