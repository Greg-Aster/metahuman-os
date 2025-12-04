<script lang="ts">
  import { onMount } from 'svelte';
  import { auditDataStore, auditLoadingStore, auditErrorStore, type AuditEntry, type AuditResponse } from '../stores/audit';
  import { apiFetch } from '../lib/client/api-config';

  let selectedCategory: string = 'all';
  let selectedLevel: string = 'all';

  async function loadAudit() {
    try {
      const res = await apiFetch('/api/audit');
      if (!res.ok) throw new Error('Failed to load audit log');
      const data = await res.json();
      auditDataStore.set(data);
      auditLoadingStore.set(false);
      auditErrorStore.set('');
    } catch (e) {
      auditErrorStore.set((e as Error).message);
      auditLoadingStore.set(false);
    }
  }

  function getLevelColor(level: string) {
    switch (level) {
      case 'info': return 'text-blue-600 dark:text-blue-400';
      case 'warn': return 'text-yellow-600 dark:text-yellow-400';
      case 'error': return 'text-red-600 dark:text-red-400';
      case 'critical': return 'text-red-800 dark:text-red-200 font-bold';
      default: return 'text-gray-600 dark:text-gray-400';
    }
  }

  function getCategoryColor(category: string) {
    switch (category) {
      case 'system': return 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200';
      case 'decision': return 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200';
      case 'action': return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
      case 'security': return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
      case 'data': return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
      default: return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200';
    }
  }

  $: filteredEntries = $auditDataStore?.entries.filter(e => {
    if (selectedCategory !== 'all' && e.category !== selectedCategory) return false;
    if (selectedLevel !== 'all' && e.level !== selectedLevel) return false;
    return true;
  }) || [];

  function handleVisibilityChange() {
    if (!document.hidden) {
      loadAudit();
    }
  }

  onMount(() => {
    // Load on mount
    loadAudit();

    // Refresh when tab becomes visible (no polling!)
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  });

  // --- Live Pipeline Derivation ---
  type StageStatus = 'idle' | 'in_progress' | 'completed' | 'failed'

  function findLatest(eventNames: string[]): AuditEntry | null {
    if (!$auditDataStore?.entries) return null
    for (let i = $auditDataStore.entries.length - 1; i >= 0; i--) {
      const e = $auditDataStore.entries[i]
      if (eventNames.includes(e.event)) return e
    }
    return null
  }

  function deriveStatus(startEvents: string[], completeEvents: string[], failEvents: string[]): StageStatus {
    const started = findLatest(startEvents)
    const completed = findLatest(completeEvents)
    const failed = findLatest(failEvents)
    // Compare timestamps if multiple exist
    const tStart = started ? new Date(started.timestamp).getTime() : -1
    const tDone = completed ? new Date(completed.timestamp).getTime() : -1
    const tFail = failed ? new Date(failed.timestamp).getTime() : -1
    const latest = Math.max(tStart, tDone, tFail)
    if (latest === -1) return 'idle'
    if (latest === tFail) return 'failed'
    if (latest === tDone) return 'completed'
    return 'in_progress'
  }

  $: loraStages = {
    builder: deriveStatus(
      ['adapter_builder_started', 'lora_orchestration_started'],
      ['adapter_builder_completed', 'lora_dataset_ready'],
      ['adapter_builder_failed', 'lora_dataset_failed']
    ),
    approval: deriveStatus(
      ['lora_dataset_ready'],
      ['lora_dataset_auto_approve', 'lora_dataset_approved', 'lora_dataset_auto_approved', 'lora_dataset_approved'],
      ['lora_dataset_auto_reject']
    ),
    training: deriveStatus(
      ['lora_training_started', 'adapter_training_queued'],
      ['lora_training_completed'],
      ['lora_training_failed']
    ),
    evaluation: deriveStatus(
      ['adapter_evaluation_started', 'adapter_evaluation_queued'],
      ['adapter_evaluation_completed'],
      ['adapter_evaluation_failed']
    ),
    activation: deriveStatus(
      ['adapter_activation_requested'],
      ['lora_adapter_activated', 'adapter_activated'],
      []
    ),
  }
</script>

