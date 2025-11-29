/**
 * Output Node Executors
 * Handles memory capture, audit logging, stream writing, chat view, and TTS
 */

import path from 'path';
import { paths } from '../paths.js';
import { captureEvent, captureEventWithDetails, type CaptureResult } from '../memory.js';
import { audit } from '../audit.js';
import type { NodeExecutor } from './types.js';

/**
 * Inner Dialogue Capture Node
 * Saves inner dialogue (reflections, thoughts) to episodic memory
 * Type: 'inner_dialogue' - never shows in main chat, only in Inner Dialogue tab
 * Returns detailed metadata including file path and encryption status
 */
export const innerDialogueCaptureExecutor: NodeExecutor = async (inputs, context) => {
  // Extract reflection text (slot 0)
  // Support multiple output formats: string, response, reflection, consolidatedChain, insight
  const reflectionText = typeof inputs[0] === 'string'
    ? inputs[0]
    : inputs[0]?.response || inputs[0]?.reflection || inputs[0]?.consolidatedChain || inputs[0]?.insight || '';

  if (!reflectionText || reflectionText.trim().length === 0) {
    return {
      saved: false,
      reason: 'No reflection text to capture',
    };
  }

  if (!context.allowMemoryWrites || !context.userId || context.userId === 'anonymous') {
    // Don't save memory for anonymous users
    return {
      saved: false,
      reason: context.allowMemoryWrites ? 'Anonymous user' : 'Memory writes disabled',
    };
  }

  try {
    const options = {
      type: 'inner_dialogue' as const,
      tags: inputs[1]?.tags || ['idle-thought', 'self-reflection', 'inner'],
      links: inputs[1]?.links || undefined,
    };

    // Use detailed capture to get full metadata including encryption status
    const result: CaptureResult = captureEventWithDetails(reflectionText, options);
    const relativePath = path.relative(paths.root, result.filePath);

    audit({
      category: 'data',
      level: 'info',
      event: 'inner_dialogue_captured',
      actor: context.userId,
      details: {
        type: 'inner_dialogue',
        path: relativePath,
        textLength: reflectionText.length,
        encrypted: result.encrypted,
        encryptionType: result.encryptionType,
      },
    });

    return {
      saved: true,
      type: 'inner_dialogue',
      eventId: result.eventId,
      eventPath: relativePath,
      filePath: result.filePath,
      encrypted: result.encrypted,
      encryptionType: result.encryptionType,
      encryptionWarning: result.encryptionWarning,
      encryptionFallback: result.encryptionFallback,
      timestamp: result.timestamp,
      textLength: reflectionText.length,
      bytesWritten: result.bytesWritten,
    };
  } catch (error) {
    console.error('[InnerDialogueCapture] Error:', error);
    return {
      saved: false,
      error: (error as Error).message,
    };
  }
};

/**
 * Memory Capture Node
 * Saves conversation to episodic memory
 * Returns detailed metadata including file path and encryption status
 */
