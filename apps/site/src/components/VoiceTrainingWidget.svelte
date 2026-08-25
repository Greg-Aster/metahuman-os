<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import DirectVoiceRecorder from './DirectVoiceRecorder.svelte';
  import ReferenceAudioSelector from './ReferenceAudioSelector.svelte';
  import { apiFetch } from '../lib/client/api-config';

  export let provider: 'piper' | 'sovits' | 'rvc' | 'kokoro' = 'rvc';

  interface TrainingReadiness {
    ready: boolean;
    reason?: string;
    samples?: { total: number; duration: number; quality: number };
    requirements?: { minSamples: number; minDuration: number; minQuality: number };
    copied?: { count: number; duration: number };
  }

  interface TrainingStatus {
    status: 'idle' | 'running' | 'completed' | 'failed';
    progress?: number;
    currentEpoch?: number;
    totalEpochs?: number;
    message?: string;
    error?: string;
    modelPath?: string;
  }

  let mounted = false;
  let loadedProvider = '';
  let readiness: TrainingReadiness | null = null;
  let trainingStatus: TrainingStatus | null = null;
  let selectedSampleIds: string[] = [];
  let logs: string[] = [];
  let error = '';
  let notice = '';
  let busy = false;
  let totalEpochs = 300;
  let saveEveryEpoch = 50;
  let batchSize = 8;
  let device: 'auto' | 'cuda' | 'cpu' = 'auto';
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  $: copiedReady = provider === 'rvc'
    && Boolean(readiness?.copied && readiness?.requirements)
    && (readiness?.copied?.count || 0) >= (readiness?.requirements?.minSamples || 0)
    && (readiness?.copied?.duration || 0) >= (readiness?.requirements?.minDuration || 0);

  $: if (mounted && provider !== loadedProvider) {
    loadedProvider = provider;
    void refresh();
  }

  onMount(() => {
    mounted = true;
    loadedProvider = provider;
    void refresh();
  });

  onDestroy(stopPolling);

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  function formatDuration(seconds = 0): string {
    const minutes = Math.floor(seconds / 60);
    const remainder = Math.round(seconds % 60);
    return minutes > 0 ? `${minutes}m ${remainder}s` : `${remainder}s`;
  }

  async function requestJson(url: string, init?: RequestInit) {
    const response = await apiFetch(url, init);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  }

  async function refresh() {
    error = '';
    notice = '';
    stopPolling();
    readiness = null;
    trainingStatus = null;
    logs = [];

    if (provider !== 'rvc' && provider !== 'sovits') return;

    try {
      if (provider === 'rvc') {
        readiness = await requestJson('/api/rvc-training?action=training-readiness&speakerId=default');
        await refreshRvcStatus();
      } else {
        readiness = await requestJson('/api/sovits-training?action=training-readiness&provider=gpt-sovits&speakerId=default');
      }
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  async function refreshRvcStatus() {
    if (provider !== 'rvc') return;
    trainingStatus = await requestJson('/api/rvc-training?action=training-status&speakerId=default');
    const logResult = await requestJson('/api/rvc-training?action=training-logs&speakerId=default');
    logs = Array.isArray(logResult.logs) ? logResult.logs : [];

    if (trainingStatus?.status === 'running' && !pollTimer) {
      pollTimer = setInterval(() => {
        void refreshRvcStatus().catch(cause => {
          error = cause instanceof Error ? cause.message : String(cause);
          stopPolling();
        });
      }, 5000);
    } else if (trainingStatus?.status !== 'running') {
      stopPolling();
    }
  }

  async function copySelected() {
    if (selectedSampleIds.length === 0) return;
    busy = true;
    error = '';
    try {
      const endpoint = provider === 'rvc' ? '/api/rvc-training' : '/api/sovits-training';
      const data = await requestJson(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'copy-samples',
          provider: provider === 'sovits' ? 'gpt-sovits' : provider,
          speakerId: 'default',
          sampleIds: selectedSampleIds,
        }),
      });
      notice = data.message || `${selectedSampleIds.length} samples copied`;
      await refresh();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      busy = false;
    }
  }

  async function autoExport() {
    busy = true;
    error = '';
    try {
      const endpoint = provider === 'rvc' ? '/api/rvc-training' : '/api/sovits-training';
      const data = await requestJson(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'auto-export',
          provider: provider === 'sovits' ? 'gpt-sovits' : provider,
          speakerId: 'default',
          minQuality: provider === 'rvc' ? 0.7 : 0.8,
          selectionMethod: 'quality',
          targetDuration: provider === 'rvc' ? 900 : 10,
          maxSamples: provider === 'rvc' ? 200 : 5,
        }),
      });
      notice = data.message || 'Best samples exported';
      await refresh();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      busy = false;
    }
  }

  async function startRvcTraining() {
    if (!copiedReady || busy) return;
    busy = true;
    error = '';
    notice = '';
    try {
      const data = await requestJson('/api/rvc-training', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'start-training',
          speakerId: 'default',
          totalEpochs,
          saveEveryEpoch,
          batchSize,
          device,
        }),
      });
      notice = data.message || 'RVC training started';
      await refreshRvcStatus();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      busy = false;
    }
  }
