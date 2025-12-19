/**
 * Memories All Handler
 *
 * Returns all memory types for the memory browser UI.
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse, errorResponse, unauthorizedResponse, forbiddenResponse } from '../types.js';
import fs from 'node:fs';
import path from 'node:path';
import { getProfilePaths, ROOT } from '../../index.js';
import { getSecurityPolicy } from '../../security-policy.js';
import { indexFilePath } from '../../vector-index.js';

interface EpisodicItem {
  id: string;
  timestamp: string;
  content: string;
  type?: string;
  tags?: string[];
  entities?: string[];
  links?: Array<{ type: string; target: string }>;
  relPath: string;
  validation?: { status?: 'correct' | 'incorrect'; by?: string; timestamp?: string };
}

interface TaskItem {
  id: string;
  title: string;
  status: string;
  priority?: string;
  updated?: string;
  relPath: string;
}

interface CuratedItem {
  name: string;
  relPath: string;
}

interface CuriosityQuestion {
  id: string;
  question: string;
  askedAt: string;
  status: 'pending' | 'answered';
  relPath: string;
  seedMemories?: string[];
  answeredAt?: string;
}

function extractTypeFromPath(filePath: string): string | undefined {
  if (filePath.includes('/reflections/')) return 'reflection';
  if (filePath.includes('/dreams/')) return 'dream';
  if (filePath.includes('/audio-dreams/')) return 'dream';
  return 'observation';
}

function listEpisodic(profilePaths: ReturnType<typeof getProfilePaths>, username: string, limit?: number): EpisodicItem[] {
  // Get the configured index path from vector-index.ts (respects embedding model settings)
  const configuredIndexPath = indexFilePath(undefined, username);

  let idx: { meta: any; data: any[] } | null = null;
  let usedIndexPath: string | null = null;

  // Try the configured index first
  try {
    if (fs.existsSync(configuredIndexPath)) {
      idx = JSON.parse(fs.readFileSync(configuredIndexPath, 'utf8'));
      usedIndexPath = configuredIndexPath;
      console.log(`[memories_all] Using configured index: ${path.basename(configuredIndexPath)} (${idx?.data?.length || 0} items)`);
    }
  } catch (err) {
    console.warn(`[memories_all] Failed to load configured index:`, err);
  }

  // If configured index doesn't exist or is empty, scan for any available index
  if (!idx || !idx.data || idx.data.length === 0) {
    console.log('[memories_all] Configured index not found or empty, scanning for available indices...');

    try {
      const indexDir = profilePaths.indexDir;
      if (fs.existsSync(indexDir)) {
        const files = fs.readdirSync(indexDir).filter(f => f.startsWith('embeddings-') && f.endsWith('.json'));

        for (const file of files) {
          const indexPath = path.join(indexDir, file);
          try {
            const candidate = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
            const itemCount = candidate?.data?.length || 0;
            console.log(`[memories_all] Found index: ${file} (${itemCount} items)`);

            // Use the index with the most items
            if (itemCount > (idx?.data?.length || 0)) {
              idx = candidate;
              usedIndexPath = indexPath;
            }
          } catch (err) {
            console.warn(`[memories_all] Failed to load ${file}:`, err);
          }
        }
      }
    } catch (err) {
      console.warn('[memories_all] Failed to scan index directory:', err);
    }
  }

  if (usedIndexPath) {
    console.log(`[memories_all] Selected index: ${path.basename(usedIndexPath)} (${idx?.data?.length || 0} items)`);
  } else {
    console.warn('[memories_all] No vector index found, falling back to filesystem scan');
  }

  if (idx && idx.data && idx.data.length > 0) {
    const items: EpisodicItem[] = idx.data
      .filter((item: any) => item.type === 'episodic')
      .map((item: any) => {
        const textParts = item.text.split(' Tags:');
        const contentPart = textParts[0];
        const tagsAndEntities = textParts[1] || '';

        const tagsMatch = tagsAndEntities.match(/^([^]*?) Entities:/);
        const tags = tagsMatch
          ? tagsMatch[1].trim().split(/\s+/).filter(Boolean)
          : tagsAndEntities.trim().split(/\s+/).filter(Boolean);

        const entitiesMatch = tagsAndEntities.match(/Entities:([^]*?)$/);
        const entities = entitiesMatch
          ? entitiesMatch[1].trim().split(/\s+/).filter(Boolean)
          : [];

        // Compute relPath relative to profile root (handles custom external storage)
        // IMPORTANT: Always use profile: prefix so paths resolve to the user's actual profile location
        // This handles the case where index contains old paths but files have been moved
        const itemPath = item.path;
        let relPath: string;

        if (itemPath.startsWith(profilePaths.root)) {
          // Path is already in current profile location
          relPath = 'profile:' + path.relative(profilePaths.root, itemPath);
        } else {
          // Path is from old location (e.g., ROOT/profiles/username/...)
          // Extract the portion after profiles/username/ and make it relative to current profile
          const oldDefaultProfileRoot = path.join(ROOT, 'profiles', username);
          if (itemPath.startsWith(oldDefaultProfileRoot)) {
            // Convert old path to profile-relative path
            const relativePart = path.relative(oldDefaultProfileRoot, itemPath);
            relPath = 'profile:' + relativePart;
          } else {
            // Unknown path format - try to extract meaningful relative path
            relPath = 'profile:' + path.relative(profilePaths.root, itemPath);
          }
        }

        return {
          id: item.id,
          timestamp: item.timestamp || '',
          content: contentPart,
          type: extractTypeFromPath(item.path),
          tags,
          entities,
          links: [],
          relPath,
          validation: undefined,
        };
      })
      .sort((a: any, b: any) => (a.timestamp < b.timestamp ? 1 : -1));

    return limit ? items.slice(0, limit) : items;
  }

  // Fallback to filesystem scan
  const items: EpisodicItem[] = [];

  if (!fs.existsSync(profilePaths.episodic)) return items;

  const walkDirectory = (dir: string): void => {
    if (!fs.existsSync(dir) || (limit && items.length >= limit)) return;

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (limit && items.length >= limit) break;

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walkDirectory(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        try {
          const raw = fs.readFileSync(fullPath, 'utf8');
          const obj = JSON.parse(raw);
          if (obj && obj.id && obj.timestamp && obj.content) {
            // Use profile: prefix for paths relative to profile root
            const relPath = 'profile:' + path.relative(profilePaths.root, fullPath);
            items.push({
              id: obj.id,
              timestamp: obj.timestamp,
              content: obj.content,
              type: obj.type,
              tags: obj.tags || [],
              entities: Array.isArray(obj.entities) ? obj.entities : [],
              links: Array.isArray(obj.links) ? obj.links : [],
              relPath,
              validation: obj.validation || undefined,
            });
          }
        } catch {}
      }
    }
  };

  walkDirectory(profilePaths.episodic);
  items.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  return items;
}

function listActiveTasks(profilePaths: ReturnType<typeof getProfilePaths>): TaskItem[] {
  const dir = path.join(profilePaths.tasks, 'active');
  const out: TaskItem[] = [];
  if (!fs.existsSync(dir)) return out;

  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const full = path.join(dir, f);
      const obj = JSON.parse(fs.readFileSync(full, 'utf8'));
      out.push({
        id: obj.id,
        title: obj.title,
        status: obj.status,
        priority: obj.priority,
        updated: obj.updated,
        relPath: 'profile:' + path.relative(profilePaths.root, full),
      });
    } catch {}
  }
  out.sort((a, b) => (a.updated && b.updated && a.updated < b.updated ? 1 : -1));
  return out;
}

function listCurated(profilePaths: ReturnType<typeof getProfilePaths>): CuratedItem[] {
  const roots = [profilePaths.semantic, profilePaths.procedural];
  const out: CuratedItem[] = [];

  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      const full = path.join(root, entry.name);
      if (entry.isDirectory()) {
        for (const e2 of fs.readdirSync(full, { withFileTypes: true })) {
          const fp = path.join(full, e2.name);
          if (e2.isFile() && (fp.endsWith('.md') || fp.endsWith('.mdx') || fp.endsWith('.txt'))) {
            out.push({ name: e2.name, relPath: 'profile:' + path.relative(profilePaths.root, fp) });
          }
        }
      } else if (entry.isFile() && (full.endsWith('.md') || full.endsWith('.mdx') || full.endsWith('.txt'))) {
        out.push({ name: entry.name, relPath: 'profile:' + path.relative(profilePaths.root, full) });
      }
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

function listCuriosityQuestions(profilePaths: ReturnType<typeof getProfilePaths>): CuriosityQuestion[] {
  const out: CuriosityQuestion[] = [];
  const questionsDir = path.join(profilePaths.curiosity, 'questions');

  if (!fs.existsSync(questionsDir)) return out;

  const dirs = [
    { dir: path.join(questionsDir, 'pending'), status: 'pending' as const },
    { dir: path.join(questionsDir, 'answered'), status: 'answered' as const },
  ];

  for (const { dir, status } of dirs) {
    if (!fs.existsSync(dir)) continue;

    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;

      try {
        const fullPath = path.join(dir, file);
        const content = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));

        out.push({
          id: content.id,
          question: content.question,
          askedAt: content.askedAt,
          status,
          relPath: 'profile:' + path.relative(profilePaths.root, fullPath),
          seedMemories: content.seedMemories,
          answeredAt: content.answeredAt,
        });
      } catch (err) {
        console.warn(`Failed to load curiosity question ${file}:`, err);
      }
    }
  }

  out.sort((a, b) => new Date(b.askedAt).getTime() - new Date(a.askedAt).getTime());
  return out;
}

/**
 * GET /api/memories/all - Get all memory types for browser
 */
