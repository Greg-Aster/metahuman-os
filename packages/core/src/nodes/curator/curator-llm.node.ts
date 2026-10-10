import { reasoningProperty } from '../llm/model-router.schema.js';
import { MODEL_ROLE_OPTIONS } from '../../model-roles.js';
/**
 * Curator LLM Node
 * Generates conversational exchanges from raw memories
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { createHash } from 'node:crypto';
import { episodicSourceHash } from '../../memory.js';
import { callLLM } from '../../model-router.js';
import { renderPromptTemplate } from '../prompt-template.js';
import { CURATOR_POLICY_VERSION, type CuratedMemory, type CuratorItemResult, type EpisodicMemory } from './contracts.js';

const DEFAULT_SYSTEM_PROMPT_TEMPLATE = `You review source memories for a personal model's training dataset.

PERSONA CONTEXT:
{{personaSummary}}

COGNITIVE MODE: {{cognitiveMode}}
MEMORY TYPE: {{memoryType}}

Review the memory for correctness, useful task behavior, and fidelity to its source.
The cognitive mode describes where it came from; it does not change the author of a message.

When both a user message and assistant response are supplied, evaluate that
exact exchange. Copy both messages without rewriting or synthesizing content.
For a standalone memory, synthesize only a useful prompt; keep its answer faithful
to the source. Do not invent facts or treat a generated reflection as human testimony.

=== QUALITY CRITERIA ===

REJECT (suitableForTraining=false) if ANY of these apply:

1. CONTAMINATION PATTERNS:
   - Repetitive phrases repeated 3+ times in same message
   - Nonsense syllables or garbled text (gibberish, typos dominating content)
   - Self-referential loops ("you ok home", "test test", repeated greetings)
   - Model confusion (mixing personas, contradicting identity)

2. UNINTENDED ARTIFACTS:
   - Leaked private instructions or unrelated diagnostic output
   - Incorrect or malformed structured output for the task requested
   - Preserve valid code, tool use, JSON, and concise replies when the task requires them

3. LOW-QUALITY EXCHANGES:
   - Empty responses or replies with insufficient context to judge their meaning
   - Incomplete thoughts cut off mid-sentence
   - Responses that don't address the user's message

Do not reject appropriate refusals, honest uncertainty, model limitations, or short
answers solely for their style or length. Do not claim corpus-wide duplication from
one memory; the dataset owner performs deduplication. Do not claim factual verification
when no evidence is supplied. Flag uncertain factual claims for downstream review.

ACCEPT (suitableForTraining=true) if:
- Natural, coherent conversation that reflects the persona
- Meaningful exchange with substantive content
- Appropriate emotional tone and style consistency
- Unique perspective or information not repetitive

=== OUTPUT FORMAT ===

Respond with JSON:
{
  "conversationalEssence": "Natural language summary of what this exchange is about",
  "userMessage": "Clean user message (extracted or synthesized)",
  "assistantResponse": "Clean assistant response (extracted or synthesized)",
  "context": "Additional context if helpful",
  "flags": ["contamination", "unintended-artifact", "insufficient-context", "unverified-claim"],
  "rejectionReason": "If rejected, explain why in 1 sentence",
  "suitableForTraining": true/false
}`;

const DEFAULT_USER_PROMPT_TEMPLATE = `Memory content:
{{content}}

{{responseSection}}`;

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Curator response requires a non-empty ${key}`);
  }
  return value.trim();
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new Error(`Curator response ${key} must be a string`);
  return value.trim() || undefined;
}

function stringArray(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error(`Curator response ${key} must be an array of strings`);
  }
  return value.map(item => item.trim()).filter(Boolean);
}

function cognitiveMode(memory: EpisodicMemory): Pick<CuratedMemory, 'cognitiveMode' | 'cognitiveModeSource'> {
  const value = memory.metadata?.cognitiveMode;
  if (value === 'dual' || value === 'agent' || value === 'emulation' || value === 'environment') {
    return { cognitiveMode: value, cognitiveModeSource: 'metadata' };
  }
  if (value === undefined || value === null || value === '') {
    return { cognitiveMode: 'dual', cognitiveModeSource: 'legacy-default' };
  }
  throw new Error(`Curator source memory ${memory.id} has invalid cognitive mode: ${String(value)}`);
}

export function parseCuratorResponse(
  content: string,
  memory: EpisodicMemory,
  curatedAt = new Date().toISOString(),
): CuratedMemory {
  if (typeof memory.id !== 'string' || !memory.id.trim()) throw new Error('Curator source memory requires an id');
  if (typeof memory.timestamp !== 'string' || Number.isNaN(Date.parse(memory.timestamp))) {
    throw new Error(`Curator source memory ${memory.id} has an invalid timestamp`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content.trim());
  } catch (error) {
    throw new Error(`Curator response is not valid JSON: ${(error as Error).message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Curator response must be a JSON object');
  }

  const result = parsed as Record<string, unknown>;
  if (typeof result.suitableForTraining !== 'boolean') {
    throw new Error('Curator response suitableForTraining must be a boolean');
  }

  const suitableForTraining = result.suitableForTraining;
  const rejectionReason = optionalString(result, 'rejectionReason');
  if (!suitableForTraining && !rejectionReason) {
    throw new Error('Rejected curator responses require rejectionReason');
  }

  const mode = cognitiveMode(memory);
  const sourceUserMessage = memory.content;
  const sourceAssistantResponse = memory.response;
  const hasSourceExchange = Boolean(sourceUserMessage.trim() && sourceAssistantResponse?.trim());
  return {
    id: memory.id,
    originalTimestamp: memory.timestamp,
    conversationalEssence: requiredString(result, 'conversationalEssence'),
    context: optionalString(result, 'context') ?? '',
    userMessage: suitableForTraining
      ? hasSourceExchange ? sourceUserMessage : requiredString(result, 'userMessage')
      : optionalString(result, 'userMessage'),
    assistantResponse: suitableForTraining
      ? hasSourceExchange ? sourceAssistantResponse : requiredString(result, 'assistantResponse')
      : optionalString(result, 'assistantResponse'),
    curatedAt,
    flags: stringArray(result, 'flags'),
    suitableForTraining,
    rejectionReason,
    ...mode,
    memoryType: typeof memory.type === 'string' && memory.type.trim() ? memory.type.trim() : 'conversation',
    sourceMemoryIds: memory.sourceMemoryIds?.length ? [...memory.sourceMemoryIds] : [memory.id],
    provenance: {
      policyVersion: CURATOR_POLICY_VERSION,
      sourceHashes: memory.sourceHashes ?? { [memory.id]: episodicSourceHash(memory) },
      kind: hasSourceExchange ? 'recorded-exchange' : 'synthetic-exchange',
      ...(typeof memory.metadata?.sessionId === 'string' && memory.metadata.sessionId.trim()
        ? { sessionId: memory.metadata.sessionId } : {}),
      ...([-1, 0, 1].includes(Number(memory.metadata?.reinforcementSignal))
        && memory.metadata?.reinforcementSignal !== undefined
        ? { reinforcementSignal: Number(memory.metadata.reinforcementSignal) } : {}),
    },
  };
}

function memoryPaths(memory: EpisodicMemory & { path: string }): string[] {
  return memory.sourcePaths?.length ? [...new Set(memory.sourcePaths)] : [memory.path];
}

const execute: NodeExecutor = async (inputs, context, properties) => {
  // Inputs are keyed by targetHandle name from graph edges, not array index
  const memoriesInput = inputs.memories || inputs[0];
  const memories: (EpisodicMemory & { path: string })[] = memoriesInput?.memories || memoriesInput || [];
  const personaSummary = (inputs.personaSummary || inputs[1]) as string;
  if (typeof personaSummary !== 'string' || !personaSummary.trim()) {
    throw new Error('Curator requires non-empty persona context');
  }
  const temperature = Number(properties?.temperature ?? 0.3);
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 1) {
    throw new Error(`Curator temperature must be between 0 and 1, received: ${properties?.temperature}`);
  }
  const role = properties?.role ?? 'curator';
  const systemPromptTemplate = properties?.systemPromptTemplate ?? DEFAULT_SYSTEM_PROMPT_TEMPLATE;
  const userPromptTemplate = properties?.userPromptTemplate ?? DEFAULT_USER_PROMPT_TEMPLATE;
  const username = context.userId || context.username;

  if (!memories || memories.length === 0) {
    return {
      success: true,
      curatedMemories: [],
      count: 0,
      sourceCount: 0,
      acceptedCount: 0,
      rejectedCount: 0,
      failedCount: 0,
    };
  }

  const curatedResults: CuratorItemResult[] = [];
  const sourceCount = memories.reduce((count, memory) => count + memoryPaths(memory).length, 0);

  for (const memory of memories) {
    if (!memory || typeof memory.content !== 'string' || !memory.content.trim()) {
      const originalMemoryPaths = memory ? memoryPaths(memory) : [];
      curatedResults.push({
        success: false,
        originalMemoryPath: originalMemoryPaths[0] || '',
        originalMemoryPaths,
        memoryId: memory?.id || 'unknown',
        error: 'Curator received a memory without content',
      });
      continue;
    }

    // Retain a durable rejection so feedback remains visible and does not recur
    // as pending work. Negative examples are not positive SFT demonstrations.
    if (memory.metadata?.reinforcementSignal === -1 || memory.tags?.includes('feedback')) {
      const curated = parseCuratorResponse(JSON.stringify({
        suitableForTraining: false, conversationalEssence: 'Feedback excluded from positive demonstrations',
        rejectionReason: 'Feedback records and negatively rated outputs are excluded from positive SFT examples.',
        flags: ['feedback'],
      }), memory);
      const originalMemoryPaths = memoryPaths(memory);
      curatedResults.push({ success: true, disposition: 'rejected', curated,
        originalMemoryPath: originalMemoryPaths[0]!, originalMemoryPaths, memoryId: memory.id });
      continue;
    }

    let sourceCognitiveMode: CuratedMemory['cognitiveMode'];
    try {
      sourceCognitiveMode = cognitiveMode(memory).cognitiveMode;
    } catch (error) {
      const originalMemoryPaths = memoryPaths(memory);
      curatedResults.push({
        success: false,
        originalMemoryPath: originalMemoryPaths[0] || memory.path,
        originalMemoryPaths,
        memoryId: memory.id,
        error: (error as Error).message,
      });
      continue;
    }
    const memoryType = memory.type || 'conversation';

    const systemPrompt = renderPromptTemplate(systemPromptTemplate, {
      personaSummary,
      cognitiveMode: sourceCognitiveMode,
      memoryType,
    });
    const userPrompt = renderPromptTemplate(userPromptTemplate, {
      content: memory.content,
      response: memory.response || '',
      responseSection: memory.response
        ? `Assistant response:\n${memory.response}\n\nPreserve the supplied user and assistant messages exactly.`
        : '',
      memory,
    });

    const messages: any[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    try {
      const response = await callLLM({
        role,
        messages,
        userId: username,
        cognitiveMode: context.cognitiveMode || 'dual',
        options: { enableThinking: properties?.enableThinking === true, temperature, response_format: { type: 'json_object' } },
        keepAlive: 0, // Unload model immediately - background agent shouldn't hog VRAM
      });

      const curated = parseCuratorResponse(response.content, memory);
      curated.provenance!.promptHash = createHash('sha256').update(systemPrompt + '\n' + userPrompt).digest('hex');
      if (response.model) curated.provenance!.model = response.model;
      const originalMemoryPaths = memoryPaths(memory);

      // Log rejections for debugging
      if (!curated.suitableForTraining) {
        console.log(`[curator_llm] ❌ Rejected memory ${memory.id}: ${curated.rejectionReason || 'No reason provided'}`);
      }

      curatedResults.push({
        success: true,
        disposition: curated.suitableForTraining ? 'accepted' : 'rejected',
        curated,
        originalMemoryPath: originalMemoryPaths[0] || memory.path,
        originalMemoryPaths,
        memoryId: memory.id,
      });
    } catch (error) {
      const originalMemoryPaths = memoryPaths(memory);
      curatedResults.push({
        success: false,
        originalMemoryPath: originalMemoryPaths[0] || memory.path,
        originalMemoryPaths,
        memoryId: memory.id,
        error: (error as Error).message,
      });
    }
  }

  const acceptedCount = curatedResults.filter(result => result.disposition === 'accepted').length;
  const rejectedCount = curatedResults.filter(result => result.disposition === 'rejected').length;
  const failedCount = curatedResults.filter(result => !result.success).length;

  return {
    success: failedCount === 0,
    curatedMemories: curatedResults,
    count: curatedResults.length,
    sourceCount,
    acceptedCount,
    rejectedCount,
    failedCount,
  };
};

export const CuratorLLMNode: NodeDefinition = defineNode({
  id: 'curator_llm',
  name: 'Curator LLM',
  category: 'curator',
  inputs: [
    { name: 'memories', type: 'object', description: 'Uncurated memories' },
    { name: 'personaSummary', type: 'string', description: 'Persona context' },
  ],
  outputs: [
    { name: 'curatedMemories', type: 'array' },
    { name: 'count', type: 'number' },
    { name: 'sourceCount', type: 'number' },
    { name: 'acceptedCount', type: 'number' },
    { name: 'rejectedCount', type: 'number' },
    { name: 'failedCount', type: 'number' },
  ],
  properties: {
    enableThinking: false,
    temperature: 0.3,
    timeout: 300000,
    role: 'curator',
    systemPromptTemplate: DEFAULT_SYSTEM_PROMPT_TEMPLATE,
    userPromptTemplate: DEFAULT_USER_PROMPT_TEMPLATE,
  },
  propertySchemas: {
    enableThinking: reasoningProperty,
    temperature: {
      type: 'number',
      default: 0.3,
      label: 'Temperature',
      min: 0,
      max: 1,
      step: 0.1,
    },
    timeout: {
      type: 'number',
      default: 300000,
      label: 'Execution Timeout (ms)',
      min: 1000,
      max: 900000,
      step: 1000,
    },
    role: {
      type: 'select',
      default: 'curator',
      label: 'LLM Role',
      options: [...MODEL_ROLE_OPTIONS],
    },
    systemPromptTemplate: {
      type: 'text_multiline',
      default: DEFAULT_SYSTEM_PROMPT_TEMPLATE,
      label: 'System Prompt Template',
      description: 'Template variables: {{personaSummary}}, {{cognitiveMode}}, {{memoryType}}.',
      rows: 28,
    },
    userPromptTemplate: {
      type: 'text_multiline',
      default: DEFAULT_USER_PROMPT_TEMPLATE,
      label: 'User Prompt Template',
      description: 'Template variables: {{content}}, {{response}}, {{responseSection}}, {{memory}}.',
      rows: 6,
    },
  },
  description: 'Generates conversational exchanges from raw memories',
  execute,
});
