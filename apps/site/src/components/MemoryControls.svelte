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

<div class="relative">
  <!-- Help Link -->
  <a href="/user-guide#memory-system" class="help-link" title="Memory System User Guide">
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10"></circle>
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
      <line x1="12" y1="17" x2="12.01" y2="17"></line>
    </svg>
  </a>

  <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
    <!-- Memory Pruner Card -->
    <div class="card">
      <div class="ctrl-card-header">
        <div class="flex items-center gap-2">
          <span class="text-lg">🧹</span>
          <h3 class="m-0 text-[0.95rem] font-semibold">Memory Pruner</h3>
        </div>
        <div class="flex items-center gap-2">
          <button class="btn-secondary text-sm py-1.5 px-3" on:click={() => prunerShowSettings = !prunerShowSettings}>⚙️</button>
          <button class="btn-secondary text-sm py-1.5 px-3" on:click={() => runPruner(true)} disabled={prunerRunning}>{prunerRunning ? '…' : 'Preview'}</button>
          <button class="btn-primary text-sm py-1.5 px-3" on:click={() => runPruner(false)} disabled={prunerRunning}>{prunerRunning ? 'Running…' : 'Run Pruner'}</button>
        </div>
      </div>
      <div class="p-3.5">
        <p class="m-0 mb-2 text-[0.8125rem] text-gray-500 dark:text-gray-400 leading-snug">
          <strong>Rule-based cleanup:</strong> Removes duplicates (exact & near-matches),
          contamination patterns, and low-quality content. <em>Fast, no LLM required.</em>
        </p>

        {#if prunerShowSettings}
          <div class="settings-panel">
            <div class="setting-row">
              <label for="min-length">Min Content Length</label>
              <div class="flex items-center gap-2">
                <input type="range" class="w-[100px] accent-violet-600" id="min-length" bind:value={prunerMinLength} min="5" max="50" step="5" />
                <span class="text-xs text-gray-500 dark:text-gray-400 min-w-[50px] text-right">{prunerMinLength} chars</span>
              </div>
            </div>
            <div class="setting-row">
              <label for="similarity">Similarity Threshold</label>
              <div class="flex items-center gap-2">
                <input type="range" class="w-[100px] accent-violet-600" id="similarity" bind:value={prunerSimilarity} min="0.7" max="0.95" step="0.05" />
                <span class="text-xs text-gray-500 dark:text-gray-400 min-w-[50px] text-right">{(prunerSimilarity * 100).toFixed(0)}%</span>
              </div>
            </div>
            <div class="setting-row">
              <label for="auto-rebuild" class="flex items-center gap-2">
                <input type="checkbox" id="auto-rebuild" bind:checked={prunerAutoRebuild} />
                Auto-rebuild search index after pruning
              </label>
            </div>
            <div class="mt-3 text-xs text-gray-500 dark:text-gray-400">
              <strong>Detection patterns:</strong>
              <ul class="mt-1 ml-4 list-disc">
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
          <div class="banner banner-error mt-2 text-sm">⚠️ {prunerError}</div>
        {:else if prunerSuccess}
          <div class="banner banner-success mt-2 text-sm">✓ Pruner started. Check Agent Monitor for progress. View results in "Pruned" tab.</div>
        {/if}
      </div>
    </div>

    <!-- Curator Card -->
    <div class="card">
      <div class="ctrl-card-header">
        <div class="flex items-center gap-2">
          <span class="text-lg">📋</span>
          <h3 class="m-0 text-[0.95rem] font-semibold">Training Curator</h3>
        </div>
        <div class="flex items-center gap-2">
          <button class="btn-secondary text-sm py-1.5 px-3" on:click={() => curatorShowSettings = !curatorShowSettings}>⚙️</button>
          <button class="btn-primary text-sm py-1.5 px-3" on:click={runCurator} disabled={curatorRunning}>{curatorRunning ? 'Running…' : 'Run Curator'}</button>
        </div>
      </div>
      <div class="p-3.5">
        <p class="m-0 mb-2 text-[0.8125rem] text-gray-500 dark:text-gray-400 leading-snug">
          <strong>LLM-based quality evaluation:</strong> Analyzes each memory for training suitability,
          extracts clean conversation pairs, and filters unsuitable content.
        </p>

        {#if curatorShowSettings}
          <div class="settings-panel">
            <div class="setting-row">
              <label for="curator-temp">LLM Temperature</label>
              <div class="flex items-center gap-2">
                <input type="range" class="w-[100px] accent-violet-600" id="curator-temp" bind:value={curatorTemperature} min="0" max="1" step="0.1" />
                <span class="text-xs text-gray-500 dark:text-gray-400 min-w-[50px] text-right">{curatorTemperature.toFixed(1)}</span>
              </div>
            </div>
            <div class="mt-3 text-xs text-gray-500 dark:text-gray-400">
              <strong>Quality criteria (LLM judges):</strong>
              <ul class="mt-1 ml-4 list-disc">
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
          <div class="banner banner-error mt-2 text-sm">⚠️ {curatorError}</div>
        {:else if curatorSuccess}
          <div class="banner banner-success mt-2 text-sm">✓ Curator started. Check Agent Monitor for progress.</div>
        {/if}
      </div>
    </div>

    <!-- Organizer Card -->
    <div class="card">
      <div class="ctrl-card-header">
        <div class="flex items-center gap-2">
          <span class="text-lg">🏷️</span>
          <h3 class="m-0 text-[0.95rem] font-semibold">Memory Organizer</h3>
        </div>
        <div class="flex items-center gap-2">
          <button class="btn-primary text-sm py-1.5 px-3" on:click={runOrganizer} disabled={organizerRunning}>{organizerRunning ? 'Running…' : 'Run Organizer'}</button>
        </div>
      </div>
      <div class="p-3.5">
        <p class="m-0 mb-2 text-[0.8125rem] text-gray-500 dark:text-gray-400 leading-snug">
          Enriches memories with tags and entities using LLM analysis.
          Improves search and retrieval quality.
        </p>
        {#if organizerError}
          <div class="banner banner-error mt-2 text-sm">⚠️ {organizerError}</div>
        {:else if organizerSuccess}
          <div class="banner banner-success mt-2 text-sm">✓ Organizer started in background. Check Agent Monitor for progress.</div>
        {/if}
      </div>
    </div>

    <!-- Search Index Card -->
    <div class="card">
      <div class="ctrl-card-header">
        <div class="flex items-center gap-2">
          <span class="text-lg">🔍</span>
          <h3 class="m-0 text-[0.95rem] font-semibold">Search Index</h3>
        </div>
        <div class="flex items-center gap-2">
          <button class="btn-secondary text-sm py-1.5 px-3" on:click={loadIndexStatus} disabled={loadingIndex}>{loadingIndex ? '…' : 'Refresh'}</button>
          <button class="btn-primary text-sm py-1.5 px-3" on:click={buildIndex} disabled={buildingIndex}>{buildingIndex ? 'Building…' : 'Rebuild'}</button>
        </div>
      </div>
      <div class="p-3.5">
        {#if indexError}
          <div class="banner banner-error text-sm">⚠️ {indexError}</div>
        {:else if loadingIndex}
          <div class="text-gray-500 dark:text-gray-400 text-sm">Loading index status…</div>
        {:else if indexStatus}
          <div class="grid grid-cols-2 gap-2">
            <div class="flex flex-col gap-0.5">
              <span class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Status</span>
              <span class="text-[0.9rem] font-medium" class:text-green-600={indexStatus.exists} class:text-amber-500={!indexStatus.exists}>
                {indexStatus.exists ? 'Ready' : 'Not built'}
              </span>
            </div>
            {#if indexStatus.exists}
              <div class="flex flex-col gap-0.5">
                <span class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Items</span>
                <span class="text-[0.9rem] font-medium">{indexStatus.items?.toLocaleString()}</span>
              </div>
              <div class="flex flex-col gap-0.5">
                <span class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Model</span>
                <span class="text-[0.8125rem]">{indexStatus.model}</span>
              </div>
              <div class="flex flex-col gap-0.5">
                <span class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Built</span>
                <span class="text-[0.8125rem]">{indexStatus.createdAt && new Date(indexStatus.createdAt).toLocaleDateString()}</span>
              </div>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  /* Help link - floating circle with icon */
  .help-link {
    @apply absolute -top-10 right-0 flex items-center justify-center w-7 h-7 rounded-full
           bg-violet-600/10 text-violet-600 dark:bg-violet-400/15 dark:text-violet-400
           no-underline transition-all z-10;
  }
  .help-link:hover {
    @apply bg-violet-600/20 dark:bg-violet-400/25 scale-110;
  }

  /* Card header with actions */
  .ctrl-card-header {
    @apply flex items-center justify-between py-3.5 px-4
           border-b border-black/5 dark:border-white/5 bg-black/[0.02] dark:bg-white/[0.02];
  }

  /* Settings panel - expandable config area */
  .settings-panel {
    @apply mt-3 p-3 rounded-lg bg-black/[0.03] dark:bg-white/[0.03] border border-black/5 dark:border-white/5;
  }

  /* Setting row - label + control */
  .setting-row {
    @apply flex items-center justify-between mb-2 text-[0.8125rem];
  }
  .setting-row label {
    @apply flex items-center gap-2;
  }
</style>
