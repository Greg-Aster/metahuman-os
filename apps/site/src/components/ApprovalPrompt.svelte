<script lang="ts">
  /**
   * ApprovalPrompt - Compact approval bar with expandable desire details
   *
   * Shows a slim notification bar when desires need user approval.
   * Click on items to expand and see full desire information.
   */
  import { onMount, onDestroy } from 'svelte';
  import { apiFetch } from '../lib/client/api-config';
  import { isOwner } from '../stores/security-policy';

  // Props
  export let onApprovalChange: (() => void) | undefined = undefined;

  // State
  let pendingDesires: any[] = [];
  let processingId: string | null = null;
  let error = '';
  let pollInterval: ReturnType<typeof setInterval> | null = null;
  let expanded = false;
  let expandedDesireId: string | null = null;
  let showTrustPanel = false;
  let currentTrustLevel = 'supervised_auto';

  const TRUST_LEVELS = [
    { value: 'observe', label: 'Observe' },
    { value: 'suggest', label: 'Suggest' },
    { value: 'supervised_auto', label: 'Supervised' },
    { value: 'bounded_auto', label: 'Bounded' },
    { value: 'adaptive_auto', label: 'Adaptive' },
  ];

  const SOURCE_LABELS: Record<string, string> = {
    persona_goal: '🎯 Persona Goal',
    urgent_task: '🔥 Urgent Task',
    task: '📋 Task',
    memory_pattern: '🧠 Memory Pattern',
    curiosity: '❓ Curiosity',
    reflection: '💭 Reflection',
    dream: '🌙 Dream',
    tool_suggestion: '🔧 Tool Suggestion',
  };

  function getRiskColor(risk: string) {
    switch (risk) {
      case 'none':
      case 'low': return 'risk-low';
      case 'medium': return 'risk-medium';
      case 'high':
      case 'critical': return 'risk-high';
      default: return 'risk-medium';
    }
  }

  function formatStrength(strength: number): string {
    return `${Math.round(strength * 100)}%`;
  }

  // Calculate trust degradation based on desire maturity
  // Mirrors the logic from packages/core/src/agency/config.ts
  function calculateTrustDegradation(desire: any): { reduction: number; effectiveLevel: string; reason: string } {
    const TRUST_ORDER: Record<string, number> = {
      observe: 0,
      suggest: 1,
      supervised_auto: 2,
      bounded_auto: 3,
      adaptive_auto: 4,
    };
    const TRUST_NAMES: Record<number, string> = {
      0: 'observe',
      1: 'suggest',
      2: 'supervised_auto',
      3: 'bounded_auto',
      4: 'adaptive_auto',
    };

    const baseLevel = desire.requiredTrustLevel || 'supervised_auto';
    const baseLevelOrder = TRUST_ORDER[baseLevel] ?? 2;
    const minLevelOrder = 1; // suggest is the floor

    const metrics = desire.metrics || {};
    const reinforcements = metrics.reinforcementCount || desire.reinforcements || 0;
    const cycles = metrics.cycleCount || 0;
    const approvals = metrics.userApprovalCount || 0;
    const successRate = metrics.executionSuccessCount > 0
      ? metrics.executionSuccessCount / (metrics.executionAttemptCount || 1)
      : 0;

    let reduction = 0;
    const reasons: string[] = [];

    // First level reduction
    if (reinforcements >= 3) {
      reduction = Math.max(reduction, 1);
      reasons.push(`${reinforcements} reinforcements`);
    }
    if (cycles >= 2 && successRate >= 0.5) {
      reduction = Math.max(reduction, 1);
      reasons.push(`${cycles} cycles`);
    }
    if (approvals >= 2) {
      reduction = Math.max(reduction, 1);
      reasons.push(`${approvals} approvals`);
    }

    // Second level reduction
    const combinedScore = reinforcements + cycles + approvals;
    if (reinforcements >= 8) {
      reduction = Math.max(reduction, 2);
    }
    if (combinedScore >= 10 && successRate >= 0.7) {
      reduction = Math.max(reduction, 2);
    }

    const effectiveLevelOrder = Math.max(minLevelOrder, baseLevelOrder - reduction);
    const effectiveLevel = TRUST_NAMES[effectiveLevelOrder] || baseLevel;

    const reason = reduction > 0 ? reasons.join(', ') : '';
    return { reduction, effectiveLevel, reason };
  }

  function formatDate(iso: string): string {
    const date = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString();
  }

  function toggleDesireExpand(id: string) {
    expandedDesireId = expandedDesireId === id ? null : id;
  }

  async function loadPendingDesires() {
    if (!$isOwner) return;

    try {
      const res = await apiFetch('/api/agency/desires?status=awaiting_approval');
      if (res.ok) {
        const data = await res.json();
        pendingDesires = (data.desires || []).filter((d: any) => d.status === 'awaiting_approval');
      }
    } catch (err) {
      console.error('[ApprovalPrompt] Failed to load desires:', err);
    }
  }

  async function loadTrustLevel() {
    try {
      const res = await apiFetch('/api/trust');
      if (res.ok) {
        const data = await res.json();
        currentTrustLevel = data.level || 'supervised_auto';
      }
    } catch (err) {
      console.error('[ApprovalPrompt] Failed to load trust level:', err);
    }
  }

  async function handleApprove(id: string, e?: Event) {
    e?.stopPropagation();
    if (processingId) return;
    processingId = id;
    error = '';

    try {
      const res = await apiFetch(`/api/agency/desires/${id}/approve`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to approve');
      }
      pendingDesires = pendingDesires.filter(d => d.id !== id);
      if (expandedDesireId === id) expandedDesireId = null;
      onApprovalChange?.();
    } catch (err) {
      error = (err as Error).message;
      setTimeout(() => { error = ''; }, 3000);
    } finally {
      processingId = null;
    }
  }

  async function handleReject(id: string, e?: Event) {
    e?.stopPropagation();
    if (processingId) return;
    processingId = id;
    error = '';

    try {
      const res = await apiFetch(`/api/agency/desires/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'User rejected' }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to reject');
      }
      pendingDesires = pendingDesires.filter(d => d.id !== id);
      if (expandedDesireId === id) expandedDesireId = null;
      onApprovalChange?.();
    } catch (err) {
      error = (err as Error).message;
      setTimeout(() => { error = ''; }, 3000);
    } finally {
      processingId = null;
    }
  }

  async function handleApproveAll() {
    for (const desire of [...pendingDesires]) {
      await handleApprove(desire.id);
    }
  }

  async function updateTrustLevel(newLevel: string) {
    try {
      const res = await apiFetch('/api/trust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level: newLevel }),
      });
      if (res.ok) {
        currentTrustLevel = newLevel;
        showTrustPanel = false;
        await loadPendingDesires();
        onApprovalChange?.();
      }
    } catch (err) {
      console.error('[ApprovalPrompt] Failed to update trust level:', err);
    }
  }

  onMount(() => {
    loadPendingDesires();
    loadTrustLevel();
    pollInterval = setInterval(loadPendingDesires, 10000);
  });

  onDestroy(() => {
    if (pollInterval) clearInterval(pollInterval);
  });
</script>

{#if $isOwner && pendingDesires.length > 0}
  <div class="approval-bar">
    <!-- Compact Header -->
    <div class="bar-header">
      <span class="bar-icon">⚡</span>
      <span class="bar-count">{pendingDesires.length}</span>
      <span class="bar-label">approval{pendingDesires.length !== 1 ? 's' : ''} needed</span>

      <div class="bar-actions">
        <button class="bar-btn approve" on:click={handleApproveAll} title="Approve all">
          ✓ All
        </button>
        <button class="bar-btn trust" on:click={() => showTrustPanel = !showTrustPanel} title="Change trust level">
          🔐
        </button>
        <button class="bar-btn expand" on:click={() => expanded = !expanded}>
          {expanded ? '▼' : '▲'}
        </button>
      </div>
    </div>

    <!-- Trust Level Selector -->
    {#if showTrustPanel}
      <div class="trust-selector">
        {#each TRUST_LEVELS as level}
          <button
            class="trust-btn {currentTrustLevel === level.value ? 'active' : ''}"
            on:click={() => updateTrustLevel(level.value)}
          >
            {level.label}
          </button>
        {/each}
      </div>
    {/if}

    <!-- Expanded List -->
    {#if expanded}
      <div class="desire-list">
        {#each pendingDesires as desire}
          <div class="desire-item-wrapper">
            <!-- Collapsed Row -->
            <div
              class="desire-item {expandedDesireId === desire.id ? 'selected' : ''}"
              on:click={() => toggleDesireExpand(desire.id)}
              on:keydown={(e) => e.key === 'Enter' && toggleDesireExpand(desire.id)}
              role="button"
              tabindex="0"
            >
              <span class="expand-icon">{expandedDesireId === desire.id ? '▼' : '▶'}</span>
              <span class="desire-title">{desire.title}</span>
              <span class="desire-source">{SOURCE_LABELS[desire.source] || desire.source}</span>
              <span class="desire-risk {getRiskColor(desire.plan?.estimatedRisk || desire.risk || 'medium')}">
                {desire.plan?.estimatedRisk || desire.risk || 'medium'}
              </span>
              <button
                class="item-btn approve"
                disabled={processingId === desire.id}
                on:click={(e) => handleApprove(desire.id, e)}
              >✓</button>
              <button
                class="item-btn reject"
                disabled={processingId === desire.id}
                on:click={(e) => handleReject(desire.id, e)}
              >✗</button>
            </div>

            <!-- Expanded Details -->
            {#if expandedDesireId === desire.id}
              <div class="desire-details">
                <!-- Description -->
                <div class="detail-section">
                  <div class="detail-label">What</div>
                  <div class="detail-value">{desire.description}</div>
                </div>

                <!-- Reason -->
                {#if desire.reason}
                  <div class="detail-section">
                    <div class="detail-label">Why</div>
                    <div class="detail-value">{desire.reason}</div>
                  </div>
                {/if}

                <!-- Metrics Row -->
                <div class="metrics-row">
                  <div class="metric">
                    <span class="metric-label">Strength</span>
                    <span class="metric-value strength">{formatStrength(desire.strength)}</span>
                  </div>
                  <div class="metric">
                    <span class="metric-label">Created</span>
                    <span class="metric-value">{formatDate(desire.createdAt)}</span>
                  </div>
                  <div class="metric">
                    <span class="metric-label">Reinforced</span>
                    <span class="metric-value">{desire.reinforcements || 0}x</span>
                  </div>
                  {#if desire.metrics?.cycleCount > 0}
                    <div class="metric">
                      <span class="metric-label">Cycles</span>
                      <span class="metric-value">{desire.metrics.cycleCount}</span>
                    </div>
                  {/if}
                </div>

                <!-- Plan Steps -->
                {#if desire.plan?.steps?.length > 0}
                  <div class="detail-section">
                    <div class="detail-label">Plan ({desire.plan.steps.length} steps)</div>
                    <div class="plan-steps">
                      {#each desire.plan.steps.slice(0, 5) as step, i}
                        <div class="plan-step">
                          <span class="step-num">{i + 1}</span>
                          <span class="step-action">{step.action}</span>
                          {#if step.risk && step.risk !== 'none'}
                            <span class="step-risk {getRiskColor(step.risk)}">{step.risk}</span>
                          {/if}
                        </div>
                      {/each}
                      {#if desire.plan.steps.length > 5}
                        <div class="plan-more">+{desire.plan.steps.length - 5} more steps...</div>
                      {/if}
                    </div>
                  </div>
                {/if}

                <!-- Trust Requirement (with maturity-based degradation) -->
                {#if true}
                  {@const degradation = calculateTrustDegradation(desire)}
                  <div class="trust-info">
                    <span class="trust-label">Requires:</span>
                    {#if degradation.reduction > 0}
                      <span class="trust-value degraded">{degradation.effectiveLevel}</span>
                      <span class="trust-reduction" title={degradation.reason}>
                        ↓{degradation.reduction} from {desire.requiredTrustLevel || 'supervised_auto'}
                      </span>
                    {:else}
                      <span class="trust-value">{desire.requiredTrustLevel || 'supervised_auto'}</span>
                    {/if}
                    <span class="trust-current">
                      (You: {currentTrustLevel})
                    </span>
                  </div>
                {/if}

                <!-- Action Buttons -->
                <div class="detail-actions">
                  <button
                    class="action-btn approve"
                    disabled={processingId === desire.id}
                    on:click={(e) => handleApprove(desire.id, e)}
                  >
                    {processingId === desire.id ? 'Approving...' : '✓ Approve & Execute'}
                  </button>
                  <button
                    class="action-btn reject"
                    disabled={processingId === desire.id}
                    on:click={(e) => handleReject(desire.id, e)}
                  >
                    {processingId === desire.id ? 'Rejecting...' : '✗ Reject'}
                  </button>
                </div>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    {#if error}
      <div class="error-msg">{error}</div>
    {/if}
  </div>
{/if}

<style>
  .approval-bar {
    background: linear-gradient(90deg, rgba(59, 130, 246, 0.15) 0%, rgba(59, 130, 246, 0.05) 100%);
    border: 1px solid rgba(59, 130, 246, 0.3);
    border-radius: 8px;
    margin: 8px 12px;
    overflow: hidden;
  }

  .bar-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    font-size: 13px;
  }

  .bar-icon {
    animation: pulse 2s infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  .bar-count {
    font-weight: 700;
    color: #60a5fa;
  }

  .bar-label {
    color: #94a3b8;
    flex: 1;
  }

  .bar-actions {
    display: flex;
    gap: 4px;
  }

  .bar-btn {
    padding: 4px 8px;
    border-radius: 4px;
    border: none;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .bar-btn.approve {
    background: #22c55e;
    color: white;
  }

  .bar-btn.approve:hover {
    background: #16a34a;
  }

  .bar-btn.trust, .bar-btn.expand {
    background: rgba(255, 255, 255, 0.1);
    color: #94a3b8;
  }

  .bar-btn.trust:hover, .bar-btn.expand:hover {
    background: rgba(255, 255, 255, 0.2);
  }

  .trust-selector {
    display: flex;
    gap: 4px;
    padding: 6px 12px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(0, 0, 0, 0.1);
  }

  .trust-btn {
    flex: 1;
    padding: 4px 8px;
    border-radius: 4px;
    border: 1px solid rgba(59, 130, 246, 0.2);
    background: transparent;
    color: #94a3b8;
    font-size: 11px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .trust-btn:hover {
    background: rgba(59, 130, 246, 0.1);
  }

  .trust-btn.active {
    background: rgba(59, 130, 246, 0.3);
    border-color: #3b82f6;
    color: #60a5fa;
  }

  .desire-list {
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    max-height: 350px;
    overflow-y: auto;
  }

  .desire-item-wrapper {
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  }

  .desire-item-wrapper:last-child {
    border-bottom: none;
  }

  .desire-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    cursor: pointer;
    transition: background 0.15s;
  }

  .desire-item:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  .desire-item.selected {
    background: rgba(59, 130, 246, 0.1);
  }

  .expand-icon {
    font-size: 10px;
    color: #64748b;
    width: 12px;
  }

  .desire-title {
    flex: 1;
    font-size: 12px;
    color: #e2e8f0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .desire-source {
    font-size: 10px;
    color: #64748b;
    white-space: nowrap;
  }

  .desire-risk {
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 3px;
    font-weight: 500;
  }

  .risk-low { background: rgba(34, 197, 94, 0.2); color: #4ade80; }
  .risk-medium { background: rgba(234, 179, 8, 0.2); color: #facc15; }
  .risk-high { background: rgba(239, 68, 68, 0.2); color: #f87171; }

  .item-btn {
    width: 24px;
    height: 24px;
    border-radius: 4px;
    border: none;
    cursor: pointer;
    font-size: 12px;
    transition: all 0.15s;
  }

  .item-btn.approve {
    background: rgba(34, 197, 94, 0.2);
    color: #4ade80;
  }

  .item-btn.approve:hover:not(:disabled) {
    background: #22c55e;
    color: white;
  }

  .item-btn.reject {
    background: rgba(239, 68, 68, 0.2);
    color: #f87171;
  }

  .item-btn.reject:hover:not(:disabled) {
    background: #ef4444;
    color: white;
  }

  .item-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Expanded Details */
  .desire-details {
    padding: 12px 16px;
    background: rgba(0, 0, 0, 0.2);
    border-top: 1px solid rgba(59, 130, 246, 0.2);
  }

  .detail-section {
    margin-bottom: 12px;
  }

  .detail-label {
    font-size: 10px;
    font-weight: 600;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 4px;
  }

  .detail-value {
    font-size: 13px;
    color: #e2e8f0;
    line-height: 1.4;
  }

  .metrics-row {
    display: flex;
    gap: 16px;
    margin-bottom: 12px;
    flex-wrap: wrap;
  }

  .metric {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .metric-label {
    font-size: 10px;
    color: #64748b;
  }

  .metric-value {
    font-size: 13px;
    font-weight: 600;
    color: #e2e8f0;
  }

  .metric-value.strength {
    color: #60a5fa;
  }

  .plan-steps {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .plan-step {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px;
    background: rgba(255, 255, 255, 0.03);
    border-radius: 4px;
    font-size: 12px;
  }

  .step-num {
    width: 18px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(59, 130, 246, 0.2);
    color: #60a5fa;
    border-radius: 50%;
    font-size: 10px;
    font-weight: 600;
  }

  .step-action {
    flex: 1;
    color: #cbd5e1;
  }

  .step-risk {
    font-size: 9px;
    padding: 1px 4px;
    border-radius: 2px;
  }

  .plan-more {
    font-size: 11px;
    color: #64748b;
    padding: 4px 8px;
  }

  .trust-info {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    padding: 8px;
    background: rgba(255, 255, 255, 0.03);
    border-radius: 4px;
    margin-bottom: 12px;
  }

  .trust-label {
    color: #64748b;
  }

  .trust-value {
    color: #f59e0b;
    font-weight: 500;
  }

  .trust-value.degraded {
    color: #22c55e;
  }

  .trust-reduction {
    font-size: 10px;
    color: #22c55e;
    background: rgba(34, 197, 94, 0.15);
    padding: 2px 6px;
    border-radius: 3px;
    cursor: help;
  }

  .trust-current {
    color: #64748b;
  }

  .detail-actions {
    display: flex;
    gap: 8px;
  }

  .action-btn {
    flex: 1;
    padding: 10px 16px;
    border-radius: 6px;
    border: none;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
  }

  .action-btn.approve {
    background: #22c55e;
    color: white;
  }

  .action-btn.approve:hover:not(:disabled) {
    background: #16a34a;
  }

  .action-btn.reject {
    background: rgba(239, 68, 68, 0.2);
    color: #f87171;
    border: 1px solid rgba(239, 68, 68, 0.3);
  }

  .action-btn.reject:hover:not(:disabled) {
    background: rgba(239, 68, 68, 0.3);
  }

  .action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .error-msg {
    padding: 4px 12px;
    background: rgba(239, 68, 68, 0.2);
    color: #fca5a5;
    font-size: 11px;
  }

  /* Light mode */
  :global(.light) .approval-bar {
    background: linear-gradient(90deg, rgba(59, 130, 246, 0.1) 0%, rgba(59, 130, 246, 0.03) 100%);
  }

  :global(.light) .bar-label,
  :global(.light) .desire-source,
  :global(.light) .detail-label,
  :global(.light) .metric-label,
  :global(.light) .trust-label,
  :global(.light) .trust-current {
    color: #64748b;
  }

  :global(.light) .desire-title,
  :global(.light) .detail-value,
  :global(.light) .metric-value,
  :global(.light) .step-action {
    color: #1e293b;
  }

  :global(.light) .bar-btn.trust,
  :global(.light) .bar-btn.expand {
    background: rgba(0, 0, 0, 0.05);
    color: #64748b;
  }

  :global(.light) .desire-details {
    background: rgba(255, 255, 255, 0.5);
  }

  :global(.light) .plan-step,
  :global(.light) .trust-info {
    background: rgba(0, 0, 0, 0.03);
  }
</style>
