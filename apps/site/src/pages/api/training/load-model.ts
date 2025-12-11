import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import {
  getAuthenticatedUser,
  getProfilePaths,
  systemPaths,
  audit,
} from '@metahuman/core';

/**
 * POST /api/training/load-model
 * Loads trained models into Ollama after training completes
 * Supports loading: merged model, LoRA adapter, or both
 */
export const POST: APIRoute = async ({ cookies, request }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    const profilePaths = getProfilePaths(user.username);
    const { modelType } = await request.json() as { modelType: 'merged' | 'adapter' | 'both' };

    // Find the most recent training output
    const adaptersDir = path.join(profilePaths.out, 'adapters');
    if (!fs.existsSync(adaptersDir)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'No training outputs found',
        }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get all date directories, sorted by date (most recent first)
    const dates = fs.readdirSync(adaptersDir)
      .filter(d => d.match(/^\d{4}-\d{2}-\d{2}$/))
      .sort()
      .reverse();

    if (dates.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'No training outputs found',
        }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Find the most recent date with training outputs
    let recentRun: string | null = null;
    let recentDate: string | null = null;
    for (const date of dates) {
      const datePath = path.join(adaptersDir, date);
      const runs = fs.readdirSync(datePath)
        .filter(r => fs.statSync(path.join(datePath, r)).isDirectory())
        .sort()
        .reverse();

      if (runs.length > 0) {
        recentDate = date;
        recentRun = runs[0];
        break;
      }
    }

    if (!recentRun || !recentDate) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'No recent training run found',
        }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const runDir = path.join(adaptersDir, recentDate, recentRun);
    const mergedGgufPath = path.join(runDir, 'adapter.gguf');
    const adapterDir = path.join(runDir, 'adapter');

    // Validate files exist
    const hasMerged = fs.existsSync(mergedGgufPath);
    const hasAdapter = fs.existsSync(adapterDir) && fs.existsSync(path.join(adapterDir, 'adapter_model.safetensors'));

    if (!hasMerged && !hasAdapter) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'No trained model files found in recent run',
        }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const modelName = `${user.username}-${recentDate}-${recentRun}`;
    const messages: string[] = [];

    // Check if Ollama is running
    try {
      execSync('ollama list', { stdio: 'ignore' });
    } catch {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Ollama server not running. Please start Ollama first.',
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Load merged model
    if ((modelType === 'merged' || modelType === 'both') && hasMerged) {
      const modelfilePath = path.join(runDir, 'Modelfile');

      // Create or verify Modelfile exists
      if (!fs.existsSync(modelfilePath)) {
        const modelfileContent = `# MetaHuman OS Fully-Merged Model - ${user.username} - ${recentDate}
FROM ${mergedGgufPath}

TEMPLATE """{{ if .System }}<|im_start|>system
{{ .System }}<|im_end|>
{{ end }}{{ if .Prompt }}<|im_start|>user
{{ .Prompt }}<|im_end|>
{{ end }}<|im_start|>assistant
{{ .Response }}<|im_end|>
"""

SYSTEM You are ${user.username}'s digital personality extension. Speak naturally in first person as ${user.username}.`;
        fs.writeFileSync(modelfilePath, modelfileContent);
      }

      try {
        execSync(`ollama create ${modelName} -f "${modelfilePath}"`, { stdio: 'inherit' });
        messages.push(`Merged model loaded as: ${modelName}`);

        audit({
          level: 'info',
          category: 'action',
          event: 'model_loaded',
          details: { modelType: 'merged', modelName, runDir },
          actor: user.username,
        });
      } catch (error) {
        return new Response(
          JSON.stringify({
            success: false,
            error: `Failed to load merged model: ${(error as Error).message}`,
          }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    // Load adapter (would require base model + adapter loading setup)
    if ((modelType === 'adapter' || modelType === 'both') && hasAdapter) {
      // For now, adapters need to be loaded via the adapter management system
      // This is a placeholder for future adapter-only loading
      messages.push('LoRA adapter available in adapter management system');

      audit({
        level: 'info',
        category: 'action',
        event: 'adapter_noted',
        details: { modelType: 'adapter', adapterPath: adapterDir },
        actor: user.username,
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: messages.join('. '),
        modelName,
        runDir,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[load-model] Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: (error as Error).message,
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
