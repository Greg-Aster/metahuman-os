/**
 * Function Memory System
 *
 * Stores reusable "how-to" execution patterns learned from successful operator runs.
 * Functions help the operator execute complex multi-step tasks by providing proven workflows.
 *
 * Storage layout:
 * - memory/functions/verified/ - User-approved, trusted functions
 * - memory/functions/drafts/ - Auto-learned functions awaiting review
 */

import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { audit } from './audit';
import { storageClient } from './storage-client.js';

/**
 * Trust level for function memory
 * - draft: Newly learned, awaiting user review
 * - verified: User-approved, ready for operator use
 */
export type FunctionTrustLevel = 'draft' | 'verified';

/**
 * Individual skill execution step within a function
 */
export interface FunctionStep {
  /** Sequential step number (1-indexed) */
  step: number;
  /** Skill ID to execute */
  skill: string;
  /** Arguments to pass to the skill */
  args: Record<string, any>;
  /** Human-readable description of what this step does */
  description: string;
  /** Expected observation/result pattern (optional) */
  expectedResult?: string;
}

/**
 * Metadata about function origin and usage
 */
export interface FunctionMetadata {
  /** When this function was created */
  createdAt: string;
  /** When this function was last modified */
  updatedAt: string;
  /** User who created/approved this function */
  createdBy: string;
  /** Trust level (draft or verified) */
  trustLevel: FunctionTrustLevel;
  /** How many times this function has been used */
  usageCount: number;
  /** How many times this function succeeded */
  successCount: number;
  /** Last time this function was used */
  lastUsedAt?: string;
  /** Source operator session that generated this function (for drafts) */
  sourceSessionId?: string;
  /** Vector embedding version (for semantic search) */
  embeddingVersion?: string;
  /** Quality score (0.0 to 1.0) based on usage stats - Phase 4.2 */
  qualityScore?: number;
}

/**
 * Example use case for a function
 */
export interface FunctionExample {
  /** Example user query */
  query: string;
  /** Expected outcome */
  outcome: string;
}

/**
 * Complete function memory structure
 */
export interface FunctionMemory {
  /** Unique identifier */
  id: string;
  /** Human-readable function title */
  title: string;
  /** Brief summary of what this function does */
  summary: string;
  /** Detailed description */
  description: string;
  /** Ordered list of skill execution steps */
  steps: FunctionStep[];
  /** Skills used in this function (for quick filtering) */
  skillsUsed: string[];
  /** Keywords/tags for semantic search */
  tags: string[];
  /** Example use cases */
  examples: FunctionExample[];
  /** Metadata */
  metadata: FunctionMetadata;
}

/**
 * Options for listing functions
 */
export interface ListFunctionsOptions {
  /** Filter by trust level */
  trustLevel?: FunctionTrustLevel;
  /** Filter by skill usage */
  usesSkill?: string;
  /** Sort by field */
  sortBy?: 'title' | 'createdAt' | 'usageCount' | 'successRate' | 'qualityScore';
  /** Sort direction */
  sortOrder?: 'asc' | 'desc';
  /** Limit results */
  limit?: number;
  /** Include draft functions (for internal use) */
  includeDrafts?: boolean;
}

/**
 * Get functions directory path based on trust level
 * Uses storage router for consistent path resolution
 */
function getFunctionsPath(trustLevel: FunctionTrustLevel, _profilePaths?: any): string {
  const subdir = trustLevel === 'verified' ? 'verified' : 'drafts';
  const result = storageClient.resolvePath({
    category: 'memory',
    subcategory: 'functions',
    relativePath: subdir,
  });

  if (!result.success || !result.path) {
    throw new Error('Cannot access function memory: User authentication required');
  }

  return result.path;
}

/**
 * Generate filename for a function
 */
function getFunctionFilename(functionId: string): string {
  return `${functionId}.json`;
}

/**
 * Save a function to disk
 *
 * @param func - Function memory to save
 * @param profilePaths - Optional profile paths (for multi-tenant support)
 * @returns Path where function was saved
 */
export async function saveFunction(
  func: FunctionMemory,
  profilePaths?: any
): Promise<string> {
  const dir = getFunctionsPath(func.metadata.trustLevel, profilePaths);
  const filename = getFunctionFilename(func.id);
  const filepath = path.join(dir, filename);

  // Ensure directory exists
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Update timestamp
  func.metadata.updatedAt = new Date().toISOString();

  // Write to disk
  fs.writeFileSync(filepath, JSON.stringify(func, null, 2), 'utf-8');

  // Audit log
  audit({
    level: 'info',
    category: 'data',
    event: 'function_saved',
    details: {
      functionId: func.id,
      title: func.title,
      trustLevel: func.metadata.trustLevel,
      skillsUsed: func.skillsUsed,
      stepCount: func.steps.length,
    },
    actor: func.metadata.createdBy,
  });

  return filepath;
}

