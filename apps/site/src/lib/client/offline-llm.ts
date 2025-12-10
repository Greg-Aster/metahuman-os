/**
 * Offline LLM Wrapper
 *
 * High-level wrapper for on-device LLM inference.
 * Handles model loading, persona context, and chat generation.
 */

import { getPersona } from './local-memory';

// Dynamic import for NativeLLM to avoid @capacitor/core bundle issues on web
async function getNativeLLM() {
  const { NativeLLM } = await import('./plugins/native-llm');
  return NativeLLM;
}

export interface OfflineChatOptions {
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

export interface OfflineModelInfo {
  name: string;
  loaded: boolean;
  contextSize: number;
}

/**
 * OfflineLLM - High-level wrapper for on-device inference
 */
export class OfflineLLM {
  private loaded = false;
  private currentModel: string | null = null;

  /**
   * Check if any model is currently loaded
   */
  async isLoaded(): Promise<boolean> {
    try {
      const NativeLLM = await getNativeLLM();
      const status = await NativeLLM.isModelLoaded();
      this.loaded = status.loaded;
      this.currentModel = status.modelName || null;
      return this.loaded;
    } catch {
      return false;
    }
  }

  /**
   * Ensure a model is loaded, loading the recommended one if needed
   */
  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;

    try {
      const NativeLLM = await getNativeLLM();
      const status = await NativeLLM.isModelLoaded();
      if (status.loaded) {
        this.loaded = true;
        this.currentModel = status.modelName || null;
        return;
      }

      // Find a downloaded model to load
      const modelsResult = await NativeLLM.listModels();
      const models = modelsResult.models;

      if (models.length === 0) {
        throw new Error('No offline model available. Download one in Settings → Server → On-Device AI.');
      }

      // Prefer smaller models for faster loading
      const sorted = [...models].sort((a, b) => a.sizeMB - b.sizeMB);
      const model = sorted[0];

      const loadResult = await NativeLLM.loadModel({
        modelPath: model.path,
        contextSize: 2048,
      });

      if (!loadResult.success) {
        throw new Error(loadResult.error || 'Failed to load model');
      }

      this.loaded = true;
      this.currentModel = model.name;
    } catch (e) {
      throw new Error(`Failed to load offline model: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }
  }

  /**
   * Unload the current model to free memory
   */
  async unload(): Promise<void> {
    if (!this.loaded) return;

    try {
      const NativeLLM = await getNativeLLM();
      await NativeLLM.unloadModel();
      this.loaded = false;
      this.currentModel = null;
    } catch (e) {
      console.error('Failed to unload model:', e);
    }
  }

  /**
   * Get the currently loaded model name
   */
  getLoadedModel(): string | null {
    return this.currentModel;
  }

  /**
   * Simple chat - send a message and get a response
   */
  async chat(message: string, personaSummary?: string): Promise<string> {
    await this.ensureLoaded();

    // Get persona from local storage if not provided
    let persona = personaSummary;
    if (!persona) {
      try {
        const localPersona = await getPersona('core');
        if (localPersona?.data?.summary) {
          persona = localPersona.data.summary;
        } else if (localPersona?.data?.name) {
          persona = `${localPersona.data.name}`;
        }
      } catch {
        // Use default
      }
    }

    const systemPrompt = persona
      ? `You are ${persona}. Respond naturally and briefly.`
      : 'You are a helpful assistant. Respond naturally and briefly.';

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: message },
    ];

    const NativeLLM = await getNativeLLM();
    const result = await NativeLLM.chat({ messages });
    return result.response;
  }

  /**
   * Generate text from a prompt (lower-level API)
   */
  async generate(prompt: string, options?: OfflineChatOptions): Promise<string> {
    await this.ensureLoaded();

    const NativeLLM = await getNativeLLM();
    const result = await NativeLLM.generate({
      prompt,
      maxTokens: options?.maxTokens || 256,
      temperature: options?.temperature || 0.7,
    });

    return result.text;
  }

  /**
   * Chat with streaming response
   */
  async chatStream(
    message: string,
    personaSummary: string | undefined,
    onToken: (token: string) => void
  ): Promise<string> {
    await this.ensureLoaded();

    let persona = personaSummary;
    if (!persona) {
      try {
        const localPersona = await getPersona('core');
        if (localPersona?.data?.summary) {
          persona = localPersona.data.summary;
        }
      } catch {
        // Use default
      }
    }

    const systemPrompt = persona
      ? `You are ${persona}. Respond naturally and briefly.`
      : 'You are a helpful assistant. Respond naturally and briefly.';

    const prompt = `${systemPrompt}

User: ${message}
Assistant:`;

    // Set up token listener
    const NativeLLM = await getNativeLLM();
    const listener = await NativeLLM.addListener('inferenceToken', (event) => {
      onToken(event.token);
    });

    try {
      const result = await NativeLLM.generate({
        prompt,
        maxTokens: 512,
      });
      return result.text;
    } finally {
      listener.remove();
    }
  }

  /**
   * Check if offline capability is available (any model downloaded)
   */
  async isAvailable(): Promise<boolean> {
    try {
      const NativeLLM = await getNativeLLM();
      const result = await NativeLLM.listModels();
      return result.models.length > 0;
    } catch {
      return false; // Plugin not available (web browser)
    }
  }

  /**
   * Get list of available (downloaded) models
   */
  async getAvailableModels(): Promise<OfflineModelInfo[]> {
    try {
      const NativeLLM = await getNativeLLM();
      const result = await NativeLLM.listModels();
      const status = await NativeLLM.isModelLoaded();

      return result.models.map((m) => ({
        name: m.name,
        loaded: status.loaded && status.modelName === m.name,
        contextSize: 2048, // Default
      }));
    } catch {
      return [];
    }
  }
}

// Singleton instance
export const offlineLLM = new OfflineLLM();
