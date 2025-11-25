<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  interface TerminalTab {
    id: string;
    port: number;
    title: string;
    url: string;
  }

  let tabs: TerminalTab[] = [];
  let activeTabId: string | null = null;
  let isCreating = false;

  onMount(async () => {
    // Start with one terminal
    await createNewTerminal();
  });

  onDestroy(async () => {
    // Clean up all terminals
    for (const tab of tabs) {
      await killTerminal(tab.port);
    }
  });

  async function createNewTerminal() {
    if (isCreating) return;

    isCreating = true;

    try {
      const response = await fetch('/api/terminal/spawn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        const error = await response.json();
        console.error('[TerminalManager] Failed to spawn terminal:', error);
        alert(`Failed to create terminal: ${error.error}`);
        return;
      }

      const data = await response.json();

      const newTab: TerminalTab = {
        id: crypto.randomUUID(),
        port: data.port,
        title: `Terminal ${tabs.length + 1}`,
        url: data.url
      };

      tabs = [...tabs, newTab];
      activeTabId = newTab.id;

    } catch (error) {
      console.error('[TerminalManager] Error creating terminal:', error);
      alert('Failed to create terminal');
    } finally {
      isCreating = false;
    }
  }

  async function closeTerminal(tab: TerminalTab) {
    if (tabs.length === 1) {
      // Don't close the last terminal, just create a new one
      await createNewTerminal();
      await killTerminal(tab.port);
      tabs = tabs.filter(t => t.id !== tab.id);
      if (tabs.length > 0) {
        activeTabId = tabs[0].id;
      }
      return;
    }

    // Kill the terminal process
    await killTerminal(tab.port);

    // Remove tab
    const tabIndex = tabs.findIndex(t => t.id === tab.id);
    tabs = tabs.filter(t => t.id !== tab.id);

    // Switch to another tab
    if (activeTabId === tab.id) {
      const newIndex = Math.max(0, tabIndex - 1);
      activeTabId = tabs[newIndex]?.id || null;
    }
  }

  async function killTerminal(port: number) {
    try {
      await fetch(`/api/terminal/kill/${port}`, {
        method: 'POST'
      });
    } catch (error) {
      console.error(`[TerminalManager] Error killing terminal on port ${port}:`, error);
    }
  }

  function switchTab(tabId: string) {
    activeTabId = tabId;
  }

  function handleTabKeydown(event: KeyboardEvent, tabId: string) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      switchTab(tabId);
    }
  }

  function handleCloseKeydown(event: KeyboardEvent, tab: TerminalTab) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      closeTerminal(tab);
    }
  }
</script>

<div class="terminal-manager">
  <!-- Tab Bar -->
  <div class="tab-bar">
    <div class="tabs-list">
      {#each tabs as tab}
        <div
          class="tab"
          class:active={tab.id === activeTabId}
          role="tab"
          tabindex={tab.id === activeTabId ? 0 : -1}
          aria-selected={tab.id === activeTabId}
          on:click={() => switchTab(tab.id)}
          on:keydown={(e) => handleTabKeydown(e, tab.id)}
        >
          <span class="tab-title">{tab.title}</span>
          <button
            class="tab-close"
            aria-label="Close tab"
            on:click|stopPropagation={() => closeTerminal(tab)}
            on:keydown|stopPropagation={(e) => handleCloseKeydown(e, tab)}
          >
            ×
          </button>
        </div>
      {/each}
    </div>
    <button
      class="new-tab-btn"
      on:click={createNewTerminal}
      disabled={isCreating || tabs.length >= 10}
      aria-label="New terminal tab"
    >
      <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="8" y1="4" x2="8" y2="12"/>
        <line x1="4" y1="8" x2="12" y2="8"/>
      </svg>
      <span class="new-tab-text">New</span>
    </button>
  </div>

  <!-- Terminal Iframes -->
  <div class="terminals-content">
    {#each tabs as tab (tab.id)}
      <div class="terminal-pane" class:active={tab.id === activeTabId}>
        <iframe
          src={tab.url}
          title={tab.title}
          class="terminal-iframe"
          sandbox="allow-same-origin allow-scripts allow-forms"
        ></iframe>
      </div>
    {/each}
  </div>
</div>

<style>
  .terminal-manager {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    background: #000;
  }

  .tab-bar {
    display: flex;
    align-items: center;
    background: #0a0a0a;
    border-bottom: 1px solid #222;
    padding: 0 0.25rem;
    gap: 0.25rem;
    min-height: 24px;
    flex-shrink: 0;
  }

  .tabs-list {
    display: flex;
    gap: 2px;
    flex: 1;
    overflow-x: auto;
    scrollbar-width: thin;
    scrollbar-color: #333 transparent;
  }

  .tabs-list::-webkit-scrollbar {
    height: 2px;
  }

  .tabs-list::-webkit-scrollbar-track {
    background: transparent;
  }

  .tabs-list::-webkit-scrollbar-thumb {
    background: #333;
    border-radius: 1px;
  }

  .tab {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.125rem 0.375rem;
    background: #1a1a1a;
    border: none;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.15s;
    min-width: 60px;
    max-width: 120px;
    border-radius: 2px;
  }

  .tab:hover {
    background: #252525;
  }

  .tab.active {
    background: #2a2a2a;
  }

  .tab:focus-visible {
    outline: 1px solid #0078d4;
    outline-offset: -1px;
  }

  .tab-title {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    color: #888;
    font-size: 0.7rem;
    font-family: monospace;
  }

  .tab.active .tab-title {
    color: #ccc;
  }

  .tab-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 12px;
    height: 12px;
    border: none;
    background: transparent;
    color: #666;
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    padding: 0;
    transition: all 0.15s;
    border-radius: 2px;
  }

  .tab-close:hover {
    background: #ff5555;
    color: #fff;
  }

  .tab-close:focus-visible {
    outline: 1px solid #0078d4;
    outline-offset: -1px;
  }

  .new-tab-btn {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.125rem 0.375rem;
    background: #1a1a1a;
    color: #888;
    border: none;
    border-radius: 2px;
    cursor: pointer;
    font-size: 0.7rem;
    font-family: monospace;
    transition: all 0.15s;
    white-space: nowrap;
  }

  .new-tab-btn:hover:not(:disabled) {
    background: #252525;
    color: #ccc;
  }

  .new-tab-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .new-tab-btn:focus-visible {
    outline: 1px solid #0078d4;
    outline-offset: 1px;
  }

  .new-tab-text {
    font-weight: 400;
  }

  .terminals-content {
    flex: 1;
    position: relative;
    overflow: hidden;
  }

  .terminal-pane {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    display: none;
  }

  .terminal-pane.active {
    display: block;
  }

  .terminal-iframe {
    width: 100%;
    height: 100%;
    border: none;
    background: #000;
  }
</style>
