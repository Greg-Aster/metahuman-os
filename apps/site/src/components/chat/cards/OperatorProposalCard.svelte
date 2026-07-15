<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import BaseMessageCard from './BaseMessageCard.svelte';
  import type { ChatMessage } from '../../../lib/client/composables/useMessages';
  import {
    proposalsStore,
    respondToProposal as storeRespondToProposal,
  } from '../../../stores/proposals';

  export let message: ChatMessage;
  export let index: number;
  export let isSelected: boolean = false;

  const dispatch = createEventDispatcher();

  // Local UI state
  let loading = false;
  let showModifyInput = false;
  let modifyInput = '';
  let responseStatus: 'approved' | 'rejected' | 'modified' | null = null;
  let errorMessage: string | null = null;

  // Extract task from message content (e.g., "**Task:** training_curate")
  $: messageTask = extractTaskFromContent(message.content);

  // Reactively find matching proposal from the store (no polling!)
  $: pendingProposal = messageTask
    ? $proposalsStore.proposals.find(
        (p) => p.taskType === messageTask && p.status === 'pending'
      ) || null
    : null;

  function extractTaskFromContent(content: string): string | null {
    const match = content.match(/\*\*Task:\*\*\s*(\w+)/);
    return match ? match[1] : null;
  }

  async function respond(response: 'approved' | 'rejected' | 'modified') {
    if (!pendingProposal || loading) return;
    loading = true;
    errorMessage = null;

    const proposalId = pendingProposal.id;

    const result = await storeRespondToProposal(
      proposalId,
      response,
      response === 'modified' ? modifyInput : undefined
    );

    if (result.success) {
      responseStatus = response;
      dispatch('proposalResponded', { proposalId, response });
    } else {
      errorMessage = result.error || 'Failed to respond';
    }

    loading = false;
  }

  function handleApprove() {
    respond('approved');
  }

  function handleReject() {
    respond('rejected');
  }

  function toggleModify() {
    showModifyInput = !showModifyInput;
    if (!showModifyInput) {
      modifyInput = '';
    }
  }

  function submitModification() {
    if (modifyInput.trim()) {
      respond('modified');
    }
  }
</script>

<BaseMessageCard
  {message}
  {index}
  {isSelected}
  roleLabel="Operator Policy"
  roleIcon="🧭"
  accentColor={pendingProposal ? '#f59e0b' : (message.meta?.displayColor || '#8b5cf6')}
  on:messageClick
  on:deleteMessage
  on:validateMessage
  on:speakMessage
>
  <svelte:fragment slot="content">
    <p class="m-0 whitespace-pre-wrap break-words leading-relaxed">{message.content}</p>
  </svelte:fragment>

  <svelte:fragment slot="footer">
    {#if responseStatus}
      <div class="py-2 px-3 rounded-md text-[0.8125rem] font-medium text-center mt-3 {responseStatus === 'approved' ? 'bg-green-500/20 text-green-500' : responseStatus === 'rejected' ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400'}">
        {responseStatus === 'approved' ? '✓ Approved - executing...' : responseStatus === 'rejected' ? '✗ Rejected' : '↻ Modified'}
      </div>
    {:else if pendingProposal}
      <div class="mt-3 pt-3 border-t border-white/10">
        <div class="flex items-center gap-2 mb-2 text-[0.8125rem] text-amber-500">
          <span class="text-base">🤖</span>
          <span class="font-medium">Awaiting your approval</span>
        </div>
        <div class="flex gap-2 flex-wrap">
          <button
            class="proposal-btn bg-green-500 text-white hover:bg-green-600"
            disabled={loading}
            on:click={handleApprove}
          >
            {loading ? '...' : '✓ Approve'}
          </button>
          <button
            class="proposal-btn bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30"
            disabled={loading}
            on:click={handleReject}
          >
            ✗ Reject
          </button>
          <button
            class="proposal-btn text-blue-400 border border-blue-500/30 hover:bg-blue-500/30 {showModifyInput ? 'bg-blue-500/40' : 'bg-blue-500/20'}"
            disabled={loading}
            on:click={toggleModify}
          >
            ✎ Modify
          </button>
        </div>

        {#if errorMessage}
          <span class="block text-red-400 text-xs mt-2">{errorMessage}</span>
        {/if}

        {#if showModifyInput}
          <div class="mt-3 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
            <textarea
              bind:value={modifyInput}
              placeholder="How should this task be modified?"
              rows="2"
              class="w-full p-2 border border-white/15 rounded-md bg-black/30 text-inherit text-[0.8125rem] font-inherit resize-y min-h-[50px] focus:outline-none focus:border-blue-500"
            ></textarea>
            <div class="flex gap-2 mt-2 justify-end">
              <button
                class="proposal-btn bg-blue-500 text-white hover:bg-blue-600"
                disabled={!modifyInput.trim() || loading}
                on:click={submitModification}
              >
                {loading ? 'Submitting...' : 'Submit Modification'}
              </button>
              <button class="proposal-btn bg-transparent text-gray-400 border border-gray-600 hover:bg-white/5" on:click={toggleModify}>
                Cancel
              </button>
            </div>
          </div>
        {/if}
      </div>
    {/if}
  </svelte:fragment>
</BaseMessageCard>

<style>
  .proposal-btn {
    @apply py-2 px-4 rounded-md border-0 text-[0.8125rem] font-medium cursor-pointer transition-all;
  }
  .proposal-btn:disabled {
    @apply opacity-60 cursor-not-allowed;
  }

  /* Light mode border adjustments */
  :global(.light) .border-white\/10 {
    border-color: rgba(0, 0, 0, 0.1);
  }
</style>
