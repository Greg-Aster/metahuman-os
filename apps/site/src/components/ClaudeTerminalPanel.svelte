<script lang="ts">
  import { createEventDispatcher, afterUpdate, onMount } from 'svelte';
  import { apiFetch } from '../lib/client/api-config';

  /** Claude CLI output chunks */
  export let output: string[] = [];
  /** Whether Claude CLI is actively running */
  export let active: boolean = false;
  /** Whether Claude is waiting for user input */
  export let waiting: boolean = false;
  /** Last question Claude asked */
  export let question: string = '';
  /** Whether panel can be minimized */
  export let minimizable: boolean = true;

  let inputText = '';
  let outputContainer: HTMLDivElement;
  let inputField: HTMLTextAreaElement;
  let minimized = false;
  let sending = false;

  const dispatch = createEventDispatcher<{
    sendInput: { text: string };
    close: void;
    minimize: void;
  }>();

  // Auto-scroll to bottom when output changes
  afterUpdate(() => {
    if (outputContainer && !minimized) {
      outputContainer.scrollTop = outputContainer.scrollHeight;
    }
  });

  // Focus input when waiting for user response
  $: if (waiting && inputField && !minimized) {
    setTimeout(() => inputField?.focus(), 100);
  }

  async function handleSend() {
    if (!inputText.trim() || sending) return;

    sending = true;
    try {
      const response = await apiFetch('/api/claude-cli-input', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: inputText }),
      });

      if (response.ok) {
        dispatch('sendInput', { text: inputText });
        inputText = '';
      } else {
        const error = await response.json();
        console.error('[ClaudeTerminalPanel] Failed to send input:', error);
      }
    } catch (error) {
      console.error('[ClaudeTerminalPanel] Error sending input:', error);
    } finally {
      sending = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function toggleMinimize() {
    minimized = !minimized;
    dispatch('minimize');
  }
</script>

<div class="claude-terminal" class:minimized class:active class:waiting>
  <!-- Header -->
  <div class="terminal-header">
    <div class="header-left">
      <span class="status-dot" class:active class:waiting></span>
      <span class="terminal-title">
        {#if active}
          Claude CLI Running...
        {:else if waiting}
          Waiting for response...
        {:else}
          Claude CLI
        {/if}
      </span>
    </div>
    <div class="header-actions">
      {#if minimizable}
        <button
          class="header-btn minimize-btn"
          on:click={toggleMinimize}
          title={minimized ? 'Expand' : 'Minimize'}
        >
          {minimized ? '▲' : '▼'}
        </button>
      {/if}
      <button
        class="header-btn close-btn"
        on:click={() => dispatch('close')}
        title="Close terminal"
      >
        ✕
      </button>
    </div>
  </div>

  {#if !minimized}
    <!-- Output area -->
    <div class="terminal-output" bind:this={outputContainer}>
      {#if output.length === 0}
        <div class="empty-state">
          Waiting for Claude CLI output...
        </div>
      {:else}
        {#each output as line, i}
          <pre class="output-line">{line}</pre>
        {/each}
      {/if}

      {#if waiting && question}
        <div class="waiting-prompt">
          <div class="prompt-icon">❯</div>
          <div class="prompt-text">Claude is waiting for your response...</div>
        </div>
      {/if}
    </div>

    <!-- Input area -->
    <div class="terminal-input" class:waiting class:disabled={!active && !waiting}>
      <textarea
        bind:this={inputField}
        bind:value={inputText}
        on:keydown={handleKeydown}
        placeholder={waiting ? "Respond to Claude's question..." : "Send input to Claude CLI..."}
        rows="2"
        disabled={(!active && !waiting) || sending}
      ></textarea>
      <button
        class="send-btn"
        on:click={handleSend}
        disabled={!inputText.trim() || (!active && !waiting) || sending}
      >
        {#if sending}
          ...
        {:else}
          Send
        {/if}
      </button>
    </div>
  {:else}
    <!-- Minimized state -->
    <div class="minimized-bar">
      {#if active}
        <span class="minimized-status">Running</span>
        <span class="minimized-output">{output[output.length - 1]?.substring(0, 50) || ''}...</span>
      {:else if waiting}
        <span class="minimized-status waiting">Waiting for input</span>
      {:else}
        <span class="minimized-status">Idle</span>
      {/if}
    </div>
  {/if}
</div>

<style>
  .claude-terminal {
    display: flex;
    flex-direction: column;
    background: var(--terminal-bg, #1e1e2e);
    border: 1px solid var(--terminal-border, #313244);
    border-radius: 8px;
    overflow: hidden;
    font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
    font-size: 13px;
  }

  .claude-terminal.minimized {
    max-height: 36px;
  }

  /* Header */
  .terminal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 12px;
    background: var(--terminal-header-bg, #181825);
    border-bottom: 1px solid var(--terminal-border, #313244);
    cursor: pointer;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #6c7086;
  }

  .status-dot.active {
    background: #a6e3a1;
    animation: pulse 2s ease-in-out infinite;
  }

  .status-dot.waiting {
    background: #f9e2af;
    animation: pulse 1s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  .terminal-title {
    color: var(--terminal-text, #cdd6f4);
    font-size: 12px;
    font-weight: 500;
  }

  .header-actions {
    display: flex;
    gap: 4px;
  }

  .header-btn {
    background: transparent;
    border: none;
    color: #6c7086;
    padding: 4px 8px;
    cursor: pointer;
    border-radius: 4px;
    font-size: 12px;
  }

  .header-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #cdd6f4;
  }

  /* Output area */
  .terminal-output {
    flex: 1;
    min-height: 150px;
    max-height: 300px;
    overflow-y: auto;
    padding: 12px;
    background: var(--terminal-bg, #1e1e2e);
  }

  .empty-state {
    color: #6c7086;
    font-style: italic;
    text-align: center;
    padding: 20px;
  }

  .output-line {
    margin: 0;
    padding: 2px 0;
    color: var(--terminal-text, #cdd6f4);
    white-space: pre-wrap;
    word-break: break-word;
  }

  .waiting-prompt {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 12px;
    padding: 12px;
    background: rgba(249, 226, 175, 0.1);
    border-radius: 6px;
    border-left: 3px solid #f9e2af;
  }

  .prompt-icon {
    color: #f9e2af;
    font-weight: bold;
  }

  .prompt-text {
    color: #f9e2af;
    font-size: 12px;
  }

  /* Input area */
  .terminal-input {
    display: flex;
    gap: 8px;
    padding: 12px;
    background: var(--terminal-header-bg, #181825);
    border-top: 1px solid var(--terminal-border, #313244);
  }

  .terminal-input.disabled {
    opacity: 0.5;
  }

  .terminal-input.waiting textarea {
    border-color: #f9e2af;
  }

  .terminal-input textarea {
    flex: 1;
    background: var(--terminal-bg, #1e1e2e);
    border: 1px solid var(--terminal-border, #313244);
    border-radius: 6px;
    color: var(--terminal-text, #cdd6f4);
    padding: 8px 12px;
    font-family: inherit;
    font-size: 13px;
    resize: none;
  }

  .terminal-input textarea:focus {
    outline: none;
    border-color: #89b4fa;
  }

  .terminal-input textarea:disabled {
    cursor: not-allowed;
  }

  .send-btn {
    padding: 8px 16px;
    background: #89b4fa;
    color: #1e1e2e;
    border: none;
    border-radius: 6px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.2s;
  }

  .send-btn:hover:not(:disabled) {
    background: #b4befe;
  }

  .send-btn:disabled {
    background: #45475a;
    color: #6c7086;
    cursor: not-allowed;
  }

  /* Minimized bar */
  .minimized-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 12px;
    color: #6c7086;
    font-size: 11px;
  }

  .minimized-status {
    color: #a6e3a1;
    font-weight: 500;
  }

  .minimized-status.waiting {
    color: #f9e2af;
  }

  .minimized-output {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Scrollbar styling */
  .terminal-output::-webkit-scrollbar {
    width: 8px;
  }

  .terminal-output::-webkit-scrollbar-track {
    background: transparent;
  }

  .terminal-output::-webkit-scrollbar-thumb {
    background: #45475a;
    border-radius: 4px;
  }

  .terminal-output::-webkit-scrollbar-thumb:hover {
    background: #585b70;
  }
</style>
