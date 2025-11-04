/**
 * Operator Agent
 *
 * Implements the Planner/Executor/Critic loop for autonomous task execution.
 * Uses skills system with trust-aware policy enforcement.
 */

import { llm, paths, audit, acquireLock, isLocked, loadPersonaCore, captureEvent } from '../../packages/core/src/index';
import { initializeSkills } from '../skills/index';
import {
  listSkills,
  executeSkill,
  loadTrustLevel,
  getAvailableSkills,
  SkillManifest,
  SkillResult,
  TrustLevel,
} from '../../packages/core/src/skills';
import { evaluatePolicy, queueForApproval, getPendingApprovals } from '../../packages/core/src/policy';

// ============================================================================
// Types
// ============================================================================

interface Task {
  goal: string;
  context?: string;
}

interface Plan {
  steps: PlanStep[];
  reasoning: string;
}

interface PlanStep {
  id: number;
  description: string;
  skillId: string;
  inputs: Record<string, any>;
  expectedOutput: string;
}

interface ExecutionResult {
  stepId: number;
  success: boolean;
  output?: any;
  error?: string;
}

interface CriticReview {
  success: boolean;
  feedback: string;
  shouldRetry: boolean;
  suggestedFixes?: string;
}

// Narrow operator focus profiles to bias planning toward certain skill sets
type OperatorProfile = 'files' | 'git' | 'web' | undefined;
type OperatorMode = 'strict' | 'yolo';

interface TaskAssessment {
  ready: boolean;
  confidence: number;
  clarification?: string;
  rationale?: string;
}

// ============================================================================
// Operator State
// ============================================================================

let trustLevel: TrustLevel = 'observe';
let availableSkills: SkillManifest[] = [];
let lastFilePath: string | null = null;
let inited = false;

// ============================================================================
// Initialization
// ============================================================================

function initialize(): void {
  console.log('[operator] Initializing operator agent...');

  // Load trust level
  trustLevel = loadTrustLevel();
  console.log(`[operator] Trust level: ${trustLevel}`);

  // Initialize skills
  initializeSkills();

  // Get available skills for current trust level
  availableSkills = getAvailableSkills(trustLevel);
  console.log(`[operator] Available skills (${availableSkills.length}):`, availableSkills.map(s => s.id).join(', '));

  audit({
    level: 'info',
    category: 'system',
    event: 'operator_initialized',
    details: {
      trustLevel,
      availableSkills: availableSkills.length,
    },
    actor: 'operator',
  });

  inited = true;
}

// ============================================================================
// Task Assessment
// ============================================================================

async function assessTask(task: Task, mode: OperatorMode): Promise<TaskAssessment | null> {
  try {
    const systemPrompt = `You are a task assessment module for an autonomous operator.
Evaluate whether the task has enough detail to proceed safely.
Respond ONLY as JSON with keys:
- "ready": boolean
- "confidence": number between 0 and 1
- "clarification": optional string describing the most important missing detail
- "rationale": optional short explanation`;

    const userPrompt = `Task goal: ${task.goal}
${task.context ? `Context: ${task.context}` : 'No additional context provided.'}
Operator mode: ${mode === 'yolo' ? 'YOLO (relaxed guardrails)' : 'Strict (default safeguards)'}

Return JSON now.`;

    const raw = await llm.generateJSON<TaskAssessment>(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      'ollama',
      { temperature: mode === 'yolo' ? 0.3 : 0.2 }
    );

    const confidence = Math.max(0, Math.min(1, Number(raw.confidence) || 0));
    const assessment: TaskAssessment = {
      ready: Boolean(raw.ready),
      confidence,
      clarification: typeof raw.clarification === 'string' ? raw.clarification.trim() : undefined,
      rationale: typeof raw.rationale === 'string' ? raw.rationale.trim() : undefined,
    };

    audit({
      level: 'info',
      category: 'action',
      event: 'task_assessed',
      details: {
        goal: task.goal,
        mode,
        ready: assessment.ready,
        confidence: assessment.confidence,
        clarification: assessment.clarification,
      },
      actor: 'operator',
    });

    return assessment;
  } catch (error) {
    console.warn('[operator:assess] Task assessment failed:', error);
    audit({
      level: 'warn',
      category: 'action',
      event: 'task_assessment_failed',
      details: { goal: task.goal, error: (error as Error).message },
      actor: 'operator',
    });
    return null;
  }
}

