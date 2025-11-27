<script lang="ts">
  import { onMount } from 'svelte';
  import { fetchJSONSafe } from '../lib/client/utils/fetch-timeout';

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

  type FineTuneModel = {
    runId: string;
    runLabel: string;
    username: string;
    baseModel: string;
    totalSamples: number;
    datasetSizeKB: number;
    createdAt: string;
    status: 'training_complete' | 'training_failed' | 'active';
    trainingSuccess: boolean;
    modelPath?: string;
    error?: string;
    isActive?: boolean;
  };

  let datasets: DatasetStatus[] = [];
  let fineTuneModels: FineTuneModel[] = [];
  let autoApproval: AutoApprovalConfig | null = null;
  let activeAdapter: ActiveAdapterInfo = null;
  let loading = true;
  let error: string | null = null;
  let workingOn: Record<string, string> = {};
  let updatingConfig = false;

  async function loadData() {
    loading = true;
    error = null;
    try {
      // Load LoRA adapters
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

      // Load fine-tune models
      await loadFineTuneModels();
    } catch (err) {
      console.error('[DatasetManagement] Load error:', err);
      error = (err as Error).message;
    } finally {
      loading = false;
    }
  }

  async function loadFineTuneModels() {
    try {
      const res = await fetch('/api/fine-tune/models');
      if (!res.ok) {
        console.warn('[DatasetManagement] Failed to load fine-tune models');
        return;
      }

      const data = await res.json();
      if (data.success) {
        fineTuneModels = data.models || [];
      }
    } catch (err) {
      console.warn('[DatasetManagement] Error loading fine-tune models:', err);
    }
  }

  function setWorking(date: string, action: string, value: boolean) {
    workingOn[`${date}:${action}`] = value ? 'working' : '';
  }

  function isWorking(date: string, action: string) {
    return !!workingOn[`${date}:${action}`];
  }

  async function sendAction(action: string, payload: Record<string, any>) {
    const res = await fetch('/api/adapters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...payload })
    });
    const data = await res.json();
    if (!data.success) {
      throw new Error(data.error || 'Action failed');
    }
    return data;
  }

  async function handleApprove(date: string) {
    setWorking(date, 'approve', true);
    try {
      await sendAction('approve', { date, notes: 'Approved via UI' });
      await loadData();
    } catch (err) {
      error = (err as Error).message;
    } finally {
      setWorking(date, 'approve', false);
    }
  }

  async function handleReject(date: string) {
    const reason = prompt('Reason for rejecting this dataset?');
    if (!reason) return;

    setWorking(date, 'reject', true);
    try {
      await sendAction('reject', { date, reason });
      await loadData();
    } catch (err) {
      error = (err as Error).message;
    } finally {
      setWorking(date, 'reject', false);
    }
  }

  async function handleTrain(date: string) {
    if (!confirm(`Start training for dataset ${date}?`)) return;

    setWorking(date, 'train', true);
    try {
      await sendAction('train', { date });
      await loadData();
    } catch (err) {
      error = (err as Error).message;
    } finally {
      setWorking(date, 'train', false);
    }
  }

  async function handleEval(date: string) {
    setWorking(date, 'eval', true);
    try {
      await sendAction('eval', { date });
      await loadData();
    } catch (err) {
      error = (err as Error).message;
    } finally {
      setWorking(date, 'eval', false);
    }
  }

  async function handleActivate(date: string) {
    if (!confirm(`Activate adapter for dataset ${date}?`)) return;

    setWorking(date, 'activate', true);
    try {
      await sendAction('activate', { date });
      await loadData();
    } catch (err) {
      error = (err as Error).message;
    } finally {
      setWorking(date, 'activate', false);
    }
  }

  async function toggleAutoApproval(field: 'enabled' | 'dryRun', value: boolean) {
    if (!autoApproval) return;
    updatingConfig = true;
    try {
      await sendAction('autoApproval', { [field]: value });
      await loadData();
    } catch (err) {
      error = (err as Error).message;
    } finally {
      updatingConfig = false;
    }
  }

  async function toggleAutoFlag(flag: string, value: boolean) {
    updatingConfig = true;
    try {
      await sendAction('autoApproval', { [flag]: value });
      await loadData();
    } catch (err) {
      error = (err as Error).message;
    } finally {
      updatingConfig = false;
    }
  }

  function onToggleEnabled(e: any) {
    toggleAutoApproval('enabled', !!e.currentTarget.checked);
  }

  function onToggleDryRun(e: any) {
    toggleAutoApproval('dryRun', !!e.currentTarget.checked);
  }

  function onToggleAutoTrain(e: any) {
    toggleAutoFlag('autoTrain', !!e.currentTarget.checked);
  }

  function onToggleAutoEval(e: any) {
    toggleAutoFlag('autoEval', !!e.currentTarget.checked);
  }

  function onToggleAutoActivate(e: any) {
    toggleAutoFlag('autoActivate', !!e.currentTarget.checked);
  }

  function getAutoFlag(flag: 'autoTrain' | 'autoEval' | 'autoActivate'): boolean {
    const cfg: any = autoApproval;
    if (!cfg) return false;
    return cfg[flag] !== false;
  }

  function statusBadge(status: DatasetStatus['status']) {
    switch (status) {
      case 'pending': return { label: 'Pending', class: 'status-pending' };
      case 'approved': return { label: 'Approved', class: 'status-approved' };
      case 'trained': return { label: 'Trained', class: 'status-trained' };
      case 'evaluated': return { label: 'Evaluated', class: 'status-evaluated' };
      case 'active': return { label: 'Active', class: 'status-active' };
      default: return { label: status, class: 'status-default' };
    }
  }

  onMount(() => {
    loadData();
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  });
</script>

