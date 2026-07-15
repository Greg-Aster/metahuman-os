<script lang="ts">
  import { onMount, afterUpdate } from 'svelte';
  import { fetchJSONSafe, FetchTimeoutError } from '../lib/client/utils/fetch-timeout';
  import { apiFetch } from '../lib/client/api-config';

  type DatasetStatus = {
    date: string;
    pairCount: number;
    status: 'pending' | 'approved' | 'trained' | 'evaluated' | 'active';
    approvedAt?: string;
    approvedBy?: string;
    notes?: string;
    autoApproved?: boolean;
    qualityScore?: number;
    evalScore?: number;
    evalPassed?: boolean;
    evaluatedAt?: string;
    adapterPath?: string;
    modelfilePath?: string;
    dryRun?: boolean;
  };

  type AutoApprovalConfig = {
    enabled: boolean;
    dryRun: boolean;
    thresholds: {
      minPairs: number;
      minHighConfidence: number;
      minReflectionPct: number;
      maxLowConfidence: number;
    };
    alertEmail?: string | null;
  };

  type ActiveAdapterInfo = {
    modelName: string;
    activatedAt: string;
    adapterPath: string;
    evalScore?: number;
    dataset?: string;
    modelfilePath?: string;
    status?: string;
  } | null;

  let datasets: DatasetStatus[] = [];
  let autoApproval: AutoApprovalConfig | null = null;
  let activeAdapter: ActiveAdapterInfo = null;
  let loraEnabled = false;
  let loading = true;
  let error: string | null = null;
  let workingOn: Record<string, string> = {};
  let updatingConfig = false;
  let recentLogs: Array<{ timestamp: string; event: string; actor?: string; details?: any }> = [];

  // Training data configuration
  let trainingConfig: any = null;
  let updatingTrainingConfig = false;

  async function loadData() {
    loading = true;
    error = null;
    try {
      // ROBUSTNESS: 15s timeout with 1 retry to handle slow/stuck Ollama
      const { data, error: fetchError } = await fetchJSONSafe('/api/adapters', {
        timeout: 15000,
        retries: 1,
        retryDelay: 2000,
      });

      if (fetchError) {
        throw new Error(fetchError);
      }

      if (!data || !data.success) {
        throw new Error(data?.error || 'Failed to load adapters');
      }

      datasets = Array.isArray(data.datasets) ? data.datasets : [];
      autoApproval = data.autoApproval ?? null;
      activeAdapter = data.activeAdapter ?? null;
      loraEnabled = !!(data.sleep?.loraEnabled);
      recentLogs = Array.isArray(data.recentLogs) ? data.recentLogs : [];
    } catch (err) {
      console.error('[AdapterDashboard] Load error:', err);
      error = (err as Error).message;

      // GRACEFUL DEGRADATION: Keep existing data visible on error
      // Don't clear datasets/activeAdapter if this is a refresh failure
    } finally {
      loading = false;
    }
  }

  async function loadTrainingConfig() {
    try {
      // ROBUSTNESS: 10s timeout for config load
      const { data, error: fetchError } = await fetchJSONSafe('/api/training-data', {
        timeout: 10000,
      });

      if (fetchError) {
        console.error('Failed to load training config:', fetchError);
        return;
      }

      if (data && data.success) {
        trainingConfig = data.config;
      }
    } catch (err) {
      console.error('Failed to load training config:', err);
    }
  }

  async function updateTrainingConfig(updates: any) {
    updatingTrainingConfig = true;
    try {
      const res = await apiFetch('/api/training-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to update training config');
      trainingConfig = data.config;
      alert('Training data configuration updated successfully');
    } catch (err) {
      alert((err as Error).message);
    } finally {
      updatingTrainingConfig = false;
    }
  }

  function applyPhasePreset(phase: 'phase1_conservative' | 'phase2_optimal' | 'phase3_maximum') {
    if (!trainingConfig || !trainingConfig.phases[phase]) return;
    const preset = trainingConfig.phases[phase];
    updateTrainingConfig({
      curator: {
        batchSize: preset.curator.batchSize,
      },
      collection: {
        maxSamplesPerSource: preset.curator.maxSamplesPerSource,
      },
    });
  }

  onMount(async () => {
    loadData();
    loadTrainingConfig();
    loadTrainingModels();

    // Check if training is already running on page load
    try {
      const statusRes = await apiFetch('/api/training/running');
      const statusData = await statusRes.json();
      if (statusData.success && statusData.running) {
        fullCycleRunningPid = statusData.pid;
        monitorExpanded = true;
        startLogsPolling();
      }
    } catch (e) {
      console.warn('Could not check training status on mount:', e);
    }

    // PERFORMANCE: Increased from 15s to 30s to reduce server load
    const interval = setInterval(loadData, 30000);

    // Pause polling when tab is hidden to save resources
    const handleVisibilityChange = () => {
      if (document.hidden) {
        clearInterval(interval);
        stopLogsPolling();
      } else {
        // Resume polling when tab becomes visible
        loadData();
        const newInterval = setInterval(loadData, 30000); // PERFORMANCE: Increased from 15s to 30s
        if (fullCycleRunningPid) {
          startLogsPolling();
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(interval);
      stopLogsPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  });

  afterUpdate(() => {
    // Auto-scroll logs to bottom when new entries are added
    if (consoleLogsScrollContainer && fullCycleRunningPid) {
      consoleLogsScrollContainer.scrollTop = consoleLogsScrollContainer.scrollHeight;
    }
    if (eventsLogsScrollContainer && fullCycleRunningPid) {
      eventsLogsScrollContainer.scrollTop = eventsLogsScrollContainer.scrollHeight;
    }
  });

  function setWorking(date: string, action: string, value: boolean) {
    const key = `${date}:${action}`;
    workingOn = value ? { ...workingOn, [key]: action } : Object.fromEntries(Object.entries(workingOn).filter(([k]) => k !== key));
  }

  function isWorking(date: string, action: string) {
    return !!workingOn[`${date}:${action}`];
  }

  async function sendAction(action: string, payload: Record<string, any>) {
    const res = await apiFetch('/api/adapters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...payload }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || `Action ${action} failed`);
    }
    return data;
  }

  async function handleApprove(date: string) {
    if (!confirm(`Approve dataset ${date}?`)) return;
    setWorking(date, 'approve', true);
    try {
      await sendAction('approve', { date });
      await loadData();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setWorking(date, 'approve', false);
    }
  }

  async function handleReject(date: string) {
    if (!confirm(`Reject dataset ${date}? It will be moved to _rejected.`)) return;
    setWorking(date, 'reject', true);
    try {
      await sendAction('reject', { date, reason: 'Rejected via web UI' });
      await loadData();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setWorking(date, 'reject', false);
    }
  }

  async function handleTrain(date: string) {
    if (!confirm(`Start LoRA training for ${date}? This runs in the background.`)) return;
    setWorking(date, 'train', true);
    try {
      await sendAction('train', { date });
      await loadData();
      alert('Training started. Check audit logs for progress.');
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setWorking(date, 'train', false);
    }
  }

  async function handleEval(date: string) {
    setWorking(date, 'eval', true);
    try {
      await sendAction('eval', { date });
      await loadData();
      alert('Evaluation started. Refresh later for results.');
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setWorking(date, 'eval', false);
    }
  }

  async function handleActivate(date: string) {
    if (!confirm(`Activate adapter ${date}? Ensure Ollama has the base model installed.`)) return;
    setWorking(date, 'activate', true);
    try {
      const response = await sendAction('activate', { date });
      await loadData();
      alert(response.message || 'Adapter activation metadata updated. Run `ollama create` as instructed.');
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setWorking(date, 'activate', false);
    }
  }

  async function runBuilderNow() {
    try {
      await sendAction('runBuilder', {});
      alert('Adapter-builder started. Refresh in a moment to see the dataset.');
      await loadData();
    } catch (err) {
      alert((err as Error).message);
    }
  }

  async function runDreamerNow() {
    try {
      await sendAction('runDreamer', {});
      alert('Dreamer started. Morning profile will include new learnings.');
    } catch (err) {
      alert((err as Error).message);
    }
  }

  async function runSleepWorkflow() {
    try {
      await sendAction('runSleepWorkflow', {});
      alert('Sleep service started in background. It will run nightly.');
    } catch (err) {
      alert((err as Error).message);
    }
  }

  // Track state for full cycle modal (simplified - just config)
  let showFullCycleModal = false;
  let selectedModel = '';
  let dualModeEnabled = false;

  // Training monitor state (moved from modal)
  let fullCycleRunningPid: number | null = null;
  let fullCycleLogs: Array<{ timestamp: string; event: string; details?: any }> = [];
  let fullCycleConsoleLogs: string[] = [];
  let logsInterval: number | null = null;
  let consoleLogsScrollContainer: HTMLDivElement | null = null;
  let eventsLogsScrollContainer: HTMLDivElement | null = null;
  let cancelling = false;
  let monitorExpanded = false;

  // Training base models (loaded dynamically from Ollama)
  interface TrainingModel {
    id: string;
    name: string;
    description: string;
    size: string;
    vram: string;
    license: string;
  }

  let trainingModels: TrainingModel[] = [];
  let trainingModelsError: string | null = null;
  let setupGuideLink = '/docs/user-guide/lora-training.md';

  async function loadTrainingModels() {
    try {
      // ROBUSTNESS: 10s timeout (Ollama may be slow)
      const { data, error: fetchError } = await fetchJSONSafe('/api/training-models', {
        timeout: 10000,
      });

      if (fetchError) {
        console.error('Failed to load training models:', fetchError);
        trainingModelsError = fetchError;
        return;
      }

      if (data && data.success && data.models) {
        trainingModels = data.models;
        if (data.notes?.setup_guide) {
          setupGuideLink = data.notes.setup_guide;
        }
      } else {
        trainingModelsError = data?.error || 'Failed to load training models';
        if (data?.setupGuide) {
          setupGuideLink = data.setupGuide;
        }
      }
    } catch (err) {
      console.error('Failed to load training models:', err);
      trainingModelsError = 'Failed to load training models';
    }
  }

  async function loadFullCycleLogs() {
    try {
      // ROBUSTNESS: 5s timeout for log polling (fails silently if slow)
      const timeout = 5000;

      // Load audit logs
      const { data: auditData } = await fetchJSONSafe('/api/training/logs?maxLines=50', { timeout });
      if (auditData && auditData.success && auditData.logs) {
        fullCycleLogs = auditData.logs;
      }

      // Load console logs
      const { data: consoleData } = await fetchJSONSafe('/api/training/console-logs?maxLines=100', { timeout });
      if (consoleData && consoleData.success && consoleData.logs) {
        fullCycleConsoleLogs = consoleData.logs;
      }

      // Check if process is still running
      const { data: statusData } = await fetchJSONSafe('/api/training/running', { timeout });
      if (statusData && statusData.success) {
        fullCycleRunningPid = statusData.running ? statusData.pid : null;

        // If process stopped, stop polling
        if (!statusData.running && fullCycleRunningPid) {
          stopLogsPolling();
        }
      }
    } catch (err) {
      // Fail silently for log polling - don't interrupt user experience
      console.warn('Failed to load training logs:', err);
    }
  }

  async function cancelFullCycle() {
    if (!confirm('Cancel the training cycle? This will stop all in-progress work.')) {
      return;
    }

    cancelling = true;
    try {
      await sendAction('cancelFullCycle', {});
      fullCycleRunningPid = null;
      stopLogsPolling();
      alert('Training cancelled successfully');
    } catch (err) {
      alert((err as Error).message);
    } finally {
      cancelling = false;
    }
  }

  function startLogsPolling() {
    // Clear any existing interval
    if (logsInterval) {
      clearInterval(logsInterval);
    }

    // Load logs immediately
    loadFullCycleLogs();

    // PERFORMANCE: Increased from 5s to 10s to reduce server load
    logsInterval = setInterval(loadFullCycleLogs, 10000);
  }

  function stopLogsPolling() {
    if (logsInterval) {
      clearInterval(logsInterval);
      logsInterval = null;
    }
  }

  function closeFullCycleModal() {
    showFullCycleModal = false;
  }

  async function runFullCycleWithParams() {
    try {
      // Start the full cycle
      await sendAction('fullCycle', {
        model: selectedModel || undefined,
        dualMode: dualModeEnabled
      });

      // Close modal and show success message
      showFullCycleModal = false;

      // Expand training monitor and start polling
      monitorExpanded = true;
      startLogsPolling();

      alert('Training started! Check the Training Monitor section below to follow progress.');
    } catch (err) {
      alert((err && (err as any).message) || String(err));
    }
  }

  async function runFullCycleNow() {
    // Load current base model from etc/training.json to use as default
    try {
      const res = await apiFetch('/api/training-config');
      if (res.ok) {
        const data = await res.json();
        selectedModel = data.base_model || '';
      }
    } catch (e) {
      // Try fallback to first model in list
      selectedModel = trainingModels.length > 0 ? trainingModels[0].id : '';
    }

    // If selectedModel is not in our training models list, use the first one
    const modelIds = trainingModels.map(m => m.id);
    if (!modelIds.includes(selectedModel) && trainingModels.length > 0) {
      selectedModel = trainingModels[0].id;
    }

    // Set dual mode to true by default if we have historical adapters
    try {
      const adaptersRes = await apiFetch('/api/adapters');
      if (adaptersRes.ok) {
        const adaptersData = await adaptersRes.json();
        const hasHistorical = adaptersData.datasets && adaptersData.datasets.length > 1; // More than 1 dataset means we have historical
        dualModeEnabled = hasHistorical; // Enable dual mode if we have historical adapters
      }
    } catch (e) {
      console.warn('Could not determine if dual mode should be enabled:', e);
      dualModeEnabled = false; // Default to false
    }

    showFullCycleModal = true;
  }

  async function exportConversationsNow() {
    try {
      const res = await apiFetch('/api/export/conversations', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Export failed');
      alert(`Exported ${data.count} items to ${data.dir || 'N/A'}`);
    } catch (err) {
      alert((err && (err as any).message) || String(err));
    }
  }

  async function mergeHistoricalAdapters() {
    if (!confirm('Merge all historical adapters into a single consolidated adapter? This may take several minutes.')) return;
    try {
      await sendAction('mergeAdapters', {});
      alert('Adapter merge started. Check audit logs for progress.');
      await loadData();
    } catch (err) {
      alert((err as Error).message);
    }
  }

  async function toggleAutoApproval(field: 'enabled' | 'dryRun', value: boolean) {
    if (!autoApproval) return;
    updatingConfig = true;
    try {
      const payload: Record<string, any> = {};
      // Avoid TS casts inside template expressions by building payload here
      payload[field] = value;
      await sendAction('autoApproval', payload);
      await loadData();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      updatingConfig = false;
    }
  }

  function onToggleEnabled(e: any) {
    const target = e.currentTarget;
    toggleAutoApproval('enabled', !!target.checked);
  }

  function onToggleDryRun(e: any) {
    const target = e.currentTarget;
    toggleAutoApproval('dryRun', !!target.checked);
  }

  function statusBadge(status: DatasetStatus['status']) {
    switch (status) {
      case 'pending':
        return { label: 'Pending', class: 'bg-gray-400/20 text-gray-600 dark:text-gray-400' };
      case 'approved':
        return { label: 'Approved', class: 'bg-blue-500/20 text-blue-600 dark:text-blue-400' };
      case 'trained':
        return { label: 'Trained', class: 'bg-violet-500/20 text-violet-600 dark:text-violet-400' };
      case 'evaluated':
        return { label: 'Evaluated', class: 'bg-amber-500/20 text-amber-600 dark:text-amber-400' };
      case 'active':
        return { label: 'Active', class: 'bg-green-500/20 text-green-600 dark:text-green-400' };
      default:
        return { label: status, class: 'bg-gray-400/20 text-gray-600 dark:text-gray-400' };
    }
  }

  async function onToggleLoraEnabled(e: any) {
    try {
      const target = e.currentTarget;
      const res = await apiFetch('/api/adapters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sleep', loraEnabled: !!target.checked }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to update sleep config');
      loraEnabled = !!data.sleep?.loraEnabled;
    } catch (err) {
      alert((err && (err as any).message) || String(err));
    }
  }

  async function toggleAutoFlag(flag: string, value: boolean) {
    try {
      const payload: any = { action: 'autoApproval' };
      payload[flag] = value;
      const res = await apiFetch('/api/adapters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to update auto-approval options');
      autoApproval = data.config;
    } catch (err) {
      alert((err && (err as any).message) || String(err));
    }
  }

  function onToggleAutoTrain(e: any) {
    toggleAutoFlag('autoTrain', !!e.currentTarget.checked)
  }
  function onToggleAutoEval(e: any) {
    toggleAutoFlag('autoEval', !!e.currentTarget.checked)
  }
  function onToggleAutoActivate(e: any) {
    toggleAutoFlag('autoActivate', !!e.currentTarget.checked)
  }

  function getAutoFlag(flag: 'autoTrain' | 'autoEval' | 'autoActivate'): boolean {
    const cfg: any = autoApproval;
    if (!cfg) return false;
    return cfg[flag] !== false;
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && showFullCycleModal) {
      showFullCycleModal = false;
    }
  }
</script>

<svelte:window on:keydown={handleKeydown} />

<div class="flex flex-col gap-6 p-6 overflow-y-auto">
  <div class="flex items-center justify-between gap-4">
    <div>
      <h2 class="m-0 text-2xl font-semibold">🧠 LoRA Adaptation</h2>
      <p class="mt-1 mb-0 text-gray-500 dark:text-gray-400">Manage datasets, training, and activation directly from the UI.</p>
    </div>
    <button
      class="px-4 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 text-gray-900 dark:text-gray-100 cursor-pointer"
      on:click={loadData}
      disabled={loading}
    >
      {loading ? 'Refreshing…' : 'Refresh'}
    </button>
  </div>

  <!-- Error/Warning Banner -->
  {#if error}
    <div class="flex items-start gap-4 p-4 mt-4 bg-red-500/10 border border-red-500/30 rounded-lg animate-slideDown">
      <div class="text-2xl flex-shrink-0">⚠️</div>
      <div class="flex-1 text-red-900 dark:text-red-200">
        <strong class="block mb-1 text-red-800 dark:text-red-400">Connection Issue</strong>
        <p class="my-1 text-sm">{error}</p>
        {#if error.includes('timeout') || error.includes('timed out')}
          <p class="mt-2 p-2 bg-black/5 dark:bg-white/5 rounded text-[0.8125rem] text-red-900 dark:text-red-300">The server may be overloaded. Try refreshing or check if Ollama is stuck.</p>
        {/if}
      </div>
      <button class="p-1 bg-transparent border-none text-red-900 dark:text-red-200 text-2xl cursor-pointer opacity-60 hover:opacity-100 flex-shrink-0" on:click={() => error = null}>×</button>
    </div>
  {/if}

  <!-- Animated status line -->
  <div class="flex items-center gap-2 py-2 border-t border-b border-dashed border-black/10 dark:border-white/10 mb-3">
    {#if activeAdapter}
      <div class="w-2.5 h-2.5 rounded-full relative animate-status-dot {activeAdapter?.status === 'loaded' ? 'bg-emerald-500' : 'bg-amber-500'}"></div>
      <span>
        {#if activeAdapter?.status === 'loaded'}
          Active model loaded in Ollama: {activeAdapter.modelName}
        {:else}
          Adapter activated ({activeAdapter.modelName}); awaiting Ollama create (status: {activeAdapter.status || 'pending'})
        {/if}
      </span>
    {:else}
      <div class="w-2.5 h-2.5 rounded-full bg-amber-500 relative animate-status-dot"></div>
      <span>No active adapter</span>
    {/if}
  </div>

  {#if error}
    <div class="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
      <strong>Error:</strong> {error}
    </div>
  {/if}

  <section class="panel">
    <header>
      <h3 class="m-0 text-lg font-semibold">Autonomy Controls</h3>
      <p class="mt-1 mb-0 text-gray-500 dark:text-gray-400">Nightly LoRA pipeline settings (no file edits needed).</p>
    </header>
    <div class="flex flex-wrap gap-2 mt-4">
      <button class="btn-sm" on:click={runBuilderNow}>Run Builder Now</button>
      <button class="btn-sm" on:click={runDreamerNow}>Run Dreamer</button>
      <button class="btn-sm" on:click={runSleepWorkflow}>Queue Sleep Workflow</button>
      <button class="btn-sm" on:click={runFullCycleNow}>Run Full Cycle Now</button>
      <button class="btn-sm" on:click={exportConversationsNow}>Export Conversations</button>
      <button class="btn-sm bg-gradient-to-r from-violet-600 to-blue-500 text-white border-transparent font-semibold hover:from-violet-700 hover:to-blue-600" on:click={mergeHistoricalAdapters}>🔀 Merge Historical Adapters</button>
    </div>
    <div class="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4 mt-4 items-start">
      <label class="flex items-center justify-between bg-black/5 dark:bg-white/5 rounded-lg px-4 py-3">
        <span>Enable LoRA (sleep.json)</span>
        <input type="checkbox" checked={loraEnabled} on:change={onToggleLoraEnabled} />
      </label>
      {#if autoApproval}
        <label class="flex items-center justify-between bg-black/5 dark:bg-white/5 rounded-lg px-4 py-3">
          <span>Auto-Approval Enabled</span>
          <input type="checkbox" checked={autoApproval.enabled} disabled={updatingConfig} on:change={onToggleEnabled} />
        </label>
        <label class="flex items-center justify-between bg-black/5 dark:bg-white/5 rounded-lg px-4 py-3">
          <span>Dry Run Mode</span>
          <input type="checkbox" checked={autoApproval.dryRun} disabled={updatingConfig} on:change={onToggleDryRun} />
        </label>
        <label class="flex items-center justify-between bg-black/5 dark:bg-white/5 rounded-lg px-4 py-3">
          <span>Auto Train</span>
          <input type="checkbox" checked={getAutoFlag('autoTrain')} on:change={onToggleAutoTrain} />
        </label>
        <label class="flex items-center justify-between bg-black/5 dark:bg-white/5 rounded-lg px-4 py-3">
          <span>Auto Evaluate</span>
          <input type="checkbox" checked={getAutoFlag('autoEval')} on:change={onToggleAutoEval} />
        </label>
        <label class="flex items-center justify-between bg-black/5 dark:bg-white/5 rounded-lg px-4 py-3">
          <span>Auto Activate</span>
          <input type="checkbox" checked={getAutoFlag('autoActivate')} on:change={onToggleAutoActivate} />
        </label>
        <div class="flex flex-col gap-1 text-sm bg-black/5 dark:bg-white/5 rounded-lg p-3">
          <div>Min pairs: <strong class="font-semibold">{autoApproval.thresholds.minPairs}</strong></div>
          <div>High confidence ≥ <strong class="font-semibold">{Math.round(autoApproval.thresholds.minHighConfidence * 100)}%</strong></div>
          <div>Reflections ≥ <strong class="font-semibold">{Math.round(autoApproval.thresholds.minReflectionPct * 100)}%</strong></div>
          <div>Low confidence ≤ <strong class="font-semibold">{Math.round(autoApproval.thresholds.maxLowConfidence * 100)}%</strong></div>
        </div>
      {:else}
        <p class="muted">Auto-approval config not available.</p>
      {/if}
    </div>
  </section>

  <!-- Training Data Configuration -->
  {#if trainingConfig}
    <section class="panel">
      <header>
        <h3 class="m-0 text-lg font-semibold">📊 Training Data Configuration</h3>
        <p class="mt-1 mb-0 text-gray-500 dark:text-gray-400">Configure data collection and curation settings for LoRA adapter training.</p>
      </header>

      <div class="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-6 mb-6 mt-4">
        <div>
          <h4 class="m-0 mb-4 text-base font-semibold">Curator Settings</h4>
          <div class="flex flex-col gap-2 mb-4">
            <label for="batch-size" class="text-sm font-medium text-gray-700 dark:text-gray-300">Batch Size:</label>
            <input
              id="batch-size"
              type="number"
              min="10"
              max="200"
              step="10"
              value={trainingConfig.curator.batchSize}
              disabled={updatingTrainingConfig}
              on:change={(e) => updateTrainingConfig({ curator: { batchSize: parseInt(e.currentTarget.value) } })}
              class="input-field"
            />
            <span class="text-xs text-gray-500 dark:text-gray-400 italic">Samples processed per curator call (10-200)</span>
          </div>
          <div class="flex flex-col gap-2 mb-4">
            <label for="quality-threshold" class="text-sm font-medium text-gray-700 dark:text-gray-300">Quality Threshold:</label>
            <input
              id="quality-threshold"
              type="number"
              min="0"
              max="10"
              step="0.1"
              value={trainingConfig.curator.qualityThreshold}
              disabled={updatingTrainingConfig}
              on:change={(e) => updateTrainingConfig({ curator: { qualityThreshold: parseFloat(e.currentTarget.value) } })}
              class="input-field"
            />
            <span class="text-xs text-gray-500 dark:text-gray-400 italic">Minimum quality score (0-10)</span>
          </div>
          <div class="flex flex-col gap-2 mb-4">
            <label for="temperature" class="text-sm font-medium text-gray-700 dark:text-gray-300">Temperature:</label>
            <input
              id="temperature"
              type="number"
              min="0"
              max="2"
              step="0.1"
              value={trainingConfig.curator.temperature}
              disabled={updatingTrainingConfig}
              on:change={(e) => updateTrainingConfig({ curator: { temperature: parseFloat(e.currentTarget.value) } })}
              class="input-field"
            />
            <span class="text-xs text-gray-500 dark:text-gray-400 italic">LLM temperature (0-2)</span>
          </div>
        </div>

        <div>
          <h4 class="m-0 mb-4 text-base font-semibold">Collection Settings</h4>
          <div class="flex flex-col gap-2 mb-4">
            <label for="max-samples" class="text-sm font-medium text-gray-700 dark:text-gray-300">Max Samples/Source:</label>
            <input
              id="max-samples"
              type="number"
              min="100"
              max="10000"
              step="100"
              value={trainingConfig.collection.maxSamplesPerSource}
              disabled={updatingTrainingConfig}
              on:change={(e) => updateTrainingConfig({ collection: { maxSamplesPerSource: parseInt(e.currentTarget.value) } })}
              class="input-field"
            />
            <span class="text-xs text-gray-500 dark:text-gray-400 italic">Maximum samples per memory type (100-10000)</span>
          </div>
          <div class="flex flex-col gap-2 mb-4">
            <label for="max-days" class="text-sm font-medium text-gray-700 dark:text-gray-300">Max Days:</label>
            <input
              id="max-days"
              type="number"
              min="1"
              max="999999"
              value={trainingConfig.collection.maxDays}
              disabled={updatingTrainingConfig}
              on:change={(e) => updateTrainingConfig({ collection: { maxDays: parseInt(e.currentTarget.value) } })}
              class="input-field"
            />
            <span class="text-xs text-gray-500 dark:text-gray-400 italic">Days of history to include (999999 = all time)</span>
          </div>
        </div>
      </div>

      <div class="mt-6 pt-6 border-t border-black/10 dark:border-white/10">
        <h4 class="m-0 mb-4 text-base font-semibold">Quick Presets</h4>
        <div class="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
          <button
            class="flex flex-col items-start p-4 bg-white dark:bg-white/5 border-2 border-black/10 dark:border-white/10 rounded-lg cursor-pointer transition-all hover:border-violet-600 dark:hover:border-violet-400 hover:bg-violet-500/5 disabled:opacity-50 disabled:cursor-not-allowed"
            on:click={() => applyPhasePreset('phase1_conservative')}
            disabled={updatingTrainingConfig}
          >
            <span class="font-semibold text-sm mb-1">Phase 1: Conservative</span>
            <span class="text-xs text-gray-500 dark:text-gray-400">~800-1200 samples, ~15 mins</span>
          </button>
          <button
            class="flex flex-col items-start p-4 bg-violet-500/10 border-2 border-violet-600 dark:border-violet-400 rounded-lg cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            on:click={() => applyPhasePreset('phase2_optimal')}
            disabled={updatingTrainingConfig}
          >
            <span class="font-semibold text-sm mb-1">Phase 2: Optimal (Current)</span>
            <span class="text-xs text-gray-500 dark:text-gray-400">~2500-3000 samples, ~30 mins</span>
          </button>
          <button
            class="flex flex-col items-start p-4 bg-white dark:bg-white/5 border-2 border-black/10 dark:border-white/10 rounded-lg cursor-pointer transition-all hover:border-violet-600 dark:hover:border-violet-400 hover:bg-violet-500/5 disabled:opacity-50 disabled:cursor-not-allowed"
            on:click={() => applyPhasePreset('phase3_maximum')}
            disabled={updatingTrainingConfig}
          >
            <span class="font-semibold text-sm mb-1">Phase 3: Maximum</span>
            <span class="text-xs text-gray-500 dark:text-gray-400">~4000-5000 samples, ~45-60 mins</span>
          </button>
        </div>
      </div>

      <div class="mt-4 p-3 bg-violet-500/5 dark:bg-violet-400/10 rounded-lg text-sm text-gray-700 dark:text-gray-300">
        <strong>Current Configuration:</strong>
        Batch size: <span class="font-semibold text-violet-600 dark:text-violet-400">{trainingConfig.curator.batchSize}</span> |
        Max samples: <span class="font-semibold text-violet-600 dark:text-violet-400">{trainingConfig.collection.maxSamplesPerSource}</span> |
        Quality threshold: <span class="font-semibold text-violet-600 dark:text-violet-400">{trainingConfig.curator.qualityThreshold}</span>
      </div>
    </section>
  {/if}

  <!-- Full Cycle Modal (Simplified - Config Only) -->
  {#if showFullCycleModal}
    <div class="fixed inset-0 bg-black/60 flex items-center justify-center z-[1000] p-4" role="presentation" on:click={closeFullCycleModal}>
      <div class="bg-white dark:bg-gray-900 rounded-xl w-full max-w-md max-h-[90vh] overflow-y-auto shadow-2xl" role="dialog" aria-modal="true" on:click|stopPropagation>
        <div class="flex justify-between items-center px-6 py-5 border-b border-black/10 dark:border-white/10">
          <h3 class="m-0 text-xl font-semibold">Run Full Cycle</h3>
          <button class="bg-transparent border-none text-2xl cursor-pointer p-1 w-8 h-8 flex items-center justify-center rounded-full hover:bg-black/10 dark:hover:bg-white/10" on:click={closeFullCycleModal}>×</button>
        </div>
        <div class="p-6">
          {#if trainingModelsError || trainingModels.length === 0}
            <div class="p-5 bg-orange-500/10 dark:bg-orange-500/15 border border-orange-500/30 dark:border-orange-500/40 rounded-lg mb-4">
              <strong class="block mb-2 text-orange-700 dark:text-orange-400">⚠️ No Ollama Models Available</strong>
              <p class="my-2 text-orange-900 dark:text-orange-300 text-sm">No models found in your local Ollama installation. Please pull at least one model using <code class="bg-black/10 dark:bg-white/10 px-1.5 py-0.5 rounded text-[0.85em] font-mono">ollama pull &lt;model&gt;</code></p>
              <p class="my-2">
                <a href={setupGuideLink} target="_blank" class="inline-block px-4 py-2 bg-orange-500 text-white no-underline rounded-md font-medium transition-colors hover:bg-orange-600">
                  📖 View Setup Guide →
                </a>
              </p>
              {#if trainingModelsError}
                <p class="mt-3 p-2 bg-black/5 dark:bg-white/5 rounded text-xs font-mono">{trainingModelsError}</p>
              {/if}
            </div>
          {:else}
            <div class="mb-6">
              <label for="model-select" class="block mb-2 font-medium">Ollama Base Model:</label>
              <select id="model-select" bind:value={selectedModel} class="select-field">
                <option value="">Use default from etc/training.json</option>
                {#each trainingModels as model}
                  <option value={model.id}>
                    {model.name} - {model.size}
                  </option>
                {/each}
              </select>
              <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Select an Ollama model from your local installation to use as the base for LoRA fine-tuning.
              </p>
            </div>
          {/if}
          <div class="mb-6">
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" bind:checked={dualModeEnabled} class="cursor-pointer" />
              <span>Enable Dual Mode (combine historical + recent adapters)</span>
            </label>
            <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">If enabled, combines historical knowledge with recent learnings. Requires historical adapters to be present.</p>
          </div>
          <div class="p-4 bg-blue-500/5 dark:bg-blue-500/10 border border-blue-500/20 dark:border-blue-500/30 rounded-lg mt-2">
            <p class="m-0 text-blue-800 dark:text-blue-300 text-sm"><strong class="text-blue-700 dark:text-blue-400">ℹ️ After starting:</strong> Follow training progress in the <strong>Training Monitor</strong> section below.</p>
          </div>
        </div>
        <div class="px-6 py-4 flex gap-3 justify-end border-t border-black/10 dark:border-white/10">
          <button class="btn-secondary" on:click={closeFullCycleModal}>Cancel</button>
          <button class="btn-primary" on:click={runFullCycleWithParams}>Start Training</button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Training Monitor -->
  <section class="panel border-2 border-violet-500/20 dark:border-violet-400/30">
    <header>
      <div class="flex justify-between items-start gap-4 w-full">
        <div>
          <h3 class="m-0 text-lg font-semibold">🖥️ Training Monitor</h3>
          <p class="mt-1 mb-0 text-gray-500 dark:text-gray-400">Real-time view of active training processes and recent activity.</p>
        </div>
        <button
          class="px-4 py-2 rounded-lg border border-violet-500/30 dark:border-violet-400/30 bg-violet-500/5 dark:bg-violet-400/5 text-violet-600 dark:text-violet-400 cursor-pointer font-medium whitespace-nowrap transition-all hover:bg-violet-500/10 dark:hover:bg-violet-400/10 hover:border-violet-500/50 dark:hover:border-violet-400/50"
          on:click={() => monitorExpanded = !monitorExpanded}
        >
          {monitorExpanded ? '▼ Collapse' : '▶ Expand'}
        </button>
      </div>
    </header>

    <!-- Status Indicator -->
    <div class="flex items-center justify-between gap-4 p-4 bg-black/5 dark:bg-white/5 rounded-lg mt-4">
      {#if fullCycleRunningPid}
        <div class="flex items-center gap-3 px-4 py-2 rounded-lg font-medium text-[0.95rem] bg-green-500/10 dark:bg-green-500/15 text-green-600 dark:text-green-400 border border-green-500/30 dark:border-green-500/40">
          <div class="w-4 h-4 border-2 border-green-500/20 dark:border-green-400/20 border-t-green-600 dark:border-t-green-400 rounded-full animate-spin"></div>
          <span>Training in Progress (PID: {fullCycleRunningPid})</span>
        </div>
        <button
          class="px-3 py-1.5 rounded-lg border border-red-500/40 dark:border-red-400/40 bg-red-500/10 dark:bg-red-400/10 text-red-600 dark:text-red-400 cursor-pointer text-sm font-medium transition-all hover:bg-red-500/20 dark:hover:bg-red-400/20 hover:border-red-500/60 dark:hover:border-red-400/60 disabled:opacity-50 disabled:cursor-not-allowed"
          on:click={cancelFullCycle}
          disabled={cancelling}
        >
          {cancelling ? 'Cancelling...' : '🛑 Cancel'}
        </button>
      {:else}
        <div class="flex items-center gap-3 px-4 py-2 rounded-lg font-medium text-[0.95rem] bg-gray-500/10 dark:bg-gray-400/10 text-gray-600 dark:text-gray-400 border border-gray-500/20 dark:border-gray-400/20">
          <span>No active training</span>
        </div>
      {/if}
    </div>

    {#if monitorExpanded}
      <div class="flex flex-col gap-6 mt-4">
        <!-- Console Output (Local Processing) -->
        <div class="flex-1 flex flex-col min-h-[300px]">
          <h4 class="m-0 mb-3 text-base font-semibold">🖥️ Console Output (Dataset Building, Curator)</h4>
          <div class="flex-1 overflow-y-auto border border-black/10 dark:border-white/10 rounded-lg p-3 bg-gray-900 dark:bg-black/95 text-gray-300 dark:text-gray-200 font-mono text-sm leading-relaxed max-h-[350px]" bind:this={consoleLogsScrollContainer}>
            {#if fullCycleConsoleLogs.length === 0}
              <div class="p-8 text-center text-gray-500 dark:text-gray-400 italic">No console output yet. {fullCycleRunningPid ? 'Waiting for process to start...' : 'Start a training cycle to see output.'}</div>
            {:else}
              {#each fullCycleConsoleLogs as line}
                <div class="py-1 whitespace-pre-wrap break-all hover:bg-violet-500/10">{line}</div>
              {/each}
            {/if}
          </div>
        </div>

        <!-- Audit Events (High-Level Status) -->
        <div class="flex-1 flex flex-col min-h-[150px]">
          <h4 class="m-0 mb-3 text-base font-semibold">📋 Training Events</h4>
          <div class="flex-1 overflow-y-auto border border-black/10 dark:border-white/10 rounded-lg p-3 bg-black/5 dark:bg-white/5 font-mono text-sm max-h-[200px]" bind:this={eventsLogsScrollContainer}>
            {#if fullCycleLogs.length === 0}
              <div class="p-8 text-center text-gray-500 dark:text-gray-400 italic">No training events yet. {fullCycleRunningPid ? 'Waiting for events...' : 'Start a training cycle to see events.'}</div>
            {:else}
              {#each fullCycleLogs as log}
                <div class="flex gap-3 py-2 border-b border-black/5 dark:border-white/5 last:border-b-0">
                  <span class="flex-shrink-0 text-gray-500 dark:text-gray-400 text-xs">{new Date(log.timestamp).toLocaleTimeString()}</span>
                  <span class="flex-shrink-0 font-semibold text-violet-600 dark:text-violet-400 capitalize">{(log.event || 'unknown').replace('full_cycle_', '').replace(/_/g, ' ')}</span>
                  {#if log.details}
                    <span class="flex-1 text-gray-600 dark:text-gray-300 text-xs overflow-hidden text-ellipsis whitespace-nowrap">{JSON.stringify(log.details)}</span>
                  {/if}
                </div>
              {/each}
            {/if}
          </div>
        </div>

        {#if fullCycleRunningPid}
          <div class="p-4 bg-orange-500/5 dark:bg-orange-500/10 rounded-lg">
            <p class="m-0 text-sm text-gray-500 dark:text-gray-400">
              <strong>Note:</strong> The training process may take 30-60 minutes depending on dataset size.
              You can navigate away and check back later.
            </p>
          </div>
        {/if}
      </div>
    {/if}

    <!-- Recent Activity (Compact View) -->
    {#if !monitorExpanded}
      <div class="mt-4 pt-4 border-t border-black/5 dark:border-white/5">
        <h4 class="m-0 mb-3 text-[0.95rem] font-semibold text-gray-600 dark:text-gray-400">Recent Activity</h4>
        <div class="grid gap-1 max-h-[200px] overflow-auto">
          {#each recentLogs.slice(0, 5) as log}
            <div class="grid grid-flow-col auto-cols-max gap-2 text-sm items-baseline">
              <span class="text-gray-500">{new Date(log.timestamp).toLocaleTimeString()}</span>
              <span class="font-semibold">{log.event}</span>
              {#if log.details?.dataset}<span class="text-blue-600">{log.details.dataset}</span>{/if}
              {#if log.details?.modelName}<span class="text-blue-600">{log.details.modelName}</span>{/if}
            </div>
          {/each}
          {#if recentLogs.length === 0}
            <div class="text-gray-500 italic">No recent events</div>
          {/if}
        </div>
      </div>
    {/if}
  </section>

  <section class="panel">
    <header>
      <h3 class="m-0 text-lg font-semibold">Datasets</h3>
      <p class="mt-1 mb-0 text-gray-500 dark:text-gray-400">Review, approve, and run the LoRA pipeline for each nightly dataset.</p>
    </header>

    {#if loading}
      <div class="p-4 text-center text-gray-500">Loading datasets…</div>
    {:else if datasets.length === 0}
      <div class="p-4 text-center text-gray-500">
        <div class="font-semibold mb-1">No datasets available</div>
        <p class="muted">Run adapter-builder to generate instruction pairs.</p>
      </div>
    {:else}
      <table class="w-full border-collapse text-[0.95rem] mt-4">
        <thead>
          <tr>
            <th class="px-2 py-3 text-left align-top border-b border-black/5 dark:border-white/5">Date</th>
            <th class="px-2 py-3 text-left align-top border-b border-black/5 dark:border-white/5">Status</th>
            <th class="px-2 py-3 text-left align-top border-b border-black/5 dark:border-white/5">Pairs</th>
            <th class="px-2 py-3 text-left align-top border-b border-black/5 dark:border-white/5">Approval</th>
            <th class="px-2 py-3 text-left align-top border-b border-black/5 dark:border-white/5">Eval</th>
            <th class="px-2 py-3 text-left align-top border-b border-black/5 dark:border-white/5">Actions</th>
          </tr>
        </thead>
        <tbody>
          {#each datasets as dataset}
            {#key dataset.date}
              <tr>
                <td class="px-2 py-3 align-top border-b border-black/5 dark:border-white/5">
                  <div class="flex flex-wrap gap-1 items-center">
                    <div class="font-semibold">{dataset.date}</div>
                    {#if dataset.status === 'active'}
                      <span class="text-[0.7rem] px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-600 dark:text-green-400">Active</span>
                    {/if}
                    {#if dataset.autoApproved}
                      <span class="text-[0.7rem] px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-600 dark:text-blue-400">Auto</span>
                    {/if}
                    {#if dataset.dryRun}
                      <span class="text-[0.7rem] px-1.5 py-0.5 rounded-full bg-orange-500/15 text-orange-600 dark:text-orange-400">Dry Run</span>
                    {/if}
                  </div>
                </td>
                <td class="px-2 py-3 align-top border-b border-black/5 dark:border-white/5">
                  <span class="inline-flex items-center justify-center min-w-[4.5rem] rounded-full px-2.5 py-1 text-xs capitalize {statusBadge(dataset.status).class}">
                    {statusBadge(dataset.status).label}
                  </span>
                </td>
                <td class="px-2 py-3 align-top border-b border-black/5 dark:border-white/5">{dataset.pairCount}</td>
                <td class="px-2 py-3 align-top border-b border-black/5 dark:border-white/5">
                  {#if dataset.approvedAt}
                    <div class="flex flex-col gap-0.5">
                      <div>{new Date(dataset.approvedAt).toLocaleString()}</div>
                      <div class="muted">by {dataset.approvedBy || 'unknown'}</div>
                      {#if dataset.notes}
                        <div class="muted">{dataset.notes}</div>
                      {/if}
                      {#if dataset.qualityScore}
                        <div class="muted">Quality {dataset.qualityScore.toFixed(0)}/100</div>
                      {/if}
                    </div>
                  {:else}
                    <span class="muted">Pending</span>
                  {/if}
                </td>
                <td class="px-2 py-3 align-top border-b border-black/5 dark:border-white/5">
                  {#if typeof dataset.evalScore === 'number'}
                    <div class="flex flex-col gap-0.5">
                      <div>{dataset.evalScore.toFixed(3)}</div>
                      <div class="text-sm {dataset.evalPassed ? 'text-green-600' : 'text-red-600'}">
                        {dataset.evalPassed ? 'Passed' : 'Failed'}
                      </div>
                    </div>
                  {:else}
                    <span class="muted">Not run</span>
                  {/if}
                </td>
                <td class="px-2 py-3 align-top border-b border-black/5 dark:border-white/5">
                  <div class="flex flex-wrap gap-1">
                    {#if dataset.status === 'pending'}
                      <button class="btn-xs" on:click={() => handleApprove(dataset.date)} disabled={isWorking(dataset.date, 'approve')}>
                        {isWorking(dataset.date, 'approve') ? 'Approving…' : 'Approve'}
                      </button>
                      <button class="btn-xs btn-danger" on:click={() => handleReject(dataset.date)} disabled={isWorking(dataset.date, 'reject')}>
                        {isWorking(dataset.date, 'reject') ? 'Rejecting…' : 'Reject'}
                      </button>
                    {/if}
                    {#if dataset.status === 'approved'}
                      <button class="btn-xs" on:click={() => handleTrain(dataset.date)} disabled={isWorking(dataset.date, 'train')}>
                        {isWorking(dataset.date, 'train') ? 'Starting…' : 'Train'}
                      </button>
                    {/if}
                    {#if dataset.status === 'trained'}
                      <button class="btn-xs" on:click={() => handleEval(dataset.date)} disabled={isWorking(dataset.date, 'eval')}>
                        {isWorking(dataset.date, 'eval') ? 'Evaluating…' : 'Evaluate'}
                      </button>
                    {/if}
                    {#if dataset.status === 'evaluated' && dataset.evalPassed}
                      <button class="btn-xs" on:click={() => handleActivate(dataset.date)} disabled={isWorking(dataset.date, 'activate')}>
                        {isWorking(dataset.date, 'activate') ? 'Activating…' : 'Activate'}
                      </button>
                    {/if}
                    {#if dataset.status !== 'pending'}
                      <button class="btn-xs border-dashed border-red-400/40 text-red-600 dark:text-red-400" on:click={() => handleReject(dataset.date)} disabled={isWorking(dataset.date, 'reject')}>
                        {isWorking(dataset.date, 'reject') ? 'Rejecting…' : 'Archive'}
                      </button>
                    {/if}
                  </div>
                </td>
              </tr>
            {/key}
          {/each}
        </tbody>
      </table>
    {/if}
  </section>

  <section class="panel">
    <header>
      <h3 class="m-0 text-lg font-semibold">Active Adapter</h3>
      <p class="mt-1 mb-0 text-gray-500 dark:text-gray-400">Current LoRA adapter in use by the chat system.</p>
    </header>
    {#if activeAdapter}
      <div class="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3 text-[0.95rem] mt-4">
        <div><strong>Model:</strong> {activeAdapter.modelName}</div>
        <div><strong>Dataset:</strong> {activeAdapter.dataset || 'unknown'}</div>
        <div><strong>Activated:</strong> {new Date(activeAdapter.activatedAt).toLocaleString()}</div>
        {#if typeof activeAdapter.evalScore === 'number'}
          <div><strong>Eval Score:</strong> {activeAdapter.evalScore.toFixed(3)}</div>
        {/if}
        <div><strong>Status:</strong> {activeAdapter.status || 'loaded'}</div>
        <div class="col-span-full break-all">
          <strong>Adapter Path:</strong>
          <code class="ml-2 bg-black/5 dark:bg-white/5 px-2 py-1 rounded text-sm font-mono">{activeAdapter.adapterPath}</code>
        </div>
        {#if activeAdapter.modelfilePath}
          <div class="col-span-full break-all">
            <strong>Modelfile:</strong>
            <code class="ml-2 bg-black/5 dark:bg-white/5 px-2 py-1 rounded text-sm font-mono">{activeAdapter.modelfilePath}</code>
          </div>
        {/if}
      </div>
    {:else}
      <p class="muted mt-4">No active adapter configured. Chat will use the base model.</p>
    {/if}
  </section>
</div>

<style>
  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  @keyframes pulse {
    0% { transform: scale(0.7); opacity: 0.6; }
    80% { transform: scale(1.4); opacity: 0; }
    100% { transform: scale(1.6); opacity: 0; }
  }

  @keyframes slideDown {
    from { opacity: 0; transform: translateY(-10px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .animate-spin { animation: spin 0.8s linear infinite; }
  .animate-slideDown { animation: slideDown 0.3s ease-out; }
  .animate-status-dot::after {
    content: '';
    position: absolute;
    inset: -6px;
    border: 2px solid currentColor;
    border-radius: 50%;
    animation: pulse 1.5s infinite ease-out;
    opacity: 0.5;
  }
</style>
