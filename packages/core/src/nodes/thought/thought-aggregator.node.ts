/**
 * Thought Aggregator Node
 * Combines all thoughts into a coherent reasoning chain
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { callLLM } from '../../model-router.js';
import { loadPersonaCore } from '../../identity.js';
import { audit } from '../../audit.js';
import { renderPromptTemplate } from '../prompt-template.js';

const DEFAULT_SYSTEM_PROMPT_TEMPLATE = `You are {{personaName}}, synthesizing a train of thought into a coherent insight.

Given the following chain of reasoning, create:
1. A consolidated narrative that weaves these thoughts together
2. A single key insight or conclusion
3. A brief 1-sentence summary

Keep the total response under {{maxLength}} words.
Style: {{summaryStyle}}

Respond in this format:
NARRATIVE: [Woven narrative of the reasoning chain]
INSIGHT: [Single key insight]
SUMMARY: [1-sentence summary]`;

const DEFAULT_USER_PROMPT_TEMPLATE = `Train of thought ({{thoughtCount}} steps):

{{chainText}}`;

const execute: NodeExecutor = async (inputs, context, properties) => {
  const input0 = inputs.thoughtData || {};
  const rawThoughts = input0.thoughts || input0.scratchpad?.thoughts || context.scratchpad?.thoughts || [];
  const thoughts = Array.isArray(rawThoughts)
    ? rawThoughts.filter((value: unknown): value is string => typeof value === 'string' && Boolean(value.trim()))
    : [];
  const summaryStyle = properties?.summaryStyle ?? 'narrative';
  const maxLength = properties?.maxLength ?? 200;
  const maxTokens = properties?.maxTokens ?? 800;
  const temperature = properties?.temperature ?? 0.6;
  const role = properties?.role ?? 'persona';
  const systemPromptTemplate = properties?.systemPromptTemplate ?? DEFAULT_SYSTEM_PROMPT_TEMPLATE;
  const userPromptTemplate = properties?.userPromptTemplate ?? DEFAULT_USER_PROMPT_TEMPLATE;
  const username = context.userId || context.username;

  if (thoughts.length === 0) {
    throw new Error('Thought Aggregator requires at least one generated thought');
  }

  const persona = loadPersonaCore();

  const chainText = thoughts.map((t: string, i: number) => `Step ${i + 1}: ${t}`).join('\n\n');

  const systemPrompt = renderPromptTemplate(systemPromptTemplate, {
    personaName: persona.identity.name,
    maxLength,
    summaryStyle,
  });
  const userPrompt = renderPromptTemplate(userPromptTemplate, {
    thoughtCount: thoughts.length,
    chainText,
  });

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: userPrompt },
  ];

  const response = await callLLM({
    role,
    messages,
    userId: username,
    cognitiveMode: context.cognitiveMode,
    options: {
      maxTokens,
      temperature,
    },
    onProgress: context.emitProgress,
  });

  const content = response.content?.trim() || '';
  if (!content) throw new Error('Thought Aggregator model returned empty content');
  const narrativeMatch = content.match(/NARRATIVE:\s*(.+?)(?=\nINSIGHT:|$)/s);
  const insightMatch = content.match(/INSIGHT:\s*(.+?)(?=\nSUMMARY:|$)/s);
  const summaryMatch = content.match(/SUMMARY:\s*(.+?)$/s);

  const consolidatedChain = narrativeMatch?.[1]?.trim() || '';
  const insight = insightMatch?.[1]?.trim() || '';
  const summary = summaryMatch?.[1]?.trim() || '';
  if (!consolidatedChain || !insight || !summary) {
    throw new Error('Thought Aggregator model response did not satisfy the narrative, insight, and summary contract');
  }

  audit({
    level: 'info',
    category: 'decision',
    event: 'thought_chain_aggregated',
    actor: 'train-of-thought',
    details: {
      thoughtCount: thoughts.length,
      sourceAgent: context.sourceAgent,
    },
  });

  return {
    result: consolidatedChain,
    consolidatedChain,
    insight,
    summary,
    thoughtCount: thoughts.length,
  };
};

export const ThoughtAggregatorNode: NodeDefinition = defineNode({
  id: 'thought_aggregator',
  name: 'Thought Aggregator',
  category: 'thought',
  inputs: [
    { name: 'thoughtData', type: 'object', description: 'Scratchpad with thoughts' },
  ],
  outputs: [
    { name: 'result', type: 'string', description: 'Consolidated reasoning chain for persistence' },
    { name: 'consolidatedChain', type: 'string', description: 'Full reasoning chain' },
    { name: 'insight', type: 'string', description: 'Key insight' },
    { name: 'summary', type: 'string', description: 'Brief summary' },
    { name: 'thoughtCount', type: 'number' },
  ],
  properties: {
    summaryStyle: 'narrative',
    maxLength: 200,
    maxTokens: 800,
    temperature: 0.6,
    role: 'persona',
    timeout: 300000,
    systemPromptTemplate: DEFAULT_SYSTEM_PROMPT_TEMPLATE,
    userPromptTemplate: DEFAULT_USER_PROMPT_TEMPLATE,
  },
  propertySchemas: {
    summaryStyle: {
      type: 'select',
      default: 'narrative',
      label: 'Summary Style',
      options: ['narrative', 'bullets', 'insight'],
    },
    maxLength: {
      type: 'number',
      default: 200,
      label: 'Max Length',
      description: 'Maximum output length in words',
    },
    maxTokens: {
      type: 'number',
      default: 800,
      label: 'Max Tokens',
      description: 'Maximum LLM response tokens',
    },
    temperature: {
      type: 'number',
      default: 0.6,
      label: 'Temperature',
    },
    role: {
      type: 'string',
      default: 'persona',
      label: 'LLM Role',
    },
    timeout: {
      type: 'number',
      default: 300000,
      label: 'Execution Timeout (ms)',
      description: 'Maximum time allowed for this model node.',
      min: 1000,
      max: 900000,
      step: 1000,
      advanced: true,
    },
    systemPromptTemplate: {
      type: 'text_multiline',
      default: DEFAULT_SYSTEM_PROMPT_TEMPLATE,
      label: 'System Prompt Template',
      description: 'Template variables: {{personaName}}, {{maxLength}}, {{summaryStyle}}.',
      rows: 13,
    },
    userPromptTemplate: {
      type: 'text_multiline',
      default: DEFAULT_USER_PROMPT_TEMPLATE,
      label: 'User Prompt Template',
      description: 'Template variables: {{thoughtCount}}, {{chainText}}.',
      rows: 6,
    },
  },
  description: 'Combines all thoughts into a coherent reasoning chain',
  execute,
});
