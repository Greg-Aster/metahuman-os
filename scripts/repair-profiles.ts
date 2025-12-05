#!/usr/bin/env tsx
/**
 * Repair Profiles Script
 *
 * Ensures every user profile has the required directories/config files.
 * Run this after upgrading or if legacy profiles are missing persona configs.
 *
 * Usage:
 *   pnpm tsx scripts/repair-profiles.ts
 */

import path from 'node:path';
import fs from 'fs-extra';
import { ensureProfileIntegrity } from '../packages/core/src/profile.js';
import { systemPaths } from '../packages/core/src/paths.js';
import { audit } from '../packages/core/src/audit.js';

async function main() {
  const profilesDir = path.join(systemPaths.root, 'profiles');
  if (!(await fs.pathExists(profilesDir))) {
    console.log('No profiles directory found. Nothing to repair.');
    return;
  }

  const entries = await fs.readdir(profilesDir);
  const usernames = entries.filter(name =>
    !name.startsWith('.') &&
    (fs.statSync(path.join(profilesDir, name)).isDirectory())
  );

  console.log(`Found ${usernames.length} profile(s) to inspect...\n`);

  let repaired = 0;
  let failures = 0;

  for (const username of usernames) {
    process.stdout.write(`→ ${username}: `);
    try {
      await ensureProfileIntegrity(username);
      console.log('ok');
      repaired += 1;

      audit({
        level: 'info',
        category: 'system',
        event: 'profile_repaired',
        details: { username },
        actor: 'repair_script',
      });
    } catch (error) {
      console.log(`FAILED (${(error as Error).message})`);
      failures += 1;
    }
  }

  console.log('\nSummary:');
  console.log(`  ✓ Repaired: ${repaired}`);
  if (failures > 0) {
    console.log(`  ⚠️  Failed: ${failures} (check paths/permissions)`);
  } else {
    console.log('  ✓ All profiles verified');
  }
}

main().catch(err => {
  console.error('Repair script crashed:', err);
  process.exit(1);
});
