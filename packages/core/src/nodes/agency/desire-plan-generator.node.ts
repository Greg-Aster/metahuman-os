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
- Create clear, actionable steps that an intelligent AI assistant (Big Brother/Claude) can execute
- Steps can be high-level - the operator is intelligent and will figure out specifics
- Break complex desires into 3-10 sequential steps
- Each step should have a clear action and expected outcome
- You MAY reference available skills/tools if applicable, but you can also specify general actions
- For complex tasks, describe WHAT to do, not HOW specifically

## Execution Context
Plans will be executed by "Big Brother" - an intelligent Claude-based operator that can:
- Search the web and gather information
- Read and write files
- Execute code and shell commands
- Create and manage tasks
- Communicate with the user
- Think creatively to solve complex problems

## Risk Assessment
- none: Read-only, information gathering
- low: Reversible file operations, local changes
- medium: External communications, data modifications
- high: Irreversible actions, external system interactions
- critical: Financial, security, or privacy implications

IMPORTANT: Always generate at least 1 step. Never return empty steps. If the desire seems impossible, create steps to research how to accomplish it or gather the necessary resources.

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
  // Inputs come via slot positions from graph links:
  // slot 0: {desire, found} from desire_loader
  // slot 1: {catalog, toolCount, entries} from tool_catalog_builder
  // slot 2: {formatted, rules, ...} from policy_loader
  // slot 3: {memories, query} from semantic_search
  const slot0 = inputs[0] as { desire?: Desire; found?: boolean } | undefined;
  const slot1 = inputs[1] as { catalog?: string } | undefined;
  const slot2 = inputs[2] as { formatted?: string } | undefined;
  const slot3 = inputs[3] as { memories?: unknown[] } | undefined;

  const desire = slot0?.desire;
  const toolCatalog = slot1?.catalog || '';
  const decisionRules = slot2?.formatted || '';
  const relevantMemories = JSON.stringify(slot3?.memories || [], null, 2);
  const temperature = (properties?.temperature as number) || 0.3;

  if (!desire) {
    return {
      plan: null,
      success: false,
      error: 'No desire provided',
    };
  }

  // Check if this is a revision (has critique and/or previous plan)
  const isRevision = !!(desire.userCritique || desire.plan);
  const previousPlan = desire.plan;
  const userCritique = desire.userCritique;
  const planVersion = (desire.planHistory?.length || 0) + 1;

  // Build the revision context if applicable
  let revisionContext = '';
  if (isRevision && previousPlan) {
    revisionContext = `
## REVISION REQUEST

This is a revision of a previous plan. The user has reviewed the plan and provided feedback.

### Previous Plan (Version ${previousPlan.version || planVersion - 1})
${previousPlan.steps.map((s, i) => `${i + 1}. ${s.action} (skill: ${s.skill || 'none'}, risk: ${s.risk})`).join('\n')}

Operator Goal: ${previousPlan.operatorGoal}
Estimated Risk: ${previousPlan.estimatedRisk}

### User Critique
${userCritique || 'No specific critique provided - please improve the plan.'}

### Instructions
Please create a NEW plan that addresses the user's feedback. Do not simply repeat the previous plan.
Consider the critique carefully and make meaningful changes to address the concerns.
`;
  }

  const userPrompt = `## Desire to Plan

**Title**: ${desire.title}
**Description**: ${desire.description}
**Reason**: ${desire.reason || 'Not specified'}
**Source**: ${desire.source || 'user'}
**Risk Level**: ${desire.risk || 'medium'}
${revisionContext}
## Available Tools (Optional Reference)
${toolCatalog ? 'These tools are available but you can also use general actions:\n' + toolCatalog : 'Use general high-level actions - Big Brother will determine specific tools.'}

## Decision Rules
${decisionRules || 'No specific rules - use good judgment'}

## Relevant Context
${relevantMemories || 'No additional context'}

## Task

Create an execution plan with 3-10 steps. Each step should be clear enough for an intelligent AI (Claude/Big Brother) to execute.

Requirements:
1. Clear, ordered steps describing WHAT to do
2. Expected outcome for each step
3. Risk assessment per step (none/low/medium/high/critical)
4. A single "operatorGoal" summarizing the overall objective
${isRevision ? '\nIMPORTANT: This is a revision. Address the user critique and improve upon the previous plan.' : ''}

CRITICAL: You MUST generate at least 1 step. Do not return empty steps array.

Output as JSON:
{
  "steps": [
    {
      "order": 1,
      "action": "Clear description of what this step accomplishes",
      "skill": "optional_skill_name_or_general",
      "inputs": { "key": "value" },
      "expectedOutcome": "What should happen when this step completes",
      "risk": "low",
      "requiresApproval": false
    }
  ],
  "estimatedRisk": "low",
  "operatorGoal": "Single sentence describing what the operator should accomplish",
  "requiredSkills": []
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
    console.log('[plan-generator] Raw LLM response length:', content.length);
    console.log('[plan-generator] Raw LLM response (first 1000 chars):', content.substring(0, 1000));

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('[plan-generator] No JSON found in response');
      return {
        plan: null,
        success: false,
        error: 'No valid JSON in response',
      };
    }

    let parsed: PlanGenerationOutput;
    try {
      parsed = JSON.parse(jsonMatch[0]) as PlanGenerationOutput;
      console.log('[plan-generator] Parsed steps count:', parsed.steps?.length || 0);
      console.log('[plan-generator] Parsed operatorGoal:', parsed.operatorGoal);
      if (parsed.steps && parsed.steps.length > 0) {
        console.log('[plan-generator] First step:', JSON.stringify(parsed.steps[0]).substring(0, 200));
      }
    } catch (parseError) {
      console.error('[plan-generator] JSON parse error:', parseError);
      console.error('[plan-generator] Failed JSON:', jsonMatch[0].substring(0, 500));
      return {
        plan: null,
        success: false,
        error: `JSON parse error: ${(parseError as Error).message}`,
      };
    }

    // Validate parsed output has steps
    if (!parsed.steps || !Array.isArray(parsed.steps) || parsed.steps.length === 0) {
      console.error('[plan-generator] Parsed output has no steps:', JSON.stringify(parsed));
      return {
        plan: null,
        success: false,
        error: 'LLM response contained no plan steps',
      };
    }

    // Convert to DesirePlan
    const plan: DesirePlan = {
      id: generatePlanId(desire.id) + (planVersion > 1 ? `-v${planVersion}` : ''),
      version: planVersion,
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
      basedOnCritique: isRevision ? userCritique : undefined,
    };

    return {
      plan,
      success: true,
      isRevision,
      previousVersion: isRevision ? planVersion - 1 : undefined,
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
