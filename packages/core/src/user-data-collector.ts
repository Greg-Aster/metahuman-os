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
  const allowedTypes = options?.types || [
    'conversation',
    'observation',
    'reflection',
    'reflection_summary',
    'inner_dialogue',
    'decision',
    'dream',
    'journal',
    'curiosity_question',
    'summary',
  ];

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
        instruction: getVariedPrompt('observation'),
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
      return {
        instruction: getVariedPrompt('reflection'),
        input: '',
        output: memory.content,
        metadata: {
          source: 'episodic_memory',
          timestamp: memory.timestamp,
          memoryType: memory.type,
          confidence: 0.9, // Reflections are high-quality personality data
        },
      };

    case 'inner_dialogue':
      return {
        instruction: getVariedPrompt('inner_dialogue'),
        input: '',
        output: memory.content,
        metadata: {
          source: 'episodic_memory',
          timestamp: memory.timestamp,
          memoryType: memory.type,
          confidence: 0.9,
        },
      };

    case 'decision':
      return {
        instruction: getVariedPrompt('decision'),
        input: '',
        output: memory.content,
        metadata: {
          source: 'episodic_memory',
          timestamp: memory.timestamp,
          memoryType: 'decision',
          confidence: 0.85,
        },
      };

    case 'dream':
      return {
        instruction: getVariedPrompt('dream'),
        input: '',
        output: memory.content,
        metadata: {
          source: 'episodic_memory',
          timestamp: memory.timestamp,
          memoryType: 'dream',
          confidence: 0.75, // Dreams reveal subconscious patterns
        },
      };

    case 'reflection_summary':
      return {
        instruction: getVariedPrompt('reflection_summary'),
        input: '',
        output: memory.content,
        metadata: {
          source: 'episodic_memory',
          timestamp: memory.timestamp,
          memoryType: 'reflection_summary',
          confidence: 0.85,
        },
      };

    case 'journal':
      return {
        instruction: getVariedPrompt('journal'),
        input: '',
        output: memory.content,
        metadata: {
          source: 'episodic_memory',
          timestamp: memory.timestamp,
          memoryType: 'journal',
          confidence: 0.9, // Journal entries are authentic personal writing
        },
      };

    case 'curiosity_question':
      return {
        instruction: 'What are you curious about and why?',
        input: '',
        output: memory.content,
        metadata: {
          source: 'episodic_memory',
          timestamp: memory.timestamp,
          memoryType: 'curiosity_question',
          confidence: 0.8,
        },
      };

    case 'summary':
      return {
        instruction: 'Can you summarize your recent thoughts or experiences?',
        input: '',
        output: memory.content,
        metadata: {
          source: 'episodic_memory',
          timestamp: memory.timestamp,
          memoryType: 'summary',
          confidence: 0.7,
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
 * Generated prompt cache for varied training data
 * Will be populated by generateAllVariedPrompts() before data collection
 */
interface PromptCache {
  dream: string[];
  reflection: string[];
  journal: string[];
  observation: string[];
  decision: string[];
  inner_dialogue: string[];
  reflection_summary: string[];
}

let PROMPT_CACHE: PromptCache | null = null;

/**
 * Fallback static prompts (used if LLM generation fails)
 */
const FALLBACK_PROMPTS: PromptCache = {
  dream: [
    'Tell me about a dream you had.',
    'What did you dream about?',
    'Describe a recent dream.',
    'What kind of dreams do you have?',
    'Can you share a dream that stood out to you?',
    'What was in your dream last night?',
  ],
  reflection: [
    'What have you been reflecting on lately?',
    'Share your thoughts on something meaningful.',
    'What insights have you gained recently?',
    'Tell me about something you\'ve been thinking about.',
    'What realizations have you had?',
    'What\'s been on your mind?',
  ],
  journal: [
    'What would you write in your journal today?',
    'Tell me about your day.',
    'What\'s been happening in your life?',
    'Share something personal.',
    'What would you like to express?',
    'How are you feeling lately?',
  ],
  observation: [
    'Tell me about this experience and what you observed.',
    'What did you notice about this situation?',
    'Share what you saw or experienced.',
    'Describe what happened from your perspective.',
  ],
  decision: [
    'How do you approach this kind of decision?',
    'What factors did you consider?',
    'Walk me through your decision-making process.',
    'What led you to make that choice?',
  ],
  inner_dialogue: [
    'What are your thoughts on this?',
    'What\'s going through your mind?',
    'Share your internal reflections.',
    'What are you thinking about?',
  ],
  reflection_summary: [
    'What have you been reflecting on lately?',
    'Share your recent insights.',
    'What patterns are you noticing?',
    'Tell me about your recent realizations.',
  ],
};

/**
 * Get a varied prompt for a memory type
 */
function getVariedPrompt(memoryType: string): string {
  const cache = PROMPT_CACHE || FALLBACK_PROMPTS;
  const prompts = cache[memoryType as keyof PromptCache] || FALLBACK_PROMPTS.observation;
  return prompts[Math.floor(Math.random() * prompts.length)];
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
 * Collect answered curiosity questions as Q&A training pairs
 */
export function collectCuriosityQA(curiosityDir: string, maxSamples?: number): RawTrainingSample[] {
  const answeredDir = path.join(curiosityDir, 'questions', 'answered');

  if (!fs.existsSync(answeredDir)) {
    console.warn(`[user-data-collector] Curiosity answered directory not found: ${answeredDir}`);
    return [];
  }

  const samples: RawTrainingSample[] = [];
  const files = fs.readdirSync(answeredDir).filter(f => f.endsWith('.json'));

  console.log(`[user-data-collector] Found ${files.length} answered curiosity questions`);

  for (const file of files) {
    if (maxSamples && samples.length >= maxSamples) break;

    try {
      const content = fs.readFileSync(path.join(answeredDir, file), 'utf-8');
      const question = JSON.parse(content);

      // Skip if no question or no answer event
      if (!question.question || !question.answerEvent) continue;

      // Try to load the answer from the referenced event
      let answerContent = '';
      try {
        // answerEvent is a relative path like "profiles/greggles/memory/episodic/..."
        // or could be absolute
        const answerPath = question.answerEvent.startsWith('/')
          ? question.answerEvent
          : path.join(path.dirname(curiosityDir), '..', '..', question.answerEvent);

        if (fs.existsSync(answerPath)) {
          const answerEvent = JSON.parse(fs.readFileSync(answerPath, 'utf-8'));
          answerContent = answerEvent.content || '';
        }
      } catch {
        // If we can't load the answer, skip this question
        continue;
      }

      if (!answerContent || answerContent.length < 20) continue;

      samples.push({
        instruction: question.question,
        input: '',
        output: answerContent,
        metadata: {
          source: 'curiosity_qa',
          timestamp: question.answeredAt || question.askedAt,
          category: 'curiosity',
          confidence: 0.85, // Curiosity Q&A is thoughtful, authentic content
        },
      });
    } catch (err) {
      console.warn(`[user-data-collector] Failed to read curiosity question ${file}:`, (err as Error).message);
    }
  }

  console.log(`[user-data-collector] Collected ${samples.length} curiosity Q&A pairs`);
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

  // 4. Curiosity Q&A pairs (answered questions)
  const curiosityDir = path.join(profileRoot, 'memory', 'curiosity');
  const curiositySamples = collectCuriosityQA(curiosityDir, options?.maxSamplesPerSource);
  allSamples.push(...curiositySamples);

  console.log(`[user-data-collector] Total samples collected: ${allSamples.length}`);
  console.log(`[user-data-collector]   Therapy: ${therapySamples.length}`);
  console.log(`[user-data-collector]   Memories: ${memorySamples.length}`);
  console.log(`[user-data-collector]   Chat: ${chatSamples.length}`);
  console.log(`[user-data-collector]   Curiosity: ${curiositySamples.length}`);

  return allSamples;
}

/**
 * Pre-generate all varied prompts using LLM for maximum diversity
 * This is called once at the start of data collection
 */
export async function generateAllVariedPrompts(therapyInsights?: string): Promise<void> {
  console.log('[user-data-collector] Generating varied prompts for all memory types...');

  try {
    const { generateVariedPrompts } = await import('./curator-prompts.js');

    const types: Array<keyof PromptCache> = [
      'dream',
      'reflection',
      'journal',
      'observation',
      'decision',
      'inner_dialogue',
      'reflection_summary',
    ];

    const cache: PromptCache = {} as PromptCache;
    let successCount = 0;

    // Generate prompts for each type in parallel
    const results = await Promise.allSettled(
      types.map(async (type) => {
        const prompts = await generateVariedPrompts(type, 30, therapyInsights);
        return { type, prompts };
      })
    );

    // Process results
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.prompts.length > 0) {
        cache[result.value.type] = result.value.prompts;
        successCount++;
        console.log(`[user-data-collector] Generated ${result.value.prompts.length} prompts for ${result.value.type}`);
      } else {
        const type = result.status === 'fulfilled' ? result.value.type : 'unknown';
        console.warn(`[user-data-collector] Failed to generate prompts for ${type}, using fallbacks`);
      }
    }

    // Use generated cache if we got any results, otherwise fallback
    if (successCount > 0) {
      // Fill in any missing types with fallbacks
      for (const type of types) {
        if (!cache[type] || cache[type].length === 0) {
          cache[type] = FALLBACK_PROMPTS[type];
        }
      }
      PROMPT_CACHE = cache;
      console.log(`[user-data-collector] Successfully generated prompts for ${successCount}/${types.length} types`);
    } else {
      console.warn('[user-data-collector] LLM prompt generation failed completely, using static fallbacks');
      PROMPT_CACHE = FALLBACK_PROMPTS;
    }
  } catch (error) {
    console.warn(`[user-data-collector] Error generating varied prompts: ${(error as Error).message}`);
    console.warn('[user-data-collector] Using static fallback prompts');
    PROMPT_CACHE = FALLBACK_PROMPTS;
  }
}

/**
 * Extract therapy insights from completed therapy sessions
 */
export function extractTherapyInsights(therapyDir: string): string {
  if (!fs.existsSync(therapyDir)) {
    return '';
  }

  const insights: string[] = [];
  const files = fs.readdirSync(therapyDir).filter(f => f.startsWith('session-') && f.endsWith('.json'));

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(therapyDir, file), 'utf-8');
      const session: TherapySession = JSON.parse(content);

      // Skip incomplete sessions
      if (!session.answers || session.answers.length === 0) continue;

      insights.push(`\n## Therapy Session Insights (${new Date(session.createdAt || '').toLocaleDateString()})\n`);

      // Group answers by category
      const byCategory: Record<string, Array<{ question: string; answer: string }>> = {};

      for (const answer of session.answers) {
        const question = session.questions.find(q => q.id === answer.questionId);
        if (!question) continue;

        const category = question.category || 'general';
        if (!byCategory[category]) byCategory[category] = [];

        byCategory[category].push({
          question: question.prompt,
          answer: answer.content,
        });
      }

      // Format by category
      for (const [category, items] of Object.entries(byCategory)) {
        insights.push(`\n### ${category.toUpperCase()}`);
        for (const item of items) {
          insights.push(`**Q**: ${item.question}`);
          insights.push(`**A**: ${item.answer}\n`);
        }
      }
    } catch (err) {
      console.warn(`[user-data-collector] Failed to read therapy session ${file}:`, (err as Error).message);
    }
  }

  if (insights.length === 0) {
    return '';
  }

  return `# Therapy Session Insights\n\nThese are authentic, deeply personal responses from therapeutic conversations. Use these to understand:\n- Core values and what drives decisions\n- Communication style and authentic voice\n- Personal history and formative experiences\n- Goals, fears, and motivations\n- Relationship patterns and social dynamics\n\n${insights.join('\n')}`;
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
