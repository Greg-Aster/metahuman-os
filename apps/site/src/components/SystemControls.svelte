<script lang="ts">
  import { onMount } from 'svelte';
  import { fetchJSONSafe } from '../lib/fetch-timeout';

  let loraEnabled = false;
  let loading = true;
  let error: string | null = null;
  let working = false;

  // Training config
  let trainingConfig: any = null;
  let updatingTrainingConfig = false;

  async function loadData() {
    loading = true;
    error = null;
    try {
      const { data, error: fetchError } = await fetchJSONSafe('/api/adapters', {
        timeout: 15000,
        retries: 1,
        retryDelay: 2000,
      });

      if (fetchError) throw new Error(fetchError);
      if (!data || !data.success) throw new Error(data?.error || 'Failed to load data');

      loraEnabled = !!(data.sleep?.loraEnabled);
    } catch (err) {
      console.error('[SystemControls] Load error:', err);
      error = (err as Error).message;
    } finally {
      loading = false;
    }
  }

  async function loadTrainingConfig() {
    try {
      const { data, error: fetchError } = await fetchJSONSafe('/api/training-data', {
        timeout: 10000,
      });

      if (fetchError) {
        console.warn('[SystemControls] Training config not available');
        return;
      }

      if (data && data.success) {
        trainingConfig = data.config;
      }
    } catch (err) {
      console.warn('[SystemControls] Failed to load training config:', err);
    }
  }

  async function updateTrainingConfig(updates: any) {
    updatingTrainingConfig = true;
    try {
      const res = await fetch('/api/training-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      await loadTrainingConfig();
    } catch (err) {
      error = (err as Error).message;
    } finally {
      updatingTrainingConfig = false;
    }
  }

  function applyPhasePreset(phase: 'phase1_conservative' | 'phase2_optimal' | 'phase3_maximum') {
    const presets = {
      phase1_conservative: { batchSize: 50, maxSamplesPerSource: 1000, qualityThreshold: 6.5 },
      phase2_optimal: { batchSize: 100, maxSamplesPerSource: 3000, qualityThreshold: 5.5 },
      phase3_maximum: { batchSize: 150, maxSamplesPerSource: 5000, qualityThreshold: 4.5 },
    };
    const preset = presets[phase];
    updateTrainingConfig({
      curator: { batchSize: preset.batchSize, qualityThreshold: preset.qualityThreshold },
      collection: { maxSamplesPerSource: preset.maxSamplesPerSource }
    });
  }

  async function sendAction(action: string, payload: Record<string, any>) {
    working = true;
    try {
      const res = await fetch('/api/adapters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...payload })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Action failed');
      return data;
    } finally {
      working = false;
    }
  }

  async function runBuilderNow() {
    try {
      await sendAction('runBuilder', {});
      alert('✅ Adapter-builder started. Check datasets tab shortly.');
    } catch (err) {
      alert('❌ ' + (err as Error).message);
    }
  }

  async function runDreamerNow() {
    try {
      await sendAction('runDreamer', {});
      alert('✅ Dreamer started. New learnings will appear in morning profile.');
    } catch (err) {
      alert('❌ ' + (err as Error).message);
    }
  }

  async function runNightProcessorNow() {
    try {
      await sendAction('runNightProcessor', {});
      alert('✅ Night processor started (transcriber + audio-organizer).');
    } catch (err) {
      alert('❌ ' + (err as Error).message);
    }
  }

  async function startSleepService() {
    try {
      await sendAction('startSleepService', {});
      alert('✅ Sleep service started. Will run nightly automation.');
    } catch (err) {
      alert('❌ ' + (err as Error).message);
    }
  }

  async function exportConversationsNow() {
    try {
      const res = await fetch('/api/export-conversations', { method: 'POST' });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      alert('✅ Conversations exported successfully.');
    } catch (err) {
      alert('❌ ' + (err as Error).message);
    }
  }

  async function mergeHistoricalAdapters() {
    if (!confirm('Merge all historical adapters into a single consolidated adapter?\n\nThis may take several minutes.')) return;

    try {
      await sendAction('mergeAdapters', {});
      alert('✅ Adapter merge started. Check audit logs for progress.');
    } catch (err) {
      alert('❌ ' + (err as Error).message);
    }
  }

  async function onToggleLoraEnabled(e: any) {
    const checked = !!e.currentTarget.checked;
    try {
      await sendAction('sleep', { loraEnabled: checked });
      loraEnabled = checked;
    } catch (err) {
      alert('❌ ' + (err as Error).message);
      await loadData(); // Reload to reset checkbox
    }
  }

  onMount(() => {
    loadData();
    loadTrainingConfig();
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  });
</script>

<div class="system-controls">
  <div class="header">
    <div>
      <h2>⚙️ System Controls</h2>
      <p>Agent triggers, automation settings, and training configuration.</p>
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

  <!-- Agent Controls -->
  <section class="card">
    <header>
      <h3>🤖 Background Agents</h3>
      <p>Manually trigger autonomous agents and services.</p>
    </header>
    <div class="actions-grid">
      <button class="action-btn" on:click={runBuilderNow} disabled={working}>
        <div class="action-icon">📦</div>
        <div class="action-label">Run Builder</div>
        <div class="action-desc">Generate training dataset</div>
      </button>
      <button class="action-btn" on:click={runDreamerNow} disabled={working}>
        <div class="action-icon">💭</div>
        <div class="action-label">Run Dreamer</div>
        <div class="action-desc">Generate dream memories</div>
      </button>
      <button class="action-btn" on:click={runNightProcessorNow} disabled={working}>
        <div class="action-icon">🌙</div>
        <div class="action-label">Night Processor</div>
        <div class="action-desc">Transcribe & organize audio</div>
      </button>
      <button class="action-btn" on:click={startSleepService} disabled={working}>
        <div class="action-icon">😴</div>
        <div class="action-label">Sleep Service</div>
        <div class="action-desc">Start nightly automation</div>
      </button>
      <button class="action-btn" on:click={exportConversationsNow} disabled={working}>
        <div class="action-icon">💾</div>
        <div class="action-label">Export Conversations</div>
        <div class="action-desc">Export chat history</div>
      </button>
      <button class="action-btn highlight" on:click={mergeHistoricalAdapters} disabled={working}>
        <div class="action-icon">🔀</div>
        <div class="action-label">Merge Adapters</div>
        <div class="action-desc">Consolidate historical adapters</div>
      </button>
    </div>
  </section>

  <!-- System Toggles -->
  <section class="card">
    <header>
      <h3>🔧 System Configuration</h3>
      <p>Core system settings and toggles.</p>
    </header>
    <div class="config-grid">
      <label class="switch-row">
        <div>
          <div class="switch-label">Enable LoRA Training</div>
          <div class="switch-desc">Allow nightly LoRA adapter training</div>
        </div>
        <input type="checkbox" checked={loraEnabled} on:change={onToggleLoraEnabled} disabled={working} />
      </label>
    </div>
  </section>

  <!-- Training Data Configuration -->
  {#if trainingConfig}
    <section class="card">
      <header>
        <h3>📊 Training Data Configuration</h3>
        <p>Configure data collection and curation settings for training.</p>
      </header>

      <!-- Quick Presets -->
      <div class="presets-row">
        <div class="presets-label">Quick Presets:</div>
        <button class="preset-btn" on:click={() => applyPhasePreset('phase1_conservative')} disabled={updatingTrainingConfig}>
          <span class="preset-name">Phase 1: Conservative</span>
          <span class="preset-desc">~1000 samples</span>
        </button>
        <button class="preset-btn" on:click={() => applyPhasePreset('phase2_optimal')} disabled={updatingTrainingConfig}>
          <span class="preset-name">Phase 2: Optimal</span>
          <span class="preset-desc">~3000 samples</span>
        </button>
        <button class="preset-btn" on:click={() => applyPhasePreset('phase3_maximum')} disabled={updatingTrainingConfig}>
          <span class="preset-name">Phase 3: Maximum</span>
          <span class="preset-desc">~5000 samples</span>
        </button>
      </div>

      <!-- Configuration Grid -->
      <div class="training-config-grid">
        <div class="config-section">
          <h4>Curator Settings</h4>
          <div class="form-row">
            <label for="batch-size">Batch Size:</label>
            <input
              id="batch-size"
              type="number"
              min="10"
              max="200"
              step="10"
              value={trainingConfig.curator.batchSize}
              disabled={updatingTrainingConfig}
              on:change={(e) => updateTrainingConfig({ curator: { batchSize: parseInt(e.currentTarget.value) } })}
            />
            <span class="help-hint">Samples per curator call (10-200)</span>
          </div>
          <div class="form-row">
            <label for="quality-threshold">Quality Threshold:</label>
            <input
              id="quality-threshold"
              type="number"
              min="0"
              max="10"
              step="0.1"
              value={trainingConfig.curator.qualityThreshold}
              disabled={updatingTrainingConfig}
              on:change={(e) => updateTrainingConfig({ curator: { qualityThreshold: parseFloat(e.currentTarget.value) } })}
            />
            <span class="help-hint">Min quality score (0-10)</span>
          </div>
        </div>

        <div class="config-section">
          <h4>Collection Settings</h4>
          <div class="form-row">
            <label for="max-samples">Max Samples/Source:</label>
            <input
              id="max-samples"
              type="number"
              min="100"
              max="10000"
              step="100"
              value={trainingConfig.collection.maxSamplesPerSource}
              disabled={updatingTrainingConfig}
              on:change={(e) => updateTrainingConfig({ collection: { maxSamplesPerSource: parseInt(e.currentTarget.value) } })}
            />
            <span class="help-hint">Max samples per type (100-10000)</span>
          </div>
        </div>
      </div>

      <div class="current-config">
        <strong>Current:</strong>
        Batch size: <span class="highlight">{trainingConfig.curator.batchSize}</span> |
        Max samples: <span class="highlight">{trainingConfig.collection.maxSamplesPerSource}</span> |
        Quality: <span class="highlight">{trainingConfig.curator.qualityThreshold}</span>
      </div>
    </section>
  {/if}
</div>

<style>
  .system-controls {
    padding: 1.5rem;
    max-width: 1400px;
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

  .card h4 {
    margin: 0 0 0.75rem 0;
    font-size: 1rem;
    font-weight: 600;
    color: #6b7280;
  }

  .card p {
    margin: 0;
    color: #6b7280;
    font-size: 0.875rem;
  }

  .actions-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 1rem;
  }

  .action-btn {
    background: white;
    border: 2px solid #e5e7eb;
    border-radius: 8px;
    padding: 1.25rem 1rem;
    cursor: pointer;
    transition: all 0.2s;
    text-align: center;
  }

  :global(.dark) .action-btn {
    background: #111827;
    border-color: #374151;
  }

  .action-btn:hover:not(:disabled) {
    border-color: #3b82f6;
    transform: translateY(-2px);
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
  }

  .action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .action-btn.highlight {
    border-color: #f59e0b;
    background: #fffbeb;
  }

  :global(.dark) .action-btn.highlight {
    background: #422006;
    border-color: #f59e0b;
  }

  .action-icon {
    font-size: 2rem;
    margin-bottom: 0.5rem;
  }

  .action-label {
    font-weight: 600;
    font-size: 0.875rem;
    margin-bottom: 0.25rem;
  }

  .action-desc {
    font-size: 0.75rem;
    color: #6b7280;
  }

  .config-grid {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .switch-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem;
    background: #f9fafb;
    border-radius: 6px;
    cursor: pointer;
  }

  :global(.dark) .switch-row {
    background: #111827;
  }

  .switch-label {
    font-weight: 600;
    font-size: 0.875rem;
    margin-bottom: 0.25rem;
  }

  .switch-desc {
    font-size: 0.75rem;
    color: #6b7280;
  }

  .switch-row input[type="checkbox"] {
    cursor: pointer;
    width: 20px;
    height: 20px;
  }

  .presets-row {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1.5rem;
    padding: 1rem;
    background: #f9fafb;
    border-radius: 6px;
    flex-wrap: wrap;
  }

  :global(.dark) .presets-row {
    background: #111827;
  }

  .presets-label {
    font-weight: 600;
    font-size: 0.875rem;
  }

  .preset-btn {
    display: flex;
    flex-direction: column;
    padding: 0.75rem 1rem;
    background: white;
    border: 2px solid #e5e7eb;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.2s;
  }

  :global(.dark) .preset-btn {
    background: #1f2937;
    border-color: #374151;
  }

  .preset-btn:hover:not(:disabled) {
    border-color: #3b82f6;
    transform: translateY(-1px);
  }

  .preset-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .preset-name {
    font-weight: 600;
    font-size: 0.875rem;
    margin-bottom: 0.25rem;
  }

  .preset-desc {
    font-size: 0.75rem;
    color: #6b7280;
  }

  .training-config-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 1.5rem;
    margin-bottom: 1rem;
  }

  .config-section {
    padding: 1rem;
    background: #f9fafb;
    border-radius: 6px;
  }

  :global(.dark) .config-section {
    background: #111827;
  }

  .form-row {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }

  .form-row:last-child {
    margin-bottom: 0;
  }

  .form-row label {
    font-weight: 500;
    font-size: 0.875rem;
  }

  .form-row input[type="number"] {
    padding: 0.5rem;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    background: white;
  }

  :global(.dark) .form-row input[type="number"] {
    background: #1f2937;
    border-color: #374151;
    color: #f3f4f6;
  }

  .help-hint {
    font-size: 0.75rem;
    color: #6b7280;
  }

  .current-config {
    padding: 1rem;
    background: #f9fafb;
    border-radius: 6px;
    font-size: 0.875rem;
  }

  :global(.dark) .current-config {
    background: #111827;
  }

  .highlight {
    color: #3b82f6;
    font-weight: 600;
  }
</style>
