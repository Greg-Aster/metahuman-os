import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildBigBrotherCLIInvocation } from './big-brother-cli.js'
import { parseBigBrotherTerminalEvent } from './big-brother-session.js'

const claude = parseBigBrotherTerminalEvent('claude-code', JSON.stringify({
  type: 'assistant',
  message: {
    content: [
      { type: 'thinking', thinking: 'Inspect the owner path' },
      { type: 'tool_use', name: 'Read', input: { file_path: 'owner.ts' } },
      { type: 'text', text: 'The owner path is healthy.' },
    ],
  },
}))
assert.equal(claude.finalText, 'The owner path is healthy.')
assert.equal(claude.reasoningSteps[0]?.type, 'thought')
assert.equal(claude.reasoningSteps[1]?.toolName, 'Read')

const codex = parseBigBrotherTerminalEvent('codex', JSON.stringify({
  type: 'item.completed',
  item: { type: 'agent_message', text: 'Codex completed the task.' },
}))
assert.equal(codex.finalText, 'Codex completed the task.')
assert.deepEqual(codex.displayLines, ['Codex completed the task.'])

const legacyCodexEvent = parseBigBrotherTerminalEvent('codex', JSON.stringify({
  msg: { type: 'agent_reasoning', text: 'Check the shared session.' },
}))
assert.equal(legacyCodexEvent.reasoningSteps[0]?.content, 'Check the shared session.')

const codexInvocation = buildBigBrotherCLIInvocation('codex', 'Describe the attached image.', {
  images: [{ mimeType: 'image/jpeg', base64: '/9j/2Q==' }],
})
try {
  assert.ok(codexInvocation.args.includes('model_reasoning_effort="low"'))
  assert.equal(codexInvocation.args.some(arg => arg.startsWith('service_tier=')), false)
  const imageArgIndex = codexInvocation.args.indexOf('--image')
  assert.equal(imageArgIndex, codexInvocation.args.length - 2)
  const imagePath = codexInvocation.args[imageArgIndex + 1]
  assert.deepEqual(await fs.readFile(imagePath), Buffer.from('/9j/2Q==', 'base64'))
} finally {
  await fs.rm(codexInvocation.tempDir, { recursive: true, force: true })
}

const sourceRoot = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(sourceRoot, '../../..')
const read = (relativePath: string) => fs.readFile(path.join(repoRoot, relativePath), 'utf8')

const [claudeBackend, codexBackend, sessionOwner, worker, responseNode, providerBridge, cliToolAdapters, router, terminalManager] = await Promise.all([
  read('packages/core/src/backends/claude-code-backend.ts'),
  read('packages/core/src/backends/codex-backend.ts'),
  read('packages/core/src/big-brother-session.ts'),
  read('packages/core/src/big-brother-session-worker.ts'),
  read('packages/core/src/nodes/response/response-llm.node.ts'),
  read('packages/core/src/providers/bridge.ts'),
  read('packages/core/src/cli-tool-adapters.ts'),
  read('packages/core/src/api/router.ts'),
  read('apps/site/src/components/TerminalManager.svelte'),
])

assert.match(claudeBackend, /createTerminalSessionBackend/)
assert.match(codexBackend, /createTerminalSessionBackend/)
assert.match(sessionOwner, /TTYD_BIN/)
assert.match(sessionOwner, /'--max-clients', '1'/)
assert.match(sessionOwner, /spawn\(process\.execPath/)
assert.match(sessionOwner, /'--follow=name'/)
assert.doesNotMatch(sessionOwner, /createServer|WebSocketServer/)
assert.match(worker, /buildBigBrotherCLIInvocation/)
assert.match(worker, /spawn\(invocation\.command/)
assert.doesNotMatch(responseNode, /big-brother-terminal\.js/)
assert.match(providerBridge, /await ensureBackendsInitialized\(\)/)
assert.match(providerBridge, /resolvedBackendId === 'codex'/)
assert.match(providerBridge, /images: preservesImages \? escalationImages/)
assert.doesNotMatch(cliToolAdapters, /executeWith(?:ClaudeCode|CodexCLI)/)
assert.doesNotMatch(router, /claude-session|spawn-claude|big-brother-input/)
assert.match(terminalManager, /body: JSON\.stringify\(\{ action: 'stop' \}\)/)

console.log('Big Brother shared terminal-session contract passed')