/**
 * Load a function from disk
 *
 * @param functionId - Function ID to load
 * @param trustLevel - Trust level (defaults to searching both)
 * @param profilePaths - Optional profile paths
 * @returns Function memory or null if not found
 */
export async function loadFunction(
  functionId: string,
  trustLevel?: FunctionTrustLevel,
  profilePaths?: any
): Promise<FunctionMemory | null> {
  const levelsToCheck: FunctionTrustLevel[] = trustLevel
    ? [trustLevel]
    : ['verified', 'draft'];

  for (const level of levelsToCheck) {
    const dir = getFunctionsPath(level, profilePaths);
    const filename = getFunctionFilename(functionId);
    const filepath = path.join(dir, filename);

    if (fs.existsSync(filepath)) {
      const content = fs.readFileSync(filepath, 'utf-8');
      return JSON.parse(content) as FunctionMemory;
    }
  }

  return null;
}

/**
 * List all functions matching criteria
 *
 * @param options - Filter and sort options
 * @param profilePaths - Optional profile paths
 * @returns Array of function memories
 */
export async function listFunctions(
  options: ListFunctionsOptions = {},
  profilePaths?: any
): Promise<FunctionMemory[]> {
  const levelsToCheck: FunctionTrustLevel[] = options.trustLevel
    ? [options.trustLevel]
    : ['verified', 'draft'];

  const functions: FunctionMemory[] = [];

  for (const level of levelsToCheck) {
    const dir = getFunctionsPath(level, profilePaths);

    if (!fs.existsSync(dir)) {
      continue;
    }

    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));

    for (const file of files) {
      const filepath = path.join(dir, file);
      const content = fs.readFileSync(filepath, 'utf-8');
      const func = JSON.parse(content) as FunctionMemory;

      // Apply filters
      if (options.usesSkill && !func.skillsUsed.includes(options.usesSkill)) {
        continue;
      }

      functions.push(func);
    }
  }

  // Sort
  if (options.sortBy) {
    functions.sort((a, b) => {
      let aVal: any;
      let bVal: any;

      switch (options.sortBy) {
        case 'title':
          aVal = a.title.toLowerCase();
          bVal = b.title.toLowerCase();
          break;
        case 'createdAt':
          aVal = new Date(a.metadata.createdAt).getTime();
          bVal = new Date(b.metadata.createdAt).getTime();
          break;
        case 'usageCount':
          aVal = a.metadata.usageCount;
          bVal = b.metadata.usageCount;
          break;
        case 'successRate':
          aVal = a.metadata.usageCount > 0
            ? a.metadata.successCount / a.metadata.usageCount
            : 0;
          bVal = b.metadata.usageCount > 0
            ? b.metadata.successCount / b.metadata.usageCount
            : 0;
          break;
        case 'qualityScore': // Phase 4.2
          aVal = a.metadata.qualityScore || 0;
          bVal = b.metadata.qualityScore || 0;
          break;
        default:
          aVal = a.metadata.createdAt;
          bVal = b.metadata.createdAt;
      }

      if (options.sortOrder === 'desc') {
        return aVal < bVal ? 1 : -1;
      } else {
        return aVal > bVal ? 1 : -1;
      }
    });
  }

  // Limit
  if (options.limit && options.limit > 0) {
    return functions.slice(0, options.limit);
  }

  return functions;
}

/**
 * Delete a function from disk
 *
 * @param functionId - Function ID to delete
 * @param trustLevel - Trust level (defaults to searching both)
 * @param profilePaths - Optional profile paths
 * @param actor - User performing the deletion
 * @returns true if deleted, false if not found
 */
export async function deleteFunction(
  functionId: string,
  trustLevel?: FunctionTrustLevel,
  profilePaths?: any,
  actor: string = 'system'
): Promise<boolean> {
  const levelsToCheck: FunctionTrustLevel[] = trustLevel
    ? [trustLevel]
    : ['verified', 'draft'];

  for (const level of levelsToCheck) {
    const dir = getFunctionsPath(level, profilePaths);
    const filename = getFunctionFilename(functionId);
    const filepath = path.join(dir, filename);

    if (fs.existsSync(filepath)) {
      // Load function for audit log
      const content = fs.readFileSync(filepath, 'utf-8');
      const func = JSON.parse(content) as FunctionMemory;

      // Delete file
      fs.unlinkSync(filepath);

      // Audit log
      audit({
        level: 'info',
        category: 'data',
        event: 'function_deleted',
        details: {
          functionId,
          title: func.title,
          trustLevel: level,
        },
        actor,
      });

      return true;
    }
  }

  return false;
}

/**
 * Promote a function from draft to verified
 *
 * @param functionId - Function ID to promote
 * @param profilePaths - Optional profile paths
 * @param actor - User performing the promotion
 * @returns true if promoted, false if not found or already verified
 */
