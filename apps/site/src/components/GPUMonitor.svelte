<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

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

  onMount(() => {
    loadGPUStatus();
    // Refresh every 5 seconds
    refreshInterval = setInterval(loadGPUStatus, 5000);
  });

  onDestroy(() => {
    if (refreshInterval) {
      clearInterval(refreshInterval);
    }
  });

  async function loadGPUStatus() {
    try {
      const res = await fetch('/api/gpu-status');
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
      case 'success':
        return 'recommendation-success';
      case 'info':
        return 'recommendation-info';
      case 'warning':
        return 'recommendation-warning';
      case 'critical':
        return 'recommendation-critical';
      default:
        return '';
    }
  }

  function getRecommendationIcon(level: string): string {
    switch (level) {
      case 'success':
        return '✓';
      case 'info':
        return 'ℹ';
      case 'warning':
        return '⚠';
      case 'critical':
        return '⚠';
      default:
        return '';
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

<div class="gpu-monitor">
  {#if loading}
    <div class="loading">Loading GPU status...</div>
  {:else if error}
    <div class="error">
      <span class="error-icon">⚠</span>
      <span>Error loading GPU status: {error}</span>
    </div>
  {:else if status && !status.available}
    <div class="no-gpu">
      <span class="info-icon">ℹ</span>
      <div>
        <strong>No NVIDIA GPU detected</strong>
        <p>{status.error || 'nvidia-smi not found'}</p>
      </div>
    </div>
  {:else if status && status.available && status.gpus}
    {#each status.gpus as gpu}
      <div class="gpu-card">
        <div class="gpu-header">
          <span class="gpu-icon">🎮</span>
          <div class="gpu-info">
            <h4>GPU {gpu.index}: {gpu.name}</h4>
          </div>
        </div>

        <div class="memory-section">
          <div class="memory-stats">
            <div class="stat">
              <span class="stat-label">Total VRAM</span>
              <span class="stat-value">{gpu.memory.total} MB</span>
            </div>
            <div class="stat">
              <span class="stat-label">Used</span>
              <span class="stat-value used">{gpu.memory.used} MB ({gpu.memory.usedPercent}%)</span>
            </div>
            <div class="stat">
              <span class="stat-label">Free</span>
              <span class="stat-value free">{gpu.memory.free} MB ({gpu.memory.freePercent}%)</span>
            </div>
            <div class="stat">
              <span class="stat-label">GPU Usage</span>
              <span class="stat-value">{gpu.utilization.gpu}%</span>
            </div>
          </div>

          <div class="memory-bar-container">
            <div class="memory-bar">
              <div class="memory-used" style="width: {gpu.memory.usedPercent}%"></div>
            </div>
            <div class="memory-bar-labels">
              <span>0%</span>
              <span>100%</span>
            </div>
          </div>
        </div>
      </div>
    {/each}

    <!-- Ollama Status -->
    {#if status.ollama}
      <div class="ollama-status">
        <h5>Ollama Status</h5>
        <div class="status-row">
          <span class="status-label">Running:</span>
          <span class="status-value {status.ollama.running ? 'status-active' : 'status-inactive'}">
            {status.ollama.running ? '✓ Yes' : '✗ No'}
            {#if status.ollama.pid}
              (PID: {status.ollama.pid})
            {/if}
          </span>
        </div>
        {#if status.ollama.running}
          <div class="status-row">
            <span class="status-label">VRAM Limit:</span>
            <span class="status-value {status.ollama.vramLimit ? 'status-configured' : 'status-unconfigured'}">
              {status.ollama.vramLimit || 'Not configured'}
            </span>
          </div>
        {/if}
      </div>
    {/if}

    <!-- GPU Processes -->
    {#if status.processes && status.processes.length > 0}
      <div class="processes-section">
        <h5>GPU Processes</h5>
        <div class="processes-list">
          {#each status.processes as process}
            <div class="process-item">
              <span class="process-name">{process.name}</span>
              <span class="process-details">PID: {process.pid} • {process.memory} MB</span>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Recommendations -->
    {#if status.recommendations && status.recommendations.length > 0}
      <div class="recommendations-section">
        <h5>Recommendations</h5>
        {#each status.recommendations as rec}
          <div class="recommendation {getRecommendationClass(rec.level)}">
            <span class="rec-icon">{getRecommendationIcon(rec.level)}</span>
            <div class="rec-content">
              <p>{rec.message}</p>
              {#if rec.action === 'configure-vram'}
                <button class="rec-action-button" on:click={openConfigureVRAM}>
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
    <div class="modal-content" on:click|stopPropagation>
      <div class="modal-header">
        <h3>⚙️ Configure Ollama VRAM Limits</h3>
        <button class="modal-close" on:click={closeConfigModal}>×</button>
      </div>
      <div class="modal-body">
        {#if !configOutput}
          <p>
            This will help you configure Ollama to use a limited amount of GPU VRAM, leaving
            headroom for RVC voice synthesis and other GPU processes.
          </p>
          <p>
            <strong>Recommended allocations:</strong>
          </p>
          <ul>
            <li>8GB GPU: 50-60% for Ollama, 40-50% for RVC</li>
            <li>12GB GPU: 60-70% for Ollama, 30-40% for RVC</li>
            <li>16GB+ GPU: 70-75% for Ollama, 25-30% for RVC</li>
          </ul>
          <button class="modal-action-button" on:click={runVRAMConfig}>
            Show Instructions
          </button>
        {:else}
          <pre class="config-output">{configOutput}</pre>
          <button class="modal-action-button" on:click={closeConfigModal}>
            Close
          </button>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .gpu-monitor {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .loading,
  .error,
  .no-gpu {
    padding: 1rem;
    border-radius: 0.5rem;
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .loading {
    background: rgba(124, 58, 237, 0.05);
    color: #4b5563;
  }

  :global(.dark) .loading {
    background: rgba(167, 139, 250, 0.08);
    color: #9ca3af;
  }

  .error {
    background: rgba(239, 68, 68, 0.1);
    color: #dc2626;
  }

  :global(.dark) .error {
    background: rgba(239, 68, 68, 0.15);
    color: #f87171;
  }

  .error-icon {
    font-size: 1.25rem;
  }

  .no-gpu {
    background: rgba(59, 130, 246, 0.1);
    color: #2563eb;
    flex-direction: column;
    align-items: flex-start;
  }

  :global(.dark) .no-gpu {
    background: rgba(59, 130, 246, 0.15);
    color: #60a5fa;
  }

  .info-icon {
    font-size: 1.5rem;
  }

  .no-gpu p {
    margin: 0.25rem 0 0 0;
    font-size: 0.875rem;
    opacity: 0.8;
  }

  .gpu-card {
    background: white;
    border: 1px solid #e5e7eb;
    border-radius: 0.5rem;
    padding: 1rem;
  }

  :global(.dark) .gpu-card {
    background: #1f2937;
    border-color: #374151;
  }

  .gpu-header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 1rem;
  }

  .gpu-icon {
    font-size: 1.5rem;
  }

  .gpu-info h4 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    color: #1f2937;
  }

  :global(.dark) .gpu-info h4 {
    color: #f3f4f6;
  }

  .memory-section {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .memory-stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 0.75rem;
  }

  .stat {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .stat-label {
    font-size: 0.75rem;
    color: #6b7280;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  :global(.dark) .stat-label {
    color: #9ca3af;
  }

  .stat-value {
    font-size: 0.9375rem;
    font-weight: 600;
    color: #1f2937;
  }

  :global(.dark) .stat-value {
    color: #f3f4f6;
  }

  .stat-value.used {
    color: #f59e0b;
  }

  :global(.dark) .stat-value.used {
    color: #fbbf24;
  }

  .stat-value.free {
    color: #10b981;
  }

  :global(.dark) .stat-value.free {
    color: #34d399;
  }

  .memory-bar-container {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .memory-bar {
    height: 1.5rem;
    background: #e5e7eb;
    border-radius: 0.375rem;
    overflow: hidden;
    position: relative;
  }

  :global(.dark) .memory-bar {
    background: #374151;
  }

  .memory-used {
    height: 100%;
    background: linear-gradient(90deg, #f59e0b 0%, #ef4444 100%);
    transition: width 0.3s ease;
  }

  .memory-bar-labels {
    display: flex;
    justify-content: space-between;
    font-size: 0.75rem;
    color: #6b7280;
  }

  :global(.dark) .memory-bar-labels {
    color: #9ca3af;
  }

  .ollama-status,
  .processes-section,
  .recommendations-section {
    background: white;
    border: 1px solid #e5e7eb;
    border-radius: 0.5rem;
    padding: 1rem;
  }

  :global(.dark) .ollama-status,
  :global(.dark) .processes-section,
  :global(.dark) .recommendations-section {
    background: #1f2937;
    border-color: #374151;
  }

  h5 {
    margin: 0 0 0.75rem 0;
    font-size: 0.875rem;
    font-weight: 600;
    color: #1f2937;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  :global(.dark) h5 {
    color: #f3f4f6;
  }

  .status-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.5rem 0;
    border-bottom: 1px solid #f3f4f6;
  }

  :global(.dark) .status-row {
    border-bottom-color: #374151;
  }

  .status-row:last-child {
    border-bottom: none;
  }

  .status-label {
    font-size: 0.875rem;
    color: #6b7280;
  }

  :global(.dark) .status-label {
    color: #9ca3af;
  }

  .status-value {
    font-size: 0.875rem;
    font-weight: 600;
  }

  .status-active {
    color: #10b981;
  }

  :global(.dark) .status-active {
    color: #34d399;
  }

  .status-inactive {
    color: #6b7280;
  }

  :global(.dark) .status-inactive {
    color: #9ca3af;
  }

  .status-configured {
    color: #7c3aed;
  }

  :global(.dark) .status-configured {
    color: #a78bfa;
  }

  .status-unconfigured {
    color: #f59e0b;
  }

  :global(.dark) .status-unconfigured {
    color: #fbbf24;
  }

  .processes-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .process-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.5rem;
    background: rgba(124, 58, 237, 0.05);
    border-radius: 0.375rem;
  }

  :global(.dark) .process-item {
    background: rgba(167, 139, 250, 0.08);
  }

  .process-name {
    font-size: 0.875rem;
    font-weight: 600;
    color: #1f2937;
  }

  :global(.dark) .process-name {
    color: #f3f4f6;
  }

  .process-details {
    font-size: 0.75rem;
    color: #6b7280;
  }

  :global(.dark) .process-details {
    color: #9ca3af;
  }

  .recommendation {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.75rem;
    border-radius: 0.375rem;
    margin-bottom: 0.5rem;
  }

  .recommendation:last-child {
    margin-bottom: 0;
  }

  .recommendation-success {
    background: rgba(16, 185, 129, 0.1);
    border-left: 3px solid #10b981;
  }

  :global(.dark) .recommendation-success {
    background: rgba(16, 185, 129, 0.15);
    border-left-color: #34d399;
  }

  .recommendation-info {
    background: rgba(59, 130, 246, 0.1);
    border-left: 3px solid #3b82f6;
  }

  :global(.dark) .recommendation-info {
    background: rgba(59, 130, 246, 0.15);
    border-left-color: #60a5fa;
  }

  .recommendation-warning {
    background: rgba(245, 158, 11, 0.1);
    border-left: 3px solid #f59e0b;
  }

  :global(.dark) .recommendation-warning {
    background: rgba(245, 158, 11, 0.15);
    border-left-color: #fbbf24;
  }

  .recommendation-critical {
    background: rgba(239, 68, 68, 0.1);
    border-left: 3px solid #ef4444;
  }

  :global(.dark) .recommendation-critical {
    background: rgba(239, 68, 68, 0.15);
    border-left-color: #f87171;
  }

  .rec-icon {
    font-size: 1.25rem;
    flex-shrink: 0;
  }

  .rec-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .rec-content p {
    margin: 0;
    font-size: 0.875rem;
    color: #374151;
  }

  :global(.dark) .rec-content p {
    color: #d1d5db;
  }

  .rec-action-button {
    align-self: flex-start;
    padding: 0.375rem 0.75rem;
    font-size: 0.8125rem;
    font-weight: 500;
    border: none;
    border-radius: 0.375rem;
    background: #7c3aed;
    color: white;
    cursor: pointer;
    transition: all 0.2s;
  }

  .rec-action-button:hover {
    background: #6d28d9;
  }

  /* Modal Styles */
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 1rem;
  }

  .modal-content {
    background: white;
    border-radius: 0.5rem;
    max-width: 600px;
    width: 100%;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
  }

  :global(.dark) .modal-content {
    background: #1f2937;
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1.25rem;
    border-bottom: 1px solid #e5e7eb;
  }

  :global(.dark) .modal-header {
    border-bottom-color: #374151;
  }

  .modal-header h3 {
    margin: 0;
    font-size: 1.125rem;
    font-weight: 600;
    color: #1f2937;
  }

  :global(.dark) .modal-header h3 {
    color: #f3f4f6;
  }

  .modal-close {
    background: none;
    border: none;
    font-size: 1.5rem;
    color: #6b7280;
    cursor: pointer;
    padding: 0;
    width: 2rem;
    height: 2rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 0.25rem;
    transition: all 0.2s;
  }

  .modal-close:hover {
    background: rgba(0, 0, 0, 0.05);
    color: #1f2937;
  }

  :global(.dark) .modal-close {
    color: #9ca3af;
  }

  :global(.dark) .modal-close:hover {
    background: rgba(255, 255, 255, 0.05);
    color: #f3f4f6;
  }

  .modal-body {
    padding: 1.25rem;
    overflow-y: auto;
    flex: 1;
  }

  .modal-body p {
    margin: 0 0 1rem 0;
    color: #4b5563;
  }

  :global(.dark) .modal-body p {
    color: #9ca3af;
  }

  .modal-body ul {
    margin: 0 0 1rem 0;
    padding-left: 1.5rem;
    color: #4b5563;
  }

  :global(.dark) .modal-body ul {
    color: #9ca3af;
  }

  .modal-body li {
    margin-bottom: 0.375rem;
  }

  .modal-action-button {
    padding: 0.625rem 1.25rem;
    font-size: 0.875rem;
    font-weight: 500;
    border: none;
    border-radius: 0.375rem;
    background: #7c3aed;
    color: white;
    cursor: pointer;
    transition: all 0.2s;
  }

  .modal-action-button:hover {
    background: #6d28d9;
  }

  .config-output {
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 0.375rem;
    padding: 1rem;
    font-family: monospace;
    font-size: 0.875rem;
    color: #1f2937;
    white-space: pre-wrap;
    overflow-x: auto;
    margin-bottom: 1rem;
  }

  :global(.dark) .config-output {
    background: #111827;
    border-color: #374151;
    color: #f3f4f6;
  }
</style>