</script>

<section class="space-y-5">
  <header>
    <h3 class="m-0 text-xl font-semibold text-gray-900 dark:text-gray-100">Voice training</h3>
    <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
      Record clean source audio and use the maintained workflow for the active provider.
    </p>
  </header>

  {#if error}
    <div class="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">{error}</div>
  {/if}
  {#if notice}
    <div class="rounded-lg border border-green-500/40 bg-green-500/10 p-3 text-sm text-green-700 dark:text-green-300">{notice}</div>
  {/if}

  {#if provider === 'kokoro'}
    <div class="card p-5">
      <h4 class="m-0 text-lg font-medium">Kokoro</h4>
      <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
        The maintained Kokoro addon supports voice selection and synthesis. This repository does not include a verified custom voicepack trainer.
      </p>
    </div>
  {:else if provider === 'piper'}
    <div class="card p-5">
      <h4 class="m-0 text-lg font-medium">Piper</h4>
      <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
        Piper synthesis is supported, but no maintained Piper model-training workflow is exposed by this application.
      </p>
    </div>
  {:else}
    <DirectVoiceRecorder
      provider="gpt-sovits"
      speakerId="default"
      onRecordingComplete={() => void refresh()}
    />

    <div class="card space-y-4 p-5">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 class="m-0 text-lg font-medium">{provider === 'rvc' ? 'RVC dataset' : 'GPT-SoVITS reference audio'}</h4>
          {#if readiness}
            <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {readiness.samples?.total || 0} eligible samples · {formatDuration(readiness.samples?.duration || 0)}
              {#if readiness.copied} · {readiness.copied.count} copied{/if}
            </p>
          {/if}
        </div>
        <button class="btn-secondary btn-sm" disabled={busy} on:click={autoExport}>Export best samples</button>
      </div>

      {#if readiness?.reason && !readiness.ready}
        <p class="m-0 text-sm text-amber-700 dark:text-amber-300">{readiness.reason}</p>
      {/if}

      <ReferenceAudioSelector
        provider={provider === 'sovits' ? 'gpt-sovits' : 'rvc'}
        speakerId="default"
        minQuality={provider === 'rvc' ? 0.7 : 0.8}
        onSelectionChange={(ids) => selectedSampleIds = ids}
      />

      <div class="flex justify-end">
        <button class="btn-primary btn-sm" disabled={busy || selectedSampleIds.length === 0} on:click={copySelected}>
          Copy {selectedSampleIds.length} selected
        </button>
      </div>
    </div>

    {#if provider === 'rvc'}
      <div class="card space-y-4 p-5">
        <div>
          <h4 class="m-0 text-lg font-medium">RVC training</h4>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Training starts only after the copied dataset satisfies the configured sample and duration requirements.
          </p>
        </div>

        <div class="grid gap-3 sm:grid-cols-4">
          <label class="text-sm">Epochs<input class="input-field mt-1" type="number" min="1" max="5000" bind:value={totalEpochs} /></label>
          <label class="text-sm">Save interval<input class="input-field mt-1" type="number" min="1" max="1000" bind:value={saveEveryEpoch} /></label>
          <label class="text-sm">Batch size<input class="input-field mt-1" type="number" min="1" max="128" bind:value={batchSize} /></label>
          <label class="text-sm">Device<select class="input-field mt-1" bind:value={device}><option value="auto">Auto</option><option value="cuda">CUDA</option><option value="cpu">CPU</option></select></label>
        </div>

        <button class="btn-primary" disabled={busy || !copiedReady || trainingStatus?.status === 'running'} on:click={startRvcTraining}>
          {trainingStatus?.status === 'running' ? 'Training in progress' : 'Start RVC training'}
        </button>

        {#if trainingStatus && trainingStatus.status !== 'idle'}
          <div class="rounded-lg border border-gray-300 p-3 text-sm dark:border-gray-700">
            <strong class="capitalize">{trainingStatus.status}</strong>
            {#if trainingStatus.progress !== undefined} · {trainingStatus.progress}%{/if}
            {#if trainingStatus.currentEpoch !== undefined} · epoch {trainingStatus.currentEpoch}/{trainingStatus.totalEpochs || '?'}{/if}
            {#if trainingStatus.message}<p class="mb-0 mt-2">{trainingStatus.message}</p>{/if}
            {#if trainingStatus.modelPath}<p class="mb-0 mt-2 font-mono text-xs">{trainingStatus.modelPath}</p>{/if}
            {#if trainingStatus.error}<p class="mb-0 mt-2 text-red-600 dark:text-red-300">{trainingStatus.error}</p>{/if}
          </div>
        {/if}

        {#if logs.length > 0}
          <details>
            <summary class="cursor-pointer text-sm font-medium">Recent training log</summary>
            <pre class="mt-2 max-h-72 overflow-auto rounded bg-black p-3 text-xs text-gray-200">{logs.join('\n')}</pre>
          </details>
        {/if}
      </div>
    {/if}
  {/if}
</section>
