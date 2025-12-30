/**
 * Open Interpreter Adapter
 *
 * TypeScript client for the Open Interpreter server.
 * Handles communication with the Python FastAPI server.
 *
 * @see external/open-interpreter/server.py for server implementation
 */

import { audit } from './audit.js';
import {
  loadToolExecutorConfig,
  type OpenInterpreterBackendConfig,
} from './tool-executor-config.js';

// ============================================================================
// Types
// ============================================================================

export interface InterpreterConfig {
  endpoint: string;
  modelId?: string;
  safeMode: boolean;
  autoRun: boolean;
  maxIterations: number;
  timeout: number;
  allowedLanguages: string[];
  blockedCommands: string[];
  sandboxMode: 'none' | 'docker' | 'firejail';
}

export interface InterpreterRequest {
  task: string;
  context?: {
    conversationId?: string;
    sessionId?: string;
    workingDirectory?: string;
    environment?: Record<string, string>;
  };
}

export interface InterpreterMessage {
  role: 'user' | 'assistant' | 'system' | 'computer';
  type: 'message' | 'code' | 'console' | 'image' | 'file' | 'error';
  content: string;
  language?: string;
  format?: string;
}

export interface InterpreterResponse {
  success: boolean;
  taskId: string;
  messages: InterpreterMessage[];
  finalOutput?: string;
  error?: string;
  executionTime?: number;
  metadata?: {
    iterations?: number;
    codeBlocks?: number;
    filesModified?: string[];
  };
}

export interface InterpreterStatus {
  running: boolean;
  version?: string;
  currentTask?: string;
  uptime?: number;
  totalTasks?: number;
  llmConfig?: {
    apiBase: string;
    model: string;
  };
}

// ============================================================================
// Server Status
// ============================================================================

/**
 * Check if the Open Interpreter server is running
 */
