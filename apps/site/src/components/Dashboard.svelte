<script lang="ts">
  import { onMount } from 'svelte';
  import { apiFetch } from '../lib/client/api-config';
  import TriggerManagerOverviewCard from './TriggerManagerOverviewCard.svelte';

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
    <p class="text-sm text-gray-500 dark:text-gray-400 mt-2">Run: ./bin/mh init</p>
  </div>
{:else if status}
  <div class="max-w-[1200px] mx-auto p-4 flex flex-col gap-4">
    <TriggerManagerOverviewCard />
    <!-- Identity & Quick Stats -->
    <section class="card p-6">
      <div class="flex items-start justify-between mb-4">
        <div>
          <h2 class="text-2xl font-bold mb-1">{status.identity.name}</h2>
          <p class="text-sm text-gray-500 dark:text-gray-400">{status.identity.role}</p>
          {#if status.cognitiveMode}
            <span class="inline-block py-1 px-3 rounded-full text-xs bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-200 mt-2">{status.cognitiveMode} mode</span>
          {/if}
        </div>
        <div class="text-right">
          <div class="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Trust Level</div>
          <div class="inline-block py-1 px-3 rounded-full text-lg font-semibold bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 mt-1">{status.identity.trustLevel}</div>
        </div>
      </div>
      <div class="grid gap-3 grid-cols-3">
        <div class="text-center">
          <div class="text-xs text-gray-500 mb-1">Active Tasks</div>
          <div class="text-2xl font-bold">{status.tasks.active}</div>
        </div>
        <div class="text-center">
          <div class="text-xs text-gray-500 mb-1">In Progress</div>
          <div class="text-2xl font-bold text-blue-600 dark:text-blue-400">{status.tasks.byStatus.in_progress}</div>
        </div>
        <div class="text-center">
          <div class="text-xs text-gray-500 mb-1">Blocked</div>
          <div class="text-2xl font-bold text-red-600 dark:text-red-400">{status.tasks.byStatus.blocked}</div>
        </div>
      </div>
    </section>

    <!-- Voice System (if available) -->
    {#if voiceStatus}
      <section class="card p-6">
        <h3 class="text-lg font-semibold mb-4">🎤 Voice System</h3>
        <div class="grid gap-4 sm:grid-cols-2">
          <div class="p-4 rounded-md bg-gray-50 dark:bg-gray-900">
            <div class="flex justify-between items-center mb-2">
              <span class="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Active Provider</span>
              <span class="w-2 h-2 rounded-full" class:bg-green-500={voiceStatus.tts.available} class:bg-red-500={!voiceStatus.tts.available}></span>
            </div>
            <div class="text-lg font-semibold capitalize">{voiceStatus.tts.provider}</div>
            <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {voiceStatus.tts.available ? 'Ready' : 'Unavailable'}
            </div>
          </div>
          <div class="p-4 rounded-md bg-gray-50 dark:bg-gray-900">
            <span class="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Training Samples</span>
            <div class="text-lg font-semibold mt-2">{voiceStatus.training.totalSamples}</div>
            <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">
              SoVITS: {voiceStatus.training.providers.sovits.samples}
              {#if voiceStatus.training.providers.sovits.hasReference}
                <span class="text-green-600 dark:text-green-400">✓ Reference</span>
              {/if}
            </div>
            <div class="text-xs text-gray-500 dark:text-gray-400">
              RVC: {voiceStatus.training.providers.rvc.samples}
              {#if voiceStatus.training.providers.rvc.hasTrained}
                <span class="text-green-600 dark:text-green-400">✓ Trained</span>
              {/if}
            </div>
          </div>
        </div>
        {#if voiceStatus.training.recentSamples.length > 0}
          <details class="mt-4">
            <summary class="cursor-pointer text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 list-none">Recent Samples ({voiceStatus.training.recentSamples.length})</summary>
            <div class="mt-2 space-y-2">
              {#each voiceStatus.training.recentSamples.slice(0, 3) as sample}
                <div class="p-2 rounded bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700">
                  <div class="font-mono text-xs">{sample.filename}</div>
                  <div class="text-xs text-gray-500 dark:text-gray-400">{formatBytes(sample.size)} • {formatTimestamp(sample.created)}</div>
                  {#if sample.transcript}
                    <div class="text-xs italic text-gray-500 dark:text-gray-400">"{sample.transcript}..."</div>
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
        <h3 class="text-lg font-semibold mb-4">System Health</h3>
        <div class="grid gap-4 sm:grid-cols-3">
          <div class="p-4 rounded-md bg-gray-50 dark:bg-gray-900">
            <div class="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">Ollama</div>
            <div class="flex items-center gap-2">
              <span class="w-2 h-2 rounded-full" class:bg-green-500={status.systemHealth.ollama === 'connected'} class:bg-red-500={status.systemHealth.ollama !== 'connected'}></span>
              <span class="text-sm font-semibold capitalize">{status.systemHealth.ollama}</span>
            </div>
          </div>
          <div class="p-4 rounded-md bg-gray-50 dark:bg-gray-900">
            <div class="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">Audit Log</div>
            <div class="text-sm font-semibold">{formatBytes(status.systemHealth.auditLogSize)}</div>
          </div>
          <div class="p-4 rounded-md bg-gray-50 dark:bg-gray-900">
            <div class="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">Storage Used</div>
            <div class="text-sm font-semibold">{formatBytes(status.systemHealth.storageUsed)}</div>
          </div>
        </div>
      </section>
    {/if}

    <!-- Memory System (Collapsible) -->
    {#if status.memoryStats}
      <section class="card">
        <button class="collapsible-header" on:click={() => collapsed.memory = !collapsed.memory}>
          <h3 class="text-lg font-semibold">Memory System</h3>
          <span class="text-xs text-gray-400 ml-2">{collapsed.memory ? '▶' : '▼'}</span>
        </button>
        {#if !collapsed.memory}
          <div class="p-6 pt-0">
            <div class="grid gap-6 sm:grid-cols-2">
              <div>
                <div class="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3">Index Status</div>
                <div class="space-y-2 text-sm">
                  <div class="flex justify-between">
                    <span class="text-gray-500 dark:text-gray-400">Total Files</span>
                    <span class="font-semibold">{status.memoryStats.totalFiles}</span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-gray-500 dark:text-gray-400">Indexed</span>
                    <span class="font-semibold">{status.memoryStats.totalIndexed}</span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-gray-500 dark:text-gray-400">Status</span>
                    <span class="font-semibold" class:text-green-600={status.memoryStats.indexAvailable} class:dark:text-green-400={status.memoryStats.indexAvailable}>
                      {status.memoryStats.indexAvailable ? 'Available' : 'Missing'}
                    </span>
                  </div>
                </div>
              </div>
              <div>
                <div class="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3">Categories</div>
                <div class="space-y-3">
                  {#if status.memoryStats.byCategory}
                    {#each Object.entries(status.memoryStats.byCategory).filter(([_, c]) => c > 0).slice(0, 4) as [category, count]}
                      <div>
                        <div class="flex justify-between text-sm mb-1">
                          <span class="text-gray-500 dark:text-gray-400 capitalize">{category}</span>
                          <span class="font-semibold">{count}</span>
                        </div>
                        <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1 overflow-hidden">
                          <div class="bg-blue-500 h-full rounded-full transition-all" style="width: {status.memoryStats.percentages?.[category] || 0}%"></div>
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
          <h3 class="text-lg font-semibold">Agent Activity</h3>
          <span class="text-xs text-gray-400 ml-2">{collapsed.agents ? '▶' : '▼'}</span>
        </button>
        {#if !collapsed.agents}
          <div class="p-6 pt-0">
            {#if status.agentActivity.processing}
              <div class="p-3 rounded-md bg-blue-50 dark:bg-blue-500/15 border border-blue-200 dark:border-blue-900 mb-4">
                <div class="flex items-center gap-2">
                  <div class="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                  <span class="text-sm font-semibold">{status.agentActivity.processing.agent}</span>
                  <span class="text-xs text-gray-500 dark:text-gray-400">- {status.agentActivity.processing.status}</span>
                </div>
              </div>
            {/if}
            <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {#each status.agentActivity.available.slice(0, 6) as agent}
                <div class="p-3 rounded bg-gray-50 dark:bg-gray-900">
                  <div class="flex justify-between items-start mb-1">
                    <span class="text-sm font-semibold">{agent.name}</span>
                    <span class="text-xs py-0.5 px-2 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300">{agent.runCount}</span>
                  </div>
                  <div class="text-xs text-gray-500 dark:text-gray-400">Last: {formatTimestamp(agent.lastRun)}</div>
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
        <h3 class="text-lg font-semibold">Core Values & Goals</h3>
        <span class="text-xs text-gray-400 ml-2">{collapsed.values ? '▶' : '▼'}</span>
      </button>
      {#if !collapsed.values}
        <div class="p-6 pt-0">
          <div class="grid gap-6 sm:grid-cols-2">
            <div>
              <div class="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">Core Values</div>
              <div class="space-y-2">
                {#each status.values as v}
                  <div>
                    <div class="text-sm font-semibold">{v.priority}. {v.value}</div>
                    <div class="text-xs text-gray-500 dark:text-gray-400">{v.description}</div>
                  </div>
                {/each}
              </div>
            </div>
            <div>
              <div class="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">Current Goals</div>
              <div class="space-y-2">
                {#each status.goals as g}
                  <div>
                    <div class="text-sm font-semibold">{g.goal}</div>
                    <div class="text-xs text-gray-500 dark:text-gray-400"><span class="py-0.5 px-2 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-xs">{g.status}</span></div>
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
          <h3 class="text-lg font-semibold">Recent Activity</h3>
          <span class="text-xs text-gray-400 ml-2">{collapsed.activity ? '▶' : '▼'}</span>
        </button>
        {#if !collapsed.activity}
          <div class="p-6 pt-0">
            <div class="space-y-3">
              {#each status.recentActivity.slice(0, 5) as activity}
                <div class="p-3 rounded bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700">
                  <div class="flex justify-between items-start mb-1">
                    <span class="py-0.5 px-2 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-xs capitalize">{activity.type}</span>
                    <span class="text-xs text-gray-500 dark:text-gray-400">{formatTimestamp(activity.timestamp)}</span>
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
          <h3 class="text-lg font-semibold">Model Configuration</h3>
          <span class="text-xs text-gray-400 ml-2">{collapsed.models ? '▶' : '▼'}</span>
        </button>
        {#if !collapsed.models}
          <div class="p-6 pt-0">
            <div class="space-y-2">
              {#each Object.entries(status.modelRoles).slice(0, 8) as [role, config]}
                <div class="flex justify-between items-start p-2 rounded text-sm hover:bg-gray-50 dark:hover:bg-gray-900">
                  <span class="text-gray-500 dark:text-gray-400 capitalize">{role}</span>
                  <div class="text-right">
                    <div class="font-mono text-xs">{config.model}</div>
                    {#if config.adapters && config.adapters.length > 0}
                      <div class="text-xs text-gray-500 dark:text-gray-400">+ {config.adapters.length} adapter(s)</div>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      </section>
    {/if}

    <div class="text-xs text-gray-500 dark:text-gray-400 text-center mt-6">
      Last updated: {new Date(status.lastUpdated).toLocaleString()}
    </div>
  </div>
{/if}

<style>
  /* Collapsible header button */
  .collapsible-header {
    @apply w-full flex items-center justify-between p-6 bg-transparent border-0 cursor-pointer text-left transition-colors;
  }
  .collapsible-header:hover {
    @apply bg-black/[0.02] dark:bg-white/5;
  }

  /* Hide details marker */
  details summary {
    list-style: none;
  }
  details summary::-webkit-details-marker {
    display: none;
  }
</style>
