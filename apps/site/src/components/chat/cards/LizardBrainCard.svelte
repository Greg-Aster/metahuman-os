<script lang="ts">
  import { onMount, createEventDispatcher } from 'svelte';
  import BaseMessageCard from './BaseMessageCard.svelte';
  import type { ChatMessage } from '../../../lib/client/composables/useMessages';
  import { apiFetch } from '../../../lib/client/api-config';

  export let message: ChatMessage;
  export let index: number;
  export let isSelected: boolean = false;

  const dispatch = createEventDispatcher();

  // Proposal state
  interface Proposal {
    id: string;
    taskType: string;
    taskDescription: string;
    reasoning: string;
    status: string;
  }

  let pendingProposal: Proposal | null = null;
  let loading = false;
  let showModifyInput = false;
  let modifyInput = '';
  let responseStatus: 'approved' | 'rejected' | 'modified' | null = null;
  let errorMessage: string | null = null;
  let proposalLoading = true;

  // Extract task from message content (e.g., "**Task:** training_curate")
  $: messageTask = extractTaskFromContent(message.content);

  function extractTaskFromContent(content: string): string | null {
    const match = content.match(/\*\*Task:\*\*\s*(\w+)/);
    return match ? match[1] : null;
  }

  async function loadProposals() {
    try {
      proposalLoading = true;
      const res = await apiFetch('/api/operator-proposals');
      if (res.ok) {
        const data = await res.json();
        const proposals: Proposal[] = data.proposals || [];

        // Find a proposal matching this message's task
        if (messageTask) {
          pendingProposal = proposals.find(p =>
            p.taskType === messageTask && p.status === 'pending'
          ) || null;
        }
      }
    } catch (err) {
      console.error('[LizardBrainCard] Error loading proposals:', err);
    } finally {
      proposalLoading = false;
    }
  }

  onMount(() => {
    loadProposals();

    // Poll for proposals every 2 seconds while we don't have one
    // This handles the case where the proposal is created after the card appears
    let pollInterval: NodeJS.Timeout | null = null;
    const startPolling = () => {
      if (pollInterval) return;
      pollInterval = setInterval(() => {
        if (!pendingProposal && !responseStatus) {
          loadProposals();
        } else {
          // Stop polling once we have a proposal or response
          if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
          }
        }
      }, 2000);
    };
    startPolling();

    // Refresh proposals when tab becomes visible
    const handleVisibility = () => {
      if (!document.hidden) {
        loadProposals();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      if (pollInterval) {
        clearInterval(pollInterval);
      }
    };
  });

  async function respond(response: 'approved' | 'rejected' | 'modified') {
    if (!pendingProposal || loading) return;
    loading = true;
    errorMessage = null;

    try {
      const res = await apiFetch('/api/operator-proposals/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proposalId: pendingProposal.id,
          response,
          userInput: response === 'modified' ? modifyInput : undefined,
        }),
      });

      if (res.ok) {
        responseStatus = response;
        pendingProposal = null; // Clear proposal after response
        dispatch('proposalResponded', { proposalId: pendingProposal?.id, response });
      } else {
        const data = await res.json();
        errorMessage = data.error || 'Failed to respond';
      }
    } catch (err) {
      errorMessage = (err as Error).message;
    } finally {
      loading = false;
    }
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
  roleLabel="Lizard Brain"
  roleIcon="⚡"
  accentColor={pendingProposal ? '#f59e0b' : (message.meta?.displayColor || '#8b5cf6')}
  on:messageClick
  on:deleteMessage
  on:validateMessage
  on:speakMessage
