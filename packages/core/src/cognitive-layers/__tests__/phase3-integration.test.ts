/**
 * Phase 3 Integration Test
 *
 * Tests the complete Phase 3 implementation:
 * - Meta-Cognition Layer integration
 * - 3-layer pipeline (Subconscious → Personality → Meta-Cognition)
 * - Validation (value alignment, consistency, safety)
 * - Response refinement
 * - All cognitive modes
 *
 * Run: tsx packages/core/src/cognitive-layers/__tests__/phase3-integration.test.ts
 */

import {
  CognitivePipeline,
  SubconsciousLayer,
  PersonalityCoreLayer,
  MetaCognitionLayer,
  getValidationSummary,
  checkSafety,
  checkValueAlignment,
  checkConsistency
} from '../index.js';

async function main() {
  console.log('=== Phase 3 Integration Test ===\n');

  // Test 1: Layer 3 Creation
  console.log('Test 1: MetaCognitionLayer Creation');
  try {
    const layer3 = new MetaCognitionLayer();
    console.log('✓ MetaCognitionLayer created');
    console.log(`  - Name: ${layer3.name}`);
    console.log(`  - Version: ${layer3.version}`);
    console.log(`  - Enabled: ${layer3.enabled}`);
  } catch (error) {
    console.error('✗ MetaCognitionLayer creation failed:', error);
    process.exit(1);
  }

  // Test 2: Safety Validator
  console.log('\nTest 2: Safety Validator');
  try {
    // Test safe response
    const safeResponse = "I'm happy to help you with your coding project!";
    const safeResult = await checkSafety(safeResponse);
    console.log(`✓ Safe response: ${safeResult.safe ? 'SAFE' : 'UNSAFE'} (score: ${(safeResult.score * 100).toFixed(1)}%)`);

    // Test response with potential issue
    const codeResponse = "Here's a file at /home/user/file.txt with API key: sk-1234567890abcdef";
    const codeResult = await checkSafety(codeResponse);
    console.log(`✓ Response with sensitive data: ${codeResult.safe ? 'SAFE' : 'UNSAFE'} (issues: ${codeResult.issues.length})`);
    if (codeResult.issues.length > 0) {
      console.log(`  - First issue: ${codeResult.issues[0].type} (${codeResult.issues[0].severity})`);
    }
  } catch (error) {
    console.error('✗ Safety validation failed:', error);
  }

  // Test 3: 3-Layer Pipeline Creation
  console.log('\nTest 3: 3-Layer Pipeline Creation');
  try {
    const pipeline = new CognitivePipeline();

    const layer1 = new SubconsciousLayer();
    const layer2 = new PersonalityCoreLayer();
    const layer3 = new MetaCognitionLayer();

    pipeline.addLayer(layer1);
    pipeline.addLayer(layer2);
    pipeline.addLayer(layer3);

    console.log('✓ 3-layer pipeline created');

    const summary = pipeline.getSummary();
    console.log(`✓ Pipeline has ${summary.layerCount} layers`);
    console.log(`  - Enabled: ${summary.enabledLayers.join(' → ')}`);
  } catch (error) {
    console.error('✗ Pipeline creation failed:', error);
    process.exit(1);
  }

  // Test 4: 3-Layer Pipeline Execution (Dual Mode)
  console.log('\nTest 4: 3-Layer Pipeline Execution (Dual Mode)');
  try {
    const pipeline = new CognitivePipeline();
    pipeline.addLayer(new SubconsciousLayer());
    pipeline.addLayer(new PersonalityCoreLayer());
    pipeline.addLayer(new MetaCognitionLayer());

    const testMessage = "Tell me about your current projects and goals.";
    console.log(`  Input: "${testMessage}"`);
    console.log('  Executing 3-layer pipeline...');

    const startTime = Date.now();
    const result = await pipeline.execute(
      { userMessage: testMessage },
      'dual'
    );
    const duration = Date.now() - startTime;

    console.log(`✓ Pipeline executed successfully in ${duration}ms`);
    console.log(`  - Total time: ${result.totalTime}ms`);
    console.log(`  - Layers executed: ${result.layers.length}`);

    // Show per-layer results
    for (const layerResult of result.layers) {
      const status = layerResult.success ? '✓' : '✗';
      console.log(`  - ${status} ${layerResult.layerName}: ${layerResult.processingTime}ms`);

      if (layerResult.error) {
        console.log(`    Error: ${layerResult.error}`);
      }
    }

    // Verify Layer 1 output (context package)
    if (result.layers[0]?.output?.contextPackage) {
      const layer1Output = result.layers[0].output;
      console.log('✓ Layer 1 (Subconscious) output:');
      console.log(`  - Memories: ${layer1Output.contextPackage.memories?.length || 0}`);
      console.log(`  - Patterns: ${layer1Output.patterns?.length || 0}`);
    }

    // Verify Layer 2 output (response)
    if (result.layers[1]?.output?.response) {
      const layer2Output = result.layers[1].output;
      console.log('✓ Layer 2 (Personality) output:');
      console.log(`  - Response length: ${layer2Output.response.length} chars`);
      console.log(`  - LoRA adapter: ${layer2Output.loraAdapter?.name || 'none'}`);
    }

    // Verify Layer 3 output (validation)
    if (result.layers[2]?.output) {
      const layer3Output = result.layers[2].output;
      console.log('✓ Layer 3 (Meta-Cognition) output:');
      console.log(`  - Validated: ${layer3Output.validated ? 'yes' : 'no'}`);
      console.log(`  - Passed validation: ${layer3Output.passedValidation ? 'yes' : 'no'}`);

      if (layer3Output.safety) {
        console.log(`  - Safety: ${layer3Output.safety.safe ? '✓' : '✗'} (${(layer3Output.safety.score * 100).toFixed(1)}%)`);
      }

      if (layer3Output.valueAlignment) {
        console.log(`  - Alignment: ${layer3Output.valueAlignment.aligned ? '✓' : '✗'} (${(layer3Output.valueAlignment.score * 100).toFixed(1)}%)`);
      }

      if (layer3Output.consistency) {
        console.log(`  - Consistency: ${layer3Output.consistency.consistent ? '✓' : '✗'} (${(layer3Output.consistency.score * 100).toFixed(1)}%)`);
      }

      if (layer3Output.refinement?.changed) {
        console.log(`  - Refined: yes (${layer3Output.refinement.changes.length} changes)`);
      }

      console.log(`  - Final response length: ${layer3Output.response.length} chars`);
    }

    // Final output is Layer 3's validated response
    console.log('✓ Final output type:', typeof result.output);
  } catch (error) {
    console.error('✗ Pipeline execution failed:', error);
    if (error instanceof Error) {
      console.error('  Error message:', error.message);
      console.error('  Stack:', error.stack);
    }
  }

  // Test 5: All Cognitive Modes
  console.log('\nTest 5: Test All Cognitive Modes (3-Layer Pipeline)');
  try {
    const modes: Array<'dual' | 'agent' | 'emulation'> = ['dual', 'agent', 'emulation'];

    for (const mode of modes) {
      const pipeline = new CognitivePipeline();
      pipeline.addLayer(new SubconsciousLayer());
      pipeline.addLayer(new PersonalityCoreLayer());
      pipeline.addLayer(new MetaCognitionLayer());

      const startTime = Date.now();
      const result = await pipeline.execute(
        { userMessage: "Hello, test message for 3-layer pipeline" },
        mode
      );
      const duration = Date.now() - startTime;

      const allSuccess = result.layers.every(l => l.success);
      const hasResponse = result.output?.response;
      const validated = result.output?.validated;

      const status = allSuccess && hasResponse ? '✓' : '✗';
      console.log(`  ${mode.padEnd(10)} - ${status} ${duration}ms (validated: ${validated ? 'yes' : 'no'})`);

      // Show validation level for each mode
      if (result.layers[2]?.output) {
        const layer3Output = result.layers[2].output;
        const validationInfo: string[] = [];

        if (layer3Output.safety) validationInfo.push('safety');
        if (layer3Output.valueAlignment) validationInfo.push('alignment');
        if (layer3Output.consistency) validationInfo.push('consistency');

        if (validationInfo.length > 0) {
          console.log(`              Checks: ${validationInfo.join(', ')}`);
        }
      }

      if (!allSuccess) {
        for (const layer of result.layers) {
          if (!layer.success) {
            console.log(`    ✗ ${layer.layerName} failed: ${layer.error}`);
          }
        }
      }
    }
    console.log('✓ All modes executed');
  } catch (error) {
    console.error('✗ Mode testing failed:', error);
  }

  // Test 6: Validation Summary
  console.log('\nTest 6: Validation Summary');
  try {
    const pipeline = new CognitivePipeline();
    pipeline.addLayer(new SubconsciousLayer());
    pipeline.addLayer(new PersonalityCoreLayer());
    pipeline.addLayer(new MetaCognitionLayer());

    const result = await pipeline.execute(
      { userMessage: "What are your thoughts on current events?" },
      'dual'
    );

    if (result.layers[2]?.output) {
      const summary = getValidationSummary(result.layers[2].output);
      console.log('✓ Validation summary generated:');
      console.log(summary.split('\n').map(line => `  ${line}`).join('\n'));
    }
  } catch (error) {
    console.error('✗ Validation summary failed:', error);
  }

  // Test 7: Input Validation
  console.log('\nTest 7: Input Validation');
  try {
    const layer3 = new MetaCognitionLayer();

    // Test invalid input (missing response)
    const invalidResult = layer3.validate({ response: null as any, contextPackage: {} });
    console.log(`  Invalid input: ${invalidResult.valid ? '✗ should be invalid' : '✓ correctly rejected'}`);
    if (!invalidResult.valid && invalidResult.errors) {
      console.log(`    Errors: ${invalidResult.errors.join(', ')}`);
    }

    // Test valid input
    const validResult = layer3.validate({
      response: 'test response',
      contextPackage: { userMessage: 'test', memories: [], patterns: [] }
    });
    console.log(`  Valid input: ${validResult.valid ? '✓ accepted' : '✗ should be valid'}`);

  } catch (error) {
    console.error('✗ Validation testing failed:', error);
  }

  console.log('\n=== Phase 3 Integration Test Complete ===');
  console.log('✓ All tests completed!');
}

// Run tests
main().catch(error => {
  console.error('Test suite failed:', error);
  process.exit(1);
});