// ============================================================================
// Planner
// ============================================================================

/**
 * Generate a plan to accomplish the given task
 */
async function plan(
  task: Task,
  profile: OperatorProfile | undefined,
  mode: OperatorMode,
  assessment?: TaskAssessment | null
): Promise<Plan | null> {
  console.log('[operator:planner] Planning task:', task.goal);

  audit({
    level: 'info',
    category: 'action',
    event: 'planning_started',
    details: { goal: task.goal },
    actor: 'operator',
  });

  // Load persona for context
  const persona = loadPersonaCore();
  let valuesString = '';
  if (persona && persona.values) {
    // Handle both array and object formats for backward compatibility
    if (Array.isArray(persona.values)) {
      valuesString = persona.values.join(', ');
    } else if (typeof persona.values === 'object' && persona.values.core) {
      // Extract values from core array if values is an object
      valuesString = persona.values.core.map((v: any) => v.value).join(', ') || '';
    } else {
      valuesString = JSON.stringify(persona.values);
    }
  }
  const personaContext = persona
    ? `Your persona:\n- Name: ${persona.name}\n- Role: ${persona.role}\n- Values: ${valuesString}`
    : '';

  // Build skill catalog for LLM
  const skillsCatalog = availableSkills
    .map(skill => {
      const inputsInfo = Object.entries(skill.inputs)
        .map(([key, spec]) => `    ${key}: ${spec.description} (${spec.type}${spec.required ? ', required' : ''})`)
        .join('\n');
      return `- ${skill.id}: ${skill.description}
  Inputs:
${inputsInfo}
  Risk: ${skill.risk} | Cost: ${skill.cost} | Requires Approval: ${skill.requiresApproval}`;
    })
    .join('\n\n');

  const allowedSkillsList = availableSkills.map(s => s.id).join(', ');
  // Profile focus instructions
  const focus = profile === 'files'
    ? `FOCUS MODE: FILES
- Prefer file-system skills: fs_list, fs_read, fs_write, summarize_file, json_update.
- Avoid git/network skills unless the user explicitly asks for them.`
    : profile === 'git'
    ? `FOCUS MODE: GIT
- Prefer git_status for inspection. Use git_commit only when the user explicitly asks and include a dry-run preview first.
- Avoid file/network operations unless explicitly asked.`
    : profile === 'web'
    ? `FOCUS MODE: WEB
- Prefer web_search for general queries. When you need a direct fetch from a known URL, use http_get.
- Summarize downloaded content with summarize_file when saving locally.
- Avoid git operations unless explicitly asked.`
    : `FOCUS MODE: AUTO
- Choose the minimal set of steps using available skills.`

  const modeLabel = mode === 'yolo' ? 'EXPERIMENTAL YOLO MODE' : 'STANDARD MODE';
  const instructionLines: string[] = [
    'Only use skills from the list above',
    'Keep plans simple and focused',
    'Avoid unnecessary steps',
    'Prefer reading before writing',
    'Use tasks.list (optionally filtered) to inspect active tasks, tasks.find to match by title or ID, tasks.create for new items, tasks.update for property or status changes, and tasks.schedule when the user needs calendar alignment.',
    'For calendar requests, use calendar.listRange / calendar.create / calendar.update as appropriate.',
    'Always validate inputs',
    'When writing files and the user did not specify a path, default to writing under the \'out/\' directory in the project root.',
  ];

  if (mode === 'strict') {
    instructionLines.splice(
      4,
      0,
      'Whenever you need the result of a previous step, reference it explicitly using placeholders such as {{steps.2.outputs.tasks[0].id}}. Never hard-code IDs.',
      'Before changing or cancelling a task, ensure the current status matches your intent (e.g. only cancel tasks currently in todo). Capture that expected status as statusBefore.',
      'Only apply filters such as listId or category when you have already retrieved those values from earlier steps.',
      'Never hard-code task IDs; always reuse the id returned from tasks.list/find/create in subsequent steps.'
    );
  } else {
    instructionLines.push(
      'If anything is ambiguous, ask the user a clarifying question instead of guessing.',
      'You may compose multi-step actions in a single plan step when it saves time, but explain what you will do.',
      'You may proceed without placeholders if you are certain about identifiers.'
    );
  }

  if (assessment) {
    const confidencePct = `${Math.round((assessment.confidence ?? 0) * 100)}%`;
    const rationale = assessment.rationale ? ` ${assessment.rationale}` : '';
    instructionLines.push(`Assessment: confidence ${confidencePct}.${rationale}`);
    if (!assessment.ready && assessment.clarification) {
      instructionLines.push(`Before destructive changes, include a preparatory step to resolve: ${assessment.clarification}`);
    }
  }

  const systemPrompt = `You are the Planner for an autonomous operator system (${modeLabel}).

${personaContext}

Your job is to break down tasks into a sequence of steps using available skills.

Available Skills:
${skillsCatalog}

${focus}

STRICT RULES:
- Skill IDs must be chosen EXACTLY from this set: ${allowedSkillsList}
- To write a file, you MUST use skillId "fs_write" with inputs: { "path": "<absolute or project-relative path>", "content": "<string>", "overwrite": true/false }
- Do NOT add fs_read before fs_write. Only include a read-after-write step if the user explicitly asks to verify content. If not asked, omit fs_read entirely.

Current Trust Level: ${trustLevel}

  IMPORTANT:
${instructionLines.map(line => `  - ${line}`).join('\n')}
${mode === 'yolo' ? '  - YOLO mode: narrate risky actions briefly before executing so humans can follow along.' : ''}

Respond with JSON only:
{
  "reasoning": "Brief explanation of the plan",
  "steps": [
    {
      "id": 1,
      "description": "Human-readable step description",
      "skillId": "skill_id",
      "inputs": { "key": "value" },
      "expectedOutput": "What this step should produce"
    }
  ]
  }`;

  const userPrompt = `Task: ${task.goal}

${task.context ? `Context: ${task.context}` : ''}
${assessment ? `\nAssessment:\n- Ready: ${assessment.ready ? 'yes' : 'no'}\n- Confidence: ${(assessment.confidence * 100).toFixed(0)}%\n${assessment.clarification ? `- Missing detail: ${assessment.clarification}\n` : ''}${assessment.rationale ? `- Notes: ${assessment.rationale}` : ''}` : ''}

Create a step-by-step plan to accomplish this task.`;

  try {
    let response = await llm.generateJSON<Plan>(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      'ollama',
      { temperature: 0.3 }
    );
    // Plan validator: map common synonyms and ensure only allowed skills
    const allowedIds = new Set(availableSkills.map(s => s.id));
    const synonyms = new Map<string, string>([
      ['create_file', 'fs_write'],
      ['write_file', 'fs_write'],
      ['save_file', 'fs_write'],
      ['open_file', 'fs_read'],
      ['read_file', 'fs_read'],
      ['list_files', 'fs_list'],
      ['update_json', 'json_update'],
      ['get_http', 'http_get'],
      ['websearch', 'web_search'],
      ['search_web', 'web_search'],
      ['web_search', 'web_search'],
      ['summarize', 'summarize_file'],
      ['task_list', 'tasks.list'],
      ['task_find', 'tasks.find'],
      ['task_create', 'tasks.create'],
      ['task_update_status', 'tasks.update'],
      ['task_schedule', 'tasks.schedule'],
    ]);
    let unknown = false;
    response.steps = response.steps.map(s => {
      const id = s.skillId;
      if (!allowedIds.has(id)) {
        const lower = id.toLowerCase();
        const mapped = synonyms.get(lower);
        if (mapped && allowedIds.has(mapped)) {
          return { ...s, skillId: mapped };
        }
        unknown = true;
      }
      return s;
    });
    if (unknown && mode === 'strict') {
      const stricter = `Your last plan used invalid or unknown skills. Replan using ONLY these skills: ${Array.from(allowedIds).join(', ')}. Use fs_write for writing; avoid fs_read before fs_write.`;
      response = await llm.generateJSON<Plan>([
        { role: 'system', content: systemPrompt + '\n\n' + stricter },
        { role: 'user', content: userPrompt },
      ], 'ollama', { temperature: 0.2 });
    }

    console.log(`[operator:planner] Generated plan with ${response.steps.length} steps`);

    audit({
      level: 'info',
      category: 'action',
      event: 'planning_completed',
      details: {
        goal: task.goal,
        stepsCount: response.steps.length,
        reasoning: response.reasoning,
        mode,
      },
      actor: 'operator',
    });

    return response;
  } catch (error) {
    console.error('[operator:planner] Planning failed:', error);

    audit({
      level: 'error',
      category: 'action',
      event: 'planning_failed',
      details: { goal: task.goal, mode, error: (error as Error).message },
      actor: 'operator',
    });

    return null;
  }
}

