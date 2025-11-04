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
  history?: Array<{ mode: CognitiveModeId; changedAt: string; actor?: string }>;
}

const MODE_CONFIG_PATH = path.join(paths.persona, 'cognitive-mode.json');

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
    label: 'Emulation (Replicant)',
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
  if (!fs.existsSync(MODE_CONFIG_PATH)) {
    const fallback: CognitiveModeConfig = {
      currentMode: 'dual',
      lastChanged: new Date().toISOString(),
      history: [{ mode: 'dual', changedAt: new Date().toISOString(), actor: 'system' }],
    };
    fs.writeFileSync(MODE_CONFIG_PATH, JSON.stringify(fallback, null, 2), 'utf-8');
    return fallback;
  }

  try {
    const raw = fs.readFileSync(MODE_CONFIG_PATH, 'utf-8');
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
    fs.writeFileSync(MODE_CONFIG_PATH, JSON.stringify(fallback, null, 2), 'utf-8');
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
  if (config.currentMode === nextMode) {
    return config;
  }

  const now = new Date().toISOString();
  const updated: CognitiveModeConfig = {
    currentMode: nextMode,
    lastChanged: now,
    history: [
      ...(config.history ?? []),
      { mode: nextMode, changedAt: now, actor },
    ],
  };

  fs.writeFileSync(MODE_CONFIG_PATH, JSON.stringify(updated, null, 2), 'utf-8');

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
