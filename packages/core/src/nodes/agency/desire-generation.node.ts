import { callLLM, type RouterMessage } from '../../model-router.js'
import {
  DESIRE_SOURCE_WEIGHTS,
  type Desire,
  type DesireCandidate,
  type DesireGeneratorInputs,
  type DesireSource,
} from '../../agency/types.js'
import { defineNode, type NodeDefinition, type NodeExecutionContext } from '../types.js'

const DESIRE_SOURCES = new Set<DesireSource>([
  'persona_goal', 'urgent_task', 'task', 'help_ticket', 'memory_pattern',
  'curiosity', 'reflection', 'dream', 'tool_suggestion',
])
const DESIRE_RISKS = new Set(['none', 'low', 'medium', 'high', 'critical'])

const GENERATION_SYSTEM_PROMPT = `You are the Agency module of MetaHuman OS, responsible for identifying what the system genuinely wants to do based on accumulated experiences, goals, and insights.

A desire is not just a task - it is a motivated intention with a clear reason.

Guidelines:
- Focus on desires actionable within the system's capabilities.
- Prefer desires aligned with persona goals.
- Pay special attention to recurring detected memory patterns.
- Avoid duplicating active desires.
- Return only 0-5 genuine desires.
- Risk must be none, low, medium, high, or critical.`

const REINFORCEMENT_SYSTEM_PROMPT = `Review existing desires against current experiences. A desire is reinforced only when supplied memories, tasks, goals, reflections, or dreams genuinely make it more relevant. Be selective and return only exact supplied desire IDs.`

export interface DesireGenerationNodeDependencies {
  callModel: typeof callLLM
}

const DEFAULT_DEPENDENCIES: DesireGenerationNodeDependencies = { callModel: callLLM }

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function throwIfAborted(context: NodeExecutionContext): void {
  const signal = (context.abortSignal ?? context.signal) as AbortSignal | undefined
  if (!signal?.aborted) return
  if (signal.reason instanceof Error) throw signal.reason
  throw new DOMException('Desire Generator cancelled', 'AbortError')
}

function parseJsonArray(content: string, label: string): unknown[] {
  const match = content.match(/\[[\s\S]*\]/)
  if (!match) throw new Error(`${label} response did not contain a JSON array`)
  try {
    const parsed = JSON.parse(match[0])
    if (!Array.isArray(parsed)) throw new Error('response must be an array')
    return parsed
  } catch (error) {
    throw new Error(`${label} response was not valid JSON: ${(error as Error).message}`)
  }
}

export function parseDesireCandidates(content: string): DesireCandidate[] {
  return parseJsonArray(content, 'Desire generation').map((candidate, index) => {
    if (!isRecord(candidate)
      || typeof candidate.title !== 'string' || !candidate.title.trim()
      || typeof candidate.description !== 'string' || !candidate.description.trim()
      || typeof candidate.reason !== 'string' || !candidate.reason.trim()
      || typeof candidate.source !== 'string' || !DESIRE_SOURCES.has(candidate.source as DesireSource)
      || typeof candidate.risk !== 'string' || !DESIRE_RISKS.has(candidate.risk)
      || typeof candidate.suggestedAction !== 'string' || !candidate.suggestedAction.trim()
      || (candidate.sourceId !== undefined && typeof candidate.sourceId !== 'string')) {
      throw new Error(`Desire candidate ${index} is missing required typed fields`)
    }
    return candidate as unknown as DesireCandidate
  })
}

export function parseReinforcementResponse(
  content: string,
  validDesireIds: Set<string>,
): Array<{ id: string; reason: string }> {
  const seen = new Set<string>()
  return parseJsonArray(content, 'Desire reinforcement').map((item, index) => {
    if (!isRecord(item) || typeof item.id !== 'string' || !validDesireIds.has(item.id)
      || typeof item.reason !== 'string' || !item.reason.trim()) {
      throw new Error(`Desire reinforcement ${index} is invalid`)
    }
    if (seen.has(item.id)) throw new Error(`Duplicate reinforcement for desire ${item.id}`)
    seen.add(item.id)
    return { id: item.id, reason: item.reason.trim() }
  })
}

export function validateCandidateSources(
  candidates: DesireCandidate[],
  inputs: DesireGeneratorInputs,
): DesireCandidate[] {
  const available = new Set<DesireSource>()
  if (inputs.personaGoals.length > 0) available.add('persona_goal')
  if (inputs.urgentTasks.length > 0) available.add('urgent_task')
  if (inputs.activeTasks.length > 0) available.add('task')
  if (inputs.memoryPatterns.length > 0) available.add('memory_pattern')
  if (inputs.pendingCuriosityQuestions.length > 0) available.add('curiosity')
  if (inputs.recentReflections.length > 0) available.add('reflection')
  if (inputs.recentDreams.length > 0) available.add('dream')
  for (const candidate of candidates) {
    if (!available.has(candidate.source)) {
      throw new Error(`Desire candidate source '${candidate.source}' has no corresponding input`)
    }
  }
  return candidates
}

