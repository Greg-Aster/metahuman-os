import assert from 'node:assert/strict'
import test from 'node:test'

import { agentFailureMessage } from './agent-process-runner.js'

test('agent failure summaries prefer the final explicit terminal failure', () => {
  const verboseOutput = [
    '[GraphExecutor] Node generate FAILED: Error: invalid model output',
    '    at executeNode (/workspace/graph-executor.ts:1:1)',
    '[desire-agent] Failed: Desire candidate sourceId did not identify a supplied input',
  ].join('\n')

  assert.equal(
    agentFailureMessage('desire-agent', 1, verboseOutput),
    'Agent desire-agent exited with code 1: [desire-agent] Failed: Desire candidate sourceId did not identify a supplied input',
  )
})

test('agent failure summaries remain bounded when an agent has no terminal summary', () => {
  const message = agentFailureMessage('example-agent', 1, 'x'.repeat(3_000))
  assert.equal(message.length, 'Agent example-agent exited with code 1: '.length + 2_000)
})
