import { runDesireCheckin, type DesireCheckinResult } from '../agency/desire-checkin.js';
import { withUserContext } from '../context.js';
import { getUserByUsername } from '../users.js';
import type { WorkHandlerContext } from './execution-engine.js';
import type { QueuedTask } from './types.js';

export async function executeDesireCheckinWork(
  task: QueuedTask,
  context: WorkHandlerContext,
): Promise<DesireCheckinResult> {
  const user = getUserByUsername(task.username);
  if (!user) throw new Error(`Desire check-in user not found: ${task.username}`);
  return withUserContext(
    { userId: user.id, username: user.username, role: user.role },
    () => runDesireCheckin(task.input, {
      username: user.username,
      cognitiveMode: task.cognitiveMode,
      signal: context.signal,
    }),
  );
}
