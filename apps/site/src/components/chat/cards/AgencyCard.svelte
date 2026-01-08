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

  // Plan data for display
  interface PlanStep {
    order: number;
    action: string;
    skill?: string;
    expectedOutcome?: string;
    risk?: string;
  }
  interface DesirePlan {
    id: string;
    version: number;
    steps: PlanStep[];
    estimatedRisk?: string;
    requiredTrustLevel?: string;
    operatorGoal?: string;
  }
  let plan: DesirePlan | null = null;

  // Clarifying questions
  interface ClarifyingQuestion {
    id: string;
    text: string;
    type: 'free_text' | 'yes_no' | 'choice';
    options?: string[];
    required: boolean;
  }

  // Derived values
  $: goalConfig = getGoalLabelConfig(message.meta?.type);
  $: desireId = message.meta?.desireId;
  $: questions = (message.meta?.questions as ClarifyingQuestion[]) || [];

  // Show clarifying questions form
  $: showQuestionsForm = message.meta?.type === 'clarifying_questions' &&
    questions.length > 0 &&
    desireStatus === 'questioning';

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

  // Show outcome review buttons for desires needing user confirmation
  $: showOutcomeReview = desireId && (
    desireStatus === 'outcome_review' ||
    desireStatus === 'awaiting_review' ||
    message.meta?.type === 'outcome_review' ||
    message.meta?.type === 'desire_completed'
  );

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
        plan = data.desire?.plan || null;
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

  // Outcome review handlers
  let reviewingDesireId: string | null = null;
  let revisionFeedbackText = '';
  let showRevisionInput = false;

  async function handleConfirmComplete() {
    if (!desireId || reviewingDesireId) return;
    reviewingDesireId = desireId;
    approvalError = null;

    try {
      const res = await apiFetch(`/api/agency/desires/${desireId}/confirm-complete`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to confirm completion');
      }

      dispatch('desireCompleted', { desireId });
      desireStatus = 'completed';
      approvalSuccess = 'Outcome confirmed! Desire marked as successfully completed.';
      setTimeout(() => { approvalSuccess = null; }, 4000);
    } catch (err) {
      approvalError = (err as Error).message;
      setTimeout(() => { approvalError = null; }, 5000);
    } finally {
      reviewingDesireId = null;
    }
  }

  function toggleRevisionInput() {
    showRevisionInput = !showRevisionInput;
    if (!showRevisionInput) {
      revisionFeedbackText = '';
    }
  }

  async function submitRevisionRequest() {
    if (!desireId || !revisionFeedbackText.trim() || reviewingDesireId) return;
    reviewingDesireId = desireId;
    approvalError = null;

    try {
      const res = await apiFetch(`/api/agency/desires/${desireId}/request-revision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback: revisionFeedbackText.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to request revision');
      }

      dispatch('desireRevisionRequested', { desireId, feedback: revisionFeedbackText.trim() });
      revisionFeedbackText = '';
      showRevisionInput = false;
      desireStatus = 'planning'; // Goes back to planning
      approvalSuccess = 'Revision requested. The plan will be regenerated with your feedback.';
      setTimeout(() => { approvalSuccess = null; }, 5000);
    } catch (err) {
      approvalError = (err as Error).message;
      setTimeout(() => { approvalError = null; }, 5000);
    } finally {
      reviewingDesireId = null;
    }
  }

  // Clarifying questions - Ready to Plan handler
  let markingReady = false;

  async function handleReadyToPlan() {
    if (!desireId || markingReady) return;
    markingReady = true;
    approvalError = null;

    try {
      const res = await apiFetch(`/api/agency/desires/${desireId}/ready-to-plan`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to move to planning');
      }

      const result = await res.json();
      dispatch('desireReadyToPlan', { desireId });
      desireStatus = 'planning';
      approvalSuccess = result.message || 'Moving to planning phase...';
      setTimeout(() => { approvalSuccess = null; }, 3000);
    } catch (err) {
      approvalError = (err as Error).message;
      setTimeout(() => { approvalError = null; }, 5000);
    } finally {
      markingReady = false;
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
    <p class="m-0 whitespace-pre-wrap break-words">{message.content}</p>

    <!-- Plan Display Section -->
    {#if plan && plan.steps?.length > 0 && (showApprovalButtons || desireStatus === 'approved')}
      <div class="plan-section mt-4 p-3 bg-gray-800/50 border border-gray-700/50 rounded-lg">
        <div class="plan-header flex items-center justify-between mb-2">
          <div class="flex items-center gap-2">
            <span class="text-sm font-medium text-gray-300">Execution Plan</span>
            <span class="text-xs px-1.5 py-0.5 rounded bg-gray-700 text-gray-400">v{plan.version}</span>
          </div>
          <div class="flex gap-2 text-xs">
            {#if plan.estimatedRisk}
              <span class="px-1.5 py-0.5 rounded {plan.estimatedRisk === 'low' || plan.estimatedRisk === 'none' ? 'bg-green-500/20 text-green-400' : plan.estimatedRisk === 'medium' ? 'bg-amber-500/20 text-amber-400' : 'bg-red-500/20 text-red-400'}">
                {plan.estimatedRisk} risk
              </span>
            {/if}
          </div>
        </div>

        {#if plan.operatorGoal}
          <p class="text-sm text-gray-400 mb-3 italic border-l-2 border-blue-500/50 pl-2">
            {plan.operatorGoal}
          </p>
        {/if}

        <ol class="plan-steps space-y-2 m-0 p-0 list-none">
          {#each plan.steps as step}
            <li class="flex gap-2 text-sm">
              <span class="flex-shrink-0 w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 text-xs flex items-center justify-center font-medium">
                {step.order}
              </span>
              <div class="flex-1">
                <span class="text-gray-300">{step.action}</span>
                {#if step.skill}
                  <span class="ml-2 text-xs px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400 border border-purple-500/30">
                    {step.skill}
                  </span>
                {/if}
              </div>
            </li>
          {/each}
        </ol>
      </div>
    {/if}
  </svelte:fragment>

  <svelte:fragment slot="footer">
    {#if showApprovalButtons}
      <div class="mt-3 pt-3 border-t border-white/10 dark:border-white/10">
        <div class="flex gap-2 flex-wrap">
          <button
            class="agency-btn bg-green-500 text-white hover:bg-green-600"
            disabled={!!processingDesireId || !!regeneratingDesireId}
            on:click={handleApprove}
          >
            {processingDesireId === desireId ? '...' : 'Approve'}
          </button>
          <button
            class="agency-btn bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30"
            disabled={!!processingDesireId || !!regeneratingDesireId}
            on:click={handleReject}
          >
            Reject
          </button>
          <button
            class="agency-btn text-blue-400 border border-blue-500/30 hover:bg-blue-500/30 {feedbackDesireId === desireId ? 'bg-blue-500/40' : 'bg-blue-500/20'}"
            disabled={!!processingDesireId || !!regeneratingDesireId}
            on:click={toggleFeedback}
          >
            Feedback
          </button>
        </div>

        {#if approvalError}
          <span class="block text-red-400 text-xs mt-2">{approvalError}</span>
        {/if}
        {#if approvalSuccess}
          <span class="block text-green-500 text-xs mt-2">{approvalSuccess}</span>
        {/if}

        {#if feedbackDesireId === desireId}
          <div class="mt-3 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
            <textarea
              bind:value={feedbackText}
              placeholder="What should be changed about this plan?"
              rows="3"
              class="w-full p-2 border border-white/15 rounded-md bg-black/30 text-inherit text-[0.8125rem] font-inherit resize-y min-h-[60px] focus:outline-none focus:border-blue-500"
            ></textarea>
            <div class="flex gap-2 mt-2 justify-end">
              <button
                class="agency-btn bg-blue-500 text-white hover:bg-blue-600"
                disabled={!feedbackText.trim() || !!regeneratingDesireId}
                on:click={submitFeedback}
              >
                {regeneratingDesireId === desireId ? 'Submitting...' : 'Submit Feedback'}
              </button>
              <button class="agency-btn bg-transparent text-gray-400 border border-gray-600 hover:bg-white/5" on:click={cancelFeedback}>
                Cancel
              </button>
            </div>
          </div>
        {/if}
      </div>
    {/if}

    {#if showExecuteButton}
      <div class="mt-3 pt-3 border-t border-white/10 dark:border-white/10">
        <button
          class="execute-btn"
          disabled={!!executingDesireId}
          on:click={handleExecute}
        >
          {executingDesireId === desireId ? 'Starting...' : '▶ Execute Now'}
        </button>
        {#if approvalError}
          <span class="block text-red-400 text-xs mt-2">{approvalError}</span>
        {/if}
        {#if approvalSuccess}
          <span class="block text-green-500 text-xs mt-2">{approvalSuccess}</span>
        {/if}
      </div>
    {/if}

    {#if showStatusBadge}
      <div class="mt-3 pt-3 border-t border-white/10 dark:border-white/10">
        {#if desireStatus === 'executing'}
          <span class="status-badge bg-blue-500/20 text-blue-400 border border-blue-500/30">
            <span class="spinner"></span> Executing...
          </span>
        {:else if desireStatus === 'completed'}
          <span class="status-badge bg-green-500/20 text-green-500 border border-green-500/30">✓ Completed</span>
        {:else if desireStatus === 'rejected'}
          <span class="status-badge bg-red-500/20 text-red-400 border border-red-500/30">✗ Rejected</span>
        {/if}
        {#if approvalSuccess}
          <span class="block text-green-500 text-xs mt-2">{approvalSuccess}</span>
        {/if}
      </div>
    {/if}

    {#if showQuestionsForm}
      <div class="mt-3 pt-3 border-t border-white/10 dark:border-white/10">
        <div class="questions-display p-3 bg-cyan-500/10 border border-cyan-500/20 rounded-lg">
          <div class="flex items-center gap-2 mb-3">
            <span class="text-cyan-400">💭</span>
            <span class="text-sm font-medium text-cyan-300">Help me plan this better</span>
          </div>

          <!-- Display questions (read-only) -->
          <div class="space-y-2 mb-4">
            {#each questions as question, i}
              <div class="text-sm text-gray-300">
                <span class="text-gray-500 mr-1">{i + 1}.</span>
                {question.text}
              </div>
            {/each}
          </div>

          <!-- Instructions for chat-based interaction -->
          <div class="text-sm text-cyan-400/80 bg-cyan-500/5 p-2 rounded border border-cyan-500/10 mb-3">
            <span class="font-medium">Click this card</span> to select it, then discuss in the chat below.
            All your messages will help inform the plan.
          </div>

          <!-- Ready to Plan button -->
          <button
            class="agency-btn bg-cyan-500 text-white hover:bg-cyan-600 w-full"
            disabled={markingReady}
            on:click|stopPropagation={handleReadyToPlan}
          >
            {markingReady ? 'Moving to planning...' : '✓ Ready to Plan'}
          </button>

          {#if approvalError}
            <span class="block text-red-400 text-xs mt-2">{approvalError}</span>
          {/if}
          {#if approvalSuccess}
            <span class="block text-green-500 text-xs mt-2">{approvalSuccess}</span>
          {/if}
        </div>
      </div>
    {/if}

    {#if showOutcomeReview}
      <div class="mt-3 pt-3 border-t border-white/10 dark:border-white/10">
        <div class="mb-2">
          <span class="status-badge bg-amber-500/20 text-amber-400 border border-amber-500/30">
            Review Required
          </span>
        </div>
        <p class="text-sm text-gray-400 mb-3">
          Please review the outcome. Does it meet your expectations?
        </p>
        <div class="flex gap-2 flex-wrap">
          <button
            class="agency-btn bg-green-500 text-white hover:bg-green-600"
            disabled={!!reviewingDesireId}
            on:click={handleConfirmComplete}
          >
            {reviewingDesireId === desireId && !showRevisionInput ? 'Confirming...' : 'Confirm Complete'}
          </button>
          <button
            class="agency-btn text-amber-400 border border-amber-500/30 hover:bg-amber-500/30 {showRevisionInput ? 'bg-amber-500/40' : 'bg-amber-500/20'}"
            disabled={!!reviewingDesireId && !showRevisionInput}
            on:click={toggleRevisionInput}
          >
            Request Revision
          </button>
        </div>

        {#if showRevisionInput}
          <div class="mt-3 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
            <textarea
              bind:value={revisionFeedbackText}
              placeholder="What needs to be changed or improved?"
              rows="3"
              class="w-full p-2 border border-white/15 rounded-md bg-black/30 text-inherit text-[0.8125rem] font-inherit resize-y min-h-[60px] focus:outline-none focus:border-amber-500"
            ></textarea>
            <div class="flex gap-2 mt-2 justify-end">
              <button
                class="agency-btn bg-amber-500 text-white hover:bg-amber-600"
                disabled={!revisionFeedbackText.trim() || !!reviewingDesireId}
                on:click={submitRevisionRequest}
              >
                {reviewingDesireId === desireId ? 'Submitting...' : 'Submit Revision Request'}
              </button>
              <button class="agency-btn bg-transparent text-gray-400 border border-gray-600 hover:bg-white/5" on:click={toggleRevisionInput}>
                Cancel
              </button>
            </div>
          </div>
        {/if}

        {#if approvalError}
          <span class="block text-red-400 text-xs mt-2">{approvalError}</span>
        {/if}
        {#if approvalSuccess}
          <span class="block text-green-500 text-xs mt-2">{approvalSuccess}</span>
        {/if}
      </div>
    {/if}
  </svelte:fragment>
</BaseMessageCard>

<style>
  /* Agency button base */
  .agency-btn {
    @apply py-2 px-4 rounded-md border-0 text-[0.8125rem] font-medium cursor-pointer transition-all;
  }
  .agency-btn:disabled {
    @apply opacity-60 cursor-not-allowed;
  }

  /* Execute button with gradient */
  .execute-btn {
    @apply py-2.5 px-5 rounded-md border-0 text-white font-semibold cursor-pointer transition-all;
    background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
    box-shadow: 0 2px 4px rgba(34, 197, 94, 0.3);
  }
  .execute-btn:hover:not(:disabled) {
    background: linear-gradient(135deg, #16a34a 0%, #15803d 100%);
    box-shadow: 0 3px 6px rgba(34, 197, 94, 0.4);
    transform: translateY(-1px);
  }
  .execute-btn:disabled {
    @apply opacity-60 cursor-not-allowed;
  }

  /* Status badge */
  .status-badge {
    @apply inline-flex items-center gap-2 py-2 px-4 rounded-md text-[0.8125rem] font-medium;
  }

  /* Spinner animation */
  .spinner {
    @apply w-3 h-3 rounded-full;
    border: 2px solid rgba(96, 165, 250, 0.3);
    border-top-color: #60a5fa;
    animation: spin 1s linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* Light mode border adjustments */
  :global(.light) .border-white\/10 {
    border-color: rgba(0, 0, 0, 0.1);
  }
</style>