export async function handleGetAllMemories(req: UnifiedRequest): Promise<UnifiedResponse> {
  if (!req.user.isAuthenticated) {
    return unauthorizedResponse('Authentication required. Please log in to view memories.');
  }

  // Check security policy
  const policy = getSecurityPolicy({ username: req.user.username });
  if (!policy.canReadMemory) {
    return forbiddenResponse('Access not permitted. Please log in to view memories.');
  }

  try {
    const profilePaths = getProfilePaths(req.user.username);

    // Parse limit from query
    const limit = Math.min(parseInt(req.query?.limit || '100'), 500);

    const episodic = listEpisodic(profilePaths, req.user.username, limit);
    const reflections = episodic.filter(item => item.type === 'reflection');
    const dreams = episodic.filter(item => item.type === 'dream');
    const episodicFiltered = episodic.filter(item => item.type !== 'reflection' && item.type !== 'dream');

    const tasks = listActiveTasks(profilePaths);
    const curated = listCurated(profilePaths);
    const curiosityQuestions = listCuriosityQuestions(profilePaths);

    return successResponse({
      episodic: episodicFiltered,
      reflections,
      dreams,
      tasks,
      curated,
      curiosityQuestions,
      pagination: {
        limit,
        returned: episodic.length,
        hasMore: episodic.length === limit,
      },
    });
  } catch (err) {
    return errorResponse((err as Error).message, 500);
  }
}
