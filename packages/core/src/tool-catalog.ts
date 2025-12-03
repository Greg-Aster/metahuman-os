/**
 * Tool Catalog Builder
 *
 * Generates LLM-friendly documentation from skill manifests.
 * Cached per process with 1-minute TTL for performance.
 */

import { listSkills, type SkillManifest } from './skills.js';

export interface ToolCatalogEntry {
  skill: string;
  description: string;
  inputs: string;
  outputs: string;
  category: string;
  notes: string;
}

// Cache with 1-minute TTL
let catalogCache: { text: string; timestamp: number } | null = null;
const CACHE_TTL_MS = 60000;

/**
 * Format a single skill manifest for LLM consumption
 */
function formatSkillForLLM(manifest: SkillManifest): string {
  const inputDesc = Object.entries(manifest.inputs)
    .map(([name, def]) => `${name}${def.required ? '*' : ''}: ${def.type}`)
    .join(', ');

  const outputDesc = Object.entries(manifest.outputs)
    .map(([name, def]) => `${name}: ${def.type}`)
    .join(', ');

  return `Skill: ${manifest.id}
Description: ${manifest.description}
Inputs: ${inputDesc || 'none'}
Outputs: ${outputDesc || 'generic result'}
Category: ${manifest.category}
Risk: ${manifest.risk} | Cost: ${manifest.cost}
Notes: Requires ${manifest.minTrustLevel} trust level${manifest.requiresApproval ? ' (approval required)' : ''}`;
}

/**
 * Build complete tool catalog from all registered skills
 */
export function buildToolCatalog(): string {
  const skills = listSkills();
  const entries = skills.map(formatSkillForLLM);

  return `# Available Tools

You have access to ${skills.length} skills across these categories:

${entries.join('\n\n---\n\n')}

IMPORTANT: Only use data from tool observations. Never invent or assume outputs.`;
}

/**
 * Get cached catalog (1-minute TTL)
 */
export function getCachedCatalog(): string {
  const now = Date.now();

  if (catalogCache && (now - catalogCache.timestamp) < CACHE_TTL_MS) {
    return catalogCache.text;
  }

  const text = buildToolCatalog();
  catalogCache = { text, timestamp: now };
  return text;
}

/**
 * Force catalog rebuild (for testing/development)
 */
export function invalidateCatalog(): void {
  catalogCache = null;
}

/**
 * Get catalog as structured data (for API/UI consumption)
 */
export function getCatalogEntries(): ToolCatalogEntry[] {
  const skills = listSkills();

  return skills.map(manifest => {
    const inputDesc = Object.entries(manifest.inputs)
      .map(([name, def]) => `${name}${def.required ? '*' : ''}: ${def.type}`)
      .join(', ');

    const outputDesc = Object.entries(manifest.outputs)
      .map(([name, def]) => `${name}: ${def.type}`)
      .join(', ');

    return {
      skill: manifest.id,
      description: manifest.description,
      inputs: inputDesc || 'none',
      outputs: outputDesc || 'generic result',
      category: manifest.category,
      notes: `Requires ${manifest.minTrustLevel} trust level${manifest.requiresApproval ? ' (approval required)' : ''}`
    };
  });
}