// ============================================================================
// Executor
// ============================================================================

/**
 * Execute a plan step by step
 */
async function execute(
  plan: Plan,
  options: { autoApprove?: boolean; mode?: OperatorMode } = {}
): Promise<ExecutionResult[]> {
  console.log('[operator:executor] Executing plan...');

  const mode: OperatorMode = options.mode ?? 'strict';
  const isYolo = mode === 'yolo';

  audit({
    level: 'info',
    category: 'action',
    event: 'execution_started',
    details: { stepsCount: plan.steps.length, mode },
    actor: 'operator',
  });

  const results: ExecutionResult[] = [];
  const stepById = new Map(plan.steps.map(s => [s.id, s]));

  const getOutputValue = (output: any, path: string[]): any => {
    return path.reduce((acc: any, key: string) => {
      if (acc == null) return undefined;
      if (Array.isArray(acc)) {
        const idx = Number(key);
        if (Number.isNaN(idx)) return undefined;
        return acc[idx];
      }
      return acc?.[key];
    }, output);
  };

  const resolvePlaceholders = (
    value: any,
    context: Map<number, { output: any; skillId?: string }>
  ): any => {
    if (typeof value === 'string') {
      const directPattern = /^\{\{\s*steps\.(\d+)\.outputs\.([a-zA-Z0-9_.-]+)\s*\}\}$/;
      const directMatch = value.match(directPattern);
      if (directMatch) {
        const stepId = Number(directMatch[1]);
        const pathParts = directMatch[2].split('.');
        const ref = context.get(stepId);
        if (!ref) return value;
        const resolved = getOutputValue(ref.output, pathParts);
        return resolved !== undefined ? resolved : value;
      }

      const pattern = /\{\{\s*steps\.(\d+)\.outputs\.([a-zA-Z0-9_.-]+)\s*\}\}/g;
      return value.replace(pattern, (_, stepIdStr: string, path: string) => {
        const stepId = Number(stepIdStr);
        const ref = context.get(stepId);
        if (!ref) return '';
        const resolved = getOutputValue(ref.output, path.split('.'));
        return resolved !== undefined && resolved !== null ? String(resolved) : '';
      });
    }

    if (Array.isArray(value)) {
      return value.map(item => resolvePlaceholders(item, context));
    }

    if (value && typeof value === 'object') {
      const clone: Record<string, any> = {};
      for (const key of Object.keys(value)) {
        clone[key] = resolvePlaceholders(value[key], context);
      }
      return clone;
    }

    return value;
  };

  const resolveInputs = (
    step: PlanStep,
    context: Map<number, { output: any; skillId?: string }>
  ): Record<string, any> | undefined => {
    if (!step.inputs) return step.inputs;
    const resolved = resolvePlaceholders(step.inputs, context);

    if (mode === 'yolo') {
      if (resolved && typeof resolved === 'object' && resolved !== null) {
        if ((resolved as any).taskId && !(resolved as any).id) {
          (resolved as any).id = (resolved as any).taskId;
        }
      }
      return resolved;
    }

    const collectCandidateTasks = () => {
      const candidates: any[] = [];
      for (const [, entry] of context.entries()) {
        const output = entry.output;
        if (!output) continue;
        if (Array.isArray((output as any).tasks)) {
          candidates.push(...(output as any).tasks);
        }
        if (Array.isArray((output as any).matches)) {
          candidates.push(...(output as any).matches);
        }
        if ((output as any).match) {
          candidates.push((output as any).match);
        }
      }
      return candidates;
    };

    if (step.skillId === 'tasks.update' && resolved) {
      if (resolved.taskId && !resolved.id) {
        resolved.id = resolved.taskId;
        delete resolved.taskId;
      }

      if (resolved.status && !resolved.statusBefore) {
        if (resolved.status === 'cancelled') resolved.statusBefore = 'todo';
        else if (resolved.status === 'done') resolved.statusBefore = 'in_progress';
      }

      const candidates = collectCandidateTasks();

      const assignFromCandidates = () => {
        const expectedBefore = resolved.statusBefore as string | undefined;
        const filtered = candidates.filter(task => {
          if (!task || typeof task !== 'object') return false;
          if (expectedBefore && task.status !== expectedBefore) return false;
          if (resolved.status === 'cancelled' && task.status !== 'todo') return false;
          return true;
        });
        if (filtered.length === 1) {
          resolved.id = filtered[0].id;
        }
      };

      if (!resolved.id || typeof resolved.id !== 'string' || !/^task-[a-z0-9_-]+$/i.test(resolved.id)) {
        assignFromCandidates();
      }

      return resolved;
    }

    if (
      step.skillId === 'task_update_status' &&
      resolved &&
      typeof resolved.taskId === 'string'
    ) {
      const trimmed = resolved.taskId.trim();
      const looksLikePlaceholder =
        trimmed === '' ||
        trimmed === 'task_xxx' ||
        !/^task-[a-z0-9_-]+$/i.test(trimmed);
      if (looksLikePlaceholder) {
        const candidates = collectCandidateTasks();
        const expectedStatus = resolved.statusBefore || 'todo';
        const filtered = candidates.filter(task => task?.status === expectedStatus);
        if (filtered.length === 1) {
          resolved.taskId = filtered[0].id;
        }
      }
    }

    return resolved;
  };

  for (const step of plan.steps) {
    console.log(`[operator:executor] Step ${step.id}: ${step.description}`);

    const context = new Map<number, { output: any; skillId?: string }>();
    for (const prior of results) {
      const meta = stepById.get(prior.stepId);
      context.set(prior.stepId, { output: prior.output, skillId: meta?.skillId });
    }

    try {
      step.inputs = resolveInputs(step, context);

      if (step.skillId === 'tasks.update') {
        const id = step.inputs?.id;
        if (!id || typeof id !== 'string' || !/^task-[a-z0-9_-]+$/i.test(id)) {
          if (isYolo) {
            console.warn('[operator:executor] YOLO mode continuing without validated task id');
          } else {
            throw new Error('tasks.update requires a task id derived from earlier steps');
          }
        }
        if (!isYolo && !step.inputs?.statusBefore && typeof step.inputs?.status === 'string') {
          if (step.inputs.status === 'cancelled') {
            step.inputs.statusBefore = 'todo';
          } else if (step.inputs.status === 'done') {
            step.inputs.statusBefore = 'in_progress';
          }
        }
      }

      // Log the inputs for debugging
      console.log(`[operator:executor] Executing step ${step.id} with inputs:`, JSON.stringify(step.inputs, null, 2));
      console.log(`[operator:executor] Skill ID: ${step.skillId}`);

      // Skip pre-read steps: if a later step writes, avoid reading first
      if (step.skillId === 'fs_read' && plan.steps.some(s => s.id > step.id && s.skillId === 'fs_write')) {
        console.log(`[operator:executor] Skipping fs_read before fs_write (pre-read suppressed)`);
        results.push({ stepId: step.id, success: true, output: { skipped: true } });
        continue;
      }

      // If fs_read and no concrete path provided, try to use lastFilePath
      if (step.skillId === 'fs_read') {
        const p = step.inputs?.path;
        const missing = !p || typeof p !== 'string' || p.includes('<absolute') || p.trim() === '';
        if (missing && lastFilePath) {
          console.log(`[operator:executor] Resolving missing fs_read path using lastFilePath: ${lastFilePath}`);
          step.inputs = { ...(step.inputs || {}), path: lastFilePath };
        }
      }
      
      // If the skill is not available, attempt a safe fallback mapping (e.g., create_file/write_file -> fs_write)
      const isAvailable = availableSkills.some(s => s.id === step.skillId);
      let result;
      if (!isAvailable) {
        const id = step.skillId.toLowerCase();
        const looksLikeWrite = /write.*file|create.*file|save.*file/.test(id);
        if (looksLikeWrite) {
          const inPath = step.inputs?.path || step.inputs?.file || step.inputs?.filepath || step.inputs?.filename;
          const resolvedPath = inPath
            ? (inPath.startsWith('/') ? inPath : `${paths.root}/${inPath.replace(/^\.\/?/, '')}`)
            : `${paths.out}/operator-output.txt`;
          const content = step.inputs?.content ?? step.inputs?.text ?? step.inputs?.data ?? '';
          console.log(`[operator:executor] Fallback mapping '${step.skillId}' -> fs_write (${resolvedPath})`);
          result = await executeSkill('fs_write', { path: resolvedPath, content, overwrite: true }, trustLevel, options.autoApprove === true);
        } else {
          result = { success: false, error: `Skill '${step.skillId}' not found` } as any;
        }
      } else {
        // Execute the skill
        result = await executeSkill(step.skillId, step.inputs, trustLevel, options.autoApprove === true);
        // Non-fatal: allow fs_read missing file to continue
        if (!result.success && step.skillId === 'fs_read' && (result.error || '').toLowerCase().includes('file not found')) {
          console.warn(`[operator:executor] fs_read file not found at ${step.inputs?.path}, continuing`);
          result = { success: true, outputs: { skipped: true } } as any;
        }
      }

      const executionResult: ExecutionResult = {
        stepId: step.id,
        success: result.success,
        output: result.outputs,
        error: result.error,
      };

      results.push(executionResult);

      // Track last written file path
      if (step.skillId === 'fs_write' && result.success) {
        const outPath = (result.outputs && (result.outputs as any).path) as string | undefined;
        if (outPath && typeof outPath === 'string') lastFilePath = outPath;
      }

      if (!result.success) {
        console.error(`[operator:executor] Step ${step.id} failed:`, result.error);

        audit({
          level: 'warn',
          category: 'action',
          event: 'step_failed',
          details: {
            stepId: step.id,
            skillId: step.skillId,
            error: result.error,
          },
          actor: 'operator',
        });

        // Stop execution on first failure (could make this configurable)
        break;
      }

      console.log(`[operator:executor] Step ${step.id} succeeded`);
    } catch (error) {
      console.error(`[operator:executor] Step ${step.id} threw error:`, error);

      results.push({
        stepId: step.id,
        success: false,
        error: (error as Error).message,
      });

      // Stop on error
      break;
    }
  }

  audit({
    level: 'info',
    category: 'action',
    event: 'execution_completed',
    details: {
      totalSteps: plan.steps.length,
      executedSteps: results.length,
      successfulSteps: results.filter(r => r.success).length,
      mode,
    },
    actor: 'operator',
  });

  return results;
}

