import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, afterEach, test } from 'node:test'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-llama-cpp-'))
process.env.METAHUMAN_ROOT = root
fs.mkdirSync(path.join(root, 'etc'), { recursive: true })
const { setAuditEnabled } = await import('./audit.js')
setAuditEnabled(false)
const { eventBus } = await import('./infrastructure/event-bus/client.js')
const { callLlamaCpp, getLlamaCppStatus, DEFAULT_LLAMA_CPP_CONFIG } = await import('./providers/llama-cpp.js')
const { saveBackendConfig, loadBackendConfig, getBackendStatus, ensureBackendRunning } = await import('./llm-backend.js')
const { resolveModel, resolveModelById, resolveModelForCognitiveMode } = await import('./model-resolver.js')
const { getProfilePaths } = await import('./path-builder.js')
const { callProvider } = await import('./providers/bridge.js')
const { handleGetModelRegistry, handleAssignModelRole } = await import('./api/handlers/model-registry.js')
const { handleSetLlmBackendConfig } = await import('./api/handlers/llm-backend-config.js')
eventBus.disconnect()
const fetchOriginal = globalThis.fetch
afterEach(() => { globalThis.fetch = fetchOriginal })
after(() => { eventBus.disconnect(); fs.rmSync(root, { recursive: true, force: true }) })

const config = { ...DEFAULT_LLAMA_CPP_CONFIG, model: 'fixture-model', capabilities: ['text', 'image'] as Array<'text' | 'image'> }
const messages = [{ role: 'user' as const, content: 'Synthetic greeting' }]
const imageMessages = [{ role: 'user' as const, content: [
  { type: 'text' as const, text: 'Describe this synthetic image' },
  { type: 'image_url' as const, image_url: { url: 'data:image/png;base64,AAAA' } },
] }]
const success = { model: config.model, choices: [{ message: { content: 'OK', reasoning_content: 'Reason' }, finish_reason: 'stop' }], usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 } }
const requests: { url: string; body?: any }[] = []
function healthyFetch() {
  requests.length = 0
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (String(url).endsWith('/lora-adapters')) return Response.json([])
    if (String(url).endsWith('/health')) return Response.json({ status: 'ok' })
    if (String(url).endsWith('/v1/models')) return Response.json({ data: [{ id: config.model }] })
    if (String(url).endsWith('/v1/chat/completions')) return Response.json(success)
    throw new Error(`Unexpected transport: ${String(url)}`)
  }
}

test('preserves text/image messages, structured output, options and token usage', async () => {
  healthyFetch()
  const schema = { type: 'object', properties: { answer: { type: 'string' } } }
  const result = await callLlamaCpp(config, imageMessages, { maxTokens: 32, temperature: 0, jsonSchema: schema })
  assert.equal(result.provider, 'llama-cpp')
  assert.equal(result.content, 'OK')
  assert.equal(result.thinking, 'Reason')
  assert.deepEqual(result.usage, { promptTokens: 4, completionTokens: 2, totalTokens: 6 })
  assert.deepEqual(requests[0].body.messages, imageMessages)
  assert.deepEqual(requests[0].body.response_format.json_schema.schema, schema)
  assert.equal(requests[0].body.temperature, 0)
  assert.equal(requests[0].body.max_tokens, 32)
  assert.equal(requests[0].body.chat_template_kwargs.enable_thinking, false)
  await callLlamaCpp(config, messages, { format: 'json' })
  assert.deepEqual(requests[1].body.response_format, { type: 'json_object' })
})

test('per-model JSON-object mode overrides native schema constraint without changing other models', async () => {
  healthyFetch()
  const schema = { type: 'object', properties: { needsAction: { type: 'boolean' } } }
  await callLlamaCpp(config, messages, { jsonSchema: schema, jsonSchemaMode: 'json-object' })
  assert.deepEqual(requests[0].body.response_format, { type: 'json_object' })
  await callLlamaCpp(config, messages, { jsonSchema: schema })
  assert.deepEqual(requests[1].body.response_format, {
    type: 'json_schema', json_schema: { name: 'response', schema },
  })
})

