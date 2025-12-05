/**
 * Mobile App Version API
 *
 * Returns the latest available mobile app version and download info.
 * Used by mobile app to check for updates.
 */

import type { APIRoute } from 'astro';
import * as fs from 'fs';
import * as path from 'path';
import { systemPaths } from '@metahuman/core';

interface VersionInfo {
  version: string;
  versionCode: number;
  releaseDate: string;
  releaseNotes: string;
  downloadUrl: string;
  fileSize: number;
  checksum?: string;
  minAndroidVersion: number;
}

interface VersionResponse {
  latest: VersionInfo;
  updateAvailable: boolean;
  currentVersion?: string;
}

// Path to mobile releases directory
const RELEASES_DIR = path.join(systemPaths.root, 'apps', 'mobile', 'releases');
const VERSION_FILE = path.join(RELEASES_DIR, 'version.json');

export const GET: APIRoute = async ({ request }) => {
  try {
    const url = new URL(request.url);
    const currentVersion = url.searchParams.get('current');
    const currentVersionCode = parseInt(url.searchParams.get('versionCode') || '0', 10);

    // Check if version.json exists
    if (!fs.existsSync(VERSION_FILE)) {
      // No releases published yet
      return new Response(JSON.stringify({
        error: 'No releases available',
        message: 'No mobile app releases have been published yet.',
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Read version info
    const versionData = JSON.parse(fs.readFileSync(VERSION_FILE, 'utf-8')) as VersionInfo;

    // Check if APK file exists
    const apkPath = path.join(RELEASES_DIR, `metahuman-${versionData.version}.apk`);
    if (!fs.existsSync(apkPath)) {
      return new Response(JSON.stringify({
        error: 'APK not found',
        message: `Release ${versionData.version} APK file is missing.`,
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Get file size
    const stats = fs.statSync(apkPath);
    versionData.fileSize = stats.size;

    // Determine if update is available
    const updateAvailable = currentVersionCode > 0
      ? versionData.versionCode > currentVersionCode
      : false;

    const response: VersionResponse = {
      latest: {
        ...versionData,
        downloadUrl: `/api/mobile/download?version=${versionData.version}`,
      },
      updateAvailable,
      currentVersion: currentVersion || undefined,
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[mobile/version] Error:', e);
    return new Response(JSON.stringify({
      error: e instanceof Error ? e.message : 'Internal server error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
