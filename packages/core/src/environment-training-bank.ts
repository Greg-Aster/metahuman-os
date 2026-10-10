import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { SvelteFlowGraph } from './cognitive-graph-schema.js'
import { executionDefinition } from './durable-execution/graph-contract.js'
import type { ExecutionStore } from './durable-execution/store.js'
import { openExecutionStore } from './durable-execution/storage.js'
import type { NodeExecutionState } from './graph-executor.js'
import { getProfilePaths } from './path-builder.js'
import { renderPromptTemplate } from './nodes/prompt-template.js'
import { parseEnvironmentIntentRouting } from './nodes/llm/orchestrator-llm.node.js'
import { isPlanningDelegation } from './nodes/environment/planning-contract.js'
import { validateEnvironmentSelectorOutput } from './nodes/environment/helpers.js'
import { normalizeGeneratedMotionPlan } from './nodes/environment/movement-generator.node.js'
import { readFileSync as readProfileFile, resolvePath, writeFileSync as writeProfileFile } from './storage-client.js'

export type EnvironmentTrainingSpecialist = 'intent' | 'task'

export interface FreestyleTrainingCandidate {
  id: string
  sourceDigest: string
  executionId: string
  effectId: string
  recordedAt: string
  system: string
  user: string
  observedOutput: string
  valid: boolean
  generationError: string
  generatedAction: unknown
}

export interface EnvironmentTrainingCandidate {
  id: string
  sourceDigest: string
  specialist: EnvironmentTrainingSpecialist
  executionId: string
  checkpointNamespace: string
  nodeId: string
  graphHash: string
  recordedAt: string
  system: string
  user: string
  observedOutput: string
}

export interface EnvironmentTrainingReview {
  candidateId: string
  sourceDigest: string
  decision: 'accept' | 'correct' | 'reject' | 'defer'
  correctedOutput?: string
  reason: string
  reviewedAt: string
}

interface CandidateBank { version: 1; candidates: EnvironmentTrainingCandidate[] }
interface ReviewBank { version: 1; reviews: EnvironmentTrainingReview[] }

export interface EnvironmentTrainingProposal {
  candidateId: string
  sourceDigest: string
  verdict: 'correct' | 'incorrect' | 'uncertain'
  reason: string
  correctedOutput?: string
  createdAt: string
}

const BANK_FILE = 'environment-action-selector/rolling-bank.json'
const REVIEWS_FILE = 'environment-action-selector/reviews.json'
const CANDIDATE_DIRECTORY = 'environment-action-selector/candidates'
const FREESTYLE_DIRECTORY = 'environment-freestyle/candidates'
const FREESTYLE_REVIEWS_FILE = 'environment-freestyle/reviews.json'

function proposalFile(bank: 'decision' | 'freestyle', candidateId: string): string {
  if (!/^[a-f0-9]{32}$/.test(candidateId)) throw new Error('Invalid training decision identity')
  return `${bank === 'freestyle' ? 'environment-freestyle' : 'environment-action-selector'}/proposals/${candidateId}.json`
}

export function readEnvironmentTrainingProposal(username: string, bank: 'decision' | 'freestyle', candidateId: string): EnvironmentTrainingProposal | null {
  return readStored<EnvironmentTrainingProposal | null>(username, proposalFile(bank, candidateId), null)
}

export function saveEnvironmentTrainingProposal(username: string, bank: 'decision' | 'freestyle',
  proposal: Omit<EnvironmentTrainingProposal, 'createdAt'>): EnvironmentTrainingProposal {
  const candidate = bank === 'freestyle'
    ? readFreestyleTrainingBank(username).find(value => value.id === proposal.candidateId)
    : readEnvironmentTrainingBank(username).candidates.find(value => value.id === proposal.candidateId)
  if (!candidate || candidate.sourceDigest !== proposal.sourceDigest) throw new Error('Training proposal source changed')
  if (!proposal.reason.trim()) throw new Error('Training proposal requires a reason')
  if (proposal.verdict === 'incorrect' && !proposal.correctedOutput?.trim()) throw new Error('Incorrect training proposal needs a corrected output')
  const saved = { ...proposal, createdAt: new Date().toISOString() }
  writeStored(username, proposalFile(bank, proposal.candidateId), saved)
  return saved
}

