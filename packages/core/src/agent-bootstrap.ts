/**
 * Agent process bootstrap.
 *
 * Resolves one catalog agent and establishes its authenticated user context
 * before importing the executable module.
 *
 * Usage: tsx packages/core/src/agent-bootstrap.ts <agent-name> [...args]
 */

import { getAgentCatalogDefinition } from './agent-catalog-definitions.js';
import { resolveAgentExecutablePath } from './agent-executable-resolver.js';
import { withUserContext } from './context.js';
import { getCurrentlyActiveUser } from './sessions.js';
import { getUsers } from './users.js';

async function executeAgent(agentPath: string, agentArgs: string[]): Promise<void> {
  process.argv = [process.argv[0], agentPath, ...agentArgs];
  const agentModule = await import(agentPath);

  if (typeof agentModule.default === 'function') {
    await agentModule.default();
  } else if (typeof agentModule.run === 'function') {
    await agentModule.run();
  }
}

async function main(): Promise<void> {
  const agentName = process.argv[2];
  const agentArgs = process.argv.slice(3);

  if (!agentName) {
    console.error('[bootstrap] Error: Agent name required');
    console.error('Usage: tsx packages/core/src/agent-bootstrap.ts <agent-name> [...args]');
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
    ? users.find(user => user.username === requestedUsername)
    : undefined) ?? (activeUser
      ? users.find(user => user.id === activeUser.userId)
      : undefined);

  if (!targetUser) {
    console.error('[bootstrap] Error: No explicit or active authenticated user found.');
    process.exit(1);
  }

  process.env.MH_TRIGGER_USERNAME = targetUser.username;

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
    },
  );
}

main().catch(error => {
  console.error('[bootstrap] Fatal error:', error);
  process.exit(1);
});
