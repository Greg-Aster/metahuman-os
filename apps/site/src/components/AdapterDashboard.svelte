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

  async function runNightProcessorNow() {
    try {
      await sendAction('runNightProcessor', {});
      alert('Night processor started (transcriber + audio-organizer).');
    } catch (err) {
      alert((err as Error).message);
    }
  }

  async function startSleepService() {
    try {
      await sendAction('startSleepService', {});
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
        return { label: 'Pending', class: 'status-pending' };
      case 'approved':
        return { label: 'Approved', class: 'status-approved' };
      case 'trained':
        return { label: 'Trained', class: 'status-trained' };
      case 'evaluated':
        return { label: 'Evaluated', class: 'status-evaluated' };
      case 'active':
        return { label: 'Active', class: 'status-active' };
      default:
        return { label: status, class: 'status-pending' };
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

<div class="adapter-dashboard">
  <div class="header">
    <div>
      <h2>🧠 LoRA Adaptation</h2>
      <p>Manage datasets, training, and activation directly from the UI.</p>
    </div>
    <button class="refresh-btn" on:click={loadData} disabled={loading}>
      {loading ? 'Refreshing…' : 'Refresh'}
    </button>
  </div>

  <!-- Error/Warning Banner -->
  {#if error}
    <div class="error-banner">
      <div class="error-icon">⚠️</div>
      <div class="error-content">
        <strong>Connection Issue</strong>
        <p>{error}</p>
        {#if error.includes('timeout') || error.includes('timed out')}
          <p class="error-hint">The server may be overloaded. Try refreshing or check if Ollama is stuck.</p>
        {/if}
      </div>
      <button class="error-dismiss" on:click={() => error = null}>×</button>
    </div>
  {/if}

  <!-- Animated status line -->
  <div class="status-line">
    {#if activeAdapter}
      <div class="dot {activeAdapter?.status === 'loaded' ? 'ok' : 'pending'}"></div>
      <span>
        {#if activeAdapter?.status === 'loaded'}
          Active model loaded in Ollama: {activeAdapter.modelName}
        {:else}
          Adapter activated ({activeAdapter.modelName}); awaiting Ollama create (status: {activeAdapter.status || 'pending'})
        {/if}
      </span>
    {:else}
      <div class="dot pending"></div>
      <span>No active adapter</span>
    {/if}
  </div>

  {#if error}
    <div class="error-box">
      <strong>Error:</strong> {error}
    </div>
  {/if}

  <section class="card">
    <header>
      <h3>Autonomy Controls</h3>
      <p>Nightly LoRA pipeline settings (no file edits needed).</p>
    </header>
    <div class="actions-row">
      <button class="action" on:click={runBuilderNow}>Run Builder Now</button>
      <button class="action" on:click={runDreamerNow}>Run Dreamer</button>
      <button class="action" on:click={runNightProcessorNow}>Run Night Processor</button>
      <button class="action" on:click={startSleepService}>Start Sleep Service</button>
      <button class="action" on:click={runFullCycleNow}>Run Full Cycle Now</button>
      <button class="action" on:click={exportConversationsNow}>Export Conversations</button>
      <button class="action highlight" on:click={mergeHistoricalAdapters}>🔀 Merge Historical Adapters</button>
    </div>
    <div class="config-grid">
      <label class="switch-row">
        <span>Enable LoRA (sleep.json)</span>
        <input type="checkbox" checked={loraEnabled} on:change={onToggleLoraEnabled} />
      </label>
      {#if autoApproval}
        <label class="switch-row">
          <span>Auto-Approval Enabled</span>
          <input type="checkbox" checked={autoApproval.enabled} disabled={updatingConfig} on:change={onToggleEnabled} />
        </label>
        <label class="switch-row">
          <span>Dry Run Mode</span>
          <input type="checkbox" checked={autoApproval.dryRun} disabled={updatingConfig} on:change={onToggleDryRun} />
        </label>
        <label class="switch-row">
          <span>Auto Train</span>
          <input type="checkbox" checked={getAutoFlag('autoTrain')} on:change={onToggleAutoTrain} />
        </label>
        <label class="switch-row">
          <span>Auto Evaluate</span>
          <input type="checkbox" checked={getAutoFlag('autoEval')} on:change={onToggleAutoEval} />
        </label>
        <label class="switch-row">
          <span>Auto Activate</span>
          <input type="checkbox" checked={getAutoFlag('autoActivate')} on:change={onToggleAutoActivate} />
        </label>
        <div class="thresholds">
          <div class="threshold">Min pairs: <strong>{autoApproval.thresholds.minPairs}</strong></div>
          <div class="threshold">High confidence ≥ <strong>{Math.round(autoApproval.thresholds.minHighConfidence * 100)}%</strong></div>
          <div class="threshold">Reflections ≥ <strong>{Math.round(autoApproval.thresholds.minReflectionPct * 100)}%</strong></div>
          <div class="threshold">Low confidence ≤ <strong>{Math.round(autoApproval.thresholds.maxLowConfidence * 100)}%</strong></div>
        </div>
      {:else}
        <p class="muted">Auto-approval config not available.</p>
      {/if}
    </div>
  </section>

  <!-- Training Data Configuration -->
  {#if trainingConfig}
    <section class="card">
      <header>
        <h3>📊 Training Data Configuration</h3>
        <p>Configure data collection and curation settings for LoRA adapter training.</p>
      </header>

      <div class="training-config-grid">
        <div class="config-section">
          <h4>Curator Settings</h4>
          <div class="form-row">
            <label for="batch-size">Batch Size:</label>
            <input
              id="batch-size"
              type="number"
              min="10"
              max="200"
              step="10"
              value={trainingConfig.curator.batchSize}
              disabled={updatingTrainingConfig}
              on:change={(e) => updateTrainingConfig({ curator: { batchSize: parseInt(e.currentTarget.value) } })}
            />
            <span class="help-hint">Samples processed per curator call (10-200)</span>
          </div>
          <div class="form-row">
            <label for="quality-threshold">Quality Threshold:</label>
            <input
              id="quality-threshold"
              type="number"
              min="0"
              max="10"
              step="0.1"
              value={trainingConfig.curator.qualityThreshold}
              disabled={updatingTrainingConfig}
              on:change={(e) => updateTrainingConfig({ curator: { qualityThreshold: parseFloat(e.currentTarget.value) } })}
            />
            <span class="help-hint">Minimum quality score (0-10)</span>
          </div>
          <div class="form-row">
            <label for="temperature">Temperature:</label>
            <input
              id="temperature"
              type="number"
              min="0"
              max="2"
              step="0.1"
              value={trainingConfig.curator.temperature}
              disabled={updatingTrainingConfig}
              on:change={(e) => updateTrainingConfig({ curator: { temperature: parseFloat(e.currentTarget.value) } })}
            />
            <span class="help-hint">LLM temperature (0-2)</span>
          </div>
        </div>

        <div class="config-section">
          <h4>Collection Settings</h4>
          <div class="form-row">
            <label for="max-samples">Max Samples/Source:</label>
            <input
              id="max-samples"
              type="number"
              min="100"
              max="10000"
              step="100"
              value={trainingConfig.collection.maxSamplesPerSource}
              disabled={updatingTrainingConfig}
              on:change={(e) => updateTrainingConfig({ collection: { maxSamplesPerSource: parseInt(e.currentTarget.value) } })}
            />
            <span class="help-hint">Maximum samples per memory type (100-10000)</span>
          </div>
          <div class="form-row">
            <label for="max-days">Max Days:</label>
            <input
              id="max-days"
              type="number"
              min="1"
              max="999999"
              value={trainingConfig.collection.maxDays}
              disabled={updatingTrainingConfig}
              on:change={(e) => updateTrainingConfig({ collection: { maxDays: parseInt(e.currentTarget.value) } })}
            />
            <span class="help-hint">Days of history to include (999999 = all time)</span>
          </div>
        </div>
      </div>

      <div class="phase-presets">
        <h4>Quick Presets</h4>
        <div class="preset-buttons">
          <button class="preset-btn" on:click={() => applyPhasePreset('phase1_conservative')} disabled={updatingTrainingConfig}>
            <span class="preset-name">Phase 1: Conservative</span>
            <span class="preset-desc">~800-1200 samples, ~15 mins</span>
          </button>
          <button class="preset-btn active" on:click={() => applyPhasePreset('phase2_optimal')} disabled={updatingTrainingConfig}>
            <span class="preset-name">Phase 2: Optimal (Current)</span>
            <span class="preset-desc">~2500-3000 samples, ~30 mins</span>
          </button>
          <button class="preset-btn" on:click={() => applyPhasePreset('phase3_maximum')} disabled={updatingTrainingConfig}>
            <span class="preset-name">Phase 3: Maximum</span>
            <span class="preset-desc">~4000-5000 samples, ~45-60 mins</span>
          </button>
        </div>
      </div>

      <div class="current-status">
        <strong>Current Configuration:</strong>
        Batch size: <span class="highlight">{trainingConfig.curator.batchSize}</span> |
        Max samples: <span class="highlight">{trainingConfig.collection.maxSamplesPerSource}</span> |
        Quality threshold: <span class="highlight">{trainingConfig.curator.qualityThreshold}</span>
      </div>
    </section>
  {/if}

  <!-- Full Cycle Modal (Simplified - Config Only) -->
  {#if showFullCycleModal}
    <div class="modal-overlay" role="presentation" on:click={closeFullCycleModal}>
      <div class="modal-content" role="dialog" aria-modal="true" on:click|stopPropagation>
        <div class="modal-header">
          <h3>Run Full Cycle</h3>
          <button class="modal-close" on:click={closeFullCycleModal}>×</button>
        </div>
        <div class="modal-body">
          {#if trainingModelsError || trainingModels.length === 0}
            <div class="warning-box">
              <strong>⚠️ No Ollama Models Available</strong>
              <p>No models found in your local Ollama installation. Please pull at least one model using <code>ollama pull &lt;model&gt;</code></p>
              <p>
                <a href={setupGuideLink} target="_blank" class="setup-link">
                  📖 View Setup Guide →
                </a>
              </p>
              {#if trainingModelsError}
                <p class="error-detail">{trainingModelsError}</p>
              {/if}
            </div>
          {:else}
            <div class="form-group">
              <label for="model-select">Ollama Base Model:</label>
              <select id="model-select" bind:value={selectedModel}>
                <option value="">Use default from etc/training.json</option>
                {#each trainingModels as model}
                  <option value={model.id}>
                    {model.name} - {model.size}
                  </option>
                {/each}
              </select>
              <p class="help-text">
                Select an Ollama model from your local installation to use as the base for LoRA fine-tuning.
              </p>
            </div>
          {/if}
          <div class="form-group">
            <label class="checkbox-label">
              <input type="checkbox" bind:checked={dualModeEnabled} />
              <span>Enable Dual Mode (combine historical + recent adapters)</span>
            </label>
            <p class="help-text">If enabled, combines historical knowledge with recent learnings. Requires historical adapters to be present.</p>
          </div>
          <div class="info-box">
            <p><strong>ℹ️ After starting:</strong> Follow training progress in the <strong>Training Monitor</strong> section below.</p>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" on:click={closeFullCycleModal}>Cancel</button>
          <button class="btn-primary" on:click={runFullCycleWithParams}>Start Training</button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Training Monitor -->
  <section class="card training-monitor">
    <header>
      <div class="monitor-header-content">
        <div>
          <h3>🖥️ Training Monitor</h3>
          <p>Real-time view of active training processes and recent activity.</p>
        </div>
        <button class="toggle-btn" on:click={() => monitorExpanded = !monitorExpanded}>
          {monitorExpanded ? '▼ Collapse' : '▶ Expand'}
        </button>
      </div>
    </header>

    <!-- Status Indicator -->
    <div class="monitor-status">
      {#if fullCycleRunningPid}
        <div class="status-badge running">
          <div class="spinner-small"></div>
          <span>Training in Progress (PID: {fullCycleRunningPid})</span>
        </div>
        <button class="btn-danger-small" on:click={cancelFullCycle} disabled={cancelling}>
          {cancelling ? 'Cancelling...' : '🛑 Cancel'}
        </button>
      {:else}
        <div class="status-badge idle">
          <span>No active training</span>
        </div>
      {/if}
    </div>

    {#if monitorExpanded}
      <div class="monitor-content">
        <!-- Console Output (Local Processing) -->
        <div class="logs-container">
          <h4>🖥️ Console Output (Dataset Building, Curator)</h4>
          <div class="logs-scroll console-output" bind:this={consoleLogsScrollContainer}>
            {#if fullCycleConsoleLogs.length === 0}
              <div class="log-empty">No console output yet. {fullCycleRunningPid ? 'Waiting for process to start...' : 'Start a training cycle to see output.'}</div>
            {:else}
              {#each fullCycleConsoleLogs as line}
                <div class="console-line">{line}</div>
              {/each}
            {/if}
          </div>
        </div>

        <!-- Audit Events (High-Level Status) -->
        <div class="logs-container compact">
          <h4>📋 Training Events</h4>
          <div class="logs-scroll events-output" bind:this={eventsLogsScrollContainer}>
            {#if fullCycleLogs.length === 0}
              <div class="log-empty">No training events yet. {fullCycleRunningPid ? 'Waiting for events...' : 'Start a training cycle to see events.'}</div>
            {:else}
              {#each fullCycleLogs as log}
                <div class="log-entry">
                  <span class="log-timestamp">{new Date(log.timestamp).toLocaleTimeString()}</span>
                  <span class="log-event">{(log.event || 'unknown').replace('full_cycle_', '').replace(/_/g, ' ')}</span>
                  {#if log.details}
                    <span class="log-details">{JSON.stringify(log.details)}</span>
                  {/if}
                </div>
              {/each}
            {/if}
          </div>
        </div>

        {#if fullCycleRunningPid}
          <div class="progress-footer">
            <p class="help-text">
              <strong>Note:</strong> The training process may take 30-60 minutes depending on dataset size.
              You can navigate away and check back later.
            </p>
          </div>
        {/if}
      </div>
    {/if}

    <!-- Recent Activity (Compact View) -->
    {#if !monitorExpanded}
      <div class="recent-activity-compact">
        <h4>Recent Activity</h4>
        <div class="log-list">
          {#each recentLogs.slice(0, 5) as log}
            <div class="log-item">
              <span class="log-time">{new Date(log.timestamp).toLocaleTimeString()}</span>
              <span class="log-evt">{log.event}</span>
              {#if log.details?.dataset}<span class="log-ds">{log.details.dataset}</span>{/if}
              {#if log.details?.modelName}<span class="log-ds">{log.details.modelName}</span>{/if}
            </div>
          {/each}
          {#if recentLogs.length === 0}
            <div class="empty">No recent events</div>
          {/if}
        </div>
      </div>
    {/if}
  </section>

  <section class="card">
    <header>
      <h3>Datasets</h3>
      <p>Review, approve, and run the LoRA pipeline for each nightly dataset.</p>
    </header>

    {#if loading}
      <div class="loading">Loading datasets…</div>
    {:else if datasets.length === 0}
      <div class="empty">
        <div class="empty-title">No datasets available</div>
        <p class="muted">Run sleep-service or adapter-builder to generate instruction pairs.</p>
      </div>
    {:else}
      <table class="dataset-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Status</th>
            <th>Pairs</th>
            <th>Approval</th>
            <th>Eval</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {#each datasets as dataset}
            {#key dataset.date}
              <tr>
                <td>
                  <div class="date-cell">
                    <div class="date-value">{dataset.date}</div>
                    {#if dataset.status === 'active'}
                      <span class="badge badge-active">Active</span>
                    {/if}
                    {#if dataset.autoApproved}
                      <span class="badge badge-auto">Auto</span>
                    {/if}
                    {#if dataset.dryRun}
                      <span class="badge badge-dry">Dry Run</span>
                    {/if}
                  </div>
                </td>
                <td>
                  <span class={"status-badge " + statusBadge(dataset.status).class}>
                    {statusBadge(dataset.status).label}
                  </span>
                </td>
                <td>{dataset.pairCount}</td>
                <td>
                  {#if dataset.approvedAt}
                    <div class="meta">
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
                <td>
                  {#if typeof dataset.evalScore === 'number'}
                    <div class="meta">
                      <div>{dataset.evalScore.toFixed(3)}</div>
                      <div class={`muted ${dataset.evalPassed ? 'pass' : 'fail'}`}>
                        {dataset.evalPassed ? 'Passed' : 'Failed'}
                      </div>
                    </div>
                  {:else}
                    <span class="muted">Not run</span>
                  {/if}
                </td>
                <td>
                  <div class="actions">
                    {#if dataset.status === 'pending'}
                      <button class="action" on:click={() => handleApprove(dataset.date)} disabled={isWorking(dataset.date, 'approve')}>
                        {isWorking(dataset.date, 'approve') ? 'Approving…' : 'Approve'}
                      </button>
                      <button class="action danger" on:click={() => handleReject(dataset.date)} disabled={isWorking(dataset.date, 'reject')}>
                        {isWorking(dataset.date, 'reject') ? 'Rejecting…' : 'Reject'}
                      </button>
                    {/if}
                    {#if dataset.status === 'approved'}
                      <button class="action" on:click={() => handleTrain(dataset.date)} disabled={isWorking(dataset.date, 'train')}>
                        {isWorking(dataset.date, 'train') ? 'Starting…' : 'Train'}
                      </button>
                    {/if}
                    {#if dataset.status === 'trained'}
                      <button class="action" on:click={() => handleEval(dataset.date)} disabled={isWorking(dataset.date, 'eval')}>
                        {isWorking(dataset.date, 'eval') ? 'Evaluating…' : 'Evaluate'}
                      </button>
                    {/if}
                    {#if dataset.status === 'evaluated' && dataset.evalPassed}
                      <button class="action" on:click={() => handleActivate(dataset.date)} disabled={isWorking(dataset.date, 'activate')}>
                        {isWorking(dataset.date, 'activate') ? 'Activating…' : 'Activate'}
                      </button>
                    {/if}
                    {#if dataset.status !== 'pending'}
                      <button class="action danger subtle" on:click={() => handleReject(dataset.date)} disabled={isWorking(dataset.date, 'reject')}>
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

  <section class="card">
    <header>
      <h3>Active Adapter</h3>
      <p>Current LoRA adapter in use by the chat system.</p>
    </header>
    {#if activeAdapter}
      <div class="meta-grid">
        <div><strong>Model:</strong> {activeAdapter.modelName}</div>
        <div><strong>Dataset:</strong> {activeAdapter.dataset || 'unknown'}</div>
        <div><strong>Activated:</strong> {new Date(activeAdapter.activatedAt).toLocaleString()}</div>
        {#if typeof activeAdapter.evalScore === 'number'}
          <div><strong>Eval Score:</strong> {activeAdapter.evalScore.toFixed(3)}</div>
        {/if}
        <div><strong>Status:</strong> {activeAdapter.status || 'loaded'}</div>
        <div class="path-label">
          <strong>Adapter Path:</strong>
          <code>{activeAdapter.adapterPath}</code>
        </div>
        {#if activeAdapter.modelfilePath}
          <div class="path-label">
            <strong>Modelfile:</strong>
            <code>{activeAdapter.modelfilePath}</code>
          </div>
        {/if}
      </div>
    {:else}
      <p class="muted">No active adapter configured. Chat will use the base model.</p>
    {/if}
  </section>
</div>

<style>
  .adapter-dashboard {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    padding: 1.5rem 2rem;
    overflow-y: auto;
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }

  .header h2 {
    margin: 0;
    font-size: 1.5rem;
  }

  .header p {
    margin: 0.25rem 0 0;
    color: rgb(107 114 128);
  }

  .refresh-btn {
    padding: 0.5rem 1rem;
    border-radius: 0.5rem;
    border: 1px solid rgba(0, 0, 0, 0.1);
    background: white;
    cursor: pointer;
  }

  .status-line { display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0; border-top: 1px dashed rgba(0,0,0,0.1); border-bottom: 1px dashed rgba(0,0,0,0.1); margin-bottom: 0.75rem; }
  .dot { width: 10px; height: 10px; border-radius: 50%; background: #f59e0b; position: relative; }
  .dot::after { content: ''; position: absolute; inset: -6px; border: 2px solid currentColor; border-radius: 50%; animation: pulse 1.5s infinite ease-out; opacity: 0.5; }
  .dot.ok { color: #10b981; background: #10b981; }
  .dot.pending { color: #f59e0b; background: #f59e0b; }
  @keyframes pulse { 0% { transform: scale(0.7); opacity: 0.6 } 80% { transform: scale(1.4); opacity: 0 } 100% { transform: scale(1.6); opacity: 0 } }

  .log-list { display: grid; gap: 0.25rem; max-height: 200px; overflow: auto; }
  .log-item { display: grid; grid-auto-flow: column; grid-auto-columns: max-content; gap: 0.5rem; font-size: 0.85rem; align-items: baseline; }
  .log-time { color: #6b7280; }
  .log-evt { font-weight: 600; }
  .log-ds { color: #2563eb; }
  .empty { color: #6b7280; font-style: italic; }

  :global(.dark) .refresh-btn {
    background: rgba(255, 255, 255, 0.05);
    border-color: rgba(255, 255, 255, 0.1);
    color: rgb(243 244 246);
  }

  .card {
    border: 1px solid rgba(0, 0, 0, 0.08);
    border-radius: 0.75rem;
    padding: 1.25rem;
    background: white;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  :global(.dark) .card {
    background: rgba(17, 24, 39, 0.6);
    border-color: rgba(255, 255, 255, 0.08);
  }

  header h3 {
    margin: 0;
    font-size: 1.2rem;
  }

  header p {
    margin: 0.25rem 0 0;
    color: rgb(107 114 128);
  }

  .config-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 1rem;
    align-items: flex-start;
  }

  .switch-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: rgba(0, 0, 0, 0.04);
    border-radius: 0.5rem;
    padding: 0.75rem 1rem;
  }

  :global(.dark) .switch-row {
    background: rgba(255, 255, 255, 0.05);
  }

  .thresholds {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    font-size: 0.9rem;
    background: rgba(0, 0, 0, 0.02);
    border-radius: 0.5rem;
    padding: 0.75rem;
  }

  :global(.dark) .thresholds {
    background: rgba(255, 255, 255, 0.03);
  }

  .threshold strong {
    font-weight: 600;
  }

  .dataset-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.95rem;
  }

  .dataset-table th,
  .dataset-table td {
    padding: 0.75rem 0.5rem;
    text-align: left;
    vertical-align: top;
    border-bottom: 1px solid rgba(0, 0, 0, 0.05);
  }

  :global(.dark) .dataset-table th,
  :global(.dark) .dataset-table td {
    border-bottom-color: rgba(255, 255, 255, 0.06);
  }

  .date-cell {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    align-items: center;
  }

  .date-value {
    font-weight: 600;
  }

  .badge {
    font-size: 0.7rem;
    padding: 0.1rem 0.4rem;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.08);
  }

  .badge-auto {
    background: rgba(59, 130, 246, 0.15);
    color: rgb(37, 99, 235);
  }

  .badge-active {
    background: rgba(34, 197, 94, 0.15);
    color: rgb(22, 163, 74);
  }

  .badge-dry {
    background: rgba(249, 115, 22, 0.15);
    color: rgb(217, 119, 6);
  }

  .status-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 4.5rem;
    border-radius: 999px;
    padding: 0.2rem 0.6rem;
    font-size: 0.75rem;
    text-transform: capitalize;
  }

  .status-pending { background: rgba(156, 163, 175, 0.2); color: rgb(75, 85, 99); }
  .status-approved { background: rgba(59, 130, 246, 0.2); color: rgb(37, 99, 235); }
  .status-trained { background: rgba(139, 92, 246, 0.2); color: rgb(124, 58, 237); }
  .status-evaluated { background: rgba(251, 191, 36, 0.2); color: rgb(217, 119, 6); }
  .status-active { background: rgba(34, 197, 94, 0.2); color: rgb(22, 163, 74); }

  .meta {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .muted {
    color: rgb(107 114 128);
  }

  :global(.dark) .muted {
    color: rgb(156 163 175);
  }

  .muted.pass { color: rgb(22, 163, 74); }
  .muted.fail { color: rgb(220, 38, 38); }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .actions-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .action {
    padding: 0.4rem 0.7rem;
    border-radius: 0.5rem;
    border: 1px solid rgba(0, 0, 0, 0.1);
    background: white;
    cursor: pointer;
    font-size: 0.8rem;
  }

  .action:disabled {
    opacity: 0.6;
    cursor: wait;
  }

  .action.danger {
    border-color: rgba(248, 113, 113, 0.4);
    color: rgb(220, 38, 38);
  }

  .action.danger.subtle {
    border-style: dashed;
  }

  .action.highlight {
    background: linear-gradient(135deg, rgb(124 58 237), rgb(59 130 246));
    color: white;
    border-color: transparent;
    font-weight: 600;
  }

  .action.highlight:hover:not(:disabled) {
    background: linear-gradient(135deg, rgb(109 40 217), rgb(37 99 235));
  }

  :global(.dark) .action {
    background: rgba(255, 255, 255, 0.05);
    color: rgb(243 244 246);
    border-color: rgba(255, 255, 255, 0.1);
  }

  .loading,
  .empty {
    padding: 1rem;
    text-align: center;
    color: rgb(107 114 128);
  }

  .empty-title {
    font-weight: 600;
    margin-bottom: 0.25rem;
  }

  .error-box {
    background: rgba(239, 68, 68, 0.12);
    border: 1px solid rgba(239, 68, 68, 0.2);
    border-radius: 0.5rem;
    padding: 0.75rem 1rem;
  }

  .meta-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 0.75rem;
    font-size: 0.95rem;
  }

  .path-label {
    grid-column: 1 / -1;
    word-break: break-all;
  }
  
  /* Modal Styles */
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 1rem;
  }

  .modal-content {
    background: white;
    border-radius: 0.75rem;
    width: 100%;
    max-width: 500px;
    max-height: 90vh;
    overflow-y: auto;
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2);
  }

  :global(.dark) .modal-content {
    background: #111827;
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1.25rem 1.5rem;
    border-bottom: 1px solid rgba(0, 0, 0, 0.1);
  }

  :global(.dark) .modal-header {
    border-bottom-color: rgba(255, 255, 255, 0.1);
  }

  .modal-header h3 {
    margin: 0;
    font-size: 1.25rem;
  }

  .modal-close {
    background: none;
    border: none;
    font-size: 1.5rem;
    cursor: pointer;
    padding: 0.25rem;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
  }

  .modal-close:hover {
    background: rgba(0, 0, 0, 0.1);
  }

  :global(.dark) .modal-close:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  .modal-body {
    padding: 1.5rem;
  }

  .modal-footer {
    padding: 1rem 1.5rem;
    display: flex;
    gap: 0.75rem;
    justify-content: flex-end;
    border-top: 1px solid rgba(0, 0, 0, 0.1);
  }

  :global(.dark) .modal-footer {
    border-top-color: rgba(255, 255, 255, 0.1);
  }

  .btn-primary {
    background: #7c3aed;
    color: white;
    border: none;
    padding: 0.5rem 1rem;
    border-radius: 0.5rem;
    cursor: pointer;
    font-weight: 500;
  }

  .btn-primary:hover {
    background: #6d28d9;
  }

  .btn-secondary {
    background: rgba(0, 0, 0, 0.08);
    border: 1px solid rgba(0, 0, 0, 0.2);
    padding: 0.5rem 1rem;
    border-radius: 0.5rem;
    cursor: pointer;
  }

  :global(.dark) .btn-secondary {
    background: rgba(255, 255, 255, 0.05);
    border-color: rgba(255, 255, 255, 0.2);
    color: rgb(243 244 246);
  }

  .form-group {
    margin-bottom: 1.5rem;
  }

  .form-group label {
    display: block;
    margin-bottom: 0.5rem;
    font-weight: 500;
  }

  .form-group select {
    width: 100%;
    padding: 0.5rem;
    border: 1px solid rgba(0, 0, 0, 0.2);
    border-radius: 0.5rem;
    background: white;
  }

  :global(.dark) .form-group select {
    background: #1f2937;
    color: white;
    border-color: rgba(255, 255, 255, 0.2);
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
  }

  .checkbox-label input {
    cursor: pointer;
  }

  .help-text {
    margin-top: 0.25rem;
    font-size: 0.85rem;
    color: #6b7280;
  }

  :global(.dark) .help-text {
    color: #9ca3af;
  }

  .warning-box {
    padding: 1.25rem;
    background: rgba(249, 115, 22, 0.1);
    border: 1px solid rgba(249, 115, 22, 0.3);
    border-radius: 0.5rem;
    margin-bottom: 1rem;
  }

  :global(.dark) .warning-box {
    background: rgba(249, 115, 22, 0.15);
    border-color: rgba(249, 115, 22, 0.4);
  }

  .warning-box strong {
    display: block;
    margin-bottom: 0.5rem;
    color: rgb(194, 65, 12);
    font-size: 1rem;
  }

  :global(.dark) .warning-box strong {
    color: rgb(251, 146, 60);
  }

  .warning-box p {
    margin: 0.5rem 0;
    color: rgb(124, 45, 18);
    font-size: 0.875rem;
  }

  :global(.dark) .warning-box p {
    color: rgb(253, 186, 116);
  }

  .warning-box code {
    background: rgba(0, 0, 0, 0.1);
    padding: 0.125rem 0.375rem;
    border-radius: 0.25rem;
    font-family: monospace;
    font-size: 0.85em;
  }

  :global(.dark) .warning-box code {
    background: rgba(255, 255, 255, 0.1);
  }

  .setup-link {
    display: inline-block;
    padding: 0.5rem 1rem;
    background: rgb(249, 115, 22);
    color: white;
    text-decoration: none;
    border-radius: 0.375rem;
    font-weight: 500;
    transition: background 0.2s;
  }

  .setup-link:hover {
    background: rgb(234, 88, 12);
  }

  .error-detail {
    margin-top: 0.75rem;
    padding: 0.5rem;
    background: rgba(0, 0, 0, 0.05);
    border-radius: 0.25rem;
    font-size: 0.8rem;
    font-family: monospace;
  }

  :global(.dark) .error-detail {
    background: rgba(255, 255, 255, 0.05);
  }

  /* Training Data Configuration Styles */
  .training-config-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 1.5rem;
    margin-bottom: 1.5rem;
  }

  .config-section h4 {
    margin: 0 0 1rem 0;
    font-size: 1rem;
    font-weight: 600;
    color: rgb(17 24 39);
  }

  :global(.dark) .config-section h4 {
    color: rgb(243 244 246);
  }

  .form-row {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }

  .form-row label {
    font-size: 0.875rem;
    font-weight: 500;
    color: rgb(55 65 81);
  }

  :global(.dark) .form-row label {
    color: rgb(209 213 219);
  }

  .form-row input[type="number"] {
    padding: 0.5rem 0.75rem;
    border: 1px solid rgba(0, 0, 0, 0.2);
    border-radius: 0.375rem;
    background: white;
    font-size: 0.875rem;
  }

  :global(.dark) .form-row input[type="number"] {
    background: #1f2937;
    border-color: rgba(255, 255, 255, 0.2);
    color: white;
  }

  .form-row input[type="number"]:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .help-hint {
    font-size: 0.75rem;
    color: rgb(107 114 128);
    font-style: italic;
  }

  :global(.dark) .help-hint {
    color: rgb(156 163 175);
  }

  .phase-presets {
    margin-top: 1.5rem;
    padding-top: 1.5rem;
    border-top: 1px solid rgba(0, 0, 0, 0.1);
  }

  :global(.dark) .phase-presets {
    border-top-color: rgba(255, 255, 255, 0.1);
  }

  .phase-presets h4 {
    margin: 0 0 1rem 0;
    font-size: 1rem;
    font-weight: 600;
    color: rgb(17 24 39);
  }

  :global(.dark) .phase-presets h4 {
    color: rgb(243 244 246);
  }

  .preset-buttons {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 0.75rem;
  }

  .preset-btn {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    padding: 1rem;
    background: white;
    border: 2px solid rgba(0, 0, 0, 0.1);
    border-radius: 0.5rem;
    cursor: pointer;
    transition: all 0.2s;
  }

  :global(.dark) .preset-btn {
    background: rgba(255, 255, 255, 0.05);
    border-color: rgba(255, 255, 255, 0.1);
  }

  .preset-btn:hover:not(:disabled) {
    border-color: rgb(124 58 237);
    background: rgba(124, 58, 237, 0.05);
  }

  :global(.dark) .preset-btn:hover:not(:disabled) {
    border-color: rgb(167 139 250);
    background: rgba(167, 139, 250, 0.05);
  }

  .preset-btn.active {
    border-color: rgb(124 58 237);
    background: rgba(124, 58, 237, 0.1);
  }

  :global(.dark) .preset-btn.active {
    border-color: rgb(167 139 250);
    background: rgba(167, 139, 250, 0.1);
  }

  .preset-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .preset-name {
    font-weight: 600;
    font-size: 0.875rem;
    margin-bottom: 0.25rem;
    color: rgb(17 24 39);
  }

  :global(.dark) .preset-name {
    color: rgb(243 244 246);
  }

  .preset-desc {
    font-size: 0.75rem;
    color: rgb(107 114 128);
  }

  :global(.dark) .preset-desc {
    color: rgb(156 163 175);
  }

  .current-status {
    margin-top: 1rem;
    padding: 0.75rem 1rem;
    background: rgba(124, 58, 237, 0.05);
    border-radius: 0.5rem;
    font-size: 0.875rem;
    color: rgb(55 65 81);
  }

  :global(.dark) .current-status {
    background: rgba(167, 139, 250, 0.1);
    color: rgb(209 213 219);
  }

  .current-status .highlight {
    font-weight: 600;
    color: rgb(124 58 237);
  }

  :global(.dark) .current-status .highlight {
    color: rgb(167 139 250);
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* Logs Container Styles (used in Training Monitor) */
  .logs-container {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 300px;
  }

  .logs-container h4 {
    margin: 0 0 0.75rem 0;
    font-size: 1rem;
    font-weight: 600;
    color: rgb(17 24 39);
  }

  :global(.dark) .logs-container h4 {
    color: rgb(243 244 246);
  }

  .logs-scroll {
    flex: 1;
    overflow-y: auto;
    border: 1px solid rgba(0, 0, 0, 0.1);
    border-radius: 0.5rem;
    padding: 0.75rem;
    background: rgba(0, 0, 0, 0.02);
    font-family: 'Courier New', monospace;
    font-size: 0.875rem;
    max-height: 350px;
  }

  :global(.dark) .logs-scroll {
    border-color: rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.02);
  }

  .log-empty {
    padding: 2rem;
    text-align: center;
    color: rgb(107 114 128);
    font-style: italic;
  }

  :global(.dark) .log-empty {
    color: rgb(156 163 175);
  }

  .log-entry {
    display: flex;
    gap: 0.75rem;
    padding: 0.5rem 0;
    border-bottom: 1px solid rgba(0, 0, 0, 0.05);
  }

  .log-entry:last-child {
    border-bottom: none;
  }

  :global(.dark) .log-entry {
    border-bottom-color: rgba(255, 255, 255, 0.05);
  }

  .log-timestamp {
    flex-shrink: 0;
    color: rgb(107 114 128);
    font-size: 0.75rem;
  }

  :global(.dark) .log-timestamp {
    color: rgb(156 163 175);
  }

  .log-event {
    flex-shrink: 0;
    font-weight: 600;
    color: rgb(124 58 237);
    text-transform: capitalize;
  }

  :global(.dark) .log-event {
    color: rgb(167 139 250);
  }

  .log-details {
    flex: 1;
    color: rgb(75 85 99);
    font-size: 0.75rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  :global(.dark) .log-details {
    color: rgb(209 213 219);
  }

  .progress-footer {
    padding: 1rem;
    background: rgba(249, 115, 22, 0.05);
    border-radius: 0.5rem;
  }

  :global(.dark) .progress-footer {
    background: rgba(249, 115, 22, 0.1);
  }

  .progress-footer .help-text {
    margin: 0;
  }

  /* Console Output Styles */
  .logs-container.compact {
    min-height: 150px;
  }

  .logs-container.compact .logs-scroll {
    max-height: 180px;
  }

  .console-output {
    background: rgba(0, 0, 0, 0.85);
    color: rgb(209 213 219);
    font-family: 'Courier New', Consolas, monospace;
    font-size: 0.8rem;
    line-height: 1.4;
  }

  :global(.dark) .console-output {
    background: rgba(0, 0, 0, 0.95);
    color: rgb(229 231 235);
  }

  .console-line {
    padding: 0.25rem 0;
    white-space: pre-wrap;
    word-break: break-all;
  }

  .console-line:hover {
    background: rgba(124, 58, 237, 0.1);
  }

  .events-output {
    max-height: 200px !important;
  }

  /* Training Monitor Styles */
  .training-monitor {
    border: 2px solid rgba(124, 58, 237, 0.2);
  }

  :global(.dark) .training-monitor {
    border-color: rgba(167, 139, 250, 0.3);
  }

  .monitor-header-content {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 1rem;
    width: 100%;
  }

  .toggle-btn {
    padding: 0.5rem 1rem;
    border-radius: 0.5rem;
    border: 1px solid rgba(124, 58, 237, 0.3);
    background: rgba(124, 58, 237, 0.05);
    color: rgb(124 58 237);
    cursor: pointer;
    font-weight: 500;
    white-space: nowrap;
    transition: all 0.2s;
  }

  .toggle-btn:hover {
    background: rgba(124, 58, 237, 0.1);
    border-color: rgba(124, 58, 237, 0.5);
  }

  :global(.dark) .toggle-btn {
    border-color: rgba(167, 139, 250, 0.3);
    background: rgba(167, 139, 250, 0.05);
    color: rgb(167 139 250);
  }

  :global(.dark) .toggle-btn:hover {
    background: rgba(167, 139, 250, 0.1);
    border-color: rgba(167, 139, 250, 0.5);
  }

  .monitor-status {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 1rem;
    background: rgba(0, 0, 0, 0.02);
    border-radius: 0.5rem;
    margin-top: 1rem;
  }

  :global(.dark) .monitor-status {
    background: rgba(255, 255, 255, 0.02);
  }

  .status-badge {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem 1rem;
    border-radius: 0.5rem;
    font-weight: 500;
    font-size: 0.95rem;
  }

  .status-badge.running {
    background: rgba(34, 197, 94, 0.1);
    color: rgb(22, 163, 74);
    border: 1px solid rgba(34, 197, 94, 0.3);
  }

  :global(.dark) .status-badge.running {
    background: rgba(34, 197, 94, 0.15);
    color: rgb(74, 222, 128);
    border-color: rgba(34, 197, 94, 0.4);
  }

  .status-badge.idle {
    background: rgba(107, 114, 128, 0.1);
    color: rgb(75, 85, 99);
    border: 1px solid rgba(107, 114, 128, 0.2);
  }

  :global(.dark) .status-badge.idle {
    background: rgba(156, 163, 175, 0.1);
    color: rgb(156, 163, 175);
    border-color: rgba(156, 163, 175, 0.2);
  }

  .spinner-small {
    width: 16px;
    height: 16px;
    border: 2px solid rgba(34, 197, 94, 0.2);
    border-top-color: rgb(22, 163, 74);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  :global(.dark) .spinner-small {
    border-color: rgba(74, 222, 128, 0.2);
    border-top-color: rgb(74, 222, 128);
  }

  .btn-danger-small {
    padding: 0.4rem 0.8rem;
    border-radius: 0.5rem;
    border: 1px solid rgba(239, 68, 68, 0.4);
    background: rgba(239, 68, 68, 0.1);
    color: rgb(220, 38, 38);
    cursor: pointer;
    font-size: 0.85rem;
    font-weight: 500;
    transition: all 0.2s;
  }

  .btn-danger-small:hover:not(:disabled) {
    background: rgba(239, 68, 68, 0.2);
    border-color: rgba(239, 68, 68, 0.6);
  }

  .btn-danger-small:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  :global(.dark) .btn-danger-small {
    border-color: rgba(248, 113, 113, 0.4);
    background: rgba(248, 113, 113, 0.1);
    color: rgb(248, 113, 113);
  }

  :global(.dark) .btn-danger-small:hover:not(:disabled) {
    background: rgba(248, 113, 113, 0.2);
    border-color: rgba(248, 113, 113, 0.6);
  }

  .monitor-content {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    margin-top: 1rem;
  }

  .recent-activity-compact {
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid rgba(0, 0, 0, 0.05);
  }

  :global(.dark) .recent-activity-compact {
    border-top-color: rgba(255, 255, 255, 0.05);
  }

  .recent-activity-compact h4 {
    margin: 0 0 0.75rem 0;
    font-size: 0.95rem;
    font-weight: 600;
    color: rgb(75, 85, 99);
  }

  :global(.dark) .recent-activity-compact h4 {
    color: rgb(156, 163, 175);
  }

  .info-box {
    padding: 1rem;
    background: rgba(59, 130, 246, 0.05);
    border: 1px solid rgba(59, 130, 246, 0.2);
    border-radius: 0.5rem;
    margin-top: 0.5rem;
  }

  :global(.dark) .info-box {
    background: rgba(59, 130, 246, 0.1);
    border-color: rgba(59, 130, 246, 0.3);
  }

  .info-box p {
    margin: 0;
    color: rgb(30, 64, 175);
    font-size: 0.875rem;
  }

  :global(.dark) .info-box p {
    color: rgb(147, 197, 253);
  }

  .info-box strong {
    color: rgb(29, 78, 216);
  }

  :global(.dark) .info-box strong {
    color: rgb(96, 165, 250);
  }

  /* Error Banner Styles */
  .error-banner {
    display: flex;
    align-items: flex-start;
    gap: 1rem;
    padding: 1rem;
    margin-top: 1rem;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: 0.5rem;
    animation: slideDown 0.3s ease-out;
  }

  :global(.dark) .error-banner {
    background: rgba(248, 113, 113, 0.1);
    border-color: rgba(248, 113, 113, 0.3);
  }

  @keyframes slideDown {
    from {
      opacity: 0;
      transform: translateY(-10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .error-icon {
    font-size: 1.5rem;
    flex-shrink: 0;
  }

  .error-content {
    flex: 1;
    color: rgb(127, 29, 29);
  }

  :global(.dark) .error-content {
    color: rgb(254, 202, 202);
  }

  .error-content strong {
    display: block;
    margin-bottom: 0.25rem;
    color: rgb(153, 27, 27);
  }

  :global(.dark) .error-content strong {
    color: rgb(248, 113, 113);
  }

  .error-content p {
    margin: 0.25rem 0;
    font-size: 0.875rem;
  }

  .error-hint {
    margin-top: 0.5rem !important;
    padding: 0.5rem;
    background: rgba(0, 0, 0, 0.05);
    border-radius: 0.25rem;
    font-size: 0.8125rem;
    color: rgb(127, 29, 29);
  }

  :global(.dark) .error-hint {
    background: rgba(255, 255, 255, 0.05);
    color: rgb(252, 165, 165);
  }

  .error-dismiss {
    padding: 0.25rem 0.5rem;
    background: none;
    border: none;
    color: rgb(127, 29, 29);
    font-size: 1.5rem;
    cursor: pointer;
    opacity: 0.6;
    transition: opacity 0.2s;
    flex-shrink: 0;
  }

  .error-dismiss:hover {
    opacity: 1;
  }

  :global(.dark) .error-dismiss {
    color: rgb(254, 202, 202);
  }
</style>
