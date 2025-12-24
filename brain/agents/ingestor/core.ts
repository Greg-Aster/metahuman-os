/**
 * Ingestor Agent — Core Logic
 *
 * Converts files in memory/inbox into episodic memories:
 * - Reads raw files from `memory/inbox/`
 * - Splits long content into chunks
 * - Creates episodic events for each chunk
 * - Moves processed files to `memory/inbox/_archive/YYYY-MM-DD/`
 *
 * This module can be used both:
 * - CLI: via cli.ts wrapper
 * - Mobile: imported directly and run in-process
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  storageClient,
  audit,
  auditAction,
  captureEvent,
  getTargetUser,
  withUserContext,
} from '@metahuman/core';
import type { AgentContext, AgentInput, AgentResult } from '@metahuman/agent-runtime';

// ============================================================================
// Types
// ============================================================================

export interface IngestorOptions {
  maxChars?: number;
  singleUser?: boolean;
  limit?: number;
}

export interface IngestorResult {
  success: boolean;
  filesProcessed: number;
  userCount: number;
  errors: string[];
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Resolve inbox and archive paths using storage router
 */
export function resolveInboxPaths(): { inbox: string; archive: string } | null {
  const inboxResult = storageClient.resolvePath({ category: 'memory', subcategory: 'inbox' });
  if (!inboxResult.success || !inboxResult.path) {
    console.error('[ingestor] Cannot resolve inbox path');
    return null;
  }

  return {
    inbox: inboxResult.path,
    archive: path.join(inboxResult.path, '_archive'),
  };
}

function ensureDirs() {
  const paths = resolveInboxPaths();
  if (!paths) return;

  fs.mkdirSync(paths.inbox, { recursive: true });
  fs.mkdirSync(paths.archive, { recursive: true });
}

export function readFileAsText(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  try {
    if (ext === '.json') {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (typeof data === 'string') return data;
      if (data && typeof data.content === 'string') return data.content;
      return JSON.stringify(data, null, 2);
    }
    // Treat others as text
    return fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    throw new Error(`Failed to read ${path.basename(filePath)}: ${(e as Error).message}`);
  }
}

export function chunkText(text: string, maxChars = 2000): string[] {
  if (text.length <= maxChars) return [text];
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    const end = Math.min(i + maxChars, text.length);
    chunks.push(text.slice(i, end));
    i = end;
  }
  return chunks;
}

// ============================================================================
// File Ingestion
// ============================================================================

export async function ingestFile(filePath: string, maxChars: number = 2000) {
  const fileName = path.basename(filePath);
  const baseTag = 'ingested';
  const content = readFileAsText(filePath);
  const chunks = chunkText(content, maxChars);

  let created = 0;
  for (let idx = 0; idx < chunks.length; idx++) {
    const chunk = chunks[idx];
    const extra = chunks.length > 1 ? ` [${idx + 1}/${chunks.length}]` : '';
    const note = `${fileName}${extra}`;
    const filepath = captureEvent(chunk, {
      type: 'observation',
      tags: [baseTag, 'inbox'],
      links: [{ type: 'source', target: note }],
    });
    created++;
    auditAction({
      skill: 'ingestor:capture',
      inputs: { file: fileName, chunk: idx + 1, total: chunks.length },
      success: true,
      output: { path: filepath },
    });
  }

  // Archive file after successful ingestion
  const inboxPaths = resolveInboxPaths();
  if (!inboxPaths) {
    console.error('[ingestor] Cannot archive file - inbox paths not resolved');
    return;
  }
  const date = new Date().toISOString().slice(0, 10);
  const archiveDir = path.join(inboxPaths.archive, date);
  fs.mkdirSync(archiveDir, { recursive: true });
  const dest = path.join(archiveDir, fileName);
  fs.renameSync(filePath, dest);

  auditAction({
    skill: 'ingestor:archive',
    inputs: { source: fileName },
    success: true,
    output: { archivePath: dest, created },
  });
}

// ============================================================================
// User Processing
// ============================================================================

/**
 * Ingest files for a single user
 */
