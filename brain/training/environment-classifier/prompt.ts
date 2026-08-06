import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { buildEnvironmentClassifierMessages } from '@metahuman/core/environment-classifier'
import {
  REPOSITORY_ROOT,
  type ClassifierConversationMessage,
  type EnvironmentClassifierCase,
} from './corpus.js'

export const CONTEXT_ROUTER_GRAPH_PATH = resolve(
  REPOSITORY_ROOT,
  'etc/cognitive-graphs/environment-mode.json',
)

export interface ContextRouterPrompt {
  systemPrompt: string
  userPromptTemplate: string
  temperature: number
  maxTokens: number
}

export const COMPACT_CLASSIFIER_INPUT_VERSION = 1

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => values[key] ?? '')
}

export function recentConversationSection(messages: ClassifierConversationMessage[]): string {
  const recentMessages = messages.slice(-4).map(message => {
    const role = message.role === 'user' ? 'User' : 'Assistant'
    const content = message.content.substring(0, 150)
    return `${role}: ${content}${content.length >= 150 ? '...' : ''}`
  }).join('\n')
  return recentMessages ? `Recent conversation:\n${recentMessages}` : ''
}

export function renderContextRouterMessages(
  testCase: Pick<EnvironmentClassifierCase, 'input'>,
  prompt: ContextRouterPrompt,
) {
  const values = {
    userMessage: JSON.stringify(testCase.input.envelope),
    recentConversationSection: recentConversationSection(testCase.input.recentConversation),
  }
  return [
    { role: 'system' as const, content: renderTemplate(prompt.systemPrompt, values) },
    { role: 'user' as const, content: renderTemplate(prompt.userPromptTemplate, values) },
  ]
}

/**
 * Runtime-sized input for a specialized classifier whose weights own the
 * routing rules. The output is still validated by the one Core contract.
 * Keeping the envelope as JSON preserves typed evidence without paying to
 * resend the graph's full routing manual on every inference request.
 */
export function renderCompactClassifierInput(
  testCase: Pick<EnvironmentClassifierCase, 'input'>,
): string {
  return buildEnvironmentClassifierMessages({
    routingRequest: testCase.input.envelope,
    recentConversation: testCase.input.recentConversation,
  })[1].content
}

export async function loadContextRouterPrompt(): Promise<ContextRouterPrompt> {
  const graph = JSON.parse(await readFile(CONTEXT_ROUTER_GRAPH_PATH, 'utf8')) as {
    nodes?: Array<Record<string, unknown>>
  }
  const router = graph.nodes?.find(node => node.id === 'context-router')
  const data = isRecord(router?.data) ? router.data : null
  const properties = isRecord(data?.properties) ? data.properties : null
  if (!properties
    || typeof properties.systemPrompt !== 'string'
    || typeof properties.userPromptTemplate !== 'string') {
    throw new Error('Active Environment graph has no usable context-router prompt')
  }
  return {
    systemPrompt: properties.systemPrompt,
    userPromptTemplate: properties.userPromptTemplate,
    temperature: typeof properties.temperature === 'number' ? properties.temperature : 0.1,
    maxTokens: typeof properties.maxTokens === 'number' ? properties.maxTokens : 256,
  }
}
