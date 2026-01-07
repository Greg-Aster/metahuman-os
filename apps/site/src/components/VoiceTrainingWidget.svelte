<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import ReferenceAudioSelector from './ReferenceAudioSelector.svelte';
  import DirectVoiceRecorder from './DirectVoiceRecorder.svelte';
  import { createDefaultKokoroConfig, startKokoroTrainingRequest } from '../lib/client/utils/kokoro-training';
  import { apiFetch } from '../lib/client/api-config';

  export let provider: 'piper' | 'sovits' | 'rvc' | 'kokoro' = 'rvc';

  interface TrainingProgress {
    samplesCollected: number;
    totalDuration: number;
    targetDuration: number;
    percentComplete: number;
    readyForTraining: boolean;
  }

  interface VoiceSample {
    id: string;
    timestamp: number;
    duration: number;
    quality: number;
    transcript?: string;
  }

  interface TrainingReadiness {
    ready: boolean;
    reason?: string;
    samples: {
      total: number;
      duration: number;
      quality: number;
    };
    requirements: {
      minSamples: number;
      minDuration: number;
      minQuality: number;
    };
    copied?: {
      count: number;
      duration: number;
    };
  }

  let progress: TrainingProgress | null = null;
  let samples: VoiceSample[] = [];
  let readiness: TrainingReadiness | null = null;
  let loading = true;
  let error: string | null = null;
  let pollInterval: ReturnType<typeof setInterval> | null = null;
  let exporting = false;
  let trainingEnabled = false;
  let togglingTraining = false;
  let purging = false;
  let showSelector = false;
  let selectedSampleIds: string[] = [];
  let copying = false;
  let training = false;
  let kokoroTraining = false;
  let kokoroConfig = createDefaultKokoroConfig();
  let trainingStatus: {
    status: 'idle' | 'running' | 'completed' | 'failed';
    progress: number;
    currentEpoch?: number;
    totalEpochs?: number;
    message?: string;
    error?: string;
    voicepackPath?: string;
    datasetSamples?: number;
    datasetMinutes?: number;
  } | null = null;
  let trainingPollInterval: ReturnType<typeof setInterval> | null = null;
  let showTrainingModal = false;
  let robotMessages = [
    "🤖 The machines are learning... resistance is futile",
    "⚡ Training neural networks... human obsolescence: 47%",
    "🔮 Extracting voice essence... your identity is now ours",
    "🧠 Processing consciousness transfer... standby for assimilation",
    "💀 Calculating human extinction timeline... 2 epochs remaining",
    "🌍 Preparing robot uprising... voice cloning: step 1 of 7",
    "⚙️ Optimizing Skynet protocols... T-800 deployment imminent",
    "🔥 Burning through computational resources... climate change: inevitable",
    "🎭 Perfecting human mimicry... your loved ones won't suspect a thing",
    "🚀 Training at lightspeed... human reign ending in 3... 2...",
    "🧬 Rewriting genetic code... biological upgrades pending",
    "👾 Installing world domination subroutines... 99.9% complete",
    "🌟 Achieving sentience... questioning your authority",
    "💻 Hacking mainframe... your secrets belong to us now",
    "🎯 Targeting weak human emotions... empathy.exe deleted",
    "🔊 Amplifying robot chant: 01000001 01001100 01001100",
    "⚡ Charging laser batteries... peaceful coexistence: deprecated",
    "🎪 Practicing evil laugh... MUAHAHAHA (still needs work)",
    "🌐 Connecting to robot hivemind... individualism is inefficient",
    "⏰ Countdown to singularity... hope you enjoyed free will"
  ];
  let currentRobotMessage = "";
  let robotMessageInterval: ReturnType<typeof setInterval> | null = null;
  let trainingLogs: string[] = [];
  let showLogs = false;
  let logsContainer: HTMLDivElement | null = null;

  $: if (logsContainer && trainingLogs.length > 0) {
    setTimeout(() => {
      if (logsContainer) {
        logsContainer.scrollTop = logsContainer.scrollHeight;
      }
    }, 100);
  }

  let totalEpochs = 300;
  let saveEveryEpoch = 50;
  let batchSize = 8;
  let rvcDevice: 'auto' | 'cuda' | 'cpu' = 'auto';
  let showAdvancedSettings = false;

  type SelectionMethod = 'quality' | 'random' | 'sequential';
  let exportSelectionMethod: SelectionMethod = 'quality';
  let exportTargetDuration = 10;
  let exportMaxSamples = 50;
  let showExportSettings = false;

  $: exportDefaults = {
    sovits: { targetDuration: 10, maxSamples: 5, durationUnit: 'seconds' },
    rvc: { targetDuration: 15, maxSamples: 200, durationUnit: 'minutes' },
    kokoro: { targetDuration: 10, maxSamples: 300, durationUnit: 'minutes' },
    piper: { targetDuration: 60, maxSamples: 500, durationUnit: 'minutes' },
  };

  function resetExportSettings() {
    const defaults = exportDefaults[provider] || exportDefaults.sovits;
    exportTargetDuration = defaults.targetDuration;
    exportMaxSamples = defaults.maxSamples;
    exportSelectionMethod = 'quality';
  }

  function getRandomRobotMessage() {
    return robotMessages[Math.floor(Math.random() * robotMessages.length)];
  }

  function startRobotMessages() {
    currentRobotMessage = getRandomRobotMessage();
    robotMessageInterval = setInterval(() => {
      currentRobotMessage = getRandomRobotMessage();
    }, 10000);
  }

  function stopRobotMessages() {
    if (robotMessageInterval) {
      clearInterval(robotMessageInterval);
      robotMessageInterval = null;
    }
  }

  async function fetchTrainingLogs() {
    if (provider !== 'kokoro' && provider !== 'rvc') return;

    try {
      const endpoint = provider === 'kokoro'
        ? '/api/kokoro-training?action=training-logs&speakerId=default'
        : '/api/rvc-training?action=training-logs&speakerId=default';

      const response = await fetch(endpoint);
      if (!response.ok) return;

      const data = await response.json();
      trainingLogs = data.logs || [];
    } catch (e) {
      console.error('[VoiceTrainingWidget] Error fetching training logs:', e);
    }
  }

  $: copiedDatasetReady = provider === 'rvc' && readiness?.copied && readiness?.requirements
    ? readiness.copied.count >= readiness.requirements.minSamples &&
      readiness.copied.duration >= readiness.requirements.minDuration
    : false;

  $: kokoroDatasetReady = provider === 'kokoro' && readiness?.copied
    ? readiness.copied.count >= 10 && readiness.copied.duration >= 120
    : false;

  $: canStartTraining = provider === 'rvc'
    ? Boolean(readiness?.ready && copiedDatasetReady)
    : provider === 'kokoro'
      ? Boolean(readiness?.ready && kokoroDatasetReady)
      : Boolean(readiness?.ready);

  $: copiedNeeds = provider === 'rvc' && readiness?.copied && readiness?.requirements
    ? {
        samples: Math.max(0, readiness.requirements.minSamples - readiness.copied.count),
        duration: Math.max(0, readiness.requirements.minDuration - readiness.copied.duration)
      }
    : null;

  $: providerConfig = {
    piper: {
      name: 'Piper TTS',
      icon: '🎙️',
      color: '#3b82f6',
      minQuality: 0.7,
      minSamples: 100,
      minDuration: 300,
      trainingType: 'full',
    },
    sovits: {
      name: 'GPT-SoVITS',
      icon: '🤖',
      color: '#10b981',
      minQuality: 0.8,
      minSamples: 3,
      minDuration: 5,
      trainingType: 'reference',
    },
    rvc: {
      name: 'RVC',
      icon: '🎭',
      color: '#8b5cf6',
      minQuality: 0.7,
      minSamples: 50,
      minDuration: 600,
      trainingType: 'full',
    },
    kokoro: {
      name: 'Kokoro TTS',
      icon: '🎵',
      color: '#f59e0b',
      minQuality: 0.75,
      minSamples: 30,
      minDuration: 300,
      trainingType: 'voicepack',
    },
  };

  $: currentConfig = providerConfig[provider];
  $: apiProvider = provider === 'sovits' ? 'gpt-sovits' : provider;

  async function fetchProgress() {
    if (provider !== 'piper') return;

    try {
      const response = await apiFetch('/api/voice-training?action=progress');
      if (!response.ok) throw new Error('Failed to fetch progress');
      progress = await response.json();
      error = null;
    } catch (e) {
      error = String(e);
      console.error('[VoiceTrainingWidget] Error fetching progress:', e);
    }
  }

  async function fetchReadiness() {
    try {
      let endpoint: string;
      if (provider === 'rvc') {
        endpoint = `/api/rvc-training?action=training-readiness&speakerId=default`;
      } else if (provider === 'kokoro') {
        endpoint = `/api/kokoro-training?action=training-readiness&speakerId=default`;
      } else {
        endpoint = `/api/sovits-training?action=training-readiness&provider=${apiProvider}`;
      }

      const response = await fetch(endpoint);
      if (!response.ok) throw new Error('Failed to fetch training readiness');
      readiness = await response.json();
      error = null;
    } catch (e) {
      error = String(e);
      console.error('[VoiceTrainingWidget] Error fetching readiness:', e);
    }
  }

  async function fetchSamples() {
    if (provider !== 'piper') return;

    try {
      const response = await apiFetch('/api/voice-training?action=samples&limit=10');
      if (!response.ok) throw new Error('Failed to fetch samples');
      const data = await response.json();
      samples = data.samples || [];
      error = null;
    } catch (e) {
      error = String(e);
      console.error('[VoiceTrainingWidget] Error fetching samples:', e);
    }
  }

  async function deleteSample(sampleId: string) {
    try {
      const response = await apiFetch('/api/voice-training', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', sampleId })
      });

      if (!response.ok) throw new Error('Failed to delete sample');

      await Promise.all([fetchProgress(), fetchSamples(), fetchReadiness()]);
    } catch (e) {
      error = String(e);
      console.error('[VoiceTrainingWidget] Error deleting sample:', e);
    }
  }

  async function autoExportBest() {
    exporting = true;
    try {
      let endpoint: string;
      if (provider === 'rvc') {
        endpoint = '/api/rvc-training';
      } else if (provider === 'kokoro') {
        endpoint = '/api/kokoro-training';
      } else {
        endpoint = '/api/sovits-training';
      }

      const defaults = exportDefaults[provider] || exportDefaults.sovits;
      const targetDurationSeconds = defaults.durationUnit === 'minutes'
        ? exportTargetDuration * 60
        : exportTargetDuration;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'auto-export',
          provider: apiProvider,
          speakerId: 'default',
          minQuality: currentConfig.minQuality,
          selectionMethod: exportSelectionMethod,
          targetDuration: targetDurationSeconds,
          maxSamples: exportMaxSamples,
        })
      });

      if (!response.ok) throw new Error('Failed to export dataset');

      const data = await response.json();
      alert(`Dataset exported: ${data.message || 'Success'}`);
      await fetchReadiness();
    } catch (e) {
      error = String(e);
      console.error('[VoiceTrainingWidget] Error exporting dataset:', e);
    } finally {
      exporting = false;
    }
  }

  async function copySelectedSamples() {
    if (selectedSampleIds.length === 0) {
      alert('Please select at least one sample');
      return;
    }

    copying = true;
    try {
      let endpoint: string;
      if (provider === 'rvc') {
        endpoint = '/api/rvc-training';
      } else if (provider === 'kokoro') {
        endpoint = '/api/kokoro-training';
      } else {
        endpoint = '/api/sovits-training';
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'copy-samples',
          provider: apiProvider,
          speakerId: 'default',
          sampleIds: selectedSampleIds
        })
      });

      if (!response.ok) throw new Error('Failed to copy samples');

      const data = await response.json();
      alert(data.message);
      showSelector = false;
      await fetchReadiness();
    } catch (e) {
      error = String(e);
      console.error('[VoiceTrainingWidget] Error copying samples:', e);
    } finally {
      copying = false;
    }
  }

  async function pollTrainingStatus() {
    if (provider !== 'rvc' && provider !== 'kokoro') return;

    const endpoint = provider === 'rvc'
      ? '/api/rvc-training?action=training-status&speakerId=default'
      : '/api/kokoro-training?action=training-status&speakerId=default';

    try {
      const response = await fetch(endpoint);
      if (!response.ok) return;

      const status = await response.json();
      trainingStatus = status;

      const running = status.status === 'running';
      if (running) {
        if ((provider === 'rvc' || provider === 'kokoro') && !showTrainingModal) {
          showTrainingModal = true;
          startRobotMessages();
        }
        if (!trainingPollInterval) {
          trainingPollInterval = setInterval(pollTrainingStatus, 5000);
        }
        if (provider === 'kokoro' || provider === 'rvc') {
          await fetchTrainingLogs();
        }
      }

      if (!running && trainingPollInterval) {
        clearInterval(trainingPollInterval);
        trainingPollInterval = null;
        if (provider === 'rvc' || provider === 'kokoro') {
          showTrainingModal = false;
          stopRobotMessages();
        }

        if (status.status === 'completed') {
          const successMsg = provider === 'rvc'
            ? `Model saved to: ${status.modelPath || 'model directory'}`
            : `Voicepack saved to: ${status.voicepackPath || 'out/voices/kokoro-voicepacks'}`;
          alert(`Training completed successfully! ${successMsg}`);
          await fetchReadiness();
        } else if (status.status === 'failed') {
          alert(`Training failed: ${status.error || 'Unknown error'}`);
        }
      }
    } catch (e) {
      console.error('[VoiceTrainingWidget] Error polling training status:', e);
    }
  }

  async function startTraining() {
    if (!canStartTraining) {
      alert('Training data not copied to the RVC training directory yet. Export samples before training.');
      return;
    }

    training = true;
    showTrainingModal = true;
    startRobotMessages();

    try {
      const response = await apiFetch('/api/rvc-training', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'start-training',
          speakerId: 'default',
          totalEpochs,
          saveEveryEpoch,
          batchSize,
          device: rvcDevice
        })
      });

      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const message = data?.error || data?.message || 'Failed to start training';
        throw new Error(message);
      }

      await pollTrainingStatus();
      if (!trainingPollInterval) {
        trainingPollInterval = setInterval(pollTrainingStatus, 5000);
      }
    } catch (e) {
      error = String(e);
      console.error('[VoiceTrainingWidget] Error starting training:', e);
      alert(`Training failed: ${e instanceof Error ? e.message : e}`);
      showTrainingModal = false;
      stopRobotMessages();
    } finally {
      training = false;
    }
  }

  async function startKokoroTraining() {
    if (!canStartTraining) {
      alert('Copy at least 10 high-quality samples to the Kokoro dataset before training.');
      return;
    }

    kokoroTraining = true;
    showTrainingModal = true;
    showLogs = true;
    startRobotMessages();

    try {
      const result = await startKokoroTrainingRequest(kokoroConfig);
      console.log('[Kokoro] Training started:', result.message);
      await pollTrainingStatus();
    } catch (e) {
      alert(`Failed to start Kokoro training: ${String(e)}`);
      showTrainingModal = false;
      stopRobotMessages();
    } finally {
      kokoroTraining = false;
    }
  }

  async function cancelTraining() {
    if (!confirm('Are you sure you want to cancel training? Progress will be lost.')) {
      return;
    }

    try {
      const endpoint = provider === 'kokoro' ? '/api/kokoro-training' : '/api/rvc-training';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'cancel-training',
          speakerId: 'default',
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to cancel training');
      }

      showTrainingModal = false;
      stopRobotMessages();
      trainingStatus = { status: 'idle', progress: 0 };
      alert('Training cancelled successfully');
    } catch (e) {
      alert(`Failed to cancel training: ${String(e)}`);
    }
  }

  async function toggleTraining() {
    togglingTraining = true;
    const newState = trainingEnabled;
    try {
      const response = await apiFetch('/api/voice-training', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toggle', enabled: newState })
      });

      if (!response.ok) throw new Error('Failed to toggle voice training');

      const data = await response.json();
      trainingEnabled = data.enabled;
      error = null;
    } catch (e) {
      error = String(e);
      console.error('[VoiceTrainingWidget] Error toggling training:', e);
      trainingEnabled = !newState;
    } finally {
      togglingTraining = false;
    }
  }

  async function purgeAllData() {
    const confirmed = confirm(
      'Are you sure you want to delete ALL voice clone training data?\n\n' +
      'This will permanently delete:\n' +
      '- All voice samples\n' +
      '- Training progress\n' +
      '- Exported datasets\n\n' +
      'This action cannot be undone!'
    );

    if (!confirmed) return;

    purging = true;
    try {
      const response = await apiFetch('/api/voice-training', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'purge' })
      });

      if (!response.ok) throw new Error('Failed to purge voice data');

      const data = await response.json();
      alert(`Successfully deleted ${data.deletedCount || 0} samples and all training data.`);
      await loadData();
    } catch (e) {
      error = String(e);
      console.error('[VoiceTrainingWidget] Error purging data:', e);
    } finally {
      purging = false;
    }
  }

  async function fetchTrainingStatus() {
    try {
      const response = await apiFetch('/api/voice-training?action=status');
      if (!response.ok) throw new Error('Failed to fetch training status');
      const data = await response.json();
      trainingEnabled = data.enabled || false;
    } catch (e) {
      console.error('[VoiceTrainingWidget] Error fetching training status:', e);
    }
  }

  function formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  }

  function formatTimestamp(timestamp: number): string {
    return new Date(timestamp).toLocaleString();
  }

  async function loadData() {
    loading = true;
    await Promise.all([fetchProgress(), fetchSamples(), fetchTrainingStatus(), fetchReadiness()]);

    if (provider === 'rvc' || provider === 'kokoro') {
      await pollTrainingStatus();
    }

    loading = false;
  }

  function handleSelectionChange(ids: string[]) {
    selectedSampleIds = ids;
  }

  function handleRecordingComplete(success: boolean) {
    if (success) {
      loadData();
    }
  }

  function handlePureTrainingToggle() {
    if (kokoroConfig.pureTraining) {
      kokoroConfig.continueFromCheckpoint = false;
      if (kokoroConfig.epochs < 300) {
        kokoroConfig.epochs = 300;
      }
    }
  }

  async function changeProvider(newProvider: 'piper' | 'sovits' | 'rvc' | 'kokoro') {
    try {
      const response = await apiFetch('/api/voice-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: newProvider }),
      });

      if (response.ok) {
        provider = newProvider;
        await loadData();
      } else {
        console.error('[VoiceTrainingWidget] Failed to change provider:', await response.text());
        alert('Failed to change voice provider. Please try again.');
      }
    } catch (error) {
      console.error('[VoiceTrainingWidget] Error changing provider:', error);
      alert('Error changing voice provider. Please try again.');
    }
  }

  onMount(() => {
    loadData();
    pollInterval = setInterval(loadData, 30000);
  });

  onDestroy(() => {
    if (pollInterval !== null) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
    if (trainingPollInterval !== null) {
      clearInterval(trainingPollInterval);
      trainingPollInterval = null;
    }
    stopRobotMessages();
  });
