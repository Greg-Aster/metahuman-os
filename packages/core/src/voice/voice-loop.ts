/**
 * Voice Loop Controller
 *
 * Manages the live voice interaction state machine.
 * Coordinates ASR, TTS, and turn-taking.
 *
 * Part of Phase 5: Voice Agent + System Operator
 */

import { EventEmitter } from 'events';
import { audit } from '../audit.js';
import type {
  VoiceLoopConfig,
  VoiceLoopState,
  VoiceLoopStatus,
  VoiceLoopEvent,
  VoiceLoopEventHandler,
  ASRResult,
  TTSResult,
  Turn,
  ConversationSession,
  DEFAULT_VOICE_LOOP_CONFIG,
} from './types.js';

// ============================================================================
// Voice Loop Controller
// ============================================================================

export class VoiceLoopController extends EventEmitter {
  private config: VoiceLoopConfig;
  private state: VoiceLoopState = 'idle';
  private session: ConversationSession | null = null;
  private currentTurn: Turn | null = null;
  private username: string;
  private eventHandlers: VoiceLoopEventHandler[] = [];

  constructor(username: string, config?: Partial<VoiceLoopConfig>) {
    super();
    this.username = username;
    this.config = {
      ...getDefaultConfig(),
      ...config,
    };
  }

  // ==========================================================================
  // State Management
  // ==========================================================================

  /**
   * Get current voice loop status.
   */
  getStatus(): VoiceLoopStatus {
    return {
      state: this.state,
      asrState: 'idle',
      ttsState: 'idle',
      isActive: this.state !== 'idle' && this.state !== 'error',
      lastActivity: new Date().toISOString(),
      currentTranscript: this.currentTurn?.transcript,
    };
  }

  /**
   * Get current session.
   */
  getSession(): ConversationSession | null {
    return this.session;
  }

  /**
   * Transition to a new state.
   */
  private setState(newState: VoiceLoopState): void {
    const oldState = this.state;
    this.state = newState;

    this.emitEvent({
      type: 'state_change',
      timestamp: new Date().toISOString(),
      data: { oldState, newState },
    });

    audit({
      category: 'action',
      level: 'info',
      event: 'voice_loop_state_change',
      actor: this.username,
      details: { oldState, newState, sessionId: this.session?.id },
    });
  }

  // ==========================================================================
  // Session Management
  // ==========================================================================

