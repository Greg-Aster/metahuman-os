import type { UnifiedHandler } from '../types.js';
import {
  getNodePipelineEnvOverride,
  readNodePipelineRuntime,
  writeNodePipelineRuntime,
} from '../../node-pipeline-runtime.js';

function buildResponseBody(): { enabled: boolean; locked: boolean; source: string } {
  const envOverride = getNodePipelineEnvOverride();
  if (envOverride) {
    return {
      enabled: envOverride.value,
      locked: true,
      source: envOverride.source,
    };
  }
  return {
    enabled: readNodePipelineRuntime(),
    locked: false,
    source: 'runtime',
  };
}

export const handleGetNodePipeline: UnifiedHandler = async () => {
  return { status: 200, data: buildResponseBody() };
};

export const handleSetNodePipeline: UnifiedHandler = async (req) => {
  const envOverride = getNodePipelineEnvOverride();
  if (envOverride) {
    return {
      status: 400,
      data: {
        error: 'Node pipeline is locked by environment configuration',
        ...buildResponseBody(),
      },
    };
  }

  const enabled = req.body?.enabled;
  if (typeof enabled !== 'boolean') {
    return {
      status: 400,
      data: {
        error: 'Invalid request: enabled must be boolean',
      },
    };
  }

  writeNodePipelineRuntime(enabled, req.user.username || 'owner');

  return {
    status: 200,
    data: {
      enabled,
      locked: false,
      source: 'runtime',
    },
  };
};
