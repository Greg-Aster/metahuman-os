<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import { apiFetch } from '../lib/client/api-config';
  const dispatch = createEventDispatcher()

  // ============================================================================
  // Search Index State
  // ============================================================================
  type IndexStatus = { exists: boolean; model?: string; provider?: string; items?: number; createdAt?: string }
  let loadingIndex = false, buildingIndex = false, indexError: string | null = null
  let indexStatus: IndexStatus | null = null

  async function loadIndexStatus() {
    loadingIndex = true; indexError = null
    try {
      const res = await apiFetch('/api/index')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      indexStatus = await res.json()
    } catch (e) {
      indexError = (e as Error).message
      indexStatus = null
    } finally {
      loadingIndex = false
    }
  }

  async function buildIndex() {
    buildingIndex = true; indexError = null
    try {
      const res = await apiFetch('/api/index', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'build' })
      })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.error || 'Build failed')
      indexStatus = data.status
    } catch (e) {
      indexError = (e as Error).message
    } finally {
      buildingIndex = false
    }
  }

  // ============================================================================
  // Generic Agent Runner with Options
  // ============================================================================
  async function runAgent(name: string, options: Record<string, any> = {}): Promise<boolean> {
    try {
      const res = await apiFetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentName: name, options })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to start agent')
      return true
    } catch (e) {
      console.error(`Failed to run agent ${name}:`, e)
      return false
    }
  }

  // ============================================================================
  // Memory Pruner State & Settings
  // ============================================================================
  let prunerRunning = false
  let prunerSuccess = false
  let prunerError: string | null = null
  let prunerShowSettings = false

  // Pruner settings
  let prunerMinLength = 10
  let prunerSimilarity = 0.85
  let prunerAutoRebuild = true

  async function runPruner(dryRun: boolean = false) {
    prunerRunning = true
    prunerError = null
    prunerSuccess = false

    try {
      const success = await runAgent('memory-pruner', {
        dryRun,
        verbose: true,
        minLength: prunerMinLength,
        similarity: prunerSimilarity,
      })
      if (success) {
        prunerSuccess = true
        // Auto-rebuild index if enabled and not a dry run
        if (!dryRun && prunerAutoRebuild) {
          setTimeout(() => {
            buildIndex()
          }, 2000) // Give pruner a moment to finish
        }
      } else {
        prunerError = 'Failed to start pruner'
      }
    } catch (e) {
      prunerError = (e as Error).message
    } finally {
      prunerRunning = false
    }
  }

  // ============================================================================
  // Curator State & Settings
  // ============================================================================
  let curatorRunning = false
  let curatorError: string | null = null
  let curatorSuccess = false
  let curatorShowSettings = false

  // Curator settings
  let curatorTemperature = 0.3

  async function runCurator() {
    curatorRunning = true
    curatorError = null
    curatorSuccess = false

    try {
      const success = await runAgent('curator', {
        temperature: curatorTemperature,
      })
      if (success) {
        curatorSuccess = true
      } else {
        curatorError = 'Failed to start curator'
      }
    } catch (e) {
      curatorError = (e as Error).message
    } finally {
      curatorRunning = false
    }
  }

  // ============================================================================
  // Organizer State
  // ============================================================================
  let organizerRunning = false
  let organizerError: string | null = null
  let organizerSuccess = false

  async function runOrganizer() {
    organizerRunning = true
    organizerError = null
    organizerSuccess = false

    try {
      const success = await runAgent('organizer')
      if (success) {
        organizerSuccess = true
      } else {
        organizerError = 'Failed to start organizer'
      }
    } catch (e) {
      organizerError = (e as Error).message
    } finally {
      organizerRunning = false
    }
  }

  // Load initial status on mount
  loadIndexStatus()
</script>

