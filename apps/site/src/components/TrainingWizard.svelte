<script lang="ts">
  import { onMount } from 'svelte';
  import { apiFetch } from '../lib/client/api-config';

  // Wizard state machine
  type WizardStep = 1 | 2 | 3 | 4 | 5;
  type TrainingMethod = 'local-lora' | 'remote-lora' | 'fine-tune' | null;

  interface SystemCapabilities {
    hasLocalGPU: boolean;
    gpuModel: string | null;
    vramGB: number | null;
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
    };
    estimatedTrainingSamples: number;
  }

  interface TrainingConfig {
    base_model: string;
    num_train_epochs: number;
    max_samples: number | null;
    monthly_training: boolean;
    days_recent: number;
    old_samples: number;
    lora_rank: number;
    learning_rate: number;
    per_device_train_batch_size: number;
    gradient_accumulation_steps: number;
    max_seq_length: number;
    quantization: string; // GGUF quantization level
  }

  // Training config presets
  const loraConfigPreset: TrainingConfig = {
    base_model: 'unsloth/Qwen3-14B',
    num_train_epochs: 3,
    max_samples: 3000,
    monthly_training: true,
    days_recent: 30,
    old_samples: 3000,
    lora_rank: 8,
    learning_rate: 0.0002, // 2e-4 (higher for LoRA)
    per_device_train_batch_size: 1,
    gradient_accumulation_steps: 16,
    max_seq_length: 2048,
    quantization: 'Q4_K_M' // Balanced quality/speed
  };

  const fineTuneConfigPreset: TrainingConfig = {
    base_model: 'unsloth/Qwen3-30B-Instruct',
    num_train_epochs: 2,
    max_samples: 5000,
    monthly_training: true,
    days_recent: 30,
    old_samples: 5000,
    lora_rank: 0, // Not used for fine-tuning
    learning_rate: 0.00002, // 2e-5 (lower for fine-tuning)
    per_device_train_batch_size: 4,
    gradient_accumulation_steps: 8,
    max_seq_length: 2048,
    quantization: 'Q4_K_M' // Balanced quality/speed
  };

  // State
  let currentStep: WizardStep = 1;
  let selectedMethod: TrainingMethod = null;
  let systemCapabilities: SystemCapabilities = {
    hasLocalGPU: false,
    gpuModel: null,
    vramGB: null,
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
  let runpodConfigLoaded = false; // Track if config was auto-loaded

  // Current user
  let username = '';

  // Advanced settings
  let enableS3Upload = true; // Enable S3 upload by default if configured
  let enablePreprocessing = true; // Enable curation/preprocessing by default
  let hasS3Configured = false; // Track if S3 credentials exist

  // Training monitor state
  let trainingPid: number | null = null;
  let trainingLogs: Array<{ timestamp: string; event: string; details?: any }> = [];
  let consoleLogs: string[] = [];
  let logsInterval: number | null = null;
  let consoleScrollContainer: HTMLDivElement | null = null;
  let eventsScrollContainer: HTMLDivElement | null = null;
  let cancelling = false;
  let trainingComplete = false;
  let loadingModel = false;
  let modelLoadSuccess = '';

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
      case 1: return selectedMethod !== null;
      case 2: return selectedMethod === 'local-lora' || runpodValid;
      case 3: return datasetStats !== null;
      case 4: return true;
      case 5: return false; // Final step, no proceed
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

  // Auto-switch config preset when method changes
  $: if (selectedMethod) {
    if (selectedMethod === 'fine-tune') {
      trainingConfig = { ...fineTuneConfigPreset };
    } else {
      // Both local-lora and remote-lora use LoRA config
      trainingConfig = { ...loraConfigPreset };
    }
  }

  // Check if current method uses LoRA
  $: usesLoRA = selectedMethod === 'local-lora' || selectedMethod === 'remote-lora';

  // System capability detection
  async function detectCapabilities() {
    loading = true;
    error = '';

    try {
      const res = await apiFetch('/api/system/gpu-info');
      if (res.ok) {
        const data = await res.json();
        systemCapabilities = {
          hasLocalGPU: data.hasGPU || false,
          gpuModel: data.gpuModel || null,
          vramGB: data.vramGB || null,
          hasUnsloth: data.hasUnsloth || false,
          hasRunpodKey: data.hasRunpodKey || false,
          hasPreviousModel: data.hasPreviousModel || false
        };

        // Check if S3 is configured
        hasS3Configured = data.hasS3Configured || false;
      }
    } catch (err) {
      console.error('[TrainingWizard] Failed to detect capabilities:', err);
      error = 'Failed to detect system capabilities';
    } finally {
      loading = false;
    }
  }

  // Load existing RunPod configuration (for owner users)
  async function loadRunpodConfig() {
    try {
      const res = await apiFetch('/api/runpod/config');
      if (res.ok) {
        const data = await res.json();

        // Auto-fill fields if API key exists
        if (data.apiKey) {
          runpodConfig.apiKey = data.apiKey;
          runpodConfigLoaded = true;
        }
        if (data.templateId) {
          runpodConfig.templateId = data.templateId;
        }
        if (data.gpuType) {
          // Check if it's a predefined GPU type
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
            // Custom GPU type
            customGpuType = data.gpuType;
            runpodConfig.gpuType = data.gpuType;
            useCustomGpu = true;
          }
        }
      }
    } catch (err) {
      console.error('[TrainingWizard] Failed to load RunPod config:', err);
      // Not a critical error, user can still enter manually
    }
  }

  // Navigation
  function nextStep() {
    if (canProceed) {
      // Skip RunPod config if doing local training
      if (currentStep === 1 && selectedMethod === 'local-lora') {
        currentStep = 3 as WizardStep;
      } else {
        currentStep = Math.min(5, currentStep + 1) as WizardStep;
      }
    }
  }

  function prevStep() {
    // Skip RunPod config on back if local training
    if (currentStep === 3 && selectedMethod === 'local-lora') {
      currentStep = 1;
    } else {
      currentStep = Math.max(1, currentStep - 1) as WizardStep;
    }
  }

  function selectMethod(method: TrainingMethod) {
    selectedMethod = method;

    // Auto-advance if method is selected
    setTimeout(() => nextStep(), 300);
  }

  // Load dataset stats
  async function loadDatasetStats() {
    loading = true;
    error = '';

    try {
      const res = await apiFetch('/api/training/dataset-stats');
      if (!res.ok) throw new Error('Failed to load dataset stats');
      datasetStats = await res.json();
    } catch (err) {
      console.error('[TrainingWizard] Failed to load dataset stats:', err);
      error = 'Failed to load dataset statistics';
    } finally {
      loading = false;
    }
  }

  // Validate RunPod credentials
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
        // Save config
        localStorage.setItem('mh_runpod_config', JSON.stringify(runpodConfig));
      }
    } catch (err) {
      console.error('[TrainingWizard] RunPod validation failed:', err);
      error = 'Invalid RunPod API key. Please check and try again.';
      runpodValid = false;
    } finally {
      validatingRunpod = false;
    }
  }

  // Check if a log line contains progress information
  function isProgressLine(line: string): boolean {
    return /\[ProgressTracker\]|Attempt\s+\d+\/\d+|\bSTEP\s+\d+\/\d+|\bStage\s+\d+\/\d+/i.test(line);
  }

  // Parse console logs to extract progress indicators
  function extractProgress(logs: string[]): ProgressInfo | null {
    // Search logs in reverse order (most recent first)
    for (let i = logs.length - 1; i >= 0; i--) {
      const line = logs[i];

      // Match ProgressTracker format: "[ProgressTracker] 📊 stage: 8% - Attempt 10/120 - message"
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

      // Match lora-trainer format: "[lora-trainer] Waiting for pod ssh gateway... (Attempt X/120)"
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

      // Match other stage indicators
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

  // Poll training logs and status
  async function pollTrainingLogs() {
    try {
      // Load audit events (reduced from 50 to 30 lines)
      const logsRes = await apiFetch('/api/training/logs?maxLines=30');
      if (logsRes.ok) {
        const logsData = await logsRes.json();
        if (logsData.success && logsData.logs) {
          trainingLogs = logsData.logs;
          // Auto-scroll only if user is near bottom
          requestAnimationFrame(() => scrollLogsIfNeeded('events'));
        }
      }

      // Load console logs (increased from 50 to 200 for better progress detection)
      const consoleRes = await apiFetch('/api/training/console-logs?maxLines=200');
      if (consoleRes.ok) {
        const consoleData = await consoleRes.json();
        if (consoleData.success && consoleData.logs) {
          consoleLogs = consoleData.logs;

          // Extract progress information from logs
          currentProgress = extractProgress(consoleData.logs);

          // Auto-scroll only if user is near bottom
          requestAnimationFrame(() => scrollLogsIfNeeded('console'));
        }
      }

      // Check if process is still running
      const statusRes = await apiFetch('/api/training/running');
      if (statusRes.ok) {
        const statusData = await statusRes.json();
        if (statusData.success) {
          trainingPid = statusData.running ? statusData.pid : null;

          // If process stopped, mark as complete and stop polling
          if (!statusData.running && !trainingComplete) {
            trainingComplete = true;
            currentProgress = null; // Clear progress on completion
            stopLogsPolling();
          }
        }
      }
    } catch (err) {
      console.warn('[TrainingWizard] Failed to poll logs:', err);
    }
  }

  // Smart scroll: only scroll if user is already near bottom
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

    // Initial poll
    pollTrainingLogs();

    // Poll every 10 seconds (reduced from 5 to reduce CPU load)
    logsInterval = window.setInterval(pollTrainingLogs, 10000);
  }

  function stopLogsPolling() {
    if (logsInterval) {
      clearInterval(logsInterval);
      logsInterval = null;
    }
  }

  // Cancel training
  async function cancelTraining() {
    if (!confirm('Cancel the training cycle? This will stop all in-progress work.')) {
      return;
    }

    cancelling = true;
    try {
      const res = await apiFetch('/api/adapters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancelFullCycle' })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to cancel training');
      }

      trainingPid = null;
      stopLogsPolling();
      alert('Training cancelled successfully');
    } catch (err) {
      alert((err as Error).message);
    } finally {
      cancelling = false;
    }
  }

  // Load trained model into Ollama
  async function loadModel(modelType: 'merged' | 'adapter' | 'both') {
    loadingModel = true;
    modelLoadSuccess = '';
    error = '';

    try {
      const res = await apiFetch('/api/training/load-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelType })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to load model');
      }

      modelLoadSuccess = `✅ ${data.message || 'Model loaded successfully!'}`;
    } catch (err) {
      error = (err as Error).message;
    } finally {
      loadingModel = false;
    }
  }

  // Launch training
  async function launchTraining() {
    loading = true;
    error = '';

    try {
      // Build the launch request payload
      const payload: any = {
        method: selectedMethod,
        trainingConfig: trainingConfig,
        advancedSettings: {
          enableS3Upload: enableS3Upload && hasS3Configured, // Only enable if S3 is configured
          enablePreprocessing: enablePreprocessing
        }
      };

      // Include RunPod config for remote training methods
      if (selectedMethod === 'remote-lora' || selectedMethod === 'fine-tune') {
        payload.runpodConfig = {
          apiKey: runpodConfig.apiKey,
          templateId: runpodConfig.templateId,
          gpuType: useCustomGpu ? customGpuType : runpodConfig.gpuType
        };
      }

      // Call the new training launch endpoint
      const res = await apiFetch('/api/training/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) throw new Error('Failed to launch training');

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || 'Training launch failed');
      }

      // Training started successfully
      trainingComplete = false;
      trainingPid = data.pid || null;
      startLogsPolling();
    } catch (err) {
      console.error('[TrainingWizard] Failed to launch training:', err);
      error = 'Failed to launch training. Please try again.';
    } finally {
      loading = false;
    }
  }

  // Lifecycle
  onMount(() => {
    detectCapabilities();
    loadRunpodConfig(); // Auto-load RunPod config for owner users

    // Fetch current user's username
    apiFetch('/api/session')
      .then(res => res.json())
      .then(data => {
        if (data.authenticated && data.username) {
          username = data.username;
        }
      })
      .catch(err => console.error('[TrainingWizard] Failed to fetch session:', err));

    // Load saved RunPod config from localStorage if exists
    const saved = localStorage.getItem('mh_runpod_config');
    if (saved) {
      try {
        const savedConfig = JSON.parse(saved);
        // Only use localStorage if API config wasn't loaded
        if (!runpodConfigLoaded) {
          runpodConfig = savedConfig;
        }
      } catch (err) {
        console.error('[TrainingWizard] Failed to load saved RunPod config');
      }
    }

    // Check if training is already running on mount
    apiFetch('/api/training/running')
      .then(res => res.json())
      .then(data => {
        if (data.success && data.running) {
          trainingPid = data.pid;
          currentStep = 5;
          startLogsPolling();
        }
      })
      .catch(err => console.warn('Could not check training status:', err));

    // Cleanup on unmount
    return () => {
      stopLogsPolling();
    };
  });

  // Watch for step changes to load data
  $: if (currentStep === 3 && datasetStats === null) {
    loadDatasetStats();
  }

  // Auto-scroll is now handled in pollTrainingLogs() using requestAnimationFrame
  // This prevents constant reactive re-renders and DOM reflows
