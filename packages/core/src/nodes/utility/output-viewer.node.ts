/**
 * Output Viewer Node
 *
 * Debug node that displays raw output data from any connected node.
 * Accumulates outputs across loop iterations for comparison.
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';

interface ViewerEntry {
  iteration: number;
  timestamp: string;
  data: any;
  dataType: string;
  summary: string;
}

const DEFAULT_MAX_SUMMARY_CHARS = 1200;

function truncate(value: string, maxChars: number): string {
  return value.length > maxChars ? `${value.slice(0, maxChars)}...` : value;
}

function summarizeData(value: unknown, maxChars = DEFAULT_MAX_SUMMARY_CHARS): string {
  if (value === null || value === undefined) {
    return '(empty)';
  }

  if (typeof value === 'string') {
    return truncate(value, maxChars);
  }

  if (typeof value !== 'object') {
    return truncate(String(value), maxChars);
  }

  const seen = new WeakSet<object>();
  try {
    return truncate(JSON.stringify(value, (_key, nested) => {
      if (nested && typeof nested === 'object') {
        if (seen.has(nested)) {
          return '[Circular]';
        }
        seen.add(nested);
      }
      return nested;
    }), maxChars);
  } catch (error) {
    return truncate(`[unserializable: ${(error as Error).message}]`, maxChars);
  }
}

const execute: NodeExecutor = async (inputs, context) => {
  // Get iteration from context (injected by graph executor)
  const iteration = context._graphExecutorIteration ?? 1;
  const timestamp = new Date().toISOString();

  // Accept any input - check named inputs first, then positional
  const inputData = inputs.data ?? inputs[0] ?? null;

  // Determine data type for display
  const dataType = inputData === null ? 'null'
    : Array.isArray(inputData) ? 'array'
    : typeof inputData;

  const summary = summarizeData(inputData);

  // Build the entry
  const entry: ViewerEntry = {
    iteration,
    timestamp,
    data: inputData,
    dataType,
    summary,
  };

  // Get previous history from context (accumulated across iterations)
  const previousHistory: ViewerEntry[] = context._outputViewerHistory ?? [];
  const history = [...previousHistory, entry];

  // Minimal console output - full data is visible in the graph UI
  console.log(`[OutputViewer] Iter ${iteration}: ${dataType} - ${summary}`);

  // Store history in context for next iteration
  context._outputViewerHistory = history;

  return {
    // Passthrough the input data (so node can be chained)
    data: inputData,
    // Current entry for display
    currentEntry: entry,
    // Full history for iteration comparison
    history,
    // Convenience fields
    iteration,
    dataType,
    summary,
    entryCount: history.length,
  };
};

export const OutputViewerNode: NodeDefinition = defineNode({
  id: 'output_viewer',
  name: 'Output Viewer',
  category: 'utility',
  inputs: [
    { name: 'data', type: 'any', description: 'Any data to view/debug' },
  ],
  outputs: [
    { name: 'data', type: 'any', description: 'Passthrough of input data' },
    { name: 'currentEntry', type: 'object', description: 'Current iteration entry' },
    { name: 'history', type: 'array', description: 'All entries across iterations' },
    { name: 'iteration', type: 'number', description: 'Current iteration number' },
    { name: 'dataType', type: 'string', description: 'Type of the viewed data' },
    { name: 'summary', type: 'string', description: 'Console-friendly data preview' },
    { name: 'entryCount', type: 'number', description: 'Total entries recorded' },
  ],
  properties: {},
  propertySchemas: {},
  description: 'Debug node that displays raw output data and accumulates history across loop iterations',
  execute,
});
