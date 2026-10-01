import assert from 'node:assert/strict'
import { after, mock, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { UnifiedRequest } from '../types.js'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-remote-chat-'))
process.env.METAHUMAN_ROOT = root
globalThis.fetch = async () => { throw new Error('Network access is forbidden in the remote chat handler fixture') }
const { eventBus } = await import('../../infrastructure/event-bus/client.js')
eventBus.disconnect()
const backend = await import('../../llm-backend.js')
let backendCalls = 0
let availableBackend: { resolvedBackend: string | null; model: string | null } = { resolvedBackend: 'ollama', model: 'server-vision' }
mock.module(new URL('../../llm-backend.ts', import.meta.url).href, { namedExports: { ...backend,
  getBackendStatus: async () => { backendCalls++; return availableBackend },
} })
const bridge = await import('../../providers/bridge.js')
const calls: any[] = []
let failure: Error | undefined
mock.module(new URL('../../providers/bridge.ts', import.meta.url).href, { namedExports: { ...bridge,
  callProvider: async (provider: string, messages: unknown[], options: any) => {
    calls.push({ provider, messages, options })
    if (failure) throw failure
    return { provider, model: options.model, content: '{"matchesTarget":true}' }
  },
} })
const { handleLlmChat } = await import('./llm-proxy.js')
after(() => fs.rmSync(root, { recursive: true, force: true }))
const messages = [{ role: 'user', content: [{ type: 'text', text: 'Identify the requested object.' },
  { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,/9j/2gAA/9k=' } }] }]
const schema = { type: 'object', required: ['matchesTarget'], properties: { matchesTarget: { type: 'boolean' } } }
const request = (body: unknown, signal?: AbortSignal): UnifiedRequest => ({ path: '/api/llm/chat', method: 'POST',
  user: { isAuthenticated: true, username: 'server-fixture', userId: 'server-fixture', role: 'owner' }, body, signal,
})

test('remote chat forwards images, structured perception schema, thinking and cancellation to the actual server provider', async () => {
  const controller = new AbortController()
  const result = await handleLlmChat(request({ model: 'explicit-server-vision', messages,
    options: { format: schema, think: false, num_ctx: 4096, num_predict: 150 } }, controller.signal))
  assert.equal(result.status, 200)
  const call = calls.at(-1)
  assert.equal(call.provider, 'ollama')
  assert.equal(call.options.model, 'explicit-server-vision')
  assert.deepEqual(call.messages, messages)
  assert.deepEqual(call.options.jsonSchema, schema)
  assert.equal(call.options.enableThinking, false)
  assert.equal(call.options.contextWindow, 4096)
  assert.equal(call.options.maxTokens, 150)
  assert.equal(call.options.signal, controller.signal)
})

test('remote chat default model selects the configured server model', async () => {
  const result = await handleLlmChat(request({ model: 'default', messages }))
  assert.equal(result.status, 200)
  assert.equal(calls.at(-1)?.options.model, 'server-vision')
})

test('remote chat exposes provider failure rather than reporting perception success', async () => {
  failure = new Error('Simulated server inference outage')
  try {
    const result = await handleLlmChat(request({ model: 'server-vision', messages }))
    assert.equal(result.status, 500)
    assert.match(result.error ?? '', /Simulated server inference outage/)
  } finally { failure = undefined }
})

test('remote chat requires login before contacting any backend', async () => {
  const before = backendCalls
  const input = request({ messages })
  const result = await handleLlmChat({ ...input, user: { ...input.user, isAuthenticated: false } })
  assert.equal(result.status, 401)
  assert.equal(backendCalls, before)
})

test('remote chat does not fabricate a provider or model when the server is unavailable', async () => {
  const before = calls.length
  const configured = availableBackend
  availableBackend = { resolvedBackend: null, model: null }
  try {
    const result = await handleLlmChat(request({ model: 'default', messages }))
    assert.equal(result.status, 503)
    assert.match(result.error ?? '', /no configured and available inference backend or model/)
    assert.equal(calls.length, before)
  } finally { availableBackend = configured }
})
