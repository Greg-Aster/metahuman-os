<script lang="ts">
  import { onMount } from 'svelte';
  import { isOwner } from '../stores/security-policy';

  // Types
  interface Desire {
    id: string;
    title: string;
    description: string;
    reason: string;
    source: string;
    status: string;
    strength: number;
    baseWeight: number;
    risk: string;
    createdAt: string;
    updatedAt: string;
    plan?: {
      steps: Array<{ action: string; risk: string }>;
      estimatedRisk: string;
    };
    review?: {
      verdict: string;
      alignmentScore: number;
    };
  }

  interface AgencyMetrics {
    totalGenerated: number;
    totalCompleted: number;
    totalRejected: number;
    totalAbandoned: number;
    totalFailed: number;
    completedToday: number;
    successRate: number;
  }

  interface DesireCounts {
    nascent: number;
    pending: number;
    evaluating: number;
    planning: number;
    reviewing: number;
    approved: number;
    executing: number;
    completed: number;
    rejected: number;
    abandoned: number;
    failed: number;
  }

  // State
  let desires: Desire[] = [];
  let metrics: AgencyMetrics | null = null;
  let counts: DesireCounts | null = null;
  let summary: { total: number; active: number; waiting: number; completed: number; failed: number } | null = null;

  let loading = true;
  let error = '';
  let statusFilter: string = 'all';
  let processingId: string | null = null;

  // New desire form
  let showNewDesire = false;
  let newDesire = {
    title: '',
    description: '',
    reason: '',
    risk: 'low',
  };

  function formatTimestamp(ts: string | null): string {
    if (!ts) return 'Never';
    const date = new Date(ts);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  }

  function getRiskColor(risk: string): string {
    switch (risk) {
      case 'none': return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200';
      case 'low': return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
      case 'medium': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
      case 'high': return 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200';
      case 'critical': return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
      default: return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200';
    }
  }

  function getStatusColor(status: string): string {
    switch (status) {
      case 'nascent': return 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200';
      case 'pending': return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
      case 'evaluating':
      case 'planning':
      case 'reviewing': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
      case 'approved': return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
      case 'executing': return 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200';
      case 'completed': return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200';
      case 'rejected':
      case 'failed': return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
      case 'abandoned': return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200';
      default: return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200';
    }
  }

  function getSourceIcon(source: string): string {
    switch (source) {
      case 'persona_goal': return '🎯';
      case 'urgent_task': return '🔥';
      case 'task': return '📋';
      case 'memory_pattern': return '🧠';
      case 'curiosity': return '❓';
      case 'reflection': return '💭';
      case 'dream': return '🌙';
      case 'tool_suggestion': return '🔧';
      default: return '✨';
    }
  }

  async function loadDesires() {
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') {
        params.set('status', statusFilter);
      }
      const url = params.size ? `/api/agency/desires?${params}` : '/api/agency/desires?status=all';
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to load desires');
      const data = await res.json();
      desires = data.desires || [];
    } catch (e) {
      error = (e as Error).message;
    }
  }

  async function loadMetrics() {
    try {
      const res = await fetch('/api/agency/metrics');
      if (!res.ok) throw new Error('Failed to load metrics');
      const data = await res.json();
      metrics = data.metrics;
      counts = data.counts;
      summary = data.summary;
    } catch (e) {
      console.error('Failed to load metrics:', e);
    }
  }

  async function loadAll() {
    loading = true;
    error = '';
    await Promise.all([loadDesires(), loadMetrics()]);
    loading = false;
  }

  async function handleApprove(id: string) {
    if (!confirm('Approve this desire for execution?')) return;
    processingId = id;
    try {
      const res = await fetch(`/api/agency/desires/${id}/approve`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to approve desire');
      }
      await loadAll();
    } catch (e) {
      error = (e as Error).message;
    } finally {
      processingId = null;
    }
  }

  async function handleReject(id: string) {
    const reason = prompt('Reason for rejection (optional):');
    if (reason === null) return; // Cancelled

    processingId = id;
    try {
      const res = await fetch(`/api/agency/desires/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason || 'User rejected' }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to reject desire');
      }
      await loadAll();
    } catch (e) {
      error = (e as Error).message;
    } finally {
      processingId = null;
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this desire permanently?')) return;
    processingId = id;
    try {
      const res = await fetch(`/api/agency/desires/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to delete desire');
      }
      await loadAll();
    } catch (e) {
      error = (e as Error).message;
    } finally {
      processingId = null;
    }
  }

  async function handleCreateDesire() {
    if (!newDesire.title.trim() || !newDesire.description.trim()) {
      error = 'Title and description are required';
      return;
    }

    try {
      const res = await fetch('/api/agency/desires', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newDesire),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create desire');
      }
      newDesire = { title: '', description: '', reason: '', risk: 'low' };
      showNewDesire = false;
      await loadAll();
    } catch (e) {
      error = (e as Error).message;
    }
  }

  onMount(() => {
    loadAll();
    const interval = setInterval(loadAll, 30000);
    return () => clearInterval(interval);
  });
