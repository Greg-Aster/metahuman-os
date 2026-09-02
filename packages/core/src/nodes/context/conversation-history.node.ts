/**
 * Canonical Buffer History Node
 *
 * Retrieves recent entries from a selected persisted canonical buffer.
 * Supports unified consciousness mode - merges inner dialogue into context
 */

import { defineNode, type NodeDefinition } from '../types.js';
import { loadChatSettingsForUser } from '../../chat-settings.js';
import { loadBufferForUser } from '../../conversation-buffer.js';

export const ConversationHistoryNode: NodeDefinition = defineNode({
  id: 'conversation_history',
  name: 'Buffer History',
  category: 'context',
  inputs: [
    { name: 'mode', type: 'string', optional: true, description: 'Canonical buffer mode: conversation, inner, or robot' },
  ],
  outputs: [
    { name: 'history', type: 'array', description: 'Selected canonical buffer entries' },
  ],
  properties: {
    mode: 'conversation',
    limit: 20,
  },
  propertySchemas: {
    mode: {
      type: 'select',
      default: 'conversation',
      label: 'Buffer Mode',
      description: 'Canonical per-user buffer to read',
      options: ['conversation', 'inner', 'robot'],
    },
    limit: {
      type: 'slider',
      default: 20,
      label: 'Entry Limit',
      description: 'Maximum entries to retrieve; 0 uses the canonical buffer retention without an additional graph-local cutoff',
      min: 0,
      max: 50,
      step: 1,
    },
  },
  description: 'Retrieves recent entries from one canonical per-user conversation, inner, or robot buffer.',

  execute: async (inputs, context, properties) => {
    const startTime = Date.now();
    const configuredLimit = properties?.limit ?? properties?.maxMessages;
    const limit = Number.isInteger(configuredLimit)
      ? Math.max(0, Math.min(50, Number(configuredLimit)))
      : 20;
    const requestedMode = inputs.mode
      ?? properties?.mode
      ?? context.dialogueType
      ?? context.mode
      ?? 'conversation';
    const mode = requestedMode === 'inner' || requestedMode === 'robot'
      ? requestedMode
      : 'conversation';
    const username = context.username;

    let messages = mode === 'conversation' ? context.conversationHistory || [] : [];
    let loadedFromBuffer = false;
    let innerDialogueCount = 0;

    if (username) {
      try {
        const loadStart = Date.now();
        const parsed = loadBufferForUser(username, mode);
        messages = parsed.messages;
        loadedFromBuffer = true;
        const loadTime = Date.now() - loadStart;
        console.log(`[ConversationHistory] Loaded ${messages.length} messages from persisted ${mode} buffer (${loadTime}ms)`);

        // Unified Consciousness: Load inner dialogue buffer and merge if enabled
        if (mode === 'conversation') {
          try {
            const unifiedConsciousness = loadChatSettingsForUser(username).unifiedConsciousness;

            console.log(`[ConversationHistory] unifiedConsciousness=${unifiedConsciousness} for user ${username}`);

            if (unifiedConsciousness) {
              const innerParsed = loadBufferForUser(username, 'inner');
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

    if (maxMessages > 0 && messages.length > maxMessages) {
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
      history: messages,
      messages,
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