export async function ingestUserFiles(
  username: string,
  options: IngestorOptions = {}
): Promise<number> {
  console.log(`[ingestor] Processing user: ${username}`);

  ensureDirs();

  const inboxPaths = resolveInboxPaths();
  if (!inboxPaths) {
    console.error(`[ingestor] Cannot resolve inbox paths for ${username}`);
    return 0;
  }

  const entries = fs.existsSync(inboxPaths.inbox) ? fs.readdirSync(inboxPaths.inbox, { withFileTypes: true }) : [];
  let files = entries.filter(e => e.isFile()).map(e => path.join(inboxPaths.inbox, e.name));

  // Apply limit if specified
  if (options.limit && options.limit > 0) {
    files = files.slice(0, options.limit);
  }

  if (files.length === 0) {
    console.log(`[ingestor]   No files in inbox for ${username}`);
    return 0;
  }

  console.log(`[ingestor]   Found ${files.length} file(s) to ingest`);

  let processed = 0;
  for (const file of files) {
    try {
      await ingestFile(file, options.maxChars || 2000);
      console.log(`[ingestor]   Ingested: ${path.basename(file)}`);
      processed++;
    } catch (e) {
      console.error(`[ingestor]   Failed: ${path.basename(file)} — ${(e as Error).message}`);
      auditAction({
        skill: 'ingestor:capture',
        inputs: { file: path.basename(file) },
        success: false,
        error: (e as Error).message,
      });
    }
  }

  console.log(`[ingestor]   Completed ${username}`);
  return processed;
}

// ============================================================================
// Main Cycle
// ============================================================================

/**
 * Run a full ingestor cycle (multi-user)
 */
export async function runCycle(options: IngestorOptions = {}): Promise<IngestorResult> {
  console.log('[ingestor] Starting cycle...');

  const result: IngestorResult = {
    success: false,
    filesProcessed: 0,
    userCount: 0,
    errors: [],
  };

  try {
    // Audit cycle start (system-level)
    audit({
      level: 'info',
      category: 'action',
      event: 'agent_cycle_started',
      details: { agent: 'ingestor', mode: 'single-active-user' },
      actor: 'agent',
    });

    // SECURITY: Get target user - prioritizes explicit username, then API trigger, then most recently active
    const activeUser = getTargetUser();

    if (!activeUser) {
      console.log('[ingestor] No active users found, skipping cycle.');
      result.success = true;
      return result;
    }

    console.log(`[ingestor] Processing user: ${activeUser.username}`);
    result.userCount = 1;

    try {
      const processed = await withUserContext(
        { userId: activeUser.userId, username: activeUser.username, role: activeUser.role },
        async () => {
          return await ingestUserFiles(activeUser.username, options);
        }
      );

      result.filesProcessed += processed;
    } catch (error) {
      const errorMsg = `User ${activeUser.username}: ${(error as Error).message}`;
      console.error(`[ingestor] Failed: ${errorMsg}`);
      result.errors.push(errorMsg);
    }

    console.log(`[ingestor] Cycle finished. Processed ${result.filesProcessed} files for user ${activeUser.username}.`);

    // Audit completion (system-level)
    audit({
      level: 'info',
      category: 'action',
      event: 'agent_cycle_completed',
      details: {
        agent: 'ingestor',
        mode: 'single-active-user',
        totalProcessed: result.filesProcessed,
        username: activeUser.username,
      },
      actor: 'agent',
    });

    result.success = result.errors.length === 0;
    return result;
  } catch (error) {
    const errorMsg = (error as Error).message;
    console.error('[ingestor] Error during cycle:', errorMsg);

    audit({
      level: 'error',
      category: 'action',
      event: 'agent_cycle_failed',
      details: { agent: 'ingestor', mode: 'multi-user', error: errorMsg },
      actor: 'agent',
    });

    result.errors.push(errorMsg);
    return result;
  }
}

// ============================================================================
// Agent Runtime Interface
// ============================================================================

/**
 * Run function for agent-runtime
 */
export async function run(ctx: AgentContext, input: AgentInput): Promise<AgentResult> {
  const startTime = Date.now();
  const args = input.args || [];
  const opts = input.options || {};

  const options: IngestorOptions = {
    singleUser: args.includes('--single-user') || opts.singleUser === true,
    maxChars: typeof opts.maxChars === 'number' ? opts.maxChars : 2000,
  };

  // Parse limit from args
  const limitArg = args.find(a => a.startsWith('--limit='));
  if (limitArg) {
    options.limit = parseInt(limitArg.split('=')[1], 10);
  }

  try {
    // If running for a specific user context, process just that user
    if (ctx.username && options.singleUser) {
      const processed = await withUserContext(
        { userId: ctx.username, username: ctx.username, role: 'owner' },
        async () => ingestUserFiles(ctx.username, options)
      );

      return {
        success: true,
        data: { filesProcessed: processed, userCount: 1, errors: [] },
        duration: Date.now() - startTime,
        itemsProcessed: processed,
      };
    }

    // Otherwise run full cycle
    const result = await runCycle(options);

    return {
      success: result.success,
      data: result,
      error: result.errors.length > 0 ? result.errors.join('; ') : undefined,
      duration: Date.now() - startTime,
      itemsProcessed: result.filesProcessed,
    };
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message,
      duration: Date.now() - startTime,
    };
  }
}
