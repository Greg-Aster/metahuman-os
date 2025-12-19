/**
 * Memory Capture Node
 *
 * Saves conversation to episodic memory
 * Returns detailed metadata including file path and encryption status
 *
 * IMPORTANT: This node expects pre-stripped content.
 * Use ThinkingStripperNode upstream in the pipeline to remove <think> blocks
 * before passing to this node.
 *
 * Pipeline example:
 *   PersonaLLM → ThinkingStripper → MemoryCapture
 */

import { defineNode, type NodeDefinition } from '../types.js';
import { captureEventWithDetails, type CaptureResult } from '../../memory.js';

export const MemoryCaptureNode: NodeDefinition = defineNode({
  id: 'memory_capture',
  name: 'Memory Capture',
  category: 'output',
  inputs: [
    { name: 'userMessage', type: 'string', description: 'User message to capture' },
    { name: 'assistantResponse', type: 'string', description: 'Assistant response to capture' },
    { name: 'cognitiveMode', type: 'cognitiveMode', optional: true },
    { name: 'metadata', type: 'object', optional: true },
  ],
  outputs: [
    { name: 'saved', type: 'boolean', description: 'Whether memory was saved' },
    { name: 'eventPath', type: 'string', description: 'Path to saved event file' },
    { name: 'encrypted', type: 'boolean', description: 'Whether the file is encrypted' },
  ],
  description: 'Saves conversation to episodic memory',

  execute: async (inputs, context) => {
    // Named inputs from graph edges (with array fallbacks)
    // Expected: userMessage, assistantResponse, cognitiveMode, metadata
    const userMessageInput = inputs.userMessage || inputs[0];
    const assistantResponseInput = inputs.assistantResponse || inputs[1];

    // Extract user message
    const message = typeof userMessageInput === 'string' ? userMessageInput : (context.userMessage || '');

    // Extract response - handle both string and object formats
    let response = '';
    if (typeof assistantResponseInput === 'string') {
      response = assistantResponseInput;
    } else if (assistantResponseInput?.response && typeof assistantResponseInput.response === 'string') {
      response = assistantResponseInput.response;
    } else if (userMessageInput?.response && typeof userMessageInput.response === 'string') {
      response = userMessageInput.response;
    }

    if (!response || response.trim().length === 0) {
      return {
        saved: false,
        reason: 'No response to capture',
      };
    }

    if (!context.allowMemoryWrites || !context.userId || context.userId === 'anonymous') {
      return {
        saved: false,
        reason: context.allowMemoryWrites ? 'Anonymous user' : 'Memory writes disabled',
      };
    }

    try {
      const content = `User: ${message}\n\nAssistant: ${response}`;
      const result: CaptureResult = captureEventWithDetails(content, {
        type: 'conversation',
        metadata: {
          cognitiveMode: context.cognitiveMode as 'dual' | 'agent' | 'emulation',
          sessionId: context.sessionId,
          userId: context.userId,
        },
      });

      return {
        saved: true,
        type: 'conversation',
        eventId: result.eventId,
        filePath: result.filePath,
        eventPath: result.filePath,
        encrypted: result.encrypted,
        encryptionType: result.encryptionType,
        encryptionWarning: result.encryptionWarning,
        encryptionFallback: result.encryptionFallback,
        timestamp: result.timestamp,
        bytesWritten: result.bytesWritten,
      };
    } catch (error) {
      console.error('[MemoryCapture] Error:', error);
      return {
        saved: false,
        error: (error as Error).message,
      };
    }
  },
});
