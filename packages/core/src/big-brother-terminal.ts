/**
 * Big Brother Terminal - Stream JSON Implementation
 *
 * Uses Claude Code's --input-format stream-json --output-format stream-json
 * for proper programmatic interaction. This is the same API the VS Code extension uses.
 *
 * No TUI, just clean JSON input/output with conversation context maintained.
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import * as net from 'net';
// ws is CommonJS - use default import for bundler compatibility
import ws from 'ws';
const WebSocketServer = ws.Server;
const WebSocket = ws;
import type { WebSocket as WsWebSocketType } from 'ws';
import * as http from 'http';
import { audit } from './audit.js';
import { eventBus, EventTypes, generateRequestId } from './infrastructure/event-bus/index.js';

const REPO_ROOT = process.env.METAHUMAN_ROOT || '/home/greggles/metahuman';
const LOG_DIR = path.join(REPO_ROOT, 'logs/run');
const BIG_BROTHER_PORT = 3099;

// Get Claude model from operator config
// Uses loadOperatorConfig to properly resolve user-specific profile paths
async function getClaudeModel(username?: string): Promise<string> {
  const DEFAULT_MODEL = 'sonnet';  // Sensible default: Claude 3.5 Sonnet

  try {
    // Dynamic import to avoid circular dependencies
    const { loadOperatorConfig } = await import('./config.js');

    if (!username) {
      console.log(`[big-brother-terminal] No username provided, using default model: ${DEFAULT_MODEL}`);
      return DEFAULT_MODEL;
    }

    // Load config with skipCache=true for fresh state
    const config = loadOperatorConfig(username, true);
    const model = config?.bigBrotherMode?.model;

    if (!model) {
      console.log(`[big-brother-terminal] bigBrotherMode.model not configured for ${username}, using default: ${DEFAULT_MODEL}`);
      return DEFAULT_MODEL;
    }

    console.log(`[big-brother-terminal] Using model for ${username}: ${model}`);
    return model;
  } catch (e) {
    console.error(`[big-brother-terminal] Error loading config for ${username}, using default model:`, e);
    return DEFAULT_MODEL;
  }
}

// ============================================================================
// Port Detection Helpers
// ============================================================================

/**
 * Check if a port is already in use
 */
function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        resolve(true);
      } else {
        resolve(false);
      }
    });
    server.once('listening', () => {
      server.close();
      resolve(false);
    });
    server.listen(port);
  });
}

/**
 * Check if an existing Big Brother terminal is healthy
 */
async function checkExistingTerminalHealth(): Promise<{ healthy: boolean; pid?: number }> {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: 'localhost',
      port: BIG_BROTHER_PORT,
      path: '/health',
      method: 'GET',
      timeout: 2000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const health = JSON.parse(data);
          if (health.status === 'ok' && health.ready) {
            resolve({ healthy: true, pid: health.pid });
          } else {
            resolve({ healthy: false });
          }
        } catch {
          resolve({ healthy: false });
        }
      });
    });

    req.on('error', () => {
      resolve({ healthy: false });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ healthy: false });
    });

    req.end();
  });
}

// ============================================================================
// Types
// ============================================================================

export interface TerminalSessionState {
  isRunning: boolean;
  port: number;
  pid: number | null;
  claudeReady: boolean;
  lastActivity: Date | null;
  promptQueue: string[];
}

export interface TerminalOutputEvent {
  type: 'output' | 'prompt_sent' | 'ready' | 'error' | 'assistant_response';
  content: string;
  timestamp: Date;
}

// Claude Code stream-json message types
interface ClaudeStreamMessage {
  type: string;
  message?: {
    role: string;
    content: string | Array<{ type: string; text?: string }>;
  };
  content_block?: {
    type: string;
    text?: string;
  };
  delta?: {
    type: string;
    text?: string;
  };
  result?: {
    type: string;
    subtype?: string;
  };
  error?: string;
}

// ============================================================================
// Stream JSON Terminal Manager
// ============================================================================

