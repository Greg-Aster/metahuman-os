/**
 * Display Buffer Node
 *
 * System utility node that displays the current chat buffer contents.
 * When triggered, loads and displays the buffer content within the node UI.
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { loadBufferForUser } from '../../conversation-buffer.js';

const execute: NodeExecutor = async (inputs, context) => {
  // Trigger input - any truthy value triggers the display
  const trigger = inputs.trigger ?? inputs[0];

  // If no trigger or trigger is false/null, don't display
  if (!trigger) {
    return {
      display: '',
      triggered: false,
      isEmpty: true,
    };
  }

  // Extract the response to display from the trigger input
  let displayContent = '';

  if (typeof trigger === 'string') {
    displayContent = trigger;
  } else if (trigger?.output && typeof trigger.output === 'string') {
    displayContent = trigger.output;
  } else if (trigger?.response && typeof trigger.response === 'string') {
    displayContent = trigger.response;
  } else if (trigger?.content && typeof trigger.content === 'string') {
    displayContent = trigger.content;
  } else if (trigger?.text && typeof trigger.text === 'string') {
    displayContent = trigger.text;
  } else if (typeof trigger === 'object' && trigger !== null) {
    // For objects, try to extract meaningful content
    displayContent = JSON.stringify(trigger, null, 2);
  }

  // If still empty, try to load from buffer file
  if (!displayContent && context.username) {
    try {
      const mode = context.mode || context.dialogueType || 'conversation';
      const bufferMode = mode === 'inner' ? 'inner' : 'conversation';
      const messages = loadBufferForUser(context.username, bufferMode).messages;

      // Get the last generated entry for the selected dialogue buffer.
      const generatedRoles = bufferMode === 'inner'
        ? new Set(['reflection', 'dream', 'daydream', 'reasoning'])
        : new Set(['assistant']);
      const lastGenerated = [...messages].reverse().find(message => generatedRoles.has(message.role));
      if (lastGenerated) {
        displayContent = lastGenerated.content;
      }
    } catch (error) {
      console.error('[DisplayBuffer] Error reading buffer:', error);
    }
  }

  console.log(`[DisplayBuffer] Displaying ${displayContent.length} chars`);

  return {
    display: displayContent,
    triggered: true,
    isEmpty: displayContent.length === 0,
    charCount: displayContent.length,
  };
};

export const DisplayBufferNode: NodeDefinition = defineNode({
  id: 'display_buffer',
  name: 'Display Buffer',
  category: 'output',
  inputs: [
    { name: 'trigger', type: 'any', description: 'Trigger input - connects to stream_writer output' },
  ],
  outputs: [
    { name: 'display', type: 'string', description: 'Content being displayed' },
    { name: 'triggered', type: 'boolean', description: 'Whether display was triggered' },
    { name: 'charCount', type: 'number', description: 'Character count of displayed content' },
  ],
  properties: {},
  propertySchemas: {},
  description: 'Displays chat buffer contents in the node UI when triggered',
  execute,
});
