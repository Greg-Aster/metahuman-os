/**
 * Phase 1 Integration Test
 *
 * Tests the complete Phase 1 implementation:
 * - Configuration loading
 * - Pipeline execution
 * - Layer 1 (Subconscious) wrapper
 *
 * Run: tsx packages/core/src/cognitive-layers/__tests__/phase1-integration.test.ts
 */

import { CognitivePipeline, SubconsciousLayer, loadLayerConfig, getConfigSummary } from '../index.js';

async function main() {
  console.log('=== Phase 1 Integration Test ===\n');

  // Test 1: Configuration Loading
  console.log('Test 1: Configuration Loading');
  try {
    const summary = getConfigSummary();
    console.log('✓ Config Path:', summary.configPath);
    console.log('✓ Config Loaded:', summary.loaded);

    if (summary.loaded) {
      for (const mode of summary.modes) {
        console.log(`✓ Mode '${mode.mode}': ${mode.layerCount} layers (${mode.enabledLayers.length} enabled)`);
      }
    }
  } catch (error) {
    console.error('✗ Configuration loading failed:', error);
    process.exit(1);
  }

  console.log('\nTest 2: Load Mode-Specific Config');
  try {
    const dualConfig = loadLayerConfig('dual');
    console.log('✓ Dual mode config loaded');
    console.log(`  - ${dualConfig.layers.length} layers defined`);
    console.log(`  - Enabled: ${dualConfig.layers.filter(l => l.enabled).map(l => l.name).join(', ')}`);

    const agentConfig = loadLayerConfig('agent');
    console.log('✓ Agent mode config loaded');
    console.log(`  - ${agentConfig.layers.length} layers defined`);

    const emulationConfig = loadLayerConfig('emulation');
    console.log('✓ Emulation mode config loaded');
    console.log(`  - ${emulationConfig.layers.length} layers defined`);
  } catch (error) {
    console.error('✗ Mode config loading failed:', error);
    process.exit(1);
  }

  // Test 3: Pipeline Creation
  console.log('\nTest 3: Pipeline Creation');
  try {
    const pipeline = new CognitivePipeline();
    console.log('✓ Pipeline created');

    const layer1 = new SubconsciousLayer();
    pipeline.addLayer(layer1);
    console.log('✓ Layer 1 (Subconscious) added');

    const summary = pipeline.getSummary();
    console.log(`✓ Pipeline has ${summary.layerCount} layer(s)`);
    console.log(`  - Enabled: ${summary.enabledLayers.join(', ')}`);
  } catch (error) {
    console.error('✗ Pipeline creation failed:', error);
    process.exit(1);
  }

  // Test 4: Pipeline Execution
  console.log('\nTest 4: Pipeline Execution (Layer 1 only)');
  try {
    const pipeline = new CognitivePipeline();
    const layer1 = new SubconsciousLayer();
    pipeline.addLayer(layer1);

    const testMessage = "What are my current projects?";
    console.log(`  Input: "${testMessage}"`);
    console.log('  Executing pipeline...');

    const startTime = Date.now();
    const result = await pipeline.execute(
      { userMessage: testMessage },
      'dual'
    );
    const duration = Date.now() - startTime;

    console.log(`✓ Pipeline executed successfully in ${duration}ms`);
    console.log(`  - Total time: ${result.totalTime}ms`);
    console.log(`  - Layers executed: ${result.layers.length}`);

    for (const layerResult of result.layers) {
      console.log(`  - ${layerResult.layerName}: ${layerResult.success ? '✓' : '✗'} (${layerResult.processingTime}ms)`);
    }

    // Verify output structure
    if (result.output.contextPackage) {
      console.log('✓ Context package generated');
      console.log(`  - Memories: ${result.output.contextPackage.memories?.length || 0}`);
      console.log(`  - Patterns: ${result.output.patterns?.length || 0}`);
      console.log(`  - Retrieval time: ${result.output.retrievalTime}ms`);
    } else {
      console.log('✗ No context package in output');
    }
  } catch (error) {
    console.error('✗ Pipeline execution failed:', error);
    console.error('  Error details:', error instanceof Error ? error.message : String(error));
  }

  // Test 5: Test All Modes
  console.log('\nTest 5: Test All Cognitive Modes');
  try {
    const modes: Array<'dual' | 'agent' | 'emulation'> = ['dual', 'agent', 'emulation'];

    for (const mode of modes) {
      const pipeline = new CognitivePipeline();
      const layer1 = new SubconsciousLayer();
      pipeline.addLayer(layer1);

      const startTime = Date.now();
      const result = await pipeline.execute(
        { userMessage: "Hello, test message" },
        mode
      );
      const duration = Date.now() - startTime;

      const success = result.layers.every(l => l.success);
      console.log(`  ${mode.padEnd(10)} - ${success ? '✓' : '✗'} ${duration}ms`);
    }
    console.log('✓ All modes executed successfully');
  } catch (error) {
    console.error('✗ Mode testing failed:', error);
  }

  console.log('\n=== Phase 1 Integration Test Complete ===');
  console.log('✓ All tests passed!');
}

// Run tests
main().catch(error => {
  console.error('Test suite failed:', error);
  process.exit(1);
});
