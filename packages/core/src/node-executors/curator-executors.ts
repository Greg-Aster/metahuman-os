/**
 * Curator Node Executors
 * Handles memory curation workflow for training data preparation
 */

import fs from 'node:fs';
import path from 'node:path';
import { callLLM } from '../model-router.js';
import { getProfilePaths } from '../index.js';
import type { NodeExecutor } from './types.js';

interface EpisodicMemory {
  id: string;
  timestamp: string;
  content: string;
  type?: string;
  entities?: string[];
  tags?: string[];
  response?: string;
  metadata?: {
    processed?: boolean;
    curated?: boolean;
    curatedAt?: string;
    model?: string;
    cognitiveMode?: 'dual' | 'emulation' | 'agent';
  };
}

interface CuratedMemory {
  id: string;
  originalTimestamp: string;
  conversationalEssence: string;
  context?: string;
  userMessage?: string;
  assistantResponse?: string;
  curatedAt: string;
  flags: string[];
  suitableForTraining: boolean;
  cognitiveMode?: 'dual' | 'emulation' | 'agent';
  memoryType?: string;
}

interface TrainingPair {
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  metadata: {
    memoryId: string;
    timestamp: string;
    curatedAt: string;
  };
}

/**
 * Uncurated Memory Loader Node
 * Loads episodic memories that haven't been curated yet
 */
export const uncuratedMemoryLoaderExecutor: NodeExecutor = async (_inputs, context, properties) => {
  const limit = properties?.limit || 50;

  if (!context.userId) {
    console.error('[UncuratedMemoryLoader] ERROR: No userId in context');
    return {
      memories: [],
      count: 0,
      hasMore: false,
      error: 'No userId in context',
    };
  }

  const profilePaths = getProfilePaths(context.userId);
  const episodicPath = path.join(profilePaths.memory, 'episodic');
  const memories: (EpisodicMemory & { path: string })[] = [];

  console.log(`[UncuratedMemoryLoader] 🔍 Searching path: ${episodicPath}`);
  console.log(`[UncuratedMemoryLoader] 📊 Limit: ${limit} memories`);

  if (!fs.existsSync(episodicPath)) {
    console.warn(`[UncuratedMemoryLoader] ⚠️  Episodic directory not found: ${episodicPath}`);
    return {
      memories: [],
      count: 0,
      hasMore: false,
    };
  }

  // Debug counters
  let totalFilesFound = 0;
  let curatedCount = 0;
  let uncuratedCount = 0;

  /**
   * Recursively walk directory tree
   */
  function walkDirectory(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (memories.length >= limit) break;

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walkDirectory(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        totalFilesFound++;
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const memory = JSON.parse(content) as EpisodicMemory;

          // Skip if already curated
          if (memory.metadata?.curated) {
            curatedCount++;
            continue;
          }

          uncuratedCount++;
          // INCLUDE ALL MEMORY TYPES (inner_dialogue, reflection, conversation, etc.)
          memories.push({ ...memory, path: fullPath });
        } catch (error) {
          console.error(`[UncuratedMemoryLoader] Failed to load ${entry.name}:`, (error as Error).message);
        }
      }
    }
  }

  walkDirectory(episodicPath);

  console.log(`[UncuratedMemoryLoader] 📈 Stats:`);
  console.log(`[UncuratedMemoryLoader]   - Total JSON files found: ${totalFilesFound}`);
  console.log(`[UncuratedMemoryLoader]   - Already curated: ${curatedCount}`);
  console.log(`[UncuratedMemoryLoader]   - Uncurated: ${uncuratedCount}`);
  console.log(`[UncuratedMemoryLoader]   - Returning: ${memories.length} memories`);

  return {
    memories,
    count: memories.length,
    hasMore: memories.length >= limit,
  };
};

/**
 * Persona Summary Loader Node
 * Loads and formats persona data for curator context
 */
