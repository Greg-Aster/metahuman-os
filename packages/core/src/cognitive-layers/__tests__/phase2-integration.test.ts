/**
 * Phase 2 Integration Test
 *
 * Tests the complete Phase 2 implementation:
 * - PersonalityCoreLayer integration
 * - 2-layer pipeline (Subconscious → Personality)
 * - LoRA adapter discovery and loading
 * - Prompt building with context
 * - All cognitive modes
 *
 * Run: tsx packages/core/src/cognitive-layers/__tests__/phase2-integration.test.ts
 */

import {
  CognitivePipeline,
  SubconsciousLayer,
  PersonalityCoreLayer,
  getLoRASummary,
  discoverLoRAAdapters
} from '../index.js';

async function main() {
  console.log('=== Phase 2 Integration Test ===\n');

  // Test 1: LoRA Adapter Discovery
  console.log('Test 1: LoRA Adapter Discovery');
  try {
    const discovery = discoverLoRAAdapters();
    console.log('✓ LoRA discovery completed');
    console.log(`  - Total adapters found: ${discovery.count}`);
    console.log(`  - Latest adapter: ${discovery.latest?.name || 'none'}`);
    console.log(`  - Latest dual adapter: ${discovery.latestDual?.name || 'none'}`);

    if (discovery.count > 0) {
      console.log('  - Available adapters:');
      for (const adapter of discovery.adapters.slice(0, 3)) {
        const type = adapter.isDual ? 'dual' : 'single';
        const size = (adapter.size / (1024 * 1024)).toFixed(2);
        console.log(`    - ${adapter.name} (${type}, ${size}MB)`);
      }
    }

    const summary = getLoRASummary();
    console.log(`✓ LoRA summary: ${summary.available} adapters available`);
  } catch (error) {
    console.error('✗ LoRA discovery failed:', error);
  }

  // Test 2: Layer 2 Creation
  console.log('\nTest 2: PersonalityCoreLayer Creation');
  try {
    const layer2 = new PersonalityCoreLayer();
    console.log('✓ PersonalityCoreLayer created');
    console.log(`  - Name: ${layer2.name}`);
    console.log(`  - Version: ${layer2.version}`);
    console.log(`  - Enabled: ${layer2.enabled}`);
  } catch (error) {
    console.error('✗ PersonalityCoreLayer creation failed:', error);
    process.exit(1);
  }

  // Test 3: 2-Layer Pipeline Creation
  console.log('\nTest 3: 2-Layer Pipeline Creation');
  try {
    const pipeline = new CognitivePipeline();

    const layer1 = new SubconsciousLayer();
    const layer2 = new PersonalityCoreLayer();

    pipeline.addLayer(layer1);
    pipeline.addLayer(layer2);

    console.log('✓ 2-layer pipeline created');

    const summary = pipeline.getSummary();
    console.log(`✓ Pipeline has ${summary.layerCount} layers`);
    console.log(`  - Enabled: ${summary.enabledLayers.join(' → ')}`);
  } catch (error) {
    console.error('✗ Pipeline creation failed:', error);
    process.exit(1);
  }

  // Test 4: 2-Layer Pipeline Execution (Dual Mode)
  console.log('\nTest 4: 2-Layer Pipeline Execution (Dual Mode)');
  try {
    const pipeline = new CognitivePipeline();
    pipeline.addLayer(new SubconsciousLayer());
    pipeline.addLayer(new PersonalityCoreLayer());

    const testMessage = "What projects am I currently working on?";
    console.log(`  Input: "${testMessage}"`);
    console.log('  Executing 2-layer pipeline...');

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
      console.log(`  - Model: ${layer2Output.voiceMetrics?.model || 'unknown'}`);
      console.log(`  - Response preview: "${layer2Output.response.substring(0, 100)}..."`);
    }

    // Final output is Layer 2's response
    console.log('✓ Final output type:', typeof result.output);
  } catch (error) {
    console.error('✗ Pipeline execution failed:', error);
    if (error instanceof Error) {
      console.error('  Error message:', error.message);
      console.error('  Stack:', error.stack);
    }
  }

  // Test 5: All Cognitive Modes
  console.log('\nTest 5: Test All Cognitive Modes (2-Layer Pipeline)');
  try {
    const modes: Array<'dual' | 'agent' | 'emulation'> = ['dual', 'agent', 'emulation'];

    for (const mode of modes) {
      const pipeline = new CognitivePipeline();
      pipeline.addLayer(new SubconsciousLayer());
      pipeline.addLayer(new PersonalityCoreLayer());

      const startTime = Date.now();
      const result = await pipeline.execute(
        { userMessage: "Hello, test message for 2-layer pipeline" },
        mode
      );
      const duration = Date.now() - startTime;

      const allSuccess = result.layers.every(l => l.success);
      const hasResponse = result.layers[1]?.output?.response;

      const status = allSuccess && hasResponse ? '✓' : '✗';
      console.log(`  ${mode.padEnd(10)} - ${status} ${duration}ms (response: ${hasResponse ? 'yes' : 'no'})`);

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

  // Test 6: Validation
  console.log('\nTest 6: Input Validation');
  try {
    const layer2 = new PersonalityCoreLayer();

    // Test invalid input (missing context package)
    const invalidResult = layer2.validate({ contextPackage: null as any });
    console.log(`  Invalid input: ${invalidResult.valid ? '✗ should be invalid' : '✓ correctly rejected'}`);
    if (!invalidResult.valid && invalidResult.errors) {
      console.log(`    Errors: ${invalidResult.errors.join(', ')}`);
    }

    // Test valid input
    const validResult = layer2.validate({
      contextPackage: {
        userMessage: 'test',
        memories: [],
        patterns: []
      }
    });
    console.log(`  Valid input: ${validResult.valid ? '✓ accepted' : '✗ should be valid'}`);

  } catch (error) {
    console.error('✗ Validation testing failed:', error);
  }

  console.log('\n=== Phase 2 Integration Test Complete ===');
  console.log('✓ All tests completed!');
}

// Run tests
main().catch(error => {
  console.error('Test suite failed:', error);
  process.exit(1);
});
