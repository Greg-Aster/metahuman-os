<script lang="ts">
  import { onMount } from 'svelte';
  import { apiFetch } from '../lib/client/api-config';
  import { DEFAULT_OLLAMA_CHAT_MODEL, DEFAULT_VLLM_CHAT_MODEL } from '../lib/client/model-defaults';
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

  interface LocalModelArtifact {
    id: string;
    displayName: string;
    source: 'ollama-store' | 'huggingface-cache';
    compatibleProviders: string[];
    format: string;
    architecture?: string;
    modelType?: string;
    quantization?: string;
    sizeBytes: number;
    path: string;
    installed: boolean;
    error?: string;
  }

  interface VllmArtifactCompatibility {
    artifactId: string;
    status: 'compatible' | 'incompatible' | 'unknown';
    compatible: boolean;
    architecture?: string;
    reason: string;
    vllmVersion?: string;
    transformersVersion?: string;
  }

  interface VllmMemoryPlan {
    utilization: number;
    allocatedGB: number;
    headroomGB: number;
    freeGB: number;
    usedGB: number;
    totalGB: number;
    recommendation: string;
    currentVllmRunning?: boolean;
  }

  interface VllmLoraAdapter {
    name: string;
    path: string;
    createdAt: string;
    valid: boolean;
    loaded: boolean;
    baseModel?: string;
    loraRank?: number;
    sizeBytes?: number;
    compatibleWithTarget?: boolean;
  }

  interface OllamaLoraAdapter extends VllmLoraAdapter {
    compatibleWithTarget: boolean;
    supportedByOllama: boolean;
    unavailableReason?: string;
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
  let sharedArtifacts: LocalModelArtifact[] = [];
  let vllmArtifacts: LocalModelArtifact[] = [];
  let selectedVllmArtifact: LocalModelArtifact | null = null;
  let vllmArtifactCompatibility: Record<string, VllmArtifactCompatibility> = {};
  let selectedVllmCompatibility: VllmArtifactCompatibility | null = null;
  let checkingVllmCompatibility = false;
  let statusLoading = false;
  let statusWarning: string | null = null;

  let ollamaEndpoint = 'http://localhost:11434';
  let ollamaModel = DEFAULT_OLLAMA_CHAT_MODEL;
  let ollamaModelSelection = '__custom__';
  let ollamaArtifacts: LocalModelArtifact[] = [];
  let selectedOllamaArtifact: LocalModelArtifact | null = null;
  let ollamaContextWindow = 8192;
  let ollamaMaxTokens = 2048;
  let ollamaTemperature = 0.7;
  let ollamaTopP = 0.9;
  let ollamaTopK = 40;
  let ollamaMinP = 0;
  let ollamaRepeatPenalty = 1.1;
  let ollamaSeed: number | undefined = undefined;
  let ollamaKeepAlive = '5m';
  let ollamaEnableThinking = false;
  let showOllamaAdvanced = false;
  let showOllamaLoras = false;
  let ollamaLoraAdapters: OllamaLoraAdapter[] = [];
  let loadingOllamaLoras = false;
  let buildingOllamaLora: string | null = null;

  let vllmEndpoint = 'http://localhost:8000';
  let vllmModel = '';
  let vllmGpuUtil = 0.7;
  let vllmEnforceEager = true;
  let vllmAutoUtilization = false;
  let vllmGpuHeadroomGiB = 1.5;
  let vllmAutoUtilizationMax = 0.95;
  let vllmContextMode: 'auto' | 'manual' = 'auto';
  let vllmMaxModelLen = 4096;
  let vllmKvCacheMemoryGiB = 0;
  let vllmCpuOffloadGiB = 0;
  let vllmKvOffloadingGiB = 0;
  let vllmKvOffloadingBackend: 'native' | 'lmcache' = 'native';
  let vllmMaxTokens = 2048;
  let vllmEnableThinking = true;
  let vllmModelPath = '';
  let vllmLoadFormat = '';
  let vllmQuantization = '';
  let vllmTokenizer = '';
  let vllmServedModelName = '';
  let vllmModelSelection = '__custom__';
  let showVllmAdvanced = false;
  let showVllmLoras = false;
  let vllmMemoryPlan: VllmMemoryPlan | null = null;
  let checkingVllmMemory = false;
  let vllmLoraAdapters: VllmLoraAdapter[] = [];
  let vllmEnabledLoras: string[] = [];
  let vllmMaxLoraRank = 64;
  let vllmMaxLoras = 1;
  let vllmMaxCpuLoras = 1;
  let vllmLoraDtype: 'auto' | 'float16' | 'bfloat16' = 'auto';
  let loadingVllmLoras = false;
  let savingVllmLoras = false;
  let vllmLoraNeedsRestart = false;

  $: vllmArtifacts = sharedArtifacts.filter(artifact =>
    artifact.installed && artifact.compatibleProviders.includes('vllm')
  );
  $: ollamaArtifacts = sharedArtifacts.filter(artifact =>
    artifact.installed &&
    artifact.source === 'ollama-store' &&
    artifact.compatibleProviders.includes('ollama')
  );
  $: selectedOllamaArtifact = ollamaArtifacts.find(artifact => artifact.id === ollamaModelSelection) || null;
  $: selectedVllmArtifact = vllmArtifacts.find(artifact => artifact.id === vllmModelSelection) || null;
  $: selectedVllmCompatibility = selectedVllmArtifact
    ? vllmArtifactCompatibility[selectedVllmArtifact.id] || null
    : null;

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
    void loadBackendSettings().then(() => {
      void refreshVllmMemoryPlan();
      void loadOllamaLoras();
    });
    loadInterpreterStatus();
    loadBigBrotherConfig();
    loadEmbeddingConfig();
    loadVllmLoras();
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

  function formatArtifactSize(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return 'Unknown size';
    const gib = bytes / 1024 / 1024 / 1024;
    return gib >= 1 ? `${gib.toFixed(gib >= 10 ? 0 : 1)} GB` : `${Math.round(bytes / 1024 / 1024)} MB`;
  }

  function syncVllmModelSelection() {
    const artifact = sharedArtifacts.find(candidate =>
      candidate.installed &&
      candidate.compatibleProviders.includes('vllm') &&
      (
      candidate.id === vllmModel ||
      candidate.displayName === vllmModel ||
      candidate.path === vllmModelPath
      )
    );
    vllmModelSelection = artifact?.id || '__custom__';
  }

  function syncOllamaModelSelection() {
    const artifact = sharedArtifacts.find(candidate =>
      candidate.installed &&
      candidate.source === 'ollama-store' &&
      candidate.compatibleProviders.includes('ollama') &&
      (candidate.id === ollamaModel || candidate.displayName === ollamaModel)
    );
    ollamaModelSelection = artifact?.id || '__custom__';
  }

  function selectOllamaModel() {
    const artifact = ollamaArtifacts.find(candidate => candidate.id === ollamaModelSelection);
    if (!artifact) {
      ollamaModel = '';
      return;
    }
    ollamaModel = artifact.displayName;
    void loadOllamaLoras(ollamaModel);
  }

  function applyBackendConfig(config: any) {
    configuredActiveBackend = config.activeBackend || 'auto';
    activeBackend = isDefaultBackend(configuredActiveBackend) ? configuredActiveBackend : 'auto';
    preferredLocalBackend = config.preferredLocalBackend === 'ollama' ? 'ollama' : 'vllm';

    ollamaEndpoint = config.ollama?.endpoint || 'http://localhost:11434';
    ollamaModel = config.ollama?.defaultModel || DEFAULT_OLLAMA_CHAT_MODEL;
    ollamaContextWindow = config.ollama?.contextWindow ?? 8192;
    ollamaMaxTokens = config.ollama?.maxTokens ?? 2048;
    ollamaTemperature = config.ollama?.temperature ?? 0.7;
    ollamaTopP = config.ollama?.topP ?? 0.9;
    ollamaTopK = config.ollama?.topK ?? 40;
    ollamaMinP = config.ollama?.minP ?? 0;
    ollamaRepeatPenalty = config.ollama?.repeatPenalty ?? 1.1;
    ollamaSeed = config.ollama?.seed === null || config.ollama?.seed === undefined
      ? undefined
      : Number(config.ollama.seed);
    ollamaKeepAlive = config.ollama?.keepAlive || '5m';
    ollamaEnableThinking = config.ollama?.enableThinking ?? false;

    vllmEndpoint = config.vllm?.endpoint || 'http://localhost:8000';
    vllmModel = config.vllm?.model || '';
    vllmModelPath = config.vllm?.modelPath || '';
    vllmLoadFormat = config.vllm?.loadFormat || '';
    vllmQuantization = config.vllm?.quantization || '';
    vllmTokenizer = config.vllm?.tokenizer || '';
    vllmServedModelName = config.vllm?.servedModelName || '';
    vllmGpuUtil = config.vllm?.gpuMemoryUtilization ?? 0.7;
    vllmEnforceEager = config.vllm?.enforceEager ?? true;
    vllmAutoUtilization = config.vllm?.autoUtilization ?? false;
    vllmGpuHeadroomGiB = config.vllm?.gpuMemoryHeadroomGiB ?? 1.5;
    vllmAutoUtilizationMax = config.vllm?.autoUtilizationMax ?? 0.95;
    vllmContextMode = config.vllm?.maxModelLen === 'auto' ? 'auto' : 'manual';
    vllmMaxModelLen = typeof config.vllm?.maxModelLen === 'number' ? config.vllm.maxModelLen : 4096;
    vllmKvCacheMemoryGiB = config.vllm?.kvCacheMemoryGiB ?? 0;
    vllmCpuOffloadGiB = config.vllm?.cpuOffloadGiB ?? 0;
    vllmKvOffloadingGiB = config.vllm?.kvOffloadingGiB ?? 0;
    vllmKvOffloadingBackend = config.vllm?.kvOffloadingBackend === 'lmcache' ? 'lmcache' : 'native';
    vllmMaxTokens = config.vllm?.maxTokens || 2048;
    vllmEnableThinking = config.vllm?.enableThinking ?? true;

    if (config.remote?.serverUrl) {
      remoteServerUrl = config.remote.serverUrl;
    }

    syncOllamaModelSelection();
    syncVllmModelSelection();
  }

  async function loadOllamaLoras(targetModel = ollamaModel) {
    if (!targetModel.trim()) {
      ollamaLoraAdapters = [];
      return;
    }
    loadingOllamaLoras = true;
    try {
      const res = await apiFetch(`/api/ollama/loras?model=${encodeURIComponent(targetModel.trim())}`, {
        signal: AbortSignal.timeout(8000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || `Ollama LoRA settings returned ${res.status}`);
      }
      ollamaLoraAdapters = data.available || [];
    } catch (err) {
      console.error('[BackendSettings] Ollama LoRA settings failed:', err);
      ollamaLoraAdapters = [];
    } finally {
      loadingOllamaLoras = false;
    }
  }

  async function buildOllamaLora(adapter: OllamaLoraAdapter) {
    if (adapter.unavailableReason || !ollamaModel.trim()) return;
    buildingOllamaLora = adapter.name;
    clearMessages();
    try {
      const res = await apiFetch('/api/ollama/loras', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adapterName: adapter.name,
          baseModel: ollamaModel.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        error = data.error || 'Failed to create Ollama model from the selected LoRA';
        return;
      }
      ollamaModel = data.modelName;
      savedNotice = `${data.modelName} was created and selected for new Ollama requests.`;
      await loadStatus();
      await loadOllamaLoras(ollamaModel);
      statusRefreshTrigger.update(n => n + 1);
    } catch {
      error = 'Failed to create Ollama model from the selected LoRA';
    } finally {
      buildingOllamaLora = null;
    }
  }

  function selectVllmModel() {
    const artifact = vllmArtifacts.find(candidate => candidate.id === vllmModelSelection);
    if (!artifact) {
      vllmModel = '';
      vllmModelPath = '';
      vllmLoadFormat = 'auto';
      vllmQuantization = '';
      vllmTokenizer = '';
      vllmServedModelName = '';
      showVllmAdvanced = true;
      return;
    }

    vllmModel = artifact.displayName;
    vllmModelPath = artifact.format === 'gguf' ? artifact.path : '';
    vllmLoadFormat = artifact.format === 'gguf' ? 'gguf' : 'auto';
    vllmQuantization = artifact.format === 'gguf' ? '' : artifact.quantization || '';
    vllmTokenizer = '';
    vllmServedModelName = artifact.displayName;
    if (!vllmArtifactCompatibility[artifact.id]) {
      void preflightVllmArtifacts([artifact.id]);
    }
    void loadVllmLoras(artifact.displayName);
  }

  async function preflightVllmArtifacts(artifactIds = vllmArtifacts.map(artifact => artifact.id)) {
    if (artifactIds.length === 0) return;
    checkingVllmCompatibility = true;
    try {
      const res = await apiFetch('/api/llm-backend/vllm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'preflight', artifactIds }),
        signal: AbortSignal.timeout(15000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || `Compatibility preflight returned ${res.status}`);
      }
      vllmArtifactCompatibility = {
        ...vllmArtifactCompatibility,
        ...Object.fromEntries(
          (data.results || []).map((result: VllmArtifactCompatibility) => [result.artifactId, result])
        ),
      };
    } catch (err) {
      console.error('[BackendSettings] vLLM artifact preflight failed:', err);
      statusWarning = 'Could not verify installed GGUF models against vLLM. They will not be started until compatibility is known.';
    } finally {
      checkingVllmCompatibility = false;
    }
  }

  async function refreshVllmMemoryPlan() {
    checkingVllmMemory = true;
    try {
      const res = await apiFetch('/api/llm-backend/vllm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'memory_plan',
          gpuMemoryHeadroomGiB: vllmGpuHeadroomGiB,
          autoUtilizationMax: vllmAutoUtilizationMax,
        }),
        signal: AbortSignal.timeout(8000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || `Memory plan returned ${res.status}`);
      }
      vllmMemoryPlan = data;
    } catch (err) {
      console.error('[BackendSettings] vLLM memory planning failed:', err);
      vllmMemoryPlan = null;
      statusWarning = 'Could not read live GPU memory. Saved vLLM settings remain editable.';
    } finally {
      checkingVllmMemory = false;
    }
  }

  async function loadVllmLoras(targetModel = vllmModel) {
    loadingVllmLoras = true;
    try {
      const query = targetModel.trim() ? `?model=${encodeURIComponent(targetModel.trim())}` : '';
      const res = await apiFetch(`/api/vllm/loras${query}`, {
        signal: AbortSignal.timeout(8000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || `LoRA settings returned ${res.status}`);
      }
      vllmLoraAdapters = data.available || [];
      vllmEnabledLoras = data.config?.enabledAdapters || [];
      vllmMaxLoraRank = data.config?.maxLoraRank ?? 64;
      vllmMaxLoras = data.config?.maxLoras ?? 1;
      vllmMaxCpuLoras = data.config?.maxCpuLoras ?? vllmMaxLoras;
      vllmLoraDtype = data.config?.loraDtype || 'auto';
    } catch (err) {
      console.error('[BackendSettings] vLLM LoRA settings failed:', err);
      vllmLoraAdapters = [];
    } finally {
      loadingVllmLoras = false;
    }
  }

  async function saveVllmLoraConfig() {
    if (vllmMaxCpuLoras < vllmMaxLoras) {
      error = 'CPU-cached LoRAs must be greater than or equal to active LoRAs per batch.';
      return;
    }
    savingVllmLoras = true;
    clearMessages();
    try {
      const res = await apiFetch('/api/vllm/loras', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'set',
          enabledAdapters: vllmEnabledLoras,
          maxLoraRank: vllmMaxLoraRank,
          maxLoras: vllmMaxLoras,
          maxCpuLoras: vllmMaxCpuLoras,
          loraDtype: vllmLoraDtype,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        error = data.error || 'Failed to save vLLM LoRA settings';
        return;
      }
      vllmLoraNeedsRestart = data.needsRestart ?? true;
      savedNotice = data.needsRestart
        ? 'LoRA settings saved. Restart vLLM to load the selected adapters.'
        : 'LoRA settings saved.';
      await loadVllmLoras();
    } catch (err) {
      error = 'Failed to save vLLM LoRA settings';
    } finally {
      savingVllmLoras = false;
    }
  }

  async function loadBackendSettings() {
    loading = true;
    void loadStatus();

    try {
      const res = await apiFetch('/api/llm-backend/config', {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        throw new Error(`Backend configuration returned ${res.status}`);
      }
      applyBackendConfig(await res.json());
    } catch (err) {
      console.error('[BackendSettings] Error loading config:', err);
      error = 'Failed to load saved backend configuration';
    } finally {
      loading = false;
    }
  }

  async function loadStatus(): Promise<boolean> {
    statusLoading = true;
    statusWarning = null;
    try {
      const res = await apiFetch('/api/llm-backend/status', {
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        throw new Error(`Backend status returned ${res.status}`);
      }

      const data = await res.json();
      backendStatus = data.active;
      available = data.available;
      resolvedBackend = data.active?.resolvedBackend || null;
      sharedArtifacts = data.sharedArtifacts || data.available?.sharedArtifacts || [];
      applyBackendConfig(data.config);
      void loadOllamaLoras(ollamaModel);
      void preflightVllmArtifacts(
        sharedArtifacts
          .filter((artifact: LocalModelArtifact) => artifact.installed && artifact.compatibleProviders.includes('vllm'))
          .map((artifact: LocalModelArtifact) => artifact.id)
      );
      return true;
    } catch (err) {
      console.error('[BackendSettings] Error loading status:', err);
      statusWarning = 'Live service status is unavailable. Saved settings are still editable.';
      return false;
    } finally {
      statusLoading = false;
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
    if (!ollamaModel.trim()) {
      error = 'Choose an installed Ollama model or enter a custom model name.';
      return;
    }
    savingOllamaConfig = true;
    clearMessages();

    try {
      const res = await apiFetch('/api/llm-backend/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ollama: {
            endpoint: ollamaEndpoint,
            defaultModel: ollamaModel.trim(),
            contextWindow: ollamaContextWindow,
            maxTokens: ollamaMaxTokens,
            temperature: ollamaTemperature,
            topP: ollamaTopP,
            topK: ollamaTopK,
            minP: ollamaMinP,
            repeatPenalty: ollamaRepeatPenalty,
            seed: Number.isInteger(ollamaSeed) ? ollamaSeed : null,
            keepAlive: ollamaKeepAlive.trim(),
            enableThinking: ollamaEnableThinking,
          },
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        error = data.error || 'Failed to save Ollama config';
        return;
      }

      savedNotice = 'Ollama configuration saved. New requests will use these backend defaults unless a model or graph overrides them.';
      await loadStatus();
      await loadOllamaLoras(ollamaModel);
      statusRefreshTrigger.update(n => n + 1);
    } catch (err) {
      error = 'Failed to save Ollama config';
    } finally {
      savingOllamaConfig = false;
    }
  }

  async function saveVllmConfig() {
    if (!vllmModel.trim()) {
      error = 'Choose an installed model or enter a custom model ID.';
      return;
    }
    if (selectedVllmArtifact && !selectedVllmCompatibility?.compatible) {
      error = selectedVllmCompatibility?.reason || 'This installed artifact has not passed the vLLM compatibility preflight.';
      return;
    }

    savingVllmConfig = true;
    clearMessages();

    try {
      const vllm: Record<string, any> = {
        endpoint: vllmEndpoint,
        model: vllmModel.trim(),
        modelPath: vllmModelPath.trim(),
        loadFormat: vllmLoadFormat.trim() || 'auto',
        quantization: vllmQuantization.trim() || null,
        tokenizer: vllmTokenizer.trim(),
        servedModelName: vllmServedModelName.trim(),
        gpuMemoryUtilization: vllmGpuUtil,
        gpuMemoryHeadroomGiB: vllmGpuHeadroomGiB,
        autoUtilizationMax: vllmAutoUtilizationMax,
        enforceEager: vllmEnforceEager,
        autoUtilization: vllmAutoUtilization,
        maxModelLen: vllmContextMode === 'auto' ? 'auto' : vllmMaxModelLen,
        kvCacheMemoryGiB: vllmKvCacheMemoryGiB > 0 ? vllmKvCacheMemoryGiB : null,
        cpuOffloadGiB: vllmCpuOffloadGiB,
        kvOffloadingGiB: vllmKvOffloadingGiB,
        kvOffloadingBackend: vllmKvOffloadingBackend,
        maxTokens: vllmMaxTokens,
        enableThinking: vllmEnableThinking,
      };

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
      await loadVllmLoras(vllmModel);
      statusRefreshTrigger.update(n => n + 1);
    } catch (err) {
      error = 'Failed to save vLLM config';
    } finally {
      savingVllmConfig = false;
    }
  }

  async function controlLLMBackend(backend: 'ollama' | 'vllm', action: 'start' | 'stop' | 'restart') {
    if (
      backend === 'vllm' &&
      action !== 'stop' &&
      selectedVllmArtifact &&
      !selectedVllmCompatibility?.compatible
    ) {
      error = selectedVllmCompatibility?.reason || 'This installed artifact has not passed the vLLM compatibility preflight.';
      return;
    }
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

  {#if statusWarning}
    <div class="banner banner-warning mb-4 flex items-center justify-between gap-3">
      <span>{statusWarning}</span>
      <button class="btn-secondary btn-sm shrink-0" on:click={loadStatus} disabled={statusLoading}>
        {statusLoading ? 'Checking...' : 'Retry status'}
      </button>
    </div>
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
              <span class="block font-medium text-gray-700 dark:text-gray-300 mb-1">Default model</span>
              <select class="select-field w-full" bind:value={ollamaModelSelection} on:change={selectOllamaModel}>
                {#each ollamaArtifacts as artifact}
                  <option value={artifact.id}>
                    {artifact.displayName} · {artifact.modelType || artifact.architecture || artifact.format.toUpperCase()} · {formatArtifactSize(artifact.sizeBytes)}
                  </option>
                {/each}
                <option value="__custom__">
                  {ollamaModelSelection === '__custom__' && ollamaModel ? `Current custom model — ${ollamaModel}` : 'Custom Ollama model name…'}
                </option>
              </select>
              <span class="block mt-1 text-xs text-gray-500 dark:text-gray-400">
                Installed models are discovered from the same Ollama store used by the service.
              </span>
            </label>

            {#if selectedOllamaArtifact}
              <div class="rounded-lg border border-green-200 dark:border-green-800 bg-green-50/60 dark:bg-green-900/10 p-3 text-sm">
                <div class="font-medium text-green-800 dark:text-green-200">Installed and available to Ollama</div>
                <div class="mt-1 text-xs text-green-700 dark:text-green-300">
                  {selectedOllamaArtifact.architecture || 'Architecture not reported'}{selectedOllamaArtifact.quantization ? ` · ${selectedOllamaArtifact.quantization}` : ''} · {formatArtifactSize(selectedOllamaArtifact.sizeBytes)}
                </div>
              </div>
            {:else}
              <label class="block text-sm">
                <span class="block font-medium text-gray-700 dark:text-gray-300 mb-1">Custom model name</span>
                <input class="input-field font-mono" bind:value={ollamaModel} placeholder="model:tag" />
                <span class="block mt-1 text-xs text-gray-500 dark:text-gray-400">The model must already exist in the configured Ollama service.</span>
              </label>
            {/if}

            <div class="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-3">
              <div class="font-medium text-sm text-gray-800 dark:text-gray-200">Context and generation</div>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label class="block text-sm">
                  <span class="block font-medium text-gray-700 dark:text-gray-300 mb-1">Context tokens</span>
                  <input class="input-field" type="number" min="256" max="1048576" step="1024" bind:value={ollamaContextWindow} />
                </label>
                <label class="block text-sm">
                  <span class="block font-medium text-gray-700 dark:text-gray-300 mb-1">Max output tokens</span>
                  <input class="input-field" type="number" min="1" max="131072" step="256" bind:value={ollamaMaxTokens} />
                </label>
              </div>
              <p class="m-0 text-xs text-gray-500 dark:text-gray-400">
                Larger context uses more memory. Model and cognitive-graph settings can deliberately override these backend defaults.
              </p>
            </div>

            <button
              type="button"
              class="text-left text-sm font-medium text-violet-700 dark:text-violet-300 hover:underline"
              on:click={() => showOllamaAdvanced = !showOllamaAdvanced}
            >
              {showOllamaAdvanced ? 'Hide advanced configuration' : 'Advanced configuration'}
            </button>

            {#if showOllamaAdvanced}
              <div class="grid grid-cols-1 gap-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-black/[0.02] dark:bg-white/[0.02] p-3">
                <label class="block text-sm">
                  <span class="block font-medium text-gray-700 dark:text-gray-300 mb-1">Endpoint</span>
                  <input class="input-field font-mono" bind:value={ollamaEndpoint} />
                </label>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label class="block text-sm">
                    <span class="block font-medium text-gray-700 dark:text-gray-300 mb-1">Temperature</span>
                    <input class="input-field" type="number" min="0" max="5" step="0.05" bind:value={ollamaTemperature} />
                  </label>
                  <label class="block text-sm">
                    <span class="block font-medium text-gray-700 dark:text-gray-300 mb-1">Top P</span>
                    <input class="input-field" type="number" min="0" max="1" step="0.01" bind:value={ollamaTopP} />
                  </label>
                  <label class="block text-sm">
                    <span class="block font-medium text-gray-700 dark:text-gray-300 mb-1">Top K</span>
                    <input class="input-field" type="number" min="0" max="10000" step="1" bind:value={ollamaTopK} />
                  </label>
                  <label class="block text-sm">
                    <span class="block font-medium text-gray-700 dark:text-gray-300 mb-1">Min P</span>
                    <input class="input-field" type="number" min="0" max="1" step="0.01" bind:value={ollamaMinP} />
                  </label>
                  <label class="block text-sm">
                    <span class="block font-medium text-gray-700 dark:text-gray-300 mb-1">Repeat penalty</span>
                    <input class="input-field" type="number" min="0.1" max="5" step="0.05" bind:value={ollamaRepeatPenalty} />
                  </label>
                  <label class="block text-sm">
                    <span class="block font-medium text-gray-700 dark:text-gray-300 mb-1">Seed</span>
                    <input class="input-field" type="number" min="0" step="1" bind:value={ollamaSeed} placeholder="Random" />
                  </label>
                </div>
                <label class="block text-sm">
                  <span class="block font-medium text-gray-700 dark:text-gray-300 mb-1">Keep model loaded</span>
                  <input class="input-field font-mono" bind:value={ollamaKeepAlive} placeholder="5m" />
                  <span class="block mt-1 text-xs text-gray-500 dark:text-gray-400">Examples: 5m, 1h, or 0 to unload after the request.</span>
                </label>
                <label class="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer">
                  <input type="checkbox" bind:checked={ollamaEnableThinking} class="w-4 h-4 accent-violet-600" />
                  <span>Enable model-native thinking by default</span>
                </label>
              </div>
            {/if}

            <div class="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
              <button
                type="button"
                class="w-full flex items-center justify-between text-left text-sm font-medium text-gray-800 dark:text-gray-200"
                on:click={() => showOllamaLoras = !showOllamaLoras}
              >
                <span>LoRA and fine-tuned models</span>
                <span aria-hidden="true">{showOllamaLoras ? '−' : '+'}</span>
              </button>

              {#if showOllamaLoras}
                <div class="mt-3 space-y-3">
                  <p class="m-0 text-xs text-gray-500 dark:text-gray-400">
                    Ollama packages a compatible LoRA with its exact base as a derived model. Already merged or previously created models appear in the main model dropdown above.
                  </p>
                  {#if loadingOllamaLoras}
                    <div class="text-xs text-gray-500">Loading profile adapters…</div>
                  {:else if ollamaLoraAdapters.length === 0}
                    <div class="rounded-md bg-gray-50 dark:bg-gray-800 p-2 text-xs text-gray-500 dark:text-gray-400">
                      No profile LoRA directories containing adapter_model.safetensors and adapter_config.json were found.
                    </div>
                  {:else}
                    <div class="space-y-2">
                      {#each ollamaLoraAdapters as adapter}
                        <div class="rounded-md border border-gray-200 dark:border-gray-700 p-2 text-sm">
                          <div class="flex items-start gap-2">
                            <div class="min-w-0 flex-1">
                              <div class="font-medium text-gray-800 dark:text-gray-200">
                                {adapter.name}
                                {#if adapter.compatibleWithTarget && adapter.supportedByOllama}
                                  <span class="ml-1 text-xs text-green-600 dark:text-green-400">Compatible</span>
                                {:else if adapter.compatibleWithTarget === false}
                                  <span class="ml-1 text-xs text-amber-600 dark:text-amber-400">Different base model</span>
                                {:else}
                                  <span class="ml-1 text-xs text-amber-600 dark:text-amber-400">Use with vLLM</span>
                                {/if}
                              </div>
                              <div class="mt-1 text-xs text-gray-500 dark:text-gray-400 break-all">
                                {adapter.baseModel || 'Unknown base model'}{adapter.loraRank ? ` · rank ${adapter.loraRank}` : ''}{adapter.sizeBytes ? ` · ${formatArtifactSize(adapter.sizeBytes)}` : ''}
                              </div>
                              {#if adapter.unavailableReason}
                                <div class="mt-1 text-xs text-amber-700 dark:text-amber-300">{adapter.unavailableReason}</div>
                              {/if}
                            </div>
                            <button
                              type="button"
                              class="btn-secondary btn-sm shrink-0"
                              on:click={() => buildOllamaLora(adapter)}
                              disabled={Boolean(adapter.unavailableReason) || buildingOllamaLora !== null}
                            >
                              {buildingOllamaLora === adapter.name ? 'Building…' : 'Build & use'}
                            </button>
                          </div>
                        </div>
                      {/each}
                    </div>
                  {/if}
                </div>
              {/if}
            </div>

            <p class="m-0 text-xs text-gray-500 dark:text-gray-400">
              Starts automatically with MetaHuman OS when selected as the default backend.
            </p>
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
              <span class="block font-medium text-gray-700 dark:text-gray-300 mb-1">Model</span>
              <select class="select-field w-full" bind:value={vllmModelSelection} on:change={selectVllmModel}>
                {#each vllmArtifacts as artifact}
                  <option value={artifact.id}>
                    {artifact.displayName} · {artifact.format.toUpperCase()} · {formatArtifactSize(artifact.sizeBytes)}{vllmArtifactCompatibility[artifact.id]?.status === 'incompatible' ? ' · Unsupported' : ''}
                  </option>
                {/each}
                <option value="__custom__">
                  {vllmModelSelection === '__custom__' && vllmModel ? `Current custom model — ${vllmModel}` : 'Custom model ID or path…'}
                </option>
              </select>
              <span class="block mt-1 text-xs text-gray-500 dark:text-gray-400">
                Installed models are discovered from the Ollama store and complete Hugging Face cache snapshots.
              </span>
            </label>

            {#if selectedVllmArtifact}
              <div class="rounded-lg border p-3 text-sm {selectedVllmCompatibility?.compatible ? 'border-green-200 dark:border-green-800 bg-green-50/60 dark:bg-green-900/10' : selectedVllmCompatibility ? 'border-red-200 dark:border-red-800 bg-red-50/60 dark:bg-red-900/10' : 'border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-900/10'}">
                {#if selectedVllmCompatibility?.compatible}
                  <div class="font-medium text-green-800 dark:text-green-200">Verified for this vLLM environment</div>
                  <div class="mt-1 text-xs text-green-700 dark:text-green-300">
                    {selectedVllmCompatibility.reason} MetaHuman OS will use the discovered model identity and served name automatically.
                  </div>
                {:else if selectedVllmCompatibility}
                  <div class="font-medium text-red-800 dark:text-red-200">Not supported by this vLLM environment</div>
                  <div class="mt-1 text-xs text-red-700 dark:text-red-300">{selectedVllmCompatibility.reason}</div>
                {:else}
                  <div class="font-medium text-amber-800 dark:text-amber-200">
                    {checkingVllmCompatibility ? 'Checking compatibility…' : 'Compatibility has not been verified'}
                  </div>
                  <button type="button" class="btn-secondary btn-sm mt-2" on:click={() => preflightVllmArtifacts([selectedVllmArtifact.id])} disabled={checkingVllmCompatibility}>
                    {checkingVllmCompatibility ? 'Checking…' : 'Check now'}
                  </button>
                {/if}
              </div>
            {:else}
              <label class="block text-sm">
                <span class="block font-medium text-gray-700 dark:text-gray-300 mb-1">Custom model ID</span>
                <input class="input-field font-mono" bind:value={vllmModel} placeholder={DEFAULT_VLLM_CHAT_MODEL} />
                <span class="block mt-1 text-xs text-gray-500 dark:text-gray-400">Use a Hugging Face model ID or open Advanced for a local path.</span>
              </label>
            {/if}

            <button
              type="button"
              class="text-left text-sm font-medium text-violet-700 dark:text-violet-300 hover:underline"
              on:click={() => showVllmAdvanced = !showVllmAdvanced}
            >
              {showVllmAdvanced ? 'Hide advanced configuration' : 'Advanced configuration'}
            </button>

            {#if showVllmAdvanced}
              <div class="grid grid-cols-1 gap-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-black/[0.02] dark:bg-white/[0.02] p-3">
                <label class="block text-sm">
                  <span class="block font-medium text-gray-700 dark:text-gray-300 mb-1">Endpoint</span>
                  <input class="input-field font-mono" bind:value={vllmEndpoint} />
                </label>
                <label class="block text-sm">
                  <span class="block font-medium text-gray-700 dark:text-gray-300 mb-1">Model path</span>
                  <input class="input-field font-mono" bind:value={vllmModelPath} readonly={selectedVllmArtifact?.format === 'gguf'} placeholder="Optional local artifact path" />
                </label>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label class="block text-sm">
                    <span class="block font-medium text-gray-700 dark:text-gray-300 mb-1">Load format</span>
                    <select class="select-field w-full font-mono" bind:value={vllmLoadFormat} disabled={selectedVllmArtifact?.format === 'gguf'}>
                      <option value="auto">auto</option>
                      <option value="gguf">gguf</option>
                      <option value="safetensors">safetensors</option>
                      <option value="bitsandbytes">bitsandbytes</option>
                      <option value="sharded_state">sharded_state</option>
                    </select>
                  </label>
                  <label class="block text-sm">
                    <span class="block font-medium text-gray-700 dark:text-gray-300 mb-1">Served name</span>
                    <input class="input-field font-mono" bind:value={vllmServedModelName} readonly={selectedVllmArtifact?.format === 'gguf'} placeholder="Optional" />
                  </label>
                </div>
                <label class="block text-sm">
                  <span class="block font-medium text-gray-700 dark:text-gray-300 mb-1">Quantization</span>
                  <select class="select-field w-full font-mono" bind:value={vllmQuantization} disabled={selectedVllmArtifact?.format === 'gguf'}>
                    <option value="">Checkpoint default</option>
                    <option value="bitsandbytes">bitsandbytes (4-bit in-flight)</option>
                    <option value="fp8">fp8 (8-bit in-flight)</option>
                    <option value="awq">awq</option>
                    <option value="gptq">gptq</option>
                    <option value="compressed-tensors">compressed-tensors</option>
                  </select>
                  <span class="block mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Choose a method only when the checkpoint or installed vLLM environment supports it.
                  </span>
                </label>
                <label class="block text-sm">
                  <span class="block font-medium text-gray-700 dark:text-gray-300 mb-1">Tokenizer model</span>
                  <input class="input-field font-mono" bind:value={vllmTokenizer} placeholder="Optional stable Hugging Face model ID" />
                  <span class="block mt-1 text-xs text-gray-500 dark:text-gray-400">
                    For GGUF, use the base model's stable Hugging Face ID. Leave blank to let vLLM read the model metadata.
                  </span>
                </label>
              </div>
            {/if}

            <div class="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-3">
              <div>
                <div class="font-medium text-sm text-gray-800 dark:text-gray-200">GPU memory budget</div>
                <p class="mt-1 mb-0 text-xs text-gray-500 dark:text-gray-400">
                  vLLM loads model weights first, then uses the remaining budget for its KV cache and longer context.
                </p>
              </div>
              <label class="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer">
                <input type="checkbox" bind:checked={vllmAutoUtilization} class="w-4 h-4 accent-violet-600" />
                <span>Calculate allocation from live free VRAM</span>
              </label>

              {#if vllmAutoUtilization}
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label class="block text-sm">
                    <span class="block font-medium text-gray-700 dark:text-gray-300 mb-1">Leave free</span>
                    <div class="flex items-center gap-2">
                      <input class="input-field" type="number" min="0" max="64" step="0.25" bind:value={vllmGpuHeadroomGiB} />
                      <span class="text-xs text-gray-500">GiB</span>
                    </div>
                  </label>
                  <label class="block text-sm">
                    <span class="block font-medium text-gray-700 dark:text-gray-300 mb-1">Maximum allocation</span>
                    <div class="flex items-center gap-2">
                      <input type="range" min="0.5" max="0.99" step="0.01" bind:value={vllmAutoUtilizationMax}
                        class="flex-1 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full appearance-none cursor-pointer accent-violet-600" />
                      <span class="text-xs font-semibold min-w-[3rem]">{Math.round(vllmAutoUtilizationMax * 100)}%</span>
                    </div>
                  </label>
                </div>
                <div class="rounded-md bg-violet-50 dark:bg-violet-900/20 p-2 text-xs text-violet-800 dark:text-violet-200">
                  {#if vllmMemoryPlan}
                    <div class="font-medium">Calculated now: {Math.round(vllmMemoryPlan.utilization * 100)}% / {vllmMemoryPlan.allocatedGB.toFixed(1)} GiB</div>
                    <div class="mt-1">{vllmMemoryPlan.recommendation}</div>
                    {#if vllmMemoryPlan.currentVllmRunning}
                      <div class="mt-1 text-amber-700 dark:text-amber-300">The running vLLM process is included in current usage. Restart recalculates after releasing its existing allocation.</div>
                    {/if}
                  {:else}
                    <div>Use the live calculator to preview the allocation before restarting vLLM.</div>
                  {/if}
                  <button type="button" class="btn-secondary btn-sm mt-2" on:click={refreshVllmMemoryPlan} disabled={checkingVllmMemory}>
                    {checkingVllmMemory ? 'Reading GPU…' : 'Recalculate from GPU'}
                  </button>
                </div>
              {:else}
                <div>
                  <label for="vllm-gpu" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Fixed total VRAM allocation</label>
                  <div class="flex items-center gap-3">
                    <input id="vllm-gpu" type="range" min="0.5" max="0.99" step="0.01" bind:value={vllmGpuUtil}
                      class="flex-1 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full appearance-none cursor-pointer accent-violet-600" />
                    <span class="text-sm font-semibold text-gray-700 dark:text-gray-300 min-w-[3rem]">{Math.round(vllmGpuUtil * 100)}%</span>
                  </div>
                </div>
              {/if}

              <label class="block text-sm">
                <span class="block font-medium text-gray-700 dark:text-gray-300 mb-1">Explicit GPU KV-cache budget</span>
                <div class="flex items-center gap-2">
                  <input class="input-field" type="number" min="0" max="128" step="0.25" bind:value={vllmKvCacheMemoryGiB} />
                  <span class="text-xs text-gray-500">GiB</span>
                </div>
                <span class="block mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Keep at 0 for automatic KV sizing. A non-zero value overrides percentage-based KV sizing.
                </span>
              </label>
            </div>

            <div class="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-3">
              <div class="font-medium text-sm text-gray-800 dark:text-gray-200">Context and generation</div>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label class="block text-sm">
                  <span class="block font-medium text-gray-700 dark:text-gray-300 mb-1">Context policy</span>
                  <select class="select-field w-full" bind:value={vllmContextMode}>
                    <option value="auto">Largest that fits VRAM</option>
                    <option value="manual">Manual token limit</option>
                  </select>
                </label>
                {#if vllmContextMode === 'manual'}
                  <label class="block text-sm">
                    <span class="block font-medium text-gray-700 dark:text-gray-300 mb-1">Context tokens</span>
                    <input class="input-field" type="number" min="256" step="1024" bind:value={vllmMaxModelLen} />
                  </label>
                {/if}
                <label class="block text-sm">
                  <span class="block font-medium text-gray-700 dark:text-gray-300 mb-1">Max output tokens</span>
                  <input class="input-field" type="number" min="1" step="256" bind:value={vllmMaxTokens} />
                </label>
              </div>
              <p class="m-0 text-xs text-gray-500 dark:text-gray-400">
                “Largest that fits VRAM” asks vLLM to profile the loaded model and choose the largest supported context that fits the available KV cache.
              </p>
            </div>

            <div class="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-3">
              <div>
                <div class="font-medium text-sm text-gray-800 dark:text-gray-200">CPU offloading</div>
                <p class="mt-1 mb-0 text-xs text-gray-500 dark:text-gray-400">Offloading can make larger models or contexts fit, but CPU/GPU transfers reduce inference speed.</p>
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label class="block text-sm">
                  <span class="block font-medium text-gray-700 dark:text-gray-300 mb-1">Model weights in CPU RAM</span>
                  <div class="flex items-center gap-2">
                    <input class="input-field" type="number" min="0" max="512" step="0.5" bind:value={vllmCpuOffloadGiB} />
                    <span class="text-xs text-gray-500">GiB</span>
                  </div>
                </label>
                <label class="block text-sm">
                  <span class="block font-medium text-gray-700 dark:text-gray-300 mb-1">KV cache in CPU RAM</span>
                  <div class="flex items-center gap-2">
                    <input class="input-field" type="number" min="0" max="512" step="0.5" bind:value={vllmKvOffloadingGiB} />
                    <span class="text-xs text-gray-500">GiB</span>
                  </div>
                </label>
              </div>
              {#if vllmKvOffloadingGiB > 0}
                <label class="block text-sm">
                  <span class="block font-medium text-gray-700 dark:text-gray-300 mb-1">KV offload backend</span>
                  <select class="select-field w-full" bind:value={vllmKvOffloadingBackend}>
                    <option value="native">Native vLLM</option>
                    <option value="lmcache">LMCache plugin</option>
                  </select>
                  {#if vllmKvOffloadingBackend === 'lmcache'}
                    <span class="block mt-1 text-xs text-amber-600 dark:text-amber-400">LMCache must be installed in the vLLM Python environment.</span>
                  {/if}
                </label>
              {/if}
            </div>

            <div class="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
              <button
                type="button"
                class="w-full flex items-center justify-between text-left text-sm font-medium text-gray-800 dark:text-gray-200"
                on:click={() => showVllmLoras = !showVllmLoras}
              >
                <span>LoRA adapters ({vllmEnabledLoras.length} enabled)</span>
                <span aria-hidden="true">{showVllmLoras ? '−' : '+'}</span>
              </button>

              {#if showVllmLoras}
                <div class="mt-3 space-y-3">
                  <p class="m-0 text-xs text-gray-500 dark:text-gray-400">
                    PEFT safetensors adapters are discovered from your profile and loaded by the normal vLLM launcher. Requests select an adapter through the existing model registry.
                  </p>
                  {#if selectedVllmArtifact?.format === 'gguf' || vllmLoadFormat === 'gguf'}
                    <div class="rounded-md bg-amber-50 dark:bg-amber-900/20 p-2 text-xs text-amber-700 dark:text-amber-300">
                      The current GGUF startup path does not load PEFT LoRAs. Select a compatible Hugging Face checkpoint to use these adapters.
                    </div>
                  {/if}

                  {#if loadingVllmLoras}
                    <div class="text-xs text-gray-500">Loading adapters…</div>
                  {:else if vllmLoraAdapters.length === 0}
                    <div class="rounded-md bg-gray-50 dark:bg-gray-800 p-2 text-xs text-gray-500 dark:text-gray-400">
                      No valid adapter directories containing adapter_model.safetensors and adapter_config.json were found in this profile.
                    </div>
                  {:else}
                    <div class="space-y-2">
                      {#each vllmLoraAdapters as adapter}
                        <label class="flex items-start gap-2 rounded-md border border-gray-200 dark:border-gray-700 p-2 text-sm">
                          <input type="checkbox" bind:group={vllmEnabledLoras} value={adapter.name} disabled={!adapter.valid} class="mt-0.5 w-4 h-4 accent-violet-600" />
                          <span class="min-w-0">
                            <span class="block font-medium text-gray-800 dark:text-gray-200">
                              {adapter.name}
                              {#if adapter.loaded}<span class="ml-1 text-xs text-green-600 dark:text-green-400">Loaded</span>{/if}
                              {#if adapter.compatibleWithTarget === false}<span class="ml-1 text-xs text-amber-600 dark:text-amber-400">Different base model</span>{/if}
                            </span>
                            <span class="block text-xs text-gray-500 dark:text-gray-400 break-all">
                              {adapter.baseModel || 'Unknown base model'}{adapter.loraRank ? ` · rank ${adapter.loraRank}` : ''}{adapter.sizeBytes ? ` · ${formatArtifactSize(adapter.sizeBytes)}` : ''}
                            </span>
                          </span>
                        </label>
                      {/each}
                    </div>
                  {/if}

                  <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label class="block text-sm">
                      <span class="block font-medium text-gray-700 dark:text-gray-300 mb-1">Maximum adapter rank</span>
                      <select class="select-field w-full" bind:value={vllmMaxLoraRank}>
                        {#each [1, 8, 16, 32, 64, 128, 256, 320, 512] as rank}
                          <option value={rank}>{rank}</option>
                        {/each}
                      </select>
                    </label>
                    <label class="block text-sm">
                      <span class="block font-medium text-gray-700 dark:text-gray-300 mb-1">LoRA dtype</span>
                      <select class="select-field w-full" bind:value={vllmLoraDtype}>
                        <option value="auto">Match base model</option>
                        <option value="float16">float16</option>
                        <option value="bfloat16">bfloat16</option>
                      </select>
                    </label>
                    <label class="block text-sm">
                      <span class="block font-medium text-gray-700 dark:text-gray-300 mb-1">Active LoRAs per batch</span>
                      <input class="input-field" type="number" min="1" max="256" step="1" bind:value={vllmMaxLoras} />
                    </label>
                    <label class="block text-sm">
                      <span class="block font-medium text-gray-700 dark:text-gray-300 mb-1">LoRAs cached in CPU RAM</span>
                      <input class="input-field" type="number" min={vllmMaxLoras} max="1024" step="1" bind:value={vllmMaxCpuLoras} />
                    </label>
                  </div>
                  <p class="m-0 text-xs text-gray-500 dark:text-gray-400">
                    CPU-cached adapters save GPU memory but may add adapter-swap latency. The cache count must be at least the active-per-batch count.
                  </p>
                  <div class="flex items-center gap-2 flex-wrap">
                    <button type="button" class="btn-secondary btn-sm" on:click={saveVllmLoraConfig} disabled={savingVllmLoras}>
                      {savingVllmLoras ? 'Saving LoRAs…' : 'Save LoRA settings'}
                    </button>
                    {#if vllmLoraNeedsRestart}
                      <span class="text-xs text-amber-600 dark:text-amber-400">Restart vLLM to apply.</span>
                    {/if}
                  </div>
                </div>
              {/if}
            </div>

            <p class="m-0 text-xs text-gray-500 dark:text-gray-400">
              Starts automatically with MetaHuman OS when selected as the default backend.
            </p>
            <label class="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer">
              <input type="checkbox" bind:checked={vllmEnforceEager} class="w-4 h-4 accent-violet-600" />
              <span>Eager Mode</span>
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
            <button class="btn-primary" on:click={saveVllmConfig} disabled={savingVllmConfig || (selectedVllmArtifact !== null && !selectedVllmCompatibility?.compatible)}>
              {savingVllmConfig ? 'Saving...' : 'Save vLLM Config'}
            </button>
            {#if available?.vllm.running}
              <button class="btn-danger" on:click={() => controlLLMBackend('vllm', 'stop')} disabled={actionInProgress !== null}>
                {actionInProgress === 'vllm-stop' ? 'Stopping...' : 'Stop'}
              </button>
              <button class="btn-secondary" on:click={() => controlLLMBackend('vllm', 'restart')} disabled={actionInProgress !== null || (selectedVllmArtifact !== null && !selectedVllmCompatibility?.compatible)}>
                {actionInProgress === 'vllm-restart' ? 'Restarting...' : 'Restart'}
              </button>
            {:else}
              <button class="btn-success" on:click={() => controlLLMBackend('vllm', 'start')} disabled={actionInProgress !== null || !available?.vllm.installed || (selectedVllmArtifact !== null && !selectedVllmCompatibility?.compatible)}>
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
