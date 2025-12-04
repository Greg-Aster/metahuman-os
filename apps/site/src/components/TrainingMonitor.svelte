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

<div class="training-monitor">
  {#if loading}
    <div class="loading-state">Loading training operations...</div>
  {:else if error}
    <div class="error-state">Error: {error}</div>
  {:else if operations.length === 0}
    <div class="empty-state">
      <div class="empty-icon">🔥</div>
      <div class="empty-title">No training operations found</div>
      <div class="empty-description">Training runs will appear here when started</div>
    </div>
  {:else}
    <div class="monitor-layout">
      <!-- Operations List -->
      <div class="operations-list">
        <div class="operations-header">
          <h3>Recent Operations</h3>
          <button on:click={loadOperations} class="refresh-btn-small">↻</button>
        </div>
        {#each operations as op}
          <button
            class="operation-item"
            class:active={selectedOperation?.operation === op.operation}
            on:click={() => loadOperationDetails(op.operation)}
          >
            <div class="op-name">{op.operation}</div>
            <div class="op-status {getStatusColor(op.overallStatus)}">
              {op.overallStatus}
            </div>
            <div class="op-progress">{op.overallProgress}%</div>
          </button>
        {/each}
      </div>

      <!-- Operation Details -->
      {#if selectedOperation}
        <div class="operation-details">
          <!-- Status Header -->
          <div class="details-header">
            <h2>{selectedOperation.operation}</h2>
            <div class="status-badge {getStatusColor(selectedOperation.overallStatus)}">
              {selectedOperation.overallStatus.toUpperCase()}
            </div>
          </div>

          <!-- Hung Process Warning -->
          {#if selectedOperation.isHung}
            <div class="warning-banner">
              ⚠️ No heartbeat for over 2 minutes - process may be stuck!
            </div>
          {/if}

          <!-- Metadata -->
          {#if selectedOperation.metadata}
            <div class="metadata">
              {#if selectedOperation.metadata.model}
                <div class="meta-item">
                  <span class="meta-label">Model:</span>
                  <span class="meta-value">{selectedOperation.metadata.model}</span>
                </div>
              {/if}
              {#if selectedOperation.metadata.samples}
                <div class="meta-item">
                  <span class="meta-label">Samples:</span>
                  <span class="meta-value">{selectedOperation.metadata.samples}</span>
                </div>
              {/if}
              {#if selectedOperation.metadata.pod_id}
                <div class="meta-item">
                  <span class="meta-label">Pod ID:</span>
                  <span class="meta-value mono">{selectedOperation.metadata.pod_id}</span>
                </div>
              {/if}
              {#if selectedOperation.elapsedSeconds !== undefined}
                <div class="meta-item">
                  <span class="meta-label">Elapsed:</span>
                  <span class="meta-value">{formatElapsedTime(selectedOperation.elapsedSeconds)}</span>
                </div>
              {/if}
            </div>
          {/if}

          <!-- Overall Progress -->
          <div class="overall-progress">
            <div class="progress-header">
              <span>Overall Progress</span>
              <span class="progress-percent">{selectedOperation.overallProgress}%</span>
            </div>
            <div class="progress-bar">
              <div
                class="progress-fill"
                style="width: {selectedOperation.overallProgress}%"
              ></div>
            </div>
          </div>

          <!-- Stage Details -->
          <div class="stages">
            <h3>Stages</h3>
            {#each selectedOperation.stages as stage}
              <div class="stage-item" class:stage-active={stage.status === 'in_progress'}>
                <div class="stage-header">
                  <span class="stage-icon">{getStageIcon(stage.status)}</span>
                  <span class="stage-name">{stage.name}</span>
                  <span class="stage-percent">{stage.progress}%</span>
                </div>
                {#if stage.message}
                  <div class="stage-message">{stage.message}</div>
                {/if}
                <div class="stage-progress-bar">
                  <div
                    class="stage-progress-fill stage-{stage.status}"
                    style="width: {stage.progress}%"
                  ></div>
                </div>
              </div>
            {/each}
          </div>

          <!-- Last Heartbeat -->
          <div class="heartbeat">
            Last heartbeat: {new Date(selectedOperation.lastHeartbeat).toLocaleString()}
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .training-monitor {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .loading-state,
  .error-state,
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: rgb(107 114 128);
  }

  :global(.dark) .loading-state,
  :global(.dark) .error-state,
  :global(.dark) .empty-state {
    color: rgb(156 163 175);
  }

  .error-state {
    color: rgb(220 38 38);
  }

  :global(.dark) .error-state {
    color: rgb(248 113 113);
  }

  .empty-icon {
    font-size: 4rem;
    margin-bottom: 1rem;
    opacity: 0.5;
  }

  .empty-title {
    font-size: 1.25rem;
    font-weight: 600;
    margin-bottom: 0.5rem;
    color: rgb(17 24 39);
  }

  :global(.dark) .empty-title {
    color: rgb(243 244 246);
  }

  .empty-description {
    font-size: 0.875rem;
  }

  .monitor-layout {
    display: grid;
    grid-template-columns: 280px 1fr;
    gap: 1.5rem;
    height: 100%;
    overflow: hidden;
  }

  /* Operations List */
  .operations-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    overflow-y: auto;
    padding: 1rem;
    background: white;
    border-radius: 0.5rem;
    border: 1px solid rgba(0, 0, 0, 0.1);
  }

  :global(.dark) .operations-list {
    background: rgba(255, 255, 255, 0.05);
    border-color: rgba(255, 255, 255, 0.1);
  }

  .operations-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.5rem;
  }

  .operations-header h3 {
    font-size: 0.875rem;
    font-weight: 600;
    text-transform: uppercase;
    color: rgb(107 114 128);
    margin: 0;
  }

  :global(.dark) .operations-header h3 {
    color: rgb(156 163 175);
  }

  .refresh-btn-small {
    background: none;
    border: none;
    font-size: 1.25rem;
    cursor: pointer;
    color: rgb(107 114 128);
    padding: 0.25rem;
  }

  :global(.dark) .refresh-btn-small {
    color: rgb(156 163 175);
  }

  .refresh-btn-small:hover {
    color: rgb(124 58 237);
  }

  :global(.dark) .refresh-btn-small:hover {
    color: rgb(167 139 250);
  }

  .operation-item {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.75rem;
    background: transparent;
    border: 1px solid rgba(0, 0, 0, 0.1);
    border-radius: 0.375rem;
    cursor: pointer;
    text-align: left;
    transition: all 0.2s;
  }

  :global(.dark) .operation-item {
    border-color: rgba(255, 255, 255, 0.1);
  }

  .operation-item:hover {
    background: rgba(0, 0, 0, 0.05);
  }

  :global(.dark) .operation-item:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  .operation-item.active {
    background: rgb(124 58 237);
    color: white;
    border-color: rgb(124 58 237);
  }

  :global(.dark) .operation-item.active {
    background: rgb(167 139 250);
    color: rgb(17 24 39);
  }

  .op-name {
    font-size: 0.875rem;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .op-status {
    font-size: 0.75rem;
    text-transform: uppercase;
    font-weight: 600;
  }

  .status-running {
    color: rgb(59 130 246);
  }

  :global(.dark) .status-running {
    color: rgb(96 165 250);
  }

  .status-completed {
    color: rgb(34 197 94);
  }

  :global(.dark) .status-completed {
    color: rgb(74 222 128);
  }

  .status-failed {
    color: rgb(239 68 68);
  }

  :global(.dark) .status-failed {
    color: rgb(248 113 113);
  }

  .op-progress {
    font-size: 0.75rem;
    font-weight: 600;
  }

  /* Operation Details */
  .operation-details {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    overflow-y: auto;
    padding: 1.5rem;
    background: white;
    border-radius: 0.5rem;
    border: 1px solid rgba(0, 0, 0, 0.1);
  }

  :global(.dark) .operation-details {
    background: rgba(255, 255, 255, 0.05);
    border-color: rgba(255, 255, 255, 0.1);
  }

  .details-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .details-header h2 {
    font-size: 1.25rem;
    font-weight: 600;
    margin: 0;
    color: rgb(17 24 39);
  }

  :global(.dark) .details-header h2 {
    color: rgb(243 244 246);
  }

  .status-badge {
    padding: 0.25rem 0.75rem;
    border-radius: 9999px;
    font-size: 0.75rem;
    font-weight: 600;
  }

  .warning-banner {
    padding: 1rem;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: 0.5rem;
    color: rgb(220 38 38);
    font-weight: 500;
  }

  :global(.dark) .warning-banner {
    background: rgba(239, 68, 68, 0.2);
    color: rgb(248 113 113);
  }

  /* Metadata */
  .metadata {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1rem;
  }

  .meta-item {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .meta-label {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    color: rgb(107 114 128);
  }

  :global(.dark) .meta-label {
    color: rgb(156 163 175);
  }

  .meta-value {
    font-size: 0.875rem;
    font-weight: 500;
    color: rgb(17 24 39);
  }

  :global(.dark) .meta-value {
    color: rgb(243 244 246);
  }

  .mono {
    font-family: monospace;
  }

  /* Progress Bars */
  .overall-progress {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .progress-header {
    display: flex;
    justify-content: space-between;
    font-size: 0.875rem;
    font-weight: 600;
    color: rgb(17 24 39);
  }

  :global(.dark) .progress-header {
    color: rgb(243 244 246);
  }

  .progress-bar {
    height: 1.5rem;
    background: rgba(0, 0, 0, 0.05);
    border-radius: 0.75rem;
    overflow: hidden;
  }

  :global(.dark) .progress-bar {
    background: rgba(255, 255, 255, 0.05);
  }

  .progress-fill {
    height: 100%;
    background: rgb(124 58 237);
    transition: width 0.3s ease;
  }

  :global(.dark) .progress-fill {
    background: rgb(167 139 250);
  }

  /* Stages */
  .stages h3 {
    font-size: 1rem;
    font-weight: 600;
    margin: 0 0 1rem 0;
    color: rgb(17 24 39);
  }

  :global(.dark) .stages h3 {
    color: rgb(243 244 246);
  }

  .stage-item {
    padding: 1rem;
    border: 1px solid rgba(0, 0, 0, 0.1);
    border-radius: 0.5rem;
    margin-bottom: 0.75rem;
  }

  :global(.dark) .stage-item {
    border-color: rgba(255, 255, 255, 0.1);
  }

  .stage-item.stage-active {
    border-color: rgb(124 58 237);
    background: rgba(124, 58, 237, 0.05);
  }

  :global(.dark) .stage-item.stage-active {
    border-color: rgb(167 139 250);
    background: rgba(167, 139, 250, 0.05);
  }

  .stage-header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 0.5rem;
  }

  .stage-icon {
    font-size: 1.25rem;
  }

  .stage-name {
    flex: 1;
    font-weight: 500;
    text-transform: capitalize;
    color: rgb(17 24 39);
  }

  :global(.dark) .stage-name {
    color: rgb(243 244 246);
  }

  .stage-percent {
    font-size: 0.875rem;
    font-weight: 600;
    color: rgb(107 114 128);
  }

  :global(.dark) .stage-percent {
    color: rgb(156 163 175);
  }

  .stage-message {
    font-size: 0.875rem;
    color: rgb(107 114 128);
    margin: 0.5rem 0;
  }

  :global(.dark) .stage-message {
    color: rgb(156 163 175);
  }

  .stage-progress-bar {
    height: 0.5rem;
    background: rgba(0, 0, 0, 0.05);
    border-radius: 0.25rem;
    overflow: hidden;
  }

  :global(.dark) .stage-progress-bar {
    background: rgba(255, 255, 255, 0.05);
  }

  .stage-progress-fill {
    height: 100%;
    transition: width 0.3s ease;
  }

  .stage-progress-fill.stage-pending {
    background: rgb(156 163 175);
    opacity: 0.3;
  }

  .stage-progress-fill.stage-in_progress {
    background: rgb(59 130 246);
  }

  .stage-progress-fill.stage-completed {
    background: rgb(34 197 94);
  }

  .stage-progress-fill.stage-failed {
    background: rgb(239 68 68);
  }

  .heartbeat {
    font-size: 0.75rem;
    color: rgb(107 114 128);
    text-align: right;
  }

  :global(.dark) .heartbeat {
    color: rgb(156 163 175);
  }
</style>
