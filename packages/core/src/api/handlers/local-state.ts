import fs from 'node:fs';
import path from 'node:path';
import type { UnifiedResponse } from '../types.js';
import { systemPaths } from '../../paths.js';

function readJsonState<T>(fileName: string, fallback: T, errorMessage: string): UnifiedResponse {
  try {
    const statePath = path.join(systemPaths.root, 'logs', 'run', fileName);

    if (!fs.existsSync(statePath)) {
      return {
        status: 200,
        data: fallback,
      };
    }

    return {
      status: 200,
      data: JSON.parse(fs.readFileSync(statePath, 'utf-8')),
    };
  } catch (error) {
    return {
      status: 500,
      data: {
        error: error instanceof Error ? error.message : errorMessage,
      },
    };
  }
}

export async function handleGetProfileSyncState(): Promise<UnifiedResponse> {
  return readJsonState(
    'profile-sync-state.json',
    {
      phase: 'idle',
      message: 'No sync in progress',
      profileFiles: 0,
      memoriesImported: 0,
      credentialsSynced: false,
    },
    'Failed to read sync state'
  );
}

export async function handleGetUpdateState(): Promise<UnifiedResponse> {
  return readJsonState(
    'update-state.json',
    {
      updateAvailable: false,
      currentVersion: 'unknown',
      latestVersion: null,
      checkedAt: null,
      reason: 'No update check has been performed yet',
    },
    'Failed to read update state'
  );
}
