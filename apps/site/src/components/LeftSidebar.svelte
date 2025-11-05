<script lang="ts">
  import { onMount } from 'svelte';
  import { activeView, statusStore } from '../stores/navigation';

  interface MenuItem {
    id: string;
    label: string;
    icon: string;
    description?: string;
  }

  const menuItems: MenuItem[] = [
    { id: 'chat', label: 'Chat', icon: '💬', description: 'Conversation interface' },
    { id: 'dashboard', label: 'Dashboard', icon: '📊', description: 'System overview' },
    { id: 'tasks', label: 'Tasks', icon: '✓', description: 'Task management' },
    { id: 'approvals', label: 'Approvals', icon: '✋', description: 'Skill execution queue' },
    { id: 'memory', label: 'Memory', icon: '🧩', description: 'Events & insights' },
    { id: 'voice', label: 'Voice', icon: '🎤', description: 'Audio & training' },
    { id: 'training', label: 'AI Training', icon: '🧠', description: 'LoRA adapters' },
    { id: 'terminal', label: 'Terminal', icon: '💻', description: 'Command line' },
    { id: 'system', label: 'System', icon: '⚙️', description: 'Settings & tools' },
    { id: 'network', label: 'Network', icon: '🌐', description: 'Cloudflare & connectivity' },
    { id: 'security', label: 'Security', icon: '🔒', description: 'User & authentication' },
  ];

  // Current user state
  interface User {
    id: string;
    username: string;
    role: 'owner' | 'guest' | 'anonymous';
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
  let pendingApprovals = 0;

  // Subscribe to the shared status store
  let statusSubscription = null;

  // Real-time activity tracking
  let activeRoles = new Set<string>();
  let eventSource: EventSource | null = null;

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

  async function loadPendingApprovals() {
    try {
      const res = await fetch('/api/approvals');
      if (res.ok) {
        const data = await res.json();
        pendingApprovals = data?.approvals?.length ?? 0;
      }
    } catch (err) {
      console.error('Failed to load pending approvals:', err);
    }
  }

  async function loadTrustOptions() {
    try {
      const res = await fetch('/api/trust');
      const data = await res.json();
      if (res.ok) {
        trustOptions = Array.isArray(data.available) ? data.available : [];
        if (identity) identity.trustLevel = data.level;
      }
    } catch (e) {
      console.error('Failed to load trust options:', e);
    }
  }

  async function setTrust(level: string) {
    try {
      const res = await fetch('/api/trust', {
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

  function connectActivityStream() {
    if (eventSource) return;
    eventSource = new EventSource('/api/llm-activity');

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'start') {
          activeRoles.add(data.role);
          activeRoles = activeRoles; // Trigger reactivity
        } else if (data.type === 'end') {
          activeRoles.delete(data.role);
          activeRoles = activeRoles; // Trigger reactivity
        }
      } catch (e) {
        console.error('Failed to parse activity event:', e);
      }
    };

    eventSource.onerror = () => {
      console.warn('Activity stream disconnected, reconnecting in 5s...');
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      setTimeout(connectActivityStream, 5000);
    };
  }

  function disconnectActivityStream() {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
  }

  async function fetchCurrentUser() {
    try {
      const response = await fetch('/api/auth/me');
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
    // Don't auto-connect initially
    loadStatus();
    loadPendingApprovals();

    // Refresh approvals every 5 seconds (no need to refresh status as we're using the shared store)
    const approvalsInterval = setInterval(loadPendingApprovals, 5000);

    // Set up visibility change handling to connect/disconnect EventSource
    const handleVisibilityChange = () => {
      if (document.hidden) {
        disconnectActivityStream();
      } else {
        connectActivityStream();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Connect after a small delay to allow for any initial page setup
    setTimeout(connectActivityStream, 1000);

    return () => {
      clearInterval(approvalsInterval);
      if (statusSubscription) {
        statusSubscription();
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      disconnectActivityStream();
    };
  });

  $: taskCount = taskTotals.active;
  $: inProgressCount = taskTotals.inProgress;

  const adapterModeLabels: Record<string, string> = {
    none: 'none',
    adapter: 'adapter',
    merged: 'merged',
    dual: 'dual',
  };
</script>

<div class="left-sidebar-container">
  <!-- Menu Items -->
  <nav class="menu">
    {#each menuItems as item}
      {@const isSecurityTab = item.id === 'security'}
      {@const isDisabled = isSecurityTab && !currentUser}
      <button
        class="menu-item"
        class:active={$activeView === item.id}
        class:disabled={isDisabled}
        on:click={() => !isDisabled && selectView(item.id)}
        disabled={isDisabled}
        title={isDisabled ? 'Login required to access security settings' : item.description}
      >
        <span class="menu-icon">{item.icon}</span>
        <div class="menu-text">
          <div class="menu-label">
            {item.label}
            {#if isDisabled}
              <svg class="w-3 h-3 inline ml-1 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
              </svg>
            {/if}
            {#if item.id === 'approvals' && pendingApprovals > 0}
              <span class="approval-badge">{pendingApprovals}</span>
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

        {#if hasModelRegistry}
          <!-- Multi-model registry view -->
<!--           <div class="status-row">
            <span class="status-label">LLM Roles:</span>
          </div> -->
          {#each Object.entries(modelRoles) as [role, info]}
            <div class="model-role-row" class:active={activeRoles.has(role)}>
              <span class="activity-indicator">
                <span class="activity-dot"></span>
              </span>
              <span class="role-name">{role}</span>
              <span class="role-arrow">→</span>
              {#if info.error}
                <span class="role-model error" title={info.error}>error</span>
              {:else}
                <span class="role-model" title="{info.model}{info.adapters && info.adapters.length > 0 ? ' + adapter' : ''}">
                  {info.model?.replace(/:.+$/, '') || '—'}
                  {#if info.adapters && info.adapters.length > 0}
                    <span class="adapter-indicator">+LoRA</span>
                  {/if}
                </span>
              {/if}
            </div>
          {/each}
        {:else}
          <!-- Legacy single-model view -->
          <div class="status-row">
            <span class="status-label">Model:</span>
            <span class="status-value mono">{modelInfo?.current || '—'}</span>
          </div>
          <div class="status-row">
            <span class="status-label">Adapter:</span>
            <span class="status-value">
              {#if modelInfo?.adapter?.isDualAdapter}
                <span class="adapter-mode-badge mode-dual">dual</span>
              {:else if modelInfo?.adapterMode === 'adapter'}
                <span class="adapter-mode-badge mode-adapter">single</span>
              {:else}
                <span class="adapter-mode-badge mode-none">none</span>
              {/if}
            </span>
          </div>
        {/if}
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

  /* Adapter mode badges - LeftSidebar-specific variants */
  .adapter-mode-badge {
    padding: 0.125rem 0.4rem;
    border-radius: 9999px;
    font-size: 0.7rem;
    text-transform: lowercase;
    margin-right: 0.5rem;
    background: rgba(107,114,128,0.16);
    color: rgb(75 85 99);
  }

  .adapter-mode-badge.mode-none {
    background: rgba(107,114,128,0.16);
    color: rgb(107 114 128);
  }

  .adapter-mode-badge.mode-adapter {
    background: rgba(14,165,233,0.18);
    color: rgb(3 105 161);
  }

  .adapter-mode-badge.mode-merged {
    background: rgba(129,140,248,0.18);
    color: rgb(79 70 229);
  }

  .adapter-mode-badge.mode-dual {
    background: rgba(236,72,153,0.18);
    color: rgb(190 24 93);
  }

  :global(.dark) .adapter-mode-badge {
    background: rgba(148,163,184,0.16);
    color: rgb(226 232 240);
  }

  :global(.dark) .adapter-mode-badge.mode-adapter {
    background: rgba(56,189,248,0.18);
    color: rgb(125 211 252);
  }

  :global(.dark) .adapter-mode-badge.mode-merged {
    background: rgba(99,102,241,0.18);
    color: rgb(165 180 252);
  }

  :global(.dark) .adapter-mode-badge.mode-dual {
    background: rgba(244,114,182,0.18);
    color: rgb(251 207 232);
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
    padding: 0.25rem 0 0.25rem 0.25rem;
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
    font-size: 0.75rem;
    font-weight: 500;
    display: flex;
    align-items: center;
    gap: 0.25rem;
    flex: 1;
    min-width: 0;
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

  /* Disabled menu item styles */
  .menu-item.disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .menu-item.disabled:hover {
    background: transparent !important;
  }

  :global(.dark) .menu-item.disabled:hover {
    background: transparent !important;
  }
</style>