/** Evidence stays attached to its recorded execution and action identity. */
export function readEnvironmentTrainingEvidence(store: ExecutionStore, executionId: string) {
  const events = store.events(executionId).filter(event =>
    ['physical_result', 'action_accepted', 'work_result'].includes(event.kind))
    .map(event => {
      const payload = event.payload && typeof event.payload === 'object'
        ? event.payload as Record<string, unknown> : {}
      const workResult = payload.result && typeof payload.result === 'object'
        ? payload.result as Record<string, unknown> : null
      return { eventId: event.eventId, kind: event.kind, actionId: event.actionId,
        createdAt: new Date(event.createdAt).toISOString(),
        ...(event.kind === 'physical_result' ? { feedback: payload.feedback } : {}),
        ...(event.kind === 'work_result' ? { effectId: payload.effectId,
          state: workResult?.state, error: workResult?.error } : {}),
      }
    })
  const dispatches = store.dispatches(executionId).filter(value => value.actionId)
    .map(value => {
      const payload = value.payload && typeof value.payload === 'object'
        ? value.payload as Record<string, unknown> : {}
      const input = payload.input && typeof payload.input === 'object'
        ? payload.input as Record<string, unknown> : {}
      return { effectId: value.effectId, actionId: value.actionId, status: value.status,
        kind: value.kind, actionType: input.type, command: input.command, sessionId: input.sessionId }
    })
  return { scope: 'same execution; action identity is recorded, but this list does not automatically attribute a result to one model decision',
    events, dispatches }
}

export function readEnvironmentTrainingEvidenceForProfile(username: string, executionId: string) {
  const store = openExecutionStore(username)
  try {
    if (store.get(executionId).username !== username) throw new Error('Execution belongs to another profile')
    return readEnvironmentTrainingEvidence(store, executionId)
  } finally { store.close() }
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function trainingFile(username: string, relativePath: string) {
  return { username, category: 'memory' as const, subcategory: 'training', relativePath }
}

function readStored<T>(username: string, relativePath: string, empty: T): T {
  const request = trainingFile(username, relativePath)
  const resolved = resolvePath(request)
  if (!resolved.success || !resolved.path) throw new Error(resolved.error || 'Training storage is unavailable')
  if (!fs.existsSync(resolved.path) && !fs.existsSync(`${resolved.path}.enc`)) return empty
  const result = readProfileFile({ ...request, encoding: 'utf8' })
  if (!result.success || typeof result.data !== 'string') throw new Error(result.error || 'Cannot read training data')
  return JSON.parse(result.data) as T
}

function writeStored(username: string, relativePath: string, value: unknown): void {
  const result = writeProfileFile({ ...trainingFile(username, relativePath), data: JSON.stringify(value) })
  if (!result.success) throw new Error(result.error || 'Cannot save training data')
}

export function readEnvironmentTrainingBank(username: string): CandidateBank {
  const bank = readStored<CandidateBank>(username, BANK_FILE, { version: 1, candidates: [] })
  if (bank.version !== 1 || !Array.isArray(bank.candidates)) throw new Error('Invalid environment training bank')
  const directory = resolvePath(trainingFile(username, CANDIDATE_DIRECTORY))
  if (!directory.success || !directory.path) throw new Error(directory.error || 'Training storage is unavailable')
  const candidates = new Map(bank.candidates.map(candidate => [candidate.id, candidate]))
  if (fs.existsSync(directory.path)) {
    for (const filename of fs.readdirSync(directory.path)) {
      if (!/^[a-f0-9]{32}\.json(?:\.enc)?$/.test(filename)) continue
      const id = filename.slice(0, 32)
      const candidate = readStored<EnvironmentTrainingCandidate | null>(username, `${CANDIDATE_DIRECTORY}/${id}.json`, null)
      if (!candidate || candidate.id !== id) throw new Error(`Invalid saved training decision ${id}`)
      candidates.set(id, candidate)
    }
  }
  return { version: 1, candidates: [...candidates.values()].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt) || a.id.localeCompare(b.id)) }
}

