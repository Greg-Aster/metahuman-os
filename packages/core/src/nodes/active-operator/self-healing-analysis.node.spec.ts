import assert from 'node:assert/strict'
import test from 'node:test'

import {
  executeSelfHealingAnalysis,
  parseSelfHealingAnalysis,
} from './self-healing-analysis.node.js'

test('self-healing analysis is graph-owned and returns a review-only proposal', async () => {
  const output = await executeSelfHealingAnalysis(
    {
      error: { file: 'src/example.ts', line: 1, column: 1, code: 'TS2322', message: 'Type mismatch' },
      sourceContext: '>>> 1: const value: string = 1',
    },
    { username: 'profile-a', userId: 'account-a' },
    {},
    {
      callModel: async () => ({
        content: JSON.stringify({
          analysis: 'A number is assigned to a string.',
          suggestedFix: 'Use a string literal.',
          diff: '- 1\n+ "1"',
          confidence: 'high',
        }),
        provider: 'test',
        model: 'test',
        modelId: 'test',
        role: 'orchestrator',
      }),
    },
  )
  assert.equal(output.confidence, 'high')
  assert.equal('applied' in output, false)
})

test('self-healing parser rejects unstructured or partial output', () => {
  assert.throws(() => parseSelfHealingAnalysis('manual review'), /did not contain/)
  assert.throws(() => parseSelfHealingAnalysis('{"analysis":"Maybe"}'), /required typed fields/)
})
