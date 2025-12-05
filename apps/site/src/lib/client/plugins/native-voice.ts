/**
 * Native Voice Plugin
 * Provides access to Android's native SpeechRecognizer and TextToSpeech
 * Only available when running in Capacitor Android app
 */

import { registerPlugin } from '@capacitor/core';
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

// Register the plugin - this will be available as NativeVoice
const NativeVoice = registerPlugin<NativeVoicePlugin>('NativeVoice', {
  web: () => import('./native-voice-web').then(m => new m.NativeVoiceWeb()),
});

export { NativeVoice };

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
