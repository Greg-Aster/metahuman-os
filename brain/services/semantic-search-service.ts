/**
 * Semantic Search Service
 *
 * Handles vector embedding operations on a separate worker thread.
 * Offloads expensive similarity computations from the main thread.
 *
 * Features:
 * - Async embedding generation via Ollama
 * - Cosine similarity search over vector index
 * - Index building and incremental updates
 * - Encryption-aware file reading
 */

import { parentPort, workerData } from 'node:worker_threads';
import fs from 'node:fs';
import path from 'node:path';

// Types for semantic search operations
export interface SemanticRequest {
  id: string;
  type: 'query' | 'embed' | 'build_index' | 'append' | 'status';
  profilePath: string;
  username: string;
  payload: QueryPayload | EmbedPayload | BuildIndexPayload | AppendPayload | StatusPayload;
}

export interface QueryPayload {
  query: string;
  topK?: number;
  model?: string;
  provider?: 'ollama' | 'mock';
  /** Filter by memory type */
  typeFilter?: ('episodic' | 'task' | 'function')[];
  /** Filter by date range */
  dateRange?: { start: string; end: string };
}

export interface EmbedPayload {
  text: string;
  model?: string;
  provider?: 'ollama' | 'mock';
}

export interface BuildIndexPayload {
  model?: string;
  provider?: 'ollama' | 'mock';
  include?: {
    episodic?: boolean;
    tasks?: boolean;
    curated?: boolean;
    functions?: boolean;
  };
}

export interface AppendPayload {
  eventId: string;
  content: string;
  timestamp: string;
  tags?: string[];
  entities?: string[];
  filePath: string;
  model?: string;
}

export interface StatusPayload {
  model?: string;
}

export interface SemanticResponse {
  id: string;
  success: boolean;
  type: SemanticRequest['type'];
  result?: QueryResult | EmbedResult | BuildIndexResult | AppendResult | StatusResult;
  error?: string;
}

export interface QueryResult {
  matches: Array<{
    id: string;
    filePath: string;
    text: string;
    score: number;
    type: string;
    timestamp?: string;
  }>;
  totalResults: number;
  model: string;
  queryTime: number;
}

export interface EmbedResult {
  vector: number[];
  dimensions: number;
  model: string;
}

export interface BuildIndexResult {
  indexPath: string;
  itemCount: number;
  model: string;
  buildTime: number;
}

export interface AppendResult {
  success: boolean;
  itemCount: number;
}

export interface StatusResult {
  exists: boolean;
  model?: string;
  provider?: string;
  itemCount?: number;
  createdAt?: string;
}

/**
 * Vector Index Item (matches core/vector-index.ts)
 */
interface VectorIndexItem {
  id: string;
  path: string;
  type: 'episodic' | 'task' | 'function';
  timestamp?: string;
  text: string;
  vector: number[];
}

interface VectorIndexMeta {
  model: string;
  provider: 'ollama' | 'mock';
  createdAt: string;
  items: number;
}

interface VectorIndexFile {
  meta: VectorIndexMeta;
  data: VectorIndexItem[];
}

/**
 * Cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Generate embedding via Ollama API
 */
async function embedText(
  text: string,
  options: { model?: string; provider?: 'ollama' | 'mock' } = {}
): Promise<number[]> {
  const model = options.model || 'nomic-embed-text';
  const provider = options.provider || 'ollama';

  if (provider === 'mock') {
    // Return mock 384-dim vector for testing
    const hash = text.split('').reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0);
    return Array.from({ length: 384 }, (_, i) => Math.sin(hash + i * 0.1));
  }

  // Call Ollama embeddings API
  const response = await fetch('http://localhost:11434/api/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt: text }),
  });

  if (!response.ok) {
    throw new Error(`Ollama embeddings failed: ${response.status}`);
  }

  const data = await response.json();
  return data.embedding;
}

/**
 * Get index file path for a profile
 */
function getIndexPath(profilePath: string, model: string): string {
  const indexDir = path.join(profilePath, 'memory', 'index');
  const safeModel = model.replace(/[^a-z0-9_.-]/gi, '_');
  return path.join(indexDir, `embeddings-${safeModel}.json`);
}

/**
 * Load vector index from disk
 */
