<script lang="ts">
  import { onMount } from 'svelte';
  import LogStream from './LogStream.svelte';
  import AuditStreamEnhanced from './AuditStreamEnhanced.svelte';
  import ModelSelector from './ModelSelector.svelte';
  import AgentMonitor from './AgentMonitor.svelte';
  import ServerStatus from './ServerStatus.svelte';
  import { apiFetch } from '../lib/client/api-config';
  import { rightSidebarOpen } from '../stores/navigation';

  let activeTab = 'monitor';
  let useEnhancedAudit = true; // Toggle between old and new audit stream (default: grouped mode)

  // Load preferences from localStorage
  onMount(() => {
    try {
      const savedTab = localStorage.getItem('mh_right_sidebar_tab');
      if (savedTab !== null) {
        activeTab = savedTab;
      }

      const savedAudit = localStorage.getItem('mh_use_enhanced_audit');
      if (savedAudit !== null) {
        useEnhancedAudit = savedAudit === 'true';
      }
    } catch {}
  });

  // Save active tab to localStorage
  $: if (typeof activeTab !== 'undefined') {
    try {
      localStorage.setItem('mh_right_sidebar_tab', activeTab);
    } catch {}
  }

  // Save audit preference to localStorage
  $: if (typeof useEnhancedAudit !== 'undefined') {
    try {
      localStorage.setItem('mh_use_enhanced_audit', String(useEnhancedAudit));
    } catch {}
  }

  interface Tab {
    id: string;
    label: string;
    icon: string;
  }

  const tabs: Tab[] = [
    { id: 'audit', label: 'Audit Stream', icon: '📋' },
    { id: 'monitor', label: 'Agent Monitor', icon: '🤖' },
    { id: 'servers', label: 'Server Status', icon: '🖥️' },
  ];
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
    {#if activeTab === 'audit'}
      <div class="h-full flex flex-col">
        <!-- Toggle Button -->
        <div class="p-2 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between bg-gray-50 dark:bg-gray-800">
          <span class="text-xs text-gray-600 dark:text-gray-400">View Mode:</span>
          <label class="flex items-center gap-2 cursor-pointer">
            <span class="text-xs text-gray-600 dark:text-gray-400">Terminal</span>
            <input
              type="checkbox"
              bind:checked={useEnhancedAudit}
              class="toggle-switch"
            />
            <span class="text-xs text-gray-600 dark:text-gray-400">Grouped</span>
          </label>
        </div>

        <!-- Stream Component -->
        <div class="flex-1 min-h-0">
          {#if useEnhancedAudit}
            <AuditStreamEnhanced />
          {:else}
            <LogStream />
          {/if}
        </div>
      </div>
    {:else if activeTab === 'monitor'}
      <div class="p-3 h-full overflow-hidden flex flex-col gap-4">
        <AgentMonitor compact={true} />
      </div>
    {:else if activeTab === 'servers'}
      <div class="h-full overflow-hidden">
        <ServerStatus isVisible={$rightSidebarOpen && activeTab === 'servers'} />
      </div>
    {/if}
  </div>
</div>
