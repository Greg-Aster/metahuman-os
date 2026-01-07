<script lang="ts">
  import { onMount } from 'svelte';
  import { apiFetch } from '../lib/client/api-config';
  import { statusRefreshTrigger } from '../stores/navigation';
  import LocalModelsSettings from './LocalModelsSettings.svelte';

  // Backend types (local LLM backends only - remote server is parallel, not a backend choice)
  type BackendType = 'ollama' | 'vllm' | 'auto';

  // Backend status
  interface BackendStatus {
    backend: BackendType;
    running: boolean;
    model?: string;
    endpoint: string;
    health: 'healthy' | 'starting' | 'degraded' | 'offline';
    resolvedBackend?: 'ollama' | 'vllm' | 'offline';
  }

  interface AvailableBackends {
    ollama: { installed: boolean; running: boolean; model?: string };
    vllm: { installed: boolean; running: boolean; model?: string };
  }

  // Big Brother escalation provider options
  type BigBrotherProvider = 'claude-code' | 'open-interpreter' | 'aider' | 'gemini-cli' | 'qwen-code' | 'codex';

  const bigBrotherProviderOptions: { value: BigBrotherProvider; label: string; description: string }[] = [
    { value: 'claude-code', label: 'Claude Code', description: 'Uses your Claude Pro subscription via CLI' },
    { value: 'open-interpreter', label: 'Open Interpreter', description: 'Uses RunPod or other configured LLM' },
    { value: 'aider', label: 'Aider', description: 'AI pair programming with git integration' },
    { value: 'gemini-cli', label: 'Gemini CLI', description: 'Google Gemini CLI' },
    { value: 'qwen-code', label: 'Qwen Code', description: 'Qwen Code CLI' },
    { value: 'codex', label: 'Codex', description: 'OpenAI Codex CLI' },
  ];

  // Big Brother config
  interface BigBrotherConfig {
    enabled: boolean;
    provider: string;
    escalateOnStuck: boolean;
    escalateOnRepeatedFailures: boolean;
    maxRetries: number;
    includeFullScratchpad: boolean;
    autoApplySuggestions: boolean;
  }

  let activeBackend: BackendType = 'ollama';
  let status: BackendStatus | null = null;
  let available: AvailableBackends | null = null;

  // vLLM config - these will be populated from server config on load
  let vllmModel = '';
  let vllmGpuUtil = 0.7;
  let vllmEndpoint = 'http://localhost:8000';
  let vllmEnforceEager = true;
  let vllmAutoUtilization = false;
  let vllmMaxModelLen = 4096;
  let vllmMaxTokens = 2048;
  let vllmEnableThinking = true;

  // Ollama config
  let ollamaEndpoint = 'http://localhost:11434';
  let ollamaModel = 'qwen3:14b';

  // Remote server connection
  let remoteServerUrl = '';
  let resolvedBackend: 'ollama' | 'vllm' | 'offline' | null = null;

  // Open Interpreter status
  let interpreterStatus: { running: boolean; version?: string; available: boolean } | null = null;
  let interpreterStarting = false;
  let interpreterStopping = false;

  // Big Brother config
  let bigBrotherConfig: BigBrotherConfig | null = null;
  let bigBrotherEnabled = false;
  let bigBrotherDelegateAll = false;
  let bigBrotherProvider: string = 'claude-code';
  let savingBigBrother = false;

  // Embedding config (for semantic memory search)
  let embeddingEnabled = true;
  let embeddingModel = 'nomic-embed-text';
  let embeddingCpuOnly = true;
  let embeddingSaving = false;

  // Remote server test state
  let testingRemoteServer = false;
  let remoteServerTestResult: {
    success: boolean;
    latencyMs?: number;
    serverVersion?: string;
    models?: Array<{ id: string; model: string; provider: string }>;
    error?: string;
    needsAuth?: boolean;
  } | null = null;

  // Remote server credentials
  let remoteServerUsername = '';
  let remoteServerPassword = '';
  let remoteServerSaveCredentials = true;

  // UI state
  let loading = true;
  let switching = false;
  let savingConfig = false;
  let savingRemoteConfig = false;
  let vllmStarting = false;
  let vllmStopping = false;
  let error: string | null = null;

  onMount(() => {
    loadStatus();
    loadInterpreterStatus();
    loadBigBrotherConfig();
    loadEmbeddingConfig();
  });

  async function loadInterpreterStatus() {
    try {
      const res = await apiFetch('/api/interpreter-status');
      if (res.ok) {
        interpreterStatus = await res.json();
      }
    } catch (err) {
      console.error('[BackendSettings] Error loading interpreter status:', err);
    }
  }

  async function startInterpreter() {
    interpreterStarting = true;
    error = null;

    try {
      const res = await apiFetch('/api/interpreter-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      });

      if (res.ok) {
        await loadInterpreterStatus();
      } else {
        const data = await res.json();
        error = data.error || 'Failed to start Open Interpreter';
      }
    } catch (err) {
      error = 'Failed to start Open Interpreter';
    } finally {
      interpreterStarting = false;
    }
  }

  async function stopInterpreter() {
    interpreterStopping = true;
    error = null;

    try {
      const res = await apiFetch('/api/interpreter-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' }),
      });

      if (res.ok) {
        await loadInterpreterStatus();
      } else {
        const data = await res.json();
        error = data.error || 'Failed to stop Open Interpreter';
      }
    } catch (err) {
      error = 'Failed to stop Open Interpreter';
    } finally {
      interpreterStopping = false;
    }
  }

  async function loadStatus() {
    try {
      const res = await apiFetch('/api/llm-backend/status');
      if (res.ok) {
        const data = await res.json();
        status = data.active;
        available = data.available;
        activeBackend = data.config.activeBackend || 'ollama';
        resolvedBackend = data.active?.resolvedBackend || null;

        vllmModel = data.config.vllm?.model || '';
        vllmGpuUtil = data.config.vllm?.gpuMemoryUtilization || 0.7;
        vllmEndpoint = data.config.vllm?.endpoint || 'http://localhost:8000';
        vllmEnforceEager = data.config.vllm?.enforceEager ?? true;
        vllmAutoUtilization = data.config.vllm?.autoUtilization ?? false;
        vllmMaxModelLen = data.config.vllm?.maxModelLen || 4096;
        vllmMaxTokens = data.config.vllm?.maxTokens || 2048;
        vllmEnableThinking = data.config.vllm?.enableThinking ?? true;

        ollamaEndpoint = data.config.ollama?.endpoint || 'http://localhost:11434';
        ollamaModel = data.config.ollama?.defaultModel || 'qwen3:14b';

        if (data.config.remote?.serverUrl) {
          remoteServerUrl = data.config.remote.serverUrl;
        }

        error = null;
      }
    } catch (err) {
      console.error('[BackendSettings] Error loading status:', err);
      error = 'Failed to load backend status';
    } finally {
      loading = false;
    }
  }

  async function loadEmbeddingConfig() {
    try {
      const res = await apiFetch('/api/embeddings-control');
      if (res.ok) {
        const data = await res.json();
        embeddingEnabled = data.enabled ?? true;
        embeddingModel = data.model ?? 'nomic-embed-text';
        embeddingCpuOnly = data.cpuOnly ?? true;
      }
    } catch (err) {
      console.error('[BackendSettings] Error loading embedding config:', err);
    }
  }

  async function loadBigBrotherConfig() {
    try {
      const res = await apiFetch('/api/big-brother-config');
      if (res.ok) {
        const data = await res.json();
        bigBrotherConfig = data.config;
        bigBrotherEnabled = data.config?.enabled ?? false;
        bigBrotherDelegateAll = data.config?.delegateAll ?? false;
        bigBrotherProvider = data.config?.provider || 'claude-code';
      }
    } catch (err) {
      console.error('[BackendSettings] Error loading Big Brother config:', err);
    }
  }

  async function saveBigBrotherConfig() {
    savingBigBrother = true;
    error = null;

    try {
      const res = await apiFetch('/api/big-brother-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: bigBrotherEnabled,
          delegateAll: bigBrotherDelegateAll,
          provider: bigBrotherProvider,
          escalateOnStuck: bigBrotherConfig?.escalateOnStuck ?? true,
          escalateOnRepeatedFailures: bigBrotherConfig?.escalateOnRepeatedFailures ?? true,
          maxRetries: bigBrotherConfig?.maxRetries ?? 1,
          includeFullScratchpad: bigBrotherConfig?.includeFullScratchpad ?? true,
          autoApplySuggestions: bigBrotherConfig?.autoApplySuggestions ?? false,
        }),
      });

      if (res.ok) {
        await loadBigBrotherConfig();
        statusRefreshTrigger.update(n => n + 1);
      } else {
        const data = await res.json();
        error = data.error || 'Failed to save Big Brother config';
      }
    } catch (err) {
      error = 'Failed to save Big Brother config';
    } finally {
      savingBigBrother = false;
    }
  }

  function getBigBrotherProviderLabel(provider: BigBrotherProvider): string {
    const opt = bigBrotherProviderOptions.find(o => o.value === provider);
    return opt?.label || provider;
  }

  async function saveEmbeddingConfig() {
    embeddingSaving = true;
    try {
      const res = await apiFetch('/api/embeddings-control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: embeddingEnabled,
          cpuOnly: embeddingCpuOnly,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        error = data.error || 'Failed to save embedding config';
      } else {
        await loadEmbeddingConfig();
      }
    } catch (err) {
      error = 'Failed to save embedding config';
    } finally {
      embeddingSaving = false;
    }
  }

  async function switchBackend(to: BackendType) {
    if (switching || to === activeBackend) return;
    switching = true;
    error = null;

    try {
      const res = await apiFetch('/api/llm-backend/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backend: to }),
      });

      if (res.ok) {
        activeBackend = to;
        await loadStatus();
        window.dispatchEvent(new CustomEvent('backend-changed', { detail: { backend: to } }));
        statusRefreshTrigger.update(n => n + 1);
      } else {
        const data = await res.json();
        error = data.error || 'Failed to switch backend';
      }
    } catch (err) {
      error = 'Failed to switch backend';
    } finally {
      switching = false;
    }
  }

  async function testRemoteServerConnection() {
    if (!remoteServerUrl) {
      remoteServerTestResult = { success: false, error: 'Please enter a server URL' };
      return;
    }

    testingRemoteServer = true;
    remoteServerTestResult = null;
    error = null;

    try {
      const payload: Record<string, any> = { serverUrl: remoteServerUrl };
      if (remoteServerUsername && remoteServerPassword) {
        payload.username = remoteServerUsername;
        payload.password = remoteServerPassword;
      }

      const res = await apiFetch('/api/remote-server/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      remoteServerTestResult = res.ok ? data : { success: false, error: data.error || 'Test failed' };
    } catch (err) {
      remoteServerTestResult = { success: false, error: 'Failed to test connection' };
    } finally {
      testingRemoteServer = false;
    }
  }

  async function connectToRemoteServer() {
    if (!remoteServerUrl) {
      error = 'Please enter a server URL';
      return;
    }

    savingRemoteConfig = true;
    error = null;

    try {
      const payload: Record<string, any> = { serverUrl: remoteServerUrl };
      if (remoteServerUsername && remoteServerPassword) {
        payload.username = remoteServerUsername;
        payload.password = remoteServerPassword;
        payload.saveCredentials = remoteServerSaveCredentials;
      }

      const res = await apiFetch('/api/remote-server/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        remoteServerTestResult = {
          success: true,
          latencyMs: data.latencyMs,
          serverVersion: data.serverVersion,
          models: data.models,
        };
        await loadStatus();
        statusRefreshTrigger.update(n => n + 1);
      } else {
        remoteServerTestResult = { success: false, error: data.error || 'Connection failed' };
      }
    } catch (err) {
      error = 'Failed to connect to server';
    } finally {
      savingRemoteConfig = false;
    }
  }

  async function disconnectRemoteServer() {
    savingRemoteConfig = true;
    error = null;

    try {
      const res = await apiFetch('/api/remote-server/disconnect', { method: 'DELETE' });
      if (res.ok) {
        remoteServerUrl = '';
        remoteServerTestResult = null;
        await loadStatus();
        statusRefreshTrigger.update(n => n + 1);
      } else {
        const data = await res.json();
        error = data.error || 'Failed to disconnect';
      }
    } catch (err) {
      error = 'Failed to disconnect';
    } finally {
      savingRemoteConfig = false;
    }
  }

  async function saveVllmConfig() {
    savingConfig = true;
    error = null;

    try {
      const res = await apiFetch('/api/llm-backend/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vllm: {
            model: vllmModel,
            gpuMemoryUtilization: vllmGpuUtil,
            endpoint: vllmEndpoint,
            enforceEager: vllmEnforceEager,
            autoUtilization: vllmAutoUtilization,
            maxModelLen: vllmMaxModelLen,
            maxTokens: vllmMaxTokens,
            enableThinking: vllmEnableThinking,
          },
        }),
      });

      if (res.ok) {
        await loadStatus();
      } else {
        const data = await res.json();
        error = data.error || 'Failed to save config';
      }
    } catch (err) {
      error = 'Failed to save config';
    } finally {
      savingConfig = false;
    }
  }

  async function startVllm() {
    vllmStarting = true;
    error = null;

    try {
      const res = await apiFetch('/api/llm-backend/vllm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start', model: vllmModel, gpuMemoryUtilization: vllmGpuUtil }),
      });

      const data = await res.json();
      if (!data.success) {
        error = data.error || 'Failed to start vLLM';
      } else {
        await loadStatus();
      }
    } catch (err) {
      error = 'Failed to start vLLM';
    } finally {
      vllmStarting = false;
    }
  }

  async function stopVllm() {
    vllmStopping = true;
    error = null;

    try {
      const res = await apiFetch('/api/llm-backend/vllm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' }),
      });

      if (res.ok) {
        await loadStatus();
      }
    } catch (err) {
      error = 'Failed to stop vLLM';
    } finally {
      vllmStopping = false;
    }
  }

  let ollamaUnloading = false;
  let ollamaStopping = false;
  let ollamaStarting = false;

  async function unloadOllama() {
    ollamaUnloading = true;
    error = null;

    try {
      const res = await apiFetch('/api/llm-backend/ollama', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unload' }),
      });

      const data = await res.json();
      if (data.success) {
        await loadStatus();
      } else {
        error = data.error || 'Failed to unload Ollama models';
      }
    } catch (err) {
      error = 'Failed to unload Ollama models';
    } finally {
      ollamaUnloading = false;
    }
  }

  async function stopOllama() {
    ollamaStopping = true;
    error = null;

    try {
      const res = await apiFetch('/api/llm-backend/ollama', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' }),
      });

      const data = await res.json();
      if (data.success) {
        await loadStatus();
      } else {
        error = data.error || 'Failed to stop Ollama service';
      }
    } catch (err) {
      error = 'Failed to stop Ollama service';
    } finally {
      ollamaStopping = false;
    }
  }

  async function startOllama() {
    ollamaStarting = true;
    error = null;

    try {
      const res = await apiFetch('/api/llm-backend/ollama', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      });

      const data = await res.json();
      if (data.success) {
        await loadStatus();
      } else {
        error = data.error || 'Failed to start Ollama service';
      }
    } catch (err) {
      error = 'Failed to start Ollama service';
    } finally {
      ollamaStarting = false;
    }
  }

  function getBackendIcon(backend: BackendType): string {
    switch (backend) {
      case 'ollama': return '🦙';
      case 'vllm': return '⚡';
      case 'auto': return '🔄';
      default: return '❓';
    }
  }

  function getBackendLabel(backend: BackendType): string {
    switch (backend) {
      case 'ollama': return 'Ollama';
      case 'vllm': return 'vLLM';
      case 'auto': return 'Auto';
      default: return 'Unknown';
    }
  }
