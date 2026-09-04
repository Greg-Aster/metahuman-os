import { callLLM } from '../../model-router.js'
import { defineNode, type NodeDefinition, type NodeExecutionContext, type NodeExecutor } from '../types.js'

export interface ChatMessage {
  role: string
  content: string
}

export interface BigFive {
  openness?: number
  conscientiousness?: number
  extraversion?: number
  agreeableness?: number
  neuroticism?: number
}

export interface CoreValue {
  priority: number
  value: string
  description: string
}

export interface CommunicationStyle {
  tone?: string[]
  vocabulary?: string[]
  preferredPronouns?: string[]
}

export interface PersonaGoals {
  shortTerm?: string[]
  midTerm?: string[]
  longTerm?: string[]
}

export interface PersonaDraft {
  bigFive?: BigFive
  values?: CoreValue[]
  communicationStyle?: CommunicationStyle
  interests?: string[]
  goals?: PersonaGoals
  background?: string
  currentFocus?: string[]
  confidence?: {
    overall: number
    categories: Record<string, number>
  }
}

export interface PersonaProfileExtractorDependencies {
  callModel: typeof callLLM
}

const DEFAULT_DEPENDENCIES: PersonaProfileExtractorDependencies = { callModel: callLLM }
const MAX_MESSAGES = 100
const MAX_MESSAGE_CHARS = 10_000
const ALLOWED_DRAFT_KEYS = new Set([
  'bigFive', 'values', 'communicationStyle', 'interests', 'goals', 'background', 'currentFocus',
])
const BIG_FIVE_KEYS = new Set([
  'openness', 'conscientiousness', 'extraversion', 'agreeableness', 'neuroticism',
])
const COMMUNICATION_STYLE_KEYS = new Set(['tone', 'vocabulary', 'preferredPronouns'])
const GOAL_KEYS = new Set(['shortTerm', 'midTerm', 'longTerm'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function validateMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_MESSAGES) {
    throw new Error(`Persona transcript requires 1-${MAX_MESSAGES} messages`)
  }
  return value.map((message, index) => {
    if (!isRecord(message)
      || typeof message.role !== 'string' || !message.role.trim()
      || typeof message.content !== 'string' || !message.content.trim()
      || message.content.length > MAX_MESSAGE_CHARS) {
      throw new Error(`Persona transcript message ${index + 1} is invalid`)
    }
    return { role: message.role.trim(), content: message.content.trim() }
  })
}

function boundedStrings(value: unknown, field: string, limit: number): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > limit || value.some(item => typeof item !== 'string')) {
    throw new Error(`Persona draft ${field} must be a bounded string array`)
  }
  return value.map(item => item.trim()).filter(Boolean)
}

function calculateConfidence(draft: PersonaDraft): PersonaDraft['confidence'] {
  const categories: Record<string, number> = {
    personality: 0,
    values: 0,
    goals: 0,
    style: 0,
    background: 0,
  }
  if (draft.bigFive) {
    const scores = Object.values(draft.bigFive).filter(value => value !== undefined)
    categories.personality = Math.min(100, (scores.length / 5) * 100)
  }
  if (draft.interests?.length) categories.personality = Math.max(categories.personality, 50)
  if (draft.values?.length) categories.values = Math.min(100, (draft.values.length / 3) * 100)
  if (draft.goals) {
    const sections = [draft.goals.shortTerm, draft.goals.midTerm, draft.goals.longTerm]
      .filter(section => section?.length)
    categories.goals = Math.min(100, (sections.length / 3) * 100)
  }
  if (draft.communicationStyle) {
    const fields = [
      draft.communicationStyle.tone,
      draft.communicationStyle.vocabulary,
      draft.communicationStyle.preferredPronouns,
    ].filter(field => field?.length)
    categories.style = Math.min(100, (fields.length / 3) * 100)
  }
  if (draft.background || draft.currentFocus?.length) categories.background = 50
  if (draft.background && draft.currentFocus?.length) categories.background = 100
  return {
    overall: Math.round(
      Object.values(categories).reduce((sum, score) => sum + score, 0)
      / Object.keys(categories).length,
    ),
    categories,
  }
}

