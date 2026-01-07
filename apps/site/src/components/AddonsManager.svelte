<script lang="ts">
  import { onMount } from 'svelte';
  import { apiFetch } from '../lib/client/api-config';

  interface Addon {
    id: string;
    name: string;
    description: string;
    category: string;
    enabled: boolean;
    installed: boolean;
    size: string;
    requirements: Record<string, string>;
    dependencies: {
      pip?: string[];
      system?: string[];
    };
    installation?: {
      script?: string;
      commands?: string[];
    };
    note?: string;
  }

  interface AddonCategory {
    name: string;
    description: string;
  }

  let addons: Record<string, Addon> = {};
  let categories: Record<string, AddonCategory> = {};
  let loading = true;
  let error: string | null = null;
  let installing: Record<string, boolean> = {};
  let toggling: Record<string, boolean> = {};
  let selectedCategory: string | null = null;

  // Installation progress modal
  let showInstallModal = false;
  let installLogs: Array<{ level: string; message: string; timestamp: Date }> = [];
  let currentInstallAddon: string | null = null;

  onMount(async () => {
    await loadAddons();
  });

  async function loadAddons() {
    try {
      loading = true;
      const response = await apiFetch('/api/addons');
      if (!response.ok) throw new Error('Failed to load addons');

      const data = await response.json();
      addons = { ...data.addons } || {};
      categories = { ...data.categories } || {};
      error = null;
    } catch (e) {
      error = String(e);
      console.error('[AddonsManager] Error loading addons:', e);
    } finally {
      loading = false;
    }
  }

  async function installAddon(addonId: string) {
    if (!confirm(`Install ${addons[addonId].name}?\n\nThis will download and configure the addon. Installation may take several minutes.`)) {
      return;
    }

    try {
      currentInstallAddon = addonId;
      installLogs = [];
      showInstallModal = true;
      installing = { ...installing, [addonId]: true };

      const scriptMap: Record<string, { script: string; args: string[] }> = {
        'kokoro': { script: 'bin/install-kokoro.sh', args: ['--yes'] },
        'gpt-sovits': { script: 'bin/install-sovits.sh', args: [] },
        'rvc': { script: 'bin/install-rvc.sh', args: [] },
      };

      const installConfig = scriptMap[addonId];
      if (!installConfig) {
        throw new Error(`No installation script configured for ${addonId}`);
      }

      const response = await apiFetch('/api/process-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: 'bash',
          args: [installConfig.script, ...installConfig.args],
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error('Failed to start installation stream');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;

          const [eventLine, dataLine] = line.split('\n');
          if (!eventLine || !dataLine) continue;

          const event = eventLine.replace('event: ', '').trim();
          const dataStr = dataLine.replace('data: ', '').trim();

          try {
            const data = JSON.parse(dataStr);

            if (event === 'start') {
              installLogs = [...installLogs, { level: 'info', message: data.message, timestamp: new Date() }];
            } else if (event === 'log') {
              installLogs = [...installLogs, { level: data.level, message: data.message, timestamp: new Date() }];

              setTimeout(() => {
                const logContainer = document.querySelector('.install-logs');
                if (logContainer) {
                  logContainer.scrollTop = logContainer.scrollHeight;
                }
              }, 10);
            } else if (event === 'complete') {
              installLogs = [...installLogs, {
                level: data.success ? 'info' : 'error',
                message: data.success ? data.message : data.error,
                timestamp: new Date()
              }];
              installing = { ...installing, [addonId]: false };

              if (data.success) {
                await apiFetch('/api/addons/mark-installed', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ addonId, installed: true }),
                }).catch(err => console.error('Failed to mark addon as installed:', err));

                await loadAddons();
              }
              break;
            } else if (event === 'error') {
              installLogs = [...installLogs, { level: 'error', message: data.message, timestamp: new Date() }];
              installing = { ...installing, [addonId]: false };
              break;
            }
          } catch (parseError) {
            console.error('[AddonsManager] Failed to parse SSE data:', parseError);
          }
        }
      }

    } catch (e) {
      error = `Installation failed: ${String(e)}`;
      console.error('[AddonsManager] Install error:', e);
      installing = { ...installing, [addonId]: false };
      showInstallModal = false;
    }
  }

  function closeInstallModal() {
    showInstallModal = false;
    currentInstallAddon = null;
    installLogs = [];
  }

  async function uninstallAddon(addonId: string) {
    if (!confirm(`Uninstall ${addons[addonId].name}?\n\nThis will remove the addon and its data.`)) {
      return;
    }

    try {
      installing = { ...installing, [addonId]: true };

      const response = await apiFetch('/api/addons/uninstall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addonId }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Uninstallation failed');
      }

      await loadAddons();
    } catch (e) {
      error = `Uninstallation failed: ${String(e)}`;
      console.error('[AddonsManager] Uninstall error:', e);
    } finally {
      installing = { ...installing, [addonId]: false };
    }
  }

  async function toggleAddon(addonId: string) {
    try {
      toggling = { ...toggling, [addonId]: true };
      const newState = !addons[addonId].enabled;

      const response = await apiFetch('/api/addons/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addonId, enabled: newState }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Toggle failed');
      }

      await loadAddons();
    } catch (e) {
      error = `Toggle failed: ${String(e)}`;
      console.error('[AddonsManager] Toggle error:', e);
    } finally {
      toggling = { ...toggling, [addonId]: false };
    }
  }

  function getAddonsByCategory(categoryId: string | null): [string, Addon][] {
    const entries = Object.entries(addons);
    if (!categoryId) return entries;
    return entries.filter(([_, addon]) => addon.category === categoryId);
  }

  $: filteredAddons = getAddonsByCategory(selectedCategory);
