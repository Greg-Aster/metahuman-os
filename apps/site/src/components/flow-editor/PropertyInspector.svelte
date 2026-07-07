<script lang="ts">
  import type { Node } from '@xyflow/svelte';

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
    options?: Array<string | { value: string; label: string }>;
    min?: number;
    max?: number;
    step?: number;
    rows?: number;
    placeholder?: string;
  }

  let {
    selectedNode,
    onUpdateNodeData,
  }: {
    selectedNode: Node | null;
    onUpdateNodeData?: (nodeId: string, data: Record<string, any>) => void;
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

<div class="bg-slate-800 border-l border-slate-700 h-full overflow-y-auto text-slate-200 text-[13px]">
  {#if selectedNode}
    <div class="p-4 border-b border-slate-700 bg-slate-900">
      <h3 class="m-0 mb-1 text-base font-semibold text-slate-50">{nodeTitle}</h3>
      <span class="text-[11px] text-slate-500 font-mono">ID: {selectedNode.id}</span>
    </div>

    {#if nodeDescription}
      <p class="py-3 px-4 m-0 text-xs text-slate-400 border-b border-slate-700 leading-relaxed">{nodeDescription}</p>
    {/if}

    <div class="p-4">
      {#each Object.entries(propertySchemas) as [key, schema]}
        {@const schemaTyped = schema as PropertySchema}
        {@const currentValue = properties[key] ?? schemaTyped.default}

        <div class="mb-4">
          <label class="block mb-1.5 font-medium text-slate-300 text-xs" for={`prop-${key}`}>
            {schemaTyped.label || key}
          </label>

          {#if schemaTyped.type === 'text' || schemaTyped.type === 'string'}
            <input
              id={`prop-${key}`}
              type="text"
              class="property-input"
              value={currentValue ?? ''}
              placeholder={schemaTyped.placeholder || ''}
              oninput={(e) => updateProperty(key, (e.target as HTMLInputElement).value)}
            />
          {:else if schemaTyped.type === 'text_multiline'}
            <textarea
              id={`prop-${key}`}
              class="property-input resize-y min-h-[96px]"
              value={currentValue ?? ''}
              placeholder={schemaTyped.placeholder || ''}
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
                oninput={(e) => updateProperty(key, parseFloat((e.target as HTMLInputElement).value))}
              />
              <span class="min-w-[40px] text-right font-mono text-xs text-slate-400">{currentValue ?? schemaTyped.default ?? 0}</span>
            </div>
          {:else if schemaTyped.type === 'select'}
            <select
              id={`prop-${key}`}
              class="property-input"
              value={currentValue ?? optionValue(schemaTyped.options?.[0] || '')}
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
                oninput={(e) => updateProperty(key, (e.target as HTMLInputElement).value)}
              />
              <input
                type="text"
                class="property-input flex-1"
                value={currentValue ?? ''}
                placeholder="#000000"
                oninput={(e) => updateProperty(key, (e.target as HTMLInputElement).value)}
              />
            </div>
          {:else if schemaTyped.type === 'checkbox' || schemaTyped.type === 'boolean' || schemaTyped.type === 'toggle'}
            <input
              id={`prop-${key}`}
              type="checkbox"
              class="w-[18px] h-[18px] cursor-pointer accent-blue-500"
              checked={currentValue ?? false}
              onchange={(e) => updateProperty(key, (e.target as HTMLInputElement).checked)}
            />
          {:else if schemaTyped.type === 'tags'}
            <input
              id={`prop-${key}`}
              type="text"
              class="property-input"
              value={Array.isArray(currentValue) ? currentValue.join(', ') : (currentValue ?? '')}
              placeholder={schemaTyped.placeholder || 'tag-one, tag-two'}
              oninput={(e) => updateProperty(key, parseTags((e.target as HTMLInputElement).value))}
            />
          {:else if schemaTyped.type === 'json'}
            <textarea
              id={`prop-${key}`}
              class="property-input font-mono text-xs resize-y min-h-[60px]"
              value={stringifyJson(currentValue)}
              oninput={(e) => updateProperty(key, parseJsonSafe((e.target as HTMLTextAreaElement).value))}
              rows="3"
            ></textarea>
          {:else}
            <!-- Fallback to text input -->
            <input
              id={`prop-${key}`}
              type="text"
              class="property-input"
              value={currentValue || ''}
              oninput={(e) => updateProperty(key, (e.target as HTMLInputElement).value)}
            />
          {/if}

          {#if schemaTyped.description}
            <p class="mt-1.5 mb-0 text-[11px] text-slate-500 leading-snug">{schemaTyped.description}</p>
          {/if}
        </div>
      {/each}

      {#if Object.keys(propertySchemas).length === 0}
        <p class="text-slate-500 italic text-center p-5">No editable properties for this node.</p>
      {/if}
    </div>
  {:else}
    <div class="flex items-center justify-center h-full text-slate-500 text-center p-5">
      <p class="m-0">Select a node to view its properties</p>
    </div>
  {/if}
</div>

<style>
  /* Shared input styling */
  .property-input {
    @apply w-full py-2 px-2.5 bg-slate-900 border border-slate-700 rounded-md text-slate-200 text-[13px] box-border;
    font-family: inherit;
  }
  .property-input:focus {
    @apply outline-none border-blue-500;
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
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
