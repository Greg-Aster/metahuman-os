import fs from 'node:fs';
import path from 'node:path';
import { audit } from './audit.js';
import { getUserContext } from './context.js';
import { getProfilePaths, systemPaths } from './path-builder.js';

export type MoodBufferSource = 'conversation' | 'inner' | 'both';

export interface MoodSettings {
  bufferSource: MoodBufferSource;
  maxMessagesPerBuffer: number;
  maxContextChars: number;
  baselineFacet: string;
  overridePersonaDisabled: boolean;
  minimumConfidence: number;
}

export interface MoodState {
  activeFacet?: string;
  previousFacet?: string;
  detectedMood?: string;
  confidence?: number;
  reason?: string;
  lastReviewedAt?: string;
  lastChangedAt?: string;
  lastTrigger?: string;
}

const DEFAULTS: MoodSettings = {
  bufferSource: 'conversation',
  maxMessagesPerBuffer: 20,
  maxContextChars: 12_000,
  baselineFacet: 'default',
  overridePersonaDisabled: false,
  minimumConfidence: 0.6,
};

const GLOBAL_CONFIG_PATH = path.join(systemPaths.etc, 'mood.json');

function normalize(raw: unknown): MoodSettings {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const bufferSource = value.bufferSource ?? DEFAULTS.bufferSource;
  if (bufferSource !== 'conversation' && bufferSource !== 'inner' && bufferSource !== 'both') {
    throw new Error('bufferSource must be conversation, inner, or both');
  }
  const maxMessagesPerBuffer = value.maxMessagesPerBuffer ?? DEFAULTS.maxMessagesPerBuffer;
  if (!Number.isInteger(maxMessagesPerBuffer) || Number(maxMessagesPerBuffer) < 1 || Number(maxMessagesPerBuffer) > 50) {
    throw new Error('maxMessagesPerBuffer must be an integer between 1 and 50');
  }
  const maxContextChars = value.maxContextChars ?? DEFAULTS.maxContextChars;
  if (!Number.isInteger(maxContextChars) || Number(maxContextChars) < 1_000 || Number(maxContextChars) > 100_000) {
    throw new Error('maxContextChars must be an integer between 1000 and 100000');
  }
  const baselineFacet = value.baselineFacet ?? DEFAULTS.baselineFacet;
  if (typeof baselineFacet !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(baselineFacet)) {
    throw new Error('baselineFacet must be a valid facet id');
  }
  const overridePersonaDisabled = value.overridePersonaDisabled ?? DEFAULTS.overridePersonaDisabled;
  if (typeof overridePersonaDisabled !== 'boolean') throw new Error('overridePersonaDisabled must be boolean');
  const minimumConfidence = value.minimumConfidence ?? DEFAULTS.minimumConfidence;
  if (typeof minimumConfidence !== 'number' || !Number.isFinite(minimumConfidence) || minimumConfidence < 0 || minimumConfidence > 1) {
    throw new Error('minimumConfidence must be between 0 and 1');
  }
  return {
    bufferSource,
    maxMessagesPerBuffer: Number(maxMessagesPerBuffer),
    maxContextChars: Number(maxContextChars),
    baselineFacet,
    overridePersonaDisabled,
    minimumConfidence,
  };
}

function readSettings(filePath: string): Partial<MoodSettings> {
  if (!fs.existsSync(filePath)) return {};
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
  return (parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : parsed) as Partial<MoodSettings>;
}

function resolveUsername(username?: string): string | undefined {
  return username || getUserContext()?.username;
}

export function loadMoodSettings(username?: string): MoodSettings {
  const global = readSettings(GLOBAL_CONFIG_PATH);
  const resolvedUsername = resolveUsername(username);
  const userPath = resolvedUsername ? path.join(getProfilePaths(resolvedUsername).etc, 'mood.json') : undefined;
  const user = userPath ? readSettings(userPath) : {};
  return normalize({ ...DEFAULTS, ...global, ...user });
}

export function saveMoodSettings(username: string, updates: Partial<MoodSettings>, actor: string): MoodSettings {
  const current = loadMoodSettings(username);
  const next = normalize({ ...current, ...updates });
  const filePath = path.join(getProfilePaths(username).etc, 'mood.json');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, `${JSON.stringify({
    version: '1.0.0',
    lastUpdated: new Date().toISOString(),
    settings: next,
  }, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, filePath);
  audit({
    level: 'info',
    category: 'data_change',
    event: 'mood_settings_updated',
    actor,
    details: { username, updates: Object.keys(updates) },
  });
  return next;
}

export function loadMoodState(username: string): MoodState {
  const filePath = path.join(getProfilePaths(username).state, 'mood-state.json');
  if (!fs.existsSync(filePath)) return {};
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

export function saveMoodState(username: string, patch: MoodState): MoodState {
  const filePath = path.join(getProfilePaths(username).state, 'mood-state.json');
  const definedPatch = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
  const next = { ...loadMoodState(username), ...definedPatch };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, filePath);
  return next;
}

export function isPersonaSummaryGloballyEnabled(): boolean {
  try {
    const models = JSON.parse(fs.readFileSync(path.join(systemPaths.etc, 'models.json'), 'utf8'));
    return models?.globalSettings?.includePersonaSummary !== false;
  } catch {
    return true;
  }
}
