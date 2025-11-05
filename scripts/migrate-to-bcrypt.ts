#!/usr/bin/env tsx
/**
 * Password Hash Migration Script
 *
 * IMPORTANT: After upgrading to bcrypt, existing SHA-256 password hashes
 * will no longer work. Users must recreate their accounts.
 *
 * This script simply removes the old users file so you can run
 * scripts/create-owner.ts with the new bcrypt hashing.
 */

import fs from 'fs';
import path from 'path';

const USERS_FILE = path.join(process.cwd(), 'persona', 'users.json');

console.log('');
console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║       Password Hash Migration - SHA-256 → bcrypt          ║');
console.log('╚════════════════════════════════════════════════════════════╝');
console.log('');
console.log('⚠️  WARNING: This will DELETE your existing user accounts!');
console.log('');
console.log('The password hashing has been upgraded from SHA-256 to bcrypt');
console.log('for security. Existing password hashes cannot be migrated.');
console.log('');
console.log('After running this script, you must recreate all users with:');
console.log('  npx tsx scripts/create-owner.ts');
console.log('');

if (!fs.existsSync(USERS_FILE)) {
  console.log('✓ No existing users file found. Nothing to migrate.');
  console.log('  You can create a new user with: npx tsx scripts/create-owner.ts');
  process.exit(0);
}

// Create backup
const backupFile = `${USERS_FILE}.sha256-backup-${Date.now()}`;
fs.copyFileSync(USERS_FILE, backupFile);
console.log(`✓ Backed up existing users to: ${path.basename(backupFile)}`);

// Remove old file
fs.unlinkSync(USERS_FILE);
console.log('✓ Removed old users file');
console.log('');
console.log('Migration complete! Now create your user account:');
console.log('  npx tsx scripts/create-owner.ts');
console.log('');
