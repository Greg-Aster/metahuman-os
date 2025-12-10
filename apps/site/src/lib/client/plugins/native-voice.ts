/**
 * Native Voice Plugin
 * Provides access to Android's native SpeechRecognizer and TextToSpeech
 * Only available when running in Capacitor Android app
 */

// Type-only import - erased at runtime, safe for web
import type { PluginListenerHandle } from '@capacitor/core';

// Hardware button event types
export type HardwareButtonEventType = 'singleClick' | 'doubleClick' | 'longPress' | 'multiClick' | 'play' | 'pause';

export interface HardwareButtonEvent {
  type: HardwareButtonEventType;
  clickCount: number;
  timestamp: number;
}

// Plugin interface
export interface NativeVoicePlugin {
  // Check if native voice features are available
  isAvailable(): Promise<{ stt: boolean; tts: boolean }>;

  // Speech-to-Text
  startListening(options?: { language?: string }): Promise<STTResult>;
  stopListening(): Promise<void>;
  cancelListening(): Promise<void>;

  // Text-to-Speech
  speak(options: { text: string; pitch?: number; rate?: number }): Promise<{ success: boolean }>;
  stopSpeaking(): Promise<void>;
  getVoices(): Promise<{ voices: NativeVoice[] }>;

  // Hardware button control (Bluetooth headphones, etc.)
  enableHardwareButtons(): Promise<{ enabled: boolean }>;
  disableHardwareButtons(): Promise<{ enabled: boolean }>;
  isHardwareButtonsEnabled(): Promise<{ enabled: boolean }>;

  // Event listeners
  addListener(eventName: 'sttReady', listener: () => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'sttStart', listener: () => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'sttEnd', listener: () => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'sttResult', listener: (result: STTResult) => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'sttPartialResult', listener: (result: STTResult) => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'sttError', listener: (error: { error: string; code: number }) => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'sttVolume', listener: (data: { volume: number }) => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'ttsStart', listener: (data: { utteranceId: string }) => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'ttsEnd', listener: (data: { utteranceId: string }) => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'ttsError', listener: (data: { utteranceId: string }) => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'hardwareButton', listener: (event: HardwareButtonEvent) => void): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}

export interface STTResult {
  transcript: string;
  confidence?: number;
  isFinal: boolean;
}

export interface NativeVoice {
  name: string;
  locale: string;
  quality: number;
  isNetworkConnectionRequired: boolean;
}

// Lazy-loaded plugin instance (only initialized on native platforms)
let _nativeVoicePlugin: NativeVoicePlugin | null = null;

/**
 * Get the NativeVoice plugin instance.
 * Uses dynamic import to avoid loading @capacitor/core on web.
 */
async function getNativeVoicePlugin(): Promise<NativeVoicePlugin> {
  if (_nativeVoicePlugin) {
    return _nativeVoicePlugin;
  }

  // Check if we're on native platform first
  if (!isCapacitorNative()) {
    // Return web fallback
    const { NativeVoiceWeb } = await import('./native-voice-web');
    _nativeVoicePlugin = new NativeVoiceWeb() as unknown as NativeVoicePlugin;
    return _nativeVoicePlugin;
  }

  // Dynamic import of Capacitor only on native
  const { registerPlugin } = await import('@capacitor/core');
  _nativeVoicePlugin = registerPlugin<NativeVoicePlugin>('NativeVoice', {
    web: () => import('./native-voice-web').then(m => new m.NativeVoiceWeb()),
  });
  return _nativeVoicePlugin;
}

// Proxy object that lazily initializes the plugin
export const NativeVoice: NativeVoicePlugin = {
  async isAvailable() {
    const plugin = await getNativeVoicePlugin();
    return plugin.isAvailable();
  },
  async startListening(options) {
    const plugin = await getNativeVoicePlugin();
    return plugin.startListening(options);
  },
  async stopListening() {
    const plugin = await getNativeVoicePlugin();
    return plugin.stopListening();
  },
  async cancelListening() {
    const plugin = await getNativeVoicePlugin();
    return plugin.cancelListening();
  },
  async speak(options) {
    const plugin = await getNativeVoicePlugin();
    return plugin.speak(options);
  },
  async stopSpeaking() {
    const plugin = await getNativeVoicePlugin();
    return plugin.stopSpeaking();
  },
  async getVoices() {
    const plugin = await getNativeVoicePlugin();
    return plugin.getVoices();
  },
  async enableHardwareButtons() {
    const plugin = await getNativeVoicePlugin();
    return plugin.enableHardwareButtons();
  },
  async disableHardwareButtons() {
    const plugin = await getNativeVoicePlugin();
    return plugin.disableHardwareButtons();
  },
  async isHardwareButtonsEnabled() {
    const plugin = await getNativeVoicePlugin();
    return plugin.isHardwareButtonsEnabled();
  },
  async addListener(eventName: any, listener: any) {
    const plugin = await getNativeVoicePlugin();
    return plugin.addListener(eventName, listener);
  },
  async removeAllListeners() {
    const plugin = await getNativeVoicePlugin();
    return plugin.removeAllListeners();
  },
};

/**
 * Check if running in Capacitor native app
 */
export function isCapacitorNative(): boolean {
  if (typeof window === 'undefined') return false;
  const cap = (window as any).Capacitor;
  return cap?.isNativePlatform?.() === true;
}

/**
 * Check if native voice features are available
 */
export async function isNativeVoiceAvailable(): Promise<{ stt: boolean; tts: boolean }> {
  if (!isCapacitorNative()) {
    return { stt: false, tts: false };
  }
  try {
    return await NativeVoice.isAvailable();
  } catch {
    return { stt: false, tts: false };
  }
}
