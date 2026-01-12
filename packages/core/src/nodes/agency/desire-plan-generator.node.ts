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
import type {
  Desire,
  DesirePlan,
  DesireRisk,
  PlanGenerationOutput,
  DesireGoalType,
  DesireMilestone,
  DesireExecution,
} from '../../agency/types.js';
import type { TrustLevel } from '../../skills.js';
import { generatePlanId, initializeGoalProgress } from '../../agency/types.js';
import { callLLM, type RouterMessage } from '../../model-router.js';
import { loadExecutionAttempts } from '../../agency/storage.js';

const SYSTEM_PROMPT = `You are the Planning module of MetaHuman OS. Your job is to create concrete, executable plans for desires.

## Guidelines
- Create clear, actionable steps that an intelligent AI assistant (Big Brother/Claude) can execute
- Steps can be high-level - the operator is intelligent and will figure out specifics
- Break complex desires into 3-10 sequential steps
- Each step should have a clear action and expected outcome
- You MAY reference available skills/tools if applicable, but you can also specify general actions
- For complex tasks, describe WHAT to do, not HOW specifically

## Goal Types
Determine the appropriate goal type for each desire:
- **one_time**: Single achievement, then done (e.g., "buy a car", "submit tax return")
- **recurring**: Ongoing without end, cycles forever (e.g., "stay healthy", "maintain relationships")
- **long_running**: Takes weeks/months with a clear end (e.g., "hike the PCT", "write a novel", "learn Spanish")

## Completion Criteria
For EVERY desire, specify what "DONE" actually means:
- Be specific and verifiable: "Reach Monument 78 at Canadian border" NOT "complete the hike"
- For one_time: The single condition that marks completion
- For recurring: The condition that marks one cycle as complete (will repeat)
- For long_running: The ultimate end goal that must be achieved

## Milestones (for long_running only)
Break long-running goals into 3-10 major milestones:
- Each milestone should be achievable in 1-4 weeks
- Milestones are MAJOR phases, not individual steps
- Steps are for the CURRENT milestone only
- Example for "Hike the PCT":
  - Milestone 1: Research & Planning
  - Milestone 2: Preparation (gear, permits, training)
  - Milestone 3: Southern California section
  - Milestone 4: Sierra Nevada section
  - etc.

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

const execute: NodeExecutor = async (inputs, context, properties) => {
  // Inputs come via NAMED handles from graph links (not positional indices!)
  // The graph executor maps edge.targetHandle -> inputs[handle]
  //
  // In desire-planner.json:
  //   inputs.slot_0 = {desire, found} from desire_loader (edge e-1-slot_0-5-slot_0)
  //   inputs.slot_1 = {catalog, toolCount, entries} from tool_catalog_builder (edge e-2-slot_0-5-slot_1)
  //   inputs.slot_2 = {formatted, rules, ...} from policy_loader (edge e-3-slot_0-5-slot_2)
  //   inputs.slot_3 = {memories, query} from semantic_search (edge e-4-memories-5-slot_3)
  //
  // IMPORTANT: Graph executor uses named properties, not array indices!

  // Try named properties first (slot_X), then fall back to positional for legacy compatibility
  const loaderOutput = (inputs.slot_0 || inputs[0]) as { desire?: Desire; found?: boolean } | undefined;
  const catalogOutput = (inputs.slot_1 || inputs[1]) as { catalog?: string } | undefined;
  const policyOutput = (inputs.slot_2 || inputs[2]) as { formatted?: string } | undefined;
  const searchOutput = (inputs.slot_3 || inputs[3]) as { memories?: unknown[] } | undefined;
  const username = context.userId || context.username;

  const desire = loaderOutput?.desire;
  const toolCatalog = catalogOutput?.catalog || '';
  const decisionRules = policyOutput?.formatted || '';
  const relevantMemories = JSON.stringify(searchOutput?.memories || [], null, 2);
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
  const outcomeReview = desire.outcomeReview;
  const planVersion = (desire.planHistory?.length || 0) + 1;
  const failCount = desire.metrics?.executionFailCount || 0;

  // Build the revision context if applicable
  let revisionContext = '';
  if (isRevision && previousPlan) {
    // Determine if this is a retry after failure
    const isRetryAfterFailure = failCount > 0 || (outcomeReview && outcomeReview.verdict === 'retry');

    revisionContext = `
