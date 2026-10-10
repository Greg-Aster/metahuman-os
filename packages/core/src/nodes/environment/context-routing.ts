/** Context selection shared by interactive requests and delegated autonomy intentions. */
export const ENVIRONMENT_CONTEXT_ENTRIES = [
  'persona.identity', 'persona.background', 'persona.personality', 'persona.values', 'persona.goals',
  'conversationHistory', 'memory', 'robotStatus', 'environment', 'vision', 'executionContext',
] as const;

export type EnvironmentContextEntry = typeof ENVIRONMENT_CONTEXT_ENTRIES[number];
export interface EnvironmentRequestRouting {
  needsResponse: boolean;
  needsAction: boolean;
  needsToolUse?: boolean;
  taskContext: EnvironmentContextEntry[];
  conversationContext: EnvironmentContextEntry[];
  memoryQuery?: string;
  memoryTypes?: string[];
}

export function selectedEnvironmentRoutes(
  routing: Record<string, any>,
  consumer?: 'task' | 'conversation',
): Record<string, boolean> {
  if (!Array.isArray(routing.taskContext) || !Array.isArray(routing.conversationContext)) {
    return Object.fromEntries(Object.entries(routing).filter(([, value]) => typeof value === 'boolean'));
  }
  const selected: string[] = consumer ? routing[`${consumer}Context`] : [...routing.taskContext, ...routing.conversationContext];
  return {
    needsResponse: routing.needsResponse,
    needsAction: routing.needsAction,
    ...(routing.needsToolUse !== undefined ? { needsToolUse: routing.needsToolUse } : {}),
    needsPersona: selected.some(entry => entry.startsWith('persona.')),
    needsConversationHistory: selected.includes('conversationHistory'),
    needsMemory: selected.includes('memory'),
    needsRobotStatus: selected.includes('robotStatus'),
    needsEnvironment: selected.includes('environment'),
    needsVision: selected.includes('vision'),
    needsExecutionContext: selected.includes('executionContext'),
  };
}
