import type { APIRoute } from 'astro';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const rootPath = path.resolve(process.cwd(), '../..');
const KOKORO_DIR = path.join(rootPath, 'external', 'kokoro');

/**
 * GET /api/kokoro-addon
 * Check Kokoro installation status
 */
export const GET: APIRoute = async () => {
  try {
    const status = await getKokoroStatus();
    return new Response(JSON.stringify(status), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[API /kokoro-addon GET] Error:', error);
    return new Response(
      JSON.stringify({ error: String(error), installed: false }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

/**
 * POST /api/kokoro-addon
 * Install or uninstall Kokoro
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const { action } = await request.json();

    if (action === 'install') {
      const result = await installKokoro();
      return new Response(JSON.stringify(result), {
        status: result.success ? 200 : 500,
        headers: { 'Content-Type': 'application/json' },
      });
    } else if (action === 'uninstall') {
      const result = await uninstallKokoro();
      return new Response(JSON.stringify(result), {
        status: result.success ? 200 : 500,
        headers: { 'Content-Type': 'application/json' },
      });
    } else {
      return new Response(
        JSON.stringify({ error: 'Invalid action. Use "install" or "uninstall".' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
  } catch (error) {
    console.error('[API /kokoro-addon POST] Error:', error);
    return new Response(
      JSON.stringify({ error: String(error), success: false }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

async function getKokoroStatus(): Promise<{
  installed: boolean;
  venvExists?: boolean;
  serverScriptExists?: boolean;
  diskUsage?: number;
  voicesCount?: number;
}> {
  // Check if Kokoro directory exists
  const installed = fs.existsSync(KOKORO_DIR);

  if (!installed) {
    return { installed: false };
  }

  // Check venv
  const venvExists = fs.existsSync(path.join(KOKORO_DIR, 'venv'));

  // Check server script
  const serverScriptExists = fs.existsSync(path.join(KOKORO_DIR, 'kokoro_server.py'));

  // Calculate disk usage
  const diskUsage = getDirSize(KOKORO_DIR);

  // Count voices in catalog
  let voicesCount = 0;
  const voicesFile = path.join(KOKORO_DIR, 'VOICES.md');
  if (fs.existsSync(voicesFile)) {
    const content = fs.readFileSync(voicesFile, 'utf-8');
    // Count voice entries (simple heuristic)
    const matches = content.match(/`[a-z_]+`/g);
    voicesCount = matches ? matches.length : 0;
  }

  return {
    installed: true,
    venvExists,
    serverScriptExists,
    diskUsage,
    voicesCount,
  };
}

async function installKokoro(): Promise<{
  success: boolean;
  message?: string;
  error?: string;
}> {
  // Check if already installed
  if (fs.existsSync(KOKORO_DIR)) {
    return {
      success: false,
      error: 'Kokoro is already installed. Uninstall first to reinstall.',
    };
  }

  const scriptPath = path.join(rootPath, 'bin', 'install-kokoro.sh');

  if (!fs.existsSync(scriptPath)) {
    return {
      success: false,
      error: 'Installation script not found: ' + scriptPath,
    };
  }

  try {
    // Run installation script
    await new Promise<void>((resolve, reject) => {
      const install = spawn('bash', [scriptPath], {
        cwd: rootPath,
        stdio: 'pipe',
      });

      let stdout = '';
      let stderr = '';

      install.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      install.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      install.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Installation failed (code ${code}):\n${stderr || stdout}`));
        }
      });

      install.on('error', (err) => {
        reject(err);
      });
    });

    return {
      success: true,
      message: 'Kokoro installed successfully!',
    };
  } catch (error) {
    return {
      success: false,
      error: `Installation failed: ${String(error)}`,
    };
  }
}

async function uninstallKokoro(): Promise<{
  success: boolean;
  message?: string;
  error?: string;
}> {
  if (!fs.existsSync(KOKORO_DIR)) {
    return {
      success: true,
      message: 'Kokoro is not installed',
    };
  }

  try {
    // Stop server if running
    const pidFile = path.join(rootPath, 'logs', 'run', 'kokoro-server.pid');
    if (fs.existsSync(pidFile)) {
      try {
        const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
        process.kill(pid, 'SIGTERM');
        fs.unlinkSync(pidFile);
      } catch {
        // Ignore errors stopping server
      }
    }

    // Remove Kokoro directory
    fs.rmSync(KOKORO_DIR, { recursive: true, force: true });

    return {
      success: true,
      message: 'Kokoro uninstalled successfully',
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to uninstall: ${String(error)}`,
    };
  }
}

function getDirSize(dirPath: string): number {
  if (!fs.existsSync(dirPath)) return 0;

  let size = 0;
  const stack = [dirPath];

  while (stack.length > 0) {
    const current = stack.pop()!;
    try {
      const entries = fs.readdirSync(current, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(fullPath);
        } else if (entry.isFile()) {
          size += fs.statSync(fullPath).size;
        }
      }
    } catch {
      // Skip directories we can't read
    }
  }

  return size;
}
