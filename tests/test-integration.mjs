/**
 * Integration Test: Multi-Model Router
 * Tests that the role-based routing system is properly integrated
 */

import { callLLM, detectSpecialistType } from './packages/core/src/index.js';

console.log('=== Multi-Model Integration Test ===\n');

// Test 1: Specialist Detection
console.log('Test 1: Specialist Type Detection');
const tests = [
  { input: 'write code to parse JSON', expected: 'coder' },
  { input: 'create a roadmap for the project', expected: 'planner' },
  { input: 'summarize this document', expected: 'summarizer' },
  { input: 'curate training data from memories', expected: 'curator' },
];

let passed = 0;
for (const test of tests) {
  const detected = detectSpecialistType(test.input);
  const match = detected === test.expected;
  console.log(`  ${match ? '✓' : '✗'} "${test.input}" → ${detected || 'null'} (expected: ${test.expected})`);
  if (match) passed++;
}
console.log(`  Result: ${passed}/${tests.length} passed\n`);

// Test 2: Model Registry Access
console.log('Test 2: Model Registry Loading');
try {
  const { loadModelRegistry } = await import('./packages/core/src/model-resolver.js');
  const registry = loadModelRegistry();
  console.log(`  ✓ Loaded ${Object.keys(registry.models).length} models`);
  console.log(`  ✓ Default roles: ${Object.keys(registry.defaults).join(', ')}`);
  console.log(`  ✓ Cognitive modes: ${Object.keys(registry.cognitiveModeMappings).join(', ')}\n`);
} catch (error) {
  console.error(`  ✗ Failed to load model registry: ${error.message}\n`);
}

// Test 3: Role Resolution
console.log('Test 3: Role Resolution');
try {
  const { resolveModel } = await import('./packages/core/src/model-resolver.js');
  const orchestrator = resolveModel('orchestrator');
  const persona = resolveModel('persona');
  const coder = resolveModel('coder');

  console.log(`  ✓ Orchestrator: ${orchestrator.model} (${orchestrator.provider})`);
  console.log(`  ✓ Persona: ${persona.model} (${persona.provider})`);
  console.log(`  ✓ Coder: ${coder.model} (${coder.provider})\n`);
} catch (error) {
  console.error(`  ✗ Role resolution failed: ${error.message}\n`);
}

// Test 4: Cognitive Mode Mappings
console.log('Test 4: Cognitive Mode Mappings');
try {
  const { resolveModelForCognitiveMode } = await import('./packages/core/src/model-resolver.js');
  const dualOrchestrator = resolveModelForCognitiveMode('dual', 'orchestrator');
  const dualPersona = resolveModelForCognitiveMode('dual', 'persona');
  const emulationPersona = resolveModelForCognitiveMode('emulation', 'persona');

  console.log(`  ✓ Dual mode orchestrator: ${dualOrchestrator.model}`);
  console.log(`  ✓ Dual mode persona: ${dualPersona.model}`);
  console.log(`  ✓ Emulation mode persona: ${emulationPersona.model}\n`);
} catch (error) {
  console.error(`  ✗ Cognitive mode mapping failed: ${error.message}\n`);
}

console.log('=== Integration Test Complete ===');
console.log('Note: LLM calls not tested (requires Ollama running)');
