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

  // Tool Executor config (replaces Big Brother)
  type ToolExecutorBackend = 'local-skills' | 'open-interpreter' | 'claude-code' | 'qwen-code' | 'aider' | 'gemini-cli';

  const toolExecutorBackendOptions: { value: ToolExecutorBackend; label: string; description: string }[] = [
    { value: 'local-skills', label: 'Local Skills', description: 'Native MetaHuman skill executor (default)' },
    { value: 'open-interpreter', label: 'Open Interpreter', description: 'Python-based natural language code execution' },
    { value: 'claude-code', label: 'Claude Code', description: 'Anthropic Claude CLI for complex reasoning' },
    { value: 'qwen-code', label: 'Qwen Code', description: 'Qwen Code CLI (Gemini CLI fork)' },
    { value: 'aider', label: 'Aider', description: 'AI pair programming with git integration' },
    { value: 'gemini-cli', label: 'Gemini CLI', description: 'Google Gemini CLI' },
  ];

  interface ToolExecutorBackendStatus {
    id: string;
    name: string;
    enabled: boolean;
    installed: boolean;
    running?: boolean;
    description?: string;
  }

  interface ToolExecutorConfig {
    activeBackend: string;
    backendStatus: ToolExecutorBackendStatus[];
    llmProxy: {
      enabled: boolean;
      modelId: string;
      fallbackModelId: string;
      temperature: number;
      maxTokens: number;
    };
  }

  // Legacy Big Brother config (for backward compatibility - DEPRECATED)
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
  let vllmMaxTokens = 2048; // Output token limit (thinking + response)
  let vllmEnableThinking = true; // Qwen3 thinking mode (shows <think> tags)

  // Ollama config
  let ollamaEndpoint = 'http://localhost:11434';
  let ollamaModel = 'qwen3:14b';

  // Remote server connection
  let remoteServerUrl = '';
  let resolvedBackend: 'ollama' | 'vllm' | 'offline' | null = null;

  // Tool Executor config (replaces Big Brother - from tool-executor.json)
  let toolExecutorConfig: ToolExecutorConfig | null = null;
  let toolExecutorActiveBackend: ToolExecutorBackend = 'local-skills';
  let toolExecutorBackendStatus: ToolExecutorBackendStatus[] = [];
  let toolExecutorLoading = false;
  let savingToolExecutor = false;
  let interpreterStatus: { running: boolean; version?: string; available: boolean } | null = null;
  let interpreterStarting = false;
  let interpreterStopping = false;

  // Legacy Big Brother config (DEPRECATED - for backward compatibility)
  let bigBrotherConfig: BigBrotherConfig | null = null;
  let bigBrotherEnabled = false;
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
    loadToolExecutorConfig();
    loadInterpreterStatus();
    loadBigBrotherConfig(); // Legacy - kept for backward compatibility
    loadEmbeddingConfig();
  });

  // Load Tool Executor config
  async function loadToolExecutorConfig() {
    toolExecutorLoading = true;
    try {
      const res = await apiFetch('/api/tool-executor-config');
      if (res.ok) {
        const data = await res.json();
        toolExecutorConfig = data;
        toolExecutorActiveBackend = (data.config?.activeBackend || 'local-skills') as ToolExecutorBackend;
        toolExecutorBackendStatus = data.backendStatus || [];
      }
    } catch (err) {
      console.error('[BackendSettings] Error loading tool executor config:', err);
    } finally {
      toolExecutorLoading = false;
    }
  }

  // Load Open Interpreter status
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

  // Switch tool executor backend
  async function switchToolExecutorBackend(backend: ToolExecutorBackend) {
    if (savingToolExecutor || backend === toolExecutorActiveBackend) return;
    savingToolExecutor = true;

    try {
      const res = await apiFetch('/api/tool-executor-config/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backend }),
      });

      if (res.ok) {
        toolExecutorActiveBackend = backend;
        await loadToolExecutorConfig();
        statusRefreshTrigger.update(n => n + 1);
      } else {
        const data = await res.json();
        error = data.error || 'Failed to switch tool executor backend';
      }
    } catch (err) {
      error = 'Failed to switch tool executor backend';
    } finally {
      savingToolExecutor = false;
    }
  }

  // Start Open Interpreter server
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
        await loadToolExecutorConfig();
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

  // Stop Open Interpreter server
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
        await loadToolExecutorConfig();
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

  // Get tool executor backend label
  function getToolExecutorBackendLabel(backend: ToolExecutorBackend): string {
    const opt = toolExecutorBackendOptions.find(o => o.value === backend);
    return opt?.label || backend;
  }

  // Check if a backend is available (installed)
  function isBackendAvailable(backend: ToolExecutorBackend): boolean {
    const status = toolExecutorBackendStatus.find(s => s.id === backend);
    return status?.installed ?? (backend === 'local-skills');
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

        // vLLM config
        vllmModel = data.config.vllm?.model || '';
        vllmGpuUtil = data.config.vllm?.gpuMemoryUtilization || 0.7;
        vllmEndpoint = data.config.vllm?.endpoint || 'http://localhost:8000';
        vllmEnforceEager = data.config.vllm?.enforceEager ?? true;
        vllmAutoUtilization = data.config.vllm?.autoUtilization ?? false;
        vllmMaxModelLen = data.config.vllm?.maxModelLen || 4096;
        vllmMaxTokens = data.config.vllm?.maxTokens || 2048;
        vllmEnableThinking = data.config.vllm?.enableThinking ?? true;

        // Ollama config
        ollamaEndpoint = data.config.ollama?.endpoint || 'http://localhost:11434';
        ollamaModel = data.config.ollama?.defaultModel || 'qwen3:14b';

        // Remote server URL
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

  // Load Big Brother config from /api/big-brother-config (uses etc/operator.json)
  async function loadBigBrotherConfig() {
    try {
      const res = await apiFetch('/api/big-brother-config');
      if (res.ok) {
        const data = await res.json();
        bigBrotherConfig = data.config;
        bigBrotherEnabled = data.config?.enabled ?? false;
        bigBrotherProvider = data.config?.provider || 'claude-code';
      }
    } catch (err) {
      console.error('[BackendSettings] Error loading Big Brother config:', err);
    }
  }

  // Save Big Brother config
  async function saveBigBrotherConfig() {
    savingBigBrother = true;
    error = null;

    try {
      const res = await apiFetch('/api/big-brother-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: bigBrotherEnabled,
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
        // Trigger status refresh for other components
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

  // Get Big Brother provider label
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
        // Reload to confirm
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

        // Dispatch event and trigger status refresh for other components
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
      remoteServerTestResult = {
        success: false,
        error: 'Please enter a server URL',
      };
      return;
    }

    testingRemoteServer = true;
    remoteServerTestResult = null;
    error = null;

    try {
      const payload: Record<string, any> = { serverUrl: remoteServerUrl };

      // Include credentials if provided
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

      if (res.ok) {
        remoteServerTestResult = data;
      } else {
        remoteServerTestResult = {
          success: false,
          error: data.error || 'Test failed',
        };
      }
    } catch (err) {
      remoteServerTestResult = {
        success: false,
        error: 'Failed to test connection',
      };
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

      // Include credentials if provided
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
        // Refresh status to show new configuration
        await loadStatus();
        statusRefreshTrigger.update(n => n + 1);
      } else {
        remoteServerTestResult = {
          success: false,
          error: data.error || 'Connection failed',
        };
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
      const res = await apiFetch('/api/remote-server/disconnect', {
        method: 'DELETE',
      });

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
        // Reload to confirm what was saved
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
        body: JSON.stringify({
          action: 'start',
          model: vllmModel,
          gpuMemoryUtilization: vllmGpuUtil,
        }),
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

  function getHealthColor(health: string): string {
    switch (health) {
      case 'healthy': return '#22c55e';
      case 'starting': return '#f59e0b';
      case 'degraded': return '#f59e0b';
      case 'offline': return '#ef4444';
      default: return '#6b7280';
    }
  }

  function getHealthLabel(health: string): string {
    switch (health) {
      case 'healthy': return 'Running';
      case 'starting': return 'Starting...';
      case 'degraded': return 'Degraded';
      case 'offline': return 'Stopped';
      default: return 'Unknown';
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

<div class="backend-settings">
  <h3>LLM Backend</h3>
  <p class="description">
    Configure local backends (Ollama/vLLM) and connect to remote servers.
  </p>

  {#if error}
    <div class="error-banner">{error}</div>
  {/if}

  <!-- Remote Server Connection (runs in parallel with local backends) -->
  <div class="remote-server-section">
    <h4>🌐 Remote Server Connection</h4>
    <p class="config-desc">
      Connect to a remote MetaHuman server to use its LLM. Remote models appear in dropdowns
      alongside local models. This runs in parallel - doesn't compete for local VRAM.
    </p>

    <div class="config-row">
      <label for="remote-server">Server URL</label>
      <input
        id="remote-server"
        type="text"
        bind:value={remoteServerUrl}
        placeholder="https://your-tunnel.trycloudflare.com"
        disabled={savingRemoteConfig || testingRemoteServer}
      />
    </div>

    <div class="config-row credentials-row">
      <div class="credential-field">
        <label for="remote-username">Username</label>
        <input
          id="remote-username"
          type="text"
          bind:value={remoteServerUsername}
          placeholder="Your MetaHuman username"
          disabled={savingRemoteConfig || testingRemoteServer}
        />
      </div>
      <div class="credential-field">
        <label for="remote-password">Password</label>
        <input
          id="remote-password"
          type="password"
          bind:value={remoteServerPassword}
          placeholder="Your password"
          disabled={savingRemoteConfig || testingRemoteServer}
        />
      </div>
    </div>

    <div class="config-row checkbox-row">
      <label class="checkbox-label">
        <input type="checkbox" bind:checked={remoteServerSaveCredentials} />
        <span>Save credentials for auto-connect</span>
      </label>
    </div>

    <div class="config-actions remote-actions">
      <button
        class="test-btn"
        on:click={testRemoteServerConnection}
        disabled={savingRemoteConfig || testingRemoteServer || !remoteServerUrl}
      >
        {testingRemoteServer ? '🔄 Testing...' : '🔍 Test Connection'}
      </button>
      <button
        class="save-btn"
        on:click={connectToRemoteServer}
        disabled={savingRemoteConfig || testingRemoteServer || !remoteServerUrl}
      >
        {savingRemoteConfig ? 'Connecting...' : '🔗 Connect & Save'}
      </button>
      {#if remoteServerUrl && remoteServerTestResult?.success}
        <button
          class="disconnect-btn"
          on:click={disconnectRemoteServer}
          disabled={savingRemoteConfig}
        >
          ❌ Disconnect
        </button>
      {/if}
    </div>

    <!-- Test Results -->
    {#if remoteServerTestResult}
      <div class="test-result" class:success={remoteServerTestResult.success} class:error={!remoteServerTestResult.success}>
        {#if remoteServerTestResult.success}
          <div class="result-header">
            <span class="status-icon">✅</span>
            <span class="status-text">Connected successfully</span>
            {#if remoteServerTestResult.latencyMs}
              <span class="latency">({remoteServerTestResult.latencyMs}ms)</span>
            {/if}
          </div>
          {#if remoteServerTestResult.serverVersion}
            <div class="result-detail">
              <span class="detail-label">Server Version:</span>
              <span class="detail-value">{remoteServerTestResult.serverVersion}</span>
            </div>
          {/if}
          {#if remoteServerTestResult.models && remoteServerTestResult.models.length > 0}
            <div class="result-detail">
              <span class="detail-label">Available Models:</span>
              <div class="models-list">
                {#each remoteServerTestResult.models as model}
                  <span class="model-badge">{model.model}</span>
                {/each}
              </div>
            </div>
          {/if}
          {#if remoteServerTestResult.needsAuth}
            <div class="result-note warning">
              ⚠️ Authentication required - provide username and password
            </div>
          {/if}
        {:else}
          <div class="result-header">
            <span class="status-icon">❌</span>
            <span class="status-text">Connection failed</span>
          </div>
          <div class="result-error">
            {remoteServerTestResult.error || 'Unknown error'}
          </div>
        {/if}
      </div>
    {/if}

    <p class="config-note">
      On your desktop, start a Cloudflare Tunnel from Settings → Network to get a public URL.
    </p>
  </div>

  <hr class="section-divider" />

  <h4>Local LLM Backends</h4>

  {#if loading}
    <div class="loading">Loading backend status...</div>
  {:else}
    <!-- Status Summary -->
    <div class="status-summary">
      <div class="summary-header">
        <span class="summary-label">Active Backend:</span>
        <span class="summary-value">{getBackendIcon(activeBackend)} {getBackendLabel(activeBackend)}</span>
        {#if resolvedBackend && resolvedBackend !== activeBackend}
          <span class="resolved-badge">→ {getBackendIcon(resolvedBackend)} {getBackendLabel(resolvedBackend)}</span>
        {/if}
      </div>
      <div class="summary-details">
        {#if activeBackend === 'ollama'}
          {#if available?.ollama.running}
            <span class="status-badge running">Running</span>
            {#if available.ollama.model}
              <span class="model-badge">{available.ollama.model}</span>
            {/if}
          {:else}
            <span class="status-badge stopped">Stopped</span>
            <span class="status-hint">Start Ollama with: ollama serve</span>
          {/if}
        {:else if activeBackend === 'vllm'}
          {#if available?.vllm.running}
            <span class="status-badge running">Running</span>
            {#if available.vllm.model}
              <span class="model-badge">{available.vllm.model}</span>
              <span class="model-note">(restart to change model)</span>
            {/if}
          {:else}
            <span class="status-badge stopped">Stopped</span>
            <span class="status-hint">Configure and start below</span>
          {/if}
        {:else if activeBackend === 'auto'}
          {#if resolvedBackend === 'offline'}
            <span class="status-badge stopped">Offline</span>
            <span class="status-hint">No backends available</span>
          {:else if resolvedBackend}
            <span class="status-badge running">Using {getBackendLabel(resolvedBackend)}</span>
          {:else}
            <span class="status-badge running">Auto-selecting</span>
          {/if}
        {/if}
      </div>
    </div>

    <!-- Backend Mode Selector -->
    <div class="backend-mode-selector">
      <button
        class="mode-btn"
        class:active={activeBackend === 'auto'}
        on:click={() => switchBackend('auto')}
        disabled={switching}
        title="Automatically select best available backend"
      >
        🔄 Auto
      </button>
      <button
        class="mode-btn"
        class:active={activeBackend === 'ollama'}
        on:click={() => switchBackend('ollama')}
        disabled={switching || !available?.ollama.installed}
        title="Use Ollama for local inference"
      >
        🦙 Ollama
      </button>
      <button
        class="mode-btn"
        class:active={activeBackend === 'vllm'}
        on:click={() => switchBackend('vllm')}
        disabled={switching || !available?.vllm.installed}
        title="Use vLLM for high-throughput inference"
      >
        ⚡ vLLM
      </button>
    </div>

    <div class="backend-cards">
      <!-- Ollama Card -->
      <div class="backend-card" class:active={activeBackend === 'ollama'} class:unavailable={!available?.ollama.installed}>
        <div class="backend-header">
          <span class="backend-icon">🦙</span>
          <span class="backend-name">Ollama</span>
          {#if available?.ollama.running}
            <span class="status-dot running"></span>
          {:else if available?.ollama.installed}
            <span class="status-dot stopped"></span>
          {:else}
            <span class="status-dot unavailable"></span>
          {/if}
        </div>

        <div class="backend-info">
          <p class="backend-desc">Local inference with GGUF models</p>
          <div class="backend-detail">
            <span class="label">Status:</span>
            <span class="value" style="color: {available?.ollama.running ? '#22c55e' : '#ef4444'}">
              {available?.ollama.running ? 'Running' : available?.ollama.installed ? 'Stopped' : 'Not Installed'}
            </span>
          </div>
          {#if available?.ollama.model}
            <div class="backend-detail">
              <span class="label">Model:</span>
              <span class="value model">{available.ollama.model}</span>
            </div>
          {/if}
          <div class="backend-detail">
            <span class="label">Endpoint:</span>
            <span class="value endpoint">{ollamaEndpoint}</span>
          </div>
        </div>

        <div class="backend-actions">
          {#if activeBackend === 'ollama'}
            <span class="active-badge">Active</span>
            {#if available?.ollama.running}
              <button
                class="stop-btn small"
                on:click={stopOllama}
                disabled={ollamaStopping}
              >
                {ollamaStopping ? 'Stopping...' : 'Stop'}
              </button>
            {:else}
              <button
                class="start-btn small"
                on:click={startOllama}
                disabled={ollamaStarting}
              >
                {ollamaStarting ? 'Starting...' : 'Start'}
              </button>
            {/if}
          {:else}
            <button
              class="switch-btn"
              on:click={() => switchBackend('ollama')}
              disabled={switching || !available?.ollama.installed}
            >
              {switching ? 'Switching...' : 'Switch to Ollama'}
            </button>
          {/if}
        </div>
      </div>

      <!-- vLLM Card -->
      <div class="backend-card" class:active={activeBackend === 'vllm'} class:unavailable={!available?.vllm.installed}>
        <div class="backend-header">
          <span class="backend-icon">⚡</span>
          <span class="backend-name">vLLM</span>
          {#if available?.vllm.running}
            <span class="status-dot running"></span>
          {:else if available?.vllm.installed}
            <span class="status-dot stopped"></span>
          {:else}
            <span class="status-dot unavailable"></span>
          {/if}
        </div>

        <div class="backend-info">
          <p class="backend-desc">High-throughput with HuggingFace models</p>
          <div class="backend-detail">
            <span class="label">Status:</span>
            <span class="value" style="color: {available?.vllm.running ? '#22c55e' : '#ef4444'}">
              {available?.vllm.running ? 'Running' : available?.vllm.installed ? 'Stopped' : 'Not Installed'}
            </span>
          </div>
          {#if available?.vllm.model}
            <div class="backend-detail">
              <span class="label">Model:</span>
              <span class="value model">{available.vllm.model}</span>
            </div>
          {/if}
          <div class="backend-detail">
            <span class="label">Endpoint:</span>
            <span class="value endpoint">{vllmEndpoint}</span>
          </div>
        </div>

        <div class="backend-actions">
          {#if activeBackend === 'vllm'}
            <span class="active-badge">Active</span>
          {:else}
            <button
              class="switch-btn"
              on:click={() => switchBackend('vllm')}
              disabled={switching || !available?.vllm.installed}
            >
              {switching ? 'Switching...' : 'Switch to vLLM'}
            </button>
          {/if}
        </div>
      </div>

    </div>

    <!-- Tool Executor (replaces Big Brother) -->
    <div class="remote-config tool-executor-config">
      <h4>🛠️ Tool Executor Backend</h4>
      <p class="config-desc">
        Select the backend for tool execution. Open Interpreter provides natural language code execution,
        while CLI backends offer specific AI integrations.
      </p>

      {#if toolExecutorLoading}
        <div class="loading-small">Loading tool executor config...</div>
      {:else}
        <!-- Backend Selector -->
        <div class="config-row">
          <label for="tool-executor-backend">Active Backend</label>
          <select
            id="tool-executor-backend"
            bind:value={toolExecutorActiveBackend}
            on:change={() => switchToolExecutorBackend(toolExecutorActiveBackend)}
            disabled={savingToolExecutor}
          >
            {#each toolExecutorBackendOptions as opt}
              <option
                value={opt.value}
                disabled={!isBackendAvailable(opt.value)}
              >
                {opt.label} - {opt.description} {!isBackendAvailable(opt.value) ? '(not installed)' : ''}
              </option>
            {/each}
          </select>
        </div>

        <!-- Backend Status Cards -->
        <div class="backend-status-grid">
          {#each toolExecutorBackendStatus as backend}
            <div
              class="backend-status-card"
              class:active={backend.id === toolExecutorActiveBackend}
              class:unavailable={!backend.installed}
            >
              <div class="backend-status-header">
                <span class="backend-status-name">{backend.name}</span>
                {#if backend.running}
                  <span class="status-dot running" title="Running"></span>
                {:else if backend.installed}
                  <span class="status-dot stopped" title="Stopped"></span>
                {:else}
                  <span class="status-dot unavailable" title="Not installed"></span>
                {/if}
              </div>
              <div class="backend-status-info">
                {#if backend.installed}
                  <span class="installed-badge">✓ Installed</span>
                {:else}
                  <span class="not-installed-badge">Not installed</span>
                {/if}
              </div>
            </div>
          {/each}
        </div>

        <!-- Open Interpreter Controls -->
        {#if toolExecutorActiveBackend === 'open-interpreter' || toolExecutorBackendStatus.find(b => b.id === 'open-interpreter')?.installed}
          <div class="interpreter-controls">
            <h5>🐍 Open Interpreter Server</h5>
            <div class="interpreter-status-row">
              <span class="status-label">Status:</span>
              {#if interpreterStatus?.running}
                <span class="status-badge running">Running</span>
                {#if interpreterStatus.version}
                  <span class="version-badge">v{interpreterStatus.version}</span>
                {/if}
              {:else if interpreterStatus?.available}
                <span class="status-badge stopped">Stopped (can start)</span>
              {:else}
                <span class="status-badge unavailable">Not available</span>
              {/if}
            </div>
            <div class="interpreter-actions">
              {#if interpreterStatus?.running}
                <button
                  class="stop-btn small"
                  on:click={stopInterpreter}
                  disabled={interpreterStopping}
                >
                  {interpreterStopping ? 'Stopping...' : 'Stop Server'}
                </button>
              {:else if interpreterStatus?.available}
                <button
                  class="start-btn small"
                  on:click={startInterpreter}
                  disabled={interpreterStarting}
                >
                  {interpreterStarting ? 'Starting...' : 'Start Server'}
                </button>
              {:else}
                <span class="hint-text">Run: bin/start-interpreter</span>
              {/if}
            </div>
          </div>
        {/if}

        <!-- Config Details -->
        {#if toolExecutorConfig}
          <div class="config-details">
            <div class="config-detail">
              <span class="detail-label">Active Backend:</span>
              <span class="detail-value">{getToolExecutorBackendLabel(toolExecutorActiveBackend)}</span>
            </div>
            {#if toolExecutorConfig.llmProxy}
              <div class="config-detail">
                <span class="detail-label">LLM Proxy Model:</span>
                <span class="detail-value">{toolExecutorConfig.llmProxy.modelId || 'default.coder'}</span>
              </div>
            {/if}
          </div>
        {/if}

        {#if savingToolExecutor}
          <span class="saving-indicator">Saving...</span>
        {/if}
      {/if}
    </div>

    <!-- vLLM Configuration -->
    {#if available?.vllm.installed}
      <div class="vllm-config">
        <h4>vLLM Configuration</h4>

        <div class="config-row">
          <label for="vllm-model">Model (HuggingFace ID - Auto Download)</label>
          <input
            id="vllm-model"
            type="text"
            bind:value={vllmModel}
            placeholder="Qwen/Qwen2.5-14B-Instruct"
          />
        </div>

        <div class="config-row">
          <label for="vllm-gpu">GPU Memory Utilization</label>
          <div class="slider-row">
            <input
              id="vllm-gpu"
              type="range"
              min="0.5"
              max="0.95"
              step="0.05"
              bind:value={vllmGpuUtil}
              disabled={vllmAutoUtilization}
            />
            <span class="slider-value">{vllmAutoUtilization ? 'Auto' : `${Math.round(vllmGpuUtil * 100)}%`}</span>
          </div>
        </div>

        <div class="config-row">
          <label for="vllm-maxlen">Context Length (maxModelLen)</label>
          <div class="slider-row">
            <input
              id="vllm-maxlen"
              type="range"
              min="2048"
              max="16384"
              step="1024"
              bind:value={vllmMaxModelLen}
            />
            <span class="slider-value">{vllmMaxModelLen.toLocaleString()}</span>
          </div>
          <span class="config-hint">Lower = less KV cache memory. 4096 saves ~3GB vs 8192.</span>
        </div>

        <div class="config-row">
          <label for="vllm-maxtokens">Max Output Tokens</label>
          <div class="slider-row">
            <input
              id="vllm-maxtokens"
              type="range"
              min="512"
              max="8192"
              step="256"
              bind:value={vllmMaxTokens}
            />
            <span class="slider-value">{vllmMaxTokens.toLocaleString()}</span>
          </div>
          <span class="config-hint">Max tokens per response. {vllmEnableThinking ? 'With thinking enabled, increase this to prevent cutoff (4096+ recommended).' : 'Higher = longer responses possible.'}</span>
        </div>

        <div class="config-row checkbox-row">
          <label class="checkbox-label">
            <input
              type="checkbox"
              bind:checked={vllmEnforceEager}
            />
            <span>Eager Mode (disable CUDA graphs)</span>
          </label>
          <span class="config-hint">Reduces memory ~0.5-1GB. Slightly slower, but prevents OOM on memory-constrained GPUs.</span>
        </div>

        <div class="config-row checkbox-row">
          <label class="checkbox-label">
            <input
              type="checkbox"
              bind:checked={vllmAutoUtilization}
            />
            <span>Auto GPU Allocation</span>
          </label>
          <span class="config-hint">Automatically detect optimal GPU utilization based on available memory.</span>
        </div>

        <div class="config-row checkbox-row">
          <label class="checkbox-label">
            <input
              type="checkbox"
              bind:checked={vllmEnableThinking}
            />
            <span>Thinking Mode (Qwen3)</span>
          </label>
          <span class="config-hint">
            {vllmEnableThinking
              ? 'Enabled: Model will show reasoning steps in <think> tags.'
              : 'Disabled: No <think> tags in output (direct responses only).'}
          </span>
        </div>

        <div class="config-actions">
          <button
            class="save-btn"
            on:click={saveVllmConfig}
            disabled={savingConfig}
          >
            {savingConfig ? 'Saving...' : 'Save Config'}
          </button>

          <button
            class="refresh-btn"
            on:click={loadStatus}
            disabled={loading}
            title="Reload config from server"
          >
            ↻ Refresh
          </button>

          {#if available.vllm.running}
            <button
              class="stop-btn"
              on:click={stopVllm}
              disabled={vllmStopping}
            >
              {vllmStopping ? 'Stopping...' : 'Stop vLLM'}
            </button>
          {:else}
            <button
              class="start-btn"
              on:click={startVllm}
              disabled={vllmStarting}
            >
              {vllmStarting ? 'Starting...' : 'Start vLLM'}
            </button>
          {/if}
        </div>

        <p class="config-note">
          Note: Changing the model requires restarting the vLLM server.
        </p>
      </div>
    {:else}
      <div class="install-hint">
        <h4>Install vLLM</h4>
        <p>vLLM is not installed. Create a virtual environment and install:</p>
        <code>python3 -m venv .venv-vllm && .venv-vllm/bin/pip install vllm</code>
      </div>
    {/if}

    <!-- Embedding Settings (Semantic Memory Search) -->
    <div class="embedding-config">
      <h4>Semantic Memory Search</h4>
      <p class="config-desc">
        Uses {embeddingModel} via Ollama for vector embeddings.
        CPU mode leaves GPU free for the chat model.
      </p>

      <div class="config-row checkbox-row">
        <label class="checkbox-label">
          <input
            type="checkbox"
            bind:checked={embeddingEnabled}
            on:change={saveEmbeddingConfig}
            disabled={embeddingSaving}
          />
          <span>Enable Semantic Search</span>
        </label>
      </div>

      <div class="config-row checkbox-row">
        <label class="checkbox-label">
          <input
            type="checkbox"
            bind:checked={embeddingCpuOnly}
            on:change={saveEmbeddingConfig}
            disabled={embeddingSaving || !embeddingEnabled}
          />
          <span>CPU-Only Mode</span>
        </label>
        <span class="config-hint">
          {embeddingCpuOnly ? 'Embeddings run on CPU (GPU free for vLLM)' : 'Embeddings use GPU (may conflict with vLLM)'}
        </span>
      </div>

      {#if embeddingSaving}
        <span class="saving-indicator">Saving...</span>
      {/if}
    </div>

    <!-- Local Models (Transformers.js - for mobile/offline) -->
    <div class="local-models-section">
      <LocalModelsSettings />
    </div>
  {/if}
</div>

<style>
  .backend-settings {
    padding: 0;
  }

  h3 {
    font-size: 1.125rem;
    font-weight: 600;
    margin: 0 0 0.5rem 0;
    color: #1f2937;
  }

  :global(.dark) h3 {
    color: #f3f4f6;
  }

  h4 {
    font-size: 1rem;
    font-weight: 600;
    margin: 0 0 0.75rem 0;
    color: #374151;
  }

  :global(.dark) h4 {
    color: #e5e7eb;
  }

  .description {
    font-size: 0.875rem;
    color: #6b7280;
    margin: 0 0 1.25rem 0;
  }

  :global(.dark) .description {
    color: #9ca3af;
  }

  .error-banner {
    background: #fef2f2;
    border: 1px solid #fecaca;
    color: #dc2626;
    padding: 0.75rem 1rem;
    border-radius: 0.5rem;
    margin-bottom: 1rem;
    font-size: 0.875rem;
  }

  :global(.dark) .error-banner {
    background: rgba(239, 68, 68, 0.1);
    border-color: rgba(239, 68, 68, 0.3);
    color: #f87171;
  }

  .loading {
    text-align: center;
    padding: 2rem;
    color: #6b7280;
  }

  .status-summary {
    background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
    border: 1px solid #e2e8f0;
    border-radius: 0.75rem;
    padding: 1rem 1.25rem;
    margin-bottom: 1.5rem;
  }

  :global(.dark) .status-summary {
    background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
    border-color: #334155;
  }

  .summary-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }

  .summary-label {
    font-size: 0.875rem;
    color: #64748b;
    font-weight: 500;
  }

  :global(.dark) .summary-label {
    color: #94a3b8;
  }

  .summary-value {
    font-size: 1rem;
    font-weight: 600;
    color: #1e293b;
  }

  :global(.dark) .summary-value {
    color: #f1f5f9;
  }

  .summary-details {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .status-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.25rem 0.625rem;
    border-radius: 9999px;
    font-size: 0.75rem;
    font-weight: 600;
  }

  .status-badge.running {
    background: rgba(34, 197, 94, 0.15);
    color: #16a34a;
  }

  .status-badge.running::before {
    content: '●';
    font-size: 0.5rem;
    animation: pulse 2s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  :global(.dark) .status-badge.running {
    background: rgba(34, 197, 94, 0.2);
    color: #4ade80;
  }

  .status-badge.stopped {
    background: rgba(239, 68, 68, 0.15);
    color: #dc2626;
  }

  :global(.dark) .status-badge.stopped {
    background: rgba(239, 68, 68, 0.2);
    color: #f87171;
  }

  .model-badge {
    background: #e0e7ff;
    color: #3730a3;
    padding: 0.25rem 0.625rem;
    border-radius: 0.375rem;
    font-size: 0.75rem;
    font-family: monospace;
    font-weight: 500;
  }

  :global(.dark) .model-badge {
    background: rgba(99, 102, 241, 0.2);
    color: #a5b4fc;
  }

  .model-note {
    font-size: 0.75rem;
    color: #94a3b8;
    font-style: italic;
  }

  :global(.dark) .model-note {
    color: #64748b;
  }

  .status-hint {
    font-size: 0.75rem;
    color: #64748b;
  }

  :global(.dark) .status-hint {
    color: #94a3b8;
  }

  .backend-cards {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 1rem;
    margin-bottom: 1.5rem;
  }

  .backend-card {
    background: #ffffff;
    border: 2px solid #e5e7eb;
    border-radius: 0.75rem;
    padding: 1rem;
    transition: border-color 0.2s, box-shadow 0.2s;
  }

  :global(.dark) .backend-card {
    background: #1f2937;
    border-color: #374151;
  }

  .backend-card.active {
    border-color: #8b5cf6;
    box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.1);
  }

  :global(.dark) .backend-card.active {
    border-color: #a78bfa;
    box-shadow: 0 0 0 3px rgba(167, 139, 250, 0.1);
  }

  .backend-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }

  .backend-icon {
    font-size: 1.5rem;
  }

  .backend-name {
    font-size: 1.125rem;
    font-weight: 600;
    color: #1f2937;
  }

  :global(.dark) .backend-name {
    color: #f3f4f6;
  }

  .status-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    margin-left: auto;
  }

  .status-dot.running {
    background: #22c55e;
    box-shadow: 0 0 6px rgba(34, 197, 94, 0.5);
  }

  .status-dot.stopped {
    background: #ef4444;
  }

  .status-dot.unavailable {
    background: #6b7280;
  }

  .backend-info {
    margin-bottom: 0.75rem;
  }

  .backend-desc {
    font-size: 0.8125rem;
    color: #6b7280;
    margin: 0 0 0.5rem 0;
  }

  :global(.dark) .backend-desc {
    color: #9ca3af;
  }

  .backend-detail {
    display: flex;
    gap: 0.5rem;
    font-size: 0.8125rem;
    margin-bottom: 0.25rem;
  }

  .backend-detail .label {
    color: #6b7280;
  }

  :global(.dark) .backend-detail .label {
    color: #9ca3af;
  }

  .backend-detail .value {
    color: #374151;
    font-weight: 500;
  }

  :global(.dark) .backend-detail .value {
    color: #e5e7eb;
  }

  .backend-detail .value.model {
    font-family: monospace;
    font-size: 0.75rem;
  }

  .backend-detail .value.endpoint {
    font-family: monospace;
    font-size: 0.75rem;
    color: #6b7280;
  }

  .backend-actions {
    display: flex;
    justify-content: center;
  }

  .active-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    background: #8b5cf6;
    color: white;
    padding: 0.375rem 0.75rem;
    border-radius: 9999px;
    font-size: 0.8125rem;
    font-weight: 500;
  }

  .active-badge::before {
    content: '●';
    font-size: 0.625rem;
  }

  .switch-btn {
    background: #f3f4f6;
    color: #374151;
    border: 1px solid #d1d5db;
    padding: 0.375rem 0.75rem;
    border-radius: 0.375rem;
    font-size: 0.8125rem;
    cursor: pointer;
    transition: background 0.2s;
  }

  :global(.dark) .switch-btn {
    background: #374151;
    color: #e5e7eb;
    border-color: #4b5563;
  }

  .switch-btn:hover:not(:disabled) {
    background: #e5e7eb;
  }

  :global(.dark) .switch-btn:hover:not(:disabled) {
    background: #4b5563;
  }

  .switch-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .stop-btn.small, .start-btn.small {
    padding: 0.25rem 0.5rem;
    font-size: 0.75rem;
    margin-left: 0.5rem;
  }

  .vllm-config {
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 0.75rem;
    padding: 1rem;
    margin-top: 1rem;
  }

  :global(.dark) .vllm-config {
    background: #111827;
    border-color: #374151;
  }

  .config-row {
    margin-bottom: 1rem;
  }

  .config-row label {
    display: block;
    font-size: 0.8125rem;
    font-weight: 500;
    color: #374151;
    margin-bottom: 0.375rem;
  }

  :global(.dark) .config-row label {
    color: #d1d5db;
  }

  .config-row input[type="text"] {
    width: 100%;
    padding: 0.5rem 0.75rem;
    border: 1px solid #d1d5db;
    border-radius: 0.375rem;
    font-size: 0.875rem;
    font-family: monospace;
    background: white;
    color: #1f2937;
  }

  :global(.dark) .config-row input[type="text"] {
    background: #1f2937;
    border-color: #4b5563;
    color: #f3f4f6;
  }

  .slider-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .slider-row input[type="range"] {
    flex: 1;
    height: 6px;
    background: #e5e7eb;
    border-radius: 3px;
    appearance: none;
    cursor: pointer;
  }

  :global(.dark) .slider-row input[type="range"] {
    background: #374151;
  }

  .slider-row input[type="range"]::-webkit-slider-thumb {
    appearance: none;
    width: 16px;
    height: 16px;
    background: #8b5cf6;
    border-radius: 50%;
    cursor: pointer;
  }

  .slider-value {
    font-size: 0.875rem;
    font-weight: 600;
    color: #374151;
    min-width: 3rem;
  }

  :global(.dark) .slider-value {
    color: #e5e7eb;
  }

  .config-actions {
    display: flex;
    gap: 0.75rem;
    margin-top: 1rem;
  }

  .save-btn, .start-btn, .stop-btn {
    padding: 0.5rem 1rem;
    border-radius: 0.375rem;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.2s;
  }

  .save-btn {
    background: #8b5cf6;
    color: white;
    border: none;
  }

  .save-btn:hover:not(:disabled) {
    background: #7c3aed;
  }

  .start-btn {
    background: #22c55e;
    color: white;
    border: none;
  }

  .start-btn:hover:not(:disabled) {
    background: #16a34a;
  }

  .stop-btn {
    background: #ef4444;
    color: white;
    border: none;
  }

  .stop-btn:hover:not(:disabled) {
    background: #dc2626;
  }

  .save-btn:disabled, .start-btn:disabled, .stop-btn:disabled, .refresh-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .refresh-btn {
    background: #6b7280;
    color: white;
    border: none;
    padding: 0.5rem 1rem;
    border-radius: 0.375rem;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.2s;
  }

  .refresh-btn:hover:not(:disabled) {
    background: #4b5563;
  }

  .config-note {
    font-size: 0.75rem;
    color: #6b7280;
    margin: 0.75rem 0 0 0;
    font-style: italic;
  }

  :global(.dark) .config-note {
    color: #9ca3af;
  }

  .config-hint {
    display: block;
    font-size: 0.75rem;
    color: #6b7280;
    margin-top: 0.25rem;
  }

  :global(.dark) .config-hint {
    color: #9ca3af;
  }

  .checkbox-row {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
    font-size: 0.875rem;
    font-weight: 500;
    color: #374151;
  }

  :global(.dark) .checkbox-label {
    color: #d1d5db;
  }

  .checkbox-label input[type="checkbox"] {
    width: 1rem;
    height: 1rem;
    accent-color: #8b5cf6;
    cursor: pointer;
  }

  .slider-row input[type="range"]:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .install-hint {
    background: #fef3c7;
    border: 1px solid #fcd34d;
    border-radius: 0.75rem;
    padding: 1rem;
    margin-top: 1rem;
  }

  :global(.dark) .install-hint {
    background: rgba(251, 191, 36, 0.1);
    border-color: rgba(251, 191, 36, 0.3);
  }

  .install-hint h4 {
    margin: 0 0 0.5rem 0;
    color: #92400e;
  }

  :global(.dark) .install-hint h4 {
    color: #fbbf24;
  }

  .install-hint p {
    font-size: 0.875rem;
    color: #78350f;
    margin: 0 0 0.5rem 0;
  }

  :global(.dark) .install-hint p {
    color: #fcd34d;
  }

  .install-hint code {
    display: block;
    background: rgba(0, 0, 0, 0.1);
    padding: 0.5rem 0.75rem;
    border-radius: 0.375rem;
    font-family: monospace;
    font-size: 0.8125rem;
    color: #78350f;
  }

  :global(.dark) .install-hint code {
    background: rgba(0, 0, 0, 0.2);
    color: #fcd34d;
  }

  .embedding-config {
    background: #f0fdf4;
    border: 1px solid #86efac;
    border-radius: 0.75rem;
    padding: 1rem;
    margin-top: 1.5rem;
  }

  :global(.dark) .embedding-config {
    background: rgba(34, 197, 94, 0.1);
    border-color: rgba(34, 197, 94, 0.3);
  }

  .embedding-config h4 {
    margin: 0 0 0.5rem 0;
    color: #166534;
  }

  :global(.dark) .embedding-config h4 {
    color: #4ade80;
  }

  .config-desc {
    font-size: 0.8125rem;
    color: #166534;
    margin: 0 0 0.75rem 0;
  }

  :global(.dark) .config-desc {
    color: #86efac;
  }

  .saving-indicator {
    font-size: 0.75rem;
    color: #6b7280;
    font-style: italic;
  }

  @media (max-width: 640px) {
    .backend-cards {
      grid-template-columns: 1fr;
    }

    .backend-mode-selector {
      flex-wrap: wrap;
    }

    .mode-btn {
      flex: 1 1 45%;
    }
  }

  /* Backend Mode Selector */
  .backend-mode-selector {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1.5rem;
    padding: 0.5rem;
    background: #f3f4f6;
    border-radius: 0.75rem;
  }

  :global(.dark) .backend-mode-selector {
    background: #1f2937;
  }

  .mode-btn {
    flex: 1;
    padding: 0.5rem 0.75rem;
    background: transparent;
    border: 2px solid transparent;
    border-radius: 0.5rem;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
    color: #6b7280;
  }

  :global(.dark) .mode-btn {
    color: #9ca3af;
  }

  .mode-btn:hover:not(:disabled) {
    background: rgba(139, 92, 246, 0.1);
    color: #7c3aed;
  }

  :global(.dark) .mode-btn:hover:not(:disabled) {
    background: rgba(167, 139, 250, 0.15);
    color: #a78bfa;
  }

  .mode-btn.active {
    background: white;
    border-color: #8b5cf6;
    color: #7c3aed;
    box-shadow: 0 2px 4px rgba(139, 92, 246, 0.1);
  }

  :global(.dark) .mode-btn.active {
    background: #374151;
    border-color: #a78bfa;
    color: #c4b5fd;
  }

  .mode-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  /* Resolved Badge */
  .resolved-badge {
    font-size: 0.8125rem;
    color: #6b7280;
    margin-left: 0.5rem;
  }

  :global(.dark) .resolved-badge {
    color: #9ca3af;
  }

  /* Remote Config Section */
  .remote-config {
    background: #faf5ff;
    border: 1px solid #e9d5ff;
    border-radius: 0.75rem;
    padding: 1rem;
    margin-top: 1rem;
    margin-bottom: 1rem;
  }

  :global(.dark) .remote-config {
    background: rgba(168, 85, 247, 0.1);
    border-color: rgba(168, 85, 247, 0.3);
  }

  .remote-config h4 {
    margin: 0 0 0.75rem 0;
    color: #7c3aed;
  }

  :global(.dark) .remote-config h4 {
    color: #c4b5fd;
  }

  /* Select dropdown */
  .config-row select {
    width: 100%;
    padding: 0.5rem 0.75rem;
    border: 1px solid #d1d5db;
    border-radius: 0.375rem;
    font-size: 0.875rem;
    background: white;
    color: #1f2937;
    cursor: pointer;
  }

  :global(.dark) .config-row select {
    background: #1f2937;
    border-color: #4b5563;
    color: #f3f4f6;
  }

  .config-row select:focus {
    outline: none;
    border-color: #8b5cf6;
    box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.1);
  }

  /* Dimmed card for unavailable backends (not installed) */
  .backend-card.unavailable {
    opacity: 0.6;
    pointer-events: none;
  }

  /* Config status row */
  .config-status {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
    margin-bottom: 0.75rem;
  }

  /* Config details section */
  .config-details {
    background: rgba(0, 0, 0, 0.03);
    border-radius: 0.5rem;
    padding: 0.75rem;
    margin-top: 0.75rem;
  }

  :global(.dark) .config-details {
    background: rgba(255, 255, 255, 0.05);
  }

  .config-detail {
    display: flex;
    justify-content: space-between;
    font-size: 0.8125rem;
    padding: 0.25rem 0;
  }

  .detail-label {
    color: #6b7280;
  }

  :global(.dark) .detail-label {
    color: #9ca3af;
  }

  .detail-value {
    font-weight: 500;
    color: #374151;
  }

  :global(.dark) .detail-value {
    color: #e5e7eb;
  }

  .detail-value.masked {
    font-family: monospace;
    letter-spacing: 0.05em;
  }

  /* Warning style for config hint */
  .config-hint.warning {
    color: #dc2626;
  }

  :global(.dark) .config-hint.warning {
    color: #f87171;
  }

  /* Tool Executor config styling */
  .tool-executor-config {
    background: #f0fdf4;
    border-color: #86efac;
  }

  :global(.dark) .tool-executor-config {
    background: rgba(34, 197, 94, 0.1);
    border-color: rgba(34, 197, 94, 0.3);
  }

  .tool-executor-config h4 {
    color: #166534;
  }

  :global(.dark) .tool-executor-config h4 {
    color: #4ade80;
  }

  .tool-executor-config .config-desc {
    color: #166534;
  }

  :global(.dark) .tool-executor-config .config-desc {
    color: #86efac;
  }

  .backend-status-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.5rem;
    margin: 1rem 0;
  }

  @media (max-width: 768px) {
    .backend-status-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  .backend-status-card {
    background: rgba(255, 255, 255, 0.5);
    border: 1px solid #d1d5db;
    border-radius: 0.5rem;
    padding: 0.5rem;
    font-size: 0.75rem;
  }

  :global(.dark) .backend-status-card {
    background: rgba(0, 0, 0, 0.2);
    border-color: #4b5563;
  }

  .backend-status-card.active {
    border-color: #22c55e;
    background: rgba(34, 197, 94, 0.1);
  }

  .backend-status-card.unavailable {
    opacity: 0.5;
  }

  .backend-status-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.25rem;
  }

  .backend-status-name {
    font-weight: 600;
    font-size: 0.8125rem;
  }

  .backend-status-info {
    font-size: 0.6875rem;
    color: #6b7280;
  }

  :global(.dark) .backend-status-info {
    color: #9ca3af;
  }

  .installed-badge {
    color: #22c55e;
  }

  .not-installed-badge {
    color: #9ca3af;
  }

  .interpreter-controls {
    background: rgba(0, 0, 0, 0.03);
    border-radius: 0.5rem;
    padding: 0.75rem;
    margin-top: 0.75rem;
  }

  :global(.dark) .interpreter-controls {
    background: rgba(255, 255, 255, 0.05);
  }

  .interpreter-controls h5 {
    margin: 0 0 0.5rem 0;
    font-size: 0.875rem;
    font-weight: 600;
  }

  .interpreter-status-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }

  .status-label {
    font-size: 0.8125rem;
    color: #6b7280;
  }

  :global(.dark) .status-label {
    color: #9ca3af;
  }

  .version-badge {
    font-size: 0.6875rem;
    background: #e0e7ff;
    color: #3730a3;
    padding: 0.125rem 0.375rem;
    border-radius: 0.25rem;
  }

  :global(.dark) .version-badge {
    background: rgba(99, 102, 241, 0.2);
    color: #a5b4fc;
  }

  .interpreter-actions {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  .hint-text {
    font-size: 0.75rem;
    color: #6b7280;
    font-family: monospace;
  }

  :global(.dark) .hint-text {
    color: #9ca3af;
  }

  .loading-small {
    font-size: 0.875rem;
    color: #6b7280;
    padding: 0.5rem 0;
  }

  :global(.dark) .loading-small {
    color: #9ca3af;
  }

  /* Legacy Big Brother config styling (deprecated) */
  .big-brother-config {
    background: #eff6ff;
    border-color: #93c5fd;
  }

  :global(.dark) .big-brother-config {
    background: rgba(59, 130, 246, 0.1);
    border-color: rgba(59, 130, 246, 0.3);
  }

  .big-brother-config h4 {
    color: #1d4ed8;
  }

  :global(.dark) .big-brother-config h4 {
    color: #93c5fd;
  }

  .big-brother-config .config-desc {
    color: #1e40af;
  }

  :global(.dark) .big-brother-config .config-desc {
    color: #93c5fd;
  }

  /* Remote Server Section */
  .remote-server-section {
    background: rgba(59, 130, 246, 0.05);
    border: 1px solid rgba(59, 130, 246, 0.2);
    border-radius: 0.5rem;
    padding: 1rem;
    margin-bottom: 1.5rem;
  }

  :global(.dark) .remote-server-section {
    background: rgba(59, 130, 246, 0.1);
    border-color: rgba(59, 130, 246, 0.3);
  }

  .remote-server-section h4 {
    margin: 0 0 0.5rem 0;
    font-size: 1rem;
    color: #1e40af;
  }

  :global(.dark) .remote-server-section h4 {
    color: #60a5fa;
  }

  .section-divider {
    border: none;
    border-top: 1px solid #e5e7eb;
    margin: 1.5rem 0;
  }

  :global(.dark) .section-divider {
    border-color: #374151;
  }

  /* Remote Server Styles */
  .credentials-row {
    display: flex;
    gap: 1rem;
  }

  .credential-field {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .credential-field label {
    font-size: 0.875rem;
    color: #4b5563;
  }

  :global(.dark) .credential-field label {
    color: #9ca3af;
  }

  .credential-field input {
    padding: 0.5rem 0.75rem;
    border: 1px solid #d1d5db;
    border-radius: 0.375rem;
    font-size: 0.875rem;
    background: white;
    color: #111827;
  }

  :global(.dark) .credential-field input {
    background: #374151;
    border-color: #4b5563;
    color: #f3f4f6;
  }

  .credential-field input:focus {
    outline: none;
    border-color: #3b82f6;
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
  }

  .remote-actions {
    flex-wrap: wrap;
  }

  .test-btn {
    padding: 0.5rem 1rem;
    border-radius: 0.375rem;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.2s;
    background: #3b82f6;
    color: white;
    border: none;
  }

  .test-btn:hover:not(:disabled) {
    background: #2563eb;
  }

  .test-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .disconnect-btn {
    padding: 0.5rem 1rem;
    border-radius: 0.375rem;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.2s;
    background: #f97316;
    color: white;
    border: none;
  }

  .disconnect-btn:hover:not(:disabled) {
    background: #ea580c;
  }

  .disconnect-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .test-result {
    margin-top: 1rem;
    padding: 0.75rem 1rem;
    border-radius: 0.5rem;
    font-size: 0.875rem;
  }

  .test-result.success {
    background: rgba(34, 197, 94, 0.1);
    border: 1px solid rgba(34, 197, 94, 0.3);
  }

  .test-result.error {
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.3);
  }

  :global(.dark) .test-result.success {
    background: rgba(34, 197, 94, 0.15);
    border-color: rgba(34, 197, 94, 0.4);
  }

  :global(.dark) .test-result.error {
    background: rgba(239, 68, 68, 0.15);
    border-color: rgba(239, 68, 68, 0.4);
  }

  .result-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-weight: 500;
  }

  .test-result.success .result-header {
    color: #16a34a;
  }

  .test-result.error .result-header {
    color: #dc2626;
  }

  :global(.dark) .test-result.success .result-header {
    color: #4ade80;
  }

  :global(.dark) .test-result.error .result-header {
    color: #f87171;
  }

  .latency {
    font-size: 0.75rem;
    opacity: 0.7;
  }

  .result-detail {
    margin-top: 0.5rem;
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
  }

  .result-detail .detail-label {
    font-weight: 500;
    color: #6b7280;
    flex-shrink: 0;
  }

  :global(.dark) .result-detail .detail-label {
    color: #9ca3af;
  }

  .result-detail .detail-value {
    color: #374151;
  }

  :global(.dark) .result-detail .detail-value {
    color: #e5e7eb;
  }

  .models-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
  }

  .result-error {
    margin-top: 0.5rem;
    color: #dc2626;
  }

  :global(.dark) .result-error {
    color: #f87171;
  }

  .result-note {
    margin-top: 0.5rem;
    font-size: 0.75rem;
  }

  .result-note.warning {
    color: #d97706;
  }

  :global(.dark) .result-note.warning {
    color: #fbbf24;
  }

  /* Local Models Section */
  .local-models-section {
    background: #fdf4ff;
    border: 1px solid #e879f9;
    border-radius: 0.75rem;
    padding: 1rem;
    margin-top: 1.5rem;
  }

  :global(.dark) .local-models-section {
    background: rgba(232, 121, 249, 0.1);
    border-color: rgba(232, 121, 249, 0.3);
  }
</style>
