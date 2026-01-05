/**
 * Operator Proposals System
 *
 * Human-in-the-Loop (HITL) approval system for autonomous operator decisions.
 * Instead of executing tasks immediately, the operator creates proposals that
 * appear in the chat feed for user approval.
 *
 * This enables:
 * 1. User involvement in every autonomous decision
 * 2. Preference learning from approvals/rejections
 * 3. Training data collection for RLHF-style fine-tuning
 */

import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import { getProfilePaths } from '../paths.js';
import { audit } from '../audit.js';
import { captureEventWithDetails } from '../memory.js';
import { setUserContext, clearUserContext } from '../context.js';

/**
 * Event emitter for proposal lifecycle events.
 * Allows the active operator loop to wake immediately when proposals are resolved
 * instead of polling on a fixed interval.
 */
export const proposalEvents = new EventEmitter();

// Event types:
// - 'proposal-resolved': Emitted when a proposal is approved/rejected (payload: { username, proposalId, response })
// - 'proposal-created': Emitted when a new proposal is created (payload: { username, proposalId, taskType })

/**
 * Trust levels and their approval behavior.
 *
 * observe:        Log intent only, no proposals shown, no execution
 * suggest:        Always require approval before execution
 * supervised_auto: Auto-approve low-risk, ask for medium/high
 * bounded_auto:   Auto-approve low/medium, ask for high only
 * adaptive_auto:  Auto-approve all, but still collect post-execution feedback
 */
export type TrustLevel =
  | 'observe'
  | 'suggest'
  | 'supervised_auto'
  | 'bounded_auto'
  | 'adaptive_auto';

/**
 * Risk level for a task type.
 */
export type TaskRisk = 'low' | 'medium' | 'high';

/**
 * Risk mapping for task types.
 * This determines approval requirements at different trust levels.
 */
export const TASK_RISK_LEVELS: Record<ProposalTaskType, TaskRisk> = {
  reflect: 'low',           // Internal thought, no external effects
  dream: 'low',             // Internal, creative process
  curiosity: 'low',         // Questions shown to user
  inner_curiosity: 'low',   // Internal Q&A
  memory_curate: 'medium',  // Modifies memory organization
  desire_generate: 'low',   // Creates desires, doesn't execute
  desire_execute: 'high',   // External actions, high impact
  psychoanalyze: 'medium',  // Modifies persona understanding
  custom: 'high',           // Unknown, assume high risk
};

/**
 * Types of operator tasks that can be proposed.
 */
export type ProposalTaskType =
  | 'reflect'
  | 'dream'
  | 'curiosity'
  | 'inner_curiosity'
  | 'memory_curate'
  | 'desire_generate'
  | 'desire_execute'
  | 'psychoanalyze'
  | 'custom';

/**
 * User response to a proposal.
 */
export type ProposalResponse = 'approved' | 'rejected' | 'modified';

/**
 * An operator proposal awaiting user approval.
 */
export interface OperatorProposal {
  id: string;
  createdAt: string;
  expiresAt?: string;

  // What the operator wants to do
  taskType: ProposalTaskType;
  taskDescription: string;
  reasoning: string;

  // Context that led to this proposal
  context: {
    cycleNumber?: number;
    triggerSource: string; // e.g., "lizard_brain", "schedule", "user_activity"
    systemState?: Record<string, unknown>;
    relevantMemories?: string[];
  };

  // Status
  status: 'pending' | 'approved' | 'rejected' | 'expired' | 'executed';
  respondedAt?: string;
  response?: ProposalResponse;
  userInput?: string; // Custom input if user modified the proposal

  // Execution tracking
  executedAt?: string;
  executionResult?: {
    success: boolean;
    summary?: string;
    error?: string;
  };

  // Post-execution feedback tracking
  postFeedbackReceived?: boolean;
}

/**
 * Training feedback entry derived from proposal responses.
 */
export interface ProposalFeedback {
  id: string;
  timestamp: string;
  proposalId: string;

  // The proposal details
  taskType: ProposalTaskType;
  taskDescription: string;
  reasoning: string;

  // User's response
  response: ProposalResponse;
  userInput?: string;

  // Context for training
  context: {
    timeOfDay: string;
    dayOfWeek: string;
    hoursSinceLastInteraction?: number;
    recentActivityTypes?: string[];
  };

  // For reinforcement tracking
  reinforcementSignal: 1 | 0 | -1; // approved=1, modified=0, rejected=-1
}

/**
 * Proposal statistics for learning.
 */
export interface ProposalStats {
  taskType: ProposalTaskType;
  totalProposed: number;
  approved: number;
  rejected: number;
  modified: number;
  approvalRate: number;
  lastProposedAt?: string;
  lastApprovedAt?: string;
}

// =============================================================================
// Storage Functions
// =============================================================================

