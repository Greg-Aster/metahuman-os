import assert from 'node:assert/strict'
import test from 'node:test'
import { selectPersonalizationDataset, trainingSampleContentHash, type TrainingDatasetHistory } from './training-dataset.js'
import { parseTrainingDataSettings, validatePersonalizationSample } from './training-schema.js'
import { assembleCuratorSources } from './nodes/curator/source-assembler.js'
import { parseCuratorResponse } from './nodes/curator/curator-llm.node.js'
import type { EpisodicEvent } from './memory.js'

function fixture(count = 40) {
  const sources: EpisodicEvent[] = []
  for (let session = 0; session < count; session++) {
    for (let turn = 0; turn < 3; turn++) {
      for (const [offset, role] of ['user', 'assistant'].entries()) {
        sources.push({
          id: `${session}-${turn}-${role}`, type: 'conversation',
          timestamp: new Date(Date.parse('2026-09-01T00:00:00Z') + (session * 10 + turn * 2 + offset) * 1000).toISOString(),
          content: `${role} session ${session} turn ${turn}`,
          metadata: { role, sessionId: `session-${session}`, cognitiveMode: 'dual', idempotencyKey: `${session}-${turn}:${role}` },
        })
      }
    }
  }
  const assembly = assembleCuratorSources(sources.map(source => ({ ...source, path: '/tmp/' + source.id + '.json' })))
  const records = assembly.memories.map(memory => parseCuratorResponse(JSON.stringify({
    conversationalEssence: 'Synthetic test exchange', suitableForTraining: true,
  }), memory, '2026-09-09T00:00:00Z'))
  return { sources, records, cutoff: '2026-09-09T01:00:00Z' }
}

test('human continuation follows the preceding assistant and never uses the future reply', () => {
  const input = fixture()
  const selected = selectPersonalizationDataset(input, parseTrainingDataSettings({ includePersona: false }))
  const rows = [...selected.train, ...selected.evaluation]
  assert.equal(rows.length, 80)
  for (const row of rows) {
    const [prompt, target] = row.messages
    const turn = Number(target!.content.split(' ').at(-1))
    assert.equal(prompt!.content, target!.content.replace(/^user/, 'assistant').replace(/turn \d+$/, `turn ${turn - 1}`))
    assert.equal(row.metadata.targetAuthor, 'human')
    assert.equal(row.metadata.synthetic, false)
    assert.doesNotMatch(prompt!.content, new RegExp('turn ' + turn + '$'))
  }
})

test('assistant targets preserve dual mode exchanges and the requested persona context', () => {
  const selected = selectPersonalizationDataset(fixture(), parseTrainingDataSettings({ objective: 'assistant-continuation' }), {
    personaContext: 'I am the configured synthetic persona.',
  })
  for (const row of [...selected.train, ...selected.evaluation]) {
    assert.equal(row.messages[0]!.role, 'system')
    assert.equal(row.messages[0]!.content, 'I am the configured synthetic persona.')
    assert.match(row.messages[1]!.content, /^user session/)
    assert.equal(row.messages[2]!.content, row.messages[1]!.content.replace(/^user/, 'assistant'))
    assert.equal(row.metadata.mode, 'dual')
  }
  assert.throws(() => selectPersonalizationDataset(fixture(), parseTrainingDataSettings()), /Persona context/)
})

test('frozen inputs give identical bytes, with entire sessions in one split', () => {
  const input = fixture()
  const config = parseTrainingDataSettings({ includePersona: false })
  const selected = selectPersonalizationDataset(input, config, { maxSamples: 27 })
  const repeated = selectPersonalizationDataset({ ...input, sources: [...input.sources].reverse(), records: [...input.records].reverse() }, config, { maxSamples: 27 })
  assert.deepEqual(repeated, selected)
  assert.ok(selected.train.length > 0 && selected.evaluation.length > 0)
  const groups = new Set(selected.train.map(row => row.metadata.group))
  const ids = new Set(selected.train.flatMap(row => row.metadata.sourceIds))
  assert.ok(selected.evaluation.every(row => !groups.has(row.metadata.group) && row.metadata.sourceIds.every(id => !ids.has(id))))
})

test('zero weights and unknown types never reenter through sampling or synthetic caps', () => {
  const input = fixture()
  const settings = parseTrainingDataSettings({ objective: 'assistant-continuation', includePersona: false, memoryTypes: { percentages: { conversation: 0, daydream: 0 } } })
  const onlyDreams = { ...input, records: input.records.map(record => ({ ...record, memoryType: 'daydream', provenance: { ...record.provenance!, kind: 'synthetic-exchange' as const } })) }
  const zero = selectPersonalizationDataset(onlyDreams, settings)
  assert.equal(zero.train.length + zero.evaluation.length, 0)
  const unknown = selectPersonalizationDataset({ ...input, records: input.records.map(record => ({ ...record, memoryType: 'unmapped-type' })) }, settings)
  assert.equal(unknown.train.length + unknown.evaluation.length, 0)
  const noRecorded = selectPersonalizationDataset(onlyDreams, parseTrainingDataSettings({
    ...settings, maxSyntheticPercent: 50, memoryTypes: { percentages: { daydream: 100 } },
  }))
  assert.equal(noRecorded.train.length + noRecorded.evaluation.length, 0)
})