// ============================================================================
// Critic
// ============================================================================

/**
 * Review the execution results and provide feedback
 */
async function critique(
  task: Task,
  plan: Plan,
  results: ExecutionResult[],
  mode: OperatorMode
): Promise<CriticReview> {
  console.log('[operator:critic] Reviewing execution results...');

  audit({
    level: 'info',
    category: 'action',
    event: 'critique_started',
    details: {
      goal: task.goal,
      resultsCount: results.length,
      mode,
    },
    actor: 'operator',
  });

  // Build a summary of what happened
  const executionSummary = results
    .map(r => {
      const step = plan.steps.find(s => s.id === r.stepId);
      return `Step ${r.stepId} (${step?.skillId}): ${r.success ? 'SUCCESS' : 'FAILED'}
  Description: ${step?.description}
  ${r.success ? `Output: ${JSON.stringify(r.output)}` : `Error: ${r.error}`}`;
    })
    .join('\n\n');

  const systemPrompt = `You are the Critic for an autonomous operator system.

Your job is to review the results of task execution and determine:
1. Did the task succeed?
2. If not, what went wrong?
3. Should we retry with a different approach?
4. What improvements can be made?

Be concise and actionable in your feedback.

Respond with JSON only:
{
  "success": true/false,
  "feedback": "Brief assessment of the execution",
  "shouldRetry": true/false,
  "suggestedFixes": "Specific suggestions if retry is recommended (optional)"
}`;

  const userPrompt = `Original Task: ${task.goal}

Execution Results:
${executionSummary}

Review the execution and provide feedback.`;

  try {
    const response = await llm.generateJSON<CriticReview>(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      'ollama',
      { temperature: 0.3 }
    );

    console.log(`[operator:critic] Review: ${response.success ? 'SUCCESS' : 'NEEDS WORK'}`);
    console.log(`[operator:critic] Feedback: ${response.feedback}`);

    audit({
      level: 'info',
      category: 'action',
      event: 'critique_completed',
      details: {
        success: response.success,
        shouldRetry: response.shouldRetry,
        feedback: response.feedback,
        mode,
      },
      actor: 'operator',
    });

    return response;
  } catch (error) {
    console.error('[operator:critic] Critique failed:', error);

    audit({
      level: 'error',
      category: 'action',
      event: 'critique_failed',
      details: { error: (error as Error).message, mode },
      actor: 'operator',
    });

    // Return a conservative review
    return {
      success: false,
      feedback: `Critique failed: ${(error as Error).message}`,
      shouldRetry: false,
    };
  }
}

