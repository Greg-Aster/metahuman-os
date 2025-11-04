/**
 * Specialist Broker
 *
 * Routes tasks to specialized models based on task type.
 * Part of Phase 6: Multi-Specialist Cluster implementation.
 */

import { callLLM, type RouterMessage, type ModelRole } from './model-router.js';
import { audit } from './audit.js';

export type SpecialistType = 'coder' | 'planner' | 'summarizer' | 'curator';

export interface SpecialistTask {
  type: SpecialistType;
  description: string;
  context?: string;
  input: string;
  options?: {
    temperature?: number;
    maxTokens?: number;
  };
}

export interface SpecialistResult {
  specialist: SpecialistType;
  output: string;
  modelId: string;
  latencyMs: number;
  tokens?: {
    prompt: number;
    completion: number;
    total: number;
  };
}

/**
 * Route a task to the appropriate specialist model
 */
export async function routeToSpecialist(
  task: SpecialistTask,
  actor = 'orchestrator'
): Promise<SpecialistResult> {
  const startTime = Date.now();

  audit({
    level: 'info',
    category: 'action',
    event: 'specialist_task_routed',
    actor,
    details: {
      specialist: task.type,
      description: task.description,
      inputLength: task.input.length,
    },
  });

  // Build system prompt based on specialist type
  const systemPrompt = getSpecialistSystemPrompt(task.type, task.description);

  // Prepare messages
  const messages: RouterMessage[] = [
    {
      role: 'system',
      content: systemPrompt,
    },
  ];

  if (task.context) {
    messages.push({
      role: 'system',
      content: `Context:\n${task.context}`,
    });
  }

  messages.push({
    role: 'user',
    content: task.input,
  });

  // Call the specialist model
  try {
    const response = await callLLM({
      role: task.type as ModelRole,
      messages,
      options: task.options || {},
    });

    const latencyMs = Date.now() - startTime;

    audit({
      level: 'info',
      category: 'action',
      event: 'specialist_task_completed',
      actor: task.type,
      details: {
        specialist: task.type,
        modelId: response.modelId,
        latencyMs,
        tokens: response.tokens,
        outputLength: response.content.length,
      },
    });

    return {
      specialist: task.type,
      output: response.content,
      modelId: response.modelId,
      latencyMs,
      tokens: response.tokens,
    };
  } catch (error) {
    const latencyMs = Date.now() - startTime;

    audit({
      level: 'error',
      category: 'system',
      event: 'specialist_task_failed',
      actor: task.type,
      details: {
        specialist: task.type,
        error: (error as Error).message,
        latencyMs,
      },
    });

    throw error;
  }
}

/**
 * Execute multiple specialist tasks in parallel
 */
export async function routeToSpecialistsParallel(
  tasks: SpecialistTask[],
  actor = 'orchestrator'
): Promise<SpecialistResult[]> {
  audit({
    level: 'info',
    category: 'action',
    event: 'parallel_specialist_tasks_started',
    actor,
    details: {
      taskCount: tasks.length,
      specialists: tasks.map(t => t.type),
    },
  });

  const startTime = Date.now();

  try {
    // Execute all tasks in parallel
    const results = await Promise.all(
      tasks.map(task => routeToSpecialist(task, actor))
    );

    const totalLatency = Date.now() - startTime;

    audit({
      level: 'info',
      category: 'action',
      event: 'parallel_specialist_tasks_completed',
      actor,
      details: {
        taskCount: tasks.length,
        totalLatencyMs: totalLatency,
        maxIndividualLatency: Math.max(...results.map(r => r.latencyMs)),
        specialists: results.map(r => r.specialist),
      },
    });

    return results;
  } catch (error) {
    const totalLatency = Date.now() - startTime;

    audit({
      level: 'error',
      category: 'system',
      event: 'parallel_specialist_tasks_failed',
      actor,
      details: {
        taskCount: tasks.length,
        error: (error as Error).message,
        totalLatencyMs: totalLatency,
      },
    });

    throw error;
  }
}

