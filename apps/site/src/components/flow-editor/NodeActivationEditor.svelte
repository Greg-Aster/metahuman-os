<script lang="ts">
  import type { Edge, Node } from '@xyflow/svelte'
  import type { GraphNodeActivation, GraphOutputCondition } from '@metahuman/core/cognitive-graph-contract'
  import type { NodeActivationMode, NodeSchema } from '@metahuman/core/nodes/types'
  import { formatScalar, parseScalar } from '../../lib/client/flow-editor/graph-authoring'

  let {
    selectedNode,
    graphNodes,
    graphEdges,
    onUpdateNodeData,
  }: {
    selectedNode: Node
    graphNodes: Node[]
    graphEdges: Edge[]
    onUpdateNodeData?: (nodeId: string, data: Record<string, any>) => void
  } = $props()

  const schema = $derived(selectedNode.data?.schema as NodeSchema | undefined)
  const configured = $derived((selectedNode.data?.activation || {}) as GraphNodeActivation)
  const defaultMode = $derived(schema?.execution?.activation || 'any-input')
  const effectiveMode = $derived(configured.mode || defaultMode)
  const effectiveRequiredInputs = $derived(
    configured.requiredInputs || schema?.execution?.requiredInputs || [],
  )
  const conditions = $derived(configured.when || [])
  const sourceNodes = $derived(graphNodes.filter(node => (
    node.id !== selectedNode.id
    && ((node.data?.schema as NodeSchema | undefined)?.outputs?.length || 0) > 0
  )))

  function updateActivation(next: GraphNodeActivation): void {
    const normalized: GraphNodeActivation = {}
    if (next.mode) normalized.mode = next.mode
    if (next.requiredInputs) normalized.requiredInputs = next.requiredInputs
    if (next.when?.length) normalized.when = next.when
    onUpdateNodeData?.(selectedNode.id, {
      activation: Object.keys(normalized).length > 0 ? normalized : undefined,
    })
  }

  function updateMode(value: string): void {
    updateActivation({
      ...configured,
      mode: value === 'default' ? undefined : value as NodeActivationMode,
    })
  }

  function updateRequiredInput(input: string, checked: boolean): void {
    const next = new Set(effectiveRequiredInputs)
    if (checked) next.add(input)
    else next.delete(input)
    updateActivation({ ...configured, requiredInputs: [...next] })
  }

  function sourceOutputs(nodeId: string): Array<{ name: string; label?: string }> {
    const node = graphNodes.find(candidate => candidate.id === nodeId)
    return ((node?.data?.schema as NodeSchema | undefined)?.outputs || [])
  }

  function nodeName(node: Node): string {
    return String(node.data?.title || node.data?.schema?.name || node.id)
  }

  function conditionOperator(condition: GraphOutputCondition): 'equals' | 'notEquals' | 'truthy' {
    if ('equals' in condition) return 'equals'
    if ('notEquals' in condition) return 'notEquals'
    return 'truthy'
  }

  function updateCondition(index: number, patch: Record<string, unknown>): void {
    const previous = conditions[index]
    const next = { ...previous, ...patch } as GraphNodeActivation['when'][number]
    updateActivation({
      ...configured,
      when: conditions.map((condition, conditionIndex) => conditionIndex === index ? next : condition),
    })
  }

  function changeConditionOperator(index: number, operator: 'equals' | 'notEquals' | 'truthy'): void {
    const previous = conditions[index]
    const base = { nodeId: previous.nodeId, output: previous.output }
    const next = operator === 'truthy'
      ? { ...base, truthy: true }
      : { ...base, [operator]: '' }
    updateActivation({
      ...configured,
      when: conditions.map((condition, conditionIndex) => conditionIndex === index ? next : condition),
    })
  }

  function addCondition(): void {
    const source = sourceNodes[0]
    const output = source ? sourceOutputs(source.id)[0]?.name : undefined
    if (!source || !output) return
    updateActivation({
      ...configured,
      when: [...conditions, { nodeId: source.id, output, truthy: true }],
    })
  }

  function removeCondition(index: number): void {
    updateActivation({ ...configured, when: conditions.filter((_, candidate) => candidate !== index) })
  }

  function hasIncomingInput(input: string): boolean {
    return graphEdges.some(edge => edge.target === selectedNode.id
      && edge.targetHandle === input
      && (edge.data as any)?.kind !== 'control')
  }
</script>

