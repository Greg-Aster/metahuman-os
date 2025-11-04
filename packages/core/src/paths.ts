import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

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

export const paths = {
  root: ROOT,
  persona: path.join(ROOT, 'persona'),
  memory: path.join(ROOT, 'memory'),
  etc: path.join(ROOT, 'etc'),
  // Ingest inbox for raw files to be processed into memories
  inbox: path.join(ROOT, 'memory', 'inbox'),
  inboxArchive: path.join(ROOT, 'memory', 'inbox', '_archive'),
  brain: path.join(ROOT, 'brain'),
  logs: path.join(ROOT, 'logs'),
  out: path.join(ROOT, 'out'),
  run: path.join(ROOT, 'logs', 'run'),
  runAgents: path.join(ROOT, 'logs', 'run', 'agents'),

  // Persona files
  personaCore: path.join(ROOT, 'persona', 'core.json'),
  personaRelationships: path.join(ROOT, 'persona', 'relationships.json'),
  personaRoutines: path.join(ROOT, 'persona', 'routines.json'),
  personaDecisionRules: path.join(ROOT, 'persona', 'decision-rules.json'),

  // Memory directories
  episodic: path.join(ROOT, 'memory', 'episodic'),
  semantic: path.join(ROOT, 'memory', 'semantic'),
  procedural: path.join(ROOT, 'memory', 'procedural'),
  proceduralOvernight: path.join(ROOT, 'memory', 'procedural', 'overnight'),
  preferences: path.join(ROOT, 'memory', 'preferences'),
  tasks: path.join(ROOT, 'memory', 'tasks'),
  indexDir: path.join(ROOT, 'memory', 'index'),
  // Audio ingestion
  audioInbox: path.join(ROOT, 'memory', 'audio', 'inbox'),
  audioTranscripts: path.join(ROOT, 'memory', 'audio', 'transcripts'),
  audioArchive: path.join(ROOT, 'memory', 'audio', 'archive'),

  // Brain directories
  agents: path.join(ROOT, 'brain', 'agents'),
  skills: path.join(ROOT, 'brain', 'skills'),
  policies: path.join(ROOT, 'brain', 'policies'),

  // Logs
  decisions: path.join(ROOT, 'logs', 'decisions'),
  actions: path.join(ROOT, 'logs', 'actions'),
  sync: path.join(ROOT, 'logs', 'sync'),
};

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
