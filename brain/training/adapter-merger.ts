/**
 * Adapter Merger
 * Merges multiple LoRA adapters into a single consolidated adapter
 * Preserves long-term personality while allowing recent adapters to be layered on top
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { ROOT, audit } from '../../packages/core/src/index.js';
import { withUserContext } from '../../packages/core/src/context.js';
import { requireUserInfo } from '../../packages/core/src/user-resolver.js';
import { storage } from '../services/storage-router.js';

interface MergeConfig {
  method: 'linear' | 'ties' | 'dare_ties' | 'slerp';
  weights?: number[];  // Weighting for each adapter (must sum to 1.0)
  outputName?: string;
}

/**
 * Find all Safetensors adapters in the adapters directory
 * We work with .safetensors format for merging, then convert to GGUF
 */
function findAdapters(username: string): string[] {
  const outResult = storage.resolvePath({
    username,
    category: 'output',
    subcategory: 'adapters',
  });
  const adaptersDir = outResult.success && outResult.path ? outResult.path : path.join(ROOT, 'out', 'adapters');
  if (!fs.existsSync(adaptersDir)) {
    console.log(`[adapter-merger] Adapters directory not found: ${adaptersDir}`);
    return [];
  }

  console.log(`[adapter-merger] Searching for adapters in: ${adaptersDir}`);
  const adapters: string[] = [];

  // Look for date-named directories (e.g., 2025-10-21 or 2025-10-21/2025-10-21-123456-abc123)
  const dateDirs = fs.readdirSync(adaptersDir)
    .filter(name => /^\d{4}-\d{2}-\d{2}$/.test(name))
    .sort();

  for (const dateDir of dateDirs) {
    const datePath = path.join(adaptersDir, dateDir);

    // Check for direct adapter_model.safetensors
    const directPath = path.join(datePath, 'adapter_model.safetensors');
    if (fs.existsSync(directPath)) {
      adapters.push(directPath);
      continue;
    }

    // Check for nested run directories (e.g., 2025-10-21-123456-abc123/adapter/)
    const subDirs = fs.readdirSync(datePath).filter(name => {
      const subPath = path.join(datePath, name);
      return fs.statSync(subPath).isDirectory();
    });

    for (const subDir of subDirs) {
      // Check for adapter/adapter_model.safetensors structure
      const nestedPath = path.join(datePath, subDir, 'adapter', 'adapter_model.safetensors');
      if (fs.existsSync(nestedPath)) {
        adapters.push(nestedPath);
      }
    }
  }

  console.log(`[adapter-merger] Found ${adapters.length} adapters`);
  return adapters; // Already sorted chronologically
}

/**
 * Merge adapters using Python mergekit
 * Falls back to simple concatenation if mergekit not available
 */
async function mergeAdapters(
  adapterPaths: string[],
  config: MergeConfig,
  username: string
): Promise<string> {
  const outputName = config.outputName || `merged-${Date.now()}`;
  const outResult = storage.resolvePath({
    username,
    category: 'output',
    subcategory: 'adapters',
  });
  const adaptersDir = outResult.success && outResult.path ? outResult.path : path.join(ROOT, 'out', 'adapters');
  const outputDir = path.join(adaptersDir, outputName);
  fs.mkdirSync(outputDir, { recursive: true });

  audit({
    level: 'info',
    category: 'action',
    event: 'adapter_merge_started',
    details: {
      adapterCount: adapterPaths.length,
      method: config.method,
      outputDir,
    },
    actor: 'adapter-merger',
  });

  // Check if mergekit is available
  let hasMergekit = false;
  try {
    execSync('python3 -c "import mergekit"', { stdio: 'pipe' });
    hasMergekit = true;
  } catch {
    console.warn('[adapter-merger] mergekit not installed, using fallback method');
  }

  if (hasMergekit && adapterPaths.length > 1) {
    // Use mergekit for proper LoRA merging
    return await mergekitMerge(adapterPaths, config, outputDir);
  } else {
    // Fallback: Copy most recent adapter as "merged"
    return fallbackMerge(adapterPaths, outputDir);
  }
}

/**
 * Merge using mergekit library (proper LoRA algebra)
 * Works with Safetensors format, then converts to GGUF
 */
