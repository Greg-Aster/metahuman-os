<script lang="ts">
  import type { SvelteFlowGraph } from '../../lib/client/flow-editor/template-converter'
  import type { AuthoringIssue, SchemaHealth } from '../../lib/client/flow-editor/graph-authoring'

  let {
    graph,
    issues,
    schemaHealth,
    onUpdateGraph,
    onSelectIssue,
  }: {
    graph: SvelteFlowGraph | null
    issues: AuthoringIssue[]
    schemaHealth: SchemaHealth | null
    onUpdateGraph?: (patch: { name?: string; description?: string; maxLoopIterations?: number }) => void
    onSelectIssue?: (issue: AuthoringIssue) => void
  } = $props()

  const errors = $derived(issues.filter(issue => issue.level === 'error'))
  const warnings = $derived(issues.filter(issue => issue.level === 'warning'))
</script>

<div class="h-full overflow-y-auto border-l border-slate-700 bg-slate-800 text-[13px] text-slate-200">
  <div class="border-b border-slate-700 bg-slate-900 p-4">
    <h3 class="m-0 text-base font-semibold text-slate-50">Graph Settings</h3>
    <p class="mb-0 mt-1 text-[11px] text-slate-500">Workflow-wide authoring, scheduling, and validation.</p>
  </div>

  {#if graph}
    <section class="border-b border-slate-700 p-4">
      <label class="field-label" for="graph-display-name">Display Name</label>
      <input id="graph-display-name" class="property-input" value={graph.name} oninput={(event) => onUpdateGraph?.({ name: (event.target as HTMLInputElement).value })} />
      <label class="field-label" for="graph-description">Workflow Description</label>
      <textarea id="graph-description" class="property-input min-h-28 resize-y" value={graph.description} oninput={(event) => onUpdateGraph?.({ description: (event.target as HTMLTextAreaElement).value })}></textarea>
    </section>

    <section class="border-b border-slate-700 p-4">
      <h4 class="section-title">Scheduler Contract</h4>
      <dl class="contract-grid">
        <dt>Activation</dt><dd>demand</dd>
        <dt>Skipped state</dt><dd>explicit</dd>
        <dt>Side effects</dt><dd>serial-topological</dd>
      </dl>
      <label class="field-label" for="max-loop-iterations">Maximum Loop Iterations</label>
      <input
        id="max-loop-iterations"
        class="property-input"
        type="number"
        min="1"
        max="100"
        step="1"
        value={graph.scheduler.maxLoopIterations}
        oninput={(event) => onUpdateGraph?.({ maxLoopIterations: Number((event.target as HTMLInputElement).value) })}
      />
      <p class="hint">A conditional loop that remains selected beyond this limit fails the graph.</p>
    </section>

    <section class="border-b border-slate-700 p-4">
      <h4 class="section-title">Validation</h4>
      {#if issues.length === 0}
        <div class="success-box">No authoring problems detected.</div>
      {:else}
        <div class="mb-2 text-[11px] text-slate-400">{errors.length} error{errors.length === 1 ? '' : 's'} · {warnings.length} warning{warnings.length === 1 ? '' : 's'}</div>
        <div class="grid gap-2">
          {#each issues as issue}
            <button type="button" class="issue issue-{issue.level}" onclick={() => onSelectIssue?.(issue)}>
              <strong>{issue.level}</strong>
              <span>{issue.message}</span>
            </button>
          {/each}
        </div>
      {/if}
    </section>

    {#if schemaHealth}
      <section class="p-4">
        <h4 class="section-title">Schema Coverage</h4>
        <dl class="contract-grid">
          <dt>Nodes in graph</dt><dd>{schemaHealth.nodes}</dd>
          <dt>Enhanced cards</dt><dd>{schemaHealth.enhancedPresentations}</dd>
          <dt>Inputs needing docs</dt><dd>{schemaHealth.undocumentedInputs}</dd>
          <dt>Outputs needing docs</dt><dd>{schemaHealth.undocumentedOutputs}</dd>
          <dt>Settings needing docs</dt><dd>{schemaHealth.undocumentedProperties}</dd>
        </dl>
      </section>
    {/if}
  {:else}
    <p class="p-4 text-sm text-slate-500">Create or load a graph to edit its contract.</p>
  {/if}
</div>

<style>
  .section-title { @apply m-0 mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400; }
  .field-label { @apply mb-1.5 mt-4 block text-xs font-medium text-slate-300 first:mt-0; }
  .property-input { @apply box-border w-full rounded-md border border-slate-700 bg-slate-900 px-2.5 py-2 text-[13px] text-slate-200; }
  .contract-grid { @apply m-0 grid grid-cols-[1fr_auto] gap-x-3 gap-y-2 text-[11px]; }
  .contract-grid dt { @apply text-slate-500; }
  .contract-grid dd { @apply m-0 font-mono text-slate-300; }
  .hint { @apply mb-0 mt-1.5 text-[10px] leading-snug text-slate-500; }
  .success-box { @apply rounded border border-emerald-900 bg-emerald-950/30 p-2.5 text-[11px] text-emerald-300; }
  .issue { @apply grid w-full grid-cols-[auto_1fr] gap-2 rounded border p-2 text-left text-[11px]; }
  .issue strong { @apply text-[9px] uppercase tracking-wide; }
  .issue-error { @apply border-red-900 bg-red-950/30 text-red-200; }
  .issue-warning { @apply border-amber-900 bg-amber-950/30 text-amber-200; }
</style>
