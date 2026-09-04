import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { audit } from '../../audit.js';
import { loadCuriosityConfig, type CuriosityConfig } from '../../config.js';
import type { CuriosityMemorySample } from '../../curiosity-memory-sampling.js';
import { getProfilePaths } from '../../path-builder.js';
import { safeReadJSON, safeWriteJSON } from '../../safe-file.js';
import { defineNode, type NodeDefinition, type NodeExecutionContext } from '../types.js';

const RECEIPT_SCHEMA_VERSION = 1;
const MAX_RECEIPTS = 768;
const MAX_EXECUTION_ID_CHARS = 400;

export type InnerCuriositySkipReason = 'disabled' | 'no-memories';

export type InnerCuriosityOutcome =
  | {
    status: 'generated';
    username: string;
    executionId: string;
    deduplicated: boolean;
    memoriesConsidered: number;
    searchResults: number;
    followOn?: InnerCuriosityFollowOnReceipt;
  }
  | {
    status: 'skipped';
    username: string;
    executionId: string;
    reason: InnerCuriositySkipReason;
  };

export interface InnerCuriosityExecutionIdentity {
  username: string;
  executionId: string;
  idempotencyKey: string;
  timestamp: string;
}

export interface InnerCuriosityFollowOnReceipt {
  admitted: boolean;
  skipped: boolean;
  reason?: string;
  taskId?: string;
  probability?: number;
  roll?: number;
}

interface InnerCuriosityReceiptBase extends InnerCuriosityExecutionIdentity {
  schemaVersion: typeof RECEIPT_SCHEMA_VERSION;
  kind: 'inner-curiosity-execution';
  question: string;
  answer: string;
  innerDialogue: string;
  sourceMemoryIds: string[];
  searchResultIds: string[];
  sampling: CuriosityMemorySample['diagnostics'];
  preparedAt: string;
}

export interface PreparedInnerCuriosityReceipt extends InnerCuriosityReceiptBase {
  status: 'prepared';
}

export interface CompletedInnerCuriosityReceipt extends InnerCuriosityReceiptBase {
  status: 'completed';
  completedAt: string;
  /** Absent only on receipts written before graph-owned follow-on observability. */
  followOn?: InnerCuriosityFollowOnReceipt;
}

export type InnerCuriosityReceipt = PreparedInnerCuriosityReceipt | CompletedInnerCuriosityReceipt;

export interface InnerCuriosityStateDependencies {
  loadConfig: (username: string) => CuriosityConfig;
  loadReceipt: (username: string, idempotencyKey: string) => InnerCuriosityReceipt | null;
}

export interface InnerCuriosityPrepareDependencies {
  saveReceipt: (receipt: InnerCuriosityReceipt) => void;
  now: () => Date;
}

