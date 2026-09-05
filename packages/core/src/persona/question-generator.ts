/** Graph-backed adaptive question generation for persona interviews. */

import fs from 'node:fs'
import path from 'node:path'

import { getUserContext } from '../context.js'
import {
  cognitiveGraphPath,
  loadGraphFile,
  requireGraphNodeOutput,
  runGraph,
} from '../graph-runtime.js'
import { systemPaths } from '../path-builder.js'
import { storageClient } from '../storage-client.js'
import {
  PERSONA_INTERVIEW_CATEGORIES,
  findPendingPersonaQuestion,
  getPersonaInterviewCategoryGaps,
  selectPersonaInterviewCategory,
  type CategoryCoverage,
  type PersonaCategory,
  type Question,
  type Session,
} from './session-manager.js'

export interface PersonaInterviewConfig {
  version: string
  description: string
  maxQuestionsPerSession: number
  requireMinimumAnswers: number
  categories: PersonaCategory[]
  categoryDescriptions: Record<PersonaCategory, string>
  interviewer: {
    corePhilosophy: string
    tone: string
  }
  privacyGuidelines: string[]
  interviewingTechniques: Record<string, boolean>
  sessionDefaults: {
    minAnswerLength: number
    maxAnswerLength: number
    targetCategoryCompletionPercentage: number
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function integer(value: unknown, minimum: number, maximum: number, field: string): number {
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`${field} must be an integer between ${minimum} and ${maximum}`)
  }
  return Number(value)
}

function stringArray(value: unknown, field: string, maximumItems: number): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > maximumItems
    || value.some(item => typeof item !== 'string' || !item.trim() || item.length > 500)) {
    throw new Error(`${field} must be a bounded non-empty string array`)
  }
  return value.map(item => item.trim())
}

export function parsePersonaInterviewConfig(value: unknown): PersonaInterviewConfig {
  if (!isRecord(value)) throw new Error('Persona generator configuration must be an object')
  const defaults = value.sessionDefaults
  const descriptions = value.categoryDescriptions
  const interviewer = value.interviewer
  const techniques = value.interviewingTechniques
  if (!isRecord(defaults) || !isRecord(descriptions) || !isRecord(interviewer) || !isRecord(techniques)) {
    throw new Error('Persona generator configuration is missing required sections')
  }

  const rawCategories = stringArray(value.categories, 'categories', PERSONA_INTERVIEW_CATEGORIES.length)
  const supported = new Set<string>(PERSONA_INTERVIEW_CATEGORIES)
  if (rawCategories.some(category => !supported.has(category))
    || new Set(rawCategories).size !== rawCategories.length) {
    throw new Error('Persona generator categories must be unique supported persona categories')
  }
  const categories = rawCategories as PersonaCategory[]
  const categoryDescriptions = Object.fromEntries(categories.map(category => {
    const description = descriptions[category]
    if (typeof description !== 'string' || !description.trim() || description.length > 500) {
      throw new Error(`Persona generator categoryDescriptions.${category} is invalid`)
    }
    return [category, description.trim()]
  })) as Record<PersonaCategory, string>

  const maxQuestionsPerSession = integer(value.maxQuestionsPerSession, 1, 50, 'maxQuestionsPerSession')
  const requireMinimumAnswers = integer(value.requireMinimumAnswers, 1, maxQuestionsPerSession, 'requireMinimumAnswers')
  const minAnswerLength = integer(defaults.minAnswerLength, 1, 10_000, 'sessionDefaults.minAnswerLength')
  const maxAnswerLength = integer(defaults.maxAnswerLength, minAnswerLength, 10_000, 'sessionDefaults.maxAnswerLength')
  const targetCategoryCompletionPercentage = integer(
    defaults.targetCategoryCompletionPercentage,
    1,
    100,
    'sessionDefaults.targetCategoryCompletionPercentage',
  )
  if (typeof value.version !== 'string' || !value.version.trim() || value.version.length > 50
    || typeof value.description !== 'string' || !value.description.trim() || value.description.length > 500
    || typeof interviewer.corePhilosophy !== 'string' || !interviewer.corePhilosophy.trim()
    || interviewer.corePhilosophy.length > 1_000
    || typeof interviewer.tone !== 'string' || !interviewer.tone.trim() || interviewer.tone.length > 500) {
    throw new Error('Persona generator metadata and interviewer policy are invalid')
  }
  const techniqueEntries = Object.entries(techniques)
  if (techniqueEntries.length === 0 || techniqueEntries.length > 20) {
    throw new Error('Persona generator requires a bounded set of interviewing techniques')
  }
  const normalizedTechniques = Object.fromEntries(techniqueEntries.map(([name, enabled]) => {
    if (!name.trim() || name.length > 100 || typeof enabled !== 'boolean') {
      throw new Error('Persona generator interviewingTechniques must contain boolean flags')
    }
    return [name, enabled]
  }))

  return {
    version: value.version.trim(),
    description: value.description.trim(),
    maxQuestionsPerSession,
    requireMinimumAnswers,
    categories,
    categoryDescriptions,
    interviewer: {
      corePhilosophy: interviewer.corePhilosophy.trim(),
      tone: interviewer.tone.trim(),
    },
    privacyGuidelines: stringArray(value.privacyGuidelines, 'privacyGuidelines', 20),
    interviewingTechniques: normalizedTechniques,
    sessionDefaults: { minAnswerLength, maxAnswerLength, targetCategoryCompletionPercentage },
  }
}