export const memoryCaptureExecutor: NodeExecutor = async (inputs, context) => {
  // Extract user message (slot 0)
  const message = typeof inputs[0] === 'string' ? inputs[0] : (context.userMessage || '');

  // Extract response (slot 1) - handle both string and object formats
  let response = '';
  if (typeof inputs[1] === 'string') {
    response = inputs[1];
  } else if (inputs[1]?.response && typeof inputs[1].response === 'string') {
    response = inputs[1].response;
  } else if (inputs[0]?.response && typeof inputs[0].response === 'string') {
    // Fallback: check inputs[0] if inputs[1] doesn't have response
    response = inputs[0].response;
  }

  if (!response || response.trim().length === 0) {
    return {
      saved: false,
      reason: 'No response to capture',
    };
  }

  if (!context.allowMemoryWrites || !context.userId || context.userId === 'anonymous') {
    // Don't save memory for anonymous users
    return {
      saved: false,
      reason: context.allowMemoryWrites ? 'Anonymous user' : 'Memory writes disabled',
    };
  }

  try {
    // Use detailed capture to get full metadata including encryption status
    const result: CaptureResult = captureEventWithDetails(`User: ${message}\n\nAssistant: ${response}`, {
      type: 'conversation',
      metadata: {
        cognitiveMode: context.cognitiveMode as 'dual' | 'agent' | 'emulation',
        sessionId: context.sessionId,
        userId: context.userId,
      },
    });

    // Return full metadata for pipeline transparency
    return {
      saved: true,
      type: 'conversation',
      eventId: result.eventId,
      filePath: result.filePath,
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
};

/**
 * Audit Logger Node
 * Logs execution to audit trail
 */
export const auditLoggerExecutor: NodeExecutor = async (inputs, context) => {
  const response = inputs[0]?.response || inputs[0] || '';

  try {
    audit({
      level: 'info',
      category: 'system',
      event: 'node_graph_execution',
      details: {
        response,
        cognitiveMode: context.cognitiveMode,
        sessionId: context.sessionId,
      },
      userId: context.userId,
    });

    return {
      logged: true,
    };
  } catch (error) {
    console.error('[AuditLogger] Error:', error);
    return {
      logged: false,
      error: (error as Error).message,
    };
  }

};

/**
 * Stream Writer Node
 * Outputs response (terminal node)
 */
export const streamWriterExecutor: NodeExecutor = async (inputs, context) => {
  // Extract response string from various input formats
  let response = '';
  if (typeof inputs[0] === 'string') {
    response = inputs[0];
  } else if (inputs[0]?.response) {
    // Handle nested response objects
    if (typeof inputs[0].response === 'string') {
      response = inputs[0].response;
    } else if (typeof inputs[0].response === 'object' && inputs[0].response?.response) {
      response = inputs[0].response.response;
    } else if (typeof inputs[0].response === 'object' && inputs[0].response?.content) {
      response = inputs[0].response.content;
    }
  } else if (inputs[0]?.content && typeof inputs[0].content === 'string') {
    response = inputs[0].content;
  } else if (inputs[0]?.cleaned && typeof inputs[0].cleaned === 'string') {
    response = inputs[0].cleaned;
  } else if (inputs[0]?.text && typeof inputs[0].text === 'string') {
    response = inputs[0].text;
  } else if (typeof inputs[0] === 'object' && inputs[0] !== null) {
    // If it's an object without recognized fields, stringify it as fallback
    console.warn('[StreamWriter] Received unexpected object format:', Object.keys(inputs[0]));
    response = JSON.stringify(inputs[0]);
  }

  if (!response || response.trim().length === 0) {
    return {
      output: '',
      completed: false,
    };
  }

  console.log('[StreamWriter]', response.substring(0, 100) + (response.length > 100 ? '...' : ''));

  return {
    output: response,
    completed: true,
  };
};

/**
 * Chat View Node
 * Displays chat messages visually in the node editor
 */
export const chatViewExecutor: NodeExecutor = async (inputs, context, properties) => {
  const mode = properties?.mode || 'direct';
  const directMessage = inputs.message || inputs[0];
  const trigger = inputs.trigger || inputs[1];

  if (mode === 'direct' && directMessage) {
    // Direct mode: display the message passed in
    return {
      displayed: true,
      message: directMessage,
      mode: 'direct',
    };
  } else if (mode === 'trigger' && trigger) {
    // Trigger mode: fetch from conversation history
    const conversationHistory = context.conversationHistory || [];
    const maxMessages = properties?.maxMessages || 5;
    const recentMessages = conversationHistory.slice(-maxMessages);

    // Format messages for display
    const formattedMessages = recentMessages
      .map((msg: any) => `${msg.role}: ${msg.content}`)
      .join('\n\n');

    return {
      displayed: true,
      message: formattedMessages,
      messageCount: recentMessages.length,
      mode: 'trigger',
    };
  }

  return {
    displayed: false,
    message: '',
    mode,
  };
};

/**
 * TTS Node
 * Triggers text-to-speech playback
 * Note: Actual audio playback happens in browser via visual node implementation
 */
export const ttsExecutor: NodeExecutor = async (inputs, context, properties) => {
  const text = inputs.text || inputs[0];

  if (!text || typeof text !== 'string') {
    return {
      played: false,
      error: 'No text provided',
    };
  }

  // In server-side execution, we can't play audio
  // The browser-side node implementation handles actual playback
  // This executor just passes through the data for logging/tracking

  audit({
    level: 'info',
    category: 'action',
    event: 'tts_triggered',
    details: {
      textLength: text.length,
      provider: properties?.provider || 'default',
      autoPlay: properties?.autoPlay !== false,
    },
    actor: 'system',
  });

  return {
    played: true,
    text,
    provider: properties?.provider || 'default',
  };
};
