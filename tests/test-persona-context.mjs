#!/usr/bin/env node
/**
 * Test script to verify persona context injection in model router
 * This bypasses the web API and directly tests the model router
 */

import { callLLM } from './packages/core/dist/model-router.js';

async function testPersonaContext() {
  console.log('Testing persona context injection...\n');

  try {
    // Test 1: Ask about goals (should include persona context)
    console.log('Test 1: Asking "What are my current goals?" with persona context enabled');
    const response1 = await callLLM({
      role: 'persona',
      messages: [
        { role: 'user', content: 'What are my current goals?' }
      ],
      options: {
        temperature: 0.7,
        maxTokens: 300
      }
    });

    console.log('\nResponse:', response1.content);
    console.log('\nModel used:', response1.model);
    console.log('Model ID:', response1.modelId);

    // Check if response mentions the actual goals from persona files
    const hasGoalMention = response1.content.toLowerCase().includes('metahuman') ||
                          response1.content.toLowerCase().includes('reflection') ||
                          response1.content.toLowerCase().includes('identity kernel');

    console.log('\n✓ Test 1:', hasGoalMention ? 'PASS - Response mentions actual goals' : 'FAIL - Generic response');

    if (!hasGoalMention) {
      console.log('\nExpected response to mention goals from persona/core.json:');
      console.log('  - Reboot MetaHuman OS with a clean, well-defined identity kernel');
      console.log('  - Maintain succinct, context-aware reflections');
    }

  } catch (error) {
    console.error('Test failed:', error);
    process.exit(1);
  }
}

testPersonaContext();
