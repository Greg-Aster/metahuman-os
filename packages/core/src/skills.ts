/**
 * Skills System
 *
 * Provides a sandboxed execution environment for operator skills.
 * All skill executions are validated, audited, and trust-aware.
 */

import fs from 'node:fs';
import path from 'node:path';
import { paths } from './paths';
import { audit } from './audit';
import { getUserContext } from './context.js';
import { filterToolOutputs } from './memory-policy.js';

// ============================================================================
// Types and Interfaces
// ============================================================================

export type SkillCategory = 'fs' | 'memory' | 'agent' | 'shell' | 'network';
export type SkillRisk = 'low' | 'medium' | 'high';
export type SkillCost = 'free' | 'cheap' | 'expensive';
export type TrustLevel = 'observe' | 'suggest' | 'supervised_auto' | 'bounded_auto';
export type InputType = 'string' | 'number' | 'boolean' | 'object' | 'array';

export interface SkillInput {
  type: InputType;
  required: boolean;
  description: string;
  validation?: (value: any) => boolean;
}

export interface SkillOutput {
  type: InputType;
  description: string;
}

export interface SkillManifest {
  id: string;
  name: string;
  description: string;
  category: SkillCategory;

  inputs: Record<string, SkillInput>;
  outputs: Record<string, SkillOutput>;

  risk: SkillRisk;
  cost: SkillCost;
  minTrustLevel: TrustLevel;
  requiresApproval: boolean;

  // Skill-specific constraints
  allowedDirectories?: string[];
  commandWhitelist?: string[];
}

export interface SkillResult {
  success: boolean;
  outputs?: Record<string, any>;
  error?: string;
}

export interface SkillExecution {
  skillId: string;
  inputs: Record<string, any>;
  timestamp: string;
  requiresApproval: boolean;
  approved: boolean;
  approvedBy?: string;
  result?: SkillResult;
}

export interface ApprovalQueueItem {
  id: string;
  skillId: string;
  skillName: string;
  skillDescription: string;
  inputs: Record<string, any>;
  timestamp: string;
  risk: SkillRisk;
  status: 'pending' | 'approved' | 'rejected';
  resolvedAt?: string;
  resolvedBy?: string;
}

// ============================================================================
// Skill Registry
// ============================================================================

const registeredSkills = new Map<string, SkillManifest>();
const skillImplementations = new Map<string, (inputs: any) => Promise<SkillResult>>();

/**
 * Register a skill with the system
 */
export function registerSkill(
  manifest: SkillManifest,
  implementation: (inputs: any) => Promise<SkillResult>
): void {
  registeredSkills.set(manifest.id, manifest);
  skillImplementations.set(manifest.id, implementation);

  audit({
    level: 'info',
    category: 'system',
    event: 'skill_registered',
    details: { skillId: manifest.id, category: manifest.category, risk: manifest.risk },
    actor: 'system',
  });
}

/**
 * Get a skill manifest by ID
 */
export function getSkill(skillId: string): SkillManifest | undefined {
  return registeredSkills.get(skillId);
}

/**
 * List all registered skills
 */
export function listSkills(): SkillManifest[] {
  return Array.from(registeredSkills.values());
}

/**
 * Get skills available at a given trust level
 */
export function getAvailableSkills(trustLevel: TrustLevel): SkillManifest[] {
  const trustLevels: TrustLevel[] = ['observe', 'suggest', 'supervised_auto', 'bounded_auto'];
  const currentIndex = trustLevels.indexOf(trustLevel);

  return listSkills().filter(skill => {
    const requiredIndex = trustLevels.indexOf(skill.minTrustLevel);
    return currentIndex >= requiredIndex;
  });
}

// ============================================================================
// Approval Queue
// ============================================================================

const approvalQueue = new Map<string, ApprovalQueueItem>();

/**
 * Generate a unique ID for an approval queue item
 */
