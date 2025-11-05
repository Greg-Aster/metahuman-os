import fs from 'node:fs';
import path from 'node:path';
import { paths } from './paths';

export interface PathResolution {
  resolved: string | null;
  isDirectory: boolean;
  isFile: boolean;
  exists: boolean;
  suggestions: string[];
  originalInput: string;
}

/**
 * Resolves a user-provided path (which may be fuzzy, case-insensitive, or incomplete)
 * to an actual filesystem path.
 *
 * This mimics the behavior of modern AI coding assistants like GitHub Copilot.
 */
export function resolvePath(userPath: string, workingDir: string = paths.root): PathResolution {
  const result: PathResolution = {
    resolved: null,
    isDirectory: false,
    isFile: false,
    exists: false,
    suggestions: [],
    originalInput: userPath,
  };

  // Normalize the input path
  const normalizedInput = userPath.trim().replace(/\\/g, '/');

  // Try absolute path first
  if (path.isAbsolute(normalizedInput)) {
    return checkPath(normalizedInput, result);
  }

  // Try relative to working directory
  const absolutePath = path.join(workingDir, normalizedInput);
  const checked = checkPath(absolutePath, result);
  if (checked.exists) {
    return checked;
  }

  // Try case-insensitive match
  const caseInsensitiveMatch = findCaseInsensitivePath(normalizedInput, workingDir);
  if (caseInsensitiveMatch) {
    return checkPath(caseInsensitiveMatch, result);
  }

  // Generate suggestions based on partial matches
  result.suggestions = findSimilarPaths(normalizedInput, workingDir);

  return result;
}

/**
 * Checks if a path exists and populates the PathResolution object
 */
function checkPath(absolutePath: string, result: PathResolution): PathResolution {
  try {
    if (fs.existsSync(absolutePath)) {
      const stats = fs.statSync(absolutePath);
      result.resolved = absolutePath;
      result.exists = true;
      result.isDirectory = stats.isDirectory();
      result.isFile = stats.isFile();
    }
  } catch (err) {
    // Path doesn't exist or permission denied
  }
  return result;
}

/**
 * Finds a path with case-insensitive matching
 * Example: "Docs/user-guide" → "/home/greggles/metahuman/docs/user-guide"
 */
function findCaseInsensitivePath(userPath: string, workingDir: string): string | null {
  const segments = userPath.split('/').filter(s => s.length > 0);
  let currentPath = workingDir;

  for (const segment of segments) {
    if (!fs.existsSync(currentPath)) {
      return null;
    }

    const entries = fs.readdirSync(currentPath, { withFileTypes: true });
    const match = entries.find(entry => entry.name.toLowerCase() === segment.toLowerCase());

    if (!match) {
      return null;
    }

    currentPath = path.join(currentPath, match.name);
  }

  return currentPath;
}

/**
 * Finds similar paths for suggestions when exact match fails
 */
function findSimilarPaths(userPath: string, workingDir: string, maxSuggestions: number = 5): string[] {
  const suggestions: string[] = [];
  const segments = userPath.toLowerCase().split('/').filter(s => s.length > 0);

  if (segments.length === 0) {
    return suggestions;
  }

  try {
    // Search for partial matches
    walkDirectory(workingDir, (filePath, isDir) => {
      const relativePath = path.relative(workingDir, filePath);
      const pathSegments = relativePath.toLowerCase().split(path.sep);

      // Check if any segment matches the user's input segments
      let matchScore = 0;
      for (const userSeg of segments) {
        for (const pathSeg of pathSegments) {
          if (pathSeg.includes(userSeg) || userSeg.includes(pathSeg)) {
            matchScore++;
          }
        }
      }

      if (matchScore > 0 && suggestions.length < maxSuggestions) {
        suggestions.push(relativePath);
      }
    }, 3); // Max depth of 3 to avoid scanning entire tree
  } catch (err) {
    // Error walking directory
  }

  return suggestions.slice(0, maxSuggestions);
}

/**
 * Recursively walks a directory tree
 */
function walkDirectory(
  dir: string,
  callback: (filePath: string, isDir: boolean) => void,
  maxDepth: number,
  currentDepth: number = 0
): void {
  if (currentDepth >= maxDepth) {
    return;
  }

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      // Skip node_modules and hidden directories
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
        continue;
      }

      const fullPath = path.join(dir, entry.name);
      callback(fullPath, entry.isDirectory());

      if (entry.isDirectory()) {
        walkDirectory(fullPath, callback, maxDepth, currentDepth + 1);
      }
    }
  } catch (err) {
    // Permission denied or other error
  }
}

/**
 * Converts a user path to a filesystem glob pattern for searching
 * Example: "Docs/user-guide" becomes case-insensitive glob with wildcards
 */
export function pathToGlobPattern(userPath: string): string {
  const normalized = userPath.trim().replace(/\\/g, '/');
  const segments = normalized.split('/').filter(s => s.length > 0);

  const caseInsensitiveSegments = segments.map(segment => {
    // Convert each character to [Aa] pattern for case-insensitivity
    return segment
      .split('')
      .map(char => {
        if (/[a-zA-Z]/.test(char)) {
          return `[${char.toUpperCase()}${char.toLowerCase()}]`;
        }
        return char;
      })
      .join('');
  });

  // Add wildcards for partial matches
  const fuzzySegments = caseInsensitiveSegments.map(seg => `*${seg}*`);

  return `**/${fuzzySegments.join('/**/')}`;
}

/**
 * Resolves a path and returns a friendly message for the AI
 */
export function resolvePathWithContext(userPath: string, workingDir: string = paths.root): {
  path: string | null;
  isDirectory: boolean;
  message: string;
} {
  const resolution = resolvePath(userPath, workingDir);

  if (resolution.exists && resolution.resolved) {
    if (resolution.isDirectory) {
      return {
        path: resolution.resolved,
        isDirectory: true,
        message: `Found directory: ${resolution.resolved}`,
      };
    } else {
      return {
        path: resolution.resolved,
        isDirectory: false,
        message: `Found file: ${resolution.resolved}`,
      };
    }
  }

  // Path not found - provide helpful message with suggestions
  let message = `Path not found: ${userPath}\n`;

  if (resolution.suggestions.length > 0) {
    message += `\nDid you mean one of these?\n`;
    message += resolution.suggestions.map(s => `  - ${s}`).join('\n');
  } else {
    message += `\nNo similar paths found. Current working directory: ${workingDir}`;
  }

  return {
    path: null,
    isDirectory: false,
    message,
  };
}