/** A graph save node persists one exact LLM output and the messages used to produce it. */
export function recordEnvironmentTrainingOutput(input: {
  username: string; executionId: string; occurrenceId: string; nodeId: string;
  graphHash: string; specialist: EnvironmentTrainingSpecialist;
  messages: unknown; observedOutput: string;
}): EnvironmentTrainingCandidate {
  const messages = textMessages(input.messages)
  if (!messages || !input.observedOutput.trim()) throw new Error('Training output needs exact model messages and response')
  const sourceDigest = digest([input.graphHash, messages, input.observedOutput])
  const id = digest([input.username, input.executionId, input.occurrenceId, input.nodeId, sourceDigest]).slice(0, 32)
  const relativePath = `${CANDIDATE_DIRECTORY}/${id}.json`
  const existing = readStored<EnvironmentTrainingCandidate | null>(input.username, relativePath, null)
  if (existing) {
    if (existing.sourceDigest !== sourceDigest) throw new Error('Saved training decision identity changed')
    return existing
  }
  const candidate: EnvironmentTrainingCandidate = {
    id, sourceDigest, specialist: input.specialist, executionId: input.executionId,
    checkpointNamespace: input.occurrenceId, nodeId: input.nodeId, graphHash: input.graphHash,
    recordedAt: new Date().toISOString(), ...messages, observedOutput: input.observedOutput,
  }
  writeStored(input.username, relativePath, candidate)
  return candidate
}

export function readEnvironmentTrainingReviews(username: string): ReviewBank {
  const bank = readStored<ReviewBank>(username, REVIEWS_FILE, { version: 1, reviews: [] })
  if (bank.version !== 1 || !Array.isArray(bank.reviews)) throw new Error('Invalid environment training reviews')
  return bank
}

export function readFreestyleTrainingBank(username: string): FreestyleTrainingCandidate[] {
  const directory = resolvePath(trainingFile(username, FREESTYLE_DIRECTORY))
  if (!directory.success || !directory.path) throw new Error(directory.error || 'Freestyle training storage is unavailable')
  if (!fs.existsSync(directory.path)) return []
  return fs.readdirSync(directory.path).filter(filename => /^[a-f0-9]{32}\.json(?:\.enc)?$/.test(filename))
    .map(filename => {
      const id = filename.slice(0, 32)
      const candidate = readStored<FreestyleTrainingCandidate | null>(username, `${FREESTYLE_DIRECTORY}/${id}.json`, null)
      if (!candidate || candidate.id !== id) throw new Error(`Invalid saved freestyle decision ${id}`)
      return candidate
    }).sort((a, b) => a.recordedAt.localeCompare(b.recordedAt) || a.id.localeCompare(b.id))
}

export function readFreestyleTrainingReviews(username: string): ReviewBank {
  const bank = readStored<ReviewBank>(username, FREESTYLE_REVIEWS_FILE, { version: 1, reviews: [] })
  if (bank.version !== 1 || !Array.isArray(bank.reviews)) throw new Error('Invalid freestyle training reviews')
  return bank
}

export function recordFreestyleTrainingOutput(input: {
  username: string; executionId: string; effectId: string; messages: unknown;
  observedOutput: string; valid: boolean; generationError: string; generatedAction: unknown;
}): FreestyleTrainingCandidate {
  const messages = textMessages(input.messages)
  if (!messages) throw new Error('Freestyle training output needs exact model messages')
  const sourceDigest = digest([messages, input.observedOutput, input.valid, input.generationError, input.generatedAction])
  const id = digest([input.username, input.executionId, input.effectId, sourceDigest]).slice(0, 32)
  const relativePath = `${FREESTYLE_DIRECTORY}/${id}.json`
  const existing = readStored<FreestyleTrainingCandidate | null>(input.username, relativePath, null)
  if (existing) {
    if (existing.sourceDigest !== sourceDigest) throw new Error('Saved freestyle decision identity changed')
    return existing
  }
  const candidate: FreestyleTrainingCandidate = {
    id, sourceDigest, executionId: input.executionId, effectId: input.effectId,
    recordedAt: new Date().toISOString(), ...messages, observedOutput: input.observedOutput,
    valid: input.valid, generationError: input.generationError, generatedAction: input.generatedAction,
  }
  writeStored(input.username, relativePath, candidate)
  return candidate
}

