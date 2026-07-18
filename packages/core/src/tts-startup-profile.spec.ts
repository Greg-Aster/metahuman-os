import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './paths.js';

const read = (relative: string) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

const launcher = read('bin/start-voice-server');
const profileCommand = read('packages/cli/src/commands/profile.ts');

assert.ok(
  launcher.includes('profile path --voice-config "$PROFILE"'),
  'voice startup must obtain the profile voice config from the canonical profile CLI',
);
assert.ok(
  !launcher.includes('profiles/$PROFILE/etc/voice.json'),
  'voice startup must not reconstruct a repo-local profile path',
);
assert.ok(
  launcher.includes('if ! RESOLVED_VOICE_CONFIG=')
    && launcher.includes('Failed to resolve voice configuration for profile'),
  'profile resolution failure must stop startup instead of silently selecting global Piper',
);
assert.ok(
  profileCommand.includes("case '--voice-config':")
    && profileCommand.includes('getProfilePaths(user).voiceConfig'),
  'the machine-readable CLI option must delegate to the maintained core profile resolver',
);
assert.ok(
  profileCommand.includes('process.exit(0)')
    && profileCommand.includes('process.exit(1)'),
  'the machine-readable CLI option must return one bounded result with an explicit status',
);

console.log('tts-startup-profile.spec.ts passed');