// ============================================================================
// Main Operator Loop
// ============================================================================

/**
 * Execute a task using the Plan/Execute/Critique loop
 */
type OperatorRunResult = {
  success: boolean;
  task: Task;
  plan?: Plan;
  results?: ExecutionResult[];
  critique?: CriticReview;
  error?: string;
};

async function runTask(
  task: Task,
  maxRetries: number = 1,
  options: { autoApprove?: boolean; profile?: OperatorProfile; mode?: OperatorMode } = {}
): Promise<OperatorRunResult> {
  if (!inited) initialize();
  console.log('\n='.repeat(60));
  console.log(`[operator] Starting task: ${task.goal}`);
  console.log('='.repeat(60) + '\n');

  const requestedMode: OperatorMode = options.mode ?? 'strict';

  audit({
    level: 'info',
    category: 'action',
    event: 'task_started',
    details: { goal: task.goal, trustLevel, mode: requestedMode },
    actor: 'operator',
  });

  let retries = 0;
  const assessment = await assessTask(task, requestedMode);
  const effectiveMode: OperatorMode =
    requestedMode === 'yolo' && assessment && assessment.confidence < 0.35 && !assessment.ready
      ? 'strict'
      : requestedMode;
  if (requestedMode !== effectiveMode) {
    console.log('[operator] Downgrading to strict mode due to low confidence assessment.');
    audit({
      level: 'warn',
      category: 'action',
      event: 'mode_downgraded',
      details: {
        goal: task.goal,
        requestedMode,
        effectiveMode,
        confidence: assessment?.confidence,
        clarification: assessment?.clarification,
      },
      actor: 'operator',
    });
  }

  while (retries <= maxRetries) {
    if (retries > 0) {
      console.log(`\n[operator] Retry attempt ${retries}/${maxRetries}\n`);
    }

    // Step 1: Plan
    const planResult = await plan(task, options.profile, effectiveMode, assessment);
    if (!planResult) {
      console.error('[operator] Planning failed. Aborting task.');
      return { success: false, task, error: 'planning_failed' };
    }

    console.log('\n--- PLAN ---');
    console.log(`Reasoning: ${planResult.reasoning}`);
    console.log(`Steps (${planResult.steps.length}):`);
    planResult.steps.forEach(step => {
      console.log(`  ${step.id}. [${step.skillId}] ${step.description}`);
    });
    console.log('');

    // Step 2: Execute
    const executionResults = await execute(planResult, { autoApprove: options.autoApprove, mode: effectiveMode });

    console.log('\n--- EXECUTION RESULTS ---');
    executionResults.forEach(result => {
      console.log(`  Step ${result.stepId}: ${result.success ? '✓ SUCCESS' : '✗ FAILED'}`);
      if (result.error) {
        console.log(`    Error: ${result.error}`);
      }
    });
    console.log('');

    // Step 3: Critique
    const review = await critique(task, planResult, executionResults, effectiveMode);

    console.log('\n--- CRITIQUE ---');
    console.log(`Success: ${review.success ? 'YES' : 'NO'}`);
    console.log(`Feedback: ${review.feedback}`);
    if (review.shouldRetry && review.suggestedFixes) {
      console.log(`Suggested Fixes: ${review.suggestedFixes}`);
    }
    console.log('');

    // Check if we're done
    if (review.success) {
      console.log('[operator] Task completed successfully!');
      try {
        const changed = executionResults.find(r => r.success && r.output && (r as any).output.path)
        const outPath = changed ? (changed as any).output.path : undefined
        const summary = `Operator task completed: ${task.goal}${outPath ? `\n\nOutput: ${outPath}` : ''}`
        captureEvent(summary, { type: 'action', tags: ['operator','success'], links: outPath ? [{ type: 'file', target: outPath }] : [] })
      } catch {}

      audit({
        level: 'info',
        category: 'action',
        event: 'task_completed',
        details: {
          goal: task.goal,
          retries,
          feedback: review.feedback,
          mode: effectiveMode,
        },
        actor: 'operator',
      });

      return { success: true, task, plan: planResult, results: executionResults, critique: review };
    }

    // Check if we should retry
    if (!review.shouldRetry || retries >= maxRetries) {
      console.log('[operator] Task failed and no more retries available.');
      try { captureEvent(`Operator task failed: ${task.goal}`, { type: 'action', tags: ['operator','failure'] }) } catch {}

      audit({
        level: 'warn',
        category: 'action',
        event: 'task_failed',
        details: {
          goal: task.goal,
          retries,
          feedback: review.feedback,
          mode: effectiveMode,
        },
        actor: 'operator',
      });

      return { success: false, task, plan: planResult, results: executionResults, critique: review };
    }

    retries++;
  }
}

