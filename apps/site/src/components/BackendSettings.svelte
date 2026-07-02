<script lang="ts">
  import { onMount } from 'svelte';
  import { apiFetch } from '../lib/client/api-config';
  import { statusRefreshTrigger } from '../stores/navigation';
  import LocalModelsSettings from './LocalModelsSettings.svelte';

  type DefaultBackend = 'auto' | 'ollama' | 'vllm';
  type ResolvedBackend = 'ollama' | 'vllm' | 'local-models' | 'remote' | 'offline';
  type BigBrotherProvider = 'claude-code' | 'open-interpreter' | 'aider' | 'gemini-cli' | 'qwen-code' | 'codex';

  interface BackendAvailability {
    ollama: { installed: boolean; running: boolean; model?: string };
    vllm: { installed: boolean; running: boolean; model?: string };
  }

  interface BackendStatus {
    backend: string;
    resolvedBackend: ResolvedBackend;
    running: boolean;
    model?: string;
    endpoint?: string;
    health: 'healthy' | 'starting' | 'degraded' | 'offline';
    reason?: string;
  }

  interface BigBrotherConfig {
    enabled: boolean;
    provider: string;
    delegateAll?: boolean;
    escalateOnStuck: boolean;
    escalateOnRepeatedFailures: boolean;
    maxRetries: number;
    includeFullScratchpad: boolean;
    autoApplySuggestions: boolean;
  }

  const defaultBackendOptions: Array<{ value: DefaultBackend; label: string; description: string }> = [
    { value: 'auto', label: 'Auto', description: 'Use the best running local backend, then configured remote fallback.' },
    { value: 'ollama', label: 'Ollama', description: 'Use the local Ollama service for normal chat.' },
    { value: 'vllm', label: 'vLLM', description: 'Use the local vLLM server for normal chat.' },
  ];

  const bigBrotherProviderOptions: { value: BigBrotherProvider; label: string; description: string }[] = [
    { value: 'claude-code', label: 'Claude Code', description: 'Uses your Claude Pro subscription via CLI' },
    { value: 'open-interpreter', label: 'Open Interpreter', description: 'Uses RunPod or other configured LLM' },
    { value: 'aider', label: 'Aider', description: 'AI pair programming with git integration' },
    { value: 'gemini-cli', label: 'Gemini CLI', description: 'Google Gemini CLI' },
    { value: 'qwen-code', label: 'Qwen Code', description: 'Qwen Code CLI' },
    { value: 'codex', label: 'Codex', description: 'OpenAI Codex CLI' },
  ];

  let loading = true;
  let error: string | null = null;
  let savedNotice: string | null = null;

  let activeBackend: DefaultBackend = 'auto';
  let configuredActiveBackend = 'auto';
  let preferredLocalBackend: 'ollama' | 'vllm' = 'vllm';
  let resolvedBackend: ResolvedBackend | null = null;
  let backendStatus: BackendStatus | null = null;
  let available: BackendAvailability | null = null;

  let ollamaEndpoint = 'http://localhost:11434';
  let ollamaAutoStart = false;
  let ollamaModel = 'qwen3:14b';

  let vllmEndpoint = 'http://localhost:8000';
  let vllmAutoStart = false;
  let vllmModel = '';
  let vllmGpuUtil = 0.7;
  let vllmEnforceEager = true;
  let vllmAutoUtilization = false;
  let vllmMaxModelLen = 4096;
  let vllmMaxTokens = 2048;
  let vllmEnableThinking = true;
  let vllmModelPath = '';
  let vllmLoadFormat = '';
  let vllmServedModelName = '';

  let savingDefault = false;
  let savingOllamaConfig = false;
  let savingVllmConfig = false;
  let actionInProgress: string | null = null;

  let remoteServerUrl = '';
  let remoteServerUsername = '';
  let remoteServerPassword = '';
  let remoteServerSaveCredentials = true;
  let savingRemoteConfig = false;
  let testingRemoteServer = false;
  let remoteServerTestResult: {
    success: boolean;
    latencyMs?: number;
    serverVersion?: string;
    models?: Array<{ id: string; model: string; provider: string }>;
    error?: string;
    needsAuth?: boolean;
  } | null = null;

  let interpreterStatus: { running: boolean; version?: string; available: boolean } | null = null;
  let interpreterStarting = false;
  let interpreterStopping = false;

  let bigBrotherConfig: BigBrotherConfig | null = null;
  let bigBrotherEnabled = false;
  let bigBrotherDelegateAll = false;
  let bigBrotherProvider: string = 'claude-code';
  let savingBigBrother = false;

  let embeddingEnabled = true;
  let embeddingModel = 'nomic-embed-text';
  let embeddingCpuOnly = true;
  let embeddingSaving = false;

  onMount(() => {
    loadStatus();
    loadInterpreterStatus();
    loadBigBrotherConfig();
    loadEmbeddingConfig();
  });

  function isDefaultBackend(value: string): value is DefaultBackend {
    return value === 'auto' || value === 'ollama' || value === 'vllm';
  }

  function restartNotice(label = 'Backend configuration saved'): string {
    return `${label}. Restart MetaHuman OS for this setting to take effect cleanly.`;
  }

  function clearMessages() {
    error = null;
    savedNotice = null;
  }

  async function loadStatus() {
    try {
      const res = await apiFetch('/api/llm-backend/status');
      if (!res.ok) return;

      const data = await res.json();
      backendStatus = data.active;
      available = data.available;
      configuredActiveBackend = data.config.activeBackend || 'auto';
      activeBackend = isDefaultBackend(configuredActiveBackend) ? configuredActiveBackend : 'auto';
      preferredLocalBackend = data.config.preferredLocalBackend === 'ollama' ? 'ollama' : 'vllm';
      resolvedBackend = data.active?.resolvedBackend || null;

      ollamaEndpoint = data.config.ollama?.endpoint || 'http://localhost:11434';
      ollamaAutoStart = data.config.ollama?.autoStart ?? false;
      ollamaModel = data.config.ollama?.defaultModel || 'qwen3:14b';

      vllmEndpoint = data.config.vllm?.endpoint || 'http://localhost:8000';
      vllmAutoStart = data.config.vllm?.autoStart ?? false;
      vllmModel = data.config.vllm?.model || '';
      vllmModelPath = data.config.vllm?.modelPath || '';
      vllmLoadFormat = data.config.vllm?.loadFormat || '';
      vllmServedModelName = data.config.vllm?.servedModelName || '';
      vllmGpuUtil = data.config.vllm?.gpuMemoryUtilization || 0.7;
      vllmEnforceEager = data.config.vllm?.enforceEager ?? true;
      vllmAutoUtilization = data.config.vllm?.autoUtilization ?? false;
      vllmMaxModelLen = data.config.vllm?.maxModelLen || 4096;
      vllmMaxTokens = data.config.vllm?.maxTokens || 2048;
      vllmEnableThinking = data.config.vllm?.enableThinking ?? true;

      if (data.config.remote?.serverUrl) {
        remoteServerUrl = data.config.remote.serverUrl;
      }
    } catch (err) {
      console.error('[BackendSettings] Error loading status:', err);
      error = 'Failed to load backend status';
    } finally {
      loading = false;
    }
  }

  async function saveDefaultBackend(to: DefaultBackend) {
    if (savingDefault || to === configuredActiveBackend) return;
    savingDefault = true;
    clearMessages();

    const updates: Record<string, any> = { activeBackend: to };
    if (to === 'ollama') {
      updates.preferredLocalBackend = 'ollama';
      updates.ollama = { autoStart: true };
      updates.vllm = { autoStart: false };
    } else if (to === 'vllm') {
      updates.preferredLocalBackend = 'vllm';
      updates.vllm = { autoStart: true };
      updates.ollama = { autoStart: false };
    } else {
      updates.preferredLocalBackend = preferredLocalBackend;
    }

    try {
      const res = await apiFetch('/api/llm-backend/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        error = data.error || 'Failed to save default backend';
        return;
      }

      configuredActiveBackend = to;
      activeBackend = to;
      savedNotice = restartNotice(`Default chat backend saved as ${getBackendLabel(to)}`);
      await loadStatus();
      window.dispatchEvent(new CustomEvent('backend-changed', { detail: { backend: to, requiresRestart: true } }));
      statusRefreshTrigger.update(n => n + 1);
    } catch (err) {
      error = 'Failed to save default backend';
    } finally {
      savingDefault = false;
    }
  }

  async function saveOllamaConfig() {
    savingOllamaConfig = true;
    clearMessages();

    try {
      const res = await apiFetch('/api/llm-backend/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ollama: {
            endpoint: ollamaEndpoint,
            autoStart: ollamaAutoStart,
            defaultModel: ollamaModel,
          },
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        error = data.error || 'Failed to save Ollama config';
        return;
      }

      savedNotice = restartNotice('Ollama configuration saved');
      await loadStatus();
      statusRefreshTrigger.update(n => n + 1);
    } catch (err) {
      error = 'Failed to save Ollama config';
    } finally {
      savingOllamaConfig = false;
    }
  }

  async function saveVllmConfig() {
    savingVllmConfig = true;
    clearMessages();

    try {
      const vllm: Record<string, any> = {
        endpoint: vllmEndpoint,
        autoStart: vllmAutoStart,
        model: vllmModel,
        gpuMemoryUtilization: vllmGpuUtil,
        enforceEager: vllmEnforceEager,
        autoUtilization: vllmAutoUtilization,
        maxModelLen: vllmMaxModelLen,
        maxTokens: vllmMaxTokens,
        enableThinking: vllmEnableThinking,
      };

      if (vllmModelPath.trim()) vllm.modelPath = vllmModelPath.trim();
      if (vllmLoadFormat.trim()) vllm.loadFormat = vllmLoadFormat.trim();
      if (vllmServedModelName.trim()) vllm.servedModelName = vllmServedModelName.trim();

      const res = await apiFetch('/api/llm-backend/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vllm }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        error = data.error || 'Failed to save vLLM config';
        return;
      }

      savedNotice = restartNotice('vLLM configuration saved');
      await loadStatus();
      statusRefreshTrigger.update(n => n + 1);
    } catch (err) {
      error = 'Failed to save vLLM config';
    } finally {
      savingVllmConfig = false;
    }
  }

  async function controlLLMBackend(backend: 'ollama' | 'vllm', action: 'start' | 'stop' | 'restart') {
    actionInProgress = `${backend}-${action}`;
    clearMessages();

    try {
      const endpoint = backend === 'ollama' ? '/api/llm-backend/ollama' : '/api/llm-backend/vllm';
      const res = await apiFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        error = data.error || `Failed to ${action} ${getBackendLabel(backend)}`;
        return;
      }
      setTimeout(loadStatus, 2000);
    } catch (err) {
      error = `Failed to ${action} ${getBackendLabel(backend)}`;
    } finally {
      actionInProgress = null;
    }
  }

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
    clearMessages();

    try {
      const res = await apiFetch('/api/interpreter-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      });

      if (res.ok) {
        await loadInterpreterStatus();
      } else {
        const data = await res.json().catch(() => ({}));
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
    clearMessages();

    try {
      const res = await apiFetch('/api/interpreter-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' }),
      });

      if (res.ok) {
        await loadInterpreterStatus();
      } else {
        const data = await res.json().catch(() => ({}));
        error = data.error || 'Failed to stop Open Interpreter';
      }
    } catch (err) {
      error = 'Failed to stop Open Interpreter';
    } finally {
      interpreterStopping = false;
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

  async function saveEmbeddingConfig() {
    embeddingSaving = true;
    clearMessages();

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
        const data = await res.json().catch(() => ({}));
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
    clearMessages();

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
        const data = await res.json().catch(() => ({}));
        error = data.error || 'Failed to save escalation config';
      }
    } catch (err) {
      error = 'Failed to save escalation config';
    } finally {
      savingBigBrother = false;
    }
  }

  async function testRemoteServerConnection() {
    if (!remoteServerUrl) {
      remoteServerTestResult = { success: false, error: 'Please enter a server URL' };
      return;
    }

    testingRemoteServer = true;
    remoteServerTestResult = null;
    clearMessages();

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
    clearMessages();

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
    clearMessages();

    try {
      const res = await apiFetch('/api/remote-server/disconnect', { method: 'DELETE' });
      if (res.ok) {
        remoteServerUrl = '';
        remoteServerTestResult = null;
        await loadStatus();
        statusRefreshTrigger.update(n => n + 1);
      } else {
        const data = await res.json().catch(() => ({}));
        error = data.error || 'Failed to disconnect';
      }
    } catch (err) {
      error = 'Failed to disconnect';
    } finally {
      savingRemoteConfig = false;
    }
  }

  function getBackendIcon(backend: string): string {
    switch (backend) {
      case 'ollama': return '🦙';
      case 'vllm': return '⚡';
      case 'auto': return '🔄';
      case 'remote': return '🌐';
      case 'local-models': return '🔍';
      default: return '❓';
    }
  }

  function getBackendLabel(backend: string): string {
    switch (backend) {
      case 'ollama': return 'Ollama';
      case 'vllm': return 'vLLM';
      case 'auto': return 'Auto';
      case 'remote': return 'Remote';
      case 'local-models': return 'Local Models';
      case 'offline': return 'Offline';
      default: return 'Unknown';
    }
  }

  function getBigBrotherProviderLabel(provider: string): string {
    const opt = bigBrotherProviderOptions.find(o => o.value === provider);
    return opt?.label || provider;
  }
