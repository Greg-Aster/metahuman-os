import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getProfilePaths } from './path-builder.js';

export type CuriosityQuestionResolution = 'answered' | 'skipped';
export type CuriosityQuestionStatus = 'pending' | CuriosityQuestionResolution;

export interface CuriosityQuestionRecord {
  version: 1;
  id: string;
  question: string;
  askedAt: string;
  seedMemories: string[];
  status: CuriosityQuestionStatus;
  username: string;
  resolvedAt?: string;
  answeredAt?: string;
  skippedAt?: string;
}

export interface CreateCuriosityQuestionInput {
  question: string;
  seedMemories?: string[];
  id?: string;
  askedAt?: string;
}

export interface ResolveCuriosityQuestionResult {
  changed: boolean;
  record: CuriosityQuestionRecord;
}

type StateRootResolver = (username: string) => string;

export class CuriosityQuestionNotFoundError extends Error {
  constructor(readonly questionId: string) {
    super(`Curiosity question not found: ${questionId}`);
    this.name = 'CuriosityQuestionNotFoundError';
  }
}

export class CuriosityQuestionResolutionConflictError extends Error {
  constructor(
    readonly questionId: string,
    readonly existingResolution: CuriosityQuestionResolution,
    readonly requestedResolution: CuriosityQuestionResolution,
  ) {
    super(`Curiosity question ${questionId} is already ${existingResolution}`);
    this.name = 'CuriosityQuestionResolutionConflictError';
  }
}

function questionId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(value)) {
    throw new Error('Curiosity question id must be a path-safe identifier');
  }
  return value;
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function boundedString(value: unknown, field: string, maxLength: number): string {
  const normalized = nonEmptyString(value, field);
  if (normalized.length > maxLength) throw new Error(`${field} exceeds ${maxLength} characters`);
  return normalized;
}

function profileUsername(value: unknown): string {
  const normalized = nonEmptyString(value, 'username');
  if (!/^[a-zA-Z0-9_-]{1,50}$/.test(normalized)) {
    throw new Error('username must be a path-safe profile identifier');
  }
  return normalized;
}

function timestamp(value: unknown, field: string): string {
  const normalized = nonEmptyString(value, field);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(normalized)
    || Number.isNaN(Date.parse(normalized))) {
    throw new Error(`${field} must be an ISO timestamp`);
  }
  return normalized;
}

function stringArray(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  if (value.length > 1_000) throw new Error(`${field} exceeds 1000 items`);
  return [...new Set(value.map((item, index) => boundedString(item, `${field}[${index}]`, 256)))];
}

