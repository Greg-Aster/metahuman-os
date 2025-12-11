/**
 * Model Registry - Track fine-tuning lineage and manage model versions
 *
 * Responsibilities:
 * 1. Track which model to use as base for next fine-tune
 * 2. Maintain training history (original → v1 → v2 → etc.)
 * 3. Update base model after successful training
 * 4. Resolve model paths (local vs HuggingFace)
 */

import fs from 'node:fs';
import path from 'node:path';
import { systemPaths } from './paths.js';

export interface ModelRegistryEntry {
  version: number;
  run_id: string;
  run_label: string;
  timestamp: string;
  base_model_used: string;
  output_model_path: string; // Path to unquantized model
  gguf_path: string; // Path to quantized GGUF
  samples_trained: number;
  mode_filter?: 'dual' | 'emulation' | 'agent';
  training_success: boolean;
}

export interface ModelRegistry {
  original_base_model: string;
  current_base_model: string;
  model_type: 'huggingface' | 'local';
  training_history: ModelRegistryEntry[];
  output_formats: {
    unquantized: {
      format: string;
      purpose: string;
      location: string;
      keep: boolean;
    };
    quantized: {
      format: string;
      quantization: string;
      purpose: string;
      location: string;
      keep: boolean;
    };
  };
  versioning: {
    enabled: boolean;
    auto_update_base: boolean;
    keep_all_versions: boolean;
  };
}

const REGISTRY_PATH = path.join(systemPaths.etc, 'model-registry.json');

/**
 * Load training registry (model fine-tuning lineage)
 * Note: This is different from loadModelRegistry in model-resolver.ts which handles role-based model config
 */
export function loadTrainingRegistry(): ModelRegistry {
  if (!fs.existsSync(REGISTRY_PATH)) {
    throw new Error(`Training registry not found: ${REGISTRY_PATH}`);
  }

  const content = fs.readFileSync(REGISTRY_PATH, 'utf-8');
  const { comment, notes, ...registry } = JSON.parse(content);
  return registry as ModelRegistry;
}

/**
 * Save model registry
 */
export function saveModelRegistry(registry: ModelRegistry): void {
  const fullRegistry = {
    comment: 'Model registry tracks fine-tuning lineage and current base model',
    notes: [
      'This file is automatically updated after each successful training run.',
      "The 'current_base_model' is used for the next fine-tuning cycle.",
      'Original model is always preserved for reference.',
      'Model paths can be local (trained models) or HuggingFace (original).',
    ],
    ...registry,
  };

  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(fullRegistry, null, 2));
}

/**
 * Get the current base model to use for training
 */
export function getCurrentBaseModel(): { model: string; type: 'huggingface' | 'local' } {
  const registry = loadTrainingRegistry();

  return {
    model: registry.current_base_model,
    type: registry.model_type,
  };
}

/**
 * Get the next version number
 */
export function getNextVersion(): number {
  const registry = loadTrainingRegistry();
  if (registry.training_history.length === 0) {
    return 1;
  }
  const lastVersion = Math.max(...registry.training_history.map((e) => e.version));
  return lastVersion + 1;
}

/**
 * Register a successful training run and update the base model
 */
export function registerTrainingRun(entry: Omit<ModelRegistryEntry, 'version'>): void {
  const registry = loadTrainingRegistry();

  if (!entry.training_success) {
    return;
  }

  const version = getNextVersion();

  const fullEntry: ModelRegistryEntry = {
    version,
    ...entry,
  };

  // Add to history
  registry.training_history.push(fullEntry);

  // Update current base model if auto-update is enabled
  if (registry.versioning.auto_update_base) {
    registry.current_base_model = entry.output_model_path;
    registry.model_type = 'local';
  }

  saveModelRegistry(registry);
}

/**
 * Reset to original base model (useful for testing or starting fresh)
 */
export function resetToOriginalBase(): void {
  const registry = loadTrainingRegistry();
  registry.current_base_model = registry.original_base_model;
  registry.model_type = 'huggingface';

  saveModelRegistry(registry);
}

/**
 * Get training history summary
 */
export function getTrainingHistory(): ModelRegistryEntry[] {
  const registry = loadTrainingRegistry();
  return registry.training_history;
}

/**
 * Get latest trained model info
 */
export function getLatestModel(): ModelRegistryEntry | null {
  const registry = loadTrainingRegistry();

  if (registry.training_history.length === 0) {
    return null;
  }

  const successfulRuns = registry.training_history.filter((e) => e.training_success);

  if (successfulRuns.length === 0) {
    return null;
  }

  // Return the most recent successful run
  return successfulRuns[successfulRuns.length - 1];
}

/**
 * Check if we're using a locally trained model or the original HuggingFace model
 */
export function isUsingLocalModel(): boolean {
  const registry = loadTrainingRegistry();
  return registry.model_type === 'local';
}
