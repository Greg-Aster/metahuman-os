/**
 * Native LLM Plugin Interface
 *
 * Provides interface to on-device LLM (llama.cpp) via Capacitor native plugin.
 * This is the client-side TypeScript interface that communicates with the
 * native Android/iOS plugin.
 *
 * The actual implementation lives in:
 * - Android: apps/mobile/android/app/src/main/java/com/metahuman/os/plugins/llm/
 * - iOS: apps/mobile/ios/App/App/Plugins/LLM/ (future)
 */

// Dynamic import used - no static @capacitor/core import to avoid web bundle issues
import { isCapacitorNative } from '../api-config';

// ============================================================================
// Types
// ============================================================================

export interface NativeLLMPlugin {
  /**
   * Check if a model is currently loaded in memory
   */
  isModelLoaded(): Promise<{ loaded: boolean; modelName?: string; memoryUsageMB?: number }>;

  /**
   * Load a GGUF model file into memory
   */
  loadModel(options: {
    modelPath: string;
    contextSize?: number;
    gpuLayers?: number;
  }): Promise<{ success: boolean; error?: string; loadTimeMs?: number }>;

  /**
   * Unload the current model from memory
   */
  unloadModel(): Promise<{ success: boolean }>;

  /**
   * Generate text completion
   */
  generate(options: {
    prompt: string;
    maxTokens?: number;
    temperature?: number;
    topP?: number;
    stopSequences?: string[];
  }): Promise<{
    text: string;
    tokensGenerated: number;
    tokensPerSecond: number;
    finishReason: 'stop' | 'length' | 'error';
  }>;

  /**
   * Generate chat completion (conversation format)
   */
  chat(options: {
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
    maxTokens?: number;
    temperature?: number;
  }): Promise<{
    response: string;
    tokensGenerated: number;
    tokensPerSecond: number;
  }>;

  /**
   * List available model files on device
   */
  listModels(): Promise<{
    models: Array<{
      name: string;
      path: string;
      sizeMB: number;
      quantization: string;
    }>;
  }>;

  /**
   * Download a model from URL to device storage
   */
  downloadModel(options: {
    url: string;
    filename: string;
  }): Promise<{ success: boolean; path?: string; error?: string }>;

  /**
   * Get current inference status
   */
  getStatus(): Promise<{
    inferring: boolean;
    modelLoaded: boolean;
    modelName?: string;
    memoryUsageMB: number;
    cpuUsagePercent: number;
  }>;

  /**
   * Cancel ongoing inference
   */
  cancelInference(): Promise<{ cancelled: boolean }>;

  /**
   * Add listener for download progress
   */
  addListener(
    eventName: 'downloadProgress',
    callback: (event: { progress: number; bytesDownloaded: number; totalBytes: number }) => void
  ): Promise<{ remove: () => void }>;

  /**
   * Add listener for inference tokens (streaming)
   */
  addListener(
    eventName: 'inferenceToken',
    callback: (event: { token: string; tokenIndex: number }) => void
  ): Promise<{ remove: () => void }>;
}

// ============================================================================
// Plugin Registration (Lazy-loaded to avoid @capacitor/core on web)
// ============================================================================

// Cached plugin instance
let _nativeLLMPlugin: NativeLLMPlugin | null = null;

/**
 * Get the NativeLLM plugin instance.
 * Uses dynamic import to avoid loading @capacitor/core on web.
 */
async function getNativeLLMPlugin(): Promise<NativeLLMPlugin> {
  if (_nativeLLMPlugin) {
    return _nativeLLMPlugin;
  }

  // Check if we're on native platform first
  if (!isCapacitorNative()) {
    // Return web fallback
    const { NativeLLMWeb } = await import('./native-llm-web');
    _nativeLLMPlugin = new NativeLLMWeb() as unknown as NativeLLMPlugin;
    return _nativeLLMPlugin;
  }

  // Dynamic import of Capacitor only on native
  const { registerPlugin } = await import('@capacitor/core');
  _nativeLLMPlugin = registerPlugin<NativeLLMPlugin>('NativeLLM', {
    web: () => import('./native-llm-web').then(m => new m.NativeLLMWeb()),
  });
  return _nativeLLMPlugin;
}

