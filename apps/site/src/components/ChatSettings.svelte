<script lang="ts">
  import { onMount } from 'svelte';

  let config: any = null;
  let settings: any = null;
  let scope: any = null;
  let loading = true;
  let saving = false;
  let applyingPreset = false;

  // Local state for sliders
  let contextInfluence = 0.5;
  let historyInfluence = 0.6;
  let facetInfluence = 0.7;
  let temperature = 0.6;
  let semanticSearchThreshold = 0.62;
  let maxContextChars = 900;
  let maxHistoryMessages = 30;
  let userInputPriority = true;
  let innerDialogHistoryLimit = 80;
  let innerDialogHistoryDays = 7;

  onMount(async () => {
    await loadSettings();
  });

  async function loadSettings() {
    try {
      loading = true;
      const res = await fetch('/api/chat-settings');
      if (res.ok) {
        const data = await res.json();
        config = data.config;
        settings = data.settings;
        scope = data.scope;

        // Update local state
        contextInfluence = settings.contextInfluence;
        historyInfluence = settings.historyInfluence;
        facetInfluence = settings.facetInfluence;
        temperature = settings.temperature;
        semanticSearchThreshold = settings.semanticSearchThreshold;
        maxContextChars = settings.maxContextChars;
        maxHistoryMessages = settings.maxHistoryMessages;
        userInputPriority = settings.userInputPriority;
        innerDialogHistoryLimit = settings.innerDialogHistoryLimit ?? 80;
        innerDialogHistoryDays = settings.innerDialogHistoryDays ?? 7;
      }
    } catch (error) {
      console.error('Failed to load chat settings:', error);
    } finally {
      loading = false;
    }
  }

  async function saveSettings() {
    try {
      saving = true;
      const updates = {
        contextInfluence,
        historyInfluence,
        facetInfluence,
        temperature,
        semanticSearchThreshold,
        maxContextChars,
        maxHistoryMessages,
        userInputPriority,
        innerDialogHistoryLimit,
        innerDialogHistoryDays,
      };

      const res = await fetch('/api/chat-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
      });

      if (res.ok) {
        await loadSettings();
      }
    } catch (error) {
      console.error('Failed to save settings:', error);
    } finally {
      saving = false;
    }
  }

  async function applyPreset(presetName: string) {
    try {
      applyingPreset = true;
      const res = await fetch('/api/chat-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preset: presetName }),
      });

      if (res.ok) {
        await loadSettings();
      }
    } catch (error) {
      console.error('Failed to apply preset:', error);
    } finally {
      applyingPreset = false;
    }
  }
</script>

