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

  // Prop to control polling - only poll when visible
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

    // Fetch LLM backend status
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

    // Fetch local-models (llama.cpp) status
    try {
      const localModelsResponse = await apiFetch('/api/local-models/status');
      if (localModelsResponse.ok) {
        const data = await localModelsResponse.json();
        // API returns loadedModels.embedder/generator when running, config values when not
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

    // Fetch Open Interpreter status
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

    // Fetch Astro dev servers
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
        // Wait a moment then refresh
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
        // Wait a moment then refresh
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
        // Wait a moment then refresh
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
        // Wait a moment then refresh
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

  // Start/stop polling based on visibility
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

  // React to visibility changes
  $: if (isVisible && isPageVisible) {
    startPolling();
  } else {
    stopPolling();
  }

  // Page Visibility API - pause when browser tab is hidden
  function handleVisibilityChange() {
    isPageVisible = !document.hidden;
  }

  onMount(() => {
    // Listen for tab visibility changes
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Initial fetch only if visible
    if (isVisible && isPageVisible) {
      startPolling();
    }
  });

  onDestroy(() => {
    stopPolling();
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  });
</script>

<div class="server-status-container">
  <div class="header">
    <h3 class="title">Server Status</h3>
    <button class="refresh-btn" on:click={fetchServerStatus} disabled={loading}>
      {loading ? '⏳' : '🔄'}
    </button>
  </div>

  {#if loading && servers.length === 0 && astroServers.length === 0}
    <div class="loading">Loading server status...</div>
  {:else}
    <div class="server-list">
      <!-- LLM Backend Section -->
      {#if llmBackend}
        <div class="section-header">
          <span class="section-icon">🧠</span>
          <span class="section-title">LLM Backend</span>
        </div>

        <!-- Ollama -->
        <div class="server-card llm-card" class:active-backend={isBackendActive('ollama')}>
          <div class="server-header">
            <div class="server-info">
              <span class="status-icon">
                {#if !llmBackend.ollama.installed}⚠️
                {:else if llmBackend.ollama.running}🟢
                {:else}🔴{/if}
              </span>
              <div class="server-details">
                <div class="server-name">
                  Ollama
                  {#if llmBackend.activeBackend === 'ollama'}
                    <span class="active-badge">ACTIVE</span>
                  {/if}
                </div>
                <div class="server-meta">
                  {llmBackend.ollama.endpoint}
                  {#if llmBackend.ollama.running && llmBackend.ollama.model}
                    • {llmBackend.ollama.model}
                  {/if}
                </div>
              </div>
            </div>
          </div>
          {#if llmBackend.ollama.installed}
            <div class="server-actions">
              {#if llmBackend.ollama.running}
                <button
                  class="action-btn stop"
                  on:click={() => controlLLMBackend('ollama', 'stop')}
                  disabled={actionInProgress !== null}
                >
                  {actionInProgress === 'ollama-stop' ? '...' : 'Stop'}
                </button>
              {:else}
                <button
                  class="action-btn start"
                  on:click={() => controlLLMBackend('ollama', 'start')}
                  disabled={actionInProgress !== null}
                >
                  {actionInProgress === 'ollama-start' ? '...' : 'Start'}
                </button>
              {/if}
            </div>
          {:else}
            <div class="not-installed-msg">Not installed</div>
          {/if}
        </div>

        <!-- vLLM -->
        <div class="server-card llm-card" class:active-backend={llmBackend.activeBackend === 'vllm'}>
          <div class="server-header">
            <div class="server-info">
              <span class="status-icon">
                {#if !llmBackend.vllm.installed}⚠️
                {:else if llmBackend.vllm.running}🟢
                {:else}🔴{/if}
              </span>
              <div class="server-details">
                <div class="server-name">
                  vLLM
                  {#if llmBackend.activeBackend === 'vllm'}
                    <span class="active-badge">ACTIVE</span>
                  {/if}
                </div>
                <div class="server-meta">
                  {llmBackend.vllm.endpoint}
                  {#if llmBackend.vllm.model}
                    • {llmBackend.vllm.model}
                  {/if}
                </div>
              </div>
            </div>
          </div>
          {#if llmBackend.vllm.installed}
            <div class="server-actions">
              {#if llmBackend.vllm.running}
                <button
                  class="action-btn stop"
                  on:click={() => controlLLMBackend('vllm', 'stop')}
                  disabled={actionInProgress !== null}
                >
                  {actionInProgress === 'vllm-stop' ? '...' : 'Stop'}
                </button>
                <button
                  class="action-btn restart"
                  on:click={() => controlLLMBackend('vllm', 'restart')}
                  disabled={actionInProgress !== null}
                >
                  {actionInProgress === 'vllm-restart' ? '...' : 'Restart'}
                </button>
              {:else}
                <button
                  class="action-btn start"
                  on:click={() => controlLLMBackend('vllm', 'start')}
                  disabled={actionInProgress !== null}
                >
                  {actionInProgress === 'vllm-start' ? '...' : 'Start'}
                </button>
              {/if}
            </div>
          {:else}
            <div class="not-installed-msg">Not installed - requires Python vLLM package</div>
          {/if}
        </div>

        <!-- Local Models (llama.cpp) -->
        <div class="server-card llama-card" class:running={localModels?.running}>
          <div class="server-header">
            <div class="server-info">
              <span class="status-icon">
                {#if localModels?.running}
                  {#if localModels.embedder.loaded}🟢{:else}🟡{/if}
                {:else}🔴{/if}
              </span>
              <div class="server-details">
                <div class="server-name">
                  llama.cpp
                  <span class="semantic-badge">Semantic Search</span>
                </div>
                <div class="server-meta">
                  {localModels?.endpoint || 'http://127.0.0.1:4324'}
                  {#if localModels?.running && localModels.embedder.loaded}
                    • {localModels.embedder.model}
                  {/if}
                </div>
              </div>
            </div>
          </div>
          <div class="server-actions">
            {#if localModels?.running}
              <button
                class="action-btn stop"
                on:click={() => controlLocalModels('stop')}
                disabled={actionInProgress !== null}
              >
                {actionInProgress === 'localModels-stop' ? '...' : 'Stop'}
              </button>
            {:else}
              <button
                class="action-btn start"
                on:click={() => controlLocalModels('start')}
                disabled={actionInProgress !== null}
              >
                {actionInProgress === 'localModels-start' ? '...' : 'Start'}
              </button>
            {/if}
          </div>
          {#if localModels?.running}
            <div class="server-details-extra">
              {#if localModels.embedder.loaded}
                <span class="detail-badge embedder">🔍 Embeddings: {localModels.embedder.model}</span>
              {:else}
                <span class="detail-badge loading">Embeddings: Loading...</span>
              {/if}
              {#if localModels.generator.loaded}
                <span class="detail-badge generator">💬 LLM: {localModels.generator.model}</span>
              {/if}
            </div>
          {/if}
        </div>

        <!-- Open Interpreter (Tool Executor) -->
        <div class="server-card interpreter-card" class:running={interpreter?.running}>
          <div class="server-header">
            <div class="server-info">
              <span class="status-icon">
                {#if !interpreter?.available}⚠️
                {:else if interpreter?.running && interpreter?.healthy}🟢
                {:else if interpreter?.running}🟡
                {:else}🔴{/if}
              </span>
              <div class="server-details">
                <div class="server-name">
                  Open Interpreter
                  <span class="tool-badge">Tool Executor</span>
                  {#if interpreter?.enabled}
                    <span class="enabled-badge">ENABLED</span>
                  {/if}
                </div>
                <div class="server-meta">
                  {interpreter?.endpoint || 'http://localhost:4325'}
                  {#if interpreter?.running && interpreter?.config?.safeMode !== undefined}
                    • {interpreter.config.safeMode ? 'Safe Mode' : 'Unrestricted'}
                  {/if}
                </div>
              </div>
            </div>
          </div>
          {#if interpreter?.available}
            <div class="server-actions">
              {#if interpreter?.running}
                <button
                  class="action-btn stop"
                  on:click={() => controlInterpreter('stop')}
                  disabled={actionInProgress !== null}
                >
                  {actionInProgress === 'interpreter-stop' ? '...' : 'Stop'}
                </button>
                <button
                  class="action-btn restart"
                  on:click={() => controlInterpreter('restart')}
                  disabled={actionInProgress !== null}
                >
                  {actionInProgress === 'interpreter-restart' ? '...' : 'Restart'}
                </button>
              {:else}
                <button
                  class="action-btn start"
                  on:click={() => controlInterpreter('start')}
                  disabled={actionInProgress !== null}
                >
                  {actionInProgress === 'interpreter-start' ? '...' : 'Start'}
                </button>
              {/if}
            </div>
          {:else}
            <div class="not-installed-msg">
              Not installed - requires Python open-interpreter package
            </div>
          {/if}
          {#if interpreter?.running && interpreter?.config}
            <div class="server-details-extra">
              {#if interpreter.config.autoRun}
                <span class="detail-badge warning">⚡ Auto-Run Enabled</span>
              {/if}
              {#if interpreter.config.maxIterations}
                <span class="detail-badge">Max Iterations: {interpreter.config.maxIterations}</span>
              {/if}
            </div>
          {/if}
        </div>
      {/if}

      <!-- Astro Dev Servers Section -->
      {#if astroServers.length > 0}
        <div class="section-header">
          <span class="section-icon">🚀</span>
          <span class="section-title">Astro Dev Servers</span>
        </div>
        {#each astroServers as astro (astro.port)}
          <div class="server-card astro-card" class:current-server={astro.isCurrentServer}>
            <div class="server-header">
              <div class="server-info">
                <span class="status-icon">🟢</span>
                <div class="server-details">
                  <div class="server-name">
                    Astro Dev Server
                    {#if astro.isCurrentServer}
                      <span class="current-badge">CURRENT</span>
                    {/if}
                  </div>
                  <div class="server-meta">
                    Port: {astro.port} • PID: {astro.pid}
                  </div>
                  <div class="server-command">{astro.command}</div>
                </div>
              </div>
            </div>

            <div class="server-actions">
              <button
                class="action-btn stop"
                class:danger={astro.isCurrentServer}
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
        <div class="section-header">
          <span class="section-icon">🔧</span>
          <span class="section-title">Backend Services</span>
        </div>
      {/if}
      {#each servers as server (server.name)}
        <div class="server-card">
          <div class="server-header">
            <div class="server-info">
              <span class="status-icon">{getStatusIcon(server)}</span>
              <div class="server-details">
                <div class="server-name">{server.displayName}</div>
                <div class="server-meta">
                  Port: {server.port} • {getStatusText(server)}
                </div>
              </div>
            </div>
          </div>

          {#if server.installed}
            <div class="server-actions">
              {#if server.status === 'running'}
                <button
                  class="action-btn stop"
                  on:click={() => controlServer(server, 'stop')}
                  disabled={actionInProgress !== null}
                >
                  {actionInProgress === `${server.name}-stop` ? '...' : 'Stop'}
                </button>
                <button
                  class="action-btn restart"
                  on:click={() => controlServer(server, 'restart')}
                  disabled={actionInProgress !== null}
                >
                  {actionInProgress === `${server.name}-restart` ? '...' : 'Restart'}
                </button>
              {:else}
                <button
                  class="action-btn start"
                  on:click={() => controlServer(server, 'start')}
                  disabled={actionInProgress !== null}
                >
                  {actionInProgress === `${server.name}-start` ? '...' : 'Start'}
                </button>
              {/if}
            </div>
          {:else}
            <div class="not-installed-msg">
              Not installed or configured
            </div>
          {/if}

          {#if server.details && server.status === 'running'}
            <div class="server-details-extra">
              {#if server.details.model}
                <span class="detail-badge">Model: {server.details.model}</span>
              {/if}
              {#if server.details.device}
                <span class="detail-badge">Device: {server.details.device}</span>
              {/if}
              {#if server.details.voice}
                <span class="detail-badge">Voice: {server.details.voice}</span>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .server-status-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: 1rem;
    gap: 1rem;
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .title {
    font-size: 1rem;
    font-weight: 600;
    color: rgb(17 24 39);
    margin: 0;
  }

  :global(.dark) .title {
    color: rgb(243 244 246);
  }

  .refresh-btn {
    background: transparent;
    border: 1px solid rgba(0, 0, 0, 0.1);
    border-radius: 0.375rem;
    padding: 0.25rem 0.5rem;
    cursor: pointer;
    font-size: 1rem;
    transition: all 0.2s;
  }

  :global(.dark) .refresh-btn {
    border-color: rgba(255, 255, 255, 0.2);
  }

  .refresh-btn:hover:not(:disabled) {
    background: rgba(0, 0, 0, 0.05);
  }

  :global(.dark) .refresh-btn:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.05);
  }

  .refresh-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .loading {
    text-align: center;
    padding: 2rem;
    color: rgb(107 114 128);
    font-size: 0.875rem;
  }

  :global(.dark) .loading {
    color: rgb(156 163 175);
  }

  .server-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    overflow-y: auto;
  }

  .server-card {
    border: 1px solid rgba(0, 0, 0, 0.1);
    border-radius: 0.5rem;
    padding: 0.75rem;
    background: white;
    transition: all 0.2s;
  }

  :global(.dark) .server-card {
    background: rgb(31 41 55);
    border-color: rgba(255, 255, 255, 0.1);
  }

  .server-card:hover {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }

  :global(.dark) .server-card:hover {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  }

  .server-header {
    margin-bottom: 0.75rem;
  }

  .server-info {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
  }

  .status-icon {
    font-size: 1.25rem;
    line-height: 1;
  }

  .server-details {
    flex: 1;
    min-width: 0;
  }

  .server-name {
    font-weight: 600;
    font-size: 0.875rem;
    color: rgb(17 24 39);
    margin-bottom: 0.25rem;
  }

  :global(.dark) .server-name {
    color: rgb(243 244 246);
  }

  .server-meta {
    font-size: 0.75rem;
    color: rgb(107 114 128);
  }

  :global(.dark) .server-meta {
    color: rgb(156 163 175);
  }

  .server-actions {
    display: flex;
    gap: 0.5rem;
  }

  .action-btn {
    flex: 1;
    padding: 0.4rem 0.75rem;
    border: none;
    border-radius: 0.375rem;
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }

  .action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .action-btn.start {
    background: rgb(34 197 94);
    color: white;
  }

  .action-btn.start:hover:not(:disabled) {
    background: rgb(22 163 74);
  }

  .action-btn.stop {
    background: rgb(239 68 68);
    color: white;
  }

  .action-btn.stop:hover:not(:disabled) {
    background: rgb(220 38 38);
  }

  .action-btn.restart {
    background: rgb(234 179 8);
    color: white;
  }

  .action-btn.restart:hover:not(:disabled) {
    background: rgb(202 138 4);
  }

  .not-installed-msg {
    font-size: 0.75rem;
    color: rgb(107 114 128);
    font-style: italic;
    padding: 0.5rem;
    text-align: center;
    background: rgba(0, 0, 0, 0.05);
    border-radius: 0.375rem;
  }

  :global(.dark) .not-installed-msg {
    color: rgb(156 163 175);
    background: rgba(255, 255, 255, 0.05);
  }

  .server-details-extra {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.75rem;
    padding-top: 0.75rem;
    border-top: 1px solid rgba(0, 0, 0, 0.1);
  }

  :global(.dark) .server-details-extra {
    border-top-color: rgba(255, 255, 255, 0.1);
  }

  .detail-badge {
    display: inline-block;
    padding: 0.25rem 0.5rem;
    background: rgba(124, 58, 237, 0.1);
    color: rgb(124 58 237);
    border-radius: 0.25rem;
    font-size: 0.7rem;
    font-weight: 500;
  }

  :global(.dark) .detail-badge {
    background: rgba(167, 139, 250, 0.15);
    color: rgb(167 139 250);
  }

  .section-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0;
    margin-top: 0.5rem;
    font-weight: 600;
    font-size: 0.8rem;
    color: rgb(107 114 128);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  :global(.dark) .section-header {
    color: rgb(156 163 175);
  }

  .section-icon {
    font-size: 1rem;
  }

  .section-title {
    flex: 1;
  }

  .astro-card {
    border-color: rgba(124, 58, 237, 0.2);
  }

  :global(.dark) .astro-card {
    border-color: rgba(167, 139, 250, 0.2);
  }

  .astro-card.current-server {
    border-width: 2px;
    border-color: rgba(124, 58, 237, 0.4);
    background: rgba(124, 58, 237, 0.02);
  }

  :global(.dark) .astro-card.current-server {
    border-color: rgba(167, 139, 250, 0.4);
    background: rgba(167, 139, 250, 0.03);
  }

  .current-badge {
    display: inline-block;
    padding: 0.125rem 0.375rem;
    margin-left: 0.5rem;
    background: rgba(124, 58, 237, 0.15);
    color: rgb(124 58 237);
    border-radius: 0.25rem;
    font-size: 0.65rem;
    font-weight: 700;
    letter-spacing: 0.05em;
  }

  :global(.dark) .current-badge {
    background: rgba(167, 139, 250, 0.2);
    color: rgb(167 139 250);
  }

  .server-command {
    font-size: 0.65rem;
    color: rgb(156 163 175);
    margin-top: 0.25rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }

  :global(.dark) .server-command {
    color: rgb(107 114 128);
  }

  .action-btn.danger {
    background: rgb(185 28 28);
  }

  .action-btn.danger:hover:not(:disabled) {
    background: rgb(153 27 27);
  }

  /* LLM Backend cards */
  .llm-card {
    border-color: rgba(59, 130, 246, 0.2);
  }

  :global(.dark) .llm-card {
    border-color: rgba(96, 165, 250, 0.2);
  }

  .llm-card.active-backend {
    border-width: 2px;
    border-color: rgba(34, 197, 94, 0.4);
    background: rgba(34, 197, 94, 0.02);
  }

  :global(.dark) .llm-card.active-backend {
    border-color: rgba(74, 222, 128, 0.4);
    background: rgba(74, 222, 128, 0.03);
  }

  .active-badge {
    display: inline-block;
    padding: 0.125rem 0.375rem;
    margin-left: 0.5rem;
    background: rgba(34, 197, 94, 0.15);
    color: rgb(34 197 94);
    border-radius: 0.25rem;
    font-size: 0.65rem;
    font-weight: 700;
    letter-spacing: 0.05em;
  }

  :global(.dark) .active-badge {
    background: rgba(74, 222, 128, 0.2);
    color: rgb(74 222 128);
  }

  /* llama.cpp card styles */
  .llama-card {
    border-color: rgba(249, 115, 22, 0.2);
  }

  :global(.dark) .llama-card {
    border-color: rgba(251, 146, 60, 0.2);
  }

  .llama-card.running {
    border-width: 2px;
    border-color: rgba(249, 115, 22, 0.4);
    background: rgba(249, 115, 22, 0.02);
  }

  :global(.dark) .llama-card.running {
    border-color: rgba(251, 146, 60, 0.4);
    background: rgba(251, 146, 60, 0.03);
  }

  .semantic-badge {
    display: inline-block;
    padding: 0.125rem 0.375rem;
    margin-left: 0.5rem;
    background: rgba(249, 115, 22, 0.15);
    color: rgb(249 115 22);
    border-radius: 0.25rem;
    font-size: 0.6rem;
    font-weight: 700;
    letter-spacing: 0.03em;
  }

  :global(.dark) .semantic-badge {
    background: rgba(251, 146, 60, 0.2);
    color: rgb(251 146 60);
  }

  .detail-badge.embedder {
    background: rgba(59, 130, 246, 0.1);
    color: rgb(59 130 246);
  }

  :global(.dark) .detail-badge.embedder {
    background: rgba(96, 165, 250, 0.15);
    color: rgb(96 165 250);
  }

  .detail-badge.generator {
    background: rgba(16, 185, 129, 0.1);
    color: rgb(16 185 129);
  }

  :global(.dark) .detail-badge.generator {
    background: rgba(52, 211, 153, 0.15);
    color: rgb(52 211 153);
  }

  .detail-badge.loading {
    background: rgba(234, 179, 8, 0.1);
    color: rgb(234 179 8);
  }

  :global(.dark) .detail-badge.loading {
    background: rgba(250, 204, 21, 0.15);
    color: rgb(250 204 21);
  }

  /* Open Interpreter card styles */
  .interpreter-card {
    border-color: rgba(139, 92, 246, 0.2);
  }

  :global(.dark) .interpreter-card {
    border-color: rgba(167, 139, 250, 0.2);
  }

  .interpreter-card.running {
    border-width: 2px;
    border-color: rgba(139, 92, 246, 0.4);
    background: rgba(139, 92, 246, 0.02);
  }

  :global(.dark) .interpreter-card.running {
    border-color: rgba(167, 139, 250, 0.4);
    background: rgba(167, 139, 250, 0.03);
  }

  .tool-badge {
    display: inline-block;
    padding: 0.125rem 0.375rem;
    margin-left: 0.5rem;
    background: rgba(139, 92, 246, 0.15);
    color: rgb(139 92 246);
    border-radius: 0.25rem;
    font-size: 0.6rem;
    font-weight: 700;
    letter-spacing: 0.03em;
  }

  :global(.dark) .tool-badge {
    background: rgba(167, 139, 250, 0.2);
    color: rgb(167 139 250);
  }

  .enabled-badge {
    display: inline-block;
    padding: 0.125rem 0.375rem;
    margin-left: 0.5rem;
    background: rgba(34, 197, 94, 0.15);
    color: rgb(34 197 94);
    border-radius: 0.25rem;
    font-size: 0.6rem;
    font-weight: 700;
    letter-spacing: 0.03em;
  }

  :global(.dark) .enabled-badge {
    background: rgba(74, 222, 128, 0.2);
    color: rgb(74 222 128);
  }

  .detail-badge.warning {
    background: rgba(234, 179, 8, 0.1);
    color: rgb(234 179 8);
  }

  :global(.dark) .detail-badge.warning {
    background: rgba(250, 204, 21, 0.15);
    color: rgb(250 204 21);
  }
</style>
