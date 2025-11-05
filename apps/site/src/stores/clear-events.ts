/**
 * Simple event system for clearing UI components across the application
 */
import { writable } from 'svelte/store';

// Increment this counter to trigger clear events
export const clearAuditStreamTrigger = writable(0);

// Helper to trigger a clear
export function triggerClearAuditStream() {
  clearAuditStreamTrigger.update(n => n + 1);
}
