<script lang="ts">
  import type { Node } from '@xyflow/svelte';

  interface PropertySchema {
    type: 'text' | 'number' | 'slider' | 'select' | 'json' | 'color' | 'checkbox';
    default?: any;
    label?: string;
    description?: string;
    options?: string[];
    min?: number;
    max?: number;
    step?: number;
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

          {#if schemaTyped.type === 'text'}
            <input
              id={`prop-${key}`}
              type="text"
              class="property-input"
              value={currentValue || ''}
              oninput={(e) => updateProperty(key, (e.target as HTMLInputElement).value)}
            />
          {:else if schemaTyped.type === 'number'}
            <input
              id={`prop-${key}`}
              type="number"
              class="property-input"
              value={currentValue || 0}
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
              value={currentValue || schemaTyped.options?.[0] || ''}
              onchange={(e) => updateProperty(key, (e.target as HTMLSelectElement).value)}
            >
              {#each schemaTyped.options || [] as option}
                <option value={option}>{option}</option>
              {/each}
            </select>
          {:else if schemaTyped.type === 'color'}
            <div class="flex gap-2 items-center">
              <input
                id={`prop-${key}`}
                type="color"
                class="property-color"
                value={currentValue || '#808080'}
                oninput={(e) => updateProperty(key, (e.target as HTMLInputElement).value)}
              />
              <input
                type="text"
                class="property-input flex-1"
                value={currentValue || ''}
                placeholder="#000000"
                oninput={(e) => updateProperty(key, (e.target as HTMLInputElement).value)}
              />
            </div>
          {:else if schemaTyped.type === 'checkbox'}
            <input
              id={`prop-${key}`}
              type="checkbox"
              class="w-[18px] h-[18px] cursor-pointer accent-blue-500"
              checked={currentValue || false}
              onchange={(e) => updateProperty(key, (e.target as HTMLInputElement).checked)}
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
