/** Browser-safe contracts shared by training controls, dataset policy and trainers. */
export type CognitiveMode = 'dual' | 'agent' | 'emulation' | 'environment'
export type TrainingObjective = 'human-continuation' | 'assistant-continuation'

export interface TrainingCandidateResult {
  version: 1
  status: 'candidate'
  datasetId: string
  baseModel: string
  configSha256: string
  templateSha256: string
  trainingMode: 'lora' | 'full' | 'full_finetune'
  trainingSamples: number
  evaluationSamples: number
  supervisedTokens: number
  baselineLoss: number
  candidateLoss: number
  qualityGate: 'passed' | 'failed'
  evaluationPolicy: 'independent'
  supervision: 'final-assistant-only'
  servingValidation: 'required'
  activation: 'not-activated'
  artifacts: Record<string, string>
}

export interface TrainingCandidateReview {
  id: string
  runLabel: string
  datasetId: string
  provider: 'ollama' | 'vllm'
  model: string
  baselineModel: string
  baselineProvider: 'ollama' | 'vllm'
  servingIdentity: string
  artifactReceiptHash: string
  createdAt: string
  cases: Array<{ prompt: string; baseline: string; candidate: string }>
  decision?: 'accepted' | 'rejected'
  notes?: string
  reviewedAt?: string
  reopenedAt?: string
}

export interface TrainingCleanupReceipt {
  runLabel: string
  podId: string | null
  podName: string
  error?: string
}

export interface TrainingCandidateSummary {
  runLabel: string
  status: string
  method: string
  target: 'ollama' | 'vllm'
  baseModel: string
  candidateDirectory: string
  datasetId?: string
  trainingSamples?: number
  evaluationSamples?: number
  baselineLoss?: number
  candidateLoss?: number
  qualityGate?: 'passed' | 'failed'
  error?: string
  review?: TrainingCandidateReview
}

export const TRAINING_MEMORY_TYPES = [
  'conversation', 'observation', 'therapy_session', 'journal', 'reflection',
  'reflection_summary', 'inner_dialogue', 'dream', 'daydream', 'curiosity_question', 'decision', 'summary',
] as const

export interface TrainingDataSettings {
  objective: TrainingObjective
  includePersona: boolean
  memoryTypes: { percentages: Record<string, number> }
  maxSyntheticPercent: number
  evaluationPercent: number
  seed: string
}

