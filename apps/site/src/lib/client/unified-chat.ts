/**
 * Unified Chat Interface
 *
 * Provides a single interface for chat that automatically routes to the best tier:
 * - Offline: On-device Qwen3-1.7B via llama.cpp
 * - Server: Home server Qwen3:14B via Ollama
 * - Cloud: RunPod Qwen3-Coder-30B
 *
 * All conversations are saved locally first, then synced to server when connected.
 */

import { selectBestTier, type TierType } from './tier-selection';
import { saveMemory } from './local-memory';
import { apiFetch } from './api-config';
import { healthStatus } from './server-health';
import { get } from 'svelte/store';

export interface ChatOptions {
  forceTier?: TierType;
  maxTokens?: number;
  includeHistory?: boolean;
  historyLimit?: number;
}

export interface ChatResponse {
  response: string;
  tier: TierType;
  model: string;
  memoryId: string;
  latencyMs: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * Unified Chat - routes to the best available tier
 */
export class UnifiedChat {
  private conversationHistory: ChatMessage[] = [];
  private maxHistoryLength = 10;

  /**
   * Send a message and get a response from the best available tier
   */
  async sendMessage(message: string, options?: ChatOptions): Promise<ChatResponse> {
    const startTime = Date.now();

    // Determine which tier to use
    let tier: TierType;

    if (options?.forceTier) {
      tier = options.forceTier;
    } else {
      // Auto-select based on connectivity, battery, task complexity
      const result = await selectBestTier(['chat']);
      tier = result.selectedTier;
    }

    // Execute on selected tier
    let response: string;
    let model: string;

    try {
      switch (tier) {
        case 'offline':
          const offlineResult = await this.executeOffline(message, options);
          response = offlineResult.response;
          model = offlineResult.model;
          break;

        case 'server':
          const serverResult = await this.executeServer(message, options);
          response = serverResult.response;
          model = serverResult.model;
          break;

        case 'cloud':
          const cloudResult = await this.executeCloud(message, options);
          response = cloudResult.response;
          model = cloudResult.model;
          break;

        default:
          throw new Error(`Unknown tier: ${tier}`);
      }
    } catch (e) {
      // If selected tier fails, try fallback
      const fallbackResult = await this.executeFallback(message, tier, options, e);
      response = fallbackResult.response;
      model = fallbackResult.model;
      tier = fallbackResult.tier;
    }

    // Update conversation history
    this.conversationHistory.push({ role: 'user', content: message });
    this.conversationHistory.push({ role: 'assistant', content: response });

    // Trim history if too long
    if (this.conversationHistory.length > this.maxHistoryLength * 2) {
      this.conversationHistory = this.conversationHistory.slice(-this.maxHistoryLength * 2);
    }

    // Save to local memory (always, regardless of tier)
    const memoryId = crypto.randomUUID();
    const now = new Date().toISOString();

    await saveMemory({
      id: memoryId,
      type: 'conversation',
      content: `User: ${message}\n\nAssistant: ${response}`,
      timestamp: now,
      metadata: {
        tier,
        model,
        latencyMs: Date.now() - startTime,
        cognitiveMode: 'dual', // Or get from current mode
      },
    });

    const latencyMs = Date.now() - startTime;

    return {
      response,
      tier,
      model,
      memoryId,
      latencyMs,
    };
  }

  /**
   * Execute on offline tier (on-device llama.cpp)
   * NOTE: Offline mode not available in React Native - uses Node.js server instead
   */
  private async executeOffline(
    _message: string,
    _options?: ChatOptions
  ): Promise<{ response: string; model: string }> {
    // Offline mode not available in React Native
    // The mobile app uses the local Node.js server instead of on-device inference
    throw new Error('Offline mode not available. Use server mode instead.');
  }

  /**
   * Execute on server tier (home Ollama server)
   */
  private async executeServer(
    message: string,
    options?: ChatOptions
  ): Promise<{ response: string; model: string }> {
    const health = get(healthStatus);
    if (!health.connected) {
      throw new Error('Server not connected');
    }

    const body: Record<string, any> = {
      message,
    };

    if (options?.includeHistory && this.conversationHistory.length > 0) {
      body.history = this.conversationHistory.slice(-(options.historyLimit || 6));
    }

    const response = await apiFetch('/api/persona_chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`);
    }

    const data = await response.json();

    return {
      response: data.response || data.content || '',
      model: data.model || 'qwen3:14b',
    };
  }

  /**
   * Execute on cloud tier (RunPod or cloud server)
   */
  private async executeCloud(
    message: string,
    options?: ChatOptions
  ): Promise<{ response: string; model: string }> {
    const body: Record<string, any> = {
      message,
      useCloud: true,
    };

    if (options?.includeHistory && this.conversationHistory.length > 0) {
      body.history = this.conversationHistory.slice(-(options.historyLimit || 6));
    }

    const response = await apiFetch('/api/persona_chat?tier=cloud', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Cloud returned ${response.status}`);
    }

    const data = await response.json();

    return {
      response: data.response || data.content || '',
      model: data.model || 'qwen3-coder-30b',
    };
  }

  /**
   * Fallback logic when primary tier fails
   */
  private async executeFallback(
    message: string,
    failedTier: TierType,
    options: ChatOptions | undefined,
    error: unknown
  ): Promise<{ response: string; model: string; tier: TierType }> {
    console.warn(`Tier ${failedTier} failed:`, error);

    // Try tiers in order of preference
    const fallbackOrder = (['server', 'cloud', 'offline'] as TierType[]).filter(t => t !== failedTier);

    for (const tier of fallbackOrder) {
      try {
        switch (tier) {
          case 'offline':
            const offlineResult = await this.executeOffline(message, options);
            return { ...offlineResult, tier };

          case 'server':
            const serverResult = await this.executeServer(message, options);
            return { ...serverResult, tier };

          case 'cloud':
            const cloudResult = await this.executeCloud(message, options);
            return { ...cloudResult, tier };
        }
      } catch (e) {
        console.warn(`Fallback tier ${tier} also failed:`, e);
        continue;
      }
    }

    // All tiers failed
    throw new Error('All tiers unavailable. Check your connection or download an offline model.');
  }

  /**
   * Clear conversation history
   */
  clearHistory(): void {
    this.conversationHistory = [];
  }

  /**
   * Get current conversation history
   */
  getHistory(): ChatMessage[] {
    return [...this.conversationHistory];
  }

  /**
   * Set conversation history (e.g., when resuming a conversation)
   */
  setHistory(history: ChatMessage[]): void {
    this.conversationHistory = [...history];
  }

  /**
   * Get battery status for tier selection
   */
  private async getBatteryStatus(): Promise<{ level: number; charging: boolean }> {
    if ('getBattery' in navigator) {
      try {
        const battery = await (navigator as any).getBattery();
        return { level: battery.level, charging: battery.charging };
      } catch {
        // Fall through
      }
    }
    return { level: 1, charging: true }; // Assume plugged in if no API
  }
}

// Singleton instance
export const unifiedChat = new UnifiedChat();

/**
 * Quick helper for simple one-off messages
 */
export async function sendMessage(message: string, options?: ChatOptions): Promise<ChatResponse> {
  return unifiedChat.sendMessage(message, options);
}
