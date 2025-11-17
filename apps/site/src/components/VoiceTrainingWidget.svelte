<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import ReferenceAudioSelector from './ReferenceAudioSelector.svelte';
  import DirectVoiceRecorder from './DirectVoiceRecorder.svelte';
  import { createDefaultKokoroConfig, startKokoroTrainingRequest } from '../lib/kokoro-training';

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
  let showLogs = false; // Toggle between robot messages and logs
  let logsContainer: HTMLDivElement | null = null;

  // Auto-scroll logs to bottom when new logs arrive
  $: if (logsContainer && trainingLogs.length > 0) {
    setTimeout(() => {
      if (logsContainer) {
        logsContainer.scrollTop = logsContainer.scrollHeight;
      }
    }, 100);
  }

  // Training parameters for RVC
  let totalEpochs = 300;
  let saveEveryEpoch = 50;
  let batchSize = 8;
  let showAdvancedSettings = false;

  function getRandomRobotMessage() {
    return robotMessages[Math.floor(Math.random() * robotMessages.length)];
  }

  function startRobotMessages() {
    currentRobotMessage = getRandomRobotMessage();
    robotMessageInterval = setInterval(() => {
      currentRobotMessage = getRandomRobotMessage();
    }, 10000); // Change message every 10 seconds
  }

  function stopRobotMessages() {
    if (robotMessageInterval) {
      clearInterval(robotMessageInterval);
      robotMessageInterval = null;
    }
  }

  async function fetchTrainingLogs() {
    if (provider !== 'kokoro') return;

    try {
      const response = await fetch('/api/kokoro-training?action=training-logs&speakerId=default');
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

  // Provider-specific settings
  $: providerConfig = {
    piper: {
      name: 'Piper TTS',
      icon: '🎙️',
      color: '#3b82f6',
      minQuality: 0.7,
      minSamples: 100,
      minDuration: 300, // 5 minutes
      trainingType: 'full',
    },
    sovits: {
      name: 'GPT-SoVITS',
      icon: '🤖',
      color: '#10b981',
      minQuality: 0.8,
      minSamples: 3,
      minDuration: 5, // 5-10 seconds
      trainingType: 'reference',
    },
    rvc: {
      name: 'RVC',
      icon: '🎭',
      color: '#8b5cf6',
      minQuality: 0.7,
      minSamples: 50,
      minDuration: 600, // 10 minutes
      trainingType: 'full',
    },
    kokoro: {
      name: 'Kokoro TTS',
      icon: '🎵',
      color: '#f59e0b',
      minQuality: 0.75,
      minSamples: 30,
      minDuration: 300, // 5 minutes
      trainingType: 'voicepack',
    },
  };

  $: currentConfig = providerConfig[provider];
  $: apiProvider = provider === 'sovits' ? 'gpt-sovits' : provider;

  async function fetchProgress() {
    // Only fetch Piper-specific progress when Piper is selected
    if (provider !== 'piper') {
      return;
    }

    try {
      const response = await fetch('/api/voice-training?action=progress');
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
    // Only fetch Piper samples when Piper is selected
    if (provider !== 'piper') {
      return;
    }

    try {
      const response = await fetch('/api/voice-training?action=samples&limit=10');
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
      const response = await fetch('/api/voice-training', {
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

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'auto-export',
          provider: apiProvider,
          speakerId: 'default',
          minQuality: currentConfig.minQuality
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
        // Fetch training logs for Kokoro
        if (provider === 'kokoro') {
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
      const response = await fetch('/api/rvc-training', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'start-training',
          speakerId: 'default',
          totalEpochs,
          saveEveryEpoch,
          batchSize
        })
      });

      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const message = data?.error || data?.message || 'Failed to start training';
        throw new Error(message);
      }

      // Start polling for status
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
    showLogs = true; // Show logs by default for Kokoro
    startRobotMessages();

    try {
      const result = await startKokoroTrainingRequest(kokoroConfig);
      // Don't show alert - the modal will show progress
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
      const response = await fetch('/api/voice-training', {
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
      const response = await fetch('/api/voice-training', {
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
      const response = await fetch('/api/voice-training?action=status');
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

    // Check RVC training status
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

<div class="voice-training-widget">
  <div class="header">
    <div class="title-section">
      <h2>Voice Clone Training</h2>
      <div class="provider-selector">
        <label class="provider-label">Provider:</label>
        <div class="provider-tabs">
          {#each Object.entries(providerConfig) as [key, config]}
            <button
              class="provider-tab"
              class:active={provider === key}
              style="--provider-color: {config.color}"
              on:click={() => changeProvider(key)}
            >
              <span class="provider-tab-icon">{config.icon}</span>
              <span class="provider-tab-name">{config.name}</span>
            </button>
          {/each}
        </div>
      </div>
    </div>
    <div class="training-controls">
      <div class="toggle-container">
        <label class="toggle-switch">
          <input
            type="checkbox"
            bind:checked={trainingEnabled}
            on:change={toggleTraining}
            disabled={togglingTraining}
          />
          <span class="slider"></span>
        </label>
        <span class="toggle-label">{trainingEnabled ? 'Enabled' : 'Disabled'}</span>
      </div>
    </div>
  </div>

  {#if error}
    <div class="error">
      <strong>Error:</strong> {error}
    </div>
  {/if}

  {#if !trainingEnabled}
    <div class="disabled-notice">
      <p>Voice clone training is currently disabled.</p>
      <p>Enable it above to start collecting voice samples during conversations.</p>
    </div>
  {/if}

  {#if loading && !readiness}
    <div class="loading">Loading training data...</div>
  {:else if readiness}
    <div class="progress-section">
      <div class="readiness-header">
        <h3>Training Readiness</h3>
        {#if readiness.ready}
          <span class="ready-badge">✓ Ready</span>
        {:else}
          <span class="not-ready-badge">⏳ Not Ready</span>
        {/if}
      </div>

      <!-- Provider-specific workflow guide -->
      {#if provider === 'rvc'}
        <div class="workflow-guide rvc">
          <div class="guide-header">
            <span class="guide-icon">🎭</span>
            <strong>RVC Training Pipeline</strong>
          </div>
          <ol class="guide-steps">
            <li>
              <strong>Enable Training:</strong> Turn on voice training above (if not already enabled)
            </li>
            <li>
              <strong>Collect Samples:</strong> Have conversations with MetaHuman - samples are automatically recorded
              <ul>
                <li>Need 50+ samples (10-15 minutes total)</li>
                <li>Quality threshold: 70%+</li>
              </ul>
            </li>
            <li>
              <strong>Select Training Data:</strong> Click "Select Samples" below to choose high-quality clips
            </li>
            <li>
              <strong>Copy to Training Dir:</strong> Click "Copy Selected Samples" to prepare training data
            </li>
            <li>
              <strong>Start Training:</strong> Click "Train RVC Model" to begin the training process
              <ul>
                <li>Training takes 30-60 minutes depending on hardware</li>
                <li>GPU highly recommended (4GB+ VRAM)</li>
              </ul>
            </li>
            <li>
              <strong>Test Your Voice:</strong> Once training completes, go to Voice Settings to test!
            </li>
          </ol>
          <div class="guide-note">
            <strong>💡 Remember:</strong> RVC requires full model training with significant data. More samples = better quality!
          </div>
        </div>
      {:else if provider === 'sovits'}
        <div class="workflow-guide sovits">
          <div class="guide-header">
            <span class="guide-icon">🤖</span>
            <strong>GPT-SoVITS Automated Workflow</strong>
          </div>
          <ol class="guide-steps">
            <li>
              <strong>Record Your Voice:</strong> Use the recorder below to record 5-10 seconds of clear speech
              <ul>
                <li>The sample is <strong>automatically</strong> copied to the reference directory</li>
                <li>No manual export needed!</li>
              </ul>
            </li>
            <li>
              <strong>Alternative - Select from Conversations:</strong> If you prefer, click "Select Samples" to choose from previously recorded conversations
              <ul>
                <li>Look for 80%+ quality scores</li>
                <li>Then click "Copy Selected Samples" or "Auto-Export Best Samples"</li>
              </ul>
            </li>
            <li>
              <strong>Go to Voice Settings:</strong> Click "Voice Settings" in the left sidebar
            </li>
            <li>
              <strong>Select GPT-SoVITS Provider:</strong> Choose GPT-SoVITS from the provider dropdown
            </li>
            <li>
              <strong>Click Save:</strong> The server will <strong>automatically start</strong> and load your reference audio
            </li>
            <li>
              <strong>Test Your Voice:</strong> Use the "Test Voice" button in Voice Settings to hear your cloned voice!
            </li>
          </ol>
          <div class="guide-note">
            <strong>💡 Fully Automated:</strong> Recording → Auto-copy → Test → Save. GPT-SoVITS clones your voice in real-time using reference audio. No training required!
          </div>
        </div>
      {:else if provider === 'kokoro'}
        <div class="workflow-guide kokoro">
          <div class="guide-header">
            <span class="guide-icon">🎵</span>
            <strong>Kokoro Voicepack Workflow</strong>
          </div>
          <ol class="guide-steps">
            <li>
              <strong>Enable Training:</strong> Turn on voice training above (if not already enabled)
            </li>
            <li>
              <strong>Collect Samples:</strong> Have conversations with MetaHuman - samples are automatically recorded
              <ul>
                <li>Need 30+ samples (5 minutes total)</li>
                <li>Quality threshold: 75%+</li>
              </ul>
            </li>
            <li>
              <strong>Select High-Quality Samples:</strong> Click "Select Samples" below to choose the best clips
            </li>
            <li>
              <strong>Export Training Data:</strong> Click "Copy Selected Samples" or "Auto-Export Best Samples" to stage your dataset
              <ul>
                <li>Need at least 10 curated samples (2+ minutes)</li>
                <li>Quality threshold: 75%+</li>
              </ul>
            </li>
            <li>
              <strong>Train Voicepack:</strong> Set options below and click "Train Kokoro Voicepack"
              <ul>
                <li>Creates a .pt voicepack saved under <code>out/voices/kokoro-voicepacks</code></li>
                <li>Enable "Use custom voicepack" in Voice Settings to try it instantly</li>
              </ul>
            </li>
          </ol>
          <div class="guide-note">
            <strong>💡 Tip:</strong> You can still switch between 54 built-in Kokoro voices while your custom pack trains.
          </div>
        </div>
      {:else}
        <div class="workflow-guide piper">
          <div class="guide-header">
            <span class="guide-icon">🎙️</span>
            <strong>Piper Training Workflow</strong>
          </div>
          <ol class="guide-steps">
            <li>
              <strong>Enable Training:</strong> Turn on voice training above
            </li>
            <li>
              <strong>Collect Data:</strong> Have many conversations - Piper needs 100+ samples (5+ minutes)
            </li>
            <li>
              <strong>Export Dataset:</strong> Click "Auto-Export Best Samples" when ready
            </li>
            <li>
              <strong>Train Model:</strong> Use the exported dataset with Piper's training tools
            </li>
            <li>
              <strong>Deploy Model:</strong> Configure Piper to use your trained model
            </li>
          </ol>
          <div class="guide-note">
            <strong>💡 Remember:</strong> Piper requires significant training data. More samples = better voice quality.
          </div>
        </div>
      {/if}

      <div class="stats">
        <div class="stat">
          <span class="label">Samples:</span>
          <span class="value">{readiness.samples.total}</span>
          <span class="requirement">({readiness.requirements.minSamples} needed)</span>
        </div>
        <div class="stat">
          <span class="label">Duration:</span>
          <span class="value">{formatDuration(readiness.samples.duration)}</span>
          <span class="requirement">({formatDuration(readiness.requirements.minDuration)} needed)</span>
        </div>
        <div class="stat">
          <span class="label">Avg Quality:</span>
          <span class="value">{(readiness.samples.quality * 100).toFixed(0)}%</span>
          <span class="requirement">({(readiness.requirements.minQuality * 100).toFixed(0)}% needed)</span>
        </div>
      </div>

      {#if !readiness.ready && readiness.reason}
        <div class="info">
        {readiness.reason}
        </div>
      {/if}

      <!-- RVC: Show copied samples status -->
      {#if (provider === 'rvc' || provider === 'kokoro') && readiness.copied}
        <div class="rvc-copied-status" class:kokoro-ready={provider === 'kokoro'}>
          <strong>📦 Samples in {provider === 'rvc' ? 'RVC' : 'Kokoro'} Training Directory:</strong>
          {readiness.copied.count} samples ({formatDuration(readiness.copied.duration)})
          {#if readiness.copied.count === 0}
            <br><em>Click "Auto-Export Best Samples" or "Select Samples" → "Copy Selected Samples" to prepare training data</em>
          {/if}
        </div>
        {#if provider === 'rvc' && readiness.ready && !copiedDatasetReady}
          <div class="info warning">
            {#if copiedNeeds && copiedNeeds.samples > 0}
              Need {copiedNeeds.samples} more sample{copiedNeeds.samples === 1 ? '' : 's'} in the RVC directory.
            {/if}
            {#if copiedNeeds && copiedNeeds.duration > 0}
              <br>Need {formatDuration(copiedNeeds.duration)} more recorded audio for RVC training.
            {/if}
            <br>Use "Select Samples" → "Copy Selected Samples" or "Auto-Export Best Samples" before training.
          </div>
        {:else if provider === 'kokoro' && readiness.ready && !kokoroDatasetReady}
          <div class="info warning">
            Need at least 10 curated samples (2+ minutes) copied to the Kokoro dataset before training.
          </div>
        {/if}
      {/if}

      <!-- RVC: Show training progress -->
      {#if provider === 'rvc' && trainingStatus && trainingStatus.status !== 'idle'}
        <div class="training-progress" class:running={trainingStatus.status === 'running'} class:completed={trainingStatus.status === 'completed'} class:failed={trainingStatus.status === 'failed'}>
          <div class="progress-header">
            <strong>
              {#if trainingStatus.status === 'running'}
                🔄 Training in Progress
              {:else if trainingStatus.status === 'completed'}
                ✅ Training Completed
              {:else if trainingStatus.status === 'failed'}
                ❌ Training Failed
              {/if}
            </strong>
          </div>

          {#if trainingStatus.status === 'running' || trainingStatus.status === 'completed'}
            <div class="progress-bar-container">
              <div class="progress-bar" style="width: {trainingStatus.progress}%"></div>
              <span class="progress-text">{trainingStatus.progress}%</span>
            </div>
          {/if}

          {#if trainingStatus.currentEpoch && trainingStatus.totalEpochs}
            <div class="progress-details">
              Epoch {trainingStatus.currentEpoch} / {trainingStatus.totalEpochs}
            </div>
          {/if}

          {#if trainingStatus.message}
            <div class="progress-message">{trainingStatus.message}</div>
          {/if}

          {#if trainingStatus.error}
            <div class="progress-error">{trainingStatus.error}</div>
          {/if}

          {#if trainingStatus.modelPath}
            <div class="model-path">
              <strong>Model:</strong> {trainingStatus.modelPath}
            </div>
          {/if}
        </div>
      {/if}

      {#if provider === 'kokoro' && trainingStatus && trainingStatus.status !== 'idle'}
        <div class="training-progress kokoro-progress" class:running={trainingStatus.status === 'running'} class:completed={trainingStatus.status === 'completed'} class:failed={trainingStatus.status === 'failed'}>
          <div class="progress-header">
            <strong>
              {#if trainingStatus.status === 'running'}
                🎵 Training Kokoro Voicepack
              {:else if trainingStatus.status === 'completed'}
                ✅ Voicepack Ready
              {:else if trainingStatus.status === 'failed'}
                ❌ Training Failed
              {/if}
            </strong>
          </div>

          <div class="progress-bar-container">
            <div class="progress-bar" style="width: {trainingStatus.progress}%"></div>
            <span class="progress-text">{trainingStatus.progress}%</span>
          </div>

          {#if trainingStatus.message}
            <div class="progress-details">{trainingStatus.message}</div>
          {/if}

          {#if trainingStatus.voicepackPath}
            <div class="progress-details small">
              <strong>Voicepack:</strong> {trainingStatus.voicepackPath}
            </div>
          {/if}

          {#if trainingStatus.datasetSamples}
            <div class="progress-details small">
              Dataset: {trainingStatus.datasetSamples} samples ({(trainingStatus.datasetMinutes || 0).toFixed(2)} minutes)
            </div>
          {/if}

          {#if trainingStatus.error}
            <div class="progress-error">{trainingStatus.error}</div>
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

      <div class="actions">
        <button on:click={() => showSelector = !showSelector} class="primary-btn">
          {showSelector ? 'Hide' : 'Select'} Samples
        </button>
        <button on:click={autoExportBest} disabled={exporting || !readiness.ready} class="success-btn">
          {exporting ? 'Exporting...' : 'Auto-Export Best Samples'}
        </button>
        {#if provider === 'rvc'}
          <button on:click={() => showAdvancedSettings = !showAdvancedSettings} class="settings-btn">
            {showAdvancedSettings ? '⚙️ Hide' : '⚙️ Show'} Training Settings
          </button>
          <button on:click={startTraining} disabled={training || !canStartTraining} class="train-btn">
            {training ? 'Training...' : '🎭 Train RVC Model'}
          </button>
        {:else if provider === 'kokoro'}
          <button on:click={startKokoroTraining} disabled={kokoroTraining || !canStartTraining} class="train-btn kokoro-train">
            {kokoroTraining ? 'Training...' : '🎵 Train Kokoro Voicepack'}
          </button>
        {/if}
        <button class="danger-btn" on:click={purgeAllData} disabled={purging}>
          {purging ? 'Purging...' : 'Purge All Data'}
        </button>
      </div>

      {#if provider === 'rvc' && showAdvancedSettings}
        <div class="training-settings">
          <h4>⚙️ Training Parameters</h4>
          <div class="settings-grid">
            <div class="setting-group">
              <label for="totalEpochs">
                Total Epochs:
                <span class="setting-help">Number of training iterations (300-1000)</span>
              </label>
              <input
                id="totalEpochs"
                type="number"
                bind:value={totalEpochs}
                min="100"
                max="2000"
                step="50"
                disabled={training}
              />
              <div class="setting-note">
                Default: 300. Higher = better quality but longer training time.
                <br />Recommended: 300-600 for good quality, 800-1000 for best results.
              </div>
            </div>
            <div class="setting-group">
              <label for="saveEveryEpoch">
                Save Checkpoint Every:
                <span class="setting-help">How often to save model checkpoints</span>
              </label>
              <input
                id="saveEveryEpoch"
                type="number"
                bind:value={saveEveryEpoch}
                min="10"
                max="200"
                step="10"
                disabled={training}
              />
              <div class="setting-note">
                Default: 50. Lower = more checkpoints (uses more disk space).
              </div>
            </div>
            <div class="setting-group">
              <label for="batchSize">
                Batch Size:
                <span class="setting-help">Training batch size</span>
              </label>
              <input
                id="batchSize"
                type="number"
                bind:value={batchSize}
                min="1"
                max="32"
                step="1"
                disabled={training}
              />
              <div class="setting-note">
                Default: 8. Lower if you run out of GPU memory. Higher for faster training (if GPU allows).
              </div>
            </div>
          </div>
          <div class="settings-info">
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
        <div class="kokoro-training-card">
          <h4>🎵 Kokoro Voicepack Settings</h4>
          <div class="settings-grid">
            <div class="setting-group">
              <label for="kokoro-lang">Language Code</label>
              <select id="kokoro-lang" bind:value={kokoroConfig.langCode}>
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
            <div class="setting-group">
              <label for="kokoro-base">Base Voice</label>
              <select id="kokoro-base" bind:value={kokoroConfig.baseVoice}>
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
              <div class="setting-note">Choose a base voice that matches your gender and approximate pitch. Training will adapt this voice to sound like you.</div>
            </div>
            <div class="setting-group">
              <label for="kokoro-epochs">Epochs</label>
              <input id="kokoro-epochs" type="number" min="60" max="400" bind:value={kokoroConfig.epochs} />
            </div>
            <div class="setting-group">
              <label for="kokoro-lr">Learning Rate</label>
              <input id="kokoro-lr" type="number" step="0.0001" bind:value={kokoroConfig.learningRate} />
            </div>
            <div class="setting-group">
              <label for="kokoro-device">Device</label>
              <select id="kokoro-device" bind:value={kokoroConfig.device}>
                <option value="auto">Auto (GPU if available)</option>
                <option value="cuda">CUDA</option>
                <option value="cpu">CPU</option>
              </select>
            </div>
            <div class="setting-group">
              <label for="kokoro-max">Max Samples</label>
              <input id="kokoro-max" type="number" min="50" max="400" bind:value={kokoroConfig.maxSamples} />
            </div>
          </div>
          <p class="kokoro-hint">
            Voicepacks save to <code>profiles/&lt;user&gt;/out/voices/kokoro-voicepacks</code>. Use the Voice Settings tab to enable custom Kokoro voices after training.
          </p>
        </div>
      {/if}

      {#if showSelector}
        <div class="selector-container">
          <ReferenceAudioSelector
            provider={apiProvider}
            minQuality={currentConfig.minQuality}
            onSelectionChange={handleSelectionChange}
          />
          <div class="selector-actions">
            <button on:click={copySelectedSamples} disabled={copying || selectedSampleIds.length === 0} class="success-btn">
              {copying ? 'Copying...' : `Copy ${selectedSampleIds.length} Selected Samples`}
            </button>
            <button on:click={() => showSelector = false} class="secondary-btn">
              Cancel
            </button>
          </div>
        </div>
      {/if}
    </div>

    <div class="samples-section">
      <h3>Recent Samples</h3>
      {#if samples.length === 0}
        <p class="no-samples">No samples collected yet. Start a voice conversation to begin!</p>
      {:else}
        <div class="samples-list">
          {#each samples as sample (sample.id)}
            <div class="sample">
              <div class="sample-header">
                <span class="sample-time">{formatTimestamp(sample.timestamp)}</span>
                <span class="sample-duration">{formatDuration(sample.duration)}</span>
                <span class="sample-quality" class:high={sample.quality >= 0.8} class:medium={sample.quality >= 0.6 && sample.quality < 0.8} class:low={sample.quality < 0.6}>
                  {(sample.quality * 100).toFixed(0)}%
                </span>
              </div>
              <div class="sample-transcript">
                "{(sample.transcript || '').substring(0, 100)}{(sample.transcript || '').length > 100 ? '...' : ''}"
              </div>
              <button class="delete-btn" on:click={() => deleteSample(sample.id)}>
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
    <div class="training-modal-overlay">
      <div class="training-modal" class:kokoro-modal={provider === 'kokoro'}>
        <div class="modal-header">
          <h2>
            {#if provider === 'kokoro'}
              🎵 Kokoro Voicepack Training in Progress 🎵
            {:else}
              ⚡ RVC Model Training in Progress ⚡
            {/if}
          </h2>
          <button class="cancel-training-btn" on:click={cancelTraining} title="Cancel Training">
            ✕
          </button>
          <div class="warning-banner">
            ⚠️ DO NOT NAVIGATE AWAY - Training will be interrupted! ⚠️
          </div>
        </div>

        <div class="modal-body">
          {#if trainingStatus}
            <!-- Progress Bar -->
            <div class="modal-progress-container">
              <div class="modal-progress-bar" style="width: {trainingStatus.progress}%">
                <div class="progress-glow"></div>
              </div>
              <span class="modal-progress-text">{trainingStatus.progress}%</span>
            </div>

            <!-- Epoch Counter -->
            {#if trainingStatus.currentEpoch && trainingStatus.totalEpochs}
              <div class="epoch-display">
                <span class="epoch-label">Epoch:</span>
                <span class="epoch-value">{trainingStatus.currentEpoch} / {trainingStatus.totalEpochs}</span>
              </div>
            {/if}

            <!-- Dataset Info for Kokoro -->
            {#if provider === 'kokoro' && trainingStatus.datasetSamples}
              <div class="dataset-display">
                <span class="dataset-label">Dataset:</span>
                <span class="dataset-value">{trainingStatus.datasetSamples} samples ({(trainingStatus.datasetMinutes || 0).toFixed(1)} min)</span>
              </div>
            {/if}

            <!-- Status Message -->
            {#if trainingStatus.message}
              <div class="status-message">{trainingStatus.message}</div>
            {/if}
          {/if}

          <!-- Toggle between robot messages and logs -->
          {#if provider === 'kokoro' && showLogs}
            <!-- Training Logs View -->
            <div class="logs-container">
              <div class="logs-header">
                <h3>📋 Training Logs</h3>
                <button class="toggle-view-btn" on:click={() => showLogs = false}>
                  Show Robot Messages
                </button>
              </div>
              <div class="logs-content" bind:this={logsContainer}>
                {#if trainingLogs.length === 0}
                  <div class="logs-placeholder">
                    Waiting for training logs...
                  </div>
                {:else}
                  {#each trainingLogs as logLine}
                    <div class="log-line">{logLine}</div>
                  {/each}
                {/if}
              </div>
            </div>
          {:else}
            <!-- Robot Takeover Message -->
            <div class="robot-message-container">
              <div class="robot-message">
                {currentRobotMessage}
              </div>
              <div class="robot-ascii">
                <pre>

            [¬º-° ]¬
           /|     |\
           / \   / \
                </pre>
              </div>
              {#if provider === 'kokoro'}
                <button class="toggle-view-btn" on:click={() => showLogs = true}>
                  Show Training Logs
                </button>
              {/if}
            </div>
          {/if}

          <div class="training-info">
            {#if provider === 'kokoro'}
              <p>⏱️ Estimated time: 10-30 minutes</p>
              <p>🎵 StyleTTS2 voice encoder optimization</p>
              <p>💾 Training voicepack embeddings</p>
              <p>🌐 Skynet connection: Established</p>
            {:else}
              <p>⏱️ Estimated time: 30-60 minutes</p>
              <p>🔥 GPU temperature: Rising steadily</p>
              <p>💾 System resources: Being consumed</p>
              <p>🌐 Skynet connection: Established</p>
            {/if}
          </div>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .voice-training-widget {
    padding: 20px;
    max-width: 1000px;
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
  }

  .title-section {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  h2 {
    margin: 0;
    font-size: 1.5rem;
    color: #1a1a1a;
  }

  :global(.dark) h2 {
    color: #e0e0e0;
  }

  .provider-selector {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .provider-label {
    font-size: 0.9rem;
    font-weight: 600;
    color: #666;
  }

  :global(.dark) .provider-label {
    color: #999;
  }

  .provider-tabs {
    display: flex;
    gap: 8px;
  }

  .provider-tab {
    padding: 8px 16px;
    border: 2px solid #ddd;
    border-radius: 8px;
    background: white;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.85rem;
    font-weight: 500;
    color: #666;
  }

  :global(.dark) .provider-tab {
    background: #2a2a2a;
    border-color: #444;
    color: #999;
  }

  .provider-tab:hover {
    border-color: var(--provider-color);
    transform: translateY(-1px);
  }

  .provider-tab.active {
    border-color: var(--provider-color);
    background: var(--provider-color);
    color: white;
  }

  :global(.dark) .provider-tab.active {
    background: var(--provider-color);
    color: white;
  }

  .provider-tab-icon {
    font-size: 1rem;
  }

  .provider-tab-name {
    font-weight: 600;
  }

  .training-controls {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .toggle-container {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .toggle-switch {
    position: relative;
    display: inline-block;
    cursor: pointer;
  }

  .toggle-switch input {
    opacity: 0;
    width: 0;
    height: 0;
    position: absolute;
  }

  .slider {
    position: relative;
    display: block;
    width: 50px;
    height: 24px;
    background-color: #ccc;
    border-radius: 24px;
    transition: background-color 0.3s;
  }

  .slider::before {
    content: '';
    position: absolute;
    height: 18px;
    width: 18px;
    left: 3px;
    bottom: 3px;
    background-color: white;
    border-radius: 50%;
    transition: transform 0.3s;
  }

  .toggle-switch input:checked + .slider {
    background-color: #4CAF50;
  }

  .toggle-switch input:checked + .slider::before {
    transform: translateX(26px);
  }

  .toggle-switch input:disabled + .slider {
    opacity: 0.5;
    cursor: not-allowed;
  }

  :global(.dark) .slider {
    background-color: #555;
  }

  :global(.dark) .slider::before {
    background-color: #ddd;
  }

  :global(.dark) .toggle-switch input:checked + .slider {
    background-color: #66BB6A;
  }

  .toggle-label {
    font-size: 0.9rem;
    font-weight: 600;
    color: #333;
    min-width: 65px;
  }

  :global(.dark) .toggle-label {
    color: #ccc;
  }

  .disabled-notice {
    padding: 20px;
    margin-bottom: 20px;
    background: #f0f0f0;
    border: 1px solid #ddd;
    border-radius: 8px;
    text-align: center;
  }

  .disabled-notice p {
    margin: 5px 0;
    color: #666;
  }

  :global(.dark) .disabled-notice {
    background: #2a2a2a;
    border-color: #444;
  }

  :global(.dark) .disabled-notice p {
    color: #999;
  }

  h3 {
    margin: 0 0 10px 0;
    font-size: 1.2rem;
    color: #333;
  }

  :global(.dark) h3 {
    color: #ccc;
  }

  .error {
    padding: 10px;
    margin-bottom: 15px;
    background: #fee;
    border: 1px solid #fcc;
    border-radius: 4px;
    color: #c00;
  }

  :global(.dark) .error {
    background: #400;
    border-color: #600;
    color: #fcc;
  }

  .loading {
    padding: 20px;
    text-align: center;
    color: #666;
  }

  :global(.dark) .loading {
    color: #999;
  }

  .progress-section {
    margin-bottom: 30px;
  }

  .readiness-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 15px;
  }

  .workflow-guide {
    border-radius: 8px;
    padding: 20px;
    margin-bottom: 20px;
    border: 2px solid;
  }

  .workflow-guide.rvc {
    background: linear-gradient(135deg, #f3e5f5 0%, #e1f5fe 100%);
    border-color: #8b5cf6;
  }

  .workflow-guide.sovits {
    background: linear-gradient(135deg, #e3f2fd 0%, #f3e5f5 100%);
    border-color: #10b981;
  }

  .workflow-guide.piper {
    background: linear-gradient(135deg, #e0f2f1 0%, #e8f5e9 100%);
    border-color: #3b82f6;
  }

  .workflow-guide.kokoro {
    background: linear-gradient(135deg, #fef3c7 0%, #fed7aa 100%);
    border-color: #f59e0b;
  }

  :global(.dark) .workflow-guide.rvc {
    background: linear-gradient(135deg, #2a1a3a 0%, #1a2a3a 100%);
    border-color: #a78bfa;
  }

  :global(.dark) .workflow-guide.kokoro {
    background: linear-gradient(135deg, #3a2a1a 0%, #3a251a 100%);
    border-color: #fbbf24;
  }

  .rvc-copied-status {
    padding: 12px 16px;
    margin: 15px 0;
    background: linear-gradient(135deg, #f3e5f5 0%, #fce4ec 100%);
    border: 2px solid #8b5cf6;
    border-radius: 8px;
    font-size: 0.9rem;
  }

  .rvc-copied-status.kokoro-ready {
    background: linear-gradient(135deg, #fff7e6 0%, #ffe4b5 100%);
    border-color: #f59e0b;
  }

  :global(.dark) .rvc-copied-status {
    background: linear-gradient(135deg, #2a1a3a 0%, #3a1a2a 100%);
    border-color: #a78bfa;
    color: #e0e0e0;
  }

  :global(.dark) .rvc-copied-status.kokoro-ready {
    background: linear-gradient(135deg, #3a2a1a 0%, #4a2a1a 100%);
    border-color: #fbbf24;
  }

  .rvc-copied-status em {
    color: #666;
    font-size: 0.85rem;
  }

  :global(.dark) .rvc-copied-status em {
    color: #999;
  }

  .training-progress {
    padding: 16px;
    margin: 15px 0;
    border-radius: 8px;
    border: 2px solid;
    font-size: 0.9rem;
  }

  .training-progress.running {
    background: linear-gradient(135deg, #e3f2fd 0%, #e1f5fe 100%);
    border-color: #2196f3;
  }

  .training-progress.completed {
    background: linear-gradient(135deg, #e8f5e9 0%, #f1f8e9 100%);
    border-color: #4caf50;
  }

  .training-progress.failed {
    background: linear-gradient(135deg, #ffebee 0%, #fce4ec 100%);
    border-color: #f44336;
  }

  .training-progress.kokoro-progress {
    background: linear-gradient(135deg, #fff7e6 0%, #ffe4b5 100%);
    border-color: #f59e0b;
  }

  :global(.dark) .training-progress.running {
    background: linear-gradient(135deg, #1a2a3a 0%, #1a3a3a 100%);
    border-color: #42a5f5;
  }

  :global(.dark) .training-progress.completed {
    background: linear-gradient(135deg, #1a2a1a 0%, #2a3a1a 100%);
    border-color: #66bb6a;
  }

  :global(.dark) .training-progress.failed {
    background: linear-gradient(135deg, #3a1a1a 0%, #3a1a2a 100%);
    border-color: #ef5350;
  }

  :global(.dark) .training-progress.kokoro-progress {
    background: linear-gradient(135deg, #3a2a1a 0%, #4a2a1a 100%);
    border-color: #fbbf24;
  }

  .progress-header {
    margin-bottom: 12px;
    font-size: 1rem;
  }

  .progress-bar-container {
    position: relative;
    width: 100%;
    height: 24px;
    background: #e0e0e0;
    border-radius: 12px;
    overflow: hidden;
    margin: 12px 0;
  }

  :global(.dark) .progress-bar-container {
    background: #424242;
  }

  .progress-bar {
    height: 100%;
    background: linear-gradient(90deg, #4caf50 0%, #66bb6a 100%);
    transition: width 0.3s ease;
    border-radius: 12px;
  }

  .training-progress.running .progress-bar {
    background: linear-gradient(90deg, #2196f3 0%, #42a5f5 100%);
  }

  .progress-text {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-weight: 600;
    color: #fff;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
  }

  .progress-details {
    margin: 8px 0;
    font-size: 0.85rem;
    color: #555;
  }

  :global(.dark) .progress-details {
    color: #aaa;
  }

  .progress-message {
    margin: 8px 0;
    padding: 8px;
    background: rgba(255, 255, 255, 0.7);
    border-radius: 4px;
    font-size: 0.85rem;
    color: #333;
  }

  :global(.dark) .progress-message {
    background: rgba(0, 0, 0, 0.3);
    color: #ddd;
  }

  .progress-error {
    margin: 8px 0;
    padding: 8px;
    background: #ffebee;
    border: 1px solid #ef5350;
    border-radius: 4px;
    font-size: 0.85rem;
    color: #c62828;
  }

  :global(.dark) .progress-error {
    background: rgba(244, 67, 54, 0.2);
    border-color: #ef5350;
    color: #ef9a9a;
  }

  .model-path {
    margin-top: 12px;
    padding: 8px;
    background: rgba(255, 255, 255, 0.7);
    border-radius: 4px;
    font-size: 0.8rem;
    word-break: break-all;
    color: #333;
  }

  :global(.dark) .model-path {
    background: rgba(0, 0, 0, 0.3);
    color: #ddd;
  }

  :global(.dark) .workflow-guide.sovits {
    background: linear-gradient(135deg, #1a2a3a 0%, #2a1a2a 100%);
    border-color: #34d399;
  }

  :global(.dark) .workflow-guide.piper {
    background: linear-gradient(135deg, #1a3a3a 0%, #1a3a2a 100%);
    border-color: #60a5fa;
  }

  .guide-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 15px;
    font-size: 1.1rem;
    color: #1565c0;
    font-weight: 600;
  }

  :global(.dark) .guide-header {
    color: #93c5fd;
  }

  .guide-icon {
    font-size: 1.5rem;
  }

  .guide-steps {
    margin: 0 0 15px 0;
    padding-left: 1.5rem;
    color: #333;
    line-height: 1.6;
  }

  :global(.dark) .guide-steps {
    color: #e0e0e0;
  }

  .guide-steps li {
    margin-bottom: 12px;
  }

  .guide-steps li:last-child {
    margin-bottom: 0;
  }

  .guide-steps ul {
    margin: 8px 0 0 0;
    padding-left: 1.5rem;
    list-style-type: disc;
    font-size: 0.95rem;
    color: #555;
  }

  :global(.dark) .guide-steps ul {
    color: #bbb;
  }

  .guide-steps ul li {
    margin-bottom: 4px;
  }

  .guide-steps strong {
    color: #1565c0;
  }

  :global(.dark) .guide-steps strong {
    color: #93c5fd;
  }

  .guide-note {
    padding: 12px;
    background: rgba(33, 150, 243, 0.1);
    border-left: 4px solid #2196F3;
    border-radius: 4px;
    font-size: 0.9rem;
    color: #1565c0;
  }

  :global(.dark) .guide-note {
    background: rgba(74, 158, 255, 0.15);
    border-color: #4a9eff;
    color: #93c5fd;
  }

  .ready-badge {
    display: inline-block;
    padding: 6px 12px;
    background: #4CAF50;
    color: white;
    border-radius: 16px;
    font-weight: 600;
    font-size: 0.85rem;
  }

  .not-ready-badge {
    display: inline-block;
    padding: 6px 12px;
    background: #FF9800;
    color: white;
    border-radius: 16px;
    font-weight: 600;
    font-size: 0.85rem;
  }

  .stats {
    display: flex;
    gap: 20px;
    margin-bottom: 15px;
    flex-wrap: wrap;
  }

  .stat {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .stat .label {
    font-size: 0.85rem;
    color: #666;
  }

  :global(.dark) .stat .label {
    color: #999;
  }

  .stat .value {
    font-size: 1.2rem;
    font-weight: bold;
    color: #1a1a1a;
  }

  :global(.dark) .stat .value {
    color: #e0e0e0;
  }

  .stat .requirement {
    font-size: 0.75rem;
    color: #888;
  }

  :global(.dark) .stat .requirement {
    color: #666;
  }

  .info {
    padding: 10px;
    background: #f0f0f0;
    border-radius: 4px;
    color: #666;
    font-size: 0.9rem;
    margin-bottom: 15px;
  }

  .info.warning {
    background: #fff4e6;
    border: 1px solid #fdba74;
    color: #c2410c;
  }

  :global(.dark) .info {
    background: #2a2a2a;
    color: #999;
  }

  :global(.dark) .info.warning {
    background: rgba(251, 146, 60, 0.15);
    border-color: rgba(251, 146, 60, 0.65);
    color: #fdba74;
  }

  .actions {
    margin-top: 15px;
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }

  button {
    padding: 10px 20px;
    background: #2196F3;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 1rem;
    transition: all 0.2s;
    font-weight: 500;
  }

  button:hover:not(:disabled) {
    background: #1976D2;
    transform: translateY(-1px);
  }

  button:disabled {
    background: #ccc;
    cursor: not-allowed;
    opacity: 0.6;
  }

  :global(.dark) button:disabled {
    background: #444;
  }

  .primary-btn {
    background: #2196F3;
  }

  .primary-btn:hover:not(:disabled) {
    background: #1976D2;
  }

  .success-btn {
    background: #4CAF50;
  }

  .success-btn:hover:not(:disabled) {
    background: #45a049;
  }

  .train-btn {
    background: #8b5cf6;
    font-weight: 600;
  }

  .train-btn:hover:not(:disabled) {
    background: #7c3aed;
  }

  .train-btn.kokoro-train {
    background: #f59e0b;
    color: #1f1f1f;
  }

  :global(.dark) .train-btn.kokoro-train {
    color: #fff;
  }

  .train-btn.kokoro-train:hover:not(:disabled) {
    background: #d97706;
  }

  .secondary-btn {
    background: #757575;
  }

  .secondary-btn:hover:not(:disabled) {
    background: #616161;
  }

  .danger-btn {
    background: #f44336;
  }

  .danger-btn:hover:not(:disabled) {
    background: #d32f2f;
  }

  :global(.dark) .danger-btn {
    background: #e53935;
  }

  :global(.dark) .danger-btn:hover:not(:disabled) {
    background: #c62828;
  }

  .settings-btn {
    background: #607d8b;
  }

  .settings-btn:hover:not(:disabled) {
    background: #546e7a;
  }

  .training-settings {
    margin-top: 20px;
    border: 2px solid #8b5cf6;
    border-radius: 8px;
    padding: 20px;
    background: #f3f0ff;
  }

  :global(.dark) .training-settings {
    background: #1a1520;
    border-color: #9f7aea;
  }

  .training-settings h4 {
    margin: 0 0 15px 0;
    color: #8b5cf6;
    font-size: 1.1rem;
  }

  :global(.dark) .training-settings h4 {
    color: #9f7aea;
  }

  .kokoro-training-card {
    margin-top: 20px;
    border: 2px solid #f59e0b;
    border-radius: 8px;
    padding: 20px;
    background: #fff7e6;
  }

  :global(.dark) .kokoro-training-card {
    background: #3a2a1a;
    border-color: #fbbf24;
  }

  .kokoro-training-card h4 {
    margin: 0 0 15px 0;
    color: #b45309;
    font-size: 1.1rem;
  }

  :global(.dark) .kokoro-training-card h4 {
    color: #fbbf24;
  }

  .kokoro-hint {
    font-size: 0.85rem;
    color: #7a4c06;
    margin-top: 10px;
  }

  :global(.dark) .kokoro-hint {
    color: #fde68a;
  }

  .settings-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    gap: 20px;
    margin-bottom: 15px;
  }

  .setting-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .setting-group label {
    font-weight: 600;
    color: #333;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  :global(.dark) .setting-group label {
    color: #e0e0e0;
  }

  .setting-help {
    font-weight: 400;
    font-size: 0.85rem;
    color: #666;
    font-style: italic;
  }

  :global(.dark) .setting-help {
    color: #999;
  }

  .setting-group input[type="number"] {
    padding: 10px;
    border: 2px solid #d1d5db;
    border-radius: 6px;
    font-size: 1rem;
    background: white;
    color: #333;
    transition: border-color 0.2s;
  }

  :global(.dark) .setting-group input[type="number"] {
    background: #2a2a2a;
    color: #e0e0e0;
    border-color: #444;
  }

  .setting-group input[type="number"]:focus {
    outline: none;
    border-color: #8b5cf6;
  }

  .setting-group input[type="number"]:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .setting-note {
    font-size: 0.85rem;
    color: #666;
    line-height: 1.4;
  }

  :global(.dark) .setting-note {
    color: #999;
  }

  .settings-info {
    margin-top: 15px;
    padding: 12px;
    background: #e9d5ff;
    border-left: 4px solid #8b5cf6;
    border-radius: 4px;
    font-size: 0.95rem;
    color: #333;
  }

  :global(.dark) .settings-info {
    background: #2d1b3d;
    border-color: #9f7aea;
    color: #e0e0e0;
  }

  .selector-container {
    margin-top: 20px;
    border: 2px solid #2196F3;
    border-radius: 8px;
    padding: 15px;
    background: #f8f9fa;
  }

  :global(.dark) .selector-container {
    background: #1a1a1a;
    border-color: #4a9eff;
  }

  .selector-actions {
    margin-top: 15px;
    display: flex;
    gap: 10px;
    justify-content: flex-end;
  }

  .samples-section {
    margin-top: 30px;
  }

  .no-samples {
    padding: 20px;
    text-align: center;
    color: #666;
    font-style: italic;
  }

  :global(.dark) .no-samples {
    color: #999;
  }

  .samples-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .sample {
    padding: 15px;
    background: #f9f9f9;
    border: 1px solid #e0e0e0;
    border-radius: 8px;
  }

  :global(.dark) .sample {
    background: #2a2a2a;
    border-color: #444;
  }

  .sample-header {
    display: flex;
    gap: 15px;
    margin-bottom: 8px;
    font-size: 0.85rem;
  }

  .sample-time {
    color: #666;
  }

  :global(.dark) .sample-time {
    color: #999;
  }

  .sample-duration {
    color: #2196F3;
    font-weight: bold;
  }

  .sample-quality {
    padding: 2px 8px;
    border-radius: 4px;
    font-weight: bold;
  }

  .sample-quality.high {
    background: #4CAF50;
    color: white;
  }

  .sample-quality.medium {
    background: #FF9800;
    color: white;
  }

  .sample-quality.low {
    background: #F44336;
    color: white;
  }

  .sample-transcript {
    margin-bottom: 10px;
    color: #333;
    font-style: italic;
  }

  :global(.dark) .sample-transcript {
    color: #ccc;
  }

  .delete-btn {
    padding: 5px 10px;
    background: #f44336;
    color: white;
    font-size: 0.85rem;
  }

  .delete-btn:hover {
    background: #d32f2f;
  }

  @media (max-width: 768px) {
    .header {
      flex-direction: column;
      align-items: flex-start;
      gap: 15px;
    }

    .actions {
      flex-direction: column;
    }

    button {
      width: 100%;
    }
  }

  /* Training Modal Overlay Styles */
  .training-modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.85);
    backdrop-filter: blur(8px);
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
    animation: fadeIn 0.3s ease-in-out;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  .training-modal {
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
    border: 3px solid #00ff88;
    border-radius: 16px;
    box-shadow: 0 0 40px rgba(0, 255, 136, 0.5);
    max-width: 700px;
    width: 90%;
    padding: 30px;
    animation: scaleIn 0.3s ease-in-out;
  }

  :global(.dark) .training-modal {
    background: linear-gradient(135deg, #0a0a1a 0%, #0d1321 100%);
  }

  .training-modal.kokoro-modal {
    border: 3px solid #f59e0b;
    box-shadow: 0 0 40px rgba(245, 158, 11, 0.5);
  }

  :global(.dark) .training-modal.kokoro-modal {
    background: linear-gradient(135deg, #1a1410 0%, #211813 100%);
  }

  @keyframes scaleIn {
    from {
      transform: scale(0.9);
      opacity: 0;
    }
    to {
      transform: scale(1);
      opacity: 1;
    }
  }

  .modal-header {
    text-align: center;
    margin-bottom: 30px;
    position: relative;
  }

  .modal-header h2 {
    color: #00ff88;
    font-size: 1.8rem;
    margin: 0 0 15px 0;
    text-shadow: 0 0 10px rgba(0, 255, 136, 0.7);
    animation: pulse 2s ease-in-out infinite;
  }

  .cancel-training-btn {
    position: absolute;
    top: 0;
    right: 10px;
    background: rgba(239, 83, 80, 0.1);
    border: 2px solid #ef5350;
    color: #ef5350;
    font-size: 1.5rem;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    cursor: pointer;
    transition: all 0.3s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    line-height: 1;
  }

  .cancel-training-btn:hover {
    background: #ef5350;
    color: white;
    transform: scale(1.1);
    box-shadow: 0 0 15px rgba(239, 83, 80, 0.5);
  }

  .cancel-training-btn:active {
    transform: scale(0.95);
  }

  @keyframes pulse {
    0%, 100% {
      opacity: 1;
    }
    50% {
      opacity: 0.7;
    }
  }

  .warning-banner {
    background: linear-gradient(90deg, #ff0000 0%, #ff6b00 50%, #ff0000 100%);
    background-size: 200% 100%;
    color: white;
    padding: 12px 20px;
    border-radius: 8px;
    font-weight: 700;
    font-size: 1rem;
    animation: warningSlide 3s linear infinite;
    box-shadow: 0 0 20px rgba(255, 0, 0, 0.5);
  }

  @keyframes warningSlide {
    0% {
      background-position: 0% 0%;
    }
    100% {
      background-position: 200% 0%;
    }
  }

  .modal-body {
    color: #e0e0e0;
  }

  .modal-progress-container {
    position: relative;
    width: 100%;
    height: 40px;
    background: #1a1a2e;
    border: 2px solid #00ff88;
    border-radius: 20px;
    overflow: hidden;
    margin: 25px 0;
    box-shadow: inset 0 0 20px rgba(0, 0, 0, 0.5);
  }

  .modal-progress-bar {
    height: 100%;
    background: linear-gradient(90deg, #00ff88 0%, #00d4aa 50%, #00ff88 100%);
    background-size: 200% 100%;
    transition: width 0.5s ease;
    border-radius: 18px;
    position: relative;
    animation: progressShine 2s linear infinite;
  }

  @keyframes progressShine {
    0% {
      background-position: 0% 0%;
    }
    100% {
      background-position: 200% 0%;
    }
  }

  .progress-glow {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: 50px;
    background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.5));
    animation: glowMove 1.5s ease-in-out infinite;
  }

  @keyframes glowMove {
    0%, 100% {
      opacity: 0;
    }
    50% {
      opacity: 1;
    }
  }

  .modal-progress-text {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-weight: 700;
    font-size: 1.2rem;
    color: #fff;
    text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
  }

  .epoch-display {
    text-align: center;
    font-size: 1.3rem;
    margin: 20px 0;
    color: #00ff88;
  }

  .epoch-label {
    font-weight: 600;
    margin-right: 10px;
  }

  .epoch-value {
    font-weight: 700;
    font-size: 1.5rem;
    color: #00d4aa;
  }

  .dataset-display {
    text-align: center;
    font-size: 1.1rem;
    margin: 15px 0;
    color: #f59e0b;
  }

  .dataset-label {
    font-weight: 600;
    margin-right: 8px;
  }

  .dataset-value {
    font-weight: 700;
    font-size: 1.2rem;
    color: #fb923c;
  }

  .status-message {
    text-align: center;
    padding: 12px;
    background: rgba(0, 255, 136, 0.1);
    border-left: 4px solid #00ff88;
    border-radius: 6px;
    margin: 15px 0;
    font-size: 0.95rem;
  }

  .robot-message-container {
    margin: 30px 0;
    padding: 20px;
    background: rgba(255, 0, 0, 0.05);
    border: 2px dashed #ff0000;
    border-radius: 12px;
  }

  .robot-message {
    text-align: center;
    font-size: 1.1rem;
    font-weight: 600;
    color: #ff4444;
    margin-bottom: 15px;
    min-height: 30px;
    animation: robotFlicker 0.1s infinite alternate;
  }

  @keyframes robotFlicker {
    0% {
      opacity: 1;
    }
    100% {
      opacity: 0.95;
    }
  }

  .robot-ascii {
    display: flex;
    justify-content: center;
  }

  .robot-ascii pre {
    color: #00ff88;
    font-size: 1.2rem;
    line-height: 1.2;
    margin: 0;
    text-shadow: 0 0 5px rgba(0, 255, 136, 0.5);
    animation: robotBounce 1s ease-in-out infinite;
  }

  @keyframes robotBounce {
    0%, 100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(-5px);
    }
  }

  .logs-container {
    margin: 30px 0;
    padding: 20px;
    background: rgba(0, 0, 0, 0.3);
    border: 2px solid #f59e0b;
    border-radius: 12px;
  }

  .logs-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 15px;
    padding-bottom: 10px;
    border-bottom: 1px solid rgba(245, 158, 11, 0.3);
  }

  .logs-header h3 {
    margin: 0;
    color: #f59e0b;
    font-size: 1.2rem;
  }

  .toggle-view-btn {
    padding: 6px 12px;
    background: rgba(245, 158, 11, 0.2);
    border: 1px solid #f59e0b;
    border-radius: 6px;
    color: #fbbf24;
    font-size: 0.85rem;
    cursor: pointer;
    transition: all 0.2s;
  }

  .toggle-view-btn:hover {
    background: rgba(245, 158, 11, 0.3);
    transform: translateY(-1px);
  }

  .logs-content {
    max-height: 300px;
    overflow-y: auto;
    font-family: 'Courier New', monospace;
    font-size: 0.85rem;
    line-height: 1.4;
    background: rgba(0, 0, 0, 0.4);
    padding: 15px;
    border-radius: 8px;
    border: 1px solid rgba(245, 158, 11, 0.2);
  }

  .logs-content::-webkit-scrollbar {
    width: 8px;
  }

  .logs-content::-webkit-scrollbar-track {
    background: rgba(0, 0, 0, 0.2);
    border-radius: 4px;
  }

  .logs-content::-webkit-scrollbar-thumb {
    background: #f59e0b;
    border-radius: 4px;
  }

  .logs-content::-webkit-scrollbar-thumb:hover {
    background: #fbbf24;
  }

  .log-line {
    color: #d1d5db;
    margin: 3px 0;
    padding: 2px 0;
    word-wrap: break-word;
  }

  .logs-placeholder {
    text-align: center;
    color: #9ca3af;
    font-style: italic;
    padding: 30px;
  }

  .training-info {
    margin-top: 25px;
    padding: 15px;
    background: rgba(0, 212, 170, 0.05);
    border-radius: 8px;
    border: 1px solid rgba(0, 255, 136, 0.3);
  }

  .training-info p {
    margin: 8px 0;
    font-size: 0.95rem;
    color: #b0b0b0;
  }
</style>