<div class="space-y-4">
  <div class="flex items-center justify-between">
    <h2 class="text-xl font-semibold">Audit Log</h2>
    {#if $auditDataStore}
      <div class="text-sm muted">
        {$auditDataStore.date} · {filteredEntries.length} entries
      </div>
    {/if}
  </div>

  <!-- Live Pipeline Overview -->
  <div class="card p-3">
    <div class="text-sm font-semibold mb-2">LoRA Pipeline</div>
    <div class="stages">
      <div class="stage">
        <div class={"dot " + loraStages.builder}></div>
        <div class="label">Builder</div>
      </div>
      <div class="chev">→</div>
      <div class="stage">
        <div class={"dot " + loraStages.approval}></div>
        <div class="label">Approval</div>
      </div>
      <div class="chev">→</div>
      <div class="stage">
        <div class={"dot " + loraStages.training}></div>
        <div class="label">Training</div>
      </div>
      <div class="chev">→</div>
      <div class="stage">
        <div class={"dot " + loraStages.evaluation}></div>
        <div class="label">Evaluation</div>
      </div>
      <div class="chev">→</div>
      <div class="stage">
        <div class={"dot " + loraStages.activation}></div>
        <div class="label">Activation</div>
      </div>
    </div>
  </div>

  {#if $auditLoadingStore}
    <div class="card p-6 animate-pulse">
      <div class="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/2"></div>
    </div>
  {:else if $auditErrorStore}
    <div class="card p-6 border-red-500">
      <p class="text-red-600 dark:text-red-400">{$auditErrorStore}</p>
    </div>
  {:else if $auditDataStore}
    <!-- Summary -->
    <div class="grid gap-3 sm:grid-cols-5 text-sm">
      <div class="card p-3">
        <div class="text-xs muted uppercase">Total</div>
        <div class="text-2xl font-bold mt-1">{$auditDataStore.summary.total}</div>
      </div>
      <div class="card p-3">
        <div class="text-xs muted uppercase">Info</div>
        <div class="text-2xl font-bold mt-1 text-blue-600">{$auditDataStore.summary.byLevel.info || 0}</div>
      </div>
      <div class="card p-3">
        <div class="text-xs muted uppercase">Warnings</div>
        <div class="text-2xl font-bold mt-1 text-yellow-600">{$auditDataStore.summary.byLevel.warn || 0}</div>
      </div>
      <div class="card p-3">
        <div class="text-xs muted uppercase">Errors</div>
        <div class="text-2xl font-bold mt-1 text-red-600">{$auditDataStore.summary.byLevel.error || 0}</div>
      </div>
      <div class="card p-3">
        <div class="text-xs muted uppercase">Critical</div>
        <div class="text-2xl font-bold mt-1 text-red-800">{$auditDataStore.summary.byLevel.critical || 0}</div>
      </div>
    </div>

    <!-- Filters -->
    <div class="flex gap-3 flex-wrap">
      <div>
        <label class="text-xs uppercase muted">Category</label>
        <select
          bind:value={selectedCategory}
          class="block mt-1 px-3 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
        >
          <option value="all">All</option>
          <option value="system">System</option>
          <option value="decision">Decision</option>
          <option value="action">Action</option>
          <option value="security">Security</option>
          <option value="data">Data</option>
        </select>
      </div>

      <div>
        <label class="text-xs uppercase muted">Level</label>
        <select
          bind:value={selectedLevel}
          class="block mt-1 px-3 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
        >
          <option value="all">All</option>
          <option value="info">Info</option>
          <option value="warn">Warn</option>
          <option value="error">Error</option>
          <option value="critical">Critical</option>
        </select>
      </div>
    </div>

    <!-- Entries -->
    <div class="space-y-2 max-h-[600px] overflow-y-auto">
      {#each filteredEntries.slice().reverse() as entry (entry.timestamp)}
        <div class="card p-3 text-sm">
          <div class="flex items-start justify-between gap-3">
            <div class="flex-1">
              <div class="flex items-center gap-2 mb-1">
                <span class="text-xs px-2 py-0.5 rounded-full font-semibold {getCategoryColor(entry.category)}">
                  {entry.category}
                </span>
                <span class="text-xs font-mono {getLevelColor(entry.level)}">
                  {entry.level.toUpperCase()}
                </span>
                {#if entry.actor}
                  <span class="text-xs muted">by {entry.actor}</span>
                {/if}
              </div>
              <div class="font-semibold">{entry.event}</div>
              {#if entry.details}
                <details class="mt-2">
                  <summary class="cursor-pointer text-xs muted hover:text-brand">Show details</summary>
                  <pre class="mt-2 text-xs bg-gray-100 dark:bg-gray-800 p-2 rounded overflow-x-auto">{JSON.stringify(entry.details, null, 2)}</pre>
                </details>
              {/if}
            </div>
            <div class="text-xs muted text-right whitespace-nowrap">
              {new Date(entry.timestamp).toLocaleTimeString()}
            </div>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .stages {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }
  .stage { display: flex; align-items: center; gap: 0.4rem; }
  .label { font-size: 0.8rem; color: rgb(75 85 99); }
  :global(.dark) .label { color: rgb(156 163 175); }
  .chev { color: rgb(156 163 175); }
  .dot { width: 10px; height: 10px; border-radius: 999px; background: rgb(209 213 219); position: relative; }
  .dot.in_progress { background: rgb(59 130 246); }
  .dot.in_progress::after {
    content: '';
    position: absolute;
    inset: -4px;
    border-radius: 999px;
    border: 2px solid rgba(59,130,246,0.25);
    animation: pulse 1s infinite ease-in-out;
  }
  .dot.completed { background: rgb(34 197 94); }
  .dot.failed { background: rgb(239 68 68); }
  .dot.idle { background: rgb(209 213 219); }
  @keyframes pulse { 0% { transform: scale(0.9); opacity: 0.8 } 50% { transform: scale(1.1); opacity: 0.3 } 100% { transform: scale(0.9); opacity: 0.8 } }
</style>
