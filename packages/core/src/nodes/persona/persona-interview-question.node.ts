import type { Question, Session } from '../../persona/session-manager.js'
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function validateContext(context: NodeExecutionContext): {
  session: Session
  config: Record<string, unknown>
  profile: Record<string, unknown>
  gaps: string[]
} {
  const session = context.session as Session | undefined
  const config = context.generatorConfig
  const profile = context.interviewerProfile
  const gaps = context.categoryGaps
  if (!session?.sessionId || !Array.isArray(session.questions) || !Array.isArray(session.answers)) {
    throw new Error('Persona Interview Input requires a typed session')
  }
  if (!isRecord(config) || !Array.isArray(config.categories)
    || config.categories.some(value => typeof value !== 'string')) {
    throw new Error('Persona Interview Input requires validated generator configuration')
  }
  if (!isRecord(profile)) throw new Error('Persona Interview Input requires an interviewer profile')
  if (!Array.isArray(gaps) || gaps.some(value => typeof value !== 'string')) {
    throw new Error('Persona Interview Input requires category gaps')
  }
  return { session, config, profile, gaps }
}

const executeInput: NodeExecutor = async (_inputs, context) => validateContext(context)

function throwIfAborted(context: NodeExecutionContext): void {
  const signal = (context.abortSignal ?? context.signal) as AbortSignal | undefined
  if (!signal?.aborted) return
  if (signal.reason instanceof Error) throw signal.reason
  throw new DOMException('Persona interview question generation cancelled', 'AbortError')
}

export function parsePersonaInterviewQuestion(
  text: string,
  categories: string[],
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
    || typeof parsed.category !== 'string' || !categories.includes(parsed.category)
    || typeof parsed.reasoning !== 'string' || !parsed.reasoning.trim() || parsed.reasoning.length > 2_000) {
    throw new Error('Persona question response is missing required typed fields')
  }
  return {
    question: {
      id: `q${questionNumber}-${now.getTime()}`,
      prompt: parsed.question.trim(),
      category: parsed.category as Question['category'],
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
  const session = inputs.session as Session | undefined
  const config = inputs.config
  const profile = inputs.profile
  const gaps = inputs.gaps
  if (!session?.sessionId || !isRecord(config) || !isRecord(profile)
    || !Array.isArray(gaps) || gaps.some(value => typeof value !== 'string')) {
    throw new Error('Persona Question Generator requires validated graph inputs')
  }
  const categories = Array.isArray(config.categories)
    ? config.categories.filter((value): value is string => typeof value === 'string')
    : []
  if (categories.length === 0) throw new Error('Persona Question Generator requires configured categories')
  const methodology = isRecord(profile.methodology) ? profile.methodology : {}
  const techniques = isRecord(profile.interviewingTechniques) ? profile.interviewingTechniques : {}
  const privacy = isRecord(profile.privacyAndEthics) ? profile.privacyAndEthics : {}
  const history = session.questions.flatMap(question => {
    const answer = session.answers.find(item => item.questionId === question.id)
    return answer
      ? [{ role: 'assistant' as const, content: question.prompt }, { role: 'user' as const, content: answer.content }]
      : [{ role: 'assistant' as const, content: question.prompt }]
  })
  const systemPrompt = `Conduct an empathetic personality interview. Generate one non-redundant, open-ended follow-up question that addresses the least-covered category and respects the supplied privacy rules.

Progress: ${session.questions.length}/${String(config.maxQuestionsPerSession)} questions; ${session.answers.length} answers.
Coverage: ${JSON.stringify(session.categoryCoverage)}
Priority gaps: ${gaps.join(', ') || 'none'}
Allowed categories: ${categories.join(', ')}
Methodology: ${String(methodology.corePhilosophy || '')}
Techniques: ${JSON.stringify(techniques)}
Privacy rules: ${JSON.stringify(privacy.neverAskFor || [])}

Return JSON only: {"question":"open-ended question","category":"one allowed category","reasoning":"one sentence"}`
  const response = await dependencies.callModel({
    role: 'psychotherapist',
    userId: typeof context.userId === 'string' ? context.userId : context.username,
    cognitiveMode: typeof context.cognitiveMode === 'string' ? context.cognitiveMode : undefined,
    messages: [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'system', content: 'Generate the next interview question now.' },
    ],
    options: { temperature: 0.7, format: 'json' },
  })
  throwIfAborted(context)
  return parsePersonaInterviewQuestion(
    response.content,
    categories,
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
    { name: 'profile', type: 'object' },
    { name: 'gaps', type: 'array' },
  ],
  properties: {},
  description: 'Admits one validated persona interview session and its configured interview policy',
  execute: executeInput,
})

export const PersonaInterviewQuestionNode: NodeDefinition = defineNode({
  id: 'persona_interview_question',
  name: 'Generate Persona Interview Question',
  category: 'persona',
  inputs: [
    { name: 'session', type: 'object' },
    { name: 'config', type: 'object' },
    { name: 'profile', type: 'object' },
    { name: 'gaps', type: 'array' },
  ],
  outputs: [
    { name: 'question', type: 'object' },
    { name: 'reasoning', type: 'string' },
  ],
  properties: {},
  description: 'Generates one typed adaptive question for the current persona interview',
  execute: executePersonaInterviewQuestion,
})
