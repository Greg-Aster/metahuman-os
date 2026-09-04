<script lang="ts">
  import { onMount } from 'svelte'
  import type { Node } from '@xyflow/svelte'
  import { apiFetch } from '../../lib/client/api-config'
  import type { SvelteFlowGraph } from '../../lib/client/flow-editor/template-converter'
  import { branchResults } from '../../lib/client/flow-editor/graph-authoring'
  import {
    safeOutputPreview,
    type ExecutionTimelineEntry,
  } from '../../lib/client/flow-editor/execution-observability'

  interface GraphTrace {
    timestamp: string
    graph?: string
    status?: string
    durationMs?: number
    error?: string
  }

  let {
    graph,
    entries,
    nodeOutputs,
    isExecuting,
    onSelectNode,
  }: {
    graph: SvelteFlowGraph | null
    entries: ExecutionTimelineEntry[]
    nodeOutputs: Record<string, unknown>
    isExecuting: boolean
    onSelectNode?: (nodeId: string) => void
  } = $props()

  let traces = $state<GraphTrace[]>([])
  let traceError = $state('')
  const branches = $derived(graph ? branchResults(graph, nodeOutputs) : [])

  function nodeName(nodeId: string): string {
    const node = graph?.nodes.find((candidate: Node) => candidate.id === nodeId)
    return String(node?.data?.title || node?.data?.schema?.name || nodeId)
  }

  async function refreshTraces(): Promise<void> {
    traceError = ''
    try {
      const response = await apiFetch('/api/graph-traces?limit=12')
      if (!response.ok) throw new Error(`Trace request failed: ${response.status}`)
      const body = await response.json()
      traces = Array.isArray(body.traces) ? body.traces : []
    } catch (error) {
      traceError = error instanceof Error ? error.message : String(error)
    }
  }

  onMount(() => { void refreshTraces() })
</script>

<div class="execution-panel">
  <section class="timeline-section">
    <div class="panel-heading">
      <h3>Current Run</h3>
      <span class:running={isExecuting}>{isExecuting ? 'running' : entries.length ? 'complete' : 'not run'}</span>
    </div>
    {#if entries.length}
      <div class="timeline-list">
        {#each entries as entry}
          <button type="button" class="timeline-row state-{entry.state}" onclick={() => onSelectNode?.(entry.nodeId)}>
            <span class="state-dot"></span>
            <strong>{nodeName(entry.nodeId)}</strong>
            <span>{entry.state}</span>
            <span>{entry.durationMs !== undefined ? `${entry.durationMs} ms` : ''}</span>
            {#if entry.reason || entry.error}<small>{entry.reason || entry.error}</small>{/if}
            {#if entry.nodeId in nodeOutputs}<code>{safeOutputPreview(nodeOutputs[entry.nodeId], 260)}</code>{/if}
          </button>
        {/each}
      </div>
    {:else}
      <p class="empty">Execute the graph to see node order, duration, skipped branches, errors, and bounded output previews.</p>
    {/if}
  </section>

  <section class="branch-section">
    <h3>Branch Results</h3>
    {#if branches.length}
      <div class="branch-list">
        {#each branches as branch}
          <div class:selected={branch.selected === true} class:rejected={branch.selected === false} class="branch-row">
            <span>{branch.selected === null ? '·' : branch.selected ? '✓' : '×'}</span>
            <code>{branch.label}</code>
          </div>
        {/each}
      </div>
    {:else}<p class="empty">This graph has no conditional connections.</p>{/if}
  </section>

  <section class="trace-section">
    <div class="panel-heading"><h3>Recent Graph Traces</h3><button type="button" onclick={refreshTraces}>Refresh</button></div>
    {#if traceError}<p class="trace-error">{traceError}</p>
    {:else if traces.length}
      {#each traces as trace}
        <div class="trace-row"><span>{trace.graph || 'Graph'}</span><strong>{trace.status || 'unknown'}</strong><code>{trace.durationMs !== undefined ? `${trace.durationMs} ms` : new Date(trace.timestamp).toLocaleTimeString()}</code></div>
      {/each}
    {:else}<p class="empty">No persisted graph traces are available.</p>{/if}
  </section>
</div>

<style>
  .execution-panel { @apply grid h-full grid-cols-[2fr_1fr_1fr] overflow-hidden border-t border-neutral-700 bg-[#101010] text-xs text-neutral-300; }
  section { @apply min-w-0 overflow-auto border-r border-neutral-800 p-3 last:border-r-0; }
  h3 { @apply m-0 text-[11px] font-semibold uppercase tracking-wide text-neutral-400; }
  .panel-heading { @apply mb-2 flex items-center justify-between gap-2; }
  .panel-heading > span { @apply rounded bg-neutral-800 px-2 py-0.5 text-[9px] uppercase text-neutral-500; }
  .panel-heading > span.running { @apply bg-blue-950 text-blue-300; }
  .panel-heading button { @apply border-0 bg-transparent text-[10px] text-blue-300 underline; }
  .timeline-list, .branch-list { @apply grid gap-1.5; }
  .timeline-row { @apply grid w-full grid-cols-[8px_minmax(90px,1fr)_70px_60px] items-center gap-2 rounded border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-left; }
  .timeline-row small, .timeline-row code { @apply col-start-2 col-end-5 overflow-hidden text-ellipsis whitespace-nowrap text-[10px] text-neutral-500; }
  .state-dot { @apply h-2 w-2 rounded-full bg-neutral-600; }
  .state-completed .state-dot { @apply bg-emerald-500; }
  .state-running .state-dot { @apply bg-blue-400; }
  .state-skipped .state-dot { @apply bg-slate-500; }
  .state-failed .state-dot { @apply bg-red-500; }
  .branch-row { @apply grid grid-cols-[16px_1fr] gap-1 rounded border border-neutral-800 px-2 py-1.5 text-neutral-500; }
  .branch-row.selected { @apply border-emerald-900 bg-emerald-950/30 text-emerald-300; }
  .branch-row.rejected { @apply opacity-60; }
  .trace-row { @apply grid grid-cols-[1fr_auto_auto] gap-2 border-b border-neutral-800 py-1.5 text-[10px]; }
  .trace-row strong { @apply text-neutral-400; }
  .trace-row code { @apply text-neutral-600; }
  .empty { @apply mb-0 mt-2 text-[10px] leading-relaxed text-neutral-600; }
  .trace-error { @apply text-[10px] text-red-400; }
</style>
