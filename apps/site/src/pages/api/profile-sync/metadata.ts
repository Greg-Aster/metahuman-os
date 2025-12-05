/**
 * Profile Sync - Metadata API
 *
 * Returns essential profile information for mobile sync.
 * Excludes training data, logs, and heavy assets.
 */

import type { APIRoute } from 'astro';
import { getAuthenticatedUser, getProfilePaths } from '@metahuman/core';
import fs from 'fs';
import path from 'path';

export const GET: APIRoute = async ({ cookies }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    const profilePaths = getProfilePaths(user.username);

    // Load persona core for name
    let name = user.username;
    let personaKeys: string[] = [];

    try {
      const corePath = profilePaths.personaCore;
      if (fs.existsSync(corePath)) {
        const core = JSON.parse(fs.readFileSync(corePath, 'utf-8'));
        name = core.name || user.username;
        personaKeys.push('core');
      }

      // Check for other persona files
      const personaDir = profilePaths.persona;
      if (fs.existsSync(personaDir)) {
        const files = fs.readdirSync(personaDir);
        for (const file of files) {
          if (file.endsWith('.json') && file !== 'core.json') {
            personaKeys.push(file.replace('.json', ''));
          }
        }
      }
    } catch {
      // Use defaults
    }

    // Count memories (lightweight - just count files)
    let memoryCount = 0;
    try {
      const episodicDir = profilePaths.episodic;
      if (fs.existsSync(episodicDir)) {
        const countFiles = (dir: string): number => {
          let count = 0;
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory()) {
              count += countFiles(path.join(dir, entry.name));
            } else if (entry.name.endsWith('.json')) {
              count++;
            }
          }
          return count;
        };
        memoryCount = countFiles(episodicDir);
      }
    } catch {
      // Leave as 0
    }

    // Get profile creation date from persona core
    let createdAt = new Date().toISOString();
    try {
      const corePath = profilePaths.personaCore;
      if (fs.existsSync(corePath)) {
        const stats = fs.statSync(corePath);
        createdAt = stats.birthtime.toISOString();
      }
    } catch {
      // Use now
    }

    const metadata = {
      profileId: user.username,
      name,
      username: user.username,
      createdAt,
      updatedAt: new Date().toISOString(),
      version: 1,
      memoryCount,
      personaKeys,
      // Indicate what's available for sync (not training/logs)
      syncableData: {
        persona: true,
        memories: true,
        tasks: true,
        settings: true,
      },
      // Indicate what stays server-only
      serverOnly: {
        training: true,
        voiceData: true,
        auditLogs: true,
        vectorIndex: true,
        loraAdapters: true,
      },
    };

    return new Response(JSON.stringify(metadata), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    if ((error as any)?.message?.includes('Authentication required')) {
      return new Response(JSON.stringify({ error: 'Authentication required' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    console.error('[profile-sync/metadata] Error:', error);
    return new Response(JSON.stringify({ error: 'Failed to get profile metadata' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
