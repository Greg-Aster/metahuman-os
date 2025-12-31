<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  const dispatch = createEventDispatcher();

  // Props
  export let includePersona: boolean = true;
  export let percentages: Record<string, number> = {};
  export let disabled: boolean = false;

  // Memory type categories for grouping in UI
  // PRIMARY types are 100% included (user voice - most valuable)
  // SECONDARY types are added as a % OF the primary data (LLM-generated supplement)
  const memoryTypeGroups = {
    'Primary Data (100% Included)': [
      { key: 'conversation', label: 'Conversations', description: 'Direct chat messages - YOUR voice', isPrimary: true },
      { key: 'observation', label: 'Observations', description: 'User-captured notes and ingested content', isPrimary: true },
      { key: 'therapy_session', label: 'Therapy Sessions', description: 'In-depth personality Q&A sessions', isPrimary: true },
      { key: 'journal', label: 'Journal', description: 'Journal entries - YOUR writing', isPrimary: true },
    ],
    'Secondary Data (% of Primary)': [
      { key: 'reflection', label: 'Reflections', description: 'AI-generated insights (% of primary data)' },
      { key: 'reflection_summary', label: 'Reflection Summaries', description: 'Condensed reflection themes' },
      { key: 'inner_dialogue', label: 'Inner Dialogue', description: 'Internal thought processes' },
      { key: 'dream', label: 'Dreams', description: 'Dream narratives and symbols' },
      { key: 'curiosity_question', label: 'Curiosity Q&A', description: 'Self-directed questions and answers' },
    ],
    'Other Secondary': [
      { key: 'decision', label: 'Decisions', description: 'Decision-making records' },
      { key: 'summary', label: 'Summaries', description: 'Generated summaries (usually 0%)' },
    ],
  };

  // Default percentages (favoring user input)
  const defaultPercentages: Record<string, number> = {
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
  };

  // Initialize percentages with defaults if missing
  $: mergedPercentages = {
    ...defaultPercentages,
    ...percentages,
  };

  // Note: With new "pie chart" logic, percentages for secondary types mean
  // "% of primary data to include", not a slice of total. No 100% validation needed.
  $: totalPercentage = Object.values(mergedPercentages).reduce((sum, val) => sum + val, 0);
  $: isValid = true; // No longer need 100% total - secondary % are relative to primary

  // Handle slider change
  function handleSliderChange(key: string, event: Event) {
    const target = event.target as HTMLInputElement;
    const value = parseInt(target.value, 10);
    const newPercentages = { ...mergedPercentages, [key]: value };
    dispatch('percentagesChange', newPercentages);
  }

  // Handle persona toggle
  function handlePersonaChange(event: Event) {
    const target = event.target as HTMLInputElement;
    dispatch('personaChange', target.checked);
  }

  // Reset to defaults
  function resetToDefaults() {
    dispatch('percentagesChange', { ...defaultPercentages });
  }

  // Preset configurations
  function applyPreset(preset: 'balanced' | 'user-focused' | 'self-growth') {
    let newPercentages: Record<string, number>;

    switch (preset) {
      case 'balanced':
        newPercentages = { ...defaultPercentages };
        break;
      case 'user-focused':
        newPercentages = {
          conversation: 50,
          observation: 30,
          therapy_session: 15,
          reflection: 2,
          reflection_summary: 1,
          inner_dialogue: 1,
          dream: 0,
          curiosity_question: 1,
          decision: 0,
          journal: 0,
          summary: 0,
        };
        break;
      case 'self-growth':
        newPercentages = {
          conversation: 25,
          observation: 15,
          therapy_session: 10,
          reflection: 15,
          reflection_summary: 8,
          inner_dialogue: 10,
          dream: 8,
          curiosity_question: 5,
          decision: 2,
          journal: 2,
          summary: 0,
        };
        break;
      default:
        return;
    }

    dispatch('percentagesChange', newPercentages);
  }
</script>

