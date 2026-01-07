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
    activeBackend: 'ollama' | 'vllm';
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

  export let isVisible = true;

  let servers: ServerInfo[] = [];
  let astroServers: AstroServer[] = [];
  let llmBackend: LLMBackendInfo | null = null;
  let localModels: LocalModelsInfo | null = null;
  let interpreter: InterpreterInfo | null = null;
  let loading = true;
  let actionInProgress: string | null = null;
  let refreshInterval: ReturnType<typeof setInterval> | null = null;
  let isPageVisible = true;

  const serverConfigs = [
    { name: 'whisper', displayName: 'Whisper STT', endpoint: '/api/whisper-server', port: 9883 },
    { name: 'kokoro', displayName: 'Kokoro TTS', endpoint: '/api/kokoro-server', port: 9882 },
    { name: 'rvc', displayName: 'RVC Voice', endpoint: '/api/rvc-server', port: 9881 },
    { name: 'sovits', displayName: 'GPT-SoVITS', endpoint: '/api/sovits-server', port: 9880 },
  ];

  async function fetchServerStatus() {
    const newServers: ServerInfo[] = [];

    try {
      const llmResponse = await apiFetch('/api/llm-backend/status');
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
      const localModelsResponse = await apiFetch('/api/local-models/status');
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
      const interpreterResponse = await apiFetch('/api/interpreter-status');
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

    for (const config of serverConfigs) {
      try {
        const response = await apiFetch(config.endpoint);
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

    try {
      const astroResponse = await apiFetch('/api/astro-servers');
      if (astroResponse.ok) {
        const astroData = await astroResponse.json();
        astroServers = astroData.servers || [];
      }
    } catch (error) {
      console.error('Failed to fetch Astro servers:', error);
      astroServers = [];
    }

    servers = newServers;
    loading = false;
  }

  function isBackendActive(backend: 'ollama' | 'vllm'): boolean {
    return llmBackend?.activeBackend === backend;
  }

  async function controlLocalModels(action: 'start' | 'stop') {
    actionInProgress = `localModels-${action}`;
    try {
      const response = await apiFetch(`/api/local-models/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        alert(`Failed to ${action} local-models: ${data.error || 'Unknown error'}`);
      } else {
        setTimeout(fetchServerStatus, 2000);
      }
    } catch (error) {
      alert(`Error ${action}ing local-models: ${(error as Error).message}`);
    } finally {
      actionInProgress = null;
    }
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

  async function controlLLMBackend(backend: 'ollama' | 'vllm', action: 'start' | 'stop' | 'restart') {
    actionInProgress = `${backend}-${action}`;
    try {
      const endpoint = backend === 'ollama' ? '/api/llm-backend/ollama' : '/api/llm-backend/vllm';
      const response = await apiFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        alert(`Failed to ${action} ${backend}: ${data.error || 'Unknown error'}`);
      } else {
        setTimeout(fetchServerStatus, 2000);
      }
    } catch (error) {
      alert(`Error ${action}ing ${backend}: ${(error as Error).message}`);
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
            <div class="flex gap-2">
              {#if llmBackend.ollama.running}
                <button class="flex-1 py-1.5 px-3 border-none rounded-md text-xs font-semibold cursor-pointer transition-all bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed" on:click={() => controlLLMBackend('ollama', 'stop')} disabled={actionInProgress !== null}>
                  {actionInProgress === 'ollama-stop' ? '...' : 'Stop'}
                </button>
              {:else}
                <button class="flex-1 py-1.5 px-3 border-none rounded-md text-xs font-semibold cursor-pointer transition-all bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed" on:click={() => controlLLMBackend('ollama', 'start')} disabled={actionInProgress !== null}>
                  {actionInProgress === 'ollama-start' ? '...' : 'Start'}
                </button>
              {/if}
            </div>
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
            <div class="flex gap-2">
              {#if llmBackend.vllm.running}
                <button class="flex-1 py-1.5 px-3 border-none rounded-md text-xs font-semibold cursor-pointer transition-all bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed" on:click={() => controlLLMBackend('vllm', 'stop')} disabled={actionInProgress !== null}>
                  {actionInProgress === 'vllm-stop' ? '...' : 'Stop'}
                </button>
                <button class="flex-1 py-1.5 px-3 border-none rounded-md text-xs font-semibold cursor-pointer transition-all bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed" on:click={() => controlLLMBackend('vllm', 'restart')} disabled={actionInProgress !== null}>
                  {actionInProgress === 'vllm-restart' ? '...' : 'Restart'}
                </button>
              {:else}
                <button class="flex-1 py-1.5 px-3 border-none rounded-md text-xs font-semibold cursor-pointer transition-all bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed" on:click={() => controlLLMBackend('vllm', 'start')} disabled={actionInProgress !== null}>
                  {actionInProgress === 'vllm-start' ? '...' : 'Start'}
                </button>
              {/if}
            </div>
          {:else}
            <div class="text-xs text-gray-500 dark:text-gray-400 italic p-2 text-center bg-black/5 dark:bg-white/5 rounded-md">Not installed - requires Python vLLM package</div>
          {/if}
        </div>

        <!-- Local Models (llama.cpp) -->
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
                  llama.cpp
                  <span class="inline-block px-1.5 py-0.5 ml-2 bg-orange-500/15 dark:bg-orange-400/20 text-orange-600 dark:text-orange-400 rounded text-[0.6rem] font-bold tracking-tight">Semantic Search</span>
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
          <div class="flex gap-2">
            {#if localModels?.running}
              <button class="flex-1 py-1.5 px-3 border-none rounded-md text-xs font-semibold cursor-pointer transition-all bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed" on:click={() => controlLocalModels('stop')} disabled={actionInProgress !== null}>
                {actionInProgress === 'localModels-stop' ? '...' : 'Stop'}
              </button>
            {:else}
              <button class="flex-1 py-1.5 px-3 border-none rounded-md text-xs font-semibold cursor-pointer transition-all bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed" on:click={() => controlLocalModels('start')} disabled={actionInProgress !== null}>
                {actionInProgress === 'localModels-start' ? '...' : 'Start'}
              </button>
            {/if}
          </div>
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