function getProposalsDir(username: string): string {
  const profilePaths = getProfilePaths(username);
  return path.join(profilePaths.state, 'operator-proposals');
}

function getFeedbackDir(username: string): string {
  const profilePaths = getProfilePaths(username);
  return path.join(profilePaths.state, 'operator-feedback');
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// =============================================================================
// Proposal CRUD
// =============================================================================

/**
 * Create a new operator proposal.
 * This is called by the Lizard Brain when it wants to execute a task.
 */
export function createProposal(
  username: string,
  taskType: ProposalTaskType,
  taskDescription: string,
  reasoning: string,
  context: OperatorProposal['context']
): OperatorProposal {
  const proposalsDir = getProposalsDir(username);
  ensureDir(proposalsDir);

  const proposal: OperatorProposal = {
    id: `prop-${randomUUID().slice(0, 8)}`,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24h expiry
    taskType,
    taskDescription,
    reasoning,
    context,
    status: 'pending',
  };

  const filePath = path.join(proposalsDir, `${proposal.id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(proposal, null, 2));

  audit({
    category: 'system',
    level: 'info',
    event: 'operator_proposal_created',
    actor: 'lizard-brain',
    details: {
      proposalId: proposal.id,
      taskType,
      taskDescription,
      username,
    },
  });

  return proposal;
}

/**
 * Get all pending proposals for a user.
 */
export function getPendingProposals(username: string): OperatorProposal[] {
  const proposalsDir = getProposalsDir(username);
  if (!fs.existsSync(proposalsDir)) {
    return [];
  }

  const proposals: OperatorProposal[] = [];
  const files = fs.readdirSync(proposalsDir).filter((f) => f.endsWith('.json'));
  const now = new Date();

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(proposalsDir, file), 'utf-8');
      const proposal = JSON.parse(content) as OperatorProposal;

      // Check if expired
      if (proposal.expiresAt && new Date(proposal.expiresAt) < now) {
        if (proposal.status === 'pending') {
          proposal.status = 'expired';
          fs.writeFileSync(
            path.join(proposalsDir, file),
            JSON.stringify(proposal, null, 2)
          );
        }
        continue;
      }

      if (proposal.status === 'pending') {
        proposals.push(proposal);
      }
    } catch {
      // Skip malformed files
    }
  }

  // Sort by creation time, newest first
  return proposals.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Get task types that have pending proposals.
 * Used by the Lizard Brain to skip tasks awaiting user approval.
 */
export function getPendingProposalTaskTypes(username: string): ProposalTaskType[] {
  const pending = getPendingProposals(username);
  const taskTypes = new Set<ProposalTaskType>();

  for (const proposal of pending) {
    taskTypes.add(proposal.taskType);
  }

  return Array.from(taskTypes);
}

/**
 * Check if a specific task type has a pending proposal.
 */
export function hasPendingProposalForTask(username: string, taskType: ProposalTaskType): boolean {
  const pending = getPendingProposals(username);
  return pending.some(p => p.taskType === taskType);
}

/**
 * Get a specific proposal by ID.
 */
export function getProposal(username: string, proposalId: string): OperatorProposal | null {
  const proposalsDir = getProposalsDir(username);
  const filePath = path.join(proposalsDir, `${proposalId}.json`);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as OperatorProposal;
  } catch {
    return null;
  }
}

/**
 * Respond to a proposal (approve, reject, or modify).
 * This captures the user's feedback for training.
 */
export function respondToProposal(
  username: string,
  proposalId: string,
  response: ProposalResponse,
  userInput?: string
): OperatorProposal | null {
  const proposalsDir = getProposalsDir(username);
  const filePath = path.join(proposalsDir, `${proposalId}.json`);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const proposal = JSON.parse(content) as OperatorProposal;

    if (proposal.status !== 'pending') {
      return null; // Already responded
    }

    // Update proposal
    proposal.status = response === 'approved' ? 'approved' : 'rejected';
    proposal.response = response;
    proposal.respondedAt = new Date().toISOString();
    if (userInput) {
      proposal.userInput = userInput;
    }

    fs.writeFileSync(filePath, JSON.stringify(proposal, null, 2));

    // Record feedback for training
    recordFeedback(username, proposal, response, userInput);

    audit({
      category: 'system',
      level: 'info',
      event: 'operator_proposal_responded',
      actor: username,
      details: {
        proposalId,
        taskType: proposal.taskType,
        response,
        hasUserInput: !!userInput,
      },
    });

    // Emit event to wake up the active operator loop immediately
    proposalEvents.emit('proposal-resolved', {
      username,
      proposalId,
      response,
      taskType: proposal.taskType,
    });

    return proposal;
  } catch {
    return null;
  }
}

/**
 * Mark a proposal as executed after successful task completion.
 */
export function markProposalExecuted(
  username: string,
  proposalId: string,
  result: OperatorProposal['executionResult']
): boolean {
  const proposalsDir = getProposalsDir(username);
  const filePath = path.join(proposalsDir, `${proposalId}.json`);

  if (!fs.existsSync(filePath)) {
    return false;
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const proposal = JSON.parse(content) as OperatorProposal;

    proposal.status = 'executed';
    proposal.executedAt = new Date().toISOString();
    proposal.executionResult = result;

    fs.writeFileSync(filePath, JSON.stringify(proposal, null, 2));

    audit({
      category: 'system',
      level: 'info',
      event: 'operator_proposal_executed',
      actor: 'lizard-brain',
      details: {
        proposalId,
        taskType: proposal.taskType,
        success: result?.success ?? false,
      },
    });

    return true;
  } catch {
    return false;
  }
}

// =============================================================================
// Feedback & Training Data
// =============================================================================

/**
 * Record feedback for training purposes.
 * This creates training data that can be used for RLHF-style fine-tuning.
 *
 * Feedback is stored in two places:
 * 1. Daily JSON files in state/operator-feedback/ (for stats and export)
 * 2. Episodic memory as 'operator_feedback' events (for LoRA training)
 */
function recordFeedback(
  username: string,
  proposal: OperatorProposal,
  response: ProposalResponse,
  userInput?: string
): void {
  const feedbackDir = getFeedbackDir(username);
  ensureDir(feedbackDir);

  const now = new Date();
  const reinforcementSignal = response === 'approved' ? 1 : response === 'rejected' ? -1 : 0;
  const feedbackId = `fb-${randomUUID().slice(0, 8)}`;

  const feedback: ProposalFeedback = {
    id: feedbackId,
    timestamp: now.toISOString(),
    proposalId: proposal.id,
    taskType: proposal.taskType,
    taskDescription: proposal.taskDescription,
    reasoning: proposal.reasoning,
    response,
    userInput,
    context: {
      timeOfDay: getTimeOfDay(now),
      dayOfWeek: now.toLocaleDateString('en-US', { weekday: 'long' }),
    },
    reinforcementSignal,
  };

  // Store in daily feedback file (for stats/export)
  const dateStr = now.toISOString().split('T')[0];
  const feedbackFile = path.join(feedbackDir, `${dateStr}.json`);

  let feedbackList: ProposalFeedback[] = [];
  if (fs.existsSync(feedbackFile)) {
    try {
      feedbackList = JSON.parse(fs.readFileSync(feedbackFile, 'utf-8'));
    } catch {
      feedbackList = [];
    }
  }

  feedbackList.push(feedback);
  fs.writeFileSync(feedbackFile, JSON.stringify(feedbackList, null, 2));

  // Also save as episodic memory for LoRA training
  // Format the content for training: shows what was proposed and how user responded
  const responseEmoji = response === 'approved' ? '✅' : response === 'rejected' ? '❌' : '✏️';
  const memoryContent = userInput
    ? `${responseEmoji} User modified proposal: "${proposal.taskDescription}"\n` +
      `Original reasoning: ${proposal.reasoning}\n` +
      `User's input: ${userInput}`
    : `${responseEmoji} User ${response} proposal: "${proposal.taskDescription}"\n` +
      `Reasoning: ${proposal.reasoning}`;

  // Set user context for memory capture
  try {
    setUserContext(username, username, 'standard');

    captureEventWithDetails(memoryContent, {
      type: 'operator_feedback',
      tags: [
        'operator-feedback',
        'training-data',
        `feedback-${response}`,
        `task-${proposal.taskType}`,
        reinforcementSignal === 1 ? 'positive' : reinforcementSignal === -1 ? 'negative' : 'neutral',
      ],
      metadata: {
        // Feedback-specific metadata
        proposalId: proposal.id,
        feedbackId,
        taskType: proposal.taskType,
        response,
        userInput,
        reinforcementSignal,
        // Context for training
        timeOfDay: getTimeOfDay(now),
        dayOfWeek: now.toLocaleDateString('en-US', { weekday: 'long' }),
        // Mark as training data
        isTrainingData: true,
        feedbackType: 'proposal_response',
      },
      importance: response === 'rejected' ? 0.9 : response === 'modified' ? 0.8 : 0.6,
    });
  } finally {
    clearUserContext();
  }

  console.log(
    `[operator-proposals] Recorded feedback: ${proposal.taskType} → ${response}` +
      (userInput ? ` (with input)` : '') +
      ' [saved to memory]'
  );
}

function getTimeOfDay(date: Date): string {
  const hour = date.getHours();
  if (hour < 6) return 'night';
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  if (hour < 21) return 'evening';
  return 'night';
}

/**
 * Get feedback entries for a date range.
 */
export function getFeedback(
  username: string,
  startDate?: Date,
  endDate?: Date
): ProposalFeedback[] {
  const feedbackDir = getFeedbackDir(username);
  if (!fs.existsSync(feedbackDir)) {
    return [];
  }

  const files = fs.readdirSync(feedbackDir).filter((f) => f.endsWith('.json'));
  const allFeedback: ProposalFeedback[] = [];

  for (const file of files) {
    const dateStr = file.replace('.json', '');
    const fileDate = new Date(dateStr);

    // Filter by date range if provided
    if (startDate && fileDate < startDate) continue;
    if (endDate && fileDate > endDate) continue;

    try {
      const content = fs.readFileSync(path.join(feedbackDir, file), 'utf-8');
      const feedback = JSON.parse(content) as ProposalFeedback[];
      allFeedback.push(...feedback);
    } catch {
      // Skip malformed files
    }
  }

  return allFeedback.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

/**
 * Get proposal statistics for learning and UI display.
 */
export function getProposalStats(username: string): ProposalStats[] {
  const feedback = getFeedback(username);
  const statsByTask = new Map<ProposalTaskType, ProposalStats>();

  for (const fb of feedback) {
    let stats = statsByTask.get(fb.taskType);
    if (!stats) {
      stats = {
        taskType: fb.taskType,
        totalProposed: 0,
        approved: 0,
        rejected: 0,
        modified: 0,
        approvalRate: 0,
      };
      statsByTask.set(fb.taskType, stats);
    }

    stats.totalProposed++;
    if (fb.response === 'approved') {
      stats.approved++;
      stats.lastApprovedAt = fb.timestamp;
    } else if (fb.response === 'rejected') {
      stats.rejected++;
    } else {
      stats.modified++;
    }
    stats.lastProposedAt = fb.timestamp;
  }

  // Calculate approval rates
  for (const stats of statsByTask.values()) {
    stats.approvalRate =
      stats.totalProposed > 0
        ? (stats.approved + stats.modified * 0.5) / stats.totalProposed
        : 0;
  }

  return Array.from(statsByTask.values()).sort(
    (a, b) => b.totalProposed - a.totalProposed
  );
}

/**
 * Get the approval rate for a specific task type.
 * Used by the decision engine to adjust proposal likelihood.
 */
export function getTaskApprovalRate(
  username: string,
  taskType: ProposalTaskType
): number {
  const stats = getProposalStats(username);
  const taskStats = stats.find((s) => s.taskType === taskType);
  return taskStats?.approvalRate ?? 0.5; // Default to 50% if no data
}

/**
 * Export feedback as training data format.
 * This can be used to fine-tune the model on user preferences.
 */
export function exportTrainingData(
  username: string,
  format: 'jsonl' | 'conversations' = 'conversations'
): string {
  const feedback = getFeedback(username);

  if (format === 'jsonl') {
    // JSONL format for direct training
    return feedback
      .map((fb) => {
        const entry = {
          prompt: `The system wants to: ${fb.taskDescription}\n\nReasoning: ${fb.reasoning}`,
          response: fb.response,
          userInput: fb.userInput,
          reinforcement: fb.reinforcementSignal,
        };
        return JSON.stringify(entry);
      })
      .join('\n');
  }

  // Conversation format for chat fine-tuning
  const conversations = feedback.map((fb) => ({
    messages: [
      {
        role: 'assistant',
        content: `I'd like to ${fb.taskDescription.toLowerCase()}.\n\n**Reasoning:** ${fb.reasoning}\n\nDo you approve?`,
      },
      {
        role: 'user',
        content:
          fb.response === 'approved'
            ? 'Yes, go ahead.'
            : fb.response === 'rejected'
              ? "No, don't do that."
              : `Instead, ${fb.userInput}`,
      },
    ],
    metadata: {
      taskType: fb.taskType,
      response: fb.response,
      reinforcement: fb.reinforcementSignal,
      timestamp: fb.timestamp,
    },
  }));

  return JSON.stringify(conversations, null, 2);
}

// =============================================================================
// Cleanup
// =============================================================================

/**
 * Clean up old proposals and feedback.
 */
export function cleanupOldProposals(username: string, retentionDays: number = 30): void {
  const proposalsDir = getProposalsDir(username);
  if (!fs.existsSync(proposalsDir)) return;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);

  const files = fs.readdirSync(proposalsDir).filter((f) => f.endsWith('.json'));

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(proposalsDir, file), 'utf-8');
      const proposal = JSON.parse(content) as OperatorProposal;

      if (new Date(proposal.createdAt) < cutoff && proposal.status !== 'pending') {
        fs.unlinkSync(path.join(proposalsDir, file));
      }
    } catch {
      // Skip
    }
  }
}

