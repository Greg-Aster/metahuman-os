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
import { ROOT, systemPaths } from '../path-builder.js'
import type { CategoryCoverage, Question, Session } from './session-manager.js'

interface GeneratorConfig {
  maxQuestionsPerSession: number
  requireMinimumAnswers: number
  targetCategoryCompletionPercentage: number
  categories: string[]
}

function loadConfig(): GeneratorConfig {
  const parsed = JSON.parse(
    fs.readFileSync(path.join(systemPaths.etc, 'persona-generator.json'), 'utf8'),
  ) as Record<string, unknown>
  const defaults = parsed.sessionDefaults as Record<string, unknown> | undefined
  if (!Number.isInteger(parsed.maxQuestionsPerSession) || Number(parsed.maxQuestionsPerSession) < 1
    || !Number.isInteger(parsed.requireMinimumAnswers) || Number(parsed.requireMinimumAnswers) < 1
    || !Number.isInteger(defaults?.targetCategoryCompletionPercentage)
    || Number(defaults?.targetCategoryCompletionPercentage) < 1
    || Number(defaults?.targetCategoryCompletionPercentage) > 100
    || !Array.isArray(parsed.categories) || parsed.categories.length === 0
    || parsed.categories.some(value => typeof value !== 'string' || !value.trim())) {
    throw new Error('Persona generator configuration is invalid')
  }
  return {
    maxQuestionsPerSession: Number(parsed.maxQuestionsPerSession),
    requireMinimumAnswers: Number(parsed.requireMinimumAnswers),
    targetCategoryCompletionPercentage: Number(defaults?.targetCategoryCompletionPercentage),
    categories: parsed.categories as string[],
  }
}

function loadInterviewerProfile(): Record<string, unknown> {
  const parsed = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'persona', 'profiles', 'psychotherapist.json'), 'utf8'),
  )
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Psychotherapist interviewer profile is invalid')
  }
  return parsed as Record<string, unknown>
}

function identifyCategoryGaps(coverage: CategoryCoverage, target: number): string[] {
  return Object.entries(coverage)
    .filter(([, percentage]) => percentage < target)
    .map(([category]) => category)
}

function checkIfComplete(session: Session, config: GeneratorConfig): boolean {
  if (session.questions.length >= config.maxQuestionsPerSession) return true
  if (session.answers.length < config.requireMinimumAnswers) return false
  return Object.values(session.categoryCoverage)
    .every(percentage => percentage >= config.targetCategoryCompletionPercentage)
}

export async function generateNextQuestion(
  session: Session,
  signal?: AbortSignal,
): Promise<{ question: Question; reasoning: string } | null> {
  const config = loadConfig()
  if (checkIfComplete(session, config)) return null
  const activeUser = getUserContext()
  if (!activeUser || activeUser.userId !== session.userId
    || (activeUser.username !== session.username && activeUser.activeProfile !== session.username)) {
    throw new Error('Persona question generation requires the owning authenticated user context')
  }
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
      interviewerProfile: loadInterviewerProfile(),
      categoryGaps: identifyCategoryGaps(
        session.categoryCoverage,
        config.targetCategoryCompletionPercentage,
      ),
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
  if (!question?.id || !question.prompt || !config.categories.includes(question.category)
    || typeof output.reasoning !== 'string' || !output.reasoning.trim()) {
    throw new Error('Persona interview question graph returned an invalid result')
  }
  return { question, reasoning: output.reasoning.trim() }
}

export function getCompletionStatus(session: Session): {
  isComplete: boolean
  progress: CategoryCoverage
  questionsRemaining: number
  message: string
} {
  const config = loadConfig()
  const isComplete = checkIfComplete(session, config)
  const gaps = identifyCategoryGaps(
    session.categoryCoverage,
    config.targetCategoryCompletionPercentage,
  )
  let message: string
  if (isComplete) {
    message = 'Interview complete! All categories have sufficient coverage.'
  } else if (session.questions.length >= config.maxQuestionsPerSession) {
    message = 'Maximum questions reached.'
  } else if (gaps.length > 0) {
    message = `Still exploring: ${gaps.slice(0, 2).join(', ')}`
  } else {
    message = 'Building deeper understanding...'
  }
  return {
    isComplete,
    progress: session.categoryCoverage,
    questionsRemaining: Math.max(0, config.maxQuestionsPerSession - session.questions.length),
    message,
  }
}