class BigBrotherTerminalManager extends EventEmitter {
  private claudeProcess: ChildProcess | null = null;
  private httpServer: http.Server | null = null;
  private wss: InstanceType<typeof WebSocketServer> | null = null;
  private clients: Set<WsWebSocketType> = new Set();
  private outputBuffer: string = '';
  private outputLogPath: string = path.join(LOG_DIR, 'big-brother-output.log');
  private outputLogStream: fs.WriteStream | null = null;
  private isStarting = false;
  private isProcessingPrompt = false;
  private currentResponseBuffer: string = '';
  private responseResolve: ((response: string) => void) | null = null;
  private responseReject: ((error: Error) => void) | null = null;
  // External session tracking - when another process owns the terminal
  private usingExternalSession = false;
  private externalSessionPid: number | null = null;
  // Current user context - determines which profile's CLAUDE.md to use
  private currentUsername: string | null = null;
  private currentWorkingDir: string = REPO_ROOT;

  getState(): TerminalSessionState {
    return {
      isRunning: this.claudeProcess !== null || this.usingExternalSession,
      port: BIG_BROTHER_PORT,
      pid: this.claudeProcess?.pid ?? this.externalSessionPid ?? null,
      claudeReady: this.claudeProcess !== null || this.usingExternalSession,
      lastActivity: null,
      promptQueue: [],
    };
  }

  isReady(): boolean {
    // Ready if we have our own process OR we're using an external session
    return (this.claudeProcess !== null && !this.claudeProcess.killed) || this.usingExternalSession;
  }

