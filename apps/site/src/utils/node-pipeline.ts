import { loadUserConfig, saveUserConfig } from '@metahuman/core/config';
import { getUserContext } from '@metahuman/core/context';

type RuntimeConfig = Record<string, any>;

function loadRuntimeConfig(username?: string): RuntimeConfig {
  const effectiveUsername = username || getUserContext()?.username;
  return loadUserConfig<RuntimeConfig>('runtime.json', {}, effectiveUsername);
}

function saveRuntimeConfig(config: RuntimeConfig, username?: string): void {
  const effectiveUsername = username || getUserContext()?.username;
  saveUserConfig<RuntimeConfig>('runtime.json', config, effectiveUsername);
}

export function getNodePipelineEnvOverride():
  | { value: boolean; source: 'env' }
  | null {
  if (process.env.USE_NODE_PIPELINE === 'true') {
    return { value: true, source: 'env' };
  }
  if (process.env.USE_NODE_PIPELINE === 'false') {
    return { value: false, source: 'env' };
  }
  return null;
}

export function readNodePipelineRuntime(): boolean {
  try {
    const runtime = loadRuntimeConfig();
    const value = runtime?.cognitive?.useNodePipeline;
    // Default to enabled when unset; explicit false disables the pipeline
    return value !== false;
  } catch {
    // Fail-open so the node pipeline is used unless explicitly disabled
    return true;
  }
}

export function writeNodePipelineRuntime(
  enabled: boolean,
  actor: string
): void {
  const userContext = getUserContext();
  const runtime = loadRuntimeConfig(userContext?.username);
  const cognitive = runtime.cognitive || {};
  cognitive.useNodePipeline = enabled;
  cognitive.changedAt = new Date().toISOString();
  cognitive.changedBy = actor;
  runtime.cognitive = cognitive;
  saveRuntimeConfig(runtime, userContext?.username);
}

export function resolveNodePipelineFlag(): boolean {
  const envOverride = getNodePipelineEnvOverride();
  if (envOverride) {
    return envOverride.value;
  }
  return readNodePipelineRuntime();
}
