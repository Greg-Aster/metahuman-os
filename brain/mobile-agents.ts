/**
 * Brain-owned mobile agent registration.
 *
 * The Work Coordinator owns queue execution. This file only adapts the
 * canonical AgentModule contract used by each finite brain agent to the
 * coordinator's in-process mobile registration contract.
 */

import { getUserByUsername } from '@metahuman/core'
import {
  initializeMobileAgents as initializeCoordinatorMobileAgents,
  stopMobileAgents as stopCoordinatorMobileAgents,
  type MobileAgentContext,
  type MobileAgentRegistration,
} from '@metahuman/core/mobile-handlers'
import type { AgentModule, AgentResult } from '@metahuman/agent-runtime'

import profileSyncAgent from './agents/profile-sync/index.js'
import organizerAgent from './agents/organizer/index.js'
import ingestorAgent from './agents/ingestor/index.js'
import reflectorAgent from './agents/reflector/index.js'
import dreamerAgent from './agents/dreamer/index.js'
import curiosityServiceAgent from './agents/curiosity-service/index.js'
import innerCuriosityAgent from './agents/inner-curiosity/index.js'
import psychoanalyzerAgent from './agents/psychoanalyzer/index.js'
import desireGeneratorAgent from './agents/desire-generator/index.js'
import desirePlannerAgent from './agents/desire-planner/index.js'

type ResolvedUser = NonNullable<ReturnType<typeof getUserByUsername>>

export interface MobileAgentBinding {
  agent: AgentModule
  systemOptions?: (context: MobileAgentContext) => Record<string, unknown>
}

export interface MobileAgentAdapterDependencies {
  resolveUser?: (username: string) => ResolvedUser | null | undefined
}

const MOBILE_AGENT_BINDINGS: MobileAgentBinding[] = [
  { agent: profileSyncAgent },
  { agent: organizerAgent },
  { agent: ingestorAgent },
  {
    agent: reflectorAgent,
    systemOptions: context => ({
      executionId: context.taskId,
      executionTimestamp: context.createdAt,
    }),
  },
  { agent: dreamerAgent },
  { agent: curiosityServiceAgent },
  {
    agent: innerCuriosityAgent,
    systemOptions: context => ({
      executionId: context.taskId,
      executionTimestamp: context.createdAt,
    }),
  },
  { agent: psychoanalyzerAgent },
  { agent: desireGeneratorAgent },
  { agent: desirePlannerAgent },
]

function assertTaskIdentity(context: MobileAgentContext, agentName: string): string {
  const username = context.username?.trim()
  if (!username) {
    throw new Error(`${agentName} requires an authenticated profile`)
  }

  const identityFlags = new Set(['--username', '--user', '-u'])
  const hasIdentityArgument = context.args.some(argument =>
    identityFlags.has(argument)
      || argument.startsWith('--username=')
      || argument.startsWith('--user='),
  )
  const hasIdentityOption = Object.hasOwn(context.options, 'username')
    || Object.hasOwn(context.options, 'userId')

  if (hasIdentityArgument || hasIdentityOption) {
    throw new Error(
      `${agentName} cannot override the authenticated profile in mobile task input`,
    )
  }

  return username
}

function failureMessage(agentName: string, result: AgentResult): string {
  const messages = [result.error, ...(result.errors || [])]
    .filter((message): message is string => typeof message === 'string' && message.trim().length > 0)
  return [...new Set(messages)].join('; ') || `${agentName} failed`
}

function mobileLogger(agentId: string) {
  return (message: string, level: 'info' | 'warn' | 'error' = 'info'): void => {
    const formatted = `[mobile-${agentId}] ${message}`
    if (level === 'error') console.error(formatted)
    else if (level === 'warn') console.warn(formatted)
    else console.info(formatted)
  }
}

/** Adapt one canonical AgentModule to the Work Coordinator mobile contract. */
export function createMobileAgentRegistration(
  binding: MobileAgentBinding,
  dependencies: MobileAgentAdapterDependencies = {},
): MobileAgentRegistration {
  const resolveUser = dependencies.resolveUser || getUserByUsername
  const { agent } = binding

  return {
    id: agent.meta.id,
    name: agent.meta.name,
    async run(context): Promise<void> {
      const requestedUsername = assertTaskIdentity(context, agent.meta.name)
      const user = resolveUser(requestedUsername)
      if (!user) {
        throw new Error(`${agent.meta.name} profile does not exist: ${requestedUsername}`)
      }

      const result = await agent.run(
        {
          username: user.username,
          userId: user.id,
          dataDir: context.dataDir,
          signal: context.signal,
          log: mobileLogger(agent.meta.id),
        },
        {
          args: [...context.args],
          options: {
            ...context.options,
            ...(binding.systemOptions?.(context) || {}),
          },
        },
      )

      if (!result.success) {
        throw new Error(failureMessage(agent.meta.name, result))
      }
    },
  }
}

/** Register the finite agents supported by the in-process mobile runtime. */
export function registerMobileAgents(): MobileAgentRegistration[] {
  return MOBILE_AGENT_BINDINGS.map(binding => createMobileAgentRegistration(binding))
}

export async function initializeMobileAgents(dataDir: string, username: string): Promise<void> {
  const user = getUserByUsername(username)
  if (!user) throw new Error(`Cannot initialize mobile agents for unknown profile: ${username}`)

  await initializeCoordinatorMobileAgents(dataDir, user.username, registerMobileAgents())
  console.info(`[mobile-agents] Registered agents for ${user.username}`)
}

export function stopMobileAgents(): void {
  stopCoordinatorMobileAgents()
  console.info('[mobile-agents] Unregistered mobile agents')
}