export function parsePersonaDraft(text: string): PersonaDraft {
  const json = text.match(/\{[\s\S]*\}/)?.[0]
  if (!json) throw new Error('Persona extraction response did not contain a JSON object')
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (error) {
    throw new Error(`Persona extraction response was not valid JSON: ${(error as Error).message}`)
  }
  if (!isRecord(parsed) || Object.keys(parsed).some(key => !ALLOWED_DRAFT_KEYS.has(key))) {
    throw new Error('Persona extraction response has an invalid top-level shape')
  }
  const bigFive = parsed.bigFive
  if (bigFive !== undefined) {
    if (!isRecord(bigFive) || Object.keys(bigFive).some(key => !BIG_FIVE_KEYS.has(key))) {
      throw new Error('Persona draft bigFive must contain only Big Five traits')
    }
    for (const value of Object.values(bigFive)) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
        throw new Error('Persona draft Big Five scores must be between 0 and 100')
      }
    }
  }
  let values: CoreValue[] | undefined
  if (parsed.values !== undefined) {
    if (!Array.isArray(parsed.values) || parsed.values.length > 10) {
      throw new Error('Persona draft values must be a bounded array')
    }
    values = parsed.values.map((value, index) => {
      if (!isRecord(value)
        || typeof value.priority !== 'number' || !Number.isInteger(value.priority)
        || typeof value.value !== 'string' || !value.value.trim()
        || typeof value.description !== 'string' || !value.description.trim()) {
        throw new Error(`Persona draft value ${index + 1} is invalid`)
      }
      return {
        priority: value.priority,
        value: value.value.trim(),
        description: value.description.trim(),
      }
    })
  }
  let communicationStyle: CommunicationStyle | undefined
  if (parsed.communicationStyle !== undefined) {
    if (!isRecord(parsed.communicationStyle)
      || Object.keys(parsed.communicationStyle).some(key => !COMMUNICATION_STYLE_KEYS.has(key))) {
      throw new Error('Persona draft communicationStyle has an invalid shape')
    }
    communicationStyle = {
      tone: boundedStrings(parsed.communicationStyle.tone, 'communicationStyle.tone', 10),
      vocabulary: boundedStrings(parsed.communicationStyle.vocabulary, 'communicationStyle.vocabulary', 10),
      preferredPronouns: boundedStrings(parsed.communicationStyle.preferredPronouns, 'communicationStyle.preferredPronouns', 10),
    }
  }
  let goals: PersonaGoals | undefined
  if (parsed.goals !== undefined) {
    if (!isRecord(parsed.goals) || Object.keys(parsed.goals).some(key => !GOAL_KEYS.has(key))) {
      throw new Error('Persona draft goals has an invalid shape')
    }
    goals = {
      shortTerm: boundedStrings(parsed.goals.shortTerm, 'goals.shortTerm', 20),
      midTerm: boundedStrings(parsed.goals.midTerm, 'goals.midTerm', 20),
      longTerm: boundedStrings(parsed.goals.longTerm, 'goals.longTerm', 20),
    }
  }
  if (parsed.background !== undefined
    && (typeof parsed.background !== 'string' || parsed.background.length > 5_000)) {
    throw new Error('Persona draft background must be a bounded string')
  }
  const interests = boundedStrings(parsed.interests, 'interests', 50)
  const currentFocus = boundedStrings(parsed.currentFocus, 'currentFocus', 50)
  const draft: PersonaDraft = {
    ...(bigFive ? { bigFive: bigFive as BigFive } : {}),
    ...(values ? { values } : {}),
    ...(communicationStyle ? { communicationStyle } : {}),
    ...(interests !== undefined ? { interests } : {}),
    ...(goals ? { goals } : {}),
    ...(typeof parsed.background === 'string' && parsed.background.trim()
      ? { background: parsed.background.trim() }
      : {}),
    ...(currentFocus !== undefined ? { currentFocus } : {}),
  }
  draft.confidence = calculateConfidence(draft)
  return draft
}

const executeInput: NodeExecutor = async (_inputs, context) => ({
  messages: validateMessages(context.messages),
})

function throwIfAborted(context: NodeExecutionContext): void {
  const signal = (context.abortSignal ?? context.signal) as AbortSignal | undefined
  if (!signal?.aborted) return
  if (signal.reason instanceof Error) throw signal.reason
  throw new DOMException('Persona extraction cancelled', 'AbortError')
}

export async function executePersonaProfileExtractor(
  inputs: Record<string, unknown>,
  context: NodeExecutionContext,
  _properties: Record<string, unknown> = {},
  dependencies: PersonaProfileExtractorDependencies = DEFAULT_DEPENDENCIES,
): Promise<Record<string, unknown>> {
  throwIfAborted(context)
  const messages = validateMessages(inputs.messages)
  const conversationText = messages.map(message => `${message.role}: ${message.content}`).join('\n\n')
  const response = await dependencies.callModel({
    role: 'curator',
    userId: typeof context.userId === 'string' ? context.userId : context.username,
    cognitiveMode: typeof context.cognitiveMode === 'string' ? context.cognitiveMode : undefined,
    messages: [
      {
        role: 'system',
        content: `Analyze the conversation and conservatively extract supported personality information. Return JSON only with these optional fields: bigFive (scores 0-100), values ({priority,value,description}[]), communicationStyle ({tone,vocabulary,preferredPronouns}), interests, goals ({shortTerm,midTerm,longTerm}), background, currentFocus. Use neutral Big Five scores when uncertain and do not infer unsupported facts.\n\nConversation:\n${conversationText}`,
      },
      { role: 'user', content: 'Extract the supported persona information.' },
    ],
    options: { temperature: 0.3, max_tokens: 2_000 },
  })
  throwIfAborted(context)
  const persona = parsePersonaDraft(response.content)
  return { persona, confidence: persona.confidence }
}

export const PersonaTranscriptInputNode: NodeDefinition = defineNode({
  id: 'persona_transcript_input',
  name: 'Persona Transcript Input',
  category: 'input',
  inputs: [],
  outputs: [{ name: 'messages', type: 'array' }],
  properties: {},
  description: 'Admits a bounded persona interview transcript from the authenticated caller',
  execute: executeInput,
})

export const PersonaProfileExtractorNode: NodeDefinition = defineNode({
  id: 'persona_profile_extractor',
  name: 'Extract Persona Profile',
  category: 'persona',
  inputs: [{ name: 'messages', type: 'array' }],
  outputs: [
    { name: 'persona', type: 'object' },
    { name: 'confidence', type: 'object' },
  ],
  properties: {},
  description: 'Extracts a validated persona draft from a graph-supplied interview transcript',
  execute: executePersonaProfileExtractor,
})
