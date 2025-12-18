/**
 * Graph Note Node
 *
 * A documentation node that displays text in the graph editor.
 * Does not process any data - purely for human-readable documentation.
 *
 * Purpose:
 * - Explain what a graph workflow does
 * - Provide context for complex node arrangements
 * - Document design decisions and data flow
 */

import { defineNode, type NodeDefinition } from '../types.js';

export const GraphNoteNode: NodeDefinition = defineNode({
  id: 'graph_note',
  name: 'Graph Note',
  category: 'utility',
  inputs: [],
  outputs: [],
  properties: {
    title: 'Note',
    content: '',
    style: 'info', // info, warning, success, error
  },
  propertySchemas: {
    title: {
      type: 'string',
      default: 'Note',
      label: 'Title',
    },
    content: {
      type: 'text_multiline',
      default: '',
      label: 'Content',
      rows: 15, // Allow large text blocks for documentation
    },
    style: {
      type: 'select',
      default: 'info',
      label: 'Style',
      options: ['info', 'warning', 'success', 'error'],
    },
  },
  description: 'Documentation node for explaining graph workflows',

  execute: async (inputs, context, properties) => {
    // This node is purely decorative - it does nothing at runtime
    // Its purpose is to be visible in the graph editor with documentation
    return {
      title: properties?.title ?? 'Note',
      content: properties?.content ?? '',
      style: properties?.style ?? 'info',
    };
  },
});
