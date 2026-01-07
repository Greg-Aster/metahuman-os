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
      const res = await apiFetch(`/api/training/log-file?file=${encodeURIComponent(run.logFile)}`);
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

<div class="p-6 max-w-[1400px] mx-auto">
  {#if loading && !currentRun && pastRuns.length === 0}
    <div class="flex flex-col items-center justify-center py-16 px-8 gap-4">
      <div class="w-10 h-10 border-4 border-gray-200 dark:border-gray-700 border-t-blue-500 rounded-full animate-spin"></div>
      <p>Loading training history...</p>
    </div>
  {:else}
    {#if error}
      <div class="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-md p-4 mb-6 text-red-700 dark:text-red-400">
        <strong>⚠️ Error:</strong> {error}
      </div>
    {/if}

    <!-- Current Run Section -->
    {#if currentRun}
      <div class="mb-8">
        <div class="flex justify-between items-center mb-4">
          <h3 class="m-0 text-xl font-semibold">🔥 Current Training Run</h3>
          <button class="bg-red-500 text-white border-none px-4 py-2 rounded-md cursor-pointer font-medium transition-colors hover:bg-red-600" on:click={cancelTraining}>
            🛑 Cancel Training
          </button>
        </div>

        <div class="bg-white dark:bg-gray-800 border-2 border-blue-500 rounded-lg p-6 mb-4">
          <div class="mb-6">
            <div class="flex items-center gap-4 mb-4">
              <span class="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium text-white bg-blue-500">
                <div class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                <span>Running</span>
              </span>
              {#if currentRun.pid}
                <span class="font-mono text-sm text-gray-500">PID: {currentRun.pid}</span>
              {/if}
            </div>
            <div class="flex flex-col gap-2">
              <div class="flex gap-2 text-sm">
                <span class="font-medium text-gray-500">Started:</span>
                <span class="text-gray-900 dark:text-gray-100">{formatTimestamp(currentRun.startTime)}</span>
              </div>
              <div class="flex gap-2 text-sm">
                <span class="font-medium text-gray-500">Method:</span>
                <span class="text-gray-900 dark:text-gray-100">{currentRun.method}</span>
              </div>
            </div>
          </div>

          <div class="grid grid-cols-2 lg:grid-cols-1 gap-4">
            <!-- Console Output -->
            <div class="flex flex-col">
              <h4 class="m-0 mb-3 text-base font-semibold">🖥️ Console Output</h4>
              <div class="bg-black text-green-400 font-mono text-xs p-4 rounded-md h-[400px] overflow-y-auto leading-relaxed whitespace-pre-wrap break-all" bind:this={consoleScrollContainer}>
                {#if consoleLogs.length === 0}
                  <div class="text-gray-500 italic text-center py-8">Waiting for training output...</div>
                {:else}
                  {#each consoleLogs as line}
                    <div class="mb-0.5">{line}</div>
                  {/each}
                {/if}
              </div>
            </div>

            <!-- Training Events -->
            <div class="flex flex-col">
              <h4 class="m-0 mb-3 text-base font-semibold">📋 Training Events</h4>
              <div class="bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 font-mono text-xs p-4 rounded-md h-[400px] overflow-y-auto leading-relaxed" bind:this={eventsScrollContainer}>
                {#if trainingLogs.length === 0}
                  <div class="text-gray-500 italic text-center py-8">No events yet</div>
                {:else}
                  {#each trainingLogs as log}
                    <div class="flex gap-3 p-2 border-b border-gray-200 dark:border-gray-700">
                      <span class="text-gray-500 text-xs flex-shrink-0">{new Date(log.timestamp).toLocaleTimeString()}</span>
                      <span class="font-medium flex-shrink-0">{log.event}</span>
                      {#if log.details}
                        <span class="text-gray-500 text-xs overflow-hidden text-ellipsis">{JSON.stringify(log.details)}</span>
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
    <div class="mt-8">
      <div class="flex justify-between items-center mb-4">
        <h3 class="m-0 text-xl font-semibold">📜 Training History</h3>
        <span class="bg-gray-100 dark:bg-gray-700 px-3 py-1 rounded-xl text-sm font-medium">{pastRuns.length} run{pastRuns.length !== 1 ? 's' : ''}</span>
      </div>

      {#if pastRuns.length === 0}
        <div class="text-center py-12 px-8 text-gray-500">
          <p>No past training runs found.</p>
          <p class="text-sm mt-2">Start a training run using the Training Wizard to see history here.</p>
        </div>
      {:else}
        <div class="flex flex-col">
          {#each pastRuns as run (run.id)}
            <div class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 mb-4">
              <div class="flex justify-between items-center cursor-pointer select-none pb-3 border-b border-gray-200 dark:border-gray-700 hover:opacity-80" on:click={() => toggleRunDetails(run.id)}>
                <div class="flex items-center gap-3">
                  <span class="text-xl">{getStatusEmoji(run.status)}</span>
                  <span class="font-semibold text-sm">{formatTimestamp(run.startTime)}</span>
                  <span class="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium text-white" style="background-color: {getStatusColor(run.status)}">
                    {run.status}
                  </span>
                </div>
                <button class="bg-transparent border-none text-base cursor-pointer p-2 text-gray-500 transition-transform {expandedRunId === run.id ? '' : ''}">
                  {expandedRunId === run.id ? '▼' : '▶'}
                </button>
              </div>

              <div class="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3 pt-3">
                <div class="flex gap-2 text-sm">
                  <span class="font-medium text-gray-500">Method:</span>
                  <span class="text-gray-900 dark:text-gray-100">{run.method || 'N/A'}</span>
                </div>
                {#if run.duration}
                  <div class="flex gap-2 text-sm">
                    <span class="font-medium text-gray-500">Duration:</span>
                    <span class="text-gray-900 dark:text-gray-100">{formatDuration(run.duration)}</span>
                  </div>
                {/if}
                {#if run.dataset}
                  <div class="flex gap-2 text-sm">
                    <span class="font-medium text-gray-500">Dataset:</span>
                    <span class="text-gray-900 dark:text-gray-100">{run.dataset}</span>
                  </div>
                {/if}
                {#if run.baseModel}
                  <div class="flex gap-2 text-sm">
                    <span class="font-medium text-gray-500">Base Model:</span>
                    <span class="text-gray-900 dark:text-gray-100">{run.baseModel}</span>
                  </div>
                {/if}
                {#if run.error}
                  <div class="flex gap-2 text-sm col-span-full text-red-500">
                    <span class="font-medium">Error:</span>
                    <span>{run.error}</span>
                  </div>
                {/if}
              </div>

              {#if expandedRunId === run.id}
                <div class="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                  {#if loadingLogs}
                    <div class="flex items-center justify-center gap-3 py-8 text-gray-500">
                      <div class="w-4 h-4 border-2 border-gray-300 dark:border-gray-600 border-t-blue-500 rounded-full animate-spin"></div>
                      <span>Loading logs...</span>
                    </div>
                  {:else}
                    <div class="bg-gray-900 text-gray-100 font-mono text-xs p-4 rounded-md h-[500px] overflow-y-auto leading-relaxed">
                      {#each expandedLogs as line}
                        <div class="py-1 whitespace-pre-wrap break-all">{line}</div>
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