// =============================================================================
// Trust-Based Approval Logic
// =============================================================================

/**
 * Determine if a task requires user approval based on trust level and task risk.
 *
 * Returns:
 * - 'require_approval': Must show proposal and wait for user response
 * - 'auto_approve': Can execute immediately, but collect post-execution feedback
 * - 'observe_only': Log the intent but don't execute or show proposal
 */
export function getApprovalRequirement(
  username: string,
  taskType: ProposalTaskType
): 'require_approval' | 'auto_approve' | 'observe_only' {
  let trustLevel: TrustLevel = 'suggest'; // Default to safest interactive mode

  // Read trust level directly from user's profile
  try {
    const profilePaths = getProfilePaths(username);
    const rulesPath = path.join(profilePaths.persona, 'decision-rules.json');
    if (fs.existsSync(rulesPath)) {
      const content = fs.readFileSync(rulesPath, 'utf-8');
      const rules = JSON.parse(content);
      trustLevel = rules.trustLevel as TrustLevel;
    }
  } catch {
    // Use default
  }

  const taskRisk = TASK_RISK_LEVELS[taskType] || 'high';

  // Matrix of trust level × task risk → approval requirement
  switch (trustLevel) {
    case 'observe':
      // Never execute, just log
      return 'observe_only';

    case 'suggest':
      // Always require approval for everything
      return 'require_approval';

    case 'supervised_auto':
      // Auto-approve low risk, ask for medium/high
      return taskRisk === 'low' ? 'auto_approve' : 'require_approval';

    case 'bounded_auto':
      // Auto-approve low/medium, ask for high
      return taskRisk === 'high' ? 'require_approval' : 'auto_approve';

    case 'adaptive_auto':
      // Auto-approve everything, but still collect feedback
      return 'auto_approve';

    default:
      return 'require_approval';
  }
}

