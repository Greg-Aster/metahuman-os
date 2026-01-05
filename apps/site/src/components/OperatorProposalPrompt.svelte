<script lang="ts">
  /**
   * OperatorProposalPrompt - Human-in-the-Loop approval system for Active Operator
   *
   * Shows pending proposals that need user approval BEFORE execution.
   * Post-execution feedback is now handled by the unified FeedbackButtons in InputArea.
   */
  import { onMount, onDestroy } from 'svelte';
  import { apiFetch } from '../lib/client/api-config';
  import OperatorProposalCard from './OperatorProposalCard.svelte';

  // Props
  export let onProposalChange: (() => void) | undefined = undefined;

  // State - only proposals, feedback is handled elsewhere
  let proposals: any[] = [];
  let pollInterval: ReturnType<typeof setInterval> | null = null;
  let loading = false;

  async function loadProposals() {
    try {
      loading = true;
      const res = await apiFetch('/api/operator-proposals');
      if (res.ok) {
        const data = await res.json();
        proposals = data.proposals || [];
        // Post-feedback is now handled by FeedbackButtons in InputArea
      }
    } catch (err) {
      console.error('[OperatorProposalPrompt] Error loading proposals:', err);
    } finally {
      loading = false;
    }
  }

  function handleResponded(event: CustomEvent) {
    const { proposalId } = event.detail;
    proposals = proposals.filter(p => p.id !== proposalId);
    onProposalChange?.();
    // Refresh to check for new proposals
    loadProposals();
  }

  onMount(() => {
    loadProposals();
    // Poll every 5 seconds for new proposals
    pollInterval = setInterval(loadProposals, 5000);
  });

  onDestroy(() => {
    if (pollInterval) {
      clearInterval(pollInterval);
    }
  });

  $: hasItems = proposals.length > 0;
</script>

{#if hasItems}
  <div class="operator-proposals-container">
    <div class="section-header">
      <span class="section-icon">🤖</span>
      <span class="section-title">Awaiting Your Input</span>
      <span class="section-count">{proposals.length}</span>
    </div>
    {#each proposals as proposal (proposal.id)}
      <OperatorProposalCard
        {proposal}
        type="proposal"
        on:responded={handleResponded}
      />
    {/each}
  </div>
{/if}

<style>
  .operator-proposals-container {
    padding: 0.5rem;
    border-bottom: 1px solid var(--border-color, #333);
    background: var(--bg-primary, #0a0a0a);
    max-height: 150px;
    overflow-y: auto;
  }

  .section-header {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    margin-bottom: 0.35rem;
    padding: 0.25rem 0;
    font-size: 0.8rem;
  }

  .section-icon {
    font-size: 0.9rem;
  }

  .section-title {
    font-weight: 600;
    color: var(--text-primary, #fff);
    font-size: 0.8rem;
  }

  .section-count {
    margin-left: auto;
    background: var(--accent-color, #3b82f6);
    color: white;
    font-size: 0.65rem;
    padding: 0.1rem 0.35rem;
    border-radius: 999px;
    font-weight: 600;
  }
</style>
