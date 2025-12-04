import { writable, derived, get } from 'svelte/store';
import { isOwner } from './security-policy';
import { apiFetch } from '../lib/client/api-config';

/**
 * Approval store - shared state for pending approvals
 * NO POLLING - loaded on demand when:
 * 1. User navigates to approvals view
 * 2. After approve/reject action completes
 * 3. Tab becomes visible (if approvals view is active)
 */

export interface ApprovalItem {
  id: string;
  skillId: string;
  skillName: string;
  skillDescription: string;
  inputs: Record<string, unknown>;
  timestamp: string;
  risk: 'low' | 'medium' | 'high';
  status: 'pending' | 'approved' | 'rejected';
  resolvedAt?: string;
  resolvedBy?: string;
}

interface ApprovalsState {
  items: ApprovalItem[];
  loading: boolean;
  error: string | null;
  lastLoaded: number | null;
}

const initialState: ApprovalsState = {
  items: [],
  loading: false,
  error: null,
  lastLoaded: null,
};

export const approvalsStore = writable<ApprovalsState>(initialState);

// Derived store for pending count (used by LeftSidebar badge)
export const pendingCount = derived(approvalsStore, ($store) => $store.items.length);

// Derived store for loading state
export const approvalsLoading = derived(approvalsStore, ($store) => $store.loading);

// Derived store for error state
export const approvalsError = derived(approvalsStore, ($store) => $store.error);

/**
 * Load approvals from API - call this on demand, not on interval
 */
export async function loadApprovals(): Promise<void> {
  // Check owner status before loading
  if (!get(isOwner)) {
    approvalsStore.set({ items: [], loading: false, error: null, lastLoaded: Date.now() });
    return;
  }

  approvalsStore.update((s) => ({ ...s, loading: true, error: null }));

  try {
    const res = await apiFetch('/api/approvals');
    if (!res.ok) throw new Error('Failed to load approval queue');
    const data = await res.json();
    approvalsStore.set({
      items: data.approvals || [],
      loading: false,
      error: null,
      lastLoaded: Date.now(),
    });
  } catch (e) {
    approvalsStore.update((s) => ({
      ...s,
      loading: false,
      error: (e as Error).message,
    }));
  }
}

/**
 * Approve a skill execution
 */
export async function approveSkill(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await apiFetch('/api/approvals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action: 'approve' }),
    });

    if (!res.ok) throw new Error('Failed to approve skill execution');

    const data = await res.json();
    if (data.success) {
      // Refresh the list after successful action
      await loadApprovals();
      return { success: true };
    } else {
      return { success: false, error: data.result?.error || 'Approval failed' };
    }
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

/**
 * Reject a skill execution
 */
export async function rejectSkill(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await apiFetch('/api/approvals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action: 'reject' }),
    });

    if (!res.ok) throw new Error('Failed to reject skill execution');

    // Refresh the list after successful action
    await loadApprovals();
    return { success: true };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

/**
 * Clear error state
 */
export function clearApprovalsError(): void {
  approvalsStore.update((s) => ({ ...s, error: null }));
}