>
  <svelte:fragment slot="content">
    <p class="lizard-text">{message.content}</p>
  </svelte:fragment>

  <svelte:fragment slot="footer">
    {#if responseStatus}
      <div class="response-status" class:approved={responseStatus === 'approved'} class:rejected={responseStatus === 'rejected'}>
        {responseStatus === 'approved' ? '✓ Approved - executing...' : responseStatus === 'rejected' ? '✗ Rejected' : '↻ Modified'}
      </div>
    {:else if pendingProposal}
      <div class="approval-section">
        <div class="approval-header">
          <span class="approval-icon">🤖</span>
          <span class="approval-label">Awaiting your approval</span>
        </div>
        <div class="approval-buttons">
          <button
            class="btn approve"
            disabled={loading}
            on:click={handleApprove}
          >
            {loading ? '...' : '✓ Approve'}
          </button>
          <button
            class="btn reject"
            disabled={loading}
            on:click={handleReject}
          >
            ✗ Reject
          </button>
          <button
            class="btn modify"
            class:active={showModifyInput}
            disabled={loading}
            on:click={toggleModify}
          >
            ✎ Modify
          </button>
        </div>

        {#if errorMessage}
          <span class="status-error">{errorMessage}</span>
        {/if}

        {#if showModifyInput}
          <div class="modify-form">
            <textarea
              bind:value={modifyInput}
              placeholder="How should this task be modified?"
              rows="2"
            ></textarea>
            <div class="modify-actions">
              <button
                class="btn submit"
                disabled={!modifyInput.trim() || loading}
                on:click={submitModification}
              >
                {loading ? 'Submitting...' : 'Submit Modification'}
              </button>
              <button class="btn cancel" on:click={toggleModify}>
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
  .lizard-text {
    margin: 0;
    white-space: pre-wrap;
    word-wrap: break-word;
    line-height: 1.6;
  }

  .response-status {
    padding: 0.5rem 0.75rem;
    border-radius: 6px;
    font-size: 0.8125rem;
    font-weight: 500;
    text-align: center;
    margin-top: 0.75rem;
  }

  .response-status.approved {
    background: rgba(34, 197, 94, 0.2);
    color: #22c55e;
  }

  .response-status.rejected {
    background: rgba(239, 68, 68, 0.2);
    color: #f87171;
  }

  .approval-section {
    margin-top: 0.75rem;
    padding-top: 0.75rem;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
  }

  .approval-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
    font-size: 0.8125rem;
    color: #f59e0b;
  }

  .approval-icon {
    font-size: 1rem;
  }

  .approval-label {
    font-weight: 500;
  }

  .approval-buttons {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .btn {
    padding: 0.5rem 1rem;
    border-radius: 6px;
    border: none;
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
  }

  .btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .btn.approve {
    background: #22c55e;
    color: white;
  }

  .btn.approve:hover:not(:disabled) {
    background: #16a34a;
  }

  .btn.reject {
    background: rgba(239, 68, 68, 0.2);
    color: #f87171;
    border: 1px solid rgba(239, 68, 68, 0.3);
  }

  .btn.reject:hover:not(:disabled) {
    background: rgba(239, 68, 68, 0.3);
  }

  .btn.modify {
    background: rgba(59, 130, 246, 0.2);
    color: #60a5fa;
    border: 1px solid rgba(59, 130, 246, 0.3);
  }

  .btn.modify:hover:not(:disabled) {
    background: rgba(59, 130, 246, 0.3);
  }

  .btn.modify.active {
    background: rgba(59, 130, 246, 0.4);
  }

  .btn.submit {
    background: #3b82f6;
    color: white;
  }

  .btn.submit:hover:not(:disabled) {
    background: #2563eb;
  }

  .btn.cancel {
    background: transparent;
    color: var(--text-muted, #9ca3af);
    border: 1px solid var(--border-color, #333);
  }

  .btn.cancel:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  .modify-form {
    margin-top: 0.75rem;
    padding: 0.75rem;
    background: rgba(59, 130, 246, 0.1);
    border: 1px solid rgba(59, 130, 246, 0.2);
    border-radius: 8px;
  }

  .modify-form textarea {
    width: 100%;
    padding: 0.5rem;
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.3);
    color: inherit;
    font-size: 0.8125rem;
    font-family: inherit;
    resize: vertical;
    min-height: 50px;
  }

  .modify-form textarea:focus {
    outline: none;
    border-color: #3b82f6;
  }

  .modify-actions {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.5rem;
    justify-content: flex-end;
  }

  .status-error {
    display: block;
    color: #f87171;
    font-size: 0.75rem;
    margin-top: 0.5rem;
  }

  /* Light mode */
  :global(.light) .approval-section {
    border-top-color: rgba(0, 0, 0, 0.1);
  }

  :global(.light) .modify-form {
    background: rgba(59, 130, 246, 0.05);
  }

  :global(.light) .modify-form textarea {
    background: white;
    border-color: #e5e7eb;
    color: #1f2937;
  }

  :global(.light) .btn.cancel {
    border-color: #e5e7eb;
    color: #6b7280;
  }

  :global(.light) .btn.cancel:hover {
    background: rgba(0, 0, 0, 0.05);
  }
</style>
