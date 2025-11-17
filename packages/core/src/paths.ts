import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getUserContext } from './context.js';

// Find metahuman root by looking for pnpm-workspace.yaml
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

/**
 * Context-aware paths proxy
 *
 * Automatically resolves to user-specific paths when user context is active,
 * or falls back to root-level paths when no context is set.
 *
 * This provides backward compatibility for existing code while enabling
 * multi-user support through context.
 *
 * @example
 * ```typescript
 * import { paths } from '@metahuman/core/paths';
 *
 * // Without context - uses root paths
 * console.log(paths.episodic); // /home/greggles/metahuman/memory/episodic
 *
 * // With context - uses profile paths
 * await withUserContext({ userId: '123', username: 'alice', role: 'owner' }, () => {
 *   console.log(paths.episodic); // /home/greggles/metahuman/profiles/alice/memory/episodic
 * });
 * ```
 */
export const paths = new Proxy({} as ReturnType<typeof getProfilePaths> & typeof systemPaths, {
  get(target, prop: string) {
    const context = getUserContext();

    // System paths always return system-level paths
    if (prop in systemPaths) {
      return systemPaths[prop as keyof typeof systemPaths];
    }

    // SECURITY: Block anonymous users from accessing user data paths
    // UNLESS they have selected a public profile (guest mode)
    // Anonymous context = web request without login (intentional security block)
    if (context && context.username === 'anonymous' && !context.activeProfile) {
      throw new Error(
        `Access denied: Anonymous users cannot access user data paths. ` +
        `Attempted to access: paths.${prop}. ` +
        `Please authenticate or select a public profile to access data.`
      );
    }

    // If we have authenticated user context OR anonymous with selected profile,
    // return user-specific paths
    if (context && (context.username !== 'anonymous' || context.activeProfile)) {
      return context.profilePaths[prop as keyof typeof context.profilePaths];
    }

    // No context at all = CLI/system operation (not a web request)
    // Fall back to root-level paths for backward compatibility
    // This allows CLI commands like `mh capture` to work
    // OLD BEHAVIOR (UNSAFE - kept for reference):
    // Fallback to root-level paths (backward compatibility)
    const rootPaths = {
      root: ROOT,
      persona: path.join(ROOT, 'persona'),
      memory: path.join(ROOT, 'memory'),
      etc: path.join(ROOT, 'etc'),
      inbox: path.join(ROOT, 'memory', 'inbox'),
      inboxArchive: path.join(ROOT, 'memory', 'inbox', '_archive'),
      logs: path.join(ROOT, 'logs'),
      out: path.join(ROOT, 'out'),
      state: path.join(ROOT, 'state'),

      // Persona files
      personaCore: path.join(ROOT, 'persona', 'core.json'),
      personaRelationships: path.join(ROOT, 'persona', 'relationships.json'),
      personaRoutines: path.join(ROOT, 'persona', 'routines.json'),
      personaDecisionRules: path.join(ROOT, 'persona', 'decision-rules.json'),
      personaFacets: path.join(ROOT, 'persona', 'facets.json'),
      personaFacetsDir: path.join(ROOT, 'persona', 'facets'),
      personaInterviews: path.join(ROOT, 'persona', 'therapy'),
      personaInterviewsIndex: path.join(ROOT, 'persona', 'therapy', 'index.json'),

      // Memory directories
      episodic: path.join(ROOT, 'memory', 'episodic'),
      semantic: path.join(ROOT, 'memory', 'semantic'),
      procedural: path.join(ROOT, 'memory', 'procedural'),
      proceduralOvernight: path.join(ROOT, 'memory', 'procedural', 'overnight'),
      preferences: path.join(ROOT, 'memory', 'preferences'),
      tasks: path.join(ROOT, 'memory', 'tasks'),
      indexDir: path.join(ROOT, 'memory', 'index'),
      audioInbox: path.join(ROOT, 'memory', 'audio', 'inbox'),
      audioTranscripts: path.join(ROOT, 'memory', 'audio', 'transcripts'),
      audioArchive: path.join(ROOT, 'memory', 'audio', 'archive'),

      // Curiosity system
      curiosity: path.join(ROOT, 'memory', 'curiosity'),
      curiosityFacts: path.join(ROOT, 'memory', 'curiosity', 'facts'),
      curiosityResearch: path.join(ROOT, 'memory', 'curiosity', 'research'),
      curiosityConfig: path.join(ROOT, 'etc', 'curiosity.json'),

      // Function memory
      functions: path.join(ROOT, 'memory', 'functions'),
      functionsVerified: path.join(ROOT, 'memory', 'functions', 'verified'),
      functionsDrafts: path.join(ROOT, 'memory', 'functions', 'drafts'),

      // Logs
      decisions: path.join(ROOT, 'logs', 'decisions'),
      actions: path.join(ROOT, 'logs', 'actions'),
      sync: path.join(ROOT, 'logs', 'sync'),
    };

    return rootPaths[prop as keyof typeof rootPaths];
  },
});

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function timestamp(): string {
  return new Date().toISOString();
}

