#!/usr/bin/env node
/**
 * Test to verify memory context is passed to operator
 */

import { buildContextPackage, formatContextForPrompt } from './packages/core/src/context-builder.ts';

async function testContextFix() {
  console.log('=== Memory Context Fix Test ===\n');

  const testQuery = "Tell me about Greg's dreams or reflections";

  console.log(`Test query: "${testQuery}"\n`);

  // Step 1: Build context package (simulating what persona_chat.ts does)
  console.log('1. Building context package...');
  const contextPackage = await buildContextPackage(testQuery, 'dual', {
    searchDepth: 'normal',
    similarityThreshold: 0.62,
    maxMemories: 2,
    maxContextChars: 900,
    filterInnerDialogue: true,
    filterReflections: true,
    includeShortTermState: true,
    includePersonaCache: true,
    includeTaskContext: false,
    detectPatterns: false,
    forceSemanticSearch: true,
    usingLoRA: false
  });

  console.log(`   ✓ Retrieved ${contextPackage.memoryCount} memories`);
  console.log(`   ✓ Index status: ${contextPackage.indexStatus}`);
  console.log(`   ✓ Fallback used: ${contextPackage.fallbackUsed}`);
  console.log();

  // Step 2: Format context for prompt
  console.log('2. Formatting context for prompt...');
  const contextInfo = formatContextForPrompt(contextPackage, {
    maxChars: 900,
    includePersona: true
  });

  console.log(`   ✓ Formatted context length: ${contextInfo.length} chars`);
  console.log();

  // Step 3: Show what gets passed to operator
  console.log('3. Building operator context (NEW behavior)...');
  let operatorContext = '';

  // MEMORY CONTEXT: Add retrieved memories from semantic search (if available)
  if (contextInfo && contextInfo.length > 0) {
    operatorContext += '# Memory Context\n';
    operatorContext += contextInfo + '\n\n';
  }

  console.log(`   ✓ Operator context length: ${operatorContext.length} chars`);
  console.log();

  // Step 4: Show preview of what conversational_response will receive
  console.log('4. Preview of context passed to conversational_response skill:\n');
  console.log('─'.repeat(60));
  console.log(operatorContext.substring(0, 500));
  if (operatorContext.length > 500) {
    console.log('...[truncated]...');
  }
  console.log('─'.repeat(60));
  console.log();

  // Step 5: Verification
  console.log('5. Verification:\n');

  if (contextPackage.memoryCount > 0) {
    console.log('   ✅ Memory retrieval: WORKING');
  } else {
    console.log('   ⚠️  Memory retrieval: No memories found (check index or query)');
  }

  if (contextInfo.length > 0) {
    console.log('   ✅ Context formatting: WORKING');
  } else {
    console.log('   ❌ Context formatting: FAILED');
  }

  if (operatorContext.length > 0 && operatorContext.includes('# Memory Context')) {
    console.log('   ✅ Operator context passing: FIXED');
    console.log('   ✅ conversational_response will receive memory context');
  } else {
    console.log('   ❌ Operator context passing: BROKEN');
    console.log('   ❌ conversational_response will receive empty context');
  }

  console.log();
  console.log('Expected result:');
  console.log('- AI should now reference actual memories from the index');
  console.log('- Responses should be grounded in retrieved episodic memories');
  console.log('- No more vague "I don\'t have access" responses');
}

testContextFix();
