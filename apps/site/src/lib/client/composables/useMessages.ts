/**
 * Message Handling Composable
 * Manages chat messages, history, and server interactions
 */

import { writable, get } from 'svelte/store';
import { apiFetch } from '../api-config';

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

    // NOTE: Duplicate detection removed to expose upstream issues
    // If you see duplicates, debug the source rather than hiding them here

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
   * Clear server conversation buffer
   */
  async function clearServerBuffer(): Promise<boolean> {
    const mode = getMode();
    try {
      const response = await apiFetch(`/api/conversation-buffer?mode=${mode}`, {
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
   * Delete a message by its relPath
   */
  async function deleteMessage(relPath: string): Promise<boolean> {
    try {
      const res = await apiFetch('/api/memories/delete', {
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
   * Supports curiosity questions, desire/goal messages, and card responses
   */
  function getReplyToMetadata(): {
    questionId: string | null;
    content: string | null;
    desireId: string | null;
    desireTitle: string | null;
    cardType: string | null;
    dialogueSource: string | null;
    isAgencyMessage: boolean;
    isCuriosityQuestion: boolean;
    responseBufferId: string | null;
    meta: Record<string, any> | null;
  } {
    const selected = get(selectedMessage);
    const meta = selected?.meta || null;
    // Check both questionId and curiosityQuestionId for backwards compatibility
    // curiosity-question-saver.node.ts saves as meta.questionId with isCuriosityQuestion: true
    const isCuriosity = !!(meta?.isCuriosityQuestion);
    const questionId = meta?.questionId || meta?.curiosityQuestionId || null;
    return {
      questionId: isCuriosity ? questionId : null,
      content: selected?.content || null,
      desireId: meta?.desireId || null,
      desireTitle: meta?.desireTitle || null,
      cardType: meta?.type || null,
      dialogueSource: meta?.dialogueSource || null,
      isAgencyMessage: !!(meta?.dialogueSource === 'agency-system' || meta?.isAgencyMessage),
      isCuriosityQuestion: isCuriosity,
      responseBufferId: meta?.responseBufferId || null,
      meta,
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
    clearServerBuffer,
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
      apiFetch('/api/activity-ping', { method: 'POST' })
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
 * LLM Backend Status Composable
 * Monitors active LLM backend (Ollama or vLLM) health and model availability
 * Note: Function still named useOllamaStatus for backward compatibility
 */
export function useOllamaStatus() {
  const running = writable<boolean>(true);
  const hasModels = writable<boolean>(true);
  const modelCount = writable<number>(0);
  const error = writable<string | null>(null);
  const activeBackend = writable<'ollama' | 'vllm'>('ollama');

  /**
   * Check backend status without triggering boot-time service work.
   */
  async function checkStatus(): Promise<void> {
    try {
      const response = await apiFetch('/api/llm-backend/status');
      if (!response.ok) return;

      const data = await response.json();
      const status = data.active;
      if (status) {
        running.set(Boolean(status.running));
        hasModels.set(Boolean(status.model));
        modelCount.set(status.model ? 1 : 0);
        error.set(status.running ? null : status.reason || 'Backend is not running');
        if (status.resolvedBackend === 'ollama' || status.resolvedBackend === 'vllm') {
          activeBackend.set(status.resolvedBackend);
        }
      }
    } catch (e) {
      console.error('[backend] Failed to check status:', e);
      error.set('Failed to check backend status');
    }
  }

  /**
   * Check if LLM backend is ready for use
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
    activeBackend,

    // Methods
    checkStatus,
    isReady,
  };
}