export interface InnerCuriosityCompleteDependencies extends InnerCuriosityPrepareDependencies {
  auditGenerated: (receipt: CompletedInnerCuriosityReceipt, deduplicated: boolean) => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function throwIfAborted(context: NodeExecutionContext): void {
  const signal = (context.abortSignal ?? context.signal) as AbortSignal | undefined;
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new DOMException('Inner Curiosity execution cancelled', 'AbortError');
}

function requiredString(value: unknown, label: string, maximum = Number.POSITIVE_INFINITY): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must not be empty`);
  const text = value.trim();
  if (text.length > maximum) throw new Error(`${label} must not exceed ${maximum} characters`);
  return text;
}

function validTimestamp(value: unknown, label: string): string {
  const text = requiredString(value, label);
  if (Number.isNaN(Date.parse(text))) throw new Error(`${label} must be a valid date`);
  return new Date(text).toISOString();
}

function usernameFromContext(context: NodeExecutionContext): string {
  const username = typeof context.username === 'string'
    ? context.username.trim()
    : typeof context.userId === 'string'
      ? context.userId.trim()
      : '';
  if (!username || username === 'anonymous') {
    throw new Error('Inner Curiosity graph requires an authenticated username');
  }
  return username;
}

function executionIdentity(context: NodeExecutionContext): InnerCuriosityExecutionIdentity {
  const username = usernameFromContext(context);
  const executionId = requiredString(
    context.executionId,
    'Inner Curiosity executionId',
    MAX_EXECUTION_ID_CHARS,
  );
  const idempotencyKey = `inner-curiosity:${username}:${executionId}`;
  if (context.idempotencyKey !== undefined && context.idempotencyKey !== idempotencyKey) {
    throw new Error('Inner Curiosity graph idempotency identity does not match its execution');
  }
  return {
    username,
    executionId,
    idempotencyKey,
    timestamp: validTimestamp(context.executionTimestamp, 'Inner Curiosity executionTimestamp'),
  };
}

function receiptFile(username: string, idempotencyKey: string): string {
  const digest = createHash('sha256').update(idempotencyKey).digest('hex');
  return path.join(getProfilePaths(username).state, 'inner-curiosity', `${digest}.json`);
}

function requireStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) {
    throw new Error(`Invalid Inner Curiosity receipt ${field}`);
  }
  return value.map(item => String(item).trim());
}

function parseSamplingDiagnostics(value: unknown): CuriosityMemorySample['diagnostics'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Inner Curiosity receipt sampling diagnostics');
  }
  const record = value as Record<string, unknown>;
  const fields = [
    'filesConsidered',
    'filesRead',
    'skippedMalformed',
    'skippedOversize',
    'skippedGenerated',
    'skippedEmpty',
    'truncatedContent',
  ] as const;
  for (const field of fields) {
    if (!Number.isSafeInteger(record[field]) || Number(record[field]) < 0) {
      throw new Error(`Invalid Inner Curiosity receipt sampling.${field}`);
    }
  }
  return {
    filesConsidered: Number(record.filesConsidered),
    filesRead: Number(record.filesRead),
    skippedMalformed: Number(record.skippedMalformed),
    skippedOversize: Number(record.skippedOversize),
    skippedGenerated: Number(record.skippedGenerated),
    skippedEmpty: Number(record.skippedEmpty),
    truncatedContent: Number(record.truncatedContent),
  };
}

function parseFollowOn(value: unknown): InnerCuriosityFollowOnReceipt | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Inner Curiosity receipt followOn');
  }
  const record = value as Record<string, unknown>;
  if (typeof record.admitted !== 'boolean' || typeof record.skipped !== 'boolean') {
    throw new Error('Invalid Inner Curiosity receipt followOn decision');
  }
  if (record.admitted === record.skipped) {
    throw new Error('Invalid Inner Curiosity receipt followOn state');
  }
  const optionalNumber = (field: 'probability' | 'roll'): number | undefined => {
    if (record[field] === undefined) return undefined;
    if (typeof record[field] !== 'number' || !Number.isFinite(record[field])) {
      throw new Error(`Invalid Inner Curiosity receipt followOn.${field}`);
    }
    return record[field];
  };
  const probability = optionalNumber('probability');
  const roll = optionalNumber('roll');
  return {
    admitted: record.admitted,
    skipped: record.skipped,
    ...(typeof record.reason === 'string' && record.reason.trim() ? { reason: record.reason.trim() } : {}),
    ...(typeof record.taskId === 'string' && record.taskId.trim() ? { taskId: record.taskId.trim() } : {}),
    ...(probability !== undefined ? { probability } : {}),
    ...(roll !== undefined ? { roll } : {}),
  };
}

function parseReceipt(value: unknown): InnerCuriosityReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Inner Curiosity receipt object');
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== RECEIPT_SCHEMA_VERSION || record.kind !== 'inner-curiosity-execution') {
    throw new Error('Unsupported Inner Curiosity receipt schema');
  }
  if (record.status !== 'prepared' && record.status !== 'completed') {
    throw new Error('Invalid Inner Curiosity receipt status');
  }
  const common = {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    kind: 'inner-curiosity-execution',
    executionId: requiredString(record.executionId, 'Invalid Inner Curiosity receipt executionId'),
    idempotencyKey: requiredString(record.idempotencyKey, 'Invalid Inner Curiosity receipt idempotencyKey'),
    username: requiredString(record.username, 'Invalid Inner Curiosity receipt username'),
    timestamp: validTimestamp(record.timestamp, 'Invalid Inner Curiosity receipt timestamp'),
    question: requiredString(record.question, 'Invalid Inner Curiosity receipt question'),
    answer: requiredString(record.answer, 'Invalid Inner Curiosity receipt answer'),
    innerDialogue: requiredString(record.innerDialogue, 'Invalid Inner Curiosity receipt innerDialogue'),
    sourceMemoryIds: requireStringArray(record.sourceMemoryIds, 'sourceMemoryIds'),
    searchResultIds: requireStringArray(record.searchResultIds, 'searchResultIds'),
    sampling: parseSamplingDiagnostics(record.sampling),
    preparedAt: validTimestamp(record.preparedAt, 'Invalid Inner Curiosity receipt preparedAt'),
  } satisfies InnerCuriosityReceiptBase;
  if (record.status === 'prepared') return { ...common, status: 'prepared' };
  const followOn = parseFollowOn(record.followOn);
  return {
    ...common,
    status: 'completed',
    completedAt: validTimestamp(record.completedAt, 'Invalid Inner Curiosity receipt completedAt'),
    ...(followOn ? { followOn } : {}),
  };
}

function loadReceipt(username: string, idempotencyKey: string): InnerCuriosityReceipt | null {
  const file = receiptFile(username, idempotencyKey);
  if (!fs.existsSync(file)) return null;
  const receipt = parseReceipt(safeReadJSON<unknown>(file));
  if (receipt.username !== username || receipt.idempotencyKey !== idempotencyKey) {
    throw new Error('Inner Curiosity receipt identity does not match the requested execution');
  }
  return receipt;
}

function pruneReceipts(username: string): void {
  const directory = path.join(getProfilePaths(username).state, 'inner-curiosity');
  if (!fs.existsSync(directory)) return;
  const receipts = fs.readdirSync(directory)
    .filter(name => name.endsWith('.json'))
    .map(name => ({ name, mtime: fs.statSync(path.join(directory, name)).mtimeMs }))
    .sort((left, right) => right.mtime - left.mtime);
  let excess = receipts.length - MAX_RECEIPTS;
  for (const receipt of receipts.slice().reverse()) {
    if (excess <= 0) break;
    const file = path.join(directory, receipt.name);
    const parsed = parseReceipt(safeReadJSON<unknown>(file));
    if (parsed.status !== 'completed') continue;
    fs.unlinkSync(file);
    excess -= 1;
    const backupDirectory = path.join(directory, '.backups');
    if (!fs.existsSync(backupDirectory)) continue;
    for (const backup of fs.readdirSync(backupDirectory)) {
      if (backup.startsWith(`${receipt.name}.`) && backup.endsWith('.bak')) {
        fs.unlinkSync(path.join(backupDirectory, backup));
      }
    }
  }
}

function saveReceipt(receipt: InnerCuriosityReceipt): void {
  safeWriteJSON(receiptFile(receipt.username, receipt.idempotencyKey), receipt);
  if (receipt.status === 'completed') pruneReceipts(receipt.username);
}

function auditGenerated(receipt: CompletedInnerCuriosityReceipt, deduplicated: boolean): void {
  audit({
    category: 'action',
    level: 'info',
    event: 'inner_question_generated',
    actor: 'inner-curiosity',
    details: {
      questionLength: receipt.question.length,
      answerLength: receipt.answer.length,
      sourceMemoryCount: receipt.sourceMemoryIds.length,
      searchResultCount: receipt.searchResultIds.length,
      executionId: receipt.executionId,
      deduplicated,
      username: receipt.username,
      followOn: receipt.followOn,
    },
  });
}

const DEFAULT_STATE_DEPENDENCIES: InnerCuriosityStateDependencies = {
  loadConfig: loadCuriosityConfig,
  loadReceipt,
};

const DEFAULT_PREPARE_DEPENDENCIES: InnerCuriosityPrepareDependencies = {
  saveReceipt,
  now: () => new Date(),
};

const DEFAULT_COMPLETE_DEPENDENCIES: InnerCuriosityCompleteDependencies = {
  ...DEFAULT_PREPARE_DEPENDENCIES,
  auditGenerated,
};

export async function executeInnerCuriosityState(
  _inputs: Record<string, unknown>,
  context: NodeExecutionContext,
  _properties: Record<string, unknown> = {},
  dependencies: InnerCuriosityStateDependencies = DEFAULT_STATE_DEPENDENCIES,
): Promise<Record<string, unknown>> {
  throwIfAborted(context);
  const execution = executionIdentity(context);
  const existing = dependencies.loadReceipt(execution.username, execution.idempotencyKey);
  if (existing) {
    const requestedTimestamp = context.requestedExecutionTimestamp === undefined
      ? undefined
      : validTimestamp(
        context.requestedExecutionTimestamp,
        'Inner Curiosity requestedExecutionTimestamp',
      );
    if (
      existing.executionId !== execution.executionId
      || (requestedTimestamp !== undefined && existing.timestamp !== requestedTimestamp)
    ) {
      throw new Error('Inner Curiosity execution identity conflicts with its durable receipt');
    }
    if (existing.status === 'completed') {
      const outcome: InnerCuriosityOutcome = {
        status: 'generated',
        username: execution.username,
        executionId: execution.executionId,
        deduplicated: true,
        memoriesConsidered: existing.sourceMemoryIds.length,
        searchResults: existing.searchResultIds.length,
        ...(existing.followOn ? { followOn: existing.followOn } : {}),
      };
      return { status: 'completed', execution, outcome, shouldGenerate: false };
    }
    return {
      status: 'prepared',
      execution,
      prepared: existing,
      shouldGenerate: false,
      deduplicated: true,
    };
  }

  const config = dependencies.loadConfig(execution.username);
  if (config.innerQuestionMode === 'off') {
    const outcome: InnerCuriosityOutcome = {
      status: 'skipped',
      username: execution.username,
      executionId: execution.executionId,
      reason: 'disabled',
    };
    return { status: 'skipped', execution, outcome, reason: 'disabled', shouldGenerate: false };
  }
  if (config.innerQuestionMode !== 'local') {
    throw new Error(`Unsupported Inner Curiosity mode: ${String(config.innerQuestionMode)}`);
  }
  return { status: 'new', execution, shouldGenerate: true, deduplicated: false };
}

function requiredExecution(value: unknown): InnerCuriosityExecutionIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Inner Curiosity preparation requires execution identity');
  }
  const record = value as Record<string, unknown>;
  return {
    username: requiredString(record.username, 'Inner Curiosity execution username'),
    executionId: requiredString(record.executionId, 'Inner Curiosity executionId', MAX_EXECUTION_ID_CHARS),
    idempotencyKey: requiredString(record.idempotencyKey, 'Inner Curiosity idempotencyKey'),
    timestamp: validTimestamp(record.timestamp, 'Inner Curiosity execution timestamp'),
  };
}

function idsFromRecords(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`${label} item ${index + 1} must be an object`);
    }
    const record = item as Record<string, unknown>;
    return requiredString(record.id ?? record.__memoryId, `${label} item ${index + 1} id`);
  });
}

export async function executeInnerCuriosityPrepare(
  inputs: Record<string, unknown>,
  context: NodeExecutionContext,
  _properties: Record<string, unknown> = {},
  dependencies: InnerCuriosityPrepareDependencies = DEFAULT_PREPARE_DEPENDENCIES,
): Promise<Record<string, unknown>> {
  throwIfAborted(context);
  const execution = requiredExecution(inputs.execution);
  const question = requiredString(inputs.question, 'Inner Curiosity question', 1_500);
  const answer = requiredString(inputs.answer, 'Inner Curiosity answer', 10_000);
  const prepared: PreparedInnerCuriosityReceipt = {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    kind: 'inner-curiosity-execution',
    status: 'prepared',
    ...execution,
    question,
    answer,
    innerDialogue: `🤔 ${question}\n\n💭 ${answer}`,
    sourceMemoryIds: idsFromRecords(inputs.memories, 'Inner Curiosity memories'),
    searchResultIds: idsFromRecords(inputs.searchResults, 'Inner Curiosity search results'),
    sampling: parseSamplingDiagnostics(inputs.sampling),
    preparedAt: dependencies.now().toISOString(),
  };
  dependencies.saveReceipt(prepared);
  throwIfAborted(context);
  return { prepared, text: prepared.innerDialogue };
}

function requiredPreparedReceipt(value: unknown): PreparedInnerCuriosityReceipt {
  const parsed = parseReceipt(value);
  if (parsed.status !== 'prepared') throw new Error('Inner Curiosity requires a prepared receipt');
  return parsed;
}

export async function executeInnerCuriosityEntry(
  inputs: Record<string, unknown>,
  context: NodeExecutionContext,
): Promise<Record<string, unknown>> {
  throwIfAborted(context);
  const prepared = requiredPreparedReceipt(inputs.prepared);
  return {
    prepared,
    entry: {
      role: 'reflection',
      content: prepared.innerDialogue,
      timestamp: prepared.timestamp,
      meta: {
        type: 'inner_question',
        source: 'agent',
        dialogueSource: 'inner-curiosity',
        displayColor: '#8b5cf6',
        tags: ['inner-curiosity', 'self-directed-question', 'inner'],
        idempotencyKey: prepared.idempotencyKey,
        skipDedup: true,
        innerCuriosity: {
          question: prepared.question,
          answer: prepared.answer,
          sourceMemoryIds: prepared.sourceMemoryIds,
          searchResultIds: prepared.searchResultIds,
        },
      },
    },
  };
}

export async function executeInnerCuriosityNoMemories(
  inputs: Record<string, unknown>,
  context: NodeExecutionContext,
): Promise<Record<string, unknown>> {
  throwIfAborted(context);
  const execution = requiredExecution(inputs.execution);
  if (inputs.memoryCount !== 0) {
    throw new Error('Inner Curiosity no-memory branch requires an exact zero memory count');
  }
  const outcome: InnerCuriosityOutcome = {
    status: 'skipped',
    username: execution.username,
    executionId: execution.executionId,
    reason: 'no-memories',
  };
  return { ...outcome, outcome };
}

function optionalFiniteNumber(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be finite`);
  return value;
}

