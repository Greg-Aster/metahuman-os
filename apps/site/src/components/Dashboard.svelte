<script lang="ts">
  import { onMount } from 'svelte';

  interface SystemStatus {
    identity: {
      name: string;
      role: string;
      trustLevel: string;
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
  }

  let status: SystemStatus | null = null;
  let loading = true;
  let error = '';

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
        </div>
        <div class="text-right">
          <div class="text-xs uppercase tracking-wide muted">Trust Level</div>
          <div class="text-lg font-semibold mt-1 px-3 py-1 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 inline-block">
            {status.identity.trustLevel}
          </div>
        </div>
      </div>
    </section>

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

    <div class="text-xs muted text-center">
      Last updated: {new Date(status.lastUpdated).toLocaleString()}
    </div>
  </div>
{/if}
