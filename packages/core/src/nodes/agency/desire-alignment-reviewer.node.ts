/**
 * Desire Alignment Reviewer Node
 *
 * Uses LLM to review a plan for alignment with persona values and goals.
 *
 * Inputs:
 *   - desire: Desire object
 *   - plan: DesirePlan object
 *   - personaContext: string - Canonically formatted persona values and goals
 *
 * Outputs:
 *   - alignmentScore: number (0-1)
 *   - concerns: string[]
 *   - approved: boolean
 *   - reasoning: string
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import type { Desire, DesirePlan, AlignmentReviewOutput } from '../../agency/types.js';
import { callLLM, normalizeModelRole, type RouterMessage } from '../../model-router.js';
import { renderPromptTemplate } from '../prompt-template.js';

const SYSTEM_PROMPT = `You are the Alignment Review module of MetaHuman OS. Your job is to evaluate whether a planned action aligns with the persona's values, goals, and identity.

Be thoughtful and honest. If there are concerns, raise them. If the plan aligns well, say so.

Respond with valid JSON matching the schema.`;

const DEFAULT_USER_PROMPT_TEMPLATE = `## Plan to Review

**Desire**: {{title}}
**Description**: {{description}}
**Reason**: {{reason}}

**Plan Steps**:
{{planSteps}}

**Operator Goal**: {{operatorGoal}}

## Persona Context
{{personaContext}}

## Review Questions

1. Does this plan align with the stated persona values?
2. Does it serve any of the persona's goals?
3. Would the persona genuinely want this outcome?
4. Are there any value conflicts or concerns?
5. Is the stated reason authentic to the persona?

## Output

Respond with JSON:
{
  "alignmentScore": 0.0-1.0,
  "concerns": ["concern 1", "concern 2"],
  "approved": true/false,
  "reasoning": "Brief explanation of the verdict"
}`;

const execute: NodeExecutor = async (inputs, context, properties) => {
  const desire = inputs.desire as Desire | undefined;
  const plan = inputs.plan as DesirePlan | undefined;
  const personaContext = typeof inputs.personaContext === 'string' ? inputs.personaContext.trim() : '';
  const userId = typeof context.userId === 'string' ? context.userId.trim() : '';
  const temperature = (properties?.temperature as number) ?? 0.2;
  const role = normalizeModelRole(properties?.role, 'persona');
  const systemPrompt = properties?.systemPrompt ?? SYSTEM_PROMPT;
  const userPromptTemplate = properties?.userPromptTemplate ?? DEFAULT_USER_PROMPT_TEMPLATE;

  if (!desire || !plan) {
    throw new Error('Alignment Review requires a desire and validated plan');
  }
  if (!userId) throw new Error('Alignment Review requires authenticated account identity');

  const userPrompt = renderPromptTemplate(userPromptTemplate, {
    title: desire.title,
    description: desire.description,
    reason: desire.reason,
    planSteps: plan.steps.map(s => `${s.order}. ${s.action} (${s.skill || 'manual'})`).join('\n'),
    operatorGoal: plan.operatorGoal,
    personaContext: personaContext || 'No active persona values or goals are configured',
    desire,
    plan,
  });

  const messages: RouterMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  try {
    const response = await callLLM({
      role,
      messages,
      userId,
      options: {
        temperature,
        responseFormat: 'json',
      },
    });

    if (!response.content) {
      throw new Error('Alignment Review received an empty model response');
    }

    const content = response.content.trim();
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Alignment Review response did not contain a JSON object');
    }

    const parsed = JSON.parse(jsonMatch[0]) as AlignmentReviewOutput;
    if (!Number.isFinite(parsed.alignmentScore)
        || !Array.isArray(parsed.concerns)
        || parsed.concerns.some(concern => typeof concern !== 'string')
        || typeof parsed.approved !== 'boolean'
        || typeof parsed.reasoning !== 'string'
        || !parsed.reasoning.trim()) {
      throw new Error('Alignment Review response is missing required typed fields');
    }
    const review = {
      alignmentScore: Math.max(0, Math.min(1, parsed.alignmentScore)),
      concerns: parsed.concerns,
      approved: parsed.approved,
      reasoning: parsed.reasoning.trim(),
    };
    return { ...review, review };
  } catch (error) {
    throw new Error(`Alignment Review failed: ${(error as Error).message}`, { cause: error });
  }
};

export const DesireAlignmentReviewerNode: NodeDefinition = defineNode({
  id: 'desire_alignment_reviewer',
  name: 'Alignment Review',
  category: 'agency',
  description: 'Reviews a plan for alignment with persona values and goals',
  inputs: [
    { name: 'desire', type: 'object', description: 'Desire being reviewed' },
    { name: 'plan', type: 'object', description: 'Plan to review' },
    { name: 'personaContext', type: 'string', optional: true, description: 'Canonical formatted persona values and goals' },
  ],
  outputs: [
    { name: 'alignmentScore', type: 'number', description: 'Score from 0-1' },
    { name: 'concerns', type: 'array', description: 'List of alignment concerns' },
    { name: 'approved', type: 'boolean', description: 'Whether alignment check passed' },
    { name: 'reasoning', type: 'string', description: 'Explanation of verdict' },
    { name: 'review', type: 'object', description: 'Typed aggregate alignment review' },
  ],
  properties: {
    temperature: 0.2,
    role: 'persona',
    systemPrompt: SYSTEM_PROMPT,
    userPromptTemplate: DEFAULT_USER_PROMPT_TEMPLATE,
  },
  propertySchemas: {
    temperature: {
      type: 'slider',
      default: 0.2,
      min: 0,
      max: 1,
      step: 0.1,
      label: 'Temperature',
      description: 'LLM temperature for alignment review',
    },
    role: {
      type: 'string',
      default: 'persona',
      label: 'LLM Role',
    },
    systemPrompt: {
      type: 'text_multiline',
      default: SYSTEM_PROMPT,
      label: 'System Prompt',
      rows: 6,
    },
    userPromptTemplate: {
      type: 'text_multiline',
      default: DEFAULT_USER_PROMPT_TEMPLATE,
      label: 'User Prompt Template',
      description: 'Template variables include {{title}}, {{description}}, {{planSteps}}, {{personaContext}}, {{desire}}, {{plan}}.',
      rows: 24,
    },
  },
  execute,
});

export default DesireAlignmentReviewerNode;
