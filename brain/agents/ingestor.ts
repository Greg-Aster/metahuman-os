#!/usr/bin/env node
/**
 * Ingestor Agent — Converts files in memory/inbox into episodic memories
 * - Reads raw files from `memory/inbox/`
 * - Splits long content into chunks
 * - Creates episodic events for each chunk
 * - Moves processed files to `memory/inbox/_archive/YYYY-MM-DD/`
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  paths,
  audit,
  auditAction,
  captureEvent,
  acquireLock,
  isLocked,
  listUsers,
  withUserContext,
  initGlobalLogger,
} from '@metahuman/core';

function ensureDirs() {
  // Use context-aware paths
  fs.mkdirSync(paths.inbox, { recursive: true });
  fs.mkdirSync(paths.inboxArchive, { recursive: true });
}

function readFileAsText(filePath: string): string {
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

function chunkText(text: string, maxChars = 2000): string[] {
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

async function ingestFile(filePath: string) {
  const fileName = path.basename(filePath);
  const baseTag = 'ingested';
  const content = readFileAsText(filePath);
  const chunks = chunkText(content, 2000);

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
  const date = new Date().toISOString().slice(0, 10);
  const archiveDir = path.join(paths.inboxArchive, date);
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

/**
 * Ingest files for a single user
 */
async function ingestUserFiles(username: string): Promise<number> {
  console.log(`[ingestor] Processing user: ${username}`);

  ensureDirs();

  const entries = fs.existsSync(paths.inbox) ? fs.readdirSync(paths.inbox, { withFileTypes: true }) : [];
  const files = entries.filter(e => e.isFile()).map(e => path.join(paths.inbox, e.name));

  if (files.length === 0) {
    console.log(`[ingestor]   No files in inbox for ${username}`);
    return 0;
  }

  console.log(`[ingestor]   Found ${files.length} file(s) to ingest`);

  let processed = 0;
  for (const file of files) {
    try {
      await ingestFile(file);
      console.log(`[ingestor]   ✓ Ingested: ${path.basename(file)}`);
      processed++;
    } catch (e) {
      console.error(`[ingestor]   ✗ Failed: ${path.basename(file)} — ${(e as Error).message}`);
      auditAction({
        skill: 'ingestor:capture',
        inputs: { file: path.basename(file) },
        success: false,
        error: (e as Error).message,
      });
    }
  }

  console.log(`[ingestor]   Completed ${username} ✅`);
  return processed;
}

async function main() {
  initGlobalLogger('ingestor');

  // Single-instance guard
  let lock;
  try {
    if (isLocked('agent-ingestor')) {
      console.log('[ingestor] Another instance is already running. Exiting.');
      return;
    }
    lock = acquireLock('agent-ingestor');
  } catch {
    console.log('[ingestor] Failed to acquire lock. Exiting.');
    return;
  }

  try {
    console.log('[ingestor] Starting ingestion cycle (multi-user)...');

    // Audit cycle start (system-level)
    audit({
      level: 'info',
      category: 'action',
      event: 'agent_cycle_started',
      details: { agent: 'ingestor', mode: 'multi-user' },
      actor: 'agent',
    });

    // Get all users
    const users = listUsers();
    console.log(`[ingestor] Found ${users.length} users to process`);

    let totalProcessed = 0;

    // Process each user with isolated context
    for (const user of users) {
      try {
        const processed = await withUserContext(
          { userId: user.id, username: user.username, role: user.role },
          async () => {
            return await ingestUserFiles(user.username);
          }
        );

        totalProcessed += processed;
      } catch (error) {
        console.error(`[ingestor] Failed to process user ${user.username}:`, (error as Error).message);
        // Continue with next user
      }
    }

    console.log(`[ingestor] Cycle finished. Processed ${totalProcessed} files across ${users.length} users. ✅`);

    // Audit completion (system-level)
    audit({
      level: 'info',
      category: 'action',
      event: 'agent_cycle_completed',
      details: {
        agent: 'ingestor',
        mode: 'multi-user',
        totalProcessed,
        userCount: users.length,
      },
      actor: 'agent',
    });
  } catch (error) {
    console.error('[ingestor] Error during cycle:', (error as Error).message);
    audit({
      level: 'error',
      category: 'action',
      event: 'agent_cycle_failed',
      details: { agent: 'ingestor', mode: 'multi-user', error: (error as Error).message },
      actor: 'agent',
    });
  } finally {
    lock.release();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
