/**
 * Thinking Trace Composable
 * Displays progress and reasoning supplied by the active task stream
 */

import { writable, derived, get } from 'svelte/store';

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
   * Callback to get current reasoning stages count (for conditional display)
   */
  getReasoningStagesCount: () => number;
}

/**
 * Thinking Trace Composable
 * Provides reactive state and methods for thinking trace visualization
 */
export function useThinkingTrace(options: UseThinkingTraceOptions) {
  const { getCurrentMode, getReasoningDepth, getReasoningStagesCount } = options;

  // Svelte stores for reactive state
  const trace = writable<string[]>([]);
  const statusLabel = writable<string>('🤔 Thinking…');
  const active = writable<boolean>(false);

  // Derived stores for computed values
  const steps = derived(trace, $trace => $trace.join('\n\n'));
  const showIndicator = derived(
    [active, trace],
    ([$active, $trace]) => $active && getReasoningStagesCount() === 0 && $trace.length > 0
  );

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
  }

  /**
   * Stop thinking trace (called when LLM processing completes)
   */
  function stop(): void {
    active.set(false);
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
  };
}
