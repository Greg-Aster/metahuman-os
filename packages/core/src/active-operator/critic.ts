/**
 * Critic System (Superego)
 *
 * Reviews and validates proposed actions before execution.
 * Provides diff previews, risk assessment, and policy enforcement.
 *
 * The Critic acts as the "superego" in the cognitive architecture:
 * - Reviews file mutations before writing
 * - Evaluates risk levels of proposed actions
 * - Enforces trust policies
 * - Queues high-risk actions for approval
 */

import * as fs from 'fs';
import * as path from 'path';
import { diffLines, createPatch } from 'diff';
import { getProfilePaths, systemPaths, ROOT } from '../paths.js';
import { audit } from '../audit.js';
import { loadTrustLevel, type TrustLevel, type SkillRisk } from '../skills.js';

// ============================================================================
// Types
// ============================================================================

export interface ProposedChange {
  id: string;
  type: 'file_write' | 'file_delete' | 'memory_write' | 'skill_execute' | 'agent_run';
  timestamp: string;
  actor: string;

  // For file operations
  filepath?: string;
  originalContent?: string;
  proposedContent?: string;

  // For skill/agent operations
  skillId?: string;
  agentId?: string;
  inputs?: Record<string, unknown>;

  // Metadata
  reason?: string;
  context?: string;
}

export interface CriticReview {
  proposalId: string;
  timestamp: string;

  // Risk assessment
  riskLevel: SkillRisk;
  riskFactors: string[];

  // Diff info (for file operations)
  diff?: string;
  linesAdded?: number;
  linesRemoved?: number;

  // Decision
  decision: 'approve' | 'reject' | 'require_approval';
  reasoning: string;

  // Policy info
  trustLevel: TrustLevel;
  policyViolations?: string[];
}

export interface ApprovalRequest {
  id: string;
  proposal: ProposedChange;
  review: CriticReview;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
}

// ============================================================================
// Diff Generation
// ============================================================================

/**
 * Generate a unified diff between original and proposed content.
 */
export function generateDiff(
  filepath: string,
  original: string,
  proposed: string
): { diff: string; linesAdded: number; linesRemoved: number } {
  const patch = createPatch(filepath, original, proposed, 'original', 'proposed');

  const changes = diffLines(original, proposed);
  let linesAdded = 0;
  let linesRemoved = 0;

  for (const change of changes) {
    const lineCount = change.value.split('\n').length - 1;
    if (change.added) {
      linesAdded += lineCount;
    } else if (change.removed) {
      linesRemoved += lineCount;
    }
  }

  return { diff: patch, linesAdded, linesRemoved };
}

/**
 * Generate a human-readable diff summary.
 */
export function formatDiffSummary(
  filepath: string,
  linesAdded: number,
  linesRemoved: number
): string {
  const parts: string[] = [`File: ${filepath}`];

  if (linesAdded > 0 && linesRemoved > 0) {
    parts.push(`Changes: +${linesAdded} / -${linesRemoved} lines`);
  } else if (linesAdded > 0) {
    parts.push(`Added: +${linesAdded} lines`);
  } else if (linesRemoved > 0) {
    parts.push(`Removed: -${linesRemoved} lines`);
  } else {
    parts.push('No changes detected');
  }

  return parts.join('\n');
}

// ============================================================================
// Risk Assessment
// ============================================================================

/**
 * Assess the risk level of a proposed change.
 */
export function assessRisk(proposal: ProposedChange): {
  level: SkillRisk;
  factors: string[];
} {
  const factors: string[] = [];
  let level: SkillRisk = 'low';

  // File operations
  if (proposal.type === 'file_write' || proposal.type === 'file_delete') {
    const filepath = proposal.filepath || '';

    // Check for sensitive directories
    if (filepath.includes('persona/')) {
      factors.push('Modifying persona directory');
      level = 'high';
    }
    if (filepath.includes('etc/')) {
      factors.push('Modifying configuration files');
      level = level === 'high' ? 'high' : 'medium';
    }
    if (filepath.includes('brain/')) {
      factors.push('Modifying agent/skill code');
      level = 'high';
    }
    if (filepath.includes('packages/')) {
      factors.push('Modifying core library code');
      level = 'high';
    }

    // Check for large changes
    if (proposal.type === 'file_write' && proposal.proposedContent) {
      const original = proposal.originalContent || '';
      const proposed = proposal.proposedContent;
      const { linesAdded, linesRemoved } = generateDiff(filepath, original, proposed);

      if (linesAdded + linesRemoved > 100) {
        factors.push(`Large change: +${linesAdded} / -${linesRemoved} lines`);
        level = level === 'low' ? 'medium' : level;
      }
    }

    // Deletion is always at least medium risk
    if (proposal.type === 'file_delete') {
      factors.push('File deletion');
      level = level === 'low' ? 'medium' : level;
    }
  }

  // Memory operations
  if (proposal.type === 'memory_write') {
    factors.push('Writing to memory system');
    // Memory writes are generally low risk if within allowed directories
  }

  // Skill/agent operations
  if (proposal.type === 'skill_execute') {
    factors.push(`Executing skill: ${proposal.skillId}`);
    // Risk depends on the specific skill (checked elsewhere)
  }

  if (proposal.type === 'agent_run') {
    factors.push(`Running agent: ${proposal.agentId}`);
    level = level === 'low' ? 'medium' : level;
  }

  return { level, factors };
}