export async function executeInnerCuriosityComplete(
  inputs: Record<string, unknown>,
  context: NodeExecutionContext,
  _properties: Record<string, unknown> = {},
  dependencies: InnerCuriosityCompleteDependencies = DEFAULT_COMPLETE_DEPENDENCIES,
): Promise<Record<string, unknown>> {
  throwIfAborted(context);
  const prepared = requiredPreparedReceipt(inputs.prepared);
  if (inputs.bufferPersisted !== true || inputs.bufferSavedCount !== 1) {
    throw new Error('Inner Curiosity buffer did not durably admit exactly one result');
  }
  if (inputs.memorySaved !== true || inputs.memorySavedCount !== 1) {
    throw new Error('Inner Curiosity memory saver did not durably capture exactly one result');
  }
  const admitted = inputs.followOnAdmitted === true;
  const skipped = inputs.followOnSkipped === true;
  if (admitted === skipped) throw new Error('Inner Curiosity follow-on returned an invalid admission state');
  const probability = optionalFiniteNumber(inputs.followOnProbability, 'Inner Curiosity follow-on probability');
  const roll = optionalFiniteNumber(inputs.followOnRoll, 'Inner Curiosity follow-on roll');
  const followOn: InnerCuriosityFollowOnReceipt = {
    admitted,
    skipped,
    ...(typeof inputs.followOnReason === 'string' && inputs.followOnReason.trim()
      ? { reason: inputs.followOnReason.trim() }
      : {}),
    ...(typeof inputs.followOnTaskId === 'string' && inputs.followOnTaskId.trim()
      ? { taskId: inputs.followOnTaskId.trim() }
      : {}),
    ...(probability !== undefined ? { probability } : {}),
    ...(roll !== undefined ? { roll } : {}),
  };
  const completed: CompletedInnerCuriosityReceipt = {
    ...prepared,
    status: 'completed',
    completedAt: dependencies.now().toISOString(),
    followOn,
  };
  dependencies.saveReceipt(completed);
  const deduplicated = inputs.deduplicated === true;
  dependencies.auditGenerated(completed, deduplicated);
  const outcome: InnerCuriosityOutcome = {
    status: 'generated',
    username: completed.username,
    executionId: completed.executionId,
    deduplicated,
    memoriesConsidered: completed.sourceMemoryIds.length,
    searchResults: completed.searchResultIds.length,
    followOn,
  };
  return { ...outcome, outcome, receipt: completed };
}

