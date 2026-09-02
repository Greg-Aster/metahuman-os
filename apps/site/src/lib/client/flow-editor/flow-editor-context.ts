import { getContext, setContext } from 'svelte'

const FLOW_EDITOR_ACTIONS = Symbol('metahuman-flow-editor-actions')

export interface FlowEditorActions {
  updateNodeProperty: (nodeId: string, propertyKey: string, value: unknown) => void
  updateNodeWidth: (nodeId: string, width: number) => void
  selectNode: (nodeId: string) => void
}

export function provideFlowEditorActions(actions: FlowEditorActions): void {
  setContext(FLOW_EDITOR_ACTIONS, actions)
}

export function requireFlowEditorActions(): FlowEditorActions {
  const actions = getContext<FlowEditorActions | undefined>(FLOW_EDITOR_ACTIONS)
  if (!actions) {
    throw new Error('Flow editor actions are unavailable outside FlowEditor')
  }
  return actions
}