// ============================================================================
// Policy Enforcement
// ============================================================================

/**
 * Check if a proposed change violates any policies.
 */
export function checkPolicies(
  proposal: ProposedChange,
  trustLevel: TrustLevel
): { violations: string[]; canProceed: boolean } {
  const violations: string[] = [];

  const trustHierarchy: TrustLevel[] = [
    'observe',
    'suggest',
    'supervised_auto',
    'bounded_auto',
    'adaptive_auto',
  ];
  const currentIndex = trustHierarchy.indexOf(trustLevel);

  // Observe mode: no mutations allowed
  if (trustLevel === 'observe') {
    if (proposal.type === 'file_write' || proposal.type === 'file_delete') {
      violations.push('File mutations not allowed in observe mode');
    }
    if (proposal.type === 'memory_write') {
      violations.push('Memory writes not allowed in observe mode');
    }
  }

  // Suggest mode: only propose, don't execute
  if (trustLevel === 'suggest') {
    if (proposal.type === 'file_write' || proposal.type === 'file_delete') {
      violations.push('File mutations require approval in suggest mode');
    }
    if (proposal.type === 'agent_run') {
      violations.push('Agent execution requires approval in suggest mode');
    }
  }

  // Supervised auto: can execute low-risk, approval for medium+
  if (trustLevel === 'supervised_auto') {
    const { level } = assessRisk(proposal);
    if (level === 'high') {
      violations.push('High-risk operations require approval in supervised_auto mode');
    }
  }

  // Check forbidden directories regardless of trust level
  if (proposal.filepath) {
    const forbidden = ['.git/', 'node_modules/', '.env'];
    for (const dir of forbidden) {
      if (proposal.filepath.includes(dir)) {
        violations.push(`Access to ${dir} is forbidden`);
      }
    }
  }

  return {
    violations,
    canProceed: violations.length === 0,
  };
}

// ============================================================================
// Critic Review
// ============================================================================

/**
 * Review a proposed change and determine if it should proceed.
 */
export function reviewProposal(proposal: ProposedChange): CriticReview {
  const trustLevel = loadTrustLevel();
  const { level: riskLevel, factors: riskFactors } = assessRisk(proposal);
  const { violations, canProceed } = checkPolicies(proposal, trustLevel);

  // Generate diff for file operations
  let diff: string | undefined;
  let linesAdded: number | undefined;
  let linesRemoved: number | undefined;

  if (proposal.type === 'file_write' && proposal.filepath && proposal.proposedContent) {
    const original = proposal.originalContent || '';
    const diffResult = generateDiff(proposal.filepath, original, proposal.proposedContent);
    diff = diffResult.diff;
    linesAdded = diffResult.linesAdded;
    linesRemoved = diffResult.linesRemoved;
  }

  // Determine decision
  let decision: 'approve' | 'reject' | 'require_approval';
  let reasoning: string;

  if (!canProceed) {
    decision = 'reject';
    reasoning = `Policy violations: ${violations.join('; ')}`;
  } else if (riskLevel === 'high') {
    decision = 'require_approval';
    reasoning = `High-risk operation requires human approval. Factors: ${riskFactors.join('; ')}`;
  } else if (riskLevel === 'medium' && trustLevel !== 'bounded_auto' && trustLevel !== 'adaptive_auto') {
    decision = 'require_approval';
    reasoning = `Medium-risk operation at ${trustLevel} trust level. Factors: ${riskFactors.join('; ')}`;
  } else {
    decision = 'approve';
    reasoning = riskFactors.length > 0
      ? `Auto-approved. Risk factors noted: ${riskFactors.join('; ')}`
      : 'Auto-approved. No significant risk factors.';
  }

  const review: CriticReview = {
    proposalId: proposal.id,
    timestamp: new Date().toISOString(),
    riskLevel,
    riskFactors,
    decision,
    reasoning,
    trustLevel,
    policyViolations: violations.length > 0 ? violations : undefined,
  };

  if (diff !== undefined) {
    review.diff = diff;
    review.linesAdded = linesAdded;
    review.linesRemoved = linesRemoved;
  }

  // Audit the review
  audit({
    category: 'decision',
    level: decision === 'reject' ? 'warn' : 'info',
    event: 'critic_review',
    actor: 'critic',
    details: {
      proposalId: proposal.id,
      proposalType: proposal.type,
      riskLevel,
      decision,
      reasoning,
      trustLevel,
    },
  });

  return review;
}

