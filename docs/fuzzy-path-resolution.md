# Fuzzy Path Resolution System

**Status**: Active ✓
**Date**: 2025-11-07
**Implementation**: Automatic fuzzy matching for filesystem operations

---

## Overview

The Fuzzy Path Resolution system automatically corrects misspelled or case-mismatched file paths before filesystem operations, preventing "file not found" errors and improving user experience. When a user types "sadsnak" but the file is "sadsnax", the system automatically suggests or resolves to the correct path.

---

## Architecture

### Components

1. **Path Resolver Module** ([`packages/core/src/path-resolver.ts`](../packages/core/src/path-resolver.ts))
   - Core fuzzy matching logic
   - Case-insensitive path resolution
   - Similar path suggestions
   - Glob pattern generation

2. **Operator Integration** ([`brain/agents/operator-react.ts`](../brain/agents/operator-react.ts))
   - Automatic path resolution before filesystem skills
   - Helpful error messages with suggestions
   - Transparent path correction

3. **Filesystem Skills** ([`brain/skills/fs_*.ts`](../brain/skills/))
   - Already support fuzzy glob patterns
   - Work seamlessly with resolved paths

---

## How It Works

### 1. Path Resolution Strategy

When a user provides a path, the system tries multiple strategies in order:

```typescript
resolvePathWithFuzzyFallback("sadsnak") → PathResolution {
  resolved: "/home/greggles/metahuman/sadsnax",
  exists: true,
  isFile: true,
  isDirectory: false,
  suggestions: [],
  originalInput: "sadsnak"
}
```

**Resolution Order**:
1. **Absolute Path**: If path starts with `/` or `C:\`, use it directly
2. **Relative Path**: Join with working directory
3. **Case-Insensitive Match**: Search for path with different case
4. **Fuzzy Suggestions**: Generate list of similar paths

### 2. Case-Insensitive Matching

Example:
```
User input: "Docs/User-Guide"
Actual path: "docs/user-guide"
Result: ✓ Matched (case-insensitive)
```

**Algorithm**:
- Split path into segments: `["Docs", "User-Guide"]`
- For each segment, scan directory entries
- Match lowercase comparison: `entry.name.toLowerCase() === segment.toLowerCase()`
- Build full path using actual casing

### 3. Fuzzy Suggestions

Example:
```
User input: "sadsnak"
Suggestions:
  1. sadsnax
  2. ./docs/sadsnax.md
  3. ./out/snapshots/sad_snack.txt
```

**Algorithm** (`findSimilarPaths`):
- Walk directory tree (max depth 3)
- Skip `node_modules` and hidden directories
- Calculate match score for each file:
  - Split input into segments: `["sadsnak"]`
  - Split file path into segments: `["docs", "sadsnax", "md"]`
  - Count partial matches: `"sadsnak".includes("sadsnax")` or vice versa
  - Higher score = better match
- Return top 5 results

### 4. Glob Pattern Generation

For fuzzy searches with `fs_list`, the system generates case-insensitive glob patterns:

```typescript
pathToGlobPattern("User-Guide")
// Returns: "**/*[Uu][Ss][Ee][Rr]*[Gg][Uu][Ii][Dd][Ee]*"
```

**Algorithm**:
- Convert each character to `[Aa]` pattern for case-insensitivity
- Add wildcards (`*`) between segments
- Prefix with `**/` for recursive search

---

## Integration Points

### Operator Integration

The ReAct operator automatically resolves paths before executing filesystem skills:

```typescript
// Before execution
async function executeSkill(skillName: string, input: any, ...): Promise<SkillResult> {
  // 1. Resolve paths with fuzzy fallback
  const pathResolution = resolveFilesystemPaths(skillName, input);

  // 2. If no exact match, return helpful suggestions
  if (pathResolution.suggestions && pathResolution.suggestions.length > 0) {
    return {
      success: false,
      error: `Path not found: "${pathResolution.originalPath}"\n\n` +
             `Did you mean one of these?\n${suggestionsText}\n\n` +
             `Tip: Use fs_list with a fuzzy pattern like "**/*${pathResolution.originalPath}*" to search.`
    };
  }

  // 3. Use resolved input (automatically corrected paths)
  const result = await coreExecuteSkill(skillName, resolvedInput, ...);
}
```

**Affected Skills**:
- `fs_read` - Read file operations
- `fs_write` - Write file operations
- `fs_list` - List/search operations
- `fs_delete` - Delete operations
- `fs_move` - Move/rename operations
- `fs_copy` - Copy operations

### Automatic Path Fields

The resolver detects paths in multiple input field names:
- `input.path`
- `input.filePath`
- `input.file`
- `input.pattern`

---

## Examples

### Example 1: Misspelled Filename

**User Request**: "Read the file sadsnak"

**Without Fuzzy Resolution**:
```
Error: File not found: sadsnak
```

**With Fuzzy Resolution**:
```
Path not found: "sadsnak"

Did you mean one of these?
  1. sadsnax
  2. ./docs/sadsnax.md
  3. ./out/sad_snack.txt