</script>

<div class="p-6 max-w-[1200px] mx-auto">
  <div class="mb-8">
    <h2 class="m-0 mb-2 text-[1.75rem] text-gray-800 dark:text-gray-100">Addons</h2>
    <p class="m-0 text-gray-500 dark:text-gray-400 text-[0.95rem]">Extend MetaHuman with optional features. Install only what you need to keep the system lightweight.</p>
  </div>

  {#if error}
    <div class="p-4 bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200 rounded-md mb-6">{error}</div>
  {/if}

  {#if loading}
    <div class="text-center py-12 text-gray-500 dark:text-gray-400">Loading addons...</div>
  {:else}
    <!-- Category filter -->
    <div class="flex gap-2 mb-6 flex-wrap">
      <button
        class="px-4 py-2 border-2 rounded-md font-medium cursor-pointer transition-all {selectedCategory === null ? 'border-violet-600 bg-violet-600 text-white' : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:border-violet-600 hover:text-violet-600'}"
        on:click={() => (selectedCategory = null)}
      >
        All Addons
      </button>
      {#each Object.entries(categories) as [catId, category]}
        <button
          class="px-4 py-2 border-2 rounded-md font-medium cursor-pointer transition-all {selectedCategory === catId ? 'border-violet-600 bg-violet-600 text-white' : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:border-violet-600 hover:text-violet-600'}"
          on:click={() => (selectedCategory = catId)}
        >
          {category.name}
        </button>
      {/each}
    </div>

    <!-- Addons grid -->
    <div class="grid grid-cols-[repeat(auto-fill,minmax(350px,1fr))] gap-6">
      {#each filteredAddons as [addonId, addon]}
        <div class="border-2 rounded-xl p-6 bg-white dark:bg-gray-800 transition-all hover:border-violet-600 hover:shadow-lg hover:shadow-violet-500/10 {addon.installed ? 'border-emerald-500 dark:border-emerald-600' : 'border-gray-200 dark:border-gray-700'}">
          <div class="flex justify-between items-start mb-4">
            <div>
              <h3 class="m-0 mb-1 text-xl text-gray-800 dark:text-gray-100">{addon.name}</h3>
              <span class="text-xs text-violet-600 font-semibold uppercase tracking-wide">{categories[addon.category]?.name || addon.category}</span>
            </div>
            <div class="flex gap-2 flex-wrap">
              {#if addon.installed}
                <span class="px-3 py-1 rounded-md text-xs font-semibold bg-emerald-100 dark:bg-emerald-900 text-emerald-800 dark:text-emerald-300">Installed</span>
                {#if addon.enabled}
                  <span class="px-3 py-1 rounded-md text-xs font-semibold bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-300">Enabled</span>
                {:else}
                  <span class="px-3 py-1 rounded-md text-xs font-semibold bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200">Disabled</span>
                {/if}
              {:else}
                <span class="px-3 py-1 rounded-md text-xs font-semibold bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400">Not Installed</span>
              {/if}
            </div>
          </div>

          <p class="m-0 mb-4 text-gray-600 dark:text-gray-300 text-[0.95rem] leading-relaxed">{addon.description}</p>

          {#if addon.note}
            <div class="p-3 bg-amber-100 dark:bg-amber-950 rounded-md text-amber-800 dark:text-amber-200 text-sm mb-4">ℹ️ {addon.note}</div>
          {/if}

          <div class="flex flex-wrap gap-4 mb-4 p-3 bg-gray-50 dark:bg-gray-900 rounded-md">
            <div class="flex gap-2 text-sm">
              <span class="text-gray-500 dark:text-gray-400 font-semibold">Size:</span>
              <span class="text-gray-800 dark:text-gray-100">{addon.size}</span>
            </div>
            {#if addon.requirements.python}
              <div class="flex gap-2 text-sm">
                <span class="text-gray-500 dark:text-gray-400 font-semibold">Python:</span>
                <span class="text-gray-800 dark:text-gray-100">{addon.requirements.python}</span>
              </div>
            {/if}
            {#if addon.requirements.gpu}
              <div class="flex gap-2 text-sm">
                <span class="text-gray-500 dark:text-gray-400 font-semibold">GPU:</span>
                <span class="text-gray-800 dark:text-gray-100">{addon.requirements.gpu}</span>
              </div>
            {/if}
            {#if addon.requirements.vram}
              <div class="flex gap-2 text-sm">
                <span class="text-gray-500 dark:text-gray-400 font-semibold">VRAM:</span>
                <span class="text-gray-800 dark:text-gray-100">{addon.requirements.vram}</span>
              </div>
            {/if}
          </div>

          {#if addon.dependencies?.pip && addon.dependencies.pip.length > 0}
            <div class="mb-4 text-sm">
              <strong class="block mb-2 text-gray-600 dark:text-gray-300">Python packages:</strong>
              <div class="flex flex-wrap gap-1.5">
                {#each addon.dependencies.pip as dep}
                  <code class="px-2 py-1 bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-200 rounded text-xs font-mono">{dep}</code>
                {/each}
              </div>
            </div>
          {/if}

          <div class="flex gap-3">
            {#if addon.installed}
              <button
                class="flex-1 py-2.5 px-4 border-none rounded-md font-semibold cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed {addon.enabled ? 'bg-emerald-500 text-white hover:bg-emerald-600' : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-emerald-600 hover:text-white'}"
                on:click={() => toggleAddon(addonId)}
                disabled={toggling[addonId]}
              >
                {toggling[addonId] ? 'Updating...' : addon.enabled ? '✓ Enabled' : 'Enable'}
              </button>
              <button
                class="flex-1 py-2.5 px-4 border-none rounded-md font-semibold cursor-pointer transition-all bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                on:click={() => uninstallAddon(addonId)}
                disabled={installing[addonId]}
              >
                {installing[addonId] ? 'Uninstalling...' : 'Uninstall'}
              </button>
            {:else}
              <button
                class="flex-1 py-2.5 px-4 border-none rounded-md font-semibold cursor-pointer transition-all bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed"
                on:click={() => installAddon(addonId)}
                disabled={installing[addonId]}
              >
                {installing[addonId] ? 'Installing...' : 'Install'}
              </button>
            {/if}
          </div>
        </div>
      {/each}
    </div>

    {#if filteredAddons.length === 0}
      <div class="text-center py-12 text-gray-500 dark:text-gray-400">
        <p>No addons found in this category.</p>
      </div>
    {/if}
  {/if}

  <!-- Installation Progress Modal -->
  {#if showInstallModal && currentInstallAddon}
    <div class="fixed inset-0 bg-black/70 flex items-center justify-center z-[1000]" on:click={closeInstallModal}>
      <div class="bg-white dark:bg-gray-800 rounded-xl w-[90%] max-w-[800px] max-h-[80vh] flex flex-col shadow-2xl" on:click|stopPropagation>
        <div class="p-6 border-b-2 border-gray-200 dark:border-gray-700 flex justify-between items-center">
          <h3 class="m-0 text-xl text-gray-800 dark:text-gray-100">Installing {addons[currentInstallAddon]?.name || currentInstallAddon}</h3>
          <button class="bg-transparent border-none text-3xl leading-none text-gray-500 cursor-pointer w-8 h-8 flex items-center justify-center hover:text-gray-800 dark:hover:text-gray-100" on:click={closeInstallModal}>×</button>
        </div>

        <div class="install-logs flex-1 overflow-y-auto p-4 bg-gray-50 dark:bg-gray-900 font-mono text-sm max-h-[500px]">
          {#each installLogs as log}
            <div class="p-2 mb-1 rounded flex gap-3 {log.level === 'error' ? 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200' : 'bg-blue-50 dark:bg-blue-900 text-blue-800 dark:text-blue-200'}">
              <span class="shrink-0 opacity-70 font-semibold">{log.timestamp.toLocaleTimeString()}</span>
              <span class="flex-1 break-words">{log.message}</span>
            </div>
          {/each}
          {#if installLogs.length === 0}
            <div class="text-center py-12 text-gray-500 dark:text-gray-400 italic">Waiting for installation to start...</div>
          {/if}
        </div>

        <div class="p-6 border-t-2 border-gray-200 dark:border-gray-700 flex justify-center">
          {#if installing[currentInstallAddon]}
            <div class="text-violet-600 font-semibold flex items-center gap-2">
              <span class="animate-spin">⏳</span> Installation in progress...
            </div>
          {:else}
            <button class="btn-primary" on:click={closeInstallModal}>Close</button>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  .animate-spin {
    animation: spin 2s linear infinite;
  }
</style>