export const DEFAULT_TRAINING_DATA: TrainingDataSettings = {
  objective: 'human-continuation',
  includePersona: true,
  memoryTypes: { percentages: {
    conversation: 100, observation: 0, therapy_session: 0, journal: 0,
    reflection: 0, reflection_summary: 0, inner_dialogue: 0, dream: 0,
    daydream: 0, curiosity_question: 0, decision: 0, summary: 0,
  } },
  maxSyntheticPercent: 0,
  evaluationPercent: 10,
  seed: 'personalization-v2',
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

/** Older profiles receive declared defaults; supplied invalid values are errors. */
export function parseTrainingDataSettings(value: unknown = {}): TrainingDataSettings {
  const data = object(value, 'Training data settings')
  const objective = data.objective ?? DEFAULT_TRAINING_DATA.objective
  if (objective !== 'human-continuation' && objective !== 'assistant-continuation') throw new Error('Invalid training objective')
  const includePersona = data.includePersona ?? DEFAULT_TRAINING_DATA.includePersona
  if (typeof includePersona !== 'boolean') throw new Error('includePersona must be a boolean')
  const types = data.memoryTypes === undefined ? {} : object(data.memoryTypes, 'Memory types')
  const supplied = types.percentages === undefined ? {} : object(types.percentages, 'Memory sampling weights')
  const percentages = { ...DEFAULT_TRAINING_DATA.memoryTypes.percentages }
  for (const [type, value] of Object.entries(supplied)) {
    if (!TRAINING_MEMORY_TYPES.includes(type as typeof TRAINING_MEMORY_TYPES[number])) {
      throw new Error(`Unknown training memory type: ${type}`)
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
      throw new Error(`Sampling weight for ${type} must be between 0 and 100`)
    }
    percentages[type] = value
  }
  const maxSyntheticPercent = data.maxSyntheticPercent ?? DEFAULT_TRAINING_DATA.maxSyntheticPercent
  const evaluationPercent = data.evaluationPercent ?? DEFAULT_TRAINING_DATA.evaluationPercent
  if (typeof maxSyntheticPercent !== 'number' || !Number.isInteger(maxSyntheticPercent) || maxSyntheticPercent < 0 || maxSyntheticPercent > 50) {
    throw new Error('maxSyntheticPercent must be an integer from 0 to 50')
  }
  if (typeof evaluationPercent !== 'number' || !Number.isInteger(evaluationPercent) || evaluationPercent < 5 || evaluationPercent > 30) {
    throw new Error('evaluationPercent must be an integer from 5 to 30')
  }
  const seed = data.seed ?? DEFAULT_TRAINING_DATA.seed
  if (typeof seed !== 'string' || !/^[A-Za-z0-9._-]{1,80}$/.test(seed)) throw new Error('Training seed must contain 1 to 80 letters, numbers, dots, dashes or underscores')
  return { objective, includePersona, memoryTypes: { percentages }, maxSyntheticPercent, evaluationPercent, seed }
}

export interface TrainingMessage { role: 'system' | 'user' | 'assistant'; content: string }

export interface PersonalizationSample {
  id: string
  messages: TrainingMessage[]
  metadata: {
    sourceIds: string[]
    sourceHashes: Record<string, string>
    curatedRecordIds: string[]
    group: string
    timestamp: string
    sourceType: string
    mode: CognitiveMode
    objective: TrainingObjective
    targetAuthor: 'human' | 'assistant'
    synthetic: boolean
  }
}

/** Only the final assistant continuation is supervised; all context is masked. */
export function validatePersonalizationSample(value: unknown): asserts value is PersonalizationSample {
  const row = object(value, 'Training sample')
  if (typeof row.id !== 'string' || !row.id.trim()) throw new Error('Training sample requires an id')
  if (!Array.isArray(row.messages) || row.messages.length < 2) throw new Error('Training sample requires chronological messages')
  for (const [index, raw] of row.messages.entries()) {
    const message = object(raw, 'Training message')
    if (!['system', 'user', 'assistant'].includes(String(message.role)) || typeof message.content !== 'string' || !message.content.trim()) {
      throw new Error('Training messages require a valid role and nonempty content')
    }
    if (message.role === 'system' && index !== 0) throw new Error('A system message is allowed only at the start')
  }
  const last = row.messages.at(-1) as TrainingMessage
  const preceding = row.messages.at(-2) as TrainingMessage
  if (last.role !== 'assistant' || preceding.role !== 'user') throw new Error('Training target must follow its prompt as the final assistant message')
  const metadata = object(row.metadata, 'Training sample metadata')
  const hashes = object(metadata.sourceHashes, 'Training source hashes')
  if (!Array.isArray(metadata.sourceIds) || metadata.sourceIds.length === 0
      || metadata.sourceIds.some(id => typeof id !== 'string' || typeof hashes[id] !== 'string' || !/^[a-f0-9]{64}$/.test(String(hashes[id])))) {
    throw new Error('Training sample requires source identities and hashes')
  }
  if (typeof metadata.group !== 'string' || !metadata.group.trim()
      || typeof metadata.timestamp !== 'string' || !Number.isFinite(Date.parse(metadata.timestamp))
      || !['human-continuation', 'assistant-continuation'].includes(String(metadata.objective))
      || !['human', 'assistant'].includes(String(metadata.targetAuthor)) || typeof metadata.synthetic !== 'boolean') {
    throw new Error('Training sample has invalid provenance')
  }
}
