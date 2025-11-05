<script lang="ts">
  import { onMount } from 'svelte';

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

  async function loadData() {
    loading = true;
    error = null;
    try {
      const res = await fetch('/api/adapters');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed to load adapters');
      datasets = Array.isArray(data.datasets) ? data.datasets : [];
      autoApproval = data.autoApproval ?? null;
      activeAdapter = data.activeAdapter ?? null;
      loraEnabled = !!(data.sleep?.loraEnabled);
      recentLogs = Array.isArray(data.recentLogs) ? data.recentLogs : [];
    } catch (err) {
      console.error(err);
      error = (err as Error).message;
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    loadData();
    const interval = setInterval(loadData, 15000);
    return () => clearInterval(interval);
  });

  function setWorking(date: string, action: string, value: boolean) {
    const key = `${date}:${action}`;
    workingOn = value ? { ...workingOn, [key]: action } : Object.fromEntries(Object.entries(workingOn).filter(([k]) => k !== key));
  }

  function isWorking(date: string, action: string) {
    return !!workingOn[`${date}:${action}`];
  }

  async function sendAction(action: string, payload: Record<string, any>) {
    const res = await fetch('/api/adapters', {
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

  // Track state for full cycle modal
  let showFullCycleModal = false;
  let selectedModel = '';
  let dualModeEnabled = false;
  let availableModels: string[] = [];
  
  async function runFullCycleWithParams() {
    try {
      await sendAction('fullCycle', {
        model: selectedModel || undefined,
        dualMode: dualModeEnabled
      });
      alert('Full cycle started. Watch the audit stream for progress.');
      showFullCycleModal = false;
    } catch (err) {
      alert((err && (err as any).message) || String(err));
    }
  }
  
  async function runFullCycleNow() {
    // Load current base model from etc/models.json to use as default
    try {
      const res = await fetch('/api/model-info');
      if (res.ok) {
        const data = await res.json();
        selectedModel = data.baseModel || '';
      }
    } catch (e) {
      console.warn('Could not fetch current model, using empty default:', e);
      selectedModel = '';
    }
    
    // Load available models from Ollama
    try {
      const res = await fetch('/api/models');
      if (res.ok) {
        const data = await res.json();
        availableModels = data.baseModels || [];
        // If selectedModel is empty and we have models, default to the current base model
        if (!selectedModel && data.agent?.model) {
          selectedModel = data.agent.model;
        }
      }
    } catch (e) {
      console.warn('Could not fetch available models:', e);
      // Fallback to a default list if API fails
      availableModels = ['qwen3:8b', 'qwen3:30b', 'dolphin-mistral:latest'];
    }
    
    // Set dual mode to true by default if we have historical adapters
    try {
      const adaptersRes = await fetch('/api/adapters');
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
      const res = await fetch('/api/export/conversations', { method: 'POST' });
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
      const res = await fetch('/api/adapters', {
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
      const res = await fetch('/api/adapters', {
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
  
  <!-- Full Cycle Modal -->
  {#if showFullCycleModal}
    <div class="modal-overlay" role="presentation" on:click={() => showFullCycleModal = false}>
      <div class="modal-content" role="dialog" aria-modal="true" on:click|stopPropagation>
        <div class="modal-header">
          <h3>Run Full Cycle</h3>
          <button class="modal-close" on:click={() => showFullCycleModal = false}>×</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label for="model-select">Base Model:</label>
            <select id="model-select" bind:value={selectedModel}>
              <option value="">Use default from etc/models.json</option>
              {#each availableModels as model}
                <option value={model}>{model}</option>
              {/each}
            </select>
            <p class="help-text">Select the base model to use for training the LoRA adapter. If empty, will use the model specified in etc/models.json</p>
          </div>
          <div class="form-group">
            <label class="checkbox-label">
              <input type="checkbox" bind:checked={dualModeEnabled} />
              <span>Enable Dual Mode (combine historical + recent adapters)</span>
            </label>
            <p class="help-text">If enabled, combines historical knowledge with recent learnings. Requires historical adapters to be present.</p>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" on:click={() => showFullCycleModal = false}>Cancel</button>
          <button class="btn-primary" on:click={runFullCycleWithParams}>Run Full Cycle</button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Recent pipeline logs -->
  <section class="card">
    <header>
      <h3>Recent Activity</h3>
      <p>Latest LoRA pipeline events (build → train → eval → activate).</p>
    </header>
    <div class="log-list">
      {#each recentLogs as log}
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
</style>