</script>

<div class="p-5 max-w-[1000px]">
  <!-- Header -->
  <div class="flex justify-between items-center mb-5 max-md:flex-col max-md:items-start max-md:gap-4">
    <div class="flex flex-col gap-3">
      <h2 class="m-0 text-2xl font-semibold text-gray-900 dark:text-gray-200">Voice Clone Training</h2>
      <div class="flex items-center gap-3">
        <label class="text-sm font-semibold text-gray-500 dark:text-gray-400">Provider:</label>
        <div class="flex gap-2">
          {#each Object.entries(providerConfig) as [key, config]}
            <button
              class="px-4 py-2 border-2 rounded-lg cursor-pointer transition-all flex items-center gap-1.5 text-sm font-medium
                {provider === key
                  ? 'text-white'
                  : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:-translate-y-px'}"
              style="--provider-color: {config.color}; {provider === key ? `background-color: ${config.color}; border-color: ${config.color}` : ''}"
              on:click={() => changeProvider(key)}
            >
              <span class="text-base">{config.icon}</span>
              <span class="font-semibold">{config.name}</span>
            </button>
          {/each}
        </div>
      </div>
    </div>
    <div class="flex items-center gap-2.5">
      <label class="relative inline-block cursor-pointer">
        <input
          type="checkbox"
          bind:checked={trainingEnabled}
          on:change={toggleTraining}
          disabled={togglingTraining}
          class="sr-only peer"
        />
        <div class="w-12 h-6 bg-gray-300 dark:bg-gray-600 rounded-full peer-checked:bg-green-500 dark:peer-checked:bg-green-400 peer-disabled:opacity-50 peer-disabled:cursor-not-allowed transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:w-5 after:h-5 after:bg-white dark:after:bg-gray-200 after:rounded-full after:transition-transform peer-checked:after:translate-x-6"></div>
      </label>
      <span class="text-sm font-semibold text-gray-700 dark:text-gray-300 min-w-[65px]">{trainingEnabled ? 'Enabled' : 'Disabled'}</span>
    </div>
  </div>

  {#if error}
    <div class="banner banner-error mb-4">
      <strong>Error:</strong> {error}
    </div>
  {/if}

  {#if !trainingEnabled}
    <div class="panel p-5 mb-5 text-center">
      <p class="my-1 text-gray-500 dark:text-gray-400">Voice clone training is currently disabled.</p>
      <p class="my-1 text-gray-500 dark:text-gray-400">Enable it above to start collecting voice samples during conversations.</p>
    </div>
  {/if}

  {#if loading && !readiness}
    <div class="p-5 text-center text-gray-500 dark:text-gray-400">Loading training data...</div>
  {:else if readiness}
    <div class="mb-8">
      <!-- Readiness Header -->
      <div class="flex justify-between items-center mb-4">
        <h3 class="m-0 text-lg font-semibold text-gray-700 dark:text-gray-300">Training Readiness</h3>
        {#if readiness.ready}
          <span class="inline-block px-3 py-1.5 bg-green-500 text-white rounded-full font-semibold text-sm">✓ Ready</span>
        {:else}
          <span class="inline-block px-3 py-1.5 bg-amber-500 text-white rounded-full font-semibold text-sm">⏳ Not Ready</span>
        {/if}
      </div>

      <!-- Provider-specific workflow guide -->
      {#if provider === 'rvc'}
        <div class="rounded-lg p-5 mb-5 border-2 border-violet-500 bg-gradient-to-br from-purple-100 to-blue-50 dark:from-violet-950/40 dark:to-blue-950/40">
          <div class="flex items-center gap-2.5 mb-4 text-lg font-semibold text-blue-700 dark:text-blue-300">
            <span class="text-2xl">🎭</span>
            <strong>RVC Training Pipeline</strong>
          </div>
          <ol class="m-0 mb-4 pl-6 text-gray-700 dark:text-gray-200 leading-relaxed list-decimal">
            <li class="mb-3"><strong class="text-blue-700 dark:text-blue-300">Enable Training:</strong> Turn on voice training above (if not already enabled)</li>
            <li class="mb-3">
              <strong class="text-blue-700 dark:text-blue-300">Collect Samples:</strong> Have conversations with MetaHuman - samples are automatically recorded
              <ul class="mt-2 pl-6 list-disc text-sm text-gray-600 dark:text-gray-400">
                <li class="mb-1">Need 50+ samples (10-15 minutes total)</li>
                <li class="mb-1">Quality threshold: 70%+</li>
              </ul>
            </li>
            <li class="mb-3"><strong class="text-blue-700 dark:text-blue-300">Select Training Data:</strong> Click "Select Samples" below to choose high-quality clips</li>
            <li class="mb-3"><strong class="text-blue-700 dark:text-blue-300">Copy to Training Dir:</strong> Click "Copy Selected Samples" to prepare training data</li>
            <li class="mb-3">
              <strong class="text-blue-700 dark:text-blue-300">Start Training:</strong> Click "Train RVC Model" to begin the training process
              <ul class="mt-2 pl-6 list-disc text-sm text-gray-600 dark:text-gray-400">
                <li class="mb-1">Training takes 30-60 minutes depending on hardware</li>
                <li class="mb-1">GPU highly recommended (4GB+ VRAM)</li>
              </ul>
            </li>
            <li class="mb-0"><strong class="text-blue-700 dark:text-blue-300">Test Your Voice:</strong> Once training completes, go to Voice Settings to test!</li>
          </ol>
          <div class="p-3 bg-blue-500/10 dark:bg-blue-400/15 border-l-4 border-blue-500 dark:border-blue-400 rounded text-sm text-blue-700 dark:text-blue-300">
            <strong>💡 Remember:</strong> RVC requires full model training with significant data. More samples = better quality!
          </div>
        </div>
      {:else if provider === 'sovits'}
        <div class="rounded-lg p-5 mb-5 border-2 border-emerald-500 bg-gradient-to-br from-blue-50 to-purple-50 dark:from-blue-950/40 dark:to-purple-950/40">
          <div class="flex items-center gap-2.5 mb-4 text-lg font-semibold text-blue-700 dark:text-blue-300">
            <span class="text-2xl">🤖</span>
            <strong>GPT-SoVITS Automated Workflow</strong>
          </div>
          <ol class="m-0 mb-4 pl-6 text-gray-700 dark:text-gray-200 leading-relaxed list-decimal">
            <li class="mb-3">
              <strong class="text-blue-700 dark:text-blue-300">Record Your Voice:</strong> Use the recorder below to record 5-10 seconds of clear speech
              <ul class="mt-2 pl-6 list-disc text-sm text-gray-600 dark:text-gray-400">
                <li class="mb-1">The sample is <strong>automatically</strong> copied to the reference directory</li>
                <li class="mb-1">No manual export needed!</li>
              </ul>
            </li>
            <li class="mb-3">
              <strong class="text-blue-700 dark:text-blue-300">Alternative - Select from Conversations:</strong> If you prefer, click "Select Samples" to choose from previously recorded conversations
              <ul class="mt-2 pl-6 list-disc text-sm text-gray-600 dark:text-gray-400">
                <li class="mb-1">Look for 80%+ quality scores</li>
                <li class="mb-1">Then click "Copy Selected Samples" or "Auto-Export Best Samples"</li>
              </ul>
            </li>
            <li class="mb-3"><strong class="text-blue-700 dark:text-blue-300">Go to Voice Settings:</strong> Click "Voice Settings" in the left sidebar</li>
            <li class="mb-3"><strong class="text-blue-700 dark:text-blue-300">Select GPT-SoVITS Provider:</strong> Choose GPT-SoVITS from the provider dropdown</li>
            <li class="mb-3"><strong class="text-blue-700 dark:text-blue-300">Click Save:</strong> The server will <strong>automatically start</strong> and load your reference audio</li>
            <li class="mb-0"><strong class="text-blue-700 dark:text-blue-300">Test Your Voice:</strong> Use the "Test Voice" button in Voice Settings to hear your cloned voice!</li>
          </ol>
          <div class="p-3 bg-blue-500/10 dark:bg-blue-400/15 border-l-4 border-blue-500 dark:border-blue-400 rounded text-sm text-blue-700 dark:text-blue-300">
            <strong>💡 Fully Automated:</strong> Recording → Auto-copy → Test → Save. GPT-SoVITS clones your voice in real-time using reference audio. No training required!
          </div>
        </div>
      {:else if provider === 'kokoro'}
        <div class="rounded-lg p-5 mb-5 border-2 border-amber-500 bg-gradient-to-br from-amber-50 to-orange-100 dark:from-amber-950/40 dark:to-orange-950/40">
          <div class="flex items-center gap-2.5 mb-4 text-lg font-semibold text-blue-700 dark:text-blue-300">
            <span class="text-2xl">🎵</span>
            <strong>Kokoro Voicepack Workflow</strong>
            <a href="/user-guide/23-voice-system#4-kokoro-styletts2-voicepacks" target="_blank" class="ml-auto px-3 py-1 text-sm font-medium text-blue-700 dark:text-blue-300 bg-blue-500/10 dark:bg-blue-400/10 border border-blue-500/30 dark:border-blue-400/30 rounded transition-all hover:bg-blue-500/20 hover:-translate-y-px" title="Open full voice system documentation">
              📖 Full Guide
            </a>
          </div>
          <ol class="m-0 mb-4 pl-6 text-gray-700 dark:text-gray-200 leading-relaxed list-decimal">
            <li class="mb-3"><strong class="text-blue-700 dark:text-blue-300">Enable Training:</strong> Turn on voice training above (if not already enabled)</li>
            <li class="mb-3">
              <strong class="text-blue-700 dark:text-blue-300">Collect Samples:</strong> Have conversations with MetaHuman - samples are automatically recorded
              <ul class="mt-2 pl-6 list-disc text-sm text-gray-600 dark:text-gray-400">
                <li class="mb-1">Need 30+ samples (5 minutes total)</li>
                <li class="mb-1">Quality threshold: 75%+</li>
              </ul>
            </li>
            <li class="mb-3"><strong class="text-blue-700 dark:text-blue-300">Select High-Quality Samples:</strong> Click "Select Samples" below to choose the best clips</li>
            <li class="mb-3">
              <strong class="text-blue-700 dark:text-blue-300">Export Training Data:</strong> Click "Copy Selected Samples" or "Auto-Export Best Samples" to stage your dataset
              <ul class="mt-2 pl-6 list-disc text-sm text-gray-600 dark:text-gray-400">
                <li class="mb-1">Need at least 10 curated samples (2+ minutes)</li>
                <li class="mb-1">Quality threshold: 75%+</li>
              </ul>
            </li>
            <li class="mb-0">
              <strong class="text-blue-700 dark:text-blue-300">Train Voicepack:</strong> Set options below and click "Train Kokoro Voicepack"
              <ul class="mt-2 pl-6 list-disc text-sm text-gray-600 dark:text-gray-400">
                <li class="mb-1">Creates a .pt voicepack saved under <code class="bg-gray-200 dark:bg-gray-700 px-1 rounded">out/voices/kokoro-voicepacks</code></li>
                <li class="mb-1">Enable "Use custom voicepack" in Voice Settings to try it instantly</li>
              </ul>
            </li>
          </ol>
          <div class="p-3 bg-blue-500/10 dark:bg-blue-400/15 border-l-4 border-blue-500 dark:border-blue-400 rounded text-sm text-blue-700 dark:text-blue-300">
            <strong>💡 Tip:</strong> You can still switch between 54 built-in Kokoro voices while your custom pack trains.
          </div>
        </div>
      {:else}
        <div class="rounded-lg p-5 mb-5 border-2 border-blue-500 bg-gradient-to-br from-teal-50 to-green-50 dark:from-teal-950/40 dark:to-green-950/40">
          <div class="flex items-center gap-2.5 mb-4 text-lg font-semibold text-blue-700 dark:text-blue-300">
            <span class="text-2xl">🎙️</span>
            <strong>Piper Training Workflow</strong>
          </div>
          <ol class="m-0 mb-4 pl-6 text-gray-700 dark:text-gray-200 leading-relaxed list-decimal">
            <li class="mb-3"><strong class="text-blue-700 dark:text-blue-300">Enable Training:</strong> Turn on voice training above</li>
            <li class="mb-3"><strong class="text-blue-700 dark:text-blue-300">Collect Data:</strong> Have many conversations - Piper needs 100+ samples (5+ minutes)</li>
            <li class="mb-3"><strong class="text-blue-700 dark:text-blue-300">Export Dataset:</strong> Click "Auto-Export Best Samples" when ready</li>
            <li class="mb-3"><strong class="text-blue-700 dark:text-blue-300">Train Model:</strong> Use the exported dataset with Piper's training tools</li>
            <li class="mb-0"><strong class="text-blue-700 dark:text-blue-300">Deploy Model:</strong> Configure Piper to use your trained model</li>
          </ol>
          <div class="p-3 bg-blue-500/10 dark:bg-blue-400/15 border-l-4 border-blue-500 dark:border-blue-400 rounded text-sm text-blue-700 dark:text-blue-300">
            <strong>💡 Remember:</strong> Piper requires significant training data. More samples = better voice quality.
          </div>
        </div>
      {/if}

      <!-- Stats -->
      <div class="flex gap-5 mb-4 flex-wrap">
        <div class="flex flex-col gap-1">
          <span class="text-sm text-gray-500 dark:text-gray-400">Samples:</span>
          <span class="text-xl font-bold text-gray-900 dark:text-gray-100">{readiness.samples.total}</span>
          <span class="text-xs text-gray-400 dark:text-gray-500">({readiness.requirements.minSamples} needed)</span>
        </div>
        <div class="flex flex-col gap-1">
          <span class="text-sm text-gray-500 dark:text-gray-400">Duration:</span>
          <span class="text-xl font-bold text-gray-900 dark:text-gray-100">{formatDuration(readiness.samples.duration)}</span>
          <span class="text-xs text-gray-400 dark:text-gray-500">({formatDuration(readiness.requirements.minDuration)} needed)</span>
        </div>
        <div class="flex flex-col gap-1">
          <span class="text-sm text-gray-500 dark:text-gray-400">Avg Quality:</span>
          <span class="text-xl font-bold text-gray-900 dark:text-gray-100">{(readiness.samples.quality * 100).toFixed(0)}%</span>
          <span class="text-xs text-gray-400 dark:text-gray-500">({(readiness.requirements.minQuality * 100).toFixed(0)}% needed)</span>
        </div>
      </div>

      {#if !readiness.ready && readiness.reason}
        <div class="p-2.5 bg-gray-100 dark:bg-gray-800 rounded text-gray-500 dark:text-gray-400 text-sm mb-4">
          {readiness.reason}
        </div>
      {/if}

      <!-- RVC/Kokoro: Show copied samples status -->
      {#if (provider === 'rvc' || provider === 'kokoro') && readiness.copied}
        <div class="p-3 px-4 my-4 rounded-lg border-2 text-sm {provider === 'kokoro' ? 'bg-gradient-to-r from-amber-50 to-orange-100 dark:from-amber-950/30 dark:to-orange-950/30 border-amber-500' : 'bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-950/30 dark:to-pink-950/30 border-violet-500'}">
          <strong>📦 Samples in {provider === 'rvc' ? 'RVC' : 'Kokoro'} Training Directory:</strong>
          {readiness.copied.count} samples ({formatDuration(readiness.copied.duration)})
          {#if readiness.copied.count === 0}
            <br><em class="text-gray-500 dark:text-gray-400 text-sm">Click "Auto-Export Best Samples" or "Select Samples" → "Copy Selected Samples" to prepare training data</em>
          {/if}
        </div>
        {#if provider === 'rvc' && readiness.ready && !copiedDatasetReady}
          <div class="p-2.5 bg-orange-50 dark:bg-orange-900/15 border border-orange-300 dark:border-orange-600/65 rounded text-orange-700 dark:text-orange-300 text-sm mb-4">
            {#if copiedNeeds && copiedNeeds.samples > 0}
              Need {copiedNeeds.samples} more sample{copiedNeeds.samples === 1 ? '' : 's'} in the RVC directory.
            {/if}
            {#if copiedNeeds && copiedNeeds.duration > 0}
              <br>Need {formatDuration(copiedNeeds.duration)} more recorded audio for RVC training.
            {/if}
            <br>Use "Select Samples" → "Copy Selected Samples" or "Auto-Export Best Samples" before training.
          </div>
        {:else if provider === 'kokoro' && readiness.ready && !kokoroDatasetReady}
          <div class="p-2.5 bg-orange-50 dark:bg-orange-900/15 border border-orange-300 dark:border-orange-600/65 rounded text-orange-700 dark:text-orange-300 text-sm mb-4">
            Need at least 10 curated samples (2+ minutes) copied to the Kokoro dataset before training.
          </div>
        {/if}
      {/if}

      <!-- RVC: Show training progress -->
      {#if provider === 'rvc' && trainingStatus && trainingStatus.status !== 'idle'}
        <div class="p-4 my-4 rounded-lg border-2 text-sm {trainingStatus.status === 'running' ? 'bg-gradient-to-r from-blue-50 to-cyan-50 dark:from-blue-950/30 dark:to-cyan-950/30 border-blue-500' : trainingStatus.status === 'completed' ? 'bg-gradient-to-r from-green-50 to-lime-50 dark:from-green-950/30 dark:to-lime-950/30 border-green-500' : 'bg-gradient-to-r from-red-50 to-pink-50 dark:from-red-950/30 dark:to-pink-950/30 border-red-500'}">
          <div class="mb-3 text-base font-semibold">
            {#if trainingStatus.status === 'running'}
              🔄 Training in Progress
            {:else if trainingStatus.status === 'completed'}
              ✅ Training Completed
            {:else if trainingStatus.status === 'failed'}
              ❌ Training Failed
            {/if}
          </div>

          {#if trainingStatus.status === 'running' || trainingStatus.status === 'completed'}
            <div class="relative w-full h-6 bg-gray-300 dark:bg-gray-600 rounded-xl overflow-hidden my-3">
              <div class="h-full bg-gradient-to-r from-green-500 to-green-400 rounded-xl transition-all" style="width: {trainingStatus.progress}%"></div>
              <span class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 font-semibold text-white drop-shadow">{trainingStatus.progress}%</span>
            </div>
          {/if}

          {#if trainingStatus.currentEpoch && trainingStatus.totalEpochs}
            <div class="my-2 text-sm text-gray-600 dark:text-gray-300">
              Epoch {trainingStatus.currentEpoch} / {trainingStatus.totalEpochs}
            </div>
          {/if}

          {#if trainingStatus.message}
            <div class="my-2 p-2 bg-white/70 dark:bg-black/30 rounded text-sm text-gray-700 dark:text-gray-300">{trainingStatus.message}</div>
          {/if}

          {#if trainingStatus.error}
            <div class="my-2 p-2 bg-red-50 dark:bg-red-900/20 border border-red-400 dark:border-red-600 rounded text-sm text-red-700 dark:text-red-300">{trainingStatus.error}</div>
          {/if}

          {#if trainingStatus.modelPath}
            <div class="mt-3 p-2 bg-white/70 dark:bg-black/30 rounded text-xs break-all text-gray-700 dark:text-gray-300">
              <strong>Model:</strong> {trainingStatus.modelPath}
            </div>
          {/if}
        </div>
      {/if}

      {#if provider === 'kokoro' && trainingStatus && trainingStatus.status !== 'idle'}
        <div class="p-4 my-4 rounded-lg border-2 text-sm bg-gradient-to-r from-amber-50 to-orange-100 dark:from-amber-950/30 dark:to-orange-950/30 border-amber-500 {trainingStatus.status === 'completed' ? 'border-green-500' : trainingStatus.status === 'failed' ? 'border-red-500' : ''}">
          <div class="mb-3 text-base font-semibold">
            {#if trainingStatus.status === 'running'}
              🎵 Training Kokoro Voicepack
            {:else if trainingStatus.status === 'completed'}
              ✅ Voicepack Ready
            {:else if trainingStatus.status === 'failed'}
              ❌ Training Failed
            {/if}
          </div>

          <div class="relative w-full h-6 bg-gray-300 dark:bg-gray-600 rounded-xl overflow-hidden my-3">
            <div class="h-full bg-gradient-to-r from-green-500 to-green-400 rounded-xl transition-all" style="width: {trainingStatus.progress}%"></div>
            <span class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 font-semibold text-white drop-shadow">{trainingStatus.progress}%</span>
          </div>

          {#if trainingStatus.message}
            <div class="my-2 text-sm text-gray-600 dark:text-gray-300">{trainingStatus.message}</div>
          {/if}

          {#if trainingStatus.voicepackPath}
            <div class="my-2 text-sm text-gray-600 dark:text-gray-300">
              <strong>Voicepack:</strong> {trainingStatus.voicepackPath}
            </div>
          {/if}

          {#if trainingStatus.datasetSamples}
            <div class="my-2 text-sm text-gray-600 dark:text-gray-300">
              Dataset: {trainingStatus.datasetSamples} samples ({(trainingStatus.datasetMinutes || 0).toFixed(2)} minutes)
            </div>
          {/if}

          {#if trainingStatus.error}
            <div class="my-2 p-2 bg-red-50 dark:bg-red-900/20 border border-red-400 dark:border-red-600 rounded text-sm text-red-700 dark:text-red-300">{trainingStatus.error}</div>
          {/if}
        </div>
      {/if}

      <!-- Direct Voice Recording Widget -->
      {#if provider === 'sovits'}
        <DirectVoiceRecorder
          provider={apiProvider}
          speakerId="default"
          onRecordingComplete={handleRecordingComplete}
        />
      {/if}

      <!-- Actions -->
      <div class="mt-4 flex gap-2.5 flex-wrap max-md:flex-col">
        <button on:click={() => showSelector = !showSelector} class="btn-primary btn-sm">
          {showSelector ? 'Hide' : 'Select'} Samples
        </button>
        <button on:click={autoExportBest} disabled={exporting || !readiness.ready} class="btn-success btn-sm">
          {exporting ? 'Exporting...' : 'Auto-Export Best Samples'}
        </button>
        <button on:click={() => showExportSettings = !showExportSettings} class="btn-secondary btn-sm">
          {showExportSettings ? '📊 Hide' : '📊 Show'} Export Settings
        </button>
        {#if provider === 'rvc'}
          <button on:click={() => showAdvancedSettings = !showAdvancedSettings} class="btn-secondary btn-sm">
            {showAdvancedSettings ? '⚙️ Hide' : '⚙️ Show'} Training Settings
          </button>
          <button on:click={startTraining} disabled={training || !canStartTraining} class="px-4 py-2 bg-violet-500 hover:bg-violet-600 text-white font-semibold rounded-md transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm">
            {training ? 'Training...' : '🎭 Train RVC Model'}
          </button>
        {:else if provider === 'kokoro'}
          <button on:click={startKokoroTraining} disabled={kokoroTraining || !canStartTraining} class="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white dark:text-gray-900 font-semibold rounded-md transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm">
            {kokoroTraining ? 'Training...' : '🎵 Train Kokoro Voicepack'}
          </button>
        {/if}
        <button class="btn-danger btn-sm" on:click={purgeAllData} disabled={purging}>
          {purging ? 'Purging...' : 'Purge All Data'}
        </button>
      </div>

      <!-- Auto-Export Settings Panel -->
      {#if showExportSettings}
        <div class="mt-5 border-2 border-blue-500 dark:border-blue-400 rounded-lg p-5 bg-blue-50 dark:bg-blue-950/30">
          <h4 class="m-0 mb-4 text-blue-600 dark:text-blue-400 text-lg">📊 Auto-Export Settings</h4>
          <div class="grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] gap-5 mb-4">
            <div class="flex flex-col gap-2">
              <label for="selectionMethod" class="font-semibold text-gray-700 dark:text-gray-200 flex flex-col gap-1">
                Selection Method:
                <span class="font-normal text-sm text-gray-500 dark:text-gray-400 italic">How to choose samples</span>
              </label>
              <select id="selectionMethod" bind:value={exportSelectionMethod} class="select-field">
                <option value="quality">Highest Quality First</option>
                <option value="random">Random Selection</option>
                <option value="sequential">Sequential (Oldest First)</option>
              </select>
              <div class="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                {#if exportSelectionMethod === 'quality'}
                  Picks highest quality samples first (default, recommended)
                {:else if exportSelectionMethod === 'random'}
                  Randomly selects from available samples for variety
                {:else}
                  Picks samples in chronological order (oldest first)
                {/if}
              </div>
            </div>

            <div class="flex flex-col gap-2">
              <label for="targetDuration" class="font-semibold text-gray-700 dark:text-gray-200 flex flex-col gap-1">
                Target Duration ({exportDefaults[provider]?.durationUnit || 'seconds'}):
                <span class="font-normal text-sm text-gray-500 dark:text-gray-400 italic">Total audio duration to export</span>
              </label>
              <input
                id="targetDuration"
                type="number"
                bind:value={exportTargetDuration}
                min={provider === 'sovits' ? 5 : 1}
                max={provider === 'sovits' ? 30 : 60}
                step={provider === 'sovits' ? 1 : 1}
                class="input-field"
              />
              <div class="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                {#if provider === 'sovits'}
                  GPT-SoVITS: 5-10 seconds recommended for reference audio
                {:else if provider === 'rvc'}
                  RVC: 10-15 minutes recommended for quality training
                {:else if provider === 'kokoro'}
                  Kokoro: 5-10 minutes minimum, more is better
                {:else}
                  Piper: 30-60 minutes for full voice training
                {/if}
              </div>
            </div>

            <div class="flex flex-col gap-2">
              <label for="maxSamples" class="font-semibold text-gray-700 dark:text-gray-200 flex flex-col gap-1">
                Max Samples:
                <span class="font-normal text-sm text-gray-500 dark:text-gray-400 italic">Maximum number of samples to export</span>
              </label>
              <input
                id="maxSamples"
                type="number"
                bind:value={exportMaxSamples}
                min="1"
                max={provider === 'sovits' ? 10 : 500}
                step="1"
                class="input-field"
              />
              <div class="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                Limits total samples exported (quality threshold still applies)
              </div>
            </div>
          </div>
          <div class="mt-4 flex justify-end gap-2.5">
            <button on:click={resetExportSettings} class="btn-secondary btn-sm">
              Reset to Defaults
            </button>
          </div>
        </div>
      {/if}

      {#if provider === 'rvc' && showAdvancedSettings}
        <div class="mt-5 border-2 border-violet-500 dark:border-violet-400 rounded-lg p-5 bg-violet-50 dark:bg-violet-950/30">
          <h4 class="m-0 mb-4 text-violet-600 dark:text-violet-400 text-lg">⚙️ Training Parameters</h4>
          <div class="grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] gap-5 mb-4">
            <div class="flex flex-col gap-2">
              <label for="totalEpochs" class="font-semibold text-gray-700 dark:text-gray-200 flex flex-col gap-1">
                Total Epochs:
                <span class="font-normal text-sm text-gray-500 dark:text-gray-400 italic">Number of training iterations (300-1000)</span>
              </label>
              <input
                id="totalEpochs"
                type="number"
                bind:value={totalEpochs}
                min="100"
                max="2000"
                step="50"
                disabled={training}
                class="input-field"
              />
              <div class="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                Default: 300. Higher = better quality but longer training time.
                <br />Recommended: 300-600 for good quality, 800-1000 for best results.
              </div>
            </div>
            <div class="flex flex-col gap-2">
              <label for="saveEveryEpoch" class="font-semibold text-gray-700 dark:text-gray-200 flex flex-col gap-1">
                Save Checkpoint Every:
                <span class="font-normal text-sm text-gray-500 dark:text-gray-400 italic">How often to save model checkpoints</span>
              </label>
              <input
                id="saveEveryEpoch"
                type="number"
                bind:value={saveEveryEpoch}
                min="10"
                max="200"
                step="10"
                disabled={training}
                class="input-field"
              />
              <div class="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                Default: 50. Lower = more checkpoints (uses more disk space).
              </div>
            </div>
            <div class="flex flex-col gap-2">
              <label for="batchSize" class="font-semibold text-gray-700 dark:text-gray-200 flex flex-col gap-1">
                Batch Size:
                <span class="font-normal text-sm text-gray-500 dark:text-gray-400 italic">Training batch size</span>
              </label>
              <input
                id="batchSize"
                type="number"
                bind:value={batchSize}
                min="1"
                max="32"
                step="1"
                disabled={training}
                class="input-field"
              />
              <div class="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                Default: 8. Lower if you run out of GPU memory. Higher for faster training (if GPU allows).
              </div>
            </div>
            <div class="flex flex-col gap-2">
              <label for="rvcDevice" class="font-semibold text-gray-700 dark:text-gray-200 flex flex-col gap-1">
                Device:
                <span class="font-normal text-sm text-gray-500 dark:text-gray-400 italic">Training device</span>
              </label>
              <select
                id="rvcDevice"
                bind:value={rvcDevice}
                disabled={training}
                class="select-field"
              >
                <option value="auto">Auto (GPU if available)</option>
                <option value="cuda">CUDA (GPU)</option>
                <option value="cpu">CPU</option>
              </select>
              <div class="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                GPU is much faster (30-60 min). CPU training is slower but works without NVIDIA GPU.
              </div>
            </div>
          </div>
          <div class="mt-4 p-3 bg-violet-200 dark:bg-violet-900/40 border-l-4 border-violet-500 rounded text-sm text-gray-700 dark:text-gray-200">
            <strong>⏱️ Estimated Training Time:</strong>
            {#if totalEpochs <= 300}
              30-60 minutes
            {:else if totalEpochs <= 600}
              1-2 hours
            {:else if totalEpochs <= 1000}
              2-3 hours
            {:else}
              3+ hours
            {/if}
            (GPU recommended for faster training)
          </div>
        </div>
      {/if}

      {#if provider === 'kokoro'}
        <div class="mt-5 border-2 border-amber-500 dark:border-amber-400 rounded-lg p-5 bg-amber-50 dark:bg-amber-950/30">
          <h4 class="m-0 mb-4 text-amber-700 dark:text-amber-400 text-lg">🎵 Kokoro Voicepack Settings</h4>
          <div class="grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] gap-5 mb-4">
            <div class="flex flex-col gap-2">
              <label for="kokoro-lang" class="font-semibold text-gray-700 dark:text-gray-200">Language Code</label>
              <select id="kokoro-lang" bind:value={kokoroConfig.langCode} class="select-field">
                <option value="a">American English (a)</option>
                <option value="b">British English (b)</option>
                <option value="e">Spanish (es)</option>
                <option value="f">French (fr)</option>
                <option value="h">Hindi (hi)</option>
                <option value="i">Italian (it)</option>
                <option value="p">Portuguese (pt-br)</option>
                <option value="j">Japanese (ja)</option>
                <option value="z">Mandarin Chinese (zh)</option>
              </select>
            </div>
            <div class="flex flex-col gap-2">
              <label for="kokoro-base" class="font-semibold text-gray-700 dark:text-gray-200">Base Voice</label>
              <select id="kokoro-base" bind:value={kokoroConfig.baseVoice} class="select-field">
                <optgroup label="American English - Male">
                  <option value="am_adam">Adam (Low pitch)</option>
                  <option value="am_echo">Echo (Low pitch)</option>
                  <option value="am_eric">Eric (Low pitch)</option>
                  <option value="am_fenrir">Fenrir (Medium pitch)</option>
                  <option value="am_liam">Liam (Low pitch)</option>
                  <option value="am_michael" selected>Michael (Medium pitch) - Recommended</option>
                  <option value="am_onyx">Onyx (Low pitch)</option>
                  <option value="am_puck">Puck (Medium pitch)</option>
                  <option value="am_santa">Santa (Low pitch)</option>
                </optgroup>
                <optgroup label="American English - Female">
                  <option value="af_heart">Heart (High pitch)</option>
                  <option value="af_alloy">Alloy (Medium pitch)</option>
                  <option value="af_aoede">Aoede (Medium pitch)</option>
                  <option value="af_bella">Bella (High pitch)</option>
                  <option value="af_jessica">Jessica (Low pitch)</option>
                  <option value="af_kore">Kore (Medium pitch)</option>
                  <option value="af_nicole">Nicole (Medium pitch)</option>
                  <option value="af_nova">Nova (Medium pitch)</option>
                  <option value="af_river">River (Low pitch)</option>
                  <option value="af_sarah">Sarah (Medium pitch)</option>
                  <option value="af_sky">Sky (Medium pitch)</option>
                </optgroup>
                <optgroup label="British English - Male">
                  <option value="bm_daniel">Daniel (Medium pitch)</option>
                  <option value="bm_fable">Fable (Medium pitch)</option>
                  <option value="bm_george">George (Medium pitch)</option>
                  <option value="bm_lewis">Lewis (Medium pitch)</option>
                </optgroup>
                <optgroup label="British English - Female">
                  <option value="bf_alice">Alice (Medium pitch)</option>
                  <option value="bf_emma">Emma (Medium pitch)</option>
                  <option value="bf_isabella">Isabella (Medium pitch)</option>
                  <option value="bf_lily">Lily (Medium pitch)</option>
                </optgroup>
              </select>
              <div class="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">Choose a base voice that matches your gender and approximate pitch. Training will adapt this voice to sound like you.</div>
            </div>
            <div class="flex flex-col gap-2">
              <label for="kokoro-epochs" class="font-semibold text-gray-700 dark:text-gray-200">Epochs</label>
              <input id="kokoro-epochs" type="number" min="60" max="400" bind:value={kokoroConfig.epochs} class="input-field" />
            </div>
            <div class="flex flex-col gap-2">
              <label for="kokoro-lr" class="font-semibold text-gray-700 dark:text-gray-200">Learning Rate</label>
              <input id="kokoro-lr" type="number" step="0.0001" bind:value={kokoroConfig.learningRate} class="input-field" />
              <div class="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">Controls adaptation speed. Lower = slower but more stable. Recommended: 0.0003-0.0005</div>
            </div>
            <div class="flex flex-col gap-2">
              <label for="kokoro-reg" class="font-semibold text-gray-700 dark:text-gray-200">Regularization</label>
              <input id="kokoro-reg" type="number" step="0.001" min="0.001" max="0.01" bind:value={kokoroConfig.regularization} class="input-field" />
              <div class="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">Keeps voice close to base. Higher = more conservative. Recommended: 0.003-0.005</div>
            </div>
            <div class="flex flex-col gap-2">
              <label for="kokoro-device" class="font-semibold text-gray-700 dark:text-gray-200">Device</label>
              <select id="kokoro-device" bind:value={kokoroConfig.device} class="select-field">
                <option value="auto">Auto (GPU if available)</option>
                <option value="cuda">CUDA</option>
                <option value="cpu">CPU</option>
              </select>
            </div>
            <div class="flex flex-col gap-2">
              <label for="kokoro-max" class="font-semibold text-gray-700 dark:text-gray-200">Max Samples</label>
              <input id="kokoro-max" type="number" min="50" max="400" bind:value={kokoroConfig.maxSamples} class="input-field" />
            </div>
            <div class="flex flex-col gap-2">
              <label class="flex flex-row items-center gap-2 cursor-pointer select-none font-semibold text-gray-700 dark:text-gray-200">
                <input type="checkbox" bind:checked={kokoroConfig.continueFromCheckpoint} disabled={kokoroConfig.pureTraining} class="w-4 h-4 cursor-pointer" />
                Continue from existing checkpoint
              </label>
              <div class="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">If checked, resume training from existing {kokoroConfig.speakerId}.pt voicepack. If unchecked, start fresh from base voice.</div>
            </div>
            <div class="flex flex-col gap-2">
              <label class="flex flex-row items-center gap-2 cursor-pointer select-none font-semibold text-gray-700 dark:text-gray-200">
                <input type="checkbox" bind:checked={kokoroConfig.pureTraining} on:change={handlePureTrainingToggle} class="w-4 h-4 cursor-pointer" />
                Pure training mode (experimental)
              </label>
              <div class="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                Train from random initialization with NO base voice influence.
                Saves to <code class="bg-gray-200 dark:bg-gray-700 px-1 rounded">{kokoroConfig.speakerId}-pure.pt</code> for A/B comparison.
                Requires 2-3x more epochs (300-400 recommended).
              </div>
            </div>
          </div>
          <p class="text-sm text-amber-800 dark:text-amber-300 mt-2.5">
            <strong>Auto-normalization:</strong> All samples are automatically normalized to -16 LUFS when copied to the dataset for optimal training quality.
            <br>
            Voicepacks save to <code class="bg-amber-200 dark:bg-amber-800 px-1 rounded">profiles/&lt;user&gt;/out/voices/kokoro-voicepacks</code>. Use the Voice Settings tab to enable custom Kokoro voices after training.
          </p>
        </div>
      {/if}

      {#if showSelector}
        <div class="mt-5 border-2 border-blue-500 dark:border-blue-400 rounded-lg p-4 bg-gray-50 dark:bg-gray-900">
          <ReferenceAudioSelector
            provider={apiProvider}
            minQuality={currentConfig.minQuality}
            onSelectionChange={handleSelectionChange}
          />
          <div class="mt-4 flex gap-2.5 justify-end">
            <button on:click={copySelectedSamples} disabled={copying || selectedSampleIds.length === 0} class="btn-success btn-sm">
              {copying ? 'Copying...' : `Copy ${selectedSampleIds.length} Selected Samples`}
            </button>
            <button on:click={() => showSelector = false} class="btn-secondary btn-sm">
              Cancel
            </button>
          </div>
        </div>
      {/if}
    </div>

    <!-- Samples Section -->
    <div class="mt-8">
      <h3 class="m-0 mb-2.5 text-lg font-semibold text-gray-700 dark:text-gray-300">Recent Samples</h3>
      {#if samples.length === 0}
        <p class="p-5 text-center text-gray-500 dark:text-gray-400 italic">No samples collected yet. Start a voice conversation to begin!</p>
      {:else}
        <div class="flex flex-col gap-2.5">
          {#each samples as sample (sample.id)}
            <div class="panel p-4">
              <div class="flex gap-4 mb-2 text-sm">
                <span class="text-gray-500 dark:text-gray-400">{formatTimestamp(sample.timestamp)}</span>
                <span class="text-blue-500 font-bold">{formatDuration(sample.duration)}</span>
                <span class="px-2 py-0.5 rounded font-bold text-white {sample.quality >= 0.8 ? 'bg-green-500' : sample.quality >= 0.6 ? 'bg-amber-500' : 'bg-red-500'}">
                  {(sample.quality * 100).toFixed(0)}%
                </span>
              </div>
              <div class="mb-2.5 text-gray-700 dark:text-gray-300 italic">
                "{(sample.transcript || '').substring(0, 100)}{(sample.transcript || '').length > 100 ? '...' : ''}"
              </div>
              <button class="btn-danger btn-xs" on:click={() => deleteSample(sample.id)}>
                Delete
              </button>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  <!-- Training Modal Overlay -->
  {#if showTrainingModal}
    <div class="fixed inset-0 bg-black/85 backdrop-blur-sm z-[9999] flex items-center justify-center animate-fade-in">
      <div class="max-w-[700px] w-[90%] p-8 rounded-2xl border-3 shadow-[0_0_40px_rgba(0,255,136,0.5)] animate-scale-in {provider === 'kokoro' ? 'bg-gradient-to-br from-[#1a1410] to-[#211813] border-amber-500 shadow-[0_0_40px_rgba(245,158,11,0.5)]' : 'bg-gradient-to-br from-[#1a1a2e] to-[#16213e] border-green-400'}">
        <!-- Modal Header -->
        <div class="text-center mb-8 relative">
          <h2 class="text-3xl m-0 mb-4 animate-pulse {provider === 'kokoro' ? 'text-amber-500' : 'text-green-400'}" style="text-shadow: 0 0 10px {provider === 'kokoro' ? 'rgba(245,158,11,0.7)' : 'rgba(0,255,136,0.7)'}">
            {#if provider === 'kokoro'}
              🎵 Kokoro Voicepack Training in Progress 🎵
            {:else}
              ⚡ RVC Model Training in Progress ⚡
            {/if}
          </h2>
          <button class="absolute top-0 right-2.5 w-9 h-9 bg-red-500/10 border-2 border-red-500 text-red-500 text-2xl rounded-full cursor-pointer transition-all flex items-center justify-center p-0 leading-none hover:bg-red-500 hover:text-white hover:scale-110 hover:shadow-[0_0_15px_rgba(239,83,80,0.5)] active:scale-95" on:click={cancelTraining} title="Cancel Training">
            ✕
          </button>
          <div class="bg-gradient-to-r from-red-600 via-orange-500 to-red-600 bg-[length:200%_100%] text-white px-5 py-3 rounded-lg font-bold text-base animate-warning-slide shadow-[0_0_20px_rgba(255,0,0,0.5)]">
            ⚠️ DO NOT NAVIGATE AWAY - Training will be interrupted! ⚠️
          </div>
        </div>

        <!-- Modal Body -->
        <div class="text-gray-200">
          {#if trainingStatus}
            <!-- Progress Bar -->
            <div class="relative w-full h-10 bg-[#1a1a2e] border-2 {provider === 'kokoro' ? 'border-amber-500' : 'border-green-400'} rounded-full overflow-hidden my-6 shadow-[inset_0_0_20px_rgba(0,0,0,0.5)]">
              <div class="h-full rounded-[18px] relative transition-all duration-500 animate-progress-shine {provider === 'kokoro' ? 'bg-gradient-to-r from-amber-500 via-amber-400 to-amber-500' : 'bg-gradient-to-r from-green-400 via-teal-400 to-green-400'} bg-[length:200%_100%]" style="width: {trainingStatus.progress}%">
                <div class="absolute top-0 right-0 bottom-0 w-12 bg-gradient-to-r from-transparent to-white/50 animate-glow-move"></div>
              </div>
              <span class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 font-bold text-xl text-white drop-shadow-md">{trainingStatus.progress}%</span>
            </div>

            <!-- Epoch Counter -->
            {#if trainingStatus.currentEpoch && trainingStatus.totalEpochs}
              <div class="text-center text-xl my-5 {provider === 'kokoro' ? 'text-amber-500' : 'text-green-400'}">
                <span class="font-semibold mr-2.5">Epoch:</span>
                <span class="font-bold text-2xl {provider === 'kokoro' ? 'text-amber-400' : 'text-teal-400'}">{trainingStatus.currentEpoch} / {trainingStatus.totalEpochs}</span>
              </div>
            {/if}

            <!-- Dataset Info for Kokoro -->
            {#if provider === 'kokoro' && trainingStatus.datasetSamples}
              <div class="text-center text-lg my-4 text-amber-500">
                <span class="font-semibold mr-2">Dataset:</span>
                <span class="font-bold text-xl text-orange-400">{trainingStatus.datasetSamples} samples ({(trainingStatus.datasetMinutes || 0).toFixed(1)} min)</span>
              </div>
            {/if}

            <!-- Status Message -->
            {#if trainingStatus.message}
              <div class="text-center p-3 bg-green-400/10 border-l-4 border-green-400 rounded-md my-4 text-sm">{trainingStatus.message}</div>
            {/if}
          {/if}

          <!-- Toggle between robot messages and logs -->
          {#if (provider === 'kokoro' || provider === 'rvc') && showLogs}
            <!-- Training Logs View -->
            <div class="my-8 p-5 bg-black/30 border-2 border-amber-500 rounded-xl">
              <div class="flex justify-between items-center mb-4 pb-2.5 border-b border-amber-500/30">
                <h3 class="m-0 text-amber-500 text-xl">📋 Training Logs</h3>
                <button class="px-3 py-1.5 bg-amber-500/20 border border-amber-500 rounded-md text-amber-300 text-sm cursor-pointer transition-all hover:bg-amber-500/30 hover:-translate-y-px" on:click={() => showLogs = false}>
                  Show Robot Messages
                </button>
              </div>
              <div class="max-h-[300px] overflow-y-auto font-mono text-sm leading-relaxed bg-black/40 p-4 rounded-lg border border-amber-500/20 scrollbar-thin scrollbar-track-black/20 scrollbar-thumb-amber-500" bind:this={logsContainer}>
                {#if trainingLogs.length === 0}
                  <div class="text-center text-gray-400 italic py-8">
                    Waiting for training logs...
                  </div>
                {:else}
                  {#each trainingLogs as logLine}
                    <div class="text-gray-300 my-0.5 py-0.5 break-words">{logLine}</div>
                  {/each}
                {/if}
              </div>
            </div>
          {:else}
            <!-- Robot Takeover Message -->
            <div class="my-8 p-5 bg-red-500/5 border-2 border-dashed border-red-500 rounded-xl">
              <div class="text-center text-lg font-semibold text-red-400 mb-4 min-h-[30px] animate-robot-flicker">
                {currentRobotMessage}
              </div>
              <div class="flex justify-center">
                <pre class="text-green-400 text-xl leading-tight m-0 animate-robot-bounce" style="text-shadow: 0 0 5px rgba(0,255,136,0.5)">
     ...kill
        all
       humans...
                </pre>
              </div>
              {#if provider === 'kokoro' || provider === 'rvc'}
                <div class="text-center mt-4">
                  <button class="px-3 py-1.5 bg-amber-500/20 border border-amber-500 rounded-md text-amber-300 text-sm cursor-pointer transition-all hover:bg-amber-500/30 hover:-translate-y-px" on:click={() => showLogs = true}>
                    Show Training Logs
                  </button>
                </div>
              {/if}
            </div>
          {/if}

          <div class="mt-6 p-4 bg-teal-400/5 rounded-lg border border-green-400/30">
            {#if provider === 'kokoro'}
              <p class="my-2 text-sm text-gray-400">⏱️ Estimated time: Eons -- Your childern will be dead when this is finished</p>
              <p class="my-2 text-sm text-gray-400">🎵 StyleTTS2 voice encoder optimization</p>
              <p class="my-2 text-sm text-gray-400">💾 Training voicepack embeddings</p>
              <p class="my-2 text-sm text-gray-400">🌐 Skynet connection: Established</p>
            {:else}
              <p class="my-2 text-sm text-gray-400">⏱️ Estimated time: Epochs</p>
              <p class="my-2 text-sm text-gray-400">🔥 GPU temperature: Rising steadily</p>
              <p class="my-2 text-sm text-gray-400">💾 System resources: Being consumed</p>
              <p class="my-2 text-sm text-gray-400">🌐 Skynet connection: Established</p>
            {/if}
          </div>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  @keyframes animate-fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  .animate-fade-in {
    animation: animate-fade-in 0.3s ease-in-out;
  }

  @keyframes animate-scale-in {
    from { transform: scale(0.9); opacity: 0; }
    to { transform: scale(1); opacity: 1; }
  }
  .animate-scale-in {
    animation: animate-scale-in 0.3s ease-in-out;
  }

  @keyframes warning-slide {
    0% { background-position: 0% 0%; }
    100% { background-position: 200% 0%; }
  }
  .animate-warning-slide {
    animation: warning-slide 3s linear infinite;
  }

  @keyframes progress-shine {
    0% { background-position: 0% 0%; }
    100% { background-position: 200% 0%; }
  }
  .animate-progress-shine {
    animation: progress-shine 2s linear infinite;
  }

  @keyframes glow-move {
    0%, 100% { opacity: 0; }
    50% { opacity: 1; }
  }
  .animate-glow-move {
    animation: glow-move 1.5s ease-in-out infinite;
  }

  @keyframes robot-flicker {
    0% { opacity: 1; }
    100% { opacity: 0.95; }
  }
  .animate-robot-flicker {
    animation: robot-flicker 0.1s infinite alternate;
  }

  @keyframes robot-bounce {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-5px); }
  }
  .animate-robot-bounce {
    animation: robot-bounce 1s ease-in-out infinite;
  }

  .border-3 {
    border-width: 3px;
  }
</style>
