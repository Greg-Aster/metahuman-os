import {
  audit,
  readEnvironmentBridgeState,
  setEnvironmentBridgeEnabled,
  summarizeEnvironmentBridgeState,
} from '@metahuman/core';
import type { AgentContext, AgentInput, AgentResult } from '@metahuman/agent-runtime';

export interface EnvironmentBridgeAgentOptions {
  once?: boolean;
  pollMs?: number;
  maxIdleMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function readOptions(args: string[], rawOptions: Record<string, unknown> | undefined = {}): EnvironmentBridgeAgentOptions {
  const pollArg = args.find(arg => arg.startsWith('--poll-ms='));
  const idleArg = args.find(arg => arg.startsWith('--max-idle-ms='));

  return {
    once: args.includes('--once') || rawOptions.once === true,
    pollMs: pollArg ? Number(pollArg.split('=')[1]) : Number(rawOptions?.pollMs ?? 1000),
    maxIdleMs: idleArg ? Number(idleArg.split('=')[1]) : Number(rawOptions?.maxIdleMs ?? 0),
  };
}

export async function runEnvironmentBridgeAgent(options: EnvironmentBridgeAgentOptions = {}): Promise<AgentResult> {
  const start = Date.now();
  const pollMs = Number.isFinite(options.pollMs) && options.pollMs! >= 250 ? options.pollMs! : 1000;
  const maxIdleMs = Number.isFinite(options.maxIdleMs) ? Math.max(0, options.maxIdleMs!) : 0;
  let cycles = 0;
  let lastActiveAt = Date.now();

  setEnvironmentBridgeEnabled(true);
  audit({
    level: 'info',
    category: 'system',
    event: 'environment_bridge_agent_started',
    details: { pollMs, maxIdleMs, once: options.once === true },
  });

  try {
    while (true) {
      cycles += 1;
      const summary = summarizeEnvironmentBridgeState(readEnvironmentBridgeState());
      const hasActivity = summary.sessionCount > 0 || summary.queuedActionCount > 0;
      if (hasActivity) {
        lastActiveAt = Date.now();
      }

      console.log(
        `[environment-bridge] enabled=${summary.enabled} sessions=${summary.sessionCount} queued=${summary.queuedActionCount}`,
      );

      if (options.once) {
        return {
          success: true,
          data: { summary, cycles },
          duration: Date.now() - start,
          itemsProcessed: summary.queuedActionCount,
        };
      }

      if (maxIdleMs > 0 && Date.now() - lastActiveAt >= maxIdleMs) {
        return {
          success: true,
          data: { summary, cycles, reason: 'idle-timeout' },
          duration: Date.now() - start,
          itemsProcessed: summary.queuedActionCount,
        };
      }

      await sleep(pollMs);
    }
  } finally {
    setEnvironmentBridgeEnabled(false);
    audit({
      level: 'info',
      category: 'system',
      event: 'environment_bridge_agent_stopped',
      details: { cycles, durationMs: Date.now() - start },
    });
  }
}

export async function run(_ctx: AgentContext, input: AgentInput): Promise<AgentResult> {
  const args = input.args ?? [];
  const options = readOptions(args, input.options as Record<string, unknown> | undefined);
  return runEnvironmentBridgeAgent(options);
}
