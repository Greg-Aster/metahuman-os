import {
  callLLM,
  type RouterMessage,
} from '../../model-router.js'
import type { PersonaCore } from '../../identity.js'
import {
  validatePersonaLearningProposal,
  type PersonaLearningProposal,
} from '../../persona-learning.js'
import {
  validatePsychoanalyzerConfig,
  type PsychoanalyzerConfig,
} from '../../psychoanalyzer-config.js'
import { defineNode, type NodeDefinition, type NodeExecutionContext } from '../types.js'

const DEFAULT_INSTRUCTION = `You are the evidence-review stage of a persona learning system.

Review only the supplied user evidence. Propose the smallest set of durable persona changes supported by repeated or explicit evidence. Identity is protected and must never be changed. Do not infer a removal merely because an item is absent from recent evidence; removals require explicit contradiction, abandonment, or completion evidence.

Allowed paths and values:
- personality.traits: update only, value {"trait":"openness|conscientiousness|extraversion|agreeableness|neuroticism","score":0..1}
- personality.communicationStyle: add/remove a concise tone string
- personality.interests: add/remove a broad stable interest string
- values.core: add/remove a durable value string
- goals: add/remove an identity-level aspiration string, not a task or project
- context.domains: add/remove a broad life domain string
- context.currentFocus: add/remove a durable psychological focus string
- context.projects: add/remove a project name string
- decisionHeuristics: add {"signal":"...","response":"..."}; remove by exact signal string
- writingStyle.motifs: add/remove a concise motif string

Every change must cite one or more IDs from EVIDENCE. Return only valid JSON with this exact shape:
{"summary":"...","confidence":0.0,"changes":[{"operation":"add|remove|update","path":"allowed.path","value":"or allowed object","evidenceIds":["memory-id"],"reason":"..."}]}`

interface PsychoanalyzerMemoryInput {
  id: string
  timestamp: string
  type: string
  tags: string[]
  content: string
}

export interface PsychoanalyzerAnalysisDependencies {
  callModel: typeof callLLM
}

const DEFAULT_DEPENDENCIES: PsychoanalyzerAnalysisDependencies = { callModel: callLLM }

function throwIfAborted(context: NodeExecutionContext): void {
  const signal = (context.abortSignal ?? context.signal) as AbortSignal | undefined
  if (!signal?.aborted) return
  if (signal.reason instanceof Error) throw signal.reason
  throw new DOMException('Psychoanalyzer analysis cancelled', 'AbortError')
}

function learnablePersona(persona: PersonaCore): Record<string, unknown> {
  const source = persona as Record<string, any>
  return {
    personality: {
      traits: source.personality?.traits ?? {},
      communicationStyle: source.personality?.communicationStyle ?? {},
      interests: source.personality?.interests ?? [],
    },
    values: { core: source.values?.core ?? [] },
    goals: source.goals ?? {},
    context: source.context ?? {},
    decisionHeuristics: source.decisionHeuristics ?? [],
    writingStyle: { motifs: source.writingStyle?.motifs ?? [] },
  }
}

function parseMemories(value: unknown): PsychoanalyzerMemoryInput[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('Psychoanalyzer analysis requires evidence')
  }
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`Psychoanalyzer evidence ${index + 1} must be an object`)
    }
    const memory = item as Record<string, unknown>
    if (typeof memory.id !== 'string' || !memory.id.trim()
      || typeof memory.timestamp !== 'string' || Number.isNaN(Date.parse(memory.timestamp))
      || typeof memory.type !== 'string'
      || typeof memory.content !== 'string' || !memory.content.trim()
      || !Array.isArray(memory.tags) || memory.tags.some(tag => typeof tag !== 'string')) {
      throw new Error(`Psychoanalyzer evidence ${index + 1} is invalid`)
    }
    return {
      id: memory.id.trim(),
      timestamp: new Date(memory.timestamp).toISOString(),
      type: memory.type,
      tags: memory.tags as string[],
      content: memory.content.trim(),
    }
  })
}

function parseModelJson(content: string): unknown {
  const trimmed = content.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  try {
    return JSON.parse(fenced ? fenced[1] : trimmed)
  } catch (error) {
    throw new Error(`Psychoanalyzer model returned invalid JSON: ${(error as Error).message}`)
  }
}

export async function executePsychoanalyzerAnalysis(
  inputs: Record<string, unknown>,
  context: NodeExecutionContext,
  properties: Record<string, unknown> = {},
  dependencies: PsychoanalyzerAnalysisDependencies = DEFAULT_DEPENDENCIES,
): Promise<{ proposal: PersonaLearningProposal }> {
  throwIfAborted(context)
  const memories = parseMemories(inputs.memories)
  if (!inputs.persona || typeof inputs.persona !== 'object' || Array.isArray(inputs.persona)) {
    throw new Error('Psychoanalyzer analysis requires the active persona')
  }
  const persona = inputs.persona as PersonaCore
  const config: PsychoanalyzerConfig = validatePsychoanalyzerConfig(inputs.config)
  const instruction = typeof properties.instruction === 'string' && properties.instruction.trim()
    ? properties.instruction.trim()
    : DEFAULT_INSTRUCTION
  const evidence = memories.map(memory => ({
    id: memory.id,
    timestamp: memory.timestamp,
    type: memory.type,
    tags: memory.tags,
    content: memory.content,
  }))
  const messages: RouterMessage[] = [{
    role: 'user',
    content: `${instruction}\n\nCURRENT LEARNABLE PERSONA:\n${JSON.stringify(learnablePersona(persona), null, 2)}\n\nEVIDENCE:\n${JSON.stringify(evidence, null, 2)}`,
  }]
  const response = await dependencies.callModel({
    role: config.analysis.model,
    messages,
    userId: typeof context.userId === 'string' ? context.userId : context.username,
    cognitiveMode: context.cognitiveMode,
    options: {
      temperature: config.analysis.temperature,
      maxTokens: config.analysis.maxTokens,
    },
    keepAlive: 0,
    onProgress: context.emitProgress,
  })
  throwIfAborted(context)
  return {
    proposal: validatePersonaLearningProposal(
      parseModelJson(response.content),
      new Set(memories.map(memory => memory.id)),
    ),
  }
}

export const PsychoanalyzerAnalysisNode: NodeDefinition = defineNode({
  id: 'psychoanalyzer_analysis',
  name: 'Psychoanalyzer Analysis',
  category: 'agent',
  inputs: [
    { name: 'memories', type: 'array' },
    { name: 'persona', type: 'object' },
    { name: 'config', type: 'object' },
  ],
  outputs: [
    { name: 'proposal', type: 'object', description: 'Validated evidence-backed persona proposal' },
  ],
  properties: { instruction: DEFAULT_INSTRUCTION },
  propertySchemas: {
    instruction: {
      type: 'text_multiline',
      default: DEFAULT_INSTRUCTION,
      label: 'Analysis Instruction',
      rows: 20,
    },
  },
  description: 'Generates and validates one evidence-backed persona learning proposal',
  execute: executePsychoanalyzerAnalysis,
})
