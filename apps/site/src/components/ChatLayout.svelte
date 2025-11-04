<script lang="ts">
  import { onMount, onDestroy, setContext } from 'svelte';
  import { writable } from 'svelte/store';

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

  type ModeVisual = {
    icon: string;
    color: string;
    glow: string;
  };

  const defaultVisual: ModeVisual = {
    icon: '🧠',
    color: '#7c3aed',
    glow: 'rgba(124, 58, 237, 0.55)',
  };

  function getModeVisual(mode: ModeDefinition | null): ModeVisual {
    if (!mode) return defaultVisual;
    switch (mode.id) {
      case 'dual':
        return {
          icon: '🧠',
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
      if (!res.ok) throw new Error(`Failed to update cognitive mode (status ${res.status})`);
      await loadCognitiveModeState();
      modeMenuOpen = false;
    } catch (error) {
      modeError = (error as Error).message;
    } finally {
      modeLoading = false;
    }
  }

  const handleGlobalClick = (event: MouseEvent) => {
    if (!modeMenuOpen) return;
    if (!modeMenuAnchor) return;
    if (modeMenuAnchor.contains(event.target as Node)) return;
    modeMenuOpen = false;
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

    void loadCognitiveModeState();
    document.addEventListener('click', handleGlobalClick, true);

    return () => {
      window.removeEventListener('resize', updateScreenSize);
      window.removeEventListener('resize', setVH);
      window.removeEventListener('orientationchange', setVH);
      document.removeEventListener('click', handleGlobalClick, true);
    };
  });

  onDestroy(() => {
    if (typeof document !== 'undefined') {
      document.removeEventListener('click', handleGlobalClick, true);
    }
  });

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
      <h1 class="flex items-center gap-3 text-lg font-semibold text-gray-900 dark:text-gray-100 m-0">
        <span class="brand-name">MetaHuman OS</span>
      </h1>
    </div>

    <div class="flex items-center gap-3">
      <div class="relative" bind:this={modeMenuAnchor}>
        <button
          class={`mode-menu-trigger ${modeMenuOpen ? 'active' : ''}`}
          style={`--mode-accent:${modeVisual.color}; --mode-glow:${modeVisual.glow}`}
          on:click={() => { modeMenuOpen = !modeMenuOpen; }}
          aria-haspopup="listbox"
          aria-expanded={modeMenuOpen}
        >
          <span class="mode-dot" style={`background:${modeVisual.color}`}></span>
          <span class="mode-text">{modeLoading ? 'Loading…' : cognitiveMode?.label ?? 'Mode unavailable'}</span>
          <svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                  <button
                    class="w-full text-left px-3 py-2 text-sm hover:bg-brand/10 dark:hover:bg-brand/20 transition {cognitiveMode?.id === mode.id ? 'bg-brand/5 border-l-4 border-brand pl-2' : ''}"
                    on:click={() => changeCognitiveMode(mode.id)}
                    disabled={modeLoading}
                  >
                    <div class="flex items-center gap-2">
                      <span class="h-2 w-2 rounded-full {mode.id === 'dual' ? 'bg-purple-500' : mode.id === 'agent' ? 'bg-blue-500' : 'bg-amber-500'}"></span>
                      <span class="font-medium">{mode.label}</span>
                    </div>
                    <p class="mt-1 text-xs text-gray-500 dark:text-gray-400 leading-snug">{mode.description}</p>
                  </button>
                {/each}
              {/if}
            </div>
          </div>
        {/if}
      </div>
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

  {#if modeError}
    <div class="px-4 py-2 text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40 border-b border-red-200 dark:border-red-900/60">
      Cognitive mode error: {modeError}
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

<style>
  /* App root uses dynamic viewport height when available */
  .app-root {
    height: 100vh;
    min-height: 100vh;
  }

  /* Prefer new dynamic viewport units when supported */
  @supports (height: 100dvh) {
    .app-root {
      height: 100dvh;
      min-height: 100dvh;
    }
  }

  /* Use JS-computed innerHeight when available (works across iOS URL bar states) */
  .app-root {
    height: var(--app-vh, 100vh);
    min-height: var(--app-vh, 100vh);
  }

  .mode-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 1.9rem;
    transition: color 0.3s ease, text-shadow 0.3s ease;
  }

  .brand-name {
    letter-spacing: 0.04em;
    font-weight: 700;
  }

  .mode-label {
    font-size: 0.8rem;
    font-weight: 600;
    padding: 0.3rem 0.9rem;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.55);
    box-shadow: 0 0 18px var(--mode-glow, rgba(124, 58, 237, 0.6));
    transition: all 0.3s ease;
    color: var(--mode-accent, inherit);
  }

  :global(.dark) .mode-label {
    background: rgba(15, 23, 42, 0.55);
  }

  .mode-label.loading,
  .mode-label.muted {
    box-shadow: none;
    color: inherit;
  }

  .mode-menu-trigger {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.35rem 0.75rem;
    border-radius: 999px;
    border: 1px solid rgba(148, 163, 184, 0.35);
    background: rgba(255, 255, 255, 0.55);
    color: var(--mode-accent, inherit);
    transition: all 0.25s ease;
    box-shadow: 0 0 12px rgba(148, 163, 184, 0.15);
  }

  :global(.dark) .mode-menu-trigger {
    background: rgba(15, 23, 42, 0.55);
    border-color: rgba(148, 163, 184, 0.25);
  }

  .mode-menu-trigger:hover {
    box-shadow: 0 0 20px var(--mode-glow, rgba(124, 58, 237, 0.25));
    border-color: var(--mode-accent, rgba(124, 58, 237, 0.45));
  }

  .mode-menu-trigger.active {
    box-shadow: 0 0 24px var(--mode-glow, rgba(124, 58, 237, 0.35));
    border-color: var(--mode-accent, rgba(124, 58, 237, 0.55));
  }

  .mode-dot {
    display: inline-flex;
    height: 8px;
    width: 8px;
    border-radius: 999px;
    box-shadow: 0 0 10px var(--mode-accent, rgba(124, 58, 237, 0.5));
  }

  .mode-text {
    font-weight: 600;
  }

  /* Custom scrollbar styling for sidebar content */
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
