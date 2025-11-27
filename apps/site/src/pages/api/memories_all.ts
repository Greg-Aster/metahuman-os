import type { APIRoute } from 'astro'
import fs from 'node:fs'
import path from 'node:path'
import { getUserOrAnonymous, getProfilePaths, systemPaths } from '@metahuman/core'
import { getSecurityPolicy } from '@metahuman/core/security-policy'

type EpisodicItem = {
  id: string
  timestamp: string
  content: string
  type?: string
  tags?: string[]
  entities?: string[]
  links?: Array<{ type: string; target: string }>
  relPath: string
  validation?: { status?: 'correct' | 'incorrect'; by?: string; timestamp?: string }
}

type TaskItem = {
  id: string
  title: string
  status: string
  priority?: string
  updated?: string
  relPath: string
}

type CuratedItem = {
  name: string
  relPath: string
}

type CuriosityQuestion = {
  id: string
  question: string
  askedAt: string
  status: 'pending' | 'answered'
  relPath: string
  seedMemories?: string[]
  answeredAt?: string
}

function listEpisodic(profilePaths: ReturnType<typeof getProfilePaths>, limit?: number): EpisodicItem[] {
  // Try loading from index first (fast path)
  const indexPath = path.join(profilePaths.indexDir, 'embeddings-nomic-embed-text.json');
  let idx: { meta: any; data: any[] } | null = null;
  try {
    if (fs.existsSync(indexPath)) {
      idx = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    }
  } catch (err) {
    console.warn('[memories_all] Failed to load index:', err);
  }

  if (idx && idx.data && idx.data.length > 0) {
    const items: EpisodicItem[] = idx.data
      .filter((item: any) => item.type === 'episodic')
      .map((item: any) => {
        // Parse metadata from the stored text
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

        return {
          id: item.id,
          timestamp: item.timestamp || '',
          content: contentPart,
          type: extractTypeFromPath(item.path),
          tags: tags,
          entities: entities,
          links: [],
          relPath: path.relative(systemPaths.root, item.path),
          validation: undefined // Validation loaded on-demand when viewing individual memory
        };
      })
      .sort((a: any, b: any) => (a.timestamp < b.timestamp ? 1 : -1));

    return limit ? items.slice(0, limit) : items;
  }

  // Fallback to filesystem scan if no index (backwards compatibility)
  const items: EpisodicItem[] = []

  if (!fs.existsSync(profilePaths.episodic)) return items;

  // Helper function to recursively walk directory tree and collect JSON files
  const walkDirectory = (dir: string): void => {
    if (!fs.existsSync(dir) || (limit && items.length >= limit)) return;

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (limit && items.length >= limit) break;

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Recurse into subdirectories (handles both old year-only and new year/month/day)
        walkDirectory(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        try {
          const raw = fs.readFileSync(fullPath, 'utf8');
          const obj = JSON.parse(raw);
          if (obj && obj.id && obj.timestamp && obj.content) {
            items.push({
              id: obj.id,
              timestamp: obj.timestamp,
              content: obj.content,
              type: obj.type,
              tags: obj.tags || [],
              entities: Array.isArray(obj.entities) ? obj.entities : [],
              links: Array.isArray(obj.links) ? obj.links : [],
              relPath: path.relative(systemPaths.root, fullPath),
              validation: obj.validation || undefined,
            });
          }
        } catch {}
      }
    }
  };

  // Start walking from episodic root
  walkDirectory(profilePaths.episodic);

  // Sort by timestamp (newest first)
  items.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  return items;
}

function extractTypeFromPath(filePath: string): string | undefined {
  // Extract type from directory structure or filename
  if (filePath.includes('/reflections/')) return 'reflection';
  if (filePath.includes('/dreams/')) return 'dream';
  if (filePath.includes('/audio-dreams/')) return 'dream';
  // Default episodic type
  return 'observation';
}

