/**
 * Training Dataset Stats API Handler
 *
 * GET statistics about available training data.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { getProfilePaths } from '../../path-builder.js';

interface DatasetStats {
  totalMemories: number;
  episodicMemories: number;
  therapySessions: number;
  chatConversations: number;
  recentMemories: number; // Last 30 days
  oldestMemory: string | null;
  newestMemory: string | null;
  cognitiveModeCounts: {
    dual: number;
    agent: number;
    emulation: number;
  };
  estimatedTrainingSamples: number;
}

/**
 * GET /api/training/dataset-stats - Get training dataset statistics
 */
export async function handleGetTrainingDatasetStats(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const { user } = req;

    if (!user.isAuthenticated) {
      return { status: 401, error: 'Authentication required' };
    }

    const profilePaths = getProfilePaths(user.username);

    const stats: DatasetStats = {
      totalMemories: 0,
      episodicMemories: 0,
      therapySessions: 0,
      chatConversations: 0,
      recentMemories: 0,
      oldestMemory: null,
      newestMemory: null,
      cognitiveModeCounts: {
        dual: 0,
        agent: 0,
        emulation: 0,
      },
      estimatedTrainingSamples: 0,
    };

    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

    // 1. Count episodic memories
    const episodicPath = path.join(profilePaths.root, 'memory', 'episodic');
    if (existsSync(episodicPath)) {
      const years = readdirSync(episodicPath).filter(name => /^\d{4}$/.test(name));

      for (const year of years) {
        const yearPath = path.join(episodicPath, year);
        if (!statSync(yearPath).isDirectory()) continue;

        const files = readdirSync(yearPath).filter(f => f.endsWith('.json'));

        for (const file of files) {
          try {
            const content = readFileSync(path.join(yearPath, file), 'utf-8');
            const memory = JSON.parse(content);

            stats.episodicMemories++;

            // Track cognitive mode
            const mode = memory.metadata?.cognitiveMode || 'emulation';
            if (mode in stats.cognitiveModeCounts) {
              stats.cognitiveModeCounts[mode as keyof typeof stats.cognitiveModeCounts]++;
            }

            // Track timestamps
            const timestamp = new Date(memory.timestamp).getTime();
            if (!stats.oldestMemory || timestamp < new Date(stats.oldestMemory).getTime()) {
              stats.oldestMemory = memory.timestamp;
            }
            if (!stats.newestMemory || timestamp > new Date(stats.newestMemory).getTime()) {
              stats.newestMemory = memory.timestamp;
            }

            // Count recent memories
            if (timestamp > thirtyDaysAgo) {
              stats.recentMemories++;
            }
          } catch {
            // Skip invalid files
          }
        }
      }
    }

    // 2. Count therapy sessions
    const therapyPath = path.join(profilePaths.persona, 'therapy');
    if (existsSync(therapyPath)) {
      const files = readdirSync(therapyPath).filter(
        f => f.startsWith('session-') && f.endsWith('.json')
      );
      stats.therapySessions = files.length;
    }

    // 3. Count chat conversations (JSONL files in training directory)
    const trainingPath = path.join(profilePaths.root, 'memory', 'training');
    if (existsSync(trainingPath)) {
      function countConversationsRecursive(dir: string): number {
        let count = 0;
        const files = readdirSync(dir);

        for (const file of files) {
          const filePath = path.join(dir, file);
          const stat = statSync(filePath);

          if (stat.isDirectory()) {
            count += countConversationsRecursive(filePath);
          } else if (file.endsWith('.jsonl')) {
            // Count lines in JSONL file
            try {
              const content = readFileSync(filePath, 'utf-8');
              const lines = content.trim().split('\n').filter(l => l.trim());
              count += lines.length;
            } catch {
              // Skip invalid files
            }
          }
        }

        return count;
      }

      stats.chatConversations = countConversationsRecursive(trainingPath);
    }

    // Calculate total and estimated samples
    stats.totalMemories = stats.episodicMemories + stats.therapySessions + stats.chatConversations;

    // Rough estimate: Each memory/conversation can generate 1-3 training samples
    // Conservative estimate: 1.5 samples per memory
    stats.estimatedTrainingSamples = Math.floor(stats.totalMemories * 1.5);

    return successResponse(stats);
  } catch (error) {
    console.error('[training-dataset-stats] GET failed:', error);
    return { status: 500, error: (error as Error).message };
  }
}