export async function promoteFunction(
  functionId: string,
  profilePaths?: any,
  actor: string = 'system'
): Promise<boolean> {
  // Load draft function
  const func = await loadFunction(functionId, 'draft', profilePaths);

  if (!func) {
    return false;
  }

  // Delete from drafts
  const draftPath = path.join(
    getFunctionsPath('draft', profilePaths),
    getFunctionFilename(functionId)
  );
  fs.unlinkSync(draftPath);

  // Update metadata
  func.metadata.trustLevel = 'verified';
  func.metadata.updatedAt = new Date().toISOString();

  // Save to verified
  await saveFunction(func, profilePaths);

  // Audit log
  audit({
    level: 'info',
    category: 'data',
    event: 'function_promoted',
    details: {
      functionId,
      title: func.title,
      promotedBy: actor,
    },
    actor,
  });

  return true;
}

/**
 * Increment usage statistics for a function
 *
 * @param functionId - Function ID
 * @param success - Whether the execution succeeded
 * @param profilePaths - Optional profile paths
 */
export async function recordFunctionUsage(
  functionId: string,
  success: boolean,
  profilePaths?: any
): Promise<void> {
  const func = await loadFunction(functionId, undefined, profilePaths);

  if (!func) {
    return;
  }

  func.metadata.usageCount++;
  if (success) {
    func.metadata.successCount++;
  }
  func.metadata.lastUsedAt = new Date().toISOString();

  // Phase 4.2: Recalculate quality score after usage update
  func.metadata.qualityScore = calculateQualityScore(func);

  await saveFunction(func, profilePaths);
}

/**
 * Create a new function memory from operator execution
 *
 * @param title - Function title
 * @param summary - Brief summary
 * @param description - Detailed description
 * @param steps - Execution steps
 * @param examples - Example use cases
 * @param tags - Keywords for search
 * @param createdBy - User/session that created this
 * @param trustLevel - Initial trust level (default: draft)
 * @param sourceSessionId - Source operator session
 * @returns New function memory
 */
export function createFunction(
  title: string,
  summary: string,
  description: string,
  steps: FunctionStep[],
  examples: FunctionExample[],
  tags: string[],
  createdBy: string,
  trustLevel: FunctionTrustLevel = 'draft',
  sourceSessionId?: string
): FunctionMemory {
  const now = new Date().toISOString();
  const skillsUsed = Array.from(new Set(steps.map(s => s.skill)));

  const func: FunctionMemory = {
    id: uuidv4(),
    title,
    summary,
    description,
    steps,
    skillsUsed,
    tags,
    examples,
    metadata: {
      createdAt: now,
      updatedAt: now,
      createdBy,
      trustLevel,
      usageCount: 0,
      successCount: 0,
      sourceSessionId,
      qualityScore: 0.0, // Phase 4.2: Will be calculated
    },
  };

  // Phase 4.2: Calculate initial quality score
  func.metadata.qualityScore = calculateQualityScore(func);

  return func;
}

/**
 * Retrieve functions using semantic search
 *
 * Searches the vector index for functions matching the query.
 * Only returns verified functions by default (can include drafts via options).
 *
 * @param query - Search query (typically the user's goal)
 * @param options - Search options
 * @returns Array of matching functions with relevance scores
 */
export async function retrieveFunctions(
  query: string,
  options: {
    topK?: number;
    minScore?: number;
    includeDrafts?: boolean;
    profilePaths?: any;
  } = {}
): Promise<Array<{ function: FunctionMemory; score: number }>> {
  const { topK = 5, minScore = 0.5, includeDrafts = false } = options;

  // Import vector search functions
  const { queryIndex } = await import('./vector-index');

  // Perform semantic search
  const results = await queryIndex(query, { topK: topK * 2 }); // Get extra results for filtering

  // Filter for function type only
  const functionResults = results.filter(r => r.item.type === 'function');

  // Load full function data
  const functionsWithScores: Array<{ function: FunctionMemory; score: number }> = [];

  for (const result of functionResults) {
    if (result.score < minScore) continue;

    // Extract function ID from path
    const filename = path.basename(result.item.path);
    const functionId = filename.replace('.json', '');

    // Load function
    const func = await loadFunction(functionId, undefined, options.profilePaths);

    if (!func) continue;

    // Filter by trust level
    if (!includeDrafts && func.metadata.trustLevel === 'draft') {
      continue;
    }

    functionsWithScores.push({ function: func, score: result.score });

    if (functionsWithScores.length >= topK) break;
  }

  return functionsWithScores;
}

/**
 * Format a function as a guide for LLM prompts
 *
 * Converts a function into a markdown-formatted guide that the operator
 * can use to understand how to execute a multi-step task.
 *
 * @param func - Function to format
 * @param options - Formatting options
 * @returns Markdown-formatted guide
 */
