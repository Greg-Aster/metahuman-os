
import {
  searchMemory,
  paths,
  audit,
  listActiveTasks,
  ollama,
  acquireLock,
  isLocked,
  initGlobalLogger,
  listUsers,
  withUserContext,
  executeGraph,
  validateCognitiveGraph,
  type CognitiveGraph,
} from '../../packages/core/src/index';
import fs from 'node:fs/promises';
import path from 'node:path';

// Technical keywords to deprioritize (not exclude, just lower weight)
const technicalKeywords = [
  'metahuman', 'ai agent', 'organizer', 'reflector', 'boredom-service',
  'llm', 'ollama', 'typescript', 'package.json', 'astro', 'dev server',
  'audit', 'persona', 'memory system', 'cli', 'codebase', 'development'
];

/**
 * Load reflector cognitive graph
 */
async function loadReflectorGraph(): Promise<CognitiveGraph> {
  const graphPath = path.join(paths.root, 'etc', 'cognitive-graphs', 'reflector-mode.json');
  const raw = await fs.readFile(graphPath, 'utf-8');
  const parsed = JSON.parse(raw);
  return validateCognitiveGraph(parsed);
}

/**
 * Get ALL memories (no pool limit)
 * Returns all episodic memories sorted by timestamp
 */
async function getAllMemories() {
  const episodicDir = paths.episodic;

  async function walk(dir: string, acc: Array<{ file: string; timestamp: Date; content: any }>) {
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return;
      }
      throw error;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      let stats;
      try {
        stats = await fs.stat(fullPath);
      } catch {
        continue;
      }

      if (stats.isDirectory()) {
        await walk(fullPath, acc);
      } else if (stats.isFile() && entry.endsWith('.json')) {
        try {
          const content = JSON.parse(await fs.readFile(fullPath, 'utf-8'));

          // Skip self-referential reflections and inner dialogue (avoid echo chamber)
          if (content.type === 'reflection' || content.type === 'inner_dialogue' ||
              content.metadata?.type === 'reflection' || content.metadata?.type === 'inner_dialogue') {
            continue;
          }

          acc.push({
            file: fullPath,
            timestamp: new Date(content.timestamp),
            content
          });
        } catch {
          // Skip malformed files
        }
      }
    }
  }

  const allMemories: Array<{ file: string; timestamp: Date; content: any }> = [];
  await walk(episodicDir, allMemories);

  // Sort by timestamp (newest first)
  allMemories.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  return allMemories;
}

/**
 * Extract key concepts/entities from a memory using simple heuristics
 */
function extractKeywords(memory: any): string[] {
  const content = memory.content || '';
  const tags = memory.tags || [];
  const entities = memory.entities || [];

  // Extract entities and tags
  const keywords = [...tags, ...entities.map((e: any) => e.text?.toLowerCase()).filter(Boolean)];

  // Extract capitalized words (potential proper nouns) - only from actual content
  if (content && typeof content === 'string') {
    const words = content.match(/\b[A-Z][a-z]+\b/g) || [];
    keywords.push(...words.map((w: string) => w.toLowerCase()));
  }

  // Remove duplicates, filter out technical terms, and common stop words
  const stopWords = ['the', 'and', 'for', 'with', 'this', 'that', 'from', 'have', 'been'];
  const unique = [...new Set(keywords)].filter(kw =>
    kw &&
    typeof kw === 'string' &&
    kw.length > 2 &&
    !stopWords.includes(kw) &&
    !technicalKeywords.some(tech => kw.includes(tech))
  );

  return unique.slice(0, 5); // Top 5 keywords
}

/**
 * Associative train of thought:
 * 1. Pick a seed memory (weighted random from all memories)
 * 2. Extract keywords from seed
 * 3. Search for related memories using those keywords
 * 4. Repeat 2-3 times to build a "chain" of associated memories
 */
