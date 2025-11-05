/**
 * Context Window Management
 *
 * Manages LLM conversation history to stay within token limits while
 * preserving important context and recent messages.
 */

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
  meta?: any;
}

export interface ContextWindowConfig {
  maxTokens: number;          // Maximum tokens for context window
  maxMessages: number;         // Maximum number of messages to keep
  preserveSystemMessages: boolean;  // Always keep system messages
  tokensPerMessage: number;    // Estimated tokens per message (rough approximation)
}

const DEFAULT_CONFIG: ContextWindowConfig = {
  maxTokens: 8000,  // Conservative limit (works for most models)
  maxMessages: 20,  // Keep last 20 messages
  preserveSystemMessages: true,
  tokensPerMessage: 4,  // Rough estimate: 1 token ≈ 4 characters
};

/**
 * Rough token estimation (characters / 4)
 * More accurate than nothing, but not perfect
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Calculate total tokens in message history
 */
export function calculateHistoryTokens(messages: Message[]): number {
  return messages.reduce((total, msg) => {
    return total + estimateTokens(msg.content) + 10; // +10 for role/metadata overhead
  }, 0);
}

/**
 * Prune message history to fit within token budget
 *
 * Strategy:
 * 1. Always preserve the first system message (persona/instructions)
 * 2. Always preserve the last N messages (recent context)
 * 3. Remove older messages from the middle if over budget
 */
export function pruneHistory(
  messages: Message[],
  config: Partial<ContextWindowConfig> = {}
): Message[] {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // If under limits, return as-is
  if (messages.length <= cfg.maxMessages) {
    const totalTokens = calculateHistoryTokens(messages);
    if (totalTokens <= cfg.maxTokens) {
      return messages;
    }
  }

  // Separate system messages from conversation
  const systemMessages = cfg.preserveSystemMessages
    ? messages.filter(m => m.role === 'system')
    : [];
  const conversationMessages = messages.filter(m => m.role !== 'system');

  // Keep the most recent N conversation messages
  const recentCount = Math.min(cfg.maxMessages - systemMessages.length, conversationMessages.length);
  const recentMessages = conversationMessages.slice(-recentCount);

  // Combine: system messages first, then recent conversation
  const pruned = [...systemMessages, ...recentMessages];

  // Double-check token count and trim further if needed
  let totalTokens = calculateHistoryTokens(pruned);

  while (totalTokens > cfg.maxTokens && pruned.length > systemMessages.length + 4) {
    // Remove oldest conversation message (but keep system + at least 2 turns)
    const firstConvIndex = systemMessages.length;
    if (firstConvIndex < pruned.length) {
      pruned.splice(firstConvIndex, 1);
      totalTokens = calculateHistoryTokens(pruned);
    } else {
      break;
    }
  }

  return pruned;
}

/**
 * Smart context window that preserves important information
 * while staying within token limits
 */
export class ContextWindow {
  private messages: Message[] = [];
  private config: ContextWindowConfig;

  constructor(config: Partial<ContextWindowConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Add a message to the history
   */
  push(message: Message): void {
    this.messages.push(message);
    this.prune();
  }

  /**
   * Get all messages (already pruned)
   */
  getMessages(): Message[] {
    return [...this.messages];
  }

  /**
   * Get message count
   */
  getCount(): number {
    return this.messages.length;
  }

  /**
   * Get estimated token count
   */
  getTokenCount(): number {
    return calculateHistoryTokens(this.messages);
  }

  /**
   * Clear all messages
   */
  clear(): void {
    this.messages = [];
  }

  /**
   * Replace all messages
   */
  setMessages(messages: Message[]): void {
    this.messages = messages;
    this.prune();
  }

  /**
   * Prune messages to fit within limits
   */
  private prune(): void {
    this.messages = pruneHistory(this.messages, this.config);
  }

  /**
   * Get summary statistics
   */
  getStats(): {
    messageCount: number;
    estimatedTokens: number;
    systemMessageCount: number;
    userMessageCount: number;
    assistantMessageCount: number;
  } {
    return {
      messageCount: this.messages.length,
      estimatedTokens: this.getTokenCount(),
      systemMessageCount: this.messages.filter(m => m.role === 'system').length,
      userMessageCount: this.messages.filter(m => m.role === 'user').length,
      assistantMessageCount: this.messages.filter(m => m.role === 'assistant').length,
    };
  }
}

/**
 * Create a context window with sensible defaults for different model types
 */
export function createContextWindow(modelType: 'small' | 'medium' | 'large' = 'medium'): ContextWindow {
  const configs = {
    small: { maxTokens: 2000, maxMessages: 10 },   // 4k context models (e.g., phi3:mini)
    medium: { maxTokens: 8000, maxMessages: 20 },  // 8-16k context models (e.g., qwen2.5)
    large: { maxTokens: 32000, maxMessages: 50 },  // 32k+ context models (e.g., claude)
  };

  return new ContextWindow(configs[modelType]);
}
