/**
 * Agent Bootstrap Wrapper
 *
 * Establishes user context for agents before they execute.
 * Agents run as standalone Node processes and need explicit context
 * to access user-specific paths (paths.persona, paths.episodic, etc.)
 *
 * Usage: tsx brain/agents/_bootstrap.ts <agent-name>
 */

import { withUserContext } from '@metahuman/core/context';
import { resolveAgentExecutablePath } from '@metahuman/core/agent-executable-resolver';
import { getUsers } from '@metahuman/core/users';

async function main() {
  const agentName = process.argv[2];
  const agentArgs = process.argv.slice(3);

  if (!agentName) {
    console.error('[bootstrap] Error: Agent name required');
    console.error('Usage: tsx brain/scripts/_bootstrap.ts <agent-name>');
    process.exit(1);
  }

  // Prefer the authenticated triggering user, then fall back to the first owner
  const users = getUsers();
  const requestedUsername = process.env.MH_TRIGGER_USERNAME?.trim();
  const owner = (requestedUsername
    ? users.find((user) => user.username === requestedUsername)
    : undefined) ?? users.find((user) => user.role === 'owner');

  if (!owner) {
    console.error('[bootstrap] Error: No owner user found.');
    console.error('[bootstrap] Run: ./bin/mh user create <username>');
    process.exit(1);
  }

  const agentPath = resolveAgentExecutablePath(agentName);
  if (!agentPath) {
    console.error(`[bootstrap] Error: Agent file not found: ${agentName}`);
    process.exit(1);
  }

  // Present the selected agent with a normal argv shape while preserving API/CLI arguments.
  process.argv = [process.argv[0], agentPath, ...agentArgs];

  // Establish owner context for the agent BEFORE importing
  // This allows agent module-level code to access user paths
  await withUserContext(
    {
      userId: owner.id,
      username: owner.username,
      role: 'owner',
    },
    async () => {
      try {
        // Dynamic import of the agent module within user context
        // This allows module-level code like `const x = paths.personaCore` to work
        const agentModule = await import(agentPath);

        // If agent exports a default function, call it
        if (typeof agentModule.default === 'function') {
          await agentModule.default();
        }
        // If agent exports a 'run' function, call it
        else if (typeof agentModule.run === 'function') {
          await agentModule.run();
        }
        // Otherwise, the agent code runs on import (common pattern)
        else {
          // Agent executed during import, nothing more to do
        }
      } catch (error) {
        console.error(`[bootstrap] Failed to run agent ${agentName}:`, error);
        process.exit(1);
      }
    }
  );
}

main().catch((err) => {
  console.error('[bootstrap] Fatal error:', err);
  process.exit(1);
});
