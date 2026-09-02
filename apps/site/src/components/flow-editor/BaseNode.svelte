<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte'
  import {
    Handle,
    NodeResizer,
    Position,
    type ResizeDragEvent,
    type ResizeParams,
    useNodeConnections,
    useNodes,
    useUpdateNodeInternals,
  } from '@xyflow/svelte'
  import type { NodeSchema } from '@metahuman/core/nodes/types'
  import NodePropertyField from './NodePropertyField.svelte'
  import { requireFlowEditorActions } from '../../lib/client/flow-editor/flow-editor-context'
  import {
    formatPropertySummary,
    getConnectedOutputConfigurationWarnings,
    getNodeStatusRows,
    groupCanvasProperties,
    isPromptInputHandle,
  } from '../../lib/client/flow-editor/node-property-presentation'

  const NOTE_STYLE_COLORS = {
    info: { color: '#60a5fa', bgColor: '#1e3a8a', icon: '📝' },
    warning: { color: '#fbbf24', bgColor: '#92400e', icon: '⚠️' },
    success: { color: '#4ade80', bgColor: '#166534', icon: '✅' },
    error: { color: '#f87171', bgColor: '#991b1b', icon: '❌' },
  } as const

  let {
    id,
    data,
    selected = false,
  }: {
    id: string
    data: {
      schema: NodeSchema
      properties?: Record<string, unknown>
      title?: string
      comment?: string
      muted?: boolean
      executionState?: 'idle' | 'running' | 'completed' | 'failed'
      executionOutput?: unknown
      isUnconnected?: boolean
    }
    selected?: boolean
  } = $props()

  const editorActions = requireFlowEditorActions()
  const inputConnections = useNodeConnections({
    id: untrack(() => id),
    handleType: 'target',
  })
  const outputConnections = useNodeConnections({
    id: untrack(() => id),
    handleType: 'source',
  })
  const flowNodes = useNodes()
  const updateNodeInternals = useUpdateNodeInternals()

  const schema = $derived(data.schema)
  const presentation = $derived(schema?.presentation)
  const properties = $derived(data.properties ?? {})
  const graphNoteStyle = $derived(
    schema?.id === 'graph_note'
      ? NOTE_STYLE_COLORS[String(properties.style ?? 'info') as keyof typeof NOTE_STYLE_COLORS]
        ?? NOTE_STYLE_COLORS.info
      : null,
  )
  const nodeColor = $derived(graphNoteStyle?.color ?? schema?.color ?? '#94a3b8')
  const nodeBackground = $derived(graphNoteStyle?.bgColor ?? schema?.bgColor ?? '#475569')
  const nodeTitle = $derived(
    schema?.id === 'graph_note'
      ? String(properties.title || data.title || schema?.name || 'Note')
      : (data.title || schema?.name || 'Node'),
  )
  const nodePurpose = $derived(data.comment || schema?.description || '')
  const isMuted = $derived(data.muted || false)
  const executionState = $derived(data.executionState || 'idle')
  const isUnconnected = $derived(data.isUnconnected || false)
  const categoryBadge = $derived(
    schema?.id === 'graph_note'
      ? 'NOTE'
      : (schema?.category?.slice(0, 3).toUpperCase() || 'NOD'),
  )

  const propertyGroups = $derived(groupCanvasProperties(schema?.propertySchemas))
  const primaryProperties = $derived(propertyGroups.primary)
  const settingProperties = $derived(propertyGroups.settings)
  const advancedProperties = $derived(propertyGroups.advanced)
  const compactSettingProperties = $derived(
    [...settingProperties, ...advancedProperties].slice(0, 4),
  )
  const remainingCompactSettings = $derived(
    settingProperties.length + advancedProperties.length - compactSettingProperties.length,
  )
  const propertyCount = $derived(
    primaryProperties.length + settingProperties.length + advancedProperties.length,
  )

  let expanded = $state(untrack(() => (
    data.schema?.presentation?.defaultExpanded || data.schema?.id === 'text_input'
  )))
  let requestedPrimaryKey = $state<string | null>(null)
  let nodeElement = $state<HTMLDivElement | null>(null)
  let nodeInternalsFrame: number | null = null
  const activePrimaryProperty = $derived(
    primaryProperties.find(([key]) => key === requestedPrimaryKey)
    ?? primaryProperties[0]
    ?? null,
  )

  const promptSourceConnection = $derived(
    inputConnections.current.find((connection) => isPromptInputHandle(connection.targetHandle))
    ?? null,
  )
  const promptSourceNode = $derived(
    promptSourceConnection
      ? flowNodes.current.find((node) => node.id === promptSourceConnection.source) ?? null
      : null,
  )
  const promptSourceName = $derived(
    String(
      promptSourceNode?.data?.title
      || promptSourceNode?.data?.label
      || promptSourceNode?.data?.schema?.name
      || promptSourceConnection?.source
      || 'connected node',
    ),
  )

  const isDisplayNode = $derived(
    schema?.id === 'chat_view'
    || schema?.id === 'display_buffer'
    || schema?.id === 'output_viewer',
  )
  const hasOutput = $derived(isDisplayNode && Boolean(data.executionOutput))
  const nodeInputs = $derived(schema?.inputs ?? [])
  const nodeOutputs = $derived(schema?.outputs ?? [])
  const hasPrimaryOutputHints = $derived(nodeOutputs.some((output) => output.primary))
  const visibleNodeOutputs = $derived(
    expanded || !hasPrimaryOutputHints
      ? nodeOutputs
      : nodeOutputs.filter((output) => (
          output.primary
          || outputConnections.current.some((connection) => connection.sourceHandle === output.name)
        )),
  )
  const hiddenOutputCount = $derived(nodeOutputs.length - visibleNodeOutputs.length)
  const maxSlots = $derived(Math.max(nodeInputs.length, visibleNodeOutputs.length, 1))
  const portRows = $derived(
    Array.from({ length: maxSlots }, (_, index) => ({
      input: nodeInputs[index],
      output: visibleNodeOutputs[index],
    })),
  )
  const outputWarnings = $derived(getConnectedOutputConfigurationWarnings(
    nodeOutputs,
    properties,
    schema?.propertySchemas,
    outputConnections.current
      .map((connection) => connection.sourceHandle)
      .filter((handle): handle is string => Boolean(handle)),
  ))
  const statusRows = $derived(getNodeStatusRows(presentation, data.executionOutput))
  const hasExpandableContent = $derived(
    propertyCount > 0 || Boolean(nodePurpose) || Boolean(promptSourceConnection),
  )

  function inputIsConnected(propertyKey: string): boolean {
    return inputConnections.current.some((connection) => connection.targetHandle === propertyKey)
  }

  function updateProperty(propertyKey: string, value: unknown): void {
    editorActions.updateNodeProperty(id, propertyKey, value)
  }

  function scheduleNodeInternalsUpdate(): void {
    if (nodeInternalsFrame !== null) return

    nodeInternalsFrame = requestAnimationFrame(() => {
      nodeInternalsFrame = null
      updateNodeInternals(id)
    })
  }

  $effect(() => {
    const element = nodeElement
    if (!element || typeof ResizeObserver === 'undefined') return

    const initialBounds = element.getBoundingClientRect()
    let observedWidth = initialBounds.width
    let observedHeight = initialBounds.height
    const observer = new ResizeObserver(([entry]) => {
      const bounds = entry?.contentRect ?? element.getBoundingClientRect()
      const widthChanged = Math.abs(bounds.width - observedWidth) > 0.5
      const heightChanged = Math.abs(bounds.height - observedHeight) > 0.5
      if (!widthChanged && !heightChanged) return

      observedWidth = bounds.width
      observedHeight = bounds.height
      scheduleNodeInternalsUpdate()
    })

    observer.observe(element)
    return () => observer.disconnect()
  })

  onDestroy(() => {
    if (nodeInternalsFrame !== null) cancelAnimationFrame(nodeInternalsFrame)
  })

  function handleResizeEnd(_event: ResizeDragEvent, params: ResizeParams): void {
    editorActions.updateNodeWidth(id, params.width)
    scheduleNodeInternalsUpdate()
  }

  async function toggleExpanded(event: MouseEvent): Promise<void> {
    event.stopPropagation()
    expanded = !expanded
    await tick()
    scheduleNodeInternalsUpdate()
  }

  function selectPromptSource(event: MouseEvent): void {
    event.stopPropagation()
    if (promptSourceConnection) editorActions.selectNode(promptSourceConnection.source)
  }
