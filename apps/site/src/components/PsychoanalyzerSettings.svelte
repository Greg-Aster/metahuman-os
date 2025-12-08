<script lang="ts">
  import { onMount, createEventDispatcher } from 'svelte';
  import { apiFetch } from '../lib/client/api-config';

  const dispatch = createEventDispatcher();

  interface MemorySelectionConfig {
    strategy: string;
    daysBack: number;
    maxMemories: number;
    minMemories: number;
    excludeTypes: string[];
    priorityTags: string[];
  }

  interface AnalysisConfig {
    model: string;
    temperature: number;
    maxTokens: number;
    focusAreas: string[];
    confidenceThreshold: number;
  }

  interface PsychoanalyzerConfig {
    enabled: boolean;
    backend: 'auto' | 'local' | 'cloud' | 'bigbrother';
    memorySelection: MemorySelectionConfig;
    analysis: AnalysisConfig;
  }

  interface BackendInfo {
    name: string;
    description: string;
    contextWindow: string;
    maxTokens: string;
  }

  let loading = true;
  let saving = false;
  let runningAnalysis = false;
  let error: string | null = null;
  let feedback: { type: 'success' | 'error'; text: string } | null = null;

  let config: PsychoanalyzerConfig = {
    enabled: true,
    backend: 'auto',
    memorySelection: {
      strategy: 'recent',
      daysBack: 14,
      maxMemories: 100,
      minMemories: 10,
      excludeTypes: [],
      priorityTags: [],
    },
    analysis: {
      model: 'psychotherapist',
      temperature: 0.3,
      maxTokens: 800,
      focusAreas: [],
      confidenceThreshold: 0.6,
    },
  };

  let backendInfo: Record<string, BackendInfo> = {};

  // Focus area display info
  const focusAreaInfo: Record<string, { name: string; description: string }> = {
    values_evolution: { name: 'Values Evolution', description: 'Track changes in core values and beliefs' },
    goals_progress: { name: 'Goals Progress', description: 'Monitor advancement toward goals' },
    communication_patterns: { name: 'Communication Patterns', description: 'Analyze speaking and writing style' },
    interests_changes: { name: 'Interests Changes', description: 'Track evolving interests and hobbies' },
    decision_heuristics: { name: 'Decision Heuristics', description: 'Identify decision-making patterns' },
    personality_shifts: { name: 'Personality Shifts', description: 'Detect personality trait changes' },
  };

  async function loadConfig() {
    loading = true;
    error = null;
    try {
      const res = await apiFetch('/api/psychoanalyzer-config');
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to load config');

      config = data.config;
      backendInfo = data.backendInfo || {};

      // Ensure defaults
      if (!config.backend) config.backend = 'auto';
      if (!config.analysis.maxTokens) config.analysis.maxTokens = 800;
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }

  async function saveConfig() {
    saving = true;
    feedback = null;
    try {
      const res = await apiFetch('/api/psychoanalyzer-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: config.enabled,
          backend: config.backend,
          memorySelection: {
            daysBack: config.memorySelection.daysBack,
            maxMemories: config.memorySelection.maxMemories,
            minMemories: config.memorySelection.minMemories,
          },
          analysis: {
            maxTokens: config.analysis.maxTokens,
            confidenceThreshold: config.analysis.confidenceThreshold,
            focusAreas: config.analysis.focusAreas,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to save');

      feedback = { type: 'success', text: 'Settings saved successfully' };
      setTimeout(() => feedback = null, 3000);
    } catch (e) {
      feedback = { type: 'error', text: (e as Error).message };
    } finally {
      saving = false;
    }
  }

  async function runAnalysis() {
    runningAnalysis = true;
    feedback = null;
    try {
      const res = await apiFetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentName: 'psychoanalyzer' }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Failed to start analysis');
      }
      feedback = { type: 'success', text: 'Psychoanalyzer started! Check the right sidebar for progress.' };
    } catch (e) {
      feedback = { type: 'error', text: (e as Error).message };
    } finally {
      runningAnalysis = false;
    }
  }

  function toggleFocusArea(area: string) {
    const index = config.analysis.focusAreas.indexOf(area);
    if (index === -1) {
      config.analysis.focusAreas = [...config.analysis.focusAreas, area];
    } else {
      config.analysis.focusAreas = config.analysis.focusAreas.filter(a => a !== area);
    }
  }

  function handleClose() {
    dispatch('close');
  }

  onMount(() => {
    loadConfig();
  });
</script>

<div class="settings-modal">
  <div class="settings-overlay" on:click={handleClose} on:keydown={(e) => e.key === 'Escape' && handleClose()} role="button" tabindex="0" aria-label="Close settings"></div>

  <div class="settings-panel">
    <div class="settings-header">
      <h2>Psychoanalyzer Settings</h2>
      <button class="btn-close" on:click={handleClose}>x</button>
    </div>

    {#if loading}
      <div class="loading">Loading configuration...</div>
    {:else if error}
      <div class="error-message">{error}</div>
    {:else}
      <div class="settings-content">
        {#if feedback}
          <div class="feedback {feedback.type}">{feedback.text}</div>
        {/if}

        <!-- Backend Selection -->
        <section class="card">
          <h3>Backend Selection</h3>
          <p class="card-description">Choose which system analyzes your persona</p>

          <div class="backend-options">
            {#each Object.entries(backendInfo) as [key, info]}
              <label class="backend-option" class:selected={config.backend === key}>
                <input
                  type="radio"
                  name="backend"
                  value={key}
                  bind:group={config.backend}
                />
                <div class="backend-info">
                  <span class="backend-name">{info.name}</span>
                  <span class="backend-desc">{info.description}</span>
                  <span class="backend-specs">Context: {info.contextWindow} | Max Output: {info.maxTokens}</span>
                </div>
              </label>
            {/each}
          </div>
        </section>

        <!-- Memory Analysis -->
        <section class="card">
          <h3>Memory Analysis</h3>
          <p class="card-description">Configure how memories are selected for analysis</p>

          <div class="form-group">
            <label for="daysBack">Days to analyze</label>
            <div class="slider-row">
              <input
                type="range"
                id="daysBack"
                min="7"
                max="90"
                bind:value={config.memorySelection.daysBack}
              />
              <span class="slider-value">{config.memorySelection.daysBack} days</span>
            </div>
          </div>

          <div class="form-group">
            <label for="maxMemories">Maximum memories</label>
            <div class="slider-row">
              <input
                type="range"
                id="maxMemories"
                min="10"
                max="200"
                step="10"
                bind:value={config.memorySelection.maxMemories}
              />
              <span class="slider-value">{config.memorySelection.maxMemories}</span>
            </div>
          </div>

          <div class="form-group">
            <label for="minMemories">Minimum required</label>
            <div class="slider-row">
              <input
                type="range"
                id="minMemories"
                min="5"
                max="50"
                step="5"
                bind:value={config.memorySelection.minMemories}
              />
              <span class="slider-value">{config.memorySelection.minMemories}</span>
            </div>
          </div>
        </section>

        <!-- Focus Areas -->
        <section class="card">
          <h3>Focus Areas</h3>
          <p class="card-description">Select which aspects of your persona to analyze</p>

          <div class="focus-areas">
            {#each Object.entries(focusAreaInfo) as [key, info]}
              <label class="focus-area" class:active={config.analysis.focusAreas.includes(key)}>
                <input
                  type="checkbox"
                  checked={config.analysis.focusAreas.includes(key)}
                  on:change={() => toggleFocusArea(key)}
                />
                <span class="focus-name">{info.name}</span>
              </label>
            {/each}
          </div>
        </section>

        <!-- Quality Settings -->
        <section class="card">
          <h3>Quality Settings</h3>
          <p class="card-description">Adjust analysis confidence and output limits</p>

          <div class="form-group">
            <label for="confidence">Confidence threshold</label>
            <div class="slider-row">
              <input
                type="range"
                id="confidence"
                min="0.4"
                max="0.9"
                step="0.1"
                bind:value={config.analysis.confidenceThreshold}
              />
              <span class="slider-value">{Math.round(config.analysis.confidenceThreshold * 100)}%</span>
            </div>
            <p class="hint">Only update persona if LLM confidence exceeds this threshold</p>
          </div>

          <div class="form-group">
            <label for="maxTokens">Max output tokens</label>
            <div class="slider-row">
              <input
                type="range"
                id="maxTokens"
                min="400"
                max="2048"
                step="100"
                bind:value={config.analysis.maxTokens}
              />
              <span class="slider-value">{config.analysis.maxTokens}</span>
            </div>
            <p class="hint">Higher values allow more detailed analysis but use more context</p>
          </div>
        </section>

        <!-- Actions -->
        <div class="actions">
          <button class="btn-primary" on:click={saveConfig} disabled={saving}>
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
          <button class="btn-run" on:click={runAnalysis} disabled={runningAnalysis}>
            {runningAnalysis ? 'Starting...' : 'Run Analysis Now'}
          </button>
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .settings-modal {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .settings-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
  }

  .settings-panel {
    position: relative;
    background: white;
    border-radius: 0.75rem;
    width: 90%;
    max-width: 600px;
    max-height: 85vh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  }

  :global(.dark) .settings-panel {
    background: #1f2937;
    border: 1px solid #374151;
  }

  .settings-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 1.5rem;
    border-bottom: 1px solid #e5e7eb;
  }

  :global(.dark) .settings-header {
    border-bottom-color: #374151;
  }

  .settings-header h2 {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 600;
  }

  .btn-close {
    background: none;
    border: none;
    font-size: 1.5rem;
    cursor: pointer;
    color: #6b7280;
    padding: 0.25rem 0.5rem;
    line-height: 1;
  }

  .btn-close:hover {
    color: #1f2937;
  }

  :global(.dark) .btn-close:hover {
    color: #f3f4f6;
  }

  .settings-content {
    padding: 1.5rem;
    overflow-y: auto;
    flex: 1;
  }

  .loading, .error-message {
    padding: 2rem;
    text-align: center;
  }

  .error-message {
    color: #ef4444;
  }

  .feedback {
    padding: 0.75rem 1rem;
    border-radius: 0.5rem;
    margin-bottom: 1rem;
    font-size: 0.875rem;
  }

  .feedback.success {
    background: #d1fae5;
    color: #065f46;
  }

  .feedback.error {
    background: #fee2e2;
    color: #991b1b;
  }

  :global(.dark) .feedback.success {
    background: #064e3b;
    color: #6ee7b7;
  }

  :global(.dark) .feedback.error {
    background: #7f1d1d;
    color: #fca5a5;
  }

  .card {
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 0.5rem;
    padding: 1.25rem;
    margin-bottom: 1rem;
  }

  :global(.dark) .card {
    background: #111827;
    border-color: #374151;
  }

  .card h3 {
    margin: 0 0 0.25rem 0;
    font-size: 1rem;
    font-weight: 600;
  }

  .card-description {
    margin: 0 0 1rem 0;
    font-size: 0.875rem;
    color: #6b7280;
  }

  :global(.dark) .card-description {
    color: #9ca3af;
  }

  .backend-options {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .backend-option {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.75rem;
    border: 1px solid #e5e7eb;
    border-radius: 0.375rem;
    cursor: pointer;
    transition: all 0.2s;
  }

  :global(.dark) .backend-option {
    border-color: #374151;
  }

  .backend-option:hover {
    border-color: #a78bfa;
  }

  .backend-option.selected {
    border-color: #7c3aed;
    background: #f5f3ff;
  }

  :global(.dark) .backend-option.selected {
    background: #2e1065;
    border-color: #7c3aed;
  }

  .backend-option input {
    margin-top: 0.25rem;
  }

  .backend-info {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .backend-name {
    font-weight: 600;
    font-size: 0.9375rem;
  }

  .backend-desc {
    font-size: 0.8125rem;
    color: #6b7280;
  }

  :global(.dark) .backend-desc {
    color: #9ca3af;
  }

  .backend-specs {
    font-size: 0.75rem;
    color: #9ca3af;
    font-family: 'Courier New', monospace;
  }

  .form-group {
    margin-bottom: 1rem;
  }

  .form-group:last-child {
    margin-bottom: 0;
  }

  .form-group label {
    display: block;
    font-weight: 500;
    margin-bottom: 0.5rem;
    font-size: 0.875rem;
  }

  .slider-row {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .slider-row input[type="range"] {
    flex: 1;
    height: 6px;
    border-radius: 3px;
    background: #e5e7eb;
    cursor: pointer;
  }

  :global(.dark) .slider-row input[type="range"] {
    background: #374151;
  }

  .slider-value {
    min-width: 4rem;
    text-align: right;
    font-weight: 600;
    font-size: 0.875rem;
    color: #7c3aed;
  }

  .hint {
    margin: 0.25rem 0 0 0;
    font-size: 0.75rem;
    color: #9ca3af;
  }

  .focus-areas {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.5rem;
  }

  @media (max-width: 500px) {
    .focus-areas {
      grid-template-columns: 1fr;
    }
  }

  .focus-area {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    border: 1px solid #e5e7eb;
    border-radius: 0.375rem;
    cursor: pointer;
    transition: all 0.2s;
  }

  :global(.dark) .focus-area {
    border-color: #374151;
  }

  .focus-area:hover {
    border-color: #a78bfa;
  }

  .focus-area.active {
    border-color: #7c3aed;
    background: #f5f3ff;
  }

  :global(.dark) .focus-area.active {
    background: #2e1065;
    border-color: #7c3aed;
  }

  .focus-name {
    font-size: 0.8125rem;
    font-weight: 500;
  }

  .actions {
    display: flex;
    gap: 0.75rem;
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid #e5e7eb;
  }

  :global(.dark) .actions {
    border-top-color: #374151;
  }

  .btn-primary, .btn-run {
    flex: 1;
    padding: 0.75rem 1rem;
    border: none;
    border-radius: 0.375rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }

  .btn-primary {
    background: #7c3aed;
    color: white;
  }

  .btn-primary:hover:not(:disabled) {
    background: #6d28d9;
  }

  .btn-run {
    background: #10b981;
    color: white;
  }

  .btn-run:hover:not(:disabled) {
    background: #059669;
  }

  .btn-primary:disabled, .btn-run:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
</style>
