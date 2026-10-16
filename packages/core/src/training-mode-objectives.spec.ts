import assert from 'node:assert/strict'
import test from 'node:test'
import { selectPersonalizationDataset, type TrainingDatasetHistory } from './training-dataset.js'
import { parseTrainingDataSettings, type CognitiveMode } from './training-schema.js'
import { assembleCuratorSources } from './nodes/curator/source-assembler.js'
import { parseCuratorResponse } from './nodes/curator/curator-llm.node.js'
import type { EpisodicEvent } from './memory.js'

function mixedModes() {
  const sources: EpisodicEvent[] = []
  for (const mode of ['dual', 'environment', 'agent', 'emulation'] as CognitiveMode[]) {
    for (let session = 0; session < 12; session++) {
      for (let turn = 0; turn < 3; turn++) {
        for (const [offset, role] of ['user', 'assistant'].entries()) {
          sources.push({ id: `${mode}-${session}-${turn}-${role}`, type: 'conversation',
            timestamp: new Date(Date.parse('2026-09-01T00:00:00Z') + (session * 10 + turn * 2 + offset) * 1000).toISOString(),
            content: `${role} ${mode} session ${session} turn ${turn}`,
            metadata: { role, cognitiveMode: mode, sessionId: `${mode}-${session}`, idempotencyKey: `${mode}-${session}-${turn}:${role}` },
          })
        }
      }
    }
  }
  const assembly = assembleCuratorSources(sources.map(source => ({ ...source, path: `/tmp/${source.id}.json` })))
  const records = assembly.memories.map(memory => parseCuratorResponse(JSON.stringify({
    conversationalEssence: 'Fixture exchange', suitableForTraining: true,
  }), memory, '2026-09-09T00:00:00Z'))
  return { sources, records, cutoff: '2026-09-09T01:00:00Z' }
}

test('saved modes choose human Dual targets and assistant Environment targets without changing other configured modes', () => {
  const settings = parseTrainingDataSettings({ objective: 'assistant-continuation', includePersona: false })
  const input = mixedModes()
  const selected = selectPersonalizationDataset(input, settings)
  const rows = [...selected.train, ...selected.evaluation]
  assert.equal(rows.filter(row => row.metadata.mode === 'dual').length, 24)
  for (const mode of ['environment', 'agent', 'emulation']) assert.equal(rows.filter(row => row.metadata.mode === mode).length, 36)
  for (const row of rows) {
    const [prompt, target] = row.messages
    if (row.metadata.mode === 'dual') {
      assert.equal(row.metadata.objective, 'human-continuation')
      assert.equal(row.metadata.targetAuthor, 'human')
      assert.match(target!.content, /^user dual /)
      const targetTurn = Number(target!.content.split(' ').at(-1))
      assert.equal(prompt!.content, target!.content.replace(/^user/, 'assistant').replace(/turn \d+$/, `turn ${targetTurn - 1}`))
    } else {
      assert.equal(row.metadata.objective, 'assistant-continuation')
      assert.equal(row.metadata.targetAuthor, 'assistant')
      assert.equal(target!.content, prompt!.content.replace(/^user/, 'assistant'))
    }
    assert.deepEqual(Object.keys(row.metadata.sourceHashes).sort(), [...row.metadata.sourceIds].sort())
  }
  const heldOut = new Set(selected.evaluation.flatMap(row => row.metadata.sourceIds))
  assert.ok(selected.train.every(row => row.metadata.sourceIds.every(id => !heldOut.has(id))))
  const history: TrainingDatasetHistory = { assignments: {}, completedSampleIds: [] }
  for (const split of ['train', 'evaluation'] as const) for (const row of selected[split]) {
    history.assignments[`group:${row.metadata.group}`] = split
    for (const id of row.metadata.sourceIds) history.assignments[`source:${id}`] = split
  }
  const replay = selectPersonalizationDataset(input, settings, { history })
  assert.deepEqual(replay.train.map(row => row.id), selected.train.map(row => row.id))
  assert.deepEqual(replay.evaluation.map(row => row.id), selected.evaluation.map(row => row.id))
})

test('mode provenance remains required and each objective gets its supplied persona context', () => {
  const input = mixedModes()
  const settings = parseTrainingDataSettings({ objective: 'human-continuation' })
  const contexts = { 'human-continuation': 'Human persona fixture.', 'assistant-continuation': 'Robot persona fixture.' }
  const selected = selectPersonalizationDataset(input, settings, { personaContexts: contexts })
  for (const row of [...selected.train, ...selected.evaluation]) {
    assert.equal(row.messages[0]!.content, contexts[row.metadata.objective])
    if (row.metadata.mode === 'agent' || row.metadata.mode === 'emulation') assert.equal(row.metadata.targetAuthor, 'human')
  }
  const unknown = selectPersonalizationDataset({ ...input,
    records: input.records.map(record => ({ ...record, cognitiveModeSource: 'legacy-default' as const })),
  }, settings, { personaContexts: contexts })
  assert.equal(unknown.train.length + unknown.evaluation.length, 0)
  assert.equal(unknown.excluded['unknown-mode'], input.records.length)
  assert.throws(() => parseTrainingDataSettings({ objectivesByMode: { environment: 'unknown' } }), /Invalid mode training objective/)
})