  async start(username?: string): Promise<boolean> {
    if (this.isStarting) {
      await new Promise(resolve => setTimeout(resolve, 3000));
      return this.claudeProcess !== null || this.usingExternalSession;
    }

    // If username changed and we have a running process, restart with new context
    if (username && this.currentUsername && username !== this.currentUsername && this.claudeProcess !== null) {
      console.log(`[big-brother-terminal] User changed from ${this.currentUsername} to ${username}, restarting...`);
      await this.stop();
    }

    if (this.claudeProcess !== null) {
      console.log('[big-brother-terminal] Already running');
      return true;
    }

    // Resolve working directory based on username
    if (username) {
      try {
        const { getProfilePaths } = await import('./paths.js');
        const profilePaths = getProfilePaths(username);
        this.currentWorkingDir = profilePaths.root;
        this.currentUsername = username;
        console.log(`[big-brother-terminal] Using user profile: ${this.currentWorkingDir}`);
      } catch (e) {
        console.warn(`[big-brother-terminal] Failed to resolve profile for ${username}, using repo root:`, e);
        this.currentWorkingDir = REPO_ROOT;
        this.currentUsername = null;
      }
    } else {
      this.currentWorkingDir = REPO_ROOT;
      this.currentUsername = null;
    }

    // Check if another process already has Big Brother running on port 3099
    // This handles the case where desire-planner CLI runs separately from dev server
    const portInUse = await isPortInUse(BIG_BROTHER_PORT);
    if (portInUse) {
      console.log(`[big-brother-terminal] Port ${BIG_BROTHER_PORT} already in use, checking health...`);
      const health = await checkExistingTerminalHealth();
      if (health.healthy) {
        console.log(`[big-brother-terminal] ✓ Existing terminal is healthy (PID: ${health.pid}), reusing session`);
        this.usingExternalSession = true;
        this.externalSessionPid = health.pid || null;

        audit({
          level: 'info',
          category: 'action',
          event: 'big_brother_terminal_reused',
          details: { port: BIG_BROTHER_PORT, externalPid: health.pid },
          actor: 'big-brother-terminal',
        });

        return true;
      } else {
        console.warn(`[big-brother-terminal] Port ${BIG_BROTHER_PORT} in use but health check failed`);
        // Port is in use but not by a healthy Big Brother - could be stale process
        // We can't start a new one, so return false
        return false;
      }
    }

    this.isStarting = true;

    try {
      // Ensure log directory exists
      if (!fs.existsSync(LOG_DIR)) {
        fs.mkdirSync(LOG_DIR, { recursive: true });
      }

      // Open log file for output
      this.outputLogStream = fs.createWriteStream(this.outputLogPath, { flags: 'w' });

      const model = await getClaudeModel(username);
      console.log(`[big-brother-terminal] Starting Claude with stream-json mode (model: ${model})...`);

      // Spawn Claude in stream-json mode (like VS Code extension does)
      // --max-thinking-tokens enables extended thinking output
      // --setting-sources ensures CLAUDE.md project instructions are loaded
      // cwd is set to user's profile root so their CLAUDE.md is loaded
      // IMPORTANT: Use stdbuf -oL to force line buffering on stdout
      // Without this, Claude's output is block-buffered when piped, causing
      // responses to sit in a 4KB buffer and never reach Node.js readline
      console.log(`[big-brother-terminal] Working directory: ${this.currentWorkingDir}`);
      this.claudeProcess = spawn('stdbuf', [
        '-oL',  // Force line buffering on stdout
        'claude',
        '--input-format', 'stream-json',
        '--output-format', 'stream-json',
        '--model', model,
        '--dangerously-skip-permissions',
        '--verbose',
      ], {
        cwd: this.currentWorkingDir,
        env: { ...process.env, IS_SANDBOX: '1' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      console.log(`[big-brother-terminal] Claude process started with PID ${this.claudeProcess.pid}`);

      // Handle stdout - parse stream-json messages
      if (this.claudeProcess.stdout) {
        const rl = readline.createInterface({
          input: this.claudeProcess.stdout,
          crlfDelay: Infinity,
        });

        rl.on('line', (line: string) => {
          this.handleStreamJsonLine(line);
        });
      }

      // Handle stderr - log errors but also emit for visibility
      if (this.claudeProcess.stderr) {
        this.claudeProcess.stderr.on('data', (data: Buffer) => {
          const text = data.toString();
          console.error(`[big-brother-terminal] stderr: ${text}`);
          this.outputLogStream?.write(`[stderr] ${text}`);

          // Broadcast to WebSocket clients
          this.broadcastToClients({ type: 'stderr', data: text });
        });
      }

      // Handle process exit
      this.claudeProcess.on('exit', (code, signal) => {
        console.log(`[big-brother-terminal] Claude process exited: code=${code}, signal=${signal}`);
        this.claudeProcess = null;

        // Reject any pending response
        if (this.responseReject) {
          this.responseReject(new Error(`Claude process exited unexpectedly: code=${code}`));
          this.responseResolve = null;
          this.responseReject = null;
        }

        this.isProcessingPrompt = false;
      });

      this.claudeProcess.on('error', (err) => {
        console.error('[big-brother-terminal] Claude process error:', err);

        if (this.responseReject) {
          this.responseReject(err);
          this.responseResolve = null;
          this.responseReject = null;
        }
      });

      // Start WebSocket server for UI visualization
      await this.startWebSocketServer();

      audit({
        level: 'info',
        category: 'action',
        event: 'big_brother_terminal_started',
        details: { port: BIG_BROTHER_PORT, pid: this.claudeProcess.pid, mode: 'stream-json' },
        actor: 'big-brother-terminal',
      });

      // Publish to event bus
      eventBus.emit('big-brother', EventTypes.BIG_BROTHER_ESCALATION_STARTED, {
        port: BIG_BROTHER_PORT,
        pid: this.claudeProcess.pid,
        mode: 'stream-json',
        username: this.currentUsername,
      });

      this.emit('ready', { port: BIG_BROTHER_PORT, url: `http://localhost:${BIG_BROTHER_PORT}` });

      return true;
    } catch (error) {
      console.error('[big-brother-terminal] Failed to start:', error);
      this.cleanup();
      return false;
    } finally {
      this.isStarting = false;
    }
  }

  /**
   * Handle a line of stream-json output from Claude
   */
  private handleStreamJsonLine(line: string): void {
    if (!line.trim()) return;

    try {
      const msg: ClaudeStreamMessage = JSON.parse(line);

      // Log raw message for debugging
      this.outputLogStream?.write(`[json] ${line}\n`);

      // Handle different message types
      switch (msg.type) {
        case 'assistant':
          // Full assistant message - handle all content types
          console.log(`[big-brother-terminal] 📨 Assistant message received`);
          if (msg.message?.content) {
            const contentArray = Array.isArray(msg.message.content) ? msg.message.content : [msg.message.content];
            for (const rawBlock of contentArray) {
              const block = rawBlock as any; // Claude stream-json has various block types

              if (typeof block === 'string') {
                // Plain text content
                console.log(`[big-brother-terminal] 📝 Text: ${block.substring(0, 100)}...`);
                this.currentResponseBuffer += block;
                this.broadcastOutput(block);
              } else if (block.type === 'text' && block.text) {
                console.log(`[big-brother-terminal] 📝 Text block: ${block.text.substring(0, 100)}...`);
                this.currentResponseBuffer += block.text;
                this.broadcastOutput(block.text);
              } else if (block.type === 'thinking' && block.thinking) {
                // Broadcast thinking/reasoning to UI - FULL content, not truncated
                const thinking = block.thinking as string;
                console.log(`[big-brother-terminal] 🧠 Thinking (${thinking.length} chars): ${thinking.substring(0, 200)}...`);
                this.broadcastToClients({
                  type: 'thinking',
                  data: thinking // Send full thinking content
                });
              } else if (block.type === 'tool_use') {
                // Broadcast tool usage to UI
                const toolName = block.name || 'unknown';
                const toolInfo = `🔧 Using tool: ${toolName}`;
                const inputPreview = JSON.stringify(block.input || {}, null, 2).substring(0, 500);
                console.log(`[big-brother-terminal] ${toolInfo}`);
                this.broadcastToClients({ type: 'tool_use', data: `${toolInfo}\n${inputPreview}` });

                // Publish to event bus
                eventBus.emit('big-brother', EventTypes.BIG_BROTHER_TOOL_INVOKED, {
                  tool: toolName,
                  inputPreview: inputPreview.substring(0, 200),
                });
              } else if (block.type === 'tool_result') {
                // Tool result
                console.log(`[big-brother-terminal] 🔧 Tool result for ${block.tool_use_id}`);
                this.broadcastToClients({ type: 'tool_result', data: String(block.content || '').substring(0, 500) });
              } else {
                // Unknown block type - log it
                console.log(`[big-brother-terminal] ❓ Unknown block type: ${block.type}`);
              }
            }
          }
          break;

        case 'content_block_start':
          // Start of a content block (text, tool_use, thinking, etc.)
          const startBlock = (msg as any).content_block;
          if (startBlock?.type === 'thinking') {
            console.log(`[big-brother-terminal] 🧠 Thinking block started`);
            this.broadcastToClients({ type: 'thinking', data: '💭 Thinking...' });
          } else if (startBlock?.type === 'tool_use') {
            console.log(`[big-brother-terminal] 🔧 Tool block started: ${startBlock.name}`);
            this.broadcastToClients({ type: 'tool_use', data: `🔧 Starting ${startBlock.name}...` });
          } else if (startBlock?.text) {
            this.currentResponseBuffer += startBlock.text;
            this.broadcastOutput(startBlock.text);
          }
          break;

        case 'content_block_delta':
          // Streaming delta within a content block
          const delta = (msg as any).delta;
          if (delta?.type === 'thinking_delta' && delta.thinking) {
            // Streaming thinking content
            console.log(`[big-brother-terminal] 🧠 Thinking delta: ${delta.thinking.substring(0, 50)}...`);
            this.broadcastToClients({ type: 'thinking', data: delta.thinking });
          } else if (delta?.type === 'text_delta' && delta.text) {
            this.currentResponseBuffer += delta.text;
            this.broadcastOutput(delta.text);
          } else if (delta?.text) {
            this.currentResponseBuffer += delta.text;
            this.broadcastOutput(delta.text);
          }
          break;

        case 'content_block_stop':
          // End of a content block
          break;

        case 'message_start':
          // Start of a new message
          this.currentResponseBuffer = '';
          break;

        case 'message_delta':
          // Message-level delta (stop_reason, etc.)
          break;

        case 'message_stop':
          // End of message - response is complete
          console.log(`[big-brother-terminal] Message complete, response length: ${this.currentResponseBuffer.length}`);
          if (this.responseResolve) {
            this.responseResolve(this.currentResponseBuffer);
            this.responseResolve = null;
            this.responseReject = null;
            this.isProcessingPrompt = false;
          }
          break;

        case 'result':
          // Final result message - subtype is at TOP LEVEL, not under msg.result
          const subtype = (msg as any).subtype;
          console.log(`[big-brother-terminal] Result received: subtype=${subtype}, buffer=${this.currentResponseBuffer.length} chars`);

          if (subtype === 'success') {
            console.log('[big-brother-terminal] ✅ Claude completed successfully');
            this.broadcastToClients({ type: 'complete', data: 'Task completed successfully' });

            // Publish completion to event bus
            eventBus.emit('big-brother', EventTypes.BIG_BROTHER_ESCALATION_COMPLETED, {
              status: 'success',
              responseLength: this.currentResponseBuffer.length,
            });

            if (this.responseResolve && this.currentResponseBuffer) {
              this.responseResolve(this.currentResponseBuffer);
              this.responseResolve = null;
              this.responseReject = null;
              this.isProcessingPrompt = false;
            }
          } else if (subtype === 'error_api_error' || subtype === 'error') {
            const errorMsg = (msg as any).error || 'Claude API error';
            console.error(`[big-brother-terminal] ❌ Claude error: ${errorMsg}`);
            this.broadcastToClients({ type: 'error', data: errorMsg });

            // Publish error to event bus
            eventBus.emit('big-brother', EventTypes.BIG_BROTHER_ESCALATION_COMPLETED, {
              status: 'error',
              error: errorMsg,
            }, { level: 'error' });

            if (this.responseReject) {
              this.responseReject(new Error(errorMsg));
              this.responseResolve = null;
              this.responseReject = null;
              this.isProcessingPrompt = false;
            }
          }
          break;

        case 'error':
          console.error('[big-brother-terminal] Claude error:', msg.error);
          if (this.responseReject) {
            this.responseReject(new Error(msg.error || 'Unknown Claude error'));
            this.responseResolve = null;
            this.responseReject = null;
            this.isProcessingPrompt = false;
          }
          break;

        case 'system':
          // System message (initialization, etc.)
          console.log('[big-brother-terminal] System message:', line.substring(0, 200));
          break;

        default:
          // Log unknown message types for debugging
          console.log(`[big-brother-terminal] Unknown message type: ${msg.type}`);
      }

      // Emit for backend listeners
      this.emit('output', {
        type: 'output',
        content: line,
        timestamp: new Date(),
      });

    } catch (error) {
      // Not JSON - might be plain text output
      console.log(`[big-brother-terminal] Non-JSON line: ${line.substring(0, 100)}`);
      this.outputLogStream?.write(`[raw] ${line}\n`);
    }
  }

  /**
   * Extract text content from Claude's content array or string
   */
  private extractTextContent(content: string | Array<{ type: string; text?: string }>): string {
    if (typeof content === 'string') {
      return content;
    }

    return content
      .filter(block => block.type === 'text' && block.text)
      .map(block => block.text!)
      .join('');
  }

  /**
   * Broadcast output to all WebSocket clients and log
   */
  private broadcastOutput(text: string): void {
    this.outputBuffer += text;
    this.outputLogStream?.write(text);
    this.broadcastToClients({ type: 'output', data: text });
  }

  /**
   * Broadcast message to all WebSocket clients
   */
  private broadcastToClients(message: { type: string; data: string }): void {
    const jsonMsg = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(jsonMsg);
      }
    }
  }

  private async startWebSocketServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Create HTTP server for health checks, prompt submission, and WebSocket
      this.httpServer = http.createServer((req, res) => {
        if (req.url === '/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            status: 'ok',
            pid: this.claudeProcess?.pid,
            mode: 'stream-json',
            ready: this.isReady(),
          }));
        } else if (req.url === '/prompt' && req.method === 'POST') {
          // Accept prompts from external processes
          let body = '';
          req.on('data', (chunk) => { body += chunk; });
          req.on('end', async () => {
            try {
              const { prompt } = JSON.parse(body);
              if (!prompt) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Missing prompt field' }));
                return;
              }

              console.log(`[big-brother-terminal] Received external prompt (${prompt.length} chars)`);

              // Send the prompt to Claude via stdin
              if (this.claudeProcess?.stdin) {
                const inputMessage = {
                  type: 'user',
                  message: { role: 'user', content: prompt },
                };
                this.claudeProcess.stdin.write(JSON.stringify(inputMessage) + '\n');
                this.isProcessingPrompt = true;
                this.currentResponseBuffer = '';

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, message: 'Prompt sent' }));
              } else {
                res.writeHead(503, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Claude process not ready' }));
              }
            } catch (error) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Invalid JSON' }));
            }
          });
        } else if (req.url === '/' || req.url === '/index.html') {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(this.getViewerHTML());
        } else {
          res.writeHead(404);
          res.end('Not found');
        }
      });

      // Create WebSocket server
      this.wss = new WebSocketServer({ server: this.httpServer });

      this.wss.on('error', (err) => {
        console.error('[big-brother-terminal] WebSocketServer error:', err);
        reject(err);
      });

      this.wss.on('connection', (ws: WsWebSocketType) => {
        console.log('[big-brother-terminal] WebSocket client connected');
        this.clients.add(ws);

        // Send recent output to new client
        if (this.outputBuffer) {
          ws.send(JSON.stringify({ type: 'output', data: this.outputBuffer.slice(-10240) }));
        }

        ws.on('close', () => {
          // console.log('[big-brother-terminal] WebSocket client disconnected');
          this.clients.delete(ws);
        });

        ws.on('error', (err) => {
          console.error('[big-brother-terminal] WebSocket error:', err);
          this.clients.delete(ws);
        });
      });

      this.httpServer.on('error', (err) => {
        console.error('[big-brother-terminal] HTTP server error:', err);
        reject(err);
      });

      this.httpServer.listen(BIG_BROTHER_PORT, () => {
        console.log(`[big-brother-terminal] Server listening on port ${BIG_BROTHER_PORT}`);
        resolve();
      });
    });
  }

  /**
   * Simple HTML viewer for Big Brother output
   */
  private getViewerHTML(): string {
    return `<!DOCTYPE html>
<html>
<head>
  <title>Big Brother Terminal</title>
  <style>
    html, body { margin: 0; padding: 0; height: 100%; background: #1e1e1e; color: #d4d4d4; font-family: monospace; }
    #output { padding: 16px; white-space: pre-wrap; word-wrap: break-word; overflow-y: auto; height: calc(100% - 32px); }
    .stderr { color: #f14c4c; }
    .info { color: #569cd6; }
  </style>
</head>
<body>
  <div id="output"></div>
  <script>
    const output = document.getElementById('output');
    const ws = new WebSocket('ws://' + window.location.host);

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        const span = document.createElement('span');
        if (msg.type === 'stderr') {
          span.className = 'stderr';
        }
        span.textContent = msg.data;
        output.appendChild(span);
        output.scrollTop = output.scrollHeight;
      } catch {
        output.textContent += event.data;
      }
    };

    ws.onclose = () => {
      const span = document.createElement('span');
      span.className = 'info';
      span.textContent = '\\n[Connection closed]\\n';
      output.appendChild(span);
    };
  </script>
</body>
</html>`;
  }

  /**
   * Send a prompt to an external Big Brother session via HTTP
   */
  private sendPromptToExternalSession(prompt: string): Promise<boolean> {
    return new Promise((resolve) => {
      const postData = JSON.stringify({ prompt });

      const req = http.request({
        hostname: 'localhost',
        port: BIG_BROTHER_PORT,
        path: '/prompt',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
        timeout: 5000,
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            if (result.success) {
              console.log(`[big-brother-terminal] ✓ Prompt sent to external session`);
              audit({
                level: 'info',
                category: 'action',
                event: 'big_brother_prompt_sent_external',
                details: { promptLength: prompt.length, externalPid: this.externalSessionPid },
                actor: 'big-brother-terminal',
              });
              resolve(true);
            } else {
              console.error(`[big-brother-terminal] External session rejected prompt: ${result.error}`);
              resolve(false);
            }
          } catch {
            console.error('[big-brother-terminal] Invalid response from external session');
            resolve(false);
          }
        });
      });

      req.on('error', (err) => {
        console.error('[big-brother-terminal] Failed to send to external session:', err.message);
        // External session may have died, clear the flag so we try to start our own next time
        this.usingExternalSession = false;
        this.externalSessionPid = null;
        resolve(false);
      });

      req.on('timeout', () => {
        console.error('[big-brother-terminal] Timeout sending to external session');
        req.destroy();
        resolve(false);
      });

      req.write(postData);
      req.end();
    });
  }

  /**
   * Send a prompt to Claude and wait for response
   * @param prompt The prompt to send
   * @param username Optional username to determine working directory (user's profile root)
   */
  async sendPrompt(prompt: string, username?: string): Promise<boolean> {
    if (this.isProcessingPrompt) {
      console.warn('[big-brother-terminal] Already processing a prompt, please wait...');
      return false;
    }

    // If using external session, forward prompt via HTTP
    if (this.usingExternalSession) {
      return this.sendPromptToExternalSession(prompt);
    }

    if (!this.claudeProcess || !this.claudeProcess.stdin) {
      console.log('[big-brother-terminal] Not running, starting...');
      const started = await this.start(username);

      // After start(), check if we ended up using external session
      if (this.usingExternalSession) {
        return this.sendPromptToExternalSession(prompt);
      }

      if (!started || !this.claudeProcess?.stdin) {
        console.error('[big-brother-terminal] Failed to start Claude');
        return false;
      }
      // Wait for Claude to initialize
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    try {
      this.isProcessingPrompt = true;
      this.currentResponseBuffer = '';

      console.log(`[big-brother-terminal] Sending prompt (${prompt.length} chars) via stream-json...`);

      // Clear output buffer for this prompt
      this.outputBuffer = '';

      // Format message for stream-json input
      // Claude Code expects messages in this format
      const inputMessage = {
        type: 'user',
        message: {
          role: 'user',
          content: prompt,
        },
      };

      // Write to stdin
      const jsonLine = JSON.stringify(inputMessage) + '\n';
      this.claudeProcess.stdin.write(jsonLine);

      this.outputLogStream?.write(`[input] ${jsonLine}`);

      // Broadcast prompt to WebSocket clients
      this.broadcastToClients({ type: 'output', data: `\n[Prompt sent: ${prompt.length} chars]\n` });

      audit({
        level: 'info',
        category: 'action',
        event: 'big_brother_prompt_sent',
        details: { promptLength: prompt.length, mode: 'stream-json' },
        actor: 'big-brother-terminal',
      });

      this.emit('output', {
        type: 'prompt_sent',
        content: prompt,
        timestamp: new Date(),
      });

      return true;
    } catch (error) {
      console.error('[big-brother-terminal] Error sending prompt:', error);
      this.isProcessingPrompt = false;
      return false;
    }
  }

  /**
   * Send prompt and wait for complete response (no timeout - cloud LLM takes as long as needed)
   * @param prompt The prompt to send
   * @param username Optional username to determine working directory (user's profile root)
   */
  async sendPromptAndWait(prompt: string, username?: string): Promise<string> {
    const sent = await this.sendPrompt(prompt, username);
    if (!sent) {
      throw new Error('Failed to send prompt to Claude');
    }

    return new Promise((resolve, reject) => {
      this.responseResolve = resolve;
      this.responseReject = reject;
    });
  }

  private cleanup(): void {
    this.claudeProcess = null;

    // Close all WebSocket clients
    for (const client of this.clients) {
      client.close();
    }
    this.clients.clear();

    // Close WebSocket server
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

    // Close HTTP server
    if (this.httpServer) {
      this.httpServer.close();
      this.httpServer = null;
    }

    // Close log stream
    if (this.outputLogStream) {
      this.outputLogStream.end();
      this.outputLogStream = null;
    }

    this.responseResolve = null;
    this.responseReject = null;
    this.isProcessingPrompt = false;
  }

  async stop(): Promise<void> {
    try {
      console.log('[big-brother-terminal] Stopping...');

      if (this.claudeProcess) {
        this.claudeProcess.kill('SIGTERM');

        // Wait for graceful shutdown, then force kill
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            if (this.claudeProcess) {
              this.claudeProcess.kill('SIGKILL');
            }
            resolve();
          }, 5000);

          this.claudeProcess?.on('exit', () => {
            clearTimeout(timeout);
            resolve();
          });
        });
      }

      this.cleanup();

      audit({
        level: 'info',
        category: 'action',
        event: 'big_brother_terminal_stopped',
        details: {},
        actor: 'big-brother-terminal',
      });
    } catch (error) {
      console.error('[big-brother-terminal] Error stopping:', error);
    }
  }

  getRecentOutput(): string {
    return this.outputBuffer;
  }

  clearOutputBuffer(): void {
    this.outputBuffer = '';
  }

  /**
   * Mark the current prompt as complete (for compatibility with existing code)
   */
  markPromptComplete(): void {
    this.isProcessingPrompt = false;
    console.log('[big-brother-terminal] Prompt marked as complete');
  }

  /**
   * Check if a prompt is currently being processed
   */
  isPromptInProgress(): boolean {
    return this.isProcessingPrompt;
  }
}

