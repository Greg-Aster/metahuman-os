<script lang="ts">
  import { onMount, createEventDispatcher } from 'svelte';
  const dispatch = createEventDispatcher<{ history: void }>();
  import { apiFetch } from '../lib/client/api-config';
  import { DEFAULT_TRAINING_MODEL, DEFAULT_VLLM_TRAINING_MODEL } from '../lib/client/model-defaults';
  import TrainingDataControls from './TrainingDataControls.svelte';
  import { parseTrainingDataSettings, type TrainingDataSettings } from '@metahuman/core/training-schema';

  // Wizard state machine
  type WizardStep = 1 | 2 | 3 | 4 | 5;
  type TrainingMethod = 'local-lora' | 'remote-lora' | 'fine-tune' | null;
  type TrainingTarget = 'ollama' | 'vllm';

  interface SystemCapabilities {
    hasLocalGPU: boolean;
    gpuModel: string | null;
    vramGB: number | null;
    freeVramGB: number | null;
    trainingEnvironmentError: string | null;
    hasUnsloth: boolean;
    hasRunpodKey: boolean;
    hasPreviousModel: boolean;
  }

  interface RunpodConfig {
    apiKey: string;
    templateId: string;
    gpuType: string;
  }

  interface DatasetStats {
    totalMemories: number;
    episodicMemories: number;
    therapySessions: number;
    chatConversations: number;
    recentMemories: number;
    oldestMemory: string | null;
    newestMemory: string | null;
    cognitiveModeCounts: {
      dual: number;
      agent: number;
      emulation: number;
      environment: number;
    };
    organizedMemories: number;
    pendingOrganization: number;
    curatedMemories: number;
    pendingCuration: number;
    curatedRecords: number;
    validCuratedRecords: number;
    invalidCuratedRecords: number;
    trainableSamples: number;
    estimatedTrainingSamples: number;
    latestCuratedAt: string | null;
    obsoleteCuratedRecords: number;
    invalidSourceRecords: number;
    selection: { trainingSamples: number; evaluationSamples: number; objective: string; cutoff: string; excluded: Record<string, number> };
    errors: string[];
  }

  interface TrainingConfig {
    base_model: string;
    num_train_epochs: number;
    max_samples: number | null;
    monthly_training: boolean;
    days_recent: number;
    old_samples: number;
    lora_rank: number;
    lora_alpha: number;
    learning_rate: number;
    per_device_train_batch_size: number;
    gradient_accumulation_steps: number;
    max_seq_length: number;
    quantization: string;
    skipGguf: boolean;
    load_in_4bit?: boolean;
  }

  interface BaseModelOption {
    value: string;
    label: string;
    targets: TrainingTarget[];
    description: string;
  }

  let baseModelOptions: BaseModelOption[] = [];

  const loraConfigPresetOllama: TrainingConfig = {
    base_model: DEFAULT_TRAINING_MODEL,
    num_train_epochs: 1,
    max_samples: 3000,
    monthly_training: true,
    days_recent: 30,
    old_samples: 3000,
    lora_rank: 16,
    lora_alpha: 32,
    learning_rate: 0.0001,
    per_device_train_batch_size: 1,
    gradient_accumulation_steps: 16,
    max_seq_length: 2048,
    quantization: 'Q4_K_M',
    skipGguf: false
  };

  const loraConfigPresetVllm: TrainingConfig = {
    base_model: DEFAULT_VLLM_TRAINING_MODEL,
    num_train_epochs: 1,
    max_samples: 3000,
    monthly_training: true,
    days_recent: 30,
    old_samples: 3000,
    lora_rank: 16,
    lora_alpha: 32,
    learning_rate: 0.0001,
    per_device_train_batch_size: 1,
    gradient_accumulation_steps: 16,
    max_seq_length: 2048,
    quantization: 'Q4_K_M',
    skipGguf: true
  };

  const loraConfigPreset = loraConfigPresetOllama;

  const fineTuneConfigPreset: TrainingConfig = {
    base_model: DEFAULT_VLLM_TRAINING_MODEL,
    num_train_epochs: 2,
    max_samples: 5000,
    monthly_training: true,
    days_recent: 30,
    old_samples: 5000,
    lora_rank: 0,
    lora_alpha: 0,
    learning_rate: 0.00002,
    per_device_train_batch_size: 1,
    gradient_accumulation_steps: 16,
    max_seq_length: 2048,
    quantization: 'Q4_K_M',
    skipGguf: false
  };

  // State
  let currentStep: WizardStep = 1;
  let selectedMethod: TrainingMethod = null;
  let trainingTarget: TrainingTarget = 'ollama';
  let systemCapabilities: SystemCapabilities = {
    hasLocalGPU: false,
    gpuModel: null,
    vramGB: null,
    freeVramGB: null,
    trainingEnvironmentError: null,
    hasUnsloth: false,
    hasRunpodKey: false,
    hasPreviousModel: false
  };
  let runpodConfig: RunpodConfig = {
    apiKey: '',
    templateId: 'metahuman-runpod-trainer',
    gpuType: 'NVIDIA H100 PCIe'
  };
  let customGpuType = '';
  let useCustomGpu = false;
  let datasetStats: DatasetStats | null = null;
  let trainingConfig: TrainingConfig = { ...loraConfigPreset };

  // Loading states
  let loading = false;
  let error = '';
  let validatingRunpod = false;
  let runpodValid = false;
  let runpodConfigLoaded = false;

  // Current user
  let username = '';

  // Advanced settings
  let enableS3Upload = true;
  let enablePreprocessing = true;
  let hasS3Configured = false;

  // Training data configuration
  let dataSettings = parseTrainingDataSettings();
  let trainingDataSaving = false;
  let trainingDataError = '';
  let trainingDataLoadAttempted = false;
  let trainingDataConfigLoaded = false;

  // Training monitor state
  let trainingPid: number | null = null;
  let trainingRunLabel = '';
  let preferencesLoaded = false;
  let settingsMessage = '';
  let trainingLogs: Array<{ timestamp: string; event: string; details?: any }> = [];
  let consoleLogs: string[] = [];
  let logsInterval: number | null = null;
  let consoleScrollContainer: HTMLDivElement | null = null;
  let eventsScrollContainer: HTMLDivElement | null = null;
  let cancelling = false;
  let trainingComplete = false;
  let trainingFailed = false;
  let failureReason = '';

  // Progress tracking state
  interface ProgressInfo {
    stage: string;
    percentage: number;
    attemptCurrent: number;
    attemptMax: number;
    message: string;
  }
  let currentProgress: ProgressInfo | null = null;

  // Computed
  $: canProceed = (() => {
    switch (currentStep) {
      case 1: return selectedMethod !== null && preferencesLoaded;
      case 2: return selectedMethod === 'local-lora' || runpodValid;
      case 3: return datasetStats !== null && trainingDataConfigLoaded && !trainingDataSaving && !trainingDataError;
      case 4: return true;
      case 5: return false;
      default: return false;
    }
  })();

  $: stepTitle = (() => {
    switch (currentStep) {
      case 1: return 'Choose Training Method';
      case 2: return 'Configure RunPod';
      case 3: return 'Review Dataset';
      case 4: return 'Training Configuration';
      case 5: return 'Launch Training';
      default: return 'Training Wizard';
    }
  })();

  function applyPreset() {
    trainingConfig = { ...(selectedMethod === 'fine-tune' ? fineTuneConfigPreset : trainingTarget === 'vllm' ? loraConfigPresetVllm : loraConfigPresetOllama) };
    settingsMessage = 'Preset applied. Save these settings to use them from the CLI.';
  }

  async function loadTrainingPreferences() {
    try {
      const response = await apiFetch('/api/training-config');
      if (!response.ok) throw new Error('Could not load saved training settings');
      const saved = await response.json();
      const catalog = await apiFetch('/api/training-models');
      const models = await catalog.json();
      if (!catalog.ok || !models.success) throw new Error(models.error || 'Could not load training base models');
      baseModelOptions = models.models.map((model: any) => ({ value: model.id, label: model.name, description: model.description, targets: ['ollama', 'vllm'] }));
      for (const key of Object.keys(trainingConfig)) {
        if (saved[key] !== undefined) (trainingConfig as any)[key] = saved[key];
      }
      trainingConfig = { ...trainingConfig };
      trainingTarget = saved.trainingTarget === 'vllm' ? 'vllm' : 'ollama';
      preferencesLoaded = true;
    } catch (err) { error = (err as Error).message; }
  }

  async function saveTrainingPreferences() {
    settingsMessage = '';
    try {
      const response = await apiFetch('/api/training-config', { method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...trainingConfig, trainingTarget }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not save training settings');
      settingsMessage = 'Training settings saved for the wizard and CLI.';
    } catch (err) { settingsMessage = (err as Error).message; }
  }

  $: filteredBaseModels = baseModelOptions.filter(opt => opt.targets.includes(trainingTarget));

  $: usesLoRA = selectedMethod === 'local-lora' || selectedMethod === 'remote-lora';

  async function detectCapabilities() {
    loading = true;
    error = '';
    try {
      const res = await apiFetch('/api/system/gpu-info');
      if (res.ok) {
        const data = await res.json();
        systemCapabilities = {
          hasLocalGPU: data.hasLocalGPU || false,
          gpuModel: data.gpuModel || null,
          vramGB: data.vramGB || null,
          freeVramGB: data.freeVramGB ?? null,
          trainingEnvironmentError: data.trainingEnvironmentError ?? null,
          hasUnsloth: data.hasUnsloth || false,
          hasRunpodKey: data.hasRunpodKey || false,
          hasPreviousModel: data.hasPreviousModel || false
        };
        hasS3Configured = data.hasS3Configured || false;
      }
    } catch (err) {
      console.error('[TrainingWizard] Failed to detect capabilities:', err);
      error = 'Failed to detect system capabilities';
    } finally {
      loading = false;
    }
  }

  async function loadRunpodConfig() {
    try {
      const res = await apiFetch('/api/runpod/config');
      if (res.ok) {
        const data = await res.json();
        if (data.apiKey) {
          runpodConfig.apiKey = data.apiKey;
          runpodConfigLoaded = true;
        }
        if (data.templateId) {
          runpodConfig.templateId = data.templateId;
        }
        if (data.gpuType) {
          const predefinedGpus = [
            'NVIDIA GeForce RTX 5090',
            'NVIDIA GeForce RTX 4090',
            'NVIDIA A100-PCIE-40GB',
            'NVIDIA A100 80GB PCIe',
            'NVIDIA H100 PCIe',
            'NVIDIA H100 80GB HBM3'
          ];
          if (predefinedGpus.includes(data.gpuType)) {
            runpodConfig.gpuType = data.gpuType;
          } else {
            customGpuType = data.gpuType;
            runpodConfig.gpuType = data.gpuType;
            useCustomGpu = true;
          }
        }
      }
    } catch (err) {
      console.error('[TrainingWizard] Failed to load RunPod config:', err);
    }
  }

  function nextStep() {
    if (canProceed) {
      if (currentStep === 1 && selectedMethod === 'local-lora') {
        currentStep = 3 as WizardStep;
      } else {
        currentStep = Math.min(5, currentStep + 1) as WizardStep;
      }
    }
  }

  function prevStep() {
    if (currentStep === 3 && selectedMethod === 'local-lora') {
      currentStep = 1;
    } else {
      currentStep = Math.max(1, currentStep - 1) as WizardStep;
    }
  }

  function selectMethod(method: TrainingMethod) {
    error = '';
    selectedMethod = method;
  }

  async function loadDatasetStats() {
    loading = true;
    error = '';
    try {
      const query = new URLSearchParams();
      query.set('maxSamples', trainingConfig.max_samples == null ? 'all' : String(trainingConfig.max_samples));
      if (trainingConfig.monthly_training) {
        query.set('recentDays', String(trainingConfig.days_recent));
        query.set('olderSamples', String(trainingConfig.old_samples));
      }
      const res = await apiFetch('/api/training/dataset-stats?' + query.toString());
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load dataset stats');
      datasetStats = data;
    } catch (err) {
      console.error('[TrainingWizard] Failed to load dataset stats:', err);
      error = (err as Error).message;
    } finally {
      loading = false;
    }
  }

  async function loadTrainingDataConfig() {
    trainingDataLoadAttempted = true;
    trainingDataError = '';
    try {
      const res = await apiFetch('/api/training-data');
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to load training data settings');
      dataSettings = parseTrainingDataSettings(data.config);
      trainingDataConfigLoaded = true;
    } catch (err) {
      trainingDataError = (err as Error).message;
      trainingDataConfigLoaded = false;
    }
  }

  async function saveTrainingDataConfig() {
    trainingDataSaving = true;
    trainingDataError = '';
    try {
      const res = await apiFetch('/api/training-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dataSettings),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to save training data settings');
      dataSettings = parseTrainingDataSettings(data.config);
      trainingDataConfigLoaded = true;
      await loadDatasetStats();
    } catch (err) {
      trainingDataError = (err as Error).message;
      trainingDataConfigLoaded = false;
    } finally {
      trainingDataSaving = false;
    }
  }

  function handleDataSettingsChange(event: CustomEvent<TrainingDataSettings>) {
    dataSettings = event.detail;
    void saveTrainingDataConfig();
  }

  async function validateRunpod() {
    if (!runpodConfig.apiKey) {
      error = 'Please enter your RunPod API key';
      return;
    }
    validatingRunpod = true;
    error = '';
    try {
      const res = await apiFetch('/api/runpod/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: runpodConfig.apiKey })
      });
      if (!res.ok) throw new Error('Invalid RunPod API key');
      const data = await res.json();
      runpodValid = data.valid;
      if (runpodValid) {

      }
    } catch (err) {
      console.error('[TrainingWizard] RunPod validation failed:', err);
      error = 'Invalid RunPod API key. Please check and try again.';
      runpodValid = false;
    } finally {
      validatingRunpod = false;
    }
  }

  function isProgressLine(line: string): boolean {
    return /\[ProgressTracker\]|Attempt\s+\d+\/\d+|\bSTEP\s+\d+\/\d+|\bStage\s+\d+\/\d+/i.test(line);
  }

  function extractProgress(logs: string[]): ProgressInfo | null {
    for (let i = logs.length - 1; i >= 0; i--) {
      const line = logs[i];
      const progressMatch = line.match(/\[ProgressTracker\]\s+📊\s+(\w+):\s+(\d+)%\s+-\s+Attempt\s+(\d+)\/(\d+)\s+-\s+(.+)/);
      if (progressMatch) {
        return {
          stage: progressMatch[1],
          percentage: parseInt(progressMatch[2]),
          attemptCurrent: parseInt(progressMatch[3]),
          attemptMax: parseInt(progressMatch[4]),
          message: progressMatch[5].trim()
        };
      }
      const loraMatch = line.match(/\[lora-trainer\]\s+(.+?)\s+\(Attempt\s+(\d+)\/(\d+)\)/);
      if (loraMatch) {
        const attemptCurrent = parseInt(loraMatch[2]);
        const attemptMax = parseInt(loraMatch[3]);
        return {
          stage: 'ssh_connection',
          percentage: Math.round((attemptCurrent / attemptMax) * 100),
          attemptCurrent,
          attemptMax,
          message: loraMatch[1].trim()
        };
      }
      const stageMatch = line.match(/\[(?:lora-trainer|full-cycle|fine-tune-cycle)\]\s+(?:STEP|Stage)\s+(\d+)\/(\d+):\s+(.+)/i);
      if (stageMatch) {
        const stageCurrent = parseInt(stageMatch[1]);
        const stageMax = parseInt(stageMatch[2]);
        return {
          stage: `step_${stageCurrent}`,
          percentage: Math.round((stageCurrent / stageMax) * 100),
          attemptCurrent: stageCurrent,
          attemptMax: stageMax,
          message: stageMatch[3].trim()
        };
      }
    }
    return null;
  }

  async function pollTrainingLogs() {
    try {
      const logsRes = await apiFetch('/api/training/logs?maxLines=30');
      if (logsRes.ok) {
        const logsData = await logsRes.json();
        if (logsData.success && logsData.logs) {
          trainingLogs = logsData.logs;
          requestAnimationFrame(() => scrollLogsIfNeeded('events'));
        }
      }
      const consoleRes = await apiFetch('/api/training/console-logs?maxLines=200');
      if (consoleRes.ok) {
        const consoleData = await consoleRes.json();
        if (consoleData.success && consoleData.logs) {
          consoleLogs = consoleData.logs;
          currentProgress = extractProgress(consoleData.logs);
          requestAnimationFrame(() => scrollLogsIfNeeded('console'));
        }
      }
      const statusRes = await apiFetch('/api/training/running');
      if (statusRes.ok) {
        const statusData = await statusRes.json();
        if (statusData.success) {
          trainingPid = statusData.running ? statusData.pid : null;
          if (!statusData.running && !trainingComplete) {
            currentProgress = null;
            const historyRes = await apiFetch('/api/training/history');
            if (!historyRes.ok) throw new Error('Could not verify the terminal training result');
            const history = await historyRes.json();
            const run = history.runs?.find((item: any) => item.runLabel === trainingRunLabel);
            trainingComplete = true;
            trainingFailed = !run || run.status !== 'completed';
            failureReason = trainingFailed ? (run?.error || 'No successful terminal receipt was found. Check Training History.') : '';
            stopLogsPolling();
          }
        }
      }
    } catch (err) {
      console.warn('[TrainingWizard] Failed to poll logs:', err);
      settingsMessage = 'Monitoring could not verify the current result: ' + (err as Error).message;
    }
  }

  function scrollLogsIfNeeded(type: 'console' | 'events') {
    const container = type === 'console' ? consoleScrollContainer : eventsScrollContainer;
    if (!container) return;
    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
    if (isNearBottom) {
      container.scrollTop = container.scrollHeight;
    }
  }

  function startLogsPolling() {
    if (logsInterval) {
      clearInterval(logsInterval);
    }
    pollTrainingLogs();
    logsInterval = window.setInterval(pollTrainingLogs, 10000);
  }

  function stopLogsPolling() {
    if (logsInterval) {
      clearInterval(logsInterval);
      logsInterval = null;
    }
  }

  async function cancelTraining() {
    if (!confirm('Cancel the training cycle? This will stop all in-progress work.')) {
      return;
    }
    cancelling = true;
    try {
      const res = await apiFetch('/api/training/cancel', {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to cancel training');
      }
      settingsMessage = 'Cancellation requested. Waiting for worker and provider cleanup.';
      await pollTrainingLogs();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      cancelling = false;
    }
  }

  async function launchTraining() {
    if (!trainingDataConfigLoaded || trainingDataSaving || trainingDataError) {
      error = 'Load and save valid training data settings before launching.';
      return;
    }
    loading = true;
    error = '';
    try {
      const payload: any = {
        method: selectedMethod,
        trainingTarget: trainingTarget,
        trainingConfig: {
          ...trainingConfig,
          skipGguf: trainingTarget === 'vllm'
        },
        advancedSettings: {
          enableS3Upload: enableS3Upload && hasS3Configured,
          enablePreprocessing: enablePreprocessing
        }
      };
      if (selectedMethod === 'remote-lora' || selectedMethod === 'fine-tune') {
        payload.runpodConfig = {
          apiKey: runpodConfig.apiKey,
          templateId: runpodConfig.templateId,
          gpuType: useCustomGpu ? customGpuType : runpodConfig.gpuType
        };
      }
      const res = await apiFetch('/api/training/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Training launch failed');
      }
      trainingComplete = false;
      trainingPid = data.pid || null;
      trainingRunLabel = data.runLabel;
      trainingFailed = false;
      startLogsPolling();
    } catch (err) {
      console.error('[TrainingWizard] Failed to launch training:', err);
      error = (err as Error).message;
    } finally {
      loading = false;
    }
  }

  async function retryTraining() {
    trainingComplete = false;
    trainingFailed = false;
    failureReason = '';
    consoleLogs = [];
    trainingLogs = [];
    error = '';
    await launchTraining();
  }

  onMount(() => {
    detectCapabilities();
    void loadTrainingPreferences();
    void loadTrainingDataConfig();
    loadRunpodConfig();
    apiFetch('/api/session')
      .then(res => res.json())
      .then(data => {
        if (data.authenticated && data.username) {
          username = data.username;
        }
      })
      .catch(err => console.error('[TrainingWizard] Failed to fetch session:', err));
    apiFetch('/api/training/running')
      .then(res => res.json())
      .then(data => {
        if (data.success && data.running) {
          trainingPid = data.pid;
          trainingRunLabel = data.runLabel || '';
          currentStep = 5;
          startLogsPolling();
        }
      })
      .catch(err => console.warn('Could not check training status:', err));
    return () => {
      stopLogsPolling();
    };
  });

  $: if (currentStep === 3 && datasetStats === null) {
    loadDatasetStats();
  }

  $: if (currentStep === 3 && !trainingDataConfigLoaded) {
    // Load failures remain visible until the user retries.
    if (!trainingDataLoadAttempted) void loadTrainingDataConfig();
  }
