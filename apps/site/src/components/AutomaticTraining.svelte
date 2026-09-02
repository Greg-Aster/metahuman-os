<script lang="ts">
  import { onMount } from 'svelte'

  import { apiFetch } from '../lib/client/api-config'
  import { DEFAULT_TRAINING_MODEL, DEFAULT_VLLM_TRAINING_MODEL } from '../lib/client/model-defaults'
  import TrainingDataControls from './TrainingDataControls.svelte'

  type TrainingMethod = 'local-lora' | 'remote-lora' | 'fine-tune'
  type TrainingTarget = 'ollama' | 'vllm'

  interface AutomaticTrainingConfig {
    version: 1
    enabled: boolean
    method: TrainingMethod
    trainingTarget: TrainingTarget
    minimumTrainableSamples: number
    minimumNewSamples: number
    cooldownHours: number
    baseModel: string
    epochs: number
    maxSamples: number | null
    useRollingWindow: boolean
    recentDays: number
    olderSamples: number
    loraRank: number
    loraAlpha: number
    learningRate: number
    batchSize: number
    gradientAccumulationSteps: number
    maxSequenceLength: number
    quantization: string
    runpodTemplateId: string
    runpodGpuType: string
    enablePreprocessing: boolean
    enableS3Upload: boolean
    updatedAt?: string
  }

  interface AutomaticTrainingStatus {
    config: AutomaticTrainingConfig
    readiness: {
      eligible: boolean
      blockers: string[]
      trainableSamples: number
      newSamplesSinceLastRun: number
      lastCompletedAt: string | null
      cooldownEndsAt: string | null
      runningProcess: { name: string; pid: number } | null
      remoteCredentialsConfigured: boolean
    }
    dataset: {
      organizedMemories: number
      pendingOrganization: number
      curatedMemories: number
      pendingCuration: number
      validCuratedRecords: number
      invalidCuratedRecords: number
      trainableSamples: number
    }
    integration: {
      owner: 'sleep-workflow'
      triggerInstalled: false
      message: string
    }
  }

  interface SystemCapabilities {
    hasLocalGPU: boolean
    gpuModel: string | null
    vramGB: number | null
    hasUnsloth: boolean
    hasRunpodKey: boolean
    hasPreviousModel: boolean
    hasS3Configured: boolean
  }

  const defaults: AutomaticTrainingConfig = {
    version: 1,
    enabled: false,
    method: 'local-lora',
    trainingTarget: 'ollama',
    minimumTrainableSamples: 250,
    minimumNewSamples: 50,
    cooldownHours: 168,
    baseModel: DEFAULT_TRAINING_MODEL,
    epochs: 5,
    maxSamples: 3000,
    useRollingWindow: false,
    recentDays: 30,
    olderSamples: 3000,
    loraRank: 16,
    loraAlpha: 32,
    learningRate: 0.0003,
    batchSize: 1,
    gradientAccumulationSteps: 16,
    maxSequenceLength: 2048,
    quantization: 'Q4_K_M',
    runpodTemplateId: 'metahuman-runpod-trainer',
    runpodGpuType: 'NVIDIA H100 PCIe',
    enablePreprocessing: true,
    enableS3Upload: false,
  }

  const defaultMemoryPercentages: Record<string, number> = {
    conversation: 40,
    observation: 25,
    therapy_session: 15,
    reflection: 5,
    reflection_summary: 3,
    inner_dialogue: 3,
    dream: 3,
    curiosity_question: 3,
    decision: 2,
    journal: 1,
    summary: 0,
  }

  let status: AutomaticTrainingStatus | null = null
  let config: AutomaticTrainingConfig = { ...defaults }
  let capabilities: SystemCapabilities | null = null
  let includePersona = true
  let memoryPercentages = { ...defaultMemoryPercentages }
  let useAllSamples = false
  let lastSampleCap = 3000

  let loading = true
  let saving = false
  let dataLoading = true
  let dataSaving = false
  let error = ''
  let capabilityError = ''
  let dataError = ''
  let savedMessage = ''
  let dataSavedMessage = ''

  $: usesLoRA = config.method === 'local-lora' || config.method === 'remote-lora'
  $: usesRunpod = config.method === 'remote-lora' || config.method === 'fine-tune'
  $: effectiveBatchSize = config.batchSize * config.gradientAccumulationSteps

  function applyStatus(next: AutomaticTrainingStatus) {
    status = next
    config = { ...next.config }
    useAllSamples = next.config.maxSamples === null
    if (next.config.maxSamples !== null) lastSampleCap = next.config.maxSamples
  }

  function handleMethodChange() {
    if (config.trainingTarget === 'vllm' && config.method !== 'remote-lora') {
      config = { ...config, trainingTarget: 'ollama' }
    }
    if (config.method !== 'fine-tune' && (config.loraRank < 1 || config.loraAlpha < 1)) {
      config = { ...config, loraRank: 16, loraAlpha: 32 }
    }
    savedMessage = ''
  }

  function handleAllSamples(event: Event) {
    const checked = (event.target as HTMLInputElement).checked
    useAllSamples = checked
    if (checked) {
      if (config.maxSamples !== null) lastSampleCap = config.maxSamples
      config = { ...config, maxSamples: null }
    } else {
      config = { ...config, maxSamples: lastSampleCap }
    }
  }

  function applyRecommendedPreset() {
    if (config.method === 'fine-tune') {
      config = {
        ...config,
        trainingTarget: 'ollama',
        baseModel: DEFAULT_VLLM_TRAINING_MODEL,
        epochs: 2,
        maxSamples: 5000,
        useRollingWindow: true,
        recentDays: 30,
        olderSamples: 5000,
        loraRank: 0,
        loraAlpha: 0,
        learningRate: 0.00002,
        batchSize: 4,
        gradientAccumulationSteps: 8,
        maxSequenceLength: 2048,
        quantization: 'Q4_K_M',
      }
      lastSampleCap = 5000
    } else {
      const vllm = config.trainingTarget === 'vllm'
      config = {
        ...config,
        baseModel: vllm ? DEFAULT_VLLM_TRAINING_MODEL : DEFAULT_TRAINING_MODEL,
        epochs: 5,
        maxSamples: 3000,
        useRollingWindow: false,
        recentDays: 30,
        olderSamples: 3000,
        loraRank: 16,
        loraAlpha: 32,
        learningRate: 0.0003,
        batchSize: 1,
        gradientAccumulationSteps: 16,
        maxSequenceLength: 2048,
        quantization: 'Q4_K_M',
      }
      lastSampleCap = 3000
    }
    useAllSamples = false
    savedMessage = ''
  }

  async function loadStatus() {
    loading = true
    error = ''
    try {
      const response = await apiFetch('/api/training/automatic')
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Failed to load automatic training settings')
      applyStatus(body)
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Failed to load automatic training settings'
    } finally {
      loading = false
    }
  }

  async function loadCapabilities() {
    capabilityError = ''
    try {
      const response = await apiFetch('/api/system/gpu-info')
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Failed to inspect training capabilities')
      capabilities = {
        hasLocalGPU: body.hasLocalGPU === true,
        gpuModel: typeof body.gpuModel === 'string' ? body.gpuModel : null,
        vramGB: typeof body.vramGB === 'number' ? body.vramGB : null,
        hasUnsloth: body.hasUnsloth === true,
        hasRunpodKey: body.hasRunpodKey === true,
        hasPreviousModel: body.hasPreviousModel === true,
        hasS3Configured: body.hasS3Configured === true,
      }
    } catch (cause) {
      capabilityError = cause instanceof Error ? cause.message : 'Failed to inspect training capabilities'
    }
  }

  async function loadTrainingDataConfig() {
    dataLoading = true
    dataError = ''
    try {
      const response = await apiFetch('/api/training-data')
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Failed to load training-data composition')
      if (typeof body.config?.collection?.includePersona === 'boolean') {
        includePersona = body.config.collection.includePersona
      }
      if (body.config?.memoryTypes?.percentages) {
        memoryPercentages = { ...defaultMemoryPercentages, ...body.config.memoryTypes.percentages }
      }
    } catch (cause) {
      dataError = cause instanceof Error ? cause.message : 'Failed to load training-data composition'
    } finally {
      dataLoading = false
    }
  }

  async function saveSettings() {
    saving = true
    error = ''
    savedMessage = ''
    try {
      const response = await apiFetch('/api/training/automatic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Failed to save automatic training settings')
      applyStatus(body)
      savedMessage = 'Automatic admission and launch settings saved.'
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Failed to save automatic training settings'
    } finally {
      saving = false
    }
  }

  async function saveTrainingDataConfig() {
    dataSaving = true
    dataError = ''
    dataSavedMessage = ''
    try {
      const response = await apiFetch('/api/training-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          collection: { includePersona },
          memoryTypes: { percentages: memoryPercentages },
        }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Failed to save training-data composition')
      dataSavedMessage = 'Training-data composition saved for manual and automatic runs.'
    } catch (cause) {
      dataError = cause instanceof Error ? cause.message : 'Failed to save training-data composition'
    } finally {
      dataSaving = false
    }
  }

  function handlePersonaChange(event: CustomEvent<boolean>) {
    includePersona = event.detail
    dataSavedMessage = ''
  }

  function handlePercentagesChange(event: CustomEvent<Record<string, number>>) {
    memoryPercentages = event.detail
    dataSavedMessage = ''
  }

  onMount(() => {
    void loadStatus()
    void loadCapabilities()
    void loadTrainingDataConfig()
  })
