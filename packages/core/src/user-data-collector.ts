/**
 * User Data Collector
 *
 * Collects training data from a user's profile including:
 * - Episodic memories
 * - Therapy sessions
 * - Chat conversations
 * - Persona data
 */

import fs from 'node:fs';
import path from 'node:path';

export interface RawTrainingSample {
  instruction: string;
  input: string;
  output: string;
  metadata?: {
    source: string;
    timestamp?: string;
    category?: string;
    memoryType?: string;
    confidence?: number;
  };
}

export interface TherapySession {
  sessionId: string;
  userId: string;
  username: string;
  status: string;
  questions: Array<{
    id: string;
    prompt: string;
    category: string;
    generatedAt: string;
  }>;
  answers: Array<{
    questionId: string;
    content: string;
    capturedAt: string;
  }>;
  categoryCoverage?: Record<string, number>;
}

export interface EpisodicMemory {
  id: string;
  timestamp: string;
  content: string;
  type: string;
  tags?: string[];
  entities?: any[];
  metadata?: any;
  response?: string;
  links?: any[];
}

/**
 * Collect all therapy sessions for a user
 */
export function collectTherapySessions(therapyDir: string): RawTrainingSample[] {
  if (!fs.existsSync(therapyDir)) {
    console.warn(`[user-data-collector] Therapy directory not found: ${therapyDir}`);
    return [];
  }

  const samples: RawTrainingSample[] = [];
  const files = fs.readdirSync(therapyDir).filter(f => f.startsWith('session-') && f.endsWith('.json'));

  console.log(`[user-data-collector] Found ${files.length} therapy session files`);

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(therapyDir, file), 'utf-8');
      const session: TherapySession = JSON.parse(content);

      // Skip sessions with no answers
      if (!session.answers || session.answers.length === 0) {
        continue;
      }

      // Convert each Q&A pair into a training sample
      for (const answer of session.answers) {
        const question = session.questions.find(q => q.id === answer.questionId);
        if (!question) continue;

        samples.push({
          instruction: question.prompt,
          input: '',
          output: answer.content,
          metadata: {
            source: 'therapy_session',
            timestamp: answer.capturedAt,
            category: question.category,
            confidence: 1.0, // Therapy sessions are highest confidence
          },
        });
      }
    } catch (err) {
      console.warn(`[user-data-collector] Failed to read therapy session ${file}:`, (err as Error).message);
    }
  }

  console.log(`[user-data-collector] Collected ${samples.length} therapy Q&A pairs`);
  return samples;
}

/**
 * Collect episodic memories from user's memory directory
 */
export function collectEpisodicMemories(episodicDir: string, options?: {
  maxDays?: number;
  maxSamples?: number;
  types?: string[];
}): RawTrainingSample[] {
  if (!fs.existsSync(episodicDir)) {
    console.warn(`[user-data-collector] Episodic directory not found: ${episodicDir}`);
    return [];
  }

  const samples: RawTrainingSample[] = [];
  const cutoffDate = options?.maxDays ? new Date(Date.now() - options.maxDays * 24 * 60 * 60 * 1000) : null;
  const allowedTypes = options?.types || ['conversation', 'observation', 'reflection', 'inner_dialogue', 'decision'];

  // Walk through year directories
  const years = fs.readdirSync(episodicDir)
    .filter(name => /^\d{4}$/.test(name))
    .sort()
    .reverse(); // Most recent first

  for (const year of years) {
    const yearPath = path.join(episodicDir, year);
    const files = fs.readdirSync(yearPath)
      .filter(f => f.endsWith('.json'))
      .sort()
      .reverse(); // Most recent first

    for (const file of files) {
      if (options?.maxSamples && samples.length >= options.maxSamples) {
        break;
      }

      try {
        const content = fs.readFileSync(path.join(yearPath, file), 'utf-8');
        const memory: EpisodicMemory = JSON.parse(content);

        // Skip if too old
        if (cutoffDate && new Date(memory.timestamp) < cutoffDate) {
          continue;
        }

        // Skip if not in allowed types
        if (!allowedTypes.includes(memory.type)) {
          continue;
        }

        // Skip if no meaningful content
        if (!memory.content || memory.content.trim().length < 20) {
          continue;
        }

        // Convert memory to training sample
        const sample = convertMemoryToSample(memory);
        if (sample) {
          samples.push(sample);
        }
      } catch (err) {
        console.warn(`[user-data-collector] Failed to read memory ${file}:`, (err as Error).message);
      }
    }

    if (options?.maxSamples && samples.length >= options.maxSamples) {
      break;
    }
  }

  console.log(`[user-data-collector] Collected ${samples.length} episodic memories`);
  return samples;
}

/**
 * Convert an episodic memory to a training sample
 */
function convertMemoryToSample(memory: EpisodicMemory): RawTrainingSample | null {
  // Different strategies based on memory type
  switch (memory.type) {
    case 'conversation':
      return {
        instruction: extractConversationPrompt(memory.content),
        input: '',
        output: extractConversationResponse(memory.content),
        metadata: {
          source: 'episodic_memory',
          timestamp: memory.timestamp,
          memoryType: 'conversation',
          confidence: 0.8,
        },
      };

    case 'observation':
      return {
        instruction: 'Tell me about this experience and what you observed.',
        input: '',
        output: memory.content,
        metadata: {
          source: 'episodic_memory',
          timestamp: memory.timestamp,
          memoryType: 'observation',
          confidence: 0.7,
        },
      };

    case 'reflection':
    case 'inner_dialogue':
      return {
        instruction: 'What are your thoughts on this?',
        input: '',
        output: memory.content,
        metadata: {
          source: 'episodic_memory',
          timestamp: memory.timestamp,
          memoryType: memory.type,
          confidence: 0.9, // Reflections are high-quality personality data
        },
      };

    case 'decision':
      return {
        instruction: 'How do you approach this kind of decision?',
        input: '',
        output: memory.content,
        metadata: {
          source: 'episodic_memory',
          timestamp: memory.timestamp,
          memoryType: 'decision',
          confidence: 0.85,
        },
      };

    default:
      // Generic conversion for other types
      return {
        instruction: `Tell me about this: ${memory.type}`,
        input: '',
        output: memory.content,
        metadata: {
          source: 'episodic_memory',
          timestamp: memory.timestamp,
          memoryType: memory.type,
          confidence: 0.6,
        },
      };
  }
}

