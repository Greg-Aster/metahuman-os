/**
 * Memories All Handler
 *
 * Returns the profile's persisted memory inventory for the Persona Memory UI.
 * The filesystem is authoritative; the vector index is only a search
 * accelerator and must never decide which memories are visible here.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { errorResponse, forbiddenResponse, successResponse, unauthorizedResponse } from '../types.js';
import { getProfilePaths } from '../../index.js';
import { getSecurityPolicy } from '../../security-policy.js';

export interface EpisodicItem {
  id: string;
  timestamp: string;
  content: string;
  type?: string;
  tags?: string[];
  entities?: string[];
  links?: Array<{ type: string; target: string }>;
  relPath: string;
  validation?: { status?: 'correct' | 'incorrect'; by?: string; timestamp?: string };
  metadata?: Record<string, any>;
}

interface TaskItem {
  id: string;
  title: string;
  status: string;
  priority?: string;
  updated?: string;
  relPath: string;
}

export interface CuratedItem {
  name: string;
  relPath: string;
  timestamp?: string;
}

export interface CuriosityQuestion {
  id: string;
  question: string;
  askedAt: string;
  status: 'pending' | 'answered' | 'recorded';
  relPath: string;
  seedMemories?: string[];
  answeredAt?: string;
}

export interface EpisodicInventory {
  episodic: EpisodicItem[];
  reflections: EpisodicItem[];
  dreams: EpisodicItem[];
  curiosity: EpisodicItem[];
  aiIngestor: EpisodicItem[];
  audio: EpisodicItem[];
  pruned: EpisodicItem[];
  activeTotal: number;
}

const REFLECTION_TYPES = new Set(['reflection', 'reflection_summary']);
const DREAM_TYPES = new Set(['dream', 'daydream']);
const CURIOSITY_TYPES = new Set(['curiosity', 'curiosity_question']);

function normalizedType(item: EpisodicItem): string {
  return (item.type || '').trim().toLowerCase();
}

function normalizedTags(item: EpisodicItem): Set<string> {
  return new Set((item.tags || []).map(tag => tag.trim().toLowerCase()));
}

function normalizedDialogueSource(item: EpisodicItem): string {
  const source = item.metadata?.dialogueSource;
  return typeof source === 'string' ? source.trim().toLowerCase() : '';
}

function isReflectionMemory(item: EpisodicItem): boolean {
  const type = normalizedType(item);
  if (REFLECTION_TYPES.has(type)) return true;
  if (type !== 'inner_dialogue') return false;

  const tags = normalizedTags(item);
  const source = normalizedDialogueSource(item);
  return source === 'reflector'
    || source === 'reflection'
    || tags.has('reflection')
    || tags.has('self-reflection');
}

function isCuriosityMemory(item: EpisodicItem): boolean {
  const type = normalizedType(item);
  if (CURIOSITY_TYPES.has(type)) return true;
  if (type !== 'inner_dialogue') return false;

  const tags = normalizedTags(item);
  const source = normalizedDialogueSource(item);
  return source === 'curiosity'
    || source === 'inner-curiosity'
    || tags.has('curiosity')
    || tags.has('inner-curiosity')
    || tags.has('self-directed-question');
}

function isAiIngestorMemory(item: EpisodicItem): boolean {
  const tags = normalizedTags(item);
  return tags.has('ingested')
    || tags.has('ai')
    || (item.links || []).some(link => link.type === 'source');
}

function isAudioMemory(item: EpisodicItem): boolean {
  const type = normalizedType(item);
  const tags = normalizedTags(item);
  return type === 'audio' || tags.has('audio') || tags.has('transcript');
}

function sortNewestFirst<T extends { timestamp?: string }>(items: T[]): T[] {
  return items.sort((a, b) => (a.timestamp || '') < (b.timestamp || '') ? 1 : -1);
}

function limited<T>(items: T[], limit?: number): T[] {
  return limit ? items.slice(0, limit) : items;
}

function episodicItemFromFile(profileRoot: string, fullPath: string): EpisodicItem | null {
  try {
    const obj = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    if (!obj?.id || !obj?.timestamp || typeof obj.content !== 'string') return null;

    return {
      id: obj.id,
      timestamp: obj.timestamp,
      content: obj.content,
      type: obj.type,
      tags: Array.isArray(obj.tags) ? obj.tags : [],
      entities: Array.isArray(obj.entities) ? obj.entities : [],
      links: Array.isArray(obj.links) ? obj.links : [],
      relPath: 'profile:' + path.relative(profileRoot, fullPath),
      validation: obj.validation || undefined,
      metadata: obj.metadata || undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Scan every persisted episodic category once, including current dated trees
 * and nested _pruned directories, then partition records by stored type/tags.
 */
