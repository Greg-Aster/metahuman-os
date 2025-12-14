/**
 * Remote Server API Handlers
 *
 * Handles communication with a remote MetaHuman server (e.g., via Cloudflare tunnel).
 * This allows mobile/laptop to use the LLM capabilities of a desktop server.
 *
 * Features:
 * - Health check / test connection
 * - Model discovery (list available models on remote)
 * - LLM proxy (route requests through remote server)
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse, errorResponse } from '../types.js';

// Dynamic imports for backend config
let loadBackendConfig: any;
let saveBackendConfig: any;

async function ensureBackendFunctions(): Promise<boolean> {
  try {
    const core = await import('../../index.js');
    loadBackendConfig = core.loadBackendConfig;
    saveBackendConfig = core.saveBackendConfig;
    return !!(loadBackendConfig && saveBackendConfig);
  } catch {
    return false;
  }
}

/**
 * Check if a remote server is reachable and get its status
 */
export async function checkRemoteServerHealth(serverUrl: string): Promise<{
  healthy: boolean;
  latencyMs: number;
  serverVersion?: string;
  models?: Array<{ id: string; model: string; provider: string }>;
  error?: string;
}> {
  const start = Date.now();

  try {
    // Normalize URL
    const baseUrl = serverUrl.replace(/\/$/, '');

    // First, try to reach the server's status endpoint
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

    try {
      const response = await fetch(`${baseUrl}/api/status`, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
        },
      });

      clearTimeout(timeout);
      const latencyMs = Date.now() - start;

      if (!response.ok) {
        // Server responded but with error status
        // 401/403 means server is reachable but needs auth
        if (response.status === 401 || response.status === 403) {
          return {
            healthy: true,
            latencyMs,
            error: 'Authentication required - save credentials to connect',
          };
        }
        return {
          healthy: false,
          latencyMs,
          error: `Server returned ${response.status}`,
        };
      }

      const data = await response.json();

      // Extract useful info from status response
      const serverVersion = data.registryVersion || 'unknown';

      return {
        healthy: true,
        latencyMs,
        serverVersion,
      };
    } catch (fetchError: any) {
      clearTimeout(timeout);
      const latencyMs = Date.now() - start;

      if (fetchError.name === 'AbortError') {
        return {
          healthy: false,
          latencyMs,
          error: 'Connection timed out (10s)',
        };
      }

      return {
        healthy: false,
        latencyMs,
        error: fetchError.message || 'Failed to connect',
      };
    }
  } catch (error) {
    return {
      healthy: false,
      latencyMs: Date.now() - start,
      error: (error as Error).message || 'Unknown error',
    };
  }
}

/**
 * Fetch available models from a remote server
 */
