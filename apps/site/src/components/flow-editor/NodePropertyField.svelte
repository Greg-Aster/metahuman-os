<script lang="ts">
  import { onMount } from 'svelte'
  import type { PropertySchema } from '@metahuman/core/nodes/types'
  import {
    CANVAS_TEXTAREA_MAX_HEIGHT,
    getCanvasTextareaHeight,
  } from '../../lib/client/flow-editor/node-property-layout'
  import {
    loadPropertySuggestions,
    type PropertySuggestion,
  } from '../../lib/client/flow-editor/property-suggestions'

  let {
    contextId,
    propertyKey,
    schema,
    value,
    overridden = false,
    density = 'inspector',
    showDescription = true,
    onValueChange,
    onContentResize,
  }: {
    contextId: string
    propertyKey: string
    schema: PropertySchema
    value: unknown
    overridden?: boolean
    density?: 'canvas' | 'inspector'
    showDescription?: boolean
    onValueChange: (value: unknown) => void
    onContentResize?: () => void
  } = $props()

  const currentValue = $derived(value ?? schema.default)
  const controlId = $derived(
    `property-${contextId}-${propertyKey}`.replace(/[^a-zA-Z0-9_-]/g, '-'),
  )
  const suggestionListId = $derived(`${controlId}-suggestions`)
  const selectedValues = $derived(
    Array.isArray(currentValue) ? currentValue.map((item) => String(item)) : [],
  )
  const textareaRows = $derived(
    density === 'canvas'
      ? Math.min(schema.rows ?? 5, 8)
      : (schema.rows ?? 5),
  )

  let suggestions = $state<PropertySuggestion[]>([])
  let suggestionsLoading = $state(false)
  let suggestionsError = $state('')

  async function refreshSuggestions(): Promise<void> {
    if (!schema.suggestions || suggestionsLoading) return
    suggestionsLoading = true
    suggestionsError = ''
    try {
      suggestions = await loadPropertySuggestions(schema.suggestions)
    } catch (error) {
      suggestionsError = error instanceof Error ? error.message : String(error)
    } finally {
      suggestionsLoading = false
    }
  }

  onMount(() => {
    if (schema.suggestions) void refreshSuggestions()
  })

  function optionValue(option: string | { value: string; label: string }): string {
    return typeof option === 'string' ? option : option.value
  }

  function optionLabel(option: string | { value: string; label: string }): string {
    return typeof option === 'string' ? option : option.label
  }

  function parseJsonSafe(nextValue: string): unknown {
    try {
      return JSON.parse(nextValue)
    } catch {
      return nextValue
    }
  }

  function stringifyJson(nextValue: unknown): string {
    if (typeof nextValue === 'string') return nextValue
    try {
      return JSON.stringify(nextValue, null, 2)
    } catch {
      return String(nextValue ?? '')
    }
  }

  function parseTags(nextValue: string): string[] {
    return nextValue
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean)
  }

  function updateNumber(nextValue: string): void {
    const parsed = Number(nextValue)
    if (Number.isFinite(parsed)) onValueChange(parsed)
  }

  function updateMultiselect(option: string, checked: boolean): void {
    const next = new Set(selectedValues)
    if (checked) next.add(option)
    else next.delete(option)
    onValueChange([...next])
  }

  function selectAllOptions(): void {
    onValueChange((schema.options || []).map(optionValue))
  }

  type AutoGrowOptions = {
    enabled: boolean
    value: unknown
  }

  function autoGrowTextarea(node: HTMLTextAreaElement, initialOptions: AutoGrowOptions) {
    let options = initialOptions
    let animationFrame: number | null = null
    let observedWidth = node.getBoundingClientRect().width

    function resize(): void {
      animationFrame = null

      if (!options.enabled) {
        node.style.removeProperty('height')
        node.style.removeProperty('overflow-y')
        return
      }

      const previousHeight = node.getBoundingClientRect().height
      node.style.height = '0px'

      const borderHeight = node.offsetHeight - node.clientHeight
      const contentHeight = node.scrollHeight + borderHeight
      const nextHeight = getCanvasTextareaHeight(contentHeight)

      node.style.height = `${nextHeight}px`
      node.style.overflowY = contentHeight > CANVAS_TEXTAREA_MAX_HEIGHT ? 'auto' : 'hidden'

      if (Math.abs(node.getBoundingClientRect().height - previousHeight) > 0.5) {
        onContentResize?.()
      }
    }

    function scheduleResize(): void {
      if (animationFrame !== null) cancelAnimationFrame(animationFrame)
      animationFrame = requestAnimationFrame(resize)
    }

    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(([entry]) => {
          const nextWidth = entry?.contentRect.width ?? node.getBoundingClientRect().width
          if (Math.abs(nextWidth - observedWidth) <= 0.5) return

          observedWidth = nextWidth
          scheduleResize()
        })

    resizeObserver?.observe(node)
    scheduleResize()

    return {
      update(nextOptions: AutoGrowOptions) {
        options = nextOptions
        scheduleResize()
      },
      destroy() {
        resizeObserver?.disconnect()
        if (animationFrame !== null) cancelAnimationFrame(animationFrame)
      },
    }
  }
