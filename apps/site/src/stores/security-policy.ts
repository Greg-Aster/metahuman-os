/**
 * Security Policy Store
 *
 * Manages the current security policy state for the UI.
 * Fetches policy from /api/security/policy and makes it available
 * to all components via Svelte stores.
 */

import { writable, derived } from 'svelte/store';

export interface SecurityPolicy {
  canWriteMemory: boolean;
  canUseOperator: boolean;
  canChangeMode: boolean;
  canChangeTrust: boolean;
  canAccessTraining: boolean;
  canFactoryReset: boolean;
  role: 'owner' | 'guest' | 'anonymous';
  mode: 'dual' | 'agent' | 'emulation';
  sessionId?: string;
}

export interface SecurityPolicyResponse {
  success: boolean;
  policy: SecurityPolicy & {
    isReadOnly: boolean;
    isOwner: boolean;
    isGuest: boolean;
  };
}

// Core policy store
export const policyStore = writable<SecurityPolicy | null>(null);

// Loading state
export const policyLoading = writable<boolean>(true);

// Error state
export const policyError = writable<string | null>(null);

// Derived stores for common checks
export const isReadOnly = derived(
  policyStore,
  ($policy) => $policy ? !$policy.canWriteMemory : true
);

export const canUseOperator = derived(
  policyStore,
  ($policy) => $policy?.canUseOperator ?? false
);

export const canWriteMemory = derived(
  policyStore,
  ($policy) => $policy?.canWriteMemory ?? false
);

export const isOwner = derived(
  policyStore,
  ($policy) => $policy?.role === 'owner'
);

export const currentMode = derived(
  policyStore,
  ($policy) => $policy?.mode ?? 'dual'
);

/**
 * Fetch the current security policy from the API
 */
export async function fetchSecurityPolicy(): Promise<void> {
  policyLoading.set(true);
  policyError.set(null);

  try {
    const res = await fetch('/api/security/policy', {
      cache: 'no-store',
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch policy (status ${res.status})`);
    }

    const data: SecurityPolicyResponse = await res.json();

    if (data.success && data.policy) {
      policyStore.set(data.policy);
    } else {
      throw new Error('Invalid policy response');
    }
  } catch (error) {
    console.error('[security-policy] Failed to fetch policy:', error);
    policyError.set((error as Error).message);

    // Set safe defaults (most restrictive)
    policyStore.set({
      canWriteMemory: false,
      canUseOperator: false,
      canChangeMode: false,
      canChangeTrust: false,
      canAccessTraining: false,
      canFactoryReset: false,
      role: 'anonymous',
      mode: 'emulation',
    });
  } finally {
    policyLoading.set(false);
  }
}

/**
 * Start polling for policy updates
 * @param intervalMs Polling interval in milliseconds (default: 30s)
 * @returns Cleanup function to stop polling
 */
export function startPolicyPolling(intervalMs: number = 30000): () => void {
  // Initial fetch
  fetchSecurityPolicy();

  // Set up polling
  const interval = setInterval(() => {
    fetchSecurityPolicy();
  }, intervalMs);

  // Return cleanup function
  return () => clearInterval(interval);
}