export async function fetchRemoteModels(
  serverUrl: string,
  credentials?: { username: string; password: string }
): Promise<{
  success: boolean;
  models?: Array<{ id: string; model: string; provider: string; roles?: string[] }>;
  error?: string;
}> {
  try {
    const baseUrl = serverUrl.replace(/\/$/, '');

    // Build headers with optional auth
    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };

    if (credentials) {
      // Basic auth or session cookie would go here
      // For now, we'll use the login flow to get a session
      headers['Authorization'] = `Basic ${btoa(`${credentials.username}:${credentials.password}`)}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      // Fetch from llm-backend/status which has model info
      const response = await fetch(`${baseUrl}/api/llm-backend/status`, {
        method: 'GET',
        signal: controller.signal,
        headers,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          return {
            success: false,
            error: 'Authentication required',
          };
        }
        return {
          success: false,
          error: `Server returned ${response.status}`,
        };
      }

      const data = await response.json();
      const models: Array<{ id: string; model: string; provider: string; roles?: string[] }> = [];

      // Extract currently loaded Ollama model if available
      if (data.available?.ollama?.running && data.available?.ollama?.model) {
        models.push({
          id: `remote-ollama-${data.available.ollama.model}`,
          model: data.available.ollama.model,
          provider: 'remote-ollama',
        });
      }

      // Extract currently loaded vLLM model if available
      if (data.available?.vllm?.running && data.available?.vllm?.model) {
        models.push({
          id: `remote-vllm-${data.available.vllm.model}`,
          model: data.available.vllm.model,
          provider: 'remote-vllm',
        });
      }

      // Try to get ALL available Ollama models (not just loaded)
      try {
        const ollamaModelsRes = await fetch(`${baseUrl}/api/ollama/models`, {
          method: 'GET',
          signal: AbortSignal.timeout(5000),
          headers,
        });

        if (ollamaModelsRes.ok) {
          const ollamaData = await ollamaModelsRes.json();
          if (ollamaData.models && Array.isArray(ollamaData.models)) {
            for (const model of ollamaData.models) {
              const modelName = model.name || model;
              const existing = models.find(m => m.model === modelName);
              if (!existing) {
                models.push({
                  id: `remote-ollama-${modelName}`,
                  model: modelName,
                  provider: 'remote-ollama',
                });
              }
            }
          }
        }
      } catch {
        // Ollama models fetch failed, continue
      }

      // Also try to fetch the full model registry for more details
      try {
        const registryResponse = await fetch(`${baseUrl}/api/model-registry`, {
          method: 'GET',
          signal: AbortSignal.timeout(5000),
          headers,
        });

        if (registryResponse.ok) {
          const registryData = await registryResponse.json();
          if (registryData.availableModels) {
            for (const model of registryData.availableModels) {
              // Only add local backend models (ollama/vllm) - not cloud providers
              if (model.provider === 'ollama' || model.provider === 'vllm') {
                const existing = models.find(m => m.model === model.model);
                if (!existing) {
                  models.push({
                    id: `remote-${model.provider}-${model.model}`,
                    model: model.model,
                    provider: `remote-${model.provider}`,
                    roles: model.roles,
                  });
                }
              }
            }
          }
        }
      } catch {
        // Registry fetch failed, use basic info we already have
      }

      return {
        success: true,
        models,
      };
    } catch (fetchError: any) {
      clearTimeout(timeout);

      if (fetchError.name === 'AbortError') {
        return {
          success: false,
          error: 'Connection timed out',
        };
      }

      return {
        success: false,
        error: fetchError.message || 'Failed to fetch models',
      };
    }
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message || 'Unknown error',
    };
  }
}

/**
 * GET /api/remote-server/health - Test connection to remote server
 */
export async function handleRemoteServerHealth(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const { query } = req;

    // Get server URL from query or config
    let serverUrl = query?.serverUrl;

    if (!serverUrl) {
      const available = await ensureBackendFunctions();
      if (available) {
        const config = loadBackendConfig();
        serverUrl = config.remote?.serverUrl;
      }
    }

    if (!serverUrl) {
      return errorResponse('No remote server URL configured', 400);
    }

    const result = await checkRemoteServerHealth(serverUrl);

    return successResponse({
      serverUrl,
      ...result,
    });
  } catch (error) {
    console.error('[remote-server] Health check failed:', error);
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * GET /api/remote-server/models - Fetch available models from remote server
 */
export async function handleRemoteServerModels(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const { query, user } = req;

    // Get server URL and credentials from config
    let serverUrl = query?.serverUrl;
    let credentials: { username: string; password: string } | undefined;

    const available = await ensureBackendFunctions();
    if (available) {
      const config = loadBackendConfig();
      if (!serverUrl) {
        serverUrl = config.remote?.serverUrl;
      }

      // Load saved credentials if available
      if (config.remote?.credentials?.token) {
        try {
          const decoded = Buffer.from(config.remote.credentials.token, 'base64').toString('utf-8');
          const [username, password] = decoded.split(':');
          if (username && password) {
            credentials = { username, password };
          }
        } catch {
          // Invalid token format, ignore
        }
      }
    }

    if (!serverUrl) {
      return errorResponse('No remote server URL configured', 400);
    }

    const result = await fetchRemoteModels(serverUrl, credentials);

    if (!result.success) {
      return errorResponse(result.error || 'Failed to fetch models', 502);
    }

    return successResponse({
      serverUrl,
      models: result.models,
    });
  } catch (error) {
    console.error('[remote-server] Model fetch failed:', error);
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * POST /api/remote-server/test - Test a specific URL without saving
 */
export async function handleRemoteServerTest(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const { body } = req;
    const serverUrl = body?.serverUrl;
    const username = body?.username;
    const password = body?.password;

    if (!serverUrl) {
      return errorResponse('serverUrl is required', 400);
    }

    // Validate URL format
    try {
      new URL(serverUrl);
    } catch {
      return errorResponse('Invalid URL format', 400);
    }

    // Build credentials if provided
    const credentials = (username && password)
      ? { username, password }
      : undefined;

    const healthResult = await checkRemoteServerHealth(serverUrl);

    if (!healthResult.healthy) {
      return successResponse({
        success: false,
        serverUrl,
        error: healthResult.error,
        latencyMs: healthResult.latencyMs,
      });
    }

    // If healthy, also try to fetch models (with credentials if provided)
    const modelsResult = await fetchRemoteModels(serverUrl, credentials);

    // Check if we need auth and didn't provide credentials
    const needsAuth = !modelsResult.success && modelsResult.error?.includes('Authentication');

    return successResponse({
      success: modelsResult.success || healthResult.healthy,
      serverUrl,
      latencyMs: healthResult.latencyMs,
      serverVersion: healthResult.serverVersion,
      models: modelsResult.models || [],
      needsAuth: needsAuth || !!healthResult.error?.includes('Authentication'),
      authError: needsAuth ? 'Provide username and password to access models' : undefined,
    });
  } catch (error) {
    console.error('[remote-server] Test failed:', error);
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * POST /api/remote-server/connect - Login to remote server and save session
 *
 * This authenticates with the remote server via its /api/auth/login endpoint,
 * obtains a session cookie, and saves it for future requests.
 *
 * Options:
 * - serverUrl: The remote server URL (required)
 * - username/password: Credentials for the remote server
 * - saveCredentials: Whether to save session for future use (default: true)
 */
export async function handleRemoteServerConnect(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const { body, user } = req;

    if (!user.isAuthenticated) {
      return { status: 401, error: 'Authentication required' };
    }

    const serverUrl = body?.serverUrl;
    const remoteUsername = body?.username;
    const remotePassword = body?.password;
    const saveCredentials = body?.saveCredentials ?? true;

    if (!serverUrl) {
      return errorResponse('serverUrl is required', 400);
    }

    // Validate URL format
    try {
      new URL(serverUrl);
    } catch {
      return errorResponse('Invalid URL format', 400);
    }

    const baseUrl = serverUrl.replace(/\/$/, '');

    console.log('[remote-server/connect] serverUrl:', serverUrl);
    console.log('[remote-server/connect] credentials provided:', !!(remoteUsername && remotePassword));
    console.log('[remote-server/connect] saveCredentials:', saveCredentials);

    // Test connection first
    const healthResult = await checkRemoteServerHealth(serverUrl);

    if (!healthResult.healthy && !healthResult.error?.includes('Authentication')) {
      return successResponse({
        success: false,
        error: healthResult.error || 'Server unreachable',
        latencyMs: healthResult.latencyMs,
      });
    }

    // If server requires auth and we don't have credentials, prompt for them
    if (!remoteUsername || !remotePassword) {
      return successResponse({
        success: false,
        error: 'Username and password are required to connect',
        needsAuth: true,
        latencyMs: healthResult.latencyMs,
      });
    }

    // Login to remote server to get session cookie
    console.log('[remote-server/connect] Logging in to remote server...');
    let sessionId: string;
    let loginUsername: string;

    try {
      const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          username: remoteUsername,
          password: remotePassword,
        }),
      });

      if (!loginResponse.ok) {
        const errorText = await loginResponse.text();
        console.error('[remote-server/connect] Login failed:', loginResponse.status, errorText);
        return successResponse({
          success: false,
          error: `Login failed: ${loginResponse.status === 401 ? 'Invalid username or password' : errorText}`,
          needsAuth: true,
          latencyMs: healthResult.latencyMs,
        });
      }

      const loginData = await loginResponse.json();
      sessionId = loginData.sessionId;
      loginUsername = loginData.user?.username || remoteUsername;

      if (!sessionId) {
        console.error('[remote-server/connect] No sessionId in login response:', loginData);
        return errorResponse('Login succeeded but no session ID returned', 500);
      }

      console.log('[remote-server/connect] Login successful, got session:', sessionId.slice(0, 8) + '...');
    } catch (loginError) {
      console.error('[remote-server/connect] Login request failed:', loginError);
      return errorResponse('Failed to connect to remote server: ' + (loginError as Error).message, 502);
    }

    // Save session to USER PROFILE (not system config)
    if (saveCredentials) {
      try {
        const { saveRemoteServerCredentials } = await import('../../llm-config.js');
        saveRemoteServerCredentials(
          user.username,
          serverUrl,
          sessionId,
          loginUsername
        );
        console.log('[remote-server/connect] Saved session to user profile for:', user.username);
      } catch (e) {
        console.error('[remote-server/connect] Failed to save session:', e);
        return errorResponse('Failed to save session: ' + (e as Error).message, 500);
      }
    }

    // Fetch models from the server using the new session
    const modelsResult = await fetchRemoteModels(serverUrl, { username: remoteUsername, password: remotePassword });

    return successResponse({
      success: true,
      serverUrl,
      latencyMs: healthResult.latencyMs,
      serverVersion: healthResult.serverVersion,
      models: modelsResult.models || [],
      saved: true,
      sessionSaved: saveCredentials,
      remoteUsername: loginUsername,
    });
  } catch (error) {
    console.error('[remote-server] Connect failed:', error);
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * DELETE /api/remote-server/disconnect - Remove remote server configuration
 */
export async function handleRemoteServerDisconnect(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const { user } = req;

    if (!user.isAuthenticated) {
      return { status: 401, error: 'Authentication required' };
    }

    // Delete credentials from USER PROFILE (not system config)
    try {
      const { deleteRemoteServerCredentials } = await import('../../llm-config.js');
      const deleted = deleteRemoteServerCredentials(user.username);
      console.log('[remote-server/disconnect] Deleted credentials for:', user.username, 'result:', deleted);
    } catch (e) {
      console.warn('[remote-server/disconnect] Failed to delete credentials:', e);
      // Continue anyway - might not have had credentials
    }

    return successResponse({
      success: true,
      message: 'Remote server disconnected',
    });
  } catch (error) {
    console.error('[remote-server] Disconnect failed:', error);
    return errorResponse((error as Error).message, 500);
  }
}
