<script lang="ts">
  import { createEventDispatcher, afterUpdate, onMount, onDestroy } from 'svelte';
  import { apiFetch } from '../lib/client/api-config';

  /** Big Brother output chunks (can be passed in OR populated via WebSocket) */
  export let output: string[] = [];
  /** Whether Big Brother is actively running */
  export let active: boolean = false;
  /** Whether Big Brother is waiting for user input */
  export let waiting: boolean = false;
  /** Last question Big Brother asked */
  export let question: string = '';
  /** Whether panel can be minimized */
  export let minimizable: boolean = true;
  /** Whether to connect to WebSocket for live updates */
  export let liveMode: boolean = true;

  let inputText = '';
  let outputContainer: HTMLDivElement;
  let inputField: HTMLTextAreaElement;
  let minimized = false;
  let sending = false;
  let ws: WebSocket | null = null;
  let wsConnected = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // Internal output buffer for WebSocket mode
  let internalOutput: string[] = [];

  // Use internal output if in live mode, otherwise use prop
  $: displayOutput = liveMode ? internalOutput : output;
  $: displayActive = liveMode ? wsConnected : active;

  function connectWebSocket() {
    if (!liveMode || ws) return;

    try {
      // Connect to Big Brother WebSocket server (port 3099)
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.hostname}:3099`;

      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('[BigBrother WS] Connected to stream');
        wsConnected = true;
        internalOutput = ['🔗 Connected to Big Brother stream...'];
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === 'output') {
            // Stream output chunk - uses 'data' field from server
            if (data.data) {
              internalOutput = [...internalOutput, data.data];
            }
          } else if (data.type === 'stderr') {
            // Stderr output
            if (data.data) {
              internalOutput = [...internalOutput, `⚠️ ${data.data}`];
            }
          } else if (data.type === 'thinking') {
            // Claude is thinking
            internalOutput = [...internalOutput, `💭 ${data.data || ''}`];
          } else if (data.type === 'tool_use') {
            // Tool being used
            internalOutput = [...internalOutput, `🔧 Tool: ${data.name || data.data}`];
          } else if (data.type === 'complete') {
            internalOutput = [...internalOutput, `\n✅ Complete`];
          } else if (data.type === 'error') {
            internalOutput = [...internalOutput, `\n❌ Error: ${data.data || 'Unknown error'}`];
          } else if (data.type === 'prompt') {
            // Show what prompt was sent
            const preview = (data.data || '').substring(0, 100);
            internalOutput = [...internalOutput, `\n📤 Prompt: ${preview}...`];
          }
        } catch {
          // Plain text message
          if (event.data.trim()) {
            internalOutput = [...internalOutput, event.data];
          }
        }
      };

      ws.onclose = () => {
        console.log('[BigBrother WS] Disconnected');
        wsConnected = false;
        ws = null;

        // Reconnect after delay if still in live mode
        if (liveMode) {
          reconnectTimer = setTimeout(connectWebSocket, 3000);
        }
      };

      ws.onerror = (err) => {
        console.error('[BigBrother WS] Error:', err);
        wsConnected = false;
      };
    } catch (err) {
      console.error('[BigBrother WS] Failed to connect:', err);
    }
  }

  function disconnectWebSocket() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (ws) {
      ws.close();
      ws = null;
    }
    wsConnected = false;
  }

  function clearOutput() {
    internalOutput = [];
  }

  onMount(() => {
    if (liveMode) {
      connectWebSocket();
    }
  });

  onDestroy(() => {
    disconnectWebSocket();
  });

  function escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function ansiToHtml(value: string): string {
    const ansiRegex = /\x1b\[([0-9;]+)m/g;
    let result = '';
    let lastIndex = 0;
    let style = '';

    const pushChunk = (chunk: string) => {
      if (!chunk) return;
      const escaped = escapeHtml(chunk);
      if (style) {
        result += `<span style="${style}">${escaped}</span>`;
      } else {
        result += escaped;
      }
    };

    let match: RegExpExecArray | null;
    while ((match = ansiRegex.exec(value)) !== null) {
      pushChunk(value.slice(lastIndex, match.index));
      lastIndex = ansiRegex.lastIndex;

      const codes = match[1].split(';').map(Number);
      for (const code of codes) {
        if (code === 0) {
          style = '';
        } else if (code === 1) {
          style = `${style}font-weight:700;`;
        } else if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) {
          const colorMap: Record<number, string> = {
            30: '#0f172a',
            31: '#ef4444',
            32: '#22c55e',
            33: '#f59e0b',
            34: '#3b82f6',
            35: '#a855f7',
            36: '#06b6d4',
            37: '#e2e8f0',
            90: '#475569',
            91: '#f87171',
            92: '#4ade80',
            93: '#fbbf24',
            94: '#60a5fa',
            95: '#c084fc',
            96: '#22d3ee',
            97: '#f8fafc',
          };
          style = `${style}color:${colorMap[code] || '#e2e8f0'};`;
        } else if (code === 39) {
          style = style.replace(/color:[^;]+;/g, '');
        }
      }
    }

    pushChunk(value.slice(lastIndex));
    return result;
  }

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
      const response = await apiFetch('/api/big-brother-input', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: inputText }),
      });

      if (response.ok) {
        dispatch('sendInput', { text: inputText });
        inputText = '';
      } else {
        const error = await response.json();
        console.error('[BigBrotherTerminalPanel] Failed to send input:', error);
      }
    } catch (error) {
      console.error('[BigBrotherTerminalPanel] Error sending input:', error);
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

<div class="big-brother-terminal" class:minimized class:active={displayActive} class:waiting>
  <!-- Header -->
  <div class="flex justify-between items-center py-2 px-3 bg-[#181825] border-b border-[#313244] cursor-pointer">
    <div class="flex items-center gap-2">
      <span class="status-dot" class:active={displayActive} class:waiting class:connected={wsConnected}></span>
      <span class="text-[#cdd6f4] text-xs font-medium">
        {#if displayActive}
          Big Brother Running...
        {:else if waiting}
          Waiting for response...
        {:else if liveMode && wsConnected}
          Big Brother (Live)
        {:else if liveMode}
          Big Brother (Connecting...)
        {:else}
          Big Brother
        {/if}
      </span>
    </div>
    <div class="flex gap-1">
      {#if liveMode && displayOutput.length > 1}
        <button
          class="header-btn"
          on:click={clearOutput}
          title="Clear output"
        >
          🗑
        </button>
      {/if}
      {#if minimizable}
        <button
          class="header-btn"
          on:click={toggleMinimize}
          title={minimized ? 'Expand' : 'Minimize'}
        >
          {minimized ? '▲' : '▼'}
        </button>
      {/if}
      <button
        class="header-btn"
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
      {#if displayOutput.length === 0}
        <div class="text-[#6c7086] italic text-center py-5">
          {#if liveMode && !wsConnected}
            Connecting to Big Brother stream...
          {:else}
            Waiting for Big Brother output...
          {/if}
        </div>
      {:else}
        {#each displayOutput as line, i}
          <pre class="m-0 py-0.5 text-[#cdd6f4] whitespace-pre-wrap break-words"><span>{@html ansiToHtml(line)}</span></pre>
        {/each}
      {/if}

      {#if waiting && question}
        <div class="flex items-center gap-2 mt-3 p-3 bg-[#f9e2af]/10 rounded-md border-l-[3px] border-[#f9e2af]">
          <div class="text-[#f9e2af] font-bold">❯</div>
          <div class="text-[#f9e2af] text-xs">Big Brother is waiting for your response...</div>
        </div>
      {/if}
    </div>

    <!-- Input area -->
    <div class="terminal-input" class:waiting class:disabled={!displayActive && !waiting}>
      <textarea
        bind:this={inputField}
        bind:value={inputText}
        on:keydown={handleKeydown}
        placeholder={waiting ? "Respond to Big Brother's question..." : "Send input to Big Brother..."}
        rows="2"
        disabled={(!displayActive && !waiting) || sending}
      ></textarea>
      <button
        class="send-btn"
        on:click={handleSend}
        disabled={!inputText.trim() || (!displayActive && !waiting) || sending}
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
    <div class="flex items-center gap-2 px-3 py-1 text-[#6c7086] text-[11px]">
      {#if displayActive}
        <span class="text-[#a6e3a1] font-medium">Running</span>
        <span class="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{displayOutput[displayOutput.length - 1]?.substring(0, 50) || ''}...</span>
      {:else if waiting}
        <span class="text-[#f9e2af] font-medium">Waiting for input</span>
      {:else if liveMode && wsConnected}
        <span class="text-[#89b4fa] font-medium">Connected</span>
      {:else}
        <span class="text-[#6c7086] font-medium">Idle</span>
      {/if}
    </div>
  {/if}
</div>

<style>
  /* Terminal container */
  .big-brother-terminal {
    @apply flex flex-col bg-[#1e1e2e] border border-[#313244] rounded-lg overflow-hidden;
    font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
    font-size: 13px;
  }
  .big-brother-terminal.minimized {
    max-height: 36px;
  }

  /* Status dot with animations */
  .status-dot {
    @apply w-2 h-2 rounded-full bg-[#6c7086];
  }
  .status-dot.connected {
    @apply bg-[#89b4fa];
  }
  .status-dot.active {
    @apply bg-[#a6e3a1];
    animation: pulse 2s ease-in-out infinite;
  }
  .status-dot.waiting {
    @apply bg-[#f9e2af];
    animation: pulse 1s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  /* Header button */
  .header-btn {
    @apply bg-transparent border-0 text-[#6c7086] py-1 px-2 cursor-pointer rounded text-xs;
  }
  .header-btn:hover {
    @apply bg-white/10 text-[#cdd6f4];
  }

  /* Output area with scrollbar */
  .terminal-output {
    @apply flex-1 min-h-[150px] max-h-[300px] overflow-y-auto p-3 bg-[#1e1e2e];
  }
  .terminal-output::-webkit-scrollbar { width: 8px; }
  .terminal-output::-webkit-scrollbar-track { background: transparent; }
  .terminal-output::-webkit-scrollbar-thumb { @apply bg-[#45475a] rounded; }
  .terminal-output::-webkit-scrollbar-thumb:hover { @apply bg-[#585b70]; }

  /* Input area */
  .terminal-input {
    @apply flex gap-2 p-3 bg-[#181825] border-t border-[#313244];
  }
  .terminal-input.disabled {
    @apply opacity-50;
  }
  .terminal-input.waiting textarea {
    border-color: #f9e2af;
  }
  .terminal-input textarea {
    @apply flex-1 bg-[#1e1e2e] border border-[#313244] rounded-md text-[#cdd6f4] py-2 px-3 resize-none;
    font-family: inherit;
    font-size: 13px;
  }
  .terminal-input textarea:focus {
    @apply outline-none border-[#89b4fa];
  }
  .terminal-input textarea:disabled {
    @apply cursor-not-allowed;
  }

  /* Send button */
  .send-btn {
    @apply py-2 px-4 bg-[#89b4fa] text-[#1e1e2e] border-0 rounded-md font-medium cursor-pointer transition-colors;
  }
  .send-btn:hover:not(:disabled) {
    @apply bg-[#b4befe];
  }
  .send-btn:disabled {
    @apply bg-[#45475a] text-[#6c7086] cursor-not-allowed;
  }
</style>
