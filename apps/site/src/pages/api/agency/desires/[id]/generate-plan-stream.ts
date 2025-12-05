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

const LOG_PREFIX = '[API:agency/generate-plan-stream]';

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
 * POST /api/agency/desires/:id/generate-plan-stream
 * Generate a plan for a desire with SSE streaming for real-time feedback
 * Streams progress events including LLM thinking output
 */
export const POST: APIRoute = async ({ params, cookies, request }) => {
  const encoder = new TextEncoder();

  // Helper to send SSE events
  const createSender = (controller: ReadableStreamDefaultController<Uint8Array>) => {
    return (event: string, data: any) => {
      const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      controller.enqueue(encoder.encode(payload));
    };
  };

  const stream = new ReadableStream({
    async start(controller) {
      const send = createSender(controller);
      const startTime = Date.now();

      try {
        // Phase 1: Authentication
        send('phase', { phase: 'authenticating', message: 'Checking authentication...' });

        const user = getAuthenticatedUser(cookies);
        if (!user) {
          send('error', { error: 'Authentication required to generate plans.' });
          controller.close();
          return;
        }

        // Check owner role
        const policy = getSecurityPolicy({ cookies });
        try {
          policy.requireOwner();
        } catch (error) {
          send('error', { error: 'Owner role required to generate plans.' });
          controller.close();
          return;
        }

        const { id } = params;
        if (!id) {
          send('error', { error: 'Desire ID is required' });
          controller.close();
          return;
        }

        send('started', {
          desireId: id,
          username: user.username,
          message: 'Plan generation started',
        });

        // Phase 2: Load desire
        send('phase', { phase: 'loading', message: 'Loading desire...' });

        // Parse optional body for critique/revision
        let bodyRequest: { critique?: string } = {};
        try {
          const text = await request.text();
          if (text) {
            bodyRequest = JSON.parse(text);
          }
        } catch {
          // No body or invalid JSON is fine
        }

        const desire = await loadDesire(id, user.username);
        if (!desire) {
          send('error', { error: 'Desire not found' });
          controller.close();
          return;
        }

        // Use critique from body OR from desire.userCritique
        const critique = bodyRequest?.critique || desire.userCritique;

        send('desire_loaded', {
          title: desire.title,
          description: desire.description,
          status: desire.status,
          hasPlan: !!desire.plan,
          hasCritique: !!critique,
        });

        // Phase 3: Build prompt
        send('phase', { phase: 'building_prompt', message: 'Building LLM prompt...' });

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

        // Phase 4: Call LLM
        send('phase', { phase: 'llm_thinking', message: 'LLM is generating plan...' });
        send('llm_started', {
          model: 'planner',
          isRevision,
          planVersion,
          promptLength: userPrompt.length,
        });

        console.log(`${LOG_PREFIX} 🤖 Calling LLM for plan generation...`);

        const response = await callLLM({
          role: 'planner',
          messages,
          options: {
            temperature: 0.3,
            responseFormat: 'json',
          },
        });

        const llmDuration = Date.now() - startTime;

        if (!response.content) {
          send('error', { error: 'Empty response from LLM' });
          controller.close();
          return;
        }

        // Send raw LLM output
        send('llm_complete', {
          model: response.model,
          modelId: response.modelId,
          provider: response.provider,
          rawOutput: response.content,
          latencyMs: response.latencyMs,
          tokens: response.tokens,
          durationMs: llmDuration,
        });

        // Phase 5: Parse response
        send('phase', { phase: 'parsing', message: 'Parsing LLM output...' });

        // Strip thinking tags
        let content = response.content
          .replace(/<think>[\s\S]*?<\/think>/gi, '')
          .replace(/<\/think>/gi, '')
          .trim();

        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          send('error', {
            error: 'No valid JSON in LLM response',
            rawOutput: content.substring(0, 500),
          });
          controller.close();
          return;
        }

        let parsed: PlanGenerationOutput;
        try {
          parsed = JSON.parse(jsonMatch[0]) as PlanGenerationOutput;
        } catch (parseError) {
          send('error', {
            error: `JSON parse error: ${(parseError as Error).message}`,
            rawOutput: jsonMatch[0].substring(0, 500),
          });
          controller.close();
          return;
        }

        if (!parsed.steps || !Array.isArray(parsed.steps) || parsed.steps.length === 0) {
          send('error', { error: 'LLM response contained no plan steps' });
          controller.close();
          return;
        }

        send('plan_parsed', {
          stepCount: parsed.steps.length,
          operatorGoal: parsed.operatorGoal,
          estimatedRisk: parsed.estimatedRisk,
        });

        // Phase 6: Build and save plan
        send('phase', { phase: 'saving', message: 'Saving plan...' });

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

        const now = new Date().toISOString();
        const updatedDesire: Desire = {
          ...desire,
          plan,
          planHistory: [...(desire.planHistory || []), ...(previousPlan ? [previousPlan] : [])],
          status: 'reviewing',
          updatedAt: now,
          userCritique: undefined,
          critiqueAt: undefined,
        };

        // Save to storage
        await saveDesire(updatedDesire, user.username);
        await saveDesireManifest(updatedDesire, user.username);
        await savePlanToFolder(id, plan, user.username);

        // Add scratchpad entry with raw LLM output
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
            streamed: true,
          },
        });

        // Phase 7: Complete
        const totalDuration = Date.now() - startTime;
        send('complete', {
          success: true,
          desire: updatedDesire,
          plan,
          message: `Plan generated with ${plan.steps.length} steps`,
          durationMs: totalDuration,
        });

        controller.close();

      } catch (error) {
        console.error(`${LOG_PREFIX} ❌ Error:`, error);
        send('error', { error: (error as Error).message });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
};