test('synthetic ceilings survive a tight global budget and exact duplicates are removed', () => {
  const input = fixture(80)
  const records = input.records.map((record, index) => index % 3 === 0 ? {
    ...record, memoryType: 'reflection', provenance: { ...record.provenance!, kind: 'synthetic-exchange' as const },
  } : record)
  records.push({ ...records[1]!, id: 'duplicate-record', provenance: { ...records[1]!.provenance!, sessionId: 'copied-session' } })
  const selected = selectPersonalizationDataset({ ...input, records }, parseTrainingDataSettings({
    objective: 'assistant-continuation', includePersona: false, maxSyntheticPercent: 10,
    memoryTypes: { percentages: { conversation: 10, reflection: 100 } },
  }), { maxSamples: 20 })
  const hashes = new Set<string>()
  assert.equal(selected.train.length, 20)
  for (const split of [selected.train, selected.evaluation]) {
    assert.ok(split.filter(row => row.metadata.synthetic).length <= split.length * 0.1)
    for (const row of split) {
      const text = JSON.stringify(row.messages)
      assert.equal(hashes.has(text), false)
      hashes.add(text)
    }
  }
  assert.ok(selected.excluded.duplicate! > 0)
})

test('malformed settings and target roles fail before training', () => {
  assert.throws(() => parseTrainingDataSettings({ memoryTypes: { percentages: { daydream: -1 } } }), /between 0 and 100/)
  assert.throws(() => parseTrainingDataSettings({ objective: 'reverse-pairs' }), /objective/)
  assert.throws(() => parseTrainingDataSettings({ evaluationPercent: 0 }), /5 to 30/)
  const row = selectPersonalizationDataset(fixture(), parseTrainingDataSettings({ includePersona: false })).train[0]!
  assert.throws(() => validatePersonalizationSample({ ...row, messages: [...row.messages].reverse() }), /target must follow/)
})

test('rolling selection retains recent data and a bounded reproducible sample of older history', () => {
  const input = fixture()
  const records = input.records.map((record, index) => ({
    ...record, originalTimestamp: index < 20 ? '2026-09-08T00:00:00Z' : '2025-01-01T00:00:00Z',
  }))
  const settings = parseTrainingDataSettings({ objective: 'assistant-continuation', includePersona: false })
  const selected = selectPersonalizationDataset({ ...input, records }, settings, { recentDays: 30, olderSamples: 7 })
  const rows = [...selected.train, ...selected.evaluation]
  assert.equal(rows.filter(row => row.metadata.timestamp.startsWith('2026')).length, 20)
  assert.equal(rows.filter(row => row.metadata.timestamp.startsWith('2025')).length, 7)
  const noHistory = selectPersonalizationDataset({ ...input, records }, settings, { recentDays: 30, olderSamples: 0 })
  assert.equal(noHistory.train.length + noHistory.evaluation.length, 20)
  assert.deepEqual(selectPersonalizationDataset({ ...input, records: records.reverse() }, settings, { recentDays: 30, olderSamples: 7 }), selected)
  assert.throws(() => selectPersonalizationDataset(input, settings, { recentDays: 0 }), /recentDays/)
})

test('null sample limit includes all eligible data, without the historical 5000-row default', () => {
  const input = fixture(1800)
  const selected = selectPersonalizationDataset(input, parseTrainingDataSettings({ includePersona: false, objective: 'assistant-continuation' }), { maxSamples: null })
  assert.equal(selected.train.length + selected.evaluation.length, 5400)
})

test('saved exposure keeps whole sessions in their original split when controls change', () => {
  const input = fixture()
  const settings = parseTrainingDataSettings({ includePersona: false })
  const first = selectPersonalizationDataset(input, settings)
  const history: TrainingDatasetHistory = { assignments: {}, completedSampleIds: [] }
  for (const split of ['train', 'evaluation'] as const) for (const row of first[split]) {
    history.assignments['content:' + trainingSampleContentHash(row)] = split
    for (const id of row.metadata.sourceIds) history.assignments['source:' + id] = split
  }
  const changed = selectPersonalizationDataset(input, { ...settings, seed: 'changed', evaluationPercent: 30 }, { history })
  for (const split of ['train', 'evaluation'] as const) {
    assert.deepEqual(changed[split].map(row => row.id).sort(), first[split].map(row => row.id).sort())
  }
  const group = first.train[0]!.metadata.group
  const row = first.train.find(item => item.metadata.group === group)!
  history.assignments['content:' + trainingSampleContentHash(row)] = 'evaluation'
  const conflict = selectPersonalizationDataset(input, settings, { history })
  assert.ok(conflict.excluded['historical-split-conflict'] >= 2)
  assert.ok([...conflict.train, ...conflict.evaluation].every(item => item.metadata.group !== group))
})
