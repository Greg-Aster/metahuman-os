/**
 * run_agent Skill
 * Trigger other agents to run
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { SkillManifest, SkillResult } from '../../packages/core/src/skills.js';
import { paths, listAvailableAgents, isAgentRunning } from '../../packages/core/src/index.js';

// Resolve tsx path (installed in node_modules/.bin)
const TSX_PATH = path.join(paths.root, 'node_modules', '.bin', 'tsx');

export const manifest: SkillManifest = {
  id: 'run_agent',
  name: 'Run Agent',
  description: 'Trigger another agent to execute',
  category: 'agent',

  inputs: {
    agentName: {
      type: 'string',
      required: true,
      description: 'Name of the agent to run (e.g., "organizer", "reflector")',
      validation: (value) => {
        const agents = listAvailableAgents();
        return agents.includes(value);
      },
    },
    wait: {
      type: 'boolean',
      required: false,
      description: 'Whether to wait for agent to complete (default: false)',
    },
  },

  outputs: {
    pid: { type: 'number', description: 'Process ID of spawned agent' },
    exitCode: { type: 'number', description: 'Exit code (if wait=true)' },
  },

  risk: 'medium',
  cost: 'expensive',
  minTrustLevel: 'supervised_auto',
  requiresApproval: true,
};

export async function execute(inputs: {
  agentName: string;
  wait?: boolean;
}): Promise<SkillResult> {
  try {
    const agentName = inputs.agentName;
    const wait = inputs.wait ?? false;

    // Validate agent exists
    const agentPath = path.join(paths.agents, `${agentName}.ts`);
    if (!fs.existsSync(agentPath)) {
      return {
        success: false,
        error: `Agent not found: ${agentName}`,
      };
    }

    // Check if already running (for continuous agents)
    if (isAgentRunning(agentName)) {
      return {
        success: false,
        error: `Agent '${agentName}' is already running`,
      };
    }

    // Spawn the agent
    const child = spawn(TSX_PATH, [agentPath], {
      stdio: wait ? 'pipe' : 'inherit',
      cwd: paths.root,
      detached: !wait,
    });

    if (!child.pid) {
      return {
        success: false,
        error: 'Failed to spawn agent process',
      };
    }

    if (wait) {
      // Wait for completion
      return new Promise((resolve) => {
        child.on('close', (code) => {
          resolve({
            success: code === 0,
            outputs: {
              pid: child.pid!,
              exitCode: code ?? -1,
            },
          });
        });

        child.on('error', (error) => {
          resolve({
            success: false,
            error: `Agent execution failed: ${error.message}`,
          });
        });
      });
    } else {
      // Return immediately
      if (!wait) {
        child.unref(); // Allow parent to exit
      }

      return {
        success: true,
        outputs: {
          pid: child.pid,
          exitCode: 0, // Not applicable when not waiting
        },
      };
    }
  } catch (error) {
    return {
      success: false,
      error: `Failed to run agent: ${(error as Error).message}`,
    };
  }
}