export const personaSummaryLoaderExecutor: NodeExecutor = async (_inputs, context, _properties) => {
  if (!context.userId) {
    return {
      personaSummary: 'User: unknown',
    };
  }

  const profilePaths = getProfilePaths(context.userId);
  const personaCorePath = path.join(profilePaths.persona, 'core.json');
  let personaSummary = `User: ${context.userId}`;

  try {
    if (fs.existsSync(personaCorePath)) {
      const personaData = JSON.parse(fs.readFileSync(personaCorePath, 'utf-8'));
      personaSummary = `
Name: ${personaData.identity?.name || context.userId}
Role: ${personaData.identity?.role || 'User'}
Communication Style: ${personaData.personality?.communicationStyle || 'Natural and conversational'}
Core Values: ${personaData.coreValues?.join(', ') || 'Not specified'}
Interests: ${personaData.interests?.join(', ') || 'Various topics'}
`.trim();
    }
  } catch (error) {
    console.warn('[PersonaSummaryLoader] Could not load persona, using minimal summary');
  }

  return {
    personaSummary,
  };
};

/**
 * Curator LLM Node
 * Generates conversational exchanges from raw memories
 * Handles batch processing of memory array
 */
export const curatorLLMExecutor: NodeExecutor = async (inputs, context, properties) => {
  // Extract memories array from inputs[0] (output from uncurated_memory_loader)
  const memoriesInput = inputs[0];
  const memories: (EpisodicMemory & { path: string })[] = memoriesInput?.memories || [];
  const personaSummary = inputs[1] as string;
  const temperature = properties?.temperature || 0.3;

  if (!memories || memories.length === 0) {
    console.log('[CuratorLLM] No memories to process');
    return {
      success: true,
      curatedMemories: [],
      count: 0,
    };
  }

  console.log(`[CuratorLLM] Processing ${memories.length} memories`);

  const curatedResults: any[] = [];

  // Process each memory
  for (const memory of memories) {
    if (!memory || !memory.content) {
      console.warn(`[CuratorLLM] Skipping memory with no content: ${memory?.id || 'unknown'}`);
      continue;
    }

    console.log(`[CuratorLLM] Processing memory ${memory.id} (${memory.type || 'unknown'})`);

    // Get cognitive mode from memory metadata (dual, emulation, agent)
    const cognitiveMode = memory.metadata?.cognitiveMode || 'emulation';
    const memoryType = memory.type || 'conversation';

  // Build type-specific instructions
  let typeInstructions = '';

  if (memoryType === 'inner_dialogue' || memoryType === 'reflection' || memoryType === 'dream') {
    typeInstructions = `
MEMORY TYPE: ${memoryType} (Internal Thoughts/Reflections)

This is an INTERNAL THOUGHT or REFLECTION. The AI was thinking privately, not conversing with a user.

When generating the USER prompt, make it sound like someone asking about their internal experience:
- "What were you thinking about earlier?"
- "Tell me about the dream you had"
- "What insights did you gain from that reflection?"
- "Walk me through your thought process on that"
- "What revelations came to you?"
- "Describe what was going through your mind"

The ASSISTANT response is the actual internal thought/reflection content.

CRITICAL: Vary these prompts extensively! Use different:
- Question structures (what/how/why/tell me/describe/walk me through)
- Emotional tones (curious/contemplative/introspective/analytical)
- Temporal references (earlier/just now/recently/that moment)
- Specificity levels (vague "that" vs specific topics)

NEVER use the same phrasing twice. If you see similar reflections, generate completely different user prompts.`;
  } else if (memoryType === 'conversation') {
    typeInstructions = `
MEMORY TYPE: conversation (Actual User Interaction)

⚠️ CRITICAL: This is a REAL CONVERSATION. PRESERVE THE ORIGINAL CONTENT!

**If both user and assistant messages exist:**
- **EXTRACT** the exact words from both sides
- **DO NOT REWRITE** or paraphrase the conversation
- **ONLY REMOVE**: Tool syntax (like <function_call>, JSON blocks, file paths, technical artifacts)
- **KEEP**: The actual human words exactly as they were spoken
- Example: "Can you help me with X?" → Keep exactly this, just remove any surrounding JSON/XML

**If only one side exists:**
- Generate the missing side to match the existing message's context and tone
- Make it sound natural and conversational

**Data Cleaning (what to remove):**
- Tool syntax: <function_call>, <tool_use>, etc.
- JSON blocks: {"type": "...", ...}
- File paths: /home/user/file.txt
- Technical IDs: uuid-1234-5678
- Operator transcripts: [Operator] doing X...

**Data Preservation (what to keep):**
- The EXACT user question or statement
- The EXACT assistant response
- Natural conversation flow
- Personality and tone

DO NOT add variety or rewrite when both sides already exist - just extract!`;

  } else if (memoryType === 'observation' || memoryType === 'journal') {
    typeInstructions = `
MEMORY TYPE: ${memoryType} (Event/Observation)

This is an OBSERVATION or JOURNAL ENTRY about something that happened.

Generate a conversational exchange about this observation:
- USER: A natural question prompting discussion (e.g., "What happened with X?", "Tell me about Y")
- ASSISTANT: The observation/event description in conversational form

CRITICAL: Vary the conversation starters! Use:
- Different question types (what happened/tell me about/how did/when was)
- Various levels of specificity (general curiosity vs specific detail requests)
- Different emotional frames (concerned/curious/interested/engaged)`;
  }

  const systemPrompt = `You are a memory curator preparing training data for a personal AI assistant.

PERSONA CONTEXT:
${personaSummary}

COGNITIVE MODE: ${cognitiveMode}
${cognitiveMode === 'dual' ? '(Dual Consciousness Mode - Note: Pairs will be inverted during training, but YOU should generate them in normal direction)' : '(Traditional mode)'}

${typeInstructions}

YOUR CRITICAL TASK:
- For CONVERSATIONS: PRESERVE original content, only clean artifacts
- For OTHER TYPES: Generate MAXIMALLY VARIED conversational wrappers

**ANTI-REPETITION RULES** (For GENERATED content only - NOT for preserved conversations):
1. NEVER use generic phrases like "Share your thoughts", "Tell me more", "What do you think?"
2. Each generated prompt must be UNIQUELY phrased - check against these patterns and AVOID:
   - "Can you tell me about..."
   - "What are your thoughts on..."
   - "How do you feel about..."
3. Use unexpected question structures:
   - Embedded questions: "I'm curious - what led you to..."
   - Assume context: "So you were thinking about X earlier?"
   - Reflective prompts: "That insight about Y - where did it come from?"
   - Direct requests: "Walk me through [specific thing]"
   - Temporal anchors: "Earlier today you mentioned..."

4. Vary response DEPTH and STYLE dramatically:
   - Sometimes brief and punchy (1-2 sentences)
   - Sometimes elaborate and exploratory (4-5 sentences)
   - Sometimes analytical, sometimes emotional
   - Sometimes direct answers, sometimes wandering thoughts
   - Use different punctuation styles (! vs . vs ...)

5. Inject PERSONALITY VARIATION:
   - Occasional humor or wordplay (if persona-appropriate)
   - Different energy levels (enthusiastic vs measured)
   - Varying formality (casual vs thoughtful)
   - Different rhetorical devices (metaphors, analogies, examples)

**Data Cleaning**:
- Remove tool syntax, JSON, file paths, technical jargon
- Convert operator/skill transcripts into natural dialogue
- Make it feel like a real human conversation

**Quality Flags**:
- Mark sensitive information (passwords, API keys, private data)
- Identify memories unsuitable for training

Respond with JSON:
{
  "conversationalEssence": "Natural language summary of what this memory teaches",
  "userMessage": "Generated or extracted user message (MUST be unique and varied)",
  "assistantResponse": "Generated or extracted assistant response (MUST be fluid and natural)",
  "context": "Additional context if needed",
  "flags": ["sensitive-data", "tool-syntax", "etc"],
  "suitableForTraining": true/false,
  "generationNotes": "Brief note on what you generated vs extracted"
}

ABSOLUTE REQUIREMENT: Generate BOTH userMessage and assistantResponse. Make them sound like a real, flowing conversation with a unique personality - NOT a robotic Q&A session.`;

    const messages: any[] = [
      {
        role: 'system',
        content: systemPrompt,
      },
      {
        role: 'user',
        content: `Memory content:\n${memory.content}\n\n${memory.response ? `Response: ${memory.response}` : ''}`,
      },
    ];

    try {
      const response = await callLLM({
        role: 'curator',
        messages,
        cognitiveMode: context.cognitiveMode || 'dual',
        options: {
          temperature,
        },
      });

      // Parse the JSON response
      const result = JSON.parse(response.content);

      const curated: CuratedMemory = {
        id: memory.id,
        originalTimestamp: memory.timestamp,
        conversationalEssence: result.conversationalEssence || memory.content,
        context: result.context,
        userMessage: result.userMessage,
        assistantResponse: result.assistantResponse,
        curatedAt: new Date().toISOString(),
        flags: result.flags || [],
        suitableForTraining: result.suitableForTraining !== false,
        cognitiveMode,
        memoryType,
      };

      curatedResults.push({
        success: true,
        curated,
        originalMemoryPath: memory.path,
      });
    } catch (error) {
      console.error(`[CuratorLLM] Failed to curate ${memory.id}:`, error);

      // Fallback: mark as unsuitable but keep the content
      curatedResults.push({
        success: false,
        curated: {
          id: memory.id,
          originalTimestamp: memory.timestamp,
          conversationalEssence: memory.content,
          curatedAt: new Date().toISOString(),
          flags: ['curator-error'],
          suitableForTraining: false,
          cognitiveMode,
          memoryType,
        },
        originalMemoryPath: memory.path,
        error: (error as Error).message,
      });
    }
  }

  console.log(`[CuratorLLM] Finished processing ${curatedResults.length} memories`);

  return {
    success: true,
    curatedMemories: curatedResults,
    count: curatedResults.length,
  };
};