## REVISION REQUEST${isRetryAfterFailure ? ' (Retry After Failure)' : ''}
${isRetryAfterFailure ? `
⚠️ **THIS IS ATTEMPT #${failCount + 1}** - Previous execution(s) failed.
${outcomeReview?.failureCategory ? `
**Failure Category**: ${outcomeReview.failureCategory}
${outcomeReview.failureCategory === 'plan_error' ? '→ The previous approach/strategy was wrong. Need a DIFFERENT plan.' : ''}
${outcomeReview.failureCategory === 'system_error' ? '→ There was a system/code error. Check if the steps are technically feasible.' : ''}
${outcomeReview.failureCategory === 'external_error' ? '→ External dependency failed. Consider alternatives or fallbacks.' : ''}
${outcomeReview.failureCategory === 'timeout' ? '→ Took too long. Consider simpler/faster approaches.' : ''}
${outcomeReview.failureCategory === 'partial' ? '→ Partially succeeded. Build on what worked.' : ''}` : ''}
` : ''}
This is a revision of a previous plan.${isRetryAfterFailure ? ' The previous execution failed and feedback has been provided.' : ' The user has reviewed the plan and provided feedback.'}

### Previous Plan (Version ${previousPlan.version || planVersion - 1})
${previousPlan.steps.map((s, i) => `${i + 1}. ${s.action} (skill: ${s.skill || 'none'}, risk: ${s.risk})`).join('\n')}

Operator Goal: ${previousPlan.operatorGoal}
Estimated Risk: ${previousPlan.estimatedRisk}
${outcomeReview?.successScore !== undefined ? `\n**Previous Success Score**: ${(outcomeReview.successScore * 100).toFixed(0)}%` : ''}

### ${isRetryAfterFailure ? 'Failure Analysis & Lessons Learned' : 'User Critique'}
${userCritique || 'No specific critique provided - please improve the plan.'}
${outcomeReview?.reasoning ? `\n**Outcome Review**: ${outcomeReview.reasoning}` : ''}
${outcomeReview?.nextAttemptSuggestions?.length ? `\n**Suggestions**:\n${outcomeReview.nextAttemptSuggestions.map(s => `- ${s}`).join('\n')}` : ''}