export function formatFunctionAsGuide(
  func: FunctionMemory,
  options: {
    includeExamples?: boolean;
    includeMetadata?: boolean;
  } = {}
): string {
  const { includeExamples = true, includeMetadata = false } = options;

  const lines: string[] = [];

  // Header
  lines.push(`### ${func.title}`);
  lines.push('');

  // Summary
  lines.push(`**Summary**: ${func.summary}`);
  lines.push('');

  // Description (if different from summary)
  if (func.description && func.description !== func.summary) {
    lines.push(`**Description**: ${func.description}`);
    lines.push('');
  }

  // Skills used
  if (func.skillsUsed.length > 0) {
    lines.push(`**Skills Required**: ${func.skillsUsed.join(', ')}`);
    lines.push('');
  }

  // Steps
  lines.push('**Steps**:');
  for (const step of func.steps) {
    lines.push(`${step.step}. **${step.skill}**: ${step.description}`);
    if (step.expectedResult) {
      lines.push(`   - Expected: ${step.expectedResult}`);
    }
  }
  lines.push('');

  // Examples
  if (includeExamples && func.examples.length > 0) {
    lines.push('**Example Use Cases**:');
    for (const example of func.examples) {
      lines.push(`- "${example.query}" → ${example.outcome}`);
    }
    lines.push('');
  }

  // Metadata (usage stats)
  if (includeMetadata && func.metadata.usageCount > 0) {
    const successRate = (func.metadata.successCount / func.metadata.usageCount * 100).toFixed(0);
    lines.push(`**Track Record**: Used ${func.metadata.usageCount}× (${successRate}% success)`);
    lines.push('');
  }

  return lines.join('\n').trim();
}

/**
 * Format multiple functions as a collection of guides
 *
 * @param functions - Array of functions with scores
 * @param options - Formatting options
 * @returns Markdown-formatted guide collection
 */
export function formatFunctionsAsGuides(
  functions: Array<{ function: FunctionMemory; score: number }>,
  options: {
    includeScores?: boolean;
    includeExamples?: boolean;
    includeMetadata?: boolean;
  } = {}
): string {
  const { includeScores = false, includeExamples = true, includeMetadata = false } = options;

  if (functions.length === 0) {
    return '';
  }

  const lines: string[] = [];

  lines.push('## Function Guides');
  lines.push('');
  lines.push('The following proven workflows may help you accomplish this goal:');
  lines.push('');

  for (const { function: func, score } of functions) {
    const guide = formatFunctionAsGuide(func, { includeExamples, includeMetadata });

    if (includeScores) {
      const scorePercent = (score * 100).toFixed(0);
      lines.push(`${guide} _(${scorePercent}% match)_`);
    } else {
      lines.push(guide);
    }

    lines.push('');
    lines.push('---');
    lines.push('');
  }

  return lines.join('\n').trim();
}

/**
 * Detect and learn patterns from operator execution
 *
 * Analyzes a successful operator run to determine if it represents a reusable
 * multi-step pattern. If criteria are met, creates a draft function for review.
 *
 * @param goal - User goal that triggered execution
 * @param scratchpad - Operator scratchpad (thought-action-observation entries)
 * @param metadata - Session and user information
 */
