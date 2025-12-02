/**
 * Curiosity Activity Check Node
 * Checks if enough time has passed since the last curiosity question
 */

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { getProfilePaths } from '../../index.js';

const execute: NodeExecutor = async (_inputs, context, properties) => {
  const username = context.userId;
  const questionInterval = properties?.questionIntervalSeconds || 1800;

  if (!username) {
    return {
      canAsk: false,
      error: 'No username in context'
    };
  }

  try {
    const profilePaths = getProfilePaths(username);
    const auditDir = path.join(profilePaths.logs, 'audit');

    if (!fsSync.existsSync(auditDir)) {
      return { canAsk: true, timeSinceLastQuestion: null };
    }

    const dates = [
      new Date().toISOString().split('T')[0],
      new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    ];

    let mostRecent = 0;

    for (const date of dates) {
      const auditFile = path.join(auditDir, `${date}.ndjson`);
      if (!fsSync.existsSync(auditFile)) continue;

      const content = await fs.readFile(auditFile, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);

      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const entry = JSON.parse(lines[i]);

          if (entry.event === 'chat_assistant' &&
              entry.details?.curiosityQuestionId &&
              entry.timestamp) {
            const timestamp = new Date(entry.timestamp).getTime();
            if (timestamp > mostRecent) {
              mostRecent = timestamp;
            }
          }
        } catch {}
      }
    }

    if (mostRecent === 0) {
      return { canAsk: true, timeSinceLastQuestion: null };
    }

    const timeSinceLastQuestion = (Date.now() - mostRecent) / 1000;
    const canAsk = timeSinceLastQuestion >= questionInterval;

    return {
      canAsk,
      timeSinceLastQuestion,
      questionInterval,
      username
    };
  } catch (error) {
    console.error('[CuriosityActivityCheck] Error:', error);
    return {
      canAsk: false,
      error: (error as Error).message,
      username
    };
  }
};

export const CuriosityActivityCheckNode: NodeDefinition = defineNode({
  id: 'curiosity_activity_check',
  name: 'Curiosity Activity Check',
  category: 'curiosity',
  inputs: [],
  outputs: [
    { name: 'canAsk', type: 'boolean', description: 'True if enough time has passed' },
    { name: 'timeSinceLastQuestion', type: 'number' },
  ],
  properties: {
    questionIntervalSeconds: 1800,
  },
  propertySchemas: {
    questionIntervalSeconds: {
      type: 'number',
      default: 1800,
      label: 'Question Interval (seconds)',
      description: 'Minimum time between questions',
    },
  },
  description: 'Checks if enough time has passed since the last curiosity question',
  execute,
});
