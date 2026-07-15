<script lang="ts">
  import { onMount } from 'svelte';
  import { fetchJSONSafe } from '../lib/client/utils/fetch-timeout';
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
      const res = await apiFetch('/api/fine-tune/models');
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
    const res = await apiFetch('/api/adapters', {
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

<div class="p-6 max-w-[1600px] mx-auto">
  <div class="flex justify-between items-center mb-6">
    <div>
      <h2 class="m-0 mb-1 text-2xl font-semibold">📊 Dataset Management</h2>
      <p class="m-0 text-gray-500 text-sm">Review, approve, and manage LoRA training datasets.</p>
    </div>
    <button class="bg-blue-500 text-white border-none px-4 py-2 rounded-md cursor-pointer font-medium transition-colors hover:enabled:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed" on:click={loadData} disabled={loading}>
      {loading ? 'Refreshing…' : '↻ Refresh'}
    </button>
  </div>

  {#if error}
    <div class="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-md p-4 mb-6 text-red-700 dark:text-red-400 flex justify-between items-center">
      <span><strong>⚠️ Error:</strong> {error}</span>
      <button class="bg-transparent border-none text-2xl cursor-pointer text-red-700 dark:text-red-400 px-2" on:click={() => error = null}>×</button>
    </div>
  {/if}

  <!-- Auto-Approval Configuration -->
  {#if autoApproval}
    <section class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 mb-6">
      <header class="mb-4 border-b border-gray-200 dark:border-gray-700 pb-3">
        <h3 class="m-0 mb-1 text-lg font-semibold">⚙️ Auto-Approval Configuration</h3>
        <p class="m-0 text-gray-500 text-sm">Automated dataset approval settings for nightly pipeline.</p>
      </header>
      <div class="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4 mb-4">
        <label class="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-900 rounded-md cursor-pointer">
          <span>Auto-Approval Enabled</span>
          <input type="checkbox" checked={autoApproval.enabled} disabled={updatingConfig} on:change={onToggleEnabled} class="cursor-pointer" />
        </label>
        <label class="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-900 rounded-md cursor-pointer">
          <span>Dry Run Mode</span>
          <input type="checkbox" checked={autoApproval.dryRun} disabled={updatingConfig} on:change={onToggleDryRun} class="cursor-pointer" />
        </label>
        <label class="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-900 rounded-md cursor-pointer">
          <span>Auto Train</span>
          <input type="checkbox" checked={getAutoFlag('autoTrain')} on:change={onToggleAutoTrain} class="cursor-pointer" />
        </label>
        <label class="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-900 rounded-md cursor-pointer">
          <span>Auto Evaluate</span>
          <input type="checkbox" checked={getAutoFlag('autoEval')} on:change={onToggleAutoEval} class="cursor-pointer" />
        </label>
        <label class="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-900 rounded-md cursor-pointer">
          <span>Auto Activate</span>
          <input type="checkbox" checked={getAutoFlag('autoActivate')} on:change={onToggleAutoActivate} class="cursor-pointer" />
        </label>
      </div>
      <div class="flex flex-wrap gap-4 p-4 bg-gray-50 dark:bg-gray-900 rounded-md">
        <div class="text-sm text-gray-500">Min pairs: <strong class="text-gray-900 dark:text-gray-100">{autoApproval.thresholds.minPairs}</strong></div>
        <div class="text-sm text-gray-500">High confidence ≥ <strong class="text-gray-900 dark:text-gray-100">{Math.round(autoApproval.thresholds.minHighConfidence * 100)}%</strong></div>
        <div class="text-sm text-gray-500">Reflections ≥ <strong class="text-gray-900 dark:text-gray-100">{Math.round(autoApproval.thresholds.minReflectionPct * 100)}%</strong></div>
        <div class="text-sm text-gray-500">Low confidence ≤ <strong class="text-gray-900 dark:text-gray-100">{Math.round(autoApproval.thresholds.maxLowConfidence * 100)}%</strong></div>
      </div>
    </section>
  {/if}

  <!-- Active Adapter -->
  <section class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 mb-6">
    <header class="mb-4 border-b border-gray-200 dark:border-gray-700 pb-3">
      <h3 class="m-0 mb-1 text-lg font-semibold">✨ Active Adapter</h3>
      <p class="m-0 text-gray-500 text-sm">Currently loaded LoRA adapter in chat system.</p>
    </header>
    {#if activeAdapter}
      <div class="grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] gap-4">
        <div class="flex flex-col gap-1">
          <span class="text-xs font-medium text-gray-500 uppercase">Model:</span>
          <span class="text-sm text-gray-900 dark:text-gray-100">{activeAdapter.modelName}</span>
        </div>
        <div class="flex flex-col gap-1">
          <span class="text-xs font-medium text-gray-500 uppercase">Dataset:</span>
          <span class="text-sm text-gray-900 dark:text-gray-100">{activeAdapter.dataset || 'unknown'}</span>
        </div>
        <div class="flex flex-col gap-1">
          <span class="text-xs font-medium text-gray-500 uppercase">Activated:</span>
          <span class="text-sm text-gray-900 dark:text-gray-100">{new Date(activeAdapter.activatedAt).toLocaleString()}</span>
        </div>
        {#if typeof activeAdapter.evalScore === 'number'}
          <div class="flex flex-col gap-1">
            <span class="text-xs font-medium text-gray-500 uppercase">Eval Score:</span>
            <span class="text-sm text-gray-900 dark:text-gray-100">{activeAdapter.evalScore.toFixed(3)}</span>
          </div>
        {/if}
        <div class="flex flex-col gap-1">
          <span class="text-xs font-medium text-gray-500 uppercase">Status:</span>
          <span class="text-sm inline-block px-3 py-1 rounded-md text-xs font-medium {activeAdapter.status === 'loaded' ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}">
            {activeAdapter.status || 'loaded'}
          </span>
        </div>
      </div>
    {:else}
      <p class="text-gray-500 text-sm">No active adapter. Chat uses base model.</p>
    {/if}
  </section>

  <!-- Datasets Table -->
  <section class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 mb-6">
    <header class="mb-4 border-b border-gray-200 dark:border-gray-700 pb-3">
      <h3 class="m-0 mb-1 text-lg font-semibold">📁 Datasets</h3>
      <p class="m-0 text-gray-500 text-sm">All training datasets with approval and training workflow.</p>
    </header>

    {#if loading}
      <div class="text-center py-12 px-8 text-gray-500">Loading datasets…</div>
    {:else if datasets.length === 0}
      <div class="text-center py-12 px-8 text-gray-500">
        <div class="text-5xl mb-4">📊</div>
        <div class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">No datasets available</div>
        <p class="text-gray-500 text-sm">Run adapter-builder to generate instruction pairs.</p>
      </div>
    {:else}
      <table class="w-full border-collapse">
        <thead>
          <tr>
            <th class="text-left p-3 bg-gray-50 dark:bg-gray-900 font-semibold text-sm border-b-2 border-gray-200 dark:border-gray-700">Date</th>
            <th class="text-left p-3 bg-gray-50 dark:bg-gray-900 font-semibold text-sm border-b-2 border-gray-200 dark:border-gray-700">Status</th>
            <th class="text-left p-3 bg-gray-50 dark:bg-gray-900 font-semibold text-sm border-b-2 border-gray-200 dark:border-gray-700">Pairs</th>
            <th class="text-left p-3 bg-gray-50 dark:bg-gray-900 font-semibold text-sm border-b-2 border-gray-200 dark:border-gray-700">Approval</th>
            <th class="text-left p-3 bg-gray-50 dark:bg-gray-900 font-semibold text-sm border-b-2 border-gray-200 dark:border-gray-700">Evaluation</th>
            <th class="text-left p-3 bg-gray-50 dark:bg-gray-900 font-semibold text-sm border-b-2 border-gray-200 dark:border-gray-700">Actions</th>
          </tr>
        </thead>
        <tbody>
          {#each datasets as dataset (dataset.date)}
            <tr>
              <td class="p-3 border-b border-gray-200 dark:border-gray-700">
                <div class="flex flex-col gap-1">
                  <div class="font-semibold text-sm">{dataset.date}</div>
                  {#if dataset.status === 'active'}
                    <span class="inline-block px-2 py-0.5 rounded text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400">Active</span>
                  {/if}
                  {#if dataset.autoApproved}
                    <span class="inline-block px-2 py-0.5 rounded text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-400">Auto</span>
                  {/if}
                  {#if dataset.dryRun}
                    <span class="inline-block px-2 py-0.5 rounded text-xs font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-400">Dry</span>
                  {/if}
                </div>
              </td>
              <td class="p-3 border-b border-gray-200 dark:border-gray-700">
                <span class="inline-block px-3 py-1 rounded-md text-xs font-medium {dataset.status === 'pending' ? 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400' : dataset.status === 'approved' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-400' : dataset.status === 'trained' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-400' : dataset.status === 'evaluated' ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-800 dark:text-indigo-400' : 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400'}">
                  {statusBadge(dataset.status).label}
                </span>
              </td>
              <td class="p-3 border-b border-gray-200 dark:border-gray-700">{dataset.pairCount}</td>
              <td class="p-3 border-b border-gray-200 dark:border-gray-700">
                {#if dataset.approvedAt}
                  <div class="flex flex-col gap-1 text-sm">
                    <div>{new Date(dataset.approvedAt).toLocaleString()}</div>
                    <div class="text-gray-500 text-sm">by {dataset.approvedBy || 'unknown'}</div>
                    {#if dataset.qualityScore}
                      <div class="text-gray-500 text-sm">Quality: {dataset.qualityScore.toFixed(0)}/100</div>
                    {/if}
                  </div>
                {:else}
                  <span class="text-gray-500 text-sm">Pending</span>
                {/if}
              </td>
              <td class="p-3 border-b border-gray-200 dark:border-gray-700">
                {#if typeof dataset.evalScore === 'number'}
                  <div class="flex flex-col gap-1 text-sm">
                    <div>{dataset.evalScore.toFixed(3)}</div>
                    <div class="text-sm {dataset.evalPassed ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}">
                      {dataset.evalPassed ? '✅ Passed' : '❌ Failed'}
                    </div>
                  </div>
                {:else}
                  <span class="text-gray-500 text-sm">Not run</span>
                {/if}
              </td>
              <td class="p-3 border-b border-gray-200 dark:border-gray-700">
                <div class="flex gap-2 flex-wrap">
                  {#if dataset.status === 'pending'}
                    <button class="bg-blue-500 text-white border-none px-3 py-1.5 rounded-md cursor-pointer text-sm font-medium transition-colors hover:enabled:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed" on:click={() => handleApprove(dataset.date)} disabled={isWorking(dataset.date, 'approve')}>
                      {isWorking(dataset.date, 'approve') ? 'Approving…' : '✓ Approve'}
                    </button>
                    <button class="bg-red-500 text-white border-none px-3 py-1.5 rounded-md cursor-pointer text-sm font-medium transition-colors hover:enabled:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed" on:click={() => handleReject(dataset.date)} disabled={isWorking(dataset.date, 'reject')}>
                      {isWorking(dataset.date, 'reject') ? 'Rejecting…' : '✗ Reject'}
                    </button>
                  {/if}
                  {#if dataset.status === 'approved'}
                    <button class="bg-blue-500 text-white border-none px-3 py-1.5 rounded-md cursor-pointer text-sm font-medium transition-colors hover:enabled:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed" on:click={() => handleTrain(dataset.date)} disabled={isWorking(dataset.date, 'train')}>
                      {isWorking(dataset.date, 'train') ? 'Starting…' : '🔥 Train'}
                    </button>
                  {/if}
                  {#if dataset.status === 'trained'}
                    <button class="bg-blue-500 text-white border-none px-3 py-1.5 rounded-md cursor-pointer text-sm font-medium transition-colors hover:enabled:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed" on:click={() => handleEval(dataset.date)} disabled={isWorking(dataset.date, 'eval')}>
                      {isWorking(dataset.date, 'eval') ? 'Evaluating…' : '📊 Evaluate'}
                    </button>
                  {/if}
                  {#if dataset.status === 'evaluated' && dataset.evalPassed}
                    <button class="bg-blue-500 text-white border-none px-3 py-1.5 rounded-md cursor-pointer text-sm font-medium transition-colors hover:enabled:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed" on:click={() => handleActivate(dataset.date)} disabled={isWorking(dataset.date, 'activate')}>
                      {isWorking(dataset.date, 'activate') ? 'Activating…' : '✨ Activate'}
                    </button>
                  {/if}
                  {#if dataset.status !== 'pending'}
                    <button class="bg-red-500 text-white border-none px-3 py-1.5 rounded-md cursor-pointer text-sm font-medium transition-colors hover:enabled:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed" on:click={() => handleReject(dataset.date)} disabled={isWorking(dataset.date, 'reject')}>
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
  <section class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 mb-6">
    <header class="mb-4 border-b border-gray-200 dark:border-gray-700 pb-3">
      <h3 class="m-0 mb-1 text-lg font-semibold">🎯 Fine-Tuned Models</h3>
      <p class="m-0 text-gray-500 text-sm">Full model fine-tuning runs (not LoRA adapters).</p>
    </header>

    {#if loading}
      <div class="text-center py-12 px-8 text-gray-500">Loading fine-tuned models…</div>
    {:else if fineTuneModels.length === 0}
      <div class="text-center py-12 px-8 text-gray-500">
        <div class="text-5xl mb-4">🎯</div>
        <div class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">No fine-tuned models</div>
        <p class="text-gray-500 text-sm">Run fine-tune training from the Training Wizard to create full fine-tuned models.</p>
      </div>
    {:else}
      <table class="w-full border-collapse">
        <thead>
          <tr>
            <th class="text-left p-3 bg-gray-50 dark:bg-gray-900 font-semibold text-sm border-b-2 border-gray-200 dark:border-gray-700">Run Label</th>
            <th class="text-left p-3 bg-gray-50 dark:bg-gray-900 font-semibold text-sm border-b-2 border-gray-200 dark:border-gray-700">Base Model</th>
            <th class="text-left p-3 bg-gray-50 dark:bg-gray-900 font-semibold text-sm border-b-2 border-gray-200 dark:border-gray-700">Samples</th>
            <th class="text-left p-3 bg-gray-50 dark:bg-gray-900 font-semibold text-sm border-b-2 border-gray-200 dark:border-gray-700">Dataset Size</th>
            <th class="text-left p-3 bg-gray-50 dark:bg-gray-900 font-semibold text-sm border-b-2 border-gray-200 dark:border-gray-700">Created</th>
            <th class="text-left p-3 bg-gray-50 dark:bg-gray-900 font-semibold text-sm border-b-2 border-gray-200 dark:border-gray-700">Status</th>
          </tr>
        </thead>
        <tbody>
          {#each fineTuneModels as model (model.runId)}
            <tr>
              <td class="p-3 border-b border-gray-200 dark:border-gray-700">
                <div class="flex flex-col gap-1">
                  <div class="font-semibold text-sm">{model.runLabel}</div>
                  {#if model.isActive}
                    <span class="inline-block px-2 py-0.5 rounded text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400">Active</span>
                  {/if}
                </div>
              </td>
              <td class="p-3 border-b border-gray-200 dark:border-gray-700">{model.baseModel}</td>
              <td class="p-3 border-b border-gray-200 dark:border-gray-700">{model.totalSamples.toLocaleString()}</td>
              <td class="p-3 border-b border-gray-200 dark:border-gray-700">{model.datasetSizeKB.toLocaleString()} KB</td>
              <td class="p-3 border-b border-gray-200 dark:border-gray-700">
                <div class="flex flex-col gap-1 text-sm">
                  <div>{new Date(model.createdAt).toLocaleString()}</div>
                  <div class="text-gray-500 text-sm">by {model.username}</div>
                </div>
              </td>
              <td class="p-3 border-b border-gray-200 dark:border-gray-700">
                <div class="flex flex-col gap-1">
                  {#if model.status === 'training_complete'}
                    <span class="inline-block px-3 py-1 rounded-md text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400">✅ Complete</span>
                  {:else}
                    <span class="inline-block px-3 py-1 rounded-md text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">❌ Failed</span>
                  {/if}
                  {#if model.error}
                    <div class="text-red-600 dark:text-red-400 text-xs">{model.error}</div>
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
