<script lang="ts">
  import { onMount } from 'svelte';
  import AgentMonitor from './AgentMonitor.svelte';
  import QueuePanel from './QueuePanel.svelte';
  import ServerStatus from './ServerStatus.svelte';
  import { rightSidebarOpen, systemCoderDisabled } from '../stores/navigation';

  let activeTab = 'queue';
  let preferencesLoaded = false;

  // Lazy load SystemCoderDashboard
  let SystemCoderDashboard: any = null;
  let coderLoading = false;

  // Load preferences from localStorage
  onMount(() => {
    try {
      const savedTab = localStorage.getItem('mh_right_sidebar_tab');
      // Only restore if it's a valid tab (audit was removed)
      if (savedTab !== null && ['coder', 'queue', 'monitor', 'servers'].includes(savedTab)) {
        activeTab = savedTab;
      }
    } catch {}
    preferencesLoaded = true;
  });

  $: if ($systemCoderDisabled && activeTab === 'coder') {
    activeTab = 'queue';
  }

  // Save active tab to localStorage
  $: if (preferencesLoaded && typeof activeTab !== 'undefined') {
    try {
      localStorage.setItem('mh_right_sidebar_tab', activeTab);
    } catch {}
  }

  interface Tab {
    id: string;
    label: string;
    icon: string;
  }

  $: tabs = [
    ...($systemCoderDisabled ? [] : [{ id: 'coder', label: 'System Coder', icon: '🔧' }]),
    { id: 'queue', label: 'Queue', icon: '☷' },
    { id: 'monitor', label: 'Agent Monitor', icon: '🤖' },
    { id: 'servers', label: 'Server Status', icon: '🖥️' },
  ] as Tab[];

  // Lazy load SystemCoderDashboard when coder tab is selected
  $: if (!$systemCoderDisabled && activeTab === 'coder' && !SystemCoderDashboard && !coderLoading) {
    coderLoading = true;
    import('./SystemCoderDashboard.svelte')
      .then(module => {
        SystemCoderDashboard = module.default;
        coderLoading = false;
      })
      .catch(err => {
        console.error('[RightSidebar] Failed to load SystemCoderDashboard:', err);
        coderLoading = false;
      });
  }
</script>

<div class="flex flex-col h-full overflow-hidden">
  <!-- Tab Navigation -->
  <div class="flex border-b border-black/10 dark:border-white/10 shrink-0">
    {#each tabs as tab}
      <button
        class="flex-1 flex flex-col items-center gap-1 py-3 px-2 border-0 bg-transparent cursor-pointer transition-all border-b-2 border-transparent hover:bg-black/5 dark:hover:bg-white/5
               {activeTab === tab.id ? 'border-b-violet-600 dark:border-b-violet-400 bg-violet-600/5 dark:bg-violet-400/5' : ''}"
        on:click={() => (activeTab = tab.id)}
      >
        <span class="text-xl">{tab.icon}</span>
        <span class="text-[0.7rem] font-medium {activeTab === tab.id ? 'text-violet-600 dark:text-violet-400' : 'text-gray-500 dark:text-gray-400'}">{tab.label}</span>
      </button>
    {/each}
  </div>

  <!-- Tab Content -->
  <div class="flex-1 overflow-y-auto overflow-x-hidden">
    {#if activeTab === 'coder'}
      <div class="h-full overflow-hidden">
        {#if coderLoading}
          <div class="flex items-center justify-center h-full">
            <div class="text-center">
              <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-purple-500 mx-auto mb-2"></div>
              <p class="text-xs text-gray-500 dark:text-gray-400">Loading...</p>
            </div>
          </div>
        {:else if SystemCoderDashboard}
          <svelte:component this={SystemCoderDashboard} compact={true} />
        {:else}
          <div class="flex items-center justify-center h-full text-gray-500 dark:text-gray-400 text-sm">
            Failed to load System Coder
          </div>
        {/if}
      </div>
    {:else if activeTab === 'monitor'}
      <div class="p-3 h-full overflow-hidden flex flex-col gap-4">
        <AgentMonitor />
      </div>
    {:else if activeTab === 'queue'}
      <div class="h-full overflow-hidden">
        <QueuePanel />
      </div>
    {:else if activeTab === 'servers'}
      <div class="h-full overflow-hidden">
        <ServerStatus isVisible={$rightSidebarOpen && activeTab === 'servers'} />
      </div>
    {/if}
  </div>
</div>
