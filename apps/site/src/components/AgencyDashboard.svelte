<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { isOwner } from '../stores/security-policy';
  import { apiFetch } from '../lib/client/api-config';

  // Track last load time to avoid redundant reloads
  let lastLoadTime = 0;
  const RELOAD_THRESHOLD_MS = 5000; // Min 5 seconds between reloads

  // Types
  interface PlanStep {
    order: number;
    action: string;
    skill?: string;
    inputs?: Record<string, unknown>;
    expectedOutcome: string;
    risk: string;
    requiresApproval: boolean;
  }

  interface DesirePlan {
    id: string;
    version: number;
    steps: PlanStep[];
    estimatedRisk: string;
    requiredSkills: string[];
    requiredTrustLevel: string;
    operatorGoal: string;
    createdAt: string;
    basedOnCritique?: string;
  }

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
    plan?: DesirePlan;
    planHistory?: DesirePlan[];
    userCritique?: string;
    critiqueAt?: string;
    review?: {
      verdict: string;
      alignmentScore: number;
      reasoning?: string;
      concerns?: string[];
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

  // Plan detail view and critique
  let expandedDesireId: string | null = null;
  let critiqueText: Record<string, string> = {};
  let showHistoryFor: string | null = null;
  let revisingId: string | null = null;

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
      const res = await apiFetch('/api/agency/metrics');
      if (!res.ok) throw new Error('Failed to load metrics');
      const data = await res.json();
      metrics = data.metrics;
      counts = data.counts;
      summary = data.summary;
    } catch (e) {
      console.error('Failed to load metrics:', e);
    }
  }

  async function loadAll(showLoading = true, force = false) {
    // Skip if recently loaded (unless forced)
    const now = Date.now();
    if (!force && now - lastLoadTime < RELOAD_THRESHOLD_MS) {
      return;
    }

    if (showLoading) loading = true;
    error = '';
    try {
      await Promise.all([loadDesires(), loadMetrics()]);
      lastLoadTime = Date.now();
    } finally {
      loading = false;
    }
  }

  // Reload when tab becomes visible (user switches back)
  function handleVisibilityChange() {
    if (document.visibilityState === 'visible' && $isOwner) {
      loadAll(false); // Silent reload, respects threshold
    }
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
      await loadAll(true, true); // Force reload after action
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
      await loadAll(true, true); // Force reload after action
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
      await loadAll(true, true); // Force reload after action
    } catch (e) {
      error = (e as Error).message;
    } finally {
      processingId = null;
    }
  }

  async function handleAdvanceStage(id: string, newStatus: string) {
    processingId = id;
    try {
      const res = await fetch(`/api/agency/desires/${id}/advance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newStatus }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to advance desire');
      }
      await loadAll(true, true);
    } catch (e) {
      error = (e as Error).message;
    } finally {
      processingId = null;
    }
  }

  async function handleExecute(id: string) {
    if (!confirm('Execute this desire now? This will run the plan through the operator.')) return;
    processingId = id;
    try {
      const res = await fetch(`/api/agency/desires/${id}/execute`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to execute desire');
      }
      await loadAll(true, true);
    } catch (e) {
      error = (e as Error).message;
    } finally {
      processingId = null;
    }
  }

  async function handleRevise(id: string) {
    const critique = critiqueText[id];
    if (!critique || critique.trim().length === 0) {
      error = 'Please enter your critique/feedback before requesting revision';
      return;
    }

    revisingId = id;
    try {
      const res = await fetch(`/api/agency/desires/${id}/revise`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ critique: critique.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to request revision');
      }
      // Clear the critique text after successful submission
      critiqueText[id] = '';
      expandedDesireId = null;
      await loadAll(true, true);
    } catch (e) {
      error = (e as Error).message;
    } finally {
      revisingId = null;
    }
  }

  function togglePlanDetail(id: string) {
    expandedDesireId = expandedDesireId === id ? null : id;
  }

  function togglePlanHistory(id: string) {
    showHistoryFor = showHistoryFor === id ? null : id;
  }

  async function handleCreateDesire() {
    if (!newDesire.title.trim() || !newDesire.description.trim()) {
      error = 'Title and description are required';
      return;
    }

    try {
      const res = await apiFetch('/api/agency/desires', {
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
      await loadAll(true, true); // Force reload after action
    } catch (e) {
      error = (e as Error).message;
    }
  }

  onMount(() => {
    loadAll(); // Load once when tab is opened

    // Listen for visibility changes to reload when user returns
    document.addEventListener('visibilitychange', handleVisibilityChange);
  });

  onDestroy(() => {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
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
          <option value="nascent">Nascent (Growing)</option>
          <option value="pending">Pending</option>
          <option value="active">Active</option>
          <option value="reviewing">Reviewing</option>
          <option value="approved">Approved</option>
          <option value="executing">Executing</option>
          <option value="completed">Completed</option>
          <option value="rejected">Rejected</option>
          <option value="abandoned">Abandoned</option>
        </select>
        <button class="btn-secondary" on:click={() => loadAll(true, true)}>Refresh</button>
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
              <!-- Plan Summary Header (clickable to expand) -->
              <button type="button" class="plan-summary clickable" on:click={() => togglePlanDetail(desire.id)} aria-expanded={expandedDesireId === desire.id}>
                <div class="plan-summary-header">
                  <span class="text-xs font-semibold">
                    📋 Plan v{desire.plan.version || 1}:
                  </span>
                  <span class="text-xs muted">
                    {desire.plan.steps.length} steps, {desire.plan.estimatedRisk} risk
                    {#if desire.planHistory && desire.planHistory.length > 0}
                      <span class="history-badge">({desire.planHistory.length} previous)</span>
                    {/if}
                  </span>
                  <span class="expand-icon">{expandedDesireId === desire.id ? '▼' : '▶'}</span>
                </div>
                {#if desire.plan.operatorGoal}
                  <p class="plan-goal text-xs muted">Goal: {desire.plan.operatorGoal}</p>
                {/if}
              </button>

              <!-- Expanded Plan Details -->
              {#if expandedDesireId === desire.id}
                <div class="plan-details">
                  <h5 class="plan-section-title">Execution Steps</h5>
                  <div class="plan-steps">
                    {#each desire.plan.steps as step, i}
                      <div class="plan-step">
                        <div class="step-header">
                          <span class="step-number">{step.order || i + 1}</span>
                          <span class="step-action">{step.action}</span>
                          <span class={`badge small ${getRiskColor(step.risk)}`}>{step.risk}</span>
                          {#if step.requiresApproval}
                            <span class="badge small bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">needs approval</span>
                          {/if}
                        </div>
                        {#if step.skill}
                          <div class="step-skill">
                            <span class="text-xs muted">Skill:</span>
                            <code class="text-xs">{step.skill}</code>
                          </div>
                        {/if}
                        {#if step.expectedOutcome}
                          <div class="step-outcome">
                            <span class="text-xs muted">Expected:</span>
                            <span class="text-xs">{step.expectedOutcome}</span>
                          </div>
                        {/if}
                        {#if step.inputs && Object.keys(step.inputs).length > 0}
                          <div class="step-inputs">
                            <span class="text-xs muted">Inputs:</span>
                            <code class="text-xs">{JSON.stringify(step.inputs)}</code>
                          </div>
                        {/if}
                      </div>
                    {/each}
                  </div>

                  <!-- Plan History Toggle -->
                  {#if desire.planHistory && desire.planHistory.length > 0}
                    <button class="btn-history" on:click|stopPropagation={() => togglePlanHistory(desire.id)}>
                      {showHistoryFor === desire.id ? '▼ Hide' : '▶ Show'} Previous Versions ({desire.planHistory.length})
                    </button>

                    {#if showHistoryFor === desire.id}
                      <div class="plan-history">
                        {#each desire.planHistory as oldPlan, idx}
                          <div class="old-plan">
                            <h6 class="old-plan-title">Version {oldPlan.version || idx + 1} ({formatTimestamp(oldPlan.createdAt)})</h6>
                            {#if oldPlan.basedOnCritique}
                              <p class="critique-note text-xs">Critique: "{oldPlan.basedOnCritique}"</p>
                            {/if}
                            <ul class="old-plan-steps">
                              {#each oldPlan.steps as step, i}
                                <li>{step.order || i + 1}. {step.action}</li>
                              {/each}
                            </ul>
                          </div>
                        {/each}
                      </div>
                    {/if}
                  {/if}

                  <!-- Critique & Revision Section -->
                  {#if ['reviewing', 'approved', 'awaiting_approval', 'planning'].includes(desire.status)}
                    <div class="critique-section">
                      <h5 class="plan-section-title">✏️ Request Revision</h5>
                      <p class="critique-hint text-xs muted">
                        Not happy with the plan? Provide feedback and request a revision.
                      </p>
                      <textarea
                        class="critique-input"
                        placeholder="Enter your critique or suggestions for improving this plan..."
                        bind:value={critiqueText[desire.id]}
                        rows="3"
                      ></textarea>
                      <div class="critique-actions">
                        <button
                          class="btn-revise"
                          disabled={revisingId === desire.id || !critiqueText[desire.id]?.trim()}
                          on:click|stopPropagation={() => handleRevise(desire.id)}
                        >
                          {revisingId === desire.id ? 'Requesting...' : '🔄 Request Revision'}
                        </button>
                      </div>
                    </div>
                  {/if}
                </div>
              {/if}
            {/if}

            {#if desire.review}
              <div class="review-summary">
                <span class="text-xs font-semibold">Review:</span>
                <span class="text-xs muted">{desire.review.verdict} (alignment: {(desire.review.alignmentScore * 100).toFixed(0)}%)</span>
                {#if desire.review.reasoning}
                  <p class="review-reasoning text-xs muted">{desire.review.reasoning}</p>
                {/if}
                {#if desire.review.concerns && desire.review.concerns.length > 0}
                  <div class="review-concerns">
                    <span class="text-xs font-semibold">Concerns:</span>
                    <ul class="concerns-list">
                      {#each desire.review.concerns as concern}
                        <li class="text-xs muted">• {concern}</li>
                      {/each}
                    </ul>
                  </div>
                {/if}
              </div>
            {/if}

            {#if desire.userCritique}
              <div class="pending-critique">
                <span class="text-xs font-semibold">⏳ Pending Revision:</span>
                <p class="text-xs muted">"{desire.userCritique}"</p>
                <span class="text-xs muted">Submitted: {formatTimestamp(desire.critiqueAt || null)}</span>
              </div>
            {/if}

            <div class="desire-actions">
              <!-- Stage progression buttons -->
              {#if desire.status === 'nascent'}
                <button
                  class="btn-stage"
                  disabled={processingId === desire.id}
                  on:click={() => handleAdvanceStage(desire.id, 'pending')}
                >
                  → Pending
                </button>
              {/if}
              {#if desire.status === 'pending'}
                <button
                  class="btn-stage"
                  disabled={processingId === desire.id}
                  on:click={() => handleAdvanceStage(desire.id, 'planning')}
                >
                  → Plan
                </button>
              {/if}
              {#if desire.status === 'planning'}
                <button
                  class="btn-stage"
                  disabled={processingId === desire.id}
                  on:click={() => handleAdvanceStage(desire.id, 'reviewing')}
                >
                  → Review
                </button>
              {/if}
              {#if desire.status === 'reviewing'}
                <button
                  class="btn-stage"
                  disabled={processingId === desire.id}
                  on:click={() => handleAdvanceStage(desire.id, 'approved')}
                >
                  → Approve
                </button>
              {/if}
              {#if desire.status === 'approved'}
                <button
                  class="btn-execute"
                  disabled={processingId === desire.id}
                  on:click={() => handleExecute(desire.id)}
                >
                  Execute
                </button>
              {/if}

              <!-- Quick approve (skip to approved) -->
              {#if ['nascent', 'pending', 'planning', 'reviewing'].includes(desire.status)}
                <button
                  class="btn-approve"
                  disabled={processingId === desire.id}
                  on:click={() => handleApprove(desire.id)}
                  title="Skip to approved status"
                >
                  Fast Approve
                </button>
              {/if}

              <!-- Reject -->
              {#if ['nascent', 'pending', 'planning', 'reviewing', 'approved'].includes(desire.status)}
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

  button.plan-summary.clickable {
    cursor: pointer;
    transition: background 0.2s;
    width: 100%;
    text-align: left;
    border: none;
    font-family: inherit;
    font-size: inherit;
  }

  .plan-summary.clickable:hover {
    background: #f3f4f6;
  }

  :global(.dark) .plan-summary.clickable:hover {
    background: #1f2937;
  }

  .plan-summary-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .expand-icon {
    margin-left: auto;
    font-size: 0.75rem;
    color: #6b7280;
  }

  .history-badge {
    font-style: italic;
    color: #8b5cf6;
  }

  .plan-goal {
    margin-top: 0.25rem;
    font-style: italic;
  }

  .plan-details {
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    padding: 1rem;
    margin-bottom: 0.5rem;
  }

  :global(.dark) .plan-details {
    background: #1f2937;
    border-color: #374151;
  }

  .plan-section-title {
    font-weight: 600;
    font-size: 0.875rem;
    margin-bottom: 0.5rem;
    color: #374151;
  }

  :global(.dark) .plan-section-title {
    color: #e5e7eb;
  }

  .plan-steps {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .plan-step {
    background: white;
    border: 1px solid #e5e7eb;
    border-radius: 4px;
    padding: 0.75rem;
  }

  :global(.dark) .plan-step {
    background: #111827;
    border-color: #374151;
  }

  .step-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-bottom: 0.25rem;
  }

  .step-number {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.5rem;
    height: 1.5rem;
    background: #3b82f6;
    color: white;
    border-radius: 50%;
    font-size: 0.75rem;
    font-weight: 600;
  }

  .step-action {
    font-weight: 500;
    flex: 1;
  }

  .step-skill,
  .step-outcome,
  .step-inputs {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.25rem;
    padding-left: 2rem;
  }

  .step-inputs code,
  .step-skill code {
    background: #e5e7eb;
    padding: 0.125rem 0.375rem;
    border-radius: 3px;
    font-family: monospace;
  }

  :global(.dark) .step-inputs code,
  :global(.dark) .step-skill code {
    background: #374151;
  }

  .badge.small {
    padding: 0.0625rem 0.375rem;
    font-size: 0.625rem;
  }

  .btn-history {
    background: transparent;
    border: 1px solid #e5e7eb;
    color: #6b7280;
    padding: 0.375rem 0.75rem;
    border-radius: 4px;
    font-size: 0.75rem;
    cursor: pointer;
    margin-top: 0.75rem;
    width: 100%;
  }

  .btn-history:hover {
    background: #f3f4f6;
  }

  :global(.dark) .btn-history {
    border-color: #374151;
    color: #9ca3af;
  }

  :global(.dark) .btn-history:hover {
    background: #374151;
  }

  .plan-history {
    margin-top: 0.5rem;
    padding: 0.5rem;
    background: #fef3c7;
    border-radius: 4px;
  }

  :global(.dark) .plan-history {
    background: #78350f;
  }

  .old-plan {
    margin-bottom: 0.75rem;
    padding-bottom: 0.75rem;
    border-bottom: 1px solid #e5e7eb;
  }

  :global(.dark) .old-plan {
    border-bottom-color: #92400e;
  }

  .old-plan:last-child {
    margin-bottom: 0;
    padding-bottom: 0;
    border-bottom: none;
  }

  .old-plan-title {
    font-size: 0.75rem;
    font-weight: 600;
    color: #92400e;
  }

  :global(.dark) .old-plan-title {
    color: #fef3c7;
  }

  .critique-note {
    font-style: italic;
    color: #78350f;
    margin: 0.25rem 0;
  }

  :global(.dark) .critique-note {
    color: #fde68a;
  }

  .old-plan-steps {
    list-style: none;
    padding: 0;
    margin: 0.25rem 0 0 0;
    font-size: 0.75rem;
  }

  .old-plan-steps li {
    color: #92400e;
  }

  :global(.dark) .old-plan-steps li {
    color: #fde68a;
  }

  .critique-section {
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px dashed #e5e7eb;
  }

  :global(.dark) .critique-section {
    border-top-color: #374151;
  }

  .critique-hint {
    margin-bottom: 0.5rem;
  }

  .critique-input {
    width: 100%;
    padding: 0.5rem;
    border: 1px solid #e5e7eb;
    border-radius: 4px;
    background: white;
    font-size: 0.875rem;
    resize: vertical;
  }

  :global(.dark) .critique-input {
    background: #111827;
    border-color: #374151;
    color: white;
  }

  .critique-actions {
    margin-top: 0.5rem;
    display: flex;
    justify-content: flex-end;
  }

  .btn-revise {
    background: #8b5cf6;
    color: white;
    padding: 0.375rem 0.75rem;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 500;
    border: none;
    cursor: pointer;
  }

  .btn-revise:hover:not(:disabled) {
    background: #7c3aed;
  }

  .btn-revise:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .review-reasoning {
    margin-top: 0.25rem;
    font-style: italic;
  }

  .review-concerns {
    margin-top: 0.5rem;
  }

  .concerns-list {
    list-style: none;
    padding: 0;
    margin: 0.25rem 0 0 0;
  }

  .pending-critique {
    padding: 0.5rem;
    background: #fef3c7;
    border: 1px solid #fcd34d;
    border-radius: 4px;
    margin-bottom: 0.5rem;
  }

  :global(.dark) .pending-critique {
    background: #78350f;
    border-color: #92400e;
  }

  .desire-actions {
    display: flex;
    flex-wrap: wrap;
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

  .btn-stage {
    background: #3b82f6;
    color: white;
    padding: 0.375rem 0.75rem;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 500;
    border: none;
    cursor: pointer;
  }

  .btn-stage:hover:not(:disabled) {
    background: #2563eb;
  }

  .btn-execute {
    background: #8b5cf6;
    color: white;
    padding: 0.375rem 0.75rem;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 500;
    border: none;
    cursor: pointer;
  }

  .btn-execute:hover:not(:disabled) {
    background: #7c3aed;
  }

  .btn-approve:disabled,
  .btn-reject:disabled,
  .btn-delete:disabled,
  .btn-stage:disabled,
  .btn-execute:disabled {
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
