<script lang="ts">
  import { onMount, setContext } from 'svelte';
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

  // Detect screen size
  function updateScreenSize() {
    if (typeof window !== 'undefined') {
      isMobile = window.innerWidth < 768;
    }
  }

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

    return () => {
      window.removeEventListener('resize', updateScreenSize);
      window.removeEventListener('resize', setVH);
      window.removeEventListener('orientationchange', setVH);
    };
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
      <h1 class="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-gray-100 m-0">
        <span class="text-2xl">🧠</span>
        MetaHuman OS
      </h1>
    </div>

    <div class="flex items-center gap-3">
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
