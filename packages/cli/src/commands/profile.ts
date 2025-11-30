/**
 * Profile Management Commands
 *
 * Commands for managing user profile storage location
 * - mh profile path              - Show current profile path
 * - mh profile path set <path>   - Set new profile location (triggers migration)
 * - mh profile path reset        - Reset to default location
 * - mh profile devices           - List available storage devices
 * - mh profile validate <path>   - Validate a path
 * - mh profile migrate status    - Show migration status
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  getProfilePaths,
  getProfilePathsWithStatus,
  getDefaultProfilePath,
  getUserByUsername,
  audit,
  ROOT,
} from '@metahuman/core';
import { validateProfilePath } from '@metahuman/core/path-security';
import {
  detectStorageDevices,
  formatBytes,
  getStorageInfo,
} from '@metahuman/core/external-storage';
import {
  migrateProfile,
  resetProfileToDefault,
  estimateMigrationDuration,
} from '@metahuman/core/profile-migration';

// Get default user from etc/default-user.txt
function getDefaultUsername(): string {
  const defaultUserFile = path.join(ROOT, 'etc', 'default-user.txt');
  if (fs.existsSync(defaultUserFile)) {
    return fs.readFileSync(defaultUserFile, 'utf-8').trim();
  }
  return 'greggles'; // Fallback
}

/**
 * Show current profile path
 */
export async function profilePath(username?: string): Promise<void> {
  const user = username || getDefaultUsername();

  const { paths: profilePaths, resolution } = getProfilePathsWithStatus(user);
  const defaultPath = getDefaultProfilePath(user);
  const storageInfo = getStorageInfo(profilePaths.root);

  console.log('\nProfile Storage Configuration\n');
  console.log(`  Username:       ${user}`);
  console.log(`  Current Path:   ${profilePaths.root}`);
  console.log(`  Default Path:   ${defaultPath}`);
  console.log(`  Using Custom:   ${resolution.root !== defaultPath ? 'Yes' : 'No'}`);
  console.log(`  Storage Type:   ${resolution.storageType}`);

  if (resolution.usingFallback) {
    console.log(`  ⚠️  Fallback:    ${resolution.fallbackReason}`);
  }

  if (storageInfo) {
    console.log('');
    console.log('  Storage Info:');
    console.log(`    Device ID:    ${storageInfo.id}`);
    console.log(`    Type:         ${storageInfo.type}`);
    console.log(`    Label:        ${storageInfo.label || 'N/A'}`);
    console.log(`    Filesystem:   ${storageInfo.fsType || 'N/A'}`);
    console.log(`    Free Space:   ${formatBytes(storageInfo.freeSpace)}`);
    console.log(`    Total Space:  ${formatBytes(storageInfo.totalSpace)}`);
    console.log(`    Writable:     ${storageInfo.writable ? 'Yes' : 'No'}`);
  }

  console.log('');
  console.log('Commands:');
  console.log('  mh profile path set <path>   Set new profile location');
  console.log('  mh profile path reset        Reset to default location');
  console.log('  mh profile devices           List available storage devices');
  console.log('  mh profile validate <path>   Validate a path');
  console.log('');
}

/**
 * Set new profile path (with migration)
 */
export async function profilePathSet(
  newPath: string,
  username?: string,
  options: { keepSource?: boolean } = {}
): Promise<void> {
  const user = username || getDefaultUsername();
  const { keepSource = true } = options;

  console.log('\nProfile Migration\n');
  console.log(`  Username:     ${user}`);
  console.log(`  Destination:  ${newPath}`);
  console.log(`  Keep Source:  ${keepSource ? 'Yes' : 'No'}`);
  console.log('');

  // Validate the new path
  console.log('Validating destination...');
  const validation = validateProfilePath(newPath, { checkExists: true });

  if (!validation.valid) {
    console.error('\n❌ Path validation failed:');
    for (const error of validation.errors) {
      console.error(`   - ${error}`);
    }
    process.exit(1);
  }

  if (validation.warnings.length > 0) {
    console.log('\n⚠️  Warnings:');
    for (const warning of validation.warnings) {
      console.log(`   - ${warning}`);
    }
  }

  console.log('✓ Path validated\n');

  // Get user ID
  const userRecord = getUserByUsername(user);
  if (!userRecord) {
    console.error(`❌ User '${user}' not found`);
    process.exit(1);
  }

  // Estimate migration
  const currentPaths = getProfilePaths(user);
  try {
    const estimate = await estimateMigrationDuration(currentPaths.root);
    console.log(`Estimated migration:`);
    console.log(`  Files:    ${estimate.files}`);
    console.log(`  Size:     ${formatBytes(estimate.bytes)}`);
    console.log(`  Duration: ~${estimate.estimatedSeconds}s`);
    console.log('');
  } catch {
    // Estimation failed, continue anyway
  }

  // Run migration with progress output
  console.log('Starting migration...\n');

  for await (const progress of migrateProfile(
    userRecord.id,
    user,
    newPath,
    { keepSource, validateIntegrity: true }
  )) {
    const statusIcon =
      progress.status === 'completed' ? '✓' :
      progress.status === 'failed' ? '✗' :
      progress.status === 'skipped' ? '○' :
      '→';

    let line = `  ${statusIcon} ${progress.message}`;

    if (progress.progress !== undefined) {
      line += ` (${progress.progress}%)`;
    }

    console.log(line);

    if (progress.error) {
      console.error(`    Error: ${progress.error}`);
    }
  }

  console.log('\n✓ Migration complete!\n');
  console.log(`Profile is now stored at: ${newPath}`);
  console.log('');
}

