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
    frame: false,
  },
  propertySchemas: {
    title: {
      type: 'string',
      default: 'Note',
      label: 'Title',
      description: 'Heading displayed on the annotation card or group frame.',
    },
    content: {
      type: 'text_multiline',
      default: '',
      label: 'Content',
      description: 'Human-readable explanation kept with the workflow; it is never sent to runtime nodes.',
      rows: 15, // Allow large text blocks for documentation
    },
    style: {
      type: 'select',
      default: 'info',
      label: 'Style',
      description: 'Visual tone used to distinguish informational, warning, success, and error notes.',
      options: ['info', 'warning', 'success', 'error'],
    },
    frame: {
      type: 'toggle',
      default: false,
      label: 'Group Frame',
      description: 'Turn this note into a resizable frame that can contain and move other nodes.',
    },
  },
  description: 'Documentation node for explaining graph workflows',
  editorOnly: true,

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
