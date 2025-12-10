/**
 * Export Conversations API Handler
 *
 * POST to export conversations to text files.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { systemPaths } from '../../paths.js';

// Dynamic import for storageClient
let storageClient: any = null;

async function ensureStorageClient(): Promise<boolean> {
  if (storageClient) return true;
  try {
    const core = await import('../../index.js');
    storageClient = core.storageClient;
    return !!storageClient;
  } catch {
    return false;
  }
}

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (entry.isFile() && entry.name.endsWith('.json')) out.push(p);
  }
  return out;
}

function extractUserText(content: string): string {
  // Common format: Me: "text" — fallback to raw content if no match
  const m = /^\s*Me:\s*"([\s\S]*?)"\s*$/.exec(content);
  if (m && m[1]) return m[1];
  // Remove leading Me: if present
  return content.replace(/^\s*Me:\s*/i, '').trim();
}

/**
 * POST /api/export/conversations - Export conversations to text files
 */
export async function handleExportConversations(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const available = await ensureStorageClient();
    if (!available || !storageClient) {
      return { status: 501, error: 'Storage client not available' };
    }

    const episodicResult = storageClient.resolvePath({ category: 'memory', subcategory: 'episodic' });
    if (!episodicResult.success || !episodicResult.path) {
      return { status: 500, error: 'Cannot resolve episodic path' };
    }

    const episodicRoot = episodicResult.path;
    const files = walk(episodicRoot);
    const records: Array<{ id: string; text: string; ts: string; type?: string }> = [];

    for (const f of files) {
      try {
        const obj = JSON.parse(readFileSync(f, 'utf-8'));
        const type = String(obj?.type || '');
        if (type !== 'conversation' && type !== 'inner_dialogue') continue;
        if (!obj?.content) continue;
        const text = extractUserText(String(obj.content));
        if (!text || text.length < 1) continue;
        records.push({
          id: String(obj.id || path.basename(f, '.json')),
          text,
          ts: String(obj.timestamp || ''),
          type
        });
      } catch {
        // Skip invalid files
      }
    }

    if (records.length === 0) {
      return successResponse({ success: true, count: 0, dir: null });
    }

    const stamp = new Date().toISOString().replace(/[:T.Z]/g, '').slice(0, 14);
    const inboxResult = storageClient.resolvePath({ category: 'memory', subcategory: 'inbox' });
    if (!inboxResult.success || !inboxResult.path) {
      return { status: 500, error: 'Cannot resolve inbox path' };
    }

    const destDir = path.join(inboxResult.path, `chat-export-${stamp}`);
    mkdirSync(destDir, { recursive: true });

    let n = 0;
    for (const r of records) {
      const nameSafe = r.id.replace(/[^a-zA-Z0-9_-]+/g, '').slice(0, 40) || `rec${n}`;
      const fname = `${String(n).padStart(4, '0')}-${nameSafe}.txt`;
      const body = r.text.trim() + '\n';
      writeFileSync(path.join(destDir, fname), body);
      n++;
    }

    return successResponse({
      success: true,
      count: n,
      dir: path.relative(systemPaths.root, destDir),
    });
  } catch (error) {
    console.error('[export-conversations] POST failed:', error);
    return { status: 500, error: (error as Error).message };
  }
}
