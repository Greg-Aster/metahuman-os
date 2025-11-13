/**
 * AI Dataset Builder
 *
 * Uses the currently configured LLM (via Ollama or adapter) to transform the
 * entire memory corpus into high-quality instruction tuning samples.
 *
 * Usage:
 *   pnpm tsx brain/agents/ai-dataset-builder.ts --output ./out/datasets/2025-10-31/ai_dataset.jsonl
 *
 * Optional flags:
 *   --max <number>         Maximum memories to process (defaults to config.maxMemories)
 *   --chunk <number>       How many memories per LLM batch (defaults to config.chunkSize)
 *   --model <name>         Override model name (otherwise current default provider is used)
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  paths,
  audit,
  loadPersonaCore,
  llm,
} from '../../packages/core/src/index.js';
import { spawnSync } from 'node:child_process';
import { acquireLock } from '../../packages/core/src/locks.js';

interface BuilderConfig {
  maxMemories: number;
  chunkSize: number;
  temperature: number;
  includeSemanticCurated: boolean;
  includeAudioTranscripts: boolean;
  includeInboxMarkdown: boolean;
  dedupe: boolean;
  outputDir: string;
  model: string | null;
  systemPrompt: string;
}

interface MemoryRecord {
  id: string;
  type: string;
  timestamp?: string;
  content?: string;
  response?: string;
  tags?: string[];
  entities?: string[];
  sourcePath: string;
  metadata?: Record<string, any>;
}

interface GeneratedSample {
  instruction: string;
  input?: string;
  output: string;
  meta?: Record<string, any>;
}

function readConfig(): BuilderConfig {
  const cfgPath = path.join(paths.etc, 'ai-dataset-builder.json');
  const defaults: BuilderConfig = {
    maxMemories: 2000,
    chunkSize: 12,
    temperature: 0.4,
    includeSemanticCurated: true,
    includeAudioTranscripts: true,
    includeInboxMarkdown: false,
    dedupe: true,
    outputDir: 'out/datasets',
    model: null,
    systemPrompt:
      "You are MetaHuman Greg's dataset curator. Transform raw memories into high-quality instruction tuning samples that teach Greg's voice, style, and reasoning. Prefer first-person narration, keep answers grounded in the memory, and avoid hallucinating facts.",
  };
  try {
    if (fs.existsSync(cfgPath)) {
      const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      return { ...defaults, ...parsed };
    }
  } catch (error) {
    console.warn(`[ai-dataset-builder] Failed to read config: ${(error as Error).message}`);
  }
  return defaults;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (!next || next.startsWith('--')) {
        out[key] = true;
        i -= 1;
      } else {
        out[key] = next;
      }
    }
  }
  return out;
}

function collectEpisodicMemories(): MemoryRecord[] {
  const root = paths.episodic;
  if (!fs.existsSync(root)) return [];

  const records: MemoryRecord[] = [];

  const walk = (dir: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        try {
          const raw = fs.readFileSync(full, 'utf8');
          const obj = JSON.parse(raw);
          if (!obj.content && !obj.response) continue;
          records.push({
            id: obj.id || path.basename(entry.name, '.json'),
            type: obj.type || 'unknown',
            timestamp: obj.timestamp,
            content: obj.content,
            response: obj.response,
            tags: obj.tags,
            entities: obj.entities,
            metadata: obj.metadata,
            sourcePath: path.relative(paths.root, full),
          });
        } catch (error) {
          console.warn(`[ai-dataset-builder] Failed to parse episodic memory ${full}: ${(error as Error).message}`);
        }
      }
    }
  };

  for (const entry of fs.readdirSync(root)) {
    const yearDir = path.join(root, entry);
    try {
      if (fs.statSync(yearDir).isDirectory()) {
        walk(yearDir);
      }
    } catch {}
  }

  return records;
}

function collectSemanticCurated(): MemoryRecord[] {
  const root = path.join(paths.semantic, 'curated');
  if (!fs.existsSync(root)) return [];

  const records: MemoryRecord[] = [];

  const files = fs.readdirSync(root);
  for (const file of files) {
    const full = path.join(root, file);
    if (!fs.statSync(full).isFile()) continue;
    const ext = path.extname(full).toLowerCase();
    if (!['.txt', '.md', '.mdx'].includes(ext)) continue;
    try {
      const content = fs.readFileSync(full, 'utf8').trim();
      if (!content) continue;
      records.push({
        id: `curated-${file}`,
        type: 'curated',
        content,
        sourcePath: path.relative(paths.root, full),
        tags: ['curated'],
      });
    } catch (error) {
      console.warn(`[ai-dataset-builder] Failed to read curated file ${full}: ${(error as Error).message}`);
    }
  }
  return records;
}

function collectAudioTranscripts(): MemoryRecord[] {
  const dir = path.join(paths.memory, 'audio', 'transcripts');
  if (!fs.existsSync(dir)) return [];

  const records: MemoryRecord[] = [];
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const full = path.join(dir, file);
    if (!fs.statSync(full).isFile()) continue;
    const ext = path.extname(full).toLowerCase();
    if (ext !== '.txt') continue;
    try {
      const content = fs.readFileSync(full, 'utf8').trim();
      if (!content) continue;
      records.push({
        id: path.basename(file, ext),
        type: 'audio_transcript',
        content,
        sourcePath: path.relative(paths.root, full),
        tags: ['audio', 'transcript'],
      });
    } catch (error) {
      console.warn(`[ai-dataset-builder] Failed to read transcript ${full}: ${(error as Error).message}`);
    }
  }
  return records;
}

function collectInboxMarkdown(): MemoryRecord[] {
  const dir = paths.inbox;
  if (!fs.existsSync(dir)) return [];

  const records: MemoryRecord[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (!['.md', '.mdx', '.txt'].includes(ext)) continue;
      try {
        const content = fs.readFileSync(full, 'utf8').trim();
        if (!content) continue;
        records.push({
          id: `inbox-${entry.name}`,
          type: 'inbox_note',
          content,
          sourcePath: path.relative(paths.root, full),
        });
      } catch (error) {
        console.warn(`[ai-dataset-builder] Failed to read inbox note ${full}: ${(error as Error).message}`);
      }
    }
  }
  return records;
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

const OUTPUT_WORD_LIMIT = 120;
const INSTRUCTION_WORD_LIMIT = 32;

const FILLER_PREFIXES: RegExp[] = [
  /^(okay|ok|alright|sure)[,;:\-\s]*/i,
  /^so[,;:\s-]*/i,
  /^let me (?:start|think|figure)[^,.!?]*[,;:\-\s]*/i,
  /^i need to[^,.!?]*[,;:\-\s]*/i,
  /^here's[^,.!?]*[,;:\-\s]*/i,
];