/**
 * Reset profile to default location
 */
export async function profilePathReset(username?: string): Promise<void> {
  const user = username || getDefaultUsername();

  const userRecord = getUserByUsername(user);
  if (!userRecord) {
    console.error(`❌ User '${user}' not found`);
    process.exit(1);
  }

  const defaultPath = getDefaultProfilePath(user);

  console.log('\nResetting Profile Location\n');
  console.log(`  Username:       ${user}`);
  console.log(`  Default Path:   ${defaultPath}`);
  console.log('');

  await resetProfileToDefault(userRecord.id, user);

  console.log('✓ Profile reset to default location\n');
  console.log('Note: Files at the custom location were NOT deleted.');
  console.log('You may need to manually copy files back or remove them.');
  console.log('');
}

/**
 * List available storage devices
 */
export async function profileDevices(): Promise<void> {
  console.log('\nAvailable Storage Devices\n');

  const devices = await detectStorageDevices();

  if (devices.length === 0) {
    console.log('No writable storage devices found.');
    console.log('');
    return;
  }

  const defaultUser = getDefaultUsername();

  for (const device of devices) {
    const typeIcon =
      device.type === 'usb' ? '🔌' :
      device.type === 'network' ? '🌐' :
      device.type === 'encrypted' ? '🔒' :
      '💾';

    console.log(`${typeIcon} ${device.label || device.path}`);
    console.log(`   Path:       ${device.path}`);
    console.log(`   Type:       ${device.type}`);
    console.log(`   Filesystem: ${device.fsType || 'N/A'}`);
    console.log(`   Free Space: ${formatBytes(device.freeSpace)}`);
    console.log(`   Writable:   ${device.writable ? 'Yes' : 'No'}`);
    console.log(`   Suggested:  ${device.path}/metahuman-profiles/${defaultUser}`);
    console.log('');
  }

  console.log(`Found ${devices.length} device(s)`);
  console.log('');
  console.log('To use a device, run:');
  console.log('  mh profile path set <suggested-path>');
  console.log('');
}

/**
 * Validate a path for profile storage
 */
export async function profileValidate(testPath: string): Promise<void> {
  console.log('\nPath Validation\n');
  console.log(`  Path: ${testPath}`);
  console.log('');

  const validation = validateProfilePath(testPath);

  if (validation.valid) {
    console.log('✓ Path is valid for profile storage\n');
  } else {
    console.log('❌ Path is NOT valid\n');
    console.log('Errors:');
    for (const error of validation.errors) {
      console.log(`  - ${error}`);
    }
  }

  if (validation.warnings.length > 0) {
    console.log('\nWarnings:');
    for (const warning of validation.warnings) {
      console.log(`  - ${warning}`);
    }
  }

  console.log(`\nResolved Path: ${validation.resolvedPath}`);

  // Show storage info if available
  if (validation.valid) {
    const storageInfo = getStorageInfo(validation.resolvedPath);
    if (storageInfo) {
      console.log('\nStorage Info:');
      console.log(`  Type:       ${storageInfo.type}`);
      console.log(`  Free Space: ${formatBytes(storageInfo.freeSpace)}`);
      console.log(`  Writable:   ${storageInfo.writable ? 'Yes' : 'No'}`);
    }
  }

  console.log('');
}

/**
 * Main profile command handler
 */
export function profileCommand(args: string[]): void {
  const subcommand = args[0] || 'path';
  const rest = args.slice(1);

  switch (subcommand) {
    case 'path':
      handlePathCommand(rest);
      break;

    case 'devices':
      profileDevices();
      break;

    case 'validate':
      if (!rest[0]) {
        console.error('Usage: mh profile validate <path>');
        process.exit(1);
      }
      profileValidate(rest[0]);
      break;

    case 'migrate':
      if (rest[0] === 'status') {
        // Show current migration status
        profilePath();
      } else {
        console.error('Usage: mh profile migrate status');
      }
      break;

    case 'help':
    default:
      showHelp();
      break;
  }
}

function handlePathCommand(args: string[]): void {
  const subsubcommand = args[0];

  switch (subsubcommand) {
    case 'set':
      if (!args[1]) {
        console.error('Usage: mh profile path set <path>');
        process.exit(1);
      }
      profilePathSet(args[1], undefined, { keepSource: !args.includes('--delete-source') });
      break;

    case 'reset':
      profilePathReset();
      break;

    default:
      profilePath();
      break;
  }
}

function showHelp(): void {
  console.log(`
Profile Management Commands

Usage: mh profile <command> [options]

Commands:
  path                    Show current profile path configuration
  path set <path>         Set new profile location (triggers migration)
  path reset              Reset to default location
  devices                 List available storage devices
  validate <path>         Validate a path for profile storage
  migrate status          Show migration status

Options:
  --delete-source         Delete source files after migration (use with 'path set')

Examples:
  mh profile path
  mh profile path set /media/usb-drive/metahuman/greggles
  mh profile path reset
  mh profile devices
  mh profile validate /mnt/external/profiles
`);
}