function parseRecord(
  value: unknown,
  expectedId: string,
  username: string,
  directoryStatus: CuriosityQuestionStatus,
): CuriosityQuestionRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Curiosity question ${expectedId} must contain an object`);
  }
  const raw = value as Record<string, unknown>;
  if (raw.version !== undefined && raw.version !== 1) {
    throw new Error(`Curiosity question ${expectedId} has an unsupported version`);
  }
  const id = questionId(raw.id);
  if (id !== expectedId) throw new Error(`Curiosity question filename and id disagree: ${expectedId}`);
  const recordUsername = nonEmptyString(raw.username, `Curiosity question ${id} username`);
  if (recordUsername !== username) throw new Error(`Curiosity question ${id} belongs to another profile`);

  const rawStatus = raw.status;
  let status: CuriosityQuestionStatus;
  if (directoryStatus === 'pending') {
    if (rawStatus !== undefined && rawStatus !== 'pending') {
      throw new Error(`Curiosity question ${id} has invalid pending status`);
    }
    status = 'pending';
  } else {
    if (rawStatus !== undefined && rawStatus !== 'answered' && rawStatus !== 'skipped') {
      throw new Error(`Curiosity question ${id} has invalid resolved status`);
    }
    status = rawStatus === 'skipped' ? 'skipped' : 'answered';
  }
  const resolvedAt = status === 'pending'
    ? undefined
    : timestamp(raw.resolvedAt ?? raw.answeredAt ?? raw.skippedAt, `Curiosity question ${id} resolvedAt`);

  return {
    version: 1,
    id,
    question: boundedString(raw.question, `Curiosity question ${id} question`, 10_000),
    askedAt: timestamp(raw.askedAt, `Curiosity question ${id} askedAt`),
    seedMemories: stringArray(raw.seedMemories, `Curiosity question ${id} seedMemories`),
    status,
    username,
    ...(resolvedAt ? { resolvedAt } : {}),
    ...(status === 'answered' && resolvedAt ? { answeredAt: resolvedAt } : {}),
    ...(status === 'skipped' && resolvedAt ? { skippedAt: resolvedAt } : {}),
  };
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function writeJsonExclusively(filePath: string, value: unknown): Promise<void> {
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    const serialized = `${JSON.stringify(value, null, 2)}\n`;
    await fs.writeFile(temporary, serialized, { encoding: 'utf-8', flag: 'wx' });
    JSON.parse(await fs.readFile(temporary, 'utf-8'));
    // Linking a complete same-directory temp file publishes it atomically and
    // fails with EEXIST instead of overwriting a competing lifecycle result.
    await fs.link(temporary, filePath);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

export class CuriosityQuestionStore {
  constructor(
    private readonly resolveStateRoot: StateRootResolver = username => getProfilePaths(username).state,
  ) {}

  private questionsRoot(username: string): string {
    const normalized = profileUsername(username);
    return path.join(this.resolveStateRoot(normalized), 'curiosity', 'questions');
  }

  private pendingDirectory(username: string): string {
    return path.join(this.questionsRoot(username), 'pending');
  }

  private answeredDirectory(username: string): string {
    return path.join(this.questionsRoot(username), 'answered');
  }

  private async readRecord(
    filePath: string,
    username: string,
    status: CuriosityQuestionStatus,
  ): Promise<CuriosityQuestionRecord> {
    const id = path.basename(filePath, '.json');
    let value: unknown;
    try {
      value = JSON.parse(await fs.readFile(filePath, 'utf-8'));
    } catch (error) {
      throw new Error(`Could not read curiosity question ${id}: ${(error as Error).message}`);
    }
    return parseRecord(value, id, username, status);
  }

  async create(username: string, input: CreateCuriosityQuestionInput): Promise<CuriosityQuestionRecord> {
    const id = input.id ? questionId(input.id) : `cur-q-${Date.now()}-${randomUUID()}`;
    const askedAt = timestamp(input.askedAt ?? new Date().toISOString(), 'askedAt');
    const record: CuriosityQuestionRecord = {
      version: 1,
      id,
      question: boundedString(input.question, 'question', 10_000),
      askedAt,
      seedMemories: stringArray(input.seedMemories, 'seedMemories'),
      status: 'pending',
      username: profileUsername(username),
    };
    const destination = path.join(this.pendingDirectory(username), `${id}.json`);
    try {
      await writeJsonExclusively(destination, record);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new Error(`Curiosity question already exists: ${id}`);
      }
      throw error;
    }
    return record;
  }

  async listPending(username: string): Promise<CuriosityQuestionRecord[]> {
    const pendingDirectory = this.pendingDirectory(username);
    const answeredDirectory = this.answeredDirectory(username);
    let pendingEntries: string[];
    let answeredEntries: string[];
    try {
      pendingEntries = await fs.readdir(pendingDirectory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    try {
      answeredEntries = await fs.readdir(answeredDirectory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') answeredEntries = [];
      else throw error;
    }
    const resolvedIds = new Set(
      answeredEntries.filter(name => name.endsWith('.json')).map(name => name.slice(0, -5)),
    );
    const records: CuriosityQuestionRecord[] = [];
    for (const filename of pendingEntries.filter(name => name.endsWith('.json')).sort()) {
      const id = filename.slice(0, -5);
      if (resolvedIds.has(id)) continue;
      records.push(await this.readRecord(path.join(pendingDirectory, filename), username, 'pending'));
    }
    return records.sort((left, right) => Date.parse(left.askedAt) - Date.parse(right.askedAt));
  }

  async countPending(username: string): Promise<number> {
    return (await this.listPending(username)).length;
  }

  async listResolved(username: string): Promise<CuriosityQuestionRecord[]> {
    const answeredDirectory = this.answeredDirectory(username);
    let entries: string[];
    try {
      entries = await fs.readdir(answeredDirectory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const records: CuriosityQuestionRecord[] = [];
    for (const filename of entries.filter(name => name.endsWith('.json')).sort()) {
      records.push(await this.readRecord(path.join(answeredDirectory, filename), username, 'answered'));
    }
    return records.sort((left, right) => Date.parse(left.askedAt) - Date.parse(right.askedAt));
  }

  async listAll(username: string): Promise<CuriosityQuestionRecord[]> {
    const records = [...await this.listPending(username), ...await this.listResolved(username)];
    return records.sort((left, right) => Date.parse(right.askedAt) - Date.parse(left.askedAt));
  }

  async get(username: string, idValue: string): Promise<CuriosityQuestionRecord | null> {
    const id = questionId(idValue);
    const answeredPath = path.join(this.answeredDirectory(username), `${id}.json`);
    if (await exists(answeredPath)) return this.readRecord(answeredPath, username, 'answered');
    const pendingPath = path.join(this.pendingDirectory(username), `${id}.json`);
    if (await exists(pendingPath)) return this.readRecord(pendingPath, username, 'pending');
    return null;
  }

  async resolve(
    username: string,
    idValue: string,
    resolution: CuriosityQuestionResolution,
    resolvedAtValue = new Date().toISOString(),
  ): Promise<ResolveCuriosityQuestionResult> {
    const id = questionId(idValue);
    const resolvedAt = timestamp(resolvedAtValue, 'resolvedAt');
    const pendingPath = path.join(this.pendingDirectory(username), `${id}.json`);
    const answeredPath = path.join(this.answeredDirectory(username), `${id}.json`);

    if (await exists(answeredPath)) {
      const record = await this.readRecord(answeredPath, username, resolution);
      await fs.rm(pendingPath, { force: true });
      if (record.status === 'pending') throw new Error(`Resolved curiosity question ${id} is pending`);
      if (record.status !== resolution) {
        throw new CuriosityQuestionResolutionConflictError(id, record.status, resolution);
      }
      return { changed: false, record };
    }
    if (!(await exists(pendingPath))) throw new CuriosityQuestionNotFoundError(id);

    const pending = await this.readRecord(pendingPath, username, 'pending');
    const record: CuriosityQuestionRecord = {
      ...pending,
      status: resolution,
      resolvedAt,
      ...(resolution === 'answered' ? { answeredAt: resolvedAt } : { skippedAt: resolvedAt }),
    };
    try {
      await writeJsonExclusively(answeredPath, record);
      await fs.rm(pendingPath, { force: true });
      return { changed: true, record };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const existing = await this.readRecord(answeredPath, username, resolution);
      await fs.rm(pendingPath, { force: true });
      if (existing.status === 'pending') throw new Error(`Resolved curiosity question ${id} is pending`);
      if (existing.status !== resolution) {
        throw new CuriosityQuestionResolutionConflictError(id, existing.status, resolution);
      }
      return { changed: false, record: existing };
    }
  }
}

export const curiosityQuestionStore = new CuriosityQuestionStore();
