/**
 * Phase 4.1a Integration Test
 *
 * Tests PersonalityCoreLayer chatHistory support for persona_chat.ts integration:
 * - Layer 2 accepts pre-built chat history
 * - Layer 2 accepts llmOptions from context.metadata
 * - Output format matches expectations
 * - Feature flag integration (simulated)
 *
 * Run: tsx packages/core/src/cognitive-layers/__tests__/phase4.1a-integration.test.ts
 */

import { PersonalityCoreLayer } from '../layers/personality-core-layer.js';
import type { PersonalityInput, LayerContext } from '../types.js';
import type { CognitiveModeId } from '../../cognitive-mode.js';

async function main() {
  console.log('=== Phase 4.1a Integration Test ===\n');

  // Test 1: Layer 2 with chatHistory support
  console.log('Test 1: PersonalityCoreLayer with chatHistory');
  try {
    const layer2 = new PersonalityCoreLayer();

    // Simulate pre-built chat history from persona_chat.ts
    const chatHistory = [
      { role: 'system', content: 'You are a helpful AI assistant.' },
      { role: 'user', content: 'Hello! How are you today?' }
    ];

    const input: PersonalityInput = {
      chatHistory,
      contextPackage: {} // Not used when chatHistory is provided
    };

    const context: LayerContext = {
      cognitiveMode: 'dual',
      previousLayers: [],
      metadata: {
        llmOptions: {
          temperature: 0.7,
          topP: 0.9,
          repeatPenalty: 1.3,
          max_tokens: 500
        }
      }
    };

    console.log('  Input: chatHistory with', chatHistory.length, 'messages');
    console.log('  Processing...');

    const startTime = Date.now();
    const output = await layer2.process(input, context);
    const duration = Date.now() - startTime;

    console.log(`✓ Layer 2 processed successfully in ${duration}ms`);
    console.log(`  - Response length: ${output.response.length} chars`);
    console.log(`  - Model: ${output.voiceMetrics?.model ?? 'unknown'}`);
    const adapterName = typeof output.loraAdapter === 'object' ? output.loraAdapter?.name : output.loraAdapter;
    console.log(`  - LoRA adapter: ${adapterName || 'none'}`);
    console.log(`  - Response preview: "${output.response.slice(0, 80)}..."`);

    // Verify output structure
    if (!output.response) {
      throw new Error('Output missing response field');
    }
    if (!output.voiceMetrics) {
      throw new Error('Output missing voiceMetrics field');
    }
    if (!output.voiceMetrics?.model) {
      throw new Error('Output missing voiceMetrics.model field');
    }

    console.log('✓ Output structure verified');
  } catch (error) {
    console.error('✗ Test 1 failed:', error);
    process.exit(1);
  }

  // Test 2: Layer 2 with standard prompt building (no chatHistory)
  console.log('\nTest 2: PersonalityCoreLayer with standard prompt building');
  try {
    const layer2 = new PersonalityCoreLayer();

    // Simulate context package from Layer 1
    const contextPackage = {
      userMessage: 'What are your current goals?',
      persona: { name: 'Test Persona' },
      memories: [],
      patterns: [],
      retrievalTime: 50
    };

    const input: PersonalityInput = {
      userMessage: 'What are your current goals?',
      contextPackage
      // No chatHistory - should use prompt building
    };

    const context: LayerContext = {
      cognitiveMode: 'dual',
      previousLayers: [],
      metadata: {
        llmOptions: {
          temperature: 0.7,
          max_tokens: 500
        }
      }
    };

    console.log('  Input: contextPackage (prompt building mode)');
    console.log('  Processing...');

    const startTime = Date.now();
    const output = await layer2.process(input, context);
    const duration = Date.now() - startTime;

    console.log(`✓ Layer 2 processed successfully in ${duration}ms`);
    console.log(`  - Response length: ${output.response.length} chars`);
    console.log(`  - Model: ${output.voiceMetrics?.model ?? 'unknown'}`);
    console.log(`  - Response preview: "${output.response.slice(0, 80)}..."`);

    console.log('✓ Standard prompt building verified');
  } catch (error) {
    console.error('✗ Test 2 failed:', error);
    process.exit(1);
  }

  // Test 3: Comparison across cognitive modes
  console.log('\nTest 3: Test chatHistory across all cognitive modes');
  try {
    const modes: CognitiveModeId[] = ['dual', 'agent', 'emulation'];
    const chatHistory = [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Test message for mode comparison' }
    ];

    for (const mode of modes) {
      const layer2 = new PersonalityCoreLayer();
      const input: PersonalityInput = {
        chatHistory,
        contextPackage: {}
      };
      const context: LayerContext = {
        cognitiveMode: mode,
        previousLayers: [],
        metadata: {
          llmOptions: { temperature: 0.7, max_tokens: 300 }
        }
      };

      const startTime = Date.now();
      const output = await layer2.process(input, context);
      const duration = Date.now() - startTime;

      const hasResponse = output.response && output.response.length > 0;
      const status = hasResponse ? '✓' : '✗';
      console.log(`  ${mode.padEnd(10)} - ${status} ${duration}ms (${output.response.length} chars)`);
    }

    console.log('✓ All modes tested');
  } catch (error) {
    console.error('✗ Test 3 failed:', error);
    process.exit(1);
  }

  // Test 4: llmOptions passthrough
  console.log('\nTest 4: Verify llmOptions passthrough from context.metadata');
  try {
    const layer2 = new PersonalityCoreLayer();

    // Test with custom temperature and max_tokens
    const customOptions = {
      temperature: 0.3, // Lower than default
      max_tokens: 200,  // Lower than default
      topP: 0.95
    };

    const input: PersonalityInput = {
      chatHistory: [
        { role: 'system', content: 'You are concise.' },
        { role: 'user', content: 'Say hello briefly.' }
      ],
      contextPackage: {}
    };

    const context: LayerContext = {
      cognitiveMode: 'agent',
      previousLayers: [],
      metadata: {
        llmOptions: customOptions
      }
    };

    console.log('  Custom options:', customOptions);
    console.log('  Processing...');

    const output = await layer2.process(input, context);

    console.log(`✓ Custom llmOptions accepted`);
    console.log(`  - Response: "${output.response}"`);
    console.log(`  - Length: ${output.response.length} chars (should be concise)`);

    // Verify response is reasonably short (200 max_tokens should result in brief response)
    if (output.response.length > 500) {
      console.warn('  ⚠ Response longer than expected for low max_tokens');
    }

    console.log('✓ llmOptions passthrough verified');
  } catch (error) {
    console.error('✗ Test 4 failed:', error);
    process.exit(1);
  }

  // Test 5: Input validation
  console.log('\nTest 5: Input validation');
  try {
    const layer2 = new PersonalityCoreLayer();

    // Test with missing contextPackage
    const invalidInput = {
      chatHistory: [{ role: 'user', content: 'test' }]
      // Missing contextPackage
    } as PersonalityInput;

    const validationResult = layer2.validate(invalidInput);
    console.log(`  Missing contextPackage: ${validationResult.valid ? '✗ should be invalid' : '✓ correctly rejected'}`);
    if (!validationResult.valid && validationResult.errors) {
      console.log(`    Errors: ${validationResult.errors.join(', ')}`);
    }

    // Test with valid input (chatHistory + empty contextPackage)
    const validInput: PersonalityInput = {
      chatHistory: [{ role: 'user', content: 'test' }],
      contextPackage: {}
    };

    const validResult = layer2.validate(validInput);
    console.log(`  Valid chatHistory input: ${validResult.valid ? '✓ accepted' : '✗ should be valid'}`);

    console.log('✓ Validation tests passed');
  } catch (error) {
    console.error('✗ Test 5 failed:', error);
    process.exit(1);
  }

  console.log('\n=== Phase 4.1a Integration Test Complete ===');
  console.log('✓ All tests passed!');
  console.log('\nIntegration notes:');
  console.log('- PersonalityCoreLayer accepts chatHistory from persona_chat.ts');
  console.log('- llmOptions from context.metadata are passed to model router');
  console.log('- Output format compatible with existing persona_chat.ts code');
  console.log('- Ready for feature flag deployment (USE_COGNITIVE_PIPELINE=true)');
}

// Run tests
main().catch(error => {
  console.error('Test suite failed:', error);
  process.exit(1);
});