<div class="chat-settings">
  <h3>Chat Behavior Settings</h3>

  {#if loading}
    <p class="loading">Loading settings...</p>
  {:else}
    <div class="scope-info">
      <p>
        <strong>Scope:</strong> {scope?.scope === 'user' ? 'User-specific' : 'Global'}
        {#if scope?.hasUserOverride}
          <span class="badge">Custom</span>
        {/if}
      </p>
      <p class="help-text">
        {scope?.scope === 'user'
          ? 'Your personal chat settings (overrides global defaults)'
          : 'Global settings (applies to all users without custom settings)'}
      </p>
    </div>

    <!-- Presets -->
    <div class="presets">
      <h4>Quick Presets</h4>
      <div class="preset-buttons">
        <button
          class="preset-btn"
          on:click={() => applyPreset('focused')}
          disabled={applyingPreset}
        >
          🎯 Focused
          <span class="preset-desc">Prioritize current question</span>
        </button>
        <button
          class="preset-btn"
          on:click={() => applyPreset('balanced')}
          disabled={applyingPreset}
        >
          ⚖️ Balanced
          <span class="preset-desc">Equal context & responsiveness</span>
        </button>
        <button
          class="preset-btn"
          on:click={() => applyPreset('immersive')}
          disabled={applyingPreset}
        >
          🌊 Immersive
          <span class="preset-desc">Deep context awareness</span>
        </button>
        <button
          class="preset-btn"
          on:click={() => applyPreset('minimal')}
          disabled={applyingPreset}
        >
          ✨ Minimal
          <span class="preset-desc">Clean, direct responses</span>
        </button>
      </div>
    </div>

    <!-- Custom Settings -->
    <div class="custom-settings">
      <h4>Custom Settings</h4>

      <!-- Context Influence -->
      <div class="setting-group">
        <label>
          Context Influence: {contextInfluence.toFixed(1)}
          <span class="help">How much weight to give memory context</span>
        </label>
        <input
          type="range"
          min="0"
          max="1"
          step="0.1"
          bind:value={contextInfluence}
          on:change={saveSettings}
        />
      </div>

      <!-- History Influence -->
      <div class="setting-group">
        <label>
          History Influence: {historyInfluence.toFixed(1)}
          <span class="help">How much weight to give conversation history</span>
        </label>
        <input
          type="range"
          min="0"
          max="1"
          step="0.1"
          bind:value={historyInfluence}
          on:change={saveSettings}
        />
      </div>

      <!-- Facet Influence -->
      <div class="setting-group">
        <label>
          Facet Influence: {facetInfluence.toFixed(1)}
          <span class="help">How strongly to apply persona facet traits</span>
        </label>
        <input
          type="range"
          min="0"
          max="1"
          step="0.1"
          bind:value={facetInfluence}
          on:change={saveSettings}
        />
      </div>

      <!-- Temperature -->
      <div class="setting-group">
        <label>
          Temperature: {temperature.toFixed(2)}
          <span class="help">Model creativity (0 = deterministic, 1 = very creative)</span>
        </label>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          bind:value={temperature}
          on:change={saveSettings}
        />
      </div>

      <!-- Semantic Search Threshold -->
      <div class="setting-group">
        <label>
          Memory Relevance: {semanticSearchThreshold.toFixed(2)}
          <span class="help">Minimum similarity for memory retrieval</span>
        </label>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          bind:value={semanticSearchThreshold}
          on:change={saveSettings}
        />
      </div>

      <!-- Max Context Chars -->
      <div class="setting-group">
        <label>
          Max Context Size: {maxContextChars} chars
          <span class="help">Maximum context characters in prompts</span>
        </label>
        <input
          type="range"
          min="200"
          max="4000"
          step="100"
          bind:value={maxContextChars}
          on:change={saveSettings}
        />
      </div>

      <!-- Max History Messages -->
      <div class="setting-group">
        <label>
          Max History: {maxHistoryMessages} messages
          <span class="help">Maximum conversation history to retain</span>
        </label>
        <input
          type="range"
          min="5"
          max="100"
          step="5"
          bind:value={maxHistoryMessages}
          on:change={saveSettings}
        />
      </div>

      <!-- User Input Priority -->
      <div class="setting-group">
        <label class="checkbox-label">
          <input
            type="checkbox"
            bind:checked={userInputPriority}
            on:change={saveSettings}
          />
          Prioritize User Input
          <span class="help">Always focus on current question over context</span>
        </label>
      </div>

      <!-- Inner Dialog History Settings -->
      <h4 style="margin-top: 1.5rem;">Inner Dialog Display</h4>

      <!-- Inner Dialog History Limit -->
      <div class="setting-group">
        <label>
          Inner Dialog Messages: {innerDialogHistoryLimit}
          <span class="help">Max messages (reflections/dreams) to display in Inner Dialog tab</span>
        </label>
        <input
          type="range"
          min="20"
          max="500"
          step="10"
          bind:value={innerDialogHistoryLimit}
          on:change={saveSettings}
        />
      </div>

      <!-- Inner Dialog History Days -->
      <div class="setting-group">
        <label>
          Inner Dialog History: {innerDialogHistoryDays} days
          <span class="help">Days of audit logs to scan for reflections/dreams</span>
        </label>
        <input
          type="range"
          min="1"
          max="365"
          step="1"
          bind:value={innerDialogHistoryDays}
          on:change={saveSettings}
        />
      </div>

      {#if saving}
        <p class="saving">Saving...</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .chat-settings {
    padding: 1rem;
    color: var(--color-text, #e0e0e0);
  }

  h3 {
    margin: 0 0 1rem 0;
    font-size: 1.2rem;
    color: var(--color-heading, #ffffff);
  }

  h4 {
    margin: 1.5rem 0 0.75rem 0;
    font-size: 1rem;
    color: var(--color-subheading, #cccccc);
  }

  .scope-info {
    background: rgba(255, 255, 255, 0.05);
    border-radius: 6px;
    padding: 0.75rem;
    margin-bottom: 1rem;
  }

  .scope-info p {
    margin: 0.25rem 0;
    font-size: 0.9rem;
  }

  .help-text {
    color: var(--color-muted, #999);
    font-size: 0.85rem;
  }

  .badge {
    background: var(--color-primary, #8b5cf6);
    color: white;
    padding: 0.15rem 0.5rem;
    border-radius: 12px;
    font-size: 0.75rem;
    margin-left: 0.5rem;
  }

  .presets {
    margin-bottom: 1.5rem;
  }

  .preset-buttons {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 0.5rem;
  }

  .preset-btn {
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.15);
    color: var(--color-text, #e0e0e0);
    padding: 0.75rem;
    border-radius: 6px;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.25rem;
    transition: all 0.2s;
    font-size: 0.9rem;
  }

  .preset-btn:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.12);
    border-color: rgba(255, 255, 255, 0.3);
  }

  .preset-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .preset-desc {
    font-size: 0.75rem;
    color: var(--color-muted, #999);
  }

  .setting-group {
    margin-bottom: 1.25rem;
  }

  label {
    display: block;
    margin-bottom: 0.5rem;
    font-size: 0.9rem;
    font-weight: 500;
  }

  .help {
    display: block;
    font-size: 0.75rem;
    color: var(--color-muted, #999);
    font-weight: normal;
    margin-top: 0.15rem;
  }

  input[type="range"] {
    width: 100%;
    height: 6px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 3px;
    outline: none;
    -webkit-appearance: none;
  }

  input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 16px;
    height: 16px;
    background: var(--color-primary, #8b5cf6);
    border-radius: 50%;
    cursor: pointer;
  }

  input[type="range"]::-moz-range-thumb {
    width: 16px;
    height: 16px;
    background: var(--color-primary, #8b5cf6);
    border-radius: 50%;
    cursor: pointer;
    border: none;
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
  }

  input[type="checkbox"] {
    width: 18px;
    height: 18px;
    cursor: pointer;
  }

  .loading,
  .saving {
    color: var(--color-muted, #999);
    font-size: 0.9rem;
    font-style: italic;
  }
</style>
