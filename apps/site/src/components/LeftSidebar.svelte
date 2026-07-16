<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { activeView, statusStore, statusRefreshTrigger, yoloModeStore } from '../stores/navigation';
  import { currentMode, isOwner } from '../stores/security-policy';
  import { pendingCount, loadApprovals } from '../stores/approvals';
  import { apiFetch } from '../lib/client/api-config';
  import SyncStatus from './SyncStatus.svelte';

  interface MenuItem {
    id: string;
    label: string;
    icon: string;
    description?: string;
  }

  const menuItems: MenuItem[] = [
    { id: 'chat', label: 'Chat', icon: '💬', description: 'Conversation interface' },
    { id: 'dashboard', label: 'Dashboard', icon: '📊', description: 'System overview' },
    { id: 'projects', label: 'Projects', icon: '📁', description: 'Task graph & projects' },
    { id: 'agency', label: 'Agency', icon: '🎯', description: 'Autonomous desires' },
    { id: 'persona', label: 'Persona', icon: '👤', description: 'Identity & personality' },
    { id: 'voice', label: 'Voice', icon: '🎤', description: 'Audio & training' },
    { id: 'training', label: 'AI Training', icon: '🧠', description: 'LoRA adapters' },
    { id: 'system', label: 'System', icon: '⚙️', description: 'Settings & tools' },
  ];

  // Current user state
  interface User {
    id: string;
    username: string;
    role: 'owner' | 'standard' | 'guest' | 'anonymous';
  }
  let currentUser: User | null = null;

  function selectView(viewId: string) {
    activeView.set(viewId);
  }

  // Status data
  let identity: any = null;
  let loading = true;
  let trustMenuOpen = false;
  let trustOptions: string[] = [];
  let yoloMode = false;

  // Subscribe to YOLO mode store
  yoloModeStore.subscribe(value => {
    yoloMode = value;
  });

  type AdapterInfo = {
    status?: string;
    modelName?: string;
    isDualAdapter?: boolean;
    activatedAt?: string;
    source?: string;
  } | null;

  type ModelStatus = {
    current?: string | null;
    base?: string | null;
    useAdapter?: boolean;
    adapterMode?: string;
    personaSummary?: string;
    adapter?: AdapterInfo;
  } | null;

  type ModelRoleInfo = {
    modelId?: string;
    provider?: string;
    model?: string;
    capabilities?: string[];
    adapters?: string[];
    baseModel?: string;
    temperature?: number;
    error?: string;
  };

  let modelInfo: ModelStatus = null;
  let modelRoles: Record<string, ModelRoleInfo> = {};
  let hasModelRegistry = false;
  let taskTotals = { active: 0, inProgress: 0 };

  // Persona facet state
  let activeFacet: string | null = null;
  let facets: Record<string, any> = {};
  let personaFacetTooltip = '';
  let personaFacetError: string | null = null;

  $: personaFacetTooltip = (() => {
    if (personaFacetError) {
      return `Persona configuration error\n\n${personaFacetError}\n\nOpen Persona settings to repair facets.json.`;
    }
    const info = activeFacet ? facets?.[activeFacet] : undefined;
    const currentLabel =
      activeFacet === 'inactive'
        ? 'Persona disabled'
        : info?.name || activeFacet || 'default';

    const lines = [
      'Click to cycle persona facet',
      '',
      `Current: ${currentLabel}`,
    ];

    if (activeFacet === 'inactive') {
      lines.push('Persona context disabled - responses use the base model without identity scaffolding.');
    } else if (info?.description) {
      lines.push(info.description);
    }

    if (info?.resolvedPath) {
      lines.push('');
      lines.push(`Persona file: ${info.resolvedPath}`);
    } else if (activeFacet === 'inactive') {
      lines.push('');
      lines.push('Persona file: (none)');
    }

    lines.push('');
    lines.push('Progression: inactive → default → poet → thinker → friend → antagonist → inactive');
    return lines.join('\n');
  })();

  // Subscribe to the shared status store
  let statusSubscription = null;

  // Load status from shared store instead of making API call directly
  async function loadStatus() {
    statusSubscription = statusStore.subscribe((data) => {
      if (data) {
        identity = data.identity;
        taskTotals = {
          active: data?.tasks?.active ?? 0,
          inProgress: data?.tasks?.byStatus?.in_progress ?? 0,
        };
        modelInfo = data?.model || null;
        modelRoles = data?.modelRoles || {};
        hasModelRegistry = Object.keys(modelRoles).length > 0;
        loading = false;

        // Populate cloud models from unified status endpoint (works on mobile too)
        if (data.systemHealth?.cloudModels && data.systemHealth.cloudModels.length > 0) {
          modelCategories.remote = data.systemHealth.cloudModels.map((m: { id: string; model: string; provider: string }) => ({
            id: m.id,
            model: m.model,
            provider: m.provider,
            locked: false
          }));
        } else {
          modelCategories.remote = [];
        }

        // Update backend info from status
        if (data.systemHealth) {
          activeBackend = data.systemHealth.activeBackend || 'auto';
          resolvedBackend = data.systemHealth.resolvedBackend || null;
          remoteProvider = data.systemHealth.remoteProvider || null;

          // Extract backend availability for multi-icon display
          if (data.systemHealth.backendAvailability) {
            const wasConnected = backendAvailability.remoteServer?.connected || false;
            backendAvailability = {
              ...data.systemHealth.backendAvailability,
              remoteServer: {
                ...data.systemHealth.backendAvailability.remoteServer,
                connected: wasConnected
              }
            };

            if (backendAvailability.remoteServer.configured && backendAvailability.remoteServer.serverUrl) {
              checkRemoteServerConnection();
            }
          }
        }
      }
    });
  }

  // Check remote server connection and fetch available models
  async function checkRemoteServerConnection() {
    const serverUrl = backendAvailability.remoteServer.serverUrl;
    if (!serverUrl) return;

    try {
      const res = await apiFetch('/api/remote-server/health');
      const data = await res.json();

      if (res.ok && data.healthy) {
        backendAvailability.remoteServer.connected = true;
      } else {
        backendAvailability.remoteServer.connected = false;
      }
    } catch (e) {
      backendAvailability.remoteServer.connected = false;
    }
  }


  async function loadTrustOptions() {
    try {
      const res = await apiFetch('/api/trust');
      const data = await res.json();
      if (res.ok) {
        trustOptions = Array.isArray(data.available) ? data.available : [];
        if (identity) identity.trustLevel = data.level;

        if (data.level !== 'adaptive_auto') {
          yoloModeStore.set(false);
          saveChatPrefs();
        }
      }
    } catch (e) {
      console.error('Failed to load trust options:', e);
    }
  }

  async function setTrust(level: string) {
    try {
      const res = await apiFetch('/api/trust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to set trust level');
      if (identity) identity.trustLevel = data.level;
      trustMenuOpen = false;
    } catch (e) {
      alert((e as Error).message);
    }
  }

  async function cycleTrustLevel() {
    if ($currentMode === 'emulation') {
      alert('Trust level is locked to "observe" in emulation mode for safety.');
      return;
    }

    const trustProgression = ['observe', 'suggest', 'supervised_auto', 'bounded_auto', 'adaptive_auto'];
    const currentTrust = identity?.trustLevel || 'observe';
    const currentYolo = yoloMode;

    if (currentYolo) {
      yoloModeStore.set(false);
      await setTrust('observe');
      saveChatPrefs();
      return;
    }

    const currentIndex = trustProgression.indexOf(currentTrust);

    if (currentIndex === trustProgression.length - 1) {
      try {
        if (!localStorage.getItem('yoloWarned')) {
          alert('YOLO mode relaxes ALL safety checks and allows maximum operator autonomy. Use with extreme caution.');
          localStorage.setItem('yoloWarned', '1');
        }
      } catch {}

      yoloModeStore.set(true);
      saveChatPrefs();
      return;
    }

    const nextIndex = currentIndex + 1;
    if (nextIndex < trustProgression.length) {
      await setTrust(trustProgression[nextIndex]);
    }
  }

  function saveChatPrefs() {
    try {
      const prefs = localStorage.getItem('chatPrefs');
      const parsed = prefs ? JSON.parse(prefs) : {};
      parsed.yoloMode = yoloMode;
      localStorage.setItem('chatPrefs', JSON.stringify(parsed));
    } catch {}
  }

  async function togglePersonaMode() {
    if ($currentMode === 'emulation') {
      alert('Persona context is locked to "active" in emulation mode for stable personality.');
      return;
    }

    const currentlyEnabled = modelInfo?.personaSummary === 'enabled';
    const newState = !currentlyEnabled;

    if (!newState && !modelInfo?.useAdapter && !modelInfo?.activeAdapter) {
      const proceed = confirm(
        'Disabling persona context removes personality, values, and memory grounding.\n\n' +
        'You have no active LoRA adapters or specialized models loaded.\n\n' +
        'Without persona context, the LLM will use default behavior without your personality scaffold.\n\n' +
        'Recommended: Keep persona context ENABLED until you have trained adapters.\n\n' +
        'Disable anyway?'
      );
      if (!proceed) return;
    }

    try {
      const response = await apiFetch('/api/persona-toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: newState }),
      });

      const result = await response.json();

      if (result.success) {
        alert(result.message || (newState ? 'Persona context enabled' : 'Persona context disabled'));
        setTimeout(() => {
          statusRefreshTrigger.update(n => n + 1);
        }, 100);
      } else if (result.locked) {
        alert(result.error);
      } else {
        alert('Failed to toggle persona context: ' + (result.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Error toggling persona context:', error);
      alert('Failed to toggle persona context: ' + (error as Error).message);
    }
  }

  async function loadFacets() {
    try {
      const response = await apiFetch('/api/persona-facet');
      const data = await response.json();
      if (!response.ok || data.error) {
        throw new Error(data.error || `Failed to load persona facets (HTTP ${response.status})`);
      }
      if (typeof data.activeFacet !== 'string' || !data.facets || typeof data.facets !== 'object') {
        throw new Error('Persona facet response is incomplete');
      }
      activeFacet = data.activeFacet;
      facets = data.facets;
      personaFacetError = null;
    } catch (error) {
      console.error('Error loading facets:', error);
      activeFacet = null;
      facets = {};
      personaFacetError = (error as Error).message;
    }
  }

  async function cyclePersonaFacet() {
    if (personaFacetError || !activeFacet) return;
    const availableFacets = Object.keys(facets).filter(
      key => facets[key]?.enabled !== false
    );

    if (availableFacets.length === 0) {
      console.warn('No enabled facets available');
      return;
    }

    const currentIndex = availableFacets.indexOf(activeFacet);
    const nextIndex = (currentIndex + 1) % availableFacets.length;
    const nextFacet = availableFacets[nextIndex];

    try {
      const response = await apiFetch('/api/persona-facet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facet: nextFacet }),
      });

      const result = await response.json();

      if (result.success) {
        activeFacet = nextFacet;
        setTimeout(() => statusRefreshTrigger.update(n => n + 1), 100);
      } else {
        console.error('Failed to switch facet:', result.error);
      }
    } catch (error) {
      console.error('Error cycling facet:', error);
    }
  }

  interface AvailableModel {
    id: string;
    model: string;
    provider: string;
    roles?: string[];
    capabilities?: string[];
    description: string;
    adapters: string[];
    baseModel?: string | null;
    metadata?: Record<string, any>;
    options?: Record<string, any>;
    source?: string;
  }

  interface LoRAAdapterInfo {
    id: string;
    name: string;
    path: string;
    date?: string;
    isDualAdapter: boolean;
    size: number;
  }

  interface ModelCategories {
    local: AvailableModel[];
    lora: LoRAAdapterInfo[];
    remote: AvailableModel[];
    bigBrother: AvailableModel[];
  }

  interface LocalModelInfo {
    id: string;
    name: string;
    provider: 'ollama' | 'vllm' | 'remote';
    locked: boolean;
  }

  type BackendType = 'ollama' | 'vllm' | 'remote' | 'auto';
  type ResolvedBackendType = 'ollama' | 'vllm' | 'remote' | 'offline';
  type RemoteProviderType = 'runpod' | 'openrouter' | 'openai' | 'server';

  const remoteProviderNames: Record<RemoteProviderType, string> = {
    runpod: 'RunPod',
    openrouter: 'OpenRouter',
    openai: 'OpenAI',
    server: 'Server',
  };

  let availableModels: AvailableModel[] = [];
  let uniqueModels: AvailableModel[] = [];
  let roleAssignments: Record<string, string> = {};
  let modelDropdownOpen: Record<string, boolean> = {};
  let loadingModelRegistry = false;
  let statusRefreshInFlight = false;

  // vLLM LoRA restart modal state
  let showRestartModal = false;
  let pendingLoraName = '';
  let restartInProgress = false;

  let activeBackend: BackendType = 'ollama';
  let resolvedBackend: ResolvedBackendType | null = null;
  let remoteProvider: RemoteProviderType | null = null;
  let localModel: LocalModelInfo | null = null;
  let modelCategories: ModelCategories = {
    local: [],
    lora: [],
    remote: [],
    bigBrother: []
  };

  interface BackendAvailability {
    ollama: { available: boolean; running: boolean; active: boolean; model?: string };
    vllm: { available: boolean; running: boolean; active: boolean; model?: string };
    runpod: { available: boolean; configured: boolean; active: boolean };
    bigBrother: { available: boolean; enabled: boolean; provider?: string };
    remoteServer: { available: boolean; configured: boolean; serverUrl?: string; connected?: boolean };
    localModels: { available: boolean; running: boolean; embeddingModel?: string | null; llmModel?: string | null };
  }
  let backendAvailability: BackendAvailability = {
    ollama: { available: false, running: false, active: false },
    vllm: { available: false, running: false, active: false },
    runpod: { available: false, configured: false, active: false },
    bigBrother: { available: false, enabled: false },
    remoteServer: { available: false, configured: false, connected: false },
    localModels: { available: false, running: false, embeddingModel: null, llmModel: null }
  };


  function getOllamaTooltip(): string {
    const ba = backendAvailability.ollama;
    if (!ba.available) return 'Ollama: Not installed';
    if (ba.running) return `Ollama: Running${ba.model ? ` (${ba.model})` : ''}${ba.active ? ' [ACTIVE]' : ''}`;
    return 'Ollama: Installed but not running';
  }
  function getVllmTooltip(): string {
    const ba = backendAvailability.vllm;
    if (!ba.available) return 'vLLM: Not installed';
    if (ba.running) return `vLLM: Running${ba.model ? ` (${ba.model})` : ''}${ba.active ? ' [ACTIVE]' : ''}`;
    return 'vLLM: Installed but not running';
  }
  function getRunPodTooltip(): string {
    const ba = backendAvailability.runpod;
    if (!ba.available) return 'RunPod: Not configured';
    return `RunPod: Configured${ba.active ? ' [ACTIVE]' : ''}`;
  }
  function getBigBrotherTooltip(): string {
    const ba = backendAvailability.bigBrother;
    if (!ba.available) return 'Big Brother: Not available';
    if (ba.enabled) return `Big Brother: Enabled (${ba.provider || 'claude-code'})`;
    return 'Big Brother: Disabled';
  }
  function getRemoteServerTooltip(): string {
    const ba = backendAvailability.remoteServer;
    if (!ba.configured) return 'Remote Server: Not configured - Configure in Settings → Backend';
    if (ba.connected) {
      const remoteModels = modelCategories.remote.filter(m => m.provider === 'remote-server');
      const modelInfo = remoteModels.length > 0
        ? ` (${remoteModels.map(m => m.model).join(', ')})`
        : '';
      return `Remote Server: Connected${modelInfo}\n${ba.serverUrl}`;
    }
    return `Remote Server: Configured (testing connection...)\n${ba.serverUrl}`;
  }
  function getLocalModelsTooltip(): string {
    const ba = backendAvailability.localModels;
    if (!ba.available) return 'Semantic Search: Not configured';
    if (ba.running) {
      const parts = ['Semantic Search: Running'];
      if (ba.embeddingModel) parts.push(`Embeddings: ${ba.embeddingModel}`);
      if (ba.llmModel) parts.push(`LLM: ${ba.llmModel}`);
      return parts.join('\n');
    }
    return `Semantic Search: Configured but not running${ba.embeddingModel ? `\nModel: ${ba.embeddingModel}` : ''}`;
  }

  async function loadModelRegistry() {
    if (loadingModelRegistry) return;
    loadingModelRegistry = true;

    try {
      const mode = get(currentMode);
      const queryParams = mode ? `?cognitiveMode=${encodeURIComponent(mode)}` : '';
      const response = await apiFetch(`/api/model-registry${queryParams}`);
      const data = await response.json();

      if (data.success) {
        availableModels = data.availableModels || [];
        roleAssignments = data.roleAssignments || {};

        if (data.activeBackend) {
          activeBackend = data.activeBackend;
        }
        if (data.resolvedBackend) {
          resolvedBackend = data.resolvedBackend;
        }
        if (data.localModel) {
          localModel = data.localModel;
        }
        if (data.modelCategories) {
          modelCategories = data.modelCategories;
        }

        const seen = new Map<string, AvailableModel>();
        for (const model of availableModels) {
          const key = model.model;
          if (!seen.has(key)) {
            seen.set(key, model);
          } else {
            const existing = seen.get(key)!;
            if (model.roles) {
              existing.roles = Array.from(new Set([...(existing.roles || []), ...model.roles]));
            }
          }
        }
        uniqueModels = Array.from(seen.values());
      } else {
        console.log('Model registry not accessible (expected for non-owner users)');
      }
    } catch (error) {
      console.error('Error loading model registry:', error);
    } finally {
      loadingModelRegistry = false;
    }
  }

  function updateModelRoleLocally(role: string, modelId: string) {
    const selectedModel = availableModels.find(model => model.id === modelId);
    if (!selectedModel) {
      return;
    }

    modelRoles = {
      ...modelRoles,
      [role]: {
        modelId: selectedModel.id,
        provider: selectedModel.provider,
        model: selectedModel.model,
        capabilities: selectedModel.capabilities ?? [],
        adapters: selectedModel.adapters ?? [],
        baseModel: selectedModel.baseModel ?? null,
        temperature: selectedModel.options?.temperature,
      },
    };
  }

  async function refreshStatus(reason = 'manual') {
    if (statusRefreshInFlight) return;
    statusRefreshInFlight = true;
    try {
      const cacheBust = `_t=${Date.now()}`;
      const res = await apiFetch(`/api/status?${cacheBust}`, { cache: 'no-store' });
      if (!res.ok) {
        throw new Error(`Failed to refresh status (${res.status})`);
      }
      const data = await res.json();
      statusStore.set(data);
    } catch (error) {
      console.warn(`[LeftSidebar] Failed to refresh status after ${reason}:`, error);
    } finally {
      statusRefreshInFlight = false;
    }
  }

  async function assignModelToRole(role: string, modelId: string) {
    console.log(`[LeftSidebar] assignModelToRole called: role=${role}, modelId=${modelId}`);
    try {
      const mode = get(currentMode);
      const payload: Record<string, any> = { role, modelId };
      if (mode) {
        payload.cognitiveMode = mode;
      }

      console.log(`[LeftSidebar] Making POST to /api/model-registry with payload:`, payload);
      const response = await apiFetch('/api/model-registry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      console.log(`[LeftSidebar] POST response status: ${response.status}`);
      const result = await response.json();
      console.log(`[LeftSidebar] POST result:`, result);

      if (result.success) {
        roleAssignments[role] = modelId;
        modelDropdownOpen[role] = false;
        modelDropdownOpen = { ...modelDropdownOpen };
        updateModelRoleLocally(role, modelId);
        void refreshStatus('model assignment');
        void loadModelRegistry();

        if (result.needsRestart && modelId.startsWith('vllm-lora.')) {
          pendingLoraName = modelId.replace('vllm-lora.', '');
          showRestartModal = true;
        } else {
          warmupModel(role).catch(err => {
            console.warn(`Failed to warm up model for role ${role}:`, err);
            const errorMsg = (err as Error).message || 'Unknown error';
            alert(`Model warmup failed for ${role}:\n\n${errorMsg}\n\nThe model assignment was saved but may not work until the backend is available.`);
            modelRoles = {
              ...modelRoles,
              [role]: {
                ...modelRoles[role],
                error: errorMsg
              }
            };
          });
        }

        setTimeout(() => {
          statusRefreshTrigger.update(n => n + 1);
        }, 200);
      } else {
        alert('Failed to assign model: ' + (result.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Error assigning model:', error);
      alert('Failed to assign model: ' + (error as Error).message);
    }
  }

  async function warmupModel(role: string): Promise<void> {
    try {
      const response = await apiFetch('/api/warmup-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });

      const result = await response.json();

      if (result.success) {
        console.log(`[warmup] Model for ${role} loaded in ${result.duration}ms`);
      } else {
        console.warn(`[warmup] Failed to warm up ${role}:`, result.error);
      }
    } catch (error) {
      console.error(`[warmup] Error warming up ${role}:`, error);
      throw error;
    }
  }

  async function restartVllmForLora() {
    restartInProgress = true;
    try {
      const response = await apiFetch('/api/llm-backend/vllm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'restart' }),
      });

      const result = await response.json();

      if (result.success) {
        console.log('[vLLM] Restart successful, loaded LoRAs:', result.loadedLoras);
        showRestartModal = false;
        pendingLoraName = '';
        void refreshStatus('vllm restart');
        void loadModelRegistry();
      } else {
        alert('Failed to restart vLLM: ' + (result.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('[vLLM] Restart error:', error);
      alert('Failed to restart vLLM: ' + (error as Error).message);
    } finally {
      restartInProgress = false;
    }
  }

  function dismissRestartModal() {
    showRestartModal = false;
    pendingLoraName = '';
  }

  function toggleModelDropdown(role: string) {
    modelDropdownOpen[role] = !modelDropdownOpen[role];
    modelDropdownOpen = { ...modelDropdownOpen };
  }

  function closeAllModelDropdowns() {
    modelDropdownOpen = {};
  }

  function handleDocumentClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!target.closest('.model-role-row')) {
      closeAllModelDropdowns();
    }
  }

  async function fetchCurrentUser() {
    try {
      const response = await apiFetch('/api/auth/me');
      const data = await response.json();
      if (data.success && data.user) {
        currentUser = data.user;
      } else {
        currentUser = null;
      }
    } catch (err) {
      console.error('[LeftSidebar] Failed to fetch user:', err);
      currentUser = null;
    }
  }

  onMount(() => {
    void fetchCurrentUser();
    loadStatus();
    loadFacets();
    loadTrustOptions();
    loadModelRegistry();
    loadApprovals();

    const ownerUnsubscribe = isOwner.subscribe(() => {
      loadApprovals();
    });

    document.addEventListener('click', handleDocumentClick);

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        loadApprovals();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      ownerUnsubscribe();
      if (statusSubscription) {
        statusSubscription();
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      document.removeEventListener('click', handleDocumentClick);
    };
  });

  $: taskCount = taskTotals.active;
  $: inProgressCount = taskTotals.inProgress;
</script>

<div class="flex flex-col h-full p-4 gap-4">
  <!-- Menu Items -->
  <nav class="menu">
    {#each menuItems as item}
      <button
        class="menu-item"
        class:active={$activeView === item.id}
        on:click={() => selectView(item.id)}
        title={item.description}
      >
        <span class="menu-icon">{item.icon}</span>
        <div class="menu-text">
          <div class="menu-label">
            {item.label}
            {#if item.id === 'dashboard' && $pendingCount > 0}
              <span class="approval-badge">{$pendingCount}</span>
            {/if}
          </div>
          {#if item.description}
            <div class="menu-description">{item.description}</div>
          {/if}
        </div>
      </button>
    {/each}
  </nav>

  <!-- Status Widget -->
  <div class="status-widget">
    <div class="widget-header">
      <span>Status</span>
      <SyncStatus compact={true} />
    </div>
    {#if loading}
      <div class="text-sm text-gray-500 dark:text-gray-400 text-center py-4">Loading...</div>
    {:else if identity}
      <div class="flex flex-col gap-2">

        <!-- Backend Status Icons -->
        <div class="backend-icons">
          {#if backendAvailability.ollama.available}
            <span
              class="backend-icon"
              class:running={backendAvailability.ollama.running}
              class:active={backendAvailability.ollama.active}
              class:available={backendAvailability.ollama.available && !backendAvailability.ollama.running}
              title={getOllamaTooltip()}
            >🦙</span>
          {/if}

          {#if backendAvailability.vllm.available}
            <span
              class="backend-icon"
              class:running={backendAvailability.vllm.running}
              class:active={backendAvailability.vllm.active}
              class:available={backendAvailability.vllm.available && !backendAvailability.vllm.running}
              title={getVllmTooltip()}
            >⚡</span>
          {/if}

          {#if backendAvailability.runpod.available}
            <span
              class="backend-icon cloud"
              class:configured={backendAvailability.runpod.configured}
              class:active={backendAvailability.runpod.active}
              title={getRunPodTooltip()}
            >☁️</span>
          {/if}

          {#if backendAvailability.bigBrother.available}
            <span
              class="backend-icon bigbrother"
              class:enabled={backendAvailability.bigBrother.enabled}
              class:disabled={!backendAvailability.bigBrother.enabled}
              title={getBigBrotherTooltip()}
            >🤖</span>
          {/if}

          {#if backendAvailability.remoteServer.configured}
            <span
              class="backend-icon remote-server"
              class:configured={backendAvailability.remoteServer.configured}
              class:connected={backendAvailability.remoteServer.connected}
              title={getRemoteServerTooltip()}
            >🌐</span>
          {/if}

          {#if backendAvailability.localModels.available}
            <span
              class="backend-icon local-models"
              class:running={backendAvailability.localModels.running}
              class:available={backendAvailability.localModels.available && !backendAvailability.localModels.running}
              title={getLocalModelsTooltip()}
            >🔍</span>
          {/if}

          {#if !backendAvailability.ollama.available && !backendAvailability.vllm.available && !backendAvailability.runpod.available}
            <span class="backend-icon offline" title="No backends configured">❌</span>
          {/if}
        </div>

        <!-- vLLM Model Name -->
        {#if localModel && backendAvailability.vllm.active}
          <div class="vllm-model-info">
            <span class="local-model-name">
              {localModel.name}
              {#if localModel.locked}
                <span class="loaded-indicator" title="Currently loaded">✓</span>
              {/if}
            </span>
          </div>
        {/if}

        {#if hasModelRegistry}
          {#each Object.entries(modelRoles) as [role, info]}
            <div class="model-role-row">
              <span class="activity-indicator">
                <span class="activity-dot"></span>
              </span>
              <span class="role-name">{role}</span>
              <span class="role-arrow">→</span>
              {#if info.needsConfig}
                <button
                  class="role-model needs-config"
                  title="{info.unavailableReason || 'Model unavailable'} - Click to select an available model"
                  on:click|stopPropagation={() => toggleModelDropdown(role)}
                >
                  select
                  <span class="dropdown-arrow">▼</span>
                </button>
              {:else if info.error}
                <span class="role-model error" title={info.error}>error</span>
              {:else}
                <button
                  class="role-model clickable"
                  title="Click to change model for {role}\nCurrent: {info.model}{info.adapters && info.adapters.length > 0 ? ' + adapter' : ''}"
                  on:click|stopPropagation={() => toggleModelDropdown(role)}
                >
                  {info.model || '—'}
                  {#if info.adapters && info.adapters.length > 0}
                    <span class="adapter-indicator">+LoRA</span>
                  {/if}
                  {#if info.capabilities?.includes('image')}
                    <span class="vllm-badge" title="Accepts image input">image</span>
                  {/if}
                  <span class="dropdown-arrow">▼</span>
                </button>
              {/if}

              {#if modelDropdownOpen[role]}
                <div class="model-dropdown categorized">
                  <div class="dropdown-header">Select model for {role}</div>

                  {#if modelCategories.local.length > 0}
                    <div class="dropdown-category">
                      <span class="category-label">
                        {activeBackend === 'vllm' ? '⚡ vLLM' : '🦙 Local'}
                      </span>
                      {#each modelCategories.local as model}
                        {@const isCurrentlySelected = modelRoles[role]?.model === model.model}
                        <button
                          class="dropdown-item"
                          class:selected={isCurrentlySelected}
                          class:vllm-active={model.locked}
                          on:click|stopPropagation={() => assignModelToRole(role, model.id)}
                        >
                          <span class="model-name">
                            {model.model}
                            {#if model.locked}
                              <span class="vllm-badge">loaded</span>
                            {/if}
                            {#if model.capabilities?.includes('image')}
                              <span class="vllm-badge">image</span>
                            {/if}
                          </span>
                        </button>
                      {/each}
                    </div>
                  {/if}

                  {#if modelCategories.lora.length > 0}
                    <div class="dropdown-category">
                      <span class="category-label">⚡ vLLM LoRAs</span>
                      {#each modelCategories.lora as adapter}
                        {@const isCurrentlySelected = roleAssignments[role] === adapter.id}
                        <button
                          class="dropdown-item"
                          class:selected={isCurrentlySelected}
                          class:lora-loaded={adapter.loaded}
                          on:click|stopPropagation={() => assignModelToRole(role, adapter.id)}
                        >
                          <span class="model-name">
                            {adapter.name}
                            {#if adapter.loaded}
                              <span class="vllm-badge">loaded</span>
                            {:else}
                              <span class="restart-badge">⟳ restart</span>
                            {/if}
                            {#if adapter.isDualAdapter}
                              <span class="dual-badge">dual</span>
                            {/if}
                          </span>
                          {#if adapter.createdAt}
                            <span class="model-desc">{adapter.createdAt}</span>
                          {:else if adapter.date}
                            <span class="model-desc">{adapter.date}</span>
                          {/if}
                        </button>
                      {/each}
                    </div>
                  {/if}

                  {#if modelCategories.remote.length > 0}
                    <div class="dropdown-category">
                      <span class="category-label">☁️ Cloud</span>
                      {#each modelCategories.remote as model}
                        {@const isCurrentlySelected = modelRoles[role]?.model === model.model}
                        <button
                          class="dropdown-item"
                          class:selected={isCurrentlySelected}
                          on:click|stopPropagation={() => assignModelToRole(role, model.id)}
                        >
                          <span class="model-name">
                            {model.model}
                            <span class="cloud-indicator">{model.provider === 'remote-server' ? '🌐' : '☁️'}</span>
                          </span>
                          <span class="provider-badge cloud">{model.provider === 'runpod_serverless' ? 'RunPod' : model.provider === 'remote-server' ? '🌐 Remote' : model.provider}</span>
                        </button>
                      {/each}
                    </div>
                  {/if}

                  {#if modelCategories.bigBrother.length > 0}
                    <div class="dropdown-category">
                      <span class="category-label">🛡️ Escalation</span>
                      {#each modelCategories.bigBrother as model}
                        {@const isCurrentlySelected = modelRoles[role]?.model === model.model}
                        <button
                          class="dropdown-item"
                          class:selected={isCurrentlySelected}
                          on:click|stopPropagation={() => assignModelToRole(role, model.id)}
                        >
                          <span class="model-name">
                            {model.model}
                            <span class="bb-badge">🛡️</span>
                          </span>
                          <span class="model-desc">Claude Code</span>
                        </button>
                      {/each}
                    </div>
                  {/if}

                  {#if activeBackend === 'ollama' && modelCategories.local.length === 0}
                    {#each uniqueModels as model}
                      {@const isSuggested = !model.roles || model.roles.includes(role)}
                      {@const isCurrentlySelected = modelRoles[role]?.model === model.model}
                      <button
                        class="dropdown-item"
                        class:selected={isCurrentlySelected}
                        class:suggested={isSuggested}
                        on:click|stopPropagation={() => assignModelToRole(role, model.id)}
                      >
                        <span class="model-name">
                          {model.model}
                          {#if model.provider === 'runpod_serverless' || model.provider === 'huggingface'}
                            <span class="cloud-indicator">☁️</span>
                          {/if}
                          {#if model.capabilities?.includes('image')}
                            <span class="vllm-badge">image</span>
                          {/if}
                          {#if isSuggested}
                            <span class="suggested-indicator">✓</span>
                          {/if}
                        </span>
                        {#if model.adapters && model.adapters.length > 0}
                          <span class="adapter-indicator-small">+LoRA</span>
                        {/if}
                        {#if model.provider === 'runpod_serverless'}
                          <span class="provider-badge cloud">RunPod Cloud</span>
                        {/if}
                        {#if model.description}
                          <span class="model-desc">{model.description}</span>
                        {/if}
                      </button>
                    {/each}
                  {/if}
                </div>
              {/if}
            </div>
          {/each}
        {/if}

        <!-- Trust Level -->
        <div class="h-px bg-black/5 dark:bg-white/10 my-1"></div>
        <div class="status-row">
          <span class="status-label">Trust:</span>
          <span class="status-value">
            <button
              class="trust-badge clickable trust-level-{yoloMode ? 'yolo' : (identity.trustLevel || 'observe')}"
              title="Click to cycle trust level: {identity.trustLevel || 'observe'}{yoloMode ? ' + YOLO' : ''}\nProgression: observe → suggest → supervised_auto → bounded_auto → adaptive_auto → YOLO"
              on:click={cycleTrustLevel}
            >
              {#if yoloMode}
                <span class="yolo-indicator">YOLO</span>
              {:else}
                {identity.trustLevel || 'observe'}
              {/if}
            </button>
          </span>
        </div>
        <div class="status-row">
          <span class="status-label">Persona:</span>
          <span class="status-value">
            <button
              class="persona-badge persona-facet-{activeFacet || 'error'} clickable"
              title={personaFacetTooltip}
              on:click={cyclePersonaFacet}
              disabled={Boolean(personaFacetError) || !activeFacet}
              aria-invalid={Boolean(personaFacetError)}
            >
              {personaFacetError
                ? '⚠ error'
                : activeFacet === 'inactive'
                  ? 'inactive'
                  : (facets[activeFacet || '']?.name || activeFacet || 'loading')}
            </button>
          </span>
        </div>
      </div>
    {/if}
  </div>

  <!-- Footer -->
  <div class="sidebar-footer">
    <div class="footer-text">
      MetaHuman OS
      <span class="footer-version">Version 1.13</span>
    </div>
  </div>
</div>

<!-- vLLM LoRA Restart Modal -->
{#if showRestartModal}
  <div class="modal-overlay" on:click={dismissRestartModal} on:keydown={(e) => e.key === 'Escape' && dismissRestartModal()} role="dialog" aria-modal="true" tabindex="-1">
    <div class="modal-content max-w-[400px]" on:click|stopPropagation role="document">
      <div class="modal-header flex items-center justify-between">
        <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100">⚡ Server Restart Required</h3>
      </div>
      <div class="modal-body">
        <p class="mb-3 text-sm text-gray-600 dark:text-gray-400">
          The LoRA adapter <strong class="text-gray-900 dark:text-gray-100">{pendingLoraName}</strong> is not currently loaded in vLLM.
        </p>
        <p class="mb-0 text-sm text-gray-600 dark:text-gray-400">
          To use this adapter, vLLM needs to restart and load it. This will briefly interrupt model availability.
        </p>
      </div>
      <div class="modal-footer">
        <button
          class="btn-secondary"
          on:click={dismissRestartModal}
          disabled={restartInProgress}
        >
          Later
        </button>
        <button
          class="btn-primary"
          on:click={restartVllmForLora}
          disabled={restartInProgress}
        >
          {#if restartInProgress}
            Restarting...
          {:else}
            Restart Now
          {/if}
        </button>
      </div>
    </div>
  </div>
{/if}
