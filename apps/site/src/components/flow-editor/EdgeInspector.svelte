<script lang="ts">
  import type { Edge, Node } from '@xyflow/svelte'
  import type { GraphOutputCondition } from '@metahuman/core/cognitive-graph-contract'
  import {
    connectionTypeWarning,
    formatScalar,
    parseScalar,
  } from '../../lib/client/flow-editor/graph-authoring'

  let {
    selectedEdge,
    graphNodes,
    onUpdateEdgeData,
    onSelectNode,
  }: {
    selectedEdge: Edge
    graphNodes: Node[]
    onUpdateEdgeData?: (edgeId: string, patch: Record<string, unknown>) => void
    onSelectNode?: (nodeId: string) => void
  } = $props()

  const data = $derived((selectedEdge.data || {}) as Record<string, any>)
  const condition = $derived(data.when as GraphOutputCondition | undefined)
  const typeWarning = $derived(connectionTypeWarning(graphNodes, selectedEdge as any))

  function nodeName(nodeId: string): string {
    const node = graphNodes.find(candidate => candidate.id === nodeId)
    return String(node?.data?.title || node?.data?.schema?.name || nodeId)
  }

  function update(patch: Record<string, unknown>): void {
    onUpdateEdgeData?.(selectedEdge.id, patch)
  }

  function operator(): 'none' | 'equals' | 'notEquals' | 'truthy' {
    if (!condition) return 'none'
    if ('equals' in condition) return 'equals'
    if ('notEquals' in condition) return 'notEquals'
    return 'truthy'
  }

  function changeOperator(next: 'none' | 'equals' | 'notEquals' | 'truthy'): void {
    if (next === 'none') {
      update({ when: undefined, loop: false })
      return
    }
    const output = condition?.output || selectedEdge.sourceHandle || 'output'
    update({ when: next === 'truthy' ? { output, truthy: true } : { output, [next]: '' } })
  }

  function updateCondition(patch: Record<string, unknown>): void {
    update({ when: { ...(condition || { output: selectedEdge.sourceHandle || 'output' }), ...patch } })
  }

  function toggleLoop(enabled: boolean): void {
    update({
      loop: enabled,
      when: enabled && !condition
        ? { output: selectedEdge.sourceHandle || 'output', truthy: true }
        : condition,
    })
  }
</script>

<div class="h-full overflow-y-auto border-l border-slate-700 bg-slate-800 text-[13px] text-slate-200">
  <div class="border-b border-slate-700 bg-slate-900 p-4">
    <h3 class="m-0 text-base font-semibold text-slate-50">Connection</h3>
    <span class="mt-1 block font-mono text-[10px] text-slate-500">ID: {selectedEdge.id}</span>
  </div>

  <section class="border-b border-slate-700 p-4">
    <button type="button" class="node-link" onclick={() => onSelectNode?.(selectedEdge.source)}>{nodeName(selectedEdge.source)}</button>
    <div class="my-2 font-mono text-[11px] text-slate-400">{selectedEdge.sourceHandle} → {selectedEdge.targetHandle}</div>
    <button type="button" class="node-link" onclick={() => onSelectNode?.(selectedEdge.target)}>{nodeName(selectedEdge.target)}</button>
    {#if typeWarning}<div class="warning-box">{typeWarning}</div>{/if}
  </section>

  <section class="border-b border-slate-700 p-4">
    <label class="field-label" for="edge-kind">Connection Kind</label>
    <select id="edge-kind" class="property-input" value={data.kind || 'data'} onchange={(event) => update({ kind: (event.target as HTMLSelectElement).value })}>
      <option value="data">Data · copies the source value</option>
      <option value="control">Control · orders execution only</option>
    </select>

    <label class="toggle-row">
      <input type="checkbox" checked={data.loop === true} onchange={(event) => toggleLoop((event.target as HTMLInputElement).checked)} />
      <span><strong>Loop back-edge</strong><small>Re-enter the loop body while this edge condition matches.</small></span>
    </label>
  </section>

  <section class="border-b border-slate-700 p-4">
    <h4 class="section-title">Branch Condition</h4>
    <label class="field-label" for="edge-condition-operator">Operator</label>
    <select id="edge-condition-operator" class="property-input" value={operator()} onchange={(event) => changeOperator((event.target as HTMLSelectElement).value as any)}>
      <option value="none">Always active</option>
      <option value="equals">Output equals</option>
      <option value="notEquals">Output does not equal</option>
      <option value="truthy">Output truthiness is</option>
    </select>

    {#if condition}
      <label class="field-label" for="edge-condition-output">Source output path</label>
      <input id="edge-condition-output" class="property-input font-mono" value={condition.output} oninput={(event) => updateCondition({ output: (event.target as HTMLInputElement).value })} />
      {#if operator() === 'truthy'}
        <label class="field-label" for="edge-condition-value">Expected truthiness</label>
        <select id="edge-condition-value" class="property-input" value={String(condition.truthy ?? true)} onchange={(event) => updateCondition({ truthy: (event.target as HTMLSelectElement).value === 'true' })}>
          <option value="true">true</option><option value="false">false</option>
        </select>
      {:else}
        {@const key = operator() as 'equals' | 'notEquals'}
        <label class="field-label" for="edge-condition-value">Expected scalar value</label>
        <input id="edge-condition-value" class="property-input font-mono" value={formatScalar(condition[key])} oninput={(event) => updateCondition({ [key]: parseScalar((event.target as HTMLInputElement).value) })} />
        <p class="hint">true, false, null, and numbers are stored as typed values; everything else is text.</p>
      {/if}
    {/if}
  </section>

  <section class="p-4">
    <label class="field-label !mt-0" for="edge-comment">Connection Purpose</label>
    <textarea id="edge-comment" class="property-input min-h-28 resize-y" value={data.comment || ''} placeholder="Explain why this path exists." oninput={(event) => update({ comment: (event.target as HTMLTextAreaElement).value })}></textarea>
    <p class="hint">Conditions, loop state, and this note are displayed directly on the connection.</p>
  </section>
</div>

<style>
  .section-title { @apply m-0 mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400; }
  .field-label { @apply mb-1.5 mt-4 block text-xs font-medium text-slate-300; }
  .property-input { @apply box-border w-full rounded-md border border-slate-700 bg-slate-900 px-2.5 py-2 text-[12px] text-slate-200; }
  .node-link { @apply border-0 bg-transparent p-0 text-left text-xs font-medium text-blue-300 underline; }
  .warning-box { @apply mt-3 rounded border border-amber-800 bg-amber-950/30 p-2 text-[11px] leading-snug text-amber-200; }
  .toggle-row { @apply mt-4 flex cursor-pointer items-start gap-2 rounded border border-slate-700 bg-slate-900/50 p-2.5; }
  .toggle-row span { @apply grid gap-0.5; }
  .toggle-row strong { @apply text-xs text-slate-200; }
  .toggle-row small, .hint { @apply m-0 text-[10px] leading-snug text-slate-500; }
</style>