function generateApprovalId(): string {
  return `approval-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Queue a skill execution for approval
 */
export async function queueForApproval(
  skillId: string,
  inputs: Record<string, any>,
  manifest: SkillManifest
): Promise<string> {
  const id = generateApprovalId();
  const item: ApprovalQueueItem = {
    id,
    skillId,
    skillName: manifest.name,
    skillDescription: manifest.description,
    inputs,
    timestamp: new Date().toISOString(),
    risk: manifest.risk,
    status: 'pending',
  };

  approvalQueue.set(id, item);

  // Persist to file system
  const queuePath = path.join(paths.out, 'approval-queue');
  if (!fs.existsSync(queuePath)) {
    fs.mkdirSync(queuePath, { recursive: true });
  }

  const itemPath = path.join(queuePath, `${id}.json`);
  fs.writeFileSync(itemPath, JSON.stringify(item, null, 2));

  return id;
}

/**
 * Get all pending approval items
 */
export function getPendingApprovals(): ApprovalQueueItem[] {
  loadApprovalQueueFromDisk();
  return Array.from(approvalQueue.values()).filter(item => item.status === 'pending');
}

/**
 * Get approval item by ID
 */
export function getApprovalItem(id: string): ApprovalQueueItem | undefined {
  loadApprovalQueueFromDisk();
  return approvalQueue.get(id);
}

/**
 * Approve a queued skill execution
 */
export async function approveSkillExecution(
  id: string,
  approvedBy: string = 'user'
): Promise<SkillResult> {
  const item = getApprovalItem(id);
  if (!item) {
    return { success: false, error: `Approval item '${id}' not found` };
  }

  if (item.status !== 'pending') {
    return { success: false, error: `Approval item '${id}' already ${item.status}` };
  }

  // Update status
  item.status = 'approved';
  item.resolvedAt = new Date().toISOString();
  item.resolvedBy = approvedBy;

  approvalQueue.set(id, item);
  persistApprovalItem(item);

  audit({
    level: 'info',
    category: 'action',
    event: 'skill_approved',
    details: { approvalId: id, skillId: item.skillId, approvedBy },
    actor: approvedBy,
  });

  // Execute the skill
  const manifest = getSkill(item.skillId);
  if (!manifest) {
    return { success: false, error: `Skill '${item.skillId}' not found` };
  }

  const implementation = skillImplementations.get(item.skillId);
  if (!implementation) {
    return { success: false, error: `Skill '${item.skillId}' has no implementation` };
  }

  try {
    const result = await implementation(item.inputs);

    audit({
      level: result.success ? 'info' : 'warn',
      category: 'action',
      event: 'approved_skill_executed',
      details: {
        approvalId: id,
        skillId: item.skillId,
        inputs: item.inputs,
        outputs: result.outputs,
        success: result.success,
        error: result.error,
        approvedBy,
      },
      actor: approvedBy,
    });

    return result;
  } catch (error) {
    audit({
      level: 'error',
      category: 'action',
      event: 'approved_skill_execution_error',
      details: {
        approvalId: id,
        skillId: item.skillId,
        error: (error as Error).message,
      },
      actor: approvedBy,
    });

    return {
      success: false,
      error: `Skill execution failed: ${(error as Error).message}`,
    };
  }
}

/**
 * Reject a queued skill execution
 */
export function rejectSkillExecution(
  id: string,
  rejectedBy: string = 'user'
): { success: boolean; error?: string } {
  const item = getApprovalItem(id);
  if (!item) {
    return { success: false, error: `Approval item '${id}' not found` };
  }

  if (item.status !== 'pending') {
    return { success: false, error: `Approval item '${id}' already ${item.status}` };
  }

  // Update status
  item.status = 'rejected';
  item.resolvedAt = new Date().toISOString();
  item.resolvedBy = rejectedBy;

  approvalQueue.set(id, item);
  persistApprovalItem(item);

  audit({
    level: 'info',
    category: 'action',
    event: 'skill_rejected',
    details: { approvalId: id, skillId: item.skillId, rejectedBy },
    actor: rejectedBy,
  });

  return { success: true };
}

/**
 * Load approval queue from disk
 */
function loadApprovalQueueFromDisk(): void {
  const queuePath = path.join(paths.out, 'approval-queue');
  if (!fs.existsSync(queuePath)) {
    return;
  }

  const files = fs.readdirSync(queuePath).filter(f => f.endsWith('.json'));
  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(queuePath, file), 'utf-8');
      const item: ApprovalQueueItem = JSON.parse(content);
      approvalQueue.set(item.id, item);
    } catch (error) {
      console.warn(`[skills] Failed to load approval item ${file}:`, error);
    }
  }
}

/**
 * Persist an approval item to disk
 */
function persistApprovalItem(item: ApprovalQueueItem): void {
  const queuePath = path.join(paths.out, 'approval-queue');
  if (!fs.existsSync(queuePath)) {
    fs.mkdirSync(queuePath, { recursive: true });
  }

  const itemPath = path.join(queuePath, `${item.id}.json`);
  fs.writeFileSync(itemPath, JSON.stringify(item, null, 2));
}

// ============================================================================
// Sandboxing and Validation
// ============================================================================

/**
 * Check if a path is within allowed directories
 */
export function isPathAllowed(filepath: string, allowedDirs: string[]): boolean {
  // Resolve relative paths against repo root to avoid cwd-dependent behavior
  const normalizedPath = path.isAbsolute(filepath)
    ? path.resolve(filepath)
    : path.resolve(paths.root, filepath);
  const normalizedRoot = path.resolve(paths.root);

  // Must be within metahuman root
  if (!normalizedPath.startsWith(normalizedRoot)) {
    return false;
  }

  // Check against allowed directories
  for (const allowedDir of allowedDirs) {
    const allowedPath = path.resolve(paths.root, allowedDir);
    if (normalizedPath.startsWith(allowedPath)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a file path is writable by the coder agent
 * Coder can write to code directories but NOT to memory/persona/logs
 */
export function isCoderWriteAllowed(filepath: string): boolean {
  const normalizedPath = path.isAbsolute(filepath)
    ? path.resolve(filepath)
    : path.resolve(paths.root, filepath);

  // Explicitly forbidden directories for coder
  const forbidden = ['memory/', 'persona/', 'logs/', 'node_modules/', '.git/'];
  for (const forbiddenDir of forbidden) {
    const forbiddenPath = path.resolve(paths.root, forbiddenDir);
    if (normalizedPath.startsWith(forbiddenPath)) {
      return false;
    }
  }

  // Allowed directories for coder
  const coderWritableDirectories = [
    'apps/',
    'packages/',
    'brain/',
    'docs/',
    'etc/',
    'out/',
    'tests/',
  ];

  return isPathAllowed(filepath, coderWritableDirectories);
}

/**
 * Check if a path is writable by the memory system (more restrictive than readable)
 */
export function isWriteAllowed(filepath: string): boolean {
  const writableDirectories = [
    'memory/episodic',
    'memory/semantic',
    'memory/procedural',
    'memory/tasks',
    'memory/audio',
    'out/',
    'logs/',
  ];

  const normalizedPath = path.isAbsolute(filepath)
    ? path.resolve(filepath)
    : path.resolve(paths.root, filepath);

  // Explicitly forbidden directories
  const forbidden = ['persona/', 'brain/', 'packages/', 'apps/', 'node_modules/', 'etc/'];
  for (const forbiddenDir of forbidden) {
    const forbiddenPath = path.resolve(paths.root, forbiddenDir);
    if (normalizedPath.startsWith(forbiddenPath)) {
      return false;
    }
  }

  return isPathAllowed(filepath, writableDirectories);
}

/**
 * Check if a command is whitelisted
 */
export function isCommandWhitelisted(command: string, whitelist: string[]): boolean {
  const baseCommand = command.split(' ')[0];
  return whitelist.includes(baseCommand);
}

/**
 * Validate skill inputs against manifest
 */
export function validateInputs(manifest: SkillManifest, inputs: Record<string, any>): { valid: boolean; error?: string } {
  // Check required inputs
  for (const [inputName, inputSpec] of Object.entries(manifest.inputs)) {
    if (inputSpec.required && !(inputName in inputs)) {
      return { valid: false, error: `Missing required input: ${inputName}` };
    }

    // Type checking
    if (inputName in inputs) {
      const value = inputs[inputName];
      const expectedType = inputSpec.type;
      const actualType = Array.isArray(value) ? 'array' : typeof value;

      if (actualType !== expectedType) {
        return { valid: false, error: `Input '${inputName}' has wrong type: expected ${expectedType}, got ${actualType}` };
      }

      // Custom validation
      if (inputSpec.validation && !inputSpec.validation(value)) {
        return { valid: false, error: `Input '${inputName}' failed validation` };
      }
    }
  }

  return { valid: true };
}

// ============================================================================
// Skill Execution
// ============================================================================

/**
 * Execute a skill with full validation, auditing, and sandboxing
 *
 * @param skillId - ID of the skill to execute
 * @param inputs - Input parameters for the skill
 * @param trustLevel - Current trust level (affects approval requirements)
 * @param autoApprove - If true, skip approval for non-required skills (testing only)
 * @param policy - Optional security policy to enforce (overrides mode-based checks)
 * @returns Skill execution result
 */
export async function executeSkill(
  skillId: string,
  inputs: Record<string, any>,
  trustLevel: TrustLevel = 'observe',
  autoApprove: boolean = false,
  policy?: any
): Promise<SkillResult> {
  const startTime = Date.now();

  // 1. Get skill manifest
  const manifest = getSkill(skillId);
  if (!manifest) {
    audit({
      level: 'warn',
      category: 'action',
      event: 'skill_execution_failed',
      details: { skillId, error: 'Skill not found' },
      actor: 'operator',
    });
    return { success: false, error: `Skill '${skillId}' not found` };
  }

  // 2. Check trust level
  const availableSkills = getAvailableSkills(trustLevel);
  if (!availableSkills.some(s => s.id === skillId)) {
    audit({
      level: 'warn',
      category: 'security',
      event: 'skill_execution_blocked',
      details: { skillId, trustLevel, minTrustLevel: manifest.minTrustLevel },
      actor: 'operator',
    });
    return {
      success: false,
      error: `Skill '${skillId}' requires trust level '${manifest.minTrustLevel}', current level is '${trustLevel}'`,
    };
  }

  // 3. Validate inputs
  const validation = validateInputs(manifest, inputs);
  if (!validation.valid) {
    audit({
      level: 'warn',
      category: 'action',
      event: 'skill_execution_failed',
      details: { skillId, error: validation.error },
      actor: 'operator',
    });
    return { success: false, error: validation.error };
  }

  // 4. Check security policy for memory-writing skills
  if (policy) {
    // Skills that write to memory/ directories need write permission
    const isMemoryWrite = manifest.allowedDirectories?.some(dir =>
      dir.startsWith('memory/') && (skillId === 'fs_write' || skillId === 'fs_delete')
    );

    if (isMemoryWrite && !policy.canWriteMemory) {
      audit({
        level: 'warn',
        category: 'security',
        event: 'skill_execution_blocked_by_policy',
        details: {
          skillId,
          reason: 'Memory writes not allowed in current mode',
          mode: policy.mode,
          role: policy.role
        },
        actor: 'operator',
      });
      return {
        success: false,
        error: `Skill '${skillId}' blocked: Memory writes not allowed in ${policy.mode} mode`,
      };
    }
  }

  // 5. Check if approval is required
  const requiresApproval = manifest.requiresApproval && !autoApprove;

  if (requiresApproval) {
    // Queue for approval
    const queueId = await queueForApproval(skillId, inputs, manifest);

    audit({
      level: 'info',
      category: 'action',
      event: 'skill_approval_queued',
      details: { skillId, inputs, risk: manifest.risk, queueId },
      actor: 'operator',
    });

    return {
      success: false,
      error: `Skill '${skillId}' queued for approval (ID: ${queueId})`,
    };
  }

  // 5. Execute skill
  const implementation = skillImplementations.get(skillId);
  if (!implementation) {
    return { success: false, error: `Skill '${skillId}' has no implementation` };
  }

  try {
    const result = await implementation(inputs);
    const ctx = getUserContext();
    if (ctx && result.outputs) {
      result.outputs = filterToolOutputs(result.outputs, ctx.role, manifest.id);
    }
    const durationMs = Date.now() - startTime;

    audit({
      level: result.success ? 'info' : 'warn',
      category: 'action',
      event: 'skill_executed',
      details: {
        skillId,
        inputs,
        outputs: result.outputs,
        success: result.success,
        error: result.error,
        durationMs,
        trustLevel,
        requiresApproval,
      },
      actor: 'operator',
    });

    return result;
  } catch (error) {
    const durationMs = Date.now() - startTime;

    audit({
      level: 'error',
      category: 'action',
      event: 'skill_execution_error',
      details: {
        skillId,
        inputs,
        error: (error as Error).message,
        durationMs,
      },
      actor: 'operator',
    });

    return {
      success: false,
      error: `Skill execution failed: ${(error as Error).message}`,
    };
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Load current trust level from persona/decision-rules.json
 */
export function loadTrustLevel(): TrustLevel {
  try {
    const decisionRulesPath = paths.personaDecisionRules;
    const data = fs.readFileSync(decisionRulesPath, 'utf-8');
    const rules = JSON.parse(data);
    // Handle both trustLevel and trust_level for compatibility
    return (rules.trustLevel || rules.trust_level || 'observe') as TrustLevel;
  } catch (error) {
    console.warn('[skills] Could not load trust level, defaulting to observe');
    return 'observe';
  }
}
