<script lang="ts">
  import { onMount, onDestroy, setContext } from 'svelte';
  import { writable } from 'svelte/store';
  import { statusStore, statusRefreshTrigger, nodeEditorMode } from '../stores/navigation';
  import { startPolicyPolling, fetchSecurityPolicy, policyStore, isReadOnly } from '../stores/security-policy';
  import UserMenu from './UserMenu.svelte';
  import HeadlessClaimBanner from './HeadlessClaimBanner.svelte';
  import NodeEditorLayout from './NodeEditorLayout.svelte';

  // Sidebar visibility state - mobile-first defaults
  let leftSidebarOpen = false;
  let rightSidebarOpen = false;
  let isMobile = true;

  // Create a store for leftSidebarOpen and expose it via context
  const leftSidebarStore = writable(false);
  setContext('leftSidebarOpen', leftSidebarStore);

  // Sync store with local variable
  $: leftSidebarStore.set(leftSidebarOpen);

  interface ModeDefinition {
    id: 'dual' | 'agent' | 'emulation';
    label: string;
    description: string;
    guidance: string[];
  }

  let cognitiveMode: ModeDefinition | null = null;
  let cognitiveModes: ModeDefinition[] = [];
  let modeMenuOpen = false;
  let modeLoading = false;
  let modeError = '';
  let modeMenuAnchor: HTMLDivElement | null = null;

  // System status and allowed modes
  let systemStatus: any = null;
  let allowedModes: string[] = [];
  let disabledModes: string[] = [];

  // User authentication state
  interface User {
    id: string;
    username: string;
    role: 'owner' | 'guest' | 'anonymous';
  }
  let currentUser: User | null = null;
  let userMenuOpen = false;
  let userMenuAnchor: HTMLElement | null = null;

  // Persona name and icon state
  let personaName = 'MetaHuman OS';
  let personaIcon: string | null = null;
  let personaIconError = false;
  let personaLoading = true;

  type ModeVisual = {
    icon: string;
    color: string;
    glow: string;
  };

  const defaultVisual: ModeVisual = {
    icon: '💭',
    color: '#7c3aed',
    glow: 'rgba(124, 58, 237, 0.55)',
  };

  function getModeVisual(mode: ModeDefinition | null): ModeVisual {
    if (!mode) return defaultVisual;
    switch (mode.id) {
      case 'dual':
        return {
          icon: '💭',
          color: '#a855f7',
          glow: 'rgba(168, 85, 247, 0.65)',
        };
      case 'agent':
        return {
          icon: '🛠️',
          color: '#38bdf8',
          glow: 'rgba(56, 189, 248, 0.6)',
        };
      case 'emulation':
        return {
          icon: '🪄',
          color: '#fbbf24',
          glow: 'rgba(251, 191, 36, 0.55)',
        };
      default:
        return defaultVisual;
    }
  }

  $: modeVisual = getModeVisual(cognitiveMode);

  // Detect screen size
  function updateScreenSize() {
    if (typeof window !== 'undefined') {
      isMobile = window.innerWidth < 768;
    }
  }

  async function loadPersonaName(bustCache = false) {
    try {
      // Add timestamp to bust server-side cache when explicitly requested
      const cacheBust = bustCache ? `?_t=${Date.now()}` : '';
      const res = await fetch(`/api/status${cacheBust}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Failed to load persona (status ${res.status})`);
      const data = await res.json();
      statusStore.set(data);  // Store the response for other components to use
      if (data?.identity?.name) {
        personaName = data.identity.name;
      }
      if (data?.identity?.icon) {
        personaIcon = data.identity.icon;
      }
    } catch (error) {
      console.warn('Failed to load persona name:', error);
      // Keep default "MetaHuman OS"
    } finally {
      personaLoading = false;
    }
  }

  async function loadCognitiveModeState() {
    modeLoading = true;
    try {
      const res = await fetch('/api/cognitive-mode', { cache: 'no-store' });
      if (!res.ok) throw new Error(`Failed to load cognitive mode (status ${res.status})`);
      const data = await res.json();
      cognitiveModes = Array.isArray(data?.modes) ? data.modes : [];
      const current = cognitiveModes.find(mode => mode.id === data?.mode);
      cognitiveMode = current ?? null;
      modeError = '';
    } catch (error) {
      modeError = (error as Error).message;
    } finally {
      modeLoading = false;
    }
  }

  async function changeCognitiveMode(nextMode: ModeDefinition['id']) {
    if (modeLoading) return;
    modeLoading = true;
    try {
      const res = await fetch('/api/cognitive-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: nextMode, actor: 'web_ui' }),
      });

      if (!res.ok) {
        // Handle specific error cases with user-friendly messages
        if (res.status === 403) {
          const data = await res.json().catch(() => ({}));
          throw new Error('Please log in to change cognitive modes. Only authenticated users can switch between modes.');
        }
        throw new Error(`Failed to update cognitive mode (status ${res.status})`);
      }

      await loadCognitiveModeState();

      // Refresh security policy to update UI controls (operator/yolo toggles, etc.)
      await fetchSecurityPolicy();

      // Trigger status refresh (trust level may have auto-adjusted if coupled)
      statusRefreshTrigger.update(n => n + 1);

      modeMenuOpen = false;
    } catch (error) {
      modeError = (error as Error).message;
    } finally {
      modeLoading = false;
    }
  }

  async function fetchSystemStatus() {
    try {
      const res = await fetch('/api/system-status');
      const data = await res.json();

      if (data.success) {
        systemStatus = data;
        allowedModes = data.allowedModes || [];
        disabledModes = data.disabledModes || [];
      }
    } catch (error) {
      console.error('[ChatLayout] Failed to fetch system status:', error);
    }
  }

  async function fetchCurrentUser() {
    try {
      const response = await fetch('/api/auth/me');
      const data = await response.json();

      if (data.success && data.user) {
        currentUser = data.user;
      } else {
        currentUser = null;
      }
    } catch (err) {
      console.error('[ChatLayout] Failed to fetch user:', err);
      currentUser = null;
    }
  }

  async function handleLogout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.href = '/';
    } catch (err) {
      console.error('[ChatLayout] Logout failed:', err);
    }
  }

  function toggleUserMenu() {
    userMenuOpen = !userMenuOpen;
  }

  const handleGlobalClick = (event: MouseEvent) => {
    // Close mode menu if clicked outside
    if (modeMenuOpen && modeMenuAnchor && !modeMenuAnchor.contains(event.target as Node)) {
      modeMenuOpen = false;
    }

    // Close user menu if clicked outside
    if (userMenuOpen && userMenuAnchor && !userMenuAnchor.contains(event.target as Node)) {
      userMenuOpen = false;
    }
  };

  // Load sidebar preferences from localStorage and ensure core agents are running
  onMount(() => {
    updateScreenSize();

    // On desktop, default to open; on mobile, default to closed
    const defaultLeft = !isMobile;
    const defaultRight = !isMobile;

    const savedLeft = localStorage.getItem('leftSidebarOpen');
    const savedRight = localStorage.getItem('rightSidebarOpen');

    leftSidebarOpen = savedLeft !== null ? savedLeft === 'true' : defaultLeft;
    rightSidebarOpen = savedRight !== null ? savedRight === 'true' : defaultRight;

    // Listen for window resize
    window.addEventListener('resize', updateScreenSize);

    // Dynamic viewport height for mobile (fix 100vh issues on iOS/Android)
    const setVH = () => {
      try {
        const vh = window.innerHeight;
        document.documentElement.style.setProperty('--app-vh', `${vh}px`);
      } catch {}
    };
    setVH();
    window.addEventListener('resize', setVH);
    window.addEventListener('orientationchange', setVH);

    // Fire-and-forget: ask server to boot core agents (idempotent)
    // Always attempt to boot boredom-service on UI load; endpoint is idempotent
    fetch('/api/boot', { method: 'GET', cache: 'no-store', keepalive: true }).catch(() => {});

    // Fire-and-forget: warm up models in background to avoid first-message latency
    // This pre-loads orchestrator and persona models into Ollama's memory
    fetch('/api/warmup', { method: 'GET', cache: 'no-store', keepalive: true }).catch(() => {});

    void loadPersonaName();
    void loadCognitiveModeState();
    void fetchSystemStatus();
    void fetchCurrentUser();
    document.addEventListener('click', handleGlobalClick, true);

    // Refresh persona name every 30 seconds (in case persona file changes)
    const personaInterval = setInterval(loadPersonaName, 30000);

    // Start security policy polling (refreshes every 30s)
    const stopPolicyPolling = startPolicyPolling(30000);

    return () => {
      window.removeEventListener('resize', updateScreenSize);
      window.removeEventListener('resize', setVH);
      window.removeEventListener('orientationchange', setVH);
      document.removeEventListener('click', handleGlobalClick, true);
      clearInterval(personaInterval);
      stopPolicyPolling();
    };
  });

  onDestroy(() => {
    if (typeof document !== 'undefined') {
      document.removeEventListener('click', handleGlobalClick, true);
    }
  });

  // Watch for refresh trigger changes - bust cache on manual refresh
  $: if ($statusRefreshTrigger > 0) {
    void loadPersonaName(true);  // Always bust cache on manual refresh
    void loadCognitiveModeState();
  }

  // Toggle functions with persistence
  function toggleLeftSidebar() {
    leftSidebarOpen = !leftSidebarOpen;
    localStorage.setItem('leftSidebarOpen', String(leftSidebarOpen));
  }

  function toggleRightSidebar() {
    rightSidebarOpen = !rightSidebarOpen;
    localStorage.setItem('rightSidebarOpen', String(rightSidebarOpen));
  }
