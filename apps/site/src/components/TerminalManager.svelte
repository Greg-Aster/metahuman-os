<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { bigBrotherTerminal, bigBrotherTerminalOpened } from '../stores/bigBrotherTerminal';
  import { apiFetch } from '../lib/client/api-config';
  import { connectionPool, ConnectionPriority, type ConnectionHandle } from '../lib/client/connection-pool';
  import { get } from 'svelte/store';
  import { isOwner } from '../stores/security-policy';
  import DebugDashboard from './DebugDashboard.svelte';

  interface TerminalTab {
    id: string;
    port: number;
    title: string;
    url: string;
    isBigBrother?: boolean;
    isServices?: boolean;
    isEventBus?: boolean;
  }

  let tabs: TerminalTab[] = [];
  let activeTabId: string | null = null;
  let isCreating = false;
  let bigBrotherTabId: string | null = null;
  let servicesTabId: string | null = null;
  let eventBusTabId: string | null = null;
  let terminalEventsHandle: ConnectionHandle | null = null;
  let terminalAccessError = '';

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
    isBigBrother?: boolean;
  }

  async function fetchRunningTerminals(): Promise<RunningTerminal[] | null> {
    try {
      const response = await apiFetch('/api/terminal/list');
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        terminalAccessError = response.status === 403
          ? 'Terminal access is limited to the system owner. Your account is still signed in and can use the rest of the portal.'
          : data.error || 'Terminal service is unavailable.';
        return null;
      }

      terminalAccessError = '';
      const data = await response.json();
      return data.terminals || [];
    } catch (error) {
      console.warn('[TerminalManager] Failed to fetch running terminals:', error);
      terminalAccessError = 'Terminal service is unavailable.';
      return null;
    }
  }

  function inferTerminalTitle(terminal: RunningTerminal, index: number): { title: string; isServices: boolean; isBigBrother: boolean } {
    const command = terminal.command || '';

    // Check if explicitly marked as Big Brother
    if (terminal.isBigBrother) {
      return { title: '🤖 Big Brother', isServices: false, isBigBrother: true };
    }

    // Detect services terminal
    if (command.includes('start-services') || command.includes('run-with-agents')) {
      return { title: '⚡ Services', isServices: true, isBigBrother: false };
    }

    // Detect Big Brother terminal by port or command
    if (terminal.port === 3099 || command.includes('claude')) {
      return { title: '🤖 Big Brother', isServices: false, isBigBrother: true };
    }

    // Regular terminal
    return { title: `💻 Terminal ${index + 1}`, isServices: false, isBigBrother: false };
  }

  async function discoverAndRestoreTerminals(): Promise<number | null> {
    // Fetch actually running terminals from the server
    const runningTerminals = await fetchRunningTerminals();
    if (runningTerminals === null) return null;

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

    // First restore Event Bus tab from saved state (it doesn't have a running process)
    const savedEventBusTab = savedTabs.find(t => t.isEventBus);
    if (savedEventBusTab) {
      restoredTabs.push(savedEventBusTab);
      eventBusTabId = savedEventBusTab.id;
    }

    for (const terminal of runningTerminals) {
      const savedTab = savedTabsByPort.get(terminal.port);

      if (savedTab) {
        // Skip Event Bus tabs - they're handled above
        if (savedTab.isEventBus) continue;

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

  function createEventBusTab() {
    if (eventBusTabId && tabs.find(t => t.id === eventBusTabId)) return; // Already created

    const newTab: TerminalTab = {
      id: crypto.randomUUID(),
      port: 3100, // Event bus port
      title: '📊 Event Bus',
      url: '', // Not used for Event Bus
      isEventBus: true
    };

    tabs = [...tabs, newTab];
    eventBusTabId = newTab.id;

    console.log('[TerminalManager] Created Event Bus tab');
    updatePersistedState();
  }

  onMount(async () => {
    if (!get(isOwner)) {
      terminalAccessError = 'Terminal access is limited to the system owner. Your account is still signed in and can use the rest of the portal.';
      return;
    }

    // Discover and restore all running terminals (including orphaned ones)
    const restoredCount = await discoverAndRestoreTerminals();
    if (restoredCount === null) return;

    // If no terminals were found, create default ones
    if (restoredCount === 0) {
      // First, spawn the Services terminal that runs all backend processes
      await createServicesTerminal();

      // Then spawn a regular bash terminal for user commands
      await createNewTerminal();
    }

    // Event Bus tab is only created when:
    // 1. Restored from localStorage (handled in discoverAndRestoreTerminals)
    // 2. User explicitly requests it (add a menu item or button for this)

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

    // Subscribe to Big Brother terminal events without consuming a connection
    // outside the shared pool used by the rest of the chat shell.
    try {
      terminalEventsHandle = connectionPool.request({
        id: 'terminal-events-stream',
        name: 'Terminal Events Stream',
        url: '/api/big-brother/terminal-events',
        priority: ConnectionPriority.LOW,
        viewDependency: 'chat',
        defer: true,
        onMessage: (event) => {
          try {
            const data = JSON.parse(event.data);

            if (data.type === 'open_tab' || data.type === 'terminal_ready') {
              console.log('[TerminalManager] Big Brother terminal event:', data.type);

              // Auto-open Big Brother tab if not already open
              if (!bigBrotherTabId) {
                openBigBrotherTerminal(data.port || 3099, data.url || 'http://localhost:3099');
              } else {
                // Switch to Big Brother tab
                activeTabId = bigBrotherTabId;
                updatePersistedState();
              }
            }
          } catch (e) {
            console.warn('[TerminalManager] Failed to parse terminal event:', e);
          }
        },
        onError: () => {
          console.warn('[TerminalManager] Terminal events SSE connection error');
        },
      });
    } catch (error) {
      console.warn('[TerminalManager] Could not connect to terminal events:', error);
    }
  });

  onDestroy(async () => {
    // Don't kill terminals on destroy - let them persist for reconnection
    // Only clean up subscriptions
    unsubscribe();

    // Close SSE connection
    terminalEventsHandle?.close();
    terminalEventsHandle = null;
    
    // Save current tab state for restoration
    if (typeof localStorage !== 'undefined') {
      try {
        const persistentTabs = tabs.map(tab => ({
          id: tab.id,
          port: tab.port,
          title: tab.title,
          url: tab.url,
          isBigBrother: tab.isBigBrother,
          isServices: tab.isServices,
          isEventBus: tab.isEventBus
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
    // If closing Event Bus tab, clear the ID
    if (tab.isEventBus) {
      eventBusTabId = null;
    }

    if (tabs.length === 1) {
      // Don't close the last terminal, just create a new one first
      await createNewTerminal();
    }

    // Kill the terminal process (Big Brother and Event Bus have their own lifecycle)
    if (!tab.isBigBrother && !tab.isEventBus) {
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
          isServices: tab.isServices,
          isEventBus: tab.isEventBus
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

<div class="flex flex-col h-full w-full bg-black">
  {#if terminalAccessError}
    <div class="flex h-full items-center justify-center p-6 text-center" role="status">
      <div class="max-w-md rounded-lg border border-amber-700/60 bg-amber-950/30 p-5 text-amber-200">
        <div class="mb-2 text-sm font-semibold">Terminal unavailable</div>
        <p class="m-0 text-xs leading-relaxed">{terminalAccessError}</p>
      </div>
    </div>
  {:else}
  <!-- Tab Bar -->
  <div class="flex items-center bg-[#0a0a0a] border-b border-gray-800 px-1 gap-1 min-h-[24px] flex-shrink-0">
    <div class="tabs-list flex gap-0.5 flex-1 overflow-x-auto">
      {#each tabs as tab}
        <div
          class="terminal-tab flex items-center gap-1 py-0.5 px-1.5 bg-[#1a1a1a] cursor-pointer whitespace-nowrap transition-colors min-w-[60px] max-w-[120px] rounded-sm hover:bg-[#252525] focus-visible:outline focus-visible:outline-1 focus-visible:outline-blue-500 focus-visible:-outline-offset-1"
          class:active={tab.id === activeTabId}
          role="tab"
          tabindex={tab.id === activeTabId ? 0 : -1}
          aria-selected={tab.id === activeTabId}
          on:click={() => switchTab(tab.id)}
          on:keydown={(e) => handleTabKeydown(e, tab.id)}
        >
          <span class="flex-1 overflow-hidden text-ellipsis text-gray-500 text-[0.7rem] font-mono" class:text-gray-400={tab.id === activeTabId}>{tab.title}</span>
          <button
            class="tab-close flex items-center justify-center w-3 h-3 border-0 bg-transparent text-gray-600 cursor-pointer text-sm leading-none p-0 transition-all rounded-sm hover:bg-red-500 hover:text-white focus-visible:outline focus-visible:outline-1 focus-visible:outline-blue-500 focus-visible:-outline-offset-1"
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
      class="flex items-center gap-1 py-0.5 px-1.5 bg-[#1a1a1a] text-gray-500 border-0 rounded-sm cursor-pointer text-[0.7rem] font-mono transition-all whitespace-nowrap hover:bg-[#252525] hover:text-gray-400 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-1 focus-visible:outline-blue-500 focus-visible:outline-offset-1"
      on:click={createNewTerminal}
      disabled={isCreating || tabs.length >= 10}
      aria-label="New terminal tab"
    >
      <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="8" y1="4" x2="8" y2="12"/>
        <line x1="4" y1="8" x2="12" y2="8"/>
      </svg>
      <span class="font-normal">New</span>
    </button>
  </div>

  <!-- Terminal Iframes / Event Bus -->
  <div class="flex-1 relative overflow-hidden">
    {#each tabs as tab (tab.id)}
      <div class="terminal-pane absolute inset-0 hidden" class:active={tab.id === activeTabId}>
        {#if tab.id === activeTabId}
          {#if tab.isEventBus}
            <DebugDashboard />
          {:else}
            <iframe
              src={tab.url}
              title={tab.title}
              class="w-full h-full border-0 bg-black"
            ></iframe>
          {/if}
        {/if}
      </div>
    {/each}
  </div>
  {/if}
</div>

<style>
  /* Tabs list scrollbar styling */
  .tabs-list {
    scrollbar-width: thin;
    scrollbar-color: #333 transparent;
  }
  .tabs-list::-webkit-scrollbar { height: 2px; }
  .tabs-list::-webkit-scrollbar-track { background: transparent; }
  .tabs-list::-webkit-scrollbar-thumb { background: #333; border-radius: 1px; }

  /* Active terminal tab state */
  .terminal-tab.active {
    @apply bg-[#2a2a2a];
  }

  /* Terminal pane visibility */
  .terminal-pane.active {
    @apply block;
  }
</style>