// ============================================================================
// Approval Queue
// ============================================================================

/**
 * Queue a proposal for human approval.
 */
export function queueForApproval(
  proposal: ProposedChange,
  review: CriticReview,
  username: string
): ApprovalRequest {
  const profilePaths = getProfilePaths(username);
  const queueDir = path.join(profilePaths.state, 'approval-queue');

  if (!fs.existsSync(queueDir)) {
    fs.mkdirSync(queueDir, { recursive: true });
  }

  const request: ApprovalRequest = {
    id: `approval-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    proposal,
    review,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };

  const filepath = path.join(queueDir, `${request.id}.json`);
  fs.writeFileSync(filepath, JSON.stringify(request, null, 2));

  audit({
    category: 'action',
    level: 'info',
    event: 'approval_queued',
    actor: 'critic',
    details: {
      requestId: request.id,
      proposalType: proposal.type,
      riskLevel: review.riskLevel,
    },
  });

  return request;
}

/**
 * Get pending approval requests for a user.
 */
export function getPendingApprovals(username: string): ApprovalRequest[] {
  const profilePaths = getProfilePaths(username);
  const queueDir = path.join(profilePaths.state, 'approval-queue');

  if (!fs.existsSync(queueDir)) {
    return [];
  }

  const requests: ApprovalRequest[] = [];
  const files = fs.readdirSync(queueDir).filter((f) => f.endsWith('.json'));

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(queueDir, file), 'utf-8');
      const request: ApprovalRequest = JSON.parse(content);
      if (request.status === 'pending') {
        requests.push(request);
      }
    } catch {
      // Skip malformed files
    }
  }

  return requests.sort((a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

/**
 * Resolve an approval request.
 */
export function resolveApproval(
  username: string,
  requestId: string,
  approved: boolean,
  resolvedBy: string = 'user'
): ApprovalRequest | null {
  const profilePaths = getProfilePaths(username);
  const filepath = path.join(profilePaths.state, 'approval-queue', `${requestId}.json`);

  if (!fs.existsSync(filepath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(filepath, 'utf-8');
    const request: ApprovalRequest = JSON.parse(content);

    request.status = approved ? 'approved' : 'rejected';
    request.resolvedAt = new Date().toISOString();
    request.resolvedBy = resolvedBy;

    fs.writeFileSync(filepath, JSON.stringify(request, null, 2));

    audit({
      category: 'action',
      level: 'info',
      event: approved ? 'approval_granted' : 'approval_denied',
      actor: resolvedBy,
      details: {
        requestId,
        proposalType: request.proposal.type,
        decision: request.status,
      },
    });

    return request;
  } catch {
    return null;
  }
}

// ============================================================================
// High-Level API
// ============================================================================

/**
 * Submit a proposed change for critic review.
 * Returns the review result and optional approval request.
 */
export function submitForReview(
  proposal: ProposedChange,
  username: string
): { review: CriticReview; approvalRequest?: ApprovalRequest } {
  const review = reviewProposal(proposal);

  if (review.decision === 'require_approval') {
    const approvalRequest = queueForApproval(proposal, review, username);
    return { review, approvalRequest };
  }

  return { review };
}

/**
 * Create a proposal for a file write operation.
 */
export function proposeFileWrite(
  filepath: string,
  newContent: string,
  actor: string,
  reason?: string
): ProposedChange {
  let originalContent = '';
  const fullPath = path.isAbsolute(filepath) ? filepath : path.join(ROOT, filepath);

  if (fs.existsSync(fullPath)) {
    try {
      originalContent = fs.readFileSync(fullPath, 'utf-8');
    } catch {
      // File exists but can't be read
    }
  }

  return {
    id: `proposal-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    type: 'file_write',
    timestamp: new Date().toISOString(),
    actor,
    filepath,
    originalContent,
    proposedContent: newContent,
    reason,
  };
}

/**
 * Create a proposal for a file delete operation.
 */
export function proposeFileDelete(
  filepath: string,
  actor: string,
  reason?: string
): ProposedChange {
  let originalContent = '';
  const fullPath = path.isAbsolute(filepath) ? filepath : path.join(ROOT, filepath);

  if (fs.existsSync(fullPath)) {
    try {
      originalContent = fs.readFileSync(fullPath, 'utf-8');
    } catch {
      // File exists but can't be read
    }
  }

  return {
    id: `proposal-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    type: 'file_delete',
    timestamp: new Date().toISOString(),
    actor,
    filepath,
    originalContent,
    reason,
  };
}