// ============================================================================
// Wrapper with Availability Check
// ============================================================================

class NativeLLMWrapper implements NativeLLMPlugin {
  private checkAvailability(): void {
    if (!isCapacitorNative()) {
      throw new Error('NativeLLM is only available on native platforms');
    }
  }

  async isModelLoaded(): Promise<{ loaded: boolean; modelName?: string; memoryUsageMB?: number }> {
    if (!isCapacitorNative()) {
      return { loaded: false };
    }
    const plugin = await getNativeLLMPlugin();
    return plugin.isModelLoaded();
  }

  async loadModel(options: {
    modelPath: string;
    contextSize?: number;
    gpuLayers?: number;
  }): Promise<{ success: boolean; error?: string; loadTimeMs?: number }> {
    this.checkAvailability();
    const plugin = await getNativeLLMPlugin();
    return plugin.loadModel(options);
  }

  async unloadModel(): Promise<{ success: boolean }> {
    this.checkAvailability();
    const plugin = await getNativeLLMPlugin();
    return plugin.unloadModel();
  }

  async generate(options: {
    prompt: string;
    maxTokens?: number;
    temperature?: number;
    topP?: number;
    stopSequences?: string[];
  }): Promise<{
    text: string;
    tokensGenerated: number;
    tokensPerSecond: number;
    finishReason: 'stop' | 'length' | 'error';
  }> {
    this.checkAvailability();
    const plugin = await getNativeLLMPlugin();
    return plugin.generate(options);
  }

  async chat(options: {
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
    maxTokens?: number;
    temperature?: number;
  }): Promise<{
    response: string;
    tokensGenerated: number;
    tokensPerSecond: number;
  }> {
    this.checkAvailability();
    const plugin = await getNativeLLMPlugin();
    return plugin.chat(options);
  }

  async listModels(): Promise<{
    models: Array<{
      name: string;
      path: string;
      sizeMB: number;
      quantization: string;
    }>;
  }> {
    if (!isCapacitorNative()) {
      return { models: [] };
    }
    const plugin = await getNativeLLMPlugin();
    return plugin.listModels();
  }

  async downloadModel(options: {
    url: string;
    filename: string;
  }): Promise<{ success: boolean; path?: string; error?: string }> {
    this.checkAvailability();
    const plugin = await getNativeLLMPlugin();
    return plugin.downloadModel(options);
  }

  async getStatus(): Promise<{
    inferring: boolean;
    modelLoaded: boolean;
    modelName?: string;
    memoryUsageMB: number;
    cpuUsagePercent: number;
  }> {
    if (!isCapacitorNative()) {
      return {
        inferring: false,
        modelLoaded: false,
        memoryUsageMB: 0,
        cpuUsagePercent: 0,
      };
    }
    const plugin = await getNativeLLMPlugin();
    return plugin.getStatus();
  }

  async cancelInference(): Promise<{ cancelled: boolean }> {
    if (!isCapacitorNative()) {
      return { cancelled: false };
    }
    const plugin = await getNativeLLMPlugin();
    return plugin.cancelInference();
  }

  addListener(
    eventName: 'downloadProgress',
    callback: (event: { progress: number; bytesDownloaded: number; totalBytes: number }) => void
  ): Promise<{ remove: () => void }>;
  addListener(
    eventName: 'inferenceToken',
    callback: (event: { token: string; tokenIndex: number }) => void
  ): Promise<{ remove: () => void }>;
  async addListener(
    eventName: 'downloadProgress' | 'inferenceToken',
    callback: (event: any) => void
  ): Promise<{ remove: () => void }> {
    if (!isCapacitorNative()) {
      return { remove: () => {} };
    }
    const plugin = await getNativeLLMPlugin();
    // Use type assertion to handle the union - native plugin handles type safety
    if (eventName === 'downloadProgress') {
      return plugin.addListener(eventName, callback);
    } else {
      return plugin.addListener(eventName, callback);
    }
  }
}

// Export singleton instance
export const NativeLLM = new NativeLLMWrapper();