export async function isInterpreterServerRunning(endpoint?: string): Promise<boolean> {
  const url = endpoint || 'http://localhost:4325';

  try {
    const response = await fetch(`${url}/health`, {
      signal: AbortSignal.timeout(3000),
    });

    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Get the status of the Open Interpreter server
 */
export async function getInterpreterStatus(endpoint?: string): Promise<InterpreterStatus> {
  const url = endpoint || 'http://localhost:4325';

  try {
    const response = await fetch(`${url}/health`, {
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return { running: false };
    }

    const data = await response.json();
    return {
      running: true,
      version: data.interpreter_version,
      currentTask: data.current_task,
      uptime: data.uptime,
      totalTasks: data.total_tasks,
      llmConfig: data.llm_config ? {
        apiBase: data.llm_config.api_base,
        model: data.llm_config.model,
      } : undefined,
    };
  } catch {
    return { running: false };
  }
}

// ============================================================================
// Server Control
// ============================================================================

/**
 * Start the Open Interpreter server
 *
 * This spawns the bin/start-interpreter script which creates a virtualenv
 * and starts the Python server.
 */
export async function startInterpreterServer(
  config?: Partial<InterpreterConfig>,
  username?: string
): Promise<{ success: boolean; error?: string }> {
  const { spawn } = await import('child_process');
  const fs = await import('fs');
  const { systemPaths } = await import('./paths.js');

  try {
    // Check if already running
    const endpoint = config?.endpoint || 'http://localhost:4325';
    if (await isInterpreterServerRunning(endpoint)) {
      return { success: true };
    }

    // Build the start command
    const port = new URL(endpoint).port || '4325';
    const scriptPath = `${systemPaths.root}/bin/start-interpreter`;

    // Ensure log directory exists
    const logDir = `${systemPaths.root}/logs/run`;
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    // Log file for the startup process (using file descriptor for spawn compatibility)
    const logFile = `${logDir}/interpreter-startup.log`;
    const logFd = fs.openSync(logFile, 'a');

    // Spawn in background (non-blocking) - this allows first-time setup to take as long as needed
    const child = spawn(scriptPath, ['--port', port], {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: {
        ...process.env,
        METAHUMAN_ROOT: systemPaths.root,
      },
    });

    // Unref so the parent can exit independently
    child.unref();

    // Close the file descriptor after spawning
    fs.closeSync(logFd);

    console.log(`[interpreter] Starting server on port ${port} (check ${logFile} for progress)...`);

    // Wait for server to be ready (longer timeout for first-time setup)
    // First-time setup may take 60+ seconds to create venv and install packages
    const maxWaitSeconds = 120;
    for (let i = 0; i < maxWaitSeconds; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      if (await isInterpreterServerRunning(endpoint)) {
        audit({
          level: 'info',
          category: 'system',
          event: 'interpreter_server_started',
          details: { endpoint, port },
          actor: username || 'system',
        });
        console.log(`[interpreter] ✅ Server started successfully after ${i + 1}s`);
        return { success: true };
      }

      // Log progress every 10 seconds
      if (i > 0 && i % 10 === 0) {
        console.log(`[interpreter] Still waiting for server... (${i}s elapsed)`);
      }
    }

    return { success: false, error: `Server did not start within ${maxWaitSeconds} seconds. Check ${logFile} for errors.` };
  } catch (error) {
    console.error('[interpreter] Failed to start server:', error);
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Stop the Open Interpreter server
 */
export async function stopInterpreterServer(
  endpoint?: string,
  username?: string
): Promise<{ success: boolean; error?: string }> {
  const { execSync } = await import('child_process');
  const { systemPaths } = await import('./paths.js');

  try {
    const scriptPath = `${systemPaths.root}/bin/stop-interpreter`;
    execSync(scriptPath, { encoding: 'utf8', timeout: 10000 });

    audit({
      level: 'info',
      category: 'system',
      event: 'interpreter_server_stopped',
      details: { endpoint },
      actor: username || 'system',
    });

    return { success: true };
  } catch (error) {
    console.error('[interpreter] Failed to stop server:', error);
    return { success: false, error: (error as Error).message };
  }
}

// ============================================================================
// Configuration
// ============================================================================

/**
 * Configure the Open Interpreter server with new settings
 */
export async function configureInterpreter(
  settings: {
    llmApiBase?: string;
    llmApiKey?: string;
    llmModel?: string;
    safeMode?: boolean;
    autoRun?: boolean;
    maxIterations?: number;
    timeout?: number;
    allowedLanguages?: string[];
    blockedCommands?: string[];
    sandboxMode?: 'none' | 'docker' | 'firejail';
  },
  endpoint?: string
): Promise<{ success: boolean; error?: string }> {
  const url = endpoint || 'http://localhost:4325';

  try {
    const response = await fetch(`${url}/configure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        llm_api_base: settings.llmApiBase,
        llm_api_key: settings.llmApiKey,
        llm_model: settings.llmModel,
        safe_mode: settings.safeMode,
        auto_run: settings.autoRun,
        max_iterations: settings.maxIterations,
        timeout: settings.timeout,
        allowed_languages: settings.allowedLanguages,
        blocked_commands: settings.blockedCommands,
        sandbox_mode: settings.sandboxMode,
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      const error = await response.text();
      return { success: false, error };
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

// ============================================================================
// Task Execution
// ============================================================================

/**
 * Execute a task with Open Interpreter
 *
 * This is the main entry point for running tasks.
 */
export async function executeWithInterpreter(
  request: InterpreterRequest,
  config?: Partial<InterpreterConfig>,
  username?: string
): Promise<InterpreterResponse> {
  // Load config if not provided
  const toolConfig = loadToolExecutorConfig(username);
  const interpreterConfig = toolConfig.backends['open-interpreter'] as OpenInterpreterBackendConfig;

  const endpoint = config?.endpoint || interpreterConfig.endpoint || 'http://localhost:4325';
  const timeout = config?.timeout || interpreterConfig.timeout || 120000;

  const startTime = Date.now();
  const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    // Check server is running
    if (!(await isInterpreterServerRunning(endpoint))) {
      // Try to auto-start if configured
      if (interpreterConfig.autoStart) {
        console.log('[interpreter] Server not running, attempting auto-start...');
        const startResult = await startInterpreterServer(config, username);
        if (!startResult.success) {
          return {
            success: false,
            taskId,
            messages: [],
            error: `Server not running and auto-start failed: ${startResult.error}`,
          };
        }
      } else {
        return {
          success: false,
          taskId,
          messages: [],
          error: 'Open Interpreter server is not running',
        };
      }
    }

    // Audit the request
    audit({
      level: 'info',
      category: 'action',
      event: 'interpreter_task_started',
      details: {
        taskId,
        task: request.task.slice(0, 200), // Truncate for audit
        context: request.context,
      },
      actor: username || 'system',
    });

    // Execute the task
    const response = await fetch(`${endpoint}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: request.task,  // Server expects 'prompt' field
        context: request.context,
      }),
      signal: AbortSignal.timeout(timeout),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let error: string;
      try {
        const errorJson = JSON.parse(errorText);
        // Ensure we always get a string, even if error is an object
        const rawError = errorJson.detail || errorJson.error || errorText;
        error = typeof rawError === 'string' ? rawError : JSON.stringify(rawError);
      } catch {
        error = errorText;
      }

      return {
        success: false,
        taskId,
        messages: [],
        error,
        executionTime: Date.now() - startTime,
      };
    }

    const data = await response.json();

    // Convert messages to our format
    const messages: InterpreterMessage[] = (data.messages || []).map((m: any) => ({
      role: m.role || 'assistant',
      type: m.type || 'message',
      content: m.content || '',
      language: m.language,
      format: m.format,
    }));

    // Find the final output (last assistant message)
    const assistantMessages = messages.filter(m => m.role === 'assistant' && m.type === 'message');
    const finalOutput = assistantMessages.length > 0
      ? assistantMessages[assistantMessages.length - 1].content
      : undefined;

    // Ensure error is always a string
    let errorMsg: string | undefined;
    if (data.error) {
      if (typeof data.error === 'string') {
        errorMsg = data.error;
      } else if (typeof data.error === 'object') {
        errorMsg = data.error.detail || data.error.message || JSON.stringify(data.error);
      } else {
        errorMsg = String(data.error);
      }
    }

    const result: InterpreterResponse = {
      success: data.success !== false,
      taskId: data.task_id || taskId,
      messages,
      finalOutput,
      error: errorMsg,
      executionTime: Date.now() - startTime,
      metadata: {
        iterations: data.iterations,
        codeBlocks: messages.filter(m => m.type === 'code').length,
      },
    };

    // Audit the result
    audit({
      level: result.success ? 'info' : 'warn',
      category: 'action',
      event: 'interpreter_task_completed',
      details: {
        taskId: result.taskId,
        success: result.success,
        executionTime: result.executionTime,
        messageCount: result.messages.length,
        error: result.error,
      },
      actor: username || 'system',
    });

    return result;
  } catch (error) {
    const executionTime = Date.now() - startTime;

    audit({
      level: 'error',
      category: 'action',
      event: 'interpreter_task_failed',
      details: {
        taskId,
        error: (error as Error).message,
        executionTime,
      },
      actor: username || 'system',
    });

    return {
      success: false,
      taskId,
      messages: [],
      error: (error as Error).message,
      executionTime,
    };
  }
}

// ============================================================================
// Streaming Execution
// ============================================================================

/**
 * Execute a task with streaming output
 *
 * Returns an async generator that yields messages as they arrive.
 */
export async function* executeWithInterpreterStream(
  request: InterpreterRequest,
  config?: Partial<InterpreterConfig>,
  username?: string
): AsyncGenerator<InterpreterMessage, void, unknown> {
  const toolConfig = loadToolExecutorConfig(username);
  const interpreterConfig = toolConfig.backends['open-interpreter'] as OpenInterpreterBackendConfig;

  const endpoint = config?.endpoint || interpreterConfig.endpoint || 'http://localhost:4325';
  const timeout = config?.timeout || interpreterConfig.timeout || 120000;

  // Check server is running
  if (!(await isInterpreterServerRunning(endpoint))) {
    if (interpreterConfig.autoStart) {
      await startInterpreterServer(config, username);
    } else {
      yield {
        role: 'system',
        type: 'error',
        content: 'Open Interpreter server is not running',
      };
      return;
    }
  }

  try {
    const response = await fetch(`${endpoint}/execute/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: request.task,  // Server expects 'prompt' field
        context: request.context,
      }),
      signal: AbortSignal.timeout(timeout),
    });

    if (!response.ok || !response.body) {
      yield {
        role: 'system',
        type: 'error',
        content: `HTTP ${response.status}: ${await response.text()}`,
      };
      return;
    }

    // Parse SSE stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE events
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            return;
          }

          try {
            const message = JSON.parse(data);
            yield {
              role: message.role || 'assistant',
              type: message.type || 'message',
              content: message.content || '',
              language: message.language,
              format: message.format,
            };
          } catch {
            // Skip invalid JSON
          }
        }
      }
    }
  } catch (error) {
    yield {
      role: 'system',
      type: 'error',
      content: (error as Error).message,
    };
  }
}

// ============================================================================
// Task Control
// ============================================================================

/**
 * Stop the currently running task
 */
export async function stopCurrentTask(
  endpoint?: string
): Promise<{ success: boolean; error?: string }> {
  const url = endpoint || 'http://localhost:4325';

  try {
    const response = await fetch(`${url}/stop`, {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return { success: false, error: await response.text() };
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Reset the interpreter (clear context)
 */
export async function resetInterpreter(
  endpoint?: string
): Promise<{ success: boolean; error?: string }> {
  const url = endpoint || 'http://localhost:4325';

  try {
    const response = await fetch(`${url}/reset`, {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return { success: false, error: await response.text() };
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Get default interpreter config from tool-executor.json
 */
export function getInterpreterConfig(username?: string): InterpreterConfig {
  const toolConfig = loadToolExecutorConfig(username);
  const config = toolConfig.backends['open-interpreter'] as OpenInterpreterBackendConfig;

  return {
    endpoint: config.endpoint,
    modelId: config.modelId,
    safeMode: config.safeMode,
    autoRun: config.autoRun,
    maxIterations: config.maxIterations,
    timeout: config.timeout,
    allowedLanguages: config.allowedLanguages,
    blockedCommands: config.blockedCommands,
    sandboxMode: config.sandboxMode,
  };
}

/**
 * Check if Open Interpreter is available (server running or can be started)
 * Note: "Available" means it CAN be used, not that it IS enabled
 */
export async function isInterpreterAvailable(username?: string): Promise<boolean> {
  const config = getInterpreterConfig(username);

  // Check if server is running
  if (await isInterpreterServerRunning(config.endpoint)) {
    return true;
  }

  // Check if startup script exists (can potentially be started)
  try {
    const { existsSync } = await import('fs');
    const { systemPaths } = await import('./paths.js');
    return existsSync(`${systemPaths.root}/bin/start-interpreter`);
  } catch {
    return false;
  }
}