// ============================================================================
// Singleton and Exports
// ============================================================================

export const bigBrotherTerminal = new BigBrotherTerminalManager();

export function isTmuxAvailable(): boolean {
  return true;
}

export async function ensureBigBrotherTerminal(username?: string): Promise<boolean> {
  return bigBrotherTerminal.start(username);
}

export async function sendToBigBrother(prompt: string, username?: string): Promise<boolean> {
  return bigBrotherTerminal.sendPrompt(prompt, username);
}

export function isBigBrotherReady(): boolean {
  return bigBrotherTerminal.isReady();
}

export async function stopBigBrother(): Promise<void> {
  return bigBrotherTerminal.stop();
}

export function getBigBrotherState(): TerminalSessionState {
  return bigBrotherTerminal.getState();
}

export function onBigBrotherOutput(callback: (event: TerminalOutputEvent) => void): () => void {
  bigBrotherTerminal.on('output', callback);
  return () => bigBrotherTerminal.off('output', callback);
}

export function onBigBrotherReady(callback: (info: { port: number; url: string }) => void): () => void {
  bigBrotherTerminal.on('ready', callback);
  return () => bigBrotherTerminal.off('ready', callback);
}

export function openBigBrotherTab(): void {
  const state = bigBrotherTerminal.getState();
  if (state.isRunning) {
    bigBrotherTerminal.emit('open_tab', { port: state.port, url: `http://localhost:${state.port}` });
  }
}
