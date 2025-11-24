import { loadUserConfig, saveUserConfig } from '@metahuman/core/config';

type RuntimeConfig = Record<string, any>;

function loadRuntimeConfig(): RuntimeConfig {
  return loadUserConfig<RuntimeConfig>('runtime.json', {});
}

function saveRuntimeConfig(config: RuntimeConfig): void {
  saveUserConfig<RuntimeConfig>('runtime.json', config);
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
  const runtime = loadRuntimeConfig();
  const cognitive = runtime.cognitive || {};
  cognitive.useNodePipeline = enabled;
  cognitive.changedAt = new Date().toISOString();
  cognitive.changedBy = actor;
  runtime.cognitive = cognitive;
  saveRuntimeConfig(runtime);
}

export function resolveNodePipelineFlag(): boolean {
  const envOverride = getNodePipelineEnvOverride();
  if (envOverride) {
    return envOverride.value;
  }
  return readNodePipelineRuntime();
}
