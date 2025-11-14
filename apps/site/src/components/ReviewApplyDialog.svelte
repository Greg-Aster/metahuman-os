<script lang="ts">
  export let reviewData: any;
  export let onApply: (strategy: 'replace' | 'merge' | 'append') => void;
  export let onDiscard: () => void;

  let selectedStrategy: 'replace' | 'merge' | 'append' = 'merge';
  let showTranscript = false;
  let showFullDiff = false;

  const strategyDescriptions = {
    replace: 'Completely replace existing persona with new data',
    merge: 'Intelligently merge new data with existing (recommended)',
    append: 'Add new data alongside existing without removing anything',
  };

  function formatValue(value: any): string {
    if (value === undefined || value === null) {
      return '(empty)';
    }
    if (typeof value === 'object') {
      return JSON.stringify(value, null, 2);
    }
    return String(value);
  }
</script>

<div class="dialog-overlay" on:click={onDiscard}>
  <div class="dialog-content" on:click|stopPropagation>
    <div class="dialog-header">
      <h2>Review Persona Changes</h2>
      <button class="close-btn" on:click={onDiscard}>×</button>
    </div>

    <div class="dialog-body">
      <!-- Summary Stats -->
      <div class="summary-stats">
        <div class="stat">
          <span class="stat-label">Additions</span>
          <span class="stat-value add">{reviewData.diff.summary.additions}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Updates</span>
          <span class="stat-value update">{reviewData.diff.summary.updates}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Confidence</span>
          <span class="stat-value">{Math.round(reviewData.confidence * 100)}%</span>
        </div>
      </div>

      <!-- Diff Preview -->
      <div class="section">
        <div class="section-header">
          <h3>Changes Preview</h3>
          <button class="toggle-btn" on:click={() => (showFullDiff = !showFullDiff)}>
            {showFullDiff ? 'Show Summary' : 'Show Full Diff'}
          </button>
        </div>

        {#if showFullDiff}
          <div class="diff-text">
            <pre>{reviewData.diff.text}</pre>
          </div>
        {:else}
          <div class="diff-changes">
            {#each reviewData.diff.changes.slice(0, 5) as change}
              {#if change.action !== 'no-change'}
                <div class="diff-item {change.action}">
                  <div class="diff-field">{change.field}</div>
                  <div class="diff-action">{change.action.toUpperCase()}</div>
                  {#if change.action === 'add'}
                    <div class="diff-value">
                      <span class="label">New:</span>
                      <span class="value">{formatValue(change.newValue)}</span>
                    </div>
                  {:else if change.action === 'update'}
                    <div class="diff-value">
                      <span class="label">Old:</span>
                      <span class="value">{formatValue(change.oldValue)}</span>
                    </div>
                    <div class="diff-value">
                      <span class="label">New:</span>
                      <span class="value">{formatValue(change.newValue)}</span>
                    </div>
                  {/if}
                </div>
              {/if}
            {/each}
            {#if reviewData.diff.changes.length > 5}
              <div class="more-changes">
                + {reviewData.diff.changes.length - 5} more changes
              </div>
            {/if}
          </div>
        {/if}
      </div>

      <!-- Merge Strategy Selector -->
      <div class="section">
        <h3>Merge Strategy</h3>
        <div class="strategy-options">
          {#each Object.entries(strategyDescriptions) as [strategy, description]}
            <label class="strategy-option">
              <input
                type="radio"
                name="strategy"
                value={strategy}
                bind:group={selectedStrategy}
              />
              <div class="strategy-details">
                <span class="strategy-name">{strategy}</span>
                <span class="strategy-desc">{description}</span>
              </div>
            </label>
          {/each}
        </div>
      </div>

      <!-- Optional: Transcript View -->
      <div class="section">
        <button class="toggle-btn" on:click={() => (showTranscript = !showTranscript)}>
          {showTranscript ? 'Hide' : 'View'} Full Transcript
        </button>

        {#if showTranscript}
          <div class="transcript">
            <p class="transcript-note">
              Interview transcript (not included in persona data)
            </p>
            <div class="transcript-content">
              {#if reviewData.extracted}
                <pre>{JSON.stringify(reviewData.extracted, null, 2)}</pre>
              {/if}
            </div>
          </div>
        {/if}
      </div>
    </div>

    <div class="dialog-footer">
      <button class="secondary" on:click={onDiscard}>
        Cancel
      </button>
      <button class="primary" on:click={() => onApply(selectedStrategy)}>
        Apply Changes ({selectedStrategy})
      </button>
    </div>
  </div>
</div>

<style>
  .dialog-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.75);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 2rem;
  }

  .dialog-content {
    background: #1f2937;
    border-radius: 0.5rem;
    max-width: 900px;
    width: 100%;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    color: #e5e7eb;
  }

  .dialog-header {
    padding: 1.5rem;
    border-bottom: 1px solid #374151;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .dialog-header h2 {
    margin: 0;
    color: #f9fafb;
  }

  .close-btn {
    background: none;
    border: none;
    color: #9ca3af;
    font-size: 2rem;
    cursor: pointer;
    padding: 0;
    width: 2rem;
    height: 2rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 0.25rem;
  }

  .close-btn:hover {
    background: #374151;
    color: #f9fafb;
  }

  .dialog-body {
    padding: 1.5rem;
    overflow-y: auto;
    flex: 1;
  }

  .summary-stats {
    display: flex;
    gap: 1rem;
    margin-bottom: 1.5rem;
  }

  .stat {
    flex: 1;
    background: #111827;
    padding: 1rem;
    border-radius: 0.375rem;
    text-align: center;
  }

  .stat-label {
    display: block;
    font-size: 0.75rem;
    color: #9ca3af;
    margin-bottom: 0.5rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .stat-value {
    display: block;
    font-size: 1.5rem;
    font-weight: 700;
    color: #f9fafb;
  }

  .stat-value.add {
    color: #10b981;
  }

  .stat-value.update {
    color: #3b82f6;
  }

  .section {
    margin-bottom: 1.5rem;
  }

  .section h3 {
    margin: 0 0 1rem 0;
    color: #f9fafb;
    font-size: 1rem;
  }

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
  }

  .section-header h3 {
    margin: 0;
  }

  .toggle-btn {
    padding: 0.5rem 1rem;
    background: #374151;
    color: #e5e7eb;
    border: none;
    border-radius: 0.375rem;
    cursor: pointer;
    font-size: 0.85rem;
  }

  .toggle-btn:hover {
    background: #4b5563;
  }

  .diff-text {
    background: #111827;
    border-radius: 0.375rem;
    padding: 1rem;
    overflow-x: auto;
  }

  .diff-text pre {
    margin: 0;
    font-family: 'Courier New', monospace;
    font-size: 0.85rem;
    line-height: 1.6;
    color: #e5e7eb;
  }

  .diff-changes {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .diff-item {
    background: #111827;
    border-left: 3px solid;
    padding: 1rem;
    border-radius: 0.375rem;
  }

  .diff-item.add {
    border-left-color: #10b981;
  }

  .diff-item.update {
    border-left-color: #3b82f6;
  }

  .diff-item.remove {
    border-left-color: #ef4444;
  }

  .diff-field {
    font-weight: 600;
    color: #f9fafb;
    margin-bottom: 0.5rem;
  }

  .diff-action {
    display: inline-block;
    padding: 0.25rem 0.5rem;
    background: #374151;
    border-radius: 0.25rem;
    font-size: 0.75rem;
    font-weight: 600;
    margin-bottom: 0.75rem;
  }

  .diff-value {
    margin-bottom: 0.5rem;
    font-size: 0.9rem;
  }

  .diff-value .label {
    color: #9ca3af;
    margin-right: 0.5rem;
  }

  .diff-value .value {
    color: #e5e7eb;
    font-family: monospace;
  }

  .more-changes {
    text-align: center;
    color: #9ca3af;
    font-size: 0.85rem;
    font-style: italic;
    padding: 0.5rem;
  }

  .strategy-options {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .strategy-option {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 1rem;
    background: #111827;
    border-radius: 0.375rem;
    cursor: pointer;
    border: 2px solid transparent;
    transition: all 0.2s;
  }

  .strategy-option:hover {
    background: #1f2937;
    border-color: #374151;
  }

  .strategy-option:has(input:checked) {
    border-color: #3b82f6;
    background: #1e3a8a;
  }

  .strategy-option input[type='radio'] {
    margin-top: 0.25rem;
    cursor: pointer;
  }

  .strategy-details {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .strategy-name {
    font-weight: 600;
    color: #f9fafb;
    text-transform: capitalize;
  }

  .strategy-desc {
    font-size: 0.85rem;
    color: #9ca3af;
  }

  .transcript {
    margin-top: 1rem;
  }

  .transcript-note {
    margin: 0 0 0.75rem 0;
    color: #9ca3af;
    font-size: 0.85rem;
    font-style: italic;
  }

  .transcript-content {
    background: #111827;
    border-radius: 0.375rem;
    padding: 1rem;
    max-height: 400px;
    overflow-y: auto;
  }

  .transcript-content pre {
    margin: 0;
    font-family: 'Courier New', monospace;
    font-size: 0.85rem;
    line-height: 1.6;
    color: #e5e7eb;
  }

  .dialog-footer {
    padding: 1.5rem;
    border-top: 1px solid #374151;
    display: flex;
    gap: 1rem;
    justify-content: flex-end;
  }

  button {
    padding: 0.75rem 1.5rem;
    border-radius: 0.375rem;
    border: none;
    font-size: 0.95rem;
    cursor: pointer;
    transition: all 0.2s;
  }

  button.primary {
    background: #3b82f6;
    color: white;
  }

  button.primary:hover {
    background: #2563eb;
  }

  button.secondary {
    background: #374151;
    color: #e5e7eb;
  }

  button.secondary:hover {
    background: #4b5563;
  }
</style>
