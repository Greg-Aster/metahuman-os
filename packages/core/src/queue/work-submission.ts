/** Service-token handoff to the one server-owned work coordinator. */

import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { systemPaths } from '../path-builder.js';
import type { QueuedTask, TaskInput } from './types.js';

const TOKEN_FILE = path.join(systemPaths.logs, 'run', 'queue', 'service-token');
const SUBMISSION_PATH = '/api/internal/work-coordinator/enqueue';
let owner = false;
let ownerToken = '';

function readToken(): string {
  try {
    return fs.readFileSync(TOKEN_FILE, 'utf8').trim();
  } catch {
    return '';
  }
}

export function claimWorkCoordinatorOwnership(): void {
  if (owner) return;
  fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
  ownerToken = readToken() || randomBytes(32).toString('hex');
  if (!fs.existsSync(TOKEN_FILE)) fs.writeFileSync(TOKEN_FILE, `${ownerToken}\n`, { mode: 0o600 });
  try { fs.chmodSync(TOKEN_FILE, 0o600); } catch {}
  owner = true;
}

export function isWorkCoordinatorOwner(): boolean {
  return owner;
}

export function authorizeWorkSubmission(authorization?: string): boolean {
  if (!owner || !ownerToken) return false;
  const supplied = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  const expectedBytes = Buffer.from(ownerToken);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}

function coordinatorUrl(): string {
  if (process.env.MH_WORK_COORDINATOR_URL?.trim()) return process.env.MH_WORK_COORDINATOR_URL.trim();
  const port = process.env.PORT?.trim() || '4321';
  return `http://127.0.0.1:${port}`;
}

export async function submitCoordinatorWork(input: TaskInput): Promise<QueuedTask> {
  if (owner) {
    const { ensureQueueSystemStarted } = await import('./queue-system.js');
    const system = await ensureQueueSystemStarted();
    return system.enqueue(input);
  }

  const token = readToken();
  if (!token) throw new Error('Server-owned work coordinator is not available');
  const response = await fetch(`${coordinatorUrl()}${SUBMISSION_PATH}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
  });
  const body = await response.json() as { task?: QueuedTask; error?: string };
  if (!response.ok || !body.task) throw new Error(body.error || `Coordinator submission failed (${response.status})`);
  return body.task;
}