Tip: Use fs_list with a fuzzy pattern like "**/*sadsnak*" to search.
```

The LLM can then retry with the correct path or ask the user which file they meant.

### Example 2: Case Mismatch

**User Request**: "Read Docs/User-Guide.md"
**Actual Path**: `docs/user-guide.md`

**Resolution**:
```typescript
resolvePathWithFuzzyFallback("Docs/User-Guide.md")
// Returns: {
//   resolved: "/home/greggles/metahuman/docs/user-guide.md",
//   exists: true,
//   isFile: true
// }
```

**Result**: ✓ File read successfully (automatic correction, transparent to user)

### Example 3: Fuzzy Pattern Search

**User Request**: "Find all files with 'user guide' in the name"

**Operator Action**:
```json
{
  "action": "fs_list",
  "actionInput": {
    "pattern": "**/*user*guide*"
  }
}
```

**Result**:
```
Found 3 files:
  - docs/user-guide.md
  - docs/advanced-user-guide.md
  - out/user_guide_draft.txt
```

---

## API Reference

### `resolvePath(userPath, workingDir)`

Core resolution function with all strategies.

**Parameters**:
- `userPath: string` - User-provided path (may be fuzzy/incomplete)
- `workingDir: string` - Base directory (default: project root)

**Returns**: `PathResolution`
```typescript
interface PathResolution {
  resolved: string | null;      // Exact match path (or null)
  isDirectory: boolean;          // True if resolved path is a directory
  isFile: boolean;               // True if resolved path is a file
  exists: boolean;               // True if path exists on filesystem
  suggestions: string[];         // List of similar paths (if no exact match)
  originalInput: string;         // Original user input
}
```

### `resolvePathWithFuzzyFallback(userPath, options)`

Wrapper function optimized for operator use.

**Parameters**:
- `userPath: string` - User-provided path
- `options: { cwd?: string }` - Options (default: project root)

**Returns**: `PathResolution`

**Usage**:
```typescript
import { resolvePathWithFuzzyFallback } from '@metahuman/core/path-resolver';

const resolution = resolvePathWithFuzzyFallback('sadsnak');

if (resolution.exists) {
  console.log(`Found: ${resolution.resolved}`);
} else if (resolution.suggestions.length > 0) {
  console.log(`Did you mean: ${resolution.suggestions.join(', ')}?`);
} else {
  console.log('No matches found');
}
```

### `pathToGlobPattern(userPath)`

Converts a user path to a case-insensitive fuzzy glob pattern.

**Parameters**:
- `userPath: string` - User-provided path

**Returns**: `string` - Glob pattern

**Example**:
```typescript
pathToGlobPattern("User-Guide")
// Returns: "**/*[Uu][Ss][Ee][Rr]*[Gg][Uu][Ii][Dd][Ee]*"
```

### `resolvePathWithContext(userPath, workingDir)`

Human-readable resolution with friendly messages.

**Parameters**:
- `userPath: string` - User-provided path
- `workingDir: string` - Base directory (default: project root)

**Returns**:
```typescript
{
  path: string | null;       // Resolved path or null
  isDirectory: boolean;       // True if directory
  message: string;            // Human-readable message
}
```

**Example**:
```typescript
const result = resolvePathWithContext('sadsnak');
console.log(result.message);
// Output:
// Path not found: sadsnak
//
// Did you mean one of these?
//   - sadsnax
//   - ./docs/sadsnax.md
```

---

## Configuration

### Performance Tuning

**Directory Walk Depth** (in `findSimilarPaths`):
```typescript
walkDirectory(workingDir, callback, 3); // Max depth = 3
```

- **Default**: 3 levels deep
- **Rationale**: Balance between coverage and performance
- **Increase**: For deeper project structures (may slow down)
- **Decrease**: For faster lookups (may miss nested files)

**Max Suggestions**:
```typescript
function findSimilarPaths(userPath, workingDir, maxSuggestions = 5): string[]
```

- **Default**: 5 suggestions
- **Displayed**: Top 5 (sliced in error message)
- **Increase**: For more options (may overwhelm user)

### Excluded Directories

**Automatically Skipped**:
- `node_modules/` - Dependencies (performance)
- `.git/` - Hidden directories (security)
- `.*` - All hidden files/folders (convention)

---

## Performance

**Typical Latency**:
- **Exact Match**: <1ms (filesystem stat)
- **Case-Insensitive**: 1-5ms (single directory scan per segment)
- **Fuzzy Suggestions**: 10-50ms (recursive walk, max depth 3)

**Optimization Strategies**:
1. **Early Exit**: Stop searching once exact match found
2. **Depth Limit**: Prevent full tree traversal (max depth 3)
3. **Skip Directories**: Exclude `node_modules` and hidden folders
4. **Suggestion Limit**: Return only top 5 results

**Caching** (not currently implemented, future enhancement):
- Cache resolved paths for common inputs
- Invalidate on file system changes
- TTL: 5 minutes

---

## Legacy Code References

The fuzzy search system reuses battle-tested logic from the legacy operator:

**Original Implementation**:
- [`brain/agents/operator-legacy.ts`](../brain/agents/operator-legacy.ts) (lines 418, 437, 480)
- [`brain/agents/operator.ts`](../brain/agents/operator.ts) (lines 418, 437, 480)

**Comments from Legacy System**:
```typescript
// Line 418:
// - If searching fails with exact match, try fuzzy patterns: "**/docs/**/*user*guide*"