function wordLimit(text: string, limit: number): string {
  const words = text.trim().split(/\s+/);
  if (words.length <= limit) return text.trim();
  return `${words.slice(0, limit).join(' ')}…`;
}

function cleanLeadingFillers(text: string): string {
  let result = text.trim();
  let removed = true;
  while (removed && result.length > 0) {
    removed = false;
    for (const regex of FILLER_PREFIXES) {
      const match = result.match(regex);
      if (match) {
        result = result.slice(match[0].length).trimStart();
        removed = true;
      }
    }
  }
  return result.trim();
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function ensureSentenceEnding(text: string): string {
  if (!text) return text;
  const trimmed = text.trim();
  if (/[.!?…]$/.test(trimmed)) return trimmed;
  return `${trimmed}.`;
}

function sanitizeInstruction(text: string): string {
  const cleaned = ensureSentenceEnding(normalizeWhitespace(cleanLeadingFillers(text)));
  return wordLimit(cleaned, INSTRUCTION_WORD_LIMIT);
}

function sanitizeOutputText(text: string): string {
  let cleaned = normalizeWhitespace(cleanLeadingFillers(text));
  cleaned = ensureSentenceEnding(cleaned);
  cleaned = wordLimit(cleaned, OUTPUT_WORD_LIMIT);
  return cleaned;
}

function styleGuideForMemory(mem: MemoryRecord): string {
  switch ((mem.type || '').toLowerCase()) {
    case 'reflection':
      return 'Provide a concise (2-3 sentences) first-person insight capturing the main takeaway. No meta commentary about thinking or planning.';
    case 'reflection_summary':
      return 'Deliver a short conclusion highlighting the key lesson in 1-2 sentences. Avoid process notes or instructions.';
    case 'conversation':
    case 'chat':
      return 'Answer the implied user request directly in Greg\'s voice. Stay under 4 sentences and avoid revealing internal reasoning.';
    case 'inner_dialogue':
      return 'Convert the inner thought into a resolved first-person statement or decision within 2 sentences. Remove self-referential rambling.';
    case 'dream':
      return 'Summarize the dream scenario in 2-3 vivid sentences, focusing on feelings and imagery without analysis.';
    case 'observation':
    case 'journal':
      return 'Offer a succinct reflection or plan (2-3 sentences) that responds to the observation. Keep it actionable and clear.';
    case 'action':
      return 'Explain the action taken and the next step in 2 sentences, emphasizing purpose and expected outcome.';
    case 'audio':
    case 'audio_transcript':
      return 'Paraphrase the audio insight in first person, 2 sentences max, highlighting the core information.';
    default:
      return 'Produce a direct first-person response in 2-3 sentences, free of filler, internal monologue, or markdown.';
  }
}


function cleanLLMOutput(raw: string): string {
  let text = raw.trim();
  if (text.startsWith('```')) {
    const firstFence = text.indexOf('\n');
    const lastFence = text.lastIndexOf('```');
    if (firstFence !== -1 && lastFence !== -1 && lastFence > firstFence) {
      text = text.slice(firstFence + 1, lastFence).trim();
    }
  }
  // Remove leading labels like JSON:
  text = text.replace(/^json\s*/i, '').trim();

  // Extract first JSON object if instructions leaked before/after
  const extracted = extractFirstJsonObject(text);
  return extracted ?? text;
}

function extractFirstJsonObject(text: string): string | null {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === '\\') {
      if (inString) escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === '{') {
      if (depth === 0) {
        start = i;
      }
      depth += 1;
    } else if (ch === '}') {
      if (depth > 0) depth -= 1;
      if (depth === 0 && start !== -1) {
        return text.slice(start, i + 1).trim();
      }
    }
  }

  return null;
}

