<script lang="ts">
  import type { Edge, Node } from '@xyflow/svelte';
  import type { NodeSlot, PropertySchema } from '@metahuman/core/nodes/types';
  import NodePropertyField from './NodePropertyField.svelte';
  import NodeActivationEditor from './NodeActivationEditor.svelte';
  import { safeOutputPreview } from '../../lib/client/flow-editor/execution-observability';
  import {
    getConnectedOutputConfigurationWarnings,
    getNodeStatusRows,
    groupNodeSlots,
  } from '../../lib/client/flow-editor/node-property-presentation';

  let {
    selectedNode,
    graphNodes = [],
    graphEdges = [],
    lastOutput,
    lastRunDurationMs = null,
    onUpdateNodeData,
    onUpdateNodeProperty,
    onSelectNode,
  }: {
    selectedNode: Node | null;
    graphNodes?: Node[];
    graphEdges?: Edge[];
    lastOutput?: unknown;
    lastRunDurationMs?: number | null;
    onUpdateNodeData?: (nodeId: string, data: Record<string, any>) => void;
    onUpdateNodeProperty?: (nodeId: string, propertyKey: string, value: unknown) => void;
    onSelectNode?: (nodeId: string) => void;
  } = $props();

  // Get property schemas from node data
  const propertySchemas = $derived(
    selectedNode?.data?.schema?.propertySchemas || {}
  );

  // Get current properties
  const properties = $derived(selectedNode?.data?.properties || {});

  // Get node info
  const nodeTitle = $derived(selectedNode?.data?.title || selectedNode?.data?.schema?.name || 'Node');
  const nodeDescription = $derived(selectedNode?.data?.schema?.description || '');
  const nodeType = $derived(selectedNode?.data?.nodeType || selectedNode?.data?.schema?.id || selectedNode?.type || 'unknown');
  const nodeCategory = $derived(selectedNode?.data?.schema?.category || '');
  const nodeInputs = $derived((selectedNode?.data?.schema?.inputs || []) as NodeSlot[]);
  const nodeOutputs = $derived((selectedNode?.data?.schema?.outputs || []) as NodeSlot[]);
  const nodePresentation = $derived(selectedNode?.data?.schema?.presentation);
  const nodeComment = $derived(
    typeof selectedNode?.data?.comment === 'string' ? selectedNode.data.comment : ''
  );
  const executionState = $derived(
    typeof selectedNode?.data?.executionState === 'string'
      ? selectedNode.data.executionState
      : 'idle'
  );
  const executionSkipReason = $derived(
    typeof selectedNode?.data?.executionSkipReason === 'string'
      ? selectedNode.data.executionSkipReason
      : ''
  );
  const incomingEdges = $derived(
    selectedNode ? graphEdges.filter((edge) => edge.target === selectedNode.id) : []
  );
  const outgoingEdges = $derived(
    selectedNode ? graphEdges.filter((edge) => edge.source === selectedNode.id) : []
  );
  const outputGroups = $derived(groupNodeSlots(nodeOutputs));
  const hasOutputGroups = $derived(nodeOutputs.some((output) => Boolean(output.group)));
  const outputWarnings = $derived(getConnectedOutputConfigurationWarnings(
    nodeOutputs,
    properties,
    propertySchemas,
    outgoingEdges
      .map((edge) => edge.sourceHandle)
      .filter((handle): handle is string => Boolean(handle)),
  ));
  const statusRows = $derived(getNodeStatusRows(nodePresentation, lastOutput));
  const propertyEntries = $derived(
    Object.entries(propertySchemas) as Array<[string, PropertySchema]>
  );
  const standardPropertyEntries = $derived(
    propertyEntries.filter(([, schema]) => !schema.advanced)
  );
  const advancedPropertyEntries = $derived(
    propertyEntries.filter(([, schema]) => schema.advanced)
  );
  const normalizedNodeType = $derived(nodeType.replace(/^cognitive\//, ''));
  const isModelRouter = $derived(normalizedNodeType === 'model_router');
  const modelRole = $derived(String(properties.role ?? 'persona'));
  const promptSourceEdge = $derived(
    incomingEdges.find((edge) => edge.targetHandle === 'messages')
  );
  const promptSourceNode = $derived(
    promptSourceEdge
      ? graphNodes.find((node) => node.id === promptSourceEdge.source) || null
      : null
  );
  const jsonSchemaConnected = $derived(
    incomingEdges.some((edge) => edge.targetHandle === 'jsonSchema')
  );
  const responseConnected = $derived(
    outgoingEdges.some((edge) => edge.sourceHandle === 'response')
  );
  const environmentSelectorInstance = $derived(
    isModelRouter && (
      modelRole === 'environmentActionSelector'
      || nodeTitle.toLowerCase().includes('environment action selector')
    )
  );
  const contractWarnings = $derived.by(() => {
    if (!isModelRouter) return [] as string[];

    const warnings: string[] = [];
    if (!promptSourceEdge) {
      warnings.push('No messages input is connected, so this node will skip model inference.');
    }
    if (properties.format === 'json' && !jsonSchemaConnected) {
      warnings.push('JSON mode has no connected schema. Only a role-specific fallback schema, when available, can constrain the response.');
    }
    if (properties.format !== 'json' && jsonSchemaConnected) {
      warnings.push('A JSON Schema is connected but ignored because Response Format is not JSON.');
    }
    if (!responseConnected) {
      warnings.push('The response output is not connected, so the model result has no downstream consumer.');
    }
    if (environmentSelectorInstance && modelRole !== 'environmentActionSelector') {
      warnings.push('This Environment Action Selector is no longer using the environmentActionSelector model role.');
    }
    if (environmentSelectorInstance && properties.format !== 'json') {
      warnings.push('Environment Action Selector requires JSON mode for its downstream parser contract.');
    }
    return warnings;
  });

  // Update a property value
  function updateProperty(key: string, value: any) {
    if (!selectedNode || !onUpdateNodeProperty) return;
    onUpdateNodeProperty(selectedNode.id, key, value);
  }

  function updateNodeMetadata(key: 'title' | 'comment', value: string) {
    if (!selectedNode || !onUpdateNodeData) return;
    onUpdateNodeData(selectedNode.id, { [key]: value });
  }

  function nodeDisplayName(nodeId: string): string {
    const node = graphNodes.find((candidate) => candidate.id === nodeId);
    if (!node) return nodeId;
    return String(
      node.data?.title
      || node.data?.label
      || node.data?.schema?.name
      || nodeId
    );
  }

  function edgeComment(edge: Edge): string {
    const comment = (edge.data as Record<string, unknown> | undefined)?.comment;
    return typeof comment === 'string' ? comment : '';
  }

  function inputIsConnected(name: string): boolean {
    return incomingEdges.some((edge) => edge.targetHandle === name);
  }

  function outputIsConnected(name: string): boolean {
    return outgoingEdges.some((edge) => edge.sourceHandle === name);
  }

  function propertyIsOverridden(key: string): boolean {
    return inputIsConnected(key);
  }

  function formatOutputPreview(value: unknown): string {
    return safeOutputPreview(value, 8_000);
  }

</script>

<div class="bg-slate-800 border-l border-slate-700 h-full overflow-y-auto text-slate-200 text-[13px]">
  {#if selectedNode}
    <div class="p-4 border-b border-slate-700 bg-slate-900">
      <div class="mb-1 flex items-start justify-between gap-3">
        <h3 class="m-0 text-base font-semibold text-slate-50">{nodeTitle}</h3>
        <span class="rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide {executionState === 'failed' ? 'bg-red-950 text-red-300' : executionState === 'completed' ? 'bg-emerald-950 text-emerald-300' : executionState === 'running' ? 'bg-blue-950 text-blue-300' : executionState === 'skipped' ? 'bg-slate-700 text-slate-300' : 'bg-slate-800 text-slate-500'}">{executionState}</span>
      </div>
      <span class="text-[11px] text-slate-500 font-mono">ID: {selectedNode.id}</span>
      <span class="block mt-1 text-[11px] text-slate-400 font-mono">Type: {nodeType}{nodeCategory ? ` · ${nodeCategory}` : ''}</span>
      {#if selectedNode.data?.schema?.version || selectedNode.data?.schema?.deprecated || selectedNode.data?.schema?.editorOnly}
        <div class="mt-2 flex flex-wrap gap-1.5 text-[9px] font-semibold uppercase tracking-wide">
          {#if selectedNode.data?.schema?.version}<span class="rounded bg-slate-800 px-1.5 py-0.5 text-slate-400">v{selectedNode.data.schema.version}</span>{/if}
          {#if selectedNode.data?.schema?.editorOnly}<span class="rounded bg-cyan-950 px-1.5 py-0.5 text-cyan-300">editor only</span>{/if}
          {#if selectedNode.data?.schema?.deprecated}<span class="rounded bg-amber-950 px-1.5 py-0.5 text-amber-300">deprecated</span>{/if}
        </div>
      {/if}
    </div>

    <section class="py-3 px-4 border-b border-slate-700">
      <h4 class="section-title">What This Node Does</h4>
      {#if nodeComment}
        <p class="m-0 text-xs text-slate-200 leading-relaxed">{nodeComment}</p>
        {#if nodeDescription}
          <p class="mt-2 mb-0 text-[11px] text-slate-500 leading-relaxed"><span class="font-medium text-slate-400">Implementation:</span> {nodeDescription}</p>
        {/if}
      {:else if nodeDescription}
        <p class="m-0 text-xs text-slate-300 leading-relaxed">{nodeDescription}</p>
      {:else}
        <p class="m-0 text-xs italic text-slate-500">No workflow purpose has been documented for this node.</p>
      {/if}
      {#if nodePresentation?.badges?.length}
        <div class="mt-3 flex flex-wrap gap-1.5" aria-label="Node behavior">
          {#each nodePresentation.badges as badge}
            <span class="presentation-badge badge-{badge.tone || 'neutral'}">{badge.label}</span>
          {/each}
        </div>
      {/if}
      {#if selectedNode.data?.schema?.documentation && !selectedNode.data.schema.documentation.complete}
        <details class="mt-3 rounded border border-slate-700 bg-slate-900/50 p-2.5 text-[10px] text-slate-500">
          <summary class="cursor-pointer text-slate-400">Schema documentation gaps</summary>
          {#if selectedNode.data.schema.documentation.missingInputs.length}<p class="mb-0 mt-2">Inputs: {selectedNode.data.schema.documentation.missingInputs.join(', ')}</p>{/if}
          {#if selectedNode.data.schema.documentation.missingOutputs.length}<p class="mb-0 mt-2">Outputs: {selectedNode.data.schema.documentation.missingOutputs.join(', ')}</p>{/if}
          {#if selectedNode.data.schema.documentation.missingProperties.length}<p class="mb-0 mt-2">Settings: {selectedNode.data.schema.documentation.missingProperties.join(', ')}</p>{/if}
        </details>
      {/if}
    </section>

    {#if statusRows.length}
      <section class="py-3 px-4 border-b border-slate-700 bg-cyan-950/10">
        <h4 class="section-title text-cyan-300">{nodePresentation?.statusTitle || 'Last Run Status'}</h4>
        <dl class="m-0 grid grid-cols-[88px_1fr] gap-x-2 gap-y-2 text-[11px]">
          {#each statusRows as row}
            <dt class="text-slate-500">{row.label}</dt>
            <dd
              class="m-0 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-right font-mono text-slate-300"
              class:text-emerald-300={row.tone === 'success'}
              class:text-amber-300={row.tone === 'warning'}
              title={row.title || ''}
            >{row.value}</dd>
          {/each}
        </dl>
      </section>
    {/if}

    {#if isModelRouter}
      <section class="py-3 px-4 border-b border-slate-700 bg-orange-950/20">
        <h4 class="section-title text-orange-300">Effective Model Call</h4>
        <dl class="m-0 grid grid-cols-[88px_1fr] gap-x-2 gap-y-2 text-[11px]">
          <dt class="text-slate-500">Role</dt>
          <dd class="m-0 font-mono text-orange-200">{modelRole}</dd>
          <dt class="text-slate-500">Prompt owner</dt>
          <dd class="m-0">
            {#if promptSourceNode}
              <button type="button" class="inspector-link" onclick={() => onSelectNode?.(promptSourceNode.id)}>{nodeDisplayName(promptSourceNode.id)}</button>
            {:else}
              <span class="text-red-300">Not connected</span>
            {/if}
          </dd>
          <dt class="text-slate-500">Output mode</dt>
          <dd class="m-0 font-mono text-slate-300">{String(properties.format ?? 'text')}</dd>
          <dt class="text-slate-500">Direct effects</dt>
          <dd class="m-0 text-slate-300">None; downstream nodes consume the response.</dd>
        </dl>
        <p class="mt-3 mb-0 text-[11px] leading-relaxed text-slate-400">The selected role resolves through the active profile's Model Registry. Prompt text remains owned by the connected upstream node.</p>

        {#if contractWarnings.length}
          <div class="mt-3 grid gap-2">
            {#each contractWarnings as warning}
              <div class="rounded border border-amber-800/70 bg-amber-950/40 px-2.5 py-2 text-[11px] leading-snug text-amber-200">{warning}</div>
            {/each}
          </div>
        {:else}
          <div class="mt-3 rounded border border-emerald-900 bg-emerald-950/30 px-2.5 py-2 text-[11px] text-emerald-300">Connected model-call contract is complete.</div>
        {/if}
      </section>
    {/if}

    <section class="py-3 px-4 border-b border-slate-700">
      <h4 class="section-title">Workflow Connections</h4>
      <div class="grid gap-3">
        <div>
          <div class="mb-1.5 text-[11px] font-medium text-slate-500">Incoming · {incomingEdges.length}</div>
          {#if incomingEdges.length}
            <div class="grid gap-1.5">
              {#each incomingEdges as edge}
                <div class="rounded border border-slate-700 bg-slate-900/60 px-2.5 py-2">
                  <button type="button" class="inspector-link" onclick={() => onSelectNode?.(edge.source)}>{nodeDisplayName(edge.source)}</button>
                  <div class="mt-1 font-mono text-[10px] text-slate-500">{edge.sourceHandle || 'output'} → {edge.targetHandle || 'input'}</div>
                  {#if edgeComment(edge)}<p class="mt-1.5 mb-0 text-[11px] leading-snug text-slate-400">{edgeComment(edge)}</p>{/if}
                </div>
              {/each}
            </div>
          {:else}
            <div class="text-[11px] italic text-slate-600">No incoming connections</div>
          {/if}
        </div>
        <div>
          <div class="mb-1.5 text-[11px] font-medium text-slate-500">Outgoing · {outgoingEdges.length}</div>
          {#if outgoingEdges.length}
            <div class="grid gap-1.5">
              {#each outgoingEdges as edge}
                <div class="rounded border border-slate-700 bg-slate-900/60 px-2.5 py-2">
                  <button type="button" class="inspector-link" onclick={() => onSelectNode?.(edge.target)}>{nodeDisplayName(edge.target)}</button>
                  <div class="mt-1 font-mono text-[10px] text-slate-500">{edge.sourceHandle || 'output'} → {edge.targetHandle || 'input'}</div>
                  {#if edgeComment(edge)}<p class="mt-1.5 mb-0 text-[11px] leading-snug text-slate-400">{edgeComment(edge)}</p>{/if}
                </div>
              {/each}
            </div>
          {:else}
            <div class="text-[11px] italic text-slate-600">No outgoing connections</div>
          {/if}
        </div>
      </div>
    </section>

    <NodeActivationEditor
      {selectedNode}
      {graphNodes}
      {graphEdges}
      {onUpdateNodeData}
    />

    {#if outputWarnings.length}
      <section class="py-3 px-4 border-b border-amber-900/70 bg-amber-950/25">
        <h4 class="section-title text-amber-300">Configuration Warnings</h4>
        <div class="grid gap-2">
          {#each outputWarnings as warning}
            <div class="rounded border border-amber-800/70 bg-amber-950/40 px-2.5 py-2 text-[11px] leading-snug text-amber-200">{warning}</div>
          {/each}
        </div>
      </section>
    {/if}

    <section class="p-4 border-b border-slate-700">
      <h4 class="section-title">Settings</h4>
      {#each standardPropertyEntries as [key, schema]}
        <NodePropertyField
          contextId={`inspector-${selectedNode.id}`}
          propertyKey={key}
          {schema}
          value={properties[key]}
          overridden={propertyIsOverridden(key)}
          onValueChange={(value) => updateProperty(key, value)}
        />
      {/each}

      {#if advancedPropertyEntries.length}
        <details class="rounded border border-slate-700 bg-slate-900/40">
          <summary class="cursor-pointer select-none px-3 py-2.5 text-xs font-semibold text-slate-300">Advanced settings · {advancedPropertyEntries.length}</summary>
          <div class="border-t border-slate-700 px-3 pt-3">
            {#each advancedPropertyEntries as [key, schema]}
              <NodePropertyField
                contextId={`inspector-${selectedNode.id}`}
                propertyKey={key}
                {schema}
                value={properties[key]}
                overridden={propertyIsOverridden(key)}
                onValueChange={(value) => updateProperty(key, value)}
              />
            {/each}
          </div>
        </details>
      {/if}

      {#if propertyEntries.length === 0}
        <p class="text-slate-500 italic text-center py-3">This node has no editable runtime settings.</p>
      {/if}
    </section>

    <details class="border-b border-slate-700">
      <summary class="cursor-pointer select-none py-3 px-4 text-xs font-semibold uppercase tracking-wide text-slate-400">Complete Port Contract</summary>
      <div class="px-4 pb-4 grid grid-cols-1 gap-3">
        <div>
          <div class="mb-1 text-[11px] font-medium text-slate-500">Inputs</div>
          {#if nodeInputs.length}
            {#each nodeInputs as port}
              <div class="mb-1.5 rounded border border-slate-700 bg-slate-900/60 px-2 py-1.5">
                <div class="flex items-center justify-between gap-2 font-mono text-[11px] text-slate-200">
                  <span>{port.name} <span class="text-slate-500">· {port.type || 'any'}{port.optional ? ' · optional' : ''}</span></span>
                  <span class="text-[9px] uppercase tracking-wide {inputIsConnected(port.name) ? 'text-emerald-400' : 'text-slate-600'}">{inputIsConnected(port.name) ? 'connected' : 'unconnected'}</span>
                </div>
                {#if port.description}<div class="mt-1 text-[11px] leading-snug text-slate-500">{port.description}</div>{/if}
              </div>
            {/each}
          {:else}
            <div class="text-[11px] italic text-slate-600">No inputs</div>
          {/if}
        </div>
        <div>
          <div class="mb-1 text-[11px] font-medium text-slate-500">Outputs</div>
          {#if nodeOutputs.length}
            {#each outputGroups as group}
              {#if hasOutputGroups}
                <div class="mb-2 mt-3 first:mt-0 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{group.label}</div>
              {/if}
              {#each group.slots as port}
                <div class="mb-1.5 rounded border border-slate-700 bg-slate-900/60 px-2 py-1.5">
                  <div class="flex items-center justify-between gap-2 font-mono text-[11px] text-slate-200">
                    <span>
                      {port.label || port.name}
                      {#if port.label && port.label !== port.name}<span class="text-slate-600"> · {port.name}</span>{/if}
                      <span class="text-slate-500"> · {port.type || 'any'}</span>
                    </span>
                    <span class="text-[9px] uppercase tracking-wide {outputIsConnected(port.name) ? 'text-emerald-400' : 'text-slate-600'}">{outputIsConnected(port.name) ? 'connected' : 'unconnected'}</span>
                  </div>
                  {#if port.description}<div class="mt-1 text-[11px] leading-snug text-slate-500">{port.description}</div>{/if}
                </div>
              {/each}
            {/each}
          {:else}
            <div class="text-[11px] italic text-slate-600">No outputs</div>
          {/if}
        </div>
      </div>
    </details>

    <details class="border-b border-slate-700" open={lastOutput !== undefined}>
      <summary class="cursor-pointer select-none py-3 px-4 text-xs font-semibold uppercase tracking-wide text-slate-400">Last Run</summary>
      <div class="px-4 pb-4">
        <div class="flex items-center justify-between text-[11px]">
          <span class="text-slate-500">State</span>
          <span class="font-mono text-slate-300">{executionState}</span>
        </div>
        {#if executionSkipReason}
          <p class="mt-2 mb-0 rounded border border-slate-700 bg-slate-900 p-2 text-[11px] text-slate-400">{executionSkipReason}</p>
        {/if}
        {#if lastRunDurationMs !== null}
          <div class="mt-2 flex items-center justify-between text-[11px]">
            <span class="text-slate-500">Graph duration</span>
            <span class="font-mono text-slate-300">{lastRunDurationMs} ms</span>
          </div>
        {/if}
        {#if lastOutput !== undefined}
          <pre class="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded border border-slate-700 bg-slate-950 p-2.5 text-[10px] leading-relaxed text-slate-300">{formatOutputPreview(lastOutput)}</pre>
        {:else}
          <p class="mb-0 mt-3 text-[11px] italic text-slate-600">Run the graph to inspect this node's output.</p>
        {/if}
      </div>
    </details>

    <details class="border-b border-slate-700">
      <summary class="cursor-pointer select-none py-3 px-4 text-xs font-semibold uppercase tracking-wide text-slate-400">Workflow Details</summary>
      <div class="px-4 pb-4">
        <label class="block mb-1.5 font-medium text-slate-300 text-xs" for="node-display-name">Display Name</label>
        <input
          id="node-display-name"
          type="text"
          class="property-input"
          value={nodeTitle}
          oninput={(e) => updateNodeMetadata('title', (e.target as HTMLInputElement).value)}
        />
        <label class="block mt-4 mb-1.5 font-medium text-slate-300 text-xs" for="node-workflow-note">Workflow Purpose</label>
        <textarea
          id="node-workflow-note"
          class="property-input resize-y min-h-[112px]"
          value={nodeComment}
          placeholder="Explain why this instance exists and what it contributes to this workflow."
          rows="6"
          oninput={(e) => updateNodeMetadata('comment', (e.target as HTMLTextAreaElement).value)}
        ></textarea>
        <p class="mt-1.5 mb-0 text-[11px] text-slate-500 leading-snug">This note belongs to the workflow instance. The implementation description remains owned by the reusable node definition.</p>
      </div>
    </details>
  {:else}
    <div class="flex items-center justify-center h-full text-slate-500 text-center p-5">
      <p class="m-0">Select a node to view its purpose, connections, and settings.</p>
    </div>
  {/if}
</div>

<style>
  .section-title {
    @apply m-0 mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400;
  }
  .presentation-badge {
    @apply rounded border px-2 py-1 text-[9px] font-semibold uppercase tracking-wide;
  }
  .badge-neutral {
    @apply border-slate-700 bg-slate-900/60 text-slate-400;
  }
  .badge-info {
    @apply border-cyan-800 bg-cyan-950/40 text-cyan-300;
  }
  .badge-success {
    @apply border-emerald-800 bg-emerald-950/40 text-emerald-300;
  }
  .badge-warning {
    @apply border-amber-800 bg-amber-950/40 text-amber-300;
  }

  .inspector-link {
    @apply border-0 bg-transparent p-0 text-left text-[11px] font-medium text-blue-300 underline decoration-blue-500/40 underline-offset-2 cursor-pointer;
  }
  .inspector-link:hover {
    @apply text-blue-200 decoration-blue-300;
  }

  /* Workflow metadata fields */
  .property-input {
    @apply w-full py-2 px-2.5 bg-slate-900 border border-slate-700 rounded-md text-slate-200 text-[13px] box-border;
    font-family: inherit;
  }
  .property-input:focus {
    @apply outline-none border-blue-500;
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
  }
  .property-input:disabled {
    @apply cursor-not-allowed opacity-50;
  }
</style>
