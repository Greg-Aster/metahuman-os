import type { PersonaInterviewConfig } from '../../persona/question-generator.js'
import {
  PERSONA_INTERVIEW_CATEGORIES,
  findPendingPersonaQuestion,
  selectPersonaInterviewCategory,
  type PersonaCategory,
  type Question,
  type Session,
} from '../../persona/session-manager.js'
import { callLLM } from '../../model-router.js'
import { defineNode, type NodeDefinition, type NodeExecutionContext, type NodeExecutor } from '../types.js'

export interface PersonaInterviewQuestionDependencies {
  callModel: typeof callLLM
  now: () => Date
}

const DEFAULT_DEPENDENCIES: PersonaInterviewQuestionDependencies = {
  callModel: callLLM,
  now: () => new Date(),
}

const MAX_TRANSCRIPT_CHARACTERS = 48_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function validateConfig(value: unknown): PersonaInterviewConfig {
  if (!isRecord(value)
    || !Array.isArray(value.categories)
    || value.categories.length === 0
    || value.categories.some(category => (
      typeof category !== 'string'
      || !PERSONA_INTERVIEW_CATEGORIES.includes(category as PersonaCategory)
    ))
    || !isRecord(value.categoryDescriptions)
    || !isRecord(value.interviewer)
    || typeof value.interviewer.corePhilosophy !== 'string'
    || typeof value.interviewer.tone !== 'string'
    || !Array.isArray(value.privacyGuidelines)
    || value.privacyGuidelines.some(rule => typeof rule !== 'string')
    || !isRecord(value.interviewingTechniques)
    || !isRecord(value.sessionDefaults)
    || !Number.isInteger(value.maxQuestionsPerSession)
    || !Number.isInteger(value.sessionDefaults.minAnswerLength)
    || !Number.isInteger(value.sessionDefaults.maxAnswerLength)) {
    throw new Error('Persona Interview Input requires validated generator configuration')
  }
  return value as unknown as PersonaInterviewConfig
}

function validateSession(value: unknown, config: PersonaInterviewConfig): Session {
  if (!isRecord(value)
    || typeof value.sessionId !== 'string'
    || value.status !== 'active'
    || !Array.isArray(value.questions)
    || !Array.isArray(value.answers)
    || !isRecord(value.categoryCoverage)) {
    throw new Error('Persona Interview Input requires an active typed session')
  }
  const session = value as unknown as Session
  if (session.questions.length >= config.maxQuestionsPerSession) {
    throw new Error('Persona Interview Input cannot generate beyond the configured question limit')
  }
  const questionIds = new Set<string>()
  for (const question of session.questions) {
    if (!question?.id || questionIds.has(question.id)
      || !question.prompt?.trim() || question.prompt.length > 2_000
      || !PERSONA_INTERVIEW_CATEGORIES.includes(question.category)) {
      throw new Error('Persona Interview Input received invalid question history')
    }
    questionIds.add(question.id)
  }
  const answerIds = new Set<string>()
  let transcriptCharacters = session.questions.reduce((total, question) => total + question.prompt.length, 0)
  for (const answer of session.answers) {
    if (!answer?.questionId || answerIds.has(answer.questionId) || !questionIds.has(answer.questionId)
      || typeof answer.content !== 'string'
      || answer.content.trim().length < config.sessionDefaults.minAnswerLength
      || answer.content.trim().length > config.sessionDefaults.maxAnswerLength) {
      throw new Error('Persona Interview Input received invalid answer history')
    }
    answerIds.add(answer.questionId)
    transcriptCharacters += answer.content.length
  }
  if (findPendingPersonaQuestion(session)) {
    throw new Error('Persona Interview Input requires the current question to be answered first')
  }
  for (const category of PERSONA_INTERVIEW_CATEGORIES) {
    const coverage = session.categoryCoverage[category]
    if (!Number.isFinite(coverage) || coverage < 0 || coverage > 100) {
      throw new Error('Persona Interview Input received invalid category coverage')
    }
  }
  if (transcriptCharacters > MAX_TRANSCRIPT_CHARACTERS) {
    throw new Error('Persona interview transcript exceeds the supported generation context')
  }
  return session
}

function validateContext(context: NodeExecutionContext): {
  session: Session
  config: PersonaInterviewConfig
  targetCategory: PersonaCategory
} {
  const config = validateConfig(context.generatorConfig)
  const session = validateSession(context.session, config)
  const targetCategory = context.targetCategory
  if (typeof context.userId !== 'string' || !context.userId
    || typeof targetCategory !== 'string'
    || !config.categories.includes(targetCategory as PersonaCategory)) {
    throw new Error('Persona Interview Input requires an authenticated user and configured target category')
  }
  return { session, config, targetCategory: targetCategory as PersonaCategory }
}

const executeInput: NodeExecutor = async (_inputs, context) => validateContext(context)

function throwIfAborted(context: NodeExecutionContext): void {
  const signal = (context.abortSignal ?? context.signal) as AbortSignal | undefined
  if (!signal?.aborted) return
  if (signal.reason instanceof Error) throw signal.reason
  throw new DOMException('Persona interview question generation cancelled', 'AbortError')
}

