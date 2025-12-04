<script lang="ts">
  import { onMount } from 'svelte';
  import { apiFetch } from '../lib/client/api-config';

  interface SystemStatus {
    identity: { name: string; role: string; trustLevel: string; icon?: string };
    tasks: {
      active: number;
      byStatus: { todo: number; in_progress: number; blocked: number };
    };
    values: Array<{ value: string; description: string; priority: number }>;
    goals: Array<{ goal: string; status: string; timeframe: string }>;
    lastUpdated: string;
    cognitiveMode?: string;
    memoryStats?: {
      totalIndexed: number;
      totalFiles: number;
      indexAvailable: boolean;
      indexModel: string | null;
      lastIndexed: string | null;
      lastCapture: string | null;
      byType: Record<string, number>;
      byCategory?: Record<string, number>;
      percentages?: Record<string, number>;
    };
    agentActivity?: {
      available: Array<{ name: string; lastRun: string | null; runCount: number }>;
      processing: { agent: string; status: string; lastActivity: string } | null;
    };
    systemHealth?: { ollama: string; auditLogSize: number; storageUsed: number };
    recentActivity?: Array<{ type: string; content: string; timestamp: string }>;
    modelRoles?: Record<string, any>;
  }

  interface VoiceStatus {
    tts: { provider: string; available: boolean; serverUrl?: string; error?: string };
    training: {
      totalSamples: number;
      totalDuration: number;
      recentSamples: Array<{
        filename: string;
        size: number;
        created: string;
        transcript: string;
      }>;
      providers: {
        sovits: { samples: number; hasReference: boolean };
        rvc: { samples: number; hasTrained: boolean };
      };
    };
  }

  let status: SystemStatus | null = null;
  let voiceStatus: VoiceStatus | null = null;
  let loading = true;
  let error = '';

  // Collapsible sections (some expanded by default)
  let collapsed = {
    memory: true,
    agents: true,
    values: true,
    activity: true,
    models: true,
  };

  function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  }

  function formatTimestamp(ts: string | null): string {
    if (!ts) return 'Never';
    const date = new Date(ts);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  }

  async function loadStatus() {
    try {
      const [statusRes, voiceRes] = await Promise.all([
        apiFetch('/api/status'),
        apiFetch('/api/voice-status'),
      ]);

      if (!statusRes.ok) throw new Error('Failed to load status');
      status = await statusRes.json();

      if (voiceRes.ok) {
        voiceStatus = await voiceRes.json();
      }

      loading = false;
    } catch (e) {
      error = (e as Error).message;
      loading = false;
    }
  }

  onMount(() => {
    loadStatus();
    const interval = setInterval(loadStatus, 30000);
    return () => clearInterval(interval);
  });
</script>

