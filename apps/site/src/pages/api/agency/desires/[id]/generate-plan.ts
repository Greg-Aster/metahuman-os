import type { APIRoute } from 'astro';
import { getAuthenticatedUser, audit } from '@metahuman/core';
import { getSecurityPolicy } from '@metahuman/core/security-policy';
import {
  loadDesire,
  saveDesire,
  saveDesireManifest,
  savePlanToFolder,
  addScratchpadEntryToFolder,
  generatePlanId,
  type Desire,
  type DesirePlan,
  type DesireRisk,
} from '@metahuman/core';
import { callLLM, type RouterMessage } from '@metahuman/core/model-router';
import type { TrustLevel } from '@metahuman/core/skills';

const LOG_PREFIX = '[API:agency/generate-plan]';

interface PlanGenerationOutput {
  steps: Array<{
    order?: number;
    action: string;
    skill?: string;
    inputs?: Record<string, unknown>;
    expectedOutcome?: string;
    risk?: string;
    requiresApproval?: boolean;
  }>;
  estimatedRisk: string;
  operatorGoal: string;
  requiredSkills?: string[];
}

const SYSTEM_PROMPT = `You are the Planning module of MetaHuman OS. Your job is to create concrete, executable plans for desires.

## Guidelines
- Create clear, actionable steps that an intelligent AI assistant (Big Brother/Claude) can execute
- Steps can be high-level - the operator is intelligent and will figure out specifics
- Break complex desires into 3-10 sequential steps
- Each step should have a clear action and expected outcome
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

/**
 * POST /api/agency/desires/:id/generate-plan
 * Generate a plan for a desire inline (without waiting for background agent)
 * Optionally accepts { critique: string } to revise an existing plan
 */
export const POST: APIRoute = async ({ params, cookies, request }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    if (!user) {
      console.log(`${LOG_PREFIX} ❌ Authentication required`);
      return new Response(
        JSON.stringify({ error: 'Authentication required to generate plans.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Require owner role
    const policy = getSecurityPolicy({ cookies });
    try {
      policy.requireOwner();
    } catch (error) {
      console.log(`${LOG_PREFIX} ❌ Owner role required`);
      return new Response(
        JSON.stringify({ error: 'Owner role required to generate plans.' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { id } = params;
    if (!id) {
      return new Response(
        JSON.stringify({ error: 'Desire ID is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Parse optional body for critique/revision
    let bodyRequest: { critique?: string } = {};
    try {
      bodyRequest = await request.json();
    } catch {
      // No body or invalid JSON is fine
    }

    console.log(`${LOG_PREFIX} 🧠 Generate plan requested for: ${id}`);
    const desire = await loadDesire(id, user.username);
    if (!desire) {
      console.log(`${LOG_PREFIX} ❌ Desire not found: ${id}`);
      return new Response(
        JSON.stringify({ error: 'Desire not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Use critique from body OR from desire.userCritique (stored by revise endpoint)
    const critique = bodyRequest?.critique || desire.userCritique;

    console.log(`${LOG_PREFIX} 📋 Desire: "${desire.title}" (status: ${desire.status})`);
    console.log(`${LOG_PREFIX}    Has existing plan: ${desire.plan ? 'yes' : 'no'}`);
    console.log(`${LOG_PREFIX}    Has userCritique: ${desire.userCritique ? 'yes' : 'no'}`);
    if (critique) {
      console.log(`${LOG_PREFIX}    Using critique: "${critique.substring(0, 50)}..."`);
    }

    // Build revision context if applicable
    const isRevision = !!(critique || desire.plan);
    const previousPlan = desire.plan;
    const planVersion = (desire.planHistory?.length || 0) + 1;

    let revisionContext = '';
    if (isRevision && previousPlan) {
      revisionContext = `
## REVISION REQUEST

This is a revision of a previous plan. The user has reviewed the plan and provided feedback.

### Previous Plan (Version ${previousPlan.version || planVersion - 1})
${previousPlan.steps.map((s, i) => `${i + 1}. ${s.action} (risk: ${s.risk})`).join('\n')}

Operator Goal: ${previousPlan.operatorGoal}
Estimated Risk: ${previousPlan.estimatedRisk}

### User Critique
${critique || 'No specific critique provided - please improve the plan.'}

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
## Task

Create an execution plan with 3-10 steps. Each step should be clear enough for an intelligent AI (Claude/Big Brother) to execute.

Requirements:
1. Clear, ordered steps describing WHAT to do
2. Expected outcome for each step
3. Risk assessment per step (none/low/medium/high/critical)
4. A single "operatorGoal" summarizing the overall objective
${isRevision ? '\nIMPORTANT: This is a revision. Address the user critique and improve upon the previous plan.' : ''}

CRITICAL: You MUST generate at least 1 step. Do not return empty steps array.

Output as JSON (no thinking, direct JSON output only):
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
}

