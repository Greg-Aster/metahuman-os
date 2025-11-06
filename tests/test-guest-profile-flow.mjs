#!/usr/bin/env node
/**
 * Test: Guest Profile Selection Flow
 *
 * Tests the complete flow from anonymous session creation to profile selection
 * and verifies security boundaries are enforced.
 */

import fetch from 'node-fetch';
import fs from 'fs-extra';
import path from 'path';

const BASE_URL = 'http://localhost:4321';
const COLORS = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(color, icon, message) {
  console.log(`${color}${icon}${COLORS.reset} ${message}`);
}

function logSection(title) {
  console.log(`\n${COLORS.cyan}${'='.repeat(60)}${COLORS.reset}`);
  console.log(`${COLORS.cyan}${title}${COLORS.reset}`);
  console.log(`${COLORS.cyan}${'='.repeat(60)}${COLORS.reset}\n`);
}

async function test() {
  let passed = 0;
  let failed = 0;

  try {
    logSection('Guest Profile Selection Flow Test');

    // ========================================
    // TEST 1: Set greggles profile to public
    // ========================================
    logSection('Test 1: Set Owner Profile to Public');

    // First login as owner
    log(COLORS.blue, '→', 'Logging in as owner (greggles)...');
    const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'greggles', password: 'password' }),
    });

    const loginData = await loginRes.json();
    if (!loginData.success) {
      log(COLORS.red, '✗', `Login failed: ${loginData.error}`);
      failed++;
    } else {
      log(COLORS.green, '✓', 'Login successful');
      passed++;
    }

    const sessionCookie = loginRes.headers.get('set-cookie');
    const sessionId = sessionCookie?.match(/mh_session=([^;]+)/)?.[1];

    if (!sessionId) {
      log(COLORS.red, '✗', 'No session cookie received');
      failed++;
      throw new Error('Cannot proceed without session');
    }

    log(COLORS.blue, '→', 'Setting profile visibility to public...');
    const visibilityRes = await fetch(`${BASE_URL}/api/profiles/visibility`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `mh_session=${sessionId}`,
      },
      body: JSON.stringify({ visibility: 'public' }),
    });

    const visibilityData = await visibilityRes.json();
    if (!visibilityData.success) {
      log(COLORS.red, '✗', `Failed to set visibility: ${visibilityData.error}`);
      failed++;
    } else {
      log(COLORS.green, '✓', 'Profile set to public');
      passed++;
    }

    // ========================================
    // TEST 2: Create anonymous guest session
    // ========================================
    logSection('Test 2: Create Anonymous Guest Session');

    log(COLORS.blue, '→', 'Creating anonymous session...');
    const guestRes = await fetch(`${BASE_URL}/api/auth/guest`, {
      method: 'POST',
    });

    const guestData = await guestRes.json();
    if (!guestData.success) {
      log(COLORS.red, '✗', `Guest session failed: ${guestData.error}`);
      failed++;
    } else {
      log(COLORS.green, '✓', 'Anonymous session created');
      log(COLORS.blue, 'ℹ', `Session ID: ${guestData.session.id.substring(0, 8)}...`);
      log(COLORS.blue, 'ℹ', `Role: ${guestData.session.role}`);
      log(COLORS.blue, 'ℹ', `Expires: ${new Date(guestData.session.expiresAt).toLocaleString()}`);
      passed++;
    }

    const guestSessionCookie = guestRes.headers.get('set-cookie');
    const guestSessionId = guestSessionCookie?.match(/mh_session=([^;]+)/)?.[1];

    if (!guestSessionId) {
      log(COLORS.red, '✗', 'No guest session cookie received');
      failed++;
      throw new Error('Cannot proceed without guest session');
    }

    // ========================================
    // TEST 3: List visible profiles (anonymous)
    // ========================================
    logSection('Test 3: List Visible Profiles as Anonymous User');

    log(COLORS.blue, '→', 'Fetching visible profiles...');
    const profilesRes = await fetch(`${BASE_URL}/api/profiles/list`, {
      headers: { 'Cookie': `mh_session=${guestSessionId}` },
    });

    const profilesData = await profilesRes.json();
    if (!profilesData.success) {
      log(COLORS.red, '✗', `Failed to list profiles: ${profilesData.error}`);
      failed++;
    } else {
      log(COLORS.green, '✓', `Found ${profilesData.profiles.length} public profile(s)`);
      profilesData.profiles.forEach(p => {
        log(COLORS.blue, '  •', `${p.username} (${p.displayName}) - ${p.visibility}`);
      });

      // Verify only public profiles are shown
      const allPublic = profilesData.profiles.every(p => p.visibility === 'public');
      if (allPublic) {
        log(COLORS.green, '✓', 'All listed profiles are public');
        passed++;
      } else {
        log(COLORS.red, '✗', 'Private profiles leaked to anonymous user!');
        failed++;
      }
      passed++;
    }

    // ========================================
    // TEST 4: Select a public profile
    // ========================================
    logSection('Test 4: Select Public Profile');

    log(COLORS.blue, '→', 'Selecting greggles profile...');
    const selectRes = await fetch(`${BASE_URL}/api/profiles/select`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `mh_session=${guestSessionId}`,
      },
      body: JSON.stringify({ username: 'greggles' }),
    });

    const selectData = await selectRes.json();
    if (!selectData.success) {
      log(COLORS.red, '✗', `Profile selection failed: ${selectData.error}`);
      failed++;
    } else {
      log(COLORS.green, '✓', `Selected profile: ${selectData.profile}`);
      passed++;
    }

    // ========================================
    // TEST 5: Verify security boundaries
    // ========================================
    logSection('Test 5: Verify Security Boundaries');

    // Try to select a private profile (should fail)
    log(COLORS.blue, '→', 'Attempting to select private profile...');
    const privateRes = await fetch(`${BASE_URL}/api/profiles/select`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `mh_session=${guestSessionId}`,
      },
      body: JSON.stringify({ username: 'test' }), // test is private
    });

    const privateData = await privateRes.json();
    if (privateData.success) {
      log(COLORS.red, '✗', 'SECURITY VIOLATION: Guest can select private profiles!');
      failed++;
    } else {
      log(COLORS.green, '✓', `Private profile blocked: ${privateData.error}`);
      passed++;
    }

    // Verify guest cannot change profile visibility
    log(COLORS.blue, '→', 'Attempting to change visibility as guest...');
    const guestVisRes = await fetch(`${BASE_URL}/api/profiles/visibility`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `mh_session=${guestSessionId}`,
      },
      body: JSON.stringify({ visibility: 'private' }),
    });

    const guestVisData = await guestVisRes.json();
    if (guestVisData.success) {
      log(COLORS.red, '✗', 'SECURITY VIOLATION: Guest can change profile visibility!');
      failed++;
    } else {
      log(COLORS.green, '✓', `Visibility change blocked: ${guestVisData.error}`);
      passed++;
    }

    // ========================================
    // TEST 6: Reset owner profile to private
    // ========================================
    logSection('Test 6: Reset to Private');

    log(COLORS.blue, '→', 'Resetting greggles profile to private...');
    const resetRes = await fetch(`${BASE_URL}/api/profiles/visibility`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `mh_session=${sessionId}`,
      },
      body: JSON.stringify({ visibility: 'private' }),
    });

    const resetData = await resetRes.json();
    if (!resetData.success) {
      log(COLORS.yellow, '⚠', `Failed to reset visibility: ${resetData.error}`);
    } else {
      log(COLORS.green, '✓', 'Profile reset to private');
      passed++;
    }

    // ========================================
    // SUMMARY
    // ========================================
    logSection('Test Summary');

    const total = passed + failed;
    const percentage = ((passed / total) * 100).toFixed(1);

    console.log(`Total Tests: ${total}`);
    log(COLORS.green, '✓', `Passed: ${passed}`);
    log(COLORS.red, '✗', `Failed: ${failed}`);
    console.log(`Success Rate: ${percentage}%\n`);

    if (failed === 0) {
      log(COLORS.green, '🎉', 'All tests passed!');
      process.exit(0);
    } else {
      log(COLORS.red, '❌', 'Some tests failed');
      process.exit(1);
    }

  } catch (error) {
    log(COLORS.red, '💥', `Test suite crashed: ${error.message}`);
    console.error(error);
    process.exit(1);
  }
}

// Run tests
test();
