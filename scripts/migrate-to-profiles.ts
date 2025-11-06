#!/usr/bin/env tsx
/**
 * Migration Script: Single-User to Multi-User Profiles
 *
 * This script migrates existing MetaHuman OS data from the single-user
 * root-level structure to the new multi-user profile system.
 *
 * WHAT IT DOES:
 * - Creates profiles/{username}/ directory structure
 * - Moves memory/, persona/, logs/, out/ to user profile
 * - Moves config files to profiles/{username}/etc/
 * - Preserves critical root files (persona/users.json, logs/run/)
 * - Creates backup before migration
 *
 * WHAT IT PRESERVES AT ROOT:
 * - brain/ (system code - agents, skills, policies)
 * - packages/ (system code - core libraries)
 * - apps/ (system code - web UI)
 * - bin/ (system code - CLI wrapper)
 * - persona/users.json (authentication database)
 * - logs/run/ (system PIDs, locks, sessions)
 * - .env (system configuration)
 *
 * USAGE:
 * pnpm tsx scripts/migrate-to-profiles.ts --username greggles
 *
 * WARNING: This script makes major filesystem changes. Always backup first!
 */

import fs from 'fs-extra';
import path from 'node:path';
import { findRepoRoot } from '../packages/core/src/paths.js';

interface MigrationOptions {
  username: string;
  dryRun?: boolean;
  backup?: boolean;
}

