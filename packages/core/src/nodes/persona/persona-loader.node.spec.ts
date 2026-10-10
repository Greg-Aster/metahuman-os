import assert from 'node:assert/strict'
import test, { after, mock } from 'node:test'
const identity = await import('../../identity.js')
let persona: any = identity.getDefaultPersonaCore()
mock.module('../../identity.js', { namedExports: { ...identity,
  loadPersonaWithFacet: () => persona, getActiveFacet: () => persona ? 'default' : 'inactive',
} })
const { PersonaLoaderNode } = await import('./persona-loader.node.js')
const { PersonaFormatterNode } = await import('../cognitive/persona-formatter.node.js')
const { eventBus } = await import('../../infrastructure/event-bus/client.js')
eventBus.disconnect()
after(() => { eventBus.disconnect(); mock.restoreAll() })

test('unified persona loading preserves the formatter output for every section combination', async () => {
  persona = identity.getDefaultPersonaCore()
  persona.background = 'Fixture background'
  persona.goals = { shortTerm: [{ goal: 'Fixture active goal', status: 'active' }], midTerm: [], longTerm: [] }
  for (const includePersonality of [false, true]) for (const includeValues of [false, true]) for (const includeGoals of [false, true]) {
    const properties = { formatContext: true, includePersonality, includeValues, includeGoals }
    const result = await PersonaLoaderNode.execute({}, {}, properties)
    const expected = await PersonaFormatterNode.execute({ persona }, {}, properties)
    assert.equal(result.persona, persona)
    assert.equal(result.formatted, expected.formatted)
    assert.match(result.formatted, /Fixture background/)
    assert.equal(result.formatted.includes('Fixture active goal'), includeGoals)
    assert.equal(result.formatted.includes('## Core Values'), includeValues)
    assert.equal(result.formatted.includes('## Personality'), includePersonality)
  }
})

test('existing load-only workflows and inactive persona retain their behavior', async () => {
  const loadOnly = await PersonaLoaderNode.execute({}, {}, {})
  assert.equal(loadOnly.persona, persona)
  assert.equal(loadOnly.formatted, '')
  persona = null
  const inactive = await PersonaLoaderNode.execute({}, {}, { formatContext: true })
  assert.equal(inactive.persona, null)
  assert.equal(inactive.formatted, '')
  assert.equal(inactive.inactive, true)
})

test('routed persona sections differ per consumer without implicit identity or background', async () => {
  persona = identity.getDefaultPersonaCore()
  persona.background = 'Unselected background'
  const result = await PersonaLoaderNode.execute({ routingAnalysis: {
    taskContext: ['persona.values'], conversationContext: ['persona.personality'],
  } }, {}, { formatContext: true })
  assert.match(result.taskFormatted, /## Core Values/)
  assert.doesNotMatch(result.taskFormatted, /## Identity|## Background|## Personality/)
  assert.match(result.conversationFormatted, /## Personality/)
  assert.doesNotMatch(result.conversationFormatted, /## Identity|## Background|## Core Values/)
  const none = await PersonaLoaderNode.execute({ routingAnalysis: {
    taskContext: [], conversationContext: ['persona.identity'],
  } }, {}, { formatContext: true })
  assert.equal(none.taskFormatted, '')
  assert.match(none.conversationFormatted, /## Identity/)
  assert.doesNotMatch(none.conversationFormatted, /Unselected background/)
})