</script>

<div class="agency-dashboard">
  {#if !$isOwner}
    <div class="card p-6 text-center space-y-2">
      <h2 class="text-lg font-semibold">Agency Access Restricted</h2>
      <p class="muted text-sm">Log in as the owner to manage autonomous desires.</p>
    </div>
  {:else if loading}
    <div class="text-center py-8">
      <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      <p class="mt-2 muted">Loading agency data...</p>
    </div>
  {:else}
    <!-- Summary Stats -->
    {#if summary}
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-label">Total Desires</div>
          <div class="stat-value">{summary.total}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Active</div>
          <div class="stat-value text-blue-600 dark:text-blue-400">{summary.active}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Waiting</div>
          <div class="stat-value text-yellow-600 dark:text-yellow-400">{summary.waiting}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Completed</div>
          <div class="stat-value text-green-600 dark:text-green-400">{summary.completed}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Failed/Rejected</div>
          <div class="stat-value text-red-600 dark:text-red-400">{summary.failed}</div>
        </div>
      </div>
    {/if}

    <!-- Metrics -->
    {#if metrics}
      <div class="card p-4 mt-4">
        <h3 class="text-sm font-semibold mb-3">Performance Metrics</h3>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <div>
            <span class="muted">Generated:</span>
            <span class="font-semibold ml-1">{metrics.totalGenerated}</span>
          </div>
          <div>
            <span class="muted">Completed:</span>
            <span class="font-semibold ml-1">{metrics.totalCompleted}</span>
          </div>
          <div>
            <span class="muted">Today:</span>
            <span class="font-semibold ml-1">{metrics.completedToday}</span>
          </div>
          <div>
            <span class="muted">Success Rate:</span>
            <span class="font-semibold ml-1">{(metrics.successRate * 100).toFixed(1)}%</span>
          </div>
        </div>
      </div>
    {/if}

    <!-- Error Display -->
    {#if error}
      <div class="error-banner mt-4">
        {error}
        <button class="ml-2 underline" on:click={() => error = ''}>Dismiss</button>
      </div>
    {/if}

    <!-- Controls -->
    <div class="controls mt-4">
      <div class="flex items-center gap-2">
        <select bind:value={statusFilter} on:change={loadDesires} class="select-input">
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="pending">Pending</option>
          <option value="reviewing">Reviewing</option>
          <option value="approved">Approved</option>
          <option value="executing">Executing</option>
          <option value="completed">Completed</option>
          <option value="rejected">Rejected</option>
          <option value="abandoned">Abandoned</option>
        </select>
        <button class="btn-secondary" on:click={loadAll}>Refresh</button>
      </div>
      <button class="btn-primary" on:click={() => showNewDesire = !showNewDesire}>
        {showNewDesire ? 'Cancel' : '+ New Desire'}
      </button>
    </div>

    <!-- New Desire Form -->
    {#if showNewDesire}
      <div class="card p-4 mt-4 space-y-3">
        <h3 class="font-semibold">Create Manual Desire</h3>
        <input
          type="text"
          bind:value={newDesire.title}
          placeholder="Title (e.g., 'Learn a new skill')"
          class="input-field"
        />
        <textarea
          bind:value={newDesire.description}
          placeholder="Description (what do you want to achieve?)"
          class="input-field"
          rows="2"
        ></textarea>
        <textarea
          bind:value={newDesire.reason}
          placeholder="Reason (why is this important?)"
          class="input-field"
          rows="2"
        ></textarea>
        <div class="flex items-center gap-4">
          <label class="text-sm">
            Risk Level:
            <select bind:value={newDesire.risk} class="select-input ml-2">
              <option value="none">None</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
          <button class="btn-primary" on:click={handleCreateDesire}>Create</button>
        </div>
      </div>
    {/if}

    <!-- Desire List -->
    <div class="desire-list mt-4">
      {#if desires.length === 0}
        <div class="empty-state">
          <p class="muted">No desires found</p>
          <p class="text-sm muted mt-1">Desires will be generated automatically by the agency system</p>
        </div>
      {:else}
        {#each desires as desire}
          <div class="desire-card">
            <div class="desire-header">
              <div class="flex items-center gap-2">
                <span class="source-icon">{getSourceIcon(desire.source)}</span>
                <h4 class="desire-title">{desire.title}</h4>
              </div>
              <div class="flex items-center gap-2">
                <span class={`badge ${getStatusColor(desire.status)}`}>{desire.status}</span>
                <span class={`badge ${getRiskColor(desire.risk)}`}>{desire.risk}</span>
              </div>
            </div>

            <p class="desire-description">{desire.description}</p>

            {#if desire.reason}
              <p class="desire-reason"><em>"{desire.reason}"</em></p>
            {/if}

            <div class="desire-meta">
              <span class="muted text-xs">Strength: {(desire.strength * 100).toFixed(0)}%</span>
              <span class="muted text-xs">Created: {formatTimestamp(desire.createdAt)}</span>
              <span class="muted text-xs">Updated: {formatTimestamp(desire.updatedAt)}</span>
            </div>

            {#if desire.plan}
              <div class="plan-summary">
                <span class="text-xs font-semibold">Plan:</span>
                <span class="text-xs muted">{desire.plan.steps.length} steps, {desire.plan.estimatedRisk} risk</span>
              </div>
            {/if}

            {#if desire.review}
              <div class="review-summary">
                <span class="text-xs font-semibold">Review:</span>
                <span class="text-xs muted">{desire.review.verdict} (alignment: {(desire.review.alignmentScore * 100).toFixed(0)}%)</span>
              </div>
            {/if}

            <div class="desire-actions">
              {#if desire.status === 'reviewing'}
                <button
                  class="btn-approve"
                  disabled={processingId === desire.id}
                  on:click={() => handleApprove(desire.id)}
                >
                  {processingId === desire.id ? 'Processing...' : 'Approve'}
                </button>
              {/if}
              {#if ['reviewing', 'approved', 'pending', 'evaluating', 'planning'].includes(desire.status)}
                <button
                  class="btn-reject"
                  disabled={processingId === desire.id}
                  on:click={() => handleReject(desire.id)}
                >
                  Reject
                </button>
              {/if}
              {#if ['nascent', 'pending', 'rejected', 'abandoned', 'failed', 'completed'].includes(desire.status)}
                <button
                  class="btn-delete"
                  disabled={processingId === desire.id}
                  on:click={() => handleDelete(desire.id)}
                >
                  Delete
                </button>
              {/if}
            </div>
          </div>
        {/each}
      {/if}
    </div>
  {/if}
</div>

<style>
  .agency-dashboard {
    padding: 1rem;
  }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 0.75rem;
  }

  .stat-card {
    background: var(--card-bg, white);
    border: 1px solid var(--border-color, #e5e7eb);
    border-radius: 8px;
    padding: 1rem;
    text-align: center;
  }

  :global(.dark) .stat-card {
    background: #1f2937;
    border-color: #374151;
  }

  .stat-label {
    font-size: 0.75rem;
    color: #6b7280;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .stat-value {
    font-size: 1.5rem;
    font-weight: 700;
    margin-top: 0.25rem;
  }

  .card {
    background: var(--card-bg, white);
    border: 1px solid var(--border-color, #e5e7eb);
    border-radius: 8px;
  }

  :global(.dark) .card {
    background: #1f2937;
    border-color: #374151;
  }

  .controls {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .select-input {
    padding: 0.5rem;
    border: 1px solid var(--border-color, #e5e7eb);
    border-radius: 6px;
    background: white;
    font-size: 0.875rem;
  }

  :global(.dark) .select-input {
    background: #374151;
    border-color: #4b5563;
    color: white;
  }

  .input-field {
    width: 100%;
    padding: 0.5rem;
    border: 1px solid var(--border-color, #e5e7eb);
    border-radius: 6px;
    background: white;
    font-size: 0.875rem;
  }

  :global(.dark) .input-field {
    background: #374151;
    border-color: #4b5563;
    color: white;
  }

  .btn-primary {
    background: #3b82f6;
    color: white;
    padding: 0.5rem 1rem;
    border-radius: 6px;
    font-weight: 500;
    font-size: 0.875rem;
    border: none;
    cursor: pointer;
    transition: background 0.2s;
  }

  .btn-primary:hover {
    background: #2563eb;
  }

  .btn-secondary {
    background: #f3f4f6;
    color: #374151;
    padding: 0.5rem 1rem;
    border-radius: 6px;
    font-weight: 500;
    font-size: 0.875rem;
    border: none;
    cursor: pointer;
    transition: background 0.2s;
  }

  :global(.dark) .btn-secondary {
    background: #374151;
    color: #e5e7eb;
  }

  .btn-secondary:hover {
    background: #e5e7eb;
  }

  :global(.dark) .btn-secondary:hover {
    background: #4b5563;
  }

  .error-banner {
    background: #fee2e2;
    border: 1px solid #f87171;
    color: #b91c1c;
    padding: 0.75rem 1rem;
    border-radius: 6px;
    font-size: 0.875rem;
  }

  :global(.dark) .error-banner {
    background: #7f1d1d;
    border-color: #991b1b;
    color: #fecaca;
  }

  .desire-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .desire-card {
    background: var(--card-bg, white);
    border: 1px solid var(--border-color, #e5e7eb);
    border-radius: 8px;
    padding: 1rem;
  }

  :global(.dark) .desire-card {
    background: #1f2937;
    border-color: #374151;
  }

  .desire-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 0.5rem;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .source-icon {
    font-size: 1.25rem;
  }

  .desire-title {
    font-weight: 600;
    font-size: 1rem;
  }

  .badge {
    display: inline-block;
    padding: 0.125rem 0.5rem;
    border-radius: 999px;
    font-size: 0.75rem;
    font-weight: 500;
  }

  .desire-description {
    font-size: 0.875rem;
    color: #4b5563;
    margin-bottom: 0.5rem;
  }

  :global(.dark) .desire-description {
    color: #9ca3af;
  }

  .desire-reason {
    font-size: 0.75rem;
    color: #6b7280;
    margin-bottom: 0.5rem;
  }

  :global(.dark) .desire-reason {
    color: #9ca3af;
  }

  .desire-meta {
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
    margin-bottom: 0.5rem;
  }

  .plan-summary,
  .review-summary {
    padding: 0.5rem;
    background: #f9fafb;
    border-radius: 4px;
    margin-bottom: 0.5rem;
  }

  :global(.dark) .plan-summary,
  :global(.dark) .review-summary {
    background: #111827;
  }

  .desire-actions {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.75rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--border-color, #e5e7eb);
  }

  :global(.dark) .desire-actions {
    border-color: #374151;
  }

  .btn-approve {
    background: #10b981;
    color: white;
    padding: 0.375rem 0.75rem;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 500;
    border: none;
    cursor: pointer;
  }

  .btn-approve:hover:not(:disabled) {
    background: #059669;
  }

  .btn-reject {
    background: #ef4444;
    color: white;
    padding: 0.375rem 0.75rem;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 500;
    border: none;
    cursor: pointer;
  }

  .btn-reject:hover:not(:disabled) {
    background: #dc2626;
  }

  .btn-delete {
    background: #6b7280;
    color: white;
    padding: 0.375rem 0.75rem;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 500;
    border: none;
    cursor: pointer;
  }

  .btn-delete:hover:not(:disabled) {
    background: #4b5563;
  }

  .btn-approve:disabled,
  .btn-reject:disabled,
  .btn-delete:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .empty-state {
    text-align: center;
    padding: 2rem;
  }

  .muted {
    color: #6b7280;
  }

  :global(.dark) .muted {
    color: #9ca3af;
  }
</style>