/**
 * Get the current trust level for a user.
 */
export function getUserTrustLevel(username: string): TrustLevel {
  try {
    const profilePaths = getProfilePaths(username);
    const rulesPath = path.join(profilePaths.persona, 'decision-rules.json');
    if (fs.existsSync(rulesPath)) {
      const content = fs.readFileSync(rulesPath, 'utf-8');
      const rules = JSON.parse(content);
      return rules.trustLevel as TrustLevel;
    }
  } catch {
    // Use default
  }
  return 'suggest';
}

// =============================================================================
// Post-Execution Feedback
// =============================================================================

/**
 * Post-execution feedback entry.
 * Collected after a task completes to learn from outcomes.
 */
export interface PostExecutionFeedback {
  id: string;
  timestamp: string;
  proposalId: string;
  taskType: ProposalTaskType;

  // Execution details
  executionResult: {
    success: boolean;
    summary?: string;
    error?: string;
  };

  // User feedback on the outcome
  userRating?: 'good' | 'neutral' | 'bad';
  userComment?: string;

  // Learning signals
  reinforcementSignal: 1 | 0 | -1; // good=1, neutral=0, bad=-1
  shouldRepeat: boolean; // Would user want this to happen again?
}

function getPostFeedbackDir(username: string): string {
  const profilePaths = getProfilePaths(username);
  return path.join(profilePaths.state, 'operator-post-feedback');
}

