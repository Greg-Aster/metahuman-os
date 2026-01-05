/**
 * Help Ticket Types
 *
 * When users provide negative feedback, the system creates help tickets
 * that can be reviewed and addressed by the Lizard Brain / System Coder.
 */

export type TicketStatus =
  | 'new'              // Just created from negative feedback
  | 'reviewing'        // Lizard Brain is analyzing
  | 'needs_fix'        // Confirmed issue, needs code fix
  | 'needs_training'   // Personality/response issue, needs training adjustment
  | 'investigating'    // Requires more context or analysis
  | 'fix_proposed'     // System Coder has proposed a fix
  | 'fix_approved'     // User approved the fix
  | 'resolved'         // Issue has been addressed
  | 'wont_fix'         // Intentional behavior or out of scope
  | 'duplicate';       // Already tracked by another ticket

export type TicketCategory =
  | 'response_quality'  // Bad response content/tone
  | 'memory_issue'      // Memory retrieval or storage problem
  | 'personality_drift' // Acting out of character
  | 'task_failure'      // Failed to complete a task
  | 'system_error'      // Technical error or bug
  | 'performance'       // Slow or unresponsive
  | 'other';            // Uncategorized

export type TicketPriority = 'low' | 'medium' | 'high' | 'critical';

export interface HelpTicket {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: TicketStatus;

  // Feedback context
  feedbackRating: -1;  // Always negative (that's why ticket was created)
  feedbackComment?: string;
  feedbackTargetType: 'conversation' | 'task' | 'memory';
  feedbackTargetId?: string;

  // Classification (may be updated during review)
  category?: TicketCategory;
  priority: TicketPriority;

  // Analysis
  llmAnalysis?: {
    analyzedAt: string;
    summary: string;
    rootCause?: string;
    suggestedCategory: TicketCategory;
    suggestedPriority: TicketPriority;
    proposedSolution?: string;
    suggestedFix?: string;  // Specific fix suggestion
    relatedFiles?: string[];
    requiresCodeChange: boolean;
    requiresTrainingChange: boolean;
    isNotActionable?: boolean;  // Issue cannot be fixed
    notActionableReason?: string;  // Why it's not actionable
  };

  // Resolution
  resolution?: {
    resolvedAt: string;
    resolvedBy: 'system_coder' | 'training_update' | 'manual' | 'wont_fix';
    summary: string;
    fixId?: string;  // Reference to ProposedFix if code change
    desireId?: string;  // Reference to Desire if training/personality change
  };

  // Audit trail
  history: TicketHistoryEntry[];
}

export interface TicketHistoryEntry {
  timestamp: string;
  action: string;
  actor: 'user' | 'lizard_brain' | 'system_coder' | 'system';
  details?: Record<string, unknown>;
}

export interface TicketSummary {
  total: number;
  byStatus: Record<TicketStatus, number>;
  byCategory: Record<TicketCategory, number>;
  byPriority: Record<TicketPriority, number>;
  newCount: number;
  needsAttention: number;  // new + reviewing + needs_fix + investigating
}

// Task type for Lizard Brain
export type HelpTicketTaskType = 'help_ticket_review';

// Trigger result for Lizard Brain
export interface HelpTicketTriggerResult {
  shouldRun: boolean;
  reason: string;
  ticketCount: number;
  urgentCount: number;
}
