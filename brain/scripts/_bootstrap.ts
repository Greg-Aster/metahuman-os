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
import { getAgentCatalogDefinition } from '@metahuman/core/agent-catalog-definitions';
import { resolveAgentExecutablePath } from '@metahuman/core/agent-executable-resolver';
import { getCurrentlyActiveUser } from '@metahuman/core/sessions';
import { getUsers } from '@metahuman/core/users';

async function executeAgent(agentPath: string, agentArgs: string[]): Promise<void> {
  process.argv = [process.argv[0], agentPath, ...agentArgs];
  const agentModule = await import(agentPath);

  if (typeof agentModule.default === 'function') {
    await agentModule.default();
  } else if (typeof agentModule.run === 'function') {
    await agentModule.run();
  }
}

async function main() {
  const agentName = process.argv[2];
  const agentArgs = process.argv.slice(3);

  if (!agentName) {
    console.error('[bootstrap] Error: Agent name required');
    console.error('Usage: tsx brain/scripts/_bootstrap.ts <agent-name>');
    process.exit(1);
  }

  const agentPath = resolveAgentExecutablePath(agentName);
  if (!agentPath) {
    console.error(`[bootstrap] Error: Agent file not found: ${agentName}`);
    process.exit(1);
  }

  const definition = getAgentCatalogDefinition(agentName);
  if (definition?.executionContext === 'system') {
    delete process.env.MH_TRIGGER_USERNAME;
    try {
      await executeAgent(agentPath, agentArgs);
    } catch (error) {
      console.error(`[bootstrap] Failed to run system agent ${agentName}:`, error);
      process.exit(1);
    }
    return;
  }

  // User-scoped work uses its explicit triggering user or the active session.
  // Never choose a profile merely because it appears first in users.json.
  const users = getUsers();
  const requestedUsername = process.env.MH_TRIGGER_USERNAME?.trim();
  const activeUser = requestedUsername ? null : getCurrentlyActiveUser();
  const targetUser = (requestedUsername
    ? users.find((user) => user.username === requestedUsername)
    : undefined) ?? (activeUser
      ? users.find((user) => user.id === activeUser.userId)
      : undefined);

  if (!targetUser) {
    console.error('[bootstrap] Error: No explicit or active authenticated user found.');
    process.exit(1);
  }

  process.env.MH_TRIGGER_USERNAME = targetUser.username;

  // Establish the authenticated user context for the agent BEFORE importing.
  // This allows agent module-level code to access user paths
  await withUserContext(
    {
      userId: targetUser.id,
      username: targetUser.username,
      role: targetUser.role,
    },
    async () => {
      try {
        await executeAgent(agentPath, agentArgs);
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
