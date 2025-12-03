/**
 * Policy Enforcement Engine
 *
 * Determines what actions are allowed based on:
 * - Current trust level
 * - Skill risk level
 * - Action type (read vs write)
 * - Target resources (files, commands, etc.)
 */

import { TrustLevel, SkillRisk, SkillManifest } from './skills.js';
import { audit } from './audit.js';

// ============================================================================
// Types
// ============================================================================

export interface PolicyDecision {
  allowed: boolean;
  requiresApproval: boolean;
  reason?: string;
}

export interface ActionContext {
  skillId: string;
  trustLevel: TrustLevel;
  inputs: Record<string, any>;
  manifest: SkillManifest;
}

// ============================================================================
// Trust Level Hierarchy
// ============================================================================

const TRUST_HIERARCHY: Record<TrustLevel, number> = {
  observe: 0,
  suggest: 1,
  supervised_auto: 2,
  bounded_auto: 3,
  adaptive_auto: 4,
};

/**
 * Check if current trust level meets minimum requirement
 */
export function meetsMinimumTrust(current: TrustLevel, required: TrustLevel): boolean {
  return TRUST_HIERARCHY[current] >= TRUST_HIERARCHY[required];
}

// ============================================================================
// Policy Rules
// ============================================================================

/**
 * Evaluate if an action is allowed based on trust level and skill manifest
 */
export function evaluatePolicy(context: ActionContext): PolicyDecision {
  const { manifest, trustLevel } = context;

  // Rule 1: Check minimum trust level
  if (!meetsMinimumTrust(trustLevel, manifest.minTrustLevel)) {
    return {
      allowed: false,
      requiresApproval: false,
      reason: `Trust level '${trustLevel}' insufficient for skill '${manifest.id}' (requires '${manifest.minTrustLevel}')`,
    };
  }

  // Rule 2: Skills that always require approval
  if (manifest.requiresApproval) {
    return {
      allowed: true,
      requiresApproval: true,
      reason: `Skill '${manifest.id}' requires approval (risk: ${manifest.risk})`,
    };
  }

  // Rule 3: High-risk actions always require approval regardless of trust
  if (manifest.risk === 'high') {
    return {
      allowed: true,
      requiresApproval: true,
      reason: `High-risk action requires approval`,
    };
  }

  // Rule 4: Medium-risk actions require approval below supervised_auto
  if (manifest.risk === 'medium' && !meetsMinimumTrust(trustLevel, 'supervised_auto')) {
    return {
      allowed: true,
      requiresApproval: true,
      reason: `Medium-risk action requires approval at trust level '${trustLevel}'`,
    };
  }

  // Rule 5: Write operations always require approval (except in bounded_auto)
  if (manifest.category === 'fs' && manifest.id === 'fs_write') {
    return {
      allowed: true,
      requiresApproval: true,
      reason: `Write operations require approval`,
    };
  }

  // Rule 6: Agent execution requires approval
  if (manifest.category === 'agent') {
    return {
      allowed: true,
      requiresApproval: true,
      reason: `Agent execution requires approval`,
    };
  }

  // Rule 7: Shell commands require approval
  if (manifest.category === 'shell') {
    return {
      allowed: true,
      requiresApproval: true,
      reason: `Shell commands require approval`,
    };
  }

  // Default: Allow without approval
  return {
    allowed: true,
    requiresApproval: false,
  };
}

// ============================================================================
// Resource-Specific Policies
// ============================================================================

/**
 * Check if a file path is allowed for reading
 */
