/**
 * Help Ticket System
 *
 * Manages help tickets created from negative user feedback.
 * Integrates with Lizard Brain for periodic review and System Coder for fixes.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { getProfilePaths } from '../path-builder.js';
import { generateId } from '../paths.js';
import { audit } from '../audit.js';
import type {
  HelpTicket,
  TicketStatus,
  TicketCategory,
  TicketPriority,
  TicketSummary,
  TicketHistoryEntry,
  HelpTicketTriggerResult,
} from './types.js';

export * from './types.js';

const TICKETS_DIR = 'help-tickets';

/**
 * Get the directory path for help tickets
 */
function getTicketsDir(username: string): string {
  const profilePaths = getProfilePaths(username);
  return path.join(profilePaths.state, TICKETS_DIR);
}

/**
 * Ensure the tickets directory exists
 */
function ensureTicketsDir(username: string): string {
  const dir = getTicketsDir(username);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Create a new help ticket from negative feedback
 */
export function createHelpTicket(
  username: string,
  feedbackComment: string | undefined,
  feedbackTargetType: 'conversation' | 'task' | 'memory',
  feedbackTargetId?: string,
): HelpTicket {
  const dir = ensureTicketsDir(username);
  const id = generateId('ticket');
  const now = new Date().toISOString();

  const ticket: HelpTicket = {
    id,
    createdAt: now,
    updatedAt: now,
    status: 'new',
    feedbackRating: -1,
    feedbackComment,
    feedbackTargetType,
    feedbackTargetId,
    priority: 'medium',  // Default, may be updated during analysis
    history: [{
      timestamp: now,
      action: 'created',
      actor: 'user',
      details: {
        comment: feedbackComment,
        targetType: feedbackTargetType,
        targetId: feedbackTargetId,
      },
    }],
  };

  const ticketPath = path.join(dir, `${id}.json`);
  fs.writeFileSync(ticketPath, JSON.stringify(ticket, null, 2));

  audit({
    category: 'action',
    level: 'info',
    event: 'help_ticket_created',
    actor: username,
    details: {
      ticketId: id,
      targetType: feedbackTargetType,
      hasComment: !!feedbackComment,
    },
  });

  return ticket;
}

/**
 * Load a specific ticket
 */
export function getTicket(username: string, ticketId: string): HelpTicket | null {
  const dir = getTicketsDir(username);
  const ticketPath = path.join(dir, `${ticketId}.json`);

  if (!fs.existsSync(ticketPath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(ticketPath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Update a ticket
 */
export function updateTicket(
  username: string,
  ticketId: string,
  updates: Partial<HelpTicket>,
  actor: TicketHistoryEntry['actor'] = 'system',
  actionDescription?: string,
): HelpTicket | null {
  const ticket = getTicket(username, ticketId);
  if (!ticket) return null;

  const now = new Date().toISOString();

  // Apply updates
  const updated: HelpTicket = {
    ...ticket,
    ...updates,
    id: ticket.id,  // Never change ID
    createdAt: ticket.createdAt,  // Never change created date
    updatedAt: now,
    history: [
      ...ticket.history,
      {
        timestamp: now,
        action: actionDescription || `updated: ${Object.keys(updates).join(', ')}`,
        actor,
        details: updates,
      },
    ],
  };

  const dir = getTicketsDir(username);
  const ticketPath = path.join(dir, `${ticketId}.json`);
  fs.writeFileSync(ticketPath, JSON.stringify(updated, null, 2));

  return updated;
}

/**
 * List all tickets for a user
 */
export function listTickets(
  username: string,
  filter?: {
    status?: TicketStatus | TicketStatus[];
    category?: TicketCategory;
    priority?: TicketPriority;
  },
): HelpTicket[] {
  const dir = getTicketsDir(username);

  if (!fs.existsSync(dir)) {
    return [];
  }

  const tickets: HelpTicket[] = [];
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));

  for (const file of files) {
    try {
      const ticket: HelpTicket = JSON.parse(
        fs.readFileSync(path.join(dir, file), 'utf-8')
      );

      // Apply filters
      if (filter) {
        if (filter.status) {
          const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
          if (!statuses.includes(ticket.status)) continue;
        }
        if (filter.category && ticket.category !== filter.category) continue;
        if (filter.priority && ticket.priority !== filter.priority) continue;
      }

      tickets.push(ticket);
    } catch {
      // Skip invalid files
    }
  }

  // Sort by priority (critical > high > medium > low) then by date
  const priorityOrder: Record<TicketPriority, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };

  return tickets.sort((a, b) => {
    const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (priorityDiff !== 0) return priorityDiff;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

/**
 * Get tickets that need attention (for Lizard Brain trigger)
 */
export function getPendingTickets(username: string): HelpTicket[] {
  return listTickets(username, {
    status: ['new', 'reviewing', 'needs_fix', 'investigating'],
  });
}

/**
 * Get summary statistics for tickets
 */
export function getTicketSummary(username: string): TicketSummary {
  const tickets = listTickets(username);

  const byStatus: Record<TicketStatus, number> = {
    new: 0,
    reviewing: 0,
    needs_fix: 0,
    needs_training: 0,
    investigating: 0,
    fix_proposed: 0,
    fix_approved: 0,
    resolved: 0,
    wont_fix: 0,
    duplicate: 0,
  };

  const byCategory: Record<TicketCategory, number> = {
    response_quality: 0,
    memory_issue: 0,
    personality_drift: 0,
    task_failure: 0,
    system_error: 0,
    performance: 0,
    other: 0,
  };

  const byPriority: Record<TicketPriority, number> = {
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  };

  for (const ticket of tickets) {
    byStatus[ticket.status]++;
    byPriority[ticket.priority]++;
    if (ticket.category) {
      byCategory[ticket.category]++;
    }
  }

  const needsAttention = byStatus.new + byStatus.reviewing + byStatus.needs_fix + byStatus.investigating;

  return {
    total: tickets.length,
    byStatus,
    byCategory,
    byPriority,
    newCount: byStatus.new,
    needsAttention,
  };
}

/**
 * Check if help ticket review should run (for Lizard Brain trigger)
 */
export function shouldReviewTickets(username: string): HelpTicketTriggerResult {
  const pending = getPendingTickets(username);
  const newTickets = pending.filter(t => t.status === 'new');
  const urgentTickets = pending.filter(t =>
    t.priority === 'critical' || t.priority === 'high'
  );

  // Run if:
  // 1. Any urgent tickets exist
  // 2. More than 3 new tickets
  // 3. Any tickets older than 24 hours in 'new' status
  const oldTickets = newTickets.filter(t => {
    const age = Date.now() - new Date(t.createdAt).getTime();
    return age > 24 * 60 * 60 * 1000;  // 24 hours
  });

  const shouldRun = urgentTickets.length > 0 ||
                    newTickets.length > 3 ||
                    oldTickets.length > 0;

  let reason = 'No urgent tickets';
  if (urgentTickets.length > 0) {
    reason = `${urgentTickets.length} urgent ticket(s) need attention`;
  } else if (newTickets.length > 3) {
    reason = `${newTickets.length} new tickets accumulated`;
  } else if (oldTickets.length > 0) {
    reason = `${oldTickets.length} ticket(s) older than 24 hours`;
  }

  return {
    shouldRun,
    reason,
    ticketCount: pending.length,
    urgentCount: urgentTickets.length,
  };
}

/**
 * Mark a ticket as being reviewed
 */
export function startTicketReview(username: string, ticketId: string): HelpTicket | null {
  return updateTicket(
    username,
    ticketId,
    { status: 'reviewing' },
    'lizard_brain',
    'started review'
  );
}

/**
 * Save LLM analysis results to a ticket
 */
export function saveTicketAnalysis(
  username: string,
  ticketId: string,
  analysis: HelpTicket['llmAnalysis'],
): HelpTicket | null {
  const updates: Partial<HelpTicket> = {
    llmAnalysis: analysis,
    category: analysis?.suggestedCategory,
    priority: analysis?.suggestedPriority || 'medium',
    status: analysis?.requiresCodeChange ? 'needs_fix' :
            analysis?.requiresTrainingChange ? 'needs_training' : 'investigating',
  };

  return updateTicket(
    username,
    ticketId,
    updates,
    'lizard_brain',
    'completed analysis'
  );
}

/**
 * Resolve a ticket
 */
export function resolveTicket(
  username: string,
  ticketId: string,
  resolution: HelpTicket['resolution'],
): HelpTicket | null {
  return updateTicket(
    username,
    ticketId,
    {
      status: 'resolved',
      resolution,
    },
    'system',
    'resolved'
  );
}

/**
 * Mark a ticket as won't fix
 */
export function wontFixTicket(
  username: string,
  ticketId: string,
  reason: string,
): HelpTicket | null {
  return updateTicket(
    username,
    ticketId,
    {
      status: 'wont_fix',
      resolution: {
        resolvedAt: new Date().toISOString(),
        resolvedBy: 'wont_fix',
        summary: reason,
      },
    },
    'lizard_brain',
    `marked as won't fix: ${reason}`
  );
}