</script>

<div>
  <h3 class="text-lg font-semibold mb-2 text-gray-900 dark:text-gray-100">LLM Backend</h3>
  <p class="text-sm text-gray-500 dark:text-gray-400 mb-5">
    Configure local backends (Ollama/vLLM) and connect to remote servers.
  </p>

  {#if error}
    <div class="banner banner-error mb-4">{error}</div>
  {/if}

  <!-- Remote Server Connection -->
  <div class="panel p-4 mb-6 bg-blue-50/50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800">
    <h4 class="text-base font-semibold mb-2 text-blue-800 dark:text-blue-300">🌐 Remote Server Connection</h4>
    <p class="text-sm text-blue-700 dark:text-blue-400 mb-3">
      Connect to a remote MetaHuman server to use its LLM. Remote models appear in dropdowns
      alongside local models. This runs in parallel - doesn't compete for local VRAM.
    </p>

    <div class="mb-3">
      <label for="remote-server" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Server URL</label>
      <input
        id="remote-server"
        type="text"
        bind:value={remoteServerUrl}
        placeholder="https://your-tunnel.trycloudflare.com"
        disabled={savingRemoteConfig || testingRemoteServer}
        class="input-field font-mono"
      />
    </div>

    <div class="flex gap-4 mb-3">
      <div class="flex-1">
        <label for="remote-username" class="block text-sm text-gray-600 dark:text-gray-400 mb-1">Username</label>
        <input
          id="remote-username"
          type="text"
          bind:value={remoteServerUsername}
          placeholder="Your MetaHuman username"
          disabled={savingRemoteConfig || testingRemoteServer}
          class="input-field"
        />
      </div>
      <div class="flex-1">
        <label for="remote-password" class="block text-sm text-gray-600 dark:text-gray-400 mb-1">Password</label>
        <input
          id="remote-password"
          type="password"
          bind:value={remoteServerPassword}
          placeholder="Your password"
          disabled={savingRemoteConfig || testingRemoteServer}
          class="input-field"
        />
      </div>
    </div>

    <div class="mb-3">
      <label class="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer">
        <input type="checkbox" bind:checked={remoteServerSaveCredentials} class="w-4 h-4 accent-violet-600" />
        <span>Save credentials for auto-connect</span>
      </label>
    </div>

    <div class="flex gap-3 flex-wrap">
      <button
        class="btn-primary"
        on:click={testRemoteServerConnection}
        disabled={savingRemoteConfig || testingRemoteServer || !remoteServerUrl}
      >
        {testingRemoteServer ? '🔄 Testing...' : '🔍 Test Connection'}
      </button>
      <button
        class="btn-success"
        on:click={connectToRemoteServer}
        disabled={savingRemoteConfig || testingRemoteServer || !remoteServerUrl}
      >
        {savingRemoteConfig ? 'Connecting...' : '🔗 Connect & Save'}
      </button>
      {#if remoteServerUrl && remoteServerTestResult?.success}
        <button
          class="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white font-medium rounded-md transition-colors disabled:opacity-50"
          on:click={disconnectRemoteServer}
          disabled={savingRemoteConfig}
        >
          ❌ Disconnect
        </button>
      {/if}
    </div>

    {#if remoteServerTestResult}
      <div class="mt-4 p-3 rounded-lg text-sm {remoteServerTestResult.success ? 'bg-green-100 dark:bg-green-900/30 border border-green-300 dark:border-green-700' : 'bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-700'}">
        {#if remoteServerTestResult.success}
          <div class="flex items-center gap-2 font-medium text-green-700 dark:text-green-300">
            <span>✅</span>
            <span>Connected successfully</span>
            {#if remoteServerTestResult.latencyMs}
              <span class="text-xs opacity-70">({remoteServerTestResult.latencyMs}ms)</span>
            {/if}
          </div>
          {#if remoteServerTestResult.serverVersion}
            <div class="mt-2 flex gap-2 text-gray-600 dark:text-gray-400">
              <span class="font-medium">Server Version:</span>
              <span>{remoteServerTestResult.serverVersion}</span>
            </div>
          {/if}
          {#if remoteServerTestResult.models && remoteServerTestResult.models.length > 0}
            <div class="mt-2">
              <span class="font-medium text-gray-600 dark:text-gray-400">Available Models:</span>
              <div class="flex flex-wrap gap-1.5 mt-1">
                {#each remoteServerTestResult.models as model}
                  <span class="px-2 py-0.5 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 rounded text-xs font-mono">{model.model}</span>
                {/each}
              </div>
            </div>
          {/if}
          {#if remoteServerTestResult.needsAuth}
            <div class="mt-2 text-xs text-amber-600 dark:text-amber-400">
              ⚠️ Authentication required - provide username and password
            </div>
          {/if}
        {:else}
          <div class="flex items-center gap-2 font-medium text-red-700 dark:text-red-300">
            <span>❌</span>
            <span>Connection failed</span>
          </div>
          <div class="mt-1 text-red-600 dark:text-red-400">
            {remoteServerTestResult.error || 'Unknown error'}
          </div>
        {/if}
      </div>
    {/if}

    <p class="mt-3 text-xs text-gray-500 dark:text-gray-400 italic">
      On your desktop, start a Cloudflare Tunnel from Settings → Network to get a public URL.
    </p>
  </div>

  <hr class="section-divider" />

  <h4 class="text-base font-semibold mb-3 text-gray-700 dark:text-gray-200">Local LLM Backends</h4>

  {#if loading}
    <div class="text-center py-8 text-gray-500">Loading backend status...</div>
  {:else}
    <!-- Status Summary -->
    <div class="bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-800 dark:to-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4 mb-6">
      <div class="flex items-center gap-2 mb-2">
        <span class="text-sm text-gray-500 dark:text-gray-400 font-medium">Active Backend:</span>
        <span class="text-base font-semibold text-gray-900 dark:text-gray-100">{getBackendIcon(activeBackend)} {getBackendLabel(activeBackend)}</span>
        {#if resolvedBackend && resolvedBackend !== activeBackend}
          <span class="text-sm text-gray-500 dark:text-gray-400">→ {getBackendIcon(resolvedBackend)} {getBackendLabel(resolvedBackend)}</span>
        {/if}
      </div>
      <div class="flex items-center gap-3 flex-wrap">
        {#if activeBackend === 'ollama'}
          {#if available?.ollama.running}
            <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">
              <span class="w-1.5 h-1.5 rounded-full bg-current animate-pulse"></span>
              Running
            </span>
            {#if available.ollama.model}
              <span class="px-2.5 py-1 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 rounded text-xs font-mono font-medium">{available.ollama.model}</span>
            {/if}
          {:else}
            <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300">Stopped</span>
            <span class="text-xs text-gray-500 dark:text-gray-400">Start Ollama with: ollama serve</span>
          {/if}
        {:else if activeBackend === 'vllm'}
          {#if available?.vllm.running}
            <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">
              <span class="w-1.5 h-1.5 rounded-full bg-current animate-pulse"></span>
              Running
            </span>
            {#if available.vllm.model}
              <span class="px-2.5 py-1 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 rounded text-xs font-mono font-medium">{available.vllm.model}</span>
              <span class="text-xs text-gray-400 dark:text-gray-500 italic">(restart to change model)</span>
            {/if}
          {:else}
            <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300">Stopped</span>
            <span class="text-xs text-gray-500 dark:text-gray-400">Configure and start below</span>
          {/if}
        {:else if activeBackend === 'auto'}
          {#if resolvedBackend === 'offline'}
            <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300">Offline</span>
            <span class="text-xs text-gray-500 dark:text-gray-400">No backends available</span>
          {:else if resolvedBackend}
            <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">
              <span class="w-1.5 h-1.5 rounded-full bg-current animate-pulse"></span>
              Using {getBackendLabel(resolvedBackend)}
            </span>
          {:else}
            <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">Auto-selecting</span>
          {/if}
        {/if}
      </div>
    </div>

    <!-- Backend Mode Selector -->
    <div class="flex gap-2 mb-6 p-2 bg-gray-100 dark:bg-gray-800 rounded-lg">
      <button
        class="flex-1 px-3 py-2 rounded-md text-sm font-medium transition-all
               {activeBackend === 'auto' ? 'bg-white dark:bg-gray-700 border-2 border-violet-500 dark:border-violet-400 text-violet-700 dark:text-violet-300 shadow-sm' : 'bg-transparent border-2 border-transparent text-gray-500 dark:text-gray-400 hover:bg-violet-100/50 dark:hover:bg-violet-900/20 hover:text-violet-600 dark:hover:text-violet-400'}"
        on:click={() => switchBackend('auto')}
        disabled={switching}
        title="Automatically select best available backend"
      >
        🔄 Auto
      </button>
      <button
        class="flex-1 px-3 py-2 rounded-md text-sm font-medium transition-all
               {activeBackend === 'ollama' ? 'bg-white dark:bg-gray-700 border-2 border-violet-500 dark:border-violet-400 text-violet-700 dark:text-violet-300 shadow-sm' : 'bg-transparent border-2 border-transparent text-gray-500 dark:text-gray-400 hover:bg-violet-100/50 dark:hover:bg-violet-900/20 hover:text-violet-600 dark:hover:text-violet-400'}
               disabled:opacity-40 disabled:cursor-not-allowed"
        on:click={() => switchBackend('ollama')}
        disabled={switching || !available?.ollama.installed}
        title="Use Ollama for local inference"
      >
        🦙 Ollama
      </button>
      <button
        class="flex-1 px-3 py-2 rounded-md text-sm font-medium transition-all
               {activeBackend === 'vllm' ? 'bg-white dark:bg-gray-700 border-2 border-violet-500 dark:border-violet-400 text-violet-700 dark:text-violet-300 shadow-sm' : 'bg-transparent border-2 border-transparent text-gray-500 dark:text-gray-400 hover:bg-violet-100/50 dark:hover:bg-violet-900/20 hover:text-violet-600 dark:hover:text-violet-400'}
               disabled:opacity-40 disabled:cursor-not-allowed"
        on:click={() => switchBackend('vllm')}
        disabled={switching || !available?.vllm.installed}
        title="Use vLLM for high-throughput inference"
      >
        ⚡ vLLM
      </button>
    </div>

    <!-- Backend Cards -->
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
      <!-- Ollama Card -->
      <div class="panel p-4 {activeBackend === 'ollama' ? 'border-2 border-violet-500 dark:border-violet-400 shadow-lg shadow-violet-500/10' : ''} {!available?.ollama.installed ? 'opacity-60 pointer-events-none' : ''}">
        <div class="flex items-center gap-2 mb-3">
          <span class="text-2xl">🦙</span>
          <span class="text-lg font-semibold text-gray-900 dark:text-gray-100">Ollama</span>
          <span class="ml-auto w-2.5 h-2.5 rounded-full {available?.ollama.running ? 'bg-green-500 shadow-lg shadow-green-500/50' : available?.ollama.installed ? 'bg-red-500' : 'bg-gray-400'}"></span>
        </div>

        <div class="mb-3">
          <p class="text-sm text-gray-500 dark:text-gray-400 mb-2">Local inference with GGUF models</p>
          <div class="flex gap-2 text-sm mb-1">
            <span class="text-gray-500 dark:text-gray-400">Status:</span>
            <span class="font-medium {available?.ollama.running ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}">
              {available?.ollama.running ? 'Running' : available?.ollama.installed ? 'Stopped' : 'Not Installed'}
            </span>
          </div>
          {#if available?.ollama.model}
            <div class="flex gap-2 text-sm mb-1">
              <span class="text-gray-500 dark:text-gray-400">Model:</span>
              <span class="font-mono text-xs font-medium text-gray-700 dark:text-gray-300">{available.ollama.model}</span>
            </div>
          {/if}
          <div class="flex gap-2 text-sm">
            <span class="text-gray-500 dark:text-gray-400">Endpoint:</span>
            <span class="font-mono text-xs text-gray-500">{ollamaEndpoint}</span>
          </div>
        </div>

        <div class="flex justify-center gap-2">
          {#if activeBackend === 'ollama'}
            <span class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium bg-violet-600 text-white">
              <span class="text-xs">●</span>
              Active
            </span>
            {#if available?.ollama.running}
              <button class="btn-danger btn-sm" on:click={stopOllama} disabled={ollamaStopping}>
                {ollamaStopping ? 'Stopping...' : 'Stop'}
              </button>
            {:else}
              <button class="btn-success btn-sm" on:click={startOllama} disabled={ollamaStarting}>
                {ollamaStarting ? 'Starting...' : 'Start'}
              </button>
            {/if}
          {:else}
            <button
              class="btn-secondary btn-sm"
              on:click={() => switchBackend('ollama')}
              disabled={switching || !available?.ollama.installed}
            >
              {switching ? 'Switching...' : 'Switch to Ollama'}
            </button>
          {/if}
        </div>
      </div>

      <!-- vLLM Card -->
      <div class="panel p-4 {activeBackend === 'vllm' ? 'border-2 border-violet-500 dark:border-violet-400 shadow-lg shadow-violet-500/10' : ''} {!available?.vllm.installed ? 'opacity-60 pointer-events-none' : ''}">
        <div class="flex items-center gap-2 mb-3">
          <span class="text-2xl">⚡</span>
          <span class="text-lg font-semibold text-gray-900 dark:text-gray-100">vLLM</span>
          <span class="ml-auto w-2.5 h-2.5 rounded-full {available?.vllm.running ? 'bg-green-500 shadow-lg shadow-green-500/50' : available?.vllm.installed ? 'bg-red-500' : 'bg-gray-400'}"></span>
        </div>

        <div class="mb-3">
          <p class="text-sm text-gray-500 dark:text-gray-400 mb-2">High-throughput with HuggingFace models</p>
          <div class="flex gap-2 text-sm mb-1">
            <span class="text-gray-500 dark:text-gray-400">Status:</span>
            <span class="font-medium {available?.vllm.running ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}">
              {available?.vllm.running ? 'Running' : available?.vllm.installed ? 'Stopped' : 'Not Installed'}
            </span>
          </div>
          {#if available?.vllm.model}
            <div class="flex gap-2 text-sm mb-1">
              <span class="text-gray-500 dark:text-gray-400">Model:</span>
              <span class="font-mono text-xs font-medium text-gray-700 dark:text-gray-300">{available.vllm.model}</span>
            </div>
          {/if}
          <div class="flex gap-2 text-sm">
            <span class="text-gray-500 dark:text-gray-400">Endpoint:</span>
            <span class="font-mono text-xs text-gray-500">{vllmEndpoint}</span>
          </div>
        </div>

        <div class="flex justify-center">
          {#if activeBackend === 'vllm'}
            <span class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium bg-violet-600 text-white">
              <span class="text-xs">●</span>
              Active
            </span>
          {:else}
            <button
              class="btn-secondary btn-sm"
              on:click={() => switchBackend('vllm')}
              disabled={switching || !available?.vllm.installed}
            >
              {switching ? 'Switching...' : 'Switch to vLLM'}
            </button>
          {/if}
        </div>
      </div>
    </div>

    <!-- Big Brother Escalation -->
    <div class="panel p-4 mb-4 bg-blue-50/50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800">
      <h4 class="text-base font-semibold mb-2 text-blue-800 dark:text-blue-300">🛡️ Big Brother Escalation</h4>
      <p class="text-sm text-blue-700 dark:text-blue-400 mb-3">
        When Big Brother mode is enabled, complex tasks are delegated to this backend.
        Claude Code uses your Pro subscription; Open Interpreter uses RunPod or other configured LLMs.
      </p>

      <div class="mb-3">
        <label class="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer">
          <input type="checkbox" bind:checked={bigBrotherEnabled} on:change={saveBigBrotherConfig} disabled={savingBigBrother} class="w-4 h-4 accent-violet-600" />
          <span>Enable Big Brother Mode</span>
        </label>
        <p class="text-xs text-gray-500 dark:text-gray-400 mt-1 ml-6">
          {bigBrotherEnabled ? 'Complex tasks will be delegated to the selected backend' : 'Big Brother delegation is disabled'}
        </p>
      </div>

      <div class="mb-3">
        <label class="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer">
          <input type="checkbox" bind:checked={bigBrotherDelegateAll} on:change={saveBigBrotherConfig} disabled={savingBigBrother || !bigBrotherEnabled} class="w-4 h-4 accent-violet-600" />
          <span>Delegate All Tasks</span>
        </label>
        <p class="text-xs text-gray-500 dark:text-gray-400 mt-1 ml-6">
          {bigBrotherDelegateAll ? 'All autonomous tasks will be sent directly to Big Brother' : 'Only complex/stuck tasks will be escalated'}
        </p>
      </div>

      <div class="mb-3">
        <label for="big-brother-provider" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Escalation Backend</label>
        <select id="big-brother-provider" bind:value={bigBrotherProvider} on:change={saveBigBrotherConfig} disabled={savingBigBrother} class="select-field w-full">
          {#each bigBrotherProviderOptions as opt}
            <option value={opt.value}>{opt.label} - {opt.description}</option>
          {/each}
        </select>
      </div>

      <div class="bg-black/5 dark:bg-white/5 rounded-lg p-3">
        <div class="flex justify-between text-sm py-1">
          <span class="text-gray-500 dark:text-gray-400">Status:</span>
          <span class="font-medium {bigBrotherEnabled ? 'text-green-600 dark:text-green-400' : 'text-gray-500'}">{bigBrotherEnabled ? 'Enabled' : 'Disabled'}</span>
        </div>
        <div class="flex justify-between text-sm py-1">
          <span class="text-gray-500 dark:text-gray-400">Provider:</span>
          <span class="font-medium text-gray-700 dark:text-gray-300">{getBigBrotherProviderLabel(bigBrotherProvider)}</span>
        </div>
      </div>

      {#if bigBrotherProvider === 'open-interpreter'}
        <div class="mt-3 bg-black/5 dark:bg-white/5 rounded-lg p-3">
          <h5 class="text-sm font-semibold mb-2">🐍 Open Interpreter Server</h5>
          <div class="flex items-center gap-2 mb-2">
            <span class="text-sm text-gray-500 dark:text-gray-400">Status:</span>
            {#if interpreterStatus?.running}
              <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">Running</span>
              {#if interpreterStatus.version}
                <span class="px-1.5 py-0.5 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 rounded text-[0.7rem]">v{interpreterStatus.version}</span>
              {/if}
            {:else if interpreterStatus?.available}
              <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300">Stopped (can start)</span>
            {:else}
              <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">Not available</span>
            {/if}
          </div>
          <div class="flex items-center gap-2">
            {#if interpreterStatus?.running}
              <button class="btn-danger btn-sm" on:click={stopInterpreter} disabled={interpreterStopping}>
                {interpreterStopping ? 'Stopping...' : 'Stop Server'}
              </button>
            {:else if interpreterStatus?.available}
              <button class="btn-success btn-sm" on:click={startInterpreter} disabled={interpreterStarting}>
                {interpreterStarting ? 'Starting...' : 'Start Server'}
              </button>
            {:else}
              <span class="text-xs text-gray-500 dark:text-gray-400 font-mono">Run: bin/start-interpreter</span>
            {/if}
          </div>
        </div>
      {/if}

      {#if savingBigBrother}
        <span class="text-xs text-gray-500 italic mt-2 block">Saving...</span>
      {/if}
    </div>

    <!-- vLLM Configuration -->
    {#if available?.vllm.installed}
      <div class="panel p-4 mb-4 bg-gray-50 dark:bg-gray-900/50">
        <h4 class="text-base font-semibold mb-3 text-gray-700 dark:text-gray-200">vLLM Configuration</h4>

        <div class="mb-4">
          <label for="vllm-model" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Model (HuggingFace ID - Auto Download)</label>
          <input id="vllm-model" type="text" bind:value={vllmModel} placeholder="Qwen/Qwen2.5-14B-Instruct" class="input-field font-mono" />
        </div>

        <div class="mb-4">
          <label for="vllm-gpu" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">GPU Memory Utilization</label>
          <div class="flex items-center gap-3">
            <input id="vllm-gpu" type="range" min="0.5" max="0.95" step="0.05" bind:value={vllmGpuUtil} disabled={vllmAutoUtilization}
                   class="flex-1 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full appearance-none cursor-pointer accent-violet-600 disabled:opacity-50" />
            <span class="text-sm font-semibold text-gray-700 dark:text-gray-300 min-w-[3rem]">{vllmAutoUtilization ? 'Auto' : `${Math.round(vllmGpuUtil * 100)}%`}</span>
          </div>
        </div>

        <div class="mb-4">
          <label for="vllm-maxlen" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Context Length (maxModelLen)</label>
          <div class="flex items-center gap-3">
            <input id="vllm-maxlen" type="range" min="2048" max="16384" step="1024" bind:value={vllmMaxModelLen}
                   class="flex-1 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full appearance-none cursor-pointer accent-violet-600" />
            <span class="text-sm font-semibold text-gray-700 dark:text-gray-300 min-w-[3rem]">{vllmMaxModelLen.toLocaleString()}</span>
          </div>
          <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">Lower = less KV cache memory. 4096 saves ~3GB vs 8192.</p>
        </div>

        <div class="mb-4">
          <label for="vllm-maxtokens" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Max Output Tokens</label>
          <div class="flex items-center gap-3">
            <input id="vllm-maxtokens" type="range" min="512" max="8192" step="256" bind:value={vllmMaxTokens}
                   class="flex-1 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full appearance-none cursor-pointer accent-violet-600" />
            <span class="text-sm font-semibold text-gray-700 dark:text-gray-300 min-w-[3rem]">{vllmMaxTokens.toLocaleString()}</span>
          </div>
          <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">{vllmEnableThinking ? 'With thinking enabled, increase this to prevent cutoff (4096+ recommended).' : 'Higher = longer responses possible.'}</p>
        </div>

        <div class="mb-3">
          <label class="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer">
            <input type="checkbox" bind:checked={vllmEnforceEager} class="w-4 h-4 accent-violet-600" />
            <span>Eager Mode (disable CUDA graphs)</span>
          </label>
          <p class="text-xs text-gray-500 dark:text-gray-400 mt-1 ml-6">Reduces memory ~0.5-1GB. Slightly slower, but prevents OOM.</p>
        </div>

        <div class="mb-3">
          <label class="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer">
            <input type="checkbox" bind:checked={vllmAutoUtilization} class="w-4 h-4 accent-violet-600" />
            <span>Auto GPU Allocation</span>
          </label>
          <p class="text-xs text-gray-500 dark:text-gray-400 mt-1 ml-6">Automatically detect optimal GPU utilization based on available memory.</p>
        </div>

        <div class="mb-4">
          <label class="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer">
            <input type="checkbox" bind:checked={vllmEnableThinking} class="w-4 h-4 accent-violet-600" />
            <span>Thinking Mode (Qwen3)</span>
          </label>
          <p class="text-xs text-gray-500 dark:text-gray-400 mt-1 ml-6">
            {vllmEnableThinking ? 'Enabled: Model will show reasoning steps in <think> tags.' : 'Disabled: No <think> tags in output (direct responses only).'}
          </p>
        </div>

        <div class="flex gap-3 flex-wrap">
          <button class="btn-primary" on:click={saveVllmConfig} disabled={savingConfig}>
            {savingConfig ? 'Saving...' : 'Save Config'}
          </button>
          <button class="btn-secondary" on:click={loadStatus} disabled={loading} title="Reload config from server">
            ↻ Refresh
          </button>
          {#if available.vllm.running}
            <button class="btn-danger" on:click={stopVllm} disabled={vllmStopping}>
              {vllmStopping ? 'Stopping...' : 'Stop vLLM'}
            </button>
          {:else}
            <button class="btn-success" on:click={startVllm} disabled={vllmStarting}>
              {vllmStarting ? 'Starting...' : 'Start vLLM'}
            </button>
          {/if}
        </div>

        <p class="text-xs text-gray-500 dark:text-gray-400 mt-3 italic">Note: Changing the model requires restarting the vLLM server.</p>
      </div>
    {:else}
      <div class="banner banner-warning mb-4">
        <h4 class="font-semibold mb-1">Install vLLM</h4>
        <p class="text-sm mb-2">vLLM is not installed. Create a virtual environment and install:</p>
        <code class="block bg-black/10 dark:bg-black/20 px-3 py-2 rounded text-sm font-mono">python3 -m venv .venv-vllm && .venv-vllm/bin/pip install vllm</code>
      </div>
    {/if}

    <!-- Embedding Settings -->
    <div class="panel p-4 mb-4 bg-green-50/50 dark:bg-green-900/10 border-green-200 dark:border-green-800">
      <h4 class="text-base font-semibold mb-2 text-green-800 dark:text-green-300">Semantic Memory Search</h4>
      <p class="text-sm text-green-700 dark:text-green-400 mb-3">
        Uses {embeddingModel} via Ollama for vector embeddings.
        CPU mode leaves GPU free for the chat model.
      </p>

      <div class="mb-3">
        <label class="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer">
          <input type="checkbox" bind:checked={embeddingEnabled} on:change={saveEmbeddingConfig} disabled={embeddingSaving} class="w-4 h-4 accent-violet-600" />
          <span>Enable Semantic Search</span>
        </label>
      </div>

      <div class="mb-2">
        <label class="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer">
          <input type="checkbox" bind:checked={embeddingCpuOnly} on:change={saveEmbeddingConfig} disabled={embeddingSaving || !embeddingEnabled} class="w-4 h-4 accent-violet-600" />
          <span>CPU-Only Mode</span>
        </label>
        <p class="text-xs text-gray-500 dark:text-gray-400 mt-1 ml-6">
          {embeddingCpuOnly ? 'Embeddings run on CPU (GPU free for vLLM)' : 'Embeddings use GPU (may conflict with vLLM)'}
        </p>
      </div>

      {#if embeddingSaving}
        <span class="text-xs text-gray-500 italic">Saving...</span>
      {/if}
    </div>

    <!-- Local Models -->
    <div class="panel p-4 bg-fuchsia-50/50 dark:bg-fuchsia-900/10 border-fuchsia-200 dark:border-fuchsia-800">
      <LocalModelsSettings />
    </div>
  {/if}
</div>