async function getAssociativeMemoryChain(chainLength: number = 3): Promise<any[]> {
  const allMemories = await getAllMemories();
  if (allMemories.length === 0) return [];

  const chain: any[] = [];
  const usedFiles = new Set<string>();

  // Step 1: Pick seed memory using weighted random selection
  const now = Date.now();
  const decayFactor = 14; // Days

  const weights = allMemories.map(mem => {
    const ageInDays = (now - mem.timestamp.getTime()) / (1000 * 60 * 60 * 24);
    let weight = Math.exp(-ageInDays / decayFactor);

    // Reduce weight for technical development memories
    const contentLower = mem.content.content?.toLowerCase() || '';
    const isTechnical = technicalKeywords.some(kw => contentLower.includes(kw));
    if (isTechnical) {
      weight *= 0.3;
    }

    return weight;
  });

  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  let rand = Math.random() * totalWeight;
  let cumulativeWeight = 0;

  let seedMemory = allMemories[0];
  for (let i = 0; i < allMemories.length; i++) {
    cumulativeWeight += weights[i];
    if (rand <= cumulativeWeight) {
      seedMemory = allMemories[i];
      break;
    }
  }

  const seedEvent = { ...seedMemory.content, __file: seedMemory.file };
  chain.push(seedEvent);
  usedFiles.add(seedMemory.file);

  console.log(`[reflector] Seed memory: "${seedMemory.content.content?.substring(0, 60)}..."`);

  // Step 2-N: Follow associative links
  for (let i = 1; i < chainLength; i++) {
    const lastMemory = chain[chain.length - 1];
    const keywords = extractKeywords(lastMemory);

    if (keywords.length === 0) {
      console.log(`[reflector] No keywords found, stopping chain at ${i} memories`);
      break;
    }

    console.log(`[reflector] Searching for memories related to: ${keywords.slice(0, 3).join(', ')}...`);

    // Search for related memories using keyword search
    let relatedMemoryPaths: string[] = [];
    for (const keyword of keywords) {
      try {
        const results = searchMemory(keyword);
        relatedMemoryPaths.push(...results);
      } catch {
        // Ignore search errors
      }
    }

    // Load memory contents from paths
    let relatedMemories: any[] = [];
    for (const relPath of relatedMemoryPaths) {
      const fullPath = path.join(paths.root, relPath);
      if (usedFiles.has(fullPath)) continue; // Skip already used

      try {
        const memContent = JSON.parse(await fs.readFile(fullPath, 'utf-8'));
        (memContent as any).__file = fullPath;
        if (memContent.type !== 'reflection' && memContent.type !== 'inner_dialogue' &&
            memContent.metadata?.type !== 'reflection' && memContent.metadata?.type !== 'inner_dialogue') {
          relatedMemories.push(memContent);
        }
      } catch {
        // Skip invalid files
      }
    }

    if (relatedMemories.length === 0) {
      console.log(`[reflector] No related memories found, stopping chain at ${i} memories`);
      break;
    }

    // Pick a random related memory (limit to top 10 most relevant)
    const nextMemory = relatedMemories[Math.floor(Math.random() * Math.min(10, relatedMemories.length))];
    const nextFilePath = (nextMemory as any).__file as string | undefined;

    chain.push(nextMemory);
    if (nextFilePath) {
      usedFiles.add(nextFilePath);
    }

    console.log(`[reflector] Found related: "${nextMemory.content?.substring(0, 60)}..."`);
  }

  console.log(`[reflector] Built chain of ${chain.length} associated memories`);
  return chain;
}

/**
 * Generate reflection for a single user
 */
