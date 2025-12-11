<script lang="ts">
  import { onMount } from 'svelte';
  import { apiFetch } from '../lib/client/api-config';
  import { statusRefreshTrigger } from '../stores/navigation';

  // Backend types
  type BackendType = 'ollama' | 'vllm' | 'remote' | 'auto';
  // Note: Claude is NOT a remote provider - Big Brother uses Claude via CLI terminal
  type RemoteProviderType = 'runpod' | 'openrouter' | 'openai' | 'server';

  // Backend status
  interface BackendStatus {
    backend: BackendType;
    running: boolean;
    model?: string;
    endpoint: string;
    health: 'healthy' | 'starting' | 'degraded' | 'offline';
    resolvedBackend?: 'ollama' | 'vllm' | 'remote' | 'offline';
    remoteProvider?: RemoteProviderType;
  }

  interface AvailableBackends {
    ollama: { installed: boolean; running: boolean; model?: string };
    vllm: { installed: boolean; running: boolean; model?: string };
    remote: { configured: boolean; provider?: RemoteProviderType; hasCredentials: boolean };
  }

  // Big Brother config (CLI LLM escalation)
  type BigBrotherProvider = 'claude-code' | 'aider' | 'gemini' | 'codex' | 'ollama-cli' | 'custom';

  const bigBrotherProviderOptions: { value: BigBrotherProvider; label: string; description: string }[] = [
    { value: 'claude-code', label: 'Claude Code', description: 'Anthropic Claude via CLI' },
    { value: 'aider', label: 'Aider', description: 'Aider with any model (GPT-4, Claude, Qwen)' },
    { value: 'gemini', label: 'Gemini CLI', description: 'Google Gemini via CLI' },
    { value: 'codex', label: 'OpenAI Codex', description: 'OpenAI Codex CLI' },
    { value: 'ollama-cli', label: 'Ollama CLI', description: 'Local models via Ollama' },
    { value: 'custom', label: 'Custom', description: 'Custom CLI command' },
  ];

  interface BigBrotherConfig {
    enabled: boolean;
    provider: BigBrotherProvider;
    escalateOnStuck: boolean;
    escalateOnRepeatedFailures: boolean;
    maxRetries: number;
    includeFullScratchpad: boolean;
    autoApplySuggestions: boolean;
  }

  // RunPod config
  interface RunPodConfig {
    apiKey: string | null;
    templateId: string | null;
    gpuType: string | null;
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
  let vllmEnableThinking = true; // Qwen3 thinking mode (shows <think> tags)

  // Ollama config
  let ollamaEndpoint = 'http://localhost:11434';
  let ollamaModel = 'qwen3:14b';

  // Remote provider config (from llm-backend.json)
  let remoteProvider: RemoteProviderType = 'runpod';
  let remoteServerUrl = '';
  let remoteModel = '';
  let resolvedBackend: 'ollama' | 'vllm' | 'remote' | 'offline' | null = null;

  // Big Brother config (CLI LLM - from operator.json)
  let bigBrotherConfig: BigBrotherConfig | null = null;
  let bigBrotherEnabled = false;
  let bigBrotherProvider: BigBrotherProvider = 'claude-code';
  let savingBigBrother = false;

  // RunPod config (from env/runpod.json)
  let runpodConfig: RunPodConfig | null = null;
  let runpodConfigured = false;

  // Credential tracking
  let credentialSource: 'local' | 'none' = 'none';

  // Embedding config (for semantic memory search)
  let embeddingEnabled = true;
  let embeddingModel = 'nomic-embed-text';
  let embeddingCpuOnly = true;
  let embeddingSaving = false;

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
    loadBigBrotherConfig();
    loadRunPodConfig();
    loadEmbeddingConfig();
  });

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
        vllmEnableThinking = data.config.vllm?.enableThinking ?? true;

        // Ollama config
        ollamaEndpoint = data.config.ollama?.endpoint || 'http://localhost:11434';
        ollamaModel = data.config.ollama?.defaultModel || 'qwen3:14b';

        // Remote provider config
        if (data.config.remote) {
          remoteProvider = data.config.remote.provider || 'runpod';
          remoteServerUrl = data.config.remote.serverUrl || '';
          remoteModel = data.config.remote.model || '';
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

  // Load RunPod config from API
  async function loadRunPodConfig() {
    credentialSource = 'none';

    try {
      const res = await apiFetch('/api/runpod/config');
      if (res.ok) {
        const config = await res.json();
        if (config?.apiKey) {
          runpodConfig = config;
          runpodConfigured = true;
          credentialSource = 'local';
        }
      }
    } catch (err) {
      console.error('[BackendSettings] Error loading RunPod config:', err);
    }
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

  async function saveRemoteConfig() {
    savingRemoteConfig = true;
    error = null;

    try {
      const res = await apiFetch('/api/llm-backend/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          remote: {
            provider: remoteProvider,
            serverUrl: remoteServerUrl,
            model: remoteModel,
          },
        }),
      });

      if (res.ok) {
        // Reload to confirm what was saved
        await loadStatus();
        // Trigger status refresh for other components
        statusRefreshTrigger.update(n => n + 1);
      } else {
        const data = await res.json();
        error = data.error || 'Failed to save remote config';
      }
    } catch (err) {
      error = 'Failed to save remote config';
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
      case 'remote': return '☁️';
      case 'auto': return '🔄';
      default: return '❓';
    }
  }

  function getBackendLabel(backend: BackendType): string {
    switch (backend) {
      case 'ollama': return 'Ollama';
      case 'vllm': return 'vLLM';
      case 'remote': return 'Remote';
      case 'auto': return 'Auto';
      default: return 'Unknown';
    }
  }

  function getProviderLabel(provider: RemoteProviderType): string {
    const labels: Record<RemoteProviderType, string> = {
      runpod: 'RunPod Serverless',
      openrouter: 'OpenRouter',
      openai: 'OpenAI',
      server: 'Desktop Server',
    };
    return labels[provider] || provider;
  }
