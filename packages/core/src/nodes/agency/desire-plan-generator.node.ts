/**
 * Desire Plan Generator Node
 *
 * Uses LLM to generate an execution plan for a desire.
 *
 * Inputs:
 *   - desire: Desire object
 *   - toolCatalog: string - Available tools/skills
 *   - decisionRules: string - Policy constraints
 *   - relevantMemories: string - Context from memory search
 *
 * Outputs:
 *   - plan: DesirePlan object
 *   - success: boolean
 *   - error?: string
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import type { Desire, DesirePlan, DesireRisk, PlanGenerationOutput } from '../../agency/types.js';
import type { TrustLevel } from '../../skills.js';
import { generatePlanId } from '../../agency/types.js';
import { callLLM, type RouterMessage } from '../../model-router.js';

const SYSTEM_PROMPT = `You are the Planning module of MetaHuman OS. Your job is to create concrete, executable plans for desires.

## Guidelines
- Only use available skills from the tool catalog
- Respect the current trust level constraints
- Follow decision rules strictly
- Minimize risk where possible
- Break complex desires into atomic, sequential steps
- Each step should use exactly one skill

## Risk Assessment
- none: Read-only, information gathering
- low: Reversible file operations, local changes
- medium: External communications, data modifications
- high: Irreversible actions, external system interactions
- critical: Financial, security, or privacy implications

Respond with valid JSON matching the plan schema.`;

function determineRequiredTrust(risk: string): TrustLevel {
  switch (risk) {
    case 'none':
    case 'low':
      return 'suggest';
    case 'medium':
      return 'supervised_auto';
    case 'high':
    case 'critical':
      return 'bounded_auto';
    default:
      return 'supervised_auto';
  }
}

const execute: NodeExecutor = async (inputs, _context, properties) => {
  const desire = inputs.desire as Desire | undefined;
  const toolCatalog = (inputs.toolCatalog as string) || '';
  const decisionRules = (inputs.decisionRules as string) || '';
  const relevantMemories = (inputs.relevantMemories as string) || '';
  const temperature = (properties?.temperature as number) || 0.3;

  if (!desire) {
    return {
      plan: null,
      success: false,
      error: 'No desire provided',
    };
  }

  const userPrompt = `## Desire to Plan

**Title**: ${desire.title}
**Description**: ${desire.description}
**Reason**: ${desire.reason}
**Source**: ${desire.source}
**Risk Level**: ${desire.risk}

## Available Skills
${toolCatalog || 'No skill catalog available - use general steps'}

## Decision Rules
${decisionRules || 'No specific rules'}

## Relevant Context
${relevantMemories || 'No additional context'}

## Task

Create an execution plan with:
1. Clear, ordered steps (1-10 steps max)
2. Specific skill to use for each step (from the catalog)
3. Required inputs for each skill
4. Expected outcome per step
5. Risk assessment per step
6. A single "operatorGoal" string summarizing what to accomplish

Output as JSON:
{
  "steps": [
    {
      "order": 1,
      "action": "Description of what this step does",
      "skill": "skill_name",
      "inputs": { "key": "value" },
      "expectedOutcome": "What should happen",
      "risk": "low",
      "requiresApproval": false
    }
  ],
  "estimatedRisk": "low",
  "operatorGoal": "Single sentence goal for the operator",
  "requiredSkills": ["skill1", "skill2"]
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
        plan: null,
        success: false,
        error: 'Empty LLM response',
      };
    }

    // Parse JSON response
    const content = response.content.trim();
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        plan: null,
        success: false,
        error: 'No valid JSON in response',
      };
    }

    const parsed = JSON.parse(jsonMatch[0]) as PlanGenerationOutput;

    // Convert to DesirePlan
    const plan: DesirePlan = {
      id: generatePlanId(desire.id),
      steps: parsed.steps.map((step, idx) => ({
        order: step.order || idx + 1,
        action: step.action,
        skill: step.skill,
        inputs: step.inputs,
        expectedOutcome: step.expectedOutcome,
        risk: step.risk as DesireRisk,
        requiresApproval: step.requiresApproval || step.risk === 'medium' || step.risk === 'high',
      })),
      estimatedRisk: parsed.estimatedRisk as DesireRisk,
      requiredSkills: parsed.requiredSkills || [],
      requiredTrustLevel: determineRequiredTrust(parsed.estimatedRisk),
      operatorGoal: parsed.operatorGoal,
      createdAt: new Date().toISOString(),
    };

    return {
      plan,
      success: true,
    };
  } catch (error) {
    return {
      plan: null,
      success: false,
      error: `Plan generation failed: ${(error as Error).message}`,
    };
  }
};

export const DesirePlanGeneratorNode: NodeDefinition = defineNode({
  id: 'desire_plan_generator',
  name: 'Generate Desire Plan',
  category: 'agency',
  description: 'Uses LLM to generate an execution plan for a desire',
  inputs: [
    { name: 'desire', type: 'object', description: 'Desire to create plan for' },
    { name: 'toolCatalog', type: 'string', optional: true, description: 'Available skills/tools' },
    { name: 'decisionRules', type: 'string', optional: true, description: 'Policy constraints' },
    { name: 'relevantMemories', type: 'string', optional: true, description: 'Context from memory' },
  ],
  outputs: [
    { name: 'plan', type: 'object', description: 'Generated DesirePlan' },
    { name: 'success', type: 'boolean', description: 'Whether plan was generated' },
    { name: 'error', type: 'string', optional: true, description: 'Error message if failed' },
  ],
  properties: {
    temperature: 0.3,
  },
  propertySchemas: {
    temperature: {
      type: 'slider',
      default: 0.3,
      min: 0,
      max: 1,
      step: 0.1,
      label: 'Temperature',
      description: 'LLM temperature for plan generation',
    },
  },
  execute,
});

export default DesirePlanGeneratorNode;
