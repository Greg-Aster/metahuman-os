/**
 * Skill Bootstrap
 *
 * Registers all built-in skills with proper manifests at system startup.
 * This ensures skills have correct cost/risk metadata for policy enforcement.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { ROOT, systemPaths, getProfilePaths } from './paths.js';
import { audit } from './audit.js';
import {
  registerSkill,
  type SkillManifest,
  type SkillResult,
  type TrustLevel,
} from './skills.js';

// ============================================================================
// Skill Manifests
// ============================================================================

const SKILL_MANIFESTS: SkillManifest[] = [
  // File System Skills
  {
    id: 'fs_read',
    name: 'Read File',
    description: 'Read the contents of a file from allowed directories',
    category: 'fs',
    inputs: {
      path: { type: 'string', required: true, description: 'File path to read' },
    },
    outputs: {
      content: { type: 'string', description: 'File contents' },
      size: { type: 'number', description: 'File size in bytes' },
    },
    risk: 'low',
    cost: 'free',
    minTrustLevel: 'observe',
    requiresApproval: false,
    allowedDirectories: ['memory/', 'persona/', 'out/', 'logs/', 'etc/'],
  },
  {
    id: 'fs_write',
    name: 'Write File',
    description: 'Write content to a file in allowed directories',
    category: 'fs',
    inputs: {
      path: { type: 'string', required: true, description: 'File path to write' },
      content: { type: 'string', required: true, description: 'Content to write' },
      append: { type: 'boolean', required: false, description: 'Append instead of overwrite' },
    },
    outputs: {
      success: { type: 'boolean', description: 'Whether write succeeded' },
      bytesWritten: { type: 'number', description: 'Number of bytes written' },
    },
    risk: 'medium',
    cost: 'free',
    minTrustLevel: 'supervised_auto',
    requiresApproval: true,
    allowedDirectories: ['memory/', 'out/', 'persona/desires/'],
  },
  {
    id: 'fs_list',
    name: 'List Directory',
    description: 'List files and directories in a path',
    category: 'fs',
    inputs: {
      path: { type: 'string', required: true, description: 'Directory path to list' },
      recursive: { type: 'boolean', required: false, description: 'List recursively' },
    },
    outputs: {
      entries: { type: 'array', description: 'List of file/directory entries' },
    },
    risk: 'low',
    cost: 'free',
    minTrustLevel: 'observe',
    requiresApproval: false,
    allowedDirectories: ['memory/', 'persona/', 'out/', 'logs/', 'etc/', 'brain/'],
  },

  // Memory Skills
  {
    id: 'search_index',
    name: 'Search Memory',
    description: 'Semantic search across indexed memories',
    category: 'memory',
    inputs: {
      query: { type: 'string', required: true, description: 'Search query' },
      limit: { type: 'number', required: false, description: 'Maximum results (default: 5)' },
      threshold: { type: 'number', required: false, description: 'Similarity threshold (0-1)' },
    },
    outputs: {
      results: { type: 'array', description: 'Search results with similarity scores' },
    },
    risk: 'low',
    cost: 'cheap', // Uses embeddings API
    minTrustLevel: 'observe',
    requiresApproval: false,
  },

  // Task Skills
  {
    id: 'task_list',
    name: 'List Tasks',
    description: 'List active tasks with optional filtering',
    category: 'memory',
    inputs: {
      status: { type: 'string', required: false, description: 'Filter by status' },
      limit: { type: 'number', required: false, description: 'Maximum tasks to return' },
    },
    outputs: {
      tasks: { type: 'array', description: 'List of tasks' },
      count: { type: 'number', description: 'Total task count' },
    },
    risk: 'low',
    cost: 'free',
    minTrustLevel: 'observe',
    requiresApproval: false,
  },
  {
    id: 'task_create',
    name: 'Create Task',
    description: 'Create a new task in the task system',
    category: 'memory',
    inputs: {
      title: { type: 'string', required: true, description: 'Task title' },
      description: { type: 'string', required: false, description: 'Task description' },
      priority: { type: 'string', required: false, description: 'Priority level' },
      dueDate: { type: 'string', required: false, description: 'Due date (ISO format)' },
    },
    outputs: {
      taskId: { type: 'string', description: 'Created task ID' },
      task: { type: 'object', description: 'Full task object' },
    },
    risk: 'low',
    cost: 'free',
    minTrustLevel: 'suggest',
    requiresApproval: false,
  },
  {
    id: 'task_update',
    name: 'Update Task',
    description: 'Update an existing task status or details',
    category: 'memory',
    inputs: {
      taskId: { type: 'string', required: true, description: 'Task ID to update' },
      status: { type: 'string', required: false, description: 'New status' },
      title: { type: 'string', required: false, description: 'New title' },
      description: { type: 'string', required: false, description: 'New description' },
    },
    outputs: {
      success: { type: 'boolean', description: 'Whether update succeeded' },
      task: { type: 'object', description: 'Updated task object' },
    },
    risk: 'low',
    cost: 'free',
    minTrustLevel: 'suggest',
    requiresApproval: false,
  },

  // Network Skills
  {
    id: 'web_search',
    name: 'Web Search',
    description: 'Search the web for information',
    category: 'network',
    inputs: {
      query: { type: 'string', required: true, description: 'Search query' },
      maxResults: { type: 'number', required: false, description: 'Maximum results' },
    },
    outputs: {
      results: { type: 'array', description: 'Search results with title, url, snippet' },
    },
    risk: 'medium',
    cost: 'expensive', // External API call
    minTrustLevel: 'supervised_auto',
    requiresApproval: true,
  },

  // Conversational Skills
  {
    id: 'conversational_response',
    name: 'Generate Response',
    description: 'Generate a conversational response using persona context',
    category: 'agent',
    inputs: {
      context: { type: 'string', required: true, description: 'Conversation context' },
      style: { type: 'string', required: false, description: 'Response style (default, strict, summary)' },
    },
    outputs: {
      response: { type: 'string', description: 'Generated response' },
      tokensUsed: { type: 'number', description: 'Tokens consumed' },
    },
    risk: 'low',
    cost: 'expensive', // LLM call
    minTrustLevel: 'observe',
    requiresApproval: false,
  },
];

// ============================================================================
// Skill Implementations (Stubs - actual logic is in nodes)
// ============================================================================

// These are placeholder implementations. The actual execution happens
// through the node system, but we need implementations registered for
// direct executeSkill() calls.

async function fsReadImpl(inputs: { path: string }): Promise<SkillResult> {
  try {
    const fullPath = path.isAbsolute(inputs.path)
      ? inputs.path
      : path.join(ROOT, inputs.path);
    const content = fs.readFileSync(fullPath, 'utf-8');
    const stats = fs.statSync(fullPath);
    return {
      success: true,
      outputs: { content, size: stats.size },
    };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

async function fsWriteImpl(inputs: { path: string; content: string; append?: boolean }): Promise<SkillResult> {
  try {
    const fullPath = path.isAbsolute(inputs.path)
      ? inputs.path
      : path.join(ROOT, inputs.path);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (inputs.append) {
      fs.appendFileSync(fullPath, inputs.content);
    } else {
      fs.writeFileSync(fullPath, inputs.content);
    }
    return {
      success: true,
      outputs: { success: true, bytesWritten: Buffer.byteLength(inputs.content) },
    };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

async function fsListImpl(inputs: { path: string; recursive?: boolean }): Promise<SkillResult> {
  try {
    const fullPath = path.isAbsolute(inputs.path)
      ? inputs.path
      : path.join(ROOT, inputs.path);
    const entries = fs.readdirSync(fullPath, { withFileTypes: true });
    const result = entries.map((e) => ({
      name: e.name,
      isDirectory: e.isDirectory(),
      path: path.join(inputs.path, e.name),
    }));
    return {
      success: true,
      outputs: { entries: result },
    };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

async function searchIndexImpl(inputs: { query: string; limit?: number }): Promise<SkillResult> {
  try {
    // Dynamic import to avoid circular dependency
    const { queryIndex } = await import('./vector-index.js');
    const results = await queryIndex(inputs.query, { topK: inputs.limit || 5 });
    return {
      success: true,
      outputs: { results },
    };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

async function taskListImpl(inputs: { status?: string; limit?: number }): Promise<SkillResult> {
  try {
    const { listActiveTasks } = await import('./memory.js');
    const tasks = await listActiveTasks();
    let filtered = tasks;
    if (inputs.status) {
      filtered = tasks.filter((t: any) => t.status === inputs.status);
    }
    if (inputs.limit) {
      filtered = filtered.slice(0, inputs.limit);
    }
    return {
      success: true,
      outputs: { tasks: filtered, count: filtered.length },
    };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

async function taskCreateImpl(inputs: { title: string; description?: string; priority?: string }): Promise<SkillResult> {
  try {
    const { createTask } = await import('./memory.js');
    const taskId = createTask(inputs.title, {
      description: inputs.description || '',
      priority: (inputs.priority as any) || 'P2',
    });
    return {
      success: true,
      outputs: { taskId, task: { id: taskId, title: inputs.title } },
    };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

async function taskUpdateImpl(inputs: { taskId: string; status?: string }): Promise<SkillResult> {
  try {
    const { updateTaskStatus } = await import('./memory.js');
    if (inputs.status) {
      await updateTaskStatus(inputs.taskId, inputs.status as any);
    }
    return {
      success: true,
      outputs: { success: true },
    };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

async function webSearchImpl(inputs: { query: string; maxResults?: number }): Promise<SkillResult> {
  // Placeholder - actual implementation would use external search API
  return {
    success: false,
    error: 'Web search requires external API configuration',
  };
}

async function conversationalResponseImpl(inputs: { context: string; style?: string }): Promise<SkillResult> {
  // Placeholder - actual implementation goes through node system
  return {
    success: false,
    error: 'Use the node system for conversational responses',
  };
}

// Map skill IDs to implementations
const SKILL_IMPLEMENTATIONS: Record<string, (inputs: any) => Promise<SkillResult>> = {
  fs_read: fsReadImpl,
  fs_write: fsWriteImpl,
  fs_list: fsListImpl,
  search_index: searchIndexImpl,
  task_list: taskListImpl,
  task_create: taskCreateImpl,
  task_update: taskUpdateImpl,
  web_search: webSearchImpl,
  conversational_response: conversationalResponseImpl,
};

// ============================================================================
// Cost Estimation
// ============================================================================

/**
 * Estimated token costs for skills that use LLM/API
 */