export function normalizePersonaInterviewConfig(
  value: unknown,
  systemDefault: PersonaInterviewConfig,
): PersonaInterviewConfig {
  if (isRecord(value) && value.version === '1.0.0' && !isRecord(value.interviewer)) {
    return parsePersonaInterviewConfig({
      ...value,
      version: systemDefault.version,
      interviewer: systemDefault.interviewer,
    })
  }
  return parsePersonaInterviewConfig(value)
}

function loadSystemPersonaInterviewConfig(): PersonaInterviewConfig {
  const raw = JSON.parse(fs.readFileSync(path.join(systemPaths.etc, 'persona-generator.json'), 'utf8'))
  return parsePersonaInterviewConfig(raw)
}

function configRequest(username: string) {
  return {
    username,
    category: 'config' as const,
    subcategory: 'etc',
    relativePath: 'persona-generator.json',
  }
}

async function persistConfig(username: string, config: PersonaInterviewConfig): Promise<void> {
  const result = await storageClient.write({
    ...configRequest(username),
    data: JSON.stringify(config, null, 2),
    encoding: 'utf8',
  })
  if (!result.success) {
    throw new Error(`Cannot persist persona generator configuration: ${result.error || 'unknown error'}`)
  }
}

export async function loadPersonaInterviewConfig(username: string): Promise<PersonaInterviewConfig> {
  const result = await storageClient.read({ ...configRequest(username), encoding: 'utf8' })
  let raw: unknown
  if (!result.success) {
    if (!result.error?.startsWith('File not found:')) {
      throw new Error(`Cannot load persona generator configuration: ${result.error || 'unknown error'}`)
    }
    const seeded = loadSystemPersonaInterviewConfig()
    await persistConfig(username, seeded)
    return seeded
  }
  try {
    raw = JSON.parse(String(result.data))
  } catch (error) {
    throw new Error(`Persona generator configuration is not valid JSON: ${(error as Error).message}`)
  }
  const config = isRecord(raw) && raw.version === '1.0.0' && !isRecord(raw.interviewer)
    ? normalizePersonaInterviewConfig(raw, loadSystemPersonaInterviewConfig())
    : parsePersonaInterviewConfig(raw)
  if (JSON.stringify(raw) !== JSON.stringify(config)) await persistConfig(username, config)
  return config
}

function completionReason(
  session: Session,
  config: PersonaInterviewConfig,
): 'maximum' | 'coverage' | null {
  if (findPendingPersonaQuestion(session)) return null
  if (session.questions.length >= config.maxQuestionsPerSession) return 'maximum'
  if (session.answers.length < config.requireMinimumAnswers) return null
  return getPersonaInterviewCategoryGaps(session, config).length === 0 ? 'coverage' : null
}

export async function generateNextQuestion(
  session: Session,
  signal?: AbortSignal,
): Promise<{ question: Question; reasoning: string } | null> {
  const activeUser = getUserContext()
  if (!activeUser || activeUser.userId !== session.userId
    || (activeUser.username !== session.username && activeUser.activeProfile !== session.username)) {
    throw new Error('Persona question generation requires the owning authenticated user context')
  }
  const config = await loadPersonaInterviewConfig(session.username)
  if (findPendingPersonaQuestion(session)) {
    throw new Error('The current persona interview question must be answered before generating another')
  }
  if (completionReason(session, config)) return null
  const targetCategory = selectPersonaInterviewCategory(session, config)
  const loaded = await loadGraphFile(cognitiveGraphPath('persona-interview-question.json'), {
    cacheKey: 'persona-interview-question',
    logPrefix: '[persona-question-generator]',
  })
  if (!loaded) throw new Error('Persona interview question graph is unavailable')
  const state = await runGraph({
    graph: loaded.graph,
    signal,
    context: {
      userId: activeUser.userId,
      username: session.username,
      session,
      generatorConfig: config,
      targetCategory,
      cognitiveMode: 'agent',
      allowMemoryWrites: false,
      recordPersonaMemory: false,
      abortSignal: signal,
    },
  })
  if (state.status !== 'completed') {
    throw new Error(`Persona interview question graph ended with status ${state.status}`)
  }
  const output = requireGraphNodeOutput(state, 'persona_interview_question')
  const question = output.question as Question | undefined
  if (!question?.id || !question.prompt || question.category !== targetCategory
    || typeof output.reasoning !== 'string' || !output.reasoning.trim()) {
    throw new Error('Persona interview question graph returned an invalid result')
  }
  return { question, reasoning: output.reasoning.trim() }
}

export function evaluatePersonaInterviewCompletion(
  session: Session,
  config: PersonaInterviewConfig,
): {
  isComplete: boolean
  progress: CategoryCoverage
  questionsRemaining: number
  message: string
} {
  const reason = completionReason(session, config)
  const gaps = getPersonaInterviewCategoryGaps(session, config)
  const message = reason === 'maximum'
    ? 'Maximum questions reached.'
    : reason === 'coverage'
      ? 'Interview complete! All configured categories have sufficient coverage.'
      : gaps.length > 0
        ? `Still exploring: ${gaps.slice(0, 2).join(', ')}`
        : 'Building deeper understanding...'
  return {
    isComplete: reason !== null,
    progress: session.categoryCoverage,
    questionsRemaining: Math.max(0, config.maxQuestionsPerSession - session.questions.length),
    message,
  }
}

export async function getCompletionStatus(session: Session): Promise<{
  isComplete: boolean
  progress: CategoryCoverage
  questionsRemaining: number
  message: string
}> {
  return evaluatePersonaInterviewCompletion(session, await loadPersonaInterviewConfig(session.username))
}
