/**
 * Path Builder - Core Path Construction
 *
 * Pure path building functions with NO dependencies on context system.
 * This file breaks the circular dependency between paths.ts and context.ts.
 *
 * Import hierarchy:
 * - path-builder.ts (this file) → no internal dependencies
 * - context.ts → imports from path-builder.ts
 * - paths.ts → imports from path-builder.ts AND context.ts (for Proxy)
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Find metahuman root by looking for pnpm-workspace.yaml
 */
export function findRepoRoot(): string {
  // Start from the current file's directory and walk up to filesystem root (cross-platform)
  let dir = path.dirname(fileURLToPath(import.meta.url));
  const fsRoot = path.parse(dir).root;
  // Walk up until reaching the filesystem root
  while (true) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir || dir === fsRoot) break;
    dir = parent;
  }
  throw new Error('Could not find repository root. Make sure "pnpm-workspace.yaml" is present.');
}

export const ROOT = findRepoRoot();

/**
 * Get user-specific profile paths
 *
 * Returns paths for a specific user's profile directory.
 * Profile structure: profiles/{username}/
 *
 * @param username - Username for profile directory (NOT userId!)
 * @returns Object with all user-specific paths
 */
export function getProfilePaths(username: string) {
  const profileRoot = path.join(ROOT, 'profiles', username);

  return {
    root: profileRoot,
    persona: path.join(profileRoot, 'persona'),
    memory: path.join(profileRoot, 'memory'),
    etc: path.join(profileRoot, 'etc'),
    inbox: path.join(profileRoot, 'memory', 'inbox'),
    inboxArchive: path.join(profileRoot, 'memory', 'inbox', '_archive'),
    logs: path.join(profileRoot, 'logs'),
    out: path.join(profileRoot, 'out'),
    state: path.join(profileRoot, 'state'),

    // Persona files
    personaCore: path.join(profileRoot, 'persona', 'core.json'),
    personaRelationships: path.join(profileRoot, 'persona', 'relationships.json'),
    personaRoutines: path.join(profileRoot, 'persona', 'routines.json'),
    personaDecisionRules: path.join(profileRoot, 'persona', 'decision-rules.json'),
    personaFacets: path.join(profileRoot, 'persona', 'facets.json'),
    personaFacetsDir: path.join(profileRoot, 'persona', 'facets'),
    personaInterviews: path.join(profileRoot, 'persona', 'therapy'),
    personaInterviewsIndex: path.join(profileRoot, 'persona', 'therapy', 'index.json'),

    // Memory directories
    episodic: path.join(profileRoot, 'memory', 'episodic'),
    semantic: path.join(profileRoot, 'memory', 'semantic'),
    procedural: path.join(profileRoot, 'memory', 'procedural'),
    proceduralOvernight: path.join(profileRoot, 'memory', 'procedural', 'overnight'),
    preferences: path.join(profileRoot, 'memory', 'preferences'),
    tasks: path.join(profileRoot, 'memory', 'tasks'),
    indexDir: path.join(profileRoot, 'memory', 'index'),
    audioInbox: path.join(profileRoot, 'memory', 'audio', 'inbox'),
    audioTranscripts: path.join(profileRoot, 'memory', 'audio', 'transcripts'),
    audioArchive: path.join(profileRoot, 'memory', 'audio', 'archive'),

    // Curiosity system
    curiosity: path.join(profileRoot, 'memory', 'curiosity'),
    curiosityFacts: path.join(profileRoot, 'memory', 'curiosity', 'facts'),
    curiosityResearch: path.join(profileRoot, 'memory', 'curiosity', 'research'),
    curiosityConfig: path.join(profileRoot, 'etc', 'curiosity.json'),

    // Function memory (Phase 1)
    functions: path.join(profileRoot, 'memory', 'functions'),
    functionsVerified: path.join(profileRoot, 'memory', 'functions', 'verified'),
    functionsDrafts: path.join(profileRoot, 'memory', 'functions', 'drafts'),

    // Logs (user-specific)
    decisions: path.join(profileRoot, 'logs', 'decisions'),
    actions: path.join(profileRoot, 'logs', 'actions'),
    sync: path.join(profileRoot, 'logs', 'sync'),

    // Voice training (profile-specific)
    voiceTraining: path.join(profileRoot, 'out', 'voice-training', 'recordings'),
    voiceDataset: path.join(profileRoot, 'out', 'voice-training', 'dataset'),
    voiceConfig: path.join(profileRoot, 'etc', 'voice.json'),

    // GPT-SoVITS reference audio (profile-specific)
    sovitsReference: path.join(profileRoot, 'out', 'voices', 'sovits'),
    sovitsModels: path.join(profileRoot, 'out', 'voices', 'sovits-models'),

    // RVC voice models (profile-specific)
    rvcReference: path.join(profileRoot, 'out', 'voices', 'rvc'),
    rvcModels: path.join(profileRoot, 'out', 'voices', 'rvc-models'),

    // Kokoro TTS (profile-specific)
    kokoroReference: path.join(profileRoot, 'out', 'voices', 'kokoro'),
    kokoroVoicepacks: path.join(profileRoot, 'out', 'voices', 'kokoro-voicepacks'),
    kokoroDatasets: path.join(profileRoot, 'out', 'voices', 'kokoro-datasets'),
  };
}

/**
 * System-level paths (not user-specific)
 *
 * These paths are always at root and never affected by user context.
 */
export const systemPaths = {
  root: ROOT,
  brain: path.join(ROOT, 'brain'),
  agents: path.join(ROOT, 'brain', 'agents'),
  skills: path.join(ROOT, 'brain', 'skills'),
  policies: path.join(ROOT, 'brain', 'policies'),
  logs: path.join(ROOT, 'logs'),
  run: path.join(ROOT, 'logs', 'run'),
  runAgents: path.join(ROOT, 'logs', 'run', 'agents'),
  profiles: path.join(ROOT, 'profiles'),

  // Auth and session databases (stay at root)
  usersDb: path.join(ROOT, 'persona', 'users.json'),
  sessionsFile: path.join(ROOT, 'logs', 'run', 'sessions.json'),

  // System configuration (accessible to all users)
  etc: path.join(ROOT, 'etc'),

  // Voice models (shared system-wide - these are large 60-120MB files)
  voiceModels: path.join(ROOT, 'out', 'voices'),
};