const SKILL_TOKEN_ESTIMATES: Record<string, number> = {
  search_index: 50, // Embedding generation
  web_search: 100, // API call overhead
  conversational_response: 500, // Average LLM response
};

/**
 * Get estimated token cost for a skill execution
 */
export function getSkillCostEstimate(skillId: string): number {
  return SKILL_TOKEN_ESTIMATES[skillId] || 0;
}

/**
 * Check if skill execution is within budget
 */
export function isSkillWithinBudget(skillId: string, currentBudget: number): boolean {
  const estimate = getSkillCostEstimate(skillId);
  return estimate <= currentBudget;
}

// ============================================================================
// Bootstrap Function
// ============================================================================

let bootstrapped = false;

/**
 * Initialize all built-in skills.
 * Should be called at system startup.
 */
export function bootstrapSkills(): void {
  if (bootstrapped) {
    console.log('[skill-bootstrap] Skills already registered');
    return;
  }

  console.log('[skill-bootstrap] Registering built-in skills...');

  for (const manifest of SKILL_MANIFESTS) {
    const implementation = SKILL_IMPLEMENTATIONS[manifest.id];
    if (implementation) {
      registerSkill(manifest, implementation);
      console.log(`[skill-bootstrap] Registered: ${manifest.id} (risk: ${manifest.risk}, cost: ${manifest.cost})`);
    } else {
      console.warn(`[skill-bootstrap] No implementation for skill: ${manifest.id}`);
    }
  }

  bootstrapped = true;

  audit({
    category: 'system',
    level: 'info',
    event: 'skills_bootstrapped',
    actor: 'system',
    details: {
      skillCount: SKILL_MANIFESTS.length,
      skills: SKILL_MANIFESTS.map((m) => m.id),
    },
  });

  console.log(`[skill-bootstrap] Registered ${SKILL_MANIFESTS.length} skills`);
}

/**
 * Get all registered skill manifests
 */
export function getRegisteredSkillManifests(): SkillManifest[] {
  return [...SKILL_MANIFESTS];
}

/**
 * Check if skills have been bootstrapped
 */
export function areSkillsBootstrapped(): boolean {
  return bootstrapped;
}