async function generateSamples(
  memories: MemoryRecord[],
  config: BuilderConfig,
  overrides: { model?: string | null; chunkSize?: number; temperature?: number }
): Promise<{ samples: GeneratedSample[]; models: Set<string> }> {
  const persona = loadPersonaCore();
  const systemPrompt = config.systemPrompt || '';
  const modelOverride = overrides.model ?? config.model ?? undefined;
  const chunkSize = overrides.chunkSize ?? config.chunkSize ?? 10;
  const temperature = overrides.temperature ?? config.temperature ?? 0.4;

  const selectedMemories = memories.slice(0, config.maxMemories ?? memories.length);
  const batches = chunk(selectedMemories, chunkSize);
  const samples: GeneratedSample[] = [];
  const modelsUsed = new Set<string>();

  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index];
    const payload = batch.map((mem) => ({
      id: mem.id,
      type: mem.type,
      timestamp: mem.timestamp,
      tags: mem.tags,
      entities: mem.entities,
      response: mem.response,
      sourcePath: mem.sourcePath,
      content: mem.content,
      styleGuide: styleGuideForMemory(mem),
      maxOutputWords: OUTPUT_WORD_LIMIT,
    }));

    let parsed: any = null;
    let lastError: Error | null = null;
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const messages = [
        {
          role: 'system',
          content: `${systemPrompt}\nYou are transforming MetaHuman Greg's memory archive into instruction-tuning pairs. Keep Greg's tone (${persona.personality?.communicationStyle?.tone?.join(', ') || 'direct, concise, pragmatic, friendly'}), respect factual accuracy, and return STRICT JSON only.`,
        },
        {
          role: 'user',
          content: [
            'MEMORIES:',
            JSON.stringify(payload, null, 2),
            '',
            'REQUIREMENTS:',
            '- Produce a JSON object with a single key "samples" pointing to an array.',
            '- For each memory, output one or more items with fields: instruction (string), input (string, can be empty), output (string), meta (object).',
            '- meta must include original memory id, type, and sourcePath.',
            '- Follow the provided styleGuide for each memory when crafting instruction, input, and output.',
            '- Use Greg\'s first-person voice; do NOT include internal thoughts, planning phrases, or apologies.',
            `- Output must be concise (under ${OUTPUT_WORD_LIMIT} words) and free of filler such as "Okay" or "Let me".`,
            '- Do not invent facts. Stay grounded in provided content.',
            '- Respond only with valid JSON. Do not include commentary, explanations, or markdown.',
          ].join('\n'),
        },
      ];

      if (attempt > 1) {
        messages.push({
          role: 'assistant',
          content: 'Previous response was invalid JSON.',
        });
        messages.push({
          role: 'user',
          content: 'Repeat the task strictly following the requirements. Return ONLY a JSON object with sanitized, concise outputs that honour each styleGuide. No filler phrases, no markdown, no explanations.',
        });
      }

      console.log(`[ai-dataset-builder] Generating samples for batch ${index + 1}/${batches.length} (memories=${batch.length}) attempt ${attempt}`);

      let response;
      try {
        response = await llm.generate(messages, modelOverride || undefined, {
          temperature,
          maxTokens: 2048,
        });
      } catch (error) {
        lastError = error as Error;
        const message = (lastError?.message || '').toLowerCase();
        console.warn(`[ai-dataset-builder] Batch ${index + 1} attempt ${attempt} failed during generation: ${lastError.message}`);
        if (attempt < maxAttempts && message.includes('fetch failed')) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          continue;
        }
        throw lastError;
      }
      if (response.model) {
        modelsUsed.add(response.model);
      }

      const cleaned = cleanLLMOutput(response.content);
      try {
        parsed = JSON.parse(cleaned);
        if (!parsed || !Array.isArray(parsed.samples)) {
          throw new Error('Missing "samples" array');
        }
        lastError = null;
        break;
      } catch (error) {
        lastError = error as Error;
        console.warn(`[ai-dataset-builder] Batch ${index + 1} attempt ${attempt} failed to parse JSON: ${lastError.message}`);
        console.warn('Raw response:', response.content.slice(0, 500));
      }
    }

    if (!parsed) {
      throw new Error(`Failed to parse JSON from LLM after ${maxAttempts} attempts: ${lastError?.message ?? 'unknown error'}`);
    }

    for (const item of parsed.samples) {
      if (!item || typeof item !== 'object') continue;
      if (!item.instruction || !item.output) continue;
      const cleanedInstruction = sanitizeInstruction(String(item.instruction));
      const cleanedOutput = sanitizeOutputText(String(item.output));
      const cleanedInput = item.input !== undefined ? wordLimit(normalizeWhitespace(String(item.input ?? '')), OUTPUT_WORD_LIMIT) : '';
      const meta = {
        ...item.meta,
        batchIndex: index,
      } as Record<string, any>;

      const targetId = meta.id ?? payload[0]?.id;
      if (targetId) meta.id = targetId;

      if (payload.length > 0) {
        const original = payload.find((p) => p.id === meta.id) ?? payload[0];
        if (original) {
          meta.styleGuide = original.styleGuide;
          meta.maxOutputWords = original.maxOutputWords;
          meta.type = meta.type || original.type;
          meta.sourcePath = meta.sourcePath || original.sourcePath;
        }
      }
      samples.push({
        instruction: cleanedInstruction,
        input: cleanedInput,
        output: cleanedOutput,
        meta,
      });
    }
  }

  return { samples, models: modelsUsed };
}