</script>

{#if $nodeEditorMode}
  <NodeEditorLayout cognitiveMode={cognitiveMode?.id} />
{:else}
<div class="flex flex-col app-root w-screen overflow-hidden bg-white dark:bg-slate-950">
  <!-- Header Bar -->
  <header class="flex justify-between items-center px-4 py-3 border-b border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-slate-950/80 backdrop-blur-xl z-10 flex-shrink-0">
    <div class="flex items-center gap-3">
      <button
        on:click={toggleLeftSidebar}
        class="flex items-center justify-center p-2 border-0 bg-transparent text-gray-500 dark:text-gray-400 cursor-pointer rounded-md transition-all hover:bg-gray-100 dark:hover:bg-white/10 hover:text-gray-900 dark:hover:text-gray-100"
        aria-label="Toggle left sidebar"
      >
        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/>
        </svg>
      </button>
      <div class="relative" bind:this={userMenuAnchor}>
        <button
          on:click={toggleUserMenu}
          class="flex items-center gap-2 sm:gap-3 text-lg font-semibold text-gray-900 dark:text-gray-100 m-0 border-0 bg-transparent cursor-pointer p-2 rounded-md transition-all hover:bg-gray-100 dark:hover:bg-white/10"
          aria-label="User menu"
        >
          {#if personaIcon && !personaIconError}
            <img
              src="/api/persona-icon"
              alt="Persona icon"
              class="persona-icon"
              on:error={() => { personaIconError = true; }}
            />
          {:else}
            <span class="persona-icon-fallback">🤖</span>
          {/if}
          <span class="brand-name hidden sm:inline">{personaName}</span>
          {#if currentUser}
            <span class="text-xs text-gray-500 dark:text-gray-400 font-normal">
              <span class="hidden sm:inline">(</span>{currentUser.username}<span class="hidden sm:inline">)</span>
            </span>
          {/if}
        </button>

        {#if userMenuOpen}
          <div class="absolute left-0 mt-2 w-64 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg z-50">
            {#if currentUser}
              <div class="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                <div class="flex items-center gap-3">
                  <div class="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white font-semibold">
                    {currentUser.username.charAt(0).toUpperCase()}
                  </div>
                  <div class="flex-1">
                    <div class="font-semibold text-gray-900 dark:text-gray-100">
                      {currentUser.username}
                    </div>
                  </div>
                </div>
              </div>

              <button
                on:click={handleLogout}
                class="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors border-0 bg-transparent cursor-pointer text-left"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/>
                </svg>
                Logout
              </button>
            {:else}
              <a
                href="/"
                class="block px-4 py-3 text-sm text-center text-white bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 transition-all font-semibold no-underline"
              >
                Login
              </a>
            {/if}
          </div>
        {/if}
      </div>
    </div>

    <div class="flex items-center gap-2 sm:gap-3">
      <div class="relative" bind:this={modeMenuAnchor}>
        <button
          class={`mode-menu-trigger ${modeMenuOpen ? 'active' : ''}`}
          style={`--mode-accent:${modeVisual.color}; --mode-glow:${modeVisual.glow}`}
          on:click={() => { modeMenuOpen = !modeMenuOpen; }}
          aria-haspopup="listbox"
          aria-expanded={modeMenuOpen}
          title={cognitiveMode?.label ?? 'Mode'}
        >
          <span class="mode-dot" style={`background:${modeVisual.color}`}></span>
          <span class="mode-text hidden sm:inline">{modeLoading ? 'Loading…' : cognitiveMode?.label ?? 'Mode unavailable'}</span>
          <svg class="w-4 h-4 text-gray-400 hidden sm:block" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
          </svg>
        </button>
        {#if modeMenuOpen}
          <div class="absolute right-0 mt-2 w-72 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg z-40">
            <div class="py-2">
              {#if cognitiveModes.length === 0}
                <div class="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
                  {modeLoading ? 'Loading modes…' : 'No modes available'}
                </div>
              {:else}
                {#each cognitiveModes as mode (mode.id)}
                  {@const isDisabled = allowedModes.length > 0 && !allowedModes.includes(mode.id)}
                  {@const disabledReason = isDisabled ?
                    (systemStatus?.status === 'high_security' ? 'High security mode: Only emulation allowed' :
                     systemStatus?.status === 'wetware_deceased' && mode.id === 'dual' ? 'Wetware deceased: Dual consciousness unavailable' :
                     'This mode is disabled') : null}

                  <button
                    class="w-full text-left px-3 py-2 text-sm transition
                           {cognitiveMode?.id === mode.id ? 'bg-brand/5 border-l-4 border-brand pl-2' : ''}
                           {isDisabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-brand/10 dark:hover:bg-brand/20'}"
                    on:click={() => !isDisabled && changeCognitiveMode(mode.id)}
                    disabled={modeLoading || isDisabled}
                    title={disabledReason || ''}
                  >
                    <div class="flex items-center gap-2">
                      <span class="h-2 w-2 rounded-full {mode.id === 'dual' ? 'bg-purple-500' : mode.id === 'agent' ? 'bg-blue-500' : 'bg-amber-500'}"></span>
                      <span class="font-medium">{mode.label}</span>
                      {#if isDisabled}
                        <svg class="w-3 h-3 text-gray-400 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
                        </svg>
                      {/if}
                    </div>
                    <p class="mt-1 text-xs text-gray-500 dark:text-gray-400 leading-snug">
                      {mode.description}
                      {#if isDisabled}
                        <br><span class="text-amber-600 dark:text-amber-400">{disabledReason}</span>
                      {/if}
                    </p>
                  </button>
                {/each}
              {/if}
            </div>
          </div>
        {/if}
      </div>
      <button
        on:click={() => nodeEditorMode.update(v => !v)}
        class={`flex items-center justify-center p-2 border-0 bg-transparent cursor-pointer rounded-md transition-all
                ${$nodeEditorMode ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10'}`}
        aria-label="Toggle node editor"
        title={$nodeEditorMode ? 'Switch to Traditional View' : 'Switch to Node Editor View'}
      >
        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"/>
        </svg>
      </button>
      <button
        on:click={toggleRightSidebar}
        class="flex items-center justify-center p-2 border-0 bg-transparent text-purple-600 dark:text-purple-400 cursor-pointer rounded-md transition-all hover:bg-gray-100 dark:hover:bg-white/10"
        aria-label="Toggle developer tools"
        title="Developer Tools"
      >
        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/>
        </svg>
      </button>
      <slot name="header-actions" />
    </div>
  </header>

  <!-- Headless Mode Claim Banner -->
  <HeadlessClaimBanner />

  {#if modeError}
    <div class="px-4 py-2 text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40 border-b border-red-200 dark:border-red-900/60">
      Cognitive mode error: {modeError}
    </div>
  {/if}

  {#if systemStatus?.status === 'high_security'}
    <div class="px-4 py-2 text-sm text-red-800 dark:text-red-200 bg-red-50 dark:bg-red-950/40 border-b border-red-200 dark:border-red-900/60 flex items-center gap-2">
      <svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
      </svg>
      <span>
        <strong>High Security Mode Active:</strong> Only emulation mode is allowed. All write operations are disabled.
      </span>
    </div>
  {:else if systemStatus?.status === 'wetware_deceased'}
    <div class="px-4 py-2 text-sm text-indigo-800 dark:text-indigo-200 bg-indigo-50 dark:bg-indigo-950/40 border-b border-indigo-200 dark:border-indigo-900/60 flex items-center gap-2">
      <svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
      </svg>
      <span>
        <strong>Wetware Deceased:</strong> Operating as independent digital consciousness. Dual consciousness mode unavailable.
      </span>
    </div>
  {/if}

  <!-- Main Content Area -->
  <div class="flex flex-1 overflow-hidden relative">
    <!-- Left Sidebar -->
    <aside
      class="flex flex-col border-r border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 overflow-hidden transition-all duration-300 ease-in-out {leftSidebarOpen ? 'w-[280px]' : 'w-0 border-0'} max-md:fixed max-md:left-0 max-md:top-[57px] max-md:bottom-0 max-md:z-30 max-md:shadow-lg"
    >
      <div class="flex flex-col w-[280px] h-full overflow-y-auto overflow-x-hidden">
        <slot name="left-sidebar" />
      </div>
    </aside>

    <!-- Backdrop for mobile -->
    {#if leftSidebarOpen && isMobile}
      <div
        class="fixed inset-0 bg-black/50 z-20"
        on:click={toggleLeftSidebar}
        on:keydown={(e) => e.key === 'Escape' && toggleLeftSidebar()}
        role="button"
        tabindex="0"
        aria-label="Close sidebar"
      />
    {/if}

    <!-- Center Chat Area -->
    <main class="flex flex-col flex-1 overflow-hidden bg-white dark:bg-slate-950 relative">
      <slot name="center" />
    </main>

    <!-- Right Sidebar (Developer Tools) -->
    <aside
      class="flex flex-col border-l border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 overflow-hidden transition-all duration-300 ease-in-out {rightSidebarOpen ? 'w-[280px]' : 'w-0 border-0'} max-md:fixed max-md:right-0 max-md:top-[57px] max-md:bottom-0 max-md:z-30 max-md:shadow-lg"
    >
      <div class="flex flex-col w-[280px] h-full overflow-y-auto overflow-x-hidden">
        <slot name="right-sidebar" />
      </div>
    </aside>

    <!-- Backdrop for mobile (right sidebar) -->
    {#if rightSidebarOpen && isMobile}
      <div
        class="fixed inset-0 bg-black/50 z-20"
        on:click={toggleRightSidebar}
        on:keydown={(e) => e.key === 'Escape' && toggleRightSidebar()}
        role="button"
        tabindex="0"
        aria-label="Close sidebar"
      />
    {/if}
  </div>
</div>
{/if}

<style>
  /* App root dynamic viewport height */
  .app-root {
    height: 100vh;
    min-height: 100vh;
  }

  @supports (height: 100dvh) {
    .app-root {
      height: 100dvh;
      min-height: 100dvh;
    }
  }

  .app-root {
    height: var(--app-vh, 100vh);
    min-height: var(--app-vh, 100vh);
  }

  /* Sidebar scrollbars - custom pseudo-elements that can't be done with Tailwind */
  aside > div::-webkit-scrollbar {
    width: 6px;
  }
  aside > div::-webkit-scrollbar-track {
    background: transparent;
  }
  aside > div::-webkit-scrollbar-thumb {
    background: rgba(0, 0, 0, 0.2);
    border-radius: 3px;
  }
  :global(.dark) aside > div::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.2);
  }
  aside > div::-webkit-scrollbar-thumb:hover {
    background: rgba(0, 0, 0, 0.3);
  }
  :global(.dark) aside > div::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.3);
  }
</style>
