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
import { paths, audit, auditAction, captureEvent, acquireLock, isLocked } from '@metahuman/core';

const INBOX = paths.inbox;
const ARCHIVE_ROOT = paths.inboxArchive;

function ensureDirs() {
  fs.mkdirSync(INBOX, { recursive: true });
  fs.mkdirSync(ARCHIVE_ROOT, { recursive: true });
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
  const archiveDir = path.join(ARCHIVE_ROOT, date);
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

async function main() {
  // Single-instance guard for one-shot ingestor
  try {
    if (isLocked('agent-ingestor')) {
      console.log('[ingestor] Another instance is already running. Exiting.');
      return;
    }
    acquireLock('agent-ingestor');
  } catch {
    console.log('[ingestor] Failed to acquire lock. Exiting.');
    return;
  }
  ensureDirs();

  audit({
    level: 'info',
    category: 'action',
    event: 'agent_started',
    details: { agent: 'ingestor' },
    actor: 'agent',
  });

  const entries = fs.existsSync(INBOX) ? fs.readdirSync(INBOX, { withFileTypes: true }) : [];
  const files = entries.filter(e => e.isFile()).map(e => path.join(INBOX, e.name));

  if (files.length === 0) {
    console.log('Inbox is empty. Place files in memory/inbox to ingest.');
    return;
  }

  console.log(`Found ${files.length} file(s) to ingest.`);

  for (const file of files) {
    try {
      await ingestFile(file);
      console.log(`✓ Ingested: ${path.basename(file)}`);
    } catch (e) {
      console.error(`✗ Failed: ${path.basename(file)} — ${(e as Error).message}`);
      auditAction({
        skill: 'ingestor:capture',
        inputs: { file: path.basename(file) },
        success: false,
        error: (e as Error).message,
      });
    }
  }

  audit({
    level: 'info',
    category: 'action',
    event: 'agent_completed',
    details: { agent: 'ingestor', processed: files.length },
    actor: 'agent',
  });
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
