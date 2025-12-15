/**
 * Agent Loader
 *
 * Dynamically discovers and loads agents from the brain/agents directory.
 * Supports both new (directory with index.ts) and legacy (single .ts file) agent formats.
 */

import fs from 'node:fs';
import path from 'node:path';
import { registerAgent, hasAgent } from './registry.js';
import type { AgentModule, AgentMeta } from './types.js';

/**
 * Check if a path is a new-style agent directory (has index.ts)
 */
function isAgentDirectory(agentPath: string): boolean {
  if (!fs.statSync(agentPath).isDirectory()) {
    return false;
  }
  const indexPath = path.join(agentPath, 'index.ts');
  return fs.existsSync(indexPath);
}

/**
 * Load a single agent module from a directory
 */
async function loadAgentFromDirectory(agentDir: string): Promise<AgentModule | null> {
  const indexPath = path.join(agentDir, 'index.ts');

  try {
    const module = await import(indexPath);

    // Agent can export as default or as named exports
    if (module.default && module.default.meta && module.default.run) {
      return module.default as AgentModule;
    }

    if (module.meta && module.run) {
      return { meta: module.meta, run: module.run } as AgentModule;
    }

    console.warn(`[agent-loader] Invalid agent module in ${agentDir}: missing meta or run`);
    return null;
  } catch (error) {
    console.error(`[agent-loader] Failed to load agent from ${agentDir}:`, error);
    return null;
  }
}

/**
 * Discover all new-style agent directories
 */
export function discoverAgentDirectories(agentsDir: string): string[] {
  if (!fs.existsSync(agentsDir)) {
    return [];
  }

  const entries = fs.readdirSync(agentsDir, { withFileTypes: true });
  const agentDirs: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const dirPath = path.join(agentsDir, entry.name);
      if (isAgentDirectory(dirPath)) {
        agentDirs.push(dirPath);
      }
    }
  }

  return agentDirs;
}

/**
 * Load and register all agents from a directory
 */
export async function loadAgents(agentsDir: string): Promise<void> {
  const agentDirs = discoverAgentDirectories(agentsDir);

  console.log(`[agent-loader] Found ${agentDirs.length} agent directories`);

  for (const agentDir of agentDirs) {
    const agent = await loadAgentFromDirectory(agentDir);
    if (agent) {
      registerAgent(agent);
    }
  }
}

/**
 * Load a specific agent by ID
 * First checks if already registered, then tries to load from disk
 */
export async function loadAgent(agentId: string, agentsDir: string): Promise<AgentModule | null> {
  // Check if already registered
  if (hasAgent(agentId)) {
    const { getAgent } = await import('./registry.js');
    return getAgent(agentId) || null;
  }

  // Try to load from directory
  const agentDir = path.join(agentsDir, agentId);
  if (isAgentDirectory(agentDir)) {
    const agent = await loadAgentFromDirectory(agentDir);
    if (agent) {
      registerAgent(agent);
      return agent;
    }
  }

  return null;
}

/**
 * Get list of available agent IDs from disk (without loading)
 */
export function getAvailableAgentIds(agentsDir: string): string[] {
  const agentDirs = discoverAgentDirectories(agentsDir);
  return agentDirs.map(dir => path.basename(dir));
}
