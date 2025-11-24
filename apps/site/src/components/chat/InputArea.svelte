<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { ChatMessage } from '../../lib/useMessages';

  export let input: string = '';
  export let loading: boolean = false;
  export let selectedMessage: ChatMessage | null = null;
  export let isRecording: boolean = false;
  export let isContinuousMode: boolean = false;
  export let ttsIsPlaying: boolean = false;
  export let lengthMode: 'auto' | 'concise' | 'detailed' = 'auto';

  const dispatch = createEventDispatcher<{
    send: void;
    stop: void;
    keypress: { event: KeyboardEvent };
    micClick: void;
    micContextMenu: void;
    ttsStop: void;
    clearSelection: void;
    lengthModeChange: { mode: 'auto' | 'concise' | 'detailed' };
  }>();

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
    dispatch('micClick');
  }

  function handleMicContextMenu(e: MouseEvent) {
    e.preventDefault();
    dispatch('micContextMenu');
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
        class="mic-btn {isRecording ? 'recording' : ''} {isContinuousMode ? 'continuous' : ''}"
        title={isContinuousMode ? (isRecording ? 'Listening continuously…' : 'Continuous mode active') : (isRecording ? 'Listening… click to stop' : 'Click to speak')}
        on:click={handleMicClick}
        on:contextmenu={handleMicContextMenu}
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
