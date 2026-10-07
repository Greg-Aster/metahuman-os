import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const repo = fileURLToPath(new URL('../../../../', import.meta.url))
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mh-terminal-service-'))
process.env.METAHUMAN_ROOT = root
fs.mkdirSync(path.join(root, 'etc'), { recursive: true })
fs.writeFileSync(path.join(root, 'etc', 'agents.json'), JSON.stringify({ agents: {} }))
const executable = path.join(root, 'provider.cjs')
fs.writeFileSync(executable, `#!/usr/bin/env node
let prompt = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', data => prompt += data);
process.stdin.on('end', () => {
  console.log(JSON.stringify({type:'assistant',message:{content:[{type:'text',text:'fixture response'}]}}));
  if (prompt.includes('wait')) setInterval(() => {}, 1000);
});
`, { mode: 0o700 })
fs.writeFileSync(path.join(root, 'etc', 'tool-executor.json'), JSON.stringify({ backends: {
  'claude-code': { enabled: true, command: executable, args: [], timeout: 15000 },
  codex: { enabled: true, command: executable, args: [], timeout: 15000 },
} }))
fs.writeFileSync(path.join(root, 'etc', 'services.json'), JSON.stringify({ services: { terminal: {
  id: 'terminal', enabled: true, type: 'manual', agentPath: 'services/terminal.ts', startOnSystemBoot: false, autoRestart: false,
} } }))
fs.mkdirSync(path.join(root, 'brain', 'services'), { recursive: true })
fs.writeFileSync(path.join(root, 'brain', 'services', 'terminal.ts'), "export { runTerminalService as default } from '@metahuman/core/terminal/service'\n")
fs.symlinkSync(path.join(repo, 'packages'), path.join(root, 'packages'), 'dir')
fs.symlinkSync(path.join(repo, 'node_modules'), path.join(root, 'node_modules'), 'dir')
const client = await import('./client.js')
const { eventBus } = await import('../infrastructure/event-bus/client.js')
eventBus.disconnect()
const { terminalSocket, terminalReceipts } = await import('./paths.js')
const { defaultAgentCatalogEntry } = await import('../agent-monitor-descriptors.js')
const script = path.join(root, 'run.mjs')
fs.writeFileSync(script, `import { eventBus } from ${JSON.stringify(new URL('../infrastructure/event-bus/client.ts', import.meta.url).href)}; eventBus.disconnect(); const { runTerminalService } = await import(${JSON.stringify(new URL('./service.ts', import.meta.url).href)}); await runTerminalService();`)
let service: ReturnType<typeof spawn> | undefined
let diagnostics = ''
const env: NodeJS.ProcessEnv = { ...process.env, SHELL: '/bin/bash' }
delete env.NODE_TEST_CONTEXT
async function eventually(check: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 7000
  while (Date.now() < deadline) { if (await check()) return; await delay(25) }
  assert.fail(`Service evidence timed out: ${diagnostics}`)
}
async function launch() {
  service = spawn(process.execPath, ['--import', 'tsx', script], { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] })
  service.stdout!.on('data', chunk => diagnostics += chunk)
  service.stderr!.on('data', chunk => diagnostics += chunk)
  service.on('error', error => { diagnostics += error.message })
  await eventually(async () => (await client.getTerminalState()).status === 'running')
}
async function waitForExit() { await eventually(() => service?.exitCode !== null || service?.signalCode !== null) }

