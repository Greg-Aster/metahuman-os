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
    if (!$isOwner) return;
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
    if (!$isOwner) return;
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
  <div class="bg-gradient-to-r from-blue-500/15 to-blue-500/5 border border-blue-500/30 rounded-lg mx-3 my-2 overflow-hidden">
    <!-- Compact Header -->
    <div class="flex items-center gap-1.5 px-3 py-2 text-[13px]">
      <span class="animate-pulse">⚡</span>
      <span class="font-bold text-blue-400">{pendingDesires.length}</span>
      <span class="text-slate-400 flex-1">approval{pendingDesires.length !== 1 ? 's' : ''} needed</span>

      <div class="flex gap-1">
        <button
          class="px-2 py-1 rounded text-xs cursor-pointer transition-all bg-green-500 text-white hover:bg-green-600"
          on:click={handleApproveAll}
          title="Approve all"
        >
          ✓ All
        </button>
        <button
          class="px-2 py-1 rounded text-xs cursor-pointer transition-all bg-white/10 text-slate-400 hover:bg-white/20"
          on:click={() => showTrustPanel = !showTrustPanel}
          title="Change trust level"
        >
          🔐
        </button>
        <button
          class="px-2 py-1 rounded text-xs cursor-pointer transition-all bg-white/10 text-slate-400 hover:bg-white/20"
          on:click={() => expanded = !expanded}
        >
          {expanded ? '▼' : '▲'}
        </button>
      </div>
    </div>

    <!-- Trust Level Selector -->
    {#if showTrustPanel}
      <div class="flex gap-1 px-3 py-1.5 border-t border-white/10 bg-black/10">
        {#each TRUST_LEVELS as level}
          <button
            class="flex-1 px-2 py-1 rounded border text-[11px] cursor-pointer transition-all {currentTrustLevel === level.value ? 'bg-blue-500/30 border-blue-500 text-blue-400' : 'border-blue-500/20 bg-transparent text-slate-400 hover:bg-blue-500/10'}"
            on:click={() => updateTrustLevel(level.value)}
          >
            {level.label}
          </button>
        {/each}
      </div>
    {/if}

    <!-- Expanded List -->
    {#if expanded}
      <div class="border-t border-white/10 max-h-[350px] overflow-y-auto">
        {#each pendingDesires as desire}
          <div class="border-b border-white/5 last:border-b-0">
            <!-- Collapsed Row -->
            <div
              class="flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors {expandedDesireId === desire.id ? 'bg-blue-500/10' : 'hover:bg-white/5'}"
              on:click={() => toggleDesireExpand(desire.id)}
              on:keydown={(e) => e.key === 'Enter' && toggleDesireExpand(desire.id)}
              role="button"
              tabindex="0"
            >
              <span class="text-[10px] text-slate-500 w-3">{expandedDesireId === desire.id ? '▼' : '▶'}</span>
              <span class="flex-1 text-xs text-slate-200 whitespace-nowrap overflow-hidden text-ellipsis">{desire.title}</span>
              <span class="text-[10px] text-slate-500 whitespace-nowrap">{SOURCE_LABELS[desire.source] || desire.source}</span>
              <span class="text-[10px] px-1.5 py-0.5 rounded font-medium {(desire.plan?.estimatedRisk || desire.risk || 'medium') === 'low' || (desire.plan?.estimatedRisk || desire.risk || 'medium') === 'none' ? 'bg-green-500/20 text-green-400' : (desire.plan?.estimatedRisk || desire.risk || 'medium') === 'medium' ? 'bg-yellow-500/20 text-yellow-300' : 'bg-red-500/20 text-red-400'}">
                {desire.plan?.estimatedRisk || desire.risk || 'medium'}
              </span>
              <button
                class="w-6 h-6 rounded border-none cursor-pointer text-xs transition-all bg-green-500/20 text-green-400 hover:bg-green-500 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={processingId === desire.id}
                on:click={(e) => handleApprove(desire.id, e)}
              >✓</button>
              <button
                class="w-6 h-6 rounded border-none cursor-pointer text-xs transition-all bg-red-500/20 text-red-400 hover:bg-red-500 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={processingId === desire.id}
                on:click={(e) => handleReject(desire.id, e)}
              >✗</button>
            </div>

            <!-- Expanded Details -->
            {#if expandedDesireId === desire.id}
              <div class="px-4 py-3 bg-black/20 border-t border-blue-500/20">
                <!-- Description -->
                <div class="mb-3">
                  <div class="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">What</div>
                  <div class="text-[13px] text-slate-200 leading-relaxed">{desire.description}</div>
                </div>

                <!-- Reason -->
                {#if desire.reason}
                  <div class="mb-3">
                    <div class="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Why</div>
                    <div class="text-[13px] text-slate-200 leading-relaxed">{desire.reason}</div>
                  </div>
                {/if}

                <!-- Metrics Row -->
                <div class="flex gap-4 mb-3 flex-wrap">
                  <div class="flex flex-col gap-0.5">
                    <span class="text-[10px] text-slate-500">Strength</span>
                    <span class="text-[13px] font-semibold text-blue-400">{formatStrength(desire.strength)}</span>
                  </div>
                  <div class="flex flex-col gap-0.5">
                    <span class="text-[10px] text-slate-500">Created</span>
                    <span class="text-[13px] font-semibold text-slate-200">{formatDate(desire.createdAt)}</span>
                  </div>
                  <div class="flex flex-col gap-0.5">
                    <span class="text-[10px] text-slate-500">Reinforced</span>
                    <span class="text-[13px] font-semibold text-slate-200">{desire.reinforcements || 0}x</span>
                  </div>
                  {#if desire.metrics?.cycleCount > 0}
                    <div class="flex flex-col gap-0.5">
                      <span class="text-[10px] text-slate-500">Cycles</span>
                      <span class="text-[13px] font-semibold text-slate-200">{desire.metrics.cycleCount}</span>
                    </div>
                  {/if}
                </div>

                <!-- Plan Steps -->
                {#if desire.plan?.steps?.length > 0}
                  <div class="mb-3">
                    <div class="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Plan ({desire.plan.steps.length} steps)</div>
                    <div class="flex flex-col gap-1">
                      {#each desire.plan.steps.slice(0, 5) as step, i}
                        <div class="flex items-center gap-2 px-2 py-1 bg-white/[0.03] rounded text-xs">
                          <span class="w-[18px] h-[18px] flex items-center justify-center bg-blue-500/20 text-blue-400 rounded-full text-[10px] font-semibold">{i + 1}</span>
                          <span class="flex-1 text-slate-300">{step.action}</span>
                          {#if step.risk && step.risk !== 'none'}
                            <span class="text-[9px] px-1 py-0.5 rounded {step.risk === 'low' ? 'bg-green-500/20 text-green-400' : step.risk === 'medium' ? 'bg-yellow-500/20 text-yellow-300' : 'bg-red-500/20 text-red-400'}">{step.risk}</span>
                          {/if}
                        </div>
                      {/each}
                      {#if desire.plan.steps.length > 5}
                        <div class="text-[11px] text-slate-500 px-2 py-1">+{desire.plan.steps.length - 5} more steps...</div>
                      {/if}
                    </div>
                  </div>
                {/if}

                <!-- Trust Requirement (with maturity-based degradation) -->
                {#if true}
                  {@const degradation = calculateTrustDegradation(desire)}
                  <div class="flex items-center gap-1.5 text-[11px] p-2 bg-white/[0.03] rounded mb-3">
                    <span class="text-slate-500">Requires:</span>
                    {#if degradation.reduction > 0}
                      <span class="text-green-500 font-medium">{degradation.effectiveLevel}</span>
                      <span class="text-[10px] text-green-500 bg-green-500/15 px-1.5 py-0.5 rounded cursor-help" title={degradation.reason}>
                        ↓{degradation.reduction} from {desire.requiredTrustLevel || 'supervised_auto'}
                      </span>
                    {:else}
                      <span class="text-amber-500 font-medium">{desire.requiredTrustLevel || 'supervised_auto'}</span>
                    {/if}
                    <span class="text-slate-500">
                      (You: {currentTrustLevel})
                    </span>
                  </div>
                {/if}

                <!-- Action Buttons -->
                <div class="flex gap-2">
                  <button
                    class="flex-1 px-4 py-2.5 rounded-md border-none text-[13px] font-medium cursor-pointer transition-all bg-green-500 text-white hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={processingId === desire.id}
                    on:click={(e) => handleApprove(desire.id, e)}
                  >
                    {processingId === desire.id ? 'Approving...' : '✓ Approve & Execute'}
                  </button>
                  <button
                    class="flex-1 px-4 py-2.5 rounded-md text-[13px] font-medium cursor-pointer transition-all bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
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
      <div class="px-3 py-1 bg-red-500/20 text-red-300 text-[11px]">{error}</div>
    {/if}
  </div>
{/if}