export function reviewFreestyleTrainingCandidate(username: string, review: Omit<EnvironmentTrainingReview, 'sourceDigest' | 'reviewedAt'>) {
  const candidate = readFreestyleTrainingBank(username).find(value => value.id === review.candidateId)
  if (!candidate) throw new Error('Freestyle training candidate does not exist')
  if (!review.reason.trim()) throw new Error('Freestyle review requires a reason')
  if (review.decision === 'correct' && !review.correctedOutput?.trim()) throw new Error('Corrected freestyle output is required')
  if (review.decision === 'accept' && !candidate.valid) throw new Error('Rejected generation cannot be accepted as a training target')
  const reviews = readFreestyleTrainingReviews(username).reviews.filter(value => value.candidateId !== candidate.id)
  reviews.push({ ...review, sourceDigest: candidate.sourceDigest, reviewedAt: new Date().toISOString() })
  writeStored(username, FREESTYLE_REVIEWS_FILE, { version: 1, reviews })
}

export function exportReviewedFreestyleTraining(username: string): { file: string; count: number } {
  const reviews = new Map(readFreestyleTrainingReviews(username).reviews.map(review => [review.candidateId, review]))
  const records: string[] = []
  for (const candidate of readFreestyleTrainingBank(username)) {
    const review = reviews.get(candidate.id)
    if (!review || review.decision === 'reject' || review.decision === 'defer') continue
    if (review.sourceDigest !== candidate.sourceDigest) throw new Error(`Stale freestyle review: ${candidate.id}`)
    const output = review.decision === 'correct' ? review.correctedOutput! : candidate.observedOutput
    normalizeGeneratedMotionPlan(output, 'training-export')
    records.push(JSON.stringify({ system: candidate.system, user: candidate.user, output,
      metadata: { recordId: candidate.id, sourceCaseId: candidate.executionId,
        specialist: 'freestyle', sourceSplit: 'development', sourceDigest: candidate.sourceDigest,
        reviewedAt: review.reviewedAt, reviewDecision: review.decision } }))
  }
  const directory = path.join(getProfilePaths(username).out, 'environment-freestyle', 'reviewed')
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  const file = path.join(directory, 'freestyle.jsonl')
  const temporary = `${file}.tmp.${process.pid}`
  fs.writeFileSync(temporary, records.join('\n') + (records.length ? '\n' : ''), { mode: 0o600 })
  fs.renameSync(temporary, file)
  return { file, count: records.length }
}

function textMessages(value: unknown): { system: string; user: string } | null {
  if (!Array.isArray(value) || value.length !== 2
    || value[0]?.role !== 'system' || typeof value[0]?.content !== 'string'
    || value[1]?.role !== 'user' || typeof value[1]?.content !== 'string') return null
  return { system: value[0].content, user: value[1].content }
}

function candidateFromNode(
  username: string, executionId: string, namespace: string, graphHash: string,
  node: SvelteFlowGraph['nodes'][number], state: NodeExecutionState,
): EnvironmentTrainingCandidate | null {
  if (state.status !== 'completed' || !state.inputs || !state.outputs || !state.endTime) return null
  let specialist: EnvironmentTrainingSpecialist
  let messages: { system: string; user: string } | null
  let observedOutput: string
  if (node.data.nodeType === 'orchestrator_llm' && node.data.properties?.outputContract === 'environment-request') {
    specialist = 'intent'
    const message = state.inputs.message
    observedOutput = state.outputs.raw
    if (typeof message !== 'string' || typeof observedOutput !== 'string') return null
    const properties = node.data.properties
    if (typeof properties.systemPrompt !== 'string' || typeof properties.userPromptTemplate !== 'string') return null
    const values = { userMessage: message, executionSection: '', feedbackSection: '', recentMessages: '', recentConversationSection: '' }
    messages = {
      system: renderPromptTemplate(properties.systemPrompt, values),
      user: renderPromptTemplate(properties.userPromptTemplate, values),
    }
  } else if (node.data.nodeType === 'model_router' && node.data.properties?.role === 'environmentActionSelector') {
    specialist = 'task'
    if (state.outputs.precomputed === true) return null
    messages = textMessages(state.inputs.messages)
    observedOutput = state.outputs.response
    if (!messages || typeof observedOutput !== 'string') return null
  } else return null
  const sourceDigest = digest([graphHash, messages, observedOutput])
  const id = digest([username, executionId, namespace, node.id, sourceDigest]).slice(0, 32)
  return {
    id, sourceDigest, specialist, executionId, checkpointNamespace: namespace,
    nodeId: node.id, graphHash, recordedAt: new Date(state.endTime).toISOString(),
    ...messages, observedOutput,
  }
}