<div class="dataset-management">
  <div class="header">
    <div>
      <h2>📊 Dataset Management</h2>
      <p>Review, approve, and manage LoRA training datasets.</p>
    </div>
    <button class="refresh-btn" on:click={loadData} disabled={loading}>
      {loading ? 'Refreshing…' : '↻ Refresh'}
    </button>
  </div>

  {#if error}
    <div class="error-banner">
      <strong>⚠️ Error:</strong> {error}
      <button class="error-dismiss" on:click={() => error = null}>×</button>
    </div>
  {/if}

  <!-- Auto-Approval Configuration -->
  {#if autoApproval}
    <section class="card">
      <header>
        <h3>⚙️ Auto-Approval Configuration</h3>
        <p>Automated dataset approval settings for nightly pipeline.</p>
      </header>
      <div class="config-grid">
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
      </div>
      <div class="thresholds">
        <div class="threshold">Min pairs: <strong>{autoApproval.thresholds.minPairs}</strong></div>
        <div class="threshold">High confidence ≥ <strong>{Math.round(autoApproval.thresholds.minHighConfidence * 100)}%</strong></div>
        <div class="threshold">Reflections ≥ <strong>{Math.round(autoApproval.thresholds.minReflectionPct * 100)}%</strong></div>
        <div class="threshold">Low confidence ≤ <strong>{Math.round(autoApproval.thresholds.maxLowConfidence * 100)}%</strong></div>
      </div>
    </section>
  {/if}

  <!-- Active Adapter -->
  <section class="card">
    <header>
      <h3>✨ Active Adapter</h3>
      <p>Currently loaded LoRA adapter in chat system.</p>
    </header>
    {#if activeAdapter}
      <div class="meta-grid">
        <div class="meta-item">
          <span class="meta-label">Model:</span>
          <span class="meta-value">{activeAdapter.modelName}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Dataset:</span>
          <span class="meta-value">{activeAdapter.dataset || 'unknown'}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Activated:</span>
          <span class="meta-value">{new Date(activeAdapter.activatedAt).toLocaleString()}</span>
        </div>
        {#if typeof activeAdapter.evalScore === 'number'}
          <div class="meta-item">
            <span class="meta-label">Eval Score:</span>
            <span class="meta-value">{activeAdapter.evalScore.toFixed(3)}</span>
          </div>
        {/if}
        <div class="meta-item">
          <span class="meta-label">Status:</span>
          <span class="meta-value status-badge {activeAdapter.status === 'loaded' ? 'status-active' : 'status-pending'}">
            {activeAdapter.status || 'loaded'}
          </span>
        </div>
      </div>
    {:else}
      <p class="muted">No active adapter. Chat uses base model.</p>
    {/if}
  </section>

  <!-- Datasets Table -->
  <section class="card">
    <header>
      <h3>📁 Datasets</h3>
      <p>All training datasets with approval and training workflow.</p>
    </header>

    {#if loading}
      <div class="loading">Loading datasets…</div>
    {:else if datasets.length === 0}
      <div class="empty">
        <div class="empty-icon">📊</div>
        <div class="empty-title">No datasets available</div>
        <p class="muted">Run adapter-builder or sleep-service to generate instruction pairs.</p>
      </div>
    {:else}
      <table class="dataset-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Status</th>
            <th>Pairs</th>
            <th>Approval</th>
            <th>Evaluation</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {#each datasets as dataset (dataset.date)}
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
                    <span class="badge badge-dry">Dry</span>
                  {/if}
                </div>
              </td>
              <td>
                <span class="status-badge {statusBadge(dataset.status).class}">
                  {statusBadge(dataset.status).label}
                </span>
              </td>
              <td>{dataset.pairCount}</td>
              <td>
                {#if dataset.approvedAt}
                  <div class="meta-cell">
                    <div>{new Date(dataset.approvedAt).toLocaleString()}</div>
                    <div class="muted">by {dataset.approvedBy || 'unknown'}</div>
                    {#if dataset.qualityScore}
                      <div class="muted">Quality: {dataset.qualityScore.toFixed(0)}/100</div>
                    {/if}
                  </div>
                {:else}
                  <span class="muted">Pending</span>
                {/if}
              </td>
              <td>
                {#if typeof dataset.evalScore === 'number'}
                  <div class="meta-cell">
                    <div>{dataset.evalScore.toFixed(3)}</div>
                    <div class="muted {dataset.evalPassed ? 'pass' : 'fail'}">
                      {dataset.evalPassed ? '✅ Passed' : '❌ Failed'}
                    </div>
                  </div>
                {:else}
                  <span class="muted">Not run</span>
                {/if}
              </td>
              <td>
                <div class="actions">
                  {#if dataset.status === 'pending'}
                    <button class="btn-action" on:click={() => handleApprove(dataset.date)} disabled={isWorking(dataset.date, 'approve')}>
                      {isWorking(dataset.date, 'approve') ? 'Approving…' : '✓ Approve'}
                    </button>
                    <button class="btn-danger-small" on:click={() => handleReject(dataset.date)} disabled={isWorking(dataset.date, 'reject')}>
                      {isWorking(dataset.date, 'reject') ? 'Rejecting…' : '✗ Reject'}
                    </button>
                  {/if}
                  {#if dataset.status === 'approved'}
                    <button class="btn-action" on:click={() => handleTrain(dataset.date)} disabled={isWorking(dataset.date, 'train')}>
                      {isWorking(dataset.date, 'train') ? 'Starting…' : '🔥 Train'}
                    </button>
                  {/if}
                  {#if dataset.status === 'trained'}
                    <button class="btn-action" on:click={() => handleEval(dataset.date)} disabled={isWorking(dataset.date, 'eval')}>
                      {isWorking(dataset.date, 'eval') ? 'Evaluating…' : '📊 Evaluate'}
                    </button>
                  {/if}
                  {#if dataset.status === 'evaluated' && dataset.evalPassed}
                    <button class="btn-action" on:click={() => handleActivate(dataset.date)} disabled={isWorking(dataset.date, 'activate')}>
                      {isWorking(dataset.date, 'activate') ? 'Activating…' : '✨ Activate'}
                    </button>
                  {/if}
                  {#if dataset.status !== 'pending'}
                    <button class="btn-danger-small" on:click={() => handleReject(dataset.date)} disabled={isWorking(dataset.date, 'reject')}>
                      {isWorking(dataset.date, 'reject') ? 'Archiving…' : '🗄️ Archive'}
                    </button>
                  {/if}
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </section>

  <!-- Fine-Tuned Models -->
  <section class="card">
    <header>
      <h3>🎯 Fine-Tuned Models</h3>
      <p>Full model fine-tuning runs (not LoRA adapters).</p>
    </header>

    {#if loading}
      <div class="loading">Loading fine-tuned models…</div>
    {:else if fineTuneModels.length === 0}
      <div class="empty">
        <div class="empty-icon">🎯</div>
        <div class="empty-title">No fine-tuned models</div>
        <p class="muted">Run fine-tune training from the Training Wizard to create full fine-tuned models.</p>
      </div>
    {:else}
      <table class="dataset-table">
        <thead>
          <tr>
            <th>Run Label</th>
            <th>Base Model</th>
            <th>Samples</th>
            <th>Dataset Size</th>
            <th>Created</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {#each fineTuneModels as model (model.runId)}
            <tr>
              <td>
                <div class="date-cell">
                  <div class="date-value">{model.runLabel}</div>
                  {#if model.isActive}
                    <span class="badge badge-active">Active</span>
                  {/if}
                </div>
              </td>
              <td>{model.baseModel}</td>
              <td>{model.totalSamples.toLocaleString()}</td>
              <td>{model.datasetSizeKB.toLocaleString()} KB</td>
              <td>
                <div class="meta-cell">
                  <div>{new Date(model.createdAt).toLocaleString()}</div>
                  <div class="muted">by {model.username}</div>
                </div>
              </td>
              <td>
                <div class="status-cell">
                  {#if model.status === 'training_complete'}
                    <span class="status-badge status-active">✅ Complete</span>
                  {:else}
                    <span class="status-badge status-pending">❌ Failed</span>
                  {/if}
                  {#if model.error}
                    <div class="muted error">{model.error}</div>
                  {/if}
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </section>
</div>

<style>
  .dataset-management {
    padding: 1.5rem;
    max-width: 1600px;
    margin: 0 auto;
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1.5rem;
  }

  .header h2 {
    margin: 0 0 0.25rem 0;
    font-size: 1.5rem;
    font-weight: 600;
  }

  .header p {
    margin: 0;
    color: #6b7280;
    font-size: 0.875rem;
  }

  .refresh-btn {
    background: #3b82f6;
    color: white;
    border: none;
    padding: 0.5rem 1rem;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 500;
    transition: background 0.2s;
  }

  .refresh-btn:hover:not(:disabled) {
    background: #2563eb;
  }

  .refresh-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .error-banner {
    background: #fee;
    border: 1px solid #fcc;
    border-radius: 6px;
    padding: 1rem;
    margin-bottom: 1.5rem;
    color: #c00;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .error-dismiss {
    background: none;
    border: none;
    font-size: 1.5rem;
    cursor: pointer;
    color: #c00;
    padding: 0 0.5rem;
  }

  .card {
    background: white;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    padding: 1.5rem;
    margin-bottom: 1.5rem;
  }

  :global(.dark) .card {
    background: #1f2937;
    border-color: #374151;
  }

  .card header {
    margin-bottom: 1rem;
    border-bottom: 1px solid #e5e7eb;
    padding-bottom: 0.75rem;
  }

  :global(.dark) .card header {
    border-bottom-color: #374151;
  }

  .card h3 {
    margin: 0 0 0.25rem 0;
    font-size: 1.125rem;
    font-weight: 600;
  }

  .card p {
    margin: 0;
    color: #6b7280;
    font-size: 0.875rem;
  }

  .config-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1rem;
    margin-bottom: 1rem;
  }

  .switch-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.75rem;
    background: #f9fafb;
    border-radius: 6px;
    cursor: pointer;
  }

  :global(.dark) .switch-row {
    background: #111827;
  }

  .switch-row input[type="checkbox"] {
    cursor: pointer;
  }

  .thresholds {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    padding: 1rem;
    background: #f9fafb;
    border-radius: 6px;
  }

  :global(.dark) .thresholds {
    background: #111827;
  }

  .threshold {
    font-size: 0.875rem;
    color: #6b7280;
  }

  .threshold strong {
    color: #111827;
  }

  :global(.dark) .threshold strong {
    color: #f3f4f6;
  }

  .meta-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    gap: 1rem;
  }

  .meta-item {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .meta-label {
    font-size: 0.75rem;
    font-weight: 500;
    color: #6b7280;
    text-transform: uppercase;
  }

  .meta-value {
    font-size: 0.875rem;
    color: #111827;
  }

  :global(.dark) .meta-value {
    color: #f3f4f6;
  }

  .muted {
    color: #6b7280;
    font-size: 0.875rem;
  }

  .loading, .empty {
    text-align: center;
    padding: 3rem 2rem;
    color: #6b7280;
  }

  .empty-icon {
    font-size: 3rem;
    margin-bottom: 1rem;
  }

  .empty-title {
    font-size: 1.125rem;
    font-weight: 600;
    color: #111827;
    margin-bottom: 0.5rem;
  }

  :global(.dark) .empty-title {
    color: #f3f4f6;
  }

  .dataset-table {
    width: 100%;
    border-collapse: collapse;
  }

  .dataset-table th {
    text-align: left;
    padding: 0.75rem;
    background: #f9fafb;
    font-weight: 600;
    font-size: 0.875rem;
    border-bottom: 2px solid #e5e7eb;
  }

  :global(.dark) .dataset-table th {
    background: #111827;
    border-bottom-color: #374151;
  }

  .dataset-table td {
    padding: 1rem 0.75rem;
    border-bottom: 1px solid #e5e7eb;
  }

  :global(.dark) .dataset-table td {
    border-bottom-color: #374151;
  }

  .date-cell {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .date-value {
    font-weight: 600;
    font-size: 0.875rem;
  }

  .badge {
    display: inline-block;
    padding: 0.125rem 0.5rem;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 500;
  }

  .badge-active {
    background: #dcfce7;
    color: #166534;
  }

  .badge-auto {
    background: #dbeafe;
    color: #1e40af;
  }

  .badge-dry {
    background: #fef3c7;
    color: #92400e;
  }

  .status-badge {
    display: inline-block;
    padding: 0.25rem 0.75rem;
    border-radius: 6px;
    font-size: 0.75rem;
    font-weight: 500;
  }

  .status-pending {
    background: #f3f4f6;
    color: #6b7280;
  }

  .status-approved {
    background: #dbeafe;
    color: #1e40af;
  }

  .status-trained {
    background: #fef3c7;
    color: #92400e;
  }

  .status-evaluated {
    background: #e0e7ff;
    color: #4338ca;
  }

  .status-active {
    background: #dcfce7;
    color: #166534;
  }

  .meta-cell {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.875rem;
  }

  .meta-cell .pass {
    color: #059669;
  }

  .meta-cell .fail {
    color: #dc2626;
  }

  .actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .btn-action {
    background: #3b82f6;
    color: white;
    border: none;
    padding: 0.375rem 0.75rem;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.875rem;
    font-weight: 500;
    transition: background 0.2s;
  }

  .btn-action:hover:not(:disabled) {
    background: #2563eb;
  }

  .btn-action:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-danger-small {
    background: #ef4444;
    color: white;
    border: none;
    padding: 0.375rem 0.75rem;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.875rem;
    font-weight: 500;
    transition: background 0.2s;
  }

  .btn-danger-small:hover:not(:disabled) {
    background: #dc2626;
  }

  .btn-danger-small:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .status-cell {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .error {
    color: #dc2626 !important;
    font-size: 0.75rem;
  }
</style>