</script>

<div class="training-wizard">
  <!-- Progress Indicator -->
  <div class="wizard-progress">
    {#each [1, 2, 3, 4, 5] as step}
      <div class="progress-step" class:active={currentStep === step} class:completed={currentStep > step}>
        <div class="step-dot">{step}</div>
        <div class="step-label">
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
  <h2 class="wizard-title">{stepTitle}</h2>

  <!-- Error Display -->
  {#if error}
    <div class="error-banner">
      <span class="error-icon">⚠️</span>
      <span class="error-text">{error}</span>
      <button class="error-close" on:click={() => error = ''}>✕</button>
    </div>
  {/if}

  <!-- Step Content -->
  <div class="wizard-content">
    {#if currentStep === 1}
      <!-- Step 1: Method Selection -->
      <div class="method-selection">
        <p class="step-description">
          Select a training method based on your hardware and goals. The wizard will guide you through the rest.
        </p>

        <div class="method-cards">
          <!-- Local LoRA Training -->
          <button class="method-card" class:selected={selectedMethod === 'local-lora'} on:click={() => selectMethod('local-lora')}>
            <div class="card-icon">🏠 💻</div>
            <h3 class="card-title">Local LoRA Training</h3>
            <p class="card-description">Train on your local machine</p>

            <div class="card-requirements">
              <div class="requirement" class:met={systemCapabilities.hasLocalGPU}>
                {systemCapabilities.hasLocalGPU ? '✅' : '❌'} NVIDIA GPU (10GB+ VRAM)
              </div>
              <div class="requirement" class:met={systemCapabilities.hasUnsloth}>
                {systemCapabilities.hasUnsloth ? '✅' : '❌'} Python + unsloth
              </div>
            </div>

            {#if systemCapabilities.hasLocalGPU && systemCapabilities.gpuModel}
              <div class="card-info">
                Detected: {systemCapabilities.gpuModel} ({systemCapabilities.vramGB}GB)
              </div>
            {/if}

            <div class="card-action">
              <span class="action-icon">→</span>
              <span>Select</span>
            </div>
          </button>

          <!-- Remote LoRA Training -->
          <button class="method-card" class:selected={selectedMethod === 'remote-lora'} on:click={() => selectMethod('remote-lora')}>
            <div class="card-icon">☁️ 🚀</div>
            <h3 class="card-title">Remote LoRA Training</h3>
            <p class="card-description">Train on RunPod cloud</p>

            <div class="card-requirements">
              <div class="requirement" class:met={systemCapabilities.hasRunpodKey}>
                {systemCapabilities.hasRunpodKey ? '✅' : '⚠️'} RunPod API key
              </div>
              <div class="requirement met">
                ✅ No local GPU needed
              </div>
            </div>

            <div class="card-info">
              Cost: ~$2-10 per training session
            </div>

            <div class="card-action">
              <span class="action-icon">→</span>
              <span>Select</span>
            </div>
          </button>

          <!-- Full Fine-Tuning -->
          <button class="method-card" class:selected={selectedMethod === 'fine-tune'} on:click={() => selectMethod('fine-tune')}>
            <div class="card-icon">🎯 🧠</div>
            <h3 class="card-title">Full Fine-Tuning</h3>
            <p class="card-description">Advanced continuous learning</p>

            <div class="card-requirements">
              <div class="requirement" class:met={systemCapabilities.hasRunpodKey}>
                {systemCapabilities.hasRunpodKey ? '✅' : '⚠️'} RunPod API key
              </div>
              <div class="requirement" class:met={systemCapabilities.hasPreviousModel}>
                {systemCapabilities.hasPreviousModel ? '✅' : '⚠️'} 1000+ samples recommended
              </div>
            </div>

            <div class="card-info">
              Builds on previous training runs
            </div>

            <div class="card-action">
              <span class="action-icon">→</span>
              <span>Select</span>
            </div>
          </button>
        </div>

        {#if !systemCapabilities.hasLocalGPU && !systemCapabilities.hasRunpodKey}
          <div class="recommendation-box">
            <span class="recommendation-icon">💡</span>
            <span class="recommendation-text">
              No local GPU or RunPod key detected. We recommend setting up RunPod for cloud training.
            </span>
          </div>
        {/if}
      </div>

    {:else if currentStep === 2}
      <!-- Step 2: RunPod Configuration -->
      <div class="runpod-config">
        <p class="step-description">
          Configure your RunPod credentials for cloud training. Don't have an account?
          <a href="https://runpod.io" target="_blank" rel="noopener">Sign up here</a>
        </p>

        {#if runpodConfigLoaded}
          <div class="info-banner">
            <span class="info-icon">✓</span>
            <span class="info-text">
              RunPod configuration auto-loaded from your saved settings
            </span>
          </div>
        {/if}

        <form class="config-form" on:submit|preventDefault={validateRunpod}>
          <div class="form-group">
            <label for="apiKey">RunPod API Key *</label>
            <input
              type="password"
              id="apiKey"
              bind:value={runpodConfig.apiKey}
              placeholder="Enter your RunPod API key"
              required
            />
            <small>Get your API key from the <a href="https://www.runpod.io/console/user/settings" target="_blank">RunPod Dashboard</a></small>
          </div>

          <div class="form-group">
            <label for="templateId">Template ID</label>
            <input
              type="text"
              id="templateId"
              bind:value={runpodConfig.templateId}
              placeholder="metahuman-runpod-trainer"
            />
            <small>Uses <code>docker.io/gregoryaster/metahuman-runpod-trainer:v3-xformers-5090</code></small>
          </div>

          <div class="form-group">
            <label for="gpuType">Preferred GPU Type</label>
            <select id="gpuType" bind:value={runpodConfig.gpuType} on:change={() => useCustomGpu = runpodConfig.gpuType === 'custom'}>
              <option value="NVIDIA GeForce RTX 5090">NVIDIA GeForce RTX 5090 (~$0.60/hr)</option>
              <option value="NVIDIA GeForce RTX 4090">NVIDIA GeForce RTX 4090 (~$0.40/hr)</option>
              <option value="NVIDIA A100-PCIE-40GB">NVIDIA A100 PCIe 40GB (~$1.00/hr)</option>
              <option value="NVIDIA A100 80GB PCIe">NVIDIA A100 PCIe 80GB (~$1.50/hr)</option>
              <option value="NVIDIA H100 PCIe">NVIDIA H100 PCIe (~$2.50/hr)</option>
              <option value="NVIDIA H100 80GB HBM3">NVIDIA H100 SXM (~$2.70/hr)</option>
              <option value="custom">Custom GPU Type...</option>
            </select>
            <small>Higher-end GPUs are faster but more expensive. <a href="https://docs.runpod.io/references/gpu-types" target="_blank">View all GPU types</a></small>
          </div>

          {#if useCustomGpu}
            <div class="form-group">
              <label for="customGpuType">Custom GPU Type</label>
              <input
                type="text"
                id="customGpuType"
                bind:value={customGpuType}
                placeholder="e.g., NVIDIA L40S"
                on:input={() => runpodConfig.gpuType = customGpuType}
              />
              <small>Enter the exact GPU name as it appears in RunPod</small>
            </div>
          {/if}

          <button type="submit" class="validate-button" disabled={validatingRunpod || !runpodConfig.apiKey}>
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
      <div class="dataset-review">
        {#if loading}
          <div class="loading-state">
            <div class="spinner"></div>
            <p>Loading dataset statistics...</p>
          </div>
        {:else if datasetStats}
          <p class="step-description">
            Review your episodic memory statistics. This data will be used for training.
          </p>

          <div class="stats-grid">
            <div class="stat-card">
              <div class="stat-value">{datasetStats.totalMemories.toLocaleString()}</div>
              <div class="stat-label">Total Memories</div>
            </div>

            <div class="stat-card">
              <div class="stat-value">{datasetStats.estimatedTrainingSamples.toLocaleString()}</div>
              <div class="stat-label">Training Samples</div>
            </div>

            <div class="stat-card">
              <div class="stat-value">{datasetStats.recentMemories.toLocaleString()}</div>
              <div class="stat-label">Recent (30 days)</div>
            </div>

            <div class="stat-card">
              <div class="stat-value">{datasetStats.oldestMemory ? new Date(datasetStats.oldestMemory).toLocaleDateString() : 'N/A'}</div>
              <div class="stat-label">Earliest Memory</div>
            </div>
          </div>

          <div class="breakdown-section">
            <h4>Memory Breakdown by Type</h4>
            <div class="breakdown-list">
              <div class="breakdown-item">
                <span class="breakdown-label">Episodic</span>
                <span class="breakdown-value">{datasetStats.episodicMemories.toLocaleString()}</span>
              </div>
              <div class="breakdown-item">
                <span class="breakdown-label">Therapy Sessions</span>
                <span class="breakdown-value">{datasetStats.therapySessions.toLocaleString()}</span>
              </div>
              <div class="breakdown-item">
                <span class="breakdown-label">Chat Conversations</span>
                <span class="breakdown-value">{datasetStats.chatConversations.toLocaleString()}</span>
              </div>
            </div>
          </div>

          <div class="breakdown-section">
            <h4>Cognitive Mode Distribution</h4>
            <div class="breakdown-list">
              <div class="breakdown-item">
                <span class="breakdown-label">Dual Mode</span>
                <span class="breakdown-value">{datasetStats.cognitiveModeCounts.dual.toLocaleString()}</span>
              </div>
              <div class="breakdown-item">
                <span class="breakdown-label">Agent Mode</span>
                <span class="breakdown-value">{datasetStats.cognitiveModeCounts.agent.toLocaleString()}</span>
              </div>
              <div class="breakdown-item">
                <span class="breakdown-label">Emulation Mode</span>
                <span class="breakdown-value">{datasetStats.cognitiveModeCounts.emulation.toLocaleString()}</span>
              </div>
            </div>
          </div>

          <div class="curation-options">
            <h4>Curation Strategy</h4>
            <label class="checkbox-label">
              <input type="checkbox" bind:checked={trainingConfig.monthly_training} />
              <span>Monthly Training (last 30 days + 3000 random old samples)</span>
            </label>

            {#if trainingConfig.monthly_training}
              <div class="advanced-curation">
                <div class="form-group">
                  <label for="daysRecent">Recent Days</label>
                  <input type="number" id="daysRecent" bind:value={trainingConfig.days_recent} min="1" max="365" />
                </div>
                <div class="form-group">
                  <label for="oldSamples">Old Samples</label>
                  <input type="number" id="oldSamples" bind:value={trainingConfig.old_samples} min="0" max="10000" />
                </div>
              </div>
            {/if}
          </div>
        {/if}
      </div>

    {:else if currentStep === 4}
      <!-- Step 4: Training Configuration -->
      <div class="training-config">
        <div class="method-info-banner" class:lora={usesLoRA} class:finetune={!usesLoRA}>
          <div class="banner-icon">{usesLoRA ? '🎯' : '🔥'}</div>
          <div class="banner-content">
            <h4>{usesLoRA ? 'LoRA Training Configuration' : 'Full Fine-Tuning Configuration'}</h4>
            <p>
              {#if usesLoRA}
                LoRA (Low-Rank Adaptation) trains only a small set of adapter weights while freezing the base model.
                This is faster, uses less VRAM, and is perfect for personalizing conversational style.
              {:else}
                Full fine-tuning updates all model weights for maximum performance.
                Requires high-end GPU (40GB+ VRAM) and longer training time (8-24 hours).
              {/if}
            </p>
          </div>
        </div>

        <div class="config-form">
          <div class="form-group">
            <label for="baseModel">Base Model</label>
            <select id="baseModel" bind:value={trainingConfig.base_model}>
              <option value="unsloth/Qwen3-14B">Qwen3-14B (Recommended)</option>
              <option value="unsloth/Qwen3-Coder-30B-A3B-Instruct">Qwen3-Coder-30B</option>
              <option value="unsloth/Qwen3-8B">Qwen3-8B (Faster)</option>
            </select>
          </div>

          <div class="form-group">
            <label for="epochs">Training Epochs</label>
            <input type="range" id="epochs" bind:value={trainingConfig.num_train_epochs} min="1" max="5" step="1" />
            <span class="range-value">{trainingConfig.num_train_epochs} epochs</span>
            <small>More epochs = better learning but longer training time</small>
          </div>

          <div class="form-group">
            <label for="maxSamples">Max Samples (optional)</label>
            <input
              type="number"
              id="maxSamples"
              bind:value={trainingConfig.max_samples}
              placeholder="Leave blank for all samples"
              min="100"
            />
            <small>Limit samples for faster testing</small>
          </div>

          <details class="advanced-config">
            <summary>Advanced Settings</summary>
            <div class="advanced-fields">
              {#if usesLoRA}
                <!-- LoRA-specific settings -->
                <div class="form-group">
                  <label for="loraRank">LoRA Rank</label>
                  <select id="loraRank" bind:value={trainingConfig.lora_rank}>
                    <option value={8}>8 (Balanced)</option>
                    <option value={16}>16 (Higher Capacity)</option>
                    <option value={32}>32 (Maximum)</option>
                  </select>
                  <small>Higher rank = more parameters but longer training</small>
                </div>
              {/if}

              <div class="form-group">
                <label for="learningRate">Learning Rate</label>
                <select id="learningRate" bind:value={trainingConfig.learning_rate}>
                  {#if usesLoRA}
                    <!-- LoRA uses higher learning rates -->
                    <option value={0.0001}>1e-4</option>
                    <option value={0.0002}>2e-4 (Recommended for LoRA)</option>
                    <option value={0.0003}>3e-4</option>
                  {:else}
                    <!-- Fine-tuning uses lower learning rates -->
                    <option value={0.00001}>1e-5</option>
                    <option value={0.00002}>2e-5 (Recommended for Fine-Tune)</option>
                    <option value={0.00005}>5e-5</option>
                  {/if}
                </select>
                <small>{usesLoRA ? 'LoRA uses higher learning rates' : 'Fine-tuning requires lower rates to preserve base model'}</small>
              </div>

              {#if !usesLoRA}
                <!-- Fine-tuning specific settings -->
                <div class="form-group">
                  <label for="batchSize">Batch Size</label>
                  <select id="batchSize" bind:value={trainingConfig.per_device_train_batch_size}>
                    <option value={2}>2</option>
                    <option value={4}>4 (Recommended)</option>
                    <option value={8}>8 (High VRAM)</option>
                  </select>
                  <small>Larger batch size requires more VRAM (40GB+ recommended)</small>
                </div>

                <div class="form-group">
                  <label for="gradAccum">Gradient Accumulation Steps</label>
                  <select id="gradAccum" bind:value={trainingConfig.gradient_accumulation_steps}>
                    <option value={4}>4</option>
                    <option value={8}>8 (Recommended)</option>
                    <option value={16}>16</option>
                  </select>
                  <small>Effective batch size = batch_size × accumulation_steps</small>
                </div>
              {/if}

              <div class="form-group">
                <label for="contextWindow">Context Window</label>
                <select id="contextWindow" bind:value={trainingConfig.max_seq_length}>
                  <option value={2048}>2048 tokens (~1500 words)</option>
                  <option value={4096}>4096 tokens (~3000 words)</option>
                  <option value={8192}>8192 tokens (~6000 words)</option>
                </select>
                <small>Longer context = more VRAM required</small>
              </div>

              <div class="form-group">
                <label for="quantization">GGUF Quantization</label>
                <select id="quantization" bind:value={trainingConfig.quantization}>
                  <option value="Q4_K_M">Q4_K_M (Balanced - 8GB, Recommended)</option>
                  <option value="Q4_K_S">Q4_K_S (Smallest - 7GB)</option>
                  <option value="Q5_K_M">Q5_K_M (Higher Quality - 10GB)</option>
                  <option value="Q5_K_S">Q5_K_S (Medium - 9GB)</option>
                  <option value="Q6_K">Q6_K (Very High Quality - 11GB)</option>
                  <option value="Q8_0">Q8_0 (Highest Quality - 14GB)</option>
                </select>
                <small>Higher quantization = better quality but larger file size</small>
              </div>

              <!-- Pipeline Settings -->
              <div class="form-group toggle-group" style="grid-column: 1 / -1;">
                <label class="section-label">Pipeline Settings</label>

                <div class="toggle-item">
                  <label class="toggle-container">
                    <input type="checkbox" bind:checked={enablePreprocessing} />
                    <span class="toggle-slider"></span>
                    <span class="toggle-label">
                      Enable Data Preprocessing
                      {#if !enablePreprocessing}<span class="warning-badge">⚠️ Not Recommended</span>{/if}
                    </span>
                  </label>
                  <small class="toggle-description">
                    Uses LLM curator to select high-quality conversations for training.
                    Disabling may result in lower quality models.
                  </small>
                </div>

                {#if selectedMethod === 'remote-lora' || selectedMethod === 'fine-tune'}
                  <div class="toggle-item">
                    <label class="toggle-container">
                      <input
                        type="checkbox"
                        bind:checked={enableS3Upload}
                        disabled={!hasS3Configured}
                      />
                      <span class="toggle-slider" class:disabled={!hasS3Configured}></span>
                      <span class="toggle-label">
                        Enable S3 Upload
                        {#if !hasS3Configured}
                          <span class="info-badge">⚙️ Not Configured</span>
                        {:else if enableS3Upload}
                          <span class="success-badge">✓ Saves ~55% Cost</span>
                        {/if}
                      </span>
                    </label>
                    <small class="toggle-description">
                      {#if hasS3Configured}
                        Upload models to S3 instead of direct download. Pod terminates immediately after upload (~3min vs ~15min download).
                      {:else}
                        Configure S3 credentials in .env to enable this feature. See docs/S3-UPLOAD.md for setup instructions.
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
      <div class="training-monitor">
        {#if !trainingPid && !trainingComplete}
          <!-- Pre-launch confirmation -->
          <div class="confirmation-dialog">
            <h3>Ready to Start Training?</h3>

            <div class="training-summary">
              <div class="summary-item">
                <span class="summary-label">Method:</span>
                <span class="summary-value">
                  {#if selectedMethod === 'local-lora'}Local LoRA Training
                  {:else if selectedMethod === 'remote-lora'}Remote LoRA Training
                  {:else}Full Fine-Tuning
                  {/if}
                </span>
              </div>

              <div class="summary-item">
                <span class="summary-label">Model:</span>
                <span class="summary-value">{trainingConfig.base_model}</span>
              </div>

              <div class="summary-item">
                <span class="summary-label">Dataset:</span>
                <span class="summary-value">
                  {datasetStats ? datasetStats.estimatedTrainingSamples.toLocaleString() : 'N/A'} samples
                </span>
              </div>

              <div class="summary-item">
                <span class="summary-label">Epochs:</span>
                <span class="summary-value">{trainingConfig.num_train_epochs}</span>
              </div>

              {#if selectedMethod !== 'local-lora'}
                <div class="summary-item">
                  <span class="summary-label">GPU:</span>
                  <span class="summary-value">{runpodConfig.gpuType}</span>
                </div>

                <div class="summary-item">
                  <span class="summary-label">Estimated Time:</span>
                  <span class="summary-value">2-4 hours</span>
                </div>

                <div class="summary-item">
                  <span class="summary-label">Estimated Cost:</span>
                  <span class="summary-value warning-text">$5-15</span>
                </div>
              {/if}
            </div>

            <div class="launch-actions">
              <button class="cancel-button" on:click={prevStep}>
                ← Back to Config
              </button>
              <button class="launch-button" on:click={launchTraining} disabled={loading}>
                {#if loading}
                  🚀 Launching...
                {:else}
                  🚀 Start Training
                {/if}
              </button>
            </div>

            <!-- Terminal Command Option -->
            <details class="terminal-command-section">
              <summary>💻 Run from Terminal Instead</summary>
              <div class="terminal-command-content">
                <p class="terminal-description">
                  Choose a training mode and copy the command to run in a separate terminal.
                </p>

                <h4 class="command-section-title">🚀 Full Cycle (RunPod - Remote GPU)</h4>
                <p class="command-description">Complete LoRA training on RunPod cloud GPU. Best for full training runs.</p>
                <div class="command-box">
                  <code class="command-text">pnpm tsx brain/agents/full-cycle.ts --username {username || 'YOUR_USERNAME'}</code>
                  <button class="copy-button" on:click={() => {
                    navigator.clipboard.writeText(`pnpm tsx brain/agents/full-cycle.ts --username ${username || 'YOUR_USERNAME'}`);
                    alert('Command copied to clipboard!');
                  }}>📋 Copy</button>
                </div>

                <h4 class="command-section-title">🖥️ Full Cycle Local (Local GPU)</h4>
                <p class="command-description">Complete LoRA training on your local GPU. Requires CUDA-capable GPU.</p>
                <div class="command-box">
                  <code class="command-text">pnpm tsx brain/agents/full-cycle-local.ts --username {username || 'YOUR_USERNAME'}</code>
                  <button class="copy-button" on:click={() => {
                    navigator.clipboard.writeText(`pnpm tsx brain/agents/full-cycle-local.ts --username ${username || 'YOUR_USERNAME'}`);
                    alert('Command copied to clipboard!');
                  }}>📋 Copy</button>
                </div>

                <h4 class="command-section-title">🔧 Fine-Tune Cycle (Incremental)</h4>
                <p class="command-description">Fine-tune an existing adapter with new data. Faster than full training.</p>
                <div class="command-box">
                  <code class="command-text">pnpm tsx brain/agents/fine-tune-cycle.ts --username {username || 'YOUR_USERNAME'}</code>
                  <button class="copy-button" on:click={() => {
                    navigator.clipboard.writeText(`pnpm tsx brain/agents/fine-tune-cycle.ts --username ${username || 'YOUR_USERNAME'}`);
                    alert('Command copied to clipboard!');
                  }}>📋 Copy</button>
                </div>

                <p class="terminal-note">
                  <strong>Tip:</strong> Running from terminal lets you see full output in real-time and run multiple sessions.
                </p>
              </div>
            </details>
          </div>
        {:else}
          <!-- Training in progress or completed -->
          <div class="monitor-status">
            {#if trainingPid}
              <div class="status-badge running">
                <div class="spinner-small"></div>
                <span>Training in Progress (PID: {trainingPid})</span>
              </div>
              <button class="btn-danger-small" on:click={cancelTraining} disabled={cancelling}>
                {cancelling ? 'Cancelling...' : '🛑 Cancel Training'}
              </button>
            {:else if trainingComplete}
              <div class="status-badge complete">
                <span>✅ Training Complete!</span>
              </div>
              <div class="post-training-actions">
                <button class="btn-primary-small" on:click={() => loadModel('merged')} disabled={loadingModel}>
                  {loadingModel ? 'Loading...' : '📦 Load Merged Model'}
                </button>
                <button class="btn-secondary-small" on:click={() => loadModel('adapter')} disabled={loadingModel}>
                  {loadingModel ? 'Loading...' : '🔧 Load LoRA Adapter'}
                </button>
                <button class="btn-secondary-small" on:click={() => loadModel('both')} disabled={loadingModel}>
                  {loadingModel ? 'Loading...' : '📦🔧 Load Both'}
                </button>
                <button class="btn-tertiary-small" on:click={() => currentStep = 1}>
                  🔄 New Training
                </button>
              </div>
              {#if modelLoadSuccess}
                <div class="success-message">{modelLoadSuccess}</div>
              {/if}
            {:else}
              <div class="status-badge idle">
                <span>No active training</span>
              </div>
            {/if}
          </div>

          <div class="monitor-content">
            <!-- Training Progress Banner -->
            {#if trainingPid && currentProgress}
              <div class="progress-banner">
                <div class="progress-header">
                  <div class="progress-stage">
                    <span class="stage-icon">⚙️</span>
                    <span class="stage-name">{currentProgress.stage.replace(/_/g, ' ').toUpperCase()}</span>
                  </div>
                  <div class="progress-stats">
                    <span class="progress-percentage">{currentProgress.percentage}%</span>
                    <span class="progress-attempts">Attempt {currentProgress.attemptCurrent}/{currentProgress.attemptMax}</span>
                  </div>
                </div>
                <div class="progress-message">{currentProgress.message}</div>
                <div class="progress-bar-container">
                  <div class="progress-bar-fill" style="width: {currentProgress.percentage}%"></div>
                </div>
              </div>
            {/if}

            <!-- Console Output -->
            <div class="logs-container">
              <h4>🖥️ Console Output</h4>
              <div class="logs-scroll console-output" bind:this={consoleScrollContainer}>
                {#if consoleLogs.length === 0}
                  <div class="log-empty">
                    {trainingPid ? 'Waiting for training process to start...' : 'No console output yet.'}
                  </div>
                {:else}
                  {#each consoleLogs as line}
                    <div class="console-line" class:progress-highlight={isProgressLine(line)}>{line}</div>
                  {/each}
                {/if}
              </div>
            </div>

            <!-- Audit Events -->
            <div class="logs-container">
              <h4>📋 Training Events</h4>
              <div class="logs-scroll events-output" bind:this={eventsScrollContainer}>
                {#if trainingLogs.length === 0}
                  <div class="log-empty">
                    {trainingPid ? 'Waiting for training events...' : 'No training events yet.'}
                  </div>
                {:else}
                  {#each trainingLogs as log}
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

            {#if trainingPid}
              <div class="progress-footer">
                <p class="help-text">
                  <strong>Note:</strong> The training process may take 30-60 minutes depending on dataset size.
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
    <div class="wizard-navigation">
      <button class="nav-button secondary" on:click={prevStep} disabled={currentStep === 1}>
        ← Back
      </button>
      <button class="nav-button primary" on:click={nextStep} disabled={!canProceed || loading}>
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
  .training-wizard {
    max-width: 900px;
    margin: 0 auto;
    padding: 2rem;
  }

  .wizard-progress {
    display: flex;
    justify-content: space-between;
    margin-bottom: 2rem;
    padding: 0 1rem;
  }

  .progress-step {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    flex: 1;
    position: relative;
  }

  .progress-step::after {
    content: '';
    position: absolute;
    top: 1rem;
    left: 50%;
    width: 100%;
    height: 2px;
    background: var(--border-color, #333);
    z-index: -1;
  }

  .progress-step:last-child::after {
    display: none;
  }

  .step-dot {
    width: 2rem;
    height: 2rem;
    border-radius: 50%;
    background: var(--bg-secondary, #1a1a1a);
    border: 2px solid var(--border-color, #333);
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: bold;
    font-size: 0.875rem;
  }

  .progress-step.active .step-dot {
    background: var(--primary-color, #00a67e);
    border-color: var(--primary-color, #00a67e);
    color: white;
  }

  .progress-step.completed .step-dot {
    background: var(--primary-color, #00a67e);
    border-color: var(--primary-color, #00a67e);
  }

  .progress-step.completed .step-dot::after {
    content: '✓';
    color: white;
  }

  .step-label {
    font-size: 0.75rem;
    color: var(--text-secondary, #888);
  }

  .progress-step.active .step-label {
    color: var(--text-primary, #fff);
    font-weight: 600;
  }

  .wizard-title {
    font-size: 1.75rem;
    margin-bottom: 1rem;
    text-align: center;
  }

  .error-banner {
    background: #ff4444;
    color: white;
    padding: 1rem;
    border-radius: 0.5rem;
    margin-bottom: 1.5rem;
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .error-icon {
    font-size: 1.25rem;
  }

  .error-text {
    flex: 1;
  }

  .error-close {
    background: none;
    border: none;
    color: white;
    font-size: 1.25rem;
    cursor: pointer;
    padding: 0.25rem;
  }

  .info-banner {
    background: #00a67e;
    color: white;
    padding: 1rem;
    border-radius: 0.5rem;
    margin-bottom: 1.5rem;
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .info-icon {
    font-size: 1.25rem;
    font-weight: bold;
  }

  .method-info-banner {
    padding: 1.5rem;
    border-radius: 0.75rem;
    margin-bottom: 2rem;
    display: flex;
    align-items: flex-start;
    gap: 1rem;
    border: 2px solid;
  }

  .method-info-banner.lora {
    background: rgba(0, 166, 126, 0.1);
    border-color: #00a67e;
  }

  .method-info-banner.finetune {
    background: rgba(255, 136, 0, 0.1);
    border-color: #ff8800;
  }

  .banner-icon {
    font-size: 2rem;
    line-height: 1;
  }

  .banner-content {
    flex: 1;
  }

  .banner-content h4 {
    margin: 0 0 0.5rem 0;
    font-size: 1.125rem;
    color: var(--text-primary, #fff);
  }

  .banner-content p {
    margin: 0;
    font-size: 0.875rem;
    color: var(--text-secondary, #888);
    line-height: 1.5;
  }

  .info-text {
    flex: 1;
  }

  .wizard-content {
    min-height: 400px;
    margin-bottom: 2rem;
  }

  .step-description {
    font-size: 1rem;
    color: var(--text-secondary, #888);
    margin-bottom: 2rem;
    text-align: center;
  }

  /* Method Selection */
  .method-cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    gap: 1.5rem;
    margin-bottom: 2rem;
  }

  .method-card {
    background: var(--bg-secondary, #1a1a1a);
    border: 2px solid var(--border-color, #333);
    border-radius: 0.75rem;
    padding: 1.5rem;
    cursor: pointer;
    transition: all 0.2s ease;
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .method-card:hover {
    border-color: var(--primary-color, #00a67e);
    transform: translateY(-2px);
  }

  .method-card.selected {
    border-color: var(--primary-color, #00a67e);
    background: rgba(0, 166, 126, 0.1);
  }

  .card-icon {
    font-size: 2rem;
  }

  .card-title {
    font-size: 1.25rem;
    margin: 0;
  }

  .card-description {
    font-size: 0.875rem;
    color: var(--text-secondary, #888);
    margin: 0;
  }

  .card-requirements {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .requirement {
    font-size: 0.875rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .requirement.met {
    color: var(--success-color, #00a67e);
  }

  .card-info {
    font-size: 0.875rem;
    color: var(--text-secondary, #888);
    padding-top: 0.5rem;
    border-top: 1px solid var(--border-color, #333);
  }

  .card-action {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: var(--primary-color, #00a67e);
    font-weight: 600;
  }

  .recommendation-box {
    background: rgba(255, 193, 7, 0.1);
    border: 1px solid rgba(255, 193, 7, 0.3);
    border-radius: 0.5rem;
    padding: 1rem;
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .recommendation-icon {
    font-size: 1.5rem;
  }

  .recommendation-text {
    font-size: 0.875rem;
  }

  /* Forms */
  .config-form,
  .training-config {
    max-width: 600px;
    margin: 0 auto;
  }

  .form-group {
    margin-bottom: 1.5rem;
  }

  .form-group label {
    display: block;
    margin-bottom: 0.5rem;
    font-weight: 600;
  }

  .form-group input,
  .form-group select {
    width: 100%;
    padding: 0.75rem;
    background: var(--bg-tertiary, #111);
    border: 1px solid var(--border-color, #333);
    border-radius: 0.5rem;
    color: var(--text-primary, #fff);
    font-size: 1rem;
  }

  .form-group small {
    display: block;
    margin-top: 0.5rem;
    font-size: 0.875rem;
    color: var(--text-secondary, #888);
  }

  .form-group small a {
    color: var(--primary-color, #00a67e);
  }

  .form-group small code {
    background: rgba(0, 0, 0, 0.2);
    padding: 0.125rem 0.375rem;
    border-radius: 0.25rem;
    font-family: 'Courier New', monospace;
    font-size: 0.8125rem;
  }

  .validate-button {
    width: 100%;
    padding: 1rem;
    background: var(--primary-color, #00a67e);
    color: white;
    border: none;
    border-radius: 0.5rem;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.2s ease;
  }

  .validate-button:hover:not(:disabled) {
    background: var(--primary-hover, #008f6e);
  }

  .validate-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Dataset Review */
  .loading-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    padding: 3rem;
  }

  .spinner {
    width: 3rem;
    height: 3rem;
    border: 3px solid var(--border-color, #333);
    border-top-color: var(--primary-color, #00a67e);
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 1rem;
    margin-bottom: 2rem;
  }

  .stat-card {
    background: var(--bg-secondary, #1a1a1a);
    border: 1px solid var(--border-color, #333);
    border-radius: 0.5rem;
    padding: 1.5rem;
    text-align: center;
  }

  .stat-value {
    font-size: 2rem;
    font-weight: bold;
    color: var(--primary-color, #00a67e);
  }

  .stat-label {
    font-size: 0.875rem;
    color: var(--text-secondary, #888);
    margin-top: 0.5rem;
  }

  .breakdown-section {
    margin-bottom: 2rem;
  }

  .breakdown-section h4 {
    font-size: 1.125rem;
    margin-bottom: 1rem;
  }

  .breakdown-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .breakdown-item {
    display: flex;
    justify-content: space-between;
    padding: 0.75rem;
    background: var(--bg-secondary, #1a1a1a);
    border-radius: 0.5rem;
  }

  .breakdown-label {
    text-transform: capitalize;
  }

  .breakdown-value {
    font-weight: 600;
    color: var(--primary-color, #00a67e);
  }

  .curation-options {
    margin-top: 2rem;
  }

  .curation-options h4 {
    font-size: 1.125rem;
    margin-bottom: 1rem;
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    cursor: pointer;
    font-size: 0.875rem;
  }

  .checkbox-label input[type="checkbox"] {
    width: 1.25rem;
    height: 1.25rem;
    cursor: pointer;
  }

  .advanced-curation {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
    margin-top: 1rem;
    padding-left: 2rem;
  }

  /* Training Config */
  .range-value {
    display: inline-block;
    margin-left: 1rem;
    font-weight: 600;
    color: var(--primary-color, #00a67e);
  }

  .advanced-config {
    margin-top: 2rem;
    border-top: 1px solid var(--border-color, #333);
    padding-top: 1rem;
  }

  .advanced-config summary {
    cursor: pointer;
    font-weight: 600;
    padding: 0.5rem 0;
  }

  .advanced-fields {
    margin-top: 1rem;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
  }

  /* Toggle Switches */
  .toggle-group {
    border-top: 1px solid var(--border-color, #333);
    padding-top: 1rem;
    margin-top: 1rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .section-label {
    font-weight: 600;
    font-size: 0.95rem;
    color: var(--text-primary, #fff);
    margin-bottom: 0.25rem;
    display: block;
  }

  .toggle-item {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .toggle-container {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    cursor: pointer;
    user-select: none;
  }

  .toggle-container input[type="checkbox"] {
    display: none;
  }

  .toggle-slider {
    position: relative;
    width: 44px;
    height: 24px;
    background: var(--bg-tertiary, #2a2a2a);
    border-radius: 12px;
    transition: background 0.2s ease;
    flex-shrink: 0;
  }

  .toggle-slider::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 20px;
    height: 20px;
    background: white;
    border-radius: 50%;
    transition: transform 0.2s ease;
  }

  .toggle-container input[type="checkbox"]:checked + .toggle-slider {
    background: var(--primary-color, #00a67e);
  }

  .toggle-container input[type="checkbox"]:checked + .toggle-slider::after {
    transform: translateX(20px);
  }

  .toggle-container input[type="checkbox"]:disabled + .toggle-slider {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .toggle-container input[type="checkbox"]:disabled + .toggle-slider.disabled {
    background: var(--bg-tertiary, #2a2a2a);
  }

  .toggle-label {
    font-size: 0.95rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .toggle-description {
    display: block;
    margin-left: 0;
    padding-left: 52px;
    font-size: 0.85rem;
    color: var(--text-secondary, #888);
    line-height: 1.4;
  }

  .warning-badge,
  .info-badge,
  .success-badge {
    font-size: 0.75rem;
    padding: 0.15rem 0.4rem;
    border-radius: 0.25rem;
    font-weight: 600;
  }

  .warning-badge {
    background: rgba(255, 193, 7, 0.2);
    color: #ffc107;
  }

  .info-badge {
    background: rgba(33, 150, 243, 0.2);
    color: #2196f3;
  }

  .success-badge {
    background: rgba(76, 175, 80, 0.2);
    color: #4caf50;
  }

  /* Launch Training */
  .confirmation-dialog {
    max-width: 600px;
    margin: 0 auto;
    background: var(--bg-secondary, #1a1a1a);
    border: 2px solid var(--primary-color, #00a67e);
    border-radius: 1rem;
    padding: 2rem;
  }

  .confirmation-dialog h3 {
    font-size: 1.5rem;
    text-align: center;
    margin-bottom: 1.5rem;
  }

  .training-summary {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    margin-bottom: 2rem;
  }

  .summary-item {
    display: flex;
    justify-content: space-between;
    padding: 0.75rem;
    background: var(--bg-tertiary, #111);
    border-radius: 0.5rem;
  }

  .summary-label {
    font-weight: 600;
  }

  .summary-value {
    color: var(--text-secondary, #888);
  }

  .warning-text {
    color: #ffc107;
    font-weight: 600;
  }

  .launch-actions {
    display: flex;
    gap: 1rem;
  }

  .launch-button,
  .cancel-button {
    flex: 1;
    padding: 1rem;
    border: none;
    border-radius: 0.5rem;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .launch-button {
    background: var(--primary-color, #00a67e);
    color: white;
  }

  .launch-button:hover:not(:disabled) {
    background: var(--primary-hover, #008f6e);
    transform: translateY(-1px);
  }

  .launch-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .cancel-button {
    background: var(--bg-tertiary, #111);
    color: var(--text-primary, #fff);
    border: 1px solid var(--border-color, #333);
  }

  .cancel-button:hover {
    background: var(--bg-secondary, #1a1a1a);
  }

  /* Navigation */
  .wizard-navigation {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    padding-top: 2rem;
    border-top: 1px solid var(--border-color, #333);
  }

  .nav-button {
    padding: 0.75rem 2rem;
    border: none;
    border-radius: 0.5rem;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .nav-button.primary {
    background: var(--primary-color, #00a67e);
    color: white;
  }

  .nav-button.primary:hover:not(:disabled) {
    background: var(--primary-hover, #008f6e);
  }

  .nav-button.secondary {
    background: var(--bg-tertiary, #111);
    color: var(--text-primary, #fff);
    border: 1px solid var(--border-color, #333);
  }

  .nav-button.secondary:hover:not(:disabled) {
    background: var(--bg-secondary, #1a1a1a);
  }

  .nav-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Training Monitor */
  .training-monitor {
    width: 100%;
  }

  .monitor-status {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem;
    background: var(--bg-secondary, #1a1a1a);
    border-radius: 0.5rem;
    margin-bottom: 1.5rem;
  }

  .status-badge {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem 1rem;
    border-radius: 0.375rem;
    font-weight: 600;
  }

  .status-badge.running {
    background: rgba(0, 166, 126, 0.1);
    color: #00a67e;
    border: 1px solid rgba(0, 166, 126, 0.3);
  }

  .status-badge.complete {
    background: rgba(76, 175, 80, 0.1);
    color: #4caf50;
    border: 1px solid rgba(76, 175, 80, 0.3);
  }

  .status-badge.idle {
    background: rgba(158, 158, 158, 0.1);
    color: #888;
    border: 1px solid rgba(158, 158, 158, 0.3);
  }

  .spinner-small {
    width: 1rem;
    height: 1rem;
    border: 2px solid rgba(0, 166, 126, 0.2);
    border-top-color: #00a67e;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .btn-danger-small, .btn-primary-small {
    padding: 0.5rem 1rem;
    border: none;
    border-radius: 0.375rem;
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .btn-danger-small {
    background: #dc3545;
    color: white;
  }

  .btn-danger-small:hover:not(:disabled) {
    background: #c82333;
  }

  .btn-primary-small {
    background: var(--primary-color, #00a67e);
    color: white;
  }

  .btn-primary-small:hover:not(:disabled) {
    background: var(--primary-hover, #008f6e);
  }

  .btn-secondary-small {
    padding: 0.5rem 1rem;
    border: 1px solid var(--primary-color, #00a67e);
    background: transparent;
    color: var(--primary-color, #00a67e);
    border-radius: 0.375rem;
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .btn-secondary-small:hover:not(:disabled) {
    background: rgba(0, 166, 126, 0.1);
  }

  .btn-secondary-small:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-tertiary-small {
    padding: 0.5rem 1rem;
    border: 1px solid var(--border-color, #333);
    background: var(--bg-tertiary, #111);
    color: var(--text-secondary, #888);
    border-radius: 0.375rem;
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .btn-tertiary-small:hover:not(:disabled) {
    background: var(--bg-secondary, #1a1a1a);
    color: var(--text-primary, #fff);
  }

  .post-training-actions {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .success-message {
    margin-top: 1rem;
    padding: 0.75rem 1rem;
    background: rgba(76, 175, 80, 0.1);
    border: 1px solid rgba(76, 175, 80, 0.3);
    border-radius: 0.5rem;
    color: #4caf50;
    font-size: 0.875rem;
  }

  .monitor-content {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .logs-container {
    background: var(--bg-secondary, #1a1a1a);
    border: 1px solid var(--border-color, #333);
    border-radius: 0.5rem;
    overflow: hidden;
  }

  .logs-container h4 {
    padding: 0.75rem 1rem;
    background: var(--bg-tertiary, #111);
    border-bottom: 1px solid var(--border-color, #333);
    margin: 0;
    font-size: 0.875rem;
    font-weight: 600;
  }

  .logs-scroll {
    height: 300px;
    overflow-y: auto;
    padding: 1rem;
    font-family: 'Courier New', monospace;
    font-size: 0.8125rem;
  }

  .console-output {
    background: #0a0a0a;
  }

  .events-output {
    background: var(--bg-tertiary, #111);
  }

  .log-empty {
    color: var(--text-secondary, #888);
    text-align: center;
    padding: 2rem;
    font-style: italic;
  }

  .console-line {
    color: #0f0;
    margin-bottom: 0.25rem;
    word-wrap: break-word;
  }

  .console-line.progress-highlight {
    color: #00d4ff;
    font-weight: 600;
    background: rgba(0, 212, 255, 0.1);
    padding: 0.25rem 0.5rem;
    border-left: 3px solid #00d4ff;
    margin-left: -0.5rem;
  }

  .log-entry {
    display: flex;
    gap: 0.75rem;
    margin-bottom: 0.5rem;
    color: var(--text-secondary, #888);
  }

  .log-timestamp {
    color: var(--text-tertiary, #666);
    flex-shrink: 0;
  }

  .log-event {
    color: var(--primary-color, #00a67e);
    font-weight: 600;
    text-transform: capitalize;
  }

  .log-details {
    color: var(--text-secondary, #888);
    font-size: 0.75rem;
  }

  .progress-footer {
    padding: 1rem;
    background: rgba(0, 166, 126, 0.05);
    border: 1px solid rgba(0, 166, 126, 0.2);
    border-radius: 0.5rem;
  }

  .help-text {
    margin: 0;
    color: var(--text-secondary, #888);
    font-size: 0.875rem;
  }

  /* Progress Banner */
  .progress-banner {
    background: linear-gradient(135deg, rgba(0, 166, 126, 0.15) 0%, rgba(0, 212, 255, 0.15) 100%);
    border: 2px solid var(--primary-color, #00a67e);
    border-radius: 0.75rem;
    padding: 1.5rem;
    margin-bottom: 1.5rem;
    box-shadow: 0 4px 12px rgba(0, 166, 126, 0.2);
  }

  .progress-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
  }

  .progress-stage {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .stage-icon {
    font-size: 1.5rem;
    animation: spin-slow 3s linear infinite;
  }

  @keyframes spin-slow {
    to { transform: rotate(360deg); }
  }

  .stage-name {
    font-size: 1.125rem;
    font-weight: 700;
    color: var(--primary-color, #00a67e);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .progress-stats {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .progress-percentage {
    font-size: 1.5rem;
    font-weight: 700;
    color: #00d4ff;
    text-shadow: 0 0 10px rgba(0, 212, 255, 0.5);
  }

  .progress-attempts {
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--text-secondary, #aaa);
    background: rgba(0, 0, 0, 0.3);
    padding: 0.375rem 0.75rem;
    border-radius: 0.5rem;
  }

  .progress-message {
    font-size: 0.95rem;
    color: var(--text-primary, #fff);
    margin-bottom: 1rem;
    padding: 0.5rem 0.75rem;
    background: rgba(0, 0, 0, 0.2);
    border-radius: 0.5rem;
    font-style: italic;
  }

  .progress-bar-container {
    width: 100%;
    height: 8px;
    background: rgba(0, 0, 0, 0.3);
    border-radius: 4px;
    overflow: hidden;
  }

  .progress-bar-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--primary-color, #00a67e) 0%, #00d4ff 100%);
    border-radius: 4px;
    transition: width 0.3s ease;
    box-shadow: 0 0 10px rgba(0, 212, 255, 0.5);
  }

  /* Terminal Command Section */
  .terminal-command-section {
    margin-top: 1.5rem;
    border: 1px solid var(--border-color, #333);
    border-radius: 0.5rem;
    overflow: hidden;
  }

  .terminal-command-section summary {
    padding: 1rem;
    background: var(--bg-tertiary, #111);
    cursor: pointer;
    font-weight: 600;
    color: var(--text-secondary, #888);
  }

  .terminal-command-section summary:hover {
    background: var(--bg-secondary, #1a1a1a);
    color: var(--text-primary, #fff);
  }

  .terminal-command-content {
    padding: 1rem;
    background: var(--bg-secondary, #1a1a1a);
  }

  .terminal-description {
    font-size: 0.875rem;
    color: var(--text-secondary, #888);
    margin: 0 0 1rem 0;
  }

  .command-box {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    background: #0a0a0a;
    border: 1px solid var(--border-color, #333);
    border-radius: 0.5rem;
    padding: 0.75rem 1rem;
    margin-bottom: 0.75rem;
  }

  .command-text {
    flex: 1;
    font-family: 'Courier New', monospace;
    font-size: 0.8125rem;
    color: #0f0;
    word-break: break-all;
  }

  .copy-button {
    padding: 0.375rem 0.75rem;
    background: var(--primary-color, #00a67e);
    color: white;
    border: none;
    border-radius: 0.25rem;
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.2s ease;
  }

  .copy-button:hover {
    background: var(--primary-hover, #008f6e);
  }

  .terminal-note {
    font-size: 0.8125rem;
    color: var(--text-secondary, #888);
    margin: 1rem 0 0 0;
    padding: 0.75rem;
    background: rgba(0, 166, 126, 0.1);
    border-radius: 0.375rem;
  }

  .command-section-title {
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--text-primary, #fff);
    margin: 1.25rem 0 0.25rem 0;
    padding: 0;
  }

  .command-section-title:first-of-type {
    margin-top: 0;
  }

  .command-description {
    font-size: 0.8125rem;
    color: var(--text-secondary, #888);
    margin: 0 0 0.5rem 0;
  }
</style>
