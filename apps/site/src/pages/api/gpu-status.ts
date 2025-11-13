import type { APIRoute } from 'astro';
import { execSync } from 'node:child_process';

export const GET: APIRoute = async () => {
  try {
    // Check if nvidia-smi is available
    let hasGPU = false;
    try {
      execSync('which nvidia-smi', { stdio: 'pipe' });
      hasGPU = true;
    } catch {
      return new Response(
        JSON.stringify({
          available: false,
          error: 'No NVIDIA GPU detected (nvidia-smi not found)',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Get GPU information
    const gpuQuery = execSync(
      'nvidia-smi --query-gpu=index,name,memory.total,memory.used,memory.free,utilization.gpu,utilization.memory --format=csv,noheader,nounits',
      { encoding: 'utf-8' }
    );

    const lines = gpuQuery.trim().split('\n');
    const gpus = lines.map(line => {
      const [index, name, total, used, free, gpuUtil, memUtil] = line
        .split(',')
        .map(s => s.trim());

      const totalNum = parseInt(total, 10);
      const usedNum = parseInt(used, 10);
      const freeNum = parseInt(free, 10);

      return {
        index: parseInt(index, 10),
        name,
        memory: {
          total: totalNum,
          used: usedNum,
          free: freeNum,
          usedPercent: Math.round((usedNum * 100) / totalNum),
          freePercent: Math.round((freeNum * 100) / totalNum),
        },
        utilization: {
          gpu: parseInt(gpuUtil, 10),
          memory: parseInt(memUtil, 10),
        },
      };
    });

    // Check if Ollama is running
    let ollamaRunning = false;
    let ollamaPid: number | null = null;
    let ollamaVramLimit: string | null = null;

    try {
      const pidOutput = execSync('pgrep -f ollama', { encoding: 'utf-8', stdio: 'pipe' });
      ollamaPid = parseInt(pidOutput.trim().split('\n')[0], 10);
      ollamaRunning = true;

      // Check if systemd service has VRAM limit configured
      try {
        const serviceActive = execSync('systemctl is-active ollama 2>/dev/null || echo inactive', {
          encoding: 'utf-8',
        }).trim();

        if (serviceActive === 'active') {
          try {
            const limitConfig = execSync(
              'grep OLLAMA_GPU_MEM_FRACTION /etc/systemd/system/ollama.service.d/gpu-mem-limit.conf 2>/dev/null || echo ""',
              { encoding: 'utf-8' }
            ).trim();

            if (limitConfig) {
              const match = limitConfig.match(/OLLAMA_GPU_MEM_FRACTION=["']?([0-9.]+)["']?/);
              if (match) {
                ollamaVramLimit = match[1];
              }
            }
          } catch {
            // Config file doesn't exist
          }
        }
      } catch {
        // systemd not available or ollama not a service
      }
    } catch {
      // Ollama not running
    }

    // Get GPU processes
    let processes: Array<{ pid: number; name: string; memory: number }> = [];
    try {
      const processOutput = execSync(
        'nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv,noheader',
        { encoding: 'utf-8', stdio: 'pipe' }
      );

      processes = processOutput
        .trim()
        .split('\n')
        .filter(line => line)
        .map(line => {
          const [pid, name, mem] = line.split(',').map(s => s.trim());
          return {
            pid: parseInt(pid, 10),
            name,
            memory: parseInt(mem, 10),
          };
        });
    } catch {
      // No processes or query failed
    }

    // Generate recommendations
    const recommendations = [];
    const primaryGPU = gpus[0];

    if (primaryGPU.memory.free < 3000) {
      recommendations.push({
        level: 'critical',
        message: `Low free VRAM (${primaryGPU.memory.free}MB). Reduce Ollama VRAM usage or limit may cause OOM errors.`,
        action: 'configure-vram',
      });
    } else if (primaryGPU.memory.free < 4000) {
      recommendations.push({
        level: 'warning',
        message: `Limited free VRAM (${primaryGPU.memory.free}MB). RVC may compete with Ollama for VRAM.`,
        action: 'configure-vram',
      });
    } else {
      recommendations.push({
        level: 'success',
        message: `Sufficient free VRAM (${primaryGPU.memory.free}MB) for RVC inference.`,
        action: null,
      });
    }

    if (ollamaRunning && !ollamaVramLimit) {
      recommendations.push({
        level: 'info',
        message: 'Ollama VRAM limit not configured. Consider setting a limit for better GPU sharing.',
        action: 'configure-vram',
      });
    }

    return new Response(
      JSON.stringify({
        available: true,
        gpus,
        ollama: {
          running: ollamaRunning,
          pid: ollamaPid,
          vramLimit: ollamaVramLimit,
        },
        processes,
        recommendations,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('[gpu-status API] Error:', error);
    return new Response(
      JSON.stringify({
        available: false,
        error: String(error),
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
