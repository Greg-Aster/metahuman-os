export function normalizeGraphFileName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
}

export function saveDialogFileName(currentFileName: string, graphDisplayName: string): string {
  if (currentFileName) return currentFileName

  return normalizeGraphFileName(graphDisplayName.replace(/[()]/g, ''))
    .replace(/^-+|-+$/g, '')
    .substring(0, 50)
}

export function overwritesDifferentGraph(
  currentFileName: string,
  targetFileName: string,
  knownFileNames: readonly string[],
): boolean {
  return targetFileName !== currentFileName && knownFileNames.includes(targetFileName)
}