/** Read committed checkpoints; the live graph has no training write on its response path. */
export async function collectEnvironmentTrainingCandidates(
  store: ExecutionStore, username: string, graph: SvelteFlowGraph,
): Promise<{ candidates: EnvironmentTrainingCandidate[]; matchingExecutions: number; skippedVersions: number }> {
  const current = executionDefinition(graph)
  const nodes = new Map(graph.nodes.map(node => [node.id, node]))
  const decisionNodeIds = graph.nodes.filter(node => node.data.nodeType === 'orchestrator_llm'
    && node.data.properties?.outputContract === 'environment-request'
    || node.data.nodeType === 'model_router' && node.data.properties?.role === 'environmentActionSelector')
    .map(node => node.id)
  const candidates = new Map<string, EnvironmentTrainingCandidate>()
  let matchingExecutions = 0, skippedVersions = 0
  for (const execution of store.list(username)) {
    const children = (store.db.prepare('SELECT invocation_id, definition FROM execution_graphs WHERE execution_id=?')
      .all(execution.executionId) as Array<{ invocation_id: string; definition: string }>)
      .map(row => ({ invocationId: row.invocation_id, definition: store.codec.decode(row.definition) as typeof current }))
    const namespaces = store.db.prepare('SELECT namespace FROM execution_heads WHERE execution_id=?')
      .all(execution.executionId) as Array<{ namespace: string }>
    for (const { namespace } of namespaces) {
      const child = children.find(row => namespace === `${row.invocationId}|` || namespace.startsWith(`${row.invocationId}|`))
      const definition = child?.definition ?? (!namespace ? execution.definition : null)
      if (definition?.graphId !== current.graphId) continue
      if (definition.graphHash !== current.graphHash) { skippedVersions++; continue }
      matchingExecutions++
      // Counts identifies the checkpoints where a decision node ran. Decoding
      // every nodeEntries write would repeatedly load unrelated observations.
      const writes = store.db.prepare(`SELECT c.value AS counts, n.value AS entries FROM writes c
        JOIN writes n ON n.thread_id=c.thread_id AND n.checkpoint_ns=c.checkpoint_ns
          AND n.checkpoint_id=c.checkpoint_id AND n.task_id=c.task_id
        WHERE c.thread_id=? AND c.checkpoint_ns=? AND c.channel='counts' AND n.channel='nodeEntries'
        ORDER BY c.rowid`)
        .all(execution.executionId, namespace) as Array<{ counts: Uint8Array; entries: Uint8Array }>
      const previousCounts: Record<string, number> = {}
      for (const write of writes) {
        const countDocument = store.decodeDocument(Buffer.from(write.counts).toString('utf8')) as { type: string; json?: unknown }
        const counts = countDocument.type === 'json' && countDocument.json && typeof countDocument.json === 'object'
          ? countDocument.json as Record<string, number> : {}
        const changed = decisionNodeIds.some(id => (counts[id] ?? 0) > (previousCounts[id] ?? 0))
        for (const id of decisionNodeIds) previousCounts[id] = counts[id] ?? 0
        if (!changed) continue
        const document = store.decodeDocument(Buffer.from(write.entries).toString('utf8')) as { type: string; json?: unknown }
        const entries = document.type === 'json' ? document.json : null
        if (!Array.isArray(entries)) continue
        for (const [nodeId, state] of entries as Array<[string, NodeExecutionState]>) {
          const node = nodes.get(nodeId)
          if (!node) continue
          const candidate = candidateFromNode(username, execution.executionId, namespace, current.graphHash, node, state)
          if (candidate) candidates.set(candidate.id, candidate)
        }
      }
    }
  }
  return { candidates: [...candidates.values()].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt) || a.id.localeCompare(b.id)),
    matchingExecutions, skippedVersions }
}

