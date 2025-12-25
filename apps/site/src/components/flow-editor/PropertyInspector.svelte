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

<div class="property-inspector">
  {#if selectedNode}
    <div class="inspector-header">
      <h3 class="inspector-title">{nodeTitle}</h3>
      <span class="node-id">ID: {selectedNode.id}</span>
    </div>

    {#if nodeDescription}
      <p class="inspector-description">{nodeDescription}</p>
    {/if}

    <div class="properties-list">
      {#each Object.entries(propertySchemas) as [key, schema]}
        {@const schemaTyped = schema as PropertySchema}
        {@const currentValue = properties[key] ?? schemaTyped.default}

        <div class="property-row">
          <label class="property-label" for={`prop-${key}`}>
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
            <div class="slider-container">
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
              <span class="slider-value">{currentValue ?? schemaTyped.default ?? 0}</span>
            </div>
          {:else if schemaTyped.type === 'select'}
            <select
              id={`prop-${key}`}
              class="property-select"
              value={currentValue || schemaTyped.options?.[0] || ''}
              onchange={(e) => updateProperty(key, (e.target as HTMLSelectElement).value)}
            >
              {#each schemaTyped.options || [] as option}
                <option value={option}>{option}</option>
              {/each}
            </select>
          {:else if schemaTyped.type === 'color'}
            <div class="color-container">
              <input
                id={`prop-${key}`}
                type="color"
                class="property-color"
                value={currentValue || '#808080'}
                oninput={(e) => updateProperty(key, (e.target as HTMLInputElement).value)}
              />
              <input
                type="text"
                class="property-input color-text"
                value={currentValue || ''}
                placeholder="#000000"
                oninput={(e) => updateProperty(key, (e.target as HTMLInputElement).value)}
              />
            </div>
          {:else if schemaTyped.type === 'checkbox'}
            <input
              id={`prop-${key}`}
              type="checkbox"
              class="property-checkbox"
              checked={currentValue || false}
              onchange={(e) => updateProperty(key, (e.target as HTMLInputElement).checked)}
            />
          {:else if schemaTyped.type === 'json'}
            <textarea
              id={`prop-${key}`}
              class="property-textarea"
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
            <p class="property-description">{schemaTyped.description}</p>
          {/if}
        </div>
      {/each}

      {#if Object.keys(propertySchemas).length === 0}
        <p class="no-properties">No editable properties for this node.</p>
      {/if}
    </div>
  {:else}
    <div class="no-selection">
      <p>Select a node to view its properties</p>
    </div>
  {/if}
</div>

<style>
  .property-inspector {
    background: #1e293b;
    border-left: 1px solid #334155;
    height: 100%;
    overflow-y: auto;
    color: #e2e8f0;
    font-size: 13px;
  }

  .inspector-header {
    padding: 16px;
    border-bottom: 1px solid #334155;
    background: #0f172a;
  }

  .inspector-title {
    margin: 0 0 4px 0;
    font-size: 16px;
    font-weight: 600;
    color: #f8fafc;
  }

  .node-id {
    font-size: 11px;
    color: #64748b;
    font-family: monospace;
  }

  .inspector-description {
    padding: 12px 16px;
    margin: 0;
    font-size: 12px;
    color: #94a3b8;
    border-bottom: 1px solid #334155;
    line-height: 1.5;
  }

  .properties-list {
    padding: 16px;
  }

  .property-row {
    margin-bottom: 16px;
  }

  .property-label {
    display: block;
    margin-bottom: 6px;
    font-weight: 500;
    color: #cbd5e1;
    font-size: 12px;
  }

  .property-input,
  .property-select,
  .property-textarea {
    width: 100%;
    padding: 8px 10px;
    background: #0f172a;
    border: 1px solid #334155;
    border-radius: 6px;
    color: #e2e8f0;
    font-size: 13px;
    font-family: inherit;
    box-sizing: border-box;
  }

  .property-input:focus,
  .property-select:focus,
  .property-textarea:focus {
    outline: none;
    border-color: #3b82f6;
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
  }

  .property-textarea {
    resize: vertical;
    min-height: 60px;
    font-family: monospace;
    font-size: 12px;
  }

  .slider-container {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .property-slider {
    flex: 1;
    height: 6px;
    background: #334155;
    border-radius: 3px;
    appearance: none;
    cursor: pointer;
  }

  .property-slider::-webkit-slider-thumb {
    appearance: none;
    width: 16px;
    height: 16px;
    background: #3b82f6;
    border-radius: 50%;
    cursor: pointer;
  }

  .slider-value {
    min-width: 40px;
    text-align: right;
    font-family: monospace;
    font-size: 12px;
    color: #94a3b8;
  }

  .color-container {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .property-color {
    width: 40px;
    height: 36px;
    padding: 2px;
    background: #0f172a;
    border: 1px solid #334155;
    border-radius: 6px;
    cursor: pointer;
  }

  .property-color::-webkit-color-swatch-wrapper {
    padding: 2px;
  }

  .property-color::-webkit-color-swatch {
    border-radius: 4px;
    border: none;
  }

  .color-text {
    flex: 1;
  }

  .property-checkbox {
    width: 18px;
    height: 18px;
    cursor: pointer;
    accent-color: #3b82f6;
  }

  .property-description {
    margin: 6px 0 0 0;
    font-size: 11px;
    color: #64748b;
    line-height: 1.4;
  }

  .no-properties {
    color: #64748b;
    font-style: italic;
    text-align: center;
    padding: 20px;
  }

  .no-selection {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #64748b;
    text-align: center;
    padding: 20px;
  }

  .no-selection p {
    margin: 0;
  }
</style>