test.after(async () => {
  try { await client.stopTerminalService() } finally {
    if (service?.exitCode === null && service.signalCode === null) { service.kill('SIGTERM'); await waitForExit() }
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('service is off on import and catalog registration is on-demand', async () => {
  assert.deepEqual(await client.getTerminalState(), { status: 'stopped', sessions: [] })
  const registration = defaultAgentCatalogEntry('terminal', 'service')
  assert.equal(registration.startOnSystemBoot, false)
  assert.equal(registration.autoRestart, false)
  await assert.rejects(client.terminalCall('/create', { kind: 'shell' }), /Terminal agent is stopped/)
  assert.equal(fs.existsSync(terminalSocket), false)
})

test('private service retains sessions across stream disconnects and preserves screen order', async () => {
  await launch()
  assert.equal(fs.statSync(terminalSocket).mode & 0o777, 0o600)
  assert.deepEqual((await client.getTerminalState()).sessions, [])
  const session = await client.terminalCall<{ id: string }>('/create', { kind: 'shell' })
  const first = await client.terminalRequest(`/events?id=${session.id}`)
  first.destroy()
  await client.terminalCall('/input', { id: session.id, data: "printf '\\033[2J\\033[Hreconnected-screen'\n" })
  await delay(100)
  const second = await client.terminalRequest(`/events?id=${session.id}`)
  second.setEncoding('utf8')
  let data = ''
  for await (const chunk of second) { data += chunk; if (data.includes('reconnected-screen')) break }
  second.destroy()
  assert.match(data, /"type":"screen"/)
  assert.equal((await client.getTerminalState()).sessions.length, 1)
  await client.terminalCall('/close', { id: session.id })
  assert.deepEqual((await client.getTerminalState()).sessions, [])
})

test('provider reservation is atomic, UI disconnect does not cancel, close does cancel', async () => {
  const work = client.executeInBigBrotherSession('claude-code', 'wait')
  await eventually(async () => (await client.getBigBrotherSessionState()).processRunning)
  const visibility = await client.terminalRequest('/events')
  visibility.destroy()
  await assert.rejects(client.executeInBigBrotherSession('codex', 'second'), /already has an active execution/)
  assert.equal((await client.getBigBrotherSessionState()).processRunning, true)
  await client.stopBigBrotherSession()
  const result = await work
  assert.equal(result.success, false)
  assert.match(result.error || '', /closed/)
  assert.deepEqual((await client.getTerminalState()).sessions, [])
  assert.deepEqual(fs.readdirSync(terminalReceipts), [])
})

test('stream authentication is revoked after logout without terminating the shell', async () => {
  const { createSession, deleteSession } = await import('../sessions.js')
  const { handleTerminalEvents } = await import('../api/handlers/terminal.js')
  const auth = createSession('terminal-test-owner', 'owner')
  const terminal = await client.terminalCall<{ id: string }>('/create', { kind: 'shell' })
  const abort = new AbortController()
  const response = await handleTerminalEvents({ path: '/api/terminal/events', method: 'GET',
    user: { userId: auth.userId, username: 'terminal-test-owner', role: 'owner', isAuthenticated: true },
    sessionId: auth.id, query: { id: terminal.id }, signal: abort.signal })
  assert.equal(response.status, 200)
  const iterator = response.stream![Symbol.asyncIterator]()
  await iterator.next()
  deleteSession(auth.id)
  await client.terminalCall('/input', { id: terminal.id, data: "printf 'revoked-session-check\\n'\n" })
  const next = await iterator.next()
  assert.match(next.value || '', /access expired/)
  assert.equal((await iterator.next()).done, true)
  assert.equal((await client.getTerminalState()).sessions.some(item => item.id === terminal.id), true)
  await client.terminalCall('/close', { id: terminal.id })
})

test('provider completes without a browser and cancellation/timeout keep the sole owner', async () => {
  const result = await client.executeInBigBrotherSession('claude-code', 'complete')
  assert.equal(result.success, true, result.error)
  assert.equal(result.output, 'fixture response')
  const timed = await client.executeInBigBrotherSession('claude-code', 'wait', { timeout: 100 })
  assert.equal(timed.success, false)
  assert.match(timed.error || '', /Timed out/)
  const abort = new AbortController()
  const work = client.executeInBigBrotherSession('claude-code', 'wait', { signal: abort.signal })
  const rejected = assert.rejects(work, /aborted/)
  await eventually(async () => (await client.getBigBrotherSessionState()).processRunning)
  abort.abort()
  await rejected
  await eventually(async () => !(await client.getBigBrotherSessionState()).processRunning)
  await client.stopBigBrotherSession()
})

test('SIGTERM stops children, restart starts empty, and explicit stop exits', async () => {
  await client.terminalCall('/create', { kind: 'shell' })
  service!.kill('SIGTERM')
  await waitForExit()
  assert.deepEqual(fs.readdirSync(terminalReceipts), [])
  assert.equal((await client.getTerminalState()).status, 'stopped')
  await launch()
  assert.deepEqual((await client.getTerminalState()).sessions, [])
  await client.stopTerminalService()
  await waitForExit()
  assert.equal(fs.existsSync(terminalSocket), false)
})

test('offline stop recovers the saved sessions after the agent is killed', async () => {
  await launch()
  await client.terminalCall('/create', { kind: 'shell' })
  service!.kill('SIGKILL')
  await waitForExit()
  assert.ok(fs.readdirSync(terminalReceipts).length > 0)
  await client.stopTerminalService()
  assert.deepEqual(fs.readdirSync(terminalReceipts), [])
  assert.equal(fs.existsSync(terminalSocket), false)
})

test('missing provider executable returns a failure and releases admission without an unhandled error', async () => {
  await launch()
  fs.renameSync(executable, `${executable}.saved`)
  try {
    const result = await client.executeInBigBrotherSession('claude-code', 'complete')
    assert.equal(result.success, false)
    assert.match(result.error || '', /ENOENT/)
    await client.stopBigBrotherSession()
  } finally { fs.renameSync(`${executable}.saved`, executable) }
  assert.equal((await client.executeInBigBrotherSession('claude-code', 'complete')).success, true)
  await client.stopTerminalService()
  await waitForExit()
})

test('Agent Monitor launcher starts the same service and stop removes its registry ownership', async () => {
  const state = await client.startTerminalService('test')
  assert.equal(state.status, 'running')
  await client.stopTerminalService()
  await eventually(() => !fs.existsSync(terminalSocket))
  const { isAgentRunning } = await import('../agent-monitor-registry.js')
  assert.equal(isAgentRunning('terminal'), false)
})

test('Big Brother starts the canonical service on demand and works again after a service stop', async () => {
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.equal((await client.getTerminalState()).status, 'stopped');
    const result = await client.executeInBigBrotherSession('claude-code', 'complete');
    assert.equal(result.success, true, result.error);
    assert.equal(result.output, 'fixture response');
    assert.equal((await client.getTerminalState()).status, 'running');
    await client.stopTerminalService();
  }
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(client.executeInBigBrotherSession('claude-code', 'complete', { signal: abort.signal }), /aborted/);
  assert.equal((await client.getTerminalState()).status, 'stopped');
});