export async function detectAndLearnPattern(
  goal: string,
  scratchpad: any[],
  metadata: {
    sessionId?: string;
    userId: string;
  }
): Promise<void> {
  // Filter scratchpad entries that have actions (actual skill executions)
  const actionEntries = scratchpad.filter(entry => entry.action);

  // Extract skill sequence
  const skillsUsed = actionEntries.map(entry => entry.action.tool);
  const uniqueSkills = Array.from(new Set(skillsUsed));

  // Phase 4.3: Apply enhanced learning criteria
  const learningCheck = shouldLearnPattern(scratchpad, skillsUsed);

  if (!learningCheck.shouldLearn) {
    // Pattern doesn't meet learning criteria - log and skip
    audit({
      level: 'info',
      category: 'action',
      event: 'function_learning_skipped',
      details: {
        goal: goal.substring(0, 100),
        reason: learningCheck.reason,
        steps: actionEntries.length,
        uniqueSkills: uniqueSkills.length,
      },
      actor: metadata.userId,
    });
    return;
  }

  // ========================================================================
  // Pattern meets criteria - Check for duplicates first (Phase 4.1)
  // ========================================================================

  // Check if similar function already exists (Phase 4.1)
  const similarFunctions = await findSimilarFunctions(skillsUsed, {
    threshold: LEARNING_CONFIG.similarityThreshold,
    includeDrafts: true,
  });

  if (similarFunctions.length > 0) {
    // Found similar function(s) - record usage instead of creating duplicate
    const mostSimilar = similarFunctions[0];

    await recordFunctionUsage(mostSimilar.function.id, true);

    audit({
      level: 'info',
      category: 'action',
      event: 'function_learning_skipped_duplicate',
      details: {
        sourceGoal: goal.substring(0, 100),
        similarFunctionId: mostSimilar.function.id,
        similarFunctionTitle: mostSimilar.function.title,
        similarity: mostSimilar.similarity.toFixed(2),
        reason: 'Similar function already exists',
      },
      actor: metadata.userId,
    });

    return; // Skip creating duplicate
  }

  // Phase 4.3: Detect pattern type and generate descriptive title
  const patternType = detectPatternType(skillsUsed);
  const title = generatePatternAwareTitle(goal, patternType);

  // Calculate success rate for description
  const successfulActions = actionEntries.filter(
    entry => entry.observation && entry.observation.success !== false
  );
  const successRate = successfulActions.length / actionEntries.length;

  // Generate summary
  const summary = `Multi-step ${patternType.replace('_', ' ')} workflow learned from successful execution: ${goal.substring(0, 70)}${goal.length > 70 ? '...' : ''}`;

  // Generate description
  const description = `This ${patternType.replace('_', ' ')} function was automatically learned from a successful operator run that used ${actionEntries.length} steps with ${uniqueSkills.length} different skills. Success rate: ${(successRate * 100).toFixed(0)}%. Pattern complexity: ${patternType}.`;

  // Create function steps from scratchpad
  const steps: FunctionStep[] = actionEntries.map((entry, idx) => ({
    step: idx + 1,
    skill: entry.action.tool,
    args: entry.action.args,
    description: entry.thought || `Execute ${entry.action.tool}`,
    expectedResult: entry.observation?.content ? entry.observation.content.substring(0, 100) : undefined,
  }));

  // Create example from this execution
  const examples: FunctionExample[] = [
    {
      query: goal,
      outcome: 'Successfully completed using this workflow',
    },
  ];

  // Extract tags from skills used (Phase 4.3: include pattern type)
  const tags = ['auto-learned', patternType, ...uniqueSkills];

  // Create draft function
  const draftFunction = createFunction(
    title,
    summary,
    description,
    steps,
    examples,
    tags,
    metadata.userId,
    'draft',
    metadata.sessionId
  );

  // Save to drafts directory
  await saveFunction(draftFunction);

  // Audit log
  audit({
    level: 'info',
    category: 'action',
    event: 'function_auto_learned',
    details: {
      functionId: draftFunction.id,
      title,
      stepCount: steps.length,
      uniqueSkills: uniqueSkills.length,
      successRate: (successRate * 100).toFixed(0),
      sourceGoal: goal.substring(0, 100),
    },
    actor: metadata.userId,
  });
}

/**
 * Generate a title from a user goal
 *
 * Attempts to create a concise, action-oriented title from the user's goal.
 *
 * @param goal - User goal text
 * @returns Generated title
 */
function generateFunctionTitle(goal: string): string {
  // Clean and normalize the goal
  const cleaned = goal.trim().replace(/[^a-zA-Z0-9\s]/g, ' ').replace(/\s+/g, ' ');

  // Extract first few words (up to 6)
  const words = cleaned.split(' ').slice(0, 6);

  // Capitalize first letter of each word
  const titleCased = words
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');

  return titleCased || 'Learned Workflow';
}

// ============================================================================
// Phase 4.1: Deduplication & Similarity Detection
// ============================================================================

/**
 * Calculate similarity between two skill sequences
 *
 * Uses Jaccard similarity: intersection / union
 *
 * @param skills1 - First skill sequence
 * @param skills2 - Second skill sequence
 * @returns Similarity score (0.0 to 1.0)
 */
function calculateSkillSimilarity(skills1: string[], skills2: string[]): number {
  // Convert to sets for comparison
  const set1 = new Set(skills1);
  const set2 = new Set(skills2);

  // Calculate intersection
  const intersection = new Set([...set1].filter(skill => set2.has(skill)));

  // Calculate union
  const union = new Set([...set1, ...set2]);

  // Jaccard similarity: |A ∩ B| / |A ∪ B|
  const similarity = intersection.size / union.size;

  return similarity;
}

/**
 * Find functions with similar skill sequences
 *
 * Searches all functions and returns those that exceed the similarity threshold.
 *
 * @param candidateSkills - Skill sequence to compare against
 * @param options - Search options
 * @returns Sorted list of similar functions (highest similarity first)
 */
async function findSimilarFunctions(
  candidateSkills: string[],
  options: {
    threshold?: number;
    includeDrafts?: boolean;
  } = {}
): Promise<Array<{ function: FunctionMemory; similarity: number }>> {
  const { threshold = 0.7, includeDrafts = true } = options;

  // List all functions
  const allFunctions = await listFunctions({ includeDrafts });

  // Calculate similarity for each function
  const similarities: Array<{ function: FunctionMemory; similarity: number }> = [];

  for (const func of allFunctions) {
    const funcSkills = func.steps.map(step => step.skill);
    const similarity = calculateSkillSimilarity(candidateSkills, funcSkills);

    if (similarity >= threshold) {
      similarities.push({ function: func, similarity });
    }
  }

  // Sort by similarity (descending)
  similarities.sort((a, b) => b.similarity - a.similarity);

  return similarities;
}

