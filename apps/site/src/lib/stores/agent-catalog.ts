import { writable } from 'svelte/store';
import { apiFetch } from '../client/api-config';

export type AgentCatalogLifecycle = 'scheduled-work' | 'workflow' | 'service';
export type AgentCatalogOwner = 'trigger-manager' | 'agent-monitor' | 'workflow' | 'available';
export type AgentCatalogHealth = 'ready' | 'available' | 'missing-source' | 'disabled';
export type AgentCatalogRisk = 'standard' | 'privileged' | 'destructive';

export interface AgentCatalogItem {
  id: string;
  sourceAgentId: string;
  displayName: string;
  description: string;
  lifecycle: AgentCatalogLifecycle;
  owner: AgentCatalogOwner;
  health: AgentCatalogHealth;
  risk: AgentCatalogRisk;
  installed: boolean;
  sourceReady: boolean;
  sourcePath?: string;
  triggerRegistered: boolean;
  serviceRegistered: boolean;
  enabled: boolean;
  triggerType?: 'interval' | 'time-of-day' | 'event' | 'activity' | 'manual';
  handler: string;
  usesLLM: boolean;
  priority: 'low' | 'normal' | 'high';
  parentIds: string[];
  tags: string[];
  canRegister: boolean;
  canUnregister: boolean;
  canRun: boolean;
  statusReason: string;
}

export interface AgentCatalogSnapshot {
  generatedAt: string;
  revision: number;
  scope: 'system';
  counts: {
    total: number;
    installed: number;
    triggerRegistered: number;
    services: number;
    available: number;
    missingSource: number;
    workflowChildren: number;
  };
  agents: AgentCatalogItem[];
}

export const agentCatalogSnapshot = writable<AgentCatalogSnapshot | null>(null);
export const agentCatalogError = writable<string | null>(null);
export const agentCatalogConnection = writable<'idle' | 'loading' | 'ready' | 'error'>('idle');

let users = 0;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let loading: Promise<AgentCatalogSnapshot> | null = null;

export async function refreshAgentCatalog(): Promise<AgentCatalogSnapshot> {
  if (loading) return loading;
  agentCatalogConnection.set('loading');
  loading = (async () => {
    const response = await apiFetch('/api/agent-catalog', { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false || !data.snapshot) {
      throw new Error(data.error || `Agent Catalog request failed: ${response.status}`);
    }
    agentCatalogSnapshot.set(data.snapshot);
    agentCatalogError.set(null);
    agentCatalogConnection.set('ready');
    return data.snapshot as AgentCatalogSnapshot;
  })();
  try {
    return await loading;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    agentCatalogError.set(message);
    agentCatalogConnection.set('error');
    throw error;
  } finally {
    loading = null;
  }
}

export function useAgentCatalog(): () => void {
  users += 1;
  if (users === 1) {
    void refreshAgentCatalog().catch(() => {});
    pollTimer = setInterval(() => void refreshAgentCatalog().catch(() => {}), 15_000);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    users = Math.max(0, users - 1);
    if (users === 0 && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
      agentCatalogConnection.set('idle');
    }
  };
}

async function control(action: 'register' | 'unregister', agentId: string): Promise<AgentCatalogSnapshot> {
  const response = await apiFetch('/api/agent-catalog/control', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, agentId }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false || !data.snapshot) {
    throw new Error(data.error || `Agent Catalog ${action} failed: ${response.status}`);
  }
  agentCatalogSnapshot.set(data.snapshot);
  agentCatalogError.set(null);
  agentCatalogConnection.set('ready');
  return data.snapshot;
}

export function registerCatalogAgent(agentId: string): Promise<AgentCatalogSnapshot> {
  return control('register', agentId);
}

export function unregisterCatalogAgent(agentId: string): Promise<AgentCatalogSnapshot> {
  return control('unregister', agentId);
}