async function generateUserReflection(username: string): Promise<boolean> {
  console.log(`[reflector] Processing user: ${username}`);

  // Use associative train of thought: 3-5 linked memories
  const chainLength = Math.floor(Math.random() * 3) + 3; // 3 to 5 memories
  const recentMemories = await getAssociativeMemoryChain(chainLength);

  if (recentMemories.length === 0) {
    console.log('[reflector] Not enough memories to reflect on yet. Going back to sleep.');
    audit({
      category: 'action',
      level: 'info',
      message: 'Reflector agent: insufficient memories to reflect',
      actor: 'reflector',
      metadata: { memoriesFound: 0 }
    });
    return;
  }

  let systemPrompt: string;
  let prompt: string;

  audit({
    category: 'action',
    level: 'info',
    message: `Reflector analyzing: ${recentMemories.length} memories`,
    actor: 'reflector',
    metadata: {
      memoriesAnalyzed: recentMemories.length,
      thinking: true
    }
  });

  if (recentMemories.length === 1) {
    const singleMemory = recentMemories[0];
    const memoryText = singleMemory.content;

    systemPrompt = `
      You are Greg's inner voice, spontaneously reflecting on a memory that surfaced.
      Write a natural, stream-of-consciousness reflection in first person.
      Let your thoughts flow freely - they can be short or long, whatever feels right.
      Stay grounded in the actual memory content, but explore your feelings, questions, or insights about it.
      Avoid formulaic phrases like "the common thread" or "this reflects" - just think naturally.
      This is an intimate, private thought - be authentic and varied in expression.
    `.trim();

    prompt = `
A memory just surfaced:
"${memoryText}"

What comes to mind?
    `.trim();
  } else {
    const memoriesText = recentMemories
      .map((m, i) => `${i + 1}. ${m.content}`)
      .join('\n\n');

    systemPrompt = `
      You are Greg's inner voice, spontaneously connecting memories that surfaced together.
      Write a natural, stream-of-consciousness reflection in first person.
      Your thoughts can be any length - a brief musing, a longer contemplation, or anything in between.
      Explore patterns, feelings, questions, or insights that emerge from seeing these memories together.
      Avoid formulaic phrases like "the common thread is" or "these memories show" - think naturally.
      Don't feel obligated to connect everything perfectly - sometimes thoughts wander.
      This is intimate, private thinking - be authentic, spontaneous, and varied in how you express yourself.
    `.trim();

    prompt = `
These memories surfaced together in my mind:

${memoriesText}

What am I noticing? What thoughts or feelings are emerging?
    `.trim();
  }

  try {
    // Preflight: ensure Ollama is available
    const running = await ollama.isRunning();
    if (!running) {
      console.warn('[reflector] Ollama is not running; skipping reflection cycle. Start with: ollama serve');
      audit({
        category: 'system',
        level: 'warn',
        message: 'Reflector skipped: Ollama not running',
        actor: 'reflector',
      });
      return;
    }

    // Load reflector cognitive graph
    const graph = await loadReflectorGraph();

    // Prepare context for graph execution
    const reflectionWordCount = prompt.split(/\s+/).filter(Boolean).length;
    const chainIsLong = recentMemories.length >= 3;
    const conciseHint = chainIsLong || reflectionWordCount > 180
      ? 'Keep the response under two sentences (<= 60 words).'
      : 'Keep it to one short sentence (<= 25 words).';

    // Execute graph with prompts as context
    const graphContext = {
      userId: username,
      allowMemoryWrites: true,
      cognitiveMode: 'agent' as const,

      // Node 1 (Generate Reflection) inputs
      reflectionPrompt: prompt,
      reflectionSystemPrompt: systemPrompt,

      // Metadata for summary formatting
      conciseHint,
      reflectionWordCount,
      chainIsLong,
    };

    const graphResult = await executeGraph(graph, graphContext);

    // Extract reflection from graph execution
    const reflectionNode = graphResult.nodes.get(1);
    const reflection = (reflectionNode?.output?.response || '').trim();

    if (reflection) {
      console.log(`[reflector] Generated new insight: "${reflection}"`);

      // Graph has already saved reflection, summary, and extended summary via inner_dialogue_capture nodes
      // Just audit the completion
      let tasksCount = 0;
      try {
        const tasks = listActiveTasks();
        tasksCount = Array.isArray(tasks) ? tasks.length : 0;
      } catch {}

      audit({
        category: 'decision',
        level: 'info',
        message: 'Reflector generated new insight',
        actor: 'reflector',
        metadata: {
          reflection: reflection, // Full reflection text
          reflectionPreview: reflection.substring(0, 100) + (reflection.length > 100 ? '...' : ''),
          memoriesConsidered: recentMemories.length,
          tasksConsidered: tasksCount,
          usedGraph: true,
        }
      });
    } else {
      console.log('[reflector] Generated an empty reflection. Going back to sleep.');
      audit({
        category: 'action',
        level: 'warn',
        message: 'Reflector generated empty reflection',
        actor: 'reflector'
      });
    }
  } catch (error) {
    console.error(`[reflector] Error generating reflection for ${username}:`, error);
    audit({
      category: 'system',
      level: 'error',
      message: `Reflector agent error for ${username}: ${(error as Error).message}`,
      actor: 'reflector',
      metadata: { error: (error as Error).stack, username }
    });
    return false;
  }

  return true;
}

/**
 * Main entry point (multi-user)
 */
async function run() {
  initGlobalLogger('reflector');

  // Single-instance guard
  let lock;
  try {
    if (isLocked('agent-reflector')) {
      console.log('[reflector] Another instance is already running. Exiting.');
      return;
    }
    lock = acquireLock('agent-reflector');
  } catch {
    console.log('[reflector] Failed to acquire lock. Exiting.');
    return;
  }

  console.log('[reflector] Waking up to ponder (multi-user)...');

  // Audit: Starting reflection cycle
  audit({
    category: 'action',
    level: 'info',
    message: 'Reflector agent starting idle reflection cycle (multi-user)',
    actor: 'reflector',
    metadata: { action: 'reflection_start', mode: 'multi-user' }
  });

  // Preflight: ensure Ollama is available
  const running = await ollama.isRunning();
  if (!running) {
    console.warn('[reflector] Ollama is not running; skipping reflection cycle. Start with: ollama serve');
    audit({
      category: 'system',
      level: 'warn',
      message: 'Reflector skipped: Ollama not running',
      actor: 'reflector',
    });
    lock.release();
    return;
  }

  try {
    // Get all users
    const users = listUsers();
    console.log(`[reflector] Found ${users.length} users to process`);

    let successCount = 0;

    // Process each user with isolated context
    for (const user of users) {
      try {
        // Run with user context for automatic path resolution
        const success = await withUserContext(
          { userId: user.id, username: user.username, role: user.role },
          async () => {
            return await generateUserReflection(user.username);
          }
        );
        // Context automatically cleaned up - no leakage to next user

        if (success) {
          successCount++;
        }
      } catch (error) {
        console.error(`[reflector] Failed to process user ${user.username}:`, (error as Error).message);
        // Continue with next user
      }
    }

    console.log(`[reflector] Cycle finished. Generated ${successCount} reflections across ${users.length} users. ✅`);

    // Audit completion
    audit({
      category: 'action',
      level: 'info',
      message: 'Reflector agent completed idle reflection cycle',
      actor: 'reflector',
      metadata: {
        action: 'reflection_complete',
        mode: 'multi-user',
        successCount,
        userCount: users.length,
      }
    });
  } finally {
    lock.release();
  }
}

run().catch(console.error);
