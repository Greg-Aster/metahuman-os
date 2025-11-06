import fs from 'node:fs';
import path from 'node:path';
import { paths } from './paths';
import { audit } from './audit';

export type CognitiveModeId = 'dual' | 'agent' | 'emulation';

export interface CognitiveModeDefinition {
  id: CognitiveModeId;
  label: string;
  description: string;
  guidance: string[];
  defaults: {
    recordingEnabled: boolean;
    proactiveAgents: boolean;
    trainingPipeline: 'enabled' | 'disabled' | 'dual_trigger';
    memoryWriteLevel: 'full' | 'command_only' | 'read_only';
  };
}

export interface CognitiveModeConfig {
  currentMode: CognitiveModeId;
  lastChanged: string;
  locked?: boolean; // If true, mode cannot be changed
  history?: Array<{ mode: CognitiveModeId; changedAt: string; actor?: string }>;
}

/**
 * Get the path to the cognitive mode config file for the current user context.
 * This must be a function call (not a constant) to resolve user context at runtime.
 */
function getModeConfigPath(): string {
  return path.join(paths.persona, 'cognitive-mode.json');
}

const MODE_DEFINITIONS: Record<CognitiveModeId, CognitiveModeDefinition> = {
  dual: {
    id: 'dual',
    label: 'Dual Consciousness',
    description: 'Deep cognitive mirroring with continuous ingestion, recording, and learning.',
    guidance: [
      'Continuous recording of conversations and interactions.',
      'Synchronize persona core with the latest user state.',
      'Trigger full-cycle learning pipelines when significant updates occur.'
    ],
    defaults: {
      recordingEnabled: true,
      proactiveAgents: true,
      trainingPipeline: 'dual_trigger',
      memoryWriteLevel: 'full',
    },
  },
  agent: {
    id: 'agent',
    label: 'Agent Mode',
    description: 'Instruction-following assistant optimized for explicit commands.',
    guidance: [
      'Disable autonomous agents unless explicitly requested.',
      'Limit memory writes to command context and outcomes.',
      'Prefer concise, action-oriented responses.'
    ],
    defaults: {
      recordingEnabled: false,
      proactiveAgents: false,
      trainingPipeline: 'disabled',
      memoryWriteLevel: 'command_only',
    },
  },
  emulation: {
    id: 'emulation',
    label: 'Emulation',
    description: 'Stable conversational personality with read-only memories.',
    guidance: [
      'Do not create new memories or modify persona state.',
      'Respond using accumulated knowledge and tone.',
      'Treat all interactions as ephemeral sessions.'
    ],
    defaults: {
      recordingEnabled: false,
      proactiveAgents: false,
      trainingPipeline: 'disabled',
      memoryWriteLevel: 'read_only',
    },
  },
};

function ensureConfig(): CognitiveModeConfig {
  const configPath = getModeConfigPath();
  if (!fs.existsSync(configPath)) {
    const fallback: CognitiveModeConfig = {
      currentMode: 'dual',
      lastChanged: new Date().toISOString(),
      history: [{ mode: 'dual', changedAt: new Date().toISOString(), actor: 'system' }],
    };

    // Ensure parent directory exists
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(configPath, JSON.stringify(fallback, null, 2), 'utf-8');
    return fallback;
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as CognitiveModeConfig;
    if (!parsed.currentMode || !(parsed.currentMode in MODE_DEFINITIONS)) {
      throw new Error('Invalid cognitive mode configuration');
    }
    return parsed;
  } catch (error) {
    const fallback: CognitiveModeConfig = {
      currentMode: 'dual',
      lastChanged: new Date().toISOString(),
      history: [{ mode: 'dual', changedAt: new Date().toISOString(), actor: 'system' }],
    };
    fs.writeFileSync(configPath, JSON.stringify(fallback, null, 2), 'utf-8');
    return fallback;
  }
}

export function listCognitiveModes(): CognitiveModeDefinition[] {
  return Object.values(MODE_DEFINITIONS);
}

export function getModeDefinition(mode: CognitiveModeId): CognitiveModeDefinition {
  return MODE_DEFINITIONS[mode];
}

export function loadCognitiveMode(): CognitiveModeConfig {
  return ensureConfig();
}

export function saveCognitiveMode(nextMode: CognitiveModeId, actor: string = 'system'): CognitiveModeConfig {
  const config = ensureConfig();

  // Check if mode is locked (e.g., for guest profiles)
  if (config.locked) {
    audit({
      level: 'warn',
      category: 'security',
      event: 'cognitive_mode_change_blocked',
      actor,
      details: {
        reason: 'Mode is locked',
        currentMode: config.currentMode,
        attemptedMode: nextMode,
      },
    });
    throw new Error(`Cognitive mode is locked to ${config.currentMode} and cannot be changed`);
  }

  if (config.currentMode === nextMode) {
    return config;
  }

  const now = new Date().toISOString();
  const updated: CognitiveModeConfig = {
    currentMode: nextMode,
    lastChanged: now,
    locked: config.locked, // Preserve locked state
    history: [
      ...(config.history ?? []),
      { mode: nextMode, changedAt: now, actor },
    ],
  };

  fs.writeFileSync(getModeConfigPath(), JSON.stringify(updated, null, 2), 'utf-8');

  audit({
    level: 'info',
    category: 'system',
    event: 'cognitive_mode_changed',
    actor,
    details: {
      mode: nextMode,
      previous: config.currentMode,
      guidance: MODE_DEFINITIONS[nextMode].guidance,
    },
  });

  return updated;
}

export function applyModeDefaults(mode: CognitiveModeId): void {
  const def = MODE_DEFINITIONS[mode];
  audit({
    level: 'info',
    category: 'system',
    event: 'cognitive_mode_applied',
    actor: 'system',
    details: {
      mode,
      defaults: def.defaults,
    },
  });
  // TODO: integrate with agent scheduler, memory service, and training pipeline toggles.
}

/**
 * Helper to check if memory writes are allowed based on cognitive mode defaults.
 * Returns true for dual mode (full write access), true for agent mode (command outcomes),
 * and false for emulation mode (read-only).
 *
 * @param input - Mode key, full config object, or defaults object
 */
export function canWriteMemory(
  input: CognitiveModeId | CognitiveModeConfig | CognitiveModeDefinition['defaults']
): boolean {
  let defaults: CognitiveModeDefinition['defaults'];

  if (typeof input === 'string') {
    // Mode key provided
    defaults = MODE_DEFINITIONS[input].defaults;
  } else if ('currentMode' in input) {
    // Full config object provided
    defaults = MODE_DEFINITIONS[input.currentMode].defaults;
  } else {
    // Defaults object provided
    defaults = input;
  }

  return defaults.memoryWriteLevel !== 'read_only';
}

/**
 * Helper to check if operator routing is allowed based on cognitive mode.
 * Returns true for dual mode (always operator), true for agent mode (heuristic),
 * and false for emulation mode (chat-only).
 *
 * @param input - Mode key, full config object, or mode definition
 */
export function canUseOperator(
  input: CognitiveModeId | CognitiveModeConfig | CognitiveModeDefinition
): boolean {
  let mode: CognitiveModeId;

  if (typeof input === 'string') {
    // Mode key provided
    mode = input;
  } else if ('currentMode' in input) {
    // Full config object provided
    mode = input.currentMode;
  } else {
    // Mode definition provided
    mode = input.id;
  }

  // Emulation mode never uses operator (chat-only)
  return mode !== 'emulation';
}
