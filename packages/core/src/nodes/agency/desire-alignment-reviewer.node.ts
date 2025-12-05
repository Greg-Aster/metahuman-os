/**
 * Desire Alignment Reviewer Node
 *
 * Uses LLM to review a plan for alignment with persona values and goals.
 *
 * Inputs:
 *   - desire: Desire object
 *   - plan: DesirePlan object
 *   - personaValues: string - Formatted persona values
 *   - personaGoals: string - Formatted persona goals
 *
 * Outputs:
 *   - alignmentScore: number (0-1)
 *   - concerns: string[]
 *   - approved: boolean
 *   - reasoning: string
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import type { Desire, DesirePlan, AlignmentReviewOutput } from '../../agency/types.js';
import { callLLM, type RouterMessage } from '../../model-router.js';

const SYSTEM_PROMPT = `You are the Alignment Review module of MetaHuman OS. Your job is to evaluate whether a planned action aligns with the persona's values, goals, and identity.

Be thoughtful and honest. If there are concerns, raise them. If the plan aligns well, say so.

Respond with valid JSON matching the schema.`;

const execute: NodeExecutor = async (inputs, _context, properties) => {
  // Inputs come via slot positions from graph links:
  // slot 0: {desire, found} from desire_loader
  // slot 2: formatted persona values string from persona_formatter
  const slot0 = inputs[0] as { desire?: Desire; found?: boolean } | undefined;
  const slot2 = inputs[2] as string | { formatted?: string } | undefined;

  // Extract desire and plan (plan is embedded in desire)
  const desire = slot0?.desire || (inputs.desire as Desire | undefined);
  const plan = desire?.plan || (inputs.plan as DesirePlan | undefined);

  // Get persona values from slot or named input
  let personaValues = '';
  if (typeof slot2 === 'string') {
    personaValues = slot2;
  } else if (slot2 && typeof slot2 === 'object' && 'formatted' in slot2) {
    personaValues = slot2.formatted || '';
  } else if (inputs.personaValues) {
    personaValues = inputs.personaValues as string;
  }

  const personaGoals = (inputs.personaGoals as string) || '';
  const temperature = (properties?.temperature as number) || 0.2;

  if (!desire || !plan) {
    return {
      alignmentScore: 0,
      concerns: ['Missing desire or plan'],
      approved: false,
      reasoning: `Cannot review without desire and plan. Got desire: ${!!desire}, plan: ${!!plan}`,
    };
  }

  const userPrompt = `## Plan to Review

**Desire**: ${desire.title}
**Description**: ${desire.description}
**Reason**: ${desire.reason}

**Plan Steps**:
${plan.steps.map(s => `${s.order}. ${s.action} (${s.skill || 'manual'})`).join('\n')}

**Operator Goal**: ${plan.operatorGoal}

## Persona Values
${personaValues || 'No values specified'}

## Persona Goals
${personaGoals || 'No goals specified'}

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

  const messages: RouterMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ];

  try {
    const response = await callLLM({
      role: 'persona',
      messages,
      options: {
        temperature,
        responseFormat: 'json',
      },
    });

    if (!response.content) {
      return {
        alignmentScore: 0,
        concerns: ['Empty LLM response'],
        approved: false,
        reasoning: 'Failed to get alignment review',
      };
    }

    const content = response.content.trim();
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        alignmentScore: 0,
        concerns: ['Invalid response format'],
        approved: false,
        reasoning: 'Could not parse alignment review',
      };
    }

    const parsed = JSON.parse(jsonMatch[0]) as AlignmentReviewOutput;

    return {
      alignmentScore: Math.max(0, Math.min(1, parsed.alignmentScore)),
      concerns: parsed.concerns || [],
      approved: parsed.approved,
      reasoning: parsed.reasoning,
    };
  } catch (error) {
    return {
      alignmentScore: 0,
      concerns: [`Review error: ${(error as Error).message}`],
      approved: false,
      reasoning: 'Alignment review failed due to error',
    };
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
    { name: 'personaValues', type: 'string', optional: true, description: 'Formatted persona values' },
    { name: 'personaGoals', type: 'string', optional: true, description: 'Formatted persona goals' },
  ],
  outputs: [
    { name: 'alignmentScore', type: 'number', description: 'Score from 0-1' },
    { name: 'concerns', type: 'array', description: 'List of alignment concerns' },
    { name: 'approved', type: 'boolean', description: 'Whether alignment check passed' },
    { name: 'reasoning', type: 'string', description: 'Explanation of verdict' },
  ],
  properties: {
    temperature: 0.2,
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
  },
  execute,
});

export default DesireAlignmentReviewerNode;
