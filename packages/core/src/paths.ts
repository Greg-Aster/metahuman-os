/**
 * Path Utilities
 *
 * Re-exports path building functions and provides utility functions
 * for timestamps and IDs.
 *
 * MIGRATION NOTE:
 * The legacy `paths` proxy is DEPRECATED. Use instead:
 * - systemPaths: For system-level paths (logs, agents, etc.)
 * - getProfilePaths(username): For user-specific paths
 * - storageClient: For category-based path resolution
 *
 * The `paths` export below maintains backwards compatibility
 * but will be removed in a future version.
 */

import fs from 'node:fs';
import path from 'node:path';

// Import users.ts FIRST to ensure profile storage config is registered
// before getProfilePaths is used (dependency injection pattern)
import './users.js';

// Re-export core path building functions
export { findRepoRoot, ROOT, getProfilePaths, systemPaths } from './path-builder.js';
import { ROOT, getProfilePaths, systemPaths } from './path-builder.js';

/**
 * DEPRECATED: Legacy paths proxy for backwards compatibility
 *
 * This object provides the old paths interface by:
 * - Using systemPaths for system-level paths
 * - Using a default owner profile for user-specific paths
 *
 * Prefer using getProfilePaths(username) or storageClient for new code.
 */
function getDefaultOwner(): string | null {
  try {
    const usersPath = path.join(ROOT, 'persona', 'users.json');
    if (fs.existsSync(usersPath)) {
      const users = JSON.parse(fs.readFileSync(usersPath, 'utf-8'));
      const owner = Object.values(users).find((u: any) => u.role === 'owner') as any;
      return owner?.username || null;
    }
  } catch {}
  return null;
}

// Cache the default profile paths
let _defaultProfilePaths: ReturnType<typeof getProfilePaths> | null = null;
function getDefaultProfilePaths() {
  if (!_defaultProfilePaths) {
    const owner = getDefaultOwner();
    if (owner) {
      _defaultProfilePaths = getProfilePaths(owner);
    } else {
      // Fallback to legacy 'memory/' path at root for backwards compatibility
      const legacyRoot = ROOT;
      _defaultProfilePaths = {
        root: legacyRoot,
        persona: path.join(legacyRoot, 'persona'),
        memory: path.join(legacyRoot, 'memory'),
        etc: path.join(legacyRoot, 'etc'),
        logs: path.join(legacyRoot, 'logs'),
        out: path.join(legacyRoot, 'out'),
        state: path.join(legacyRoot, 'state'),
        sessions: path.join(legacyRoot, 'sessions'),
        personaCore: path.join(legacyRoot, 'persona', 'core.json'),
        personaDecisionRules: path.join(legacyRoot, 'persona', 'decision-rules.json'),
        personaRoutines: path.join(legacyRoot, 'persona', 'routines.json'),
        personaRelationships: path.join(legacyRoot, 'persona', 'relationships.json'),
        episodic: path.join(legacyRoot, 'memory', 'episodic'),
        semantic: path.join(legacyRoot, 'memory', 'semantic'),
        procedural: path.join(legacyRoot, 'memory', 'procedural'),
        proceduralOvernight: path.join(legacyRoot, 'memory', 'procedural', 'overnight'),
        preferences: path.join(legacyRoot, 'memory', 'preferences'),
        inbox: path.join(legacyRoot, 'memory', 'inbox'),
        inboxArchive: path.join(legacyRoot, 'memory', 'inbox', '_archive'),
        audioInbox: path.join(legacyRoot, 'memory', 'audio-inbox'),
        audioTranscripts: path.join(legacyRoot, 'memory', 'audio-inbox', 'transcripts'),
        audioArchive: path.join(legacyRoot, 'memory', 'audio-inbox', '_archive'),
        tasks: path.join(legacyRoot, 'memory', 'tasks'),
        vectorIndex: path.join(legacyRoot, 'memory', 'index'),
        voiceTraining: path.join(legacyRoot, 'out', 'voice-training'),
        sovitsReference: path.join(legacyRoot, 'out', 'voices', 'sovits'),
        rvcReference: path.join(legacyRoot, 'out', 'voices', 'rvc'),
        rvcModels: path.join(legacyRoot, 'out', 'voices', 'rvc-models'),
        kokoroVoicepacks: path.join(legacyRoot, 'out', 'voices', 'kokoro-voicepacks'),
        kokoroDatasets: path.join(legacyRoot, 'out', 'voices', 'kokoro-datasets'),
      } as ReturnType<typeof getProfilePaths>;
    }
  }
  return _defaultProfilePaths;
}

