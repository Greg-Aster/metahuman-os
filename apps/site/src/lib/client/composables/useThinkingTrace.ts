/**
 * Thinking Trace Composable
 * Handles live audit stream visualization during LLM processing
 */

import { writable, derived, get } from 'svelte/store';

// Types
interface AuditStreamEvent {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'critical' | string;
  category: string;
  event: string;
  actor: string;
  details?: Record<string, any>;
}

interface UseThinkingTraceOptions {
  /**
   * Callback to get current cognitive mode
   */
  getCurrentMode: () => string;

  /**
   * Callback to get current reasoning depth
   */
  getReasoningDepth: () => number;

  /**
   * Callback to get current conversation session ID
   */
  getConversationSessionId: () => string;

  /**
   * Callback to get current reasoning stages count (for conditional display)
   */
  getReasoningStagesCount: () => number;
}

// Constants
const THINKING_TRACE_LIMIT = 40;

/**
 * Thinking Trace Composable
 * Provides reactive state and methods for thinking trace visualization
 */
export function useThinkingTrace(options: UseThinkingTraceOptions) {
  const { getCurrentMode, getReasoningDepth, getConversationSessionId, getReasoningStagesCount } = options;

  // State
  let auditStream: EventSource | null = null;

  // Svelte stores for reactive state
  const trace = writable<string[]>([]);
  const statusLabel = writable<string>('🤔 Thinking…');
  const active = writable<boolean>(false);
  const placeholderActive = writable<boolean>(false);

  // Derived stores for computed values
  const steps = derived(trace, $trace => $trace.join('\n\n'));
  const showIndicator = derived(
    [active, trace],
    ([$active, $trace]) => $active && getReasoningStagesCount() === 0 && $trace.length > 0
  );

  /**
   * Ensure audit stream is connected
   */
  function ensureAuditStream(): void {
    // Close any existing connection first to prevent duplicates
    if (auditStream) {
      auditStream.close();
      auditStream = null;
    }

    auditStream = new EventSource('/api/monitor/stream');
    auditStream.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as AuditStreamEvent;
        handleAuditTrace(parsed);
      } catch (err) {
        console.warn('[thinking-trace] Failed to parse audit event', err);
      }
    };
    auditStream.onerror = (err) => {
      console.warn('[thinking-trace] Audit stream disconnected', err);
    };
  }

  /**
   * Handle incoming audit trace event
   */
  function handleAuditTrace(event: AuditStreamEvent): void {
    if (!get(active)) return;

    const sessionId = getConversationSessionId();
    const sessionMatches =
      event.details?.sessionId === sessionId ||
      event.details?.conversationId === sessionId ||
      event.details?.taskId === sessionId;
    if (!sessionMatches) return;

    const formatted = formatAuditTrace(event);
    const base = get(placeholderActive) ? [] : get(trace);
    placeholderActive.set(false);
    trace.set([...base, formatted].slice(-THINKING_TRACE_LIMIT));
  }

  /**
   * Format audit trace event for display
   */
  function formatAuditTrace(event: AuditStreamEvent): string {
    const eventLabel = humanizeEventName(event.event);
    const detailsText = summarizeDetails(event.details || {});
    return detailsText ? `${eventLabel} ${detailsText}` : eventLabel;
  }

  /**
   * Convert event name to human-readable format
   */
  function humanizeEventName(name: string): string {
    return name
      .replace(/_/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase());
  }

  /**
   * Summarize event details for display
   */
  function summarizeDetails(details: Record<string, any>): string {
    const preferredKeys = [
      'goal',
      'action',
      'skill',
      'iteration',
      'reason',
      'summary',
      'model',
      'modelId',
      'provider',
      'latencyMs',
      'tokens',
      'path',
      'inputs',
      'outputs',
      'message',
      'status',
    ];

    const lines: string[] = [];

    for (const key of preferredKeys) {
      if (!(key in details)) continue;
      const value = details[key];
      if (value == null) continue;
      if (typeof value === 'object') {
        const compact = JSON.stringify(value, null, 2);
        lines.push(`${key}: ${truncateText(compact)}`);
      } else {
        lines.push(`${key}: ${truncateText(String(value))}`);
      }
    }

    // Fallback: if nothing matched, stringify small scalar entries
    if (lines.length === 0) {
      const fallback = Object.entries(details)
        .filter(([, value]) => typeof value !== 'object' || value === null)
        .map(([key, value]) => `${key}: ${truncateText(String(value ?? ''))}`);
      lines.push(...fallback);
    }

    return lines.join(' · ');
  }

  /**
   * Truncate text to limit
   */
  function truncateText(value: string, limit = 320): string {
    if (value.length <= limit) return value;
    return `${value.slice(0, limit)}…`;
  }

  /**
   * Start thinking trace (called when LLM processing begins)
   */
  function start(): void {
    // Detect cognitive mode to show appropriate status
    const cogMode = getCurrentMode() || 'dual';

    if (cogMode === 'emulation') {
      statusLabel.set('🤔 Processing...');
      trace.set(['Generating response...']);
    } else {
      const reasoningDepth = getReasoningDepth();
      statusLabel.set(reasoningDepth > 0 ? '🧠 Operator planning…' : '🤔 Thinking…');
      trace.set(['Awaiting operator telemetry…']);
    }

    active.set(true);
    placeholderActive.set(true);
    ensureAuditStream();
  }

  /**
   * Stop thinking trace (called when LLM processing completes)
   */
  function stop(): void {
    active.set(false);
    placeholderActive.set(false);
    trace.set([]);
  }

  /**
   * Set trace directly (for SSE stream handler)
   */
  function setTrace(newTrace: string[]): void {
    trace.set(newTrace);
  }

  /**
   * Set status label directly (for SSE stream handler)
   */
  function setStatusLabel(label: string): void {
    statusLabel.set(label);
  }

  /**
   * Set active state directly (for SSE stream handler)
   */
  function setActive(isActive: boolean): void {
    active.set(isActive);
  }

  /**
   * Update trace by appending new message (for SSE stream handler)
   */
  function appendTrace(message: string, limit = 10): void {
    trace.update($trace => [...$trace, message].slice(-limit));
  }

  /**
   * Get current trace value (for SSE stream handler)
   */
  function getTrace(): string[] {
    return get(trace);
  }

  /**
   * Cleanup function to call on component unmount
   */
  function cleanup(): void {
    if (auditStream) {
      auditStream.close();
      auditStream = null;
    }
  }

  return {
    // Stores
    trace,
    statusLabel,
    active,
    steps,
    showIndicator,

    // Methods
    start,
    stop,
    setTrace,
    setStatusLabel,
    setActive,
    appendTrace,
    getTrace,
    cleanup,
  };
}