export function scanEpisodicInventory(
  profileRoot: string,
  episodicRoot: string,
  limit?: number,
): EpisodicInventory {
  const active: EpisodicItem[] = [];
  const pruned: EpisodicItem[] = [];
  const seenIds = new Set<string>();

  const walk = (directory: string): void => {
    if (!fs.existsSync(directory)) return;

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;

      const item = episodicItemFromFile(profileRoot, fullPath);
      if (!item || seenIds.has(item.id)) continue;
      seenIds.add(item.id);

      const relativeParts = path.relative(episodicRoot, fullPath).split(path.sep);
      if (relativeParts.includes('_pruned')) {
        pruned.push(item);
      } else {
        active.push(item);
      }
    }
  };

  walk(episodicRoot);
  sortNewestFirst(active);
  sortNewestFirst(pruned);

  const activeWindow = limited(active, limit);
  const reflections = activeWindow.filter(item => isReflectionMemory(item) && !isCuriosityMemory(item));
  const dreams = activeWindow.filter(item => DREAM_TYPES.has(normalizedType(item)));
  const curiosity = activeWindow.filter(isCuriosityMemory);
  const aiIngestor = activeWindow.filter(isAiIngestorMemory);
  const audio = activeWindow.filter(isAudioMemory);
  const episodic = activeWindow.filter(item => {
    const type = normalizedType(item);
    return !isReflectionMemory(item)
      && !DREAM_TYPES.has(type)
      && !isCuriosityMemory(item)
      && !isAiIngestorMemory(item)
      && !isAudioMemory(item);
  });

  return {
    episodic,
    reflections,
    dreams,
    curiosity,
    aiIngestor,
    audio,
    pruned: limited(pruned, limit),
    activeTotal: active.length,
  };
}

function listActiveTasks(profileRoot: string, tasksRoot: string): TaskItem[] {
  const directory = path.join(tasksRoot, 'active');
  if (!fs.existsSync(directory)) return [];

  const tasks: TaskItem[] = [];
  for (const filename of fs.readdirSync(directory)) {
    if (!filename.endsWith('.json')) continue;
    try {
      const fullPath = path.join(directory, filename);
      const obj = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
      tasks.push({
        id: obj.id,
        title: obj.title,
        status: obj.status,
        priority: obj.priority,
        updated: obj.updated,
        relPath: 'profile:' + path.relative(profileRoot, fullPath),
      });
    } catch {}
  }

  return tasks.sort((a, b) => (a.updated || '') < (b.updated || '') ? 1 : -1);
}

/** Load the JSON records written by curated_memory_saver. */
export function listCuratedConversations(profileRoot: string, memoryRoot: string): CuratedItem[] {
  const directory = path.join(memoryRoot, 'curated', 'conversations');
  if (!fs.existsSync(directory)) return [];

  const items: CuratedItem[] = [];
  for (const filename of fs.readdirSync(directory)) {
    if (!filename.endsWith('.json')) continue;
    try {
      const fullPath = path.join(directory, filename);
      const obj = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
      const name = obj.conversationalEssence || obj.userMessage || filename;
      items.push({
        name,
        relPath: 'profile:' + path.relative(profileRoot, fullPath),
        timestamp: obj.curatedAt || obj.originalTimestamp,
      });
    } catch {}
  }

  return sortNewestFirst(items);
}