function requireInputs(value: unknown): DesireGeneratorInputs {
  if (!isRecord(value)) throw new Error('Desire Generator requires gathered inputs')
  const arrays = [
    'personaGoals', 'urgentTasks', 'activeTasks', 'recentMemories', 'memoryPatterns',
    'pendingCuriosityQuestions', 'recentReflections', 'recentDreams',
    'recentlyRejected', 'activeDesires',
  ]
  for (const key of arrays) {
    if (!Array.isArray(value[key])) throw new Error(`Desire Generator inputs.${key} must be an array`)
  }
  return value as unknown as DesireGeneratorInputs
}

function formatGenerationInputs(inputs: DesireGeneratorInputs): string {
  const sections: string[] = []
  if (inputs.personaGoals.length > 0) sections.push(`### Persona Goals (Weight: ${DESIRE_SOURCE_WEIGHTS.persona_goal})\n${inputs.personaGoals.map(goal => `- [${goal.priority}] ${goal.goal} (${goal.status})`).join('\n')}`)
  if (inputs.urgentTasks.length > 0) sections.push(`### Urgent Tasks (Weight: ${DESIRE_SOURCE_WEIGHTS.urgent_task})\n${inputs.urgentTasks.map(task => `- [${task.priority}] ${task.title}${task.description ? `: ${task.description.slice(0, 100)}` : ''}`).join('\n')}`)
  if (inputs.activeTasks.length > 0) sections.push(`### Active Tasks (Weight: ${DESIRE_SOURCE_WEIGHTS.task})\n${inputs.activeTasks.slice(0, 10).map(task => `- ${task.title}`).join('\n')}`)
  if (inputs.recentMemories.length > 0) sections.push(`### Recent Memories\n${inputs.recentMemories.slice(0, 10).map(memory => `- [${memory.type || 'observation'}] ${memory.content.slice(0, 100)}...`).join('\n')}`)
  if (inputs.memoryPatterns.length > 0) sections.push(`### Detected Memory Patterns (Weight: ${DESIRE_SOURCE_WEIGHTS.memory_pattern})\n${inputs.memoryPatterns.map(pattern => `- ${pattern.description} (appears in ${pattern.relatedMemoryIds.length} memories)`).join('\n')}`)
  if (inputs.pendingCuriosityQuestions.length > 0) sections.push(`### Unanswered Questions (Weight: ${DESIRE_SOURCE_WEIGHTS.curiosity})\n${inputs.pendingCuriosityQuestions.map(question => `- ${question.question}`).join('\n')}`)
  if (inputs.recentReflections.length > 0) sections.push(`### Recent Reflections (Weight: ${DESIRE_SOURCE_WEIGHTS.reflection})\n${inputs.recentReflections.map(reflection => `- ${reflection.content.slice(0, 150)}...`).join('\n')}`)
  if (inputs.recentDreams.length > 0) sections.push(`### Recent Dreams (Weight: ${DESIRE_SOURCE_WEIGHTS.dream})\n${inputs.recentDreams.map(dream => `- ${dream.content.slice(0, 100)}...`).join('\n')}`)
  if (inputs.activeDesires.length > 0) sections.push(`### Already Active Desires (avoid duplicates)\n${inputs.activeDesires.map(desire => `- ${desire.title} [${desire.source}]`).join('\n')}`)
  if (inputs.recentlyRejected.length > 0) sections.push(`### Recently Rejected\n${inputs.recentlyRejected.map(desire => `- ${desire.title}`).join('\n')}`)
  return sections.join('\n\n')
}

function formatReinforcementInputs(inputs: DesireGeneratorInputs): string[] {
  const sections: string[] = []
  if (inputs.personaGoals.length > 0) sections.push(`Goals: ${inputs.personaGoals.map(goal => goal.goal).join('; ')}`)
  if (inputs.urgentTasks.length > 0) sections.push(`Urgent tasks: ${inputs.urgentTasks.map(task => task.title).join('; ')}`)
  if (inputs.activeTasks.length > 0) sections.push(`Tasks: ${inputs.activeTasks.slice(0, 5).map(task => task.title).join('; ')}`)
  if (inputs.recentMemories.length > 0) sections.push(`Recent memories: ${inputs.recentMemories.slice(0, 5).map(memory => memory.content.slice(0, 80)).join('; ')}`)
  if (inputs.recentReflections.length > 0) sections.push(`Reflections: ${inputs.recentReflections.slice(0, 3).map(reflection => reflection.content.slice(0, 80)).join('; ')}`)
  if (inputs.recentDreams.length > 0) sections.push(`Dreams: ${inputs.recentDreams.slice(0, 2).map(dream => dream.content.slice(0, 80)).join('; ')}`)
  return sections
}

const inputExecute = async (_inputs: Record<string, unknown>, context: NodeExecutionContext) => {
  const value = context.desireGeneratorInput
  if (!isRecord(value)) throw new Error('Desire Generator graph requires canonical agent input')
  if (value.operation !== 'generate' && value.operation !== 'reinforce') {
    throw new Error('Desire Generator operation must be generate or reinforce')
  }
  if (!Array.isArray(value.existingDesires)) {
    throw new Error('Desire Generator existingDesires must be an array')
  }
  return {
    operation: value.operation,
    inputs: requireInputs(value.inputs),
    existingDesires: value.existingDesires,
  }
}

