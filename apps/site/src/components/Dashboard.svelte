<script lang="ts">
  import { onMount } from 'svelte';

  interface SystemStatus {
    identity: {
      name: string;
      role: string;
      trustLevel: string;
      icon?: string;
    };
    tasks: {
      active: number;
      byStatus: {
        todo: number;
        in_progress: number;
        blocked: number;
      };
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
    systemHealth?: {
      ollama: string;
      auditLogSize: number;
      storageUsed: number;
    };
    recentActivity?: Array<{ type: string; content: string; timestamp: string }>;
    modelRoles?: Record<string, any>;
  }

  let status: SystemStatus | null = null;
  let loading = true;
  let error = '';

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
      const res = await fetch('/api/status');
      if (!res.ok) throw new Error('Failed to load status');
      status = await res.json();
      loading = false;
    } catch (e) {
      error = (e as Error).message;
      loading = false;
    }
  }

  onMount(() => {
    loadStatus();
    // Refresh every 30 seconds
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
  <div class="space-y-6">
    <!-- Identity Section -->
    <section class="card p-6">
      <div class="flex items-start justify-between">
        <div>
          <h2 class="text-2xl font-bold mb-1">{status.identity.name}</h2>
          <p class="muted text-sm">{status.identity.role}</p>
          {#if status.cognitiveMode}
            <span class="inline-block mt-2 px-2 py-1 text-xs rounded-full bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200">
              {status.cognitiveMode} mode
            </span>
          {/if}
        </div>
        <div class="text-right">
          <div class="text-xs uppercase tracking-wide muted">Trust Level</div>
          <div class="text-lg font-semibold mt-1 px-3 py-1 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 inline-block">
            {status.identity.trustLevel}
          </div>
        </div>
      </div>
    </section>

    <!-- System Health Overview -->
    {#if status.systemHealth}
      <section class="card p-6">
        <h3 class="text-lg font-semibold mb-4">System Health</h3>
        <div class="grid gap-4 sm:grid-cols-3">
          <div>
            <div class="text-xs uppercase tracking-wide muted mb-1">Ollama</div>
            <div class="flex items-center gap-2">
              <span class="w-2 h-2 rounded-full {status.systemHealth.ollama === 'connected' ? 'bg-green-500' : 'bg-red-500'}"></span>
              <span class="text-sm font-semibold capitalize">{status.systemHealth.ollama}</span>
            </div>
          </div>
          <div>
            <div class="text-xs uppercase tracking-wide muted mb-1">Audit Log</div>
            <div class="text-sm font-semibold">{formatBytes(status.systemHealth.auditLogSize)}</div>
          </div>
          <div>
            <div class="text-xs uppercase tracking-wide muted mb-1">Storage Used</div>
            <div class="text-sm font-semibold">{formatBytes(status.systemHealth.storageUsed)}</div>
          </div>
        </div>
      </section>
    {/if}

    <!-- Memory System Stats -->
    {#if status.memoryStats}
      <section class="card p-6">
        <h3 class="text-lg font-semibold mb-4">Memory System</h3>
        <div class="grid gap-6 sm:grid-cols-2">
          <div>
            <div class="text-xs uppercase tracking-wide muted mb-3">Index Status</div>
            <div class="space-y-2">
              <div class="flex justify-between text-sm">
                <span class="muted">Total Files</span>
                <span class="font-semibold">{status.memoryStats.totalFiles}</span>
              </div>
              <div class="flex justify-between text-sm">
                <span class="muted">Indexed</span>
                <span class="font-semibold">{status.memoryStats.totalIndexed}</span>
              </div>
              <div class="flex justify-between text-sm">
                <span class="muted">Status</span>
                <span class="font-semibold {status.memoryStats.indexAvailable ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}">
                  {status.memoryStats.indexAvailable ? 'Available' : 'Missing'}
                </span>
              </div>
              {#if status.memoryStats.lastIndexed}
                <div class="flex justify-between text-sm">
                  <span class="muted">Last Indexed</span>
                  <span class="font-semibold">{formatTimestamp(status.memoryStats.lastIndexed)}</span>
                </div>
              {/if}
              {#if status.memoryStats.lastCapture}
                <div class="flex justify-between text-sm">
                  <span class="muted">Last Capture</span>
                  <span class="font-semibold">{formatTimestamp(status.memoryStats.lastCapture)}</span>
                </div>
              {/if}
            </div>
          </div>
          <div>
            <div class="text-xs uppercase tracking-wide muted mb-3">Memory Categories</div>
            <div class="space-y-3">
              {#if status.memoryStats.byCategory}
                {#each Object.entries(status.memoryStats.byCategory).filter(([_, count]) => count > 0).sort((a, b) => b[1] - a[1]) as [category, count]}
                  <div class="space-y-1">
                    <div class="flex justify-between text-sm">
                      <span class="muted capitalize">{category}</span>
                      <span class="font-semibold">{count} <span class="text-xs muted">({status.memoryStats.percentages?.[category] || 0}%)</span></span>
                    </div>
                    <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
                      <div
                        class="bg-blue-500 dark:bg-blue-400 h-1.5 rounded-full transition-all duration-300"
                        style="width: {status.memoryStats.percentages?.[category] || 0}%"
                      ></div>
                    </div>
                  </div>
                {/each}
              {:else}
                <!-- Fallback to legacy byType if byCategory not available -->
                {#each Object.entries(status.memoryStats.byType) as [type, count]}
                  <div class="flex justify-between text-sm">
                    <span class="muted capitalize">{type}</span>
                    <span class="font-semibold">{count}</span>
                  </div>
                {/each}
              {/if}
            </div>
          </div>
        </div>
      </section>
    {/if}

    <!-- Agent Activity -->
    {#if status.agentActivity}
      <section class="card p-6">
        <h3 class="text-lg font-semibold mb-4">Agent Activity</h3>
        {#if status.agentActivity.processing}
          <div class="mb-4 p-3 rounded bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800">
            <div class="flex items-center gap-2">
              <div class="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></div>
              <span class="text-sm font-semibold">{status.agentActivity.processing.agent}</span>
              <span class="text-xs muted">- {status.agentActivity.processing.status}</span>
            </div>
          </div>
        {/if}
        <div class="grid gap-3 sm:grid-cols-2">
          {#each status.agentActivity.available as agent}
            <div class="p-3 rounded bg-gray-50 dark:bg-gray-800/50">
              <div class="flex justify-between items-start mb-1">
                <span class="text-sm font-semibold">{agent.name}</span>
                <span class="text-xs px-2 py-0.5 rounded-full bg-gray-200 dark:bg-gray-700">
                  {agent.runCount} runs
                </span>
              </div>
              <div class="text-xs muted">
                Last: {formatTimestamp(agent.lastRun)}
              </div>
            </div>
          {/each}
        </div>
      </section>
    {/if}

    <!-- Stats Grid -->
    <div class="grid gap-4 sm:grid-cols-3">
      <div class="card p-6">
        <div class="text-xs uppercase tracking-wide muted mb-2">Active Tasks</div>
        <div class="text-3xl font-bold">{status.tasks.active}</div>
        <div class="mt-3 space-y-1 text-sm">
          <div class="flex justify-between">
            <span class="muted">Todo</span>
            <span class="font-semibold">{status.tasks.byStatus.todo}</span>
          </div>
          <div class="flex justify-between">
            <span class="muted">In Progress</span>
            <span class="font-semibold text-blue-600 dark:text-blue-400">{status.tasks.byStatus.in_progress}</span>
          </div>
          <div class="flex justify-between">
            <span class="muted">Blocked</span>
            <span class="font-semibold text-red-600 dark:text-red-400">{status.tasks.byStatus.blocked}</span>
          </div>
        </div>
      </div>

      <div class="card p-6">
        <div class="text-xs uppercase tracking-wide muted mb-2">Core Values</div>
        <div class="space-y-2 mt-3">
          {#each status.values as v}
            <div>
              <div class="text-sm font-semibold">{v.priority}. {v.value}</div>
              <div class="text-xs muted">{v.description}</div>
            </div>
          {/each}
        </div>
      </div>

      <div class="card p-6">
        <div class="text-xs uppercase tracking-wide muted mb-2">Current Goals</div>
        <div class="space-y-2 mt-3">
          {#each status.goals as g}
            <div>
              <div class="text-sm font-semibold">{g.goal}</div>
              <div class="text-xs muted">
                <span class="inline-block px-2 py-0.5 rounded-full bg-gray-200 dark:bg-gray-700">
                  {g.status}
                </span>
              </div>
            </div>
          {/each}
        </div>
      </div>
    </div>

    <!-- Recent Activity -->
    {#if status.recentActivity && status.recentActivity.length > 0}
      <section class="card p-6">
        <h3 class="text-lg font-semibold mb-4">Recent Activity</h3>
        <div class="space-y-3">
          {#each status.recentActivity as activity}
            <div class="p-3 rounded bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
              <div class="flex justify-between items-start mb-1">
                <span class="text-xs px-2 py-0.5 rounded-full bg-gray-200 dark:bg-gray-700 capitalize">
                  {activity.type}
                </span>
                <span class="text-xs muted">{formatTimestamp(activity.timestamp)}</span>
              </div>
              <p class="text-sm mt-2">{activity.content}</p>
            </div>
          {/each}
        </div>
      </section>
    {/if}

    <!-- Model Configuration -->
    {#if status.modelRoles && Object.keys(status.modelRoles).length > 0}
      <section class="card p-6">
        <h3 class="text-lg font-semibold mb-4">Model Configuration</h3>
        <div class="space-y-2">
          {#each Object.entries(status.modelRoles) as [role, config]}
            <div class="flex justify-between items-start text-sm p-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800/50">
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
      </section>
    {/if}

    <div class="text-xs muted text-center">
      Last updated: {new Date(status.lastUpdated).toLocaleString()}
    </div>
  </div>
{/if}