</script>

<div>
  <h3 class="text-lg font-semibold mb-2 text-gray-900 dark:text-gray-100">Backend Configuration</h3>
  <p class="text-sm text-gray-500 dark:text-gray-400 mb-5">
    Set the default chat route, manage local services, and keep utility models available for indexing and routed tasks.
  </p>

  {#if error}
    <div class="banner banner-error mb-4">{error}</div>
  {/if}

  {#if savedNotice}
    <div class="banner banner-warning mb-4">{savedNotice}</div>
  {/if}

  {#if loading}
    <div class="text-center py-8 text-gray-500">Loading backend settings...</div>
  {:else}
    <section class="panel p-4 mb-6 bg-gray-50 dark:bg-gray-900/50">
      <div class="flex items-start justify-between gap-4 mb-4">
        <div>
          <h4 class="text-base font-semibold mb-1 text-gray-800 dark:text-gray-100">Default Chat Backend</h4>
          <p class="text-sm text-gray-500 dark:text-gray-400">
            This controls the normal chat route. It does not stop other services or prevent task-specific routing.
          </p>
        </div>
        <div class="text-right text-sm">
          <div class="text-gray-500 dark:text-gray-400">Resolved now</div>
          <div class="font-semibold text-gray-800 dark:text-gray-100">
            {getBackendIcon(resolvedBackend || 'offline')} {getBackendLabel(resolvedBackend || 'offline')}
          </div>
        </div>
      </div>

      {#if !isDefaultBackend(configuredActiveBackend)}
        <div class="banner banner-warning mb-4">
          Current config uses {getBackendLabel(configuredActiveBackend)}. Choose Auto, Ollama, or vLLM below to make local chat routing explicit.
        </div>
      {/if}

      <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
        {#each defaultBackendOptions as option}
          <button
            class="text-left rounded-lg border-2 p-4 transition-all bg-white dark:bg-gray-800 hover:border-violet-400 disabled:opacity-60 {activeBackend === option.value ? 'border-violet-500 dark:border-violet-400 shadow-sm shadow-violet-500/10' : 'border-gray-200 dark:border-gray-700'}"
            on:click={() => saveDefaultBackend(option.value)}
            disabled={savingDefault}
          >
            <div class="flex items-center gap-2 mb-2">
              <span class="text-xl">{getBackendIcon(option.value)}</span>
              <span class="font-semibold text-gray-900 dark:text-gray-100">{option.label}</span>
              {#if activeBackend === option.value}
                <span class="ml-auto text-xs px-2 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300">Selected</span>
              {/if}
            </div>
            <div class="text-xs text-gray-500 dark:text-gray-400">{option.description}</div>
          </button>
        {/each}
      </div>
    </section>

    <section class="mb-6">
      <h4 class="text-base font-semibold mb-3 text-gray-800 dark:text-gray-100">Local Service Control</h4>
      <div class="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div class="panel p-4 {configuredActiveBackend === 'ollama' ? 'border-2 border-violet-500 dark:border-violet-400' : ''}">
          <div class="flex items-center gap-2 mb-3">
            <span class="text-2xl">🦙</span>
            <div>
              <h5 class="m-0 text-lg font-semibold text-gray-900 dark:text-gray-100">Ollama</h5>
              <p class="m-0 text-xs text-gray-500 dark:text-gray-400">Local GGUF/chat service</p>
            </div>
            <span class="ml-auto w-2.5 h-2.5 rounded-full {available?.ollama.running ? 'bg-green-500' : available?.ollama.installed ? 'bg-red-500' : 'bg-gray-400'}"></span>
          </div>

          <div class="grid grid-cols-1 gap-3 mb-4">
            <label class="block text-sm">
              <span class="block font-medium text-gray-700 dark:text-gray-300 mb-1">Endpoint</span>
              <input class="input-field font-mono" bind:value={ollamaEndpoint} />
            </label>
            <label class="block text-sm">
              <span class="block font-medium text-gray-700 dark:text-gray-300 mb-1">Default model</span>
              <input class="input-field font-mono" bind:value={ollamaModel} placeholder="qwen3:14b" />
            </label>
            <label class="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer">
              <input type="checkbox" bind:checked={ollamaAutoStart} class="w-4 h-4 accent-violet-600" />
              <span>Auto-start when active backend requires Ollama</span>
            </label>
          </div>

          <div class="flex items-center gap-2 text-sm mb-4">
            <span class="text-gray-500 dark:text-gray-400">Status:</span>
            <span class="font-semibold {available?.ollama.running ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}">
              {available?.ollama.running ? 'Running' : available?.ollama.installed ? 'Stopped' : 'Not installed'}
            </span>
            {#if available?.ollama.model}
              <span class="font-mono text-xs text-gray-500 dark:text-gray-400">• {available.ollama.model}</span>
            {/if}
          </div>

          <div class="flex gap-2 flex-wrap">
            <button class="btn-primary" on:click={saveOllamaConfig} disabled={savingOllamaConfig}>
              {savingOllamaConfig ? 'Saving...' : 'Save Ollama Config'}
            </button>
            {#if available?.ollama.running}
              <button class="btn-danger" on:click={() => controlLLMBackend('ollama', 'stop')} disabled={actionInProgress !== null}>
                {actionInProgress === 'ollama-stop' ? 'Stopping...' : 'Stop'}
              </button>
            {:else}
              <button class="btn-success" on:click={() => controlLLMBackend('ollama', 'start')} disabled={actionInProgress !== null || !available?.ollama.installed}>
                {actionInProgress === 'ollama-start' ? 'Starting...' : 'Start'}
              </button>
            {/if}
          </div>
        </div>

        <div class="panel p-4 {configuredActiveBackend === 'vllm' ? 'border-2 border-violet-500 dark:border-violet-400' : ''}">
          <div class="flex items-center gap-2 mb-3">
            <span class="text-2xl">⚡</span>
            <div>
              <h5 class="m-0 text-lg font-semibold text-gray-900 dark:text-gray-100">vLLM</h5>
              <p class="m-0 text-xs text-gray-500 dark:text-gray-400">Local GPU inference server</p>
            </div>
            <span class="ml-auto w-2.5 h-2.5 rounded-full {available?.vllm.running ? 'bg-green-500' : available?.vllm.installed ? 'bg-red-500' : 'bg-gray-400'}"></span>
          </div>

          <div class="grid grid-cols-1 gap-3 mb-4">
            <label class="block text-sm">
              <span class="block font-medium text-gray-700 dark:text-gray-300 mb-1">Endpoint</span>
              <input class="input-field font-mono" bind:value={vllmEndpoint} />
            </label>
            <label class="block text-sm">
              <span class="block font-medium text-gray-700 dark:text-gray-300 mb-1">Model</span>
              <input class="input-field font-mono" bind:value={vllmModel} placeholder="Qwen/Qwen3-14B-AWQ" />
            </label>
            <label class="block text-sm">
              <span class="block font-medium text-gray-700 dark:text-gray-300 mb-1">Model path</span>
              <input class="input-field font-mono" bind:value={vllmModelPath} placeholder="Optional local artifact path" />
            </label>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label class="block text-sm">
                <span class="block font-medium text-gray-700 dark:text-gray-300 mb-1">Load format</span>
                <input class="input-field font-mono" bind:value={vllmLoadFormat} placeholder="auto" />
              </label>
              <label class="block text-sm">
                <span class="block font-medium text-gray-700 dark:text-gray-300 mb-1">Served name</span>
                <input class="input-field font-mono" bind:value={vllmServedModelName} placeholder="Optional" />
              </label>
            </div>
            <div>
              <label for="vllm-gpu" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">GPU Memory Utilization</label>
              <div class="flex items-center gap-3">
                <input id="vllm-gpu" type="range" min="0.5" max="0.95" step="0.05" bind:value={vllmGpuUtil} disabled={vllmAutoUtilization}
                  class="flex-1 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full appearance-none cursor-pointer accent-violet-600 disabled:opacity-50" />
                <span class="text-sm font-semibold text-gray-700 dark:text-gray-300 min-w-[3rem]">{vllmAutoUtilization ? 'Auto' : `${Math.round(vllmGpuUtil * 100)}%`}</span>
              </div>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label class="block text-sm">
                <span class="block font-medium text-gray-700 dark:text-gray-300 mb-1">Context Length</span>
                <input class="input-field" type="number" min="2048" step="1024" bind:value={vllmMaxModelLen} />
              </label>
              <label class="block text-sm">
                <span class="block font-medium text-gray-700 dark:text-gray-300 mb-1">Max Output Tokens</span>
                <input class="input-field" type="number" min="512" step="256" bind:value={vllmMaxTokens} />
              </label>
            </div>
            <label class="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer">
              <input type="checkbox" bind:checked={vllmAutoStart} class="w-4 h-4 accent-violet-600" />
              <span>Auto-start when active backend requires vLLM</span>
            </label>
            <label class="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer">
              <input type="checkbox" bind:checked={vllmEnforceEager} class="w-4 h-4 accent-violet-600" />
              <span>Eager Mode</span>
            </label>
            <label class="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer">
              <input type="checkbox" bind:checked={vllmAutoUtilization} class="w-4 h-4 accent-violet-600" />
              <span>Auto GPU Allocation</span>
            </label>
            <label class="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer">
              <input type="checkbox" bind:checked={vllmEnableThinking} class="w-4 h-4 accent-violet-600" />
              <span>Thinking Mode (Qwen3)</span>
            </label>
          </div>

          <div class="flex items-center gap-2 text-sm mb-4">
            <span class="text-gray-500 dark:text-gray-400">Status:</span>
            <span class="font-semibold {available?.vllm.running ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}">
              {available?.vllm.running ? 'Running' : available?.vllm.installed ? 'Stopped' : 'Not installed'}
            </span>
            {#if available?.vllm.model}
              <span class="font-mono text-xs text-gray-500 dark:text-gray-400">• {available.vllm.model}</span>
            {/if}
          </div>

          <div class="flex gap-2 flex-wrap">
            <button class="btn-primary" on:click={saveVllmConfig} disabled={savingVllmConfig}>
              {savingVllmConfig ? 'Saving...' : 'Save vLLM Config'}
            </button>
            {#if available?.vllm.running}
              <button class="btn-danger" on:click={() => controlLLMBackend('vllm', 'stop')} disabled={actionInProgress !== null}>
                {actionInProgress === 'vllm-stop' ? 'Stopping...' : 'Stop'}
              </button>
              <button class="btn-secondary" on:click={() => controlLLMBackend('vllm', 'restart')} disabled={actionInProgress !== null}>
                {actionInProgress === 'vllm-restart' ? 'Restarting...' : 'Restart'}
              </button>
            {:else}
              <button class="btn-success" on:click={() => controlLLMBackend('vllm', 'start')} disabled={actionInProgress !== null || !available?.vllm.installed}>
                {actionInProgress === 'vllm-start' ? 'Starting...' : 'Start'}
              </button>
            {/if}
          </div>
        </div>
      </div>
    </section>

    <section class="panel p-4 mb-6 bg-blue-50/50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800">
      <h4 class="text-base font-semibold mb-2 text-blue-800 dark:text-blue-300">Remote Server</h4>
      <p class="text-sm text-blue-700 dark:text-blue-400 mb-3">
        Remote servers can stay available alongside local services for routed tasks and fallback model access.
      </p>

      <label for="remote-server" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Server URL</label>
      <input
        id="remote-server"
        type="text"
        bind:value={remoteServerUrl}
        placeholder="https://your-tunnel.trycloudflare.com"
        disabled={savingRemoteConfig || testingRemoteServer}
        class="input-field font-mono mb-3"
      />

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <label class="block text-sm">
          <span class="block text-gray-600 dark:text-gray-400 mb-1">Username</span>
          <input type="text" bind:value={remoteServerUsername} placeholder="Your MetaHuman username" disabled={savingRemoteConfig || testingRemoteServer} class="input-field" />
        </label>
        <label class="block text-sm">
          <span class="block text-gray-600 dark:text-gray-400 mb-1">Password</span>
          <input type="password" bind:value={remoteServerPassword} placeholder="Your password" disabled={savingRemoteConfig || testingRemoteServer} class="input-field" />
        </label>
      </div>

      <label class="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer mb-3">
        <input type="checkbox" bind:checked={remoteServerSaveCredentials} class="w-4 h-4 accent-violet-600" />
        <span>Save credentials for auto-connect</span>
      </label>

      <div class="flex gap-3 flex-wrap">
        <button class="btn-primary" on:click={testRemoteServerConnection} disabled={savingRemoteConfig || testingRemoteServer || !remoteServerUrl}>
          {testingRemoteServer ? 'Testing...' : 'Test Connection'}
        </button>
        <button class="btn-success" on:click={connectToRemoteServer} disabled={savingRemoteConfig || testingRemoteServer || !remoteServerUrl}>
          {savingRemoteConfig ? 'Connecting...' : 'Connect & Save'}
        </button>
        {#if remoteServerUrl && remoteServerTestResult?.success}
          <button class="btn-danger" on:click={disconnectRemoteServer} disabled={savingRemoteConfig}>
            Disconnect
          </button>
        {/if}
      </div>

      {#if remoteServerTestResult}
        <div class="mt-4 p-3 rounded-lg text-sm {remoteServerTestResult.success ? 'bg-green-100 dark:bg-green-900/30 border border-green-300 dark:border-green-700' : 'bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-700'}">
          {#if remoteServerTestResult.success}
            <div class="font-medium text-green-700 dark:text-green-300">
              Connected successfully{remoteServerTestResult.latencyMs ? ` (${remoteServerTestResult.latencyMs}ms)` : ''}
            </div>
            {#if remoteServerTestResult.models && remoteServerTestResult.models.length > 0}
              <div class="flex flex-wrap gap-1.5 mt-2">
                {#each remoteServerTestResult.models as model}
                  <span class="px-2 py-0.5 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 rounded text-xs font-mono">{model.model}</span>
                {/each}
              </div>
            {/if}
          {:else}
            <div class="font-medium text-red-700 dark:text-red-300">Connection failed</div>
            <div class="mt-1 text-red-600 dark:text-red-400">{remoteServerTestResult.error || 'Unknown error'}</div>
          {/if}
        </div>
      {/if}
    </section>

    <section class="panel p-4 mb-6 bg-blue-50/50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800">
      <h4 class="text-base font-semibold mb-2 text-blue-800 dark:text-blue-300">Escalation</h4>
      <p class="text-sm text-blue-700 dark:text-blue-400 mb-3">
        Big Brother is a task escalation route. It is separate from the default chat backend.
      </p>

      <label class="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer mb-3">
        <input type="checkbox" bind:checked={bigBrotherEnabled} on:change={saveBigBrotherConfig} disabled={savingBigBrother} class="w-4 h-4 accent-violet-600" />
        <span>Enable Big Brother Mode</span>
      </label>

      <label class="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer mb-3">
        <input type="checkbox" bind:checked={bigBrotherDelegateAll} on:change={saveBigBrotherConfig} disabled={savingBigBrother || !bigBrotherEnabled} class="w-4 h-4 accent-violet-600" />
        <span>Delegate All Tasks</span>
      </label>

      <label for="big-brother-provider" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Escalation Provider</label>
      <select id="big-brother-provider" bind:value={bigBrotherProvider} on:change={saveBigBrotherConfig} disabled={savingBigBrother} class="select-field w-full mb-3">
        {#each bigBrotherProviderOptions as opt}
          <option value={opt.value}>{opt.label} - {opt.description}</option>
        {/each}
      </select>

      <div class="bg-black/5 dark:bg-white/5 rounded-lg p-3 text-sm">
        <div class="flex justify-between py-1">
          <span class="text-gray-500 dark:text-gray-400">Status:</span>
          <span class="font-medium {bigBrotherEnabled ? 'text-green-600 dark:text-green-400' : 'text-gray-500'}">{bigBrotherEnabled ? 'Enabled' : 'Disabled'}</span>
        </div>
        <div class="flex justify-between py-1">
          <span class="text-gray-500 dark:text-gray-400">Provider:</span>
          <span class="font-medium text-gray-700 dark:text-gray-300">{getBigBrotherProviderLabel(bigBrotherProvider)}</span>
        </div>
      </div>

      {#if bigBrotherProvider === 'open-interpreter'}
        <div class="mt-3 bg-black/5 dark:bg-white/5 rounded-lg p-3">
          <h5 class="text-sm font-semibold mb-2">Open Interpreter Server</h5>
          <div class="flex items-center gap-2 mb-2">
            <span class="text-sm text-gray-500 dark:text-gray-400">Status:</span>
            <span class="text-sm font-semibold {interpreterStatus?.running ? 'text-green-600 dark:text-green-400' : 'text-yellow-700 dark:text-yellow-300'}">
              {interpreterStatus?.running ? 'Running' : interpreterStatus?.available ? 'Stopped' : 'Not available'}
            </span>
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
    </section>

    <section class="panel p-4 mb-6 bg-green-50/50 dark:bg-green-900/10 border-green-200 dark:border-green-800">
      <h4 class="text-base font-semibold mb-2 text-green-800 dark:text-green-300">Semantic Memory Search</h4>
      <p class="text-sm text-green-700 dark:text-green-400 mb-3">
        Uses {embeddingModel} for vector search. This can run separately from the default chat backend.
      </p>

      <label class="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer mb-3">
        <input type="checkbox" bind:checked={embeddingEnabled} on:change={saveEmbeddingConfig} disabled={embeddingSaving} class="w-4 h-4 accent-violet-600" />
        <span>Enable Semantic Search</span>
      </label>

      <label class="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer">
        <input type="checkbox" bind:checked={embeddingCpuOnly} on:change={saveEmbeddingConfig} disabled={embeddingSaving || !embeddingEnabled} class="w-4 h-4 accent-violet-600" />
        <span>CPU-Only Mode</span>
      </label>
    </section>

    <section class="panel p-4 bg-fuchsia-50/50 dark:bg-fuchsia-900/10 border-fuchsia-200 dark:border-fuchsia-800">
      <LocalModelsSettings />
    </section>
  {/if}
</div>
