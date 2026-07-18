/**
 * Quality Scorer Node (Persona Values Alignment)
 *
 * Evaluates response against PERSONA VALUES, not generic quality metrics.
 * The persona defines what constitutes a "good" response.
 *
 * Purpose:
 * - Check if response aligns with persona's stated values
 * - Respect privacy settings (private persona → don't overshare)
 * - Ensure response matches persona's communication style
 * - Only check hallucination when unknownSignal=true (claiming knowledge without memories)
 *
 * Philosophy: The AI should respond however it pleases as long as it:
 * 1. Doesn't violate persona values
 * 2. Doesn't claim knowledge it doesn't have (when unknownSignal=true)
 * 3. Stays in character with the persona
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { callLLM } from '../../model-router.js';
import { renderPromptTemplate } from '../prompt-template.js';

interface PersonaIssue {
  type: 'values_violation' | 'privacy_breach' | 'out_of_character' | 'hallucination';
  severity: 'low' | 'medium' | 'high';
  description: string;
}

interface QualityScorerResult {
  qualityScore: number;
  issues: PersonaIssue[];
  passesThreshold: boolean;
  needsRefinement: boolean;
  suggestions: string[];
  evaluation: string;
}

const DEFAULT_SYSTEM_PROMPT_TEMPLATE = `Check if this response aligns with the persona.

{{personaContext}}

{{groundingContext}}

Query: "{{originalQuery}}"
Response: "{{responseText}}"

Output JSON: {"qualityScore": 0.0-1.0, "issues": [], "needsRefinement": false, "evaluation": ""}`;

const DEFAULT_USER_PROMPT_TEMPLATE = 'Evaluate this response for persona values alignment.';

const execute: NodeExecutor = async (inputs, context, properties) => {
  // Extract inputs
  const response = inputs.response ?? inputs[0] ?? '';
  const originalQuery = inputs.originalQuery ?? inputs[1] ?? context.userMessage ?? '';
  const memories = inputs.memories ?? inputs[2] ?? [];
  const unknownSignal = inputs.unknownSignal ?? inputs[3] ?? false;
  const persona = inputs.persona ?? inputs[4] ?? null;

  // Extract properties
  const qualityThreshold = properties?.qualityThreshold ?? 0.7;
  const strictHallucinationCheck = properties?.strictHallucinationCheck !== false;

  const responseText = typeof response === 'string' ? response : (response?.text || response?.content || '');
  const memoryList = Array.isArray(memories)
    ? memories
    : (Array.isArray(memories?.memories) ? memories.memories : []);

  console.log(`[quality_scorer] Persona-based evaluation for: "${originalQuery.substring(0, 60)}..."`);
  console.log(`[quality_scorer] Has persona: ${!!persona}, unknownSignal: ${unknownSignal}`);

  // Early return for empty response
  if (!responseText || responseText.trim().length === 0) {
    return {
      qualityScore: 0,
      issues: [{ type: 'out_of_character' as const, severity: 'high' as const, description: 'Empty response' }],
      passesThreshold: false,
      needsRefinement: true,
      suggestions: ['Generate a response'],
      evaluation: 'Response is empty',
    };
  }

  // LoRA-only mode has no explicit persona contract to score. If the turn also
  // has no personal-memory grounding concern, avoid an unnecessary evaluator
  // LLM call and let the dedicated safety validator handle policy checks.
  if (!persona && !unknownSignal && memoryList.length === 0) {
    const result: QualityScorerResult = {
      qualityScore: 1,
      issues: [],
      passesThreshold: true,
      needsRefinement: false,
      suggestions: [],
      evaluation: 'No explicit persona or personal-memory claim required evaluation',
    };
    return {
      response: responseText,
      qualityResult: result,
      ...result,
      evaluationSkipped: true,
    };
  }

  // Extract ONLY essential persona data for alignment check
  // Full persona objects are too heavy (10KB+) - slim down to what's needed
  const personaValues = persona?.values || {};
  const personaPersonality = persona?.personality || {};
  const personaIdentity = persona?.identity || {};

  // Extract only core values (the main alignment check)
  const coreValues = personaValues.core || [];
  const coreValuesText = coreValues.length > 0
    ? coreValues.map((v: any) => `- ${v.value}: ${v.description || ''}`).join('\n')
    : 'No core values defined';

  // Extract privacy/boundaries if present
  const boundaries = personaValues.boundaries || [];
  const boundariesText = boundaries.length > 0
    ? boundaries.map((b: any) => `- ${b}`).join('\n')
    : '';

  // Extract communication style (compact)
  const commStyle = personaPersonality.communicationStyle || {};
  const styleText = commStyle.tone ? `Tone: ${commStyle.tone}` : '';

  // Build COMPACT persona context (only what's needed for alignment check)
  const personaContext = `
PERSONA: ${personaIdentity.name || 'No explicit persona configured'}
CORE VALUES:
${coreValuesText}
${boundariesText ? `\nBOUNDARIES:\n${boundariesText}` : ''}
${styleText ? `\nSTYLE: ${styleText}` : ''}
`.trim();

  try {
    const groundingContext = strictHallucinationCheck
      ? unknownSignal
        ? 'GROUNDING: No relevant memory answered this query. The response must not claim that the persona remembers or knows unsupported personal facts.'
        : memoryList.length > 0
          ? `GROUNDING: Relevant memory evidence was supplied (${memoryList.length} item${memoryList.length === 1 ? '' : 's'}). Reject factual claims that contradict it.`
          : 'GROUNDING: No personal-memory claim was requested. Evaluate ordinary conversational accuracy without inventing personal history.'
      : '';
    const promptValues = { personaContext, groundingContext, originalQuery, responseText };
    const systemPrompt = renderPromptTemplate(
      properties?.systemPrompt || DEFAULT_SYSTEM_PROMPT_TEMPLATE,
      promptValues,
    );
    const userPrompt = renderPromptTemplate(
      properties?.userPromptTemplate || DEFAULT_USER_PROMPT_TEMPLATE,
      promptValues,
    );

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: userPrompt },
    ];

    const llmResponse = await callLLM({
      role: 'orchestrator',
      messages,
      cognitiveMode: context.cognitiveMode,
      options: {
        maxTokens: 768,
        temperature: 0.1,
      },
      onProgress: context.emitProgress,
    });

    // Parse the LLM response
    let evaluation;
    try {
      evaluation = JSON.parse(llmResponse.content);
    } catch {
      console.warn('[quality_scorer] Failed to parse LLM response, using defaults');
      const scoreMatch = llmResponse.content.match(/qualityScore[":]\s*([\d.]+)/i);
      const needsRefMatch = llmResponse.content.match(/needsRefinement[":]\s*(true|false)/i);

      evaluation = {
        qualityScore: scoreMatch ? parseFloat(scoreMatch[1]) : 0.8,
        issues: [],
        needsRefinement: needsRefMatch?.[1]?.toLowerCase() === 'true',
        suggestions: [],
        evaluation: 'Unable to parse full evaluation - defaulting to pass',
      };
    }

    const qualityScore = Math.max(0, Math.min(1, evaluation.qualityScore ?? 0.8));
    const issues: PersonaIssue[] = evaluation.issues || [];

    // NOTE: No hard-coded hallucination checks here.
    // The LLM evaluation against persona values is the ONLY check.
    // The persona defines what's acceptable - if the persona is open/trusting,
    // conversational responses pass. If closed/private, revealing responses fail.
    // Hard-coded regex checks caused false positives for greetings and casual chat.

    // Use the LLM's score directly - it already considers persona values and context
    const adjustedScore = qualityScore;

    const passesThreshold = adjustedScore >= qualityThreshold;
    const needsRefinement = evaluation.needsRefinement ?? !passesThreshold;

    console.log(`[quality_scorer] Persona alignment score: ${adjustedScore.toFixed(2)} (threshold: ${qualityThreshold}), issues: ${issues.length}, passes: ${passesThreshold}`);

    const result: QualityScorerResult = {
      qualityScore: adjustedScore,
      issues,
      passesThreshold,
      needsRefinement,
      suggestions: evaluation.suggestions || [],
      evaluation: evaluation.evaluation || `Persona alignment score: ${adjustedScore.toFixed(2)}`,
    };

    return {
      response: responseText,
      qualityResult: result,
      ...result,
      originalScore: qualityScore,
      adjustedScore,
      threshold: qualityThreshold,
      personaChecked: true,
    };

  } catch (error) {
    console.error('[quality_scorer] Error:', error);

    // On error, pass through (don't block due to evaluation failure)
    return {
      response: responseText,
      qualityScore: 0.75,
      issues: [],
      passesThreshold: true,
      needsRefinement: false,
      suggestions: [],
      evaluation: 'Evaluation failed - passing through',
      qualityResult: {
        qualityScore: 0.75,
        issues: [],
        passesThreshold: true,
        needsRefinement: false,
        suggestions: [],
        evaluation: 'Evaluation failed - passing through',
      },
      error: (error as Error).message,
    };
  }
};

export const QualityScorerNode: NodeDefinition = defineNode({
  id: 'quality_scorer',
  name: 'Quality Scorer',
  category: 'cognitive',
  inputs: [
    { name: 'response', type: 'string', description: 'Generated response to evaluate' },
    { name: 'originalQuery', type: 'string', description: 'Original user query' },
    { name: 'memories', type: 'array', optional: true, description: 'Retrieved memories used to check factual grounding' },
    { name: 'unknownSignal', type: 'boolean', optional: true, description: 'Whether search interpreter signaled unknown' },
    { name: 'persona', type: 'object', optional: true, description: 'Persona data (values, personality, identity) for alignment check' },
  ],
  outputs: [
    { name: 'response', type: 'string', description: 'Passthrough of the input response' },
    { name: 'qualityResult', type: 'object', description: 'Full quality evaluation result' },
    { name: 'qualityScore', type: 'number', description: 'Persona alignment score 0-1' },
    { name: 'issues', type: 'array', description: 'List of persona alignment issues' },
    { name: 'passesThreshold', type: 'boolean', description: 'Whether response aligns with persona values' },
    { name: 'needsRefinement', type: 'boolean', description: 'Whether response needs another pass' },
    { name: 'suggestions', type: 'array', description: 'How to better align with persona' },
    { name: 'evaluation', type: 'string', description: 'Summary of persona alignment assessment' },
  ],
  properties: {
    qualityThreshold: 0.7,
    strictHallucinationCheck: true,
    systemPrompt: DEFAULT_SYSTEM_PROMPT_TEMPLATE,
    userPromptTemplate: DEFAULT_USER_PROMPT_TEMPLATE,
  },
  propertySchemas: {
    qualityThreshold: {
      type: 'slider',
      default: 0.7,
      label: 'Alignment Threshold',
      min: 0.5,
      max: 0.95,
      step: 0.05,
    },
    strictHallucinationCheck: {
      type: 'toggle',
      default: true,
      label: 'Check Hallucination (when unknownSignal=true)',
    },
    systemPrompt: {
      type: 'text_multiline',
      default: DEFAULT_SYSTEM_PROMPT_TEMPLATE,
      label: 'System Prompt',
      description: 'Supports {{personaContext}}, {{groundingContext}}, {{originalQuery}}, and {{responseText}}.',
      rows: 10,
    },
    userPromptTemplate: {
      type: 'text_multiline',
      default: DEFAULT_USER_PROMPT_TEMPLATE,
      label: 'User Prompt Template',
      description: 'Supports {{personaContext}}, {{originalQuery}}, and {{responseText}}.',
      rows: 3,
    },
  },
  description: 'Evaluates persona alignment, privacy, character consistency, and memory grounding.',
  execute,
});
