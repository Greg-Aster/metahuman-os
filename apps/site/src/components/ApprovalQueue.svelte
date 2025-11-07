<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { isOwner } from '../stores/security-policy';

  interface ApprovalItem {
    id: string;
    skillId: string;
    skillName: string;
    skillDescription: string;
    inputs: Record<string, any>;
    timestamp: string;
    risk: 'low' | 'medium' | 'high';
    status: 'pending' | 'approved' | 'rejected';
    resolvedAt?: string;
    resolvedBy?: string;
  }

  let approvals: ApprovalItem[] = [];
  let loading = true;
  let error = '';
  let processingId: string | null = null;

  async function loadApprovals() {
    if (!get(isOwner)) {
      approvals = [];
      loading = false;
      return;
    }
    try {
      const res = await fetch('/api/approvals');
      if (!res.ok) throw new Error('Failed to load approval queue');
      const data = await res.json();
      approvals = data.approvals;
      loading = false;
    } catch (e) {
      error = (e as Error).message;
      loading = false;
    }
  }

  async function handleApprove(id: string) {
    processingId = id;
    try {
      const res = await fetch('/api/approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: 'approve' }),
      });

      if (!res.ok) throw new Error('Failed to approve skill execution');

      const data = await res.json();
      if (data.success) {
        // Refresh the list
        await loadApprovals();
      } else {
        error = data.result?.error || 'Approval failed';
        setTimeout(() => error = '', 5000);
      }
    } catch (e) {
      error = (e as Error).message;
      setTimeout(() => error = '', 5000);
    } finally {
      processingId = null;
    }
  }

  async function handleReject(id: string) {
    processingId = id;
    try {
      const res = await fetch('/api/approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: 'reject' }),
      });

      if (!res.ok) throw new Error('Failed to reject skill execution');

      // Refresh the list
      await loadApprovals();
    } catch (e) {
      error = (e as Error).message;
      setTimeout(() => error = '', 5000);
    } finally {
      processingId = null;
    }
  }

  function getRiskColor(risk: 'low' | 'medium' | 'high') {
    switch (risk) {
      case 'low': return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
      case 'medium': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
      case 'high': return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
    }
  }

  function formatTimestamp(timestamp: string) {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  }

  let approvalsInterval: ReturnType<typeof setInterval> | null = null;

  function stopApprovalsInterval() {
    if (approvalsInterval) {
      clearInterval(approvalsInterval);
      approvalsInterval = null;
    }
  }

  function startApprovalsInterval() {
    stopApprovalsInterval();
    if (!get(isOwner)) {
      approvals = [];
      loading = false;
      return;
    }
    loadApprovals();
    approvalsInterval = setInterval(loadApprovals, 5000);
  }

  onMount(() => {
    startApprovalsInterval();
    const unsubscribe = isOwner.subscribe(() => startApprovalsInterval());
    return () => {
      stopApprovalsInterval();
      unsubscribe();
    };
  });
</script>

{#if !$isOwner}
  <div class="card p-6 text-center space-y-2">
    <h2 class="text-lg font-semibold">Approvals Restricted</h2>
    <p class="muted text-sm">Log in as the owner to review and approve skill executions.</p>
  </div>
{:else}
<div class="space-y-4">
  <!-- Header -->
  <div class="flex items-center justify-between">
    <div class="flex items-center gap-2">
      <h2 class="text-xl font-semibold">Approval Queue</h2>
      <span class="text-sm muted">({approvals.length} pending)</span>
    </div>
    <button
      on:click={loadApprovals}
      class="btn-secondary"
      title="Refresh approval queue"
    >
      Refresh
    </button>
  </div>

  <!-- Error Message -->
  {#if error}
    <div class="bg-red-100 border border-red-400 text-red-700 dark:bg-red-900 dark:border-red-700 dark:text-red-200 px-4 py-3 rounded">
      {error}
    </div>
  {/if}

  <!-- Loading State -->
  {#if loading}
    <div class="text-center py-8">
      <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      <p class="mt-2 muted">Loading approvals...</p>
    </div>
  {:else if approvals.length === 0}
    <!-- Empty State -->
    <div class="text-center py-8">
      <p class="muted">No pending approvals</p>
      <p class="text-sm muted mt-2">Skills requiring approval will appear here</p>
    </div>
  {:else}
    <!-- Approval List -->
    <div class="space-y-3">
      {#each approvals as approval}
        <div class="card p-4 space-y-3">
          <!-- Header Row -->
          <div class="flex items-start justify-between">
            <div class="flex-1">
              <h3 class="font-semibold">{approval.skillName}</h3>
              <p class="text-sm muted">{approval.skillDescription}</p>
            </div>
            <div class="flex items-center gap-2">
              <span class={`px-2 py-1 rounded text-xs font-medium ${getRiskColor(approval.risk)}`}>
                {approval.risk} risk
              </span>
              <span class="text-xs muted">{formatTimestamp(approval.timestamp)}</span>
            </div>
          </div>

          <!-- Input Parameters -->
          {#if Object.keys(approval.inputs).length > 0}
            <div class="bg-gray-50 dark:bg-gray-800 rounded p-3">
              <p class="text-xs font-medium muted mb-2">Parameters:</p>
              <div class="space-y-1">
                {#each Object.entries(approval.inputs) as [key, value]}
                  <div class="text-sm">
                    <span class="font-medium">{key}:</span>
                    <span class="ml-2 font-mono text-xs">
                      {typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}
                    </span>
                  </div>
                {/each}
              </div>
            </div>
          {/if}

          <!-- Action Buttons -->
          <div class="flex items-center gap-2 pt-2 border-t dark:border-gray-700">
            <button
              on:click={() => handleApprove(approval.id)}
              disabled={processingId === approval.id}
              class="btn-primary flex-1"
            >
              {processingId === approval.id ? 'Approving...' : 'Approve & Execute'}
            </button>
            <button
              on:click={() => handleReject(approval.id)}
              disabled={processingId === approval.id}
              class="btn-secondary flex-1"
            >
              {processingId === approval.id ? 'Rejecting...' : 'Reject'}
            </button>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
{/if}

<style>
  .card {
    background: var(--card-bg);
    border: 1px solid var(--border-color);
  }

  .btn-primary {
    background: var(--primary);
    color: white;
    padding: 0.5rem 1rem;
    border-radius: 0.375rem;
    font-weight: 500;
    transition: opacity 0.2s;
  }

  .btn-primary:hover:not(:disabled) {
    opacity: 0.9;
  }

  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-secondary {
    background: var(--secondary-bg);
    color: var(--text-color);
    padding: 0.5rem 1rem;
    border-radius: 0.375rem;
    border: 1px solid var(--border-color);
    font-weight: 500;
    transition: background 0.2s;
  }

  .btn-secondary:hover:not(:disabled) {
    background: var(--hover-bg);
  }

  .btn-secondary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .muted {
    color: var(--muted-text);
  }
</style>
