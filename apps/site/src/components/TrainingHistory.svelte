<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { apiFetch } from '../lib/client/api-config';

  interface TrainingRun {
    id: string;
    startTime: string;
    endTime?: string;
    status: 'running' | 'completed' | 'failed' | 'cancelled';
    pid?: number;
    method: 'local-lora' | 'remote-lora' | 'fine-tune' | 'full-cycle';
    logFile: string;
    dataset?: string;
    baseModel?: string;
    duration?: string;
    error?: string;
  }

  let currentRun: TrainingRun | null = null;
  let pastRuns: TrainingRun[] = [];
  let loading = true;
  let error = '';

  // Current run monitoring
  let trainingLogs: Array<{ timestamp: string; event: string; details?: any }> = [];
  let consoleLogs: string[] = [];
  let logsInterval: number | null = null;
  let consoleScrollContainer: HTMLDivElement | null = null;
  let eventsScrollContainer: HTMLDivElement | null = null;

  // Expanded run details
  let expandedRunId: string | null = null;
  let expandedLogs: string[] = [];
  let loadingLogs = false;

  async function loadTrainingHistory() {
    loading = true;
    error = '';

    try {
      // Check if training is currently running
      const runningRes = await apiFetch('/api/training/running');
      if (runningRes.ok) {
        const runningData = await runningRes.json();
        if (runningData.success && runningData.running) {
          // Load current run info
          const logsRes = await apiFetch('/api/training/logs?maxLines=1');
          let startTime = new Date().toISOString();
          if (logsRes.ok) {
            const logsData = await logsRes.json();
            if (logsData.success && logsData.logs && logsData.logs.length > 0) {
              startTime = logsData.logs[0].timestamp;
            }
          }

          currentRun = {
            id: `current-${runningData.pid}`,
            startTime,
            status: 'running',
            pid: runningData.pid,
            method: 'full-cycle',
            logFile: 'Current run',
          };

          // Start polling for logs
          startLogsPolling();
        } else {
          currentRun = null;
          stopLogsPolling();
        }
      }

      // Load past runs from audit logs
      const historyRes = await apiFetch('/api/training/history');
      if (historyRes.ok) {
        const historyData = await historyRes.json();
        if (historyData.success) {
          pastRuns = historyData.runs || [];
        }
      }
    } catch (err) {
      console.error('[TrainingHistory] Failed to load:', err);
      error = 'Failed to load training history';
    } finally {
      loading = false;
    }
  }

  async function pollTrainingLogs() {
    if (!currentRun) return;

    try {
      // Load audit events
      const logsRes = await apiFetch('/api/training/logs?maxLines=50');
      if (logsRes.ok) {
        const logsData = await logsRes.json();
        if (logsData.success && logsData.logs) {
          trainingLogs = logsData.logs;
          // Auto-scroll events
          if (eventsScrollContainer) {
            setTimeout(() => {
              if (eventsScrollContainer) {
                eventsScrollContainer.scrollTop = eventsScrollContainer.scrollHeight;
              }
            }, 100);
          }
        }
      }

      // Load console logs
      const consoleRes = await apiFetch('/api/training/console-logs?maxLines=200');
      if (consoleRes.ok) {
        const consoleData = await consoleRes.json();
        if (consoleData.success && consoleData.logs) {
          consoleLogs = consoleData.logs;
          // Auto-scroll console
          if (consoleScrollContainer) {
            setTimeout(() => {
              if (consoleScrollContainer) {
                consoleScrollContainer.scrollTop = consoleScrollContainer.scrollHeight;
              }
            }, 100);
          }
        }
      }

      // Check if process is still running
      const statusRes = await apiFetch('/api/training/running');
      if (statusRes.ok) {
        const statusData = await statusRes.json();
        if (statusData.success && !statusData.running) {
          // Training finished, reload history
          currentRun = null;
          stopLogsPolling();
          await loadTrainingHistory();
        }
      }
    } catch (err) {
      console.warn('[TrainingHistory] Failed to poll logs:', err);
    }
  }

  function startLogsPolling() {
    if (logsInterval) {
      clearInterval(logsInterval);
    }
    pollTrainingLogs();
    logsInterval = window.setInterval(pollTrainingLogs, 5000);
  }

  function stopLogsPolling() {
    if (logsInterval) {
      clearInterval(logsInterval);
      logsInterval = null;
    }
  }

  async function cancelTraining() {
    if (!currentRun) return;

    try {
      const res = await apiFetch('/api/adapters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancelFullCycle' })
      });

      if (!res.ok) throw new Error('Failed to cancel training');

      const data = await res.json();
      if (data.success) {
        currentRun = null;
        stopLogsPolling();
        await loadTrainingHistory();
      } else {
        throw new Error(data.error || 'Cancellation failed');
      }
    } catch (err) {
      console.error('[TrainingHistory] Failed to cancel:', err);
      error = 'Failed to cancel training';
    }
  }

  async function toggleRunDetails(runId: string) {
    if (expandedRunId === runId) {
      expandedRunId = null;
      expandedLogs = [];
      return;
    }

    expandedRunId = runId;
    loadingLogs = true;
    expandedLogs = [];

    try {
      const run = pastRuns.find(r => r.id === runId);
      if (!run || !run.logFile) {
        expandedLogs = ['No log file available'];
        return;
      }

      // Load full log file
      const res = await fetch(`/api/training/log-file?file=${encodeURIComponent(run.logFile)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.logs) {
          expandedLogs = data.logs;
        } else {
          expandedLogs = ['Failed to load logs'];
        }
      } else {
        expandedLogs = ['Log file not found'];
      }
    } catch (err) {
      console.error('[TrainingHistory] Failed to load logs:', err);
      expandedLogs = ['Error loading logs'];
    } finally {
      loadingLogs = false;
    }
  }

  function formatDuration(duration: string | undefined): string {
    if (!duration) return 'N/A';
    return duration;
  }

  function formatTimestamp(timestamp: string): string {
    try {
      const date = new Date(timestamp);
      return date.toLocaleString();
    } catch {
      return timestamp;
    }
  }

  function getStatusColor(status: string): string {
    switch (status) {
      case 'running': return '#3b82f6';
      case 'completed': return '#10b981';
      case 'failed': return '#ef4444';
      case 'cancelled': return '#f59e0b';
      default: return '#6b7280';
    }
  }

  function getStatusEmoji(status: string): string {
    switch (status) {
      case 'running': return '🔄';
      case 'completed': return '✅';
      case 'failed': return '❌';
      case 'cancelled': return '🛑';
      default: return '❓';
    }
  }

  let historyInterval: number | null = null;

  function startHistoryPolling() {
    if (historyInterval) return;
    loadTrainingHistory();
    historyInterval = window.setInterval(loadTrainingHistory, 30000);
  }

  function stopHistoryPolling() {
    if (historyInterval) {
      clearInterval(historyInterval);
      historyInterval = null;
    }
  }

  function handleVisibilityChange() {
    if (document.hidden) {
      // Pause all polling when tab hidden
      stopHistoryPolling();
      stopLogsPolling();
    } else {
      // Resume polling when tab visible
      startHistoryPolling();
      // Only resume logs polling if there's a current run
      if (currentRun) {
        startLogsPolling();
      }
    }
  }

  onMount(() => {
    // Only poll when tab is visible
    if (!document.hidden) {
      startHistoryPolling();
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      stopHistoryPolling();
      stopLogsPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  });

  onDestroy(() => {
    stopLogsPolling();
  });
</script>

<div class="training-history">
  {#if loading && !currentRun && pastRuns.length === 0}
    <div class="loading-state">
      <div class="spinner"></div>
      <p>Loading training history...</p>
    </div>
  {:else}
    {#if error}
      <div class="error-banner">
        <strong>⚠️ Error:</strong> {error}
      </div>
    {/if}

    <!-- Current Run Section -->
    {#if currentRun}
      <div class="current-run-section">
        <div class="section-header">
          <h3>🔥 Current Training Run</h3>
          <button class="btn-cancel" on:click={cancelTraining}>
            🛑 Cancel Training
          </button>
        </div>

        <div class="run-card current">
          <div class="run-info">
            <div class="run-status">
              <span class="status-badge running">
                <div class="spinner-small"></div>
                <span>Running</span>
              </span>
              {#if currentRun.pid}
                <span class="run-pid">PID: {currentRun.pid}</span>
              {/if}
            </div>
            <div class="run-details">
              <div class="detail-row">
                <span class="detail-label">Started:</span>
                <span class="detail-value">{formatTimestamp(currentRun.startTime)}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Method:</span>
                <span class="detail-value">{currentRun.method}</span>
              </div>
            </div>
          </div>

          <div class="logs-grid">
            <!-- Console Output -->
            <div class="log-panel">
              <h4>🖥️ Console Output</h4>
              <div class="log-scroll console-output" bind:this={consoleScrollContainer}>
                {#if consoleLogs.length === 0}
                  <div class="log-empty">Waiting for training output...</div>
                {:else}
                  {#each consoleLogs as line}
                    <div class="console-line">{line}</div>
                  {/each}
                {/if}
              </div>
            </div>

            <!-- Training Events -->
            <div class="log-panel">
              <h4>📋 Training Events</h4>
              <div class="log-scroll events-output" bind:this={eventsScrollContainer}>
                {#if trainingLogs.length === 0}
                  <div class="log-empty">No events yet</div>
                {:else}
                  {#each trainingLogs as log}
                    <div class="event-line">
                      <span class="event-time">{new Date(log.timestamp).toLocaleTimeString()}</span>
                      <span class="event-name">{log.event}</span>
                      {#if log.details}
                        <span class="event-details">{JSON.stringify(log.details)}</span>
                      {/if}
                    </div>
                  {/each}
                {/if}
              </div>
            </div>
          </div>
        </div>
      </div>
    {/if}

    <!-- Past Runs Section -->
    <div class="past-runs-section">
      <div class="section-header">
        <h3>📜 Training History</h3>
        <span class="run-count">{pastRuns.length} run{pastRuns.length !== 1 ? 's' : ''}</span>
      </div>

      {#if pastRuns.length === 0}
        <div class="empty-state">
          <p>No past training runs found.</p>
          <p class="empty-hint">Start a training run using the Training Wizard to see history here.</p>
        </div>
      {:else}
        <div class="runs-list">
          {#each pastRuns as run (run.id)}
            <div class="run-card">
              <div class="run-header" on:click={() => toggleRunDetails(run.id)}>
                <div class="run-title">
                  <span class="status-emoji">{getStatusEmoji(run.status)}</span>
                  <span class="run-date">{formatTimestamp(run.startTime)}</span>
                  <span class="status-badge" style="background-color: {getStatusColor(run.status)}">
                    {run.status}
                  </span>
                </div>
                <button class="expand-button" class:expanded={expandedRunId === run.id}>
                  {expandedRunId === run.id ? '▼' : '▶'}
                </button>
              </div>

              <div class="run-summary">
                <div class="summary-item">
                  <span class="summary-label">Method:</span>
                  <span class="summary-value">{run.method || 'N/A'}</span>
                </div>
                {#if run.duration}
                  <div class="summary-item">
                    <span class="summary-label">Duration:</span>
                    <span class="summary-value">{formatDuration(run.duration)}</span>
                  </div>
                {/if}
                {#if run.dataset}
                  <div class="summary-item">
                    <span class="summary-label">Dataset:</span>
                    <span class="summary-value">{run.dataset}</span>
                  </div>
                {/if}
                {#if run.baseModel}
                  <div class="summary-item">
                    <span class="summary-label">Base Model:</span>
                    <span class="summary-value">{run.baseModel}</span>
                  </div>
                {/if}
                {#if run.error}
                  <div class="summary-item error">
                    <span class="summary-label">Error:</span>
                    <span class="summary-value">{run.error}</span>
                  </div>
                {/if}
              </div>

              {#if expandedRunId === run.id}
                <div class="run-logs-expanded">
                  {#if loadingLogs}
                    <div class="loading-logs">
                      <div class="spinner-small"></div>
                      <span>Loading logs...</span>
                    </div>
                  {:else}
                    <div class="log-scroll full-logs">
                      {#each expandedLogs as line}
                        <div class="log-line">{line}</div>
                      {/each}
                    </div>
                  {/if}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .training-history {
    padding: 1.5rem;
    max-width: 1400px;
    margin: 0 auto;
  }

  .loading-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 4rem 2rem;
    gap: 1rem;
  }

  .error-banner {
    background: #fee;
    border: 1px solid #fcc;
    border-radius: 6px;
    padding: 1rem;
    margin-bottom: 1.5rem;
    color: #c00;
  }

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
  }

  .section-header h3 {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 600;
  }

  .run-count {
    background: #f3f4f6;
    padding: 0.25rem 0.75rem;
    border-radius: 12px;
    font-size: 0.875rem;
    font-weight: 500;
  }

  :global(.dark) .run-count {
    background: #374151;
  }

  .btn-cancel {
    background: #ef4444;
    color: white;
    border: none;
    padding: 0.5rem 1rem;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 500;
    transition: background 0.2s;
  }

  .btn-cancel:hover {
    background: #dc2626;
  }

  .current-run-section {
    margin-bottom: 2rem;
  }

  .run-card {
    background: white;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    padding: 1.5rem;
    margin-bottom: 1rem;
  }

  :global(.dark) .run-card {
    background: #1f2937;
    border-color: #374151;
  }

  .run-card.current {
    border-color: #3b82f6;
    border-width: 2px;
  }

  .run-info {
    margin-bottom: 1.5rem;
  }

  .run-status {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1rem;
  }

  .status-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.375rem 0.75rem;
    border-radius: 6px;
    font-size: 0.875rem;
    font-weight: 500;
    color: white;
  }

  .status-badge.running {
    background: #3b82f6;
  }

  .run-pid {
    font-family: 'Courier New', monospace;
    font-size: 0.875rem;
    color: #6b7280;
  }

  .run-details {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .detail-row {
    display: flex;
    gap: 0.5rem;
    font-size: 0.875rem;
  }

  .detail-label {
    font-weight: 500;
    color: #6b7280;
  }

  .detail-value {
    color: #111827;
  }

  :global(.dark) .detail-value {
    color: #f3f4f6;
  }

  .logs-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
  }

  @media (max-width: 1024px) {
    .logs-grid {
      grid-template-columns: 1fr;
    }
  }

  .log-panel {
    display: flex;
    flex-direction: column;
  }

  .log-panel h4 {
    margin: 0 0 0.75rem 0;
    font-size: 1rem;
    font-weight: 600;
  }

  .log-scroll {
    background: #000;
    color: #0f0;
    font-family: 'Courier New', monospace;
    font-size: 0.75rem;
    padding: 1rem;
    border-radius: 6px;
    height: 400px;
    overflow-y: auto;
    line-height: 1.4;
  }

  .console-output {
    white-space: pre-wrap;
    word-break: break-all;
  }

  .events-output {
    background: #f9fafb;
    color: #111827;
  }

  :global(.dark) .events-output {
    background: #111827;
    color: #f3f4f6;
  }

  .console-line {
    margin-bottom: 2px;
  }

  .log-empty {
    color: #6b7280;
    font-style: italic;
    text-align: center;
    padding: 2rem;
  }

  .event-line {
    display: flex;
    gap: 0.75rem;
    padding: 0.5rem;
    border-bottom: 1px solid #e5e7eb;
  }

  :global(.dark) .event-line {
    border-bottom-color: #374151;
  }

  .event-time {
    color: #6b7280;
    font-size: 0.75rem;
    flex-shrink: 0;
  }

  .event-name {
    font-weight: 500;
    flex-shrink: 0;
  }

  .event-details {
    color: #6b7280;
    font-size: 0.75rem;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .past-runs-section {
    margin-top: 2rem;
  }

  .empty-state {
    text-align: center;
    padding: 3rem 2rem;
    color: #6b7280;
  }

  .empty-hint {
    font-size: 0.875rem;
    margin-top: 0.5rem;
  }

  .runs-list {
    display: flex;
    flex-direction: column;
  }

  .run-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    cursor: pointer;
    user-select: none;
    padding-bottom: 0.75rem;
    border-bottom: 1px solid #e5e7eb;
  }

  :global(.dark) .run-header {
    border-bottom-color: #374151;
  }

  .run-header:hover {
    opacity: 0.8;
  }

  .run-title {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .status-emoji {
    font-size: 1.25rem;
  }

  .run-date {
    font-weight: 600;
    font-size: 0.875rem;
  }

  .expand-button {
    background: none;
    border: none;
    font-size: 1rem;
    cursor: pointer;
    padding: 0.5rem;
    color: #6b7280;
    transition: transform 0.2s;
  }

  .expand-button.expanded {
    transform: rotate(0deg);
  }

  .run-summary {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 0.75rem;
    padding-top: 0.75rem;
  }

  .summary-item {
    display: flex;
    gap: 0.5rem;
    font-size: 0.875rem;
  }

  .summary-item.error {
    grid-column: 1 / -1;
    color: #ef4444;
  }

  .summary-label {
    font-weight: 500;
    color: #6b7280;
  }

  .summary-value {
    color: #111827;
  }

  :global(.dark) .summary-value {
    color: #f3f4f6;
  }

  .run-logs-expanded {
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid #e5e7eb;
  }

  :global(.dark) .run-logs-expanded {
    border-top-color: #374151;
  }

  .loading-logs {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    padding: 2rem;
    color: #6b7280;
  }

  .full-logs {
    height: 500px;
    background: #111827;
    color: #f3f4f6;
    font-size: 0.75rem;
  }

  .log-line {
    padding: 0.25rem 0;
    white-space: pre-wrap;
    word-break: break-all;
  }

  .spinner {
    width: 40px;
    height: 40px;
    border: 4px solid #e5e7eb;
    border-top-color: #3b82f6;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  .spinner-small {
    width: 16px;
    height: 16px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