function listActiveTasks(profilePaths: ReturnType<typeof getProfilePaths>): TaskItem[] {
  const dir = path.join(profilePaths.tasks, 'active')
  const out: TaskItem[] = []
  if (!fs.existsSync(dir)) return out
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue
    try {
      const full = path.join(dir, f)
      const obj = JSON.parse(fs.readFileSync(full, 'utf8'))
      out.push({ id: obj.id, title: obj.title, status: obj.status, priority: obj.priority, updated: obj.updated, relPath: path.relative(systemPaths.root, full) })
    } catch {}
  }
  out.sort((a, b) => (a.updated && b.updated && a.updated < b.updated ? 1 : -1))
  return out
}

function listCurated(profilePaths: ReturnType<typeof getProfilePaths>): CuratedItem[] {
  const roots = [profilePaths.semantic, profilePaths.procedural]
  const out: CuratedItem[] = []
  for (const root of roots) {
    if (!fs.existsSync(root)) continue
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      const full = path.join(root, entry.name)
      if (entry.isDirectory()) {
        // Only 1-level deep list: include files in subdir
        for (const e2 of fs.readdirSync(full, { withFileTypes: true })) {
          const fp = path.join(full, e2.name)
          if (e2.isFile() && (fp.endsWith('.md') || fp.endsWith('.mdx') || fp.endsWith('.txt'))) {
            out.push({ name: e2.name, relPath: path.relative(systemPaths.root, fp) })
          }
        }
      } else if (entry.isFile() && (full.endsWith('.md') || full.endsWith('.mdx') || full.endsWith('.txt'))) {
        out.push({ name: entry.name, relPath: path.relative(systemPaths.root, full) })
      }
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

function listCuriosityQuestions(profilePaths: ReturnType<typeof getProfilePaths>): CuriosityQuestion[] {
  const out: CuriosityQuestion[] = []
  const questionsDir = path.join(profilePaths.curiosity, 'questions')

  if (!fs.existsSync(questionsDir)) {
    return out
  }

  const dirs = [
    { dir: path.join(questionsDir, 'pending'), status: 'pending' as const },
    { dir: path.join(questionsDir, 'answered'), status: 'answered' as const }
  ]

  for (const { dir, status } of dirs) {
    if (!fs.existsSync(dir)) continue

    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.json')) continue

      try {
        const fullPath = path.join(dir, file)
        const content = JSON.parse(fs.readFileSync(fullPath, 'utf-8'))

        out.push({
          id: content.id,
          question: content.question,
          askedAt: content.askedAt,
          status,
          relPath: path.relative(systemPaths.root, fullPath),
          seedMemories: content.seedMemories,
          answeredAt: content.answeredAt
        })
      } catch (err) {
        console.warn(`Failed to load curiosity question ${file}:`, err)
      }
    }
  }

  // Sort by askedAt timestamp (newest first)
  out.sort((a, b) => new Date(b.askedAt).getTime() - new Date(a.askedAt).getTime())
  return out
}

const handler: APIRoute = async ({ cookies, request }) => {
  try {
    const user = getUserOrAnonymous(cookies)

    // Anonymous users cannot access memory data
    if (user.role === 'anonymous') {
      return new Response(
        JSON.stringify({ error: 'Authentication required. Please log in to view memories.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Require authentication to access memory data
    const policy = getSecurityPolicy({ cookies });
    if (!policy.canReadMemory) {
      return new Response(
        JSON.stringify({ error: 'Access not permitted. Please log in to view memories.' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const profilePaths = getProfilePaths(user.username);

    // Parse query parameters for pagination
    const url = new URL(request.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 500); // Max 500 items

    // Load episodic memories with limit (stops early after reaching limit)
    const episodic = listEpisodic(profilePaths, limit);
    const reflections = episodic.filter(item => item.type === 'reflection');
    const dreams = episodic.filter(item => item.type === 'dream');
    const episodicFiltered = episodic.filter(item => item.type !== 'reflection' && item.type !== 'dream');

    // Tasks and curated are typically small, load all
    const tasks = listActiveTasks(profilePaths);
    const curated = listCurated(profilePaths);
    const curiosityQuestions = listCuriosityQuestions(profilePaths);

    return new Response(JSON.stringify({
      episodic: episodicFiltered,
      reflections,
      dreams,
      tasks,
      curated,
      curiosityQuestions,
      pagination: {
        limit,
        returned: episodic.length,
        hasMore: episodic.length === limit
      }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}

// MIGRATED: explicit authentication (auth required for memory overview)
export const GET = handler
