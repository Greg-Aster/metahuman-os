/** Graph-backed persona extraction used by onboarding, Persona Generator, and CLI. */

import { getUserContext } from '../context.js'
import {
  cognitiveGraphPath,
  loadGraphFile,
  requireGraphNodeOutput,
  runGraph,
} from '../graph-runtime.js'
import {
  type ChatMessage,
  type PersonaDraft,
} from '../nodes/persona/persona-profile-extractor.node.js'

export type {
  BigFive,
  ChatMessage,
  CommunicationStyle,
  CoreValue,
  PersonaDraft,
  PersonaGoals,
} from '../nodes/persona/persona-profile-extractor.node.js'

export async function extractPersonaFromTranscript(
  messages: ChatMessage[],
  signal?: AbortSignal,
): Promise<PersonaDraft> {
  const activeUser = getUserContext()
  if (!activeUser) throw new Error('Persona extraction requires an authenticated user context')
  const username = activeUser.activeProfile || activeUser.username
  const loaded = await loadGraphFile(cognitiveGraphPath('persona-extraction.json'), {
    cacheKey: 'persona-extraction',
    logPrefix: '[persona-extractor]',
  })
  if (!loaded) throw new Error('Persona extraction graph is unavailable')
  const state = await runGraph({
    graph: loaded.graph,
    signal,
    context: {
      userId: activeUser.userId,
      username,
      messages,
      cognitiveMode: 'agent',
      allowMemoryWrites: false,
      recordPersonaMemory: false,
      abortSignal: signal,
    },
  })
  if (state.status !== 'completed') {
    throw new Error(`Persona extraction graph ended with status ${state.status}`)
  }
  const output = requireGraphNodeOutput(state, 'persona_profile_extractor')
  const persona = output.persona as PersonaDraft | undefined
  if (!persona || typeof persona !== 'object'
    || !persona.confidence || typeof persona.confidence.overall !== 'number') {
    throw new Error('Persona extraction graph returned an invalid persona draft')
  }
  return persona
}

export async function extractPersonaFromSession(session: {
  questions: Array<{ id: string; prompt: string }>
  answers: Array<{ questionId: string; content: string }>
}, signal?: AbortSignal): Promise<PersonaDraft> {
  const messages: ChatMessage[] = []
  for (const question of session.questions) {
    const answer = session.answers.find(item => item.questionId === question.id)
    messages.push({ role: 'assistant', content: question.prompt })
    if (answer) messages.push({ role: 'user', content: answer.content })
  }
  return extractPersonaFromTranscript(messages, signal)
}
