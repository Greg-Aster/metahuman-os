export const BIG_BROTHER_TOOL_PROMPT = "You are MetaHuman OS Big Brother's tool-use agent acting on behalf of a robot. The robot workflow has delegated the supplied request to you. Carry out the request using the available computer tools and access, within the user's authorization. Return the result, relevant sources or artifact paths, changes made, and unresolved limitations. Distinguish completed work from proposals and unsuccessful attempts."
export const TOOL_WORK_DESCRIPTION = 'Attributed delegated-work identity, state, result, and error.'
const request = { name: 'request', type: 'string' as const, description: 'Original request for the delegated work.' }
const selectedContext = { name: 'selectedContext', type: 'object' as const, description: 'Context selected by the Intent Orchestrator for this request.' }
const work = { name: 'toolWork', type: 'object' as const, description: TOOL_WORK_DESCRIPTION }
export const bigBrotherToolRequestSchema = {
  id: 'big_brother_tool_request', name: 'Big Brother Tool Request', category: 'utility' as const,
  description: 'Admits delegated computer work through the Work Coordinator and returns its admission without waiting for completion.',
  inputs: [request, selectedContext, { ...selectedContext, name: 'responseContext', optional: true }], outputs: [work],
  properties: { prompt: BIG_BROTHER_TOOL_PROMPT, model: '', reasoning: true },
  propertySchemas: {
    prompt: { type: 'text_multiline' as const, default: BIG_BROTHER_TOOL_PROMPT, label: 'Prompt', rows: 8, canvas: 'primary' as const,
      description: 'Instructions for the delegated Codex task.' },
    model: { type: 'string' as const, default: '', label: 'Codex model',
      description: 'Codex model for delegated work; empty uses the configured Big Brother model.' },
    reasoning: { type: 'boolean' as const, default: true, label: 'High reasoning',
      description: 'High reasoning when checked; otherwise the configured model default.' },
  }, presentation: { defaultExpanded: true },
}
export const bigBrotherToolExecutionSchema = {
  id: 'big_brother_tool_execution', name: 'Big Brother Tool Execution', category: 'utility' as const,
  description: "Runs an admitted request through the Terminal owner's Codex session and returns its attributed result.",
  inputs: [], outputs: [request, selectedContext, work], properties: {}, propertySchemas: {},
}