<section class="border-b border-slate-700 p-4">
  <div class="mb-3 flex items-center justify-between gap-3">
    <h4 class="section-title !mb-0">Activation and Branching</h4>
    <button
      type="button"
      class="small-button"
      disabled={!selectedNode.data?.activation}
      onclick={() => updateActivation({})}
    >Use defaults</button>
  </div>

  <label class="toggle-row">
    <input
      type="checkbox"
      checked={Boolean(selectedNode.data?.muted)}
      onchange={(event) => onUpdateNodeData?.(selectedNode.id, {
        muted: (event.target as HTMLInputElement).checked,
      })}
    />
    <span><strong>Muted</strong><small>Skip this node without deleting it or its connections.</small></span>
  </label>

  <label class="field-label" for="node-activation-mode">Run this node when</label>
  <select
    id="node-activation-mode"
    class="property-input"
    value={configured.mode || 'default'}
    onchange={(event) => updateMode((event.target as HTMLSelectElement).value)}
  >
    <option value="default">Definition default · {defaultMode}</option>
    <option value="required-inputs">All required inputs are active</option>
    <option value="any-input">Any incoming branch is active</option>
    <option value="always">Always, after dependencies</option>
  </select>

  {#if effectiveMode === 'required-inputs' && (schema?.inputs?.length || 0) > 0}
    <fieldset class="input-contract">
      <legend>Required inputs</legend>
      {#each schema?.inputs || [] as input}
        <label>
          <input
            type="checkbox"
            checked={effectiveRequiredInputs.includes(input.name)}
            onchange={(event) => updateRequiredInput(input.name, (event.target as HTMLInputElement).checked)}
          />
          <span>{input.label || input.name}</span>
          <small class:connected={hasIncomingInput(input.name)}>{hasIncomingInput(input.name) ? 'connected' : 'unconnected'}</small>
        </label>
      {/each}
    </fieldset>
  {/if}

  <div class="mt-4 flex items-center justify-between gap-3">
    <div>
      <div class="field-label !mb-0">Additional conditions</div>
      <p class="hint">All listed conditions must match.</p>
    </div>
    <button type="button" class="small-button" disabled={sourceNodes.length === 0} onclick={addCondition}>Add</button>
  </div>

  {#each conditions as condition, index}
    <div class="condition-card">
      <div class="condition-grid">
        <select
          class="property-input"
          aria-label="Condition source node"
          value={condition.nodeId}
          onchange={(event) => {
            const nodeId = (event.target as HTMLSelectElement).value
            updateCondition(index, { nodeId, output: sourceOutputs(nodeId)[0]?.name || '' })
          }}
        >
          {#each sourceNodes as node}<option value={node.id}>{nodeName(node)}</option>{/each}
        </select>
        <input
          class="property-input font-mono"
          aria-label="Source output or nested output path"
          list={`activation-outputs-${selectedNode.id}-${index}`}
          value={condition.output}
          oninput={(event) => updateCondition(index, { output: (event.target as HTMLInputElement).value })}
        />
        <datalist id={`activation-outputs-${selectedNode.id}-${index}`}>
          {#each sourceOutputs(condition.nodeId) as output}<option value={output.name}>{output.label || output.name}</option>{/each}
        </datalist>
        <select
          class="property-input"
          aria-label="Condition operator"
          value={conditionOperator(condition)}
          onchange={(event) => changeConditionOperator(index, (event.target as HTMLSelectElement).value as any)}
        >
          <option value="equals">equals</option>
          <option value="notEquals">does not equal</option>
          <option value="truthy">truthiness is</option>
        </select>
        {#if conditionOperator(condition) === 'truthy'}
          <select
            class="property-input"
            aria-label="Expected truthiness"
            value={String(condition.truthy ?? true)}
            onchange={(event) => updateCondition(index, { truthy: (event.target as HTMLSelectElement).value === 'true' })}
          ><option value="true">true</option><option value="false">false</option></select>
        {:else}
          {@const operator = conditionOperator(condition)}
          <input
            class="property-input font-mono"
            aria-label="Expected value"
            value={formatScalar(condition[operator])}
            oninput={(event) => updateCondition(index, { [operator]: parseScalar((event.target as HTMLInputElement).value) })}
          />
        {/if}
      </div>
      <button type="button" class="remove-button" onclick={() => removeCondition(index)}>Remove condition</button>
    </div>
  {/each}
</section>

<style>
  .section-title { @apply m-0 mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400; }
  .property-input { @apply box-border w-full rounded-md border border-slate-700 bg-slate-900 px-2.5 py-2 text-[12px] text-slate-200; }
  .field-label { @apply mb-1.5 mt-4 block text-xs font-medium text-slate-300; }
  .small-button { @apply rounded border border-slate-600 bg-slate-800 px-2 py-1 text-[10px] font-medium text-slate-300 disabled:cursor-not-allowed disabled:opacity-40; }
  .toggle-row { @apply flex cursor-pointer items-start gap-2 rounded border border-slate-700 bg-slate-900/50 p-2.5; }
  .toggle-row span { @apply grid gap-0.5; }
  .toggle-row strong { @apply text-xs text-slate-200; }
  .toggle-row small, .hint { @apply m-0 text-[10px] leading-snug text-slate-500; }
  .input-contract { @apply mt-3 grid gap-1.5 rounded border border-slate-700 p-2.5; }
  .input-contract legend { @apply px-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500; }
  .input-contract label { @apply grid grid-cols-[auto_1fr_auto] items-center gap-2 text-[11px] text-slate-300; }
  .input-contract small { @apply text-[9px] uppercase text-amber-400; }
  .input-contract small.connected { @apply text-emerald-400; }
  .condition-card { @apply mt-2 rounded border border-slate-700 bg-slate-900/50 p-2.5; }
  .condition-grid { @apply grid grid-cols-2 gap-2; }
  .remove-button { @apply mt-2 border-0 bg-transparent p-0 text-[10px] text-red-400 underline; }
</style>
