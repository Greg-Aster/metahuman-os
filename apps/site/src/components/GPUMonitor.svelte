<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { apiFetch } from '../lib/client/api-config';

  interface GPUMemory {
    total: number;
    used: number;
    free: number;
    usedPercent: number;
    freePercent: number;
  }

  interface GPU {
    index: number;
    name: string;
    memory: GPUMemory;
    utilization: {
      gpu: number;
      memory: number;
    };
  }

  interface Process {
    pid: number;
    name: string;
    memory: number;
  }

  interface Recommendation {
    level: 'success' | 'info' | 'warning' | 'critical';
    message: string;
    action: string | null;
  }

  interface GPUStatus {
    available: boolean;
    error?: string;
    gpus?: GPU[];
    ollama?: {
      running: boolean;
      pid: number | null;
      vramLimit: string | null;
    };
    processes?: Process[];
    recommendations?: Recommendation[];
  }

  let status: GPUStatus | null = null;
  let loading = true;
  let error: string | null = null;
  let refreshInterval: ReturnType<typeof setInterval> | null = null;
  let configuringVRAM = false;
  let configOutput = '';
  let showConfigModal = false;

  function startPolling() {
    if (refreshInterval) return;
    console.log('[GPUMonitor] Starting polling (5s interval)');
    loadGPUStatus();
    refreshInterval = setInterval(loadGPUStatus, 5000);
  }

  function stopPolling() {
    if (refreshInterval) {
      console.log('[GPUMonitor] Stopping polling');
      clearInterval(refreshInterval);
      refreshInterval = null;
    }
  }

  function handleVisibilityChange() {
    if (document.hidden) {
      stopPolling();
    } else {
      startPolling();
    }
  }

  onMount(() => {
    // Only poll when component mounted AND tab visible
    if (!document.hidden) {
      startPolling();
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);
  });

  onDestroy(() => {
    stopPolling();
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  });

  async function loadGPUStatus() {
    try {
      const res = await apiFetch('/api/gpu-status');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      status = await res.json();
      error = null;
    } catch (err) {
      error = String(err);
      console.error('[GPUMonitor] Error loading GPU status:', err);
    } finally {
      loading = false;
    }
  }

  function getRecommendationClass(level: string): string {
    switch (level) {
      case 'success': return 'bg-green-500/10 dark:bg-green-500/15 border-l-green-500 dark:border-l-green-400';
      case 'info': return 'bg-blue-500/10 dark:bg-blue-500/15 border-l-blue-500 dark:border-l-blue-400';
      case 'warning': return 'bg-amber-500/10 dark:bg-amber-500/15 border-l-amber-500 dark:border-l-amber-400';
      case 'critical': return 'bg-red-500/10 dark:bg-red-500/15 border-l-red-500 dark:border-l-red-400';
      default: return '';
    }
  }

  function getRecommendationIcon(level: string): string {
    switch (level) {
      case 'success': return '✓';
      case 'info': return 'ℹ';
      case 'warning': return '⚠';
      case 'critical': return '⚠';
      default: return '';
    }
  }

  async function openConfigureVRAM() {
    showConfigModal = true;
    configuringVRAM = false;
    configOutput = '';
  }

  function closeConfigModal() {
    showConfigModal = false;
    configOutput = '';
  }

  async function runVRAMConfig() {
    configuringVRAM = true;
    configOutput = 'Running VRAM configuration...\n\n';

    try {
      // This would ideally be a WebSocket or SSE stream
      // For now, we'll just show instructions
      configOutput = `⚙️ VRAM Configuration Tool

To configure Ollama VRAM limits, please run this command in your terminal:

  ./bin/configure-ollama-vram

This will:
1. Detect your GPU's total VRAM
2. Recommend an allocation based on your GPU size
3. Create systemd override to limit Ollama VRAM usage
4. Optionally disable auto-pause in voice.json

After configuration, refresh this page to see the updated status.

For more information, see the Voice System documentation.
`;
    } finally {
      configuringVRAM = false;
    }
  }
</script>

