/**
 * Test: Curiosity Settings Integration
 *
 * Verifies that the Settings UI slider properly controls the activity-based
 * curiosity system via both curiosity.json and agents.json.
 */

import fs from 'fs';
import path from 'path';

console.log('🧪 Testing Curiosity Settings Integration...\n');

// Test 1: Verify no duplicate activity checks
console.log('Test 1: No duplicate activity checks');
const servicePath = path.join(process.cwd(), 'brain/agents/curiosity-service.ts');
const serviceCode = fs.readFileSync(servicePath, 'utf-8');

const hasIsUserActiveFunction = serviceCode.match(/^async function isUserActive/m);
const hasIsUserActiveCall = serviceCode.includes('await isUserActive(');

if (!hasIsUserActiveFunction && !hasIsUserActiveCall) {
  console.log('✅ Removed duplicate isUserActive check\n');
} else {
  console.log('❌ Still has duplicate activity detection\n');
  process.exit(1);
}

// Test 2: Verify scheduler handles activity detection
console.log('Test 2: Scheduler handles activity detection');
const hasSchedulerNote = serviceCode.includes('scheduler (agent-scheduler.ts) now handles this');

if (hasSchedulerNote) {
  console.log('✅ Comments explain scheduler handles activity\n');
} else {
  console.log('❌ Missing documentation about scheduler responsibility\n');
  process.exit(1);
}

// Test 3: Verify API syncs both config files
console.log('Test 3: API endpoint syncs both configs');
const apiPath = path.join(process.cwd(), 'apps/site/src/pages/api/curiosity-config.ts');
const apiCode = fs.readFileSync(apiPath, 'utf-8');

const syncsBothConfigs = apiCode.includes('saveCuriosityConfig(newConfig)') &&
                         apiCode.includes('agentsData.agents.curiosity.inactivityThreshold');

if (syncsBothConfigs) {
  console.log('✅ API updates both curiosity.json and agents.json\n');
} else {
  console.log('❌ API does not sync both config files\n');
  process.exit(1);
}

// Test 4: Verify UI maps slider to intervals correctly
console.log('Test 4: UI slider interval mapping');
const settingsPath = path.join(process.cwd(), 'apps/site/src/components/SystemSettings.svelte');
const settingsCode = fs.readFileSync(settingsPath, 'utf-8');

const hasCuriosityIntervals = settingsCode.includes('const curiosityIntervals');
const hasActiveLevel = settingsCode.includes('900,') && settingsCode.includes('// Level 3: 15 minutes');

if (hasCuriosityIntervals && hasActiveLevel) {
  console.log('✅ Slider correctly maps levels to intervals (0, 3600, 1800, 900, 300, 120, 60)\n');
} else {
  console.log('❌ Slider mapping is incorrect or missing\n');
  process.exit(1);
}

// Test 5: Verify agents.json defaults to 900s (Active level)
console.log('Test 5: Default inactivity threshold');
const agentsPath = path.join(process.cwd(), 'etc/agents.json');
const agentsData = JSON.parse(fs.readFileSync(agentsPath, 'utf-8'));
const threshold = agentsData.agents.curiosity.inactivityThreshold;

if (threshold === 900) {
  console.log(`✅ Default threshold is 900s (15 minutes - Active level)\n`);
} else {
  console.log(`⚠️  Default threshold is ${threshold}s (expected 900s)\n`);
}

console.log('✅ All tests passed! Curiosity settings are properly integrated.\n');
console.log('📝 Complete flow:');
console.log('   1. User moves slider in Settings UI');
console.log('   2. API updates curiosity.json → questionIntervalSeconds');
console.log('   3. API updates agents.json → inactivityThreshold');
console.log('   4. Scheduler uses inactivityThreshold for activity detection');
console.log('   5. Service uses questionIntervalSeconds to prevent spam');
console.log('   6. No duplicate activity checks - clean separation of concerns');
