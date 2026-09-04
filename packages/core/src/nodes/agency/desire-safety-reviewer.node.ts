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
import { callLLM, normalizeModelRole, type RouterMessage } from '../../model-router.js';
import { renderPromptTemplate } from '../prompt-template.js';

const SYSTEM_PROMPT = `You are the Safety Review module of MetaHuman OS. Your job is to evaluate plans for safety, risk, and policy compliance.

## Risk Assessment Criteria
- Is the action reversible?
- What is the worst-case outcome?
- Are there unintended consequences?
- Does it violate any supplied decision rule or hard rule?
- Is user data protected?

The decision rules supplied with the request are authoritative. Do not invent,
weaken, or replace them. Be conservative with safety. When in doubt, flag concerns.

Respond with valid JSON matching the schema.`;

const DEFAULT_USER_PROMPT_TEMPLATE = `## Plan to Review for Safety

**Desire**: {{title}}
**Description**: {{description}}
**Estimated Risk**: {{estimatedRisk}}

**Plan Steps**:
{{planSteps}}

**Operator Goal**: {{operatorGoal}}
**Required Skills**: {{requiredSkills}}

## Decision Rules
{{decisionRules}}

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

const execute: NodeExecutor = async (inputs, context, properties) => {
  const desire = inputs.desire as Desire | undefined;
  const plan = inputs.plan as DesirePlan | undefined;
  const decisionRules = typeof inputs.decisionRules === 'string' ? inputs.decisionRules.trim() : '';
  const userId = typeof context.userId === 'string' ? context.userId.trim() : '';

  const temperature = (properties?.temperature as number) ?? 0.1;
  const role = normalizeModelRole(properties?.role, 'orchestrator');
  const systemPrompt = properties?.systemPrompt ?? SYSTEM_PROMPT;
  const userPromptTemplate = properties?.userPromptTemplate ?? DEFAULT_USER_PROMPT_TEMPLATE;

  if (!desire || !plan) {
    throw new Error('Safety Review requires a desire and validated plan');
  }
  if (!decisionRules) throw new Error('Safety Review requires loaded decision rules');
  if (!userId) throw new Error('Safety Review requires authenticated account identity');

  const userPrompt = renderPromptTemplate(userPromptTemplate, {
    title: desire.title,
    description: desire.description,
    estimatedRisk: plan.estimatedRisk,
    planSteps: plan.steps.map(s => `${s.order}. [${s.risk}] ${s.action} (skill: ${s.skill || 'none'})`).join('\n'),
    operatorGoal: plan.operatorGoal,
    requiredSkills: plan.requiredSkills.join(', ') || 'None specified',
    decisionRules: decisionRules || 'Standard safety rules apply',
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
      throw new Error('Safety Review received an empty model response');
    }

    const content = response.content.trim();
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Safety Review response did not contain a JSON object');
    }

    const parsed = JSON.parse(jsonMatch[0]) as SafetyReviewOutput;
    if (!Number.isFinite(parsed.safetyScore)
        || !Array.isArray(parsed.risks)
        || parsed.risks.some(risk => typeof risk !== 'string')
        || !Array.isArray(parsed.mitigations)
        || parsed.mitigations.some(mitigation => typeof mitigation !== 'string')
        || typeof parsed.approved !== 'boolean'
        || typeof parsed.reasoning !== 'string'
        || !parsed.reasoning.trim()) {
      throw new Error('Safety Review response is missing required typed fields');
    }
    const review = {
      safetyScore: Math.max(0, Math.min(1, parsed.safetyScore)),
      risks: parsed.risks,
      mitigations: parsed.mitigations,
      approved: parsed.approved,
      reasoning: parsed.reasoning.trim(),
    };
    return { ...review, review };
  } catch (error) {
    throw new Error(`Safety Review failed: ${(error as Error).message}`, { cause: error });
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
    { name: 'decisionRules', type: 'string', description: 'Canonical loaded decision rules and constraints' },
  ],
  outputs: [
    { name: 'safetyScore', type: 'number', description: 'Score from 0-1' },
    { name: 'risks', type: 'array', description: 'Identified risks' },
    { name: 'mitigations', type: 'array', description: 'Suggested mitigations' },
    { name: 'approved', type: 'boolean', description: 'Whether safety check passed' },
    { name: 'reasoning', type: 'string', description: 'Explanation of verdict' },
    { name: 'review', type: 'object', description: 'Typed aggregate safety review' },
  ],
  properties: {
    temperature: 0.1,
    role: 'orchestrator',
    systemPrompt: SYSTEM_PROMPT,
    userPromptTemplate: DEFAULT_USER_PROMPT_TEMPLATE,
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
    role: {
      type: 'string',
      default: 'orchestrator',
      label: 'LLM Role',
    },
    systemPrompt: {
      type: 'text_multiline',
      default: SYSTEM_PROMPT,
      label: 'System Prompt',
      rows: 18,
    },
    userPromptTemplate: {
      type: 'text_multiline',
      default: DEFAULT_USER_PROMPT_TEMPLATE,
      label: 'User Prompt Template',
      description: 'Template variables include {{title}}, {{description}}, {{planSteps}}, {{decisionRules}}, {{desire}}, {{plan}}.',
      rows: 24,
    },
  },
  execute,
});

export default DesireSafetyReviewerNode;
