import type { APIRoute } from 'astro';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * POST /api/addons/install
 * Install an addon
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const { addonId } = await request.json();

    if (!addonId) {
      return new Response(
        JSON.stringify({ error: 'Missing addonId' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Load addon configuration using system paths
    const rootPath = path.resolve(process.cwd(), '../..');
    const addonsConfigPath = path.join(rootPath, 'etc', 'addons.json');
    const config = JSON.parse(fs.readFileSync(addonsConfigPath, 'utf-8'));
    const addon = config.addons[addonId];

    if (!addon) {
      return new Response(
        JSON.stringify({ error: 'Addon not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Execute installation
    const result = await installAddon(addonId, addon);

    if (!result.success) {
      return new Response(
        JSON.stringify({ error: result.error }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Update addon status
    addon.installed = true;
    fs.writeFileSync(addonsConfigPath, JSON.stringify(config, null, 2));

    return new Response(
      JSON.stringify({ success: true, message: result.message }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[API /addons/install] Error:', error);
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

async function installAddon(addonId: string, addon: any): Promise<{ success: boolean; error?: string; message?: string }> {
  const rootPath = path.resolve(process.cwd(), '../..');

  switch (addonId) {
    case 'gpt-sovits': {
      // Run installation script
      const scriptPath = path.join(rootPath, 'bin', 'install-sovits.sh');

      if (!fs.existsSync(scriptPath)) {
        return { success: false, error: 'Installation script not found' };
      }

      try {
        await runScript(scriptPath);

        // Install Python dependencies
        const pipPackages = addon.dependencies?.pip || [];
        if (pipPackages.length > 0) {
          await installPipPackages(pipPackages);
        }

        return { success: true, message: 'GPT-SoVITS installed successfully' };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }

    case 'rvc': {
      // Run RVC installation script
      const scriptPath = path.join(rootPath, 'bin', 'install-rvc.sh');

      if (!fs.existsSync(scriptPath)) {
        return { success: false, error: 'RVC installation script not found' };
      }

      try {
        await runScript(scriptPath);
        return { success: true, message: 'RVC installed successfully' };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }

    case 'kokoro': {
      // Run Kokoro installation script
      const scriptPath = path.join(rootPath, 'bin', 'install-kokoro.sh');

      if (!fs.existsSync(scriptPath)) {
        return { success: false, error: 'Kokoro installation script not found' };
      }

      try {
        await runScriptWithArgs(scriptPath, ['--yes']);
        return { success: true, message: 'Kokoro TTS installed successfully' };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }

    default:
      return { success: false, error: 'Addon installation not implemented' };
  }
}

function runScript(scriptPath: string): Promise<void> {
  return runScriptWithArgs(scriptPath, []);
}

function runScriptWithArgs(scriptPath: string, args: string[]): Promise<void> {
  const rootPath = path.resolve(process.cwd(), '../..');

  return new Promise((resolve, reject) => {
    const proc = spawn('bash', [scriptPath, ...args], {
      cwd: rootPath,
      stdio: 'pipe',
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
      console.log('[Install Script]', data.toString().trim());
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
      console.error('[Install Script Error]', data.toString().trim());
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Script failed with code ${code}: ${stderr || stdout}`));
      }
    });

    proc.on('error', (error) => {
      reject(error);
    });
  });
}

function installPipPackages(packages: string[]): Promise<void> {
  const rootPath = path.resolve(process.cwd(), '../..');

  return new Promise((resolve, reject) => {
    const pythonCandidates = ['python3', 'python'];
    let pythonCmd = 'python3';

    for (const cmd of pythonCandidates) {
      try {
        require('child_process').execSync(`command -v ${cmd}`, { encoding: 'utf-8' });
        pythonCmd = cmd;
        break;
      } catch {
        // Try next
      }
    }

    const proc = spawn(pythonCmd, ['-m', 'pip', 'install', ...packages], {
      cwd: rootPath,
      stdio: 'pipe',
    });

    let stderr = '';
    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`pip install failed with code ${code}: ${stderr}`));
      }
    });

    proc.on('error', (error) => {
      reject(error);
    });
  });
}