test('rejects unsupported images, invalid endpoints and invalid budgets before transport', async () => {
  healthyFetch()
  await assert.rejects(callLlamaCpp({ ...config, capabilities: ['text'] }, imageMessages), /image input/)
  await assert.rejects(callLlamaCpp({ ...config, endpoint: 'file:///tmp/model' }, messages), /HTTP/)
  await assert.rejects(callLlamaCpp({ ...config, endpoint: 'http://localhost:8080/v1' }, messages), /root URL/)
  await assert.rejects(callLlamaCpp(config, messages, { maxTokens: config.contextWindow }), /context window/)
  await assert.rejects(callLlamaCpp(config, [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://example.test/private' } }] }]), /data URL/)
  assert.equal(requests.length, 0)
})

test('HTTP errors, malformed responses and absent model are reported without fallback', async () => {
  globalThis.fetch = async () => new Response('model unavailable', { status: 503 })
  await assert.rejects(callLlamaCpp(config, messages), /HTTP 503/)
  globalThis.fetch = async () => new Response('not JSON')
  await assert.rejects(callLlamaCpp(config, messages), /invalid JSON/)
  globalThis.fetch = async () => Response.json({ choices: [{ message: { content: '' } }] })
  await assert.rejects(callLlamaCpp(config, messages), /no assistant text/)
  globalThis.fetch = async url => Response.json(String(url).endsWith('/health') ? { status: 'ok' } : { data: [{ id: 'different-model' }] })
  assert.match((await getLlamaCppStatus(config)).error!, /not serving/)
})

test('cancellation is honored before transport and while consuming the body', async () => {
  healthyFetch()
  const before = new AbortController()
  before.abort(new Error('cancelled before request'))
  await assert.rejects(callLlamaCpp(config, messages, { signal: before.signal }), /cancelled before/)
  assert.equal(requests.length, 0)
  const during = new AbortController()
  globalThis.fetch = async (_url, init) => ({ ok: true, text: () => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
    during.abort(new Error('cancelled during body'))
  }) }) as Response
  await assert.rejects(callLlamaCpp(config, messages, { signal: during.signal }), /cancelled during body/)
})

test('health timeout covers a stalled body and reports offline', async () => {
  globalThis.fetch = async (_url, init) => ({ ok: true, text: () => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
  }) }) as Response
  const keepAlive = setTimeout(() => {}, 3000)
  try {
    const result = await getLlamaCppStatus(config)
    assert.equal(result.running, false)
    assert.match(result.error!, /timed out/)
  } finally { clearTimeout(keepAlive) }
})

test('backend config validates at its owner, disables other startup flags, and resolves live status', async () => {
  healthyFetch()
  saveBackendConfig({ activeBackend: 'llama-cpp', preferredLocalBackend: 'llama-cpp', llamaCpp: config })
  assert.equal(loadBackendConfig(true).ollama.autoStart, false)
  assert.equal(loadBackendConfig().vllm.autoStart, false)
  assert.throws(() => saveBackendConfig({ llamaCpp: { ...config, maxTokens: -1 } }), /maxTokens/)
  assert.equal(loadBackendConfig(true).llamaCpp.maxTokens, config.maxTokens)
  assert.equal((await getBackendStatus()).resolvedBackend, 'llama-cpp')
  assert.equal((await ensureBackendRunning()).running, true)
  saveBackendConfig({ activeBackend: 'auto' })
  assert.equal((await getBackendStatus()).resolvedBackend, 'llama-cpp')
  assert(requests.every(r => r.url.startsWith(config.endpoint)))
})

test('settings API accepts llama.cpp and rejects bad values or non-owner edits', async () => {
  const request = { method: 'PUT', user: { isAuthenticated: true, username: 'fixture', role: 'owner' }, body: { activeBackend: 'llama-cpp', llamaCpp: config } }
  assert.equal((await handleSetLlmBackendConfig(request as any)).status, 200)
  assert.equal((await handleSetLlmBackendConfig({ ...request, body: { llamaCpp: { maxTokens: 0 } } } as any)).status, 400)
  assert.equal((await handleSetLlmBackendConfig({ ...request, user: { ...request.user, role: 'standard' } } as any)).status, 403)
})

