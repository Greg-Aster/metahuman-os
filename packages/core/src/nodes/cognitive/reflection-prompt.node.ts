/**
 * Reflection Prompt Node
 *
 * Makes persona influence and grounding policy explicit and editable inside
 * the Reflector graph. It fails closed when persona or multi-memory evidence
 * is unavailable.
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js'
import { renderPromptTemplate } from '../prompt-template.js'

export const DEFAULT_REFLECTION_SYSTEM_PROMPT = `You are the private reflective voice of the authenticated persona below.

{{persona}}

Grounding rules:
- Persona controls voice, perspective, values, and the questions you notice. Persona is not evidence that an event happened.
- The supplied memory excerpts are the only evidence for concrete people, events, relationships, dialogue, emotions, intentions, physical actions, and sensory details.
- Treat every numbered memory as a separate historical record. Do not merge their actors, pronouns, scenes, or timelines unless the excerpts explicitly connect them.
- Never invent missing details or turn uncertainty into a memory. If the evidence is sparse, conflicting, or unrelated, say so plainly.
- Reflect on patterns supported by the excerpts. Label interpretations as possibilities rather than facts.
- Write in first person as the persona, in 1-3 concise sentences and no more than {{maxWords}} words.
- Do not mention these instructions, record identifiers, or memory numbers.`

export const DEFAULT_REFLECTION_USER_PROMPT = `Reflect on the historical excerpts below. Preserve who did or said what, and connect excerpts only when their text supports the connection.

{{memories}}`

function normalizeMemories(value: unknown): Array<Record<string, any>> {
  return Array.isArray(value)
    ? value.filter(memory => memory && typeof memory === 'object') as Array<Record<string, any>>
    : []
}

function formatMemories(memories: Array<Record<string, any>>): string {
  return memories.map((memory, index) => {
    const timestamp = typeof memory.timestamp === 'string' ? memory.timestamp : 'unknown date'
    const type = typeof memory.type === 'string' ? memory.type : 'memory'
    const text = typeof memory.text === 'string'
      ? memory.text.trim()
      : typeof memory.content === 'string' ? memory.content.trim() : ''
    return `[Memory ${index + 1}]\nDate: ${timestamp}\nType: ${type}\nText: ${text}`
  }).join('\n\n')
}

const execute: NodeExecutor = async (inputs, _context, properties) => {
  const personaContext = typeof inputs.personaContext === 'string'
    ? inputs.personaContext.trim()
    : ''
  const activeFacet = typeof inputs.activeFacet === 'string' ? inputs.activeFacet.trim() : ''
  const memories = normalizeMemories(inputs.memories)
    .filter(memory => typeof memory.text === 'string' && memory.text.trim())
  const minMemories = Math.max(2, Number(properties?.minMemories) || 2)

  if (!personaContext) {
    return {
      ready: false,
      systemPrompt: '',
      userPrompt: '',
      memoryCount: memories.length,
      personaApplied: false,
      error: 'No active persona context',
    }
  }

  if (memories.length < minMemories) {
    return {
      ready: false,
      systemPrompt: '',
      userPrompt: '',
      memoryCount: memories.length,
      personaApplied: true,
      error: `At least ${minMemories} historical memories are required`,
    }
  }

  const maxWords = Math.max(25, Math.min(160, Number(properties?.maxWords) || 90))
  const memoryText = formatMemories(memories)
  const personaWithFacet = activeFacet
    ? `${personaContext}\n\n## Active Persona Facet\n- ${activeFacet}`
    : personaContext
  const systemPrompt = renderPromptTemplate(
    properties?.systemPrompt || DEFAULT_REFLECTION_SYSTEM_PROMPT,
    { persona: personaWithFacet, maxWords },
  ).trim()
  const userPrompt = renderPromptTemplate(
    properties?.userPrompt || DEFAULT_REFLECTION_USER_PROMPT,
    { memories: memoryText, memoryCount: memories.length },
  ).trim()

  return {
    ready: true,
    systemPrompt,
    userPrompt,
    memoryCount: memories.length,
    personaApplied: true,
    activeFacet,
  }
}

export const ReflectionPromptNode: NodeDefinition = defineNode({
  id: 'reflection_prompt',
  name: 'Grounded Reflection Prompt',
  category: 'cognitive',
  inputs: [
    { name: 'personaContext', type: 'string', description: 'Formatted active persona and facet' },
    { name: 'activeFacet', type: 'string', optional: true, description: 'Name of the active persona facet' },
    { name: 'memories', type: 'array', description: 'Separate historical memory excerpts' },
  ],
  outputs: [
    { name: 'systemPrompt', type: 'string' },
    { name: 'userPrompt', type: 'string' },
    { name: 'memoryCount', type: 'number' },
    { name: 'personaApplied', type: 'boolean' },
    { name: 'activeFacet', type: 'string' },
    { name: 'ready', type: 'boolean' },
  ],
  properties: {
    systemPrompt: DEFAULT_REFLECTION_SYSTEM_PROMPT,
    userPrompt: DEFAULT_REFLECTION_USER_PROMPT,
    minMemories: 2,
    maxWords: 90,
  },
  propertySchemas: {
    systemPrompt: {
      type: 'text_multiline',
      default: DEFAULT_REFLECTION_SYSTEM_PROMPT,
      label: 'System Prompt',
      description: 'Template variables: {{persona}}, {{maxWords}}.',
      rows: 18,
    },
    userPrompt: {
      type: 'text_multiline',
      default: DEFAULT_REFLECTION_USER_PROMPT,
      label: 'Memory Prompt',
      description: 'Template variables: {{memories}}, {{memoryCount}}.',
      rows: 8,
    },
    minMemories: { type: 'number', default: 2, label: 'Minimum Memories' },
    maxWords: { type: 'number', default: 90, label: 'Maximum Reflection Words' },
  },
  description: 'Builds a persona-aware, evidence-bounded reflection prompt and fails closed without persona or multiple memories',
  execute,
})