// ============================================================================
// Phase 4.3: Learning Refinement Rules
// ============================================================================

/**
 * Configuration for auto-learning criteria
 * Can be tuned based on system performance and user feedback
 */
const LEARNING_CONFIG = {
  /** Minimum number of steps required to learn a pattern */
  minSteps: 3,
  /** Minimum success rate (0.0 to 1.0) */
  minSuccessRate: 0.8,
  /** Minimum number of unique skills */
  minUniqueSkills: 2,
  /** Maximum number of steps (avoid learning overly complex patterns) */
  maxSteps: 15,
  /** Similarity threshold for deduplication */
  similarityThreshold: 0.7,
};

/**
 * Pattern types detected from skill sequences
 */
type PatternType =
  | 'crud' // Create, Read, Update, Delete operations
  | 'data_transform' // Data processing and transformation
  | 'search_analyze' // Search and analysis workflow
  | 'communication' // Email, message, notification workflows
  | 'file_management' // File operations
  | 'general'; // Generic multi-step pattern

/**
 * Detect pattern type from skill sequence
 *
 * @param skills - List of skills used
 * @returns Detected pattern type
 */
function detectPatternType(skills: string[]): PatternType {
  const skillSet = new Set(skills.map(s => s.toLowerCase()));

  // CRUD operations
  if (
    skillSet.has('create_memory') ||
    skillSet.has('update_task') ||
    skillSet.has('delete_file') ||
    (skillSet.has('fs_write') && skillSet.has('fs_read'))
  ) {
    return 'crud';
  }

  // Data transformation
  if (
    skillSet.has('json_parse') ||
    skillSet.has('data_filter') ||
    skillSet.has('format_output') ||
    skills.some(s => s.includes('transform') || s.includes('convert'))
  ) {
    return 'data_transform';
  }

  // Search and analyze
  if (
    (skillSet.has('search_memory') || skillSet.has('semantic_search')) &&
    (skillSet.has('analyze_sentiment') || skillSet.has('extract_entities'))
  ) {
    return 'search_analyze';
  }

  // Communication
  if (
    skillSet.has('send_email') ||
    skillSet.has('send_message') ||
    skillSet.has('notify_user')
  ) {
    return 'communication';
  }

  // File management
  if (
    (skillSet.has('fs_list') || skillSet.has('fs_read') || skillSet.has('fs_write')) &&
    skills.filter(s => s.startsWith('fs_')).length >= 2
  ) {
    return 'file_management';
  }

  return 'general';
}

/**
 * Generate pattern-aware title
 *
 * Uses detected pattern type to create more descriptive titles.
 *
 * @param goal - User goal
 * @param patternType - Detected pattern type
 * @returns Generated title
 */
function generatePatternAwareTitle(goal: string, patternType: PatternType): string {
  const baseTitle = generateFunctionTitle(goal);

  // Add pattern-specific prefix if generic
  const prefixes: Record<PatternType, string> = {
    crud: 'Manage',
    data_transform: 'Transform',
    search_analyze: 'Analyze',
    communication: 'Notify',
    file_management: 'Organize',
    general: '',
  };

  const prefix = prefixes[patternType];

  if (prefix && !baseTitle.toLowerCase().startsWith(prefix.toLowerCase())) {
    return `${prefix} ${baseTitle}`;
  }

  return baseTitle;
}

/**
 * Check if pattern is worth learning based on enhanced criteria
 *
 * @param scratchpad - Operator scratchpad
 * @param skillsUsed - List of skills used
 * @returns True if pattern should be learned
 */
