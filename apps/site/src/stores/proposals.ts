import { writable, derived, get } from 'svelte/store';
import { apiFetch } from '../lib/client/api-config';
import { connectionPool, ConnectionPriority, type ConnectionHandle } from '../lib/client/connection-pool';

/**
 * Proposals store - real-time state for operator proposals
 *
 * Uses SSE (Server-Sent Events) for real-time updates instead of polling.
 * The SSE connection is established once and shared across all components.
 */

export interface Proposal {
  id: string;
  createdAt: string;
  expiresAt?: string;
  taskType: string;
  taskDescription: string;
  reasoning: string;
  context: {
    cycleNumber?: number;
    triggerSource: string;
    systemState?: Record<string, unknown>;
    relevantMemories?: string[];
  };
  status: 'pending' | 'approved' | 'rejected' | 'expired' | 'executed';
  respondedAt?: string;
  response?: 'approved' | 'rejected' | 'modified';
  userInput?: string;
  executedAt?: string;
  executionResult?: {
    success: boolean;
    summary?: string;
    error?: string;
  };
}

export interface PostFeedbackRequest {
  id: string;
  proposalId: string;
  taskType: string;
  taskDescription: string;
  executedAt: string;
  executionResult: {
    success: boolean;
    summary?: string;
    error?: string;
  };
  status: 'pending' | 'received';
  proposal: Proposal;
}

interface ProposalsState {
  proposals: Proposal[];
  postFeedbackRequests: PostFeedbackRequest[];
  connected: boolean;
  error: string | null;
  lastUpdated: number | null;
}

const initialState: ProposalsState = {
  proposals: [],
  postFeedbackRequests: [],
  connected: false,
  error: null,
  lastUpdated: null,
};

export const proposalsStore = writable<ProposalsState>(initialState);

// Derived stores for convenience
export const pendingProposals = derived(proposalsStore, ($store) =>
  $store.proposals.filter((p) => p.status === 'pending')
);

export const pendingProposalCount = derived(pendingProposals, ($proposals) => $proposals.length);

export const postFeedbackCount = derived(
  proposalsStore,
  ($store) => $store.postFeedbackRequests.length
);

export const proposalsConnected = derived(proposalsStore, ($store) => $store.connected);

// SSE connection management
let connectionHandle: ConnectionHandle | null = null;
let eventSource: EventSource | null = null;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY_MS = 3000;

/**
 * Connect to the proposals SSE stream.
 * Call this once when the app initializes (e.g., in ChatInterface).
 * Now uses connection pool for priority-based allocation.
 */
export function connectProposalsStream(): void {
  if (connectionHandle && connectionHandle.getStatus() === 'active') {
    return; // Already connected
  }

  // Clean up any existing connection
  disconnectProposalsStream();

  try {
    connectionHandle = connectionPool.request({
      id: 'proposals-stream',
      name: 'Proposals Stream',
      url: '/api/operator-proposals/stream',
      priority: ConnectionPriority.MEDIUM,
      defer: true,
      onOpen: (source) => {
        eventSource = source;
        reconnectAttempts = 0;
        proposalsStore.update((s) => ({ ...s, connected: true, error: null }));

        // Handle named events
        source.addEventListener('connected', () => {
          proposalsStore.update((s) => ({ ...s, connected: true }));
        });

        source.addEventListener('state', (event) => {
          try {
            const data = JSON.parse((event as MessageEvent).data);
            proposalsStore.update((s) => ({
              ...s,
              proposals: data.proposals || [],
              postFeedbackRequests: data.postFeedbackRequests || [],
              lastUpdated: Date.now(),
            }));
          } catch (e) {
            console.error('[proposals-store] Failed to parse state event:', e);
          }
        });

        source.addEventListener('proposal-created', (event) => {
          try {
            const data = JSON.parse((event as MessageEvent).data);
            proposalsStore.update((s) => ({
              ...s,
              proposals: [...s.proposals, data.proposal],
              lastUpdated: Date.now(),
            }));
          } catch (e) {
            console.error('[proposals-store] Failed to parse proposal-created event:', e);
          }
        });

        source.addEventListener('proposal-resolved', (event) => {
          try {
            const data = JSON.parse((event as MessageEvent).data);
            proposalsStore.update((s) => ({
              ...s,
              proposals: s.proposals.filter((p) => p.id !== data.proposalId),
              lastUpdated: Date.now(),
            }));
          } catch (e) {
            console.error('[proposals-store] Failed to parse proposal-resolved event:', e);
          }
        });
      },
      onClose: () => {
        eventSource = null;
        proposalsStore.update((s) => ({ ...s, connected: false }));
      },
      onError: () => {
        proposalsStore.update((s) => ({ ...s, connected: false }));

        // Attempt to reconnect
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttempts++;
          reconnectTimeout = setTimeout(() => {
            connectProposalsStream();
          }, RECONNECT_DELAY_MS);
        } else {
          proposalsStore.update((s) => ({
            ...s,
            error: 'Failed to connect to proposals stream',
          }));
        }
      },
    });
  } catch (e) {
    console.error('[proposals-store] Failed to create connection:', e);
    proposalsStore.update((s) => ({
      ...s,
      connected: false,
      error: (e as Error).message,
    }));
  }
}

/**
 * Disconnect from the proposals SSE stream.
 */
export function disconnectProposalsStream(): void {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  if (connectionHandle) {
    connectionHandle.close();
    connectionHandle = null;
    eventSource = null;
  }

  proposalsStore.update((s) => ({ ...s, connected: false }));
}

/**
 * Get a proposal by ID from the current store state.
 */
export function getProposalById(proposalId: string): Proposal | undefined {
  const state = get(proposalsStore);
  return state.proposals.find((p) => p.id === proposalId);
}

/**
 * Get a proposal by task type from the current store state.
 */
export function getProposalByTask(taskType: string): Proposal | undefined {
  const state = get(proposalsStore);
  return state.proposals.find((p) => p.taskType === taskType && p.status === 'pending');
}

/**
 * Respond to a proposal (approve, reject, modify).
 * The SSE stream will automatically update the store when the server confirms.
 */
export async function respondToProposal(
  proposalId: string,
  response: 'approved' | 'rejected' | 'modified',
  userInput?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await apiFetch('/api/operator-proposals/respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proposalId, response, userInput }),
    });

    if (!res.ok) {
      const data = await res.json();
      return { success: false, error: data.error || 'Failed to respond' };
    }

    return { success: true };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

/**
 * Submit post-execution feedback.
 */
export async function submitPostFeedback(
  proposalId: string,
  rating: 'good' | 'neutral' | 'bad',
  comment?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await apiFetch('/api/operator-proposals/post-feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proposalId, rating, comment }),
    });

    if (!res.ok) {
      const data = await res.json();
      return { success: false, error: data.error || 'Failed to submit feedback' };
    }

    // Remove from local state
    proposalsStore.update((s) => ({
      ...s,
      postFeedbackRequests: s.postFeedbackRequests.filter((r) => r.proposalId !== proposalId),
    }));

    return { success: true };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}