export const InnerCuriosityStateNode: NodeDefinition = defineNode({
  id: 'inner_curiosity_state',
  name: 'Inner Curiosity State',
  category: 'curiosity',
  inputs: [],
  outputs: [
    { name: 'status', type: 'string' },
    { name: 'execution', type: 'object' },
    { name: 'outcome', type: 'object', optional: true },
    { name: 'prepared', type: 'object', optional: true },
    { name: 'shouldGenerate', type: 'boolean' },
    { name: 'deduplicated', type: 'boolean', optional: true },
    { name: 'reason', type: 'string', optional: true },
  ],
  properties: {},
  description: 'Resolves execution identity, configuration, and durable retry state before Inner Curiosity cognition.',
  execute: executeInnerCuriosityState,
});

export const InnerCuriosityPrepareNode: NodeDefinition = defineNode({
  id: 'inner_curiosity_prepare',
  name: 'Prepare Inner Curiosity Result',
  category: 'curiosity',
  inputs: [
    { name: 'execution', type: 'object' },
    { name: 'question', type: 'string' },
    { name: 'answer', type: 'string' },
    { name: 'memories', type: 'array' },
    { name: 'searchResults', type: 'array' },
    { name: 'sampling', type: 'object' },
  ],
  outputs: [
    { name: 'prepared', type: 'object' },
    { name: 'text', type: 'string' },
  ],
  properties: {},
  description: 'Durably checkpoints the exact generated question and answer before any buffer or memory effects.',
  execute: executeInnerCuriosityPrepare,
});

