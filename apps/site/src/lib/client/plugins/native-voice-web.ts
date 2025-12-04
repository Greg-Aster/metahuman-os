/**
 * Web fallback implementation for NativeVoice plugin
 * Uses Web Speech API when native Android APIs aren't available
 */

import type { NativeVoicePlugin, STTResult, NativeVoice } from './native-voice';
import type { PluginListenerHandle } from '@capacitor/core';

type EventCallback = (...args: any[]) => void;

export class NativeVoiceWeb implements NativeVoicePlugin {
  private recognition: SpeechRecognition | null = null;
  private synthesis: SpeechSynthesis | null = null;
  private listeners: Map<string, Set<EventCallback>> = new Map();
  private currentUtterance: SpeechSynthesisUtterance | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      this.synthesis = window.speechSynthesis || null;
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        this.recognition = new SpeechRecognition();
      }
    }
  }

  async isAvailable(): Promise<{ stt: boolean; tts: boolean }> {
    return {
      stt: this.recognition !== null,
      tts: this.synthesis !== null,
    };
  }

  async startListening(options?: { language?: string }): Promise<STTResult> {
    return new Promise((resolve, reject) => {
      if (!this.recognition) {
        reject(new Error('Speech recognition not available'));
        return;
      }

      this.recognition.lang = options?.language || 'en-US';
      this.recognition.interimResults = true;
      this.recognition.maxAlternatives = 1;

      this.recognition.onresult = (event) => {
        const last = event.results.length - 1;
        const result = event.results[last];
        const transcript = result[0].transcript;
        const isFinal = result.isFinal;

        const sttResult: STTResult = {
          transcript,
          confidence: result[0].confidence,
          isFinal,
        };

        if (isFinal) {
          this.notifyListeners('sttResult', sttResult);
          resolve(sttResult);
        } else {
          this.notifyListeners('sttPartialResult', sttResult);
        }
      };

      this.recognition.onerror = (event) => {
        this.notifyListeners('sttError', { error: event.error, code: -1 });
        reject(new Error(event.error));
      };

      this.recognition.onstart = () => {
        this.notifyListeners('sttStart', {});
      };

      this.recognition.onend = () => {
        this.notifyListeners('sttEnd', {});
      };

      this.notifyListeners('sttReady', {});
      this.recognition.start();
    });
  }

  async stopListening(): Promise<void> {
    this.recognition?.stop();
  }

  async cancelListening(): Promise<void> {
    this.recognition?.abort();
  }

  async speak(options: { text: string; pitch?: number; rate?: number }): Promise<{ success: boolean }> {
    return new Promise((resolve, reject) => {
      if (!this.synthesis) {
        reject(new Error('Speech synthesis not available'));
        return;
      }

      // Cancel any ongoing speech
      this.synthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(options.text);
      utterance.pitch = options.pitch ?? 1.0;
      utterance.rate = options.rate ?? 1.0;

      // Try to use a good English voice
      const voices = this.synthesis.getVoices();
      const englishVoice = voices.find(v => v.lang.startsWith('en') && v.name.includes('Google')) ||
                          voices.find(v => v.lang.startsWith('en')) ||
                          voices[0];
      if (englishVoice) {
        utterance.voice = englishVoice;
      }

      utterance.onstart = () => {
        this.notifyListeners('ttsStart', { utteranceId: 'web' });
      };

      utterance.onend = () => {
        this.notifyListeners('ttsEnd', { utteranceId: 'web' });
        resolve({ success: true });
      };

      utterance.onerror = (event) => {
        this.notifyListeners('ttsError', { utteranceId: 'web' });
        reject(new Error(event.error));
      };

      this.currentUtterance = utterance;
      this.synthesis.speak(utterance);
    });
  }

  async stopSpeaking(): Promise<void> {
    this.synthesis?.cancel();
    this.currentUtterance = null;
  }

  async getVoices(): Promise<{ voices: NativeVoice[] }> {
    if (!this.synthesis) {
      return { voices: [] };
    }

    const voices = this.synthesis.getVoices().map(v => ({
      name: v.name,
      locale: v.lang,
      quality: v.localService ? 300 : 100,
      isNetworkConnectionRequired: !v.localService,
    }));

    return { voices };
  }

  async addListener(eventName: string, listener: EventCallback): Promise<PluginListenerHandle> {
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, new Set());
    }
    this.listeners.get(eventName)!.add(listener);

    return {
      remove: async () => {
        this.listeners.get(eventName)?.delete(listener);
      },
    };
  }

  async removeAllListeners(): Promise<void> {
    this.listeners.clear();
  }

  private notifyListeners(eventName: string, data: any) {
    const callbacks = this.listeners.get(eventName);
    if (callbacks) {
      callbacks.forEach(cb => cb(data));
    }
  }
}