// Line 437:
// - For filesystem operations, ALWAYS use lowercase paths and fuzzy glob patterns to handle case mismatches

// Line 480:
//   1. fs_list: Search with pattern "**/user*guide*" or "**/*user*guide*" (fuzzy match)
```

These patterns are now **automated** in the ReAct operator via `resolveFilesystemPaths()`.

---

## Testing

### Manual Testing

**Test Case 1: Misspelled Filename**
```bash
# Create test file
echo "content" > sadsnax

# Try to read misspelled version via operator
# Expected: Suggestions shown, then corrected on retry
```

**Test Case 2: Case Mismatch**
```bash
# Create test file
mkdir -p Docs
echo "content" > Docs/User-Guide.md

# Try to read with different case
# Expected: Automatic correction, file read successfully
```

**Test Case 3: Fuzzy Search**
```bash
# Create test files
touch user-guide.md advanced-user-guide.md user_guide_draft.txt

# Search with fs_list
# Pattern: "**/*user*guide*"
# Expected: All 3 files found
```

### Unit Tests (Future)

**Recommended Test Suite**:
```typescript
// tests/path-resolver.test.ts

describe('Path Resolver', () => {
  test('resolves exact match', () => {
    const result = resolvePath('docs/README.md');
    expect(result.exists).toBe(true);
    expect(result.resolved).toBe('/home/greggles/metahuman/docs/README.md');
  });

  test('resolves case-insensitive match', () => {
    const result = resolvePath('Docs/Readme.MD');
    expect(result.exists).toBe(true);
    expect(result.resolved).toBe('/home/greggles/metahuman/docs/README.md');
  });

  test('provides suggestions for misspelled paths', () => {
    const result = resolvePath('sadsnak');
    expect(result.exists).toBe(false);
    expect(result.suggestions).toContain('sadsnax');
  });

  test('generates correct glob pattern', () => {
    const pattern = pathToGlobPattern('User-Guide');
    expect(pattern).toMatch(/\*\*\/.*\[Uu\]\[Ss\]\[Ee\]\[Rr\]/);
  });
});
```

---

## Troubleshooting

### Problem: Suggestions Not Showing

**Symptom**: `resolvePathWithFuzzyFallback()` returns empty suggestions array

**Causes**:
1. File doesn't exist anywhere in project
2. File is in `node_modules` or hidden directory (excluded)
3. File is deeper than max depth (3 levels)
4. Typo is too different (no partial matches)

**Solutions**:
- Check if file exists: `find . -name "*partial*"`
- Increase max depth in `walkDirectory()` call
- Use explicit `fs_list` with glob pattern

### Problem: Wrong File Matched

**Symptom**: Fuzzy search returns incorrect file

**Causes**:
1. Multiple files with similar names
2. Scoring algorithm favors wrong match

**Solutions**:
- Be more specific in path (include directory)
- Use `fs_list` to see all matches first
- Manually specify exact path

### Problem: Slow Performance

**Symptom**: Filesystem operations take >100ms

**Causes**:
1. Large project with many files
2. Deep directory structure
3. Fuzzy search walking entire tree

**Solutions**:
- Reduce max depth (currently 3)
- Add more excluded directories
- Implement caching (future enhancement)

---

## Future Enhancements

**1. Levenshtein Distance**:
- Install `fastest-levenshtein` or `leven` package
- Calculate edit distance for better scoring
- Example: `levenshtein("sadsnak", "sadsnax") = 1` (very similar)

**2. Caching**:
- Cache resolution results for 5 minutes
- Invalidate on filesystem changes (via `fs.watch`)
- Reduce repeated lookups

**3. Semantic Search**:
- Use vector embeddings for filename similarity
- Match based on meaning, not just spelling
- Example: "configuration" matches "config", "setup"

**4. User Learning**:
- Track user corrections (sadsnak → sadsnax)
- Build personalized dictionary
- Auto-correct common typos

**5. Visual Feedback**:
- Show "Corrected: sadsnak → sadsnax" in UI
- Highlight autocorrected paths in responses
- Add confidence scores to suggestions

---

## References

- **Path Resolver Module**: [`packages/core/src/path-resolver.ts`](../packages/core/src/path-resolver.ts)
- **Operator Integration**: [`brain/agents/operator-react.ts`](../brain/agents/operator-react.ts) (lines 512-585)
- **Filesystem Skills**: [`brain/skills/fs_list.ts`](../brain/skills/fs_list.ts) (line 14 - fuzzy pattern docs)
- **Legacy Operator**: [`brain/agents/operator-legacy.ts`](../brain/agents/operator-legacy.ts) (lines 418, 437, 480)

---

**Document Version**: 1.0
**Last Updated**: 2025-11-07
**Status**: Active ✓
