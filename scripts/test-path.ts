// Test: path-builder should now auto-load users.ts via dynamic require
import { getProfilePathsWithStatus } from '../packages/core/src/path-builder.js';

const username = process.argv[2] || 'greggles';
console.log(`Testing path resolution for user: ${username}\n`);

try {
  const pathsWithStatus = getProfilePathsWithStatus(username);
  console.log('Resolution:');
  console.log('  root:', pathsWithStatus.paths.root);
  console.log('  voiceConfig:', pathsWithStatus.paths.voiceConfig);
  console.log('  storageType:', pathsWithStatus.resolution.storageType);
  console.log('  usingFallback:', pathsWithStatus.resolution.usingFallback);
  if (pathsWithStatus.resolution.fallbackReason) {
    console.log('  fallbackReason:', pathsWithStatus.resolution.fallbackReason);
  }
} catch (error) {
  console.error('Error:', (error as Error).message);
}
