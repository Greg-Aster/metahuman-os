<script lang="ts">
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import type { ChatMessage } from '../../lib/useMessages';

  export let input: string = '';
  export let loading: boolean = false;
  export let selectedMessage: ChatMessage | null = null;
  export let isRecording: boolean = false;
  export let isContinuousMode: boolean = false;
  export let ttsIsPlaying: boolean = false;
  export let lengthMode: 'auto' | 'concise' | 'detailed' = 'auto';
  export let interimTranscript: string = ''; // Real-time transcript preview

  const dispatch = createEventDispatcher<{
    send: void;
    stop: void;
    keypress: { event: KeyboardEvent };
    micClick: void;
    micLongPress: void;  // New: long-press for continuous mode
    micContextMenu: void;
    ttsStop: void;
    clearSelection: void;
    lengthModeChange: { mode: 'auto' | 'concise' | 'detailed' };
  }>();

  // Long-press detection for mobile
  const LONG_PRESS_DURATION = 500; // 500ms for long press
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  let isLongPress = false;
  let micButton: HTMLButtonElement;

  function handleKeyPress(e: KeyboardEvent) {
    dispatch('keypress', { event: e });
  }

  function handleSend() {
    dispatch('send');
  }

  function handleStop() {
    dispatch('stop');
  }

  function handleMicClick() {
    // Only dispatch click if it wasn't a long press
    if (!isLongPress) {
      dispatch('micClick');
    }
    isLongPress = false;
  }

  function handleMicContextMenu(e: MouseEvent) {
    e.preventDefault();
    dispatch('micContextMenu');
  }

  // Touch event handlers for long-press detection
  function handleMicTouchStart(e: TouchEvent) {
    isLongPress = false;
    longPressTimer = setTimeout(() => {
      isLongPress = true;
      // Vibrate on mobile if supported (haptic feedback)
      if (navigator.vibrate) {
        navigator.vibrate(50);
      }
      dispatch('micLongPress');
    }, LONG_PRESS_DURATION);
  }

  function handleMicTouchEnd(e: TouchEvent) {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    // If it was a long press, prevent the click event
    if (isLongPress) {
      e.preventDefault();
    }
  }

  function handleMicTouchMove(e: TouchEvent) {
    // Cancel long press if user moves finger
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  }

  function handleTtsStop() {
    dispatch('ttsStop');
  }

  function handleClearSelection() {
    dispatch('clearSelection');
  }

  function handleLengthModeChange(mode: 'auto' | 'concise' | 'detailed') {
    dispatch('lengthModeChange', { mode });
  }

  onDestroy(() => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
    }
  });
</script>

<div class="input-wrapper">
  <!-- Reply-to indicator -->
  {#if selectedMessage}
    <div class="reply-indicator">
      <span class="reply-label">↩ Replying to:</span>
      <span class="reply-preview">{selectedMessage.content.substring(0, 60)}{selectedMessage.content.length > 60 ? '...' : ''}</span>
      <button
        class="reply-cancel"
        on:click={handleClearSelection}
        title="Cancel reply"
      >✕</button>
    </div>
  {/if}

  <!-- Interim transcript preview (shows words as you speak in native mode) -->
  {#if interimTranscript}
    <div class="interim-transcript">
      <span class="interim-icon">🎤</span>
      <span class="interim-text">{interimTranscript}</span>
    </div>
  {/if}

  <div class="input-row">
    <textarea
      bind:value={input}
      on:keypress={handleKeyPress}
      placeholder="Message your MetaHuman..."
      rows="1"
      class="chat-input"
      disabled={loading}
    />
    <div class="input-actions">
      <!-- Stop thinking button - only visible when thinking -->
      {#if loading}
        <button
          class="input-stop-btn stop-thinking"
          title="Stop thinking"
          on:click={handleStop}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="6" width="12" height="12" rx="2"/>
          </svg>
          <span class="stop-text">Stop</span>
        </button>
      {/if}
      <!-- Stop button - only visible when audio is playing -->
      {#if ttsIsPlaying}
        <button
          class="input-stop-btn"
          title="Stop speaking"
          on:click={handleTtsStop}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="6" width="12" height="12" rx="2"/>
          </svg>
        </button>
      {/if}
      <button
        bind:this={micButton}
        class="mic-btn {isRecording ? 'recording' : ''} {isContinuousMode ? 'continuous' : ''}"
        title={isContinuousMode ? (isRecording ? 'Listening continuously…' : 'Continuous mode active') : (isRecording ? 'Listening… click to stop' : 'Tap to speak, hold for continuous')}
        on:click={handleMicClick}
        on:contextmenu={handleMicContextMenu}
        on:touchstart={handleMicTouchStart}
        on:touchend={handleMicTouchEnd}
        on:touchmove={handleMicTouchMove}
        disabled={loading}
      >
        {#if isContinuousMode && isRecording}
          <!-- Recording: Waveform icon -->
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" class="recording-icon">
            <rect x="2" y="8" width="2" height="8" rx="1"/>
            <rect x="6" y="4" width="2" height="16" rx="1"/>
            <rect x="10" y="10" width="2" height="4" rx="1"/>
            <rect x="14" y="6" width="2" height="12" rx="1"/>
            <rect x="18" y="9" width="2" height="6" rx="1"/>
          </svg>
        {:else if isContinuousMode}
          <!-- Waiting: Sound waves icon -->
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="waiting-icon">
            <path d="M9 9c-.5-.5-1.5-1-3-1M9 15c-.5.5-1.5 1-3 1M15 9c.5-.5 1.5-1 3-1M15 15c.5.5 1.5 1 3 1M12 12v.01"/>
          </svg>
        {:else}
          <!-- Normal: Microphone icon -->
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/>
          </svg>
        {/if}
      </button>
      <button
        class="send-btn"
        on:click={handleSend}
        disabled={!input.trim() || loading}
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/>
        </svg>
      </button>
    </div>
  </div>
</div>

<style>
  /* Interim transcript preview - shows words as you speak */
  .interim-transcript {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    background: rgba(59, 130, 246, 0.1);
    border-radius: 0.5rem;
    margin-bottom: 0.5rem;
    animation: pulse 1.5s ease-in-out infinite;
  }

  :global(.dark) .interim-transcript {
    background: rgba(59, 130, 246, 0.2);
  }

  .interim-icon {
    font-size: 1rem;
    animation: bounce 0.5s ease-in-out infinite;
  }

  .interim-text {
    font-size: 0.875rem;
    color: #3b82f6;
    font-style: italic;
  }

  :global(.dark) .interim-text {
    color: #60a5fa;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
  }

  @keyframes bounce {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-2px); }
  }

  /* Prevent text selection on mic button during long press */
  .mic-btn {
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    user-select: none;
    touch-action: manipulation;
  }
</style>
