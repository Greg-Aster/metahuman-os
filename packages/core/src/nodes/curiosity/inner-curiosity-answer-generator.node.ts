import { callLLM, type RouterMessage } from '../../model-router.js';
import { renderPromptTemplate } from '../prompt-template.js';
import { defineNode, type NodeDefinition, type NodeExecutionContext } from '../types.js';

const DEFAULT_SYSTEM_PROMPT = `You are {{personaName}} privately contemplating a self-directed question. Answer from the supplied memories. Be thoughtful, exploratory, and explicit about uncertainty or missing evidence.`;

const DEFAULT_USER_PROMPT = `Question: {{question}}

Recent experiences:
{{memoriesText}}{{searchContext}}

What grounded insights or patterns emerge?`;

const MAX_ANSWER_CHARS = 10_000;

export interface InnerCuriosityAnswerDependencies {
  callModel: typeof callLLM;
}

const DEFAULT_DEPENDENCIES: InnerCuriosityAnswerDependencies = { callModel: callLLM };

function throwIfAborted(context: NodeExecutionContext): void {
  const signal = (context.abortSignal ?? context.signal) as AbortSignal | undefined;
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new DOMException('Inner Curiosity answer generation cancelled', 'AbortError');
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must not be empty`);
  return value.trim();
}

function boundedNumber(
  value: unknown,
  fallback: number,
  label: string,
  minimum: number,
  maximum: number,
  integer = false,
): number {
  const selected = value === undefined ? fallback : value;
  if (typeof selected !== 'number' || !Number.isFinite(selected)
    || selected < minimum || selected > maximum || (integer && !Number.isSafeInteger(selected))) {
    throw new Error(`${label} must be ${integer ? 'an integer ' : ''}from ${minimum} to ${maximum}`);
  }
  return selected;
}

function memoryText(value: unknown, label: string, maximumPerItem?: number): string {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`${label} item ${index + 1} must be an object`);
    }
    const record = item as Record<string, unknown>;
    const content = typeof record.content === 'string' ? record.content : record.text;
    const text = requiredText(content, `${label} item ${index + 1}`);
    return `${index + 1}. ${maximumPerItem ? text.slice(0, maximumPerItem) : text}`;
  }).join('\n');
}

export async function executeInnerCuriosityAnswerGenerator(
  inputs: Record<string, unknown>,
  context: NodeExecutionContext,
  properties: Record<string, unknown> = {},
  dependencies: InnerCuriosityAnswerDependencies = DEFAULT_DEPENDENCIES,
): Promise<Record<string, unknown>> {
  throwIfAborted(context);
  const question = requiredText(inputs.question, 'Inner Curiosity answer question');
  const personaName = requiredText(inputs.personaName, 'Inner Curiosity answer personaName');
  const memoriesText = memoryText(inputs.memories, 'Inner Curiosity memories');
  const searchResults = Array.isArray(inputs.searchResults) ? inputs.searchResults : [];
  const relatedText = searchResults.length > 0
    ? memoryText(searchResults, 'Inner Curiosity search results', 500)
    : '';
  const searchContext = relatedText ? `\n\nRelevant indexed memories:\n${relatedText}` : '';
  const values = { personaName, question, memoriesText, searchContext };
  const messages: RouterMessage[] = [
    {
      role: 'system',
      content: renderPromptTemplate(
        typeof properties.systemPrompt === 'string' ? properties.systemPrompt : DEFAULT_SYSTEM_PROMPT,
        values,
      ),
    },
    {
      role: 'user',
      content: renderPromptTemplate(
        typeof properties.userPromptTemplate === 'string' ? properties.userPromptTemplate : DEFAULT_USER_PROMPT,
        values,
      ),
    },
  ];
  const temperature = boundedNumber(properties.temperature, 0.7, 'Inner Curiosity answer temperature', 0, 2);
  const maxTokens = boundedNumber(properties.maxTokens, 768, 'Inner Curiosity answer maxTokens', 64, 4_096, true);
  const response = await dependencies.callModel({
    role: 'persona',
    messages,
    userId: typeof context.userId === 'string' ? context.userId : context.username,
    cognitiveMode: context.cognitiveMode,
    options: { temperature, maxTokens },
    onProgress: context.emitProgress,
  });
  throwIfAborted(context);
  const answer = response.content?.trim() || '';
  if (!answer) throw new Error('Inner Curiosity answer model returned empty content');
  if (answer.length > MAX_ANSWER_CHARS) {
    throw new Error(`Inner Curiosity answer model exceeded the ${MAX_ANSWER_CHARS}-character limit`);
  }
  return { question, answer, personaName, searchResultCount: searchResults.length };
}

export const InnerCuriosityAnswerGeneratorNode: NodeDefinition = defineNode({
  id: 'inner_curiosity_answer_generator',
  name: 'Answer Inner Curiosity Question',
  category: 'curiosity',
  inputs: [
    { name: 'question', type: 'string' },
    { name: 'personaName', type: 'string' },
    { name: 'memories', type: 'array' },
    { name: 'searchResults', type: 'array' },
  ],
  outputs: [
    { name: 'question', type: 'string' },
    { name: 'answer', type: 'string' },
    { name: 'personaName', type: 'string' },
    { name: 'searchResultCount', type: 'number' },
  ],
  properties: {
    temperature: 0.7,
    maxTokens: 768,
    timeout: 300_000,
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    userPromptTemplate: DEFAULT_USER_PROMPT,
  },
  propertySchemas: {
    temperature: { type: 'slider', default: 0.7, min: 0, max: 2, step: 0.05, label: 'Temperature' },
    maxTokens: { type: 'number', default: 768, min: 64, max: 4_096, label: 'Maximum Tokens' },
    timeout: { type: 'number', default: 300_000, min: 1_000, label: 'Timeout (ms)', advanced: true },
    systemPrompt: {
      type: 'text_multiline',
      default: DEFAULT_SYSTEM_PROMPT,
      label: 'System Prompt',
      description: 'Supports {{personaName}}, {{question}}, {{memoriesText}}, and {{searchContext}}.',
      rows: 7,
    },
    userPromptTemplate: {
      type: 'text_multiline',
      default: DEFAULT_USER_PROMPT,
      label: 'User Prompt',
      description: 'Supports {{personaName}}, {{question}}, {{memoriesText}}, and {{searchContext}}.',
      rows: 8,
    },
  },
  description: 'Answers one private self-directed question using bounded recent and semantically related profile memories.',
  execute: executeInnerCuriosityAnswerGenerator,
});
