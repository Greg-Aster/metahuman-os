import assert from 'node:assert/strict'
import test from 'node:test'
import { stripVTControlCharacters } from 'node:util'
import { formatProviderDisplay, terminalHeading } from './presentation.js'
import { TerminalScreen } from './screen.js'

test('formatted responses retain link destinations and literal fenced code', () => {
  const output = formatProviderDisplay('Codex', [
    '# Findings\n**Updated** `owner.ts`\n[Source](/workspace/owner.ts:12)\n```diff\n- old **literal**\n+ new `literal`\n```',
  ])
  assert.match(output, /\x1b\[1;36mFindings/)
  assert.match(output, /\x1b\[1mUpdated/)
  assert.match(output, /\x1b\[31m- old \*\*literal\*\*/)
  assert.match(output, /\x1b\[32m\+ new `literal`/)
  const plain = stripVTControlCharacters(output)
  assert.match(plain, /Source \(\/workspace\/owner.ts:12\)/)
  assert.match(plain, /- old \*\*literal\*\*/)
  assert.match(plain, /\+ new `literal`/)
})

test('tool output remains literal and error, reasoning, and completion are distinct', () => {
  const tool = '$ cat owner.md\n# raw heading\n**raw data**'
  assert.equal(stripVTControlCharacters(formatProviderDisplay('Codex', [tool])), `\r\n${tool.replaceAll('\n', '\r\n')}\r\n`)
  assert.match(formatProviderDisplay('Codex', ['💭 Checking the owner']), /\x1b\[1;35mReasoning/)
  assert.match(formatProviderDisplay('Codex', ['❌ failure']), /\x1b\[1;31m/)
  assert.match(formatProviderDisplay('Codex', ['[Codex] Completed']), /\x1b\[1;32m/)
})

test('terminal reconnect snapshots retain the formatted response and its colors', async () => {
  const screen = new TerminalScreen(100, 30)
  const restored = new TerminalScreen(100, 30)
  try {
    await screen.write(terminalHeading('Diagnostic fixture'))
    await screen.write(formatProviderDisplay('Codex', ['**Verified** `owner.ts`']))
    const snapshot = await screen.snapshot()
    assert.match(snapshot, /\x1b\[/)
    assert.match(stripVTControlCharacters(snapshot), /Verified owner.ts/)
    await restored.write(snapshot)
    assert.equal(await restored.snapshot(), snapshot)
  } finally { screen.dispose(); restored.dispose() }
})