</script>

<div class="backend-settings">
  <h3>LLM Backend</h3>
  <p class="description">
    Choose your inference backend: local (Ollama/vLLM) or remote (RunPod, OpenRouter, Desktop Server). Auto mode picks the best available.
  </p>

  {#if error}
    <div class="error-banner">{error}</div>
  {/if}

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
        {:else if activeBackend === 'remote'}
          <span class="status-badge running">Active</span>
          <span class="model-badge">{getProviderLabel(remoteProvider)}</span>
          {#if remoteModel}
            <span class="model-note">{remoteModel}</span>
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
      <button
        class="mode-btn"
        class:active={activeBackend === 'remote'}
        on:click={() => switchBackend('remote')}
        disabled={switching}
        title="Use remote cloud providers"
      >
        ☁️ Remote
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

      <!-- Remote Provider Card -->
      <div class="backend-card" class:active={activeBackend === 'remote'}>
        <div class="backend-header">
          <span class="backend-icon">☁️</span>
          <span class="backend-name">Remote</span>
          <span class="status-dot" class:running={runpodConfigured || bigBrotherEnabled} class:stopped={!runpodConfigured && !bigBrotherEnabled}></span>
        </div>

        <div class="backend-info">
          <p class="backend-desc">Cloud GPU or Desktop Server</p>
          <div class="backend-detail">
            <span class="label">RunPod:</span>
            <span class="value" style="color: {runpodConfigured ? '#22c55e' : '#6b7280'}">
              {runpodConfigured ? '✓ Configured' : 'Not configured'}
            </span>
          </div>
          <div class="backend-detail">
            <span class="label">Big Brother:</span>
            <span class="value" style="color: {bigBrotherEnabled ? '#22c55e' : '#6b7280'}">
              {bigBrotherEnabled ? `✓ ${getBigBrotherProviderLabel(bigBrotherProvider)}` : 'Disabled'}
            </span>
          </div>
          {#if remoteServerUrl}
            <div class="backend-detail">
              <span class="label">Server:</span>
              <span class="value endpoint">{remoteServerUrl}</span>
            </div>
          {/if}
        </div>

        <div class="backend-actions">
          {#if activeBackend === 'remote'}
            <span class="active-badge">Active</span>
          {:else}
            <button
              class="switch-btn"
              on:click={() => switchBackend('remote')}
              disabled={switching}
            >
              {switching ? 'Switching...' : 'Switch to Remote'}
            </button>
          {/if}
        </div>
      </div>
    </div>

    <!-- Big Brother Mode (CLI LLM Escalation) -->
    <div class="remote-config big-brother-config">
      <h4>🤖 Big Brother Mode (CLI LLM)</h4>
      <p class="config-desc">
        Escalate to a CLI LLM for complex reasoning. Requires terminal access on desktop.
      </p>

      <div class="config-row checkbox-row">
        <label class="checkbox-label">
          <input
            type="checkbox"
            bind:checked={bigBrotherEnabled}
            on:change={saveBigBrotherConfig}
            disabled={savingBigBrother}
          />
          <span>Enable Big Brother Mode</span>
        </label>
        <span class="config-hint">
          {bigBrotherEnabled ? `${getBigBrotherProviderLabel(bigBrotherProvider)} will handle complex tasks` : 'Disabled - using local models only'}
        </span>
      </div>

      <div class="config-row">
          <label for="big-brother-provider">CLI Provider</label>
          <select
            id="big-brother-provider"
            bind:value={bigBrotherProvider}
            on:change={saveBigBrotherConfig}
            disabled={savingBigBrother}
          >
            {#each bigBrotherProviderOptions as opt}
              <option value={opt.value}>{opt.label} - {opt.description}</option>
            {/each}
          </select>
        </div>

        {#if bigBrotherConfig}
          <div class="config-details">
            <div class="config-detail">
              <span class="detail-label">Active Provider:</span>
              <span class="detail-value">{getBigBrotherProviderLabel(bigBrotherProvider)}</span>
            </div>
            <div class="config-detail">
              <span class="detail-label">Escalate on stuck:</span>
              <span class="detail-value">{bigBrotherConfig.escalateOnStuck ? 'Yes' : 'No'}</span>
            </div>
            <div class="config-detail">
              <span class="detail-label">Auto-retry failures:</span>
              <span class="detail-value">{bigBrotherConfig.escalateOnRepeatedFailures ? 'Yes' : 'No'}</span>
            </div>
          </div>
        {/if}

      {#if savingBigBrother}
        <span class="saving-indicator">Saving...</span>
      {/if}
    </div>

    <!-- RunPod Cloud GPU -->
    <div class="remote-config runpod-config">
      <h4>☁️ RunPod Cloud GPU</h4>
      <p class="config-desc">
        Serverless GPU inference for high-performance models. Works on all devices.
      </p>

      <div class="config-status">
        {#if runpodConfigured}
          <span class="status-badge running">✓ Configured</span>
          <span class="config-hint">
            {#if credentialSource === 'local'}
              From local config
            {:else if credentialSource === 'synced'}
              Synced from desktop
            {:else if credentialSource === 'manual'}
              Manually entered
            {:else}
              API key detected
            {/if}
          </span>
        {:else}
          <span class="status-badge stopped">Not Configured</span>
          <span class="config-hint">Set RUNPOD_API_KEY in .env or etc/runpod.json</span>
        {/if}
      </div>

      {#if runpodConfig && runpodConfigured}
        <div class="config-details">
          <div class="config-detail">
            <span class="detail-label">API Key:</span>
            <span class="detail-value masked">{runpodConfig.apiKey?.slice(0, 8)}...****</span>
          </div>
          {#if runpodConfig.gpuType}
            <div class="config-detail">
              <span class="detail-label">GPU Type:</span>
              <span class="detail-value">{runpodConfig.gpuType}</span>
            </div>
          {/if}
          {#if runpodConfig.templateId}
            <div class="config-detail">
              <span class="detail-label">Template:</span>
              <span class="detail-value">{runpodConfig.templateId}</span>
            </div>
          {/if}
        </div>
      {/if}

      <p class="config-note">
        Configure via environment: RUNPOD_API_KEY, RUNPOD_GPU_TYPE, RUNPOD_TEMPLATE_ID
      </p>
    </div>

    <!-- Remote Server (Desktop Connection) -->
    <div class="remote-config server-config">
      <h4>🖥️ Connect to Desktop Server</h4>
      <p class="config-desc">
        Connect mobile app to your desktop MetaHuman server via Cloudflare Tunnel.
      </p>

      <div class="config-row">
        <label for="remote-server">Server URL</label>
        <input
          id="remote-server"
          type="text"
          bind:value={remoteServerUrl}
          placeholder="https://your-tunnel.trycloudflare.com"
        />
      </div>

      <div class="config-actions">
        <button
          class="save-btn"
          on:click={saveRemoteConfig}
          disabled={savingRemoteConfig}
        >
          {savingRemoteConfig ? 'Saving...' : 'Save Server URL'}
        </button>
      </div>
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

  /* Big Brother config specific styling */
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

  /* RunPod config specific styling */
  .runpod-config {
    background: #f0fdf4;
    border-color: #86efac;
  }

  :global(.dark) .runpod-config {
    background: rgba(34, 197, 94, 0.1);
    border-color: rgba(34, 197, 94, 0.3);
  }

  .runpod-config h4 {
    color: #166534;
  }

  :global(.dark) .runpod-config h4 {
    color: #86efac;
  }

  .runpod-config .config-desc {
    color: #15803d;
  }

  :global(.dark) .runpod-config .config-desc {
    color: #86efac;
  }

  /* Server config styling */
  .server-config {
    background: #f5f5f5;
    border-color: #d1d5db;
  }

  :global(.dark) .server-config {
    background: rgba(107, 114, 128, 0.1);
    border-color: rgba(107, 114, 128, 0.3);
  }

  .server-config h4 {
    color: #374151;
  }

  :global(.dark) .server-config h4 {
    color: #d1d5db;
  }

  .server-config .config-desc {
    color: #4b5563;
  }

  :global(.dark) .server-config .config-desc {
    color: #9ca3af;
  }

  /* Credential actions (sync/manual buttons) */
  .credential-actions {
    display: flex;
    gap: 0.75rem;
    margin-top: 1rem;
    flex-wrap: wrap;
  }

  .sync-btn, .manual-btn {
    padding: 0.5rem 1rem;
    border-radius: 0.375rem;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
    border: 1px solid transparent;
  }

  .sync-btn {
    background: #3b82f6;
    color: white;
    border-color: #2563eb;
  }

  .sync-btn:hover:not(:disabled) {
    background: #2563eb;
  }

  .sync-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .manual-btn {
    background: #f3f4f6;
    color: #374151;
    border-color: #d1d5db;
  }

  :global(.dark) .manual-btn {
    background: #374151;
    color: #e5e7eb;
    border-color: #4b5563;
  }

  .manual-btn:hover {
    background: #e5e7eb;
  }

  :global(.dark) .manual-btn:hover {
    background: #4b5563;
  }

  /* Manual credential entry form */
  .manual-entry {
    margin-top: 1rem;
    padding: 1rem;
    background: rgba(0, 0, 0, 0.03);
    border-radius: 0.5rem;
    border: 1px dashed #d1d5db;
  }

  :global(.dark) .manual-entry {
    background: rgba(255, 255, 255, 0.03);
    border-color: #4b5563;
  }

  .manual-entry .config-row {
    margin-bottom: 0.75rem;
  }

  .manual-entry .config-row:last-of-type {
    margin-bottom: 0;
  }

  .manual-entry .config-actions {
    margin-top: 1rem;
    padding-top: 0.75rem;
    border-top: 1px solid #e5e7eb;
  }

  :global(.dark) .manual-entry .config-actions {
    border-color: #374151;
  }
</style>
