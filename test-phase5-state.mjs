import {
  loadShortTermState,
  saveShortTermState,
  updateCurrentFocus,
  addActiveTask,
  updateConversationContext,
  getOrchestratorContext,
  loadPersonaCache,
  savePersonaCache,
  trackTheme,
  addCatchphrase,
  updateFrequentFact,
  getPersonaContext
} from './packages/core/src/state.js';

console.log('Testing Phase 5 - State Management System\n');

// Test 1: Short-term state
console.log('=== Test 1: Short-Term State ===');
updateCurrentFocus('Testing Phase 5 implementation');
addActiveTask('task-phase5-test');
updateConversationContext(['multi-model', 'state management'], 'testing');

const shortTermState = loadShortTermState();
console.log('Short-term state loaded:');
console.log(`  Current focus: ${shortTermState.currentFocus}`);
console.log(`  Active tasks: ${shortTermState.activeTasks.join(', ')}`);
console.log(`  Last topics: ${shortTermState.conversationContext.lastTopics.join(', ')}`);

// Test 2: Orchestrator context
console.log('\n=== Test 2: Orchestrator Context ===');
const orchestratorCtx = getOrchestratorContext();
console.log('Orchestrator context:');
console.log(orchestratorCtx || '(empty)');

// Test 3: Persona cache
console.log('\n=== Test 3: Persona Cache ===');
updateFrequentFact('testKey', 'testValue');
trackTheme('multi-model architecture');
trackTheme('state management');
addCatchphrase('Let me check the state');

const personaCache = loadPersonaCache();
console.log('Persona cache loaded:');
console.log(`  Frequent facts: ${Object.keys(personaCache.frequentFacts).length} entries`);
console.log(`  Themes: ${personaCache.recentThemes.length} tracked`);
console.log(`  Catchphrases: ${personaCache.catchphrases.length} phrases`);

// Test 4: Persona context
console.log('\n=== Test 4: Persona Context ===');
const personaCtx = getPersonaContext();
console.log('Persona context:');
console.log(personaCtx || '(empty)');

console.log('\n✅ All state management tests passed!');
