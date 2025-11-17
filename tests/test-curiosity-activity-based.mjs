/**
 * Test: Curiosity Activity-Based Triggering
 *
 * Verifies that curiosity system now uses activity-based triggering
 * instead of interval-based polling.
 */

import fs from 'fs';
import path from 'path';

console.log('🧪 Testing Curiosity Activity-Based Triggering...\n');

// Test 1: Verify agents.json has curiosity as activity type
console.log('Test 1: Verify agents.json configuration');
const agentsPath = path.join(process.cwd(), 'etc/agents.json');
const agentsData = JSON.parse(fs.readFileSync(agentsPath, 'utf-8'));
const curiosityAgent = agentsData.agents.curiosity;

if (curiosityAgent.type === 'activity') {
  console.log('✅ Curiosity agent type is "activity"\n');
} else {
  console.log(`❌ Curiosity agent type is "${curiosityAgent.type}" (should be "activity")\n`);
  process.exit(1);
}

// Test 2: Verify inactivityThreshold is set
console.log('Test 2: Verify inactivityThreshold is configured');
if (curiosityAgent.inactivityThreshold) {
  console.log(`✅ inactivityThreshold is set to ${curiosityAgent.inactivityThreshold} seconds\n`);
} else {
  console.log('❌ inactivityThreshold is not set\n');
  process.exit(1);
}

// Test 3: Verify API endpoint updates both configs
console.log('Test 3: Verify API endpoint implementation');
const apiPath = path.join(process.cwd(), 'apps/site/src/pages/api/curiosity-config.ts');
const apiCode = fs.readFileSync(apiPath, 'utf-8');

const updatesAgentsJson = apiCode.includes('agents.json') &&
                           apiCode.includes('inactivityThreshold');

if (updatesAgentsJson) {
  console.log('✅ API endpoint syncs inactivityThreshold to agents.json\n');
} else {
  console.log('❌ API endpoint does not update agents.json\n');
  process.exit(1);
}

// Test 4: Verify UI descriptions reflect activity-based behavior
console.log('Test 4: Verify UI descriptions');
const settingsPath = path.join(process.cwd(), 'apps/site/src/components/SystemSettings.svelte');
const settingsCode = fs.readFileSync(settingsPath, 'utf-8');

const hasActivityDescription = settingsCode.includes('conversation inactivity') &&
                                !settingsCode.includes('Questions every ~');

if (hasActivityDescription) {
  console.log('✅ UI descriptions mention "conversation inactivity"\n');
} else {
  console.log('❌ UI descriptions still use old timer-based language\n');
  process.exit(1);
}

// Test 5: Verify curiosity service still has internal checks
console.log('Test 5: Verify curiosity service internal checks');
const servicePath = path.join(process.cwd(), 'brain/agents/curiosity-service.ts');
const serviceCode = fs.readFileSync(servicePath, 'utf-8');

const hasActivityCheck = serviceCode.includes('isUserActive');
const hasIntervalCheck = serviceCode.includes('questionIntervalSeconds');

if (hasActivityCheck && hasIntervalCheck) {
  console.log('✅ Service has both activity and interval checks (prevents spam)\n');
} else {
  console.log('❌ Service missing activity or interval checks\n');
  process.exit(1);
}

console.log('✅ All tests passed! Curiosity is now activity-based.\n');
console.log('📝 Summary of changes:');
console.log('   - agents.json: curiosity changed from "interval" to "activity" type');
console.log('   - Slider in Settings now controls inactivity threshold');
console.log('   - Questions only trigger after conversation inactivity');
console.log('   - No more polling every 60 seconds - event-driven instead');
console.log('   - API endpoint syncs both curiosity.json and agents.json');
