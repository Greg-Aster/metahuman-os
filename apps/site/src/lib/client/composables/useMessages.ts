/**
 * Message Handling Composable
 * Manages chat messages, history, and server interactions
 */

import { writable, derived, get } from 'svelte/store';

// Types
export type MessageRole = 'user' | 'assistant' | 'system' | 'reflection' | 'dream' | 'reasoning';

export interface ChatMessage {
  role: MessageRole;
  content: string;
  timestamp: number;
  relPath?: string;
  meta?: Record<string, any> | null;
}

export interface ReasoningStage {
  round: number;
  stage: string;
  content: string;
  timestamp: number;
}

interface UseMessagesOptions {
  /**
   * Get the current conversation mode
   */
  getMode: () => 'conversation' | 'inner';

  /**
   * Callback when messages change
   */
  onMessagesChange?: (messages: ChatMessage[]) => void;
}

/**
 * Message Handling Composable
 * Provides reactive state and methods for message management
 */
export function useMessages(options: UseMessagesOptions) {
  const { getMode, onMessagesChange } = options;

  // State
  const messages = writable<ChatMessage[]>([]);
  const selectedMessage = writable<ChatMessage | null>(null);
  const selectedMessageIndex = writable<number | null>(null);
  const conversationSessionId = writable<string>('');

  // Subscribe to messages changes
  if (onMessagesChange) {
    messages.subscribe(onMessagesChange);
  }

  /**
   * Push a new message to the conversation
   */
  function pushMessage(
    role: MessageRole,
    content: string,
    relPath?: string,
    meta: Record<string, any> | null = null
  ): void {
    const trimmed = (content || '').trim();
    if (!trimmed) return;

    // Prevent near-duplicate inserts by checking the last few items for same role+content
    if (role !== 'reasoning') {
      const currentMessages = get(messages);
      const back = currentMessages.slice(-3);
      if (back.some(m => m.role === role && (m.content || '').trim() === trimmed)) return;
    }

    const newMessage: ChatMessage = {
      role,
      content: trimmed,
      timestamp: Date.now(),
      relPath,
      meta,
    };

    messages.update(msgs => [...msgs, newMessage]);
  }

  /**
   * Load messages from server conversation buffer
   */
  async function loadMessagesFromServer(): Promise<ChatMessage[] | null> {
    const mode = getMode();
    try {
      const response = await fetch(`/api/conversation-buffer?mode=${mode}`);
      if (!response.ok) return null;

      const data = await response.json();
      if (Array.isArray(data.messages)) {
        const baseTimestamp = Date.now();
        let fallback = 0;
        const normalized = data.messages.map((msg: Record<string, any>) => {
          let ts: number | undefined;

          if (typeof msg.timestamp === 'number') {
            ts = msg.timestamp;
          } else if (typeof msg.timestamp === 'string') {
            const parsed = Date.parse(msg.timestamp);
            ts = Number.isNaN(parsed) ? undefined : parsed;
          }

          if (typeof ts !== 'number') {
            ts = baseTimestamp + fallback++;
          }

          return { ...msg, timestamp: ts };
        });

        console.log(`[useMessages] Loaded ${normalized.length} messages from server (mode: ${mode})`);
        return normalized;
      }
    } catch (error) {
      console.error('[useMessages] Failed to load messages from server:', error);
    }
    return null;
  }

  /**
   * Clear server conversation buffer
   */
  async function clearServerBuffer(): Promise<boolean> {
    const mode = getMode();
    try {
      const response = await fetch(`/api/conversation-buffer?mode=${mode}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        console.error('[useMessages] Failed to clear server buffer');
        return false;
      }

      console.log(`[useMessages] Cleared server buffer (mode: ${mode})`);
      return true;
    } catch (error) {
      console.error('[useMessages] Error clearing server buffer:', error);
      return false;
    }
  }

  /**
   * Load chat history from episodic memory
   */
  async function loadHistoryForMode(): Promise<void> {
    const mode = getMode();
    console.log(`[useMessages] loadHistoryForMode called with mode: ${mode}`);
    try {
      const res = await fetch(`/api/chat/history?mode=${mode}&limit=60`);
      console.log(`[useMessages] Fetched history for mode=${mode}, status:`, res.status);
      if (!res.ok) return;
      const data = await res.json();
      console.log(`[useMessages] Loaded ${data.messages?.length || 0} messages for mode=${mode}`);
      if (Array.isArray(data.messages)) {
        messages.set(data.messages);
      }
    } catch (e) {
      console.error('[useMessages] Failed to load chat history:', e);
    }
  }

  /**
   * Delete a message by its relPath
   */
  async function deleteMessage(relPath: string): Promise<boolean> {
    try {
      const res = await fetch('/api/memories/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ relPath }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to delete');
      }

      // Remove from local messages
      messages.update(msgs => msgs.filter(m => m.relPath !== relPath));
      return true;
    } catch (e) {
      console.error('[useMessages] Failed to delete message:', e);
      return false;
    }
  }

  /**
   * Clear all messages
   */
  function clearMessages(): void {
    messages.set([]);
    selectedMessage.set(null);
    selectedMessageIndex.set(null);
  }

  /**
   * Set selected message for reply-to functionality
   */
  function selectMessage(message: ChatMessage | null, index: number | null): void {
    selectedMessage.set(message);
    selectedMessageIndex.set(index);
  }

  /**
   * Get reply-to metadata from selected message
   */
  function getReplyToMetadata(): { questionId: string | null; content: string | null } {
    const selected = get(selectedMessage);
    return {
      questionId: selected?.meta?.curiosityQuestionId || null,
      content: selected?.content || null,
    };
  }

  /**
   * Clear selected message
   */
  function clearSelection(): void {
    selectedMessage.set(null);
    selectedMessageIndex.set(null);
  }

  /**
   * Generate a new conversation session ID
   */
  function generateSessionId(): string {
    const sessionId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
    conversationSessionId.set(sessionId);
    return sessionId;
  }

  /**
   * Format timestamp for display
   */
  function formatTime(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }

  /**
   * Format reasoning stage label
   */
  function formatReasoningLabel(stage: ReasoningStage): string {
    const stageName = String(stage.stage || 'plan')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
    return `🤔 Round ${stage.round}: ${stageName}`;
  }

  return {
    // Stores
    messages,
    selectedMessage,
    selectedMessageIndex,
    conversationSessionId,

    // Methods
    pushMessage,
    loadMessagesFromServer,
    clearServerBuffer,
    loadHistoryForMode,
    deleteMessage,
    clearMessages,
    selectMessage,
    getReplyToMetadata,
    clearSelection,
    generateSessionId,
    formatTime,
    formatReasoningLabel,
  };
}

/**
 * Activity Tracking Composable
 * Handles user activity signaling for boredom service
 */
export function useActivityTracking() {
  let activityTimeout: number | null = null;

  /**
   * Signal user activity with debouncing
   */
  function signalActivity(): void {
    // Clear existing timeout
    if (activityTimeout) {
      clearTimeout(activityTimeout);
    }

    // Set a new timeout - signal activity after 3 seconds of no further input
    activityTimeout = window.setTimeout(() => {
      fetch('/api/activity-ping', { method: 'POST' })
        .then(response => {
          if (!response.ok) {
            console.error('[activity] Failed to signal activity');
          }
        })
        .catch(error => console.error('[activity] Error signaling activity:', error));
    }, 3000); // 3000ms = 3 seconds debounce
  }

  /**
   * Clear activity timeout
   */
  function clearActivity(): void {
    if (activityTimeout) {
      clearTimeout(activityTimeout);
      activityTimeout = null;
    }
  }

  return {
    signalActivity,
    clearActivity,
  };
}

/**
 * Ollama Status Composable
 * Monitors Ollama health and model availability
 */
export function useOllamaStatus() {
  const running = writable<boolean>(true);
  const hasModels = writable<boolean>(true);
  const modelCount = writable<number>(0);
  const error = writable<string | null>(null);

  /**
   * Check Ollama status from boot endpoint
   */
  async function checkStatus(): Promise<void> {
    try {
      const response = await fetch('/api/boot');
      if (!response.ok) return;

      const data = await response.json();
      if (data.ollamaStatus) {
        running.set(data.ollamaStatus.running);
        hasModels.set(data.ollamaStatus.hasModels);
        modelCount.set(data.ollamaStatus.modelCount || 0);
        error.set(data.ollamaStatus.error || null);
      }
    } catch (e) {
      console.error('[ollama] Failed to check status:', e);
      error.set('Failed to check Ollama status');
    }
  }

  /**
   * Check if Ollama is ready for use
   */
  function isReady(): boolean {
    return get(running) && get(hasModels);
  }

  return {
    // Stores
    running,
    hasModels,
    modelCount,
    error,

    // Methods
    checkStatus,
    isReady,
  };
}