function loadIndex(profilePath: string, model: string): VectorIndexFile | null {
  const indexPath = getIndexPath(profilePath, model);
  try {
    if (!fs.existsSync(indexPath)) return null;
    const content = fs.readFileSync(indexPath, 'utf8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Save vector index to disk
 */
function saveIndex(profilePath: string, model: string, index: VectorIndexFile): void {
  const indexPath = getIndexPath(profilePath, model);
  fs.mkdirSync(path.dirname(indexPath), { recursive: true });
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
}

/**
 * Query the vector index
 */
async function queryIndex(
  profilePath: string,
  payload: QueryPayload
): Promise<QueryResult> {
  const startTime = Date.now();
  const model = payload.model || 'nomic-embed-text';
  const topK = payload.topK || 10;
  const provider = payload.provider || 'ollama';

  const index = loadIndex(profilePath, model);
  if (!index) {
    throw new Error('No index found. Run index build first.');
  }

  // Generate query embedding
  const queryVector = await embedText(payload.query, { model, provider });

  // Score all items
  let results = index.data.map(item => ({
    id: item.id,
    filePath: item.path,
    text: item.text,
    score: cosineSimilarity(queryVector, item.vector),
    type: item.type,
    timestamp: item.timestamp,
  }));

  // Apply filters
  if (payload.typeFilter && payload.typeFilter.length > 0) {
    results = results.filter(r => payload.typeFilter!.includes(r.type as any));
  }

  if (payload.dateRange) {
    const startDate = new Date(payload.dateRange.start).getTime();
    const endDate = new Date(payload.dateRange.end).getTime();
    results = results.filter(r => {
      if (!r.timestamp) return true;
      const ts = new Date(r.timestamp).getTime();
      return ts >= startDate && ts <= endDate;
    });
  }

  // Sort by score and take topK
  results.sort((a, b) => b.score - a.score);
  results = results.slice(0, topK);

  return {
    matches: results,
    totalResults: results.length,
    model,
    queryTime: Date.now() - startTime,
  };
}

/**
 * Generate embedding for text
 */
async function generateEmbedding(payload: EmbedPayload): Promise<EmbedResult> {
  const model = payload.model || 'nomic-embed-text';
  const provider = payload.provider || 'ollama';

  const vector = await embedText(payload.text, { model, provider });

  return {
    vector,
    dimensions: vector.length,
    model,
  };
}

/**
 * Build full index (walks all memory files)
 */
async function buildFullIndex(
  profilePath: string,
  payload: BuildIndexPayload
): Promise<BuildIndexResult> {
  const startTime = Date.now();
  const model = payload.model || 'nomic-embed-text';
  const provider = payload.provider || 'ollama';
  const include = payload.include || { episodic: true, tasks: true };

  const items: VectorIndexItem[] = [];

  // Walk episodic memories
  if (include.episodic !== false) {
    const episodicDir = path.join(profilePath, 'memory', 'episodic');
    await walkAndEmbed(episodicDir, items, 'episodic', model, provider);
  }

  // Walk tasks
  if (include.tasks !== false) {
    const activeDir = path.join(profilePath, 'memory', 'tasks', 'active');
    const completedDir = path.join(profilePath, 'memory', 'tasks', 'completed');
    await walkAndEmbed(activeDir, items, 'task', model, provider);
    await walkAndEmbed(completedDir, items, 'task', model, provider);
  }

  // Create index file
  const index: VectorIndexFile = {
    meta: {
      model,
      provider,
      createdAt: new Date().toISOString(),
      items: items.length,
    },
    data: items,
  };

  saveIndex(profilePath, model, index);

  return {
    indexPath: getIndexPath(profilePath, model),
    itemCount: items.length,
    model,
    buildTime: Date.now() - startTime,
  };
}

/**
 * Walk directory and embed all JSON files
 */
async function walkAndEmbed(
  dir: string,
  items: VectorIndexItem[],
  type: 'episodic' | 'task' | 'function',
  model: string,
  provider: 'ollama' | 'mock'
): Promise<void> {
  if (!fs.existsSync(dir)) return;

  const stack = [dir];
  while (stack.length > 0) {
    const currentDir = stack.pop()!;
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          const obj = JSON.parse(content);

          if (!obj.id) continue;

          // Build text for embedding
          let text: string;
          if (type === 'episodic') {
            if (!obj.content) continue;
            const tags = Array.isArray(obj.tags) ? obj.tags.join(' ') : '';
            const entities = Array.isArray(obj.entities) ? obj.entities.join(' ') : '';
            text = [obj.content, tags ? `Tags: ${tags}` : '', entities ? `Entities: ${entities}` : '']
              .filter(Boolean)
              .join(' ');
          } else if (type === 'task') {
            if (!obj.title) continue;
            const tags = Array.isArray(obj.tags) ? obj.tags.join(' ') : '';
            text = [obj.title, obj.description || '', tags ? `Tags: ${tags}` : '']
              .filter(Boolean)
              .join(' ');
          } else {
            text = obj.content || obj.title || '';
          }

          if (!text) continue;

          const vector = await embedText(text, { model, provider });
          items.push({
            id: obj.id,
            path: fullPath,
            type,
            timestamp: obj.timestamp || obj.updated || obj.created,
            text,
            vector,
          });
        } catch {
          // Skip unreadable files
        }
      }
    }
  }
}