export function generateId(prefix: string): string {
  const now = new Date();
  const dateStr = now.toISOString()
    .replace(/[-:T.Z]/g, '')
    .slice(0, 15);
  return `${prefix}-${dateStr}`;
}

/**
 * Path resolution result types
 */
export type PathResolutionSuccess = { ok: true; path: string };
export type PathResolutionError = { ok: false; error: 'anonymous' | 'no_context' | 'invalid_key' };
export type PathResolutionResult = PathResolutionSuccess | PathResolutionError;

/**
 * Attempt to resolve a profile-specific path without throwing
 *
 * This is the safe alternative to directly accessing `paths.*` for API endpoints
 * that need to handle anonymous users gracefully.
 *
 * Returns a discriminated union so you can handle each case explicitly:
 * - `{ ok: true, path: '/path/to/file' }` - Path resolved successfully
 * - `{ ok: false, error: 'anonymous' }` - Anonymous user without profile
 * - `{ ok: false, error: 'no_context' }` - No context at all (should fall back to system paths)
 * - `{ ok: false, error: 'invalid_key' }` - Requested key doesn't exist in paths
 *
 * @example
 * ```typescript
 * // For READ operations - return defaults on failure
 * const result = tryResolveProfilePath('personaCore');
 * if (!result.ok) {
 *   return new Response(JSON.stringify({ default: 'data' }), { status: 200 });
 * }
 * const coreData = fs.readFileSync(result.path, 'utf-8');
 * ```
 *
 * @example
 * ```typescript
 * // For WRITE operations - return 401 on failure
 * const result = tryResolveProfilePath('episodic');
 * if (!result.ok) {
 *   return new Response(
 *     JSON.stringify({ error: 'Authentication required' }),
 *     { status: 401 }
 *   );
 * }
 * fs.writeFileSync(path.join(result.path, 'event.json'), data);
 * ```
 */
