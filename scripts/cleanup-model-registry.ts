#!/usr/bin/env tsx
/**
 * Cleanup Model Registry
 *
 * Removes models from etc/models.json that no longer exist in Ollama.
 * This helps keep the registry file clean after auto-cleanup removes old training runs.
 *
 * Usage:
 *   pnpm tsx scripts/cleanup-model-registry.ts [--dry-run]
 */

import fs from 'node:fs';
import path from 'node:path';
import { systemPaths } from '@metahuman/core';
import { OllamaClient } from '@metahuman/core/ollama';

interface ModelConfig {
  provider: string;
  model: string;
  roles?: string[];
  adapters?: any[];
  description?: string;
  baseModel?: string | null;
  metadata?: Record<string, any>;
  options?: Record<string, any>;
}

interface ModelRegistry {
  version?: string;
  globalSettings?: Record<string, any>;
  defaults?: Record<string, string>;
  models?: Record<string, ModelConfig>;
  cognitiveModeMappings?: Record<string, Record<string, string>>;
  roleHierarchy?: Record<string, any>;
}

async function main() {
  const isDryRun = process.argv.includes('--dry-run');

  console.log('🧹 Model Registry Cleanup');
  console.log(isDryRun ? '🔍 DRY RUN MODE (no changes will be made)\n' : '\n');

  // Read current registry
  const registryPath = path.join(systemPaths.etc, 'models.json');

  if (!fs.existsSync(registryPath)) {
    console.log('❌ No models.json found at:', registryPath);
    process.exit(1);
  }

  const registry: ModelRegistry = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
  const originalModels = registry.models || {};
  const modelCount = Object.keys(originalModels).length;

  console.log(`📋 Registry contains ${modelCount} model entries`);

  // Fetch Ollama models
  const ollama = new OllamaClient();
  let ollamaModels: string[] = [];

  try {
    console.log('🔍 Fetching models from Ollama...');
    const tags = await ollama.listModels();
    ollamaModels = tags.map(m => m.name);
    console.log(`✅ Found ${ollamaModels.length} models in Ollama\n`);
  } catch (err) {
    console.error('❌ Failed to fetch Ollama models:', (err as Error).message);
    console.error('   Make sure Ollama is running');
    process.exit(1);
  }

  // Build set for fast lookup
  const ollamaModelSet = new Set(ollamaModels);

  // Find models to remove
  const modelsToRemove: Array<{ id: string; model: string; reason: string }> = [];
  const modelsToKeep: Record<string, ModelConfig> = {};

  for (const [id, config] of Object.entries(originalModels)) {
    const modelName = config.model;

    if (!ollamaModelSet.has(modelName)) {
      modelsToRemove.push({
        id,
        model: modelName,
        reason: 'Model no longer exists in Ollama'
      });
    } else {
      modelsToKeep[id] = config;
    }
  }

  // Display results
  if (modelsToRemove.length === 0) {
    console.log('✨ Registry is already clean! All models exist in Ollama.');
    process.exit(0);
  }

  console.log(`🗑️  Found ${modelsToRemove.length} model(s) to remove:\n`);

  for (const { id, model, reason } of modelsToRemove) {
    console.log(`   ❌ ${id}`);
    console.log(`      Model: ${model}`);
    console.log(`      Reason: ${reason}\n`);
  }

  console.log(`✅ Keeping ${Object.keys(modelsToKeep).length} model(s)\n`);

  // Clean up role assignments that reference deleted models
  const cleanedDefaults: Record<string, string> = {};
  let defaultsRemoved = 0;

  if (registry.defaults) {
    for (const [role, modelId] of Object.entries(registry.defaults)) {
      if (modelsToKeep[modelId]) {
        cleanedDefaults[role] = modelId;
      } else {
        defaultsRemoved++;
        console.log(`   🔗 Removing role assignment: ${role} → ${modelId}`);
      }
    }
  }

  // Clean up cognitive mode mappings
  const cleanedCognitiveModeMappings: Record<string, Record<string, string>> = {};
  let mappingsRemoved = 0;

  if (registry.cognitiveModeMappings) {
    for (const [mode, assignments] of Object.entries(registry.cognitiveModeMappings)) {
      const cleanedAssignments: Record<string, string> = {};

      for (const [role, modelId] of Object.entries(assignments)) {
        if (modelsToKeep[modelId]) {
          cleanedAssignments[role] = modelId;
        } else {
          mappingsRemoved++;
          console.log(`   🔗 Removing cognitive mode mapping: ${mode}.${role} → ${modelId}`);
        }
      }

      if (Object.keys(cleanedAssignments).length > 0) {
        cleanedCognitiveModeMappings[mode] = cleanedAssignments;
      }
    }
  }

  if (defaultsRemoved > 0 || mappingsRemoved > 0) {
    console.log(`\n📌 Removed ${defaultsRemoved + mappingsRemoved} stale role assignment(s)\n`);
  }

  // Update registry
  const updatedRegistry: ModelRegistry = {
    ...registry,
    models: modelsToKeep,
    defaults: cleanedDefaults,
    cognitiveModeMappings: cleanedCognitiveModeMappings
  };

  // Show summary
  const removedCount = modelsToRemove.length;
  const keptCount = Object.keys(modelsToKeep).length;
  const totalCount = modelCount;

  console.log('📊 Summary:');
  console.log(`   Total models in registry: ${totalCount}`);
  console.log(`   Models removed: ${removedCount}`);
  console.log(`   Models kept: ${keptCount}`);
  console.log(`   Role assignments removed: ${defaultsRemoved + mappingsRemoved}`);

  if (isDryRun) {
    console.log('\n🔍 DRY RUN - No changes were made');
    console.log('   Run without --dry-run to apply changes');
  } else {
    // Write updated registry
    fs.writeFileSync(registryPath, JSON.stringify(updatedRegistry, null, 2));
    console.log('\n✅ Registry cleaned successfully!');
    console.log(`   Updated: ${registryPath}`);
  }
}

main().catch(err => {
  console.error('❌ Cleanup failed:', err);
  process.exit(1);
});