/**
 * Create a request for post-execution feedback.
 * This is shown to the user after a task completes.
 */
export interface PostFeedbackRequest {
  id: string;
  proposalId: string;
  taskType: ProposalTaskType;
  taskDescription: string;
  executedAt: string;
  executionResult: {
    success: boolean;
    summary?: string;
    error?: string;
  };
  status: 'pending' | 'received';
  /** The full proposal object (for UI compatibility) */
  proposal: OperatorProposal;
}

/**
 * Get pending post-execution feedback requests.
 */
export function getPendingPostFeedback(username: string): PostFeedbackRequest[] {
  const proposalsDir = getProposalsDir(username);
  if (!fs.existsSync(proposalsDir)) {
    return [];
  }

  const requests: PostFeedbackRequest[] = [];
  const files = fs.readdirSync(proposalsDir).filter((f) => f.endsWith('.json'));

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(proposalsDir, file), 'utf-8');
      const proposal = JSON.parse(content) as OperatorProposal;

      // Find executed proposals without post-feedback
      if (
        proposal.status === 'executed' &&
        proposal.executedAt &&
        !proposal.postFeedbackReceived
      ) {
        // Only show feedback requests for recent executions (last 24 hours)
        const executedAt = new Date(proposal.executedAt);
        const hoursSinceExecution = (Date.now() - executedAt.getTime()) / (1000 * 60 * 60);

        if (hoursSinceExecution < 24) {
          requests.push({
            id: `pfb-${proposal.id}`,
            proposalId: proposal.id,
            taskType: proposal.taskType,
            taskDescription: proposal.taskDescription,
            executedAt: proposal.executedAt,
            executionResult: proposal.executionResult || { success: false },
            status: 'pending',
            proposal, // Include full proposal for UI compatibility
          });
        }
      }
    } catch {
      // Skip malformed files
    }
  }

  return requests.sort((a, b) => b.executedAt.localeCompare(a.executedAt));
}

