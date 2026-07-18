/**
 * Security Policy Store
 *
 * Manages the current security policy capability display for the UI.
 * Fetches policy from /api/security/policy and makes it available
 * to components via Svelte stores. The API router is the enforcement owner;
 * this store must not be treated as a security boundary.
 */

import { writable, derived } from 'svelte/store';
import { apiFetch } from '../lib/client/api-config';

export interface SecurityPolicy {
  canWriteMemory: boolean;
  canUseOperator: boolean;
  canChangeMode: boolean;
  canChangeTrust: boolean;
  canAccessTraining: boolean;
  canFactoryReset: boolean;
  role: 'owner' | 'standard' | 'guest' | 'anonymous';
  mode: 'dual' | 'agent' | 'emulation' | 'environment';
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
  ($policy) => $policy ? !$policy.canWriteMemory : false
);

export const canUseOperator = derived(
  policyStore,
  ($policy) => $policy?.canUseOperator ?? true
);

export const canWriteMemory = derived(
  policyStore,
  ($policy) => $policy?.canWriteMemory ?? true
);

export const isOwner = derived(
  policyStore,
  ($policy) => $policy?.role === 'owner'
);

export const currentMode = derived(
  policyStore,
  ($policy) => $policy?.mode ?? 'dual'
);

export function clearSecurityPolicy(): void {
  policyStore.set(null);
  policyError.set(null);
  policyLoading.set(false);
}

/**
 * Fetch the current security policy from the API
 */
export async function fetchSecurityPolicy(): Promise<void> {
  policyLoading.set(true);
  policyError.set(null);

  try {
    const res = await apiFetch('/api/security/policy', {
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
    policyStore.set(null);
  } finally {
    policyLoading.set(false);
  }
}