{#if loading}
  <div class="animate-pulse space-y-4">
    <div class="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/3"></div>
    <div class="h-32 bg-gray-200 dark:bg-gray-700 rounded"></div>
  </div>
{:else if error}
  <div class="card p-6 border-red-500">
    <p class="text-red-600 dark:text-red-400">Error: {error}</p>
    <p class="text-sm muted mt-2">Run: ./bin/mh init</p>
  </div>
{:else if status}
  <div class="dashboard-container">
    <!-- Identity & Quick Stats -->
    <section class="card p-6">
      <div class="flex items-start justify-between mb-4">
        <div>
          <h2 class="text-2xl font-bold mb-1">{status.identity.name}</h2>
          <p class="muted text-sm">{status.identity.role}</p>
          {#if status.cognitiveMode}
            <span class="badge badge-purple mt-2">{status.cognitiveMode} mode</span>
          {/if}
        </div>
        <div class="text-right">
          <div class="text-xs uppercase tracking-wide muted">Trust Level</div>
          <div class="badge badge-blue text-lg font-semibold mt-1">{status.identity.trustLevel}</div>
        </div>
      </div>
      <div class="grid gap-3 grid-cols-3">
        <div class="stat-mini">
          <div class="stat-mini-label">Active Tasks</div>
          <div class="stat-mini-value">{status.tasks.active}</div>
        </div>
        <div class="stat-mini">
          <div class="stat-mini-label">In Progress</div>
          <div class="stat-mini-value text-blue-600 dark:text-blue-400">{status.tasks.byStatus.in_progress}</div>
        </div>
        <div class="stat-mini">
          <div class="stat-mini-label">Blocked</div>
          <div class="stat-mini-value text-red-600 dark:text-red-400">{status.tasks.byStatus.blocked}</div>
        </div>
      </div>
    </section>

    <!-- Voice System (if available) -->
    {#if voiceStatus}
      <section class="card p-6">
        <h3 class="section-title mb-4">🎤 Voice System</h3>
        <div class="grid gap-4 sm:grid-cols-2">
          <div class="info-box">
            <div class="flex justify-between items-center mb-2">
              <span class="text-xs uppercase tracking-wide muted">Active Provider</span>
              <span class="status-dot" class:active={voiceStatus.tts.available}></span>
            </div>
            <div class="text-lg font-semibold capitalize">{voiceStatus.tts.provider}</div>
            <div class="text-xs muted mt-1">
              {voiceStatus.tts.available ? 'Ready' : 'Unavailable'}
            </div>
          </div>
          <div class="info-box">
            <span class="text-xs uppercase tracking-wide muted">Training Samples</span>
            <div class="text-lg font-semibold mt-2">{voiceStatus.training.totalSamples}</div>
            <div class="text-xs muted mt-1">
              SoVITS: {voiceStatus.training.providers.sovits.samples}
              {#if voiceStatus.training.providers.sovits.hasReference}
                <span class="text-green-600 dark:text-green-400">✓ Reference</span>
              {/if}
            </div>
            <div class="text-xs muted">
              RVC: {voiceStatus.training.providers.rvc.samples}
              {#if voiceStatus.training.providers.rvc.hasTrained}
                <span class="text-green-600 dark:text-green-400">✓ Trained</span>
              {/if}
            </div>
          </div>
        </div>
        {#if voiceStatus.training.recentSamples.length > 0}
          <details class="mt-4">
            <summary class="cursor-pointer text-xs uppercase tracking-wide muted">Recent Samples ({voiceStatus.training.recentSamples.length})</summary>
            <div class="mt-2 space-y-2">
              {#each voiceStatus.training.recentSamples.slice(0, 3) as sample}
                <div class="sample-item">
                  <div class="font-mono text-xs">{sample.filename}</div>
                  <div class="text-xs muted">{formatBytes(sample.size)} • {formatTimestamp(sample.created)}</div>
                  {#if sample.transcript}
                    <div class="text-xs italic muted">"{sample.transcript}..."</div>
                  {/if}
                </div>
              {/each}
            </div>
          </details>
        {/if}
      </section>
    {/if}

    <!-- System Health -->
    {#if status.systemHealth}
      <section class="card p-6">
        <h3 class="section-title mb-4">System Health</h3>
        <div class="grid gap-4 sm:grid-cols-3">
          <div class="info-box">
            <div class="text-xs uppercase tracking-wide muted mb-1">Ollama</div>
            <div class="flex items-center gap-2">
              <span class="status-dot" class:active={status.systemHealth.ollama === 'connected'}></span>
              <span class="text-sm font-semibold capitalize">{status.systemHealth.ollama}</span>
            </div>
          </div>
          <div class="info-box">
            <div class="text-xs uppercase tracking-wide muted mb-1">Audit Log</div>
            <div class="text-sm font-semibold">{formatBytes(status.systemHealth.auditLogSize)}</div>
          </div>
          <div class="info-box">
            <div class="text-xs uppercase tracking-wide muted mb-1">Storage Used</div>
            <div class="text-sm font-semibold">{formatBytes(status.systemHealth.storageUsed)}</div>
          </div>
        </div>
      </section>
    {/if}

    <!-- Memory System (Collapsible) -->
    {#if status.memoryStats}
      <section class="card">
        <button class="collapsible-header" on:click={() => collapsed.memory = !collapsed.memory}>
          <h3 class="section-title">Memory System</h3>
          <span class="expand-icon">{collapsed.memory ? '▶' : '▼'}</span>
        </button>
        {#if !collapsed.memory}
          <div class="p-6 pt-0">
            <div class="grid gap-6 sm:grid-cols-2">
              <div>
                <div class="text-xs uppercase tracking-wide muted mb-3">Index Status</div>
                <div class="space-y-2 text-sm">
                  <div class="flex justify-between">
                    <span class="muted">Total Files</span>
                    <span class="font-semibold">{status.memoryStats.totalFiles}</span>
                  </div>
                  <div class="flex justify-between">
                    <span class="muted">Indexed</span>
                    <span class="font-semibold">{status.memoryStats.totalIndexed}</span>
                  </div>
                  <div class="flex justify-between">
                    <span class="muted">Status</span>
                    <span class="font-semibold" class:text-green-600={status.memoryStats.indexAvailable} class:dark:text-green-400={status.memoryStats.indexAvailable}>
                      {status.memoryStats.indexAvailable ? 'Available' : 'Missing'}
                    </span>
                  </div>
                </div>
              </div>
              <div>
                <div class="text-xs uppercase tracking-wide muted mb-3">Categories</div>
                <div class="space-y-3">
                  {#if status.memoryStats.byCategory}
                    {#each Object.entries(status.memoryStats.byCategory).filter(([_, c]) => c > 0).slice(0, 4) as [category, count]}
                      <div>
                        <div class="flex justify-between text-sm mb-1">
                          <span class="muted capitalize">{category}</span>
                          <span class="font-semibold">{count}</span>
                        </div>
                        <div class="progress-bar-bg">
                          <div class="progress-bar-fill" style="width: {status.memoryStats.percentages?.[category] || 0}%"></div>
                        </div>
                      </div>
                    {/each}
                  {/if}
                </div>
              </div>
            </div>
          </div>
        {/if}
      </section>
    {/if}

    <!-- Agent Activity (Collapsible) -->
    {#if status.agentActivity}
      <section class="card">
        <button class="collapsible-header" on:click={() => collapsed.agents = !collapsed.agents}>
          <h3 class="section-title">Agent Activity</h3>
          <span class="expand-icon">{collapsed.agents ? '▶' : '▼'}</span>
        </button>
        {#if !collapsed.agents}
          <div class="p-6 pt-0">
            {#if status.agentActivity.processing}
              <div class="processing-banner mb-4">
                <div class="flex items-center gap-2">
                  <div class="status-dot active animate-pulse"></div>
                  <span class="text-sm font-semibold">{status.agentActivity.processing.agent}</span>
                  <span class="text-xs muted">- {status.agentActivity.processing.status}</span>
                </div>
              </div>
            {/if}
            <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {#each status.agentActivity.available.slice(0, 6) as agent}
                <div class="agent-card">
                  <div class="flex justify-between items-start mb-1">
                    <span class="text-sm font-semibold">{agent.name}</span>
                    <span class="badge badge-gray text-xs">{agent.runCount}</span>
                  </div>
                  <div class="text-xs muted">Last: {formatTimestamp(agent.lastRun)}</div>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      </section>
    {/if}

    <!-- Values & Goals (Collapsible) -->
    <section class="card">
      <button class="collapsible-header" on:click={() => collapsed.values = !collapsed.values}>
        <h3 class="section-title">Core Values & Goals</h3>
        <span class="expand-icon">{collapsed.values ? '▶' : '▼'}</span>
      </button>
      {#if !collapsed.values}
        <div class="p-6 pt-0">
          <div class="grid gap-6 sm:grid-cols-2">
            <div>
              <div class="text-xs uppercase tracking-wide muted mb-2">Core Values</div>
              <div class="space-y-2">
                {#each status.values as v}
                  <div>
                    <div class="text-sm font-semibold">{v.priority}. {v.value}</div>
                    <div class="text-xs muted">{v.description}</div>
                  </div>
                {/each}
              </div>
            </div>
            <div>
              <div class="text-xs uppercase tracking-wide muted mb-2">Current Goals</div>
              <div class="space-y-2">
                {#each status.goals as g}
                  <div>
                    <div class="text-sm font-semibold">{g.goal}</div>
                    <div class="text-xs muted"><span class="badge badge-gray">{g.status}</span></div>
                  </div>
                {/each}
              </div>
            </div>
          </div>
        </div>
      {/if}
    </section>

    <!-- Recent Activity (Collapsible) -->
    {#if status.recentActivity && status.recentActivity.length > 0}
      <section class="card">
        <button class="collapsible-header" on:click={() => collapsed.activity = !collapsed.activity}>
          <h3 class="section-title">Recent Activity</h3>
          <span class="expand-icon">{collapsed.activity ? '▶' : '▼'}</span>
        </button>
        {#if !collapsed.activity}
          <div class="p-6 pt-0">
            <div class="space-y-3">
              {#each status.recentActivity.slice(0, 5) as activity}
                <div class="activity-item">
                  <div class="flex justify-between items-start mb-1">
                    <span class="badge badge-gray text-xs capitalize">{activity.type}</span>
                    <span class="text-xs muted">{formatTimestamp(activity.timestamp)}</span>
                  </div>
                  <p class="text-sm">{activity.content}</p>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      </section>
    {/if}

    <!-- Model Configuration (Collapsible) -->
    {#if status.modelRoles && Object.keys(status.modelRoles).length > 0}
      <section class="card">
        <button class="collapsible-header" on:click={() => collapsed.models = !collapsed.models}>
          <h3 class="section-title">Model Configuration</h3>
          <span class="expand-icon">{collapsed.models ? '▶' : '▼'}</span>
        </button>
        {#if !collapsed.models}
          <div class="p-6 pt-0">
            <div class="space-y-2">
              {#each Object.entries(status.modelRoles).slice(0, 8) as [role, config]}
                <div class="model-item">
                  <span class="muted capitalize">{role}</span>
                  <div class="text-right">
                    <div class="font-mono text-xs">{config.model}</div>
                    {#if config.adapters && config.adapters.length > 0}
                      <div class="text-xs muted">+ {config.adapters.length} adapter(s)</div>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      </section>
    {/if}

    <div class="text-xs muted text-center mt-6">
      Last updated: {new Date(status.lastUpdated).toLocaleString()}
    </div>
  </div>
{/if}

<style>
  .dashboard-container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .card {
    background: white;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    overflow: hidden;
  }

  :global(.dark) .card {
    background: #1f2937;
    border-color: #374151;
  }

  .collapsible-header {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1.5rem;
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: left;
    transition: background 0.2s;
  }

  .collapsible-header:hover {
    background: rgba(0, 0, 0, 0.02);
  }

  :global(.dark) .collapsible-header:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  .section-title {
    font-size: 1.125rem;
    font-weight: 600;
  }

  .expand-icon {
    font-size: 0.75rem;
    color: #9ca3af;
    margin-left: 0.5rem;
  }

  .badge {
    display: inline-block;
    padding: 0.25rem 0.75rem;
    border-radius: 999px;
    font-size: 0.75rem;
  }

  .badge-purple {
    background: #f3e8ff;
    color: #7c3aed;
  }

  :global(.dark) .badge-purple {
    background: #581c87;
    color: #e9d5ff;
  }

  .badge-blue {
    background: #dbeafe;
    color: #1e40af;
  }

  :global(.dark) .badge-blue {
    background: #1e3a8a;
    color: #93c5fd;
  }

  .badge-gray {
    background: #f3f4f6;
    color: #4b5563;
    font-size: 0.75rem;
    padding: 0.125rem 0.5rem;
  }

  :global(.dark) .badge-gray {
    background: #374151;
    color: #d1d5db;
  }

  .stat-mini {
    text-align: center;
  }

  .stat-mini-label {
    font-size: 0.75rem;
    color: #6b7280;
    margin-bottom: 0.25rem;
  }

  .stat-mini-value {
    font-size: 1.5rem;
    font-weight: 700;
  }

  .info-box {
    padding: 1rem;
    border-radius: 6px;
    background: #f9fafb;
  }

  :global(.dark) .info-box {
    background: #111827;
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #ef4444;
  }

  .status-dot.active {
    background: #10b981;
  }

  .sample-item {
    padding: 0.5rem;
    border-radius: 4px;
    background: #f9fafb;
    border: 1px solid #e5e7eb;
  }

  :global(.dark) .sample-item {
    background: #111827;
    border-color: #374151;
  }

  .progress-bar-bg {
    width: 100%;
    background: #e5e7eb;
    border-radius: 999px;
    height: 4px;
    overflow: hidden;
  }

  :global(.dark) .progress-bar-bg {
    background: #374151;
  }

  .progress-bar-fill {
    background: #3b82f6;
    height: 100%;
    border-radius: 999px;
    transition: width 0.3s ease;
  }

  .processing-banner {
    padding: 0.75rem;
    border-radius: 6px;
    background: #eff6ff;
    border: 1px solid #bfdbfe;
  }

  :global(.dark) .processing-banner {
    background: rgba(59, 130, 246, 0.15);
    border-color: #1e3a8a;
  }

  .agent-card {
    padding: 0.75rem;
    border-radius: 4px;
    background: #f9fafb;
  }

  :global(.dark) .agent-card {
    background: #111827;
  }

  .activity-item {
    padding: 0.75rem;
    border-radius: 4px;
    background: #f9fafb;
    border: 1px solid #e5e7eb;
  }

  :global(.dark) .activity-item {
    background: #111827;
    border-color: #374151;
  }

  .model-item {
    display: flex;
    justify-content: space-between;
    align-items: start;
    padding: 0.5rem;
    border-radius: 4px;
    font-size: 0.875rem;
  }

  .model-item:hover {
    background: #f9fafb;
  }

  :global(.dark) .model-item:hover {
    background: #111827;
  }

  .muted {
    color: #6b7280;
  }

  :global(.dark) .muted {
    color: #9ca3af;
  }

  details summary {
    list-style: none;
  }

  details summary::-webkit-details-marker {
    display: none;
  }
</style>
