<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { apiFetch } from '../lib/client/api-config';

  interface TrainingStage {
    name: string;
    status: 'pending' | 'in_progress' | 'completed' | 'failed';
    progress: number;
    message?: string;
  }

  interface TrainingOperation {
    operation: string;
    overallStatus: 'running' | 'completed' | 'failed';
    overallProgress: number;
    currentStage: string;
    stages: TrainingStage[];
    lastHeartbeat: string;
    isHung?: boolean;
    elapsedSeconds?: number;
    metadata?: {
      pod_id?: string;
      model?: string;
      samples?: number;
    };
  }

  let operations: TrainingOperation[] = [];
  let selectedOperation: TrainingOperation | null = null;
  let loading = true;
  let error = '';
  let pollInterval: ReturnType<typeof setInterval>;

  async function loadOperations() {
    try {
      const res = await apiFetch('/api/training/status');
      if (!res.ok) throw new Error('Failed to load training operations');
      const data = await res.json();
      operations = data.operations;

      // Auto-select first running operation
      if (!selectedOperation && operations.length > 0) {
        selectedOperation = operations.find(op => op.overallStatus === 'running') || operations[0];
      }

      loading = false;
    } catch (e) {
      error = (e as Error).message;
      loading = false;
    }
  }

  async function loadOperationDetails(operationId: string) {
    try {
      const res = await apiFetch(`/api/training/${operationId}`);
      if (!res.ok) throw new Error('Failed to load operation details');
      const data = await res.json();
      selectedOperation = data;

      // Update in operations list
      const index = operations.findIndex(op => op.operation === operationId);
      if (index !== -1) {
        operations[index] = data;
      }
    } catch (e) {
      console.error('Failed to load operation details:', e);
    }
  }

  function formatElapsedTime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hours > 0) return `${hours}h ${minutes}m ${secs}s`;
    if (minutes > 0) return `${minutes}m ${secs}s`;
    return `${secs}s`;
  }

  function getStatusColor(status: string): string {
    switch (status) {
      case 'running': return 'status-running';
      case 'completed': return 'status-completed';
      case 'failed': return 'status-failed';
      default: return 'status-default';
    }
  }

  function getStageIcon(status: string): string {
    switch (status) {
      case 'completed': return '✅';
      case 'in_progress': return '🔄';
      case 'failed': return '❌';
      default: return '⏳';
    }
  }

  onMount(() => {
    loadOperations();
    // Poll every 5 seconds
    pollInterval = setInterval(() => {
      loadOperations();
      if (selectedOperation) {
        loadOperationDetails(selectedOperation.operation);
      }
    }, 5000);
  });

  onDestroy(() => {
    if (pollInterval) clearInterval(pollInterval);
  });
</script>

