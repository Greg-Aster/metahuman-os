export const GRAPH_EDITOR_WORKSPACE = 'graph-editor'

export function isGraphEditorLocation(currentUrl: string): boolean {
  return new URL(currentUrl).searchParams.get('workspace') === GRAPH_EDITOR_WORKSPACE
}

export function graphEditorLocation(currentUrl: string, enabled: boolean): string {
  const url = new URL(currentUrl)

  if (enabled) {
    url.searchParams.set('workspace', GRAPH_EDITOR_WORKSPACE)
  } else if (url.searchParams.get('workspace') === GRAPH_EDITOR_WORKSPACE) {
    url.searchParams.delete('workspace')
  }

  return url.toString()
}