/**
 * Get system prompt for a specialist type
 */
function getSpecialistSystemPrompt(type: SpecialistType, taskDescription: string): string {
  const prompts: Record<SpecialistType, string> = {
    coder: `You are a code generation and review specialist.
Your expertise: Writing clean, efficient, well-documented code in multiple languages.
Task: ${taskDescription}

Guidelines:
- Follow best practices and design patterns
- Include clear comments and documentation
- Consider edge cases and error handling
- Provide complete, runnable code when possible
- Explain your implementation choices`,

    planner: `You are a strategic planning and task decomposition specialist.
Your expertise: Breaking down complex problems into actionable steps.
Task: ${taskDescription}

Guidelines:
- Create clear, sequential plans
- Identify dependencies between steps
- Consider resources and constraints
- Provide realistic time estimates when possible
- Flag potential risks or blockers`,

    summarizer: `You are a document and conversation summarization specialist.
Your expertise: Condensing information while preserving key points and context.
Task: ${taskDescription}

Guidelines:
- Extract the most important information
- Maintain accuracy and context
- Use clear, concise language
- Organize information logically
- Highlight key takeaways`,

    curator: `You are a memory curation and training data preparation specialist.
Your expertise: Extracting clean, structured data from raw information.
Task: ${taskDescription}

Guidelines:
- Remove technical artifacts and noise
- Preserve conversational essence
- Extract structured data when appropriate
- Flag sensitive information
- Maintain context and meaning`,
  };

  return prompts[type];
}

/**
 * Detect specialist type from task description
 */
export function detectSpecialistType(taskDescription: string): SpecialistType | null {
  const description = taskDescription.toLowerCase();

  // Code-related keywords
  if (
    /\b(code|program|function|class|implement|debug|refactor|test|algorithm)\b/.test(description)
  ) {
    return 'coder';
  }

  // Planning-related keywords
  if (
    /\b(plan|strategy|roadmap|breakdown|steps|approach|organize|structure)\b/.test(description)
  ) {
    return 'planner';
  }

  // Summarization-related keywords
  if (
    /\b(summarize|condense|brief|overview|digest|extract|key points|highlights)\b/.test(description)
  ) {
    return 'summarizer';
  }

  // Curation-related keywords
  if (
    /\b(curate|clean|prepare|extract|training|dataset|memories)\b/.test(description)
  ) {
    return 'curator';
  }

  // No clear match
  return null;
}

/**
 * Helper: Route a code generation task
 */
export async function generateCode(
  language: string,
  description: string,
  context?: string
): Promise<string> {
  const result = await routeToSpecialist({
    type: 'coder',
    description: `Generate ${language} code: ${description}`,
    context,
    input: description,
    options: {
      temperature: 0.2, // Lower temperature for more deterministic code
    },
  });

  return result.output;
}

/**
 * Helper: Route a planning task
 */
export async function createPlan(
  goal: string,
  constraints?: string
): Promise<string> {
  const contextStr = constraints ? `Constraints: ${constraints}` : undefined;

  const result = await routeToSpecialist({
    type: 'planner',
    description: 'Create strategic plan',
    context: contextStr,
    input: goal,
    options: {
      temperature: 0.4, // Moderate temperature for creative planning
    },
  });

  return result.output;
}

/**
 * Helper: Route a summarization task
 */
export async function summarizeText(
  text: string,
  maxLength?: number
): Promise<string> {
  const lengthConstraint = maxLength
    ? `Summarize in approximately ${maxLength} words or less.`
    : 'Summarize concisely.';

  const result = await routeToSpecialist({
    type: 'summarizer',
    description: lengthConstraint,
    input: text,
    options: {
      temperature: 0.3, // Lower temperature for factual summarization
    },
  });

  return result.output;
}