async function mergekitMerge(
  adapterPaths: string[],
  config: MergeConfig,
  outputDir: string
): Promise<string> {
  // Calculate time-based weights (newer = higher weight)
  const weights = config.weights || calculateTimeWeights(adapterPaths);

  const configPath = path.join(outputDir, 'merge-config.yaml');
  const mergedSafetensorsDir = path.join(outputDir, 'merged-safetensors');

  // mergekit config format for LoRA adapters
  // Read base model from training config or use default
  const trainingConfigPath = path.join(ROOT, 'etc', 'training.json');
  let baseModel = 'unsloth/Qwen3-14B';  // Default to current training base
  try {
    if (fs.existsSync(trainingConfigPath)) {
      const trainingConfig = JSON.parse(fs.readFileSync(trainingConfigPath, 'utf-8'));
      baseModel = trainingConfig.base_model || baseModel;
    }
  } catch (e) {
    console.warn('[adapter-merger] Could not read training.json, using default base model');
  }

  console.log(`[adapter-merger] Using base model: ${baseModel}`);

  // LoRA adapter merge config - uses 'models' not 'slices'
  const yaml = `merge_method: ${config.method}
base_model: ${baseModel}
dtype: bfloat16
models:
${adapterPaths.map((p, i) => `  - model: ${path.dirname(p)}
    parameters:
      weight: ${weights[i]}`).join('\n')}
`;

  fs.writeFileSync(configPath, yaml);

  console.log(`[adapter-merger] Merging ${adapterPaths.length} adapters using mergekit...`);
  console.log(`[adapter-merger] Weights:`, weights);
  console.log(`[adapter-merger] Config: ${configPath}`);

  try {
    // Run mergekit to create merged Safetensors
    // Note: --lora-merge-cache speeds up repeated merges, --lazy-unpickle reduces memory
    const command = `cd "${ROOT}" && source venv/bin/activate && python3 -m mergekit.merge "${configPath}" "${mergedSafetensorsDir}" --lora-merge-cache --lazy-unpickle`;
    execSync(command, { stdio: 'inherit', shell: '/bin/bash' });

    // Convert merged Safetensors to GGUF using llama.cpp
    const safetensorsPath = path.join(mergedSafetensorsDir, 'adapter_model.safetensors');
    const ggufPath = path.join(outputDir, 'adapter-merged.gguf');

    if (!fs.existsSync(safetensorsPath)) {
      throw new Error(`Merged safetensors not found at: ${safetensorsPath}`);
    }

    console.log(`[adapter-merger] Converting to GGUF...`);
    convertToGGUF(mergedSafetensorsDir, ggufPath);

    audit({
      level: 'info',
      category: 'action',
      event: 'adapter_merge_completed',
      details: { outputPath: ggufPath, method: 'mergekit', weights },
      actor: 'adapter-merger',
    });

    return ggufPath;
  } catch (error) {
    console.error('[adapter-merger] mergekit failed:', error);
    throw error;
  }
}

/**
 * Calculate time-based weights for adapters
 * Newer adapters get higher weight (exponential decay)
 */
function calculateTimeWeights(adapterPaths: string[]): number[] {
  const baseWeight = 0.9; // Decay factor per week
  const weights: number[] = [];

  // Oldest adapter gets lowest weight
  for (let i = 0; i < adapterPaths.length; i++) {
    const ageInAdapters = adapterPaths.length - 1 - i;
    weights.push(Math.pow(baseWeight, ageInAdapters));
  }

  // Normalize weights to sum to 1.0
  const sum = weights.reduce((a, b) => a + b, 0);
  return weights.map(w => w / sum);
}

/**
 * Convert Safetensors adapter to GGUF using llama.cpp's convert script
 * Tries multiple methods in order of preference
 */
function convertToGGUF(safetensorsDir: string, ggufOutputPath: string): void {
  const llamaCppPath = path.join(ROOT, 'vendor', 'llama.cpp');
  const convertScript = path.join(llamaCppPath, 'convert_lora_to_gguf.py');

  // Method 1: Use llama.cpp's LoRA-specific converter (preferred)
  if (fs.existsSync(convertScript)) {
    try {
      console.log(`[adapter-merger] Using llama.cpp LoRA converter: ${convertScript}`);
      const command = `cd "${ROOT}" && source venv/bin/activate && python3 "${convertScript}" "${safetensorsDir}" --outfile "${ggufOutputPath}"`;
      execSync(command, { stdio: 'inherit', shell: '/bin/bash' });
      return;
    } catch (error) {
      console.warn('[adapter-merger] llama.cpp LoRA converter failed, trying alternative...');
    }
  }

  // Method 2: Try the general convert script
  const generalConvertScript = path.join(llamaCppPath, 'convert_hf_to_gguf.py');
  if (fs.existsSync(generalConvertScript)) {
    try {
      console.log(`[adapter-merger] Using llama.cpp HF converter: ${generalConvertScript}`);
      const command = `cd "${ROOT}" && source venv/bin/activate && python3 "${generalConvertScript}" "${safetensorsDir}" --outfile "${ggufOutputPath}" --outtype f16`;
      execSync(command, { stdio: 'inherit', shell: '/bin/bash' });
      return;
    } catch (error) {
      console.warn('[adapter-merger] llama.cpp HF converter failed');
    }
  }

  // Method 3: Keep safetensors as-is if no converter available
  // Note: This will NOT work with Ollama - just preserves the merged adapter
  const safetensorsPath = path.join(safetensorsDir, 'adapter_model.safetensors');
  if (fs.existsSync(safetensorsPath)) {
    const safetensorsOutput = ggufOutputPath.replace('.gguf', '.safetensors');
    fs.copyFileSync(safetensorsPath, safetensorsOutput);
    console.warn(`[adapter-merger] GGUF conversion not available. Saved safetensors to: ${safetensorsOutput}`);
    console.warn('[adapter-merger] To use with Ollama, install llama.cpp and run: convert_lora_to_gguf.py');
    throw new Error('GGUF conversion failed - llama.cpp not found. Safetensors preserved for manual conversion.');
  }

  throw new Error('No adapter files found to convert');
}