// ============================================================================
// CLI Entry Point
// ============================================================================

async function main() {
  // Single-instance guard
  let lockHandle;
  try {
    if (isLocked('agent-operator')) {
      console.log('[operator] Another instance is already running. Exiting.');
      return;
    }
    lockHandle = acquireLock('agent-operator');
  } catch {
    console.log('[operator] Failed to acquire lock. Exiting.');
    return;
  }

  try {
    // Initialize
    initialize();

    // Get task from command line args
    const args = process.argv.slice(2);

    if (args.length === 0) {
      console.log('[operator] No task specified.');
      console.log('Usage: tsx operator.ts "<task description>"');
      console.log('Example: tsx operator.ts "Search my memories for meetings with Sarah"');
      return;
    }

    const taskGoal = args.join(' ');

    // Run the task
    await runTask({ goal: taskGoal });

    console.log('\n' + '='.repeat(60));
    console.log('[operator] Agent finished.');
    console.log('='.repeat(60) + '\n');
  } catch (error) {
    console.error('[operator] Fatal error:', error);

    audit({
      level: 'error',
      category: 'system',
      event: 'operator_failed',
      details: { error: (error as Error).message },
      actor: 'operator',
    });
  } finally {
    if (lockHandle) {
      lockHandle.release();
    }
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

// Export for programmatic use
export { runTask, plan, execute, critique };
