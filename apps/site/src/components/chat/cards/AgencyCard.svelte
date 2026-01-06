<script lang="ts">
  import { onMount, createEventDispatcher } from 'svelte';
  import BaseMessageCard from './BaseMessageCard.svelte';
  import type { ChatMessage } from '../../../lib/client/composables/useMessages';
  import { getGoalLabelConfig } from '../message-discriminator';
  import { apiFetch } from '../../../lib/client/api-config';

  export let message: ChatMessage;
  export let index: number;
  export let isSelected: boolean = false;

  const dispatch = createEventDispatcher();

  // Local state for approval flow
  let processingDesireId: string | null = null;
  let regeneratingDesireId: string | null = null;
  let executingDesireId: string | null = null;
  let feedbackDesireId: string | null = null;
  let feedbackText = '';
  let approvalError: string | null = null;
  let approvalSuccess: string | null = null;

  // Desire status tracking
  let desireStatus: string | null = null;
  let statusLoading = true;

  // Derived values
  $: goalConfig = getGoalLabelConfig(message.meta?.type);
  $: desireId = message.meta?.desireId;

  // Show approval buttons only for awaiting_approval status (or if we haven't loaded yet and it looks like an approval request)
  $: showApprovalButtons = desireId && (
    desireStatus === 'awaiting_approval' ||
    desireStatus === 'reviewing' ||
    (statusLoading && message.meta?.type === 'approval_request')
  );

  // Show execute button for approved desires
  $: showExecuteButton = desireId && desireStatus === 'approved';

  // Show status badge for executing/completed
  $: showStatusBadge = desireId && (desireStatus === 'executing' || desireStatus === 'completed' || desireStatus === 'rejected');

  // Fetch desire status on mount
  onMount(() => {
    if (desireId) {
      loadDesireStatus();
    } else {
      statusLoading = false;
    }
  });

  async function loadDesireStatus() {
    if (!desireId) return;

    try {
      const res = await apiFetch(`/api/agency/desires/${desireId}`);
      if (res.ok) {
        const data = await res.json();
        desireStatus = data.desire?.status || null;
      }
    } catch (err) {
      console.error('[AgencyCard] Failed to load desire status:', err);
    } finally {
      statusLoading = false;
    }
  }

  async function handleApprove() {
    if (!desireId || processingDesireId) return;
    processingDesireId = desireId;
    approvalError = null;

    try {
      const res = await apiFetch(`/api/agency/desires/${desireId}/approve`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to approve');
      }

      const result = await res.json();
      dispatch('desireApproved', { desireId });

      // Check if auto-executed
      if (result.autoExecuted) {
        desireStatus = 'executing';
        approvalSuccess = result.message || 'Approved and executing! Check inner dialogue for progress.';
        setTimeout(() => { approvalSuccess = null; }, 6000);
      } else {
        desireStatus = 'approved';
        approvalSuccess = result.message || 'Goal approved! Click "Execute Now" to start.';
        setTimeout(() => { approvalSuccess = null; }, 4000);
      }
    } catch (err) {
      approvalError = (err as Error).message;
      setTimeout(() => { approvalError = null; }, 5000);
    } finally {
      processingDesireId = null;
    }
  }

  async function handleReject() {
    if (!desireId || processingDesireId) return;
    processingDesireId = desireId;
    approvalError = null;

    try {
      const res = await apiFetch(`/api/agency/desires/${desireId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'User rejected via chat' }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to reject');
      }

      dispatch('desireRejected', { desireId });
      desireStatus = 'rejected'; // Update local status
      approvalSuccess = 'Goal rejected.';
      setTimeout(() => { approvalSuccess = null; }, 4000);
    } catch (err) {
      approvalError = (err as Error).message;
      setTimeout(() => { approvalError = null; }, 5000);
    } finally {
      processingDesireId = null;
    }
  }

  function toggleFeedback() {
    if (feedbackDesireId === desireId) {
      feedbackDesireId = null;
      feedbackText = '';
    } else {
      feedbackDesireId = desireId || null;
      feedbackText = '';
    }
  }

  async function submitFeedback() {
    if (!desireId || !feedbackText.trim() || regeneratingDesireId) return;
    regeneratingDesireId = desireId;
    approvalError = null;

    try {
      const res = await apiFetch(`/api/agency/desires/${desireId}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback: feedbackText.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to submit feedback');
      }

      dispatch('desireFeedback', { desireId, feedback: feedbackText.trim() });
      feedbackText = '';
      feedbackDesireId = null;
      approvalSuccess = 'Feedback submitted. Plan will be regenerated.';
      setTimeout(() => { approvalSuccess = null; }, 4000);
    } catch (err) {
      approvalError = (err as Error).message;
      setTimeout(() => { approvalError = null; }, 5000);
    } finally {
      regeneratingDesireId = null;
    }
  }

  function cancelFeedback() {
    feedbackDesireId = null;
    feedbackText = '';
  }

  async function handleExecute() {
    if (!desireId || executingDesireId) return;
    executingDesireId = desireId;
    approvalError = null;

    try {
      const res = await apiFetch(`/api/agency/desires/${desireId}/execute`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to execute');
      }

      const result = await res.json();
      dispatch('desireExecuting', { desireId });
      desireStatus = 'executing'; // Update local status
      approvalSuccess = result.message || 'Execution started! Check inner dialogue for progress.';
      setTimeout(() => { approvalSuccess = null; }, 6000);
    } catch (err) {
      approvalError = (err as Error).message;
      setTimeout(() => { approvalError = null; }, 5000);
    } finally {
      executingDesireId = null;
    }
  }