/**
 * Extract conversation prompt from conversation content
 */
function extractConversationPrompt(content: string): string {
  // Try to find the last question or user input before the response
  const lines = content.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.endsWith('?') || line.match(/^(User|You):/i)) {
      return line.replace(/^(User|You):\s*/i, '');
    }
  }

  // Fallback: use generic prompt
  return 'What did you say?';
}

/**
 * Extract conversation response from conversation content
 */
function extractConversationResponse(content: string): string {
  // Try to find the assistant/self response
  const lines = content.split('\n');
  const responseLines: string[] = [];
  let inResponse = false;

  for (const line of lines) {
    if (line.match(/^(Assistant|Me|I):/i)) {
      inResponse = true;
      responseLines.push(line.replace(/^(Assistant|Me|I):\s*/i, ''));
    } else if (inResponse && line.trim()) {
      responseLines.push(line);
    } else if (inResponse && !line.trim()) {
      break;
    }
  }

  if (responseLines.length > 0) {
    return responseLines.join('\n');
  }

  // Fallback: use entire content
  return content;
}

/**
 * Collect chat conversations from training directory
 */
export function collectChatConversations(trainingDir: string, maxSamples?: number): RawTrainingSample[] {
  if (!fs.existsSync(trainingDir)) {
    console.warn(`[user-data-collector] Training directory not found: ${trainingDir}`);
    return [];
  }

  const samples: RawTrainingSample[] = [];

  // Recursively find all .jsonl files
  function walkDir(dir: string) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      if (maxSamples && samples.length >= maxSamples) {
        return;
      }

      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);

      if (stat.isDirectory()) {
        walkDir(filePath);
      } else if (file.endsWith('.jsonl')) {
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const lines = content.split('\n').filter(Boolean);

          for (const line of lines) {
            if (maxSamples && samples.length >= maxSamples) {
              return;
            }

            try {
              const obj = JSON.parse(line);

              // Check if it's already in instruction-output format
              if (obj.instruction && obj.output) {
                samples.push({
                  instruction: obj.instruction,
                  input: obj.input || '',
                  output: obj.output,
                  metadata: {
                    source: 'chat_conversation',
                    ...obj.metadata,
                  },
                });
              }
              // Handle conversational format (role: user/assistant)
              else if (obj.role && obj.content) {
                // These need to be paired - skip for now, would need more complex logic
                continue;
              }
            } catch {
              // Skip invalid JSON lines
            }
          }
        } catch (err) {
          console.warn(`[user-data-collector] Failed to read ${file}:`, (err as Error).message);
        }
      }
    }
  }

  walkDir(trainingDir);
  console.log(`[user-data-collector] Collected ${samples.length} chat conversation samples`);
  return samples;
}

/**
 * Collect all training data for a user
 */
export function collectAllUserData(profileRoot: string, options?: {
  maxDays?: number;
  maxSamplesPerSource?: number;
  memoryTypes?: string[];
}): RawTrainingSample[] {
  console.log(`[user-data-collector] Collecting all training data from: ${profileRoot}`);

  const allSamples: RawTrainingSample[] = [];

  // 1. Therapy sessions (highest priority, no limit)
  const therapyDir = path.join(profileRoot, 'persona', 'therapy');
  const therapySamples = collectTherapySessions(therapyDir);
  allSamples.push(...therapySamples);

  // 2. Episodic memories
  const episodicDir = path.join(profileRoot, 'memory', 'episodic');
  const memorySamples = collectEpisodicMemories(episodicDir, {
    maxDays: options?.maxDays,
    maxSamples: options?.maxSamplesPerSource,
    types: options?.memoryTypes,
  });
  allSamples.push(...memorySamples);

  // 3. Chat conversations
  const trainingDir = path.join(profileRoot, 'memory', 'training');
  const chatSamples = collectChatConversations(trainingDir, options?.maxSamplesPerSource);
  allSamples.push(...chatSamples);

  console.log(`[user-data-collector] Total samples collected: ${allSamples.length}`);
  console.log(`[user-data-collector]   Therapy: ${therapySamples.length}`);
  console.log(`[user-data-collector]   Memories: ${memorySamples.length}`);
  console.log(`[user-data-collector]   Chat: ${chatSamples.length}`);

  return allSamples;
}

/**
 * Load persona data for context
 */
export function loadPersonaData(profileRoot: string): any {
  const personaPath = path.join(profileRoot, 'persona', 'core.json');

  if (!fs.existsSync(personaPath)) {
    console.warn(`[user-data-collector] Persona file not found: ${personaPath}`);
    return {};
  }

  try {
    const content = fs.readFileSync(personaPath, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    console.warn(`[user-data-collector] Failed to load persona:`, (err as Error).message);
    return {};
  }
}