### Instructions
Please create a NEW plan that addresses the feedback. Do not simply repeat the previous plan.
${isRetryAfterFailure ? `
**CRITICAL**: This plan MUST be different from the previous one. Simply repeating failed steps will fail again.
Consider:
1. Alternative approaches or tools
2. Breaking complex steps into smaller ones
3. Adding validation/verification steps
4. Graceful error handling` : 'Consider the critique carefully and make meaningful changes to address the concerns.'}
`;
  }

  // Load previous execution results for context (especially for long-running goals)
  let executionContext = '';
  try {
    const executions = await loadExecutionAttempts(desire.id, username);
    if (executions.length > 0) {
      // Get the most recent successful execution for context
      const successfulExecution = executions.find(e => e.status === 'completed');
      if (successfulExecution && successfulExecution.stepResults) {
        const accomplishments = successfulExecution.stepResults
          .filter(r => r.success && r.result?.response)
          .map((r, i) => {
            const response = r.result.response || '';
            // Truncate to first 1500 chars to avoid bloating the prompt
            const truncated = response.length > 1500 ? response.slice(0, 1500) + '...' : response;
            return `### Step ${i + 1} Results\n${truncated}`;
          });

        if (accomplishments.length > 0) {
          executionContext = `
## Previous Accomplishments
The following work has already been completed for this desire. Build upon these findings:

${accomplishments.join('\n\n')}

IMPORTANT: Use this context to inform the next phase. Do not repeat research that was already done.
`;
        }
      }
    }
  } catch (error) {
    console.warn('[plan-generator] Failed to load execution attempts:', error);
  }

  // Build milestone context for long-running goals
  let milestoneContext = '';
  if (desire.goalType === 'long_running' && desire.milestones && desire.milestones.length > 0) {
    const currentMilestone = desire.goalProgress?.currentMilestone || 0;
    const completedMilestones = desire.milestones.filter(m => m.status === 'completed');
    const currentMilestoneData = desire.milestones[currentMilestone];

    milestoneContext = `
## Long-Running Goal Progress
This is a long-running goal with ${desire.milestones.length} milestones.
- Completed: ${completedMilestones.length}/${desire.milestones.length} (${desire.goalProgress?.progressPercent || 0}%)
- Completion Criteria: ${desire.completionCriteria || 'Not specified'}

### Completed Milestones
${completedMilestones.length > 0 ? completedMilestones.map(m => `✅ ${m.order}. ${m.title}: ${m.description || 'No description'}`).join('\n') : 'None yet'}

### Current Milestone (#${currentMilestone + 1})
${currentMilestoneData ? `**${currentMilestoneData.title}**: ${currentMilestoneData.description || 'No description'}` : 'None active'}

IMPORTANT: Generate a plan for the CURRENT MILESTONE only, not the entire goal.
`;
  }

  const userPrompt = `## Desire to Plan

**Title**: ${desire.title}
**Description**: ${desire.description}
**Reason**: ${desire.reason || 'Not specified'}
**Source**: ${desire.source || 'user'}
**Risk Level**: ${desire.risk || 'medium'}
${revisionContext}${milestoneContext}${executionContext}
## Available Tools (Optional Reference)
${toolCatalog ? 'These tools are available but you can also use general actions:\n' + toolCatalog : 'Use general high-level actions - Big Brother will determine specific tools.'}

## Decision Rules
${decisionRules || 'No specific rules - use good judgment'}

## Relevant Context
${relevantMemories || 'No additional context'}

## Task

Create an execution plan with 3-10 steps. Each step should be clear enough for an intelligent AI (Claude/Big Brother) to execute.

Requirements:
1. Determine the goal type (one_time, recurring, or long_running)
2. Define specific, verifiable completion criteria
3. For long_running: Create 3-10 milestones AND steps for the FIRST milestone only
4. Clear, ordered steps describing WHAT to do
5. Expected outcome for each step
6. Risk assessment per step (none/low/medium/high/critical)
7. A single "operatorGoal" summarizing the overall objective
${isRevision ? '\nIMPORTANT: This is a revision. Address the user critique and improve upon the previous plan.' : ''}

CRITICAL: You MUST generate at least 1 step. Do not return empty steps array.

Output as JSON:
{
  "goalType": "one_time | recurring | long_running",
  "completionCriteria": "Specific, verifiable condition that means this desire is TRULY satisfied",
  "milestones": [
    {
      "order": 1,
      "title": "Milestone title (3-5 words)",
      "description": "What this milestone achieves"
    }
  ],
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
}

NOTE: For one_time and recurring desires, milestones can be omitted or empty.
For long_running desires, milestones are REQUIRED and steps should only cover the FIRST milestone.`;

  const messages: RouterMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ];

  try {
    const response = await callLLM({
      role: 'orchestrator',
      messages,
      userId: username,
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

    // Extract goal type and completion criteria from LLM response
    const parsedAny = parsed as unknown as Record<string, unknown>;
    const goalType = (parsedAny.goalType as DesireGoalType) || 'one_time';
    const completionCriteria = (parsedAny.completionCriteria as string) || undefined;

    // Parse milestones for long-running goals
    let milestones: DesireMilestone[] | undefined;
    if (goalType === 'long_running' && Array.isArray(parsedAny.milestones)) {
      milestones = (parsedAny.milestones as Array<{ order?: number; title: string; description?: string }>)
        .map((m, idx) => ({
          id: `milestone-${desire.id}-${idx + 1}`,
          order: m.order || idx + 1,
          title: m.title,
          description: m.description,
          status: idx === 0 ? 'in_progress' : 'pending' as const,
        }));
      console.log(`[plan-generator] Created ${milestones.length} milestones for long-running goal`);
    }

    // Initialize goal progress for long-running goals
    const goalProgress = milestones && milestones.length > 0
      ? initializeGoalProgress(milestones.length)
      : undefined;

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

    console.log(`[plan-generator] Goal type: ${goalType}, Completion criteria: ${completionCriteria?.substring(0, 50)}...`);

    return {
      plan,
      success: true,
      isRevision,
      previousVersion: isRevision ? planVersion - 1 : undefined,
      // New fields for long-running goal support
      goalType,
      completionCriteria,
      milestones,
      goalProgress,
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
    { name: 'goalType', type: 'string', optional: true, description: 'Goal type: one_time, recurring, or long_running' },
    { name: 'completionCriteria', type: 'string', optional: true, description: 'Verifiable completion condition' },
    { name: 'milestones', type: 'array', optional: true, description: 'Milestones for long_running goals' },
    { name: 'goalProgress', type: 'object', optional: true, description: 'Progress tracking for long_running goals' },
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