</script>

<div class="max-w-[900px] mx-auto p-8">
  <!-- Progress Indicator -->
  <div class="flex justify-between mb-8 px-4">
    {#each [1, 2, 3, 4, 5] as step}
      <div class="flex flex-col items-center gap-2 flex-1 relative {step < 5 ? 'after:content-[\'\'] after:absolute after:top-4 after:left-1/2 after:w-full after:h-0.5 after:bg-gray-700 after:-z-10' : ''}">
        <div class="w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm border-2
          {currentStep === step ? 'bg-emerald-600 border-emerald-600 text-white' : currentStep > step ? 'bg-emerald-600 border-emerald-600' : 'bg-gray-900 border-gray-700'}">
          {#if currentStep > step}
            <span class="text-white">✓</span>
          {:else}
            {step}
          {/if}
        </div>
        <div class="text-xs {currentStep === step ? 'text-white font-semibold' : 'text-gray-500'}">
          {#if step === 1}Method
          {:else if step === 2}RunPod
          {:else if step === 3}Dataset
          {:else if step === 4}Config
          {:else}Launch
          {/if}
        </div>
      </div>
    {/each}
  </div>

  <!-- Step Title -->
  <h2 class="text-2xl font-bold mb-4 text-center text-gray-900 dark:text-gray-100">{stepTitle}</h2>

  <!-- Error Display -->
  {#if error}
    <div class="banner banner-error mb-6 flex items-center gap-3">
      <span class="text-xl">⚠️</span>
      <span class="flex-1">{error}</span>
      <button class="bg-transparent border-0 text-red-300 text-xl cursor-pointer p-1 hover:text-white" on:click={() => error = ''}>✕</button>
    </div>
  {/if}

  <!-- Step Content -->
  <div class="min-h-[400px] mb-8">
    {#if currentStep === 1}
      <!-- Step 1: Method Selection -->
      <div>
        <p class="text-base text-gray-500 dark:text-gray-400 mb-8 text-center">
          Select your training target and method based on your hardware and goals.
        </p>

        <!-- Training Target Selection -->
        <div class="mb-8 pb-6 border-b border-gray-700">
          <h4 class="text-lg mb-2 text-center text-gray-900 dark:text-gray-100">Training Target</h4>
          <p class="text-sm text-gray-500 text-center mb-6">Choose where you'll use the trained model:</p>

          <div class="flex justify-center gap-4 flex-wrap">
            <button
              class="flex items-center gap-3 px-6 py-4 rounded-xl border-2 cursor-pointer transition-all min-w-[160px]
                {trainingTarget === 'ollama' ? 'border-emerald-600 bg-emerald-600/10' : 'border-gray-700 bg-gray-900 hover:border-emerald-600'}"
              on:click={() => trainingTarget = 'ollama'}
            >
              <div class="text-2xl">🦙</div>
              <div>
                <h5 class="m-0 text-base text-white">Ollama</h5>
                <span class="text-xs text-gray-500">GGUF format • Local inference</span>
              </div>
            </button>

            <button
              class="flex items-center gap-3 px-6 py-4 rounded-xl border-2 cursor-pointer transition-all min-w-[160px]
                {trainingTarget === 'vllm' ? 'border-emerald-600 bg-emerald-600/10' : 'border-gray-700 bg-gray-900 hover:border-emerald-600'}"
              on:click={() => trainingTarget = 'vllm'}
            >
              <div class="text-2xl">⚡</div>
              <div>
                <h5 class="m-0 text-base text-white">vLLM</h5>
                <span class="text-xs text-gray-500">Safetensors format • High throughput</span>
              </div>
            </button>

          </div>

          {#if trainingTarget === 'vllm'}
            <div class="flex items-start gap-3 mt-6 p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg text-sm text-gray-400">
              <span class="shrink-0">ℹ️</span>
              <span>vLLM training produces safetensors adapters from the maintained Qwen 3.5 base.</span>
            </div>
          {/if}
        </div>

        <!-- Training Method Selection -->
        <h4 class="text-lg mb-4 text-center text-gray-900 dark:text-gray-100">Choose Training Method</h4>

        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          <!-- Local LoRA Training -->
          <button
            class="p-6 rounded-xl border-2 transition-all text-left flex flex-col gap-4 cursor-pointer
              {selectedMethod === 'local-lora' ? 'border-emerald-600 bg-emerald-600/10' : 'border-gray-700 bg-gray-900 hover:border-emerald-600 hover:-translate-y-0.5'}"
            on:click={() => selectMethod('local-lora')}
          >
            <div class="text-3xl">🏠 💻</div>
            <h3 class="text-xl m-0 text-gray-100">Local LoRA Training</h3>
            <p class="text-sm text-gray-500 m-0">Train on your local machine</p>

            <div class="flex flex-col gap-2">
              <div class="text-sm flex items-center gap-2 {systemCapabilities.hasLocalGPU ? 'text-emerald-500' : ''}">
                {systemCapabilities.hasLocalGPU ? '✅' : '❌'} NVIDIA GPU; 4B LoRA is the starting preset
              </div>
              <div class="text-sm flex items-center gap-2 {systemCapabilities.hasUnsloth ? 'text-emerald-500' : ''}">
                {systemCapabilities.hasUnsloth ? '✅' : '❌'} Python + unsloth
              </div>
            </div>

            {#if systemCapabilities.hasLocalGPU && systemCapabilities.gpuModel}
              <div class="text-sm text-gray-500 pt-2 border-t border-gray-700">
                Detected: {systemCapabilities.gpuModel} ({systemCapabilities.vramGB?.toFixed(1)} GB total, {systemCapabilities.freeVramGB?.toFixed(1)} GB free)
              </div>
            {/if}

            {#if systemCapabilities.trainingEnvironmentError}<p class="text-sm text-amber-400 break-words">{systemCapabilities.trainingEnvironmentError}</p>{/if}

            <div class="flex items-center gap-2 text-emerald-500 font-semibold">
              <span>→</span>
              <span>Select</span>
            </div>
          </button>

          <!-- Remote LoRA Training -->
          <button
            class="p-6 rounded-xl border-2 cursor-pointer transition-all text-left flex flex-col gap-4
              {selectedMethod === 'remote-lora' ? 'border-emerald-600 bg-emerald-600/10' : 'border-gray-700 bg-gray-900 hover:border-emerald-600 hover:-translate-y-0.5'}"
            on:click={() => selectMethod('remote-lora')}
          >
            <div class="text-3xl">☁️ 🚀</div>
            <h3 class="text-xl m-0 text-gray-100">Remote LoRA Training</h3>
            <p class="text-sm text-gray-500 m-0">Train on RunPod cloud</p>

            <div class="flex flex-col gap-2">
              <div class="text-sm flex items-center gap-2 {systemCapabilities.hasRunpodKey ? 'text-emerald-500' : ''}">
                {systemCapabilities.hasRunpodKey ? '✅' : '⚠️'} RunPod API key
              </div>
              <div class="text-sm flex items-center gap-2 text-emerald-500">
                ✅ No local GPU needed
              </div>
            </div>

            <div class="text-sm text-gray-500 pt-2 border-t border-gray-700">
              Cost depends on the selected GPU and runtime
            </div>

            <div class="flex items-center gap-2 text-emerald-500 font-semibold">
              <span>→</span>
              <span>Select</span>
            </div>
          </button>

          <!-- Full Fine-Tuning -->
          <button
            class="p-6 rounded-xl border-2 transition-all text-left flex flex-col gap-4 cursor-pointer
              {selectedMethod === 'fine-tune' ? 'border-emerald-600 bg-emerald-600/10' : 'border-gray-700 bg-gray-900 hover:border-emerald-600 hover:-translate-y-0.5'}"
            on:click={() => selectMethod('fine-tune')}
          >
            <div class="text-3xl">🎯 🧠</div>
            <h3 class="text-xl m-0 text-gray-100">Full Fine-Tuning</h3>
            <p class="text-sm text-gray-500 m-0">Advanced continuous learning</p>

            <div class="flex flex-col gap-2">
              <div class="text-sm flex items-center gap-2 {systemCapabilities.hasRunpodKey ? 'text-emerald-500' : ''}">
                {systemCapabilities.hasRunpodKey ? '✅' : '⚠️'} RunPod API key
              </div>
              <div class="text-sm flex items-center gap-2">
                Requires memory for all weights and optimizer state
              </div>
            </div>

            <div class="text-sm text-gray-500 pt-2 border-t border-gray-700">
              Trains the base model you select; evaluation gates acceptance
            </div>

            <div class="flex items-center gap-2 text-emerald-500 font-semibold">
              <span>→</span>
              <span>Select</span>
            </div>
          </button>
        </div>

        {#if !systemCapabilities.hasLocalGPU && !systemCapabilities.hasRunpodKey}
          <div class="banner banner-warning flex items-center gap-3">
            <span class="text-2xl">💡</span>
            <span class="text-sm">
              No local GPU or RunPod key detected. We recommend setting up RunPod for cloud training.
            </span>
          </div>
        {/if}
      </div>

    {:else if currentStep === 2}
      <!-- Step 2: RunPod Configuration -->
      <div>
        <p class="text-base text-gray-500 mb-8 text-center">
          Configure your RunPod credentials for cloud training. Don't have an account?
          <a href="https://runpod.io" target="_blank" rel="noopener" class="text-emerald-500 hover:underline">Sign up here</a>
        </p>

        {#if runpodConfigLoaded}
          <div class="banner banner-success mb-6 flex items-center gap-3">
            <span class="text-xl font-bold">✓</span>
            <span>RunPod configuration auto-loaded from your saved settings</span>
          </div>
        {/if}

        <form class="max-w-[600px] mx-auto" on:submit|preventDefault={validateRunpod}>
          <div class="form-group">
            <label class="form-label" for="apiKey">RunPod API Key *</label>
            <input
              type="password"
              id="apiKey"
              class="input-field"
              bind:value={runpodConfig.apiKey}
              placeholder="Enter your RunPod API key"
              required
            />
            <small class="block mt-2 text-sm text-gray-500">Get your API key from the <a href="https://www.runpod.io/console/user/settings" target="_blank" class="text-emerald-500 hover:underline">RunPod Dashboard</a></small>
          </div>

          <div class="form-group">
            <label class="form-label" for="templateId">Template ID</label>
            <input
              type="text"
              id="templateId"
              class="input-field"
              bind:value={runpodConfig.templateId}
              placeholder="metahuman-runpod-trainer"
            />
            <small class="block mt-2 text-sm text-gray-500">Uses <code class="bg-black/20 px-1.5 py-0.5 rounded text-xs font-mono">docker.io/gregoryaster/metahuman-runpod-trainer:v3-xformers-5090</code></small>
          </div>

          <div class="form-group">
            <label class="form-label" for="gpuType">Preferred GPU Type</label>
            <select id="gpuType" class="select-field w-full" bind:value={runpodConfig.gpuType} on:change={() => useCustomGpu = runpodConfig.gpuType === 'custom'}>
              <option value="NVIDIA GeForce RTX 5090">NVIDIA GeForce RTX 5090 (~$0.60/hr)</option>
              <option value="NVIDIA GeForce RTX 4090">NVIDIA GeForce RTX 4090 (~$0.40/hr)</option>
              <option value="NVIDIA A100-PCIE-40GB">NVIDIA A100 PCIe 40GB (~$1.00/hr)</option>
              <option value="NVIDIA A100 80GB PCIe">NVIDIA A100 PCIe 80GB (~$1.50/hr)</option>
              <option value="NVIDIA H100 PCIe">NVIDIA H100 PCIe (~$2.50/hr)</option>
              <option value="NVIDIA H100 80GB HBM3">NVIDIA H100 SXM (~$2.70/hr)</option>
              <option value="custom">Custom GPU Type...</option>
            </select>
            <small class="block mt-2 text-sm text-gray-500">Higher-end GPUs are faster but more expensive. <a href="https://docs.runpod.io/references/gpu-types" target="_blank" class="text-emerald-500 hover:underline">View all GPU types</a></small>
          </div>

          {#if useCustomGpu}
            <div class="form-group">
              <label class="form-label" for="customGpuType">Custom GPU Type</label>
              <input
                type="text"
                id="customGpuType"
                class="input-field"
                bind:value={customGpuType}
                placeholder="e.g., NVIDIA L40S"
                on:input={() => runpodConfig.gpuType = customGpuType}
              />
              <small class="block mt-2 text-sm text-gray-500">Enter the exact GPU name as it appears in RunPod</small>
            </div>
          {/if}

          <button type="submit" class="btn-primary w-full py-4 text-base" disabled={validatingRunpod || !runpodConfig.apiKey}>
            {#if validatingRunpod}
              Validating...
            {:else if runpodValid}
              ✅ Valid - Continue
            {:else}
              Validate API Key
            {/if}
          </button>
        </form>
      </div>

    {:else if currentStep === 3}
      <!-- Step 3: Dataset Review -->
      <div>
        {#if loading}
          <div class="flex flex-col items-center gap-4 p-12">
            <div class="w-12 h-12 border-3 border-gray-700 border-t-emerald-500 rounded-full animate-spin"></div>
            <p class="text-gray-400">Loading dataset statistics...</p>
          </div>
        {:else if datasetStats}
          <p class="text-base text-gray-500 mb-8 text-center">
            Preview the reviewed examples available for your selected training target.
          </p>

          <div class="stats-grid mb-8">
            <div class="stat-card">
              <div class="stat-value text-emerald-500">{datasetStats.totalMemories.toLocaleString()}</div>
              <div class="stat-label">Total Memories</div>
            </div>
            <div class="stat-card">
              <div class="stat-value text-emerald-500">{datasetStats.selection.trainingSamples.toLocaleString()}</div>
              <div class="stat-label">Eligible Training Examples</div>
            </div>
            <div class="stat-card">
              <div class="stat-value text-emerald-500">{datasetStats.selection.evaluationSamples.toLocaleString()}</div>
              <div class="stat-label">Evaluation Examples</div>
            </div>
            <div class="stat-card">
              <div class="stat-value text-emerald-500">{datasetStats.oldestMemory ? new Date(datasetStats.oldestMemory).toLocaleDateString() : 'N/A'}</div>
              <div class="stat-label">Earliest Memory</div>
            </div>
          </div>

          <div class="mb-8">
            <h4 class="text-lg mb-4 text-gray-100">Manual Training Pipeline</h4>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div class="p-4 bg-gray-900 rounded-lg">
                <div class="text-sm text-gray-500">Needs Organizer</div>
                <div class="mt-1 text-xl font-semibold {datasetStats.pendingOrganization === 0 ? 'text-emerald-500' : 'text-amber-400'}">
                  {datasetStats.pendingOrganization.toLocaleString()}
                </div>
              </div>
              <div class="p-4 bg-gray-900 rounded-lg">
                <div class="text-sm text-gray-500">Needs Curator</div>
                <div class="mt-1 text-xl font-semibold {datasetStats.pendingCuration === 0 ? 'text-emerald-500' : 'text-amber-400'}">
                  {datasetStats.pendingCuration.toLocaleString()}
                </div>
              </div>
              <div class="p-4 bg-gray-900 rounded-lg">
                <div class="text-sm text-gray-500">Valid Curator Records</div>
                <div class="mt-1 text-xl font-semibold text-emerald-500">{datasetStats.validCuratedRecords.toLocaleString()}</div>
              </div>
            </div>
            <p class="mt-3 text-sm leading-relaxed text-gray-500">
              Preprocessing organizes and reviews saved messages before freezing a dataset for this run.
              Existing records with an old review policy or changed content are reviewed again.
            </p>
            {#if datasetStats.invalidCuratedRecords > 0}
              <div class="banner banner-warning mt-4">
                {datasetStats.invalidCuratedRecords.toLocaleString()} existing Curator record(s) fail the current contract.
                These records are excluded until Curator can review their sources again.
              </div>
            {/if}
            {#if datasetStats.obsoleteCuratedRecords > 0 || datasetStats.invalidSourceRecords > 0}
              <p class="text-sm text-amber-400 mt-3">{datasetStats.obsoleteCuratedRecords} reviews need renewal; {datasetStats.invalidSourceRecords} source files could not be read.</p>
            {/if}
            {#if datasetStats.selection.trainingSamples === 0 || datasetStats.selection.evaluationSamples === 0}
              <p class="text-sm text-amber-400 mt-3">Training requires eligible examples and an independent evaluation group. Preprocessing may make additional reviewed data available.</p>
            {/if}
            <details class="mt-3 text-sm text-gray-500">
              <summary class="cursor-pointer">Excluded examples and source errors</summary>
              {#each Object.entries(datasetStats.selection.excluded).filter(([, count]) => count > 0) as [reason, count]}
                <p class="mt-1">{reason.replaceAll('-', ' ')}: {count}</p>
              {/each}
              {#each datasetStats.errors as message}<p class="mt-1 break-all">{message}</p>{/each}
            </details>
            <button type="button" class="btn-secondary mt-3" on:click={loadDatasetStats}>Refresh dataset preview</button>
          </div>

          <div class="mb-8">
            <h4 class="text-lg mb-4 text-gray-100">Memory Breakdown by Type</h4>
            <div class="flex flex-col gap-2">
              <div class="flex justify-between p-3 bg-gray-900 rounded-lg">
                <span class="capitalize">Episodic</span>
                <span class="font-semibold text-emerald-500">{datasetStats.episodicMemories.toLocaleString()}</span>
              </div>
              <div class="flex justify-between p-3 bg-gray-900 rounded-lg">
                <span class="capitalize">Therapy Sessions</span>
                <span class="font-semibold text-emerald-500">{datasetStats.therapySessions.toLocaleString()}</span>
              </div>
              <div class="flex justify-between p-3 bg-gray-900 rounded-lg">
                <span class="capitalize">Chat Conversations</span>
                <span class="font-semibold text-emerald-500">{datasetStats.chatConversations.toLocaleString()}</span>
              </div>
            </div>
          </div>

          <div class="mb-8">
            <h4 class="text-lg mb-4 text-gray-100">Cognitive Mode Distribution</h4>
            <div class="flex flex-col gap-2">
              <div class="flex justify-between p-3 bg-gray-900 rounded-lg">
                <span>Dual Mode</span>
                <span class="font-semibold text-emerald-500">{datasetStats.cognitiveModeCounts.dual.toLocaleString()}</span>
              </div>
              <div class="flex justify-between p-3 bg-gray-900 rounded-lg">
                <span>Agent Mode</span>
                <span class="font-semibold text-emerald-500">{datasetStats.cognitiveModeCounts.agent.toLocaleString()}</span>
              </div>
              <div class="flex justify-between p-3 bg-gray-900 rounded-lg">
                <span>Emulation Mode</span>
                <span class="font-semibold text-emerald-500">{datasetStats.cognitiveModeCounts.emulation.toLocaleString()}</span>
              </div>
              <div class="flex justify-between p-3 bg-gray-900 rounded-lg">
                <span>Environment Mode</span>
                <span class="font-semibold text-emerald-500">{datasetStats.cognitiveModeCounts.environment.toLocaleString()}</span>
              </div>
            </div>
          </div>

            <div class="mt-8">
              <h4 class="text-lg mb-4 text-gray-100">Training Dataset Window</h4>
              <label class="flex items-center gap-3 cursor-pointer text-sm">
                <input type="checkbox" class="w-5 h-5 cursor-pointer accent-emerald-600" bind:checked={trainingConfig.monthly_training} />
                <span>Use a recent-data window plus a sample of older records</span>
              </label>

              {#if trainingConfig.monthly_training}
                <div class="grid grid-cols-2 gap-4 mt-4 pl-8">
                  <div class="form-group">
                    <label class="form-label" for="daysRecent">Recent Days</label>
                    <input type="number" id="daysRecent" class="input-field" bind:value={trainingConfig.days_recent} min="1" max="365" />
                  </div>
                  <div class="form-group">
                    <label class="form-label" for="oldSamples">Old Samples</label>
                    <input type="number" id="oldSamples" class="input-field" bind:value={trainingConfig.old_samples} min="0" max="10000" />
                  </div>
                </div>
              {/if}
            </div>
          <!-- Training Data Controls -->
          <div class="mt-8 border-t border-gray-700 pt-6">
            <h4 class="text-lg mb-2 text-gray-100">Training Data Composition</h4>
            <p class="text-sm text-gray-500 mb-4 leading-relaxed">
              Choose whose replies to learn and which reviewed sources to include. These settings also apply to automatic training.
            </p>
            <TrainingDataControls
              settings={dataSettings}
              disabled={loading || trainingDataSaving}
              on:settingsChange={handleDataSettingsChange}
            />
            {#if trainingDataError}
              <p class="text-sm text-red-400 mt-3" role="alert">{trainingDataError}</p>
              <button type="button" class="btn-secondary mt-2" on:click={loadTrainingDataConfig}>Reload data settings</button>
            {/if}
          </div>
        {/if}
      </div>

    {:else if currentStep === 4}
      <!-- Step 4: Training Configuration -->
      <div class="max-w-[600px] mx-auto">
        <div class="flex gap-3 mb-4">
          <button class="btn-secondary" on:click={applyPreset}>Apply recommended preset</button>
          <button class="btn-secondary" on:click={saveTrainingPreferences}>Save training settings</button>
        </div>
        {#if settingsMessage}<p role="status" class="mb-4">{settingsMessage}</p>{/if}
        <div class="p-6 rounded-xl mb-8 flex items-start gap-4 border-2
          {usesLoRA ? 'bg-emerald-600/10 border-emerald-600' : 'bg-orange-500/10 border-orange-500'}">
          <div class="text-3xl leading-none">{usesLoRA ? '🎯' : '🔥'}</div>
          <div class="flex-1">
            <h4 class="m-0 mb-2 text-lg text-gray-100">{usesLoRA ? 'LoRA Training Configuration' : 'Full Fine-Tuning Configuration'}</h4>
            <p class="m-0 text-sm text-gray-500 leading-relaxed">
              {#if usesLoRA}
                LoRA (Low-Rank Adaptation) trains only a small set of adapter weights while freezing the base model.
                It uses less training memory than updating the full model. Evaluation determines whether the candidate improves your target task.
              {:else}
                Full fine-tuning updates every model weight and needs substantially more GPU memory. It does not guarantee better results than LoRA.
              {/if}
            </p>
          </div>
        </div>

        <div>
          <div class="form-group">
            <label class="form-label" for="baseModel">Base Model</label>
            <select id="baseModel" class="select-field w-full" bind:value={trainingConfig.base_model}>
              {#if !filteredBaseModels.some(model => model.value === trainingConfig.base_model)}
                <option value={trainingConfig.base_model}>{trainingConfig.base_model} (custom)</option>
              {/if}
              {#each filteredBaseModels as model}
                <option value={model.value}>{model.label}</option>
              {/each}
            </select>
            <label class="form-label mt-3" for="customTrainingModel">Model identifier or local model directory</label>
            <input id="customTrainingModel" class="input-field" bind:value={trainingConfig.base_model} />
            <small class="block mt-2 text-sm text-gray-500">
              {#if trainingTarget === 'vllm'}
                Safetensors output. Serving must support this base model and adapter configuration.
              {:else if trainingTarget === 'ollama'}
                Models that convert to GGUF format for Ollama
              {:else}
                Models that work with both Ollama and vLLM
              {/if}
            </small>
          </div>

          <div class="form-group">
            <label class="form-label" for="epochs">Training Epochs</label>
            <div class="flex items-center gap-4">
              <input type="number" id="epochs" class="input-field flex-1" bind:value={trainingConfig.num_train_epochs} min="1" max="50" step="1" />
              <span class="font-semibold text-emerald-500 min-w-[80px]">{trainingConfig.num_train_epochs} epochs</span>
            </div>
            <small class="block mt-2 text-sm text-gray-500">Start with a short run. More epochs can overfit; compare the held-out evaluation.</small>
          </div>

          <div class="form-group">
            <label class="form-label" for="maxSamples">Max Samples (optional)</label>
            <input
              type="number"
              id="maxSamples"
              class="input-field"
              bind:value={trainingConfig.max_samples}
              placeholder="Leave blank for all samples"
              min="1"
            />
            <small class="block mt-2 text-sm text-gray-500">Limit samples for faster testing</small>
          </div>

          <details class="mt-8 border-t border-gray-700 pt-4">
            <summary class="cursor-pointer font-semibold py-2 text-gray-100">Advanced Settings</summary>
            <div class="mt-4 grid grid-cols-2 gap-4">
              {#if usesLoRA}
                <div class="form-group">
                  <label class="form-label" for="loraRank">LoRA Rank</label>
                  <input id="loraRank" type="number" min="1" max="1024" step="1" class="input-field w-full" bind:value={trainingConfig.lora_rank} />
                  <small class="block mt-2 text-sm text-gray-500">Higher rank = more parameters but longer training</small>
                </div>
                <div class="form-group">
                  <label class="form-label" for="loraAlpha">LoRA Alpha</label>
                  <input id="loraAlpha" type="number" min="1" max="4096" step="1" class="input-field w-full" bind:value={trainingConfig.lora_alpha} />
                  <small class="block mt-2 text-sm text-gray-500">Controls the scale of the adapter update relative to its rank.</small>
                </div>
              {/if}

              <div class="form-group">
                <label class="form-label" for="learningRate">Learning Rate</label>
                <input id="learningRate" type="number" min="0.000000001" max="1" step="any" class="input-field w-full" bind:value={trainingConfig.learning_rate} />
                <small class="block mt-2 text-sm text-gray-500">{usesLoRA ? 'LoRA uses higher learning rates' : 'Fine-tuning requires lower rates to preserve base model'}</small>
              </div>

                <div class="form-group">
                  <label class="form-label" for="batchSize">Batch Size</label>
                  <input id="batchSize" type="number" min="1" max="128" step="1" class="input-field w-full" bind:value={trainingConfig.per_device_train_batch_size} />
                  <small class="block mt-2 text-sm text-gray-500">Larger batches require more GPU memory.</small>
                </div>

                <div class="form-group">
                  <label class="form-label" for="gradAccum">Gradient Accumulation Steps</label>
                  <input id="gradAccum" type="number" min="1" max="1024" step="1" class="input-field w-full" bind:value={trainingConfig.gradient_accumulation_steps} />
                  <small class="block mt-2 text-sm text-gray-500">Effective batch size = batch_size × accumulation_steps</small>
                </div>
              <div class="form-group">
                <label class="form-label" for="contextWindow">Context Window</label>
                <input id="contextWindow" type="number" min="128" max="262144" step="1" class="input-field w-full" bind:value={trainingConfig.max_seq_length} />
                <small class="block mt-2 text-sm text-gray-500">Longer context = more VRAM required</small>
              </div>

              {#if trainingTarget !== 'vllm'}
                <div class="form-group">
                  <label class="form-label" for="quantization">GGUF Quantization</label>
                  <select id="quantization" class="select-field w-full" bind:value={trainingConfig.quantization}>
                    {#if !['Q4_K_M', 'Q5_K_M', 'Q6_K', 'Q8_0'].includes(trainingConfig.quantization)}
                      <option value={trainingConfig.quantization}>{trainingConfig.quantization} (saved setting)</option>
                    {/if}
                    <option value="Q4_K_M">Q4_K_M</option>
                    <option value="Q5_K_M">Q5_K_M</option>
                    <option value="Q6_K">Q6_K</option>
                    <option value="Q8_0">Q8_0</option>
                  </select>
                  <small class="block mt-2 text-sm text-gray-500">This controls the exported serving model. Training uses unquantized weights by default.</small>
                </div>
              {:else}
                <div class="form-group">
                  <div class="form-label">Output Format</div>
                  <div class="flex items-center gap-3 p-3 bg-emerald-600/10 border border-emerald-600/30 rounded-lg text-emerald-500 font-medium">
                    <span class="text-xl">⚡</span>
                    <span>vLLM target: Safetensors format (no GGUF conversion)</span>
                  </div>
                  <small class="block mt-2 text-sm text-gray-500">LoRA adapters will be saved in safetensors format for direct use with vLLM</small>
                </div>
              {/if}

              <!-- Pipeline Settings -->
              <div class="col-span-2 border-t border-gray-700 pt-4 mt-4 flex flex-col gap-4">
                <div class="font-semibold text-gray-100">Pipeline Settings</div>

                <div class="flex flex-col gap-2">
                  <label class="flex items-center gap-3 cursor-pointer select-none">
                    <div class="relative">
                      <input type="checkbox" class="sr-only peer" bind:checked={enablePreprocessing} />
                      <div class="w-11 h-6 bg-gray-700 rounded-full peer-checked:bg-emerald-600 transition-colors"></div>
                      <div class="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5"></div>
                    </div>
                    <span class="text-sm flex items-center gap-2">
                      Enable Data Preprocessing
                      {#if !enablePreprocessing}<span class="text-xs px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-500 font-semibold">⚠️ Not Recommended</span>{/if}
                    </span>
                  </label>
                  <small class="pl-14 text-sm text-gray-500">
                    Run Organizer and Curator before this job. When disabled, training still uses only previously reviewed examples.
                  </small>
                </div>

                {#if selectedMethod === 'remote-lora' || selectedMethod === 'fine-tune'}
                  <div class="flex flex-col gap-2">
                    <label class="flex items-center gap-3 cursor-pointer select-none {!hasS3Configured ? 'opacity-40' : ''}">
                      <div class="relative">
                        <input type="checkbox" class="sr-only peer" bind:checked={enableS3Upload} disabled={!hasS3Configured} />
                        <div class="w-11 h-6 bg-gray-700 rounded-full peer-checked:bg-emerald-600 transition-colors {!hasS3Configured ? 'cursor-not-allowed' : ''}"></div>
                        <div class="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5"></div>
                      </div>
                      <span class="text-sm flex items-center gap-2">
                        Back up verified candidate to S3
                        {#if !hasS3Configured}
                          <span class="text-xs px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-500 font-semibold">⚙️ Not Configured</span>
                        {/if}
                      </span>
                    </label>
                    <small class="pl-14 text-sm text-gray-500">
                      {#if hasS3Configured}
                        After downloading and verifying the candidate, terminate the pod and upload a backup through the configured S3 connection.
                      {:else}
                        Configure the documented RunPod S3 environment settings to enable backup.
                      {/if}
                    </small>
                  </div>
                {/if}
              </div>
            </div>
          </details>
        </div>
      </div>

    {:else if currentStep === 5}
      <!-- Step 5: Training Monitor -->
      <div class="w-full">
        {#if !trainingPid && !trainingComplete}
          <!-- Pre-launch confirmation -->
          <div class="max-w-[600px] mx-auto bg-gray-900 border-2 border-emerald-600 rounded-2xl p-8">
            <h3 class="text-2xl text-center mb-6 text-gray-100">Ready to Start Training?</h3>

            <div class="flex flex-col gap-4 mb-8">
              <div class="flex justify-between p-3 bg-gray-950 rounded-lg">
                <span class="font-semibold text-gray-100">Method:</span>
                <span class="text-gray-400">
                  {#if selectedMethod === 'local-lora'}Local LoRA Training
                  {:else if selectedMethod === 'remote-lora'}Remote LoRA Training
                  {:else}Full Fine-Tuning
                  {/if}
                </span>
              </div>

              <div class="flex justify-between p-3 bg-gray-950 rounded-lg">
                <span class="font-semibold text-gray-100">Target:</span>
                <span class="text-gray-400">
                  {#if trainingTarget === 'ollama'}🦙 Ollama (GGUF)
                  {:else if trainingTarget === 'vllm'}⚡ vLLM (Safetensors)
                  {:else}🔄 Both (GGUF + Safetensors)
                  {/if}
                </span>
              </div>

              <div class="flex justify-between p-3 bg-gray-950 rounded-lg">
                <span class="font-semibold text-gray-100">Model:</span>
                <span class="text-gray-400">{trainingConfig.base_model}</span>
              </div>

              <div class="flex justify-between p-3 bg-gray-950 rounded-lg">
                <span class="font-semibold text-gray-100">Dataset:</span>
                <span class="text-gray-400">
                  {datasetStats ? datasetStats.selection.trainingSamples.toLocaleString() : 'N/A'} eligible training samples
                </span>
              </div>

              <div class="flex justify-between p-3 bg-gray-950 rounded-lg">
                <span class="font-semibold text-gray-100">Epochs:</span>
                <span class="text-gray-400">{trainingConfig.num_train_epochs}</span>
              </div>

              {#if selectedMethod !== 'local-lora'}
                <div class="flex justify-between p-3 bg-gray-950 rounded-lg">
                  <span class="font-semibold text-gray-100">GPU:</span>
                  <span class="text-gray-400">{runpodConfig.gpuType}</span>
                </div>

                <p class="text-sm text-gray-500">Time and RunPod charges depend on the selected model, GPU, context and dataset. Review the provider rate before launching.</p>
              {/if}
            </div>

            <div class="flex gap-4">
              <button class="btn-secondary flex-1 py-4" on:click={prevStep}>
                ← Back to Config
              </button>
              <button class="btn-primary flex-1 py-4 bg-emerald-600 hover:bg-emerald-700" on:click={launchTraining} disabled={loading}>
                {#if loading}
                  🚀 Launching...
                {:else}
                  🚀 Start Training
                {/if}
              </button>
            </div>

            <!-- Terminal Command Option -->
            <details class="mt-6 border border-gray-700 rounded-lg overflow-hidden">
              <summary class="p-4 bg-gray-950 cursor-pointer font-semibold text-gray-500 hover:bg-gray-900 hover:text-white transition-colors">💻 Run from Terminal Instead</summary>
              <div class="p-4 bg-gray-900">
                <p class="text-sm text-gray-500 m-0 mb-4">
                  Choose a training mode and copy the command to run in a separate terminal.
                </p>

                <h4 class="text-base font-semibold text-gray-100 mt-5 mb-1">🚀 Full Cycle (RunPod - Remote GPU)</h4>
                <p class="text-sm text-gray-500 m-0 mb-2">Complete LoRA training on RunPod cloud GPU. Best for full training runs.</p>
                <div class="flex items-center gap-3 bg-black border border-gray-700 rounded-lg p-3 mb-3">
                  <code class="flex-1 font-mono text-sm text-green-400 break-all">pnpm exec tsx brain/training/personalization/full-cycle.ts --username {username || 'YOUR_USERNAME'}</code>
                  <button class="btn-primary btn-sm whitespace-nowrap" on:click={() => {
                    navigator.clipboard.writeText(`pnpm exec tsx brain/training/personalization/full-cycle.ts --username ${username || 'YOUR_USERNAME'}`);
                    alert('Command copied to clipboard!');
                  }}>📋 Copy</button>
                </div>

                <h4 class="text-base font-semibold text-gray-100 mt-5 mb-1">🖥️ Full Cycle Local (Local GPU)</h4>
                <p class="text-sm text-gray-500 m-0 mb-2">Complete LoRA training on your local GPU. Requires CUDA-capable GPU.</p>
                <div class="flex items-center gap-3 bg-black border border-gray-700 rounded-lg p-3 mb-3">
                  <code class="flex-1 font-mono text-sm text-green-400 break-all">pnpm exec tsx brain/training/personalization/full-cycle-local.ts --username {username || 'YOUR_USERNAME'}</code>
                  <button class="btn-primary btn-sm whitespace-nowrap" on:click={() => {
                    navigator.clipboard.writeText(`pnpm exec tsx brain/training/personalization/full-cycle-local.ts --username ${username || 'YOUR_USERNAME'}`);
                    alert('Command copied to clipboard!');
                  }}>📋 Copy</button>
                </div>

                <h4 class="text-base font-semibold text-gray-100 mt-5 mb-1">🔧 Full Fine-Tune Cycle</h4>
                <p class="text-sm text-gray-500 m-0 mb-2">Fine-tune the saved training base through the shared remote workflow.</p>
                <div class="flex items-center gap-3 bg-black border border-gray-700 rounded-lg p-3 mb-3">
                  <code class="flex-1 font-mono text-sm text-green-400 break-all">pnpm exec tsx brain/training/personalization/fine-tune-cycle.ts --username {username || 'YOUR_USERNAME'}</code>
                  <button class="btn-primary btn-sm whitespace-nowrap" on:click={() => {
                    navigator.clipboard.writeText(`pnpm exec tsx brain/training/personalization/fine-tune-cycle.ts --username ${username || 'YOUR_USERNAME'}`);
                    alert('Command copied to clipboard!');
                  }}>📋 Copy</button>
                </div>

                <p class="text-sm text-gray-500 m-0 mt-4 p-3 bg-emerald-600/10 rounded">
                  <strong>Tip:</strong> Running from a terminal exposes the complete live output. Keep one training job active at a time.
                </p>
              </div>
            </details>
          </div>
        {:else}
          <!-- Training in progress or completed -->
          {#if settingsMessage}<p role="status" class="mb-4">{settingsMessage}</p>{/if}
          <div class="flex items-center justify-between p-4 bg-gray-900 rounded-lg mb-6">
            {#if trainingPid}
              <div class="flex items-center gap-3 px-4 py-2 rounded-md font-semibold bg-emerald-600/10 text-emerald-500 border border-emerald-600/30">
                <div class="w-4 h-4 border-2 border-emerald-600/20 border-t-emerald-500 rounded-full animate-spin"></div>
                <span>Training in Progress (PID: {trainingPid})</span>
              </div>
              <button class="btn-danger btn-sm" on:click={cancelTraining} disabled={cancelling}>
                {cancelling ? 'Cancelling...' : '🛑 Cancel Training'}
              </button>
            {:else if trainingComplete && trainingFailed}
              <div class="flex items-center gap-3 px-4 py-2 rounded-md font-semibold bg-red-500/10 text-red-500 border border-red-500/30">
                <span>❌ Training Failed</span>
              </div>
              <div class="flex gap-3 flex-wrap">
                <button class="btn-sm px-4 py-2 rounded-md font-semibold cursor-pointer transition-all bg-gradient-to-br from-yellow-500 to-orange-500 text-white hover:from-yellow-600 hover:to-orange-600" on:click={retryTraining} disabled={loading}>
                  {loading ? 'Starting...' : '🔄 Retry Training'}
                </button>
                <button class="btn-secondary btn-sm" on:click={() => currentStep = 1}>
                  ⚙️ Change Settings
                </button>
              </div>
            {:else if trainingComplete}
              <div class="flex items-center gap-3 px-4 py-2 rounded-md font-semibold bg-green-500/10 text-green-500 border border-green-500/30">
                <span>✅ Training Complete!</span>
              </div>
              <div class="flex gap-3 flex-wrap items-center">
                <button class="btn-secondary btn-sm" on:click={() => dispatch('history')}>Review candidate in Training History</button>
                <button class="btn-ghost btn-sm border border-gray-700" on:click={() => currentStep = 1}>
                  🔄 New Training
                </button>
              </div>
            {:else}
              <div class="flex items-center gap-3 px-4 py-2 rounded-md font-semibold bg-gray-500/10 text-gray-500 border border-gray-500/30">
                <span>No active training</span>
              </div>
            {/if}
          </div>

          {#if trainingComplete && trainingFailed}
            <div class="bg-red-500/5 border border-red-500/20 rounded-lg p-4 mb-6">
              <p class="text-gray-400 text-sm m-0 leading-relaxed">{failureReason}</p>
            </div>
          {/if}

          <div class="flex flex-col gap-6">
            <!-- Training Progress Banner -->
            {#if trainingPid && currentProgress}
              <div class="bg-gradient-to-br from-emerald-600/15 to-cyan-500/15 border-2 border-emerald-600 rounded-xl p-6 shadow-lg shadow-emerald-600/20">
                <div class="flex justify-between items-center mb-4">
                  <div class="flex items-center gap-3">
                    <span class="text-2xl animate-spin-slow">⚙️</span>
                    <span class="text-lg font-bold text-emerald-500 uppercase tracking-wide">{currentProgress.stage.replace(/_/g, ' ')}</span>
                  </div>
                  <div class="flex items-center gap-4">
                    <span class="text-2xl font-bold text-cyan-400" style="text-shadow: 0 0 10px rgba(0, 212, 255, 0.5);">{currentProgress.percentage}%</span>
                    <span class="text-sm font-semibold text-gray-400 bg-black/30 px-3 py-1.5 rounded-lg">Attempt {currentProgress.attemptCurrent}/{currentProgress.attemptMax}</span>
                  </div>
                </div>
                <div class="text-sm text-gray-100 mb-4 p-2 px-3 bg-black/20 rounded-lg italic">{currentProgress.message}</div>
                <div class="w-full h-2 bg-black/30 rounded overflow-hidden">
                  <div class="h-full bg-gradient-to-r from-emerald-500 to-cyan-400 rounded transition-all duration-300" style="width: {currentProgress.percentage}%; box-shadow: 0 0 10px rgba(0, 212, 255, 0.5);"></div>
                </div>
              </div>
            {/if}

            <!-- Console Output -->
            <div class="panel overflow-hidden">
              <h4 class="px-4 py-3 bg-gray-950 border-b border-gray-700 m-0 text-sm font-semibold text-gray-100">🖥️ Console Output</h4>
              <div class="h-[300px] overflow-y-auto p-4 font-mono text-sm bg-black" bind:this={consoleScrollContainer}>
                {#if consoleLogs.length === 0}
                  <div class="text-gray-500 text-center py-8 italic">
                    {trainingPid ? 'Waiting for training process to start...' : 'No console output yet.'}
                  </div>
                {:else}
                  {#each consoleLogs as line}
                    <div class="text-green-400 mb-1 break-words {isProgressLine(line) ? 'text-cyan-400 font-semibold bg-cyan-500/10 px-2 py-1 -ml-2 border-l-[3px] border-cyan-400' : ''}">{line}</div>
                  {/each}
                {/if}
              </div>
            </div>

            <!-- Audit Events -->
            <div class="panel overflow-hidden">
              <h4 class="px-4 py-3 bg-gray-950 border-b border-gray-700 m-0 text-sm font-semibold text-gray-100">📋 Training Events</h4>
              <div class="h-[300px] overflow-y-auto p-4 font-mono text-sm bg-gray-950" bind:this={eventsScrollContainer}>
                {#if trainingLogs.length === 0}
                  <div class="text-gray-500 text-center py-8 italic">
                    {trainingPid ? 'Waiting for training events...' : 'No training events yet.'}
                  </div>
                {:else}
                  {#each trainingLogs as log}
                    <div class="flex gap-3 mb-2 text-gray-500">
                      <span class="text-gray-600 shrink-0">{new Date(log.timestamp).toLocaleTimeString()}</span>
                      <span class="text-emerald-500 font-semibold capitalize">{(log.event || 'unknown').replace('full_cycle_', '').replace(/_/g, ' ')}</span>
                      {#if log.details}
                        <span class="text-gray-500 text-xs">{JSON.stringify(log.details)}</span>
                      {/if}
                    </div>
                  {/each}
                {/if}
              </div>
            </div>

            {#if trainingPid}
              <div class="p-4 bg-emerald-600/5 border border-emerald-600/20 rounded-lg">
                <p class="m-0 text-gray-500 text-sm">
                  <strong>Note:</strong> Runtime depends on the selected model, data and hardware. Completion requires the saved worker result and confirmed provider cleanup.
                  You can navigate away and check back later.
                </p>
              </div>
            {/if}
          </div>
        {/if}
      </div>
    {/if}
  </div>

  <!-- Navigation -->
  {#if currentStep < 5}
    <div class="flex justify-between gap-4 pt-8 border-t border-gray-700">
      <button class="btn-secondary px-8 py-3" on:click={prevStep} disabled={currentStep === 1}>
        ← Back
      </button>
      <button class="btn-primary px-8 py-3 bg-emerald-600 hover:bg-emerald-700" on:click={nextStep} disabled={!canProceed || loading}>
        {#if loading}
          Loading...
        {:else}
          {currentStep === 4 ? 'Review' : 'Continue'} →
        {/if}
      </button>
    </div>
  {/if}
</div>

<style>
  /* Only keyframe animations need to stay */
  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .animate-spin {
    animation: spin 1s linear infinite;
  }

  .animate-spin-slow {
    animation: spin 3s linear infinite;
  }
</style>
