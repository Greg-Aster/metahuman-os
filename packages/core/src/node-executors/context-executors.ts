/**
 * Context Node Executors
 * Handles session context, system settings, semantic search, conversation history, and context building
 */

import { queryIndex } from '../vector-index.js';
import { loadCognitiveMode } from '../cognitive-mode.js';
import type { NodeExecutor } from './types.js';

/**
 * Session Context Node
 * Provides conversation history and user context
 */
export const sessionContextExecutor: NodeExecutor = async (inputs, context) => {
  return {
    conversationHistory: context.conversationHistory || [],
    user: context.user || {
      id: context.userId || 'anonymous',
      username: context.username || 'user',
      role: context.userRole || 'user',
    },
    sessionId: context.sessionId,
  };
};

/**
 * System Settings Node
 * Provides cognitive mode and system configuration
 */
export const systemSettingsExecutor: NodeExecutor = async (inputs, context) => {
  try {
    // Load cognitive mode
    const cognitiveMode = loadCognitiveMode();
    const mode = cognitiveMode.currentMode || context.cognitiveMode || 'dual';

    // Load chat settings
    let chatSettings = null;
    try {
      const { loadChatSettings } = await import('../chat-settings.js');
      chatSettings = loadChatSettings();
    } catch (error) {
      console.warn('[SystemSettings] Could not load chat settings:', error);
    }

    // Load active facet for UI color-coding
    let activeFacet = null;
    try {
      const { getActiveFacet } = await import('../identity.js');
      activeFacet = getActiveFacet();
    } catch (error) {
      console.warn('[SystemSettings] Could not load active facet:', error);
    }

    // Load memory policy
    let memoryPolicy = null;
    try {
      const { canWriteMemory } = await import('../cognitive-mode.js');
      const canWrite = canWriteMemory(mode);
      memoryPolicy = {
        canWriteConversation: canWrite,
        canWriteInnerDialogue: canWrite,
      };
    } catch (error) {
      console.warn('[SystemSettings] Could not load memory policy:', error);
    }

    return {
      cognitiveMode: mode,
      chatSettings: chatSettings || {
        temperature: 0.7,
        maxContextChars: 8000,
        semanticSearchThreshold: 0.6,
      },
      activeFacet: activeFacet || 'default',
      memoryPolicy: memoryPolicy || {
        canWriteConversation: mode !== 'emulation',
        canWriteInnerDialogue: mode !== 'emulation',
      },
      trustLevel: 'supervised_auto',
      settings: {
        recordingEnabled: mode !== 'emulation',
        proactiveAgents: mode === 'dual',
      },
    };
  } catch (error) {
    console.error('[SystemSettings] Error loading settings:', error);
    return {
      cognitiveMode: context.cognitiveMode || 'dual',
      chatSettings: {
        temperature: 0.7,
        maxContextChars: 8000,
        semanticSearchThreshold: 0.6,
      },
      activeFacet: 'default',
      memoryPolicy: {
        canWriteConversation: true,
        canWriteInnerDialogue: true,
      },
      trustLevel: 'supervised_auto',
      settings: {},
    };
  }
};

/**
 * Semantic Search Node
 * Searches episodic memory for relevant context
 */
export const semanticSearchExecutor: NodeExecutor = async (inputs, context, properties) => {
  const query = inputs[0] || context.userMessage || '';
  const topK = properties?.topK || properties?.limit || 8;
  const threshold = properties?.threshold || 0.6;

  if (context.contextPackage?.memories) {
    return {
      memories: context.contextPackage.memories,
      query,
      fromCache: true,
    };
  }

  try {
    const results = await queryIndex(query, { topK });

    return {
      memories: results
        .filter(r => r.score >= threshold)
        .map(r => ({
          content: r.item.text || '',
          timestamp: r.item.timestamp,
          type: r.item.type || 'observation',
          score: r.score,
        })),
      query,
    };
  } catch (error) {
    console.error('[SemanticSearch] Error:', error);
    return {
      memories: [],
      query,
      error: (error as Error).message,
    };
  }
};

/**
 * Conversation History Node
 * Retrieves recent conversation messages from persisted buffer
 */
export const conversationHistoryExecutor: NodeExecutor = async (inputs, context, properties) => {
  const limit = properties?.limit || 20;
  const mode = context.mode || context.dialogueType || 'conversation';

  // First, try to load from persisted buffer files
  let messages = context.conversationHistory || [];
  let summaryMarkers: any[] = [];
  let loadedFromBuffer = false;

  try {
    const { loadPersistedBuffer } = await import('../conversation-buffer.js');
    const bufferData = loadPersistedBuffer(mode as 'inner' | 'conversation');

    if (bufferData.messages.length > 0) {
      messages = bufferData.messages;
      summaryMarkers = bufferData.summaryMarkers;
      loadedFromBuffer = true;
      console.log(`[ConversationHistory] Loaded ${messages.length} messages from persisted ${mode} buffer`);
    }
  } catch (error) {
    console.warn('[ConversationHistory] Could not load persisted buffer, using context:', error);
  }

  // Auto-prune to stay within limits (max 20 messages, ~8000 tokens)
  const maxMessages = limit;
  let pruned = false;

  if (messages.length > maxMessages) {
    // Keep system messages and summary markers at the beginning
    const systemAndMarkers = messages.filter(
      msg => msg.role === 'system' || msg.meta?.summaryMarker
    );
    const conversationMessages = messages.filter(
      msg => msg.role !== 'system' && !msg.meta?.summaryMarker
    );

    // Keep most recent conversation messages
    const recentConversation = conversationMessages.slice(-maxMessages);
    messages = [...systemAndMarkers, ...recentConversation];
    pruned = true;
    console.log(`[ConversationHistory] Pruned history from ${messages.length + conversationMessages.length - recentConversation.length} to ${messages.length} messages`);
  }

  // Estimate token count (rough: 4 chars per token)
  const totalChars = messages.reduce((sum, msg) => sum + (msg.content?.length || 0), 0);
  const estimatedTokens = Math.ceil(totalChars / 4);

  return {
    messages,
    summaryMarkers,
    count: messages.length,
    pruned,
    loadedFromBuffer,
    estimatedTokens,
    mode,
  };
};

/**
 * Context Builder Node
 * Combines multiple context sources into unified context
 */
export const contextBuilderExecutor: NodeExecutor = async (inputs, context) => {
  const query = inputs[0] || inputs[2]?.message || context.userMessage || '';
  const mode = inputs[1] || context.cognitiveMode || 'dual';
  const fallbackMemories = inputs[2]?.memories || inputs[1]?.memories || [];
  const memories = context.contextPackage?.memories || fallbackMemories;
  const conversationHistory = context.contextPackage?.conversationHistory || inputs[3]?.messages || context.conversationHistory || [];

  const contextPayload = context.contextPackage
    ? { ...context.contextPackage, query, mode }
    : {
        query,
        mode,
        memories,
        conversationHistory,
        timestamp: new Date().toISOString(),
      };

  if (context.contextInfo) {
    contextPayload.contextText = context.contextInfo;
  }

  return {
    context: contextPayload,
  };
};

/**
 * Auth Check Node
 * Verifies user authentication and permissions
 */
export const authCheckExecutor: NodeExecutor = async (inputs, context) => {
  const isAuthenticated = context.userId && context.userId !== 'anonymous';

  return {
    authenticated: isAuthenticated,
    userId: context.userId || 'anonymous',
    canWriteMemory: isAuthenticated,
    canExecuteSkills: isAuthenticated,
  };
};
