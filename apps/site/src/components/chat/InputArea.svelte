<script lang="ts">
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import type { ChatMessage } from '../../lib/client/composables/useMessages';

  export let input: string = '';
  export let loading: boolean = false;
  export let selectedMessage: ChatMessage | null = null;
  export let isRecording: boolean = false;
  export let isContinuousMode: boolean = false;
  export let isWakeWordListening: boolean = false; // Wake word detection active (mobile)
  export let isConversationMode: boolean = false; // Conversation mode active (mobile long-press)
  export let ttsIsPlaying: boolean = false;
  export let lengthMode: 'auto' | 'concise' | 'detailed' = 'auto';
  export let interimTranscript: string = ''; // Real-time transcript preview

  const dispatch = createEventDispatcher<{
    send: void;
    stop: void;
    keypress: { event: KeyboardEvent };
    micClick: void;
    micLongPress: void;  // Legacy: long-press for continuous mode (desktop)
    micContextMenu: void;
    ttsStop: void;
    ttsStopAndListen: void;  // New: interrupt AI and start listening
    clearSelection: void;
    lengthModeChange: { mode: 'auto' | 'concise' | 'detailed' };
  }>();

  // Long-press detection for conversation mode
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
    // If TTS is playing, tap to interrupt and start listening (tap-to-interrupt feature)
    if (ttsIsPlaying) {
      dispatch('ttsStopAndListen');
      return;
    }

    // Single tap for single utterance, long-press for conversation mode
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

  // Touch event handlers for long-press detection (enter conversation mode)
  let touchStartX = 0;
  let touchStartY = 0;
  const TOUCH_MOVE_THRESHOLD = 10; // pixels - allow some finger movement

  function handleMicTouchStart(e: TouchEvent) {
    // Prevent browser's default long-press behavior (context menu, text selection, etc.)
    e.preventDefault();
    console.log('[InputArea] touchstart - starting long-press timer');
    isLongPress = false;
    // Store initial touch position for movement threshold
    if (e.touches.length > 0) {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    }
    longPressTimer = setTimeout(() => {
      console.log('[InputArea] Long press detected! Dispatching micLongPress');
      isLongPress = true;
      // Vibrate on mobile if supported (haptic feedback)
      if (navigator.vibrate) {
        navigator.vibrate(50);
      }
      dispatch('micLongPress');
    }, LONG_PRESS_DURATION);
  }

  function handleMicTouchEnd(e: TouchEvent) {
    console.log('[InputArea] touchend - isLongPress:', isLongPress);
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
      // Timer was still running = short tap, dispatch click
      console.log('[InputArea] Short tap detected, dispatching micClick');
      dispatch('micClick');
    }
    // Always prevent since we're handling everything in touch events
    e.preventDefault();
  }

  function handleMicTouchMove(e: TouchEvent) {
    // Cancel long press only if user moves finger significantly
    if (longPressTimer && e.touches.length > 0) {
      const dx = Math.abs(e.touches[0].clientX - touchStartX);
      const dy = Math.abs(e.touches[0].clientY - touchStartY);
      if (dx > TOUCH_MOVE_THRESHOLD || dy > TOUCH_MOVE_THRESHOLD) {
        console.log('[InputArea] touchmove - finger moved too much, cancelling long-press');
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
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
        class="mic-btn {isRecording ? 'recording' : ''} {isContinuousMode ? 'continuous' : ''} {isConversationMode ? 'conversation' : ''} {isWakeWordListening ? 'wake-word' : ''} {ttsIsPlaying ? 'interrupt-ready' : ''}"
        title={ttsIsPlaying ? 'Tap to interrupt and speak' : isWakeWordListening ? 'Listening for "hey greg"…' : isConversationMode ? (isRecording ? 'Listening…' : 'Conversation mode - just talk!') : isContinuousMode ? (isRecording ? 'Listening continuously…' : 'Continuous mode active') : (isRecording ? 'Listening… tap to stop' : 'Tap to speak, hold for conversation')}
        on:click={handleMicClick}
        on:contextmenu={handleMicContextMenu}
        on:touchstart={handleMicTouchStart}
        on:touchend={handleMicTouchEnd}
        on:touchmove={handleMicTouchMove}
        disabled={loading}
      >
        {#if isWakeWordListening}
          <!-- Wake word mode: Ear icon (listening for trigger phrase) -->
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" class="wake-word-icon">
            <path d="M12 1C7.03 1 3 5.03 3 10v4c0 1.66 1.34 3 3 3h1v-7H5.5c.32-3.52 3.3-6.25 6.91-6.25s6.59 2.73 6.91 6.25H17v7h1c1.66 0 3-1.34 3-3v-4c0-4.97-4.03-9-9-9zm-1 17h2v2h-2v-2z"/>
          </svg>
        {:else if isConversationMode && isRecording}
          <!-- Conversation mode recording: Waveform icon (green) -->
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" class="recording-icon">
            <rect x="2" y="8" width="2" height="8" rx="1"/>
            <rect x="6" y="4" width="2" height="16" rx="1"/>
            <rect x="10" y="10" width="2" height="4" rx="1"/>
            <rect x="14" y="6" width="2" height="12" rx="1"/>
            <rect x="18" y="9" width="2" height="6" rx="1"/>
          </svg>
        {:else if isConversationMode}
          <!-- Conversation mode waiting: Chat bubble icon -->
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" class="conversation-icon">
            <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/>
          </svg>
        {:else if isContinuousMode && isRecording}
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

  /* Prevent text selection and browser context menu on mic button during long press */
  .mic-btn {
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    user-select: none;
    touch-action: none; /* Prevents browser long-press menu, gives us full control */
  }

  /* Wake word listening mode - distinctive purple color */
  .mic-btn.wake-word {
    background: rgba(147, 51, 234, 0.15);
    border-color: rgb(147, 51, 234);
    color: rgb(147, 51, 234);
  }

  :global(.dark) .mic-btn.wake-word {
    background: rgba(167, 139, 250, 0.2);
    border-color: rgb(167, 139, 250);
    color: rgb(167, 139, 250);
  }

  .wake-word-icon {
    animation: pulse 2s ease-in-out infinite;
  }

  /* Conversation mode (mobile long-press) - distinctive green color */
  .mic-btn.conversation {
    background: rgba(34, 197, 94, 0.15);
    border-color: rgb(34, 197, 94);
    color: rgb(34, 197, 94);
  }

  :global(.dark) .mic-btn.conversation {
    background: rgba(74, 222, 128, 0.2);
    border-color: rgb(74, 222, 128);
    color: rgb(74, 222, 128);
  }

  .conversation-icon {
    animation: pulse 2s ease-in-out infinite;
  }

  /* Interrupt ready state - when TTS is playing, mic pulses to show tap-to-interrupt */
  .mic-btn.interrupt-ready {
    background: rgba(239, 68, 68, 0.15);
    border-color: rgb(239, 68, 68);
    color: rgb(239, 68, 68);
    animation: interrupt-pulse 1s ease-in-out infinite;
  }

  :global(.dark) .mic-btn.interrupt-ready {
    background: rgba(248, 113, 113, 0.2);
    border-color: rgb(248, 113, 113);
    color: rgb(248, 113, 113);
  }

  @keyframes interrupt-pulse {
    0%, 100% {
      transform: scale(1);
      box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4);
    }
    50% {
      transform: scale(1.05);
      box-shadow: 0 0 0 8px rgba(239, 68, 68, 0);
    }
  }

  /* Recording state - animated waveform bars */
  .mic-btn.recording .recording-icon rect {
    animation: waveform 0.8s ease-in-out infinite;
  }

  .mic-btn.recording .recording-icon rect:nth-child(1) { animation-delay: 0s; }
  .mic-btn.recording .recording-icon rect:nth-child(2) { animation-delay: 0.1s; }
  .mic-btn.recording .recording-icon rect:nth-child(3) { animation-delay: 0.2s; }
  .mic-btn.recording .recording-icon rect:nth-child(4) { animation-delay: 0.3s; }
  .mic-btn.recording .recording-icon rect:nth-child(5) { animation-delay: 0.4s; }

  @keyframes waveform {
    0%, 100% {
      transform: scaleY(0.5);
    }
    50% {
      transform: scaleY(1);
    }
  }

  /* Conversation mode not recording - pulsing border to show "ready" state */
  .mic-btn.conversation:not(.recording) {
    animation: ready-pulse 2s ease-in-out infinite;
  }

  @keyframes ready-pulse {
    0%, 100% {
      box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.4);
    }
    50% {
      box-shadow: 0 0 0 6px rgba(34, 197, 94, 0);
    }
  }
</style>