<div class="flex flex-col gap-4">
  {#if loading}
    <div class="p-4 rounded-lg flex items-center gap-3 bg-violet-500/5 dark:bg-violet-400/10 text-gray-600 dark:text-gray-400">
      Loading GPU status...
    </div>
  {:else if error}
    <div class="p-4 rounded-lg flex items-center gap-3 bg-red-500/10 dark:bg-red-500/15 text-red-600 dark:text-red-400">
      <span class="text-xl">⚠</span>
      <span>Error loading GPU status: {error}</span>
    </div>
  {:else if status && !status.available}
    <div class="p-4 rounded-lg flex flex-col items-start gap-3 bg-blue-500/10 dark:bg-blue-500/15 text-blue-600 dark:text-blue-400">
      <span class="text-2xl">ℹ</span>
      <div>
        <strong>No NVIDIA GPU detected</strong>
        <p class="mt-1 text-sm opacity-80">{status.error || 'nvidia-smi not found'}</p>
      </div>
    </div>
  {:else if status && status.available && status.gpus}
    {#each status.gpus as gpu}
      <div class="panel">
        <div class="flex items-center gap-3 mb-4">
          <span class="text-2xl">🎮</span>
          <h4 class="m-0 text-base font-semibold text-gray-900 dark:text-gray-100">GPU {gpu.index}: {gpu.name}</h4>
        </div>

        <div class="flex flex-col gap-4">
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div class="flex flex-col gap-1">
              <span class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Total VRAM</span>
              <span class="text-sm font-semibold text-gray-900 dark:text-gray-100">{gpu.memory.total} MB</span>
            </div>
            <div class="flex flex-col gap-1">
              <span class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Used</span>
              <span class="text-sm font-semibold text-amber-500 dark:text-amber-400">{gpu.memory.used} MB ({gpu.memory.usedPercent}%)</span>
            </div>
            <div class="flex flex-col gap-1">
              <span class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Free</span>
              <span class="text-sm font-semibold text-green-500 dark:text-green-400">{gpu.memory.free} MB ({gpu.memory.freePercent}%)</span>
            </div>
            <div class="flex flex-col gap-1">
              <span class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">GPU Usage</span>
              <span class="text-sm font-semibold text-gray-900 dark:text-gray-100">{gpu.utilization.gpu}%</span>
            </div>
          </div>

          <div class="flex flex-col gap-1">
            <div class="h-6 bg-gray-200 dark:bg-gray-700 rounded-md overflow-hidden">
              <div class="h-full bg-gradient-to-r from-amber-500 to-red-500 transition-all duration-300" style="width: {gpu.memory.usedPercent}%"></div>
            </div>
            <div class="flex justify-between text-xs text-gray-500 dark:text-gray-400">
              <span>0%</span>
              <span>100%</span>
            </div>
          </div>
        </div>
      </div>
    {/each}

    <!-- Ollama Status -->
    {#if status.ollama}
      <div class="panel">
        <h5 class="m-0 mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100 uppercase tracking-wide">Ollama Status</h5>
        <div class="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-700">
          <span class="text-sm text-gray-500 dark:text-gray-400">Running:</span>
          <span class="text-sm font-semibold {status.ollama.running ? 'text-green-500 dark:text-green-400' : 'text-gray-500 dark:text-gray-400'}">
            {status.ollama.running ? '✓ Yes' : '✗ No'}
            {#if status.ollama.pid}
              (PID: {status.ollama.pid})
            {/if}
          </span>
        </div>
        {#if status.ollama.running}
          <div class="flex justify-between items-center py-2">
            <span class="text-sm text-gray-500 dark:text-gray-400">VRAM Limit:</span>
            <span class="text-sm font-semibold {status.ollama.vramLimit ? 'text-violet-600 dark:text-violet-400' : 'text-amber-500 dark:text-amber-400'}">
              {status.ollama.vramLimit || 'Not configured'}
            </span>
          </div>
        {/if}
      </div>
    {/if}

    <!-- GPU Processes -->
    {#if status.processes && status.processes.length > 0}
      <div class="panel">
        <h5 class="m-0 mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100 uppercase tracking-wide">GPU Processes</h5>
        <div class="flex flex-col gap-2">
          {#each status.processes as process}
            <div class="flex justify-between items-center p-2 bg-violet-500/5 dark:bg-violet-400/10 rounded-md">
              <span class="text-sm font-semibold text-gray-900 dark:text-gray-100">{process.name}</span>
              <span class="text-xs text-gray-500 dark:text-gray-400">PID: {process.pid} • {process.memory} MB</span>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Recommendations -->
    {#if status.recommendations && status.recommendations.length > 0}
      <div class="panel">
        <h5 class="m-0 mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100 uppercase tracking-wide">Recommendations</h5>
        {#each status.recommendations as rec, i}
          <div class="flex items-start gap-3 p-3 rounded-md border-l-[3px] mb-2 last:mb-0 {getRecommendationClass(rec.level)}">
            <span class="text-xl shrink-0">{getRecommendationIcon(rec.level)}</span>
            <div class="flex-1 flex flex-col gap-2">
              <p class="m-0 text-sm text-gray-700 dark:text-gray-300">{rec.message}</p>
              {#if rec.action === 'configure-vram'}
                <button class="self-start btn-primary btn-sm" on:click={openConfigureVRAM}>
                  Configure VRAM Limits
                </button>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<!-- VRAM Configuration Modal -->
{#if showConfigModal}
  <div class="modal-overlay" on:click={closeConfigModal}>
    <div class="modal-content max-w-[600px]" on:click|stopPropagation>
      <div class="modal-header">
        <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100">⚙️ Configure Ollama VRAM Limits</h3>
        <button class="w-8 h-8 flex items-center justify-center rounded text-xl text-gray-500 dark:text-gray-400 hover:bg-black/5 dark:hover:bg-white/5 transition-colors" on:click={closeConfigModal}>×</button>
      </div>
      <div class="modal-body">
        {#if !configOutput}
          <p class="mb-4 text-gray-600 dark:text-gray-400">
            This will help you configure Ollama to use a limited amount of GPU VRAM, leaving
            headroom for RVC voice synthesis and other GPU processes.
          </p>
          <p class="mb-2 text-gray-600 dark:text-gray-400">
            <strong class="text-gray-900 dark:text-gray-100">Recommended allocations:</strong>
          </p>
          <ul class="mb-4 pl-6 text-gray-600 dark:text-gray-400 list-disc">
            <li class="mb-1">8GB GPU: 50-60% for Ollama, 40-50% for RVC</li>
            <li class="mb-1">12GB GPU: 60-70% for Ollama, 30-40% for RVC</li>
            <li class="mb-1">16GB+ GPU: 70-75% for Ollama, 25-30% for RVC</li>
          </ul>
          <button class="btn-primary" on:click={runVRAMConfig}>
            Show Instructions
          </button>
        {:else}
          <pre class="mb-4 p-4 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md font-mono text-sm text-gray-900 dark:text-gray-100 whitespace-pre-wrap overflow-x-auto">{configOutput}</pre>
          <button class="btn-primary" on:click={closeConfigModal}>
            Close
          </button>
        {/if}
      </div>
    </div>
  </div>
{/if}
