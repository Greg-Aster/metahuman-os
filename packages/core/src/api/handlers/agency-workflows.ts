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
  executeDesireViaGraph,
  generatePlanId,
  loadDesire,
  moveDesire,
  saveDesire,
  saveDesireManifest,
  savePlanToFolder,
  type Desire,
  type DesireExecutionProgress,
  type DesireOutcomeReview,
  type DesirePlan,
  type DesireRisk,
  type OutcomeVerdict,
} from '../../agency/index.js';
import { audit } from '../../audit.js';
import { captureEvent } from '../../memory.js';
import { callLLM, type RouterMessage } from '../../model-router.js';
import { queueTTS } from '../../nodes/output/tts.node.js';
import type { TrustLevel } from '../../skills.js';
import {
  ensureBackendsInitialized,
  escalate,
  getActiveBackend,
  isEscalationReady,
} from '../../escalation-backend.js';

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

interface OutcomeReviewOutput {
  verdict: OutcomeVerdict;
  reasoning: string;
  successScore: number;
  lessonsLearned: string[];
  nextAttemptSuggestions?: string[];
  adjustedStrength?: number;
  notifyUser: boolean;
  userMessage?: string;
}

interface VerificationResult {
  verified: boolean;
  evidence: string[];
  errors: string[];
  operatorResponse?: unknown;
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
  type: 'phase' | 'progress' | 'log' | 'result' | 'error' | 'done';
  phase?: string;
  message?: string;
  data?: unknown;
}): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function createStringQueue() {
  const values: string[] = [];
  let resolver: (() => void) | undefined;

  return {
    push(value: string) {
      values.push(value);
      resolver?.();
      resolver = undefined;
    },
    shift() {
      return values.shift();
    },
    async wait() {
      if (values.length > 0) return;
      await new Promise<void>((resolve) => {
        resolver = resolve;
      });
    },
    wake() {
      resolver?.();
      resolver = undefined;
    },
  };
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

async function runDesire(username: string, id: string, onProgress?: (progress: DesireExecutionProgress) => void, streamed = false) {
  const desire = await loadDesire(id, username);
  if (!desire) throw new WorkflowError('Desire not found', 404);
  if (!['approved', 'executing'].includes(desire.status)) {
    throw new WorkflowError(`Cannot run desire in '${desire.status}' status. Must be 'approved' or 'executing'.`, 400);
  }
  if (!desire.plan || !desire.plan.steps || desire.plan.steps.length === 0) {
    throw new WorkflowError('Cannot run desire without a plan. Generate a plan first.', 400);
  }

  const startTime = Date.now();
  const now = new Date().toISOString();
  let executingDesire: Desire = desire;
  if (desire.status === 'approved') {
    executingDesire = {
      ...desire,
      status: 'executing',
      updatedAt: now,
      execution: {
        startedAt: now,
        status: 'in_progress',
        stepsCompleted: 0,
        stepsTotal: desire.plan?.steps?.length || 1,
      },
    };
    await moveDesire(executingDesire, 'approved', 'executing', username);
  }

  const graphResult = await executeDesireViaGraph(executingDesire, username, onProgress);
  const execution = graphResult.execution;

  audit({
    category: 'agent',
    level: graphResult.success ? 'info' : 'warn',
    event: 'desire_executed',
    actor: username,
    details: {
      desireId: id,
      title: desire.title,
      executionStatus: execution?.status || 'failed',
      stepsCompleted: execution?.stepsCompleted || 0,
      totalSteps: desire.plan?.steps.length || 0,
      error: graphResult.error,
      triggeredBy: streamed ? 'api-stream' : 'api',
      ...(streamed ? { durationMs: Date.now() - startTime } : {}),
    },
  });

  const nowFinal = new Date().toISOString();
  const newStatus: Desire['status'] = 'awaiting_review';
  const finalDesire: Desire = {
    ...executingDesire,
    status: newStatus,
    currentStage: 'outcome_review',
    execution: execution || {
      startedAt: now,
      status: 'failed',
      error: graphResult.error || 'Execution failed',
    },
    updatedAt: nowFinal,
    ...(desire.metrics && {
      metrics: {
        ...desire.metrics,
        executionAttemptCount: desire.metrics.executionAttemptCount + 1,
        lastActivityAt: nowFinal,
      },
    }),
  };

  await moveDesire(finalDesire, 'executing', newStatus, username);
  await addScratchpadEntryToFolder(id, {
    timestamp: nowFinal,
    type: 'execution_completed',
    description: `Execution ${execution?.status || 'failed'}: ${execution?.stepsCompleted || 0}/${desire.plan?.steps.length || 0} steps completed`,
    actor: 'user',
    data: {
      executionStatus: execution?.status,
      stepsCompleted: execution?.stepsCompleted,
      totalSteps: desire.plan?.steps.length || 0,
      error: graphResult.error,
      newStatus,
      ...(streamed ? { durationMs: Date.now() - startTime } : {}),
    },
  }, username);

  const message = graphResult.success
    ? `✅ Execution complete! "${desire.title}" - ${execution?.stepsCompleted}/${desire.plan?.steps.length || 0} steps completed.${streamed ? '' : ' Status: awaiting_review'}`
    : `⚠️ Execution had issues: "${desire.title}" - ${graphResult.error || 'Unknown error'}.${streamed ? '' : ' Status: awaiting_review'}`;

  return { graphResult, desire, finalDesire, execution, message, durationMs: Date.now() - startTime };
}

export async function handleRunDesire(req: UnifiedRequest): Promise<UnifiedResponse> {
  const auth = requireOwner(req, 'execute desires');
  if (auth) return auth;
  const id = req.params?.id;
  if (!id) return { status: 400, error: 'Desire ID is required' };

  try {
    console.log(`${RUN_LOG_PREFIX} 🚀 Run requested for: ${id}`);
    const result = await runDesire(req.user.username, id);
    return successResponse({
      success: result.graphResult.success,
      desire: result.finalDesire,
      execution: result.execution,
      message: result.message,
      awaitingReview: true,
    });
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
    if (!['approved', 'executing'].includes(desire.status)) {
      yield namedSse('error', { error: `Cannot run desire in '${desire.status}' status. Must be 'approved' or 'executing'.` });
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

    const progressEvents = createStringQueue();
    const onProgress = (progress: DesireExecutionProgress) => {
      progressEvents.push(namedSse('progress', {
        type: progress.type,
        stepNumber: progress.stepNumber,
        totalSteps: progress.totalSteps,
        action: progress.action,
        message: progress.message,
        timestamp: progress.timestamp,
        data: progress.data,
      }));
    };

    if (desire.status === 'approved') {
      yield namedSse('phase', { phase: 'preparing', message: 'Moving to executing status...' });
    }
    yield namedSse('phase', { phase: 'executing', message: 'Starting execution...' });
    let executionDone = false;
    let executionError: unknown;
    let result: Awaited<ReturnType<typeof runDesire>> | undefined;
    const executionPromise = runDesire(req.user.username, id, onProgress, true)
      .then((value) => {
        result = value;
      })
      .catch((error) => {
        executionError = error;
      })
      .finally(() => {
        executionDone = true;
        progressEvents.wake();
      });

    while (!executionDone) {
      const event = progressEvents.shift();
      if (event) {
        yield event;
      } else {
        await progressEvents.wait();
      }
    }
    await executionPromise;
    for (;;) {
      const event = progressEvents.shift();
      if (!event) break;
      yield event;
    }
    if (executionError) throw executionError;
    if (!result) throw new Error('Execution did not return a result');

    yield namedSse('phase', { phase: 'finalizing', message: 'Updating desire status...' });
    yield namedSse('complete', {
      success: result.graphResult.success,
      desire: result.finalDesire,
      execution: result.execution,
      message: result.message,
      awaitingReview: true,
      durationMs: Date.now() - startTime,
    });
  } catch (error) {
    console.error(`${RUN_STREAM_LOG_PREFIX} ❌ Error:`, error);
    yield namedSse('error', { error: (error as Error).message });
  }
}

function buildVerificationPrompt(desire: Desire): string {
  const plan = desire.plan;
  const operatorGoal = plan?.operatorGoal || desire.description;
  const goalLower = operatorGoal.toLowerCase();

  if (goalLower.includes('file') || goalLower.includes('write') || goalLower.includes('create')) {
    const filePaths: string[] = [];
    plan?.steps?.forEach(step => {
      if (step.inputs?.path) filePaths.push(step.inputs.path as string);
      if (step.inputs?.file_path) filePaths.push(step.inputs.file_path as string);
      const pathMatch = step.action.match(/["']([^"']+\.[a-z]+)["']/i);
      if (pathMatch) filePaths.push(pathMatch[1]);
    });

    return filePaths.length > 0
      ? `VERIFICATION TASK: Check if these files exist and have content: ${filePaths.join(', ')}. Read each file to verify it exists and has appropriate content.`
      : `VERIFICATION TASK: The goal was "${operatorGoal}". Check the filesystem to see if any relevant files were created. List the directory contents and read any new files.`;
  }

  if (goalLower.includes('task')) {
    return `VERIFICATION TASK: Check if any tasks were created or updated related to "${operatorGoal}". List current tasks and check for relevant entries.`;
  }

  return `VERIFICATION TASK: The desire "${desire.title}" claims to be completed. The goal was: "${operatorGoal}". Investigate whether the outcome actually occurred. Check files, tasks, or other artifacts that should exist. Report your findings.`;
}

async function verifyOutcomeWithOperator(desire: Desire, username: string): Promise<VerificationResult> {
  const plan = desire.plan;
  const evidence: string[] = [];
  const errors: string[] = [];
  const operatorGoal = plan?.operatorGoal || desire.description;

  await ensureBackendsInitialized();
  const backend = getActiveBackend(username);
  if (!backend) {
    errors.push('No escalation backend configured. Enable one in Settings.');
    return { verified: false, evidence, errors };
  }

  if (!isEscalationReady(username)) {
    errors.push(`Backend ${backend.name} is not ready. Start it first.`);
    return { verified: false, evidence, errors };
  }

  try {
    const prompt = `You are verifying whether a task was actually completed for MetaHuman OS.

## Desire Being Verified
**Title**: ${desire.title}
**Description**: ${desire.description}
**Original Goal**: ${operatorGoal}
**Execution Status**: ${desire.execution?.status || 'unknown'}
**Steps Claimed Completed**: ${desire.execution?.stepsCompleted || 0} / ${plan?.steps?.length || 0}

## Verification Task
${buildVerificationPrompt(desire)}

## Instructions
1. Use your tools (Read, Bash, Glob, etc.) to check if the outcome actually occurred
2. Look for concrete evidence (files exist, content is correct, tasks were created)
3. Be thorough - don't trust self-reported success
4. Report EXACTLY what you found - exists/doesn't exist, content summary

Please verify now and report your findings.`;

    audit({
      level: 'info',
      category: 'action',
      event: 'big_brother_verification_started',
      actor: 'outcome-review',
      details: { desireId: desire.id, title: desire.title, backend: backend.id },
    });

    const result = await escalate(prompt, { timeout: 90000, username });
    if (!result.success) {
      errors.push(`Verification failed: ${result.error}`);
      return { verified: false, evidence, errors };
    }

    const response = result.output;
    audit({
      level: 'info',
      category: 'action',
      event: 'big_brother_verification_completed',
      actor: 'outcome-review',
      details: { desireId: desire.id, responseLength: response.length, backend: backend.id },
    });

    const responseLower = response.toLowerCase();
    const hasPositiveIndicators = responseLower.includes('exists') ||
      responseLower.includes('found') ||
      responseLower.includes('confirmed') ||
      responseLower.includes('successfully') ||
      responseLower.includes('content:') ||
      responseLower.includes('verified');
    const hasNegativeIndicators = responseLower.includes('not found') ||
      responseLower.includes('does not exist') ||
      responseLower.includes('no such file') ||
      responseLower.includes('failed') ||
      responseLower.includes('error:') ||
      responseLower.includes('could not');

    evidence.push(`${backend.name} verification: ${response.substring(0, 500)}${response.length > 500 ? '...' : ''}`);
    return {
      verified: hasPositiveIndicators && !hasNegativeIndicators,
      evidence,
      errors,
      operatorResponse: { response, executedVia: backend.id },
    };
  } catch (error) {
    errors.push(`${backend.name} verification failed: ${(error as Error).message}`);
    return { verified: false, evidence, errors };
  }
}

const OUTCOME_SYSTEM_PROMPT = `You are the Outcome Review module of MetaHuman OS. Your job is to evaluate whether an executed desire actually achieved its goal.

CRITICAL: You will be given VERIFICATION RESULTS from an independent check. Do NOT trust self-reported success - use the verification evidence to make your verdict.

## Your Task
Analyze the execution results and determine:
1. Did the execution actually satisfy the desire?
2. What was learned from this attempt?
3. What should happen next?

## Verdict Options
- **completed**: The desire is fully satisfied. The goal was achieved. Archive it.
- **continue**: Keep pursuing this (for recurring desires like "stay healthy", "learn new things"). Reset for next cycle.
- **retry**: The execution failed or was incomplete. Try again with a new approach.
- **escalate**: Something unexpected happened that needs human attention. Alert the user.
- **abandon**: This desire cannot be achieved or is no longer relevant. Give up gracefully.

## Success Score (0.0 - 1.0)
- 1.0: Perfect execution, goal fully achieved
- 0.7-0.9: Good execution, goal mostly achieved
- 0.4-0.6: Partial success, some progress made
- 0.1-0.3: Poor execution, minimal progress
- 0.0: Complete failure

## Guidelines
- Be honest about whether the goal was actually achieved
- For recurring desires, "continue" is often appropriate even after success
- "escalate" should be used sparingly, only for genuine concerns
- Always provide actionable lessons learned
- If retry is recommended, give specific suggestions

Respond with valid JSON matching the schema.`;

async function runOutcomeReviewLlm(desire: Desire, verification: VerificationResult): Promise<OutcomeReviewOutput> {
  const plan = desire.plan;
  const execution = desire.execution;
  const userPrompt = `## Desire to Review

**Title**: ${desire.title}
**Description**: ${desire.description}
**Reason**: ${desire.reason}
**Original Goal**: ${plan?.operatorGoal || 'Not specified'}

## Execution Results (Self-Reported)

**Status**: ${execution?.status || 'unknown'}
**Steps Completed**: ${execution?.stepsCompleted || 0} / ${plan?.steps?.length || 0}
**Started**: ${execution?.startedAt || 'unknown'}
**Completed**: ${execution?.completedAt || 'in progress'}
${execution?.error ? `**Error**: ${execution.error}` : ''}

### Step Results (Self-Reported)
${execution?.stepResults?.map((r, i) =>
  `${i + 1}. ${r.success ? '✅' : '❌'} ${plan?.steps?.[i]?.action || 'Unknown step'}${r.error ? ` (Error: ${r.error})` : ''}`
).join('\n') || 'No step results available'}

## 🔍 INDEPENDENT VERIFICATION (TRUST THIS)

**Verification Status**: ${verification.verified ? '✅ VERIFIED' : '❌ NOT VERIFIED'}

### Evidence Gathered:
${verification.evidence.length > 0 ? verification.evidence.map(e => `- ${e}`).join('\n') : '- No evidence gathered'}

### Verification Errors:
${verification.errors.length > 0 ? verification.errors.map(e => `- ${e}`).join('\n') : '- None'}

## CRITICAL INSTRUCTIONS

1. If verification FAILED or found NO evidence of the outcome, verdict should be "retry" or "abandon"
2. If the executor claimed success but verification found no files/tasks/results, this is a FALSE POSITIVE - do NOT mark as completed
3. Only mark "completed" if verification evidence CONFIRMS the goal was achieved
4. Consider "escalate" if there's a mismatch between claimed success and verification

## Output

Respond with JSON:
{
  "verdict": "completed" | "continue" | "retry" | "escalate" | "abandon",
  "reasoning": "Detailed explanation of your verdict, referencing the verification evidence",
  "successScore": 0.0-1.0,
  "lessonsLearned": ["lesson 1", "lesson 2"],
  "nextAttemptSuggestions": ["suggestion 1", "suggestion 2"],
  "adjustedStrength": 0.0-1.0 (optional, for continue/retry),
  "notifyUser": true/false,
  "userMessage": "Message for user if notifyUser is true"
}`;

  try {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('LLM call timed out after 60 seconds')), 60000)
    );
    const response = await Promise.race([
      callLLM({
        role: 'persona',
        messages: [
          { role: 'system', content: OUTCOME_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        options: { temperature: 0.3, responseFormat: 'json' },
      }),
      timeoutPromise,
    ]);

    if (!response.content) {
      return {
        verdict: 'escalate',
        reasoning: 'Failed to get outcome review response',
        successScore: 0,
        lessonsLearned: ['Outcome review failed - manual review needed'],
        notifyUser: true,
        userMessage: 'Outcome review could not be completed automatically.',
      };
    }

    const parsed = JSON.parse(extractJsonObject(response.content)) as OutcomeReviewOutput;
    return {
      verdict: parsed.verdict,
      reasoning: parsed.reasoning,
      successScore: Math.max(0, Math.min(1, parsed.successScore)),
      lessonsLearned: parsed.lessonsLearned || [],
      nextAttemptSuggestions: parsed.nextAttemptSuggestions,
      adjustedStrength: parsed.adjustedStrength,
      notifyUser: parsed.notifyUser ?? false,
      userMessage: parsed.userMessage,
    };
  } catch (error) {
    return {
      verdict: 'escalate',
      reasoning: `Outcome review error: ${(error as Error).message}`,
      successScore: 0,
      lessonsLearned: ['Outcome review threw an error'],
      notifyUser: true,
      userMessage: `Outcome review failed: ${(error as Error).message}`,
    };
  }
}

function buildExecutionSummary(desire: Desire): string {
  const execution = desire.execution;
  const plan = desire.plan;
  if (!execution?.stepResults || !Array.isArray(execution.stepResults)) return '';

  const summaryParts: string[] = [];
  for (const stepResult of execution.stepResults) {
    const stepIndex = (stepResult as { stepOrder?: number }).stepOrder || 0;
    const stepAction = plan?.steps?.[stepIndex - 1]?.action || `Step ${stepIndex}`;
    const result = stepResult as { success?: boolean; result?: { claudeResponse?: string; interpreterResponse?: string }; error?: string };

    if (result.success && result.result) {
      const response = result.result.claudeResponse || result.result.interpreterResponse || '';
      const firstLine = response.split('\n').find(line =>
        line.trim() && !line.startsWith('#') && !line.startsWith('*')
      ) || response.substring(0, 150);
      summaryParts.push(`✅ ${stepAction}: ${firstLine.substring(0, 100)}${firstLine.length > 100 ? '...' : ''}`);
    } else {
      const error = result.error || 'Failed';
      summaryParts.push(`❌ ${stepAction}: ${error.substring(0, 80)}`);
    }
  }

  return summaryParts.join('\n');
}

async function applyOutcomeReview(
  username: string,
  desire: Desire,
  reviewResult: OutcomeReviewOutput,
  verification: VerificationResult,
  includeDialogue = true,
  includeMetrics = true,
) {
  const executionSummary = includeMetrics ? buildExecutionSummary(desire) : '';
  const now = new Date().toISOString();
  const oldStatus = desire.status;
  let newStatus: Desire['status'] = desire.status;

  switch (reviewResult.verdict) {
    case 'completed':
      newStatus = 'completed';
      break;
    case 'continue':
    case 'retry':
      newStatus = 'planning';
      break;
    case 'escalate':
      newStatus = 'awaiting_approval';
      break;
    case 'abandon':
      newStatus = 'abandoned';
      break;
  }

  const outcomeReview: DesireOutcomeReview = {
    id: `outcome-${desire.id}-${Date.now()}`,
    verdict: reviewResult.verdict,
    reasoning: reviewResult.reasoning,
    successScore: reviewResult.successScore,
    lessonsLearned: reviewResult.lessonsLearned,
    nextAttemptSuggestions: reviewResult.nextAttemptSuggestions,
    adjustedStrength: reviewResult.adjustedStrength,
    reviewedAt: now,
    notifyUser: reviewResult.notifyUser,
    userMessage: reviewResult.userMessage,
    ...(executionSummary ? { executionSummary } : {}),
  };

  const updatedDesire: Desire = {
    ...desire,
    outcomeReview,
    status: newStatus,
    updatedAt: now,
    strength: reviewResult.adjustedStrength ?? desire.strength,
    ...(includeMetrics && desire.metrics ? {
      metrics: {
        ...desire.metrics,
        executionSuccessCount: reviewResult.verdict === 'completed'
          ? desire.metrics.executionSuccessCount + 1
          : desire.metrics.executionSuccessCount,
        executionFailCount: ['retry', 'abandon'].includes(reviewResult.verdict)
          ? desire.metrics.executionFailCount + 1
          : desire.metrics.executionFailCount,
        completionCount: reviewResult.verdict === 'completed'
          ? desire.metrics.completionCount + 1
          : desire.metrics.completionCount,
        cycleCount: ['continue', 'retry'].includes(reviewResult.verdict)
          ? desire.metrics.cycleCount + 1
          : desire.metrics.cycleCount,
        avgSuccessScore: (desire.metrics.avgSuccessScore * desire.metrics.executionAttemptCount + reviewResult.successScore)
          / (desire.metrics.executionAttemptCount + 1),
      },
    } : {}),
  };

  if (oldStatus !== newStatus) {
    await moveDesire(updatedDesire, oldStatus, newStatus, username);
  } else {
    await saveDesire(updatedDesire, username);
  }

  await addScratchpadEntryToFolder(desire.id, {
    timestamp: now,
    type: 'outcome_review',
    description: includeMetrics
      ? `Outcome review: ${reviewResult.verdict} (score: ${(reviewResult.successScore * 100).toFixed(0)}%) - Verification: ${verification.verified ? 'VERIFIED' : 'NOT VERIFIED'}`
      : `Outcome review: ${reviewResult.verdict} (score: ${(reviewResult.successScore * 100).toFixed(0)}%)`,
    actor: 'llm',
    data: includeMetrics ? {
      verdict: reviewResult.verdict,
      reasoning: reviewResult.reasoning,
      successScore: reviewResult.successScore,
      lessonsLearned: reviewResult.lessonsLearned,
      nextAttemptSuggestions: reviewResult.nextAttemptSuggestions,
      notifyUser: reviewResult.notifyUser,
      userMessage: reviewResult.userMessage,
      newStatus,
      verification: {
        verified: verification.verified,
        evidence: verification.evidence,
        errors: verification.errors,
      },
    } : {
      verdict: reviewResult.verdict,
      verification: { verified: verification.verified },
    },
  }, username);

  audit({
    category: 'agent',
    level: reviewResult.verdict === 'escalate' ? 'warn' : 'info',
    event: 'desire_outcome_reviewed',
    actor: username,
    details: includeMetrics ? {
      desireId: desire.id,
      title: desire.title,
      verdict: reviewResult.verdict,
      successScore: reviewResult.successScore,
      oldStatus,
      newStatus,
      notifyUser: reviewResult.notifyUser,
      verificationPassed: verification.verified,
      verificationEvidenceCount: verification.evidence.length,
      verificationErrorCount: verification.errors.length,
    } : {
      desireId: desire.id,
      verdict: reviewResult.verdict,
      newStatus,
    },
  });

  if (includeDialogue) {
    const summarySection = executionSummary ? `\n\n**What I did:**\n${executionSummary}` : '';
    let dialogueText: string;
    switch (reviewResult.verdict) {
      case 'completed':
        dialogueText = `I've completed my desire "${desire.title}"! ${reviewResult.reasoning}${summarySection}`;
        break;
      case 'continue':
        dialogueText = `My desire "${desire.title}" is ongoing. ${reviewResult.reasoning} I'll continue pursuing it.${summarySection}`;
        break;
      case 'retry':
        dialogueText = `I need to retry "${desire.title}". ${reviewResult.reasoning}${summarySection}`;
        break;
      case 'escalate':
        dialogueText = `I need help with "${desire.title}". ${reviewResult.userMessage || reviewResult.reasoning}${summarySection}`;
        break;
      case 'abandon':
        dialogueText = `I'm letting go of "${desire.title}". ${reviewResult.reasoning}${summarySection}`;
        break;
    }

    captureEvent(dialogueText, {
      type: 'inner_dialogue',
      tags: ['agency', 'outcome', 'review', 'inner'],
      metadata: {
        source: 'outcome-reviewer',
        desireId: desire.id,
        verdict: reviewResult.verdict,
        successScore: reviewResult.successScore,
        executionSummary,
      },
    });

    const ttsText = (() => {
      switch (reviewResult.verdict) {
        case 'completed':
          return `I've completed my desire: ${desire.title}. ${reviewResult.reasoning}`;
        case 'continue':
          return `My desire "${desire.title}" is ongoing. I'll continue pursuing it.`;
        case 'retry':
          return `I need to retry "${desire.title}". ${reviewResult.reasoning}`;
        case 'escalate':
          return `I need help with "${desire.title}". ${reviewResult.userMessage || reviewResult.reasoning}`;
        case 'abandon':
          return `I'm letting go of "${desire.title}". ${reviewResult.reasoning}`;
        default:
          return `Desire "${desire.title}" review complete.`;
      }
    })();
    queueTTS(username, ttsText, 'inner', 'outcome-reviewer');
  } else {
    captureEvent(`Reviewed "${desire.title}": ${reviewResult.verdict}`, {
      type: 'inner_dialogue',
      metadata: { source: 'outcome-reviewer', desireId: desire.id, verdict: reviewResult.verdict },
    });
  }

  const verificationStatus = verification.verified ? '✅ Verified' : '⚠️ Not Verified';
  let message: string;
  switch (reviewResult.verdict) {
    case 'completed':
      message = includeMetrics
        ? `🎉 Success! "${desire.title}" has been completed. Score: ${(reviewResult.successScore * 100).toFixed(0)}% [${verificationStatus}]`
        : `🎉 "${desire.title}" completed! Score: ${(reviewResult.successScore * 100).toFixed(0)}% [${verificationStatus}]`;
      break;
    case 'continue':
      message = includeMetrics
        ? `🔄 "${desire.title}" will continue. Moving back to planning for next cycle. [${verificationStatus}]`
        : `🔄 "${desire.title}" will continue. [${verificationStatus}]`;
      break;
    case 'retry':
      message = includeMetrics
        ? `🔁 "${desire.title}" needs another attempt. Moving back to planning. [${verificationStatus}]`
        : `🔁 "${desire.title}" needs retry. [${verificationStatus}]`;
      break;
    case 'escalate':
      message = includeMetrics
        ? `⚠️ "${desire.title}" needs your attention: ${reviewResult.userMessage || reviewResult.reasoning} [${verificationStatus}]`
        : `⚠️ "${desire.title}" needs attention. [${verificationStatus}]`;
      break;
    case 'abandon':
      message = includeMetrics
        ? `🚫 "${desire.title}" has been abandoned. ${reviewResult.reasoning} [${verificationStatus}]`
        : `🚫 "${desire.title}" abandoned. [${verificationStatus}]`;
      break;
  }

  return { updatedDesire, outcomeReview, message, verification, reviewResult };
}

async function loadReviewableDesire(username: string, id: string): Promise<Desire> {
  const desire = await loadDesire(id, username);
  if (!desire) throw new WorkflowError('Desire not found', 404);
  if (!['executing', 'awaiting_review', 'completed', 'failed'].includes(desire.status)) {
    throw new WorkflowError(`Cannot review outcome for desire in '${desire.status}' status. Must be 'executing', 'awaiting_review', 'completed', or 'failed'.`, 400);
  }
  if (!desire.execution) {
    throw new WorkflowError('Cannot review outcome without execution data.', 400);
  }
  return desire;
}

export async function handleOutcomeReview(req: UnifiedRequest): Promise<UnifiedResponse> {
  const auth = requireOwner(req, 'review outcomes');
  if (auth) return auth;
  const id = req.params?.id;
  if (!id) return { status: 400, error: 'Desire ID is required' };

  try {
    console.log(`${OUTCOME_LOG_PREFIX} 🔍 Outcome review requested for: ${id}`);
    const desire = await loadReviewableDesire(req.user.username, id);
    const verification = await verifyOutcomeWithOperator(desire, req.user.username);
    const reviewResult = await runOutcomeReviewLlm(desire, verification);
    const result = await applyOutcomeReview(req.user.username, desire, reviewResult, verification, true, true);
    return successResponse({
      success: true,
      desire: result.updatedDesire,
      outcomeReview: result.outcomeReview,
      message: result.message,
      verification: {
        verified: result.verification.verified,
        evidence: result.verification.evidence,
        errors: result.verification.errors,
      },
    });
  } catch (error) {
    console.error(`${OUTCOME_LOG_PREFIX} ❌ Error:`, error);
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
    yield dataSse({ type: 'log', message: `Loading desire: ${id}` });
    const desire = await loadReviewableDesire(req.user.username, id);
    yield dataSse({ type: 'log', message: `Found: "${desire.title}" (status: ${desire.status})` });
    yield dataSse({ type: 'phase', phase: '🔍 Running verification...' });
    yield dataSse({ type: 'log', message: 'Checking escalation backend...' });

    const verification = await verifyOutcomeWithOperator(desire, req.user.username);
    if (verification.errors.length > 0) {
      for (const error of verification.errors) yield dataSse({ type: 'log', message: `❌ ${error}` });
    }
    if (verification.evidence.length > 0) {
      yield dataSse({ type: 'log', message: verification.verified ? '✅ Verification passed' : '❌ Verification failed' });
    }

    yield dataSse({ type: 'phase', phase: '🤖 Analyzing results...' });
    yield dataSse({ type: 'log', message: 'Preparing LLM prompt for verdict assessment...' });
    yield dataSse({ type: 'log', message: 'Calling LLM for verdict...' });
    const reviewResult = await runOutcomeReviewLlm(desire, verification);
    yield dataSse({ type: 'log', message: `Verdict: ${reviewResult.verdict} (score: ${(reviewResult.successScore * 100).toFixed(0)}%)` });

    yield dataSse({ type: 'phase', phase: '📝 Updating desire...' });
    const result = await applyOutcomeReview(req.user.username, desire, reviewResult, verification, false, false);
    yield dataSse({ type: 'log', message: `Status: ${desire.status} → ${result.updatedDesire.status}` });
    yield dataSse({ type: 'log', message: '✅ Review complete!' });
    yield dataSse({
      type: 'result',
      data: {
        success: true,
        desire: result.updatedDesire,
        outcomeReview: result.outcomeReview,
        message: result.message,
        verification: {
          verified: result.verification.verified,
          evidence: result.verification.evidence,
          errors: result.verification.errors,
        },
      },
    });
    yield dataSse({ type: 'done' });
  } catch (error) {
    console.error(`${OUTCOME_STREAM_LOG_PREFIX} Stream error:`, error);
    yield dataSse({ type: 'error', message: (error as Error).message });
  }
}
