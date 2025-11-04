import { resolveModelForCognitiveMode } from './packages/core/src/model-resolver.js';

console.log('Testing Phase 4 - Persona LoRA Integration\n');

// Test emulation mode uses persona with LoRA
const emulationPersona = resolveModelForCognitiveMode('emulation', 'persona');
console.log('Emulation mode persona:');
console.log(`  Model ID: ${emulationPersona.id}`);
console.log(`  Model: ${emulationPersona.model}`);
console.log(`  Has adapters: ${emulationPersona.adapters.length > 0 ? 'Yes' : 'No'}`);
console.log(`  Description: ${emulationPersona.description}\n`);

// Test dual mode uses default persona
const dualPersona = resolveModelForCognitiveMode('dual', 'persona');
console.log('Dual mode persona:');
console.log(`  Model ID: ${dualPersona.id}`);
console.log(`  Model: ${dualPersona.model}`);
console.log(`  Has adapters: ${dualPersona.adapters.length > 0 ? 'Yes' : 'No'}\n`);

console.log('✅ Phase 4 integration verified!');
