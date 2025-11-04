<script lang="ts">
  import { sleepStatus } from '../lib/stores/sleep-status'
  import { marked } from 'marked'

  let learningsHtml = ''
  $: statusLabel = $sleepStatus ? $sleepStatus.status.charAt(0).toUpperCase() + $sleepStatus.status.slice(1) : 'Loading'
  $: latestFile = $sleepStatus?.learningsFile ?? null
  $: lastChecked = $sleepStatus ? new Date($sleepStatus.lastChecked).toLocaleString() : null

  $: if ($sleepStatus) {
    const content = $sleepStatus.learningsContent
    learningsHtml = content ? marked.parse(content) : ''
  }
</script>

<div class="learnings-container">
  <header class="learnings-header">
    <div>
      <h2>Overnight Learnings</h2>
      <p class="subtitle">Summaries generated after the last dreaming cycle.</p>
    </div>
    <div class="status">
      <span class="label">Status:</span>
      <span class="value">{statusLabel}</span>
    </div>
  </header>

  {#if !$sleepStatus}
    <div class="placeholder">Loading sleep status…</div>
  {:else if !$sleepStatus.learningsContent}
    <div class="placeholder">
      <p>No overnight learnings available yet.</p>
      <p class="hint">Run the sleep pipeline or wait for the next nightly cycle.</p>
      {#if lastChecked}
        <p class="timestamp">Last checked {lastChecked}</p>
      {/if}
    </div>
  {:else}
    <div class="learnings-meta">
      {#if latestFile}
        <span class="file">Latest file: {latestFile}</span>
      {/if}
      {#if lastChecked}
        <span class="timestamp">Updated {lastChecked}</span>
      {/if}
    </div>
    <article class="prose dark:prose-invert max-w-none">
      {@html learningsHtml}
    </article>
  {/if}
</div>

<style>
  .learnings-container {
    height: 100%;
    overflow-y: auto;
    padding: 1.5rem;
    background: linear-gradient(180deg, rgba(30, 41, 59, 0.04) 0%, rgba(15, 23, 42, 0.02) 100%);
  }

  .learnings-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1.5rem;
    gap: 1rem;
  }

  .learnings-header h2 {
    margin: 0;
    font-size: 1.5rem;
  }

  .subtitle {
    margin: 0.25rem 0 0;
    color: rgb(100 116 139);
  }

  :global(.dark) .subtitle {
    color: rgb(148 163 184);
  }

  .status {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.875rem;
    color: rgb(100 116 139);
  }

  .status .value {
    font-weight: 600;
    text-transform: capitalize;
  }

  .placeholder {
    padding: 2rem;
    border: 1px dashed rgba(148, 163, 184, 0.4);
    border-radius: 1rem;
    text-align: center;
    color: rgb(100 116 139);
  }

  .placeholder .hint {
    margin-top: 0.5rem;
    font-size: 0.875rem;
    color: rgb(148 163 184);
  }

  .placeholder .timestamp {
    margin-top: 0.75rem;
    font-size: 0.75rem;
    color: rgb(148 163 184);
  }

  .learnings-meta {
    display: flex;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 0.75rem;
    margin-bottom: 1.5rem;
    font-size: 0.8125rem;
    color: rgb(100 116 139);
  }

  :global(.dark) .learnings-meta {
    color: rgb(148 163 184);
  }

  .learnings-meta .timestamp {
    font-style: italic;
  }
</style>
