/**
 * @metahuman/core
 *
 * Shared core library for MetaHuman OS
 * Used by CLI, web UI, agents, and skills
 */

export * from './paths';
export * from './identity';
export * from './memory';
export * from './audit';
export * from './llm';
export * from './ollama';
export * from './model-resolver';
export * from './model-router';
export * from './specialist-broker';
export * from './agent-monitor';
export * from './vector-index';
export * from './embeddings';
export * from './locks';
export * from './logging';
export * from './transcription';
export * from './adapters';
export * from './skills';
export * from './policy';
export * from './tts';
export * from './stt';
export * from './voice-training';
export * from './autonomy';
export * from './cognitive-mode';
export * from './fs-glob';
export * from './progress-tracker';
export * from './state';

// Version
export const VERSION = '0.1.0';
export const PHASE = 'Phase 1-2: Intelligence & Autonomy';
