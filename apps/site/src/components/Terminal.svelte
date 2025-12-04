<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { apiFetch } from '../lib/client/api-config';
  interface CommandHistory {
    command: string;
    output: string;
    error?: string;
    timestamp: Date;
    success: boolean;
  }

  let commandInput = '';
  let history: CommandHistory[] = [];
  let commandHistory: string[] = [];
  let historyIndex = -1;
  let isExecuting = false;
  let terminalOutput: HTMLDivElement;
  let autoScroll = true; // disable when user scrolls up
  let bottomSentinel: HTMLDivElement;
  let observer: IntersectionObserver | null = null;

  // Auto-scroll to bottom when new output arrives
  $: if (history.length > 0 && autoScroll && bottomSentinel) {
    // Scroll after DOM updates to avoid race with observer
    requestAnimationFrame(() => {
      bottomSentinel?.scrollIntoView({ block: 'end', inline: 'nearest' });
    });
  }

  onMount(() => {
    if (terminalOutput && bottomSentinel) {
      observer = new IntersectionObserver(
        (entries) => {
          const entry = entries[0];
          autoScroll = entry.isIntersecting;
        },
        { root: terminalOutput, threshold: 0.99 }
      );
      observer.observe(bottomSentinel);
    }
  });

  onDestroy(() => {
    observer?.disconnect();
    observer = null;
  });

  async function executeCommand() {
    if (!commandInput.trim() || isExecuting) return;

    const fullCommand = commandInput.trim();
    const parts = fullCommand.split(' ');
    const command = parts[0];
    const args = parts.slice(1);

    // Add to command history
    commandHistory.push(fullCommand);
    historyIndex = commandHistory.length;

    // Clear input
    const cmdToExecute = commandInput;
    commandInput = '';
    isExecuting = true;

    // Add placeholder to history
    history = [
      ...history,
      {
        command: `mh ${cmdToExecute}`,
        output: 'Executing...',
        timestamp: new Date(),
        success: true,
      },
    ];

    try {
      const response = await apiFetch('/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, args }),
      });

      const result = await response.json();

      // Update last history item with result
      history[history.length - 1] = {
        command: result.command || `mh ${cmdToExecute}`,
        output: result.stdout || result.error || 'No output',
        error: result.stderr,
        timestamp: new Date(),
        success: result.success,
      };

      history = [...history]; // Trigger reactivity
    } catch (error) {
      history[history.length - 1] = {
        command: `mh ${cmdToExecute}`,
        output: '',
        error: (error as Error).message,
        timestamp: new Date(),
        success: false,
      };
      history = [...history];
    } finally {
      isExecuting = false;
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      executeCommand();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (historyIndex > 0) {
        historyIndex--;
        commandInput = commandHistory[historyIndex];
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex < commandHistory.length - 1) {
        historyIndex++;
        commandInput = commandHistory[historyIndex];
      } else {
        historyIndex = commandHistory.length;
        commandInput = '';
      }
    }
  }

  function clearHistory() {
    history = [];
  }

  // Common commands for quick access
  const quickCommands = [
    { label: 'Status', cmd: 'status' },
    { label: 'Tasks', cmd: 'task' },
    { label: 'Agent List', cmd: 'agent list' },
    { label: 'Inner Dialogue', cmd: 'chat' },
    { label: 'Raw LLM Chat', cmd: 'ollama chat phi3:mini' },
    { label: 'Help', cmd: 'help' },
  ];

  function runQuickCommand(cmd: string) {
    commandInput = cmd;
    executeCommand();
  }
</script>

<div class="terminal-container h-full flex flex-col">
  <!-- Quick Commands -->
  <div class="flex gap-2 p-3 border-b border-gray-200 dark:border-gray-700 flex-wrap">
    {#each quickCommands as qc}
      <button
        on:click={() => runQuickCommand(qc.cmd)}
        class="px-3 py-1 text-xs bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition"
        disabled={isExecuting}
      >
        {qc.label}
      </button>
    {/each}
    <button
      on:click={clearHistory}
      class="px-3 py-1 text-xs bg-red-100 dark:bg-red-900 hover:bg-red-200 dark:hover:bg-red-800 rounded transition ml-auto"
    >
      Clear
    </button>
  </div>

  <!-- Terminal Output -->
  <div
    bind:this={terminalOutput}
    class="flex-1 overflow-y-auto p-4 font-mono text-sm bg-black text-green-400"
  >
    {#if history.length === 0}
      <div class="text-gray-500">
        <p>MetaHuman OS Terminal</p>
        <p class="mt-4">This is a direct interface to the 'mh' command-line tool.</p>
        <p class="mt-2">Use <span class="text-blue-400">chat</span> for inner dialogue (persona-aware).</p>
        <p>Use <span class="text-blue-400">ollama chat &lt;model&gt;</span> to talk directly to a raw AI model.</p>
        <p class="mt-2">Try the quick commands above or type 'help' for a full command list.</p>
      </div>
    {:else}
      {#each history as entry}
        <div class="mb-4">
          <!-- Command -->
          <div class="text-blue-400">
            <span class="text-gray-500">[{entry.timestamp.toLocaleTimeString()}]</span>
            <span class="ml-2">$ {entry.command}</span>
          </div>

          <!-- Output -->
          {#if entry.output}
            <pre class="mt-1 whitespace-pre-wrap break-words overflow-x-auto {entry.success ? 'text-green-400' : 'text-yellow-400'}">{entry.output}</pre>
          {/if}

          <!-- Error -->
          {#if entry.error}
            <pre class="mt-1 text-red-400 whitespace-pre-wrap break-words overflow-x-auto">{entry.error}</pre>
          {/if}
        </div>
      {/each}
    {/if}

    {#if isExecuting}
      <div class="animate-pulse text-gray-500">...</div>
    {/if}
    <div bind:this={bottomSentinel} style="height: 1px;"></div>
  </div>

  <!-- Command Input -->
  <div class="p-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
    <div class="flex items-center gap-2 font-mono text-sm">
      <span class="text-gray-500">mh</span>
      <input
        type="text"
        bind:value={commandInput}
        on:keydown={handleKeyDown}
        placeholder="type command here (e.g., status, task, ollama status)"
        disabled={isExecuting}
        class="flex-1 bg-transparent border-none outline-none text-gray-900 dark:text-gray-100 placeholder-gray-400"
      />
      <button
        on:click={executeCommand}
        disabled={!commandInput.trim() || isExecuting}
        class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
      >
        Run
      </button>
    </div>
  </div>
</div>

<style>
  .terminal-container {
    background: #000;
  }
</style>