/**
 * Submit post-execution feedback.
 * This is called when the user rates how a task execution went.
 */
export function submitPostFeedback(
  username: string,
  proposalId: string,
  rating: 'good' | 'neutral' | 'bad',
  comment?: string
): boolean {
  const proposalsDir = getProposalsDir(username);
  const proposalPath = path.join(proposalsDir, `${proposalId}.json`);

  if (!fs.existsSync(proposalPath)) {
    return false;
  }

  try {
    const content = fs.readFileSync(proposalPath, 'utf-8');
    const proposal = JSON.parse(content) as OperatorProposal & { postFeedbackReceived?: boolean };

    if (proposal.status !== 'executed') {
      return false;
    }

    // Mark as received
    proposal.postFeedbackReceived = true;
    fs.writeFileSync(proposalPath, JSON.stringify(proposal, null, 2));

    // Save the feedback
    const feedbackDir = getPostFeedbackDir(username);
    ensureDir(feedbackDir);

    const feedback: PostExecutionFeedback = {
      id: `post-${randomUUID().slice(0, 8)}`,
      timestamp: new Date().toISOString(),
      proposalId: proposal.id,
      taskType: proposal.taskType,
      executionResult: proposal.executionResult || { success: false },
      userRating: rating,
      userComment: comment,
      reinforcementSignal: rating === 'good' ? 1 : rating === 'bad' ? -1 : 0,
      shouldRepeat: rating === 'good',
    };

    // Store in daily file
    const dateStr = new Date().toISOString().split('T')[0];
    const feedbackFile = path.join(feedbackDir, `${dateStr}.json`);

    let feedbackList: PostExecutionFeedback[] = [];
    if (fs.existsSync(feedbackFile)) {
      try {
        feedbackList = JSON.parse(fs.readFileSync(feedbackFile, 'utf-8'));
      } catch {
        feedbackList = [];
      }
    }

    feedbackList.push(feedback);
    fs.writeFileSync(feedbackFile, JSON.stringify(feedbackList, null, 2));

    // Save as episodic memory for LoRA training
    const ratingEmoji = rating === 'good' ? '👍' : rating === 'bad' ? '👎' : '🤷';
    const resultEmoji = proposal.executionResult?.success ? '✅' : '❌';
    const memoryContent = comment
      ? `${ratingEmoji} Post-execution feedback for "${proposal.taskDescription}":\n` +
        `Result: ${resultEmoji} ${proposal.executionResult?.success ? 'Success' : 'Failed'}\n` +
        `Rating: ${rating}\n` +
        `Comment: ${comment}`
      : `${ratingEmoji} Post-execution feedback: "${proposal.taskDescription}" → ${rating}\n` +
        `Result: ${resultEmoji} ${proposal.executionResult?.success ? 'Success' : 'Failed'}`;

    try {
      setUserContext(username, username, 'standard');

      captureEventWithDetails(memoryContent, {
        type: 'operator_feedback',
        tags: [
          'operator-feedback',
          'post-execution',
          'training-data',
          `rating-${rating}`,
          `task-${proposal.taskType}`,
          feedback.reinforcementSignal === 1 ? 'positive' : feedback.reinforcementSignal === -1 ? 'negative' : 'neutral',
        ],
        metadata: {
          proposalId: proposal.id,
          feedbackId: feedback.id,
          taskType: proposal.taskType,
          rating,
          userComment: comment,
          reinforcementSignal: feedback.reinforcementSignal,
          executionSuccess: proposal.executionResult?.success,
          // Mark as training data
          isTrainingData: true,
          feedbackType: 'post_execution',
        },
        importance: rating === 'bad' ? 0.9 : rating === 'good' ? 0.7 : 0.5,
      });
    } finally {
      clearUserContext();
    }

    audit({
      category: 'system',
      level: 'info',
      event: 'operator_post_feedback_received',
      actor: username,
      details: {
        proposalId,
        taskType: proposal.taskType,
        rating,
        hasComment: !!comment,
      },
    });

    console.log(
      `[operator-proposals] Post-execution feedback: ${proposal.taskType} → ${rating}` +
        (comment ? ` "${comment}"` : '') +
        ' [saved to memory]'
    );

    return true;
  } catch {
    return false;
  }
}

/**
 * Get post-execution feedback for analysis.
 */
