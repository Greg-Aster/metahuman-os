/**
 * Remote Dispatcher
 *
 * Handles non-blocking remote LLM calls:
 * - RunPod serverless
 * - Big Brother (Claude CLI)
 * - Other remote APIs
 *
 * Tasks are dispatched and callbacks are invoked when responses arrive.
 * The queue continues processing while remote tasks are in-flight.
 */

import fs from 'node:fs';
import path from 'node:path';
import { UnifiedQueueManager } from './unified-queue-manager.js';
import {
  QueuedTask,
  RemoteTaskHandle,
  RemoteResult,
  TaskInput,
} from './types.js';
import { audit } from '../audit.js';
import { systemPaths } from '../path-builder.js';
import type { EscalationRequest } from '../big-brother.js';

// Remote provider types
type RemoteProvider = 'runpod' | 'big-brother' | 'openai' | 'anthropic';

interface ProviderHandler {
  dispatch: (task: QueuedTask) => Promise<any>;
  parseResponse: (response: any, task: QueuedTask) => RemoteResult;
}

export class RemoteDispatcher {
  private queueManager: UnifiedQueueManager;
  private providers: Map<RemoteProvider, ProviderHandler>;
  private defaultTimeoutMs: number = 300000; // 5 minutes

  constructor(queueManager: UnifiedQueueManager) {
    this.queueManager = queueManager;
    this.providers = new Map();

    // Register default providers
    this.registerDefaultProviders();
  }

  /**
   * Register a provider handler
   */
  registerProvider(name: RemoteProvider, handler: ProviderHandler): void {
    this.providers.set(name, handler);
  }

  /**
   * Register default provider handlers
   */
  private registerDefaultProviders(): void {
    // Big Brother (Claude CLI) provider
    this.providers.set('big-brother', {
      dispatch: async (task) => {
        const { escalateToBigBrother } = await import('../big-brother.js');
        const { loadFreshOperatorConfig } = await import('../config.js');
        const operatorConfig = loadFreshOperatorConfig(task.username);
        // Build proper EscalationRequest from task payload
        const request: EscalationRequest = {
          goal: task.input.goal || '',
          stuckReason: task.input.stuckReason || task.input.failureReason || 'unknown',
          errorType: task.input.errorType || null,
          scratchpad: task.input.scratchpad || [],
          context: task.input.context || {},
          suggestions: task.input.suggestions || [],
        };
        return escalateToBigBrother(request, operatorConfig);
      },
      parseResponse: (response, task) => this.parseBigBrotherResponse(response, task),
    });

    // RunPod provider
    this.providers.set('runpod', {
      dispatch: async (task) => {
        return this.dispatchRunPod(task);
      },
      parseResponse: (response, task) => this.parseRunPodResponse(response, task),
    });

    // OpenAI provider (for cloud API fallback)
    this.providers.set('openai', {
      dispatch: async (task) => {
        return this.dispatchOpenAI(task);
      },
      parseResponse: (response, task) => this.parseOpenAIResponse(response, task),
    });
  }

  /**
   * Dispatch a task to the appropriate remote provider
   */
  async dispatch(task: QueuedTask): Promise<void> {
    const provider = this.getProviderForTask(task);
    const handler = this.providers.get(provider);

    if (!handler) {
      throw new Error(`No handler for remote provider: ${provider}`);
    }

    const startTime = Date.now();

    // Track the in-flight task
    const handle: RemoteTaskHandle = {
      taskId: task.id,
      provider,
      startedAt: new Date().toISOString(),
      timeoutMs: task.input.timeoutMs || this.defaultTimeoutMs,
    };
    this.queueManager.trackRemoteTask(handle);

    audit({
      category: 'action',
      event: 'remote_dispatch',
      actor: 'remote_dispatcher',
      level: 'info',
      details: {
        taskId: task.id,
        provider,
        type: task.type,
      },
    });

    try {
      // Dispatch to provider (this is async but we don't await in the queue)
      const response = await handler.dispatch(task);
      const durationMs = Date.now() - startTime;

      // Parse response and create result
      const result = handler.parseResponse(response, task);
      result.durationMs = durationMs;

      audit({
        category: 'action',
        event: 'remote_complete',
        actor: 'remote_dispatcher',
        level: 'info',
        details: {
          taskId: task.id,
          provider,
          durationMs,
          success: result.success,
        },
      });

      // Handle the callback
      this.queueManager.handleRemoteCallback(result);
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = (error as Error).message;

      audit({
        category: 'action',
        event: 'remote_failed',
        actor: 'remote_dispatcher',
        level: 'error',
        details: {
          taskId: task.id,
          provider,
          durationMs,
          error: errorMessage,
        },
      });

      // Create failed result
      const result: RemoteResult = {
        taskId: task.id,
        success: false,
        output: { error: errorMessage },
        durationMs,
      };

      this.queueManager.handleRemoteCallback(result);
    }
  }

