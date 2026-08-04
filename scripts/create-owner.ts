#!/usr/bin/env tsx
/**
 * Create Owner User Script
 *
 * One-time setup script to create the first owner user for MetaHuman OS.
 * This is a temporary solution until CLI user management is implemented.
 *
 * Usage:
 *   MH_OWNER_PASSWORD='<password>' npx tsx scripts/create-owner.ts \
 *     --username=<username> --display-name='<name>' [--email=<email>]
 */

import { createUser, deleteUser } from '../packages/core/src/users.js';
import { initializeProfile } from '../packages/core/src/profile.js';
import { generateRecoveryCodes, saveRecoveryCodes } from '../packages/core/src/recovery-codes.js';

const valueFor = (name: string): string | undefined =>
  process.argv.find(arg => arg.startsWith(`${name}=`))?.slice(name.length + 1)

const username = valueFor('--username')
const password = process.env.MH_OWNER_PASSWORD
const displayName = valueFor('--display-name')
const email = valueFor('--email')

async function main() {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║       MetaHuman OS - Create Owner User                    ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');

  // Validate input
  if (!username?.trim()) {
    console.error('❌ Error: Pass --username=<username>');
    process.exit(1);
  }

  if (!password) {
    console.error('❌ Error: Set MH_OWNER_PASSWORD in the command environment');
    process.exit(1);
  }

  if (password.length < 4) {
    console.error('⚠️  Warning: Password is very short (less than 4 characters)');
    console.error('   For production, use a strong password (12+ characters)');
    console.error('');
  }

  console.log('Creating owner user with:');
  console.log(`  Username:     ${username}`);
  console.log(`  Display Name: ${displayName || '(none)'}`);
  console.log(`  Email:        ${email || '(none)'}`);
  console.log(`  Role:         owner`);
  console.log('');

  try {
    const user = createUser(username, password, 'owner', {
      displayName: displayName || undefined,
      email: email || undefined,
    });

    try {
      await initializeProfile(username);
    } catch (profileError) {
      deleteUser(user.id);
      throw new Error(`Profile initialization failed: ${(profileError as Error).message}`);
    }

    // Generate recovery codes
    const recoveryCodes = generateRecoveryCodes();
    const recoveryFile = saveRecoveryCodes(user.username, recoveryCodes);

    console.log('✅ Owner user created successfully!');
    console.log('');
    console.log('User Details:');
    console.log(`  ID:           ${user.id}`);
    console.log(`  Username:     ${user.username}`);
    console.log(`  Role:         ${user.role}`);
    console.log(`  Display Name: ${user.metadata?.displayName || '(none)'}`);
    console.log(`  Email:        ${user.metadata?.email || '(none)'}`);
    console.log(`  Created:      ${user.createdAt}`);
    console.log('');
    console.log('User file saved to:');
    console.log(`  persona/users.json`);
    console.log('');
    console.log('🔑 RECOVERY CODES (Save these in a safe place!):');
    console.log('═'.repeat(50));
    console.log('Use these codes to reset your password if you forget it.');
    console.log('Each code can only be used once.');
    console.log('');
    recoveryCodes.forEach((code, index) => {
      console.log(`  ${(index + 1).toString().padStart(2, ' ')}. ${code}`);
    });
    console.log('');
    console.log(`Recovery codes saved to: ${recoveryFile}`);
    console.log('⚠️  Store these codes in a password manager or print them!');
    console.log('');
    console.log('Next Steps:');
    console.log('  1. Start the dev server: pnpm dev');
    console.log('  2. Navigate to: http://localhost:4321');
    console.log('  3. Click persona name/icon in header');
    console.log('  4. Click "Login"');
    console.log(`  5. Enter username: ${user.username}`);
    console.log('  6. Enter your password');
    console.log('');
    console.log('Password Recovery:');
    console.log(`  If you forget your password, use: mh user reset-password ${user.username}`);
    console.log('  Or use a recovery code in the web UI (future feature)');
    console.log('');
    console.log('🎉 You\'re all set!');
    console.log('');

  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('already exists')) {
        console.log('⚠️  User already exists!');
        console.log('');
        console.log('Options:');
        console.log('  1. Use a different username (edit scripts/create-owner.ts)');
        console.log(`  2. Delete existing user: rm memory/users/${username}.json`);
        console.log('  3. Try to login with existing credentials');
        console.log('');
        process.exit(1);
      } else if (error.message.includes('Invalid username')) {
        console.error('❌ Invalid username');
        console.error('   Username must:');
        console.error('   - Be 3-50 characters long');
        console.error('   - Contain only letters, numbers, underscore, hyphen');
        console.error('   - Not contain spaces');
        console.error('');
        process.exit(1);
      } else {
        console.error('❌ Failed to create user:');
        console.error(`   ${error.message}`);
        console.error('');
        process.exit(1);
      }
    } else {
      console.error('❌ Unknown error occurred');
      console.error(error);
      process.exit(1);
    }
  }
}

main();
