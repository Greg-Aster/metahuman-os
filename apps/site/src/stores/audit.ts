import { writable } from 'svelte/store';

export interface AuditEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'critical';
  category: 'system' | 'decision' | 'action' | 'security' | 'data';
  event: string;
  details?: any;
  actor?: 'human' | 'system' | 'agent' | string;
}

export interface AuditResponse {
  date: string;
  entries: AuditEntry[];
  summary: {
    total: number;
    byLevel: Record<string, number>;
    byCategory: Record<string, number>;
  };
}

// Persistent audit data store
export const auditDataStore = writable<AuditResponse | null>(null);
export const auditLoadingStore = writable<boolean>(true);
export const auditErrorStore = writable<string>('');
