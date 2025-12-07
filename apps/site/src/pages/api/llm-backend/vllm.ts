/**
 * vLLM Server Control API
 *
 * POST: Control vLLM server (start, stop, restart, cleanup, gpu_check)
 */

import type { APIRoute } from 'astro';
import {
  getAuthenticatedUser,
  vllm,
  loadBackendConfig,
  cleanupVLLMProcesses,
  checkVLLMGPUMemory,
} from '@metahuman/core';
import { requireOwner } from '../../../middleware/cognitiveModeGuard';

interface VLLMAction {
  action: 'start' | 'stop' | 'restart' | 'status' | 'cleanup' | 'gpu_check';
  model?: string;
  gpuMemoryUtilization?: number;
}

const handler: APIRoute = async ({ cookies, request }) => {
  try {
    getAuthenticatedUser(cookies);
    const body = await request.json() as VLLMAction;

    const config = loadBackendConfig();

    switch (body.action) {
      case 'status': {
        const health = await vllm.getHealth();
        return new Response(JSON.stringify(health), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      case 'start': {
        const result = await vllm.startServer({
          endpoint: config.vllm.endpoint,
          model: body.model || config.vllm.model,
          gpuMemoryUtilization: body.gpuMemoryUtilization || config.vllm.gpuMemoryUtilization,
          maxModelLen: config.vllm.maxModelLen,
          tensorParallelSize: config.vllm.tensorParallelSize,
          dtype: config.vllm.dtype,
          quantization: config.vllm.quantization,
          enforceEager: config.vllm.enforceEager,
          autoUtilization: config.vllm.autoUtilization,
          enableThinking: config.vllm.enableThinking,
        });

        return new Response(JSON.stringify({
          success: result.success,
          pid: result.pid,
          error: result.error,
        }), {
          status: result.success ? 200 : 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      case 'stop': {
        await vllm.stopServer();
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      case 'restart': {
        await vllm.stopServer();
        const result = await vllm.startServer({
          endpoint: config.vllm.endpoint,
          model: body.model || config.vllm.model,
          gpuMemoryUtilization: body.gpuMemoryUtilization || config.vllm.gpuMemoryUtilization,
          maxModelLen: config.vllm.maxModelLen,
          tensorParallelSize: config.vllm.tensorParallelSize,
          dtype: config.vllm.dtype,
          quantization: config.vllm.quantization,
          enforceEager: config.vllm.enforceEager,
          autoUtilization: config.vllm.autoUtilization,
          enableThinking: config.vllm.enableThinking,
        });

        return new Response(JSON.stringify({
          success: result.success,
          pid: result.pid,
          error: result.error,
        }), {
          status: result.success ? 200 : 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      case 'cleanup': {
        await cleanupVLLMProcesses();
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      case 'gpu_check': {
        const utilization = body.gpuMemoryUtilization || config.vllm.gpuMemoryUtilization;
        const result = await checkVLLMGPUMemory(utilization);
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      default:
        return new Response(JSON.stringify({
          error: 'Invalid action. Must be "start", "stop", "restart", "status", "cleanup", or "gpu_check"',
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status = message.includes('Not authenticated') ? 401 : 500;

    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const POST = requireOwner(handler);
