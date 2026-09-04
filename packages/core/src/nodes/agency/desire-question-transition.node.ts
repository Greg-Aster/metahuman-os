import type { Desire } from '../../agency/types.js'
import { saveDesireManifest } from '../../agency/storage.js'
import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js'

const execute: NodeExecutor = async (inputs, context) => {
  const username = typeof context.username === 'string' ? context.username.trim() : ''
  if (!username) throw new Error('Desire question persistence requires a resolved username')
  const desire = inputs.desire as Desire | undefined
  if (!desire?.id || desire.status !== 'questioning' || desire.currentStage !== 'questioning'
    || !desire.clarifyingQuestions || desire.clarifyingQuestions.questions.length === 0) {
    throw new Error('Desire question persistence requires a questioning desire with generated questions')
  }
  await saveDesireManifest(desire, username)
  return {
    success: true,
    desire,
    questions: desire.clarifyingQuestions.questions,
    reason: typeof inputs.reason === 'string' ? inputs.reason : '',
  }
}

export const DesireQuestionTransitionNode: NodeDefinition = defineNode({
  id: 'desire_question_transition',
  name: 'Persist Desire Questions',
  category: 'agency',
  inputs: [
    { name: 'desire', type: 'object' },
    { name: 'reason', type: 'string', optional: true },
  ],
  outputs: [
    { name: 'success', type: 'boolean' },
    { name: 'desire', type: 'object' },
    { name: 'questions', type: 'array' },
    { name: 'reason', type: 'string' },
  ],
  properties: {},
  description: 'Persists generated clarification questions through the canonical Agency storage owner',
  execute,
})
