<script lang="ts">
  import { onMount } from 'svelte'
  import { apiFetch } from '../lib/client/api-config'

  type Bank = 'decision' | 'freestyle'
  type Decision = 'accept' | 'correct' | 'reject' | 'defer'
  type Item = { id: string; bank: Bank; specialist: string; recordedAt: string;
    executionId: string; preview: string; review: string }
  type Detail = { candidate: Record<string, any>; review: Record<string, any> | null;
    proposal: Record<string, any> | null;
    executionEvidence: { scope: string; events: unknown[]; dispatches: unknown[] } }

  let items: Item[] = []
  let selected: Item | null = null
  let detail: Detail | null = null
  let loading = false
  let saving = false
  let error = ''
  let decision: Decision = 'accept'
  let reason = ''
  let correctedOutput = ''

  async function load() {
    loading = true
    error = ''
    try {
      const response = await apiFetch('/api/environment-training')
      if (!response.ok) throw new Error((await response.json()).error || `HTTP ${response.status}`)
      items = (await response.json()).items ?? []
    } catch (cause) { error = cause instanceof Error ? cause.message : String(cause) }
    finally { loading = false }
  }

  async function select(item: Item) {
    selected = item
    detail = null
    error = ''
    try {
      const response = await apiFetch(`/api/environment-training?bank=${item.bank}&id=${encodeURIComponent(item.id)}`)
      if (!response.ok) throw new Error((await response.json()).error || `HTTP ${response.status}`)
      detail = await response.json()
      decision = (detail?.review?.decision as Decision) || 'accept'
      reason = detail?.review?.reason || ''
      correctedOutput = detail?.review?.correctedOutput || ''
      if (!detail?.review && detail?.proposal) {
        decision = detail.proposal.verdict === 'correct' ? 'accept'
          : detail.proposal.verdict === 'incorrect' ? 'correct' : 'defer'
        reason = detail.proposal.reason || ''
        correctedOutput = detail.proposal.correctedOutput || ''
      }
    } catch (cause) { error = cause instanceof Error ? cause.message : String(cause) }
  }

  async function submitReview() {
    if (!selected || !reason.trim() || decision === 'correct' && !correctedOutput.trim()) return
    saving = true
    error = ''
    try {
      const response = await apiFetch('/api/environment-training/review', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bank: selected.bank, id: selected.id, decision, reason,
          ...(decision === 'correct' ? { correctedOutput } : {}) }),
      })
      if (!response.ok) throw new Error((await response.json()).error || `HTTP ${response.status}`)
      const current = selected
      await load()
      await select(current)
    } catch (cause) { error = cause instanceof Error ? cause.message : String(cause) }
    finally { saving = false }
  }

  onMount(() => { void load() })
</script>

<div class="space-y-3">
  <div class="flex items-center justify-between gap-3">
    <div>
      <h3 class="font-semibold text-gray-900 dark:text-gray-100">Environment decisions</h3>
      <p class="text-sm text-gray-500 dark:text-gray-400">Intent, task selection, and Freestyle attempts are stored separately from persona conversations. Only reviewed records can enter specialist training exports.</p>
    </div>
    <button class="px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 text-sm" on:click={load} disabled={loading}>Refresh</button>
  </div>
  {#if error}<p class="text-sm text-red-600" role="alert">{error}</p>{/if}
  {#if loading}<p class="text-sm text-gray-500">Loading decisions…</p>{/if}
  {#if !loading && items.length === 0}<p class="text-sm text-gray-500">No saved model decisions yet.</p>{/if}
  <div class="grid grid-cols-1 lg:grid-cols-[minmax(260px,1fr)_minmax(320px,2fr)] gap-3">
    <div class="max-h-[60vh] overflow-auto space-y-1">
      {#each items as item (item.id)}
        <button class="w-full text-left p-3 rounded border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 {selected?.id === item.id ? 'bg-violet-50 dark:bg-violet-900/20' : ''}" on:click={() => select(item)}>
          <span class="text-xs font-semibold uppercase text-violet-700 dark:text-violet-300">{item.specialist}</span>
          <span class="text-xs text-gray-500 ml-2">{item.review}</span>
          <div class="text-xs text-gray-500">{new Date(item.recordedAt).toLocaleString()}</div>
          <div class="text-sm break-words line-clamp-2">{item.preview}</div>
        </button>
      {/each}
    </div>
    {#if detail}
      <div class="space-y-3 min-w-0">
        <div class="text-xs text-gray-500 break-all">Execution {detail.candidate.executionId}</div>
        <details><summary class="cursor-pointer font-medium">Model input</summary><pre class="text-xs whitespace-pre-wrap break-words max-h-64 overflow-auto">{detail.candidate.system}</pre><pre class="text-xs whitespace-pre-wrap break-words max-h-64 overflow-auto">{detail.candidate.user}</pre></details>
        <div><div class="font-medium">Model output</div><pre class="text-xs whitespace-pre-wrap break-words max-h-64 overflow-auto">{detail.candidate.observedOutput || '(no model output captured)'}</pre></div>
        {#if detail.candidate.generationError}<p class="text-sm text-red-600">Generation error: {detail.candidate.generationError}</p>{/if}
        {#if detail.candidate.generatedAction}<details><summary class="cursor-pointer font-medium">Validated motion plan</summary><pre class="text-xs whitespace-pre-wrap break-words max-h-64 overflow-auto">{JSON.stringify(detail.candidate.generatedAction, null, 2)}</pre></details>{/if}
        <details><summary class="cursor-pointer font-medium">Execution evidence</summary>
          <p class="text-xs text-gray-500">{detail.executionEvidence.scope}</p>
          <pre class="text-xs whitespace-pre-wrap break-words max-h-64 overflow-auto">{JSON.stringify(detail.executionEvidence, null, 2)}</pre>
        </details>
        {#if detail.proposal}<div class="p-3 rounded bg-violet-50 dark:bg-violet-900/20 text-sm">Curator suggestion: {detail.proposal.verdict}. Review and save it below before training.</div>{/if}
        <div class="space-y-2 border-t border-gray-200 dark:border-gray-700 pt-3">
          <label class="block text-sm">Review decision
            <select class="block w-full mt-1 p-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800" bind:value={decision}>
              <option value="accept">Correct</option><option value="correct">Correct output</option><option value="reject">Exclude</option><option value="defer">Insufficient evidence</option>
            </select>
          </label>
          <label class="block text-sm">Reason<textarea class="block w-full mt-1 p-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800" rows="3" bind:value={reason}></textarea></label>
          {#if decision === 'correct'}<label class="block text-sm">Corrected JSON output<textarea class="block w-full mt-1 p-2 font-mono text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800" rows="8" bind:value={correctedOutput}></textarea></label>{/if}
          <button class="px-3 py-2 rounded bg-violet-700 text-white disabled:opacity-50" on:click={submitReview} disabled={saving || !reason.trim() || decision === 'correct' && !correctedOutput.trim()}>Save review</button>
        </div>
      </div>
    {/if}
  </div>
</div>