function normalizedQuestion(prompt: string): string {
  return prompt
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

export function parsePersonaInterviewQuestion(
  text: string,
  categories: PersonaCategory[],
  targetCategory: PersonaCategory,
  priorPrompts: string[],
  questionNumber: number,
  now: Date,
): { question: Question; reasoning: string } {
  const json = text.match(/\{[\s\S]*\}/)?.[0]
  if (!json) throw new Error('Persona question response did not contain a JSON object')
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (error) {
    throw new Error(`Persona question response was not valid JSON: ${(error as Error).message}`)
  }
  if (!isRecord(parsed)
    || typeof parsed.question !== 'string' || !parsed.question.trim() || parsed.question.length > 2_000
    || typeof parsed.category !== 'string'
    || parsed.category !== targetCategory || !categories.includes(parsed.category as PersonaCategory)
    || typeof parsed.reasoning !== 'string' || !parsed.reasoning.trim() || parsed.reasoning.length > 2_000) {
    throw new Error('Persona question response is missing required typed fields or the requested category')
  }
  const prompt = parsed.question.trim()
  const normalizedPrompt = normalizedQuestion(prompt)
  if (priorPrompts.some(prior => normalizedQuestion(prior) === normalizedPrompt)) {
    throw new Error('Persona question response duplicates an earlier question')
  }
  return {
    question: {
      id: `q${questionNumber}`,
      prompt,
      category: targetCategory,
      generatedAt: now.toISOString(),
    },
    reasoning: parsed.reasoning.trim(),
  }
}

export async function executePersonaInterviewQuestion(
  inputs: Record<string, unknown>,
  context: NodeExecutionContext,
  _properties: Record<string, unknown> = {},
  dependencies: PersonaInterviewQuestionDependencies = DEFAULT_DEPENDENCIES,
): Promise<Record<string, unknown>> {
  throwIfAborted(context)
  const config = validateConfig(inputs.config)
  const session = validateSession(inputs.session, config)
  const targetCategory = inputs.targetCategory
  if (typeof targetCategory !== 'string'
    || !config.categories.includes(targetCategory as PersonaCategory)) {
    throw new Error('Persona Question Generator requires the configured target category')
  }
  const typedTarget = targetCategory as PersonaCategory
  if (typedTarget !== selectPersonaInterviewCategory(session, config)) {
    throw new Error('Persona Question Generator target does not match the canonical coverage policy')
  }
  const categoryDescription = config.categoryDescriptions[typedTarget]
  if (typeof categoryDescription !== 'string' || !categoryDescription.trim()) {
    throw new Error('Persona Question Generator requires a description for the target category')
  }
  const history = session.questions.flatMap(question => {
    const answer = session.answers.find(item => item.questionId === question.id)
    return answer
      ? [{ role: 'assistant' as const, content: question.prompt }, { role: 'user' as const, content: answer.content }]
      : [{ role: 'assistant' as const, content: question.prompt }]
  })
  const enabledTechniques = Object.entries(config.interviewingTechniques)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name)
  const systemPrompt = `Conduct one empathetic persona interview turn. Generate exactly one open-ended, non-leading question for the required category. Do not repeat an earlier question or ask for information prohibited by the privacy rules.

Required category: ${typedTarget}
Category purpose: ${categoryDescription}
Progress: ${session.questions.length}/${config.maxQuestionsPerSession} questions; ${session.answers.length} answers
Coverage: ${JSON.stringify(session.categoryCoverage)}
Interview philosophy: ${config.interviewer.corePhilosophy}
Tone: ${config.interviewer.tone}
Enabled techniques: ${enabledTechniques.join(', ')}
Privacy rules: ${JSON.stringify(config.privacyGuidelines)}

Return JSON only: {"question":"one open-ended question","category":"${typedTarget}","reasoning":"one sentence"}`
  const response = await dependencies.callModel({
    role: 'psychotherapist',
    userId: context.userId as string,
    cognitiveMode: typeof context.cognitiveMode === 'string' ? context.cognitiveMode : undefined,
    messages: [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'system', content: `Generate question ${session.questions.length + 1} now.` },
    ],
    options: { temperature: 0.7, format: 'json', max_tokens: 512 },
  })
  throwIfAborted(context)
  return parsePersonaInterviewQuestion(
    response.content,
    config.categories,
    typedTarget,
    session.questions.map(question => question.prompt),
    session.questions.length + 1,
    dependencies.now(),
  )
}

export const PersonaInterviewInputNode: NodeDefinition = defineNode({
  id: 'persona_interview_input',
  name: 'Persona Interview Input',
  category: 'input',
  inputs: [],
  outputs: [
    { name: 'session', type: 'object' },
    { name: 'config', type: 'object' },
    { name: 'targetCategory', type: 'string' },
  ],
  properties: {},
  description: 'Admits one authenticated persona interview, its canonical policy, and deterministic target category',
  execute: executeInput,
})

export const PersonaInterviewQuestionNode: NodeDefinition = defineNode({
  id: 'persona_interview_question',
  name: 'Generate Persona Interview Question',
  category: 'persona',
  inputs: [
    { name: 'session', type: 'object' },
    { name: 'config', type: 'object' },
    { name: 'targetCategory', type: 'string' },
  ],
  outputs: [
    { name: 'question', type: 'object' },
    { name: 'reasoning', type: 'string' },
  ],
  properties: {},
  description: 'Generates one typed, non-duplicate question for the selected persona category',
  execute: executePersonaInterviewQuestion,
})