</script>

<div
  bind:this={nodeElement}
  class="base-node"
  class:selected
  class:muted={isMuted}
  class:running={executionState === 'running'}
  class:completed={executionState === 'completed'}
  class:failed={executionState === 'failed'}
  class:unconnected={isUnconnected}
  class:expanded
  style="--node-color: {nodeColor}; --node-bg: {nodeBackground};"
>
  <NodeResizer
    isVisible={selected && expanded}
    minWidth={360}
    maxWidth={960}
    resizeDirection="horizontal"
    color={nodeColor}
    onResizeEnd={handleResizeEnd}
  />

  <div class="node-header">
    <span class="category-badge">{categoryBadge}</span>
    {#if graphNoteStyle}<span class="note-icon" aria-hidden="true">{graphNoteStyle.icon}</span>{/if}
    <span class="node-title" title={nodeTitle}>{nodeTitle}</span>
    {#if isMuted}
      <span class="muted-badge">MUTED</span>
    {/if}
    {#if hasExpandableContent}
      <button
        type="button"
        class="expand-button nodrag nopan"
        aria-label={expanded ? `Collapse ${nodeTitle}` : `Expand ${nodeTitle}`}
        aria-expanded={expanded}
        title={expanded ? 'Collapse node details' : 'Expand node details'}
        onclick={toggleExpanded}
      >{expanded ? '−' : '+'}</button>
    {/if}
  </div>

  <div class="node-body">
    {#if nodePurpose}
      <p class="node-purpose" class:purpose-expanded={expanded} title={nodePurpose}>{nodePurpose}</p>
      {#if expanded && data.comment && schema?.description && data.comment !== schema.description}
        <p class="implementation-description"><strong>Implementation:</strong> {schema.description}</p>
      {/if}
    {/if}

    {#if presentation?.badges?.length}
      <div class="node-badges" aria-label="Node behavior">
        {#each presentation.badges as badge}
          <span class="node-badge badge-{badge.tone || 'neutral'}">{badge.label}</span>
        {/each}
      </div>
    {/if}

    {#if statusRows.length}
      <section class="runtime-summary">
        <div class="summary-heading">{presentation?.statusTitle || 'Last run'}</div>
        {#each statusRows as row}
          <div class="runtime-summary-row" title={row.title || ''}>
            <span>{row.label}</span>
            <strong
              class:status-success={row.tone === 'success'}
              class:status-warning={row.tone === 'warning'}
            >{row.value}</strong>
          </div>
        {/each}
      </section>
    {/if}

    {#if outputWarnings.length}
      <div class="output-warning" title={outputWarnings.join('\n')}>
        ⚠ {outputWarnings.length} connected output{outputWarnings.length === 1 ? '' : 's'} affected by settings
      </div>
    {/if}

    {#if !expanded}
      {#if primaryProperties.length}
        {@const [primaryKey, primarySchema] = primaryProperties[0]}
        <div class="prompt-preview" title={String(properties[primaryKey] ?? primarySchema.default ?? '')}>
          <div class="summary-heading">
            <span>
              {primarySchema.label || primaryKey}
              {primaryProperties.length > 1 ? ` · +${primaryProperties.length - 1} field${primaryProperties.length === 2 ? '' : 's'}` : ''}
            </span>
            {#if inputIsConnected(primaryKey)}<span class="linked-badge">linked</span>{/if}
          </div>
          <div class="prompt-preview-value">
            {inputIsConnected(primaryKey)
              ? 'Supplied by a connected input'
              : formatPropertySummary(properties[primaryKey] ?? primarySchema.default, primarySchema, 150)}
          </div>
        </div>
      {/if}

      {#if promptSourceConnection}
        <button type="button" class="prompt-source nodrag nopan" onclick={selectPromptSource}>
          <span>Prompt input</span>
          <strong>{promptSourceName}</strong>
        </button>
      {/if}

      {#if compactSettingProperties.length}
        <div class="settings-summary">
          {#each compactSettingProperties as [propertyKey, propertySchema]}
            <div class="setting-summary-row" title={propertySchema.description}>
              <span>{propertySchema.label || propertyKey}</span>
              <strong class:linked-value={inputIsConnected(propertyKey)}>
                {inputIsConnected(propertyKey)
                  ? 'linked'
                  : formatPropertySummary(properties[propertyKey] ?? propertySchema.default, propertySchema, 48)}
              </strong>
            </div>
          {/each}
          {#if remainingCompactSettings > 0}
            <div class="more-settings">+{remainingCompactSettings} more settings</div>
          {/if}
        </div>
      {/if}
    {:else}
      {#if primaryProperties.length}
        <section class="inline-section">
          <div class="inline-section-heading">
            <span>Prompts and long text</span>
            <span>{primaryProperties.length}</span>
          </div>
          {#if primaryProperties.length > 1}
            <select
              class="prompt-selector nodrag nopan nowheel"
              aria-label="Prompt or text field"
              value={activePrimaryProperty?.[0] ?? ''}
              onchange={(event) => {
                requestedPrimaryKey = (event.target as HTMLSelectElement).value
              }}
            >
              {#each primaryProperties as [propertyKey, propertySchema]}
                <option value={propertyKey}>{propertySchema.label || propertyKey}</option>
              {/each}
            </select>
          {/if}
          {#if activePrimaryProperty}
            <NodePropertyField
              contextId={`canvas-${id}`}
              propertyKey={activePrimaryProperty[0]}
              schema={activePrimaryProperty[1]}
              value={properties[activePrimaryProperty[0]]}
              overridden={inputIsConnected(activePrimaryProperty[0])}
              density="canvas"
              showDescription={false}
              onContentResize={scheduleNodeInternalsUpdate}
              onValueChange={(value) => updateProperty(activePrimaryProperty![0], value)}
            />
          {/if}
        </section>
      {/if}

      {#if promptSourceConnection}
        <button type="button" class="prompt-source expanded-source nodrag nopan" onclick={selectPromptSource}>
          <span>{promptSourceConnection.targetHandle || 'prompt'} supplied by</span>
          <strong>{promptSourceName}</strong>
        </button>
      {/if}

      {#if settingProperties.length}
        <section class="inline-section">
          <div class="inline-section-heading"><span>Settings</span><span>{settingProperties.length}</span></div>
          {#each settingProperties as [propertyKey, propertySchema]}
            <NodePropertyField
              contextId={`canvas-${id}`}
              {propertyKey}
              schema={propertySchema}
              value={properties[propertyKey]}
              overridden={inputIsConnected(propertyKey)}
              density="canvas"
              showDescription={false}
              onContentResize={scheduleNodeInternalsUpdate}
              onValueChange={(value) => updateProperty(propertyKey, value)}
            />
          {/each}
        </section>
      {/if}

      {#if advancedProperties.length}
        <details class="advanced-settings nodrag nopan">
          <summary>Advanced settings · {advancedProperties.length}</summary>
          <div class="advanced-settings-body">
            {#each advancedProperties as [propertyKey, propertySchema]}
              <NodePropertyField
                contextId={`canvas-${id}`}
                {propertyKey}
                schema={propertySchema}
                value={properties[propertyKey]}
                overridden={inputIsConnected(propertyKey)}
                density="canvas"
                showDescription={false}
                onContentResize={scheduleNodeInternalsUpdate}
                onValueChange={(value) => updateProperty(propertyKey, value)}
              />
            {/each}
          </div>
        </details>
      {/if}
    {/if}

    {#if isDisplayNode}
      <div class="output-container nodrag nowheel">
        {#if hasOutput}
          <div class="output-display">{data.executionOutput}</div>
        {:else}
          <div class="output-placeholder">Output will appear here after execution…</div>
        {/if}
      </div>
    {/if}

    <div class="port-list">
      {#each portRows as row}
        <div class="port-row">
          {#if row.input}
            <Handle type="target" position={Position.Left} id={row.input.name} />
          {/if}
          <div class="slot-label input-label" title={row.input?.description || row.input?.name || ''}>
            {row.input?.label || row.input?.name || ''}
          </div>
          <div class="slot-label output-label" title={row.output?.description || row.output?.name || ''}>
            {row.output?.label || row.output?.name || ''}
          </div>
          {#if row.output}
            <Handle type="source" position={Position.Right} id={row.output.name} />
          {/if}
        </div>
      {/each}
      {#if hiddenOutputCount > 0}
        <div class="hidden-ports-summary">+{hiddenOutputCount} optional output{hiddenOutputCount === 1 ? '' : 's'}</div>
      {/if}
    </div>
  </div>
</div>

<style>
  .base-node {
    @apply relative box-border min-w-[220px] rounded-lg font-sans text-xs text-white transition-[border-color,box-shadow,opacity];
    width: 100%;
    max-width: 960px;
    background: var(--node-bg);
    border: 2px solid var(--node-color);
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
  }
  .base-node.expanded {
    min-width: 360px;
  }
  .base-node.selected {
    border-color: #fff;
    box-shadow: 0 0 0 2px var(--node-color), 0 4px 12px rgba(0, 0, 0, 0.4);
  }
  .base-node.muted { @apply opacity-50; }
  .base-node.running {
    @apply border-amber-400;
    box-shadow: 0 0 12px rgba(251, 191, 36, 0.5);
    animation: pulse 1s ease-in-out infinite;
  }
  .base-node.completed {
    @apply border-green-500;
    box-shadow: 0 0 8px rgba(34, 197, 94, 0.4);
  }
  .base-node.failed {
    @apply border-red-500;
    box-shadow: 0 0 8px rgba(239, 68, 68, 0.4);
  }
  .base-node.unconnected {
    @apply border-dashed border-yellow-500 opacity-80;
    box-shadow: 0 0 8px rgba(234, 179, 8, 0.3);
  }
  .node-header {
    @apply flex items-center gap-2 rounded-t-md border-b border-white/10 bg-black/30 px-3 py-2;
  }
  .category-badge {
    @apply rounded-sm px-1.5 py-0.5 text-[9px] font-bold tracking-wide;
    background: var(--node-color);
    color: var(--node-bg);
  }
  .node-title {
    @apply min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-semibold;
  }
  .note-icon {
    @apply text-sm leading-none;
  }
  .muted-badge {
    @apply rounded-sm bg-gray-600 px-1 py-0.5 text-[8px] text-gray-300;
  }
  .expand-button {
    @apply flex h-5 w-5 flex-none cursor-pointer items-center justify-center rounded border border-white/20 bg-black/25 p-0 text-sm leading-none text-white/80;
  }
  .expand-button:hover {
    @apply border-white/40 bg-black/40 text-white;
  }
  .node-body {
    @apply px-3 py-2;
  }
  .node-purpose {
    @apply mb-2 mt-0 overflow-hidden text-[10px] leading-snug text-white/70;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }
  .node-purpose.purpose-expanded {
    @apply text-[11px] text-white/85;
    display: block;
  }
  .implementation-description {
    @apply mb-3 mt-[-2px] text-[10px] leading-snug text-white/55;
  }
  .prompt-preview,
  .settings-summary,
  .inline-section,
  .advanced-settings,
  .runtime-summary,
  .prompt-source {
    @apply mb-2 rounded border border-white/15 bg-black/20;
  }
  .prompt-preview {
    @apply px-2 py-1.5;
  }
  .summary-heading,
  .inline-section-heading {
    @apply flex items-center justify-between gap-2 text-[9px] font-semibold uppercase tracking-wide text-white/55;
  }
  .node-badges {
    @apply mb-2 flex flex-wrap gap-1;
  }
  .node-badge {
    @apply rounded border px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide;
  }
  .badge-neutral {
    @apply border-white/15 bg-black/20 text-white/60;
  }
  .badge-info {
    @apply border-cyan-300/30 bg-cyan-950/40 text-cyan-200;
  }
  .badge-success {
    @apply border-emerald-300/30 bg-emerald-950/40 text-emerald-200;
  }
  .badge-warning {
    @apply border-amber-300/30 bg-amber-950/40 text-amber-200;
  }
  .runtime-summary {
    @apply px-2 py-1.5;
  }
  .runtime-summary-row {
    @apply mt-1 flex items-center justify-between gap-3 text-[9px];
  }
  .runtime-summary-row span {
    @apply text-white/55;
  }
  .runtime-summary-row strong {
    @apply min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-right font-medium text-white/90;
  }
  .runtime-summary-row strong.status-success {
    @apply text-emerald-300;
  }
  .runtime-summary-row strong.status-warning {
    @apply text-amber-300;
  }
  .output-warning {
    @apply mb-2 rounded border border-amber-400/30 bg-amber-950/40 px-2 py-1.5 text-[9px] leading-snug text-amber-200;
  }
  .linked-badge {
    @apply rounded bg-amber-950/70 px-1 py-0.5 text-[8px] text-amber-300;
  }
  .prompt-preview-value {
    @apply mt-1 overflow-hidden text-[10px] leading-snug text-white/85;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
  }
  .settings-summary {
    @apply divide-y divide-white/10 px-2;
  }
  .setting-summary-row {
    @apply grid grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] gap-2 py-1 text-[9px];
  }
  .setting-summary-row span {
    @apply overflow-hidden text-ellipsis whitespace-nowrap text-white/55;
  }
  .setting-summary-row strong {
    @apply overflow-hidden text-ellipsis whitespace-nowrap text-right font-medium text-white/90;
  }
  .setting-summary-row strong.linked-value {
    @apply text-amber-300;
  }
  .more-settings {
    @apply py-1 text-right text-[9px] italic text-white/45;
  }
  .prompt-source {
    @apply flex w-full cursor-pointer items-center justify-between gap-2 px-2 py-1.5 text-left text-[9px] text-white/60;
  }
  .prompt-source strong {
    @apply min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-right text-[10px] font-medium text-blue-200;
  }
  .prompt-source:hover strong {
    @apply text-blue-100 underline;
  }
  .expanded-source {
    @apply mb-3;
  }
  .inline-section {
    @apply px-2 pb-0 pt-2;
  }
  .inline-section-heading {
    @apply mb-2;
  }
  .prompt-selector {
    @apply mb-2 box-border w-full rounded border border-white/20 bg-black/30 px-2 py-1.5 text-[10px] text-white outline-none;
  }
  .prompt-selector:focus {
    @apply border-blue-400;
  }
  .advanced-settings {
    @apply overflow-hidden;
  }
  .advanced-settings summary {
    @apply cursor-pointer select-none px-2 py-2 text-[10px] font-semibold text-white/70;
  }
  .advanced-settings-body {
    @apply border-t border-white/10 px-2 pt-2;
  }
  .output-container {
    @apply mb-2;
  }
  .output-display {
    @apply box-border max-h-[200px] w-full overflow-y-auto whitespace-pre-wrap break-words rounded border border-green-500/40 bg-green-500/15 p-2 text-[11px] leading-snug text-green-100;
  }
  .output-placeholder {
    @apply box-border w-full rounded border border-dashed border-white/20 bg-black/30 px-2 py-3 text-center text-[10px] italic text-white/40;
  }
  .port-list {
    @apply -mx-3 mt-1;
  }
  .hidden-ports-summary {
    @apply px-3 py-1 text-right text-[9px] italic text-white/45;
  }
  .port-row {
    @apply relative grid h-5 grid-cols-2 items-center gap-4 px-3;
  }
  .slot-label {
    @apply h-5 overflow-hidden text-ellipsis whitespace-nowrap p-0 text-[10px] leading-5 text-white/70;
  }
  .output-label {
    @apply text-right;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.8; }
  }

  :global(.svelte-flow .svelte-flow__handle) {
    @apply h-2.5 w-2.5 rounded-full;
    border: 2px solid #1a1a1a;
    background: var(--node-color);
  }
</style>
