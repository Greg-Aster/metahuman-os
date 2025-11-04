/**
 * GGUF Converter Agent
 * Converts LoRA adapters from safetensors to GGUF format for Ollama
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { paths, audit } from '../../packages/core/src/index.js';

const DATASET_DATE = process.argv[2];

if (!DATASET_DATE) {
  console.error('Usage: tsx gguf-converter.ts <dataset-date>');
  console.error('Example: tsx gguf-converter.ts 2025-10-21');
  process.exit(1);
}

const datasetDir = path.join(paths.out, 'adapters', DATASET_DATE);
const adapterPath = path.join(datasetDir, 'adapter_model.safetensors');
const ggufPath = path.join(datasetDir, 'adapter.gguf');
const llamaCppPath = path.join(paths.root, 'vendor', 'llama.cpp');
const convertScript = path.join(llamaCppPath, 'convert_lora_to_gguf.py');

/**
 * Validate adapter exists
 */
function validateAdapter() {
  if (!fs.existsSync(adapterPath)) {
    console.error(`Adapter not found: ${adapterPath}`);
    console.error('Run training first: mh adapter train <date>');
    process.exit(1);
  }

  console.log(`[gguf-converter] Found adapter: ${adapterPath}`);
  const sizeInMB = (fs.statSync(adapterPath).size / 1024 / 1024).toFixed(2);
  console.log(`[gguf-converter] Adapter size: ${sizeInMB} MB\n`);
}

/**
 * Ensure llama.cpp is available
 */
function ensureLlamaCpp() {
  if (!fs.existsSync(llamaCppPath)) {
    console.log('[gguf-converter] llama.cpp not found. Cloning repository...');
    try {
      execSync(`git clone https://github.com/ggml-org/llama.cpp.git "${llamaCppPath}"`, {
        stdio: 'inherit',
        cwd: path.join(paths.root, 'vendor'),
      });
      console.log('[gguf-converter] ✓ llama.cpp cloned successfully\n');
    } catch (error) {
      console.error('[gguf-converter] Failed to clone llama.cpp:', (error as Error).message);
      process.exit(1);
    }
  }

  if (!fs.existsSync(convertScript)) {
    console.error(`[gguf-converter] Conversion script not found: ${convertScript}`);
    process.exit(1);
  }

  console.log('[gguf-converter] ✓ llama.cpp found\n');
}

/**
 * Check if Python dependencies are installed
 */
function checkPythonDeps() {
  try {
    // Check if gguf package is installed
    execSync('python3 -c "import gguf"', { stdio: 'pipe' });
    console.log('[gguf-converter] ✓ Python dependencies satisfied\n');
  } catch {
    console.log('[gguf-converter] Installing Python dependencies...');
    try {
      const venvPython = path.join(paths.root, 'venv', 'bin', 'python3');
      const pipCmd = fs.existsSync(venvPython)
        ? `"${venvPython}" -m pip install gguf`
        : 'pip3 install gguf';

      execSync(pipCmd, { stdio: 'inherit' });
      console.log('[gguf-converter] ✓ Dependencies installed\n');
    } catch (error) {
      console.error('[gguf-converter] Failed to install dependencies:', (error as Error).message);
      process.exit(1);
    }
  }
}

/**
 * Convert adapter to GGUF
 */
function convertToGGUF() {
  console.log('[gguf-converter] Converting adapter to GGUF format...\n');

  audit({
    level: 'info',
    category: 'action',
    event: 'gguf_conversion_started',
    details: { dataset: DATASET_DATE, adapterPath, ggufPath },
    actor: 'gguf-converter',
  });

  try {
    const venvPython = path.join(paths.root, 'venv', 'bin', 'python3');
    const pythonCmd = fs.existsSync(venvPython) ? venvPython : 'python3';

    execSync(
      `${pythonCmd} "${convertScript}" "${datasetDir}" --outfile "${ggufPath}"`,
      {
        stdio: 'inherit',
        cwd: llamaCppPath,
        env: { ...process.env, PYTHONPATH: llamaCppPath },
      }
    );

    console.log('\n[gguf-converter] ✓ Conversion completed successfully');

    const ggufSizeInMB = (fs.statSync(ggufPath).size / 1024 / 1024).toFixed(2);
    console.log(`[gguf-converter] GGUF adapter: ${ggufPath}`);
    console.log(`[gguf-converter] GGUF size: ${ggufSizeInMB} MB\n`);

    audit({
      level: 'info',
      category: 'action',
      event: 'gguf_conversion_completed',
      details: {
        dataset: DATASET_DATE,
        ggufPath,
        sizeBytes: fs.statSync(ggufPath).size
      },
      actor: 'gguf-converter',
    });

    return true;
  } catch (error) {
    console.error('\n[gguf-converter] ✗ Conversion failed:', (error as Error).message);

    audit({
      level: 'error',
      category: 'action',
      event: 'gguf_conversion_failed',
      details: { dataset: DATASET_DATE, error: (error as Error).message },
      actor: 'gguf-converter',
    });

    process.exit(1);
  }
}

/**
 * Main execution
 */
async function main() {
  console.log(`[gguf-converter] Converting LoRA adapter to GGUF: ${DATASET_DATE}\n`);

  validateAdapter();
  ensureLlamaCpp();
  checkPythonDeps();
  convertToGGUF();

  console.log('[gguf-converter] ✓ Adapter is ready for Ollama');
  console.log(`[gguf-converter] Load with: ollama create greg-${DATASET_DATE} -f ${path.join(datasetDir, 'Modelfile')}\n`);
}

main().catch(err => {
  console.error('[gguf-converter] Fatal error:', err);
  audit({
    level: 'error',
    category: 'action',
    event: 'gguf_converter_crashed',
    details: { error: String(err) },
    actor: 'gguf-converter',
  });
  process.exit(1);
});