<div class="memory-controls-wrapper">
  <!-- Help Link -->
  <a href="/user-guide#memory-system" class="help-link" title="Memory System User Guide">
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10"></circle>
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
      <line x1="12" y1="17" x2="12.01" y2="17"></line>
    </svg>
  </a>

  <div class="memory-controls">
    <!-- Memory Pruner Card -->
  <div class="card card-expanded">
    <div class="card-header">
      <div class="header-title">
        <span class="icon">🧹</span>
        <h3>Memory Pruner</h3>
      </div>
      <div class="actions">
        <button class="btn btn-secondary" on:click={() => prunerShowSettings = !prunerShowSettings}>
          ⚙️
        </button>
        <button class="btn btn-secondary" on:click={() => runPruner(true)} disabled={prunerRunning}>
          {prunerRunning ? '…' : 'Preview'}
        </button>
        <button class="btn btn-primary" on:click={() => runPruner(false)} disabled={prunerRunning}>
          {prunerRunning ? 'Running…' : 'Run Pruner'}
        </button>
      </div>
    </div>
    <div class="card-body">
      <p class="description">
        <strong>Rule-based cleanup:</strong> Removes duplicates (exact & near-matches),
        contamination patterns, and low-quality content. <em>Fast, no LLM required.</em>
      </p>

      {#if prunerShowSettings}
        <div class="settings-panel">
          <div class="setting-row">
            <label for="min-length">Min Content Length</label>
            <div class="setting-control">
              <input type="range" id="min-length" bind:value={prunerMinLength} min="5" max="50" step="5" />
              <span class="setting-value">{prunerMinLength} chars</span>
            </div>
          </div>
          <div class="setting-row">
            <label for="similarity">Similarity Threshold</label>
            <div class="setting-control">
              <input type="range" id="similarity" bind:value={prunerSimilarity} min="0.7" max="0.95" step="0.05" />
              <span class="setting-value">{(prunerSimilarity * 100).toFixed(0)}%</span>
            </div>
          </div>
          <div class="setting-row">
            <label for="auto-rebuild">
              <input type="checkbox" id="auto-rebuild" bind:checked={prunerAutoRebuild} />
              Auto-rebuild search index after pruning
            </label>
          </div>
          <div class="setting-info">
            <strong>Detection patterns:</strong>
            <ul>
              <li>Exact duplicates (MD5 hash match)</li>
              <li>Near-duplicates ({(prunerSimilarity * 100).toFixed(0)}%+ word overlap)</li>
              <li>Contamination: "you ok home", "test test test", single-word replies</li>
              <li>AI disclaimers: "As an AI...", "I cannot..."</li>
              <li>System artifacts: JSON, XML, error messages</li>
            </ul>
          </div>
        </div>
      {/if}

      {#if prunerError}
        <div class="note error">⚠️ {prunerError}</div>
      {:else if prunerSuccess}
        <div class="note ok">✓ Pruner started. Check Agent Monitor for progress. View results in "Pruned" tab.</div>
      {/if}
    </div>
  </div>

  <!-- Curator Card -->
  <div class="card card-expanded">
    <div class="card-header">
      <div class="header-title">
        <span class="icon">📋</span>
        <h3>Training Curator</h3>
      </div>
      <div class="actions">
        <button class="btn btn-secondary" on:click={() => curatorShowSettings = !curatorShowSettings}>
          ⚙️
        </button>
        <button class="btn btn-primary" on:click={runCurator} disabled={curatorRunning}>
          {curatorRunning ? 'Running…' : 'Run Curator'}
        </button>
      </div>
    </div>
    <div class="card-body">
      <p class="description">
        <strong>LLM-based quality evaluation:</strong> Analyzes each memory for training suitability,
        extracts clean conversation pairs, and filters unsuitable content.
      </p>

      {#if curatorShowSettings}
        <div class="settings-panel">
          <div class="setting-row">
            <label for="curator-temp">LLM Temperature</label>
            <div class="setting-control">
              <input type="range" id="curator-temp" bind:value={curatorTemperature} min="0" max="1" step="0.1" />
              <span class="setting-value">{curatorTemperature.toFixed(1)}</span>
            </div>
          </div>
          <div class="setting-info">
            <strong>Quality criteria (LLM judges):</strong>
            <ul>
              <li>✓ Natural, coherent conversation</li>
              <li>✓ Reflects persona accurately</li>
              <li>✓ Meaningful exchange with substance</li>
              <li>✗ Repetitive phrases (3+ times)</li>
              <li>✗ System artifacts (JSON, tools, errors)</li>
              <li>✗ AI disclaimers / model confusion</li>
              <li>✗ Empty or near-empty responses</li>
            </ul>
          </div>
        </div>
      {/if}

      {#if curatorError}
        <div class="note error">⚠️ {curatorError}</div>
      {:else if curatorSuccess}
        <div class="note ok">✓ Curator started. Check Agent Monitor for progress.</div>
      {/if}
    </div>
  </div>

  <!-- Organizer Card -->
  <div class="card">
    <div class="card-header">
      <div class="header-title">
        <span class="icon">🏷️</span>
        <h3>Memory Organizer</h3>
      </div>
      <div class="actions">
        <button class="btn btn-primary" on:click={runOrganizer} disabled={organizerRunning}>
          {organizerRunning ? 'Running…' : 'Run Organizer'}
        </button>
      </div>
    </div>
    <div class="card-body">
      <p class="description">
        Enriches memories with tags and entities using LLM analysis.
        Improves search and retrieval quality.
      </p>
      {#if organizerError}
        <div class="note error">⚠️ {organizerError}</div>
      {:else if organizerSuccess}
        <div class="note ok">✓ Organizer started in background. Check Agent Monitor for progress.</div>
      {/if}
    </div>
  </div>

  <!-- Search Index Card -->
  <div class="card">
    <div class="card-header">
      <div class="header-title">
        <span class="icon">🔍</span>
        <h3>Search Index</h3>
      </div>
      <div class="actions">
        <button class="btn btn-secondary" on:click={loadIndexStatus} disabled={loadingIndex}>
          {loadingIndex ? '…' : 'Refresh'}
        </button>
        <button class="btn btn-primary" on:click={buildIndex} disabled={buildingIndex}>
          {buildingIndex ? 'Building…' : 'Rebuild'}
        </button>
      </div>
    </div>
    <div class="card-body">
      {#if indexError}
        <div class="note error">⚠️ {indexError}</div>
      {:else if loadingIndex}
        <div class="muted">Loading index status…</div>
      {:else if indexStatus}
        <div class="stats-grid">
          <div class="stat">
            <span class="stat-label">Status</span>
            <span class="stat-value" class:ok={indexStatus.exists} class:warn={!indexStatus.exists}>
              {indexStatus.exists ? 'Ready' : 'Not built'}
            </span>
          </div>
          {#if indexStatus.exists}
            <div class="stat">
              <span class="stat-label">Items</span>
              <span class="stat-value">{indexStatus.items?.toLocaleString()}</span>
            </div>
            <div class="stat">
              <span class="stat-label">Model</span>
              <span class="stat-value small">{indexStatus.model}</span>
            </div>
            <div class="stat">
              <span class="stat-label">Built</span>
              <span class="stat-value small">{indexStatus.createdAt && new Date(indexStatus.createdAt).toLocaleDateString()}</span>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  </div>
  </div>
</div>

<style>
  .memory-controls-wrapper {
    position: relative;
  }

  .help-link {
    position: absolute;
    top: -2.5rem;
    right: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: rgba(124, 58, 237, 0.1);
    color: rgb(124, 58, 237);
    text-decoration: none;
    transition: all 0.15s ease;
    z-index: 10;
  }

  .help-link:hover {
    background: rgba(124, 58, 237, 0.2);
    transform: scale(1.1);
  }

  :global(.dark) .help-link {
    background: rgba(167, 139, 250, 0.15);
    color: rgb(167, 139, 250);
  }

  :global(.dark) .help-link:hover {
    background: rgba(167, 139, 250, 0.25);
  }

  .memory-controls {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1rem;
    margin-bottom: 1.5rem;
  }

  @media (max-width: 900px) {
    .memory-controls {
      grid-template-columns: 1fr;
    }
  }

  .card {
    border: 1px solid rgba(0,0,0,0.1);
    border-radius: 0.75rem;
    background: white;
    overflow: hidden;
  }

  .card-expanded {
    grid-column: span 1;
  }

  :global(.dark) .card {
    border-color: rgba(255,255,255,0.1);
    background: rgba(255,255,255,0.05);
  }

  .card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.875rem 1rem;
    border-bottom: 1px solid rgba(0,0,0,0.08);
    background: rgba(0,0,0,0.02);
  }

  :global(.dark) .card-header {
    border-bottom-color: rgba(255,255,255,0.08);
    background: rgba(255,255,255,0.02);
  }

  .header-title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .header-title h3 {
    margin: 0;
    font-size: 0.95rem;
    font-weight: 600;
  }

  .icon {
    font-size: 1.1rem;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .card-body {
    padding: 0.875rem 1rem;
  }

  .description {
    margin: 0 0 0.5rem 0;
    font-size: 0.8125rem;
    color: rgb(107 114 128);
    line-height: 1.4;
  }

  :global(.dark) .description {
    color: rgb(156 163 175);
  }

  /* Settings Panel */
  .settings-panel {
    margin-top: 0.75rem;
    padding: 0.75rem;
    background: rgba(0,0,0,0.03);
    border-radius: 0.5rem;
    border: 1px solid rgba(0,0,0,0.06);
  }

  :global(.dark) .settings-panel {
    background: rgba(255,255,255,0.03);
    border-color: rgba(255,255,255,0.06);
  }

  .setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.5rem;
    font-size: 0.8125rem;
  }

  .setting-row label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .setting-control {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .setting-control input[type="range"] {
    width: 100px;
    accent-color: rgb(124 58 237);
  }

  .setting-value {
    font-size: 0.75rem;
    color: rgb(107 114 128);
    min-width: 50px;
    text-align: right;
  }

  :global(.dark) .setting-value {
    color: rgb(156 163 175);
  }

  .setting-info {
    margin-top: 0.75rem;
    font-size: 0.75rem;
    color: rgb(107 114 128);
  }

  :global(.dark) .setting-info {
    color: rgb(156 163 175);
  }

  .setting-info ul {
    margin: 0.25rem 0 0 1rem;
    padding: 0;
    list-style: disc;
  }

  .setting-info li {
    margin-bottom: 0.125rem;
  }

  .btn {
    padding: 0.4rem 0.75rem;
    border-radius: 0.375rem;
    border: 1px solid transparent;
    cursor: pointer;
    font-weight: 500;
    font-size: 0.8125rem;
    transition: all 0.15s;
  }

  .btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .btn-primary {
    background: rgb(124 58 237);
    color: white;
  }

  .btn-primary:hover:not(:disabled) {
    background: rgb(109 40 217);
  }

  .btn-secondary {
    background: transparent;
    color: rgb(107 114 128);
    border-color: rgba(0,0,0,0.2);
  }

  :global(.dark) .btn-secondary {
    color: rgb(156 163 175);
    border-color: rgba(255,255,255,0.2);
  }

  .btn-secondary:hover:not(:disabled) {
    background: rgba(0,0,0,0.05);
  }

  :global(.dark) .btn-secondary:hover:not(:disabled) {
    background: rgba(255,255,255,0.05);
  }

  .note {
    margin-top: 0.5rem;
    font-size: 0.8125rem;
    padding: 0.5rem 0.75rem;
    border-radius: 0.375rem;
  }

  .note.error {
    color: rgb(153 27 27);
    background: rgba(220 38 38 / 0.1);
  }

  :global(.dark) .note.error {
    color: rgb(248 113 113);
    background: rgba(220 38 38 / 0.15);
  }

  .note.ok {
    color: rgb(22 101 52);
    background: rgba(34 197 94 / 0.1);
  }

  :global(.dark) .note.ok {
    color: rgb(74 222 128);
    background: rgba(34 197 94 / 0.15);
  }

  .muted {
    color: rgb(107 114 128);
    font-size: 0.875rem;
  }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.5rem;
  }

  .stat {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .stat-label {
    font-size: 0.75rem;
    color: rgb(107 114 128);
    text-transform: uppercase;
    letter-spacing: 0.025em;
  }

  :global(.dark) .stat-label {
    color: rgb(156 163 175);
  }

  .stat-value {
    font-size: 0.9rem;
    font-weight: 500;
  }

  .stat-value.small {
    font-size: 0.8125rem;
    font-weight: 400;
  }

  .stat-value.ok {
    color: rgb(22 163 74);
  }

  .stat-value.warn {
    color: rgb(202 138 4);
  }
</style>