async function migrate(options: MigrationOptions) {
  const { username, dryRun = false, backup = true } = options;
  const ROOT = findRepoRoot();

  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  MetaHuman OS: Multi-User Profile Migration               ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log();
  console.log(`Target username: ${username}`);
  console.log(`Root directory: ${ROOT}`);
  console.log(`Dry run: ${dryRun ? 'YES (no changes will be made)' : 'NO'}`);
  console.log(`Backup: ${backup ? 'YES' : 'NO'}`);
  console.log();

  // 1. Validate preconditions
  console.log('📋 Step 1: Validating preconditions...');

  const profileDir = path.join(ROOT, 'profiles', username);
  if (fs.existsSync(profileDir)) {
    console.error(`❌ Error: Profile directory already exists: ${profileDir}`);
    console.error('   Migration appears to have already been run.');
    process.exit(1);
  }

  const requiredDirs = ['memory', 'persona'];
  for (const dir of requiredDirs) {
    if (!fs.existsSync(path.join(ROOT, dir))) {
      console.error(`❌ Error: Required directory not found: ${dir}/`);
      console.error('   This may not be a valid MetaHuman OS installation.');
      process.exit(1);
    }
  }

  console.log('   ✅ Preconditions validated');
  console.log();

  // 2. Create backup
  if (backup && !dryRun) {
    console.log('💾 Step 2: Creating backup...');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupDir = path.join(ROOT, 'backups', `pre-migration-${timestamp}`);

    await fs.ensureDir(backupDir);

    const dirsToBackup = ['memory', 'persona', 'logs', 'out', 'etc'];
    for (const dir of dirsToBackup) {
      const srcPath = path.join(ROOT, dir);
      if (fs.existsSync(srcPath)) {
        const destPath = path.join(backupDir, dir);
        await fs.copy(srcPath, destPath);
        console.log(`   📦 Backed up ${dir}/`);
      }
    }

    console.log(`   ✅ Backup created at: ${backupDir}`);
    console.log();
  } else {
    console.log('💾 Step 2: Skipping backup (disabled or dry run)');
    console.log();
  }

  // 3. Create profile directory structure
  console.log('📁 Step 3: Creating profile directory structure...');

  const dirsToCreate = [
    profileDir,
    path.join(profileDir, 'memory'),
    path.join(profileDir, 'memory', 'episodic'),
    path.join(profileDir, 'memory', 'semantic'),
    path.join(profileDir, 'memory', 'procedural'),
    path.join(profileDir, 'memory', 'procedural', 'overnight'),
    path.join(profileDir, 'memory', 'preferences'),
    path.join(profileDir, 'memory', 'tasks'),
    path.join(profileDir, 'memory', 'tasks', 'active'),
    path.join(profileDir, 'memory', 'tasks', 'completed'),
    path.join(profileDir, 'memory', 'tasks', 'projects'),
    path.join(profileDir, 'memory', 'index'),
    path.join(profileDir, 'memory', 'inbox'),
    path.join(profileDir, 'memory', 'inbox', '_archive'),
    path.join(profileDir, 'memory', 'audio'),
    path.join(profileDir, 'memory', 'audio', 'inbox'),
    path.join(profileDir, 'memory', 'audio', 'transcripts'),
    path.join(profileDir, 'memory', 'audio', 'archive'),
    path.join(profileDir, 'persona'),
    path.join(profileDir, 'persona', 'facets'),
    path.join(profileDir, 'logs'),
    path.join(profileDir, 'logs', 'decisions'),
    path.join(profileDir, 'logs', 'actions'),
    path.join(profileDir, 'logs', 'sync'),
    path.join(profileDir, 'out'),
    path.join(profileDir, 'out', 'adapters'),
    path.join(profileDir, 'out', 'datasets'),
    path.join(profileDir, 'out', 'state'),
    path.join(profileDir, 'etc'),
  ];

  if (!dryRun) {
    for (const dir of dirsToCreate) {
      await fs.ensureDir(dir);
    }
  }

  console.log(`   ✅ Created ${dirsToCreate.length} directories`);
  console.log();

  // 4. Move config files FIRST (before moving persona directory)
  console.log('⚙️  Step 4: Moving configuration files...');

  const configFiles = [
    { src: 'persona/cognitive-mode.json', dest: 'cognitive-mode.json' },
    { src: 'etc/models.json', dest: 'models.json' },
    { src: 'etc/training.json', dest: 'training.json' },
    { src: 'etc/boredom.json', dest: 'boredom.json' },
    { src: 'etc/sleep.json', dest: 'sleep.json' },
    { src: 'etc/audio.json', dest: 'audio.json' },
    { src: 'etc/ingestor.json', dest: 'ingestor.json' },
    { src: 'etc/autonomy.json', dest: 'autonomy.json' },
  ];

  const etcDir = path.join(profileDir, 'etc');
  for (const { src, dest } of configFiles) {
    const srcPath = path.join(ROOT, src);
    const destPath = path.join(etcDir, dest);

    if (fs.existsSync(srcPath)) {
      if (!dryRun) {
        await fs.copy(srcPath, destPath);
        await fs.remove(srcPath);
      }
      console.log(`   📄 Moved ${src} → profiles/${username}/etc/${dest}`);
    } else {
      console.log(`   ⏭️  Skipped ${src} (not found)`);
    }
  }

  console.log('   ✅ Configuration files moved');
  console.log();

  // 5. Move persona files (EXCEPT users.json which stays at root for auth)
  console.log('👤 Step 5: Moving persona files...');

  const personaSrcDir = path.join(ROOT, 'persona');
  const personaDestDir = path.join(profileDir, 'persona');

  if (fs.existsSync(personaSrcDir)) {
    const personaFiles = fs.readdirSync(personaSrcDir);

    for (const file of personaFiles) {
      // CRITICAL: Skip users.json - it must stay at root for authentication
      if (file === 'users.json') {
        console.log(`   🔒 Preserving persona/users.json at root (required for auth)`);
        continue;
      }

      const srcPath = path.join(personaSrcDir, file);
      const destPath = path.join(personaDestDir, file);

      if (fs.statSync(srcPath).isDirectory()) {
        // Copy directory recursively
        if (!dryRun) {
          await fs.copy(srcPath, destPath);
          await fs.remove(srcPath);
        }
        console.log(`   📁 Moved persona/${file}/ → profiles/${username}/persona/${file}/`);
      } else {
        // Copy file
        if (!dryRun) {
          await fs.copy(srcPath, destPath);
          await fs.remove(srcPath);
        }
        console.log(`   📄 Moved persona/${file} → profiles/${username}/persona/${file}`);
      }
    }
  }

  console.log('   ✅ Persona files moved (users.json preserved at root)');
  console.log();

  // 6. Move memory directory
  console.log('🧠 Step 6: Moving memory directory...');

  const memorySrcDir = path.join(ROOT, 'memory');
  const memoryDestDir = path.join(profileDir, 'memory');

  if (fs.existsSync(memorySrcDir)) {
    const memoryEntries = fs.readdirSync(memorySrcDir);

    for (const entry of memoryEntries) {
      const srcPath = path.join(memorySrcDir, entry);
      const destPath = path.join(memoryDestDir, entry);

      if (!dryRun) {
        await fs.copy(srcPath, destPath);
        await fs.remove(srcPath);
      }

      const isDir = fs.statSync(srcPath).isDirectory();
      console.log(`   ${isDir ? '📁' : '📄'} Moved memory/${entry} → profiles/${username}/memory/${entry}`);
    }
  }

  console.log('   ✅ Memory directory moved');
  console.log();

  // 7. Move user-specific logs (EXCEPT logs/run/ which stays at root for system)
  console.log('📜 Step 7: Moving user-specific logs...');

  const logsSrcDir = path.join(ROOT, 'logs');
  const logsDestDir = path.join(profileDir, 'logs');

  if (fs.existsSync(logsSrcDir)) {
    const logEntries = fs.readdirSync(logsSrcDir);

    for (const dir of logEntries) {
      // CRITICAL: Skip logs/run/ - it contains system PIDs, locks, sessions
      if (dir === 'run') {
        console.log(`   🔒 Preserving logs/run/ at root (contains system PIDs/locks)`);
        continue;
      }

      const srcPath = path.join(logsSrcDir, dir);
      const destPath = path.join(logsDestDir, dir);

      if (fs.statSync(srcPath).isDirectory()) {
        if (!dryRun) {
          await fs.copy(srcPath, destPath);
          await fs.remove(srcPath);
        }
        console.log(`   📁 Moved logs/${dir}/ → profiles/${username}/logs/${dir}/`);
      } else {
        // Move log files directly in logs/
        if (!dryRun) {
          await fs.copy(srcPath, destPath);
          await fs.remove(srcPath);
        }
        console.log(`   📄 Moved logs/${dir} → profiles/${username}/logs/${dir}`);
      }
    }
  }

  console.log('   ✅ User-specific logs moved (logs/run/ preserved at root)');
  console.log();

  // 8. Move out/ directory
  console.log('📦 Step 8: Moving out/ directory...');

  const outSrcDir = path.join(ROOT, 'out');
  const outDestDir = path.join(profileDir, 'out');

  if (fs.existsSync(outSrcDir)) {
    const outEntries = fs.readdirSync(outSrcDir);

    for (const entry of outEntries) {
      const srcPath = path.join(outSrcDir, entry);
      const destPath = path.join(outDestDir, entry);

      if (!dryRun) {
        await fs.copy(srcPath, destPath);
        await fs.remove(srcPath);
      }

      const isDir = fs.statSync(srcPath).isDirectory();
      console.log(`   ${isDir ? '📁' : '📄'} Moved out/${entry} → profiles/${username}/out/${entry}`);
    }
  }

  console.log('   ✅ Out directory moved');
  console.log();

  // 9. Summary
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  Migration Complete!                                       ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log();
  console.log('📊 Summary:');
  console.log(`   • Profile created: profiles/${username}/`);
  console.log(`   • Memory, persona, logs, out moved to profile`);
  console.log(`   • Config files moved to profiles/${username}/etc/`);
  console.log();
  console.log('🔒 Preserved at root:');
  console.log('   • brain/ (system code)');
  console.log('   • packages/ (system code)');
  console.log('   • apps/ (system code)');
  console.log('   • bin/ (system code)');
  console.log('   • persona/users.json (authentication database)');
  console.log('   • logs/run/ (system PIDs, locks, sessions)');
  console.log('   • .env (system configuration)');
  console.log();
  console.log('✅ Next steps:');
  console.log('   1. Review the migrated profile directory');
  console.log('   2. Test the system with: ./bin/mh status');
  console.log('   3. Verify memory access works correctly');
  console.log('   4. If issues occur, restore from backup directory');
  console.log();
}