/**
 * Curated Memory Saver Node
 * Saves curated memories to curated/conversations directory
 */
export const curatedMemorySaverExecutor: NodeExecutor = async (inputs, context, _properties) => {
  const curatedResults = inputs[0]?.curatedMemories || [];

  if (!context.userId) {
    return {
      success: false,
      error: 'No userId in context',
    };
  }

  if (!curatedResults || curatedResults.length === 0) {
    console.log('[CuratedMemorySaver] No curated memories to save');
    return {
      success: true,
      savedCount: 0,
    };
  }

  try {
    const profilePaths = getProfilePaths(context.userId);
    const curatedDir = path.join(profilePaths.memory, 'curated', 'conversations');
    fs.mkdirSync(curatedDir, { recursive: true });

    let savedCount = 0;
    const savedPaths: string[] = [];

    for (const result of curatedResults) {
      const curated = result.curated;
      if (!curated || !curated.id) continue;

      const dateStr = new Date(curated.originalTimestamp).toISOString().split('T')[0];
      const filename = `${dateStr}-${curated.id}.json`;
      const filepath = path.join(curatedDir, filename);

      fs.writeFileSync(filepath, JSON.stringify(curated, null, 2), 'utf-8');
      savedPaths.push(filepath);
      savedCount++;
    }

    console.log(`[CuratedMemorySaver] Saved ${savedCount} curated memories`);

    return {
      success: true,
      savedCount,
      savedPaths,
    };
  } catch (error) {
    console.error('[CuratedMemorySaver] Error:', error);
    return {
      success: false,
      error: (error as Error).message,
    };
  }
};

