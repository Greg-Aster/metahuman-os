import { getUserContext } from './context.js'
import {
  cognitiveGraphPath,
  loadGraphFile,
  requireGraphNodeOutput,
  runGraph,
} from './graph-runtime.js'
import {
  parseSemanticTurnDecision,
  type SemanticTurnDecision,
} from './nodes/agent/semantic-turn-classifier.node.js'

export async function classifySemanticTurn(input: {
  transcript: string
  context?: string
  username: string
  signal?: AbortSignal
}): Promise<SemanticTurnDecision> {
  const activeUser = getUserContext()
  if (!activeUser || (activeUser.username !== input.username && activeUser.activeProfile !== input.username)) {
    throw new Error(`Semantic turn classification requires an authenticated context for ${input.username}`)
  }
  const loaded = await loadGraphFile(cognitiveGraphPath('semantic-turn.json'), {
    cacheKey: 'semantic-turn',
    logPrefix: '[semantic-turn]',
  })
  if (!loaded) throw new Error('Semantic turn graph is unavailable')
  const state = await runGraph({
    graph: loaded.graph,
    signal: input.signal,
    context: {
      userId: activeUser.userId,
      username: input.username,
      transcript: input.transcript,
      previousContext: input.context,
      cognitiveMode: 'agent',
      allowMemoryWrites: false,
      recordPersonaMemory: false,
      abortSignal: input.signal,
    },
  })
  if (state.status !== 'completed') {
    throw new Error(`Semantic turn graph ended with status ${state.status}`)
  }
  const output = requireGraphNodeOutput(state, 'semantic_turn_classifier')
  return parseSemanticTurnDecision(JSON.stringify(output.decision))
}
