import assert from 'node:assert/strict'
import fs from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { ReflectionPromptNode } from './reflection-prompt.node.js'
import { ReflectorLLMNode } from '../llm/reflector-llm.node.js'
import {
  extractReflectionMemoryText,
  selectReflectionMemories,
} from '../memory/reflection-memory-sampler.node.js'

const graphPath = fileURLToPath(new URL('../../../../../etc/cognitive-graphs/reflector-mode.json', import.meta.url))
const agentPath = fileURLToPath(new URL('../../../../../brain/agents/reflector/core.ts', import.meta.url))

test('Reflector graph owns persona, memory, prompt, generation, and persistence', () => {
  const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'))
  const nodeTypes = graph.nodes.map((node: any) => node.data.nodeType)
  const node = (nodeType: string, predicate: (candidate: any) => boolean = () => true) => {
    const matches = graph.nodes.filter(
      (candidate: any) => candidate.data.nodeType === nodeType && predicate(candidate),
    )
    assert.equal(matches.length, 1, `expected exactly one matching ${nodeType} node`)
    return matches[0]
  }
  const edge = (targetId: string, targetHandle: string) => graph.edges.find(
    (candidate: any) => candidate.target === targetId && candidate.targetHandle === targetHandle,
  )

  for (const required of [
    'persona_loader',
    'persona_formatter',
    'reflection_memory_sampler',
    'reflection_prompt',
    'reflector_llm',
    'inner_dialogue_buffer',
    'inner_dialogue_saver',
  ]) {
    assert.ok(nodeTypes.includes(required), `missing ${required}`)
  }

  const personaLoader = node('persona_loader')
  const personaFormatter = node('persona_formatter')
  const memorySampler = node('reflection_memory_sampler')
  const prompt = node('reflection_prompt')
  const model = node('reflector_llm')
  const reflectionBuffer = node(
    'inner_dialogue_buffer',
    candidate => candidate.data.properties?.role === 'reflection',
  )
  const reasoningBuffer = node(
    'inner_dialogue_buffer',
    candidate => candidate.data.properties?.role === 'reasoning',
  )
  const reflectionSaver = node(
    'inner_dialogue_saver',
    candidate => candidate.data.properties?.roles?.includes('reflection'),
  )
  const reasoningSaver = node(
    'inner_dialogue_saver',
    candidate => candidate.data.properties?.roles?.includes('reasoning'),
  )
  const audit = node('audit_logger')
  const tts = node('tts')

  assert.equal(edge(prompt.id, 'personaContext')?.source, personaFormatter.id)
  assert.equal(edge(prompt.id, 'activeFacet')?.source, personaLoader.id)
  assert.equal(edge(prompt.id, 'memories')?.source, memorySampler.id)
  assert.equal(edge(model.id, 'systemPrompt')?.source, prompt.id)
  assert.equal(edge(model.id, 'prompt')?.source, prompt.id)
  assert.equal(memorySampler.data.properties.contentMode, 'configured')
  assert.equal(memorySampler.data.properties.maxCandidateFiles, 2000)
  assert.equal(memorySampler.data.properties.maxFileSizeBytes, 2097152)
  assert.equal(edge(reasoningSaver.id, 'entries')?.source, reasoningBuffer.id)
  assert.equal(edge(reflectionSaver.id, 'entries')?.source, reflectionBuffer.id)
  assert.equal(edge(reflectionSaver.id, 'gate')?.source, reasoningSaver.id)
  assert.equal(edge(audit.id, 'data')?.source, reflectionSaver.id)
  assert.equal(edge(tts.id, 'innerDialogue')?.source, reflectionSaver.id)
  assert.equal(audit.data.properties.event, 'reflection_persisted')

  const agentSource = fs.readFileSync(agentPath, 'utf8')
  assert.match(agentSource, /runGraph/)
  assert.doesNotMatch(agentSource, /getAssociativeMemoryChain|reflectionSystemPrompt|reflectionPrompt|executeTrainOfThought/)
  assert.doesNotMatch(agentSource, /graphResult\.nodes\.get\(['"]/)
  assert.doesNotMatch(agentSource, /singleUser|generateUserReflection|runCycle/)
})

test('reflection prompt applies persona while preserving separate historical evidence', async () => {
  const outputs = await ReflectionPromptNode.execute({
    personaContext: '## Identity\n- Name: Avery\n\n## Core Values\n- Accuracy: prefer verified claims',
    activeFacet: 'thinker',
    memories: [
      { id: 'one', timestamp: '2026-08-20T12:00:00.000Z', type: 'conversation', text: 'User planned a garden.' },
      { id: 'two', timestamp: '2026-08-21T12:00:00.000Z', type: 'observation', text: 'Rain delayed the outdoor work.' },
    ],
  }, {}, {})

  assert.equal(outputs.ready, true)
  assert.equal(outputs.personaApplied, true)
  assert.equal(outputs.memoryCount, 2)
  assert.match(outputs.systemPrompt, /Name: Avery/)
  assert.match(outputs.systemPrompt, /Active Persona Facet[\s\S]*thinker/)
  assert.match(outputs.systemPrompt, /Persona is not evidence that an event happened/)
  assert.match(outputs.systemPrompt, /Do not merge their actors, pronouns, scenes, or timelines/)
  assert.match(outputs.userPrompt, /\[Memory 1\][\s\S]*User planned a garden/)
  assert.match(outputs.userPrompt, /\[Memory 2\][\s\S]*Rain delayed the outdoor work/)
})

test('reflection prompt fails closed without persona or multiple memories', async () => {
  const noPersona = await ReflectionPromptNode.execute({
    personaContext: '',
    memories: [{ text: 'One memory' }, { text: 'Another memory' }],
  }, {}, {})
  assert.equal(noPersona.ready, false)
  assert.equal(noPersona.userPrompt, '')
  assert.match(noPersona.error, /persona/i)

  const oneMemory = await ReflectionPromptNode.execute({
    personaContext: '## Identity\n- Name: Avery',
    memories: [{ text: 'Only one memory' }],
  }, {}, {})
  assert.equal(oneMemory.ready, false)
  assert.equal(oneMemory.systemPrompt, '')
  assert.match(oneMemory.error, /At least 2 historical memories/)
})

test('reflection memory extraction excludes generated inner content and separates conversation roles', () => {
  assert.equal(extractReflectionMemoryText({ type: 'dream', content: 'Invented scene' }, 'all'), null)
  assert.equal(extractReflectionMemoryText({ type: 'reflection', content: 'Prior reflection' }, 'agent'), null)

  const conversation = {
    type: 'conversation',
    content: 'User: Please remember the red notebook.\n\nAssistant: I will remember it.',
  }
  assert.equal(extractReflectionMemoryText(conversation, 'user'), 'Please remember the red notebook.')
  assert.equal(extractReflectionMemoryText(conversation, 'agent'), 'I will remember it.')
  assert.equal(extractReflectionMemoryText({
    type: 'conversation',
    content: 'Please remember the blue notebook.',
    metadata: { role: 'user' },
  }, 'user'), 'Please remember the blue notebook.')
  assert.equal(extractReflectionMemoryText({
    type: 'conversation',
    content: 'I will remember the blue notebook.',
    metadata: { role: 'assistant' },
  }, 'agent'), 'I will remember the blue notebook.')
  assert.equal(extractReflectionMemoryText({
    type: 'conversation',
    content: 'Please remember the blue notebook.',
    metadata: { role: 'user' },
  }, 'agent'), null)
})

test('reflection memory sampling returns multiple distinct historical excerpts', () => {
  const timestamp = new Date().toISOString()
  const selected = selectReflectionMemories([
    { id: 'one', timestamp, type: 'conversation', text: 'Garden planning', file: '/one', keywords: ['garden'] },
    { id: 'two', timestamp, type: 'observation', text: 'Rain arrived', file: '/two', keywords: ['rain'] },
    { id: 'three', timestamp, type: 'conversation', text: 'Garden work resumed', file: '/three', keywords: ['garden'] },
  ], 3, 14, 1.5, () => 0)

  assert.equal(selected.length, 3)
  assert.equal(new Set(selected.map(memory => memory.id)).size, 3)
})

test('reflector LLM refuses generation without a persona-aware system prompt', async () => {
  const outputs = await ReflectorLLMNode.execute({ prompt: 'Two memory excerpts' }, { userId: 'avery' }, {})
  assert.equal(outputs.response, '')
  assert.match(outputs.error, /persona-aware system prompt/)
})
