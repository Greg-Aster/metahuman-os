<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { bigBrotherTerminal, bigBrotherTerminalOpened } from '../stores/bigBrotherTerminal';
  import { apiFetch } from '../lib/client/api-config';

  interface TerminalTab {
    id: string;
    port: number;
    title: string;
    url: string;
    isBigBrother?: boolean;
    isServices?: boolean;
  }

  let tabs: TerminalTab[] = [];
  let activeTabId: string | null = null;
  let isCreating = false;
  let bigBrotherTabId: string | null = null;
  let servicesTabId: string | null = null;

  // Subscribe to Big Brother terminal requests
  const unsubscribe = bigBrotherTerminal.subscribe(state => {
    if (state.shouldOpen && !bigBrotherTabId) {
      openBigBrotherTerminal(state.port, state.url);
    }
  });

  interface RunningTerminal {
    pid: number;
    port: number;
    command?: string;
  }

  async function fetchRunningTerminals(): Promise<RunningTerminal[]> {
    try {
      const response = await apiFetch('/api/terminal/list');
      if (!response.ok) return [];
      const data = await response.json();
      return data.terminals || [];
    } catch (error) {
      console.warn('[TerminalManager] Failed to fetch running terminals:', error);
      return [];
    }
  }

  function inferTerminalTitle(terminal: RunningTerminal, index: number): { title: string; isServices: boolean; isBigBrother: boolean } {
    const command = terminal.command || '';

    // Detect services terminal
    if (command.includes('start-services') || command.includes('run-with-agents')) {
      return { title: '⚡ Services', isServices: true, isBigBrother: false };
    }

    // Detect Big Brother terminal
    if (terminal.port === 3099 || command.includes('claude')) {
      return { title: '🤖 Big Brother', isServices: false, isBigBrother: true };
    }

    // Regular terminal
    return { title: `💻 Terminal ${index + 1}`, isServices: false, isBigBrother: false };
  }

  async function discoverAndRestoreTerminals() {
    // Fetch actually running terminals from the server
    const runningTerminals = await fetchRunningTerminals();

    // Load saved tabs from localStorage for title/metadata restoration
    let savedTabs: TerminalTab[] = [];
    let savedActiveTabId: string | null = null;

    if (typeof localStorage !== 'undefined') {
      try {
        const savedTabsJson = localStorage.getItem('mh_terminal_tabs');
        savedActiveTabId = localStorage.getItem('mh_active_terminal_tab');
        if (savedTabsJson) {
          savedTabs = JSON.parse(savedTabsJson);
        }
      } catch {
        // Ignore localStorage errors
      }
    }

    // Build map of saved tabs by port for quick lookup
    const savedTabsByPort = new Map(savedTabs.map(t => [t.port, t]));

    // Create tabs for all running terminals
    const restoredTabs: TerminalTab[] = [];
    let regularTerminalCount = 0;

    for (const terminal of runningTerminals) {
      const savedTab = savedTabsByPort.get(terminal.port);

      if (savedTab) {
        // Restore from saved metadata
        restoredTabs.push(savedTab);

        if (savedTab.isBigBrother) bigBrotherTabId = savedTab.id;
        if (savedTab.isServices) servicesTabId = savedTab.id;
        if (!savedTab.isBigBrother && !savedTab.isServices) regularTerminalCount++;
      } else {
        // Create new tab for orphaned terminal
        const { title, isServices, isBigBrother } = inferTerminalTitle(terminal, regularTerminalCount);

        const newTab: TerminalTab = {
          id: crypto.randomUUID(),
          port: terminal.port,
          title,
          url: `http://localhost:${terminal.port}`,
          isServices,
          isBigBrother
        };

        restoredTabs.push(newTab);

        if (isBigBrother) bigBrotherTabId = newTab.id;
        if (isServices) servicesTabId = newTab.id;
        if (!isBigBrother && !isServices) regularTerminalCount++;

        console.log(`[TerminalManager] Discovered orphaned terminal on port ${terminal.port}`);
      }
    }

    if (restoredTabs.length > 0) {
      // Sort by port for consistent ordering
      restoredTabs.sort((a, b) => a.port - b.port);
      tabs = restoredTabs;

      // Restore active tab if still valid
      if (savedActiveTabId && restoredTabs.some(t => t.id === savedActiveTabId)) {
        activeTabId = savedActiveTabId;
      } else {
        activeTabId = restoredTabs[0].id;
      }

      console.log(`[TerminalManager] Restored ${restoredTabs.length} terminal sessions`);
      updatePersistedState();
    }

    return restoredTabs.length;
  }

  async function openBigBrotherTerminal(port: number, url: string) {
    // Check if Big Brother tab already exists
    const existingTab = tabs.find(t => t.isBigBrother);
    if (existingTab) {
      activeTabId = existingTab.id;
      bigBrotherTerminalOpened();
      return;
    }

    // Create new Big Brother tab
    const newTab: TerminalTab = {
      id: crypto.randomUUID(),
      port,
      title: '🤖 Big Brother',
      url,
      isBigBrother: true
    };

    tabs = [...tabs, newTab];
    activeTabId = newTab.id;
    bigBrotherTabId = newTab.id;
    bigBrotherTerminalOpened();

    console.log('[TerminalManager] Opened Big Brother terminal on port', port);
    updatePersistedState();
  }

  async function createServicesTerminal() {
    if (servicesTabId && tabs.find(t => t.id === servicesTabId)) return; // Already created

    try {
      // Spawn a terminal that runs the services startup script
      const response = await apiFetch('/api/terminal/spawn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: './bin/start-services'
        })
      });

      if (!response.ok) {
        console.error('[TerminalManager] Failed to spawn services terminal');
        return;
      }

      const data = await response.json();

      const newTab: TerminalTab = {
        id: crypto.randomUUID(),
        port: data.port,
        title: '⚡ Services',
        url: data.url,
        isServices: true
      };

      tabs = [...tabs, newTab];
      activeTabId = newTab.id;
      servicesTabId = newTab.id;

      console.log('[TerminalManager] Started services terminal on port', data.port);
      updatePersistedState();
    } catch (error) {
      console.error('[TerminalManager] Error creating services terminal:', error);
    }
  }

  onMount(async () => {
    // Discover and restore all running terminals (including orphaned ones)
    const restoredCount = await discoverAndRestoreTerminals();

    // If no terminals were found, create default ones
    if (restoredCount === 0) {
      // First, spawn the Services terminal that runs all backend processes
      await createServicesTerminal();

      // Then spawn a regular bash terminal for user commands
      await createNewTerminal();
    }

    // Check if Big Brother session is active and create tab if needed
    try {
      const res = await apiFetch('/api/claude-session');
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.status?.ready && !bigBrotherTabId) {
          console.log('[TerminalManager] Big Brother session is active, opening terminal tab');
          openBigBrotherTerminal(3099, 'http://localhost:3099');
        }
      }
    } catch (error) {
      console.warn('[TerminalManager] Could not check Claude session status:', error);
    }
  });

  onDestroy(async () => {
    // Don't kill terminals on destroy - let them persist for reconnection
    // Only clean up the store subscription
    unsubscribe();
    
    // Save current tab state for restoration
    if (typeof localStorage !== 'undefined') {
      try {
        const persistentTabs = tabs.map(tab => ({
          id: tab.id,
          port: tab.port,
          title: tab.title,
          url: tab.url,
          isBigBrother: tab.isBigBrother,
          isServices: tab.isServices
        }));
        localStorage.setItem('mh_terminal_tabs', JSON.stringify(persistentTabs));
        if (activeTabId) {
          localStorage.setItem('mh_active_terminal_tab', activeTabId);
        }
      } catch (error) {
        console.warn('[TerminalManager] Failed to save tab state:', error);
      }
    }
  });

  async function createNewTerminal() {
    if (isCreating) return;

    isCreating = true;

    try {
      const response = await apiFetch('/api/terminal/spawn', {
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

      const terminalNumber = tabs.filter(t => !t.isBigBrother && !t.isServices).length + 1;
      const newTab: TerminalTab = {
        id: crypto.randomUUID(),
        port: data.port,
        title: `💻 Terminal ${terminalNumber}`,
        url: data.url
      };

      tabs = [...tabs, newTab];
      activeTabId = newTab.id;
      updatePersistedState();

    } catch (error) {
      console.error('[TerminalManager] Error creating terminal:', error);
      alert('Failed to create terminal');
    } finally {
      isCreating = false;
    }
  }

  async function closeTerminal(tab: TerminalTab) {
    // If closing Big Brother tab, clear the ID
    if (tab.isBigBrother) {
      bigBrotherTabId = null;
    }
    // If closing Services tab, clear the ID
    if (tab.isServices) {
      servicesTabId = null;
    }

    if (tabs.length === 1) {
      // Don't close the last terminal, just create a new one first
      await createNewTerminal();
    }

    // Kill the terminal process (Big Brother has its own lifecycle)
    if (!tab.isBigBrother) {
      await killTerminal(tab.port);
    }

    // Remove tab
    const tabIndex = tabs.findIndex(t => t.id === tab.id);
    tabs = tabs.filter(t => t.id !== tab.id);

    // Switch to another tab
    if (activeTabId === tab.id) {
      const newIndex = Math.max(0, tabIndex - 1);
      activeTabId = tabs[newIndex]?.id || null;
    }

    // Update localStorage to reflect the current state
    updatePersistedState();
  }

  async function killTerminal(port: number) {
    try {
      await apiFetch(`/api/terminal/kill/${port}`, {
        method: 'POST'
      });
    } catch (error) {
      console.error(`[TerminalManager] Error killing terminal on port ${port}:`, error);
    }
  }

  function switchTab(tabId: string) {
    activeTabId = tabId;
    updatePersistedState();
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

  function updatePersistedState() {
    if (typeof localStorage !== 'undefined') {
      try {
        const persistentTabs = tabs.map(tab => ({
          id: tab.id,
          port: tab.port,
          title: tab.title,
          url: tab.url,
          isBigBrother: tab.isBigBrother,
          isServices: tab.isServices
        }));
        localStorage.setItem('mh_terminal_tabs', JSON.stringify(persistentTabs));
        if (activeTabId) {
          localStorage.setItem('mh_active_terminal_tab', activeTabId);
        }
      } catch (error) {
        console.warn('[TerminalManager] Failed to update persisted state:', error);
      }
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