// Parse command-line arguments
const args = process.argv.slice(2);
const options: Partial<MigrationOptions> = {};

for (let i = 0; i < args.length; i++) {
  const arg = args[i];

  if (arg === '--username' && args[i + 1]) {
    options.username = args[i + 1];
    i++;
  } else if (arg === '--dry-run') {
    options.dryRun = true;
  } else if (arg === '--no-backup') {
    options.backup = false;
  } else if (arg === '--help' || arg === '-h') {
    console.log(`
Usage: pnpm tsx scripts/migrate-to-profiles.ts --username <username> [options]

Options:
  --username <name>   Username for the first profile (required)
  --dry-run          Preview changes without making them
  --no-backup        Skip backup creation (not recommended)
  --help, -h         Show this help message

Examples:
  # Standard migration with backup
  pnpm tsx scripts/migrate-to-profiles.ts --username greggles

  # Preview without making changes
  pnpm tsx scripts/migrate-to-profiles.ts --username greggles --dry-run

  # Skip backup (dangerous!)
  pnpm tsx scripts/migrate-to-profiles.ts --username greggles --no-backup
`);
    process.exit(0);
  }
}

// Validate required options
if (!options.username) {
  console.error('❌ Error: --username is required');
  console.error('Usage: pnpm tsx scripts/migrate-to-profiles.ts --username <username>');
  console.error('Run with --help for more information');
  process.exit(1);
}

// Run migration
migrate(options as MigrationOptions).catch((error) => {
  console.error('❌ Migration failed:', error);
  process.exit(1);
});
