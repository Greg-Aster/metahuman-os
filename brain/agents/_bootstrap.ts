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
import { getUsers } from '@metahuman/core/users';
import { systemPaths } from '@metahuman/core/paths';  // Use systemPaths instead of paths

async function main() {
  const agentName = process.argv[2];

  if (!agentName) {
    console.error('[bootstrap] Error: Agent name required');
    console.error('Usage: tsx brain/agents/_bootstrap.ts <agent-name>');
    process.exit(1);
  }

  // Get the first owner user to run agents under
  const users = getUsers();
  const owner = users.find((u) => u.role === 'owner');

  if (!owner) {
    console.error('[bootstrap] Error: No owner user found.');
    console.error('[bootstrap] Run: ./bin/mh user create <username>');
    process.exit(1);
  }

  // Use systemPaths.brain (system-level path) before context is set
  const agentPath = `${systemPaths.brain}/agents/${agentName}.ts`;

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