<div class="training-data-controls" class:disabled>
  <!-- Persona Toggle -->
  <div class="control-section">
    <label class="toggle-row">
      <span class="toggle-label">
        <strong>Include Persona Data</strong>
        <span class="toggle-description">Include core personality traits and values in training</span>
      </span>
      <input
        type="checkbox"
        checked={includePersona}
        on:change={handlePersonaChange}
        {disabled}
      />
    </label>
  </div>

  <!-- Presets -->
  <div class="control-section">
    <h4>Quick Presets</h4>
    <div class="preset-buttons">
      <button
        class="preset-btn"
        on:click={() => applyPreset('balanced')}
        {disabled}
        title="Default balanced mix: conversations 40%, observations 25%, therapy 15%, self-generated lower"
      >
        Balanced (Default)
      </button>
      <button
        class="preset-btn"
        on:click={() => applyPreset('user-focused')}
        {disabled}
        title="Focus on user input: conversations 50%, observations 30%, minimal self-generated content"
      >
        User-Focused
      </button>
      <button
        class="preset-btn"
        on:click={() => applyPreset('self-growth')}
        {disabled}
        title="Increase self-generated content: reflections 15%, inner dialogue 10%, dreams 8%"
      >
        Self-Growth
      </button>
    </div>
  </div>

  <!-- Memory Type Sliders -->
  <div class="control-section">
    <div class="section-header">
      <h4>Memory Type Weights</h4>
      <span class="total-badge info">
        Primary = 100% | Secondary = % of primary
      </span>
    </div>

    {#each Object.entries(memoryTypeGroups) as [groupName, types]}
      <div class="type-group">
        <h5 class="group-title">{groupName}</h5>
        {#each types as type}
          <div class="slider-row">
            <div class="slider-info">
              <span class="slider-label">{type.label}</span>
              <span class="slider-value">{mergedPercentages[type.key]}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={mergedPercentages[type.key]}
              on:input={(e) => handleSliderChange(type.key, e)}
              {disabled}
              class="slider"
            />
            <span class="slider-description">{type.description}</span>
          </div>
        {/each}
      </div>
    {/each}

    <button
      class="reset-btn"
      on:click={resetToDefaults}
      {disabled}
    >
      Reset to Defaults
    </button>
  </div>

  <!-- Info Box -->
  <div class="info-box">
    <strong>How it works (Pie Chart Model):</strong>
    <br/>
    <em>Primary data</em> (conversations, observations, journals) = <strong>100% included</strong> — this is YOUR voice.
    <br/>
    <em>Secondary data</em> (reflections, dreams, etc.) = added as a <strong>% of primary</strong>.
    <br/><br/>
    <strong>Example:</strong> If you have 800 conversations + observations, and inner_dialogue is set to 3%,
    you get 800 + (800 × 3% = 24) = 824 total samples.
    <br/><br/>
    <strong>Tip:</strong> Ingest more of your writing (notes, journals, blog posts) to increase primary data.
    The more primary data you have, the more supplemental data gets included proportionally.
  </div>
</div>

<style>
  .training-data-controls {
    padding: 1rem;
    background: #f9fafb;
    border-radius: 8px;
    border: 1px solid #e5e7eb;
  }

  :global(.dark) .training-data-controls {
    background: #1f2937;
    border-color: #374151;
  }

  .training-data-controls.disabled {
    opacity: 0.6;
    pointer-events: none;
  }

  .control-section {
    margin-bottom: 1.5rem;
  }

  .control-section:last-of-type {
    margin-bottom: 0;
  }

  h4 {
    margin: 0 0 0.75rem 0;
    font-size: 0.875rem;
    font-weight: 600;
    color: #374151;
  }

  :global(.dark) h4 {
    color: #d1d5db;
  }

  h5.group-title {
    margin: 1rem 0 0.5rem 0;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    color: #6b7280;
    letter-spacing: 0.05em;
  }

  :global(.dark) h5.group-title {
    color: #9ca3af;
  }

  /* Toggle Row */
  .toggle-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.75rem;
    background: white;
    border-radius: 6px;
    border: 1px solid #e5e7eb;
    cursor: pointer;
  }

  :global(.dark) .toggle-row {
    background: #111827;
    border-color: #374151;
  }

  .toggle-label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .toggle-label strong {
    font-size: 0.875rem;
  }

  .toggle-description {
    font-size: 0.75rem;
    color: #6b7280;
  }

  .toggle-row input[type="checkbox"] {
    width: 1.25rem;
    height: 1.25rem;
    cursor: pointer;
  }

  /* Preset Buttons */
  .preset-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .preset-btn {
    padding: 0.5rem 1rem;
    background: white;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    font-size: 0.875rem;
    cursor: pointer;
    transition: all 0.15s;
  }

  :global(.dark) .preset-btn {
    background: #111827;
    border-color: #374151;
    color: #d1d5db;
  }

  .preset-btn:hover:not(:disabled) {
    background: #3b82f6;
    color: white;
    border-color: #3b82f6;
  }

  .preset-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Section Header */
  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.5rem;
  }

  .section-header h4 {
    margin: 0;
  }

  .total-badge {
    font-size: 0.75rem;
    font-weight: 600;
    padding: 0.25rem 0.5rem;
    background: #dcfce7;
    color: #166534;
    border-radius: 4px;
  }

  :global(.dark) .total-badge {
    background: #064e3b;
    color: #6ee7b7;
  }

  .total-badge.invalid {
    background: #fee2e2;
    color: #dc2626;
  }

  :global(.dark) .total-badge.invalid {
    background: #7f1d1d;
    color: #fca5a5;
  }

  .total-badge.info {
    background: #e0f2fe;
    color: #0369a1;
    font-size: 0.7rem;
  }

  :global(.dark) .total-badge.info {
    background: #0c4a6e;
    color: #7dd3fc;
  }

  .total-badge .warning {
    font-weight: normal;
  }

  /* Type Group */
  .type-group {
    padding: 0.75rem;
    background: white;
    border-radius: 6px;
    border: 1px solid #e5e7eb;
    margin-bottom: 0.75rem;
  }

  :global(.dark) .type-group {
    background: #111827;
    border-color: #374151;
  }

  .type-group h5 {
    margin-top: 0;
  }

  /* Slider Row */
  .slider-row {
    margin-bottom: 0.75rem;
  }

  .slider-row:last-child {
    margin-bottom: 0;
  }

  .slider-info {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.25rem;
  }

  .slider-label {
    font-size: 0.875rem;
    font-weight: 500;
  }

  .slider-value {
    font-size: 0.875rem;
    font-weight: 600;
    color: #3b82f6;
    min-width: 3rem;
    text-align: right;
  }

  :global(.dark) .slider-value {
    color: #60a5fa;
  }

  .slider {
    width: 100%;
    height: 6px;
    border-radius: 3px;
    background: #e5e7eb;
    appearance: none;
    cursor: pointer;
  }

  :global(.dark) .slider {
    background: #374151;
  }

  .slider::-webkit-slider-thumb {
    appearance: none;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #3b82f6;
    cursor: pointer;
    transition: transform 0.1s;
  }

  .slider::-webkit-slider-thumb:hover {
    transform: scale(1.2);
  }

  .slider::-moz-range-thumb {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #3b82f6;
    cursor: pointer;
    border: none;
  }

  .slider-description {
    font-size: 0.7rem;
    color: #6b7280;
    display: block;
    margin-top: 0.25rem;
  }

  :global(.dark) .slider-description {
    color: #9ca3af;
  }

  /* Reset Button */
  .reset-btn {
    margin-top: 1rem;
    padding: 0.5rem 1rem;
    background: #f3f4f6;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    font-size: 0.875rem;
    color: #374151;
    cursor: pointer;
    transition: all 0.15s;
  }

  :global(.dark) .reset-btn {
    background: #374151;
    border-color: #4b5563;
    color: #d1d5db;
  }

  .reset-btn:hover:not(:disabled) {
    background: #e5e7eb;
  }

  :global(.dark) .reset-btn:hover:not(:disabled) {
    background: #4b5563;
  }

  .reset-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Info Box */
  .info-box {
    margin-top: 1rem;
    padding: 1rem;
    background: #eff6ff;
    border: 1px solid #bfdbfe;
    border-radius: 6px;
    font-size: 0.8rem;
    color: #1e40af;
    line-height: 1.5;
  }

  :global(.dark) .info-box {
    background: #1e3a5f;
    border-color: #3b82f6;
    color: #93c5fd;
  }

  .info-box strong {
    display: block;
    margin-bottom: 0.25rem;
  }

  .info-box strong:not(:first-child) {
    margin-top: 0.5rem;
  }
</style>
