<script lang="ts">
  import { createEventDispatcher, onDestroy } from 'svelte';
  import type { ChatMessage } from '../../lib/client/composables/useMessages';
  import FeedbackButtons from './FeedbackButtons.svelte';

  export let input: string = '';
  export let loading: boolean = false;
  export let messageQueue: string[] = []; // FIFO queue of messages waiting to be sent

  // Auto-expanding textarea
  let textareaElement: HTMLTextAreaElement;
  const MIN_HEIGHT = 44; // ~1-2 lines
  const MAX_HEIGHT = 200; // ~8-10 lines
  let isAdjustingHeight = false; // Guard to prevent reactive loop

  function adjustTextareaHeight() {
    if (!textareaElement || isAdjustingHeight) return;
    isAdjustingHeight = true;
    // Reset to min to get accurate scrollHeight
    textareaElement.style.height = MIN_HEIGHT + 'px';
    // Expand to content, capped at max
    const newHeight = Math.min(Math.max(textareaElement.scrollHeight, MIN_HEIGHT), MAX_HEIGHT);
    textareaElement.style.height = newHeight + 'px';
    // Use setTimeout to release guard after DOM settles
    setTimeout(() => { isAdjustingHeight = false; }, 0);
  }

  // React to input changes (including programmatic clears)
  // Use afterUpdate instead of reactive statement to avoid infinite loops
  let lastInputLength = 0;
  $: if (textareaElement && input.length !== lastInputLength) {
    lastInputLength = input.length;
    adjustTextareaHeight();
  }
  export let selectedMessage: ChatMessage | null = null;
  export let isRecording: boolean = false;
  export let isContinuousMode: boolean = false;
  export let isWakeWordListening: boolean = false; // Wake word detection active (mobile)
  export let isConversationMode: boolean = false; // Conversation mode active (mobile long-press)
  export let ttsIsPlaying: boolean = false;
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

  onDestroy(() => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
    }
  });
</script>

