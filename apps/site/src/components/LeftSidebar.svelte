<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { activeView, statusStore, statusRefreshTrigger, yoloModeStore } from '../stores/navigation';
  import { currentMode, isOwner } from '../stores/security-policy';
  import { pendingCount, loadApprovals } from '../stores/approvals';
  import { apiFetch } from '../lib/client/api-config';

  interface MenuItem {
    id: string;
    label: string;
    icon: string;
    description?: string;
  }

  const menuItems: MenuItem[] = [
    { id: 'chat', label: 'Chat', icon: '💬', description: 'Conversation interface' },
    { id: 'dashboard', label: 'Dashboard', icon: '📊', description: 'System overview' },
    { id: 'agency', label: 'Agency', icon: '🎯', description: 'Autonomous desires' },
    { id: 'persona', label: 'Persona', icon: '👤', description: 'Identity & personality' },
    { id: 'voice', label: 'Voice', icon: '🎤', description: 'Audio & training' },
    { id: 'training', label: 'AI Training', icon: '🧠', description: 'LoRA adapters' },
    { id: 'terminal', label: 'Terminal', icon: '💻', description: 'Command line' },
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
  let activeFacet: string = 'default';
  let facets: Record<string, any> = {};
  let personaFacetTooltip = '';

  $: personaFacetTooltip = (() => {
    const info = facets?.[activeFacet];
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

  // Real-time activity tracking
  // activeRoles and eventSource removed - llm-activity polling deleted

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
      }
    });
  }

  
  async function loadTrustOptions() {
    try {
      const res = await apiFetch('/api/trust');
      const data = await res.json();
      if (res.ok) {
        trustOptions = Array.isArray(data.available) ? data.available : [];
        if (identity) identity.trustLevel = data.level;

        // Sync YOLO mode with trust level
        // YOLO mode is only valid when trust level is at maximum (adaptive_auto)
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

  /**
   * Cycle through trust levels, culminating in YOLO mode
   * Trust progression: observe → suggest → supervised_auto → bounded_auto → adaptive_auto → YOLO → (back to observe)
   * In emulation mode, always stays at 'observe'
   */
  async function cycleTrustLevel() {
    // Emulation mode is always locked to lowest level
    if ($currentMode === 'emulation') {
      alert('Trust level is locked to "observe" in emulation mode for safety.');
      return;
    }

    const trustProgression = ['observe', 'suggest', 'supervised_auto', 'bounded_auto', 'adaptive_auto'];
    const currentTrust = identity?.trustLevel || 'observe';
    const currentYolo = yoloMode;

    // If YOLO is active, cycle back to observe
    if (currentYolo) {
      yoloModeStore.set(false);
      await setTrust('observe');
      saveChatPrefs();
      return;
    }

    // Find current position in progression
    const currentIndex = trustProgression.indexOf(currentTrust);

    // If at max trust level (adaptive_auto), enable YOLO
    if (currentIndex === trustProgression.length - 1) {
      // Show warning before enabling YOLO
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

    // Otherwise, advance to next trust level
    const nextIndex = currentIndex + 1;
    if (nextIndex < trustProgression.length) {
      await setTrust(trustProgression[nextIndex]);
    }
  }

  function saveChatPrefs() {
    // Save YOLO mode to localStorage
    try {
      const prefs = localStorage.getItem('chatPrefs');
      const parsed = prefs ? JSON.parse(prefs) : {};
      parsed.yoloMode = yoloMode;
      localStorage.setItem('chatPrefs', JSON.stringify(parsed));
    } catch {}
  }

  /**
   * Toggle persona summary (includePersonaSummary in models.json)
   * Rules:
   * - Emulation mode: Always ON (locked for safety)
   * - Other modes: Can toggle OFF
   * - Default: ON (recommended when no active LoRAs)
   */
  async function togglePersonaMode() {
    // Emulation mode is always locked to persona ON
    if ($currentMode === 'emulation') {
      alert('Persona context is locked to "active" in emulation mode for stable personality.');
      return;
    }

    const currentlyEnabled = modelInfo?.personaSummary === 'enabled';
    const newState = !currentlyEnabled;

    // Warn if disabling without active LoRAs or specialized models
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

    // Toggle the setting via API
    try {
      const response = await apiFetch('/api/persona-toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: newState }),
      });

      const result = await response.json();

      if (result.success) {
        // Show confirmation
        alert(result.message || (newState ? 'Persona context enabled' : 'Persona context disabled'));

        // Small delay to ensure file write completes, then refresh status
        setTimeout(() => {
          statusRefreshTrigger.update(n => n + 1);
        }, 100);
      } else if (result.locked) {
        // Emulation mode lock (should be caught earlier, but just in case)
        alert(result.error);
      } else {
        alert('Failed to toggle persona context: ' + (result.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Error toggling persona context:', error);
      alert('Failed to toggle persona context: ' + (error as Error).message);
    }
  }

  /**
   * Load persona facets configuration
   */
  async function loadFacets() {
    try {
      const response = await apiFetch('/api/persona-facet');
      const data = await response.json();
      activeFacet = data.activeFacet || 'default';
      facets = data.facets || {};
    } catch (error) {
      console.error('Error loading facets:', error);
    }
  }

  /**
   * Cycle to next persona facet
   * Dynamically builds facet list from loaded facets (enabled only)
   */
  async function cyclePersonaFacet() {
    // Build dynamic facet list from loaded facets (enabled only)
    const availableFacets = Object.keys(facets).filter(
      key => facets[key]?.enabled !== false
    );

    // If no facets available, bail out
    if (availableFacets.length === 0) {
      console.warn('No enabled facets available');
      return;
    }

    // Find current facet index
    const currentIndex = availableFacets.indexOf(activeFacet);

    // Calculate next index (wraps around to 0 after last facet)
    const nextIndex = (currentIndex + 1) % availableFacets.length;
    const nextFacet = availableFacets[nextIndex];

    // Switch to the next facet
    try {
      const response = await apiFetch('/api/persona-facet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facet: nextFacet }),
      });

      const result = await response.json();

      if (result.success) {
        activeFacet = nextFacet;
        // Refresh status to show new facet
        setTimeout(() => statusRefreshTrigger.update(n => n + 1), 100);
      } else {
        console.error('Failed to switch facet:', result.error);
      }
    } catch (error) {
      console.error('Error cycling facet:', error);
    }
  }

  /**
   * Model registry management
   */
  interface AvailableModel {
    id: string;
    model: string;
    provider: string;
    roles?: string[];
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
    provider: 'ollama' | 'vllm';
    locked: boolean;
  }

  let availableModels: AvailableModel[] = [];
  let uniqueModels: AvailableModel[] = [];
  let roleAssignments: Record<string, string> = {};
  let modelDropdownOpen: Record<string, boolean> = {};
  let loadingModelRegistry = false;
  let statusRefreshInFlight = false;

  // NEW: Adaptive widget state
  let activeBackend: 'ollama' | 'vllm' = 'ollama';
  let localModel: LocalModelInfo | null = null;
  let modelCategories: ModelCategories = {
    local: [],
    lora: [],
    remote: [],
    bigBrother: []
  };

  // Fetch backend status from public endpoint (works for all users)
  async function loadBackendStatus() {
    try {
      const response = await apiFetch('/api/llm-backend/status');
      const data = await response.json();
      if (data.active) {
        activeBackend = data.active.backend || 'ollama';
        // Update local model info from backend status
        if (activeBackend === 'vllm' && data.active.model) {
          localModel = {
            id: 'vllm.active',
            name: data.active.model,
            provider: 'vllm',
            locked: true
          };
          modelCategories.local = [{
            id: 'vllm.active',
            model: data.active.model,
            provider: 'vllm',
            locked: true
          }];
        }
      }
    } catch (error) {
      console.error('Error loading backend status:', error);
    }
  }

  async function loadModelRegistry() {
    if (loadingModelRegistry) return;
    loadingModelRegistry = true;

    // Always fetch backend status first (works for all users)
    await loadBackendStatus();

    try {
      const response = await apiFetch('/api/model-registry');
      const data = await response.json();

      if (data.success) {
        availableModels = data.availableModels || [];
        roleAssignments = data.roleAssignments || {};

        // Model registry may override backend info for owners
        if (data.activeBackend) {
          activeBackend = data.activeBackend;
        }
        if (data.localModel) {
          localModel = data.localModel;
        }
        if (data.modelCategories) {
          modelCategories = data.modelCategories;
        }

        // Deduplicate models by model name
        const seen = new Map<string, AvailableModel>();
        for (const model of availableModels) {
          const key = model.model;
          if (!seen.has(key)) {
            seen.set(key, model);
          } else {
            // Merge roles from duplicate entries
            const existing = seen.get(key)!;
            if (model.roles) {
              existing.roles = Array.from(new Set([...(existing.roles || []), ...model.roles]));
            }
          }
        }
        uniqueModels = Array.from(seen.values());
      } else {
        // Non-owner users won't have access to model registry
        // Backend status was already loaded above
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
    try {
      const mode = get(currentMode);
      const payload: Record<string, any> = { role, modelId };
      if (mode) {
        payload.cognitiveMode = mode;
      }

      const response = await apiFetch('/api/model-registry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const result = await response.json();

      if (result.success) {
        roleAssignments[role] = modelId;
        modelDropdownOpen[role] = false;
        modelDropdownOpen = { ...modelDropdownOpen };
        updateModelRoleLocally(role, modelId);
        void refreshStatus('model assignment');
        void loadModelRegistry();

        // Warm up the model in the background (non-blocking)
        // This preloads it into Ollama memory to avoid cold-start on first use
        warmupModel(role).catch(err => {
          console.warn(`Failed to warm up model for role ${role}:`, err);
        });

        // Refresh status to show updated model assignments
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

  function toggleModelDropdown(role: string) {
    modelDropdownOpen[role] = !modelDropdownOpen[role];
    // Force reactive update
    modelDropdownOpen = { ...modelDropdownOpen };
  }

  function closeAllModelDropdowns() {
    modelDropdownOpen = {};
  }

  // Close dropdowns when clicking outside
  function handleDocumentClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!target.closest('.model-role-row')) {
      closeAllModelDropdowns();
    }
  }

  // connectActivityStream and disconnectActivityStream removed - llm-activity polling deleted

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
    loadApprovals(); // Load approvals once on mount (from shared store)

    const ownerUnsubscribe = isOwner.subscribe(() => {
      loadApprovals(); // Reload when owner status changes
    });

    // Set up document click handler for closing dropdowns
    document.addEventListener('click', handleDocumentClick);

    // Refresh approvals when tab becomes visible (no polling!)
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

<div class="left-sidebar-container">
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
    <div class="widget-header">Status</div>
    {#if loading}
      <div class="widget-loading">Loading...</div>
    {:else if identity}
      <div class="status-info">

        <!-- Backend Indicator -->
        <div class="backend-indicator">
          {#if activeBackend === 'vllm'}
            <span class="backend-badge vllm">⚡ vLLM</span>
          {:else}
            <span class="backend-badge ollama">🦙 Ollama</span>
          {/if}
          {#if localModel}
            <span class="local-model-name">
              {localModel.name}
              {#if localModel.locked}
                <span class="loaded-indicator" title="Currently loaded in vLLM - select for any role">✓</span>
              {/if}
            </span>
          {/if}
        </div>

        {#if hasModelRegistry}
          <!-- Multi-model registry view with interactive switching -->
          {#each Object.entries(modelRoles) as [role, info]}
            <div class="model-role-row">
              <span class="activity-indicator">
                <span class="activity-dot"></span>
              </span>
              <span class="role-name">{role}</span>
              <span class="role-arrow">→</span>
              {#if info.error}
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
                  <span class="dropdown-arrow">▼</span>
                </button>

                {#if modelDropdownOpen[role]}
                  <div class="model-dropdown categorized">
                    <div class="dropdown-header">Select model for {role}</div>

                    <!-- Category: Local Models -->
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
                            </span>
                          </button>
                        {/each}
                      </div>
                    {/if}

                    <!-- Category: LoRA Adapters -->
                    {#if modelCategories.lora.length > 0}
                      <div class="dropdown-category">
                        <span class="category-label">🎯 LoRA Adapters</span>
                        {#each modelCategories.lora as adapter}
                          <button
                            class="dropdown-item"
                            on:click|stopPropagation={() => assignModelToRole(role, adapter.id)}
                          >
                            <span class="model-name">
                              {adapter.name}
                              {#if adapter.isDualAdapter}
                                <span class="dual-badge">dual</span>
                              {/if}
                            </span>
                            {#if adapter.date}
                              <span class="model-desc">{adapter.date}</span>
                            {/if}
                          </button>
                        {/each}
                      </div>
                    {/if}

                    <!-- Category: Remote/Cloud Models -->
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
                              <span class="cloud-indicator">☁️</span>
                            </span>
                            <span class="provider-badge cloud">{model.provider === 'runpod_serverless' ? 'RunPod' : model.provider}</span>
                          </button>
                        {/each}
                      </div>
                    {/if}

                    <!-- Category: Big Brother (Claude escalation) -->
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

                    <!-- Fallback: Show all models if no categories (Ollama mode) -->
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
              {/if}
            </div>
          {/each}
        {/if}

        <!-- Unified Trust Level (includes YOLO as max level) -->
        <div class="status-sep"></div>
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
              class="persona-badge persona-facet-{activeFacet} clickable"
              title={personaFacetTooltip}
              on:click={cyclePersonaFacet}
            >
              {activeFacet === 'inactive' ? 'inactive' : (facets[activeFacet]?.name || activeFacet)}
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

<style>
  /* Container - unique to LeftSidebar */
  .left-sidebar-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: 1rem;
    gap: 1rem;
  }

  /* Widget loading state - component-specific */
  .widget-loading {
    font-size: 0.875rem;
    color: rgb(107 114 128);
    text-align: center;
    padding: 1rem 0;
  }

  :global(.dark) .widget-loading {
    color: rgb(156 163 175);
  }

  .status-info {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .status-sep {
    height: 1px;
    background: rgba(0,0,0,0.06);
    margin: 0.25rem 0;
  }

  :global(.dark) .status-sep {
    background: rgba(255,255,255,0.12);
  }

  .mono {
    font-family: ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace;
    font-size: 0.78rem;
    font-weight: 500;
  }

  .adapter-flag {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgb(107 114 128);
    border: 1px solid rgba(107,114,128,0.3);
    border-radius: 4px;
    padding: 0.05rem 0.3rem;
  }

  :global(.dark) .adapter-flag {
    color: rgb(209 213 219);
    border-color: rgba(209,213,219,0.25);
  }

  .adapter-source {
    font-size: 0.65rem;
    color: rgb(107 114 128);
    margin-left: 0.4rem;
  }

  :global(.dark) .adapter-source {
    color: rgb(156 163 175);
  }

  .in-progress-badge {
    padding: 0.125rem 0.375rem;
    border-radius: 9999px;
    font-size: 0.7rem;
    background: rgb(124 58 237);
    color: white;
  }

  :global(.dark) .in-progress-badge {
    background: rgb(167 139 250);
    color: rgb(17 24 39);
  }

  /* Approval count badge - unique to LeftSidebar */
  .approval-badge {
    display: inline-block;
    margin-left: 0.5rem;
    padding: 0.125rem 0.375rem;
    border-radius: 9999px;
    font-size: 0.7rem;
    font-weight: 600;
    background: rgb(239 68 68);
    color: white;
  }

  :global(.dark) .approval-badge {
    background: rgb(248 113 113);
    color: rgb(17 24 39);
  }

  /* Footer - unique to LeftSidebar */
  .sidebar-footer {
    padding: 0.75rem 0;
    border-top: 1px solid rgba(0, 0, 0, 0.1);
    margin-top: auto;
  }

  :global(.dark) .sidebar-footer {
    border-top-color: rgba(255, 255, 255, 0.1);
  }

  .footer-text {
    font-size: 0.75rem;
    color: rgb(107 114 128);
    text-align: center;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  :global(.dark) .footer-text {
    color: rgb(156 163 175);
  }

  .footer-version {
    font-size: 0.7rem;
    opacity: 0.7;
  }

  /* Trust level dropdown - component-specific */
  .trust-control {
    position: relative;
    display: inline-block;
  }

  .status-badge .chev {
    margin-left: 6px;
    opacity: 0.7;
  }

  .trust-menu {
    position: absolute;
    right: 0;
    top: 120%;
    z-index: 50;
    background: white;
    border: 1px solid rgba(0,0,0,0.1);
    border-radius: 0.5rem;
    box-shadow: 0 6px 24px rgba(0,0,0,0.15);
    padding: 0.25rem;
    min-width: 160px;
  }

  :global(.dark) .trust-menu {
    background: rgb(3 7 18);
    border-color: rgba(255,255,255,0.15);
  }

  .trust-opt {
    display: block;
    width: 100%;
    text-align: left;
    padding: 0.4rem 0.6rem;
    border: none;
    background: transparent;
    border-radius: 0.375rem;
    font-size: 0.85rem;
    cursor: pointer;
  }

  .trust-opt:hover {
    background: rgba(0,0,0,0.06);
  }

  :global(.dark) .trust-opt:hover {
    background: rgba(255,255,255,0.08);
  }

  .trust-opt.active {
    font-weight: 700;
  }

  /* Model Roles Display */
  .model-role-row {
    display: flex;
    align-items: center;
    font-size: 0.8rem;
    gap: 0.375rem;
    padding: 0.2rem 0 0.2rem 0.25rem;
    border-radius: 0.375rem;
    transition: all 0.3s ease;
    position: relative;
  }

  .model-role-row.active {
    background: rgba(124, 58, 237, 0.08);
    box-shadow: 0 0 12px rgba(124, 58, 237, 0.3);
  }

  :global(.dark) .model-role-row.active {
    background: rgba(167, 139, 250, 0.12);
    box-shadow: 0 0 16px rgba(167, 139, 250, 0.4);
  }

  .activity-indicator {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    flex-shrink: 0;
  }

  .activity-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: rgb(156 163 175);
    transition: all 0.3s ease;
  }

  .model-role-row.active .activity-dot {
    width: 8px;
    height: 8px;
    background: rgb(124 58 237);
    animation: pulse 1.5s ease-in-out infinite;
  }

  :global(.dark) .model-role-row.active .activity-dot {
    background: rgb(167 139 250);
  }

  @keyframes pulse {
    0%, 100% {
      opacity: 1;
      transform: scale(1);
    }
    50% {
      opacity: 0.6;
      transform: scale(1.3);
    }
  }

  .role-name {
    color: rgb(107 114 128);
    font-weight: 500;
    min-width: 75px;
    text-transform: capitalize;
  }

  :global(.dark) .role-name {
    color: rgb(156 163 175);
  }

  .role-arrow {
    color: rgb(156 163 175);
    font-size: 0.7rem;
  }

  :global(.dark) .role-arrow {
    color: rgb(107 114 128);
  }

  .role-model {
    color: rgb(17 24 39);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    font-size: 0.7rem;
    font-weight: 500;
    display: flex;
    align-items: center;
    gap: 0.25rem;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  :global(.dark) .role-model {
    color: rgb(243 244 246);
  }

  .role-model.error {
    color: rgb(239 68 68);
    font-style: italic;
  }

  :global(.dark) .role-model.error {
    color: rgb(248 113 113);
  }

  .adapter-indicator {
    padding: 0.05rem 0.3rem;
    border-radius: 0.25rem;
    font-size: 0.65rem;
    font-weight: 600;
    background: rgba(167, 139, 250, 0.18);
    color: rgb(109 40 217);
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }

  :global(.dark) .adapter-indicator {
    background: rgba(167, 139, 250, 0.25);
    color: rgb(196 181 253);
  }

  /* Model switching dropdown styles */
  .role-model.clickable {
    background: transparent;
    border: 1px solid rgba(107, 114, 128, 0.2);
    border-radius: 0.375rem;
    padding: 0.25rem 0.5rem;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .role-model.clickable:hover {
    background: rgba(107, 114, 128, 0.08);
    border-color: rgba(107, 114, 128, 0.4);
  }

  :global(.dark) .role-model.clickable {
    border-color: rgba(156, 163, 175, 0.2);
  }

  :global(.dark) .role-model.clickable:hover {
    background: rgba(156, 163, 175, 0.12);
    border-color: rgba(156, 163, 175, 0.4);
  }

  .dropdown-arrow {
    font-size: 0.6rem;
    margin-left: auto;
    color: rgb(107 114 128);
  }

  :global(.dark) .dropdown-arrow {
    color: rgb(156 163 175);
  }

  .model-dropdown {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    margin-top: 0.25rem;
    background: white;
    border: 1px solid rgba(0, 0, 0, 0.1);
    border-radius: 0.5rem;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    z-index: 1000;
    max-height: 300px;
    overflow-y: auto;
    animation: dropdownSlideIn 0.15s ease-out;
  }

  :global(.dark) .model-dropdown {
    background: rgb(31 41 55);
    border-color: rgba(255, 255, 255, 0.1);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
  }

  @keyframes dropdownSlideIn {
    from {
      opacity: 0;
      transform: translateY(-8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .dropdown-header {
    padding: 0.5rem 0.75rem;
    font-size: 0.7rem;
    font-weight: 600;
    color: rgb(107 114 128);
    border-bottom: 1px solid rgba(0, 0, 0, 0.1);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  :global(.dark) .dropdown-header {
    color: rgb(156 163 175);
    border-bottom-color: rgba(255, 255, 255, 0.1);
  }

  .dropdown-item {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.25rem;
    padding: 0.5rem 0.75rem;
    width: 100%;
    background: transparent;
    border: none;
    border-bottom: 1px solid rgba(0, 0, 0, 0.05);
    text-align: left;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .dropdown-item:last-child {
    border-bottom: none;
  }

  .dropdown-item:hover {
    background: rgba(124, 58, 237, 0.08);
  }

  .dropdown-item.selected {
    background: rgba(124, 58, 237, 0.12);
  }

  .dropdown-item.suggested {
    /* Subtle highlight for suggested models */
  }

  :global(.dark) .dropdown-item {
    border-bottom-color: rgba(255, 255, 255, 0.05);
  }

  :global(.dark) .dropdown-item:hover {
    background: rgba(167, 139, 250, 0.12);
  }

  :global(.dark) .dropdown-item.selected {
    background: rgba(167, 139, 250, 0.18);
  }

  .model-name {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    font-size: 0.75rem;
    font-weight: 600;
    color: rgb(17 24 39);
    display: flex;
    align-items: center;
    gap: 0.375rem;
  }

  :global(.dark) .model-name {
    color: rgb(243 244 246);
  }

  .adapter-indicator-small {
    padding: 0.05rem 0.25rem;
    border-radius: 0.2rem;
    font-size: 0.6rem;
    font-weight: 600;
    background: rgba(167, 139, 250, 0.18);
    color: rgb(109 40 217);
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }

  :global(.dark) .adapter-indicator-small {
    background: rgba(167, 139, 250, 0.25);
    color: rgb(196 181 253);
  }

  .model-desc {
    font-size: 0.65rem;
    color: rgb(107 114 128);
    line-height: 1.3;
  }

  :global(.dark) .model-desc {
    color: rgb(156 163 175);
  }

  .suggested-indicator {
    display: inline-block;
    margin-left: 0.25rem;
    font-size: 0.7rem;
    color: rgb(34 197 94);
    opacity: 0.7;
  }

  :global(.dark) .suggested-indicator {
    color: rgb(74 222 128);
  }

  .cloud-indicator {
    margin-left: 0.25rem;
    font-size: 0.75rem;
  }

  .provider-badge {
    display: inline-block;
    padding: 0.1rem 0.35rem;
    border-radius: 0.25rem;
    font-size: 0.6rem;
    font-weight: 500;
    margin-top: 0.15rem;
  }

  .provider-badge.cloud {
    background: rgba(59, 130, 246, 0.15);
    color: rgb(59 130 246);
    border: 1px solid rgba(59, 130, 246, 0.3);
  }

  :global(.dark) .provider-badge.cloud {
    background: rgba(96, 165, 250, 0.15);
    color: rgb(147 197 253);
    border-color: rgba(96, 165, 250, 0.3);
  }

  /* Unified trust level badge (cycles through levels + YOLO) */
  .trust-badge {
    padding: 0.125rem 0.4rem;
    border-radius: 9999px;
    font-size: 0.65rem;
    font-weight: 600;
    text-transform: lowercase;
    border: 1px solid transparent;
    cursor: default;
    transition: all 0.2s ease;
  }

  .trust-badge.clickable {
    cursor: pointer;
  }

  .trust-badge.clickable:hover {
    transform: scale(1.05);
  }

  /* Temperature gradient: Cool (observe) → Warm (suggest) → Hot (supervised) → Hotter (bounded) → Hottest (adaptive) → YOLO */

  /* Level 1: observe - Cool blue-green */
  .trust-badge.trust-level-observe {
    background: rgba(6,182,212,0.16);
    color: rgb(8 145 178);
    border-color: transparent;
  }

  .trust-badge.trust-level-observe:hover {
    background: rgba(6,182,212,0.25);
  }

  /* Level 2: suggest - Light green */
  .trust-badge.trust-level-suggest {
    background: rgba(34,197,94,0.16);
    color: rgb(22 101 52);
    border-color: transparent;
  }

  .trust-badge.trust-level-suggest:hover {
    background: rgba(34,197,94,0.25);
  }

  /* Level 3: supervised_auto - Yellow-green */
  .trust-badge.trust-level-supervised_auto {
    background: rgba(132,204,22,0.16);
    color: rgb(77 124 15);
    border-color: transparent;
  }

  .trust-badge.trust-level-supervised_auto:hover {
    background: rgba(132,204,22,0.25);
  }

  /* Level 4: bounded_auto - Orange */
  .trust-badge.trust-level-bounded_auto {
    background: rgba(249,115,22,0.16);
    color: rgb(194 65 12);
    border-color: transparent;
  }

  .trust-badge.trust-level-bounded_auto:hover {
    background: rgba(249,115,22,0.25);
  }

  /* Level 5: adaptive_auto - Red-orange */
  .trust-badge.trust-level-adaptive_auto {
    background: rgba(239,68,68,0.16);
    color: rgb(185 28 28);
    border-color: transparent;
  }

  .trust-badge.trust-level-adaptive_auto:hover {
    background: rgba(239,68,68,0.25);
  }

  /* Level 6: YOLO - Hot yellow with glow */
  .trust-badge.trust-level-yolo {
    background: rgba(234,179,8,0.25);
    color: rgb(202 138 4);
    border-color: rgb(234 179 8);
    box-shadow: 0 0 0 2px rgba(234,179,8,0.2);
  }

  .trust-badge.trust-level-yolo:hover {
    background: rgba(234,179,8,0.35);
  }

  .yolo-indicator {
    text-transform: uppercase;
    font-weight: 700;
    letter-spacing: 0.05em;
  }

  /* Dark mode temperature gradient */
  :global(.dark) .trust-badge.trust-level-observe {
    background: rgba(34,211,238,0.2);
    color: rgb(103 232 249);
  }

  :global(.dark) .trust-badge.trust-level-observe:hover {
    background: rgba(34,211,238,0.3);
  }

  :global(.dark) .trust-badge.trust-level-suggest {
    background: rgba(34,197,94,0.2);
    color: rgb(134 239 172);
  }

  :global(.dark) .trust-badge.trust-level-suggest:hover {
    background: rgba(34,197,94,0.3);
  }

  :global(.dark) .trust-badge.trust-level-supervised_auto {
    background: rgba(163,230,53,0.2);
    color: rgb(190 242 100);
  }

  :global(.dark) .trust-badge.trust-level-supervised_auto:hover {
    background: rgba(163,230,53,0.3);
  }

  :global(.dark) .trust-badge.trust-level-bounded_auto {
    background: rgba(251,146,60,0.2);
    color: rgb(253 186 116);
  }

  :global(.dark) .trust-badge.trust-level-bounded_auto:hover {
    background: rgba(251,146,60,0.3);
  }

  :global(.dark) .trust-badge.trust-level-adaptive_auto {
    background: rgba(248,113,113,0.2);
    color: rgb(252 165 165);
  }

  :global(.dark) .trust-badge.trust-level-adaptive_auto:hover {
    background: rgba(248,113,113,0.3);
  }

  :global(.dark) .trust-badge.trust-level-yolo {
    background: rgba(250,204,21,0.25);
    color: rgb(250 204 21);
    border-color: rgb(250 204 21);
    box-shadow: 0 0 0 2px rgba(250,204,21,0.2);
  }

  :global(.dark) .trust-badge.trust-level-yolo:hover {
    background: rgba(250,204,21,0.35);
  }

  /* Cognitive Mode badge */
  .mode-badge {
    padding: 0.125rem 0.4rem;
    border-radius: 9999px;
    font-size: 0.65rem;
    font-weight: 600;
    text-transform: lowercase;
    border: 1px solid transparent;
    transition: all 0.2s ease;
  }

  /* Dual mode - Purple (operator/coding enabled) */
  .mode-badge.mode-dual {
    background: rgba(147, 51, 234, 0.16);
    color: rgb(109 40 217);
    border-color: transparent;
  }

  /* Agent mode - Blue (heuristic routing) */
  .mode-badge.mode-agent {
    background: rgba(59, 130, 246, 0.16);
    color: rgb(29 78 216);
    border-color: transparent;
  }

  /* Emulation mode - Amber (stable snapshot) */
  .mode-badge.mode-emulation {
    background: rgba(245, 158, 11, 0.16);
    color: rgb(180 83 9);
    border-color: transparent;
  }

  /* Dark mode */
  :global(.dark) .mode-badge.mode-dual {
    background: rgba(167, 139, 250, 0.2);
    color: rgb(196 181 253);
  }

  :global(.dark) .mode-badge.mode-agent {
    background: rgba(96, 165, 250, 0.2);
    color: rgb(147 197 253);
  }

  :global(.dark) .mode-badge.mode-emulation {
    background: rgba(251, 191, 36, 0.2);
    color: rgb(252 211 77);
  }

  /* Trust level dropdown menu (kept for backward compatibility if needed) */
  .trust-menu {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin-top: 0.5rem;
    padding: 0.5rem;
    background: white;
    border: 1px solid rgba(0,0,0,0.1);
    border-radius: 0.5rem;
    box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);
  }

  :global(.dark) .trust-menu {
    background: rgb(31 41 55);
    border-color: rgba(255,255,255,0.1);
    box-shadow: 0 4px 6px -1px rgba(0,0,0,0.3);
  }

  .trust-option {
    padding: 0.375rem 0.5rem;
    background: transparent;
    border: none;
    border-radius: 0.375rem;
    font-size: 0.75rem;
    text-transform: lowercase;
    text-align: left;
    cursor: pointer;
    color: rgb(55 65 81);
    transition: all 0.15s ease;
  }

  .trust-option:hover {
    background: rgba(34,197,94,0.1);
    color: rgb(22 101 52);
  }

  .trust-option.active {
    background: rgba(34,197,94,0.16);
    color: rgb(22 101 52);
    font-weight: 600;
  }

  :global(.dark) .trust-option {
    color: rgb(209 213 219);
  }

  :global(.dark) .trust-option:hover {
    background: rgba(34,197,94,0.15);
    color: rgb(134 239 172);
  }

  :global(.dark) .trust-option.active {
    background: rgba(34,197,94,0.2);
    color: rgb(134 239 172);
  }

  /* Persona badge - shows personality context state */
  .persona-badge {
    padding: 0.125rem 0.4rem;
    border-radius: 9999px;
    font-size: 0.65rem;
    font-weight: 600;
    text-transform: lowercase;
    border: 1px solid transparent;
    transition: all 0.2s ease;
  }

  /* Clickable button reset */
  .persona-badge.clickable {
    cursor: pointer;
  }

  /* Active persona: Vibrant purple with subtle glow */
  .persona-badge.persona-active {
    background: linear-gradient(135deg, rgba(139,92,246,0.2), rgba(168,85,247,0.16));
    color: rgb(109 40 217);
    border-color: rgba(139,92,246,0.3);
    box-shadow: 0 0 8px rgba(139,92,246,0.15);
  }

  .persona-badge.persona-active:hover {
    background: linear-gradient(135deg, rgba(139,92,246,0.3), rgba(168,85,247,0.25));
    border-color: rgba(139,92,246,0.4);
    box-shadow: 0 0 12px rgba(139,92,246,0.25);
    transform: translateY(-1px);
  }

  /* Inactive persona: Neutral gray */
  .persona-badge.persona-inactive {
    background: rgba(107,114,128,0.16);
    color: rgb(107 114 128);
    border-color: transparent;
  }

  .persona-badge.persona-inactive:hover {
    background: rgba(107,114,128,0.25);
    border-color: rgba(107,114,128,0.2);
    transform: translateY(-1px);
  }

  /* Backwards compatibility with old class names */
  .persona-badge.enabled {
    background: linear-gradient(135deg, rgba(139,92,246,0.2), rgba(168,85,247,0.16));
    color: rgb(109 40 217);
    border-color: rgba(139,92,246,0.3);
    box-shadow: 0 0 8px rgba(139,92,246,0.15);
  }

  .persona-badge.disabled {
    background: rgba(107,114,128,0.16);
    color: rgb(107 114 128);
    border-color: transparent;
  }

  /* Dark mode */
  :global(.dark) .persona-badge.persona-active {
    background: linear-gradient(135deg, rgba(167,139,250,0.25), rgba(196,181,253,0.2));
    color: rgb(196 181 253);
    border-color: rgba(167,139,250,0.4);
    box-shadow: 0 0 12px rgba(167,139,250,0.2);
  }

  :global(.dark) .persona-badge.persona-active:hover {
    background: linear-gradient(135deg, rgba(167,139,250,0.35), rgba(196,181,253,0.3));
    border-color: rgba(167,139,250,0.5);
    box-shadow: 0 0 16px rgba(167,139,250,0.3);
    transform: translateY(-1px);
  }

  :global(.dark) .persona-badge.persona-inactive {
    background: rgba(107,114,128,0.2);
    color: rgb(156 163 175);
    border-color: transparent;
  }

  :global(.dark) .persona-badge.persona-inactive:hover {
    background: rgba(107,114,128,0.3);
    border-color: rgba(107,114,128,0.2);
    transform: translateY(-1px);
  }

  :global(.dark) .persona-badge.enabled {
    background: linear-gradient(135deg, rgba(167,139,250,0.25), rgba(196,181,253,0.2));
    color: rgb(196 181 253);
    border-color: rgba(167,139,250,0.4);
    box-shadow: 0 0 12px rgba(167,139,250,0.2);
  }

  :global(.dark) .persona-badge.disabled {
    background: rgba(107,114,128,0.2);
    color: rgb(156 163 175);
    border-color: transparent;
  }

  /* Facet-specific colors */
  /* Inactive - Gray */
  .persona-badge.persona-facet-inactive {
    background: rgba(107,114,128,0.16);
    color: rgb(107 114 128);
    border-color: transparent;
  }

  .persona-badge.persona-facet-inactive:hover {
    background: rgba(107,114,128,0.25);
    border-color: rgba(107,114,128,0.2);
    transform: translateY(-1px);
  }

  :global(.dark) .persona-badge.persona-facet-inactive {
    background: rgba(107,114,128,0.2);
    color: rgb(156 163 175);
  }

  :global(.dark) .persona-badge.persona-facet-inactive:hover {
    background: rgba(107,114,128,0.3);
    border-color: rgba(107,114,128,0.2);
  }

  /* Default - Purple */
  .persona-badge.persona-facet-default {
    background: linear-gradient(135deg, rgba(139,92,246,0.2), rgba(168,85,247,0.16));
    color: rgb(109 40 217);
    border-color: rgba(139,92,246,0.3);
    box-shadow: 0 0 8px rgba(139,92,246,0.15);
  }

  .persona-badge.persona-facet-default:hover {
    background: linear-gradient(135deg, rgba(139,92,246,0.3), rgba(168,85,247,0.25));
    border-color: rgba(139,92,246,0.4);
    box-shadow: 0 0 12px rgba(139,92,246,0.25);
    transform: translateY(-1px);
  }

  :global(.dark) .persona-badge.persona-facet-default {
    background: linear-gradient(135deg, rgba(167,139,250,0.25), rgba(196,181,253,0.2));
    color: rgb(196 181 253);
    border-color: rgba(167,139,250,0.4);
    box-shadow: 0 0 12px rgba(167,139,250,0.2);
  }

  :global(.dark) .persona-badge.persona-facet-default:hover {
    background: linear-gradient(135deg, rgba(167,139,250,0.35), rgba(196,181,253,0.3));
    border-color: rgba(167,139,250,0.5);
    box-shadow: 0 0 16px rgba(167,139,250,0.3);
  }

  /* Poet - Indigo */
  .persona-badge.persona-facet-poet {
    background: linear-gradient(135deg, rgba(99,102,241,0.2), rgba(129,140,248,0.16));
    color: rgb(67 56 202);
    border-color: rgba(99,102,241,0.3);
    box-shadow: 0 0 8px rgba(99,102,241,0.15);
  }

  .persona-badge.persona-facet-poet:hover {
    background: linear-gradient(135deg, rgba(99,102,241,0.3), rgba(129,140,248,0.25));
    border-color: rgba(99,102,241,0.4);
    box-shadow: 0 0 12px rgba(99,102,241,0.25);
    transform: translateY(-1px);
  }

  :global(.dark) .persona-badge.persona-facet-poet {
    background: linear-gradient(135deg, rgba(129,140,248,0.25), rgba(165,180,252,0.2));
    color: rgb(165 180 252);
    border-color: rgba(129,140,248,0.4);
    box-shadow: 0 0 12px rgba(129,140,248,0.2);
  }

  :global(.dark) .persona-badge.persona-facet-poet:hover {
    background: linear-gradient(135deg, rgba(129,140,248,0.35), rgba(165,180,252,0.3));
    border-color: rgba(129,140,248,0.5);
    box-shadow: 0 0 16px rgba(129,140,248,0.3);
  }

  /* Thinker - Blue */
  .persona-badge.persona-facet-thinker {
    background: linear-gradient(135deg, rgba(59,130,246,0.2), rgba(96,165,250,0.16));
    color: rgb(29 78 216);
    border-color: rgba(59,130,246,0.3);
    box-shadow: 0 0 8px rgba(59,130,246,0.15);
  }

  .persona-badge.persona-facet-thinker:hover {
    background: linear-gradient(135deg, rgba(59,130,246,0.3), rgba(96,165,250,0.25));
    border-color: rgba(59,130,246,0.4);
    box-shadow: 0 0 12px rgba(59,130,246,0.25);
    transform: translateY(-1px);
  }

  :global(.dark) .persona-badge.persona-facet-thinker {
    background: linear-gradient(135deg, rgba(96,165,250,0.25), rgba(147,197,253,0.2));
    color: rgb(147 197 253);
    border-color: rgba(96,165,250,0.4);
    box-shadow: 0 0 12px rgba(96,165,250,0.2);
  }

  :global(.dark) .persona-badge.persona-facet-thinker:hover {
    background: linear-gradient(135deg, rgba(96,165,250,0.35), rgba(147,197,253,0.3));
    border-color: rgba(96,165,250,0.5);
    box-shadow: 0 0 16px rgba(96,165,250,0.3);
  }

  /* Friend - Green */
  .persona-badge.persona-facet-friend {
    background: linear-gradient(135deg, rgba(34,197,94,0.2), rgba(74,222,128,0.16));
    color: rgb(21 128 61);
    border-color: rgba(34,197,94,0.3);
    box-shadow: 0 0 8px rgba(34,197,94,0.15);
  }

  .persona-badge.persona-facet-friend:hover {
    background: linear-gradient(135deg, rgba(34,197,94,0.3), rgba(74,222,128,0.25));
    border-color: rgba(34,197,94,0.4);
    box-shadow: 0 0 12px rgba(34,197,94,0.25);
    transform: translateY(-1px);
  }

  :global(.dark) .persona-badge.persona-facet-friend {
    background: linear-gradient(135deg, rgba(74,222,128,0.25), rgba(134,239,172,0.2));
    color: rgb(134 239 172);
    border-color: rgba(74,222,128,0.4);
    box-shadow: 0 0 12px rgba(74,222,128,0.2);
  }

  :global(.dark) .persona-badge.persona-facet-friend:hover {
    background: linear-gradient(135deg, rgba(74,222,128,0.35), rgba(134,239,172,0.3));
    border-color: rgba(74,222,128,0.5);
    box-shadow: 0 0 16px rgba(74,222,128,0.3);
  }

  /* Antagonist - Red */
  .persona-badge.persona-facet-antagonist {
    background: linear-gradient(135deg, rgba(239,68,68,0.2), rgba(248,113,113,0.16));
    color: rgb(185 28 28);
    border-color: rgba(239,68,68,0.3);
    box-shadow: 0 0 8px rgba(239,68,68,0.15);
  }

  .persona-badge.persona-facet-antagonist:hover {
    background: linear-gradient(135deg, rgba(239,68,68,0.3), rgba(248,113,113,0.25));
    border-color: rgba(239,68,68,0.4);
    box-shadow: 0 0 12px rgba(239,68,68,0.25);
    transform: translateY(-1px);
  }

  :global(.dark) .persona-badge.persona-facet-antagonist {
    background: linear-gradient(135deg, rgba(248,113,113,0.25), rgba(252,165,165,0.2));
    color: rgb(252 165 165);
    border-color: rgba(248,113,113,0.4);
    box-shadow: 0 0 12px rgba(248,113,113,0.2);
  }

  :global(.dark) .persona-badge.persona-facet-antagonist:hover {
    background: linear-gradient(135deg, rgba(248,113,113,0.35), rgba(252,165,165,0.3));
    border-color: rgba(248,113,113,0.5);
    box-shadow: 0 0 16px rgba(248,113,113,0.3);
  }

  /* ============================================
     Backend Indicator & Adaptive Widget Styles
     ============================================ */

  .backend-indicator {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.5rem;
    background: rgba(0, 0, 0, 0.03);
    border-radius: 0.5rem;
    margin-bottom: 0.5rem;
  }

  :global(.dark) .backend-indicator {
    background: rgba(255, 255, 255, 0.05);
  }

  .backend-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.15rem 0.4rem;
    border-radius: 0.375rem;
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .backend-badge.vllm {
    background: linear-gradient(135deg, rgba(234, 179, 8, 0.2), rgba(250, 204, 21, 0.15));
    color: rgb(161 98 7);
    border: 1px solid rgba(234, 179, 8, 0.3);
  }

  .backend-badge.ollama {
    background: linear-gradient(135deg, rgba(34, 197, 94, 0.15), rgba(74, 222, 128, 0.1));
    color: rgb(21 128 61);
    border: 1px solid rgba(34, 197, 94, 0.25);
  }

  :global(.dark) .backend-badge.vllm {
    background: linear-gradient(135deg, rgba(250, 204, 21, 0.2), rgba(253, 224, 71, 0.15));
    color: rgb(253 224 71);
    border-color: rgba(250, 204, 21, 0.35);
  }

  :global(.dark) .backend-badge.ollama {
    background: linear-gradient(135deg, rgba(74, 222, 128, 0.2), rgba(134, 239, 172, 0.15));
    color: rgb(134 239 172);
    border-color: rgba(74, 222, 128, 0.3);
  }

  .local-model-name {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    font-size: 0.7rem;
    color: rgb(55 65 81);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 140px;
  }

  :global(.dark) .local-model-name {
    color: rgb(209 213 219);
  }

  .loaded-indicator {
    display: inline-block;
    font-size: 0.6rem;
    margin-left: 0.25rem;
    color: rgb(34 197 94);
    font-weight: bold;
  }

  :global(.dark) .loaded-indicator {
    color: rgb(134 239 172);
  }

  /* Dropdown Categories */
  .dropdown-category {
    padding: 0.25rem 0;
    border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  }

  .dropdown-category:last-child {
    border-bottom: none;
  }

  :global(.dark) .dropdown-category {
    border-bottom-color: rgba(255, 255, 255, 0.08);
  }

  .category-label {
    display: block;
    padding: 0.35rem 0.75rem 0.25rem;
    font-size: 0.65rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: rgb(107 114 128);
  }

  :global(.dark) .category-label {
    color: rgb(156 163 175);
  }

  /* Default/Active Badge */
  .default-badge {
    display: inline-block;
    padding: 0.05rem 0.25rem;
    border-radius: 0.2rem;
    font-size: 0.6rem;
    font-weight: 600;
    background: rgba(34, 197, 94, 0.15);
    color: rgb(21 128 61);
    text-transform: uppercase;
    letter-spacing: 0.02em;
    margin-left: 0.25rem;
  }

  :global(.dark) .default-badge {
    background: rgba(74, 222, 128, 0.2);
    color: rgb(134 239 172);
  }

  /* Dual LoRA Badge */
  .dual-badge {
    display: inline-block;
    padding: 0.05rem 0.25rem;
    border-radius: 0.2rem;
    font-size: 0.6rem;
    font-weight: 600;
    background: rgba(139, 92, 246, 0.15);
    color: rgb(109 40 217);
    text-transform: uppercase;
    letter-spacing: 0.02em;
    margin-left: 0.25rem;
  }

  :global(.dark) .dual-badge {
    background: rgba(167, 139, 250, 0.2);
    color: rgb(196 181 253);
  }

  /* Big Brother Badge */
  .bb-badge {
    font-size: 0.7rem;
    margin-left: 0.25rem;
  }

  /* vLLM Active State - NOT disabled, just shows it's the loaded model */
  .dropdown-item.vllm-active {
    /* Normal clickable appearance - not grayed out */
    background: rgba(250, 204, 21, 0.08);
    border-left: 2px solid rgba(250, 204, 21, 0.5);
  }

  .dropdown-item.vllm-active:hover {
    background: rgba(250, 204, 21, 0.15);
  }

  :global(.dark) .dropdown-item.vllm-active {
    background: rgba(250, 204, 21, 0.1);
  }

  :global(.dark) .dropdown-item.vllm-active:hover {
    background: rgba(250, 204, 21, 0.18);
  }

  /* vLLM "loaded" badge */
  .vllm-badge {
    display: inline-block;
    padding: 0.05rem 0.25rem;
    border-radius: 0.2rem;
    font-size: 0.6rem;
    font-weight: 600;
    background: rgba(250, 204, 21, 0.2);
    color: rgb(161 98 7);
    text-transform: uppercase;
    letter-spacing: 0.02em;
    margin-left: 0.25rem;
  }

  :global(.dark) .vllm-badge {
    background: rgba(250, 204, 21, 0.25);
    color: rgb(253 224 71);
  }

  .dropdown-item:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .dropdown-item:disabled:hover {
    background: transparent;
  }

</style>