export async function executeDesireGeneration(
  inputs: Record<string, unknown>,
  context: NodeExecutionContext,
  properties: Record<string, unknown> = {},
  dependencies: DesireGenerationNodeDependencies = DEFAULT_DEPENDENCIES,
): Promise<Record<string, unknown>> {
  throwIfAborted(context)
  const operation = inputs.operation
  if (operation !== 'generate' && operation !== 'reinforce') {
    throw new Error('Desire Generator received an invalid operation')
  }
  const gathered = requireInputs(inputs.inputs)
  const existingDesires = Array.isArray(inputs.existingDesires)
    ? inputs.existingDesires as Desire[]
    : []
  const userId = typeof context.userId === 'string' ? context.userId : context.username

  if (operation === 'reinforce') {
    const currentInputs = formatReinforcementInputs(gathered)
    if (existingDesires.length === 0 || currentInputs.length === 0) {
      return { operation, reinforcements: [] }
    }
    const desires = existingDesires
      .map(desire => `- [${desire.id}] "${desire.title}" (strength: ${desire.strength.toFixed(2)}, source: ${desire.source})`)
      .join('\n')
    const messages: RouterMessage[] = [
      {
        role: 'system',
        content: typeof properties.reinforcementSystemPrompt === 'string'
          ? properties.reinforcementSystemPrompt
          : REINFORCEMENT_SYSTEM_PROMPT,
      },
      {
        role: 'user',
        content: `Existing desires:\n${desires}\n\nCurrent inputs:\n${currentInputs.join('\n')}\n\nReturn JSON only: [{"id":"exact-id","reason":"brief evidence-backed reason"}]. Return [] when none are genuinely reinforced.`,
      },
    ]
    const response = await dependencies.callModel({
      role: 'persona',
      messages,
      userId,
      cognitiveMode: context.cognitiveMode,
      options: { temperature: 0.3, responseFormat: 'json' },
      onProgress: context.emitProgress,
    })
    throwIfAborted(context)
    if (!response.content) throw new Error('Desire reinforcement model returned no content')
    return {
      operation,
      reinforcements: parseReinforcementResponse(
        response.content,
        new Set(existingDesires.map(desire => desire.id)),
      ),
    }
  }

  const formatted = formatGenerationInputs(gathered)
  if (!formatted.trim()) return { operation, candidates: [] }
  const messages: RouterMessage[] = [
    {
      role: 'system',
      content: typeof properties.generationSystemPrompt === 'string'
        ? properties.generationSystemPrompt
        : GENERATION_SYSTEM_PROMPT,
    },
    {
      role: 'user',
      content: `Current context:\n\n${formatted}\n\nReturn only a JSON array with 0-5 objects containing title, description, reason, source, optional sourceId, risk, and suggestedAction.`,
    },
  ]
  const response = await dependencies.callModel({
    role: 'persona',
    messages,
    userId,
    cognitiveMode: context.cognitiveMode,
    options: { temperature: 0.6, responseFormat: 'json' },
    onProgress: context.emitProgress,
  })
  throwIfAborted(context)
  if (!response.content) throw new Error('Desire generation model returned no content')
  return {
    operation,
    candidates: validateCandidateSources(parseDesireCandidates(response.content), gathered),
  }
}

export const DesireGenerationInputNode: NodeDefinition = defineNode({
  id: 'desire_generation_input',
  name: 'Desire Generation Input',
  category: 'agency',
  inputs: [],
  outputs: [
    { name: 'operation', type: 'string' },
    { name: 'inputs', type: 'object' },
    { name: 'existingDesires', type: 'array' },
  ],
  properties: {},
  description: 'Accepts gathered Agency inputs from the canonical Desire Generator agent',
  execute: inputExecute,
})

export const DesireGenerationNode: NodeDefinition = defineNode({
  id: 'desire_generation',
  name: 'Generate or Reinforce Desires',
  category: 'agency',
  inputs: [
    { name: 'operation', type: 'string' },
    { name: 'inputs', type: 'object' },
    { name: 'existingDesires', type: 'array' },
  ],
  outputs: [
    { name: 'operation', type: 'string' },
    { name: 'candidates', type: 'array', optional: true },
    { name: 'reinforcements', type: 'array', optional: true },
  ],
  properties: {
    generationSystemPrompt: GENERATION_SYSTEM_PROMPT,
    reinforcementSystemPrompt: REINFORCEMENT_SYSTEM_PROMPT,
  },
  propertySchemas: {
    generationSystemPrompt: {
      type: 'text_multiline',
      default: GENERATION_SYSTEM_PROMPT,
      label: 'Generation Instruction',
      rows: 12,
    },
    reinforcementSystemPrompt: {
      type: 'text_multiline',
      default: REINFORCEMENT_SYSTEM_PROMPT,
      label: 'Reinforcement Instruction',
      rows: 8,
    },
  },
  description: 'Runs the selected Desire Generator cognition stage through the profile model router',
  execute: executeDesireGeneration,
})
