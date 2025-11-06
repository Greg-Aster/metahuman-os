#!/usr/bin/env node
/**
 * Test to verify operator receives context from persona_chat
 */

import { buildContextPackage, formatContextForPrompt } from './packages/core/src/context-builder.ts';

async function testOperatorContext() {
  console.log('=== Operator Context Test ===\n');

  const userMessage = "I'd like to know about some of Greg's dreams or reflections.";

  // Step 1: Build context like persona_chat does
  console.log('1. Building context package (like persona_chat.ts does)...');
  const contextPackage = await buildContextPackage(userMessage, 'dual', {
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

  console.log(`   Memory count: ${contextPackage.memoryCount}`);
  console.log(`   Index used: ${contextPackage.indexStatus === 'available'}`);
  console.log();

  // Step 2: Format context for prompt
  console.log('2. Formatting context for prompt...');
  const formattedContext = formatContextForPrompt(contextPackage, {
    maxChars: 900,
    includePersona: true
  });

  console.log(`   Formatted context length: ${formattedContext.length} chars`);
  console.log(`   Context preview:\n${formattedContext.substring(0, 300)}...\n`);

  // Step 3: Check what operator currently receives
  console.log('3. What operator currently receives (WRONG):');
  console.log('   context: ""  // ← Empty string!\n');

  // Step 4: What operator SHOULD receive
  console.log('4. What operator SHOULD receive (CORRECT):');
  console.log(`   context: "${formattedContext.substring(0, 100)}..."`);
  console.log();

  // Step 5: Verification
  if (contextPackage.memoryCount > 0 && formattedContext.length > 0) {
    console.log('✅ Context is being retrieved successfully');
    console.log('❌ BUT it is not being passed to the operator');
    console.log();
    console.log('FIX: Pass formattedContext to operator in persona_chat.ts');
  } else {
    console.log('❌ Context retrieval failed');
  }
}

testOperatorContext();