/**
 * @deprecated Use systemPaths, getProfilePaths(username), or storageClient instead
 */
export const paths = {
  // System paths (from systemPaths)
  get root() { return ROOT; },
  get brain() { return systemPaths.brain; },
  get agents() { return systemPaths.agents; },
  get skills() { return path.join(systemPaths.brain, 'skills'); },
  get policies() { return path.join(systemPaths.brain, 'policies'); },
  get logs() { return systemPaths.logs; },
  get decisions() { return path.join(systemPaths.logs, 'decisions'); },
  get actions() { return path.join(systemPaths.logs, 'actions'); },
  get sync() { return path.join(ROOT, 'sync'); },

  // Profile paths (from default owner or legacy fallback)
  get persona() { return getDefaultProfilePaths().persona; },
  get personaCore() { return getDefaultProfilePaths().personaCore; },
  get personaDecisionRules() { return getDefaultProfilePaths().personaDecisionRules; },
  get personaRoutines() { return getDefaultProfilePaths().personaRoutines; },
  get personaRelationships() { return getDefaultProfilePaths().personaRelationships; },
  get memory() { return getDefaultProfilePaths().memory; },
  get episodic() { return getDefaultProfilePaths().episodic; },
  get semantic() { return getDefaultProfilePaths().semantic; },
  get procedural() { return getDefaultProfilePaths().procedural; },
  get proceduralOvernight() { return getDefaultProfilePaths().proceduralOvernight; },
  get preferences() { return getDefaultProfilePaths().preferences; },
  get inbox() { return getDefaultProfilePaths().inbox; },
  get inboxArchive() { return getDefaultProfilePaths().inboxArchive; },
  get audioInbox() { return getDefaultProfilePaths().audioInbox; },
  get audioTranscripts() { return getDefaultProfilePaths().audioTranscripts; },
  get audioArchive() { return getDefaultProfilePaths().audioArchive; },
  get tasks() { return getDefaultProfilePaths().tasks; },
  get vectorIndex() { return getDefaultProfilePaths().vectorIndex; },
  get out() { return getDefaultProfilePaths().out; },
  get voiceTraining() { return getDefaultProfilePaths().voiceTraining; },
  get sovitsReference() { return getDefaultProfilePaths().sovitsReference; },
  get rvcReference() { return getDefaultProfilePaths().rvcReference; },
  get rvcModels() { return getDefaultProfilePaths().rvcModels; },
  get kokoroVoicepacks() { return getDefaultProfilePaths().kokoroVoicepacks; },
  get kokoroDatasets() { return getDefaultProfilePaths().kokoroDatasets; },
};

/**
 * Get today's date in YYYY-MM-DD format
 */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Get current timestamp in ISO format
 */
export function timestamp(): string {
  return new Date().toISOString();
}

/**
 * Generate a unique ID with a prefix and timestamp
 * @param prefix - The prefix for the ID (e.g., 'event', 'task')
 * @returns A unique ID like 'event-20251201123456789'
 */
export function generateId(prefix: string): string {
  const now = new Date();
  const dateStr = now.toISOString()
    .replace(/[-:T.Z]/g, '')
    .slice(0, 15);
  return `${prefix}-${dateStr}`;
}