/**
 * Fallback: Copy the most recent adapter as the "merged" version
 * This is used when mergekit isn't available
 */
function fallbackMerge(adapterPaths: string[], outputDir: string): string {
  if (adapterPaths.length === 0) {
    throw new Error('No adapters to merge');
  }

  // Use the most recent adapter's GGUF file
  const latestSafetensors = adapterPaths[adapterPaths.length - 1];
  const latestGGUF = path.join(path.dirname(latestSafetensors), 'adapter.gguf');
  const outputPath = path.join(outputDir, 'adapter-merged.gguf');

  console.log(`[adapter-merger] Fallback: copying latest adapter as merged version`);
  console.log(`[adapter-merger] Source: ${latestGGUF}`);

  if (!fs.existsSync(latestGGUF)) {
    throw new Error(`Latest GGUF adapter not found: ${latestGGUF}`);
  }

  fs.mkdirSync(outputDir, { recursive: true });
  fs.copyFileSync(latestGGUF, outputPath);

  audit({
    level: 'warn',
    category: 'action',
    event: 'adapter_merge_fallback',
    details: { outputPath, source: latestGGUF },
    actor: 'adapter-merger',
  });

  return outputPath;
}

/**
 * Main merge workflow (runs within user context)
 * - Find all historical adapters (excluding most recent)
 * - Merge them into a single "history" adapter
 * - Keep the most recent adapter separate
 */
async function mainWithContext(username: string) {
  const args = process.argv.slice(2);
  const allAdapters = findAdapters(username);

  if (allAdapters.length === 0) {
    console.error('[adapter-merger] No adapters found to merge');
    process.exit(1);
  }

  if (allAdapters.length === 1) {
    console.log('[adapter-merger] Only one adapter exists, no merge needed');
    process.exit(0);
  }

  // Keep the most recent adapter separate, merge all others
  const recentAdapter = allAdapters[allAdapters.length - 1];
  const historicalAdapters = allAdapters.slice(0, -1);

  console.log(`[adapter-merger] Found ${allAdapters.length} adapters`);
  console.log(`[adapter-merger] Recent (kept separate): ${path.basename(path.dirname(recentAdapter))}`);
  console.log(`[adapter-merger] Historical (to merge): ${historicalAdapters.length}`);

  if (historicalAdapters.length === 0) {
    console.log('[adapter-merger] No historical adapters to merge');
    process.exit(0);
  }

  // Merge historical adapters
  const mergeConfig: MergeConfig = {
    method: args.includes('--ties') ? 'ties' : 'linear',
    outputName: 'history-merged',
  };

  const mergedPath = await mergeAdapters(historicalAdapters, mergeConfig, username);
  const recentGGUF = path.join(path.dirname(recentAdapter), 'adapter.gguf');

  console.log(`\n✅ Merge complete!`);
  console.log(`\nHistorical adapter (GGUF): ${mergedPath}`);
  console.log(`Recent adapter (GGUF): ${recentGGUF}`);
  console.log(`\nTo create a dual-adapter model, use:`);
  console.log(`./bin/mh adapter activate ${path.basename(path.dirname(recentAdapter))}`);
  console.log(`\nOr manually create a modelfile:`);
  console.log(`FROM <your-base-model>:latest
ADAPTER ${mergedPath}
ADAPTER ${recentGGUF}`);
}

/**
 * CLI entry point - parses --username and establishes user context
 */
async function main() {
  const args = process.argv.slice(2);
  let username: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--username' && i + 1 < args.length) {
      username = args[i + 1];
      break;
    }
  }

  if (!username) {
    console.error('[adapter-merger] ERROR: --username <name> is required');
    console.error('\nUsage: npx tsx brain/agents/adapter-merger.ts --username <username>');
    process.exit(1);
  }

  const userInfo = requireUserInfo(username);
  console.log(`[adapter-merger] Starting for user: ${username}`);

  await withUserContext(userInfo, () => mainWithContext(username));
}

main().catch((err: Error) => {
  console.error('[adapter-merger] Fatal error:', err);
  audit({
    level: 'error',
    category: 'action',
    event: 'adapter_merge_failed',
    details: { error: String(err) },
    actor: 'adapter-merger',
  });
  process.exit(1);
});