/no_think`;

    const messages: RouterMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ];

    console.log(`${LOG_PREFIX} 🤖 Calling LLM for plan generation...`);

    const response = await callLLM({
      role: 'planner',  // Use planner role (qwen3-coder:30b) for better structured output
      messages,
      options: {
        temperature: 0.3,
        responseFormat: 'json',
      },
    });

    if (!response.content) {
      console.error(`${LOG_PREFIX} ❌ Empty LLM response`);
      return new Response(
        JSON.stringify({ error: 'Empty response from LLM' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Parse JSON response - strip thinking tags first (Qwen3/DeepSeek style)
    let content = response.content
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/<\/think>/gi, '')
      .trim();
    console.log(`${LOG_PREFIX} 📝 LLM response length: ${content.length}`);

    // Debug: log first 500 chars of response for troubleshooting
    if (content.length < 500) {
      console.log(`${LOG_PREFIX} 📝 Full response: ${content}`);
    } else {
      console.log(`${LOG_PREFIX} 📝 Response preview: ${content.substring(0, 500)}...`);
    }

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error(`${LOG_PREFIX} ❌ No JSON found in response`);
      console.error(`${LOG_PREFIX} ❌ Raw response was: ${content.substring(0, 300)}`);
      return new Response(
        JSON.stringify({ error: 'No valid JSON in LLM response. The model may not be following the JSON format instruction.' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    let parsed: PlanGenerationOutput;
    try {
      parsed = JSON.parse(jsonMatch[0]) as PlanGenerationOutput;
      console.log(`${LOG_PREFIX} ✅ Parsed ${parsed.steps?.length || 0} steps`);
    } catch (parseError) {
      console.error(`${LOG_PREFIX} ❌ JSON parse error:`, parseError);
      return new Response(
        JSON.stringify({ error: `JSON parse error: ${(parseError as Error).message}` }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Validate parsed output has steps
    if (!parsed.steps || !Array.isArray(parsed.steps) || parsed.steps.length === 0) {
      console.error(`${LOG_PREFIX} ❌ No steps in parsed output`);
      return new Response(
        JSON.stringify({ error: 'LLM response contained no plan steps' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
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
        expectedOutcome: step.expectedOutcome || 'Complete this step successfully',
        risk: (step.risk || 'medium') as DesireRisk,
        requiresApproval: step.requiresApproval || step.risk === 'medium' || step.risk === 'high',
      })),
      estimatedRisk: (parsed.estimatedRisk || 'medium') as DesireRisk,
      requiredSkills: parsed.requiredSkills || [],
      requiredTrustLevel: determineRequiredTrust(parsed.estimatedRisk),
      operatorGoal: parsed.operatorGoal,
      createdAt: new Date().toISOString(),
      basedOnCritique: isRevision ? critique : undefined,
    };

    console.log(`${LOG_PREFIX} 💾 Saving plan to desire...`);
    console.log(`${LOG_PREFIX}    Goal: ${plan.operatorGoal}`);
    console.log(`${LOG_PREFIX}    Steps: ${plan.steps.length}`);
    console.log(`${LOG_PREFIX}    Risk: ${plan.estimatedRisk}`);

    // Update desire with plan
    const now = new Date().toISOString();
    const updatedDesire: Desire = {
      ...desire,
      plan,
      planHistory: [...(desire.planHistory || []), ...(previousPlan ? [previousPlan] : [])],
      status: 'reviewing', // Move to reviewing after plan is generated
      updatedAt: now,
      // Clear the critique since it's been addressed by this new plan
      userCritique: undefined,
      critiqueAt: undefined,
    };

    // Save to flat-file storage
    await saveDesire(updatedDesire, user.username);

    // Also save to folder-based storage
    await saveDesireManifest(updatedDesire, user.username);
    await savePlanToFolder(id, plan, user.username);

    // Add scratchpad entry with raw LLM output for debugging/analysis
    await addScratchpadEntryToFolder(id, {
      timestamp: now,
      type: isRevision ? 'plan_revised' : 'plan_generated',
      description: isRevision
        ? `Plan revised (v${planVersion}): ${plan.operatorGoal}`
        : `Plan generated: ${plan.operatorGoal}`,
      actor: 'llm',
      data: {
        planId: plan.id,
        planVersion,
        stepCount: plan.steps.length,
        estimatedRisk: plan.estimatedRisk,
        operatorGoal: plan.operatorGoal,
        isRevision,
        critique: isRevision ? critique : undefined,
        // Include raw LLM output for debugging and analysis
        llmOutput: {
          model: response.model,
          modelId: response.modelId,
          provider: response.provider,
          rawResponse: response.content,
          parsedJson: jsonMatch[0],
          latencyMs: response.latencyMs,
          tokens: response.tokens,
        },
      },
    }, user.username);

    audit({
      category: 'agent',
      level: 'info',
      event: 'desire_plan_generated_inline',
      actor: user.username,
      details: {
        desireId: id,
        title: desire.title,
        planSteps: plan.steps.length,
        operatorGoal: plan.operatorGoal,
        estimatedRisk: plan.estimatedRisk,
        isRevision,
        planVersion,
      },
    });

    console.log(`${LOG_PREFIX} ✅ Plan generated and saved! "${desire.title}" now in reviewing`);

    return new Response(JSON.stringify({
      success: true,
      desire: updatedDesire,
      plan,
      message: `Plan generated with ${plan.steps.length} steps. Desire moved to reviewing.`,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error(`${LOG_PREFIX} ❌ Error:`, error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