/**
 * Training Pair Generator Node
 * Converts curated memories to training pair format
 */
export const trainingPairGeneratorExecutor: NodeExecutor = async (inputs, _context, _properties) => {
  const curatedResults = inputs[0]?.curatedMemories || [];

  if (!curatedResults || curatedResults.length === 0) {
    console.log('[TrainingPairGenerator] No curated memories to convert');
    return {
      trainingPairs: [],
      count: 0,
    };
  }

  const trainingPairs: TrainingPair[] = [];

  for (const result of curatedResults) {
    const curated = result.curated;

    if (!curated || !curated.suitableForTraining || !curated.userMessage || !curated.assistantResponse) {
      continue;
    }

    const pair: TrainingPair = {
      messages: [
        {
          role: 'user',
          content: curated.userMessage,
        },
        {
          role: 'assistant',
          content: curated.assistantResponse,
        },
      ],
      metadata: {
        memoryId: curated.id,
        timestamp: curated.originalTimestamp,
        curatedAt: curated.curatedAt,
      },
    };

    trainingPairs.push(pair);
  }

  console.log(`[TrainingPairGenerator] Generated ${trainingPairs.length} training pairs`);

  return {
    trainingPairs,
    count: trainingPairs.length,
  };
};

/**
 * Training Pair Appender Node
 * Appends training pairs to daily JSONL file
 */
