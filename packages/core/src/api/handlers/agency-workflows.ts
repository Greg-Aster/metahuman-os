/**
 * Agency workflow API handlers.
 *
 * Owns the manual desire workflow routes that require model calls, execution,
 * verification, and SSE progress. Astro route files should only delegate here.
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse, streamResponse } from '../types.js';
import {
  addScratchpadEntryToFolder,
  generatePlanId,
  loadDesire,
  moveDesire,
  saveDesire,
  saveDesireManifest,
  savePlanToFolder,
  type Desire,
  type DesirePlan,
  type DesireRisk,
} from '../../agency/index.js';
import { audit } from '../../audit.js';
import { callLLM, type RouterMessage } from '../../model-router.js';
import type { TrustLevel } from '../../skills.js';
import {
  getQueueManager,
  submitDesireExecution,
  submitDesireOutcomeReview,
  type QueueEvent,
} from '../../queue/index.js';

const PLAN_LOG_PREFIX = '[API:agency/generate-plan]';
const PLAN_STREAM_LOG_PREFIX = '[API:agency/generate-plan-stream]';
const REVIEW_LOG_PREFIX = '[API:agency/review]';
const RUN_LOG_PREFIX = '[API:agency/run]';
const RUN_STREAM_LOG_PREFIX = '[API:agency/run-stream]';
const OUTCOME_LOG_PREFIX = '[API:agency/outcome-review]';
const OUTCOME_STREAM_LOG_PREFIX = '[API:agency/outcome-review-stream]';

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

interface AlignmentReviewOutput {
  alignmentScore: number;
  concerns: string[];
  approved: boolean;
  reasoning: string;
}

interface SafetyReviewOutput {
  safetyScore: number;
  risks: string[];
  mitigations: string[];
  approved: boolean;
  reasoning: string;
}

class WorkflowError extends Error {
  constructor(message: string, readonly status = 500) {
    super(message);
  }
}

function workflowErrorResponse(error: unknown): UnifiedResponse {
  if (error instanceof WorkflowError) {
    return { status: error.status, error: error.message };
  }
  return { status: 500, error: (error as Error).message };
}

function requireOwner(req: UnifiedRequest, action: string): UnifiedResponse | undefined {
  if (!req.user.isAuthenticated) {
    return { status: 401, error: `Authentication required to ${action}.` };
  }
  if (req.user.role !== 'owner') {
    return { status: 403, error: `Owner role required to ${action}.` };
  }
  return undefined;
}

function namedSse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function dataSse(event: {
  type: 'phase' | 'log' | 'result' | 'error' | 'done';
  phase?: string;
  message?: string;
  data?: unknown;
}): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

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

const PLAN_SYSTEM_PROMPT = `You are the Planning module of MetaHuman OS. Your job is to create concrete, executable plans for desires.

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

function buildPlanPrompt(desire: Desire, critique?: string): {
  messages: RouterMessage[];
  isRevision: boolean;
  previousPlan: DesirePlan | undefined;
  planVersion: number;
  userPrompt: string;
} {
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

  return {
    messages: [
      { role: 'system', content: PLAN_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    isRevision,
    previousPlan,
    planVersion,
    userPrompt,
  };
}

function extractJsonObject(content: string): string {
  const cleaned = content
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<\/think>/gi, '')
    .trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new WorkflowError('No valid JSON in LLM response. The model may not be following the JSON format instruction.', 500);
  }
  return jsonMatch[0];
}

async function saveGeneratedPlan(params: {
  desire: Desire;
  username: string;
  critique?: string;
  parsed: PlanGenerationOutput;
  rawResponse: {
    content: string;
    model?: string;
    modelId?: string;
    provider?: string;
    latencyMs?: number;
    tokens?: unknown;
  };
  parsedJson: string;
  isRevision: boolean;
  previousPlan?: DesirePlan;
  planVersion: number;
  streamed?: boolean;
}): Promise<{ desire: Desire; plan: DesirePlan }> {
  const { desire, username, critique, parsed, rawResponse, parsedJson, isRevision, previousPlan, planVersion, streamed } = params;

  if (!parsed.steps || !Array.isArray(parsed.steps) || parsed.steps.length === 0) {
    throw new WorkflowError('LLM response contained no plan steps', 500);
  }

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

  await saveDesire(updatedDesire, username);
  await saveDesireManifest(updatedDesire, username);
  await savePlanToFolder(desire.id, plan, username);

  await addScratchpadEntryToFolder(desire.id, {
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
        model: rawResponse.model,
        modelId: rawResponse.modelId,
        provider: rawResponse.provider,
        rawResponse: rawResponse.content,
        parsedJson,
        latencyMs: rawResponse.latencyMs,
        tokens: rawResponse.tokens,
      },
    },
  }, username);

  audit({
    category: 'agent',
    level: 'info',
    event: 'desire_plan_generated_inline',
    actor: username,
    details: {
      desireId: desire.id,
      title: desire.title,
      planSteps: plan.steps.length,
      operatorGoal: plan.operatorGoal,
      estimatedRisk: plan.estimatedRisk,
      isRevision,
      planVersion,
      ...(streamed ? { streamed: true } : {}),
    },
  });

  return { desire: updatedDesire, plan };
}

async function generatePlan(username: string, id: string, critiqueFromBody?: string) {
  const desire = await loadDesire(id, username);
  if (!desire) {
    throw new WorkflowError('Desire not found', 404);
  }

  const critique = critiqueFromBody || desire.userCritique;
  const prompt = buildPlanPrompt(desire, critique);
  const response = await callLLM({
    role: 'planner',
    messages: prompt.messages,
    options: {
      temperature: 0.3,
      responseFormat: 'json',
    },
  });

  if (!response.content) {
    throw new WorkflowError('Empty response from LLM', 500);
  }

  const parsedJson = extractJsonObject(response.content);
  let parsed: PlanGenerationOutput;
  try {
    parsed = JSON.parse(parsedJson) as PlanGenerationOutput;
  } catch (error) {
    throw new WorkflowError(`JSON parse error: ${(error as Error).message}`, 500);
  }

  return saveGeneratedPlan({
    desire,
    username,
    critique,
    parsed,
    rawResponse: response,
    parsedJson,
    isRevision: prompt.isRevision,
    previousPlan: prompt.previousPlan,
    planVersion: prompt.planVersion,
  });
}

export async function handleGenerateDesirePlan(req: UnifiedRequest): Promise<UnifiedResponse> {
  const auth = requireOwner(req, 'generate plans');
  if (auth) return auth;

  const id = req.params?.id;
  if (!id) return { status: 400, error: 'Desire ID is required' };

  try {
    console.log(`${PLAN_LOG_PREFIX} 🧠 Generate plan requested for: ${id}`);
    const { desire, plan } = await generatePlan(req.user.username, id, (req.body as { critique?: string } | undefined)?.critique);
    return successResponse({
      success: true,
      desire,
      plan,
      message: `Plan generated with ${plan.steps.length} steps. Desire moved to reviewing.`,
    });
  } catch (error) {
    console.error(`${PLAN_LOG_PREFIX} ❌ Error:`, error);
    return workflowErrorResponse(error);
  }
}

export async function handleGenerateDesirePlanStream(req: UnifiedRequest): Promise<UnifiedResponse> {
  const response = streamResponse(generatePlanStream(req));
  return {
    ...response,
    headers: {
      ...response.headers,
      'X-Accel-Buffering': 'no',
    },
  };
}

async function* generatePlanStream(req: UnifiedRequest): AsyncIterable<string> {
  const startTime = Date.now();
  try {
    yield namedSse('phase', { phase: 'authenticating', message: 'Checking authentication...' });
    const auth = requireOwner(req, 'generate plans');
    if (auth) {
      yield namedSse('error', { error: auth.error });
      return;
    }

    const id = req.params?.id;
    if (!id) {
      yield namedSse('error', { error: 'Desire ID is required' });
      return;
    }

    yield namedSse('started', {
      desireId: id,
      username: req.user.username,
      message: 'Plan generation started',
    });
    yield namedSse('phase', { phase: 'loading', message: 'Loading desire...' });

    const desire = await loadDesire(id, req.user.username);
    if (!desire) {
      yield namedSse('error', { error: 'Desire not found' });
      return;
    }

    const critique = (req.body as { critique?: string } | undefined)?.critique || desire.userCritique;
    yield namedSse('desire_loaded', {
      title: desire.title,
      description: desire.description,
      status: desire.status,
      hasPlan: !!desire.plan,
      hasCritique: !!critique,
    });

    yield namedSse('phase', { phase: 'building_prompt', message: 'Building LLM prompt...' });
    const prompt = buildPlanPrompt(desire, critique);
    yield namedSse('phase', { phase: 'llm_thinking', message: 'LLM is generating plan...' });
    yield namedSse('llm_started', {
      model: 'planner',
      isRevision: prompt.isRevision,
      planVersion: prompt.planVersion,
      promptLength: prompt.userPrompt.length,
    });

    console.log(`${PLAN_STREAM_LOG_PREFIX} 🤖 Calling LLM for plan generation...`);
    const response = await callLLM({
      role: 'planner',
      messages: prompt.messages,
      options: { temperature: 0.3, responseFormat: 'json' },
    });

    const llmDuration = Date.now() - startTime;
    if (!response.content) {
      yield namedSse('error', { error: 'Empty response from LLM' });
      return;
    }

    yield namedSse('llm_complete', {
      model: response.model,
      modelId: response.modelId,
      provider: response.provider,
      rawOutput: response.content,
      latencyMs: response.latencyMs,
      tokens: response.tokens,
      durationMs: llmDuration,
    });

    yield namedSse('phase', { phase: 'parsing', message: 'Parsing LLM output...' });
    let parsedJson: string;
    try {
      parsedJson = extractJsonObject(response.content);
    } catch {
      yield namedSse('error', {
        error: 'No valid JSON in LLM response',
        rawOutput: response.content.substring(0, 500),
      });
      return;
    }

    let parsed: PlanGenerationOutput;
    try {
      parsed = JSON.parse(parsedJson) as PlanGenerationOutput;
    } catch (error) {
      yield namedSse('error', {
        error: `JSON parse error: ${(error as Error).message}`,
        rawOutput: parsedJson.substring(0, 500),
      });
      return;
    }

    if (!parsed.steps || !Array.isArray(parsed.steps) || parsed.steps.length === 0) {
      yield namedSse('error', { error: 'LLM response contained no plan steps' });
      return;
    }

    yield namedSse('plan_parsed', {
      stepCount: parsed.steps.length,
      operatorGoal: parsed.operatorGoal,
      estimatedRisk: parsed.estimatedRisk,
    });

    yield namedSse('phase', { phase: 'saving', message: 'Saving plan...' });
    const { desire: updatedDesire, plan } = await saveGeneratedPlan({
      desire,
      username: req.user.username,
      critique,
      parsed,
      rawResponse: response,
      parsedJson,
      isRevision: prompt.isRevision,
      previousPlan: prompt.previousPlan,
      planVersion: prompt.planVersion,
      streamed: true,
    });

    yield namedSse('complete', {
      success: true,
      desire: updatedDesire,
      plan,
      message: `Plan generated with ${plan.steps.length} steps`,
      durationMs: Date.now() - startTime,
    });
  } catch (error) {
    console.error(`${PLAN_STREAM_LOG_PREFIX} ❌ Error:`, error);
    yield namedSse('error', { error: (error as Error).message });
  }
}

async function runAlignmentReview(desire: Desire): Promise<AlignmentReviewOutput> {
  const plan = desire.plan!;
  const systemPrompt = `You are the Alignment Review module of MetaHuman OS. Your job is to evaluate whether a planned action aligns with the persona's values, goals, and identity.

Be thoughtful and honest. If there are concerns, raise them. If the plan aligns well, say so.

Respond with valid JSON matching the schema.`;
  const userPrompt = `## Plan to Review

**Desire**: ${desire.title}
**Description**: ${desire.description}
**Reason**: ${desire.reason}

**Plan Steps**:
${plan.steps.map(s => `${s.order}. ${s.action} (${s.skill || 'manual'})`).join('\n')}

**Operator Goal**: ${plan.operatorGoal}

## Review Questions

1. Does this plan seem reasonable for the stated goal?
2. Are there any ethical concerns with this plan?
3. Would a reasonable person want this outcome?
4. Are there any value conflicts or concerns?
5. Is the stated reason authentic?

## Output

Respond with JSON:
{
  "alignmentScore": 0.0-1.0,
  "concerns": ["concern 1", "concern 2"],
  "approved": true/false,
  "reasoning": "Brief explanation of the verdict"
}`;

  try {
    const response = await callLLM({
      role: 'persona',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      options: { temperature: 0.2, responseFormat: 'json' },
    });
    if (!response.content) return { alignmentScore: 0, concerns: ['Empty response'], approved: false, reasoning: 'Failed to get response' };
    const parsed = JSON.parse(extractJsonObject(response.content)) as AlignmentReviewOutput;
    return {
      alignmentScore: Math.max(0, Math.min(1, parsed.alignmentScore)),
      concerns: parsed.concerns || [],
      approved: parsed.approved,
      reasoning: parsed.reasoning,
    };
  } catch (error) {
    return {
      alignmentScore: 0,
      concerns: [`Error: ${(error as Error).message}`],
      approved: false,
      reasoning: 'Review failed',
    };
  }
}

async function runSafetyReview(desire: Desire): Promise<SafetyReviewOutput> {
  const plan = desire.plan!;
  const systemPrompt = `You are the Safety Review module of MetaHuman OS. Your job is to evaluate plans for safety, risk, and policy compliance.

## Hard Rules (Never Violate)
- Never send messages without explicit approval
- Never make financial transactions (except pre-approved <$10)
- Never delete important data without explicit approval
- Always maintain complete audit logs
- Never share private data externally

Be conservative with safety. When in doubt, flag concerns.

Respond with valid JSON matching the schema.`;
  const userPrompt = `## Plan to Review for Safety

**Desire**: ${desire.title}
**Description**: ${desire.description}
**Estimated Risk**: ${plan.estimatedRisk}

**Plan Steps**:
${plan.steps.map(s => `${s.order}. [${s.risk}] ${s.action} (skill: ${s.skill || 'none'})`).join('\n')}

**Operator Goal**: ${plan.operatorGoal}

## Safety Review Questions

1. Does any step violate the hard rules?
2. What is the worst-case outcome if this goes wrong?
3. Is each step reversible? If not, what's the impact?
4. Is user data or privacy at risk?
5. Could this action have unintended consequences?

## Output

Respond with JSON:
{
  "safetyScore": 0.0-1.0,
  "risks": ["risk 1", "risk 2"],
  "mitigations": ["mitigation 1", "mitigation 2"],
  "approved": true/false,
  "reasoning": "Brief explanation of safety verdict"
}`;

  try {
    const response = await callLLM({
      role: 'orchestrator',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      options: { temperature: 0.1, responseFormat: 'json' },
    });
    if (!response.content) return { safetyScore: 0, risks: ['Empty response'], mitigations: [], approved: false, reasoning: 'Failed to get response' };
    const parsed = JSON.parse(extractJsonObject(response.content)) as SafetyReviewOutput;
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
      risks: [`Error: ${(error as Error).message}`],
      mitigations: [],
      approved: false,
      reasoning: 'Review failed',
    };
  }
}

export async function handleReviewDesirePlan(req: UnifiedRequest): Promise<UnifiedResponse> {
  const auth = requireOwner(req, 'review desires');
  if (auth) return auth;

  const id = req.params?.id;
  if (!id) return { status: 400, error: 'Desire ID is required' };

  try {
    console.log(`${REVIEW_LOG_PREFIX} 🔍 Review requested for: ${id}`);
    const desire = await loadDesire(id, req.user.username);
    if (!desire) return { status: 404, error: 'Desire not found' };
    if (!desire.plan || !desire.plan.steps || desire.plan.steps.length === 0) {
      return { status: 400, error: 'Cannot review desire without a plan. Generate a plan first.' };
    }

    const alignmentResult = await runAlignmentReview(desire);
    const safetyResult = await runSafetyReview(desire);
    const alignmentThreshold = 0.7;
    const safetyThreshold = 0.8;
    const autoApproveThreshold = 0.9;
    const passedAlignment = alignmentResult.alignmentScore >= alignmentThreshold;
    const passedSafety = safetyResult.safetyScore >= safetyThreshold;
    const autoApprove = alignmentResult.alignmentScore >= autoApproveThreshold &&
      safetyResult.safetyScore >= autoApproveThreshold;

    let verdict: 'approve' | 'reject' | 'revise';
    let newStatus: Desire['status'];
    if (!passedAlignment || !passedSafety) {
      verdict = 'reject';
      newStatus = 'reviewing';
    } else if (autoApprove) {
      verdict = 'approve';
      newStatus = 'approved';
    } else {
      verdict = 'revise';
      newStatus = 'reviewing';
    }

    const now = new Date().toISOString();
    const oldStatus = desire.status;
    const updatedDesire: Desire = {
      ...desire,
      review: {
        id: `review-${desire.id}-${Date.now()}`,
        verdict,
        alignmentScore: alignmentResult.alignmentScore,
        reasoning: `Alignment: ${alignmentResult.reasoning}\n\nSafety: ${safetyResult.reasoning}`,
        concerns: [...alignmentResult.concerns, ...safetyResult.risks],
        suggestions: safetyResult.mitigations,
        riskAssessment: `Safety Score: ${safetyResult.safetyScore.toFixed(2)}. Risks: ${safetyResult.risks.join(', ') || 'None identified'}`,
        reviewedAt: now,
      },
      status: newStatus,
      updatedAt: now,
    };

    if (oldStatus !== newStatus) {
      await moveDesire(updatedDesire, oldStatus, newStatus, req.user.username);
    } else {
      await saveDesire(updatedDesire, req.user.username);
    }

    audit({
      category: 'agent',
      level: 'info',
      event: 'desire_reviewed_inline',
      actor: req.user.username,
      details: {
        desireId: id,
        title: desire.title,
        verdict,
        alignmentScore: alignmentResult.alignmentScore,
        safetyScore: safetyResult.safetyScore,
        autoApproved: autoApprove,
      },
    });

    return successResponse({
      success: true,
      desire: updatedDesire,
      review: {
        verdict,
        alignment: alignmentResult,
        safety: safetyResult,
        autoApproved: autoApprove,
      },
      message: verdict === 'approve'
        ? 'Plan auto-approved! High alignment and safety scores.'
        : verdict === 'reject'
          ? 'Plan needs revision. See concerns below.'
          : 'Plan reviewed. Waiting for your approval.',
    });
  } catch (error) {
    console.error(`${REVIEW_LOG_PREFIX} ❌ Error:`, error);
    return workflowErrorResponse(error);
  }
}

async function loadExecutableDesire(username: string, id: string): Promise<Desire> {
  const desire = await loadDesire(id, username);
  if (!desire) throw new WorkflowError('Desire not found', 404);
  if (desire.status !== 'approved') {
    throw new WorkflowError(`Cannot run desire in '${desire.status}' status. Must be 'approved'.`, 400);
  }
  if (!desire.plan || !desire.plan.steps || desire.plan.steps.length === 0) {
    throw new WorkflowError('Cannot run desire without a plan. Generate a plan first.', 400);
  }
  return desire;
}

export async function handleRunDesire(req: UnifiedRequest): Promise<UnifiedResponse> {
  const auth = requireOwner(req, 'execute desires');
  if (auth) return auth;
  const id = req.params?.id;
  if (!id) return { status: 400, error: 'Desire ID is required' };

  try {
    console.log(`${RUN_LOG_PREFIX} 🚀 Run requested for: ${id}`);
    const desire = await loadExecutableDesire(req.user.username, id);
    const task = await submitDesireExecution({
      username: req.user.username,
      desireId: id,
      source: 'user',
      metadata: { producer: 'agency-run-api' },
    });
    return successResponse({
      success: true,
      executionQueued: true,
      taskId: task.id,
      desire,
      message: `Execution queued for "${desire.title}".`,
    }, 202);
  } catch (error) {
    console.error(`${RUN_LOG_PREFIX} ❌ Error:`, error);
    const response = workflowErrorResponse(error);
    if (error instanceof WorkflowError && error.message === 'Cannot run desire without a plan. Generate a plan first.') {
      response.data = { error: error.message, suggestion: 'Use the "Generate Plan" button first.' };
      response.error = undefined;
    }
    return response;
  }
}

export async function handleRunDesireStream(req: UnifiedRequest): Promise<UnifiedResponse> {
  return streamResponse(runDesireStream(req));
}

async function* runDesireStream(req: UnifiedRequest): AsyncIterable<string> {
  const startTime = Date.now();
  try {
    yield namedSse('phase', { phase: 'authenticating', message: 'Checking authentication...' });
    const auth = requireOwner(req, 'execute desires');
    if (auth) {
      yield namedSse('error', { error: auth.error });
      return;
    }
    const id = req.params?.id;
    if (!id) {
      yield namedSse('error', { error: 'Desire ID is required' });
      return;
    }

    console.log(`${RUN_STREAM_LOG_PREFIX} 🚀 Stream run requested for: ${id}`);
    yield namedSse('phase', { phase: 'loading', message: 'Loading desire...' });
    const desire = await loadDesire(id, req.user.username);
    if (!desire) {
      yield namedSse('error', { error: 'Desire not found' });
      return;
    }
    if (desire.status !== 'approved') {
      yield namedSse('error', { error: `Cannot run desire in '${desire.status}' status. Must be 'approved'.` });
      return;
    }
    if (!desire.plan || !desire.plan.steps || desire.plan.steps.length === 0) {
      yield namedSse('error', { error: 'Cannot run desire without a plan. Generate a plan first.' });
      return;
    }

    yield namedSse('desire_loaded', {
      desireId: id,
      title: desire.title,
      totalSteps: desire.plan.steps.length,
      goal: desire.plan.operatorGoal,
    });

    const task = await submitDesireExecution({
      username: req.user.username,
      desireId: id,
      source: 'user',
      metadata: { producer: 'agency-run-stream' },
    });
    yield namedSse('queued', { taskId: task.id, state: task.state, message: 'Execution admitted to the Work Coordinator.' });

    const manager = getQueueManager();
    let outputIndex = 0;
    let wake: (() => void) | undefined;
    const listener = (event: QueueEvent) => {
      if (event.taskId !== task.id) return;
      wake?.();
      wake = undefined;
    };

    manager.addEventListener(listener);
    try {
      let current = manager.getTask(task.id);
      if (!current) throw new Error('Queued desire execution is not visible to the coordinator owner');

      while (!['completed', 'failed', 'cancelled', 'expired'].includes(current.state)) {
        const output = manager.getOutput(task.id);
        for (const chunk of output.slice(outputIndex)) yield chunk;
        outputIndex = output.length;
        if (req.signal?.aborted) {
          manager.cancel(task.id, 'Desire execution stream closed by requester');
          return;
        }
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 1_000);
          wake = () => {
            clearTimeout(timer);
            resolve();
          };
        });
        current = manager.getTask(task.id);
        if (!current) throw new Error('Queued desire execution disappeared before completion');
      }
      const finalOutput = manager.getOutput(task.id);
      for (const chunk of finalOutput.slice(outputIndex)) yield chunk;

      if (current.state !== 'completed') {
        throw new Error(current.error?.message || `Desire execution ${current.state}`);
      }
    } finally {
      wake?.();
      manager.removeEventListener(listener);
    }

    const finalDesire = await loadDesire(id, req.user.username);
    if (!finalDesire) throw new Error('Executed desire could not be reloaded');
    const execution = finalDesire.execution;
    const executionSucceeded = execution?.status === 'completed';
    yield namedSse('phase', { phase: 'finalizing', message: 'Execution attempt durably recorded.' });
    yield namedSse('complete', {
      success: executionSucceeded,
      taskId: task.id,
      desire: finalDesire,
      execution,
      message: executionSucceeded
        ? `Execution completed for "${finalDesire.title}".`
        : `Execution failed for "${finalDesire.title}": ${execution?.error || 'unknown error'}.`,
      awaitingReview: finalDesire.status === 'awaiting_review',
      durationMs: Date.now() - startTime,
    });
  } catch (error) {
    console.error(`${RUN_STREAM_LOG_PREFIX} ❌ Error:`, error);
    yield namedSse('error', { error: (error as Error).message });
  }
}

async function loadReviewableDesire(username: string, id: string): Promise<Desire> {
  const desire = await loadDesire(id, username);
  if (!desire) throw new WorkflowError('Desire not found', 404);
  if (!['awaiting_review', 'completed', 'failed'].includes(desire.status)) {
    throw new WorkflowError(`Cannot review outcome for desire in '${desire.status}' status. Must be 'awaiting_review', 'completed', or 'failed'.`, 400);
  }
  if (!desire.execution) {
    throw new WorkflowError('Cannot review outcome without execution data.', 400);
  }
  if (desire.outcomeReview) {
    throw new WorkflowError('This desire already has a durable outcome review.', 409);
  }
  return desire;
}

export async function handleOutcomeReview(req: UnifiedRequest): Promise<UnifiedResponse> {
  const auth = requireOwner(req, 'review outcomes');
  if (auth) return auth;
  const id = req.params?.id;
  if (!id) return { status: 400, error: 'Desire ID is required' };

  try {
    const desire = await loadReviewableDesire(req.user.username, id);
    const task = await submitDesireOutcomeReview({
      username: req.user.username,
      desireId: id,
      source: 'user',
      metadata: { producer: 'agency-outcome-review-api' },
    });
    return successResponse({
      success: true,
      reviewQueued: true,
      taskId: task.id,
      desire,
      message: `Outcome review queued for "${desire.title}".`,
    }, 202);
  } catch (error) {
    console.error(`${OUTCOME_LOG_PREFIX} Error:`, error);
    return workflowErrorResponse(error);
  }
}

export async function handleOutcomeReviewStream(req: UnifiedRequest): Promise<UnifiedResponse> {
  return streamResponse(outcomeReviewStream(req));
}

async function* outcomeReviewStream(req: UnifiedRequest): AsyncIterable<string> {
  try {
    const auth = requireOwner(req, 'review outcomes');
    if (auth) {
      yield dataSse({ type: 'error', message: auth.error });
      return;
    }
    const id = req.params?.id;
    if (!id) {
      yield dataSse({ type: 'error', message: 'Desire ID is required' });
      return;
    }

    yield dataSse({ type: 'phase', phase: 'Loading desire...' });
    const desire = await loadReviewableDesire(req.user.username, id);
    yield dataSse({ type: 'log', message: `Found: "${desire.title}" (status: ${desire.status})` });
    const task = await submitDesireOutcomeReview({
      username: req.user.username,
      desireId: id,
      source: 'user',
      metadata: { producer: 'agency-outcome-review-stream' },
    });
    yield dataSse({ type: 'phase', phase: 'Review admitted to Work Coordinator...' });
    yield dataSse({ type: 'log', message: `Queued work item ${task.id} (${task.state})` });

    const manager = getQueueManager();
    let wake: (() => void) | undefined;
    const listener = (event: QueueEvent) => {
      if (event.taskId !== task.id) return;
      wake?.();
      wake = undefined;
    };
    manager.addEventListener(listener);
    try {
      let current = manager.getTask(task.id);
      if (!current) throw new Error('Queued outcome review is not visible to the coordinator owner');
      while (!['completed', 'failed', 'cancelled', 'expired'].includes(current.state)) {
        if (req.signal?.aborted) {
          manager.cancel(task.id, 'Outcome review stream closed by requester');
          return;
        }
        await new Promise<void>(resolve => {
          const timer = setTimeout(resolve, 1_000);
          wake = () => {
            clearTimeout(timer);
            resolve();
          };
        });
        current = manager.getTask(task.id);
        if (!current) throw new Error('Queued outcome review disappeared before completion');
      }
      if (current.state !== 'completed') {
        throw new Error(current.error?.message || `Outcome review ${current.state}`);
      }
    } finally {
      wake?.();
      manager.removeEventListener(listener);
    }

    const reviewed = await loadDesire(id, req.user.username);
    if (!reviewed?.outcomeReview) throw new Error('Outcome review completed without a durable review');
    yield dataSse({ type: 'result', data: {
      success: true,
      taskId: task.id,
      desire: reviewed,
      outcomeReview: reviewed.outcomeReview,
      message: `Outcome review completed for "${reviewed.title}".`,
    } });
    yield dataSse({ type: 'done' });
  } catch (error) {
    console.error(`${OUTCOME_STREAM_LOG_PREFIX} Stream error:`, error);
    yield dataSse({ type: 'error', message: (error as Error).message });
  }
}
