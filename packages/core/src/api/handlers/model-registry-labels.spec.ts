import assert from 'node:assert/strict'
import test, { after, mock } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'model-labels-'))
process.env.METAHUMAN_ROOT = root
const backend = await import('../../llm-backend.js')
mock.module('../../llm-backend.js', { namedExports: { ...backend,
  getBackendStatus: async () => ({ backend: 'llama-cpp', resolvedBackend: 'llama-cpp', model: 'shared' }),
  detectAvailableBackends: async () => ({ vllm: { running: false }, ollama: { running: false }, llamaCpp: { running: false } }),
} })
const { migrateModelRegistry, parseModelRegistry } = await import('../../model-resolver.js')
const { handleGetModelRegistry } = await import('./model-registry.js')
const { setAuditEnabled } = await import('../../audit.js')
const { eventBus } = await import('../../infrastructure/event-bus/client.js')
setAuditEnabled(false)
eventBus.disconnect()
after(() => { eventBus.disconnect(); fs.rmSync(root, { recursive: true, force: true }) })
test('GET preserves distinct registered specialist descriptions on a shared llama deployment', async () => {
  const models = Object.fromEntries(['intent', 'task'].map(specialist => [specialist, {
    provider: 'llama-cpp', model: 'shared', description: `Registered ${specialist} description`,
    roles: [], adapters: [`/${specialist}.gguf`], metadata: { run: 'same-run', specialist },
    options: { endpoint: 'http://fixture:8086', lora: [{ path: `/${specialist}.gguf`, scale: 1 }] },
  }]))
  const file = path.join(root, 'profiles/fixture/etc/models.json')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const registry = migrateModelRegistry(parseModelRegistry({ version: '1.0.0', description: 'Fixture registry', defaults: {}, models })).registry
  fs.writeFileSync(file, JSON.stringify(registry))
  const response = await handleGetModelRegistry({ method: 'GET', path: '/api/model-registry',
    user: { username: 'fixture', userId: 'fixture', role: 'owner', isAuthenticated: true } })
  assert.equal(response.status, 200)
  const data = response.data as { availableModels: Array<{ id: string; description: string }> }
  for (const specialist of ['intent', 'task']) {
    assert.equal(data.availableModels.find(model => model.id === specialist)?.description, models[specialist].description)
  }
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), registry)
})