export function tryResolveProfilePath(
  key: keyof ReturnType<typeof getProfilePaths>
): PathResolutionResult {
  try {
    const context = getUserContext();

    // Check if this is an anonymous user without a profile
    if (context && context.username === 'anonymous' && !context.activeProfile) {
      return { ok: false, error: 'anonymous' };
    }

    // If we have context (authenticated or anonymous with profile), resolve the path
    if (context && (context.username !== 'anonymous' || context.activeProfile)) {
      const profilePaths = context.profilePaths;
      if (key in profilePaths) {
        return { ok: true, path: profilePaths[key as keyof typeof profilePaths] as string };
      }
      return { ok: false, error: 'invalid_key' };
    }

    // No context = CLI/system operation
    // Return root-level paths for backward compatibility
    const rootPaths = {
      root: ROOT,
      persona: path.join(ROOT, 'persona'),
      memory: path.join(ROOT, 'memory'),
      etc: path.join(ROOT, 'etc'),
      inbox: path.join(ROOT, 'memory', 'inbox'),
      inboxArchive: path.join(ROOT, 'memory', 'inbox', '_archive'),
      logs: path.join(ROOT, 'logs'),
      out: path.join(ROOT, 'out'),
      state: path.join(ROOT, 'state'),
      personaCore: path.join(ROOT, 'persona', 'core.json'),
      personaRelationships: path.join(ROOT, 'persona', 'relationships.json'),
      personaRoutines: path.join(ROOT, 'persona', 'routines.json'),
      personaDecisionRules: path.join(ROOT, 'persona', 'decision-rules.json'),
      personaFacets: path.join(ROOT, 'persona', 'facets.json'),
      personaFacetsDir: path.join(ROOT, 'persona', 'facets'),
      episodic: path.join(ROOT, 'memory', 'episodic'),
      semantic: path.join(ROOT, 'memory', 'semantic'),
      procedural: path.join(ROOT, 'memory', 'procedural'),
      proceduralOvernight: path.join(ROOT, 'memory', 'procedural', 'overnight'),
      preferences: path.join(ROOT, 'memory', 'preferences'),
      tasks: path.join(ROOT, 'memory', 'tasks'),
      indexDir: path.join(ROOT, 'memory', 'index'),
      audioInbox: path.join(ROOT, 'memory', 'audio', 'inbox'),
      audioTranscripts: path.join(ROOT, 'memory', 'audio', 'transcripts'),
      audioArchive: path.join(ROOT, 'memory', 'audio', 'archive'),
      curiosity: path.join(ROOT, 'memory', 'curiosity'),
      curiosityFacts: path.join(ROOT, 'memory', 'curiosity', 'facts'),
      curiosityResearch: path.join(ROOT, 'memory', 'curiosity', 'research'),
      curiosityConfig: path.join(ROOT, 'etc', 'curiosity.json'),
      functions: path.join(ROOT, 'memory', 'functions'),
      functionsVerified: path.join(ROOT, 'memory', 'functions', 'verified'),
      functionsDrafts: path.join(ROOT, 'memory', 'functions', 'drafts'),
      decisions: path.join(ROOT, 'logs', 'decisions'),
      actions: path.join(ROOT, 'logs', 'actions'),
      sync: path.join(ROOT, 'logs', 'sync'),
      voiceTraining: path.join(ROOT, 'out', 'voice-training', 'recordings'),
      voiceDataset: path.join(ROOT, 'out', 'voice-training', 'dataset'),
      voiceConfig: path.join(ROOT, 'etc', 'voice.json'),
      sovitsReference: path.join(ROOT, 'out', 'voices', 'sovits'),
      sovitsModels: path.join(ROOT, 'out', 'voices', 'sovits-models'),
      rvcReference: path.join(ROOT, 'out', 'voices', 'rvc'),
      rvcModels: path.join(ROOT, 'out', 'voices', 'rvc-models'),
    };

    if (key in rootPaths) {
      return { ok: true, path: rootPaths[key as keyof typeof rootPaths] };
    }

    return { ok: false, error: 'invalid_key' };
  } catch (error) {
    // Unexpected error - treat as no context
    return { ok: false, error: 'no_context' };
  }
}

/**
 * Require a profile-specific path or throw a descriptive error
 *
 * Use this for operations that MUST have user context and should fail loudly
 * if called without proper authentication.
 *
 * For API endpoints that should return 401/403 instead of throwing, use
 * `tryResolveProfilePath` instead.
 *
 * @throws {Error} If path cannot be resolved (anonymous user, missing context, etc.)
 *
 * @example
 * ```typescript
 * // For CLI commands that require authentication
 * const episodicPath = requireProfilePath('episodic');
 * const events = fs.readdirSync(episodicPath);
 * ```
 */
export function requireProfilePath(
  key: keyof ReturnType<typeof getProfilePaths>
): string {
  const result = tryResolveProfilePath(key);

  if (!result.ok) {
    switch (result.error) {
      case 'anonymous':
        throw new Error(
          `Access denied: Anonymous users cannot access user data paths. ` +
          `Attempted to access: paths.${key}. ` +
          `Please authenticate or select a public profile to access data.`
        );
      case 'no_context':
        throw new Error(
          `No user context available to resolve path: paths.${key}. ` +
          `This operation requires user context.`
        );
      case 'invalid_key':
        throw new Error(
          `Invalid path key: paths.${key}. ` +
          `This path does not exist in the profile paths schema.`
        );
    }
  }

  return result.path;
}
