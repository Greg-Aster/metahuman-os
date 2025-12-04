<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import { apiFetch } from '../lib/client/api-config';
  const dispatch = createEventDispatcher()
  type IndexStatus = { exists: boolean; model?: string; provider?: string; items?: number; createdAt?: string }
  let loadingIndex = false, buildingIndex = false, indexError: string | null = null
  let indexStatus: IndexStatus | null = null

  let captureText = '', captureBusy = false, captureError: string | null = null, captureOk: string | null = null

  async function loadIndexStatus() {
    loadingIndex = true; indexError = null
    try { const res = await apiFetch('/api/index'); if (!res.ok) throw new Error(`HTTP ${res.status}`); indexStatus = await res.json() }
    catch (e) { indexError = (e as Error).message; indexStatus = null }
    finally { loadingIndex = false }
  }
  async function buildIndex() {
    buildingIndex = true; indexError = null
    try { const res = await apiFetch('/api/index', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'build' }) })
      const data = await res.json(); if (!res.ok || !data.success) throw new Error(data.error || 'Build failed'); indexStatus = data.status }
    catch (e) { indexError = (e as Error).message }
    finally { buildingIndex = false }
  }
  async function quickCapture() {
    if (!captureText.trim()) return
    captureBusy = true; captureError = null; captureOk = null
    try { const res = await apiFetch('/api/capture', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: captureText }) })
      const data = await res.json(); if (!res.ok || !data.success) throw new Error(data.error || 'Capture failed'); captureOk = 'Saved'; captureText = ''; dispatch('captured') }
    catch (e) { captureError = (e as Error).message }
    finally { captureBusy = false }
  }
  async function runAgent(name: string) {
    try { await apiFetch('/api/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agentName: name }) }) } catch {}
  }

  // Ingestor preference (AI organize vs legacy)
  let useAiIngestor = true
  function loadPrefs() {
    try { const raw = localStorage.getItem('memoryPrefs'); if (!raw) return; const p = JSON.parse(raw); if (typeof p.useAiIngestor === 'boolean') useAiIngestor = p.useAiIngestor } catch {}
  }
  function savePrefs() {
    try { localStorage.setItem('memoryPrefs', JSON.stringify({ useAiIngestor })) } catch {}
  }
  function runIngestor() {
    runAgent(useAiIngestor ? 'ai-ingestor' : 'ingestor')
  }

  function handleCaptureKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !captureBusy) quickCapture()
  }

  // Load initial status on mount
  loadIndexStatus(); loadPrefs()
</script>

<div class="memory-controls">
  <div class="card">
    <div class="card-header"><h3>Quick Capture</h3></div>
    <div class="card-body">
      <div class="row">
        <input class="input" type="text" placeholder="Capture an observation (Enter to save)" bind:value={captureText}
               on:keydown={handleCaptureKeydown} />
        <button class="btn btn-primary" on:click={quickCapture} disabled={captureBusy || !captureText.trim()}>{captureBusy ? 'Saving...' : 'Save'}</button>
      </div>
      {#if captureError}<div class="note error">⚠️ {captureError}</div>{/if}
      {#if captureOk}<div class="note ok">✓ {captureOk}</div>{/if}
    </div>
  </div>

  <div class="card">
    <div class="card-header">
      <h3>Search Index</h3>
      <div class="actions">
        <button class="btn btn-secondary" on:click={loadIndexStatus} disabled={loadingIndex}>Refresh</button>
        <button class="btn btn-primary" on:click={buildIndex} disabled={buildingIndex}>{buildingIndex ? 'Building…' : 'Build Index'}</button>
      </div>
    </div>
    <div class="card-body">
      {#if indexError}<div class="note error">⚠️ {indexError}</div>
      {:else if loadingIndex}<div class="muted">Loading index status…</div>
      {:else if indexStatus}
        <div class="grid">
          <div><strong>Status:</strong> {indexStatus.exists ? 'Ready' : 'Not built'}</div>
          {#if indexStatus.exists}
            <div><strong>Items:</strong> {indexStatus.items}</div>
            <div><strong>Model:</strong> {indexStatus.model}</div>
            <div><strong>Provider:</strong> {indexStatus.provider}</div>
            <div><strong>Created:</strong> {indexStatus.createdAt && new Date(indexStatus.createdAt).toLocaleString()}</div>
          {/if}
        </div>
      {/if}
    </div>
  </div>

  <div class="card">
    <div class="card-header"><h3>Agents</h3></div>
    <div class="card-body">
      <div class="row">
        <button class="btn btn-secondary" on:click={() => runAgent('organizer')}>Run Organizer</button>
        <button class="btn btn-secondary" on:click={() => runAgent('indexer')}>Run Indexer</button>
        <button class="btn btn-secondary" on:click={runIngestor}>Run Ingestor</button>
      </div>
      <div class="muted small">Organizer enriches episodic JSON; Indexer rebuilds semantic index; Ingestor converts files from <code>memory/inbox</code>.</div>
      <div class="row" style="margin-top: 0.5rem; align-items: center;">
        <label class="switch-row">
          <input type="checkbox" bind:checked={useAiIngestor} on:change={savePrefs} />
          <span>Use AI Ingestor (organize)</span>
        </label>
        <span class="muted small">{useAiIngestor ? 'Summarize/curate large files with outline/highlights' : 'Legacy raw ingestor (observation chunks)'}</span>
      </div>
    </div>
  </div>
</div>

<style>
  .memory-controls { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1rem; margin-bottom: 1.5rem; }
  .card { border: 1px solid rgba(0,0,0,0.1); border-radius: 0.5rem; background: white; }
  :global(.dark) .card { border-color: rgba(255,255,255,0.1); background: rgba(255,255,255,0.05); }
  .card-header { display: flex; align-items: center; justify-content: space-between; padding: 0.75rem 1rem; border-bottom: 1px solid rgba(0,0,0,0.08); }
  :global(.dark) .card-header { border-bottom-color: rgba(255,255,255,0.1); }
  .card-body { padding: 0.75rem 1rem; }
  .row { display: flex; gap: 0.5rem; }
  .switch-row { display: inline-flex; align-items: center; gap: 0.35rem; }
  .input { flex: 1; padding: 0.625rem 0.875rem; border: 1px solid rgba(0,0,0,0.2); border-radius: 0.5rem; }
  :global(.dark) .input { border-color: rgba(255,255,255,0.2); background: rgb(31 41 55); color: rgb(243 244 246); }
  .btn { padding: 0.5rem 0.9rem; border-radius: 0.375rem; border: 1px solid transparent; cursor: pointer; font-weight: 600; }
  .btn-primary { background: rgb(124 58 237); color: white; }
  .btn-secondary { background: transparent; color: rgb(107 114 128); border-color: rgba(0,0,0,0.2); }
  :global(.dark) .btn-secondary { color: rgb(156 163 175); border-color: rgba(255,255,255,0.2); }
  .note { margin-top: 0.5rem; font-size: 0.875rem; }
  .note.error { color: rgb(153 27 27); }
  .note.ok { color: rgb(22 101 52); }
  .muted { color: rgb(107 114 128); }
  .small { font-size: 0.8125rem; }
  .grid { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 0.25rem 1rem; font-size: 0.9rem; }
</style>