export const InnerCuriosityEntryNode: NodeDefinition = defineNode({
  id: 'inner_curiosity_entry',
  name: 'Build Inner Curiosity Entry',
  category: 'curiosity',
  inputs: [{ name: 'prepared', type: 'object' }],
  outputs: [
    { name: 'entry', type: 'message' },
    { name: 'prepared', type: 'object' },
  ],
  properties: {},
  description: 'Builds the typed private inner-dialogue entry from one durable prepared result.',
  execute: executeInnerCuriosityEntry,
});

export const InnerCuriosityNoMemoriesNode: NodeDefinition = defineNode({
  id: 'inner_curiosity_no_memories',
  name: 'Skip Inner Curiosity Without Memories',
  category: 'curiosity',
  inputs: [
    { name: 'execution', type: 'object' },
    { name: 'memoryCount', type: 'number' },
  ],
  outputs: [
    { name: 'status', type: 'string' },
    { name: 'username', type: 'string' },
    { name: 'executionId', type: 'string' },
    { name: 'reason', type: 'string' },
    { name: 'outcome', type: 'object' },
  ],
  properties: {},
  description: 'Returns the explicit no-memories outcome selected by the graph sampling branch.',
  execute: executeInnerCuriosityNoMemories,
});

export const InnerCuriosityCompleteNode: NodeDefinition = defineNode({
  id: 'inner_curiosity_complete',
  name: 'Complete Inner Curiosity',
  category: 'curiosity',
  inputs: [
    { name: 'prepared', type: 'object' },
    { name: 'deduplicated', type: 'boolean' },
    { name: 'bufferPersisted', type: 'boolean' },
    { name: 'bufferSavedCount', type: 'number' },
    { name: 'memorySaved', type: 'boolean' },
    { name: 'memorySavedCount', type: 'number' },
    { name: 'followOnAdmitted', type: 'boolean' },
    { name: 'followOnSkipped', type: 'boolean' },
    { name: 'followOnReason', type: 'string', optional: true },
    { name: 'followOnTaskId', type: 'string', optional: true },
    { name: 'followOnProbability', type: 'number', optional: true },
    { name: 'followOnRoll', type: 'number', optional: true },
  ],
  outputs: [
    { name: 'status', type: 'string' },
    { name: 'username', type: 'string' },
    { name: 'executionId', type: 'string' },
    { name: 'deduplicated', type: 'boolean' },
    { name: 'memoriesConsidered', type: 'number' },
    { name: 'searchResults', type: 'number' },
    { name: 'followOn', type: 'object' },
    { name: 'outcome', type: 'object' },
    { name: 'receipt', type: 'object' },
  ],
  properties: {},
  description: 'Validates buffer, memory, and follow-on results before marking the execution durably complete.',
  execute: executeInnerCuriosityComplete,
});

export function innerCuriosityErrorMessage(error: unknown): string {
  return errorMessage(error);
}
