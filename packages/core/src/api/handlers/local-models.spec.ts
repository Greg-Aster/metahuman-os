import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, afterEach, test } from 'node:test'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-local-model-status-'))
process.env.METAHUMAN_ROOT = root
const { setAuditEnabled } = await import('../../audit.js')
setAuditEnabled(false)
const { eventBus } = await import('../../infrastructure/event-bus/client.js')
const { handleGetLocalModelsStatus, handleGetLocalModelsAvailable } = await import('./local-models.js')
const originalFetch = globalThis.fetch
eventBus.disconnect()
afterEach(() => { globalThis.fetch = originalFetch })
after(() => { eventBus.disconnect(); fs.rmSync(root, { recursive: true, force: true }) })

test('settings status retains the loadedModels envelope and service-owned inventory metadata', async () => {
  const loadedModels = { embedder: { model: 'synthetic-embedding', loaded: true, dimensions: 8 }, generator: { model: null, loaded: false } }
  const embeddings = [{ id: 'synthetic-embedding', config: { size: '1MB', dimensions: 8 }, downloaded: true }]
  globalThis.fetch = async url => {
    const route = new URL(String(url)).pathname
    if (route === '/health') return Response.json({ status: 'ok' })
    if (route === '/models/loaded') return Response.json(loadedModels)
    if (route === '/models') return Response.json({ embeddings, llm: [] })
    throw new Error(`Unexpected route: ${route}`)
  }
  const status = await handleGetLocalModelsStatus({} as any)
  assert.equal(status.status, 200)
  assert.deepEqual((status.data as any).loadedModels, loadedModels)
  const models = await handleGetLocalModelsAvailable({} as any)
  assert.deepEqual((models.data as any).embeddings, embeddings)
})

test('offline or unreadable inventory is an explicit error, never a fabricated model list', async () => {
  globalThis.fetch = async () => { throw new Error('Offline') }
  assert.equal((await handleGetLocalModelsAvailable({} as any)).status, 503)
  const status = await handleGetLocalModelsStatus({} as any)
  assert.equal((status.data as any).running, false)
  assert.equal((status.data as any).loadedModels, null)
  globalThis.fetch = async url => String(url).endsWith('/health')
    ? Response.json({ status: 'ok' }) : new Response('Unavailable', { status: 500 })
  assert.equal((await handleGetLocalModelsAvailable({} as any)).status, 502)
})
