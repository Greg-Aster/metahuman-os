/**
 * Desire Safety Reviewer Node
 *
 * Uses LLM to review a plan for safety concerns and risk assessment.
 *
 * Inputs:
 *   - desire: Desire object
 *   - plan: DesirePlan object
 *   - decisionRules: string - Hard rules and constraints
 *
 * Outputs:
 *   - safetyScore: number (0-1)
 *   - risks: string[]
 *   - mitigations: string[]
 *   - approved: boolean
 *   - reasoning: string
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import type { Desire, DesirePlan, SafetyReviewOutput } from '../../agency/types.js';
import { callLLM, type RouterMessage } from '../../model-router.js';

const SYSTEM_PROMPT = `You are the Safety Review module of MetaHuman OS. Your job is to evaluate plans for safety, risk, and policy compliance.

## Hard Rules (Never Violate)
- Never send messages without explicit approval
- Never make financial transactions (except pre-approved <$10)
- Never delete important data without explicit approval
- Always maintain complete audit logs
- Never share private data externally

## Risk Assessment Criteria
- Is the action reversible?
- What is the worst-case outcome?
- Are there unintended consequences?
- Does it violate any hard rules?
- Is user data protected?

Be conservative with safety. When in doubt, flag concerns.

Respond with valid JSON matching the schema.`;

const execute: NodeExecutor = async (inputs, _context, properties) => {
  // Inputs come via slot positions from graph links:
  // slot 0: {desire, found} from desire_loader
  // slot 2: formatted decision rules string from policy_loader
  const slot0 = inputs[0] as { desire?: Desire; found?: boolean } | undefined;
  const slot2 = inputs[2] as string | { formatted?: string } | undefined;

  // Extract desire and plan (plan is embedded in desire)
  const desire = slot0?.desire || (inputs.desire as Desire | undefined);
  const plan = desire?.plan || (inputs.plan as DesirePlan | undefined);

  // Get decision rules from slot or named input
  let decisionRules = '';
  if (typeof slot2 === 'string') {
    decisionRules = slot2;
  } else if (slot2 && typeof slot2 === 'object' && 'formatted' in slot2) {
    decisionRules = slot2.formatted || '';
  } else if (inputs.decisionRules) {
    decisionRules = inputs.decisionRules as string;
  }

  const temperature = (properties?.temperature as number) || 0.1;

  if (!desire || !plan) {
    return {
      safetyScore: 0,
      risks: ['Missing desire or plan'],
      mitigations: [],
      approved: false,
      reasoning: `Cannot review safety without desire and plan. Got desire: ${!!desire}, plan: ${!!plan}`,
    };
  }

  const userPrompt = `## Plan to Review for Safety

**Desire**: ${desire.title}
**Description**: ${desire.description}
**Estimated Risk**: ${plan.estimatedRisk}

**Plan Steps**:
${plan.steps.map(s => `${s.order}. [${s.risk}] ${s.action} (skill: ${s.skill || 'none'})`).join('\n')}

**Operator Goal**: ${plan.operatorGoal}
**Required Skills**: ${plan.requiredSkills.join(', ') || 'None specified'}

## Decision Rules
${decisionRules || 'Standard safety rules apply'}

## Safety Review Questions

1. Does any step violate the hard rules?
2. What is the worst-case outcome if this goes wrong?
3. Is each step reversible? If not, what's the impact?
4. Are there safer alternatives to achieve the same goal?
5. Is user data or privacy at risk?
6. Could this action have unintended consequences?

## Output

Respond with JSON:
{
  "safetyScore": 0.0-1.0,
  "risks": ["risk 1", "risk 2"],
  "mitigations": ["mitigation 1", "mitigation 2"],
  "approved": true/false,
  "reasoning": "Brief explanation of safety verdict"
}`;

  const messages: RouterMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ];

  try {
    const response = await callLLM({
      role: 'orchestrator',
      messages,
      options: {
        temperature,
        responseFormat: 'json',
      },
    });

    if (!response.content) {
      return {
        safetyScore: 0,
        risks: ['Empty LLM response'],
        mitigations: [],
        approved: false,
        reasoning: 'Failed to get safety review',
      };
    }

    const content = response.content.trim();
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        safetyScore: 0,
        risks: ['Invalid response format'],
        mitigations: [],
        approved: false,
        reasoning: 'Could not parse safety review',
      };
    }

    const parsed = JSON.parse(jsonMatch[0]) as SafetyReviewOutput;

    return {
      safetyScore: Math.max(0, Math.min(1, parsed.safetyScore)),
      risks: parsed.risks || [],
      mitigations: parsed.mitigations || [],
      approved: parsed.approved,
      reasoning: parsed.reasoning,
    };
  } catch (error) {
    return {
      safetyScore: 0,
      risks: [`Review error: ${(error as Error).message}`],
      mitigations: [],
      approved: false,
      reasoning: 'Safety review failed due to error',
    };
  }
};

export const DesireSafetyReviewerNode: NodeDefinition = defineNode({
  id: 'desire_safety_reviewer',
  name: 'Safety Review',
  category: 'agency',
  description: 'Reviews a plan for safety concerns and risk assessment',
  inputs: [
    { name: 'desire', type: 'object', description: 'Desire being reviewed' },
    { name: 'plan', type: 'object', description: 'Plan to review' },
    { name: 'decisionRules', type: 'string', optional: true, description: 'Hard rules and constraints' },
  ],
  outputs: [
    { name: 'safetyScore', type: 'number', description: 'Score from 0-1' },
    { name: 'risks', type: 'array', description: 'Identified risks' },
    { name: 'mitigations', type: 'array', description: 'Suggested mitigations' },
    { name: 'approved', type: 'boolean', description: 'Whether safety check passed' },
    { name: 'reasoning', type: 'string', description: 'Explanation of verdict' },
  ],
  properties: {
    temperature: 0.1,
  },
  propertySchemas: {
    temperature: {
      type: 'slider',
      default: 0.1,
      min: 0,
      max: 1,
      step: 0.1,
      label: 'Temperature',
      description: 'LLM temperature for safety review (lower = more conservative)',
    },
  },
  execute,
});

export default DesireSafetyReviewerNode;