function shouldLearnPattern(scratchpad: any[], skillsUsed: string[]): {
  shouldLearn: boolean;
  reason?: string;
} {
  const actionEntries = scratchpad.filter(entry => entry.action);

  // Check step count bounds
  if (actionEntries.length < LEARNING_CONFIG.minSteps) {
    return { shouldLearn: false, reason: 'Too few steps' };
  }
  if (actionEntries.length > LEARNING_CONFIG.maxSteps) {
    return { shouldLearn: false, reason: 'Too complex (too many steps)' };
  }

  // Check success rate
  const successfulActions = actionEntries.filter(
    entry => entry.observation && entry.observation.success !== false
  );
  const successRate = successfulActions.length / actionEntries.length;

  if (successRate < LEARNING_CONFIG.minSuccessRate) {
    return { shouldLearn: false, reason: `Low success rate (${(successRate * 100).toFixed(0)}%)` };
  }

  // Check skill diversity
  const uniqueSkills = Array.from(new Set(skillsUsed));
  if (uniqueSkills.length < LEARNING_CONFIG.minUniqueSkills) {
    return { shouldLearn: false, reason: 'Insufficient skill diversity' };
  }

  // Reject trivial patterns (e.g., single skill repeated many times)
  const mostCommonSkill = skillsUsed
    .reduce((acc, skill) => {
      acc[skill] = (acc[skill] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

  const maxCount = Math.max(...Object.values(mostCommonSkill));
  const repetitionRatio = maxCount / skillsUsed.length;

  if (repetitionRatio > 0.8) {
    return { shouldLearn: false, reason: 'Pattern too repetitive' };
  }

  return { shouldLearn: true };
}

// ============================================================================
// Phase 4.4: Batch Processing & Maintenance
// ============================================================================

/**
 * Consolidate similar draft functions
 *
 * Finds groups of very similar draft functions and merges them into
 * a single best representative, removing duplicates.
 *
 * @param options - Consolidation options
 * @returns Consolidation report
 */
export async function consolidateDraftFunctions(options: {
  similarityThreshold?: number;
  dryRun?: boolean;
  profilePaths?: any;
} = {}): Promise<{
  groupsFound: number;
  functionsRemoved: number;
  functionsMerged: number;
}> {
  const { similarityThreshold = 0.85, dryRun = false } = options;

  // Get all draft functions
  const drafts = await listFunctions(
    { trustLevel: 'draft', sortBy: 'qualityScore', sortOrder: 'desc' },
    options.profilePaths
  );

  if (drafts.length < 2) {
    return { groupsFound: 0, functionsRemoved: 0, functionsMerged: 0 };
  }

  const consolidated: Set<string> = new Set();
  const toRemove: string[] = [];
  let groupsFound = 0;

  // Compare each function with all others
  for (let i = 0; i < drafts.length; i++) {
    if (consolidated.has(drafts[i].id)) continue;

    const similarGroup: FunctionMemory[] = [drafts[i]];

    for (let j = i + 1; j < drafts.length; j++) {
      if (consolidated.has(drafts[j].id)) continue;

      const similarity = calculateSkillSimilarity(
        drafts[i].skillsUsed,
        drafts[j].skillsUsed
      );

      if (similarity >= similarityThreshold) {
        similarGroup.push(drafts[j]);
      }
    }

    // If we found a group of similar functions, keep the best one
    if (similarGroup.length > 1) {
      groupsFound++;

      // Sort by quality score (highest first)
      similarGroup.sort((a, b) => {
        const scoreA = a.metadata.qualityScore || 0;
        const scoreB = b.metadata.qualityScore || 0;
        return scoreB - scoreA;
      });

      const keeper = similarGroup[0];
      const duplicates = similarGroup.slice(1);

      // Mark keeper as consolidated
      consolidated.add(keeper.id);

      // Merge usage stats from duplicates into keeper
      for (const dup of duplicates) {
        keeper.metadata.usageCount += dup.metadata.usageCount;
        keeper.metadata.successCount += dup.metadata.successCount;

        // Update last used if duplicate was more recent
        if (
          dup.metadata.lastUsedAt &&
          (!keeper.metadata.lastUsedAt ||
            new Date(dup.metadata.lastUsedAt) > new Date(keeper.metadata.lastUsedAt))
        ) {
          keeper.metadata.lastUsedAt = dup.metadata.lastUsedAt;
        }

        toRemove.push(dup.id);
        consolidated.add(dup.id);
      }

      // Recalculate quality score for merged function
      keeper.metadata.qualityScore = calculateQualityScore(keeper);

      // Save merged function (unless dry run)
      if (!dryRun) {
        await saveFunction(keeper, options.profilePaths);
      }

      // Log consolidation
      audit({
        level: 'info',
        category: 'data',
        event: 'functions_consolidated',
        details: {
          keeperId: keeper.id,
          keeperTitle: keeper.title,
          duplicatesRemoved: duplicates.length,
          duplicateIds: duplicates.map(d => d.id),
          mergedUsageCount: keeper.metadata.usageCount,
          dryRun,
        },
        actor: 'system',
      });
    }
  }

  // Remove duplicate functions (unless dry run)
  if (!dryRun) {
    for (const id of toRemove) {
      await deleteFunction(id, 'draft', options.profilePaths);
    }
  }

  return {
    groupsFound,
    functionsRemoved: toRemove.length,
    functionsMerged: groupsFound,
  };
}

/**
 * Clean up low-quality draft functions
 *
 * Removes draft functions that haven't been used after a grace period
 * or have very low quality scores.
 *
 * @param options - Cleanup options
 * @returns Cleanup report
 */
export async function cleanupDraftFunctions(options: {
  minQualityScore?: number;
  gracePeriodDays?: number;
  minUsageCount?: number;
  dryRun?: boolean;
  profilePaths?: any;
} = {}): Promise<{
  functionsRemoved: number;
  spaceReclaimed: number;
}> {
  const {
    minQualityScore = 0.3,
    gracePeriodDays = 30,
    minUsageCount = 1,
    dryRun = false,
  } = options;

  // Get all draft functions
  const drafts = await listFunctions({ trustLevel: 'draft' }, options.profilePaths);

  const toRemove: string[] = [];
  const now = Date.now();

  for (const func of drafts) {
    const qualityScore = func.metadata.qualityScore || 0;
    const usageCount = func.metadata.usageCount;
    const createdAt = new Date(func.metadata.createdAt).getTime();
    const ageInDays = (now - createdAt) / (1000 * 60 * 60 * 24);

    // Remove if:
    // 1. Low quality score AND past grace period AND no usage
    // 2. OR never used AND well past grace period (2x)
    const shouldRemove =
      (qualityScore < minQualityScore &&
        ageInDays > gracePeriodDays &&
        usageCount < minUsageCount) ||
      (usageCount === 0 && ageInDays > gracePeriodDays * 2);

    if (shouldRemove) {
      toRemove.push(func.id);

      audit({
        level: 'info',
        category: 'data',
        event: 'function_cleaned_up',
        details: {
          functionId: func.id,
          title: func.title,
          qualityScore,
          usageCount,
          ageInDays: ageInDays.toFixed(1),
          reason:
            usageCount === 0
              ? 'Never used, past grace period'
              : 'Low quality, minimal usage',
          dryRun,
        },
        actor: 'system',
      });
    }
  }

  // Remove functions (unless dry run)
  if (!dryRun) {
    for (const id of toRemove) {
      await deleteFunction(id, 'draft', options.profilePaths);
    }
  }

  return {
    functionsRemoved: toRemove.length,
    spaceReclaimed: toRemove.length * 2048, // Rough estimate: ~2KB per function
  };
}

/**
 * Run full maintenance cycle
 *
 * Consolidates similar drafts, then cleans up low-quality ones.
 *
 * @param options - Maintenance options
 * @returns Combined maintenance report
 */
export async function maintainFunctionMemory(options: {
  dryRun?: boolean;
  profilePaths?: any;
} = {}): Promise<{
  consolidation: {
    groupsFound: number;
    functionsRemoved: number;
    functionsMerged: number;
  };
  cleanup: {
    functionsRemoved: number;
    spaceReclaimed: number;
  };
}> {
  // Step 1: Consolidate similar drafts
  const consolidation = await consolidateDraftFunctions({
    dryRun: options.dryRun,
    profilePaths: options.profilePaths,
  });

  // Step 2: Clean up low-quality drafts
  const cleanup = await cleanupDraftFunctions({
    dryRun: options.dryRun,
    profilePaths: options.profilePaths,
  });

  return { consolidation, cleanup };
}

// ============================================================================
// Phase 4.2: Quality Scoring
// ============================================================================

/**
 * Calculate quality score for a function
 *
 * Score is based on:
 * - Success rate (40%): How often the function succeeds when used
 * - Usage count (30%): More proven functions score higher
 * - Recency (20%): Recently used functions are more relevant
 * - Trust level (10%): Verified functions get a bonus
 *
 * @param func - Function to score
 * @returns Quality score (0.0 to 1.0)
 */
function calculateQualityScore(func: FunctionMemory): number {
  // Success rate component (0-1, weight 0.4)
  const successRate = func.metadata.usageCount > 0
    ? func.metadata.successCount / func.metadata.usageCount
    : 0.5; // Neutral for unused functions
  const successComponent = successRate * 0.4;

  // Usage count component (0-1, weight 0.3)
  // Use logarithmic scaling: log10(uses + 1) / log10(101)
  // This gives: 0 uses = 0.0, 10 uses = 0.5, 100 uses = 1.0
  const usageNormalized = Math.log10(func.metadata.usageCount + 1) / Math.log10(101);
  const usageComponent = Math.min(usageNormalized, 1.0) * 0.3;

  // Recency component (0-1, weight 0.2)
  // Exponential decay: score drops to 0.5 after 30 days
  let recencyComponent = 0.0;
  if (func.metadata.lastUsedAt) {
    const daysSinceUse = (Date.now() - new Date(func.metadata.lastUsedAt).getTime()) / (1000 * 60 * 60 * 24);
    const recencyScore = Math.exp(-daysSinceUse / 30); // Decay with 30-day half-life
    recencyComponent = recencyScore * 0.2;
  }

  // Trust level component (0-1, weight 0.1)
  const trustComponent = func.metadata.trustLevel === 'verified' ? 0.1 : 0.05; // Verified gets full bonus

  // Total quality score
  const qualityScore = successComponent + usageComponent + recencyComponent + trustComponent;

  return Math.min(Math.max(qualityScore, 0.0), 1.0); // Clamp to [0, 1]
}
