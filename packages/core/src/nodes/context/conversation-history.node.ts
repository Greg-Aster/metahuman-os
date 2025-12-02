/**
 * Conversation History Node
 *
 * Retrieves recent conversation messages from persisted buffer
 * Supports unified consciousness mode - merges inner dialogue into context
 */

import { defineNode, type NodeDefinition } from '../types.js';

export const ConversationHistoryNode: NodeDefinition = defineNode({
  id: 'conversation_history',
  name: 'Conversation History',
  category: 'context',
  inputs: [],
  outputs: [
    { name: 'messages', type: 'array', description: 'Conversation messages' },
    { name: 'count', type: 'number', description: 'Message count' },
    { name: 'estimatedTokens', type: 'number', description: 'Estimated token count' },
  ],
  properties: {
    limit: 20,
  },
  propertySchemas: {
    limit: {
      type: 'slider',
      default: 20,
      label: 'Message Limit',
      description: 'Maximum messages to retrieve',
      min: 5,
      max: 50,
      step: 5,
    },
  },
  description: 'Retrieves recent conversation messages from persisted buffer',

  execute: async (inputs, context, properties) => {
    const startTime = Date.now();
    const limit = properties?.limit || 20;
    const mode = context.mode || context.dialogueType || 'conversation';
    const username = context.username;

    let messages = context.conversationHistory || [];
    let summaryMarkers: any[] = [];
    let loadedFromBuffer = false;
    let innerDialogueCount = 0;

    if (username) {
      try {
        const loadStart = Date.now();
        const fs = await import('node:fs');
        const path = await import('node:path');
        const { getProfilePaths } = await import('../../paths.js');

        const profilePaths = getProfilePaths(username);
        const bufferPath = path.join(profilePaths.state, `conversation-buffer-${mode}.json`);

        if (fs.existsSync(bufferPath)) {
          const raw = fs.readFileSync(bufferPath, 'utf-8');
          const parsed = JSON.parse(raw);

          if (parsed.messages && Array.isArray(parsed.messages)) {
            messages = parsed.messages;
            summaryMarkers = parsed.summaryMarkers || [];
            loadedFromBuffer = true;
            const loadTime = Date.now() - loadStart;
            console.log(`[ConversationHistory] Loaded ${messages.length} messages from persisted ${mode} buffer (${loadTime}ms)`);
          }
        }

        // Unified Consciousness: Load inner dialogue buffer and merge if enabled
        if (mode === 'conversation') {
          try {
            const { loadChatSettings } = await import('../../chat-settings.js');
            const chatSettings = loadChatSettings();

            if (chatSettings.unifiedConsciousness) {
              const innerBufferPath = path.join(profilePaths.state, 'conversation-buffer-inner.json');

              if (fs.existsSync(innerBufferPath)) {
                const innerRaw = fs.readFileSync(innerBufferPath, 'utf-8');
                const innerParsed = JSON.parse(innerRaw);

                if (innerParsed.messages && Array.isArray(innerParsed.messages)) {
                  const innerLimit = 10;
                  const innerMessages = innerParsed.messages
                    .slice(-innerLimit)
                    .map((msg: any) => ({
                      ...msg,
                      role: 'system',
                      content: `[Inner thought - ${msg.role}]: ${msg.content}`,
                      meta: { ...msg.meta, isInnerDialogue: true, originalRole: msg.role },
                    }));

                  messages = [...innerMessages, ...messages];
                  innerDialogueCount = innerMessages.length;
                  console.log(`[ConversationHistory] Unified consciousness: Added ${innerDialogueCount} inner dialogue messages`);
                }
              }
            }
          } catch (error) {
            console.warn('[ConversationHistory] Could not load inner dialogue:', error);
          }
        }
      } catch (error) {
        console.warn('[ConversationHistory] Could not load persisted buffer:', error);
      }
    } else {
      console.warn('[ConversationHistory] No username in context');
    }

    // Auto-prune
    const maxMessages = limit;
    let pruned = false;

    if (messages.length > maxMessages) {
      const systemAndMarkers = messages.filter(
        (msg: any) => msg.role === 'system' || msg.meta?.summaryMarker
      );
      const conversationMessages = messages.filter(
        (msg: any) => msg.role !== 'system' && !msg.meta?.summaryMarker
      );

      const recentConversation = conversationMessages.slice(-maxMessages);
      messages = [...systemAndMarkers, ...recentConversation];
      pruned = true;
    }

    const totalChars = messages.reduce((sum: number, msg: any) => sum + (msg.content?.length || 0), 0);
    const estimatedTokens = Math.ceil(totalChars / 4);

    const totalTime = Date.now() - startTime;
    if (totalTime > 100) {
      console.log(`[ConversationHistory] Slow execution: ${totalTime}ms`);
    }

    return {
      messages,
      summaryMarkers,
      count: messages.length,
      pruned,
      loadedFromBuffer,
      estimatedTokens,
      mode,
      innerDialogueCount,
      unifiedConsciousness: innerDialogueCount > 0,
    };
  },
});