  /**
   * Determine which provider to use for a task
   */
  private getProviderForTask(task: QueuedTask): RemoteProvider {
    // Check payload for explicit provider
    if (task.input.provider) {
      return task.input.provider as RemoteProvider;
    }

    // Map task types to providers
    switch (task.type) {
      case 'big_brother_escalation':
        return 'big-brother';
      case 'runpod_inference':
        return 'runpod';
      case 'desire_execute':
        return 'big-brother'; // Desires use Big Brother for complex execution
      case 'code_analyze':
        return 'big-brother'; // Code analysis uses Big Brother
      default:
        return 'runpod'; // Default to RunPod for generic remote inference
    }
  }

  /**
   * Parse Big Brother response into RemoteResult
   */
  private parseBigBrotherResponse(response: any, task: QueuedTask): RemoteResult {
    // Big Brother returns structured suggestions
    const suggestions = response?.suggestions || [];
    const reasoning = response?.reasoning || '';

    // Check if Big Brother suggests follow-up tasks
    const followUpTasks: TaskInput[] = [];

    for (const suggestion of suggestions) {
      // Parse suggestions into potential tasks
      if (suggestion.action === 'run_agent') {
        followUpTasks.push({
          type: suggestion.agentType as any,
          input: suggestion.params || {},
          username: task.username,
          priority: 'high',
          metadata: { triggeredBy: 'big-brother', originalTaskId: task.id },
        });
      }
    }

    return {
      taskId: task.id,
      success: true,
      output: response,
      durationMs: 0, // Will be set by caller

      // Chain execution
      followUpTasks: followUpTasks.length > 0 ? followUpTasks : undefined,
      saveMemory: true,
      memoryType: 'inner_dialogue',
      memoryTags: ['big-brother', 'escalation', 'inner'],
    };
  }

  /**
   * Dispatch to RunPod
   */
  private async dispatchRunPod(task: QueuedTask): Promise<any> {
    // Load RunPod config from etc/runpod.json
    const runpodConfigPath = path.join(systemPaths.etc, 'runpod.json');
    if (!fs.existsSync(runpodConfigPath)) {
      throw new Error('RunPod not configured (missing etc/runpod.json)');
    }

    const config = JSON.parse(fs.readFileSync(runpodConfigPath, 'utf-8'));

    if (!config?.apiKey) {
      throw new Error('RunPod not configured (missing API key in etc/runpod.json)');
    }

    // Determine endpoint (default or tier-specific)
    const tier = task.input.tier || 'default';
    const endpoint = config.endpoints?.[tier] || config.endpoints?.default;
    if (!endpoint) {
      throw new Error(`RunPod endpoint not configured for tier: ${tier}`);
    }

    // Make RunPod API call
    const response = await fetch(`https://api.runpod.ai/v2/${endpoint}/runsync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        input: task.input.input || task.input,
      }),
    });

    if (!response.ok) {
      throw new Error(`RunPod API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Parse RunPod response
   */
  private parseRunPodResponse(response: any, task: QueuedTask): RemoteResult {
    return {
      taskId: task.id,
      success: response.status === 'COMPLETED',
      output: response.output,
      durationMs: 0,
      updateBuffer: task.input.updateBuffer ?? true,
      saveMemory: task.input.saveMemory ?? false,
    };
  }

  /**
   * Dispatch to OpenAI
   */
  private async dispatchOpenAI(task: QueuedTask): Promise<any> {
    // Load OpenAI API key from environment
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OpenAI not configured (missing OPENAI_API_KEY environment variable)');
    }

    const model = task.input.model || 'gpt-4-turbo-preview';
    const messages = task.input.messages || [];

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: task.input.temperature ?? 0.7,
        max_tokens: task.input.max_tokens ?? 2048,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  }

  /**
   * Parse OpenAI response
   */
  private parseOpenAIResponse(response: any, task: QueuedTask): RemoteResult {
    return {
      taskId: task.id,
      success: true,
      output: response,
      durationMs: 0,
      updateBuffer: task.input.updateBuffer ?? true,
    };
  }
}
