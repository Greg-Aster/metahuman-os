<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import Thinking from '../Thinking.svelte';
  import type { ChatMessage, ReasoningStage } from '../../lib/client/composables/useMessages';

  export let messages: ChatMessage[] = [];
  export let mode: 'conversation' | 'inner' | 'combined' = 'conversation';
  export let showSystemMessages: boolean = false; // When terminal tab is selected, always show system messages
  export let selectedMessageIndex: number | null = null;
  export let loading: boolean = false;
  export let reasoningStages: ReasoningStage[] = [];
  export let showThinkingIndicator: boolean = false;
  export let thinkingSteps: string = '';
  export let thinkingStatusLabel: string = '';

  import { apiFetch } from '../../lib/client/api-config';

  const dispatch = createEventDispatcher<{
    messageClick: { message: ChatMessage; index: number };
    deleteMessage: { relPath: string };
    validateMessage: { relPath: string; status: 'correct' | 'incorrect' };
    speakMessage: { content: string };
    desireApproved: { desireId: string };
    desireRejected: { desireId: string };
    desireFeedback: { desireId: string; feedback: string };
  }>();

  // Track which desires are being processed
  let processingDesireId: string | null = null;
  let approvalError: string | null = null;
  let approvalSuccess: string | null = null;

  // Track feedback input state
  let feedbackDesireId: string | null = null;
  let feedbackText: string = '';

  // Track plan regeneration state
  let regeneratingDesireId: string | null = null;
  let regenerationProgress: string = '';

  async function handleApproveDesire(desireId: string) {
    if (processingDesireId) return;
    processingDesireId = desireId;
    approvalError = null;
    try {
      const res = await apiFetch(`/api/agency/desires/${desireId}/approve`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to approve');
      }
      dispatch('desireApproved', { desireId });
      // Show success notification
      approvalSuccess = '✓ Desire approved! Will execute soon.';
      setTimeout(() => { approvalSuccess = null; }, 4000);
    } catch (err) {
      approvalError = (err as Error).message;
      setTimeout(() => { approvalError = null; }, 5000);
    } finally {
      processingDesireId = null;
    }
  }

  async function handleRejectDesire(desireId: string) {
    if (processingDesireId) return;
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
      // Show success notification
      approvalSuccess = '✓ Desire rejected.';
      setTimeout(() => { approvalSuccess = null; }, 4000);
    } catch (err) {
      approvalError = (err as Error).message;
      setTimeout(() => { approvalError = null; }, 5000);
    } finally {
      processingDesireId = null;
    }
  }

  function handleFeedbackClick(desireId: string) {
    if (feedbackDesireId === desireId) {
      // Toggle off
      feedbackDesireId = null;
      feedbackText = '';
    } else {
      // Toggle on for this desire
      feedbackDesireId = desireId;
      feedbackText = '';
    }
  }

  async function handleSubmitFeedback(desireId: string) {
    if (processingDesireId || regeneratingDesireId || !feedbackText.trim()) return;
    processingDesireId = desireId;
    approvalError = null;
    const critique = feedbackText.trim();

    try {
      // Step 1: Save critique and move to planning status
      const reviseRes = await apiFetch(`/api/agency/desires/${desireId}/revise`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ critique }),
      });
      if (!reviseRes.ok) {
        const data = await reviseRes.json();
        throw new Error(data.error || 'Failed to submit feedback');
      }

      dispatch('desireFeedback', { desireId, feedback: critique });

      // Reset feedback form immediately
      feedbackDesireId = null;
      feedbackText = '';
      processingDesireId = null;

      // Step 2: Immediately trigger plan regeneration with streaming
      regeneratingDesireId = desireId;
      regenerationProgress = 'Generating revised plan...';
      approvalSuccess = '⏳ Regenerating plan based on your feedback...';

      const streamRes = await apiFetch(`/api/agency/desires/${desireId}/generate-plan-stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ critique }),
      });

      if (!streamRes.ok) {
        const data = await streamRes.json();
        throw new Error(data.error || 'Failed to start plan generation');
      }

      // Process SSE stream
      const reader = streamRes.body?.getReader();
      if (!reader) throw new Error('No response stream');

      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));

              // Handle SSE events by type
              if (currentEvent === 'phase') {
                regenerationProgress = data.message || 'Processing...';
                approvalSuccess = `⏳ ${data.message || 'Generating...'}`;
              } else if (currentEvent === 'llm_started') {
                approvalSuccess = '⏳ LLM is generating plan...';
              } else if (currentEvent === 'plan_parsed') {
                approvalSuccess = `⏳ Plan with ${data.stepCount} steps parsed...`;
              } else if (currentEvent === 'complete') {
                regenerationProgress = '';
                approvalSuccess = `✓ Plan revised with ${data.plan?.steps?.length || '?'} steps! Check the Agency tab.`;
                setTimeout(() => { approvalSuccess = null; }, 5000);
              } else if (currentEvent === 'error') {
                throw new Error(data.error || 'Plan generation failed');
              }

              currentEvent = ''; // Reset after processing
            } catch (parseErr) {
              if (currentEvent === 'error') {
                throw parseErr;
              }
              // Ignore JSON parse errors for malformed SSE data
            }
          }
        }
      }
    } catch (err) {
      approvalError = (err as Error).message;
      approvalSuccess = null;
      regenerationProgress = '';
      setTimeout(() => { approvalError = null; }, 5000);
    } finally {
      processingDesireId = null;
      regeneratingDesireId = null;
    }
  }

  function handleCancelFeedback() {
    feedbackDesireId = null;
    feedbackText = '';
  }

  /**
   * Parse <think> blocks from message content
   * Returns { thinking: string | null, content: string }
   */
  function parseThinkingBlocks(content: string): { thinking: string | null; content: string } {
    // Guard against null, undefined, or non-string content
    if (!content || typeof content !== 'string') return { thinking: null, content: String(content || '') };

    // First try to match complete <think>...</think> blocks (case insensitive, multiline)
    const thinkPattern = /<think>([\s\S]*?)<\/think>/gi;
    const matches = content.match(thinkPattern);

    if (matches && matches.length > 0) {
      // Extract thinking content (combine multiple blocks if present)
      let thinking = '';
      for (const match of matches) {
        const inner = match.replace(/<\/?think>/gi, '').trim();
        if (inner) {
          thinking += (thinking ? '\n\n' : '') + inner;
        }
      }

      // Remove thinking blocks from content
      const strippedContent = content
        .replace(thinkPattern, '')
        .replace(/^\s*\n+/, '') // Remove leading newlines
        .trim();

      return {
        thinking: thinking || null,
        content: strippedContent
      };
    }

    // Handle incomplete thinking blocks (model ran out of tokens mid-thinking)
    // Match <think> at start without closing tag
    const incompletePattern = /^<think>([\s\S]*)$/i;
    const incompleteMatch = content.match(incompletePattern);

    if (incompleteMatch) {
      const thinking = incompleteMatch[1].trim();
      // Response was cut off during thinking - no final answer available
      return {
        thinking: thinking ? `${thinking}\n\n[Thinking was cut off - response limit reached]` : null,
        content: '[Response incomplete - thinking exceeded token limit]'
      };
    }

    // No thinking blocks found
    return { thinking: null, content: content.trim() };
  }

  /**
   * Get parsed message parts (memoized per message)
   */
  const parsedCache = new Map<string, { thinking: string | null; content: string }>();

  function getParsedMessage(message: ChatMessage): { thinking: string | null; content: string } {
    // Safely convert content to string (handles null, undefined, objects)
    const contentStr = typeof message.content === 'string' ? message.content : String(message.content || '');

    // Only parse assistant messages (model responses)
    if (message.role !== 'assistant') {
      return { thinking: null, content: contentStr };
    }

    // Use cache key based on content
    const cacheKey = contentStr;
    if (parsedCache.has(cacheKey)) {
      return parsedCache.get(cacheKey)!;
    }

    const parsed = parseThinkingBlocks(contentStr);
    parsedCache.set(cacheKey, parsed);
    return parsed;
  }

  function handleMessageClick(message: ChatMessage, index: number) {
    dispatch('messageClick', { message, index });
  }

  function handleDelete(relPath: string) {
    dispatch('deleteMessage', { relPath });
  }

  function handleValidate(relPath: string, status: 'correct' | 'incorrect') {
    dispatch('validateMessage', { relPath, status });
  }

  function handleSpeak(e: MouseEvent, content: string) {
    e.stopPropagation();
    // Strip thinking from content before speaking (TTS should only speak final answer)
    const { content: strippedContent } = parseThinkingBlocks(content);
    dispatch('speakMessage', { content: strippedContent });
  }

  function formatTime(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }

  function formatReasoningLabel(stage: ReasoningStage): string {
    const stageName = String(stage.stage || 'plan')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
    return `🤔 Round ${stage.round}: ${stageName}`;
  }
</script>

<div class="messages-list">
  {#each messages as message, i}
    {#if mode === 'combined'
      ? true
      : mode === 'inner'
        ? (message.role === 'reflection' || message.role === 'dream' || message.role === 'reasoning')
        : (message.role !== 'reflection' && message.role !== 'dream')}
      {#if message.role === 'reasoning'}
        <Thinking
          steps={message.content}
          label={message.meta?.label ?? (message.meta?.stage ? formatReasoningLabel({ ...message.meta.stage, timestamp: message.timestamp }) : '🤔 Reasoning · ' + formatTime(message.timestamp))}
          initiallyOpen={false}
        />
      {:else}
        {@const parsed = getParsedMessage(message)}
        <!-- Show thinking block above message if present (for assistant messages) -->
        {#if parsed.thinking}
          <Thinking
            steps={parsed.thinking}
            label="🧠 Reasoning · {formatTime(message.timestamp)}"
            initiallyOpen={false}
          />
        {/if}
        <div
          class="message message-{message.role}"
          class:message-selected={selectedMessageIndex === i}
          data-facet={message.meta?.facet || 'default'}
          style={message.meta?.displayColor ? `--message-accent-color: ${message.meta.displayColor}` : ''}
          on:click={() => handleMessageClick(message, i)}
          role="button"
          tabindex="0"
        >
          <div class="message-header">
            <span class="message-role">
              {#if message.role === 'user'}
                You
              {:else if message.role === 'assistant'}
                {#if message.meta?.isCuriosityQuestion}
                  <span class="curiosity-label">💭 I'm curious:</span>
                {:else}
                  MetaHuman{#if message.meta?.facet && message.meta.facet !== 'default'}<span class="facet-indicator" title="Speaking as {message.meta.facet} facet"> · {message.meta.facet}</span>{/if}
                {/if}
              {:else if message.role === 'reflection'}
                {#if message.meta?.dialogueSource === 'lizard-brain'}
                  ⚡ Lizard Brain
                {:else if message.meta?.dialogueSource === 'agency-system'}
                  📋 Agency System
                {:else}
                  💭 Idle Thought
                {/if}
              {:else if message.role === 'dream'}
                🌙 Dream
              {:else}
                System
              {/if}
            </span>
            <span class="message-time">{formatTime(message.timestamp)}</span>

            {#if message.role === 'assistant' && message.relPath}
              <span class="message-actions">
                <button class="msg-btn bad" title="Delete from memory" on:click={() => handleDelete(message.relPath)}>−</button>
                <button class="msg-btn good" title="Mark as correct" on:click={() => handleValidate(message.relPath, 'correct')}>+</button>
              </span>
            {/if}
          </div>
          <div class="message-content">
            {parsed.content}
            <!-- TTS replay button inside bubble at bottom right -->
            <button class="msg-mic-btn" title="Listen to this message" on:click={(e) => handleSpeak(e, message.content)}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3zM19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8"/>
              </svg>
            </button>
          </div>
          <!-- Inline approval buttons for approval_request messages -->
          {#if message.meta?.type === 'approval_request' && message.meta?.desireId}
            <div class="approval-buttons">
              <button
                class="approval-btn approve"
                disabled={processingDesireId === message.meta.desireId || regeneratingDesireId === message.meta.desireId}
                on:click|stopPropagation={() => handleApproveDesire(message.meta.desireId)}
              >
                {processingDesireId === message.meta.desireId ? '...' : '✓ Approve'}
              </button>
              <button
                class="approval-btn reject"
                disabled={processingDesireId === message.meta.desireId || regeneratingDesireId === message.meta.desireId}
                on:click|stopPropagation={() => handleRejectDesire(message.meta.desireId)}
              >
                {processingDesireId === message.meta.desireId ? '...' : '✗ Reject'}
              </button>
              <button
                class="approval-btn feedback"
                class:active={feedbackDesireId === message.meta.desireId}
                disabled={processingDesireId === message.meta.desireId || regeneratingDesireId === message.meta.desireId}
                on:click|stopPropagation={() => handleFeedbackClick(message.meta.desireId)}
              >
                {regeneratingDesireId === message.meta.desireId ? '⏳ Regenerating...' : '✎ Feedback'}
              </button>
              {#if approvalError}
                <span class="approval-error">{approvalError}</span>
              {/if}
              {#if approvalSuccess}
                <span class="approval-success">{approvalSuccess}</span>
              {/if}
            </div>
            <!-- Feedback input form -->
            {#if feedbackDesireId === message.meta.desireId}
              <div class="feedback-form" on:click|stopPropagation>
                <textarea
                  class="feedback-input"
                  placeholder="What should be changed? Provide feedback to revise the plan..."
                  bind:value={feedbackText}
                  rows="3"
                ></textarea>
                <div class="feedback-actions">
                  <button
                    class="feedback-submit"
                    disabled={!feedbackText.trim() || processingDesireId === message.meta.desireId}
                    on:click={() => handleSubmitFeedback(message.meta.desireId)}
                  >
                    {processingDesireId === message.meta.desireId ? 'Submitting...' : 'Submit Feedback'}
                  </button>
                  <button
                    class="feedback-cancel"
                    on:click={handleCancelFeedback}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            {/if}
          {/if}
        </div>
      {/if}
    {/if}
  {/each}

  {#if reasoningStages.length > 0}
    {#each reasoningStages as stage (stage.timestamp + '-' + stage.round + '-' + stage.stage)}
      <Thinking
        steps={stage.content}
        label={formatReasoningLabel(stage)}
        initiallyOpen={true}
      />
    {/each}
  {/if}

  {#if showThinkingIndicator}
    <Thinking
      steps={thinkingSteps}
      label={thinkingStatusLabel}
      initiallyOpen={true}
    />
  {/if}

  {#if loading && reasoningStages.length === 0}
    <div class="message message-assistant">
      <div class="message-header">
        <span class="message-role">MetaHuman</span>
      </div>
      <div class="message-content typing">
        <span class="typing-dot"></span>
        <span class="typing-dot"></span>
        <span class="typing-dot"></span>
      </div>
    </div>
  {/if}
</div>

<style>
  /* Inline approval buttons for desire approval requests */
  .approval-buttons {
    display: flex;
    gap: 8px;
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
  }

  .approval-btn {
    padding: 8px 16px;
    border-radius: 6px;
    border: none;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
  }

  .approval-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .approval-btn.approve {
    background: #22c55e;
    color: white;
  }

  .approval-btn.approve:hover:not(:disabled) {
    background: #16a34a;
  }

  .approval-btn.reject {
    background: rgba(239, 68, 68, 0.2);
    color: #f87171;
    border: 1px solid rgba(239, 68, 68, 0.3);
  }

  .approval-btn.reject:hover:not(:disabled) {
    background: rgba(239, 68, 68, 0.3);
  }

  .approval-error {
    color: #f87171;
    font-size: 12px;
    margin-left: 8px;
    align-self: center;
  }

  .approval-success {
    color: #22c55e;
    font-size: 12px;
    margin-left: 8px;
    align-self: center;
    font-weight: 500;
  }

  .approval-btn.feedback {
    background: rgba(59, 130, 246, 0.2);
    color: #60a5fa;
    border: 1px solid rgba(59, 130, 246, 0.3);
  }

  .approval-btn.feedback:hover:not(:disabled) {
    background: rgba(59, 130, 246, 0.3);
  }

  .approval-btn.feedback.active {
    background: rgba(59, 130, 246, 0.4);
    border-color: #3b82f6;
  }

  .feedback-form {
    margin-top: 12px;
    padding: 12px;
    background: rgba(59, 130, 246, 0.1);
    border: 1px solid rgba(59, 130, 246, 0.2);
    border-radius: 8px;
  }

  .feedback-input {
    width: 100%;
    padding: 10px;
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.3);
    color: inherit;
    font-size: 13px;
    font-family: inherit;
    resize: vertical;
    min-height: 60px;
  }

  .feedback-input:focus {
    outline: none;
    border-color: #3b82f6;
  }

  .feedback-input::placeholder {
    color: rgba(255, 255, 255, 0.4);
  }

  .feedback-actions {
    display: flex;
    gap: 8px;
    margin-top: 10px;
    justify-content: flex-end;
  }

  .feedback-submit {
    padding: 8px 16px;
    border-radius: 6px;
    border: none;
    background: #3b82f6;
    color: white;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
  }

  .feedback-submit:hover:not(:disabled) {
    background: #2563eb;
  }

  .feedback-submit:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .feedback-cancel {
    padding: 8px 16px;
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    background: transparent;
    color: rgba(255, 255, 255, 0.7);
    font-size: 13px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .feedback-cancel:hover {
    background: rgba(255, 255, 255, 0.1);
    color: white;
  }
</style>