export function getPostFeedbackStats(username: string): {
  taskType: ProposalTaskType;
  totalExecutions: number;
  goodRatings: number;
  neutralRatings: number;
  badRatings: number;
  repeatRate: number;
}[] {
  const feedbackDir = getPostFeedbackDir(username);
  if (!fs.existsSync(feedbackDir)) {
    return [];
  }

  const allFeedback: PostExecutionFeedback[] = [];
  const files = fs.readdirSync(feedbackDir).filter((f) => f.endsWith('.json'));

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(feedbackDir, file), 'utf-8');
      allFeedback.push(...JSON.parse(content));
    } catch {
      // Skip
    }
  }

  const statsByTask = new Map<
    ProposalTaskType,
    { total: number; good: number; neutral: number; bad: number }
  >();

  for (const fb of allFeedback) {
    let stats = statsByTask.get(fb.taskType);
    if (!stats) {
      stats = { total: 0, good: 0, neutral: 0, bad: 0 };
      statsByTask.set(fb.taskType, stats);
    }

    stats.total++;
    if (fb.userRating === 'good') stats.good++;
    else if (fb.userRating === 'neutral') stats.neutral++;
    else if (fb.userRating === 'bad') stats.bad++;
  }

  return Array.from(statsByTask.entries()).map(([taskType, stats]) => ({
    taskType,
    totalExecutions: stats.total,
    goodRatings: stats.good,
    neutralRatings: stats.neutral,
    badRatings: stats.bad,
    repeatRate: stats.total > 0 ? stats.good / stats.total : 0,
  }));
}

// =============================================================================
// Combined Training Data Export
// =============================================================================

/**
 * Export all feedback (approval + post-execution) as training data.
 * This provides a complete picture for preference learning.
 */
export function exportAllTrainingData(username: string): {
  approvalFeedback: ProposalFeedback[];
  postExecutionFeedback: PostExecutionFeedback[];
  summary: {
    totalApprovalEvents: number;
    totalPostEvents: number;
    overallApprovalRate: number;
    overallSatisfactionRate: number;
  };
} {
  const approvalFeedback = getFeedback(username);
  const postStats = getPostFeedbackStats(username);

  // Load post-execution feedback
  const postFeedbackDir = getPostFeedbackDir(username);
  const postExecutionFeedback: PostExecutionFeedback[] = [];

  if (fs.existsSync(postFeedbackDir)) {
    const files = fs.readdirSync(postFeedbackDir).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(postFeedbackDir, file), 'utf-8');
        postExecutionFeedback.push(...JSON.parse(content));
      } catch {
        // Skip
      }
    }
  }

  // Calculate summary stats
  const approvalCount = approvalFeedback.filter((f) => f.response === 'approved').length;
  const goodCount = postExecutionFeedback.filter((f) => f.userRating === 'good').length;

  return {
    approvalFeedback,
    postExecutionFeedback,
    summary: {
      totalApprovalEvents: approvalFeedback.length,
      totalPostEvents: postExecutionFeedback.length,
      overallApprovalRate:
        approvalFeedback.length > 0 ? approvalCount / approvalFeedback.length : 0,
      overallSatisfactionRate:
        postExecutionFeedback.length > 0 ? goodCount / postExecutionFeedback.length : 0,
    },
  };
}

// ============================================================================
// Big Brother Execution Review
// ============================================================================

/**
 * Result of a Big Brother execution review.
 */
export interface ExecutionReviewResult {
  success: boolean;
  analysis?: string;
  suggestions?: string[];
  improvementOpportunities?: string[];
  codeChangeRecommended?: boolean;
  reasoning?: string;
  error?: string;
  /** Reasoning steps captured during Big Brother execution */
  reasoningSteps?: Array<{
    type: 'thought' | 'action' | 'observation' | 'result' | 'tool_use';
    content: string;
    timestamp: string;
    toolName?: string;
  }>;
}

/**
 * Trigger Big Brother to review a task execution.
 * This provides analysis and suggestions for improvement that can lead to code changes.
 */