</script>

<BaseMessageCard
  {message}
  {index}
  {isSelected}
  roleLabel={goalConfig.label}
  roleIcon={goalConfig.icon}
  accentColor={message.meta?.displayColor || '#f59e0b'}
  on:messageClick
  on:deleteMessage
  on:validateMessage
  on:speakMessage
>
  <svelte:fragment slot="content">
    <p class="card-text">{message.content}</p>
  </svelte:fragment>

  <svelte:fragment slot="footer">
    {#if showApprovalButtons}
      <div class="approval-section">
        <div class="approval-buttons">
          <button
            class="btn approve"
            disabled={!!processingDesireId || !!regeneratingDesireId}
            on:click={handleApprove}
          >
            {processingDesireId === desireId ? '...' : 'Approve'}
          </button>
          <button
            class="btn reject"
            disabled={!!processingDesireId || !!regeneratingDesireId}
            on:click={handleReject}
          >
            Reject
          </button>
          <button
            class="btn feedback"
            class:active={feedbackDesireId === desireId}
            disabled={!!processingDesireId || !!regeneratingDesireId}
            on:click={toggleFeedback}
          >
            Feedback
          </button>
        </div>

        {#if approvalError}
          <span class="status-error">{approvalError}</span>
        {/if}
        {#if approvalSuccess}
          <span class="status-success">{approvalSuccess}</span>
        {/if}

        {#if feedbackDesireId === desireId}
          <div class="feedback-form">
            <textarea
              bind:value={feedbackText}
              placeholder="What should be changed about this plan?"
              rows="3"
            ></textarea>
            <div class="feedback-actions">
              <button
                class="btn submit"
                disabled={!feedbackText.trim() || !!regeneratingDesireId}
                on:click={submitFeedback}
              >
                {regeneratingDesireId === desireId ? 'Submitting...' : 'Submit Feedback'}
              </button>
              <button class="btn cancel" on:click={cancelFeedback}>
                Cancel
              </button>
            </div>
          </div>
        {/if}
      </div>
    {/if}

    {#if showExecuteButton}
      <div class="execute-section">
        <button
          class="btn execute"
          disabled={!!executingDesireId}
          on:click={handleExecute}
        >
          {executingDesireId === desireId ? 'Starting...' : '▶ Execute Now'}
        </button>
        {#if approvalError}
          <span class="status-error">{approvalError}</span>
        {/if}
        {#if approvalSuccess}
          <span class="status-success">{approvalSuccess}</span>
        {/if}
      </div>
    {/if}

    {#if showStatusBadge}
      <div class="status-badge-section">
        {#if desireStatus === 'executing'}
          <span class="status-badge executing">
            <span class="spinner"></span> Executing...
          </span>
        {:else if desireStatus === 'completed'}
          <span class="status-badge completed">✓ Completed</span>
        {:else if desireStatus === 'rejected'}
          <span class="status-badge rejected">✗ Rejected</span>
        {/if}
        {#if approvalSuccess}
          <span class="status-success">{approvalSuccess}</span>
        {/if}
      </div>
    {/if}
  </svelte:fragment>
</BaseMessageCard>

<style>
  .card-text {
    margin: 0;
    white-space: pre-wrap;
    word-wrap: break-word;
  }

  .approval-section {
    margin-top: 0.75rem;
    padding-top: 0.75rem;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
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

  .btn.feedback {
    background: rgba(59, 130, 246, 0.2);
    color: #60a5fa;
    border: 1px solid rgba(59, 130, 246, 0.3);
  }

  .btn.feedback:hover:not(:disabled) {
    background: rgba(59, 130, 246, 0.3);
  }

  .btn.feedback.active {
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

  .feedback-form {
    margin-top: 0.75rem;
    padding: 0.75rem;
    background: rgba(59, 130, 246, 0.1);
    border: 1px solid rgba(59, 130, 246, 0.2);
    border-radius: 8px;
  }

  .feedback-form textarea {
    width: 100%;
    padding: 0.5rem;
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.3);
    color: inherit;
    font-size: 0.8125rem;
    font-family: inherit;
    resize: vertical;
    min-height: 60px;
  }

  .feedback-form textarea:focus {
    outline: none;
    border-color: #3b82f6;
  }

  .feedback-actions {
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

  .status-success {
    display: block;
    color: #22c55e;
    font-size: 0.75rem;
    margin-top: 0.5rem;
  }

  .execute-section {
    margin-top: 0.75rem;
    padding-top: 0.75rem;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
  }

  .btn.execute {
    background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
    color: white;
    font-weight: 600;
    padding: 0.625rem 1.25rem;
    box-shadow: 0 2px 4px rgba(34, 197, 94, 0.3);
  }

  .btn.execute:hover:not(:disabled) {
    background: linear-gradient(135deg, #16a34a 0%, #15803d 100%);
    box-shadow: 0 3px 6px rgba(34, 197, 94, 0.4);
    transform: translateY(-1px);
  }

  .btn.execute:active:not(:disabled) {
    transform: translateY(0);
    box-shadow: 0 1px 2px rgba(34, 197, 94, 0.3);
  }

  .status-badge-section {
    margin-top: 0.75rem;
    padding-top: 0.75rem;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
  }

  .status-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    border-radius: 6px;
    font-size: 0.8125rem;
    font-weight: 500;
  }

  .status-badge.executing {
    background: rgba(59, 130, 246, 0.2);
    color: #60a5fa;
    border: 1px solid rgba(59, 130, 246, 0.3);
  }

  .status-badge.completed {
    background: rgba(34, 197, 94, 0.2);
    color: #22c55e;
    border: 1px solid rgba(34, 197, 94, 0.3);
  }

  .status-badge.rejected {
    background: rgba(239, 68, 68, 0.2);
    color: #f87171;
    border: 1px solid rgba(239, 68, 68, 0.3);
  }

  .spinner {
    width: 12px;
    height: 12px;
    border: 2px solid rgba(96, 165, 250, 0.3);
    border-top-color: #60a5fa;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* Light mode adjustments */
  :global(.light) .approval-section,
  :global(.light) .execute-section,
  :global(.light) .status-badge-section {
    border-top-color: rgba(0, 0, 0, 0.1);
  }

  :global(.light) .feedback-form {
    background: rgba(59, 130, 246, 0.05);
  }

  :global(.light) .feedback-form textarea {
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
