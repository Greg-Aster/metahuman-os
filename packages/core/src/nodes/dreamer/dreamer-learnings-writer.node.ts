/**
 * Dreamer Learnings Writer Node
 * Writes overnight learnings to procedural memory as markdown file
 */

import fs from 'node:fs';
import path from 'node:path';
import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { audit } from '../../audit.js';
import { getProfilePaths } from '../../paths.js';

interface Memory {
  id: string;
}

const execute: NodeExecutor = async (inputs, context) => {
  const learnings = inputs[0] || {};
  const memoriesInput = inputs[1]?.memories || inputs[0]?.memories || [];
  const memories = Array.isArray(memoriesInput) ? memoriesInput : [];
  const username = context.userId || context.username;

  const preferences = learnings.preferences || [];
  const heuristics = learnings.heuristics || [];
  const styleNotes = learnings.styleNotes || [];
  const avoidances = learnings.avoidances || [];

  if (preferences.length === 0 && heuristics.length === 0 && styleNotes.length === 0 && avoidances.length === 0) {
    return {
      written: false,
      error: 'No learnings to write',
    };
  }

  try {
    if (!username) {
      return {
        written: false,
        error: 'No username provided',
      };
    }
    const profilePaths = getProfilePaths(username);
    const proceduralDir = path.join(profilePaths.root, 'memory', 'procedural', 'overnight');

    fs.mkdirSync(proceduralDir, { recursive: true });

    const date = new Date().toISOString().split('T')[0];
    const filename = `overnight-learnings-${date.replace(/-/g, '')}.md`;
    const filepath = path.join(proceduralDir, filename);
    const memoryCitations = memories.map((m: Memory) => m.id).filter(Boolean);

    const content = `# Overnight Learnings — ${date}

Generated from ${memoryCitations.length} recent memories during the nightly sleep cycle.

## Preferences
${preferences.length > 0 ? preferences.map((p: string) => `- ${p}`).join('\n') : '- None extracted'}

## Decision Heuristics
${heuristics.length > 0 ? heuristics.map((h: string) => `- ${h}`).join('\n') : '- None extracted'}

## Writing Style Notes
${styleNotes.length > 0 ? styleNotes.map((s: string) => `- ${s}`).join('\n') : '- None extracted'}

## Avoidances
${avoidances.length > 0 ? avoidances.map((a: string) => `- ${a}`).join('\n') : '- None extracted'}

## Citations
${memoryCitations.map((id: string) => `- ${id}`).join('\n') || '- No citations'}

---
*This file is generated automatically by the dreamer agent during the nightly sleep cycle.*
*It is used by the morning-loader agent to compose the daily operator profile.*
`;

    fs.writeFileSync(filepath, content, 'utf-8');

    audit({
      level: 'info',
      category: 'data',
      event: 'overnight_learnings_written',
      details: {
        date,
        filepath,
        preferencesCount: preferences.length,
        heuristicsCount: heuristics.length,
        styleNotesCount: styleNotes.length,
        avoidancesCount: avoidances.length,
        citations: memoryCitations.length,
        username,
      },
      actor: 'dreamer',
    });

    return {
      written: true,
      filepath,
      filename,
      date,
      username,
    };
  } catch (error) {
    console.error('[DreamerLearningsWriter] Error:', error);
    return {
      written: false,
      error: (error as Error).message,
    };
  }
};

export const DreamerLearningsWriterNode: NodeDefinition = defineNode({
  id: 'dreamer_learnings_writer',
  name: 'Dreamer Learnings Writer',
  category: 'dreamer',
  inputs: [
    { name: 'learningsData', type: 'object', description: 'Learnings from extractor' },
    { name: 'memoriesData', type: 'object', optional: true, description: 'Source memories' },
  ],
  outputs: [
    { name: 'written', type: 'boolean' },
    { name: 'filepath', type: 'string' },
  ],
  properties: {},
  propertySchemas: {},
  description: 'Writes overnight learnings to procedural memory as markdown',
  execute,
});
