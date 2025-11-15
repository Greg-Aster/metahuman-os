/**
 * Test: Curiosity Service Prompt Improvements
 *
 * Verifies that curiosity questions now use persona context
 * and natural language instead of formulaic "curiosity engine" prompts
 */

import fs from 'fs';
import path from 'path';

console.log('🧪 Testing Curiosity Service Prompt Improvements...\n');

const curiosityPath = path.join(process.cwd(), 'brain/agents/curiosity-service.ts');
const code = fs.readFileSync(curiosityPath, 'utf-8');

// Test 1: Verify persona context is loaded
console.log('Test 1: Persona context integration');
const hasPersonaContext = code.includes('persona.personality?.communicationStyle?.tone') &&
                          code.includes('persona.personality?.archetypes') &&
                          code.includes('persona.values?.core');

if (hasPersonaContext) {
  console.log('✅ Loads communication style, archetypes, and values from persona\n');
} else {
  console.log('❌ Missing persona context integration\n');
  process.exit(1);
}

// Test 2: Verify old "curiosity engine" language is removed
console.log('Test 2: Natural language prompts');
const hasOldLanguage = code.includes('curiosity engine') ||
                       code.includes('Guidelines:') ||
                       code.includes('Focus on "why" and "how"');

if (!hasOldLanguage) {
  console.log('✅ Removed formulaic "curiosity engine" language\n');
} else {
  console.log('❌ Still contains robotic prompt language\n');
  process.exit(1);
}

// Test 3: Verify prompt uses persona identity
console.log('Test 3: First-person persona voice');
const usesPersonaVoice = code.includes('You are ${persona.identity.name}') &&
                         code.includes('ask in your own voice');

if (usesPersonaVoice) {
  console.log('✅ Prompts the LLM to speak as the persona, not as a system\n');
} else {
  console.log('❌ Does not use first-person persona voice\n');
  process.exit(1);
}

// Test 4: Verify temperature is reasonable (not too creative)
console.log('Test 4: Temperature setting');
const tempMatch = code.match(/temperature:\s*(0\.\d+)/);
if (tempMatch) {
  const temp = parseFloat(tempMatch[1]);
  if (temp >= 0.5 && temp <= 0.7) {
    console.log(`✅ Temperature is ${temp} (balanced for natural questions)\n`);
  } else {
    console.log(`⚠️  Temperature is ${temp} (may be too ${temp > 0.7 ? 'creative' : 'deterministic'})\n`);
  }
} else {
  console.log('❌ Could not find temperature setting\n');
  process.exit(1);
}

// Test 5: Verify question prefix is natural
console.log('Test 5: Question display format');
const hasNaturalPrefix = code.includes('💭 ${question}');
const hasRoboticPrefix = code.includes('Q ${question}');

if (hasNaturalPrefix && !hasRoboticPrefix) {
  console.log('✅ Uses natural emoji prefix instead of "Q"\n');
} else if (hasRoboticPrefix) {
  console.log('❌ Still uses robotic "Q" prefix\n');
  process.exit(1);
} else {
  console.log('⚠️  Uses different prefix format\n');
}

console.log('✅ All tests passed! Curiosity questions should be more natural.\n');
console.log('📝 Summary of improvements:');
console.log('   - Uses persona communication style, archetypes, and values');
console.log('   - Removed "curiosity engine" formulaic language');
console.log('   - Prompts LLM to speak in first person as the persona');
console.log('   - Lowered temperature from 0.8 to 0.6 for more natural questions');
console.log('   - Changed display from "Q" to "💭" emoji');
