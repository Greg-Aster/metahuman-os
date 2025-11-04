import fg from 'fast-glob'

export interface GlobOptions {
  dot?: boolean
  onlyFiles?: boolean
  unique?: boolean
  followSymbolicLinks?: boolean
  suppressErrors?: boolean
}

export async function listGlob(
  baseDir: string,
  pattern: string,
  options: GlobOptions = {}
): Promise<string[]> {
  return fg(pattern, {
    cwd: baseDir,
    dot: options.dot ?? false,
    onlyFiles: options.onlyFiles ?? true,
    unique: options.unique ?? true,
    followSymbolicLinks: options.followSymbolicLinks ?? false,
    suppressErrors: options.suppressErrors ?? true,
  })
}