export function listCuriosityQuestions(profileRoot: string, stateRoot: string): CuriosityQuestion[] {
  const questionsRoot = path.join(stateRoot, 'curiosity', 'questions');
  const questions: CuriosityQuestion[] = [];
  const directories = [
    { directory: path.join(questionsRoot, 'pending'), status: 'pending' as const },
    { directory: path.join(questionsRoot, 'answered'), status: 'answered' as const },
  ];

  for (const { directory, status } of directories) {
    if (!fs.existsSync(directory)) continue;
    for (const filename of fs.readdirSync(directory)) {
      if (!filename.endsWith('.json')) continue;
      try {
        const fullPath = path.join(directory, filename);
        const obj = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
        questions.push({
          id: obj.id,
          question: obj.question,
          askedAt: obj.askedAt,
          status,
          relPath: 'profile:' + path.relative(profileRoot, fullPath),
          seedMemories: obj.seedMemories,
          answeredAt: obj.answeredAt,
        });
      } catch {}
    }
  }

  return questions.sort((a, b) => new Date(b.askedAt).getTime() - new Date(a.askedAt).getTime());
}

export function mergeCuriosityQuestions(
  persistedQuestions: CuriosityQuestion[],
  curiosityMemories: EpisodicItem[],
): CuriosityQuestion[] {
  const questions = [...persistedQuestions];
  const seenText = new Set(
    persistedQuestions.map(item => item.question.trim().toLowerCase()).filter(Boolean),
  );

  for (const memory of curiosityMemories) {
    const normalizedQuestion = memory.content.trim().toLowerCase();
    if (!normalizedQuestion || seenText.has(normalizedQuestion)) continue;
    seenText.add(normalizedQuestion);
    questions.push({
      id: memory.id,
      question: memory.content,
      askedAt: memory.timestamp,
      status: 'recorded',
      relPath: memory.relPath,
    });
  }

  return questions.sort((a, b) => new Date(b.askedAt).getTime() - new Date(a.askedAt).getTime());
}

/** GET /api/memories_all - Get all memory types for the Persona Memory browser. */
export async function handleGetAllMemories(req: UnifiedRequest): Promise<UnifiedResponse> {
  if (!req.user.isAuthenticated) {
    return unauthorizedResponse('Authentication required. Please log in to view memories.');
  }

  const policy = getSecurityPolicy({ username: req.user.username });
  if (!policy.canReadMemory) {
    return forbiddenResponse('Access not permitted. Please log in to view memories.');
  }

  try {
    const profilePaths = getProfilePaths(req.user.username);
    const requestedLimit = Number.parseInt(req.query?.limit || '500', 10);
    const limit = requestedLimit === 0
      ? undefined
      : Number.isFinite(requestedLimit) && requestedLimit > 0
        ? Math.min(requestedLimit, 10_000)
        : 500;
    const inventory = scanEpisodicInventory(profilePaths.root, profilePaths.episodic, limit);

    return successResponse({
      episodic: inventory.episodic,
      reflections: inventory.reflections,
      dreams: inventory.dreams,
      aiIngestor: inventory.aiIngestor,
      audio: inventory.audio,
      pruned: inventory.pruned,
      tasks: listActiveTasks(profilePaths.root, profilePaths.tasks),
      curated: listCuratedConversations(profilePaths.root, profilePaths.memory),
      curiosityQuestions: mergeCuriosityQuestions(
        listCuriosityQuestions(profilePaths.root, profilePaths.state),
        inventory.curiosity,
      ),
      pagination: {
        limit,
        returned: limit ? Math.min(inventory.activeTotal, limit) : inventory.activeTotal,
        hasMore: Boolean(limit && inventory.activeTotal > limit),
      },
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}
