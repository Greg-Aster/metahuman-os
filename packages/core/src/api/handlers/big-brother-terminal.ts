import type { UnifiedHandler, UnifiedRequest } from '../types.js';
import { streamResponse } from '../types.js';
import { audit } from '../../audit.js';
import { loadFreshOperatorConfig } from '../../config.js';
import {
  bigBrotherTerminal,
  ensureBigBrotherTerminal,
  getBigBrotherState,
  isBigBrotherReady,
  stopBigBrother,
} from '../../big-brother-terminal.js';
import {
  getSessionStatus,
  sendStdinInput,
} from '../../backends/claude-code-backend.js';

const LOG_PREFIX = '[api/big-brother-terminal]';

export const handleBigBrotherStatus: UnifiedHandler = async () => {
  try {
    const state = getBigBrotherState();

    return {
      status: 200,
      data: {
        running: state.isRunning,
        healthy: isBigBrotherReady(),
        port: state.port,
        pid: state.pid,
        claudeReady: state.claudeReady,
        endpoint: `http://localhost:${state.port}`,
      },
    };
  } catch (error) {
    console.error(`${LOG_PREFIX} Error getting status:`, error);
    return { status: 500, data: { error: (error as Error).message } };
  }
};

export const handleBigBrotherControl: UnifiedHandler = async (req) => {
  try {
    const action = req.body?.action;
    if (!['start', 'stop', 'restart'].includes(action)) {
      return { status: 400, data: { error: 'Invalid action. Use: start, stop, or restart' } };
    }

    console.log(`${LOG_PREFIX} ${action} requested by ${req.user.username}`);

    let success = false;
    let message = '';
    const beforeState = getBigBrotherState();

    switch (action) {
      case 'start':
        if (beforeState.isRunning) {
          message = 'Big Brother is already running';
          success = true;
        } else {
          success = await ensureBigBrotherTerminal();
          message = success ? 'Big Brother started' : 'Failed to start Big Brother';
        }
        break;

      case 'stop':
        if (!beforeState.isRunning) {
          message = 'Big Brother is not running';
          success = true;
        } else {
          await stopBigBrother();
          success = true;
          message = 'Big Brother stopped';
        }
        break;

      case 'restart':
        console.log(`${LOG_PREFIX} Stopping for restart...`);
        await stopBigBrother();
        await new Promise((resolve) => setTimeout(resolve, 1000));
        console.log(`${LOG_PREFIX} Starting after restart...`);
        success = await ensureBigBrotherTerminal();
        message = success ? 'Big Brother restarted' : 'Failed to restart Big Brother';
        break;
    }

    const afterState = getBigBrotherState();
    audit({
      level: 'info',
      category: 'action',
      event: `big_brother_${action}`,
      actor: req.user.username,
      details: {
        action,
        success,
        beforePid: beforeState.pid,
        afterPid: afterState.pid,
        beforeRunning: beforeState.isRunning,
        afterRunning: afterState.isRunning,
      },
    });

    return {
      status: success ? 200 : 500,
      data: {
        success,
        message,
        state: {
          running: afterState.isRunning,
          healthy: isBigBrotherReady(),
          port: afterState.port,
          pid: afterState.pid,
        },
      },
    };
  } catch (error) {
    console.error(`${LOG_PREFIX} Error:`, error);
    return { status: 500, data: { error: (error as Error).message } };
  }
};

export const handleGetBigBrotherInputStatus: UnifiedHandler = async (req) => {
  try {
    if (!req.user.isAuthenticated) {
      return { status: 200, data: { ...getSessionStatus(), authenticated: false } };
    }

    return { status: 200, data: getSessionStatus() };
  } catch {
    return { status: 200, data: { ...getSessionStatus(), authenticated: false } };
  }
};

export const handleBigBrotherInput: UnifiedHandler = async (req) => {
  try {
    const input = req.body?.input;
    if (!input || typeof input !== 'string') {
      return {
        status: 400,
        data: { success: false, error: 'input is required and must be a string' },
      };
    }

    const operatorConfig = loadFreshOperatorConfig(req.user.username);
    const provider = operatorConfig.bigBrotherMode?.provider || 'claude-code';
    if (provider !== 'claude-code') {
      return {
        status: 409,
        data: {
          success: false,
          error: `Big Brother input is only supported for claude-code. Current provider: ${provider}`,
        },
      };
    }

    const status = getSessionStatus();
    if (!status.ready) {
      return {
        status: 400,
        data: {
          success: false,
          error: 'No active Big Brother session',
          status,
        },
      };
    }

    const success = sendStdinInput(input);
    audit({
      level: 'info',
      category: 'action',
      event: 'big_brother_user_input',
      details: {
        inputLength: input.length,
        inputPreview: input.substring(0, 50),
        success,
      },
      actor: req.user.username,
    });

    return {
      status: success ? 200 : 500,
      data: {
        success,
        message: success ? 'Input sent to Big Brother' : 'Failed to send input',
      },
    };
  } catch (error) {
    return {
      status: 500,
      data: {
        success: false,
        error: (error as Error).message,
      },
    };
  }
};

async function* terminalEvents(req: UnifiedRequest): AsyncIterable<string> {
  const queue: string[] = [];
  let wake: (() => void) | null = null;
  let closed = false;

  const push = (payload: Record<string, unknown>): void => {
    queue.push(`data: ${JSON.stringify(payload)}\n\n`);
    if (wake) {
      wake();
      wake = null;
    }
  };

  const close = (): void => {
    closed = true;
    bigBrotherTerminal.off('ready', handleReady);
    bigBrotherTerminal.off('open_tab', handleOpenTab);
    bigBrotherTerminal.off('output', handleOutput);
    if (wake) {
      wake();
      wake = null;
    }
  };

  const handleReady = (info: { port: number; url: string }) => {
    push({
      type: 'terminal_ready',
      port: info.port,
      url: info.url,
    });
  };

  const handleOpenTab = (info: { port: number; url: string }) => {
    push({
      type: 'open_tab',
      port: info.port,
      url: info.url,
    });
  };

  const handleOutput = (event: { type?: string; content?: string }) => {
    if (event.type === 'prompt_sent' || event.type === 'ready') {
      push({
        type: 'output',
        content: event.content?.substring(0, 200),
      });
    }
  };

  req.signal?.addEventListener('abort', close, { once: true });

  try {
    push({ type: 'connected' });

    bigBrotherTerminal.on('ready', handleReady);
    bigBrotherTerminal.on('open_tab', handleOpenTab);
    bigBrotherTerminal.on('output', handleOutput);

    const state = bigBrotherTerminal.getState();
    if (state.isRunning) {
      push({
        type: 'terminal_ready',
        port: state.port,
        url: `http://localhost:${state.port}`,
        alreadyRunning: true,
      });
    }

    while (!closed) {
      while (queue.length > 0) {
        yield queue.shift()!;
      }

      if (closed) break;

      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  } finally {
    req.signal?.removeEventListener('abort', close);
    close();
  }
}

export const handleBigBrotherTerminalEvents: UnifiedHandler = async (req) => {
  return streamResponse(terminalEvents(req));
};