test('device routing overrides synced local chat/action roles without changing profiles or embedding/cloud roles', async () => {
  healthyFetch()
  saveBackendConfig({ activeBackend: 'llama-cpp', llamaCpp: config })
  const profile = getProfilePaths('fixture')
  fs.mkdirSync(profile.etc, { recursive: true })
  const file = path.join(profile.etc, 'models.json')
  const registry = { version: '1.0.0', description: 'Synthetic registry', defaults: { orchestrator: 'old', embedder: 'embed', coder: 'cloud' },
    models: {
      old: { provider: 'ollama', model: 'desktop-model', roles: ['orchestrator'], options: {}, capabilities: ['text'] },
      embed: { provider: 'local-models', model: 'embedding', roles: ['embedder'], options: {} },
      cloud: { provider: 'runpod_serverless', model: 'cloud-model', roles: ['coder'], options: {} },
    } }
  fs.writeFileSync(file, JSON.stringify(registry))
  const resolved = resolveModel('orchestrator', undefined, 'fixture')
  assert.equal(resolved.provider, 'llama-cpp')
  assert.equal(resolved.model, config.model)
  assert.equal(resolveModelById('old', 'fixture', false).model, 'desktop-model')
  assert.equal(resolveModelById('old', 'fixture', false).provider, 'ollama')
  assert.deepEqual(resolved.capabilities, ['text', 'image'])
  assert.equal(resolveModelForCognitiveMode('environment', 'environmentActionSelector', 'fixture').provider, 'llama-cpp')
  assert.equal(resolveModel('embedder', undefined, 'fixture').provider, 'local-models')
  assert.equal(resolveModel('coder', undefined, 'fixture').provider, 'runpod_serverless')
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).models.old.model, 'desktop-model')
  for (const provider of ['ollama', 'vllm', 'local', 'llama-cpp'] as const) {
    const result = await callProvider(provider, imageMessages, { model: config.model, modelCapabilities: ['text', 'image'] })
    assert.equal(result.provider, 'llama-cpp')
  }
  assert(requests.every(request => request.url.startsWith(config.endpoint)))
  const inventory = await handleGetModelRegistry({ method: 'GET', user: { username: 'fixture', isAuthenticated: true }, query: {} } as any)
  assert.equal(inventory.status, 200)
  const data = inventory.data as any
  assert.equal(data.localModel.provider, 'llama-cpp')
  assert.equal(data.modelCategories.local[0].model, config.model)
  assert(data.modelCategories.local[0].aliases.includes('old'))
  globalThis.fetch = async () => { throw new Error('server disconnected') }
  await assert.rejects(callProvider('llama-cpp', messages, {}), /[Nn]o.*backend|offline|not.*running|unavailable|disconnected/)
})

test('role-selected llama.cpp deployment preserves model, endpoint and request adapters', async () => {
  const selected = 'specialist'
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), 'http://127.0.0.1:8081/v1/chat/completions')
    const body = JSON.parse(String(init?.body))
    assert.equal(body.model, selected)
    assert.deepEqual(body.lora, [{ id: 1, scale: 0.8 }])
    return Response.json({ ...success, model: selected })
  }
  const result = await callProvider('llama-cpp', messages, {
    model: selected, endpoint: 'http://127.0.0.1:8081',
    modelCapabilities: ['text'], lora: [{ id: 1, scale: 0.8 }],
  })
  assert.equal(result.model, selected)
})

test('explicit registry selection carries its JSON-object mode through the model router', async () => {
  const { callLLM } = await import('./model-router.js')
  const file = path.join(getProfilePaths('fixture').etc, 'models.json')
  const registry = JSON.parse(fs.readFileSync(file, 'utf8'))
  const id = 'llama-cpp.speck-intent'
  registry.models[id] = {
    provider: 'llama-cpp', model: 'speck-intent', adapters: [], roles: [], capabilities: ['text'],
    description: 'Synthetic intent model',
    options: { endpoint: 'http://127.0.0.1:8083', contextWindow: 4096, jsonSchemaMode: 'json-object' },
  }
  fs.writeFileSync(file, JSON.stringify(registry))
  const schema = { type: 'object', properties: { needsAction: { type: 'boolean' } } }
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), 'http://127.0.0.1:8083/v1/chat/completions')
    const body = JSON.parse(String(init?.body))
    assert.equal(body.model, 'speck-intent')
    assert.deepEqual(body.response_format, { type: 'json_object' })
    return Response.json({ ...success, model: 'speck-intent' })
  }
  const result = await callLLM({ role: 'orchestrator', modelId: id, userId: 'fixture',
    cognitiveMode: 'environment', messages, options: { format: 'json', jsonSchema: schema } })
  assert.equal(result.modelId, id)
})

test('assigning a discovered model persists the role and invalidates cached resolution', async () => {
  healthyFetch()
  const file = path.join(getProfilePaths('fixture').etc, 'models.json')
  const before = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.throws(() => resolveModelForCognitiveMode('environment', 'persona', 'fixture'), /No default model/)
  const result = await handleAssignModelRole({ user: { username: 'fixture', isAuthenticated: true },
    body: { role: 'persona', modelId: `llama-cpp.${config.model}`, cognitiveMode: 'environment' } } as any)
  assert.equal(result.status, 200)
  const after = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.deepEqual(after.defaults, before.defaults)
  assert.equal(after.cognitiveModeMappings.environment.persona, `llama-cpp.${config.model}`)
  assert.equal(resolveModelForCognitiveMode('environment', 'persona', 'fixture').id, `llama-cpp.${config.model}`)
})