export function isReadAllowed(filepath: string): boolean {
  const allowedPrefixes = [
    '/memory/',
    '/persona/',
    '/logs/',
    '/out/',
    '/etc/',
    '/docs/',
  ];

  const deniedPrefixes = [
    '/brain/',
    '/packages/',
    '/apps/',
    '/node_modules/',
    '/.git/',
  ];

  // Check denied first
  for (const prefix of deniedPrefixes) {
    if (filepath.includes(prefix)) {
      return false;
    }
  }

  // Check allowed
  for (const prefix of allowedPrefixes) {
    if (filepath.includes(prefix)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a file path is allowed for writing
 */
export function isWriteAllowedPolicy(filepath: string): boolean {
  const allowedPrefixes = [
    '/memory/episodic',
    '/memory/semantic',
    '/memory/procedural',
    '/memory/tasks',
    '/memory/audio',
    '/out/',
    '/logs/',
  ];

  const deniedPrefixes = [
    '/persona/',
    '/brain/',
    '/packages/',
    '/apps/',
    '/node_modules/',
    '/etc/',
    '/.git/',
  ];

  // Check denied first (explicit deny)
  for (const prefix of deniedPrefixes) {
    if (filepath.includes(prefix)) {
      return false;
    }
  }

  // Check allowed
  for (const prefix of allowedPrefixes) {
    if (filepath.includes(prefix)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a command is allowed
 */
export function isCommandAllowed(command: string): boolean {
  const whitelist = [
    'ls',
    'cat',
    'grep',
    'find',
    'git',
    'pnpm',
    'node',
    'tsx',
    'pwd',
    'whoami',
  ];

  const baseCommand = command.split(' ')[0];
  return whitelist.includes(baseCommand);
}

// ============================================================================
// Approval Queue (Future Implementation)
// ============================================================================

export interface PendingAction {
  id: string;
  skillId: string;
  inputs: Record<string, any>;
  context: ActionContext;
  timestamp: string;
  status: 'pending' | 'approved' | 'rejected';
  approvedBy?: string;
  rejectedReason?: string;
}

const approvalQueue: PendingAction[] = [];

/**
 * Add an action to the approval queue
 */
export function queueForApproval(context: ActionContext): string {
  const id = `approval-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  const action: PendingAction = {
    id,
    skillId: context.skillId,
    inputs: context.inputs,
    context,
    timestamp: new Date().toISOString(),
    status: 'pending',
  };

  approvalQueue.push(action);

  audit({
    level: 'info',
    category: 'security',
    event: 'action_queued_for_approval',
    details: {
      approvalId: id,
      skillId: context.skillId,
      risk: context.manifest.risk,
    },
    actor: 'operator',
  });

  return id;
}

/**
 * Get pending approvals
 */
export function getPendingApprovals(): PendingAction[] {
  return approvalQueue.filter(a => a.status === 'pending');
}

/**
 * Approve an action
 */
export function approveAction(id: string, approvedBy: string = 'human'): boolean {
  const action = approvalQueue.find(a => a.id === id);
  if (!action || action.status !== 'pending') {
    return false;
  }

  action.status = 'approved';
  action.approvedBy = approvedBy;

  audit({
    level: 'info',
    category: 'security',
    event: 'action_approved',
    details: {
      approvalId: id,
      skillId: action.skillId,
      approvedBy,
    },
    actor: approvedBy,
  });

  return true;
}

/**
 * Reject an action
 */
export function rejectAction(id: string, reason?: string, rejectedBy: string = 'human'): boolean {
  const action = approvalQueue.find(a => a.id === id);
  if (!action || action.status !== 'pending') {
    return false;
  }

  action.status = 'rejected';
  action.rejectedReason = reason;

  audit({
    level: 'info',
    category: 'security',
    event: 'action_rejected',
    details: {
      approvalId: id,
      skillId: action.skillId,
      reason,
      rejectedBy,
    },
    actor: rejectedBy,
  });

  return true;
}

/**
 * Get an action from the queue
 */
export function getAction(id: string): PendingAction | undefined {
  return approvalQueue.find(a => a.id === id);
}

// ============================================================================
// Policy Helpers
// ============================================================================

/**
 * Check if operator can auto-execute a skill
 */
export function canAutoExecute(manifest: SkillManifest, trustLevel: TrustLevel): boolean {
  const decision = evaluatePolicy({
    skillId: manifest.id,
    trustLevel,
    inputs: {},
    manifest,
  });

  return decision.allowed && !decision.requiresApproval;
}

/**
 * Get allowed skills for a trust level with auto-execute status
 */
export function getAllowedSkills(
  skills: SkillManifest[],
  trustLevel: TrustLevel
): Array<{ skill: SkillManifest; autoExecute: boolean }> {
  return skills
    .filter(skill => meetsMinimumTrust(trustLevel, skill.minTrustLevel))
    .map(skill => ({
      skill,
      autoExecute: canAutoExecute(skill, trustLevel),
    }));
}