<div class="flex flex-col h-full">
  {#if loading}
    <div class="flex flex-col items-center justify-center h-full text-gray-500 dark:text-gray-400">Loading training operations...</div>
  {:else if error}
    <div class="flex flex-col items-center justify-center h-full text-red-600 dark:text-red-400">Error: {error}</div>
  {:else if operations.length === 0}
    <div class="flex flex-col items-center justify-center h-full text-gray-500 dark:text-gray-400">
      <div class="text-6xl mb-4 opacity-50">🔥</div>
      <div class="text-xl font-semibold mb-2 text-gray-900 dark:text-gray-100">No training operations found</div>
      <div class="text-sm">Training runs will appear here when started</div>
    </div>
  {:else}
    <div class="grid grid-cols-[280px_1fr] gap-6 h-full overflow-hidden">
      <!-- Operations List -->
      <div class="flex flex-col gap-2 overflow-y-auto p-4 bg-white dark:bg-white/5 rounded-lg border border-black/10 dark:border-white/10">
        <div class="flex justify-between items-center mb-2">
          <h3 class="text-sm font-semibold uppercase text-gray-500 dark:text-gray-400">Recent Operations</h3>
          <button on:click={loadOperations} class="bg-transparent border-none text-xl cursor-pointer text-gray-500 dark:text-gray-400 p-1 hover:text-violet-600 dark:hover:text-violet-400">↻</button>
        </div>
        {#each operations as op}
          <button
            class="flex flex-col gap-1 p-3 bg-transparent border border-black/10 dark:border-white/10 rounded-md cursor-pointer text-left transition-all hover:bg-black/5 dark:hover:bg-white/5 {selectedOperation?.operation === op.operation ? 'bg-violet-600 dark:bg-violet-400 text-white dark:text-gray-900 border-violet-600 dark:border-violet-400' : ''}"
            on:click={() => loadOperationDetails(op.operation)}
          >
            <div class="text-sm font-medium whitespace-nowrap overflow-hidden text-ellipsis">{op.operation}</div>
            <div class="text-xs uppercase font-semibold {op.overallStatus === 'running' ? 'text-blue-500 dark:text-blue-400' : op.overallStatus === 'completed' ? 'text-green-500 dark:text-green-400' : op.overallStatus === 'failed' ? 'text-red-500 dark:text-red-400' : ''}">
              {op.overallStatus}
            </div>
            <div class="text-xs font-semibold">{op.overallProgress}%</div>
          </button>
        {/each}
      </div>

      <!-- Operation Details -->
      {#if selectedOperation}
        <div class="flex flex-col gap-6 overflow-y-auto p-6 bg-white dark:bg-white/5 rounded-lg border border-black/10 dark:border-white/10">
          <!-- Status Header -->
          <div class="flex justify-between items-center">
            <h2 class="text-xl font-semibold text-gray-900 dark:text-gray-100">{selectedOperation.operation}</h2>
            <div class="px-3 py-1 rounded-full text-xs font-semibold {selectedOperation.overallStatus === 'running' ? 'text-blue-500 dark:text-blue-400 bg-blue-500/10' : selectedOperation.overallStatus === 'completed' ? 'text-green-500 dark:text-green-400 bg-green-500/10' : selectedOperation.overallStatus === 'failed' ? 'text-red-500 dark:text-red-400 bg-red-500/10' : 'bg-gray-500/10'}">
              {selectedOperation.overallStatus.toUpperCase()}
            </div>
          </div>

          <!-- Hung Process Warning -->
          {#if selectedOperation.isHung}
            <div class="p-4 bg-red-500/10 dark:bg-red-500/20 border border-red-500/30 rounded-lg text-red-600 dark:text-red-400 font-medium">
              ⚠️ No heartbeat for over 2 minutes - process may be stuck!
            </div>
          {/if}

          <!-- Metadata -->
          {#if selectedOperation.metadata}
            <div class="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
              {#if selectedOperation.metadata.model}
                <div class="flex flex-col gap-1">
                  <span class="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Model:</span>
                  <span class="text-sm font-medium text-gray-900 dark:text-gray-100">{selectedOperation.metadata.model}</span>
                </div>
              {/if}
              {#if selectedOperation.metadata.samples}
                <div class="flex flex-col gap-1">
                  <span class="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Samples:</span>
                  <span class="text-sm font-medium text-gray-900 dark:text-gray-100">{selectedOperation.metadata.samples}</span>
                </div>
              {/if}
              {#if selectedOperation.metadata.pod_id}
                <div class="flex flex-col gap-1">
                  <span class="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Pod ID:</span>
                  <span class="text-sm font-medium text-gray-900 dark:text-gray-100 font-mono">{selectedOperation.metadata.pod_id}</span>
                </div>
              {/if}
              {#if selectedOperation.elapsedSeconds !== undefined}
                <div class="flex flex-col gap-1">
                  <span class="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Elapsed:</span>
                  <span class="text-sm font-medium text-gray-900 dark:text-gray-100">{formatElapsedTime(selectedOperation.elapsedSeconds)}</span>
                </div>
              {/if}
            </div>
          {/if}

          <!-- Overall Progress -->
          <div class="flex flex-col gap-2">
            <div class="flex justify-between text-sm font-semibold text-gray-900 dark:text-gray-100">
              <span>Overall Progress</span>
              <span>{selectedOperation.overallProgress}%</span>
            </div>
            <div class="h-6 bg-black/5 dark:bg-white/5 rounded-xl overflow-hidden">
              <div
                class="h-full bg-violet-600 dark:bg-violet-400 transition-all duration-300"
                style="width: {selectedOperation.overallProgress}%"
              ></div>
            </div>
          </div>

          <!-- Stage Details -->
          <div>
            <h3 class="text-base font-semibold mb-4 text-gray-900 dark:text-gray-100">Stages</h3>
            {#each selectedOperation.stages as stage}
              <div class="p-4 border border-black/10 dark:border-white/10 rounded-lg mb-3 {stage.status === 'in_progress' ? 'border-violet-600 dark:border-violet-400 bg-violet-600/5 dark:bg-violet-400/5' : ''}">
                <div class="flex items-center gap-3 mb-2">
                  <span class="text-xl">{getStageIcon(stage.status)}</span>
                  <span class="flex-1 font-medium capitalize text-gray-900 dark:text-gray-100">{stage.name}</span>
                  <span class="text-sm font-semibold text-gray-500 dark:text-gray-400">{stage.progress}%</span>
                </div>
                {#if stage.message}
                  <div class="text-sm text-gray-500 dark:text-gray-400 my-2">{stage.message}</div>
                {/if}
                <div class="h-2 bg-black/5 dark:bg-white/5 rounded overflow-hidden">
                  <div
                    class="h-full transition-all duration-300 {stage.status === 'pending' ? 'bg-gray-400 opacity-30' : stage.status === 'in_progress' ? 'bg-blue-500' : stage.status === 'completed' ? 'bg-green-500' : 'bg-red-500'}"
                    style="width: {stage.progress}%"
                  ></div>
                </div>
              </div>
            {/each}
          </div>

          <!-- Last Heartbeat -->
          <div class="text-xs text-gray-500 dark:text-gray-400 text-right">
            Last heartbeat: {new Date(selectedOperation.lastHeartbeat).toLocaleString()}
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>

