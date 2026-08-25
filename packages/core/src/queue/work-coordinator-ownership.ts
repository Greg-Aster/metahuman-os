/** Process-local ownership and service-token authentication for the work coordinator. */

import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { systemPaths } from '../path-builder.js';

const TOKEN_FILE = path.join(systemPaths.logs, 'run', 'queue', 'service-token');
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

export function getWorkCoordinatorToken(): string {
  return readToken();
}

export function getWorkCoordinatorUrl(): string {
  if (process.env.MH_WORK_COORDINATOR_URL?.trim()) return process.env.MH_WORK_COORDINATOR_URL.trim();
  const port = process.env.PORT?.trim() || '4321';
  return `http://127.0.0.1:${port}`;
}