export async function triggerBigBrotherExecutionReview(
  username: string,
  proposalId: string
): Promise<ExecutionReviewResult> {
  const proposal = getProposal(username, proposalId);
  if (!proposal || proposal.status !== 'executed') {
    return { success: false, error: 'Proposal not found or not executed' };
  }

  // Load operator config to check if Big Brother is enabled
  const { loadOperatorConfig } = await import('../config.js');
  const operatorConfig = loadOperatorConfig(username);

  if (!operatorConfig.bigBrotherMode?.enabled) {
    return { success: false, error: 'Big Brother mode is not enabled' };
  }

  // Build context for review
  const reviewContext = `
## Task Execution Review Request

### Task Details
- **Type**: ${proposal.taskType}
- **Description**: ${proposal.taskDescription}
- **Reasoning**: ${proposal.reasoning}

### Execution Result
- **Success**: ${proposal.executionResult?.success ? 'Yes' : 'No'}
- **Summary**: ${proposal.executionResult?.summary || 'N/A'}
${proposal.executionResult?.error ? `- **Error**: ${proposal.executionResult.error}` : ''}

### Context
- **Trigger Source**: ${proposal.context.triggerSource}
- **Cycle Number**: ${proposal.context.cycleNumber || 'N/A'}

### Review Goals
1. Analyze whether the task execution was effective
2. Identify any patterns or issues in the execution
3. Suggest improvements to the task handler or decision logic
4. Determine if code changes would help future executions
`;

  try {
    const { escalateToBigBrother } = await import('../big-brother.js');

    const result = await escalateToBigBrother(
      {
        goal: `Review task execution and suggest improvements for MetaHuman OS`,
        stuckReason: 'execution_review',
        errorType: proposal.executionResult?.success ? null : 'repeated_failures',
        scratchpad: [
          {
            type: 'thought',
            content: `Reviewing execution of ${proposal.taskType}: ${proposal.taskDescription}`,
            timestamp: proposal.createdAt,
          },
          {
            type: 'observation',
            success: proposal.executionResult?.success ?? false,
            content: proposal.executionResult?.summary || 'No summary available',
            timestamp: proposal.executedAt || new Date().toISOString(),
          },
        ],
        context: {
          userId: username, // For conversation buffer attribution
          reviewType: 'execution_review',
          taskType: proposal.taskType,
          taskDescription: proposal.taskDescription,
          executionSuccess: proposal.executionResult?.success,
          reviewContext,
        },
        suggestions: [
          'Analyze the execution result',
          'Identify what worked well and what could be improved',
          'Suggest specific code improvements if applicable',
          'Recommend configuration changes if needed',
        ],
      },
      operatorConfig
    );

    if (result.success) {
      // Parse suggestions from reasoning
      const suggestions: string[] = [];
      const improvementOpportunities: string[] = [];

      if (result.reasoning) {
        suggestions.push(result.reasoning);
      }
      if (result.alternativeApproach) {
        improvementOpportunities.push(result.alternativeApproach);
      }

      // Check if code changes are recommended
      const codeChangeRecommended = result.reasoning?.toLowerCase().includes('code') ||
        result.alternativeApproach?.toLowerCase().includes('code') ||
        result.reasoning?.toLowerCase().includes('implement') ||
        result.reasoning?.toLowerCase().includes('modify');

      audit({
        category: 'system',
        level: 'info',
        event: 'big_brother_execution_review',
        actor: username,
        details: {
          proposalId,
          taskType: proposal.taskType,
          success: true,
          codeChangeRecommended,
        },
      });

      return {
        success: true,
        analysis: result.reasoning,
        suggestions,
        improvementOpportunities,
        codeChangeRecommended,
        reasoning: result.reasoning,
        reasoningSteps: result.reasoningSteps, // Include reasoning steps for UI
      };
    } else {
      return {
        success: false,
        error: result.error || 'Big Brother review failed',
      };
    }
  } catch (error) {
    console.error('[operator-proposals] Big Brother review error:', error);
    return {
      success: false,
      error: (error as Error).message,
    };
  }
}

/**
 * Submit an improvement request based on user feedback.
 * This creates a coding request that Big Brother + System Coder can work on.
 */
export async function submitImprovementRequest(
  username: string,
  proposalId: string,
  userInput: string,
  context?: {
    rating?: 'good' | 'neutral' | 'bad';
    bigBrotherAnalysis?: string;
  }
): Promise<{ success: boolean; requestId?: string; error?: string }> {
  const proposal = getProposal(username, proposalId);
  if (!proposal) {
    return { success: false, error: 'Proposal not found' };
  }

  try {
    // Import System Coder request functionality
    const { createCodingRequest } = await import('../system-coder/coding-requests.js');

    // Build a detailed request
    const requestDescription = `
## User Improvement Request

**Task Type**: ${proposal.taskType}
**Task Description**: ${proposal.taskDescription}

### Execution Context
- Success: ${proposal.executionResult?.success ? 'Yes' : 'No'}
- Error: ${proposal.executionResult?.error || 'None'}

### User Feedback
**Rating**: ${context?.rating || 'Not provided'}
**User Input**: ${userInput}

${context?.bigBrotherAnalysis ? `### Big Brother Analysis\n${context.bigBrotherAnalysis}` : ''}

### Request
Please implement the improvements suggested by the user to enhance the ${proposal.taskType} task execution.
`;

    const request = createCodingRequest(username, {
      type: 'feature',
      description: requestDescription,
      context: JSON.stringify({
        proposalId,
        taskType: proposal.taskType,
        userInput,
        rating: context?.rating,
        executionResult: proposal.executionResult,
      }),
    });

    audit({
      category: 'action',
      level: 'info',
      event: 'improvement_request_created',
      actor: username,
      details: {
        proposalId,
        requestId: request.id,
        taskType: proposal.taskType,
        hasUserInput: true,
      },
    });

    console.log(`[operator-proposals] Created improvement request ${request.id} from user feedback`);

    return {
      success: true,
      requestId: request.id,
    };
  } catch (error) {
    console.error('[operator-proposals] Failed to create improvement request:', error);
    return {
      success: false,
      error: (error as Error).message,
    };
  }
}