</script>

<div class="property-field" class:canvas-density={density === 'canvas'}>
  <div class="property-heading">
    <label for={controlId} title={schema.description}>{schema.label || propertyKey}</label>
    {#if overridden}
      <span class="override-badge">Input overrides</span>
    {/if}
  </div>

  {#if schema.type === 'text' || schema.type === 'string'}
    <div class="suggestion-input-row">
      <input
        id={controlId}
        type="text"
        class="property-input nodrag nopan nowheel"
        value={currentValue ?? ''}
        placeholder={schema.placeholder || ''}
        list={schema.suggestions ? suggestionListId : undefined}
        disabled={overridden}
        oninput={(event) => onValueChange((event.target as HTMLInputElement).value)}
      />
      {#if schema.suggestions}
        <button
          type="button"
          class="suggestion-refresh nodrag nopan"
          disabled={suggestionsLoading}
          aria-label={`Refresh ${schema.label || propertyKey} choices`}
          title="Refresh live choices"
          onclick={refreshSuggestions}
        >{suggestionsLoading ? '…' : '↻'}</button>
        <datalist id={suggestionListId}>
          {#each suggestions as suggestion}
            <option value={suggestion.value}>{suggestion.label}</option>
          {/each}
        </datalist>
      {/if}
    </div>
    {#if schema.suggestions}
      {#if suggestionsError}
        <p class="suggestion-status suggestion-error">{suggestionsError}; a session ID can still be entered manually.</p>
      {:else if !suggestionsLoading && suggestions.length === 0}
        <p class="suggestion-status">No saved bridge sessions found. Leave blank for the triggering or latest connected observation.</p>
      {:else if suggestions.length > 0}
        <p class="suggestion-status">{suggestions.length} known bridge session{suggestions.length === 1 ? '' : 's'} available.</p>
      {/if}
    {/if}
  {:else if schema.type === 'text_multiline'}
    <textarea
      id={controlId}
      class="property-input property-textarea nodrag nopan nowheel"
      use:autoGrowTextarea={{ enabled: density === 'canvas', value: currentValue }}
      value={currentValue ?? ''}
      placeholder={schema.placeholder || ''}
      disabled={overridden}
      oninput={(event) => onValueChange((event.target as HTMLTextAreaElement).value)}
      rows={textareaRows}
    ></textarea>
  {:else if schema.type === 'number'}
    <input
      id={controlId}
      type="number"
      class="property-input nodrag nopan nowheel"
      value={currentValue ?? 0}
      min={schema.min}
      max={schema.max}
      step={schema.step ?? 1}
      disabled={overridden}
      oninput={(event) => updateNumber((event.target as HTMLInputElement).value)}
    />
  {:else if schema.type === 'slider'}
    <div class="slider-row">
      <input
        id={controlId}
        type="range"
        class="property-slider nodrag nopan nowheel"
        value={currentValue ?? schema.default ?? 0}
        min={schema.min ?? 0}
        max={schema.max ?? 1}
        step={schema.step ?? 0.1}
        disabled={overridden}
        oninput={(event) => updateNumber((event.target as HTMLInputElement).value)}
      />
      <span>{String(currentValue ?? schema.default ?? 0)}</span>
    </div>
  {:else if schema.type === 'select'}
    <select
      id={controlId}
      class="property-input nodrag nopan nowheel"
      value={String(currentValue ?? optionValue(schema.options?.[0] || ''))}
      disabled={overridden}
      onchange={(event) => onValueChange((event.target as HTMLSelectElement).value)}
    >
      {#each schema.options || [] as option}
        <option value={optionValue(option)}>{optionLabel(option)}</option>
      {/each}
    </select>
  {:else if schema.type === 'multiselect'}
    <div
      id={controlId}
      class="property-multiselect nodrag nopan nowheel"
      role="group"
      aria-label={schema.label || propertyKey}
    >
      <div class="multiselect-toolbar">
        <span>{selectedValues.length} of {schema.options?.length ?? 0} selected</span>
        <div>
          <button type="button" disabled={overridden} onclick={selectAllOptions}>All</button>
          <button type="button" disabled={overridden} onclick={() => onValueChange([])}>Clear</button>
        </div>
      </div>
      <div class="multiselect-options">
        {#each schema.options || [] as option}
          {@const value = optionValue(option)}
          <label>
            <input
              type="checkbox"
              checked={selectedValues.includes(value)}
              disabled={overridden}
              onchange={(event) => updateMultiselect(
                value,
                (event.target as HTMLInputElement).checked,
              )}
            />
            <span>{optionLabel(option)}</span>
          </label>
        {/each}
      </div>
    </div>
  {:else if schema.type === 'color'}
    <div class="color-row">
      <input
        id={controlId}
        type="color"
        class="property-color nodrag nopan nowheel"
        value={String(currentValue ?? '#808080')}
        disabled={overridden}
        oninput={(event) => onValueChange((event.target as HTMLInputElement).value)}
      />
      <input
        type="text"
        class="property-input nodrag nopan nowheel"
        value={String(currentValue ?? '')}
        placeholder="#000000"
        disabled={overridden}
        oninput={(event) => onValueChange((event.target as HTMLInputElement).value)}
      />
    </div>
  {:else if schema.type === 'boolean' || schema.type === 'toggle'}
    <input
      id={controlId}
      type="checkbox"
      class="property-checkbox nodrag nopan nowheel"
      checked={Boolean(currentValue)}
      disabled={overridden}
      onchange={(event) => onValueChange((event.target as HTMLInputElement).checked)}
    />
  {:else if schema.type === 'tags'}
    <input
      id={controlId}
      type="text"
      class="property-input nodrag nopan nowheel"
      value={Array.isArray(currentValue) ? currentValue.join(', ') : String(currentValue ?? '')}
      placeholder={schema.placeholder || 'tag-one, tag-two'}
      disabled={overridden}
      oninput={(event) => onValueChange(parseTags((event.target as HTMLInputElement).value))}
    />
  {:else if schema.type === 'json'}
    <textarea
      id={controlId}
      class="property-input property-textarea property-json nodrag nopan nowheel"
      use:autoGrowTextarea={{ enabled: density === 'canvas', value: currentValue }}
      value={stringifyJson(currentValue)}
      disabled={overridden}
      oninput={(event) => onValueChange(parseJsonSafe((event.target as HTMLTextAreaElement).value))}
      rows={density === 'canvas' ? 6 : 3}
    ></textarea>
  {/if}

  {#if showDescription && schema.description}
    <p class="property-description">{schema.description}</p>
  {/if}
  {#if overridden}
    <p class="override-note">The connected {propertyKey} input is the effective runtime value.</p>
  {/if}
</div>

<style>
  .property-field {
    @apply mb-4;
  }
  .property-field.canvas-density {
    @apply mb-3;
  }
  .property-heading {
    @apply mb-1.5 flex items-center justify-between gap-2;
  }
  .property-heading label {
    @apply text-xs font-medium text-slate-300;
  }
  .override-badge {
    @apply rounded bg-amber-950 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-300;
  }
  .property-input {
    @apply box-border w-full rounded-md border border-slate-700 bg-slate-900 px-2.5 py-2 text-[13px] text-slate-200;
    font-family: inherit;
  }
  .canvas-density .property-input {
    @apply border-white/20 bg-black/30 px-2 py-1.5 text-[11px] text-white;
  }
  .property-input:focus {
    @apply border-blue-500 outline-none;
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
  }
  .property-input:disabled,
  .suggestion-refresh:disabled,
  .property-multiselect button:disabled,
  .property-multiselect input:disabled,
  .property-slider:disabled,
  .property-checkbox:disabled,
  .property-color:disabled {
    @apply cursor-not-allowed opacity-50;
  }
  .property-textarea {
    @apply min-h-[96px] resize-y leading-snug;
  }
  .canvas-density .property-textarea {
    @apply min-h-[72px] resize-none;
    max-height: 360px;
  }
  .property-json {
    @apply font-mono text-xs;
  }
  .property-multiselect {
    @apply overflow-hidden rounded-md border border-slate-700 bg-slate-900;
  }
  .canvas-density .property-multiselect {
    @apply border-white/20 bg-black/30;
  }
  .multiselect-toolbar {
    @apply flex items-center justify-between gap-2 border-b border-slate-700 px-2.5 py-1.5 text-[10px] text-slate-500;
  }
  .canvas-density .multiselect-toolbar {
    @apply border-white/15 text-white/55;
  }
  .multiselect-toolbar > div {
    @apply flex items-center gap-1;
  }
  .multiselect-toolbar button,
  .suggestion-refresh {
    @apply cursor-pointer rounded border border-slate-600 bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300;
  }
  .multiselect-toolbar button:hover:not(:disabled),
  .suggestion-refresh:hover:not(:disabled) {
    @apply border-blue-500 text-white;
  }
  .multiselect-options {
    @apply grid max-h-56 overflow-y-auto;
  }
  .multiselect-options label {
    @apply flex cursor-pointer items-start gap-2 border-b border-slate-800 px-2.5 py-1.5 text-[11px] leading-snug text-slate-300 last:border-b-0;
  }
  .canvas-density .multiselect-options label {
    @apply border-white/10 text-white/80;
  }
  .multiselect-options label:hover {
    @apply bg-white/5;
  }
  .multiselect-options input {
    @apply mt-0.5 accent-blue-500;
  }
  .suggestion-input-row {
    @apply flex items-stretch gap-1.5;
  }
  .suggestion-refresh {
    @apply w-9 flex-none text-sm;
  }
  .suggestion-status {
    @apply mb-0 mt-1.5 text-[10px] leading-snug text-slate-500;
  }
  .canvas-density .suggestion-status {
    @apply text-white/55;
  }
  .suggestion-error {
    @apply text-amber-500;
  }
  .slider-row {
    @apply flex items-center gap-3;
  }
  .slider-row span {
    @apply min-w-[40px] text-right font-mono text-xs text-slate-400;
  }
  .property-slider {
    @apply h-1.5 flex-1 cursor-pointer rounded bg-slate-700;
    appearance: none;
  }
  .property-slider::-webkit-slider-thumb {
    @apply h-4 w-4 cursor-pointer rounded-full bg-blue-500;
    appearance: none;
  }
  .property-slider::-moz-range-thumb {
    @apply h-4 w-4 cursor-pointer rounded-full border-0 bg-blue-500;
  }
  .color-row {
    @apply flex items-center gap-2;
  }
  .property-color {
    @apply h-9 w-10 cursor-pointer rounded-md border border-slate-700 bg-slate-900 p-0.5;
  }
  .property-checkbox {
    @apply h-[18px] w-[18px] cursor-pointer accent-blue-500;
  }
  .property-description,
  .override-note {
    @apply mb-0 mt-1.5 text-[11px] leading-snug text-slate-500;
  }
  .override-note {
    @apply text-amber-400/80;
  }
</style>
