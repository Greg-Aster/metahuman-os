<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { apiFetch } from '../lib/client/api-config';

  interface ServerInfo {
    name: string;
    displayName: string;
    endpoint: string;
    port: number;
    status: 'running' | 'stopped' | 'unknown';
    healthy: boolean;
    installed: boolean;
    details?: any;
  }

  interface AstroServer {
    port: number;
    pid: number;
    command: string;
    isCurrentServer: boolean;
  }

  interface LLMBackendInfo {
    activeBackend: 'auto' | 'ollama' | 'vllm' | 'remote' | 'local-models';
    ollama: {
      installed: boolean;
      running: boolean;
      model?: string;
      endpoint: string;
    };
    vllm: {
      installed: boolean;
      running: boolean;
      model?: string;
      endpoint: string;
    };
  }

  interface LocalModelsInfo {
    running: boolean;
    endpoint: string;
    embedder: {
      model: string | null;
      loaded: boolean;
      dimensions?: number;
    };
    generator: {
      model: string | null;
      loaded: boolean;
    };
  }

  interface InterpreterInfo {
    running: boolean;
    healthy: boolean;
    available: boolean;
    enabled: boolean;
    endpoint: string;
    config?: {
      safeMode?: boolean;
      autoRun?: boolean;
      maxIterations?: number;
    };
  }

  interface BigBrotherInfo {
    running: boolean;
    healthy: boolean;
    port: number;
    pid: number | null;
    claudeReady: boolean;
    endpoint: string;
  }

  interface EventBusInfo {
    running: boolean;
    healthy: boolean;
    port: number;
    endpoint: string;
    uptime?: number;
    eventCount?: number;
    subscribers?: number;
  }

  export let isVisible = true;

  let servers: ServerInfo[] = [];
  let astroServers: AstroServer[] = [];
  let llmBackend: LLMBackendInfo | null = null;
  let localModels: LocalModelsInfo | null = null;
  let interpreter: InterpreterInfo | null = null;
  let bigBrother: BigBrotherInfo | null = null;
  let eventBus: EventBusInfo | null = null;
  let loading = true;
  let actionInProgress: string | null = null;
  let refreshInterval: ReturnType<typeof setInterval> | null = null;
  let isPageVisible = true;
  let statusFetchInProgress = false;

  const STATUS_FETCH_TIMEOUT_MS = 5000;

  const serverConfigs = [
    { name: 'whisper', displayName: 'Whisper STT', endpoint: '/api/whisper-server', port: 9883 },
    { name: 'kokoro', displayName: 'Kokoro TTS', endpoint: '/api/kokoro-server', port: 9882 },
    { name: 'rvc', displayName: 'RVC Voice', endpoint: '/api/rvc-server', port: 9881 },
    { name: 'sovits', displayName: 'GPT-SoVITS', endpoint: '/api/sovits-server', port: 9880 },
  ];

  async function fetchStatusEndpoint(endpoint: string): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), STATUS_FETCH_TIMEOUT_MS);

    try {
      return await apiFetch(endpoint, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  async function fetchServerStatus() {
    if (statusFetchInProgress) {
      console.log('[ServerStatus] Skipping refresh; previous refresh still running');
      return;
    }

    statusFetchInProgress = true;
    loading = servers.length === 0 && astroServers.length === 0;
    const newServers: ServerInfo[] = [];

    try {
      try {
        const llmResponse = await fetchStatusEndpoint('/api/llm-backend/status');
        if (llmResponse.ok) {
          const data = await llmResponse.json();
          llmBackend = {
            activeBackend: data.config.activeBackend,
            ollama: {
              installed: data.available.ollama.installed,
              running: data.available.ollama.running,
              model: data.available.ollama.model,
              endpoint: data.config.ollama.endpoint,
            },
            vllm: {
              installed: data.available.vllm.installed,
              running: data.available.vllm.running,
              model: data.available.vllm.model || data.config.vllm.model,
              endpoint: data.config.vllm.endpoint,
            },
          };
        }
      } catch (error) {
        console.error('Failed to fetch LLM backend status:', error);
      }

      try {
        const localModelsResponse = await fetchStatusEndpoint('/api/local-models/status');
        if (localModelsResponse.ok) {
          const data = await localModelsResponse.json();
          const loaded = data.loadedModels;
          localModels = {
            running: data.running,
            endpoint: data.endpoint || 'http://127.0.0.1:4324',
            embedder: {
              model: loaded?.embedder?.model || data.config?.embeddings?.model || null,
              loaded: loaded?.embedder?.loaded || false,
              dimensions: loaded?.embedder?.dimensions,
            },
            generator: {
              model: loaded?.generator?.model || data.config?.llm?.model || null,
              loaded: loaded?.generator?.loaded || false,
            },
          };
        }
      } catch (error) {
        console.error('Failed to fetch local-models status:', error);
        localModels = null;
      }

      try {
        const interpreterResponse = await fetchStatusEndpoint('/api/interpreter-status');
        if (interpreterResponse.ok) {
          const data = await interpreterResponse.json();
          interpreter = {
            running: data.running ?? false,
            healthy: data.healthy ?? false,
            available: data.available ?? false,
            enabled: data.enabled ?? false,
            endpoint: data.config?.endpoint || 'http://localhost:4325',
            config: data.config,
          };
        }
      } catch (error) {
        console.error('Failed to fetch interpreter status:', error);
        interpreter = null;
      }

      try {
        const bigBrotherResponse = await fetchStatusEndpoint('/api/big-brother-status');
        if (bigBrotherResponse.ok) {
          const data = await bigBrotherResponse.json();
          bigBrother = {
            running: data.running ?? false,
            healthy: data.healthy ?? false,
            port: data.port ?? 3099,
            pid: data.pid ?? null,
            claudeReady: data.claudeReady ?? false,
            endpoint: data.endpoint || 'http://localhost:3099',
          };
        }
      } catch (error) {
        console.error('Failed to fetch Big Brother status:', error);
        bigBrother = null;
      }

      try {
        const eventBusResponse = await fetchStatusEndpoint('/api/event-bus-status');
        if (eventBusResponse.ok) {
          const data = await eventBusResponse.json();
          eventBus = {
            running: data.running ?? false,
            healthy: data.healthy ?? false,
            port: data.port ?? 3100,
            endpoint: data.endpoint || 'http://localhost:3100',
            uptime: data.uptime,
            eventCount: data.eventCount,
            subscribers: data.subscribers,
          };
        }
      } catch (error) {
        console.error('Failed to fetch Event Bus status:', error);
        eventBus = null;
      }

      try {
        for (const config of serverConfigs) {
          try {
            const response = await fetchStatusEndpoint(config.endpoint);
            if (response.ok) {
              const data = await response.json();
              newServers.push({
                name: config.name,
                displayName: config.displayName,
                endpoint: config.endpoint,
                port: config.port,
                status: data.running ? 'running' : 'stopped',
                healthy: data.healthy ?? data.running,
                installed: data.installed ?? true,
                details: data,
              });
            } else {
              newServers.push({
                name: config.name,
                displayName: config.displayName,
                endpoint: config.endpoint,
                port: config.port,
                status: 'unknown',
                healthy: false,
                installed: false,
              });
            }
          } catch (error) {
            console.error(`Failed to fetch ${config.displayName} status:`, error);
            newServers.push({
              name: config.name,
              displayName: config.displayName,
              endpoint: config.endpoint,
              port: config.port,
              status: 'unknown',
              healthy: false,
              installed: false,
            });
          }
        }
      } finally {
        servers = newServers;
      }

      try {
        const astroResponse = await fetchStatusEndpoint('/api/astro-servers');
        if (astroResponse.ok) {
          const astroData = await astroResponse.json();
          astroServers = astroData.servers || [];
        }
      } catch (error) {
        console.error('Failed to fetch Astro servers:', error);
        astroServers = [];
      }
    } finally {
      if (newServers.length > 0 || servers.length === 0) {
        servers = newServers;
      }
      loading = false;
      statusFetchInProgress = false;
    }
  }

  function isBackendActive(backend: 'ollama' | 'vllm'): boolean {
    return llmBackend?.activeBackend === backend;
  }

  function openBackendSettings() {
    window.dispatchEvent(new CustomEvent('mh-open-system-tab', { detail: { tab: 'backend' } }));
  }

  async function controlInterpreter(action: 'start' | 'stop' | 'restart') {
    actionInProgress = `interpreter-${action}`;
    try {
      const response = await apiFetch('/api/interpreter-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        alert(`Failed to ${action} Open Interpreter: ${data.error || 'Unknown error'}`);
      } else {
        setTimeout(fetchServerStatus, 2000);
      }
    } catch (error) {
      alert(`Error ${action}ing Open Interpreter: ${(error as Error).message}`);
    } finally {
      actionInProgress = null;
    }
  }

  async function controlBigBrother(action: 'start' | 'stop' | 'restart') {
    actionInProgress = `bigbrother-${action}`;
    try {
      const response = await apiFetch('/api/big-brother-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        alert(`Failed to ${action} Big Brother: ${data.error || 'Unknown error'}`);
      } else {
        setTimeout(fetchServerStatus, 2000);
      }
    } catch (error) {
      alert(`Error ${action}ing Big Brother: ${(error as Error).message}`);
    } finally {
      actionInProgress = null;
    }
  }

  async function controlEventBus(action: 'start' | 'stop' | 'restart') {
    actionInProgress = `eventbus-${action}`;
    try {
      const response = await apiFetch('/api/event-bus-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        alert(`Failed to ${action} Event Bus: ${data.error || 'Unknown error'}`);
      } else {
        setTimeout(fetchServerStatus, 2000);
      }
    } catch (error) {
      alert(`Error ${action}ing Event Bus: ${(error as Error).message}`);
    } finally {
      actionInProgress = null;
    }
  }

  async function controlServer(server: ServerInfo, action: 'start' | 'stop' | 'restart') {
    actionInProgress = `${server.name}-${action}`;
    try {
      const response = await apiFetch(server.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        alert(`Failed to ${action} ${server.displayName}: ${data.error || 'Unknown error'}`);
      } else {
        setTimeout(fetchServerStatus, 1000);
      }
    } catch (error) {
      alert(`Error ${action}ing ${server.displayName}: ${(error as Error).message}`);
    } finally {
      actionInProgress = null;
    }
  }

  function getStatusIcon(server: ServerInfo): string {
    if (!server.installed) return '⚠️';
    if (server.status === 'running' && server.healthy) return '🟢';
    if (server.status === 'running' && !server.healthy) return '🟡';
    if (server.status === 'stopped') return '🔴';
    return '⚪';
  }

  function getStatusText(server: ServerInfo): string {
    if (!server.installed) return 'Not Installed';
    if (server.status === 'running' && server.healthy) return 'Running';
    if (server.status === 'running' && !server.healthy) return 'Unhealthy';
    if (server.status === 'stopped') return 'Stopped';
    return 'Unknown';
  }

  async function stopAstroServer(port: number, isCurrentServer: boolean) {
    if (isCurrentServer) {
      const confirmed = confirm(
        `⚠️ Warning: This will stop the current Astro dev server.\n\n` +
        `The UI will disconnect and you'll need to restart the server manually.\n\n` +
        `Continue?`
      );
      if (!confirmed) return;
    }
    actionInProgress = `astro-${port}`;
    try {
      const response = await apiFetch('/api/astro-servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop', port }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        alert(`Failed to stop Astro server: ${data.error || 'Unknown error'}`);
      } else {
        if (isCurrentServer) {
          alert('Server stopped. You will need to restart it manually.');
        } else {
          setTimeout(fetchServerStatus, 1000);
        }
      }
    } catch (error) {
      alert(`Error stopping Astro server: ${(error as Error).message}`);
    } finally {
      actionInProgress = null;
    }
  }

  function startPolling() {
    if (!refreshInterval) {
      console.log('[ServerStatus] Starting polling (10s interval)');
      fetchServerStatus();
      refreshInterval = setInterval(fetchServerStatus, 10000);
    }
  }

  function stopPolling() {
    if (refreshInterval) {
      console.log('[ServerStatus] Stopping polling');
      clearInterval(refreshInterval);
      refreshInterval = null;
    }
  }

  $: if (isVisible && isPageVisible) {
    startPolling();
  } else {
    stopPolling();
  }

  function handleVisibilityChange() {
    isPageVisible = !document.hidden;
  }

  onMount(() => {
    document.addEventListener('visibilitychange', handleVisibilityChange);
    if (isVisible && isPageVisible) {
      startPolling();
    }
  });

  onDestroy(() => {
    stopPolling();
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  });
</script>

<div class="flex flex-col h-full p-4 gap-4">
  <div class="flex justify-between items-center">
    <h3 class="text-base font-semibold text-gray-900 dark:text-gray-100 m-0">Server Status</h3>
    <button
      class="bg-transparent border border-black/10 dark:border-white/20 rounded-md px-2 py-1 cursor-pointer text-base transition-all hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed"
      on:click={fetchServerStatus}
      disabled={loading}
    >
      {loading ? '⏳' : '🔄'}
    </button>
  </div>

  {#if loading && servers.length === 0 && astroServers.length === 0}
    <div class="text-center py-8 text-gray-500 dark:text-gray-400 text-sm">Loading server status...</div>
  {:else}
    <div class="flex flex-col gap-3 overflow-y-auto">
      <!-- LLM Backend Section -->
      {#if llmBackend}
        <div class="flex items-center gap-2 py-2 mt-2 font-semibold text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
          <span class="text-base">🧠</span>
          <span class="flex-1">LLM Backend</span>
        </div>

        <!-- Ollama -->
        <div class="border rounded-lg p-3 bg-white dark:bg-gray-800 transition-all hover:shadow-md dark:hover:shadow-black/30 {isBackendActive('ollama') ? 'border-2 border-emerald-500/40 dark:border-emerald-400/40 bg-emerald-500/[0.02] dark:bg-emerald-400/[0.03]' : 'border-blue-500/20 dark:border-blue-400/20'}">
          <div class="mb-3">
            <div class="flex items-start gap-3">
              <span class="text-xl leading-none">
                {#if !llmBackend.ollama.installed}⚠️
                {:else if llmBackend.ollama.running}🟢
                {:else}🔴{/if}
              </span>
              <div class="flex-1 min-w-0">
                <div class="font-semibold text-sm text-gray-900 dark:text-gray-100 mb-1">
                  Ollama
                  {#if llmBackend.activeBackend === 'ollama'}
                    <span class="inline-block px-1.5 py-0.5 ml-2 bg-emerald-500/15 dark:bg-emerald-400/20 text-emerald-600 dark:text-emerald-400 rounded text-[0.65rem] font-bold tracking-wide">ACTIVE</span>
                  {/if}
                </div>
                <div class="text-xs text-gray-500 dark:text-gray-400">
                  {llmBackend.ollama.endpoint}
                  {#if llmBackend.ollama.running && llmBackend.ollama.model}
                    • {llmBackend.ollama.model}
                  {/if}
                </div>
              </div>
            </div>
          </div>
          {#if llmBackend.ollama.installed}
            <button class="w-full py-1.5 px-3 border border-blue-500/30 dark:border-blue-400/30 rounded-md text-xs font-semibold cursor-pointer transition-all bg-blue-500/10 dark:bg-blue-400/10 text-blue-700 dark:text-blue-300 hover:bg-blue-500/15 dark:hover:bg-blue-400/15" on:click={openBackendSettings}>
              Configure in Backend
            </button>
          {:else}
            <div class="text-xs text-gray-500 dark:text-gray-400 italic p-2 text-center bg-black/5 dark:bg-white/5 rounded-md">Not installed</div>
          {/if}
        </div>

        <!-- vLLM -->
        <div class="border rounded-lg p-3 bg-white dark:bg-gray-800 transition-all hover:shadow-md dark:hover:shadow-black/30 {llmBackend.activeBackend === 'vllm' ? 'border-2 border-emerald-500/40 dark:border-emerald-400/40 bg-emerald-500/[0.02] dark:bg-emerald-400/[0.03]' : 'border-blue-500/20 dark:border-blue-400/20'}">
          <div class="mb-3">
            <div class="flex items-start gap-3">
              <span class="text-xl leading-none">
                {#if !llmBackend.vllm.installed}⚠️
                {:else if llmBackend.vllm.running}🟢
                {:else}🔴{/if}
              </span>
              <div class="flex-1 min-w-0">
                <div class="font-semibold text-sm text-gray-900 dark:text-gray-100 mb-1">
                  vLLM
                  {#if llmBackend.activeBackend === 'vllm'}
                    <span class="inline-block px-1.5 py-0.5 ml-2 bg-emerald-500/15 dark:bg-emerald-400/20 text-emerald-600 dark:text-emerald-400 rounded text-[0.65rem] font-bold tracking-wide">ACTIVE</span>
                  {/if}
                </div>
                <div class="text-xs text-gray-500 dark:text-gray-400">
                  {llmBackend.vllm.endpoint}
                  {#if llmBackend.vllm.model}
                    • {llmBackend.vllm.model}
                  {/if}
                </div>
              </div>
            </div>
          </div>
          {#if llmBackend.vllm.installed}
            <button class="w-full py-1.5 px-3 border border-blue-500/30 dark:border-blue-400/30 rounded-md text-xs font-semibold cursor-pointer transition-all bg-blue-500/10 dark:bg-blue-400/10 text-blue-700 dark:text-blue-300 hover:bg-blue-500/15 dark:hover:bg-blue-400/15" on:click={openBackendSettings}>
              Configure in Backend
            </button>
          {:else}
            <div class="text-xs text-gray-500 dark:text-gray-400 italic p-2 text-center bg-black/5 dark:bg-white/5 rounded-md">Not installed - requires Python vLLM package</div>
          {/if}
        </div>

        <!-- Local Models -->
        <div class="border rounded-lg p-3 bg-white dark:bg-gray-800 transition-all hover:shadow-md dark:hover:shadow-black/30 {localModels?.running ? 'border-2 border-orange-500/40 dark:border-orange-400/40 bg-orange-500/[0.02] dark:bg-orange-400/[0.03]' : 'border-orange-500/20 dark:border-orange-400/20'}">
          <div class="mb-3">
            <div class="flex items-start gap-3">
              <span class="text-xl leading-none">
                {#if localModels?.running}
                  {#if localModels.embedder.loaded}🟢{:else}🟡{/if}
                {:else}🔴{/if}
              </span>
              <div class="flex-1 min-w-0">
                <div class="font-semibold text-sm text-gray-900 dark:text-gray-100 mb-1">
                  Local Models
                  <span class="inline-block px-1.5 py-0.5 ml-2 bg-orange-500/15 dark:bg-orange-400/20 text-orange-600 dark:text-orange-400 rounded text-[0.6rem] font-bold tracking-tight">Utility</span>
                </div>
                <div class="text-xs text-gray-500 dark:text-gray-400">
                  {localModels?.endpoint || 'http://127.0.0.1:4324'}
                  {#if localModels?.running && localModels.embedder.loaded}
                    • {localModels.embedder.model}
                  {/if}
                </div>
              </div>
            </div>
          </div>
          <button class="w-full py-1.5 px-3 border border-orange-500/30 dark:border-orange-400/30 rounded-md text-xs font-semibold cursor-pointer transition-all bg-orange-500/10 dark:bg-orange-400/10 text-orange-700 dark:text-orange-300 hover:bg-orange-500/15 dark:hover:bg-orange-400/15" on:click={openBackendSettings}>
            Configure in Backend
          </button>
          {#if localModels?.running}
            <div class="flex flex-wrap gap-2 mt-3 pt-3 border-t border-black/10 dark:border-white/10">
              {#if localModels.embedder.loaded}
                <span class="inline-block px-2 py-1 bg-blue-500/10 dark:bg-blue-400/15 text-blue-600 dark:text-blue-400 rounded text-[0.7rem] font-medium">🔍 Embeddings: {localModels.embedder.model}</span>
              {:else}
                <span class="inline-block px-2 py-1 bg-amber-500/10 dark:bg-amber-400/15 text-amber-600 dark:text-amber-400 rounded text-[0.7rem] font-medium">Embeddings: Loading...</span>
              {/if}
              {#if localModels.generator.loaded}
                <span class="inline-block px-2 py-1 bg-emerald-500/10 dark:bg-emerald-400/15 text-emerald-600 dark:text-emerald-400 rounded text-[0.7rem] font-medium">💬 LLM: {localModels.generator.model}</span>
              {/if}
            </div>
          {/if}
        </div>

        <!-- Open Interpreter -->
        <div class="border rounded-lg p-3 bg-white dark:bg-gray-800 transition-all hover:shadow-md dark:hover:shadow-black/30 {interpreter?.running ? 'border-2 border-violet-500/40 dark:border-violet-400/40 bg-violet-500/[0.02] dark:bg-violet-400/[0.03]' : 'border-violet-500/20 dark:border-violet-400/20'}">
          <div class="mb-3">
            <div class="flex items-start gap-3">
              <span class="text-xl leading-none">
                {#if !interpreter?.available}⚠️
                {:else if interpreter?.running && interpreter?.healthy}🟢
                {:else if interpreter?.running}🟡
                {:else}🔴{/if}
              </span>
              <div class="flex-1 min-w-0">
                <div class="font-semibold text-sm text-gray-900 dark:text-gray-100 mb-1">
                  Open Interpreter
                  <span class="inline-block px-1.5 py-0.5 ml-2 bg-violet-500/15 dark:bg-violet-400/20 text-violet-600 dark:text-violet-400 rounded text-[0.6rem] font-bold tracking-tight">Tool Executor</span>
                  {#if interpreter?.enabled}
                    <span class="inline-block px-1.5 py-0.5 ml-1 bg-emerald-500/15 dark:bg-emerald-400/20 text-emerald-600 dark:text-emerald-400 rounded text-[0.6rem] font-bold tracking-tight">ENABLED</span>
                  {/if}
                </div>
                <div class="text-xs text-gray-500 dark:text-gray-400">
                  {interpreter?.endpoint || 'http://localhost:4325'}
                  {#if interpreter?.running && interpreter?.config?.safeMode !== undefined}
                    • {interpreter.config.safeMode ? 'Safe Mode' : 'Unrestricted'}
                  {/if}
                </div>
              </div>
            </div>
          </div>
          {#if interpreter?.available}
            <div class="flex gap-2">
              {#if interpreter?.running}
                <button class="flex-1 py-1.5 px-3 border-none rounded-md text-xs font-semibold cursor-pointer transition-all bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed" on:click={() => controlInterpreter('stop')} disabled={actionInProgress !== null}>
                  {actionInProgress === 'interpreter-stop' ? '...' : 'Stop'}
                </button>
                <button class="flex-1 py-1.5 px-3 border-none rounded-md text-xs font-semibold cursor-pointer transition-all bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed" on:click={() => controlInterpreter('restart')} disabled={actionInProgress !== null}>
                  {actionInProgress === 'interpreter-restart' ? '...' : 'Restart'}
                </button>
              {:else}
                <button class="flex-1 py-1.5 px-3 border-none rounded-md text-xs font-semibold cursor-pointer transition-all bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed" on:click={() => controlInterpreter('start')} disabled={actionInProgress !== null}>
                  {actionInProgress === 'interpreter-start' ? '...' : 'Start'}
                </button>
              {/if}
            </div>
          {:else}
            <div class="text-xs text-gray-500 dark:text-gray-400 italic p-2 text-center bg-black/5 dark:bg-white/5 rounded-md">Not installed - requires Python open-interpreter package</div>
          {/if}
          {#if interpreter?.running && interpreter?.config}
            <div class="flex flex-wrap gap-2 mt-3 pt-3 border-t border-black/10 dark:border-white/10">
              {#if interpreter.config.autoRun}
                <span class="inline-block px-2 py-1 bg-amber-500/10 dark:bg-amber-400/15 text-amber-600 dark:text-amber-400 rounded text-[0.7rem] font-medium">⚡ Auto-Run Enabled</span>
              {/if}
              {#if interpreter.config.maxIterations}
                <span class="inline-block px-2 py-1 bg-violet-500/10 dark:bg-violet-400/15 text-violet-600 dark:text-violet-400 rounded text-[0.7rem] font-medium">Max Iterations: {interpreter.config.maxIterations}</span>
              {/if}
            </div>
          {/if}
        </div>

        <!-- Big Brother (Claude Code) -->
        <div class="border rounded-lg p-3 bg-white dark:bg-gray-800 transition-all hover:shadow-md dark:hover:shadow-black/30 {bigBrother?.running ? 'border-2 border-purple-500/40 dark:border-purple-400/40 bg-purple-500/[0.02] dark:bg-purple-400/[0.03]' : 'border-purple-500/20 dark:border-purple-400/20'}">
          <div class="mb-3">
            <div class="flex items-start gap-3">
              <span class="text-xl leading-none">
                {#if bigBrother?.running && bigBrother?.healthy}🟢
                {:else if bigBrother?.running}🟡
                {:else}🔴{/if}
              </span>
              <div class="flex-1 min-w-0">
                <div class="font-semibold text-sm text-gray-900 dark:text-gray-100 mb-1">
                  Big Brother
                  <span class="inline-block px-1.5 py-0.5 ml-2 bg-purple-500/15 dark:bg-purple-400/20 text-purple-600 dark:text-purple-400 rounded text-[0.6rem] font-bold tracking-tight">Claude Code</span>
                </div>
                <div class="text-xs text-gray-500 dark:text-gray-400">
                  {bigBrother?.endpoint || 'http://localhost:3099'}
                  {#if bigBrother?.running && bigBrother?.pid}
                    • PID: {bigBrother.pid}
                  {/if}
                </div>
              </div>
            </div>
          </div>
          <div class="flex gap-2">
            {#if bigBrother?.running}
              <button class="flex-1 py-1.5 px-3 border-none rounded-md text-xs font-semibold cursor-pointer transition-all bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed" on:click={() => controlBigBrother('stop')} disabled={actionInProgress !== null}>
                {actionInProgress === 'bigbrother-stop' ? '...' : 'Stop'}
              </button>
              <button class="flex-1 py-1.5 px-3 border-none rounded-md text-xs font-semibold cursor-pointer transition-all bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed" on:click={() => controlBigBrother('restart')} disabled={actionInProgress !== null}>
                {actionInProgress === 'bigbrother-restart' ? '...' : 'Restart'}
              </button>
            {:else}
              <button class="flex-1 py-1.5 px-3 border-none rounded-md text-xs font-semibold cursor-pointer transition-all bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed" on:click={() => controlBigBrother('start')} disabled={actionInProgress !== null}>
                {actionInProgress === 'bigbrother-start' ? '...' : 'Start'}
              </button>
            {/if}
          </div>
          {#if bigBrother?.running}
            <div class="flex flex-wrap gap-2 mt-3 pt-3 border-t border-black/10 dark:border-white/10">
              {#if bigBrother.claudeReady}
                <span class="inline-block px-2 py-1 bg-emerald-500/10 dark:bg-emerald-400/15 text-emerald-600 dark:text-emerald-400 rounded text-[0.7rem] font-medium">🤖 Claude Ready</span>
              {:else}
                <span class="inline-block px-2 py-1 bg-amber-500/10 dark:bg-amber-400/15 text-amber-600 dark:text-amber-400 rounded text-[0.7rem] font-medium">Initializing...</span>
              {/if}
              <a
                href="http://localhost:3099"
                target="_blank"
                rel="noopener noreferrer"
                class="inline-block px-2 py-1 bg-purple-500/10 dark:bg-purple-400/15 text-purple-600 dark:text-purple-400 rounded text-[0.7rem] font-medium hover:bg-purple-500/20 dark:hover:bg-purple-400/25 transition-colors"
              >
                🔗 Open Terminal
              </a>
            </div>
          {/if}
        </div>

        <!-- Event Bus (Telemetry) -->
        <div class="border rounded-lg p-3 bg-white dark:bg-gray-800 transition-all hover:shadow-md dark:hover:shadow-black/30 {eventBus?.running ? 'border-2 border-cyan-500/40 dark:border-cyan-400/40 bg-cyan-500/[0.02] dark:bg-cyan-400/[0.03]' : 'border-cyan-500/20 dark:border-cyan-400/20'}">
          <div class="mb-3">
            <div class="flex items-start gap-3">
              <span class="text-xl leading-none">
                {#if eventBus?.running && eventBus?.healthy}🟢
                {:else if eventBus?.running}🟡
                {:else}🔴{/if}
              </span>
              <div class="flex-1 min-w-0">
                <div class="font-semibold text-sm text-gray-900 dark:text-gray-100 mb-1">
                  Event Bus
                  <span class="inline-block px-1.5 py-0.5 ml-2 bg-cyan-500/15 dark:bg-cyan-400/20 text-cyan-600 dark:text-cyan-400 rounded text-[0.6rem] font-bold tracking-tight">Telemetry</span>
                </div>
                <div class="text-xs text-gray-500 dark:text-gray-400">
                  {eventBus?.endpoint || 'http://localhost:3100'}
                  {#if eventBus?.running && eventBus?.eventCount !== undefined}
                    • {eventBus.eventCount} events
                  {/if}
                </div>
              </div>
            </div>
          </div>
          <div class="flex gap-2">
            {#if eventBus?.running}
              <button class="flex-1 py-1.5 px-3 border-none rounded-md text-xs font-semibold cursor-pointer transition-all bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed" on:click={() => controlEventBus('stop')} disabled={actionInProgress !== null}>
                {actionInProgress === 'eventbus-stop' ? '...' : 'Stop'}
              </button>
              <button class="flex-1 py-1.5 px-3 border-none rounded-md text-xs font-semibold cursor-pointer transition-all bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed" on:click={() => controlEventBus('restart')} disabled={actionInProgress !== null}>
                {actionInProgress === 'eventbus-restart' ? '...' : 'Restart'}
              </button>
            {:else}
              <button class="flex-1 py-1.5 px-3 border-none rounded-md text-xs font-semibold cursor-pointer transition-all bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed" on:click={() => controlEventBus('start')} disabled={actionInProgress !== null}>
                {actionInProgress === 'eventbus-start' ? '...' : 'Start'}
              </button>
            {/if}
          </div>
          {#if eventBus?.running}
            <div class="flex flex-wrap gap-2 mt-3 pt-3 border-t border-black/10 dark:border-white/10">
              {#if eventBus.subscribers !== undefined}
                <span class="inline-block px-2 py-1 bg-cyan-500/10 dark:bg-cyan-400/15 text-cyan-600 dark:text-cyan-400 rounded text-[0.7rem] font-medium">📡 {eventBus.subscribers} subscriber{eventBus.subscribers !== 1 ? 's' : ''}</span>
              {/if}
              <a
                href="/debug"
                class="inline-block px-2 py-1 bg-cyan-500/10 dark:bg-cyan-400/15 text-cyan-600 dark:text-cyan-400 rounded text-[0.7rem] font-medium hover:bg-cyan-500/20 dark:hover:bg-cyan-400/25 transition-colors"
              >
                🔗 Debug Dashboard
              </a>
            </div>
          {/if}
        </div>
      {/if}

      <!-- Astro Dev Servers Section -->
      {#if astroServers.length > 0}
        <div class="flex items-center gap-2 py-2 mt-2 font-semibold text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
          <span class="text-base">🚀</span>
          <span class="flex-1">Astro Dev Servers</span>
        </div>
        {#each astroServers as astro (astro.port)}
          <div class="border rounded-lg p-3 bg-white dark:bg-gray-800 transition-all hover:shadow-md dark:hover:shadow-black/30 {astro.isCurrentServer ? 'border-2 border-violet-500/40 dark:border-violet-400/40 bg-violet-500/[0.02] dark:bg-violet-400/[0.03]' : 'border-violet-500/20 dark:border-violet-400/20'}">
            <div class="mb-3">
              <div class="flex items-start gap-3">
                <span class="text-xl leading-none">🟢</span>
                <div class="flex-1 min-w-0">
                  <div class="font-semibold text-sm text-gray-900 dark:text-gray-100 mb-1">
                    Astro Dev Server
                    {#if astro.isCurrentServer}
                      <span class="inline-block px-1.5 py-0.5 ml-2 bg-violet-500/15 dark:bg-violet-400/20 text-violet-600 dark:text-violet-400 rounded text-[0.65rem] font-bold tracking-wide">CURRENT</span>
                    {/if}
                  </div>
                  <div class="text-xs text-gray-500 dark:text-gray-400">
                    Port: {astro.port} • PID: {astro.pid}
                  </div>
                  <div class="text-[0.65rem] text-gray-400 dark:text-gray-500 mt-1 font-mono">{astro.command}</div>
                </div>
              </div>
            </div>
            <div class="flex gap-2">
              <button
                class="flex-1 py-1.5 px-3 border-none rounded-md text-xs font-semibold cursor-pointer transition-all text-white disabled:opacity-50 disabled:cursor-not-allowed {astro.isCurrentServer ? 'bg-red-700 hover:bg-red-800' : 'bg-red-500 hover:bg-red-600'}"
                on:click={() => stopAstroServer(astro.port, astro.isCurrentServer)}
                disabled={actionInProgress !== null}
              >
                {actionInProgress === `astro-${astro.port}` ? '...' : 'Stop'}
              </button>
            </div>
          </div>
        {/each}
      {/if}

      <!-- Voice/Backend Servers Section -->
      {#if servers.length > 0}
        <div class="flex items-center gap-2 py-2 mt-2 font-semibold text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
          <span class="text-base">🔧</span>
          <span class="flex-1">Backend Services</span>
        </div>
      {/if}
      {#each servers as server (server.name)}
        <div class="border border-black/10 dark:border-white/10 rounded-lg p-3 bg-white dark:bg-gray-800 transition-all hover:shadow-md dark:hover:shadow-black/30">
          <div class="mb-3">
            <div class="flex items-start gap-3">
              <span class="text-xl leading-none">{getStatusIcon(server)}</span>
              <div class="flex-1 min-w-0">
                <div class="font-semibold text-sm text-gray-900 dark:text-gray-100 mb-1">{server.displayName}</div>
                <div class="text-xs text-gray-500 dark:text-gray-400">
                  Port: {server.port} • {getStatusText(server)}
                </div>
              </div>
            </div>
          </div>

          {#if server.installed}
            <div class="flex gap-2">
              {#if server.status === 'running'}
                <button class="flex-1 py-1.5 px-3 border-none rounded-md text-xs font-semibold cursor-pointer transition-all bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed" on:click={() => controlServer(server, 'stop')} disabled={actionInProgress !== null}>
                  {actionInProgress === `${server.name}-stop` ? '...' : 'Stop'}
                </button>
                <button class="flex-1 py-1.5 px-3 border-none rounded-md text-xs font-semibold cursor-pointer transition-all bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed" on:click={() => controlServer(server, 'restart')} disabled={actionInProgress !== null}>
                  {actionInProgress === `${server.name}-restart` ? '...' : 'Restart'}
                </button>
              {:else}
                <button class="flex-1 py-1.5 px-3 border-none rounded-md text-xs font-semibold cursor-pointer transition-all bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed" on:click={() => controlServer(server, 'start')} disabled={actionInProgress !== null}>
                  {actionInProgress === `${server.name}-start` ? '...' : 'Start'}
                </button>
              {/if}
            </div>
          {:else}
            <div class="text-xs text-gray-500 dark:text-gray-400 italic p-2 text-center bg-black/5 dark:bg-white/5 rounded-md">Not installed or configured</div>
          {/if}

          {#if server.details && server.status === 'running'}
            <div class="flex flex-wrap gap-2 mt-3 pt-3 border-t border-black/10 dark:border-white/10">
              {#if server.details.model}
                <span class="inline-block px-2 py-1 bg-violet-500/10 dark:bg-violet-400/15 text-violet-600 dark:text-violet-400 rounded text-[0.7rem] font-medium">Model: {server.details.model}</span>
              {/if}
              {#if server.details.device}
                <span class="inline-block px-2 py-1 bg-violet-500/10 dark:bg-violet-400/15 text-violet-600 dark:text-violet-400 rounded text-[0.7rem] font-medium">Device: {server.details.device}</span>
              {/if}
              {#if server.details.voice}
                <span class="inline-block px-2 py-1 bg-violet-500/10 dark:bg-violet-400/15 text-violet-600 dark:text-violet-400 rounded text-[0.7rem] font-medium">Voice: {server.details.voice}</span>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>
