import { writable } from 'svelte/store';
import { apiEventSource } from '../client/api-config';
import type { TriggerManagerSnapshot } from './trigger-manager';

export interface WorkView {
  id: string;
  type: string;
  handler: string;
  resource: string;
  state: string;
  priority: string;
  source: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  waitingReason?: string;
  wakeAt?: string;
  deadline?: string;
  attempt: number;
  maxAttempts: number;
  cancellationRequestedAt?: string;
  robotSessionId?: string;
  error?: string;
}

export interface PersonResume {
  sessionId: string;
  candidateFrame?: string;
  observedAt?: string;
  frameExpiresAt?: string;
  windowExpiresAt: string;
  terminationConfirmed: boolean;
  rejection?: string;
}

export interface QueueSnapshot {
  triggerManager?: TriggerManagerSnapshot;
  lifecycle: string;
  running: boolean;
  paused: boolean;
  degraded: boolean;
  error?: string;
  tasks: WorkView[];
  canConfirmRobotStopped: boolean;
  executions: { executionId: string; graph: string; status: string; waitingReason?: string; updatedAt: string; personResume?: PersonResume }[];
}

export const coordinatorSnapshot = writable<QueueSnapshot | null>(null);
export const coordinatorConnection = writable<'idle' | 'connecting' | 'live' | 'reconnecting'>('idle');
export const coordinatorError = writable('');

let stream: EventSource | null = null;
let users = 0;

// Queue and Trigger Manager observe the same coordinator through one connection.
export function useWorkCoordinator(): () => void {
  if (typeof window === 'undefined') return () => {};
  users++;
  if (!stream) {
    coordinatorConnection.set('connecting');
    stream = apiEventSource('/api/queue-stream');
    stream.onopen = () => {
      coordinatorConnection.set('live');
      coordinatorError.set('');
    };
    stream.onmessage = event => {
      try {
        const data = JSON.parse(event.data);
        if (data.error) throw new Error(data.error);
        if (data.snapshot) {
          coordinatorSnapshot.set(data.snapshot);
          coordinatorError.set('');
        }
      } catch (error) {
        coordinatorError.set((error as Error).message);
      }
    };
    stream.onerror = () => coordinatorConnection.set('reconnecting');
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--users === 0) {
      stream?.close();
      stream = null;
      coordinatorSnapshot.set(null);
      coordinatorConnection.set('idle');
      coordinatorError.set('');
    }
  };
}
