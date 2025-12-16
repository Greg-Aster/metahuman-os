#!/usr/bin/env node
/**
 * Postinstall script for MetaHuman OS monorepo
 *
 * Creates necessary symlinks that pnpm doesn't create automatically.
 * React Native + pnpm monorepo requires some packages to be accessible
 * in the app's node_modules even though they're hoisted to root.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

// React Native packages that need symlinks in app's node_modules
// These are transitive deps that Gradle expects to find locally
const reactNativeSymlinks = [
  '@react-native/codegen',
  '@react-native/gradle-plugin',
];

function ensureSymlink(target, linkPath) {
  // Check if target exists
  if (!fs.existsSync(target)) {
    console.log(`  ⚠ Target not found: ${target}`);
    return false;
  }

  // Remove existing link/file if it exists
  try {
    const stats = fs.lstatSync(linkPath);
    // Path exists (either file, dir, or symlink)
    fs.unlinkSync(linkPath);
  } catch (e) {
    // Path doesn't exist, which is fine
  }

  // Create parent directory if needed
  const parentDir = path.dirname(linkPath);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  // Create relative symlink
  const relativeTarget = path.relative(parentDir, target);
  fs.symlinkSync(relativeTarget, linkPath);
  console.log(`  ✓ ${path.basename(linkPath)} -> ${relativeTarget}`);
  return true;
}

function setupReactNativeSymlinks() {
  const rnAppDir = path.join(rootDir, 'apps/react-native');
  const rnNodeModules = path.join(rnAppDir, 'node_modules/@react-native');
  const rootNodeModules = path.join(rootDir, 'node_modules/@react-native');

  // Check if React Native app exists
  if (!fs.existsSync(rnAppDir)) {
    console.log('React Native app not found, skipping symlinks');
    return;
  }

  // Check if root has @react-native packages
  if (!fs.existsSync(rootNodeModules)) {
    console.log('Root @react-native packages not found, skipping');
    return;
  }

  console.log('Setting up React Native symlinks...');

  // Ensure the @react-native directory exists in app's node_modules
  if (!fs.existsSync(rnNodeModules)) {
    fs.mkdirSync(rnNodeModules, { recursive: true });
  }

  for (const pkg of reactNativeSymlinks) {
    const pkgName = pkg.replace('@react-native/', '');
    const target = path.join(rootNodeModules, pkgName);
    const linkPath = path.join(rnNodeModules, pkgName);
    ensureSymlink(target, linkPath);
  }
}

function setupAgentRuntimeSymlink() {
  const target = path.join(rootDir, 'packages/agent-runtime');
  const linkDir = path.join(rootDir, 'node_modules/@metahuman');
  const linkPath = path.join(linkDir, 'agent-runtime');

  // Check if agent-runtime package exists
  if (!fs.existsSync(target)) {
    console.log('agent-runtime package not found, skipping');
    return;
  }

  // Check if symlink already exists and is valid
  if (fs.existsSync(linkPath)) {
    try {
      const stats = fs.lstatSync(linkPath);
      if (stats.isSymbolicLink()) {
        const resolvedPath = fs.realpathSync(linkPath);
        if (resolvedPath === target) {
          // Symlink already correct
          return;
        }
      }
    } catch (e) {
      // If we can't read it, recreate it
    }
  }

  console.log('Setting up agent-runtime symlink...');
  ensureSymlink(target, linkPath);
}

// Run setup
console.log('MetaHuman postinstall: Setting up monorepo symlinks\n');
setupReactNativeSymlinks();
setupAgentRuntimeSymlink();
console.log('\nPostinstall complete!');