export async function refreshEnvironmentTrainingBank(store: ExecutionStore, username: string, graph: SvelteFlowGraph) {
  const found = await collectEnvironmentTrainingCandidates(store, username, graph)
  const existing = readEnvironmentTrainingBank(username)
  const reviewed = new Set(readEnvironmentTrainingReviews(username).reviews.map(review => review.candidateId))
  const key = (candidate: EnvironmentTrainingCandidate) => JSON.stringify([
    candidate.executionId, candidate.nodeId, candidate.sourceDigest,
  ])
  const merged = new Map<string, EnvironmentTrainingCandidate>()
  for (const candidate of existing.candidates) {
    const prior = merged.get(key(candidate))
    if (!prior || reviewed.has(candidate.id) && !reviewed.has(prior.id)) merged.set(key(candidate), candidate)
  }
  const previousCount = merged.size
  for (const candidate of found.candidates) {
    if (!merged.has(key(candidate))) merged.set(key(candidate), candidate)
  }
  const candidates = [...merged.values()].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt) || a.id.localeCompare(b.id))
  writeStored(username, BANK_FILE, { version: 1, candidates })
  return { total: candidates.length, added: candidates.length - previousCount,
    matchingExecutions: found.matchingExecutions, skippedVersions: found.skippedVersions }
}

export function reviewEnvironmentTrainingCandidate(username: string, review: Omit<EnvironmentTrainingReview, 'sourceDigest' | 'reviewedAt'>) {
  const candidate = readEnvironmentTrainingBank(username).candidates.find(value => value.id === review.candidateId)
  if (!candidate) throw new Error('Training candidate does not exist')
  if (!review.reason.trim()) throw new Error('Training review requires a reason')
  if (review.decision === 'correct' && !review.correctedOutput?.trim()) throw new Error('Corrected training output is required')
  const reviews = readEnvironmentTrainingReviews(username).reviews.filter(value => value.candidateId !== candidate.id)
  reviews.push({ ...review, sourceDigest: candidate.sourceDigest, reviewedAt: new Date().toISOString() })
  writeStored(username, REVIEWS_FILE, { version: 1, reviews })
}

/** Freeze only owner-reviewed targets. Existing synthetic evaluation remains independent. */
export function exportReviewedEnvironmentTraining(username: string): { directory: string; counts: Record<EnvironmentTrainingSpecialist, number> } {
  const candidates = readEnvironmentTrainingBank(username).candidates
  const reviews = new Map(readEnvironmentTrainingReviews(username).reviews.map(review => [review.candidateId, review]))
  const records: Record<EnvironmentTrainingSpecialist, string[]> = { intent: [], task: [] }
  for (const candidate of candidates) {
    const review = reviews.get(candidate.id)
    if (!review || review.decision === 'reject' || review.decision === 'defer') continue
    if (review.sourceDigest !== candidate.sourceDigest) throw new Error(`Stale training review: ${candidate.id}`)
    const output = review.decision === 'correct' ? review.correctedOutput! : candidate.observedOutput
    if (candidate.specialist === 'intent') parseEnvironmentIntentRouting(output)
    else {
      const parsed = JSON.parse(output)
      if (!isPlanningDelegation(parsed)) {
        const envelope = JSON.parse(candidate.user)
        const result = validateEnvironmentSelectorOutput(output,
          envelope.currentEnvironment?.sessionId, envelope.activeExecutions ?? [], false)
        if (!result.valid) throw new Error(`Invalid reviewed task output ${candidate.id}: ${result.errors.join('; ')}`)
      }
    }
    records[candidate.specialist].push(JSON.stringify({
      system: candidate.system, user: candidate.user, output,
      metadata: { recordId: candidate.id, sourceCaseId: candidate.executionId,
        specialist: candidate.specialist, sourceSplit: 'development', sourceDigest: candidate.sourceDigest,
        reviewedAt: review.reviewedAt, reviewDecision: review.decision },
    }))
  }
  const directory = path.join(getProfilePaths(username).out, 'environment-action-selector', 'reviewed')
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  for (const specialist of ['intent', 'task'] as const) {
    const target = path.join(directory, `${specialist}.jsonl`)
    const temporary = `${target}.tmp.${process.pid}`
    fs.writeFileSync(temporary, records[specialist].join('\n') + (records[specialist].length ? '\n' : ''), { mode: 0o600 })
    fs.renameSync(temporary, target)
  }
  return { directory, counts: { intent: records.intent.length, task: records.task.length } }
}