export const trainingPairAppenderExecutor: NodeExecutor = async (inputs, context, properties) => {
  const trainingPairs = inputs[0]?.trainingPairs || [];

  if (!context.userId) {
    return {
      success: false,
      error: 'No userId in context',
    };
  }

  if (!trainingPairs || trainingPairs.length === 0) {
    console.log('[TrainingPairAppender] No training pairs to append');
    return {
      success: true,
      appendedCount: 0,
    };
  }

  try {
    const profilePaths = getProfilePaths(context.userId);
    const trainingDir = path.join(profilePaths.memory, 'curated', 'training-datasets');
    fs.mkdirSync(trainingDir, { recursive: true });

    const outputFile = properties?.outputFile || path.join(trainingDir, `persona-training-${new Date().toISOString().split('T')[0]}.jsonl`);

    let appendedCount = 0;
    for (const pair of trainingPairs) {
      const line = JSON.stringify(pair) + '\n';
      fs.appendFileSync(outputFile, line, 'utf-8');
      appendedCount++;
    }

    console.log(`[TrainingPairAppender] Appended ${appendedCount} training pairs to ${outputFile}`);

    return {
      success: true,
      file: outputFile,
      appendedCount,
    };
  } catch (error) {
    console.error('[TrainingPairAppender] Error:', error);
    return {
      success: false,
      error: (error as Error).message,
    };
  }
};

/**
 * Memory Marker Node
 * Marks original episodic memories as curated
 */
export const memoryMarkerExecutor: NodeExecutor = async (inputs, _context, _properties) => {
  const curatedResults = inputs[0]?.curatedMemories || [];

  if (!curatedResults || curatedResults.length === 0) {
    console.log('[MemoryMarker] No memories to mark');
    return {
      success: true,
      markedCount: 0,
    };
  }

  let markedCount = 0;
  const markedPaths: string[] = [];

  for (const result of curatedResults) {
    const originalMemoryPath = result.originalMemoryPath;

    if (!originalMemoryPath) {
      console.warn('[MemoryMarker] Missing original memory path');
      continue;
    }

    try {
      const content = fs.readFileSync(originalMemoryPath, 'utf-8');
      const memory = JSON.parse(content);

      memory.metadata = memory.metadata || {};
      memory.metadata.curated = true;
      memory.metadata.curatedAt = new Date().toISOString();

      fs.writeFileSync(originalMemoryPath, JSON.stringify(memory, null, 2), 'utf-8');

      markedPaths.push(originalMemoryPath);
      markedCount++;
    } catch (error) {
      console.error(`[MemoryMarker] Failed to mark as curated: ${originalMemoryPath}`, error);
    }
  }

  console.log(`[MemoryMarker] Marked ${markedCount} memories as curated`);

  return {
    success: true,
    markedCount,
    markedPaths,
  };
};