test('saved specialist role changes reach the newly assigned endpoint and adapters on the next call', async () => {
  const { callLLM } = await import('./model-router.js')
  const file = path.join(getProfilePaths('fixture').etc, 'models.json')
  const registry = JSON.parse(fs.readFileSync(file, 'utf8'))
  for (const [index, name] of ['intent-v1', 'intent-v2'].entries()) {
    registry.models[name] = { provider: 'llama-cpp', model: name, roles: ['environmentIntent'], capabilities: ['text'],
      options: { endpoint: `http://127.0.0.1:${8081 + index}`, lora: [{ id: index, scale: 0.8 }] } }
  }
  fs.writeFileSync(file, JSON.stringify(registry))
  const dispatched: any[] = []
  globalThis.fetch = async (url, init) => {
    assert(String(url).endsWith('/v1/chat/completions'))
    const body = JSON.parse(String(init?.body))
    dispatched.push({ url: String(url), model: body.model, lora: body.lora })
    return Response.json({ ...success, model: body.model })
  }
  for (const name of ['intent-v1', 'intent-v2']) {
    const result = await handleAssignModelRole({ user: { username: 'fixture', isAuthenticated: true },
      body: { role: 'environmentIntent', modelId: name, cognitiveMode: 'environment' } } as any)
    assert.equal(result.status, 200)
    const resolved = resolveModelForCognitiveMode('environment', 'environmentIntent', 'fixture')
    assert.equal(resolved.model, name)
    const response = await callLLM({ userId: 'fixture', role: 'environmentIntent', cognitiveMode: 'environment', messages })
    assert.equal(response.model, name)
  }
  assert.deepEqual(dispatched, [
    { url: 'http://127.0.0.1:8081/v1/chat/completions', model: 'intent-v1', lora: [{ id: 0, scale: 0.8 }] },
    { url: 'http://127.0.0.1:8082/v1/chat/completions', model: 'intent-v2', lora: [{ id: 1, scale: 0.8 }] },
  ])
  // A separate server process cannot call this process's invalidation function.
  const externalUpdate = JSON.parse(fs.readFileSync(file, 'utf8'))
  externalUpdate.cognitiveModeMappings.environment.environmentIntent = 'intent-v1'
  fs.writeFileSync(`${file}.updated`, JSON.stringify(externalUpdate))
  fs.renameSync(`${file}.updated`, file)
  assert.equal(resolveModelForCognitiveMode('environment', 'environmentIntent', 'fixture').model, 'intent-v1')
  assert.equal(resolveModelForCognitiveMode('environment', 'orchestrator', 'fixture').model, config.model);
})

test('router sends an explicit small model to Ollama while inherited calls use llama.cpp', async () => {
  const { callLLM } = await import('./model-router.js')
  const dispatched: string[] = []
  globalThis.fetch = async (url, init) => {
    const route = String(url)
    if (route.endsWith('/api/version')) return Response.json({ version: 'fixture' })
    if (route.endsWith('/api/ps')) return Response.json({ models: [{ name: 'desktop-model' }] })
    if (route.endsWith('/api/chat')) {
      const body = JSON.parse(String(init?.body))
      dispatched.push(body.model)
      return Response.json({ model: body.model, message: { role: 'assistant', content: 'small response' }, done: true })
    }
    if (route.endsWith('/health')) return Response.json({ status: 'ok' })
    if (route.endsWith('/v1/models')) return Response.json({ data: [{ id: config.model }] })
    if (route.endsWith('/v1/chat/completions')) {
      dispatched.push(JSON.parse(String(init?.body)).model)
      return Response.json(success)
    }
    throw new Error(`Unexpected route: ${route}`)
  }
  const small = await callLLM({ modelId: 'old', userId: 'fixture', role: 'orchestrator', cognitiveMode: 'environment', messages })
  const inherited = await callLLM({ userId: 'fixture', role: 'orchestrator', cognitiveMode: 'environment', messages })
  assert.equal(small.provider, 'ollama')
  assert.equal(small.model, 'desktop-model')
  assert.equal(inherited.model, config.model)
  assert.deepEqual(dispatched, ['desktop-model', config.model])
  await assert.rejects(callLLM({ modelId: 'old', userId: 'fixture', role: 'persona', messages: imageMessages }), /not configured for image/)
  assert.equal(dispatched.length, 2)
})

test('named llama.cpp adapter selection resolves the current server ID after reload', async () => {
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('/lora-adapters')) return Response.json([{ id: 7, path: '/models/specialist.gguf', scale: 0 }])
    assert.deepEqual(JSON.parse(String(init?.body)).lora, [{ id: 7, scale: 1 }])
    return Response.json(success)
  }
  await callLlamaCpp(config, messages, { lora: [{ path: '/models/specialist.gguf', scale: 1 }] })
  await assert.rejects(callLlamaCpp(config, messages, { lora: [{ path: '/models/missing.gguf', scale: 1 }] }), /not loaded/)
})
