import type { APIRoute } from 'astro';
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const rootPath = path.resolve(process.cwd(), '../..');
const RVC_DIR = path.join(rootPath, 'external', 'applio-rvc');

/**
 * GET /api/rvc-addon
 * Check RVC installation status
 */
export const GET: APIRoute = async () => {
  try {
    const status = await getRVCStatus();
    return new Response(JSON.stringify(status), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[API /rvc-addon GET] Error:', error);
    return new Response(
      JSON.stringify({ error: String(error), installed: false }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

/**
 * POST /api/rvc-addon
 * Install or uninstall RVC
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const { action } = await request.json();

    if (action === 'install') {
      const result = await installRVC();
      return new Response(JSON.stringify(result), {
        status: result.success ? 200 : 500,
        headers: { 'Content-Type': 'application/json' },
      });
    } else if (action === 'uninstall') {
      const result = await uninstallRVC();
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
    console.error('[API /rvc-addon POST] Error:', error);
    return new Response(
      JSON.stringify({ error: String(error), success: false }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

async function getRVCStatus(): Promise<{
  installed: boolean;
  venvExists?: boolean;
  inferScriptExists?: boolean;
  diskUsage?: number;
  modelsCount?: number;
}> {
  // Check if RVC directory exists
  const installed = fs.existsSync(RVC_DIR);

  if (!installed) {
    return { installed: false };
  }

  // Check venv
  const venvExists = fs.existsSync(path.join(RVC_DIR, 'venv'));

  // Check inference script
  const inferScriptExists = fs.existsSync(path.join(RVC_DIR, 'infer.py'));

  // Calculate disk usage
  const diskUsage = getDirSize(RVC_DIR);

  // Count trained models
  const modelsDir = path.join(rootPath, 'out', 'voices', 'rvc');
  let modelsCount = 0;
  if (fs.existsSync(modelsDir)) {
    modelsCount = fs.readdirSync(modelsDir).filter(f => {
      const modelPath = path.join(modelsDir, f, 'models', `${f}.pth`);
      return fs.existsSync(modelPath);
    }).length;
  }

  return {
    installed: true,
    venvExists,
    inferScriptExists,
    diskUsage,
    modelsCount,
  };
}

async function installRVC(): Promise<{
  success: boolean;
  message?: string;
  error?: string;
}> {
  // Check if already installed
  if (fs.existsSync(RVC_DIR)) {
    return {
      success: false,
      error: 'RVC is already installed. Uninstall first to reinstall.',
    };
  }

  const scriptPath = path.join(rootPath, 'bin', 'install-rvc.sh');

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
      message: 'RVC installed successfully!',
    };
  } catch (error) {
    return {
      success: false,
      error: `Installation failed: ${String(error)}`,
    };
  }
}

async function uninstallRVC(): Promise<{
  success: boolean;
  message?: string;
  error?: string;
}> {
  if (!fs.existsSync(RVC_DIR)) {
    return {
      success: true,
      message: 'RVC is not installed',
    };
  }

  try {
    // Remove RVC directory
    fs.rmSync(RVC_DIR, { recursive: true, force: true });

    return {
      success: true,
      message: 'RVC uninstalled successfully',
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
