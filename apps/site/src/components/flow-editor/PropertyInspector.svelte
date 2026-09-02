<script lang="ts">
  import type { Edge, Node } from '@xyflow/svelte';

  interface PropertySchema {
    type:
      | 'string'
      | 'text'
      | 'text_multiline'
      | 'number'
      | 'slider'
      | 'select'
      | 'multiselect'
      | 'json'
      | 'color'
      | 'boolean'
      | 'toggle'
      | 'checkbox'
      | 'tags';
    default?: any;
    label?: string;
    description?: string;
    advanced?: boolean;
    options?: Array<string | { value: string; label: string }>;
    min?: number;
    max?: number;
    step?: number;
    rows?: number;
    placeholder?: string;
  }

  interface PortSchema {
    name: string;
    type?: string;
    optional?: boolean;
    description?: string;
  }

  let {
    selectedNode,
    graphNodes = [],
    graphEdges = [],
    lastOutput,
    lastRunDurationMs = null,
    onUpdateNodeData,
    onSelectNode,
  }: {
    selectedNode: Node | null;
    graphNodes?: Node[];
    graphEdges?: Edge[];
    lastOutput?: unknown;
    lastRunDurationMs?: number | null;
    onUpdateNodeData?: (nodeId: string, data: Record<string, any>) => void;
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
  const nodeInputs = $derived((selectedNode?.data?.schema?.inputs || []) as PortSchema[]);
  const nodeOutputs = $derived((selectedNode?.data?.schema?.outputs || []) as PortSchema[]);
  const nodeComment = $derived(
    typeof selectedNode?.data?.comment === 'string' ? selectedNode.data.comment : ''
  );
  const executionState = $derived(
    typeof selectedNode?.data?.executionState === 'string'
      ? selectedNode.data.executionState
      : 'idle'
  );
  const incomingEdges = $derived(
    selectedNode ? graphEdges.filter((edge) => edge.target === selectedNode.id) : []
  );
  const outgoingEdges = $derived(
    selectedNode ? graphEdges.filter((edge) => edge.source === selectedNode.id) : []
  );
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
    if (!selectedNode || !onUpdateNodeData) return;

    const newProperties = {
      ...selectedNode.data.properties,
      [key]: value
    };

    onUpdateNodeData(selectedNode.id, {
      properties: newProperties
    });
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
    try {
      const rendered = JSON.stringify(value, (_key, nestedValue) => {
        if (typeof nestedValue === 'string' && /^data:(?:image|audio)\//.test(nestedValue)) {
          return `[embedded media omitted: ${nestedValue.length} characters]`;
        }
        if (typeof nestedValue === 'string' && nestedValue.length > 2_000) {
          return `${nestedValue.slice(0, 2_000)}… [${nestedValue.length - 2_000} characters omitted]`;
        }
        return nestedValue;
      }, 2);
      if (!rendered) return String(value);
      return rendered.length > 8_000
        ? `${rendered.slice(0, 8_000)}\n… [output preview truncated]`
        : rendered;
    } catch {
      return String(value);
    }
  }

  // Parse JSON safely
  function parseJsonSafe(value: string): any {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  // Stringify for JSON display
  function stringifyJson(value: any): string {
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  function optionValue(option: string | { value: string; label: string }): string {
    return typeof option === 'string' ? option : option.value;
  }

  function optionLabel(option: string | { value: string; label: string }): string {
    return typeof option === 'string' ? option : option.label;
  }

  function parseTags(value: string): string[] {
    return value
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
  }
</script>

{#snippet propertyField(key: string, schemaTyped: PropertySchema)}
  {@const currentValue = properties[key] ?? schemaTyped.default}
  <div class="mb-4">
    <div class="mb-1.5 flex items-center justify-between gap-2">
      <label class="font-medium text-slate-300 text-xs" for={`prop-${key}`}>
        {schemaTyped.label || key}
      </label>
      {#if propertyIsOverridden(key)}
        <span class="rounded bg-amber-950 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-300">Input overrides</span>
      {/if}
    </div>

    {#if schemaTyped.type === 'text' || schemaTyped.type === 'string'}
      <input
        id={`prop-${key}`}
        type="text"
        class="property-input"
        value={currentValue ?? ''}
        placeholder={schemaTyped.placeholder || ''}
        disabled={propertyIsOverridden(key)}
        oninput={(e) => updateProperty(key, (e.target as HTMLInputElement).value)}
      />
    {:else if schemaTyped.type === 'text_multiline'}
      <textarea
        id={`prop-${key}`}
        class="property-input resize-y min-h-[96px]"
        value={currentValue ?? ''}
        placeholder={schemaTyped.placeholder || ''}
        disabled={propertyIsOverridden(key)}
        oninput={(e) => updateProperty(key, (e.target as HTMLTextAreaElement).value)}
        rows={schemaTyped.rows || 5}
      ></textarea>
    {:else if schemaTyped.type === 'number'}
      <input
        id={`prop-${key}`}
        type="number"
        class="property-input"
        value={currentValue ?? 0}
        min={schemaTyped.min}
        max={schemaTyped.max}
        step={schemaTyped.step || 1}
        disabled={propertyIsOverridden(key)}
        oninput={(e) => updateProperty(key, parseFloat((e.target as HTMLInputElement).value))}
      />
    {:else if schemaTyped.type === 'slider'}
      <div class="flex items-center gap-3">
        <input
          id={`prop-${key}`}
          type="range"
          class="property-slider"
          value={currentValue ?? schemaTyped.default ?? 0}
          min={schemaTyped.min ?? 0}
          max={schemaTyped.max ?? 1}
          step={schemaTyped.step ?? 0.1}
          disabled={propertyIsOverridden(key)}
          oninput={(e) => updateProperty(key, parseFloat((e.target as HTMLInputElement).value))}
        />
        <span class="min-w-[40px] text-right font-mono text-xs text-slate-400">{currentValue ?? schemaTyped.default ?? 0}</span>
      </div>
    {:else if schemaTyped.type === 'select'}
      <select
        id={`prop-${key}`}
        class="property-input"
        value={currentValue ?? optionValue(schemaTyped.options?.[0] || '')}
        disabled={propertyIsOverridden(key)}
        onchange={(e) => updateProperty(key, (e.target as HTMLSelectElement).value)}
      >
        {#each schemaTyped.options || [] as option}
          <option value={optionValue(option)}>{optionLabel(option)}</option>
        {/each}
      </select>
    {:else if schemaTyped.type === 'multiselect'}
      <select
        id={`prop-${key}`}
        class="property-input min-h-[96px]"
        multiple
        value={Array.isArray(currentValue) ? currentValue : []}
        disabled={propertyIsOverridden(key)}
        onchange={(e) => updateProperty(
          key,
          Array.from((e.target as HTMLSelectElement).selectedOptions).map((option) => option.value)
        )}
      >
        {#each schemaTyped.options || [] as option}
          <option value={optionValue(option)}>{optionLabel(option)}</option>
        {/each}
      </select>
    {:else if schemaTyped.type === 'color'}
      <div class="flex gap-2 items-center">
        <input
          id={`prop-${key}`}
          type="color"
          class="property-color"
          value={currentValue ?? '#808080'}
          disabled={propertyIsOverridden(key)}
          oninput={(e) => updateProperty(key, (e.target as HTMLInputElement).value)}
        />
        <input
          type="text"
          class="property-input flex-1"
          value={currentValue ?? ''}
          placeholder="#000000"
          disabled={propertyIsOverridden(key)}
          oninput={(e) => updateProperty(key, (e.target as HTMLInputElement).value)}
        />
      </div>
    {:else if schemaTyped.type === 'checkbox' || schemaTyped.type === 'boolean' || schemaTyped.type === 'toggle'}
      <input
        id={`prop-${key}`}
        type="checkbox"
        class="w-[18px] h-[18px] cursor-pointer accent-blue-500"
        checked={currentValue ?? false}
        disabled={propertyIsOverridden(key)}
        onchange={(e) => updateProperty(key, (e.target as HTMLInputElement).checked)}
      />
    {:else if schemaTyped.type === 'tags'}
      <input
        id={`prop-${key}`}
        type="text"
        class="property-input"
        value={Array.isArray(currentValue) ? currentValue.join(', ') : (currentValue ?? '')}
        placeholder={schemaTyped.placeholder || 'tag-one, tag-two'}
        disabled={propertyIsOverridden(key)}
        oninput={(e) => updateProperty(key, parseTags((e.target as HTMLInputElement).value))}
      />
    {:else if schemaTyped.type === 'json'}
      <textarea
        id={`prop-${key}`}
        class="property-input font-mono text-xs resize-y min-h-[60px]"
        value={stringifyJson(currentValue)}
        disabled={propertyIsOverridden(key)}
        oninput={(e) => updateProperty(key, parseJsonSafe((e.target as HTMLTextAreaElement).value))}
        rows="3"
      ></textarea>
    {:else}
      <input
        id={`prop-${key}`}
        type="text"
        class="property-input"
        value={currentValue || ''}
        disabled={propertyIsOverridden(key)}
        oninput={(e) => updateProperty(key, (e.target as HTMLInputElement).value)}
      />
    {/if}

    {#if schemaTyped.description}
      <p class="mt-1.5 mb-0 text-[11px] text-slate-500 leading-snug">{schemaTyped.description}</p>
    {/if}
    {#if propertyIsOverridden(key)}
      <p class="mt-1.5 mb-0 text-[11px] text-amber-400/80 leading-snug">The connected {key} input is the effective runtime value.</p>
    {/if}
  </div>
{/snippet}

<div class="bg-slate-800 border-l border-slate-700 h-full overflow-y-auto text-slate-200 text-[13px]">
  {#if selectedNode}
    <div class="p-4 border-b border-slate-700 bg-slate-900">
      <div class="mb-1 flex items-start justify-between gap-3">
        <h3 class="m-0 text-base font-semibold text-slate-50">{nodeTitle}</h3>
        <span class="rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide {executionState === 'failed' ? 'bg-red-950 text-red-300' : executionState === 'completed' ? 'bg-emerald-950 text-emerald-300' : executionState === 'running' ? 'bg-blue-950 text-blue-300' : 'bg-slate-800 text-slate-500'}">{executionState}</span>
      </div>
      <span class="text-[11px] text-slate-500 font-mono">ID: {selectedNode.id}</span>
      <span class="block mt-1 text-[11px] text-slate-400 font-mono">Type: {nodeType}{nodeCategory ? ` · ${nodeCategory}` : ''}</span>
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
    </section>

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

    <section class="p-4 border-b border-slate-700">
      <h4 class="section-title">Settings</h4>
      {#each standardPropertyEntries as [key, schema]}
        {@render propertyField(key, schema)}
      {/each}

      {#if advancedPropertyEntries.length}
        <details class="rounded border border-slate-700 bg-slate-900/40">
          <summary class="cursor-pointer select-none px-3 py-2.5 text-xs font-semibold text-slate-300">Advanced settings · {advancedPropertyEntries.length}</summary>
          <div class="border-t border-slate-700 px-3 pt-3">
            {#each advancedPropertyEntries as [key, schema]}
              {@render propertyField(key, schema)}
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
            {#each nodeOutputs as port}
              <div class="mb-1.5 rounded border border-slate-700 bg-slate-900/60 px-2 py-1.5">
                <div class="flex items-center justify-between gap-2 font-mono text-[11px] text-slate-200">
                  <span>{port.name} <span class="text-slate-500">· {port.type || 'any'}</span></span>
                  <span class="text-[9px] uppercase tracking-wide {outputIsConnected(port.name) ? 'text-emerald-400' : 'text-slate-600'}">{outputIsConnected(port.name) ? 'connected' : 'unconnected'}</span>
                </div>
                {#if port.description}<div class="mt-1 text-[11px] leading-snug text-slate-500">{port.description}</div>{/if}
              </div>
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

  .inspector-link {
    @apply border-0 bg-transparent p-0 text-left text-[11px] font-medium text-blue-300 underline decoration-blue-500/40 underline-offset-2 cursor-pointer;
  }
  .inspector-link:hover {
    @apply text-blue-200 decoration-blue-300;
  }

  /* Shared input styling */
  .property-input {
    @apply w-full py-2 px-2.5 bg-slate-900 border border-slate-700 rounded-md text-slate-200 text-[13px] box-border;
    font-family: inherit;
  }
  .property-input:focus {
    @apply outline-none border-blue-500;
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
  }
  .property-input:disabled,
  .property-slider:disabled {
    @apply cursor-not-allowed opacity-50;
  }

  /* Slider styling */
  .property-slider {
    @apply flex-1 h-1.5 bg-slate-700 rounded cursor-pointer;
    appearance: none;
  }
  .property-slider::-webkit-slider-thumb {
    @apply w-4 h-4 bg-blue-500 rounded-full cursor-pointer;
    appearance: none;
  }
  .property-slider::-moz-range-thumb {
    @apply w-4 h-4 bg-blue-500 rounded-full cursor-pointer border-0;
  }

  /* Color picker styling */
  .property-color {
    @apply w-10 h-9 p-0.5 bg-slate-900 border border-slate-700 rounded-md cursor-pointer;
  }
  .property-color::-webkit-color-swatch-wrapper {
    padding: 2px;
  }
  .property-color::-webkit-color-swatch {
    @apply rounded border-0;
  }
</style>