function dedupeSamples(samples: GeneratedSample[]): GeneratedSample[] {
  const seen = new Set<string>();
  const out: GeneratedSample[] = [];
  for (const sample of samples) {
    const key = `${sample.instruction.trim()}||${(sample.input || '').trim()}||${sample.output.trim()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(sample);
  }
  return out;
}

function writeDataset(samples: GeneratedSample[], destPath: string) {
  const dir = path.dirname(destPath);
  fs.mkdirSync(dir, { recursive: true });

  const lines = samples.map((sample) =>
    JSON.stringify({
      instruction: sample.instruction,
      input: sample.input ?? '',
      output: sample.output,
      meta: sample.meta,
    })
  );
  fs.writeFileSync(destPath, lines.join('\n'));

  const stats = {
    createdAt: new Date().toISOString(),
    sampleCount: samples.length,
    byType: {} as Record<string, number>,
    avgInstructionLength: 0,
    avgOutputLength: 0,
  };

  let totalInstr = 0;
  let totalOut = 0;
  for (const sample of samples) {
    const type = sample.meta?.type || 'unknown';
    stats.byType[type] = (stats.byType[type] || 0) + 1;
    totalInstr += sample.instruction.length;
    totalOut += sample.output.length;
  }
  if (samples.length > 0) {
    stats.avgInstructionLength = Math.round(totalInstr / samples.length);
    stats.avgOutputLength = Math.round(totalOut / samples.length);
  }

  fs.writeFileSync(`${destPath}.metadata.json`, JSON.stringify(stats, null, 2));
}

async function main() {
  const config = readConfig();
  const args = parseArgs();

  const outputArg = typeof args.output === 'string' ? args.output : null;
  const maxArg = typeof args.max === 'string' ? Number(args.max) : undefined;
  const chunkArg = typeof args.chunk === 'string' ? Number(args.chunk) : undefined;
  const modelArg = typeof args.model === 'string' ? args.model : undefined;

  const date = new Date().toISOString().slice(0, 10);
  const defaultOutput = path.join(paths.root, config.outputDir, date, 'ai_dataset.jsonl');
  const outputPath = outputArg ? path.resolve(outputArg) : defaultOutput;

  let lock: ReturnType<typeof acquireLock> | null = null;
  try {
    lock = acquireLock('ai-dataset-builder');
  } catch (error) {
    console.warn(`[ai-dataset-builder] Lock acquisition failed: ${(error as Error).message}`);
    const lockPath = path.join(paths.run, 'locks', 'ai-dataset-builder.lock');
    try {
      fs.unlinkSync(lockPath);
      console.warn('[ai-dataset-builder] Removed stale lock file, continuing without lock');
    } catch (unlinkErr) {
      console.warn(`[ai-dataset-builder] Could not remove lock file (${lockPath}): ${(unlinkErr as Error).message}`);
    }
  }
  audit({
    level: 'info',
    category: 'action',
    event: 'ai_dataset_builder_started',
    details: { outputPath, model: modelArg || config.model, chunkSize: chunkArg || config.chunkSize },
    actor: 'ai-dataset-builder',
  });

  try {
    const memories: MemoryRecord[] = [];
    memories.push(...collectEpisodicMemories());
    if (config.includeSemanticCurated) memories.push(...collectSemanticCurated());
    if (config.includeAudioTranscripts) memories.push(...collectAudioTranscripts());
    if (config.includeInboxMarkdown) memories.push(...collectInboxMarkdown());

    if (memories.length === 0) {
      console.log('[ai-dataset-builder] No memories found to process.');
      audit({
        level: 'warn',
        category: 'action',
        event: 'ai_dataset_builder_no_memories',
        details: {},
        actor: 'ai-dataset-builder',
      });
      return;
    }

    shuffle(memories);

    if (maxArg && Number.isFinite(maxArg)) {
      config.maxMemories = Math.min(config.maxMemories, maxArg);
    }

    const modelSet = new Set<string>();
    const { samples, models } = await generateSamples(memories, config, {
      model: modelArg ?? config.model,
      chunkSize: chunkArg,
      temperature: config.temperature,
    });
    models.forEach((m) => modelSet.add(m));

    const finalSamples = config.dedupe ? dedupeSamples(samples) : samples;

    writeDataset(finalSamples, outputPath);

    console.log(`[ai-dataset-builder] Wrote ${finalSamples.length} samples to ${outputPath}`);
    audit({
      level: 'info',
      category: 'action',
      event: 'ai_dataset_builder_completed',
      details: {
        outputPath,
        samples: finalSamples.length,
        unique: config.dedupe,
      },
      actor: 'ai-dataset-builder',
    });

    if (modelSet.size > 0) {
      for (const modelName of modelSet) {
        try {
          const stopResult = spawnSync('ollama', ['stop', modelName], { stdio: 'ignore' });
          if (stopResult.status === 0) {
            console.log(`[ai-dataset-builder] Stopped Ollama model ${modelName}`);
          } else {
            console.warn(`[ai-dataset-builder] ollama stop ${modelName} exited with code ${stopResult.status}`);
          }
        } catch (error) {
          console.warn(`[ai-dataset-builder] Failed to stop model ${modelName}: ${(error as Error).message}`);
        }
      }
    }
  } catch (error) {
    console.error('[ai-dataset-builder] Failed:', error);
    audit({
      level: 'error',
      category: 'action',
      event: 'ai_dataset_builder_failed',
      details: { error: (error as Error).message },
      actor: 'ai-dataset-builder',
    });
    process.exitCode = 1;
  } finally {
    if (lock) {
      lock.release();
    }
  }
}

// Execute only when run directly
const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] === modulePath) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
