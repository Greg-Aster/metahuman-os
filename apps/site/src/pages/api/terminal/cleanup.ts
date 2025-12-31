import type { APIRoute } from 'astro';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export const POST: APIRoute = async () => {
  try {
    // Kill all ttyd processes
    const { stdout, stderr } = await execAsync('pkill -f ttyd || true');
    
    return new Response(JSON.stringify({
      success: true,
      message: 'All terminal processes cleaned up',
      output: stdout
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('[Terminal Cleanup] Error:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Failed to cleanup terminals'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

export const GET: APIRoute = async () => {
  try {
    // List all running ttyd processes
    const { stdout } = await execAsync('pgrep -fa ttyd || echo "No terminals running"');
    
    const lines = stdout.trim().split('\n').filter(line => line && !line.includes('No terminals running'));
    const terminals = lines.map(line => {
      const match = line.match(/--port (\d+)/);
      return {
        pid: line.split(' ')[0],
        port: match ? match[1] : 'unknown',
        command: line
      };
    });
    
    return new Response(JSON.stringify({
      count: terminals.length,
      terminals,
      maxTerminals: 10
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('[Terminal Status] Error:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Failed to get terminal status'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};