<div class="input-wrapper">
  <!-- Reply-to indicator -->
  {#if selectedMessage}
    {@const isCuriosity = selectedMessage.meta?.isCuriosityQuestion || selectedMessage.meta?.type === 'curiosity'}
    {@const isClarifying = selectedMessage.meta?.type === 'clarifying_questions'}
    <div class="reply-indicator flex items-center gap-2 px-3 py-2 rounded-t-lg text-sm
                {isCuriosity ? 'bg-purple-500/10 dark:bg-purple-500/20 curiosity-reply' : isClarifying ? 'bg-cyan-500/10 dark:bg-cyan-500/20' : 'bg-blue-500/10 dark:bg-blue-500/20'}">
      {#if isCuriosity}
        <span class="pulse-dot-curiosity"></span>
        <span class="text-purple-500 dark:text-purple-400 font-medium">💭 Responding to:</span>
        <span class="text-gray-600 dark:text-gray-400 flex-1 truncate">{selectedMessage.content.substring(0, 50)}{selectedMessage.content.length > 50 ? '...' : ''}</span>
      {:else if isClarifying}
        <span class="text-cyan-500 dark:text-cyan-400 font-medium">💭 Discussing:</span>
        <span class="text-gray-600 dark:text-gray-400 flex-1 truncate">{selectedMessage.meta?.desireTitle || 'Goal'}</span>
      {:else}
        <span class="text-blue-500 dark:text-blue-400 font-medium">↩ Replying to:</span>
        <span class="text-gray-600 dark:text-gray-400 flex-1 truncate">{selectedMessage.content.substring(0, 60)}{selectedMessage.content.length > 60 ? '...' : ''}</span>
      {/if}
      <button
        class="w-6 h-6 flex items-center justify-center rounded-full bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
        on:click={handleClearSelection}
        title="Cancel reply"
      >✕</button>
    </div>
  {/if}

  <!-- Queued messages indicator (shows FIFO queue of messages waiting to be sent) -->
  {#if messageQueue.length > 0}
    <div class="queued-indicator flex items-center gap-2 px-3 py-2 bg-amber-500/10 dark:bg-amber-500/20 rounded-lg mb-2">
      <span class="queued-icon text-base">⏳</span>
      <span class="text-sm text-amber-600 dark:text-amber-400">
        {#if messageQueue.length === 1}
          Queued: "{messageQueue[0].substring(0, 40)}{messageQueue[0].length > 40 ? '...' : ''}"
        {:else}
          {messageQueue.length} messages queued (next: "{messageQueue[0].substring(0, 25)}...")
        {/if}
      </span>
    </div>
  {/if}

  <!-- Interim transcript preview (shows words as you speak in native mode) -->
  {#if interimTranscript}
    <div class="interim-transcript flex items-center gap-2 px-3 py-2 bg-blue-500/10 dark:bg-blue-500/20 rounded-lg mb-2">
      <span class="interim-icon text-base">🎤</span>
      <span class="text-sm text-blue-500 dark:text-blue-400 italic">{interimTranscript}</span>
    </div>
  {/if}

  <div class="input-row">
    <!-- Feedback buttons - left side -->
    <div class="flex items-center flex-shrink-0 mr-2">
      <FeedbackButtons targetType="conversation" />
    </div>

    <textarea
      bind:this={textareaElement}
      bind:value={input}
      on:keypress={handleKeyPress}
      on:input={adjustTextareaHeight}
      placeholder={loading ? "Type next message (will queue)..." : "Message your MetaHuman..."}
      rows="1"
      class="chat-input {loading ? 'queuing' : ''}"
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
        class="mic-btn {isRecording ? 'recording' : ''} {isContinuousMode ? 'continuous' : ''} {isConversationMode ? 'conversation' : ''} {isWakeWordListening ? 'wake-word' : ''} {ttsIsPlaying ? 'interrupt-ready' : ''} {loading ? 'queuing' : ''}"
        title={loading ? 'Voice input will be queued' : ttsIsPlaying ? 'Tap to interrupt and speak' : isWakeWordListening ? 'Listening for "hey greg"…' : isConversationMode ? (isRecording ? 'Listening…' : 'Conversation mode - just talk!') : isContinuousMode ? (isRecording ? 'Listening continuously…' : 'Continuous mode active') : (isRecording ? 'Listening… tap to stop' : 'Tap to speak, hold for conversation')}
        on:click={handleMicClick}
        on:contextmenu={handleMicContextMenu}
        on:touchstart={handleMicTouchStart}
        on:touchend={handleMicTouchEnd}
        on:touchmove={handleMicTouchMove}
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
        class="send-btn {loading && input.trim() ? 'queuing' : ''}"
        on:click={handleSend}
        disabled={!input.trim()}
        title={loading && input.trim() ? 'Queue message' : 'Send message'}
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/>
        </svg>
      </button>
    </div>
  </div>
</div>

<style>
  /* Curiosity reply indicator with pulsing dot */
  .curiosity-reply {
    border-left: 3px solid #8b5cf6;
    animation: curiosity-glow 2s ease-in-out infinite;
  }

  .pulse-dot-curiosity {
    width: 10px;
    height: 10px;
    background: #8b5cf6;
    border-radius: 50%;
    flex-shrink: 0;
    animation: pulse-curiosity 1.5s ease-in-out infinite;
    box-shadow: 0 0 0 0 rgba(139, 92, 246, 0.4);
  }

  @keyframes pulse-curiosity {
    0%, 100% {
      opacity: 1;
      transform: scale(1);
      box-shadow: 0 0 0 0 rgba(139, 92, 246, 0.4);
    }
    50% {
      opacity: 0.8;
      transform: scale(0.85);
      box-shadow: 0 0 0 8px rgba(139, 92, 246, 0);
    }
  }

  @keyframes curiosity-glow {
    0%, 100% {
      background-color: rgba(139, 92, 246, 0.1);
    }
    50% {
      background-color: rgba(139, 92, 246, 0.18);
    }
  }

  :global(.dark) .curiosity-reply {
    border-left-color: #a78bfa;
  }

  /* Queued message indicator */
  .queued-indicator {
    animation: queued-pulse 2s ease-in-out infinite;
  }
  .queued-icon {
    animation: hourglass 1.5s ease-in-out infinite;
  }
  @keyframes queued-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.8; }
  }
  @keyframes hourglass {
    0%, 100% { transform: rotate(0deg); }
    50% { transform: rotate(180deg); }
  }

  /* Interim transcript animations */
  .interim-transcript {
    animation: pulse 1.5s ease-in-out infinite;
  }
  .interim-icon {
    animation: bounce 0.5s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
  }
  @keyframes bounce {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-2px); }
  }

  /* Mic button - prevent long-press browser behavior */
  .mic-btn {
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    user-select: none;
    touch-action: none;
  }

  /* Wake word mode - purple */
  .mic-btn.wake-word {
    @apply bg-purple-500/15 border-purple-600 text-purple-600 dark:bg-purple-400/20 dark:border-purple-400 dark:text-purple-400;
  }
  .wake-word-icon { animation: pulse 2s ease-in-out infinite; }

  /* Conversation mode - green */
  .mic-btn.conversation {
    @apply bg-green-500/15 border-green-500 text-green-500 dark:bg-green-400/20 dark:border-green-400 dark:text-green-400;
  }
  .conversation-icon { animation: pulse 2s ease-in-out infinite; }
  .mic-btn.conversation:not(.recording) {
    animation: ready-pulse 2s ease-in-out infinite;
  }

  /* Interrupt ready - red pulsing */
  .mic-btn.interrupt-ready {
    @apply bg-red-500/15 border-red-500 text-red-500 dark:bg-red-400/20 dark:border-red-400 dark:text-red-400;
    animation: interrupt-pulse 1s ease-in-out infinite;
  }

  @keyframes interrupt-pulse {
    0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4); }
    50% { transform: scale(1.05); box-shadow: 0 0 0 8px rgba(239, 68, 68, 0); }
  }
  @keyframes ready-pulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.4); }
    50% { box-shadow: 0 0 0 6px rgba(34, 197, 94, 0); }
  }

  /* Recording waveform animation */
  .mic-btn.recording .recording-icon rect {
    animation: waveform 0.8s ease-in-out infinite;
  }
  .mic-btn.recording .recording-icon rect:nth-child(1) { animation-delay: 0s; }
  .mic-btn.recording .recording-icon rect:nth-child(2) { animation-delay: 0.1s; }
  .mic-btn.recording .recording-icon rect:nth-child(3) { animation-delay: 0.2s; }
  .mic-btn.recording .recording-icon rect:nth-child(4) { animation-delay: 0.3s; }
  .mic-btn.recording .recording-icon rect:nth-child(5) { animation-delay: 0.4s; }

  @keyframes waveform {
    0%, 100% { transform: scaleY(0.5); }
    50% { transform: scaleY(1); }
  }
</style>
