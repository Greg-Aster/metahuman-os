/**
 * Curator LLM Node
 * Generates conversational exchanges from raw memories
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { callLLM } from '../../model-router.js';
import { renderPromptTemplate } from '../prompt-template.js';

interface EpisodicMemory {
  id: string;
  timestamp: string;
  content: string;
  type?: string;
  response?: string;
  path?: string;
  tags?: string[];
  metadata?: {
    cognitiveMode?: string;
    reinforcementSignal?: number;  // -1 = negative feedback, +1 = positive
    [key: string]: unknown;
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
  rejectionReason?: string;
  cognitiveMode?: string;
  memoryType?: string;
}

const DEFAULT_SYSTEM_PROMPT_TEMPLATE = `You are a memory curator preparing training data for a personal AI assistant.

PERSONA CONTEXT:
{{personaSummary}}

COGNITIVE MODE: {{cognitiveMode}}
MEMORY TYPE: {{memoryType}}

Convert this memory into a conversational exchange suitable for training.

=== QUALITY CRITERIA ===

REJECT (suitableForTraining=false) if ANY of these apply:

1. CONTAMINATION PATTERNS:
   - Repetitive phrases repeated 3+ times in same message
   - Nonsense syllables or garbled text (gibberish, typos dominating content)
   - Self-referential loops ("you ok home", "test test", repeated greetings)
   - Model confusion (mixing personas, contradicting identity)

2. SYSTEM ARTIFACTS:
   - Raw JSON, XML, or code blocks (unless the conversation IS about code)
   - Tool syntax, function calls, or API responses
   - Error messages, stack traces, or debug output
   - System prompts or internal instructions leaked

3. LOW-QUALITY EXCHANGES:
   - Empty or near-empty responses (< 5 words total)
   - Single word replies without context ("ok", "yes", "no")
   - Incomplete thoughts cut off mid-sentence
   - Responses that don't address the user's message

4. SELF-AWARE AI ARTIFACTS:
   - "As an AI/LLM/assistant, I..." disclaimers
   - Explaining model limitations or training cutoffs
   - Refusing to engage for safety reasons (unless persona-appropriate)
   - Meta-commentary about being trained or fine-tuned

5. DUPLICATE INDICATORS:
   - Exact repetition of a previous exchange
   - Same question asked multiple times with minor variations
   - Greeting exchanges that add no unique value

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
  "flags": ["contamination", "system-artifact", "low-quality", "ai-disclaimer", "duplicate"],
  "rejectionReason": "If rejected, explain why in 1 sentence",
  "suitableForTraining": true/false
}`;

const DEFAULT_USER_PROMPT_TEMPLATE = `Memory content:
{{content}}

{{responseSection}}`;

const execute: NodeExecutor = async (inputs, context, properties) => {
  // Inputs are keyed by targetHandle name from graph edges, not array index
  const memoriesInput = inputs.memories || inputs[0];
  const memories: (EpisodicMemory & { path: string })[] = memoriesInput?.memories || memoriesInput || [];
  const personaSummary = (inputs.personaSummary || inputs[1]) as string;
  const temperature = properties?.temperature ?? 0.3;
  const role = properties?.role ?? 'curator';
  const systemPromptTemplate = properties?.systemPromptTemplate ?? DEFAULT_SYSTEM_PROMPT_TEMPLATE;
  const userPromptTemplate = properties?.userPromptTemplate ?? DEFAULT_USER_PROMPT_TEMPLATE;
  const username = context.userId || context.username;

  if (!memories || memories.length === 0) {
    return {
      success: true,
      curatedMemories: [],
      count: 0,
    };
  }

  const curatedResults: any[] = [];

  for (const memory of memories) {
    if (!memory || !memory.content) continue;

    // Skip memories with negative feedback - user explicitly marked these as bad
    // They should not influence training data
    if (memory.metadata?.reinforcementSignal === -1) {
      console.log(`[curator_llm] ⏭️ Skipping memory ${memory.id}: negative user feedback`);
      continue;
    }

    // Skip feedback memories themselves - they're meta-data, not training content
    if (memory.tags?.includes('feedback')) {
      continue;
    }

    const cognitiveMode = memory.metadata?.cognitiveMode || 'emulation';
    const memoryType = memory.type || 'conversation';

    const systemPrompt = renderPromptTemplate(systemPromptTemplate, {
      personaSummary,
      cognitiveMode,
      memoryType,
    });
    const userPrompt = renderPromptTemplate(userPromptTemplate, {
      content: memory.content,
      response: memory.response || '',
      responseSection: memory.response ? `Response: ${memory.response}` : '',
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
        options: { temperature },
        keepAlive: 0, // Unload model immediately - background agent shouldn't hog VRAM
      });

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
        rejectionReason: result.rejectionReason,
        cognitiveMode,
        memoryType,
      };

      // Log rejections for debugging
      if (!curated.suitableForTraining) {
        console.log(`[curator_llm] ❌ Rejected memory ${memory.id}: ${result.rejectionReason || 'No reason provided'}`);
      }

      curatedResults.push({
        success: true,
        curated,
        originalMemoryPath: memory.path,
      });
    } catch (error) {
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

  return {
    success: true,
    curatedMemories: curatedResults,
    count: curatedResults.length,
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
  ],
  properties: {
    temperature: 0.3,
    role: 'curator',
    systemPromptTemplate: DEFAULT_SYSTEM_PROMPT_TEMPLATE,
    userPromptTemplate: DEFAULT_USER_PROMPT_TEMPLATE,
  },
  propertySchemas: {
    temperature: {
      type: 'number',
      default: 0.3,
      label: 'Temperature',
    },
    role: {
      type: 'string',
      default: 'curator',
      label: 'LLM Role',
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