</script>

<div class="mx-auto max-w-[1040px] p-6 sm:p-8">
  <div class="mb-6">
    <h3 class="m-0 text-2xl font-bold text-gray-100">Automatic Training</h3>
    <p class="mt-2 text-sm leading-relaxed text-gray-400">
      Configure both admission policy and the complete training launch. Automatic runs use the same refined
      dataset, hyperparameter contract, and trainer boundary as the manual Training Wizard.
    </p>
  </div>

  {#if loading}
    <div class="flex items-center justify-center p-12 text-sm text-gray-400 animate-pulse">
      Loading automatic training settings...
    </div>
  {:else}
    {#if error}
      <div class="banner banner-error mb-5">{error}</div>
    {/if}
    {#if savedMessage}
      <div class="banner banner-success mb-5">{savedMessage}</div>
    {/if}

    <div class="mb-6 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
      <div class="font-semibold">Sleep-cycle trigger is not installed yet</div>
      <div class="mt-1 text-amber-100/80">
        These settings are persisted and launch-ready, but enabling the policy alone will not start training.
        Sleep admission remains the next implementation stage.
      </div>
    </div>

    {#if status}
      <div class="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div class="stat-card">
          <div class="stat-value {status.readiness.eligible ? 'text-emerald-500' : 'text-amber-400'}">
            {status.readiness.eligible ? 'Eligible' : 'Blocked'}
          </div>
          <div class="stat-label">Policy readiness</div>
        </div>
        <div class="stat-card">
          <div class="stat-value text-emerald-500">{status.readiness.trainableSamples.toLocaleString()}</div>
          <div class="stat-label">Validated samples</div>
        </div>
        <div class="stat-card">
          <div class="stat-value text-emerald-500">{status.readiness.newSamplesSinceLastRun.toLocaleString()}</div>
          <div class="stat-label">New since last run</div>
        </div>
        <div class="stat-card">
          <div class="stat-value {status.dataset.invalidCuratedRecords === 0 ? 'text-emerald-500' : 'text-red-400'}">
            {status.dataset.invalidCuratedRecords.toLocaleString()}
          </div>
          <div class="stat-label">Invalid curated records</div>
        </div>
      </div>

      {#if status.readiness.blockers.length > 0}
        <div class="mb-6 rounded-xl border border-gray-700 bg-gray-900 p-4">
          <h4 class="m-0 mb-3 text-sm font-semibold text-gray-100">Current admission blockers</h4>
          <ul class="m-0 space-y-2 pl-5 text-sm text-gray-400">
            {#each status.readiness.blockers as blocker}
              <li>{blocker}</li>
            {/each}
          </ul>
        </div>
      {/if}
    {/if}

    <form on:submit|preventDefault={saveSettings} class="space-y-5">
      <section class="rounded-xl border border-gray-700 bg-gray-900/70 p-5 sm:p-6">
        <label class="flex cursor-pointer items-start justify-between gap-6">
          <span>
            <span class="block font-semibold text-gray-100">Enable automatic training policy</span>
            <span class="mt-1 block text-sm text-gray-500">The future Sleep trigger will honor this switch and every gate below.</span>
          </span>
          <input type="checkbox" class="mt-1 h-5 w-5 accent-emerald-600" bind:checked={config.enabled} />
        </label>
      </section>

      <section class="rounded-xl border border-gray-700 bg-gray-900/70 p-5 sm:p-6">
        <div class="mb-5">
          <h4 class="m-0 text-lg font-semibold text-gray-100">Admission policy</h4>
          <p class="mt-1 text-sm text-gray-500">All gates must pass before an automatic run can be admitted.</p>
        </div>
        <div class="grid grid-cols-1 gap-5 sm:grid-cols-3">
          <div class="form-group">
            <label class="form-label" for="minimum-samples">Minimum validated samples</label>
            <input id="minimum-samples" class="input-field" type="number" min="1" max="1000000" bind:value={config.minimumTrainableSamples} />
            <small class="mt-2 block text-sm text-gray-500">Minimum complete refined dataset size.</small>
          </div>
          <div class="form-group">
            <label class="form-label" for="minimum-new-samples">Minimum new samples</label>
            <input id="minimum-new-samples" class="input-field" type="number" min="1" max="1000000" bind:value={config.minimumNewSamples} />
            <small class="mt-2 block text-sm text-gray-500">Required after the latest completed run.</small>
          </div>
          <div class="form-group">
            <label class="form-label" for="cooldown-hours">Cooldown (hours)</label>
            <input id="cooldown-hours" class="input-field" type="number" min="1" max="8760" bind:value={config.cooldownHours} />
            <small class="mt-2 block text-sm text-gray-500">168 hours is one week.</small>
          </div>
        </div>
      </section>

      <section class="rounded-xl border border-gray-700 bg-gray-900/70 p-5 sm:p-6">
        <div class="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h4 class="m-0 text-lg font-semibold text-gray-100">Method and deployment</h4>
            <p class="mt-1 text-sm text-gray-500">Choose where training runs and which artifact format it produces.</p>
          </div>
          <button type="button" class="btn-secondary" on:click={applyRecommendedPreset}>Apply recommended preset</button>
        </div>

        <div class="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div class="form-group">
            <label class="form-label" for="automatic-method">Training method</label>
            <select id="automatic-method" class="select-field w-full" bind:value={config.method} on:change={handleMethodChange}>
              <option value="local-lora">Local LoRA</option>
              <option value="remote-lora">Remote LoRA (RunPod)</option>
              <option value="fine-tune">Full fine-tune (RunPod)</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" for="automatic-target">Output target</label>
            <select id="automatic-target" class="select-field w-full" bind:value={config.trainingTarget}>
              <option value="ollama">Ollama / GGUF</option>
              <option value="vllm" disabled={config.method !== 'remote-lora'}>vLLM / safetensors adapter</option>
            </select>
          </div>
        </div>

        <div class="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div class="rounded-lg border border-gray-700 bg-gray-950/50 p-3 text-sm">
            <div class="font-semibold text-gray-200">Local accelerator</div>
            <div class="mt-1 text-gray-500">
              {#if capabilities?.hasLocalGPU}
                {capabilities.gpuModel || 'NVIDIA GPU'}{capabilities.vramGB ? ` · ${capabilities.vramGB} GB` : ''}
              {:else}
                Not detected
              {/if}
            </div>
          </div>
          <div class="rounded-lg border border-gray-700 bg-gray-950/50 p-3 text-sm">
            <div class="font-semibold text-gray-200">Local trainer</div>
            <div class="mt-1 {capabilities?.hasUnsloth ? 'text-emerald-400' : 'text-gray-500'}">
              {capabilities?.hasUnsloth ? 'Unsloth available' : 'Unsloth not detected'}
            </div>
          </div>
          <div class="rounded-lg border border-gray-700 bg-gray-950/50 p-3 text-sm">
            <div class="font-semibold text-gray-200">RunPod credentials</div>
            <div class="mt-1 {status?.readiness.remoteCredentialsConfigured ? 'text-emerald-400' : 'text-gray-500'}">
              {status?.readiness.remoteCredentialsConfigured ? 'Configured' : 'Not configured'}
            </div>
          </div>
        </div>

        {#if capabilityError}
          <div class="mt-4 text-sm text-amber-300">Capability inspection: {capabilityError}</div>
        {/if}
        {#if config.method === 'local-lora' && capabilities && (!capabilities.hasLocalGPU || !capabilities.hasUnsloth)}
          <div class="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
            Local LoRA needs a supported NVIDIA GPU and the Unsloth environment. The policy can be saved, but this machine is not currently launch-ready.
          </div>
        {/if}
        {#if usesRunpod && status && !status.readiness.remoteCredentialsConfigured}
          <div class="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
            Configure and validate the RunPod API key in the manual Training Wizard. Automatic settings intentionally do not copy or expose that secret.
          </div>
        {/if}

        {#if usesRunpod}
          <div class="mt-5 grid grid-cols-1 gap-5 border-t border-gray-700 pt-5 sm:grid-cols-2">
            <div class="form-group">
              <label class="form-label" for="runpod-template">RunPod template ID</label>
              <input id="runpod-template" class="input-field" type="text" maxlength="300" bind:value={config.runpodTemplateId} />
            </div>
            <div class="form-group">
              <label class="form-label" for="runpod-gpu">RunPod GPU type</label>
              <input id="runpod-gpu" class="input-field" type="text" maxlength="300" list="runpod-gpus" bind:value={config.runpodGpuType} />
              <datalist id="runpod-gpus">
                <option value="NVIDIA GeForce RTX 5090"></option>
                <option value="NVIDIA GeForce RTX 4090"></option>
                <option value="NVIDIA A100-PCIE-40GB"></option>
                <option value="NVIDIA A100 80GB PCIe"></option>
                <option value="NVIDIA H100 PCIe"></option>
                <option value="NVIDIA H100 80GB HBM3"></option>
              </datalist>
            </div>
          </div>
        {/if}
      </section>

      <section class="rounded-xl border border-gray-700 bg-gray-900/70 p-5 sm:p-6">
        <div class="mb-5">
          <h4 class="m-0 text-lg font-semibold text-gray-100">Model and optimization</h4>
          <p class="mt-1 text-sm text-gray-500">These values are passed to the selected trainer; they are no longer display-only settings.</p>
        </div>

        <div class="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div class="form-group sm:col-span-2">
            <label class="form-label" for="automatic-base-model">Base model</label>
            <input id="automatic-base-model" class="input-field" type="text" maxlength="300" list="training-models" bind:value={config.baseModel} />
            <datalist id="training-models">
              <option value={DEFAULT_TRAINING_MODEL}>Maintained Ollama/GGUF training base</option>
              <option value={DEFAULT_VLLM_TRAINING_MODEL}>Maintained vLLM/full-fine-tune base</option>
            </datalist>
            <small class="mt-2 block text-sm text-gray-500">A custom Hugging Face model identifier is allowed when it is compatible with the selected trainer.</small>
          </div>
          <div class="form-group">
            <label class="form-label" for="automatic-epochs">Epochs</label>
            <input id="automatic-epochs" class="input-field" type="number" min="1" max="50" bind:value={config.epochs} />
          </div>
          <div class="form-group">
            <label class="form-label" for="automatic-learning-rate">Learning rate</label>
            <input id="automatic-learning-rate" class="input-field" type="number" min="0.000000001" max="1" step="any" bind:value={config.learningRate} />
            <small class="mt-2 block text-sm text-gray-500">Typical: 0.0003 LoRA; 0.00002 full fine-tune.</small>
          </div>

          {#if usesLoRA}
            <div class="form-group">
              <label class="form-label" for="automatic-lora-rank">LoRA rank</label>
              <input id="automatic-lora-rank" class="input-field" type="number" min="1" max="1024" bind:value={config.loraRank} />
            </div>
            <div class="form-group">
              <label class="form-label" for="automatic-lora-alpha">LoRA alpha</label>
              <input id="automatic-lora-alpha" class="input-field" type="number" min="1" max="4096" bind:value={config.loraAlpha} />
            </div>
          {/if}

          <div class="form-group">
            <label class="form-label" for="automatic-batch-size">Per-device batch size</label>
            <input id="automatic-batch-size" class="input-field" type="number" min="1" max="128" bind:value={config.batchSize} />
          </div>
          <div class="form-group">
            <label class="form-label" for="automatic-gradient-steps">Gradient accumulation steps</label>
            <input id="automatic-gradient-steps" class="input-field" type="number" min="1" max="1024" bind:value={config.gradientAccumulationSteps} />
          </div>
          <div class="form-group">
            <label class="form-label" for="automatic-context">Maximum sequence length</label>
            <input id="automatic-context" class="input-field" type="number" min="128" max="262144" step="128" bind:value={config.maxSequenceLength} />
          </div>
          <div class="form-group">
            <label class="form-label" for="automatic-quantization">GGUF quantization</label>
            <input id="automatic-quantization" class="input-field" type="text" maxlength="32" list="quantization-options" bind:value={config.quantization} disabled={config.trainingTarget === 'vllm'} />
            <datalist id="quantization-options">
              <option value="Q4_K_M"></option>
              <option value="Q4_K_S"></option>
              <option value="Q5_K_M"></option>
              <option value="Q5_K_S"></option>
              <option value="Q6_K"></option>
              <option value="Q8_0"></option>
            </datalist>
            <small class="mt-2 block text-sm text-gray-500">vLLM keeps safetensors adapters and skips GGUF conversion.</small>
          </div>
        </div>

        <div class="mt-5 rounded-lg border border-gray-700 bg-gray-950/50 p-3 text-sm text-gray-400">
          Effective batch size: <strong class="text-gray-200">{effectiveBatchSize.toLocaleString()}</strong>
          ({config.batchSize} × {config.gradientAccumulationSteps})
        </div>
      </section>

      <section class="rounded-xl border border-gray-700 bg-gray-900/70 p-5 sm:p-6">
        <div class="mb-5">
          <h4 class="m-0 text-lg font-semibold text-gray-100">Dataset size and history</h4>
          <p class="mt-1 text-sm text-gray-500">Control cost and decide how much older history a full fine-tune retains.</p>
        </div>

        <label class="mb-4 flex cursor-pointer items-center gap-3 text-sm text-gray-300">
          <input type="checkbox" class="h-4 w-4 accent-emerald-600" checked={useAllSamples} on:change={handleAllSamples} />
          <span>Use every validated sample after composition weighting</span>
        </label>
        {#if !useAllSamples}
          <div class="form-group max-w-md">
            <label class="form-label" for="maximum-samples">Maximum samples per run</label>
            <input id="maximum-samples" class="input-field" type="number" min="1" max="1000000" bind:value={config.maxSamples} />
            <small class="mt-2 block text-sm text-gray-500">Applied by both LoRA and full-fine-tune dataset builders.</small>
          </div>
        {/if}

        {#if config.method === 'fine-tune'}
          <div class="mt-5 border-t border-gray-700 pt-5">
            <label class="flex cursor-pointer items-start gap-3 text-sm text-gray-300">
              <input type="checkbox" class="mt-0.5 h-4 w-4 accent-emerald-600" bind:checked={config.useRollingWindow} />
              <span>
                <strong>Use a rolling history window</strong>
                <span class="mt-1 block text-gray-500">Keep all recent records and an evenly distributed sample of older history.</span>
              </span>
            </label>
            {#if config.useRollingWindow}
              <div class="mt-4 grid grid-cols-1 gap-5 pl-7 sm:grid-cols-2">
                <div class="form-group">
                  <label class="form-label" for="automatic-recent-days">Recent days kept in full</label>
                  <input id="automatic-recent-days" class="input-field" type="number" min="1" max="36500" bind:value={config.recentDays} />
                </div>
                <div class="form-group">
                  <label class="form-label" for="automatic-older-samples">Older history samples</label>
                  <input id="automatic-older-samples" class="input-field" type="number" min="0" max="1000000" bind:value={config.olderSamples} />
                </div>
              </div>
            {/if}
          </div>
        {/if}
      </section>

      <section class="rounded-xl border border-gray-700 bg-gray-900/70 p-5 sm:p-6">
        <div class="mb-4">
          <h4 class="m-0 text-lg font-semibold text-gray-100">Pipeline controls</h4>
          <p class="mt-1 text-sm text-gray-500">Control refinement and optional artifact transport for each automatic run.</p>
        </div>
        <div class="space-y-4">
          <label class="flex cursor-pointer items-start gap-3 text-sm text-gray-300">
            <input type="checkbox" class="mt-0.5 h-4 w-4 accent-emerald-600" bind:checked={config.enablePreprocessing} />
            <span>
              <strong>Run Organizer and Curator first</strong>
              <span class="mt-1 block text-gray-500">Drain the finite refinement stages before constructing the dataset.</span>
            </span>
          </label>
          <label class="flex cursor-pointer items-start gap-3 text-sm text-gray-300">
            <input type="checkbox" class="mt-0.5 h-4 w-4 accent-emerald-600" bind:checked={config.enableS3Upload} />
            <span>
              <strong>Enable S3 artifact upload</strong>
              <span class="mt-1 block text-gray-500">Use configured S3 transport when the selected runner supports it.</span>
            </span>
          </label>
        </div>
        {#if config.enableS3Upload && capabilities && !capabilities.hasS3Configured}
          <div class="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
            S3 upload is enabled in policy, but S3 credentials were not detected in this server process.
          </div>
        {/if}
      </section>

      <div class="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-gray-700 bg-gray-900/70 p-5">
        <button type="button" class="btn-secondary" on:click={() => { void loadStatus(); void loadCapabilities() }} disabled={saving}>
          Refresh readiness
        </button>
        <button type="submit" class="btn-primary" disabled={saving}>
          {saving ? 'Saving...' : 'Save automatic training settings'}
        </button>
      </div>
    </form>

    <section class="mt-6 rounded-xl border border-gray-700 bg-gray-900/70 p-5 sm:p-6">
      <div class="mb-5">
        <h4 class="m-0 text-lg font-semibold text-gray-100">Training-data composition</h4>
        <p class="mt-1 text-sm leading-relaxed text-gray-500">
          This is the shared dataset composition used by both the manual wizard and automatic runs. Primary user-authored
          memories remain fully represented; secondary model-generated memories are sampled as a percentage of primary data.
        </p>
      </div>

      {#if dataError}
        <div class="banner banner-error mb-4">{dataError}</div>
      {/if}
      {#if dataSavedMessage}
        <div class="banner banner-success mb-4">{dataSavedMessage}</div>
      {/if}

      {#if dataLoading}
        <div class="p-6 text-center text-sm text-gray-500 animate-pulse">Loading training-data composition...</div>
      {:else}
        <TrainingDataControls
          {includePersona}
          percentages={memoryPercentages}
          disabled={dataSaving}
          on:personaChange={handlePersonaChange}
          on:percentagesChange={handlePercentagesChange}
        />
        <div class="mt-5 flex justify-end">
          <button type="button" class="btn-primary" on:click={saveTrainingDataConfig} disabled={dataSaving}>
            {dataSaving ? 'Saving...' : 'Save dataset composition'}
          </button>
        </div>
      {/if}
    </section>
  {/if}
</div>
