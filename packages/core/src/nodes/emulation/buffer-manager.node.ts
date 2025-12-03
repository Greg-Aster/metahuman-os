/**
 * Buffer Manager Node
 * Persists conversation buffer to disk
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';

const execute: NodeExecutor = async (inputs, context) => {
  const mode = context.mode || context.dialogueType || 'conversation';
  const sessionId = context.sessionId;
  const username = context.username;
  const userMessage = context.userMessage;

  if (!username) {
    return {
      persisted: false,
      error: 'No username in context',
    };
  }

  try {
    const { getProfilePaths, systemPaths } = await import('../../paths.js');
    const fs = await import('node:fs');
    const path = await import('node:path');

    const profilePaths = getProfilePaths(username);
    const bufferPath = path.join(profilePaths.state, `conversation-buffer-${mode}.json`);

    fs.mkdirSync(profilePaths.state, { recursive: true });

    // Load existing buffer
    let existingMessages: any[] = [];
    let summaryMarkers: any[] = [];
    try {
      if (fs.existsSync(bufferPath)) {
        const existingRaw = fs.readFileSync(bufferPath, 'utf-8');
        const existing = JSON.parse(existingRaw);
        existingMessages = existing.messages || [];
        summaryMarkers = existing.summaryMarkers || [];
      }
    } catch {}

    // Get response from inputs[1]
    const assistantResponse = inputs[1]?.response || inputs[1]?.content || inputs[1]?.text || inputs[1];

    // Build updated message list
    const updatedMessages = [...existingMessages];

    if (userMessage) {
      updatedMessages.push({
        role: 'user',
        content: userMessage,
        timestamp: Date.now(),
      });
    }

    if (assistantResponse) {
      updatedMessages.push({
        role: 'assistant',
        content: assistantResponse,
        timestamp: Date.now(),
      });
    }

    // Filter out system messages
    const conversationMessages = updatedMessages.filter((msg: any) => msg.role !== 'system');

    // Load max messages from settings
    let maxMessages = 80;
    try {
      const settingsPath = path.join(profilePaths.root, 'chat-settings.json');
      if (fs.existsSync(settingsPath)) {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        maxMessages = settings.settings?.maxHistoryMessages?.value ?? 80;
      }
    } catch {}

    // Hard prune if over max
    let finalMessages = conversationMessages;
    if (conversationMessages.length > maxMessages) {
      finalMessages = conversationMessages.slice(-maxMessages);
    }

    const payload = {
      summaryMarkers,
      messages: finalMessages,
      lastSummarizedIndex: null,
      lastUpdated: new Date().toISOString(),
    };

    fs.writeFileSync(bufferPath, JSON.stringify(payload, null, 2));

    return {
      persisted: true,
      mode,
      messageCount: finalMessages.length,
      sessionId,
      bufferPath,
    };
  } catch (error) {
    console.error('[BufferManager] Error:', error);
    return {
      persisted: false,
      error: (error as Error).message,
    };
  }
};

export const BufferManagerNode: NodeDefinition = defineNode({
  id: 'buffer_manager',
  name: 'Buffer Manager',
  category: 'emulation',
  inputs: [
    { name: 'conversationHistory', type: 'array', optional: true, description: 'Conversation history' },
    { name: 'response', type: 'any', optional: true, description: 'Assistant response' },
  ],
  outputs: [
    { name: 'persisted', type: 'boolean' },
    { name: 'messageCount', type: 'number' },
    { name: 'bufferPath', type: 'string' },
  ],
  properties: {},
  propertySchemas: {},
  description: 'Persists conversation buffer to disk',
  execute,
});