/**
 * Append a single event to the index
 */
async function appendToIndex(
  profilePath: string,
  payload: AppendPayload
): Promise<AppendResult> {
  const model = payload.model || 'nomic-embed-text';

  const index = loadIndex(profilePath, model);
  if (!index) {
    return { success: false, itemCount: 0 };
  }

  // Check if already exists
  if (index.data.some(item => item.id === payload.eventId)) {
    return { success: true, itemCount: index.data.length };
  }

  // Build text and embedding
  const tags = Array.isArray(payload.tags) ? payload.tags.join(' ') : '';
  const entities = Array.isArray(payload.entities) ? payload.entities.join(' ') : '';
  const text = [payload.content, tags ? `Tags: ${tags}` : '', entities ? `Entities: ${entities}` : '']
    .filter(Boolean)
    .join(' ');

  const vector = await embedText(text, { model, provider: index.meta.provider });

  // Append to index
  index.data.push({
    id: payload.eventId,
    path: payload.filePath,
    type: 'episodic',
    timestamp: payload.timestamp,
    text,
    vector,
  });

  index.meta.items = index.data.length;
  saveIndex(profilePath, model, index);

  return { success: true, itemCount: index.data.length };
}

/**
 * Get index status
 */
function getIndexStatus(profilePath: string, payload: StatusPayload): StatusResult {
  const model = payload.model || 'nomic-embed-text';
  const index = loadIndex(profilePath, model);

  if (!index) {
    return { exists: false };
  }

  return {
    exists: true,
    model: index.meta.model,
    provider: index.meta.provider,
    itemCount: index.meta.items,
    createdAt: index.meta.createdAt,
  };
}

/**
 * Handle incoming requests
 */
async function handleRequest(request: SemanticRequest): Promise<SemanticResponse> {
  try {
    let result: QueryResult | EmbedResult | BuildIndexResult | AppendResult | StatusResult;

    switch (request.type) {
      case 'query':
        result = await queryIndex(request.profilePath, request.payload as QueryPayload);
        break;

      case 'embed':
        result = await generateEmbedding(request.payload as EmbedPayload);
        break;

      case 'build_index':
        result = await buildFullIndex(request.profilePath, request.payload as BuildIndexPayload);
        break;

      case 'append':
        result = await appendToIndex(request.profilePath, request.payload as AppendPayload);
        break;

      case 'status':
        result = getIndexStatus(request.profilePath, request.payload as StatusPayload);
        break;

      default:
        throw new Error(`Unknown request type: ${request.type}`);
    }

    return {
      id: request.id,
      success: true,
      type: request.type,
      result,
    };
  } catch (error) {
    return {
      id: request.id,
      success: false,
      type: request.type,
      error: (error as Error).message,
    };
  }
}

// Worker thread message handler
if (parentPort) {
  parentPort.on('message', async (request: SemanticRequest) => {
    const response = await handleRequest(request);
    parentPort!.postMessage(response);
  });

  console.log('[semantic-search-service] Worker started');
}

// Export for direct use (non-worker mode)
export {
  queryIndex,
  generateEmbedding,
  buildFullIndex,
  appendToIndex,
  getIndexStatus,
  handleRequest,
  embedText,
  cosineSimilarity,
};
