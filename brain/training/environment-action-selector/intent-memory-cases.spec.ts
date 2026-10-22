import assert from 'node:assert/strict'
import test from 'node:test'
import { cases } from './development-cases.js'
import { buildDevelopmentRecords, loadGraphProperties, validateDevelopmentRecords } from './generate-training-data.js'

const isMemoryFamily = (id: string) => /^intent-(development|evaluation)-memory-/.test(id)
const previous = structuredClone(cases.filter(source => !isMemoryFamily(source.id)))
await import('./intent-memory-cases.js')
const selected = cases.filter(source => isMemoryFamily(source.id))
const recordsPromise = buildDevelopmentRecords(selected)

test('memory families use the existing complete prompt/schema builder without changing previous cases', async () => {
  const records = await recordsPromise
  const properties = await loadGraphProperties()
  assert.ok(selected.length > 0)
  assert.deepEqual(cases.filter(source => !isMemoryFamily(source.id)), previous)
  assert.deepEqual(validateDevelopmentRecords(records, selected), [])
  for (const record of records) {
    const source = selected.find(item => item.id === record.metadata.sourceCaseId)!
    assert.equal(record.system, properties['intent-orchestrator'].systemPrompt)
    assert.equal(record.user, properties['intent-orchestrator'].userPromptTemplate.replace('{{userMessage}}', source.instructions[record.metadata.instructionIndex]!))
    const output = JSON.parse(record.output)
    assert.equal(output.needsResponse, true)
    assert.equal(output.needsAction, false)
    assert.equal(output.needsToolUse, false)
    assert.deepEqual(output.taskContext, [])
    assert.equal(output.taskPlanner, 'specialist')
  }
})

test('prior spoken descriptions, recorded observations and current images retain distinct source choices', async () => {
  const records = (await recordsPromise).filter(record => record.metadata.suite.startsWith('memory-visual-'))
  const families = new Map<string, typeof records>()
  for (const record of records) {
    const suffix = record.metadata.suite.split('-').at(-1)!
    const expected = { spoken: ['conversationHistory'], observation: ['environment'], current: ['environment', 'vision'] }[suffix]
    assert.ok(expected)
    assert.deepEqual(JSON.parse(record.output).conversationContext, expected)
    const group = record.metadata.sourceCaseId.replace(/-(spoken|observation|current)$/, '')
    families.set(group, [...(families.get(group) ?? []), record])
  }
  assert.ok(families.size > 0)
  for (const family of families.values()) {
    assert.equal(new Set(family.map(record => record.metadata.developmentFold)).size, 1)
    assert.equal(new Set(family.map(record => record.metadata.sourceSplit)).size, 1)
    assert.equal(new Set(family.map(record => record.metadata.suite.split('-').at(-1))).size, 3)
  }
})

test('memory scope covers supported types, chronological retrieval and cycle combinations in both splits', async () => {
  const records = await recordsPromise
  for (const split of ['development', 'evaluation']) {
    const outputs = records.filter(record => record.metadata.sourceSplit === split).map(record => JSON.parse(record.output))
    assert.ok(outputs.filter(output => output.memoryQuery).length > 0)
    assert.ok(new Set(outputs.map(output => output.memoryQuery).filter(Boolean)).size >= 10)
    const types = new Set(outputs.flatMap(output => output.memoryTypes ?? []))
    for (const type of ['conversation', 'observation', 'reflection', 'reflection_summary', 'dream', 'daydream', 'audio', 'curiosity', 'action', 'tool_invocation', 'inner_dialogue']) assert.ok(types.has(type), type)
    assert.ok(outputs.some(output => output.memoryOrder === 'newest' && !output.memorySleepCycle))
    assert.ok(outputs.some(output => output.memorySleepCycle === 'latest' && !output.memoryOrder))
    assert.ok(outputs.some(output => output.memorySleepCycle === 'latest' && output.memoryOrder === 'newest'))
    for (const output of outputs.filter(output => output.memoryQuery)) assert.deepEqual(output.conversationContext, ['memory'])
  }
})

test('absolute interval targets preserve only timezone-qualified bounds supplied by the request', async () => {
  const records = (await recordsPromise).filter(record => JSON.parse(record.output).memoryTimeRange)
  assert.ok(records.length > 0)
  assert.ok(records.some(record => !JSON.parse(record.output).memoryTimeRange.from))
  assert.ok(records.some(record => !JSON.parse(record.output).memoryTimeRange.before))
  for (const record of records) {
    const range = JSON.parse(record.output).memoryTimeRange
    assert.doesNotMatch(record.user, /yesterday|last night|days? ago|today|tomorrow/i)
    for (const timestamp of Object.values(range) as string[]) {
      assert.match(timestamp, /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/)
      assert.ok(record.user.includes(timestamp))
      assert.ok(Number.isFinite(Date.parse(timestamp)))
    }
    if (range.from && range.before) assert.ok(Date.parse(range.from) < Date.parse(range.before))
  }
})

test('development and evaluation keep distinct family identities, subjects and complete requests', async () => {
  const records = await recordsPromise
  const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const development = records.filter(record => record.metadata.sourceSplit === 'development')
  const evaluation = records.filter(record => record.metadata.sourceSplit === 'evaluation')
  const earlierRequests = new Set(previous.flatMap(source => source.instructions).map(normalize))
  const developmentRequests = new Set(development.map(record => normalize(record.user)))
  const developmentIds = new Set(development.map(record => record.metadata.sourceCaseId))
  assert.deepEqual([...new Set(development.map(record => record.metadata.developmentFold))].sort(), [0, 1, 2, 3])
  for (const source of selected) for (const instruction of source.instructions) assert.ok(!earlierRequests.has(normalize(instruction)), instruction)
  for (const record of evaluation) {
    assert.ok(!developmentRequests.has(normalize(record.user)), record.metadata.recordId)
    assert.ok(!developmentIds.has(record.metadata.sourceCaseId))
  }
  const developmentTopics = new Set(development.filter(record => record.metadata.suite.startsWith('memory-query-')).map(record => JSON.parse(record.output).memoryQuery))
  for (const record of evaluation.filter(record => record.metadata.suite.startsWith('memory-query-'))) assert.ok(!developmentTopics.has(JSON.parse(record.output).memoryQuery))
  assert.ok(records.every(record => record.metadata.sourceSplit !== 'regression'))
})