  /**
   * Start a new voice session.
   */
  async start(): Promise<void> {
    if (this.state !== 'idle') {
      throw new Error(`Cannot start voice loop from state: ${this.state}`);
    }

    this.session = {
      id: `voice-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      startTime: new Date().toISOString(),
      turns: [],
      username: this.username,
    };

    this.setState('listening');

    audit({
      category: 'action',
      level: 'info',
      event: 'voice_session_started',
      actor: this.username,
      details: { sessionId: this.session.id },
    });
  }

  /**
   * Stop the current voice session.
   */
  async stop(): Promise<void> {
    if (this.session) {
      this.session.endTime = new Date().toISOString();

      audit({
        category: 'action',
        level: 'info',
        event: 'voice_session_ended',
        actor: this.username,
        details: {
          sessionId: this.session.id,
          duration: Date.now() - new Date(this.session.startTime).getTime(),
          turnCount: this.session.turns.length,
        },
      });
    }

    this.setState('idle');
    this.currentTurn = null;
  }

  /**
   * Pause listening (keep session active).
   */
  async pause(): Promise<void> {
    if (this.state === 'listening') {
      this.setState('idle');
    }
  }

  /**
   * Resume listening.
   */
  async resume(): Promise<void> {
    if (this.state === 'idle' && this.session) {
      this.setState('listening');
    }
  }

  // ==========================================================================
  // Speech Handling
  // ==========================================================================

  /**
   * Handle speech start detected.
   */
  onSpeechStart(): void {
    if (this.state !== 'listening') return;

    this.currentTurn = {
      id: `turn-${Date.now()}`,
      speaker: 'user',
      startTime: new Date().toISOString(),
      interrupted: false,
    };

    this.emitEvent({
      type: 'speech_start',
      timestamp: new Date().toISOString(),
      data: { turnId: this.currentTurn.id },
    });
  }

  /**
   * Handle speech end detected.
   */
  onSpeechEnd(): void {
    if (!this.currentTurn) return;

    this.currentTurn.endTime = new Date().toISOString();
    this.setState('processing');

    this.emitEvent({
      type: 'speech_end',
      timestamp: new Date().toISOString(),
      data: { turnId: this.currentTurn.id },
    });
  }

  /**
   * Handle partial transcript update.
   */
  onTranscriptPartial(text: string): void {
    if (!this.currentTurn) return;

    this.currentTurn.transcript = text;

    this.emitEvent({
      type: 'transcript_partial',
      timestamp: new Date().toISOString(),
      data: { text, turnId: this.currentTurn.id },
    });
  }

  /**
   * Handle final transcript.
   */
  async onTranscriptFinal(result: ASRResult): Promise<void> {
    if (!this.currentTurn || !this.session) return;

    this.currentTurn.transcript = result.text;
    this.session.turns.push(this.currentTurn);

    this.emitEvent({
      type: 'transcript_final',
      timestamp: new Date().toISOString(),
      data: { result, turnId: this.currentTurn.id },
    });

    // Save transcript if configured
    if (this.config.saveTranscripts) {
      audit({
        category: 'action',
        level: 'info',
        event: 'voice_transcript',
        actor: this.username,
        details: {
          sessionId: this.session.id,
          turnId: this.currentTurn.id,
          text: result.text,
          confidence: result.confidence,
        },
      });
    }

    this.currentTurn = null;
    this.setState('thinking');

    // Generate response (to be implemented with persona chat)
    await this.generateResponse(result.text);
  }

  // ==========================================================================
  // Response Handling
  // ==========================================================================

  /**
   * Generate response to user speech.
   */
  private async generateResponse(userText: string): Promise<void> {
    // This will integrate with the persona chat system
    // For now, emit event for external handling

    this.emitEvent({
      type: 'response_start',
      timestamp: new Date().toISOString(),
      data: { userText },
    });

    // Response generation would happen here
    // The actual implementation will use personaChat or operator

    this.setState('speaking');
  }

  /**
   * Handle TTS response chunk (streaming).
   */
  onResponseChunk(chunk: Buffer): void {
    this.emitEvent({
      type: 'response_chunk',
      timestamp: new Date().toISOString(),
      data: { chunkSize: chunk.length },
    });
  }

  /**
   * Handle response complete.
   */
  async onResponseComplete(result: TTSResult): Promise<void> {
    if (!this.session) return;

    const assistantTurn: Turn = {
      id: `turn-${Date.now()}`,
      speaker: 'assistant',
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
      transcript: result.text,
      interrupted: false,
    };

    this.session.turns.push(assistantTurn);

    this.emitEvent({
      type: 'response_end',
      timestamp: new Date().toISOString(),
      data: { turnId: assistantTurn.id },
    });

    // Return to listening state
    this.setState('listening');
  }

  // ==========================================================================
  // Barge-In Handling
  // ==========================================================================

  /**
   * Handle barge-in (user interrupts assistant).
   */
  onBargeIn(): void {
    if (this.state !== 'speaking') return;

    if (!this.config.bargeIn.enabled) return;

    this.setState('interrupted');

    this.emitEvent({
      type: 'barge_in',
      timestamp: new Date().toISOString(),
      data: { previousState: 'speaking' },
    });

    audit({
      category: 'action',
      level: 'info',
      event: 'voice_barge_in',
      actor: this.username,
      details: { sessionId: this.session?.id },
    });

    // Mark current assistant turn as interrupted
    if (this.session && this.session.turns.length > 0) {
      const lastTurn = this.session.turns[this.session.turns.length - 1];
      if (lastTurn.speaker === 'assistant') {
        lastTurn.interrupted = true;
      }
    }

    // Transition back to listening
    this.setState('listening');
  }

  // ==========================================================================
  // Event Handling
  // ==========================================================================

  /**
   * Subscribe to voice loop events.
   */
  onEvent(handler: VoiceLoopEventHandler): () => void {
    this.eventHandlers.push(handler);
    return () => {
      const index = this.eventHandlers.indexOf(handler);
      if (index > -1) {
        this.eventHandlers.splice(index, 1);
      }
    };
  }

  /**
   * Emit an event to all handlers.
   */
  private emitEvent(event: VoiceLoopEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error('Voice loop event handler error:', error);
      }
    }

    // Also emit via EventEmitter for Node.js compatibility
    this.emit(event.type, event);
  }

  // ==========================================================================
  // Error Handling
  // ==========================================================================

  /**
   * Handle an error.
   */
  onError(error: Error): void {
    this.setState('error');

    this.emitEvent({
      type: 'error',
      timestamp: new Date().toISOString(),
      data: { message: error.message, stack: error.stack },
    });

    audit({
      category: 'system',
      level: 'error',
      event: 'voice_loop_error',
      actor: this.username,
      details: {
        sessionId: this.session?.id,
        error: error.message,
      },
    });
  }

  // ==========================================================================
  // Configuration
  // ==========================================================================

  /**
   * Update configuration.
   */
  updateConfig(config: Partial<VoiceLoopConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration.
   */
  getConfig(): VoiceLoopConfig {
    return { ...this.config };
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get default voice loop configuration.
 */
function getDefaultConfig(): VoiceLoopConfig {
  return {
    audio: {
      sampleRate: 16000,
      channels: 1,
      bitDepth: 16,
      encoding: 'pcm',
    },
    asr: {
      model: 'whisper-small',
      language: 'en',
      vadEnabled: true,
      vadThreshold: 0.5,
      silenceTimeout: 1500,
      maxDuration: 30000,
    },
    tts: {
      model: 'piper',
      voice: 'en_US-lessac-medium',
      speed: 1.0,
      pitch: 1.0,
      volume: 1.0,
      streaming: true,
    },
    bargeIn: {
      enabled: true,
      sensitivity: 0.6,
      minInterruptDuration: 200,
      gracePeriod: 500,
    },
    autoStart: false,
    saveTranscripts: true,
    saveAudio: false,
  };
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new voice loop controller.
 */
export function createVoiceLoop(
  username: string,
  config?: Partial<VoiceLoopConfig>
): VoiceLoopController {
  return new VoiceLoopController(username, config);
}
