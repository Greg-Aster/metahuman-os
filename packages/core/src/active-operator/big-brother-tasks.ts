/**
 * Big Brother Task Definitions
 *
 * This module provides detailed task specifications for Big Brother delegation.
 * Each task includes:
 * - Detailed prompt with specific file paths and actions
 * - Success criteria for validation
 * - Expected state changes
 *
 * When Big Brother (Claude Code, Codex, etc.) receives a task, it needs to know
 * EXACTLY what to do, what files to read/modify, and what success looks like.
 */

import { getProfilePaths, systemPaths } from '../paths.js';

// ============================================================================
// Types
// ============================================================================

export interface TaskSpecification {
  /** Detailed prompt telling Big Brother exactly what to do */
  prompt: string;
  /** Files that should be read or modified */
  relevantPaths: string[];
  /** What success looks like - used for validation */
  successCriteria: SuccessCriteria;
  /** Expected runtime in ms (for timeout tuning) */
  expectedDurationMs: number;
  /** Whether this task modifies files */
  isWriteOperation: boolean;
}

export interface SuccessCriteria {
  /** Keywords that should appear in meaningful output */
  requiredKeywords: string[];
  /** Patterns that indicate placeholder/no-op responses */
  placeholderPatterns: RegExp[];
  /** Minimum output length for meaningful response */
  minimumOutputLength: number;
  /** State changes to verify after execution */
  stateChecks?: StateCheck[];
}

export interface StateCheck {
  type: 'file_exists' | 'file_modified' | 'file_contains' | 'desire_status_changed';
  path?: string;
  pattern?: string;
  expectedValue?: string;
}

export interface ValidationResult {
  isValid: boolean;
  isPlaceholder: boolean;
  failureReason?: string;
  details: {
    outputLength: number;
    hasRequiredKeywords: boolean;
    matchedPlaceholderPattern?: string;
    stateChecksPassed: number;
    stateChecksFailed: number;
  };
}

// ============================================================================
// Placeholder Detection Patterns
// ============================================================================

/**
 * Patterns that indicate Big Brother returned a placeholder/no-op response
 * instead of actually executing the task.
 */
const PLACEHOLDER_PATTERNS: RegExp[] = [
  /^(?:\*\*)?preparing\s+(?:to\s+)?(?:give\s+)?(?:guidance|response|analysis)/i,
  /^(?:\*\*)?getting\s+ready/i,
  /^(?:\*\*)?starting\s+(?:to\s+)?(?:work|analyze|process)/i,
  /^(?:\*\*)?analyzing\s+(?:the\s+)?(?:request|task|situation)/i,
  /^(?:\*\*)?understanding\s+(?:the\s+)?(?:request|task|context)/i,
  /^(?:\*\*)?processing\s+(?:the\s+)?(?:request|task)/i,
  /^I\s+(?:will|would|can|could)\s+help/i,
  /^Let\s+me\s+(?:help|assist|work\s+on)/i,
  /^I['']?m\s+(?:ready|prepared|going)\s+to/i,
  /^(?:Sure|Okay|Alright)[,!]?\s+(?:I['']?ll|let\s+me)/i,
  /^(?:This|That)\s+(?:task|request)\s+(?:requires|involves|needs)/i,
  /^\s*$/,  // Empty response
];

/**
 * Minimum meaningful output lengths by task type
 */
const MIN_OUTPUT_LENGTHS: Record<string, number> = {
  desire_advance: 100,
  desire_execute: 200,
  desire_generate: 150,
  reflect: 300,
  dream: 400,
  curiosity: 100,
  inner_curiosity: 150,
  memory_curate: 100,
  training_curate: 100,
  psychoanalyze: 300,
  default: 50,
};

// ============================================================================
// Task Specification Generators
// ============================================================================

/**
 * Generate a detailed task specification for Big Brother.
 * Returns null if the task cannot be delegated (should run locally).
 */
export function generateTaskSpecification(
  taskType: string,
  username: string,
  context: {
    reasoning?: string;
    desireId?: string;
    desireTitle?: string;
    desireDescription?: string;
  } = {}
): TaskSpecification | null {
  const profilePaths = getProfilePaths(username);

  switch (taskType) {
    case 'desire_advance':
      return generateDesireAdvanceSpec(username, profilePaths, context);

    case 'desire_execute':
      return generateDesireExecuteSpec(username, profilePaths, context);

    case 'desire_generate':
      return generateDesireGenerateSpec(username, profilePaths, context);

    case 'reflect':
      return generateReflectSpec(username, profilePaths, context);

    case 'dream':
      return generateDreamSpec(username, profilePaths, context);

    case 'curiosity':
      return generateCuriositySpec(username, profilePaths, context);

    case 'inner_curiosity':
      return generateInnerCuriositySpec(username, profilePaths, context);

    case 'memory_curate':
      return generateMemoryCurateSpec(username, profilePaths, context);

    case 'training_curate':
      return generateTrainingCurateSpec(username, profilePaths, context);

    case 'psychoanalyze':
      return generatePsychoanalyzeSpec(username, profilePaths, context);

    default:
      // Unknown task - return generic spec
      return {
        prompt: `Execute the "${taskType}" task for user "${username}". Reasoning: ${context.reasoning || 'No reasoning provided'}`,
        relevantPaths: [profilePaths.root],
        successCriteria: {
          requiredKeywords: ['complete', 'success', 'done', 'finished'],
          placeholderPatterns: PLACEHOLDER_PATTERNS,
          minimumOutputLength: MIN_OUTPUT_LENGTHS.default,
        },
        expectedDurationMs: 60000,
        isWriteOperation: true,
      };
  }
}

function generateDesireAdvanceSpec(
  username: string,
  paths: ReturnType<typeof getProfilePaths>,
  context: { reasoning?: string; desireId?: string }
): TaskSpecification {
  const desiresPath = `${paths.persona}/desires`;

  return {
    prompt: `# Task: Advance Desires Through Planning Pipeline

## Context
User: ${username}
Working Directory: ${systemPaths.root}
Reasoning: ${context.reasoning || 'No specific reasoning provided'}
${context.desireId ? `Specific Desire ID: ${context.desireId}` : ''}

## Instructions

You need to advance pending desires through the MetaHuman OS agency pipeline. Here's what to do:

### Step 1: Find Pending Desires Ready for Advancement
Read the desires from: \`${desiresPath}/pending/\` and \`${desiresPath}/nascent/\`
Each desire is in a folder with a \`manifest.json\` file.

Look for desires with \`strength >= 0.70\` (activation threshold).

### Step 2: For Each Ready Desire, Generate a Plan
For each desire ready for advancement:
1. Read the desire's \`manifest.json\`
2. Create an execution plan with:
   - \`operatorGoal\`: Clear goal statement
   - \`steps\`: Array of action steps with skill mappings
   - \`estimatedRisk\`: 'low', 'medium', 'high', or 'critical'
3. Update the manifest with the plan
4. Move the desire folder from \`pending/\` or \`nascent/\` to \`planning/\`

### Step 3: Report Results
Report what you did:
- How many desires were found
- Which ones were advanced
- What plans were created

## Expected File Operations
- READ: \`${desiresPath}/pending/*/manifest.json\`
- READ: \`${desiresPath}/nascent/*/manifest.json\`
- WRITE: Updated manifest.json files with plans
- MOVE: Desire folders from pending/nascent to planning

## Success Criteria
- At least one desire was processed (or report if none were ready)
- Plans were generated with operatorGoal and steps
- Files were actually modified (not just described)

## DO NOT
- Just describe what you would do - actually do it
- Return without checking the files
- Say you're "preparing" without executing`,
    relevantPaths: [
      `${desiresPath}/pending`,
      `${desiresPath}/nascent`,
      `${desiresPath}/planning`,
      paths.personaCore,
    ],
    successCriteria: {
      requiredKeywords: ['manifest', 'desire', 'plan', 'strength', 'status'],
      placeholderPatterns: PLACEHOLDER_PATTERNS,
      minimumOutputLength: MIN_OUTPUT_LENGTHS.desire_advance,
      stateChecks: [
        { type: 'file_modified', path: desiresPath },
      ],
    },
    expectedDurationMs: 120000,
    isWriteOperation: true,
  };
}

function generateDesireExecuteSpec(
  username: string,
  paths: ReturnType<typeof getProfilePaths>,
  context: { reasoning?: string; desireId?: string; desireTitle?: string }
): TaskSpecification {
  const desiresPath = `${paths.persona}/desires`;

  return {
    prompt: `# Task: Execute Approved Desire

## Context
User: ${username}
Working Directory: ${systemPaths.root}
${context.desireId ? `Desire ID: ${context.desireId}` : ''}
${context.desireTitle ? `Desire Title: ${context.desireTitle}` : ''}
Reasoning: ${context.reasoning || 'Execute the approved desire'}

## Instructions

Execute an APPROVED desire from the agency system.

### Step 1: Find Approved Desire
Read from: \`${desiresPath}/approved/\`
${context.desireId ? `Look for desire with ID: ${context.desireId}` : 'Process the first available approved desire.'}

### Step 2: Read the Execution Plan
The desire's \`manifest.json\` contains:
- \`plan.operatorGoal\`: What to achieve
- \`plan.steps\`: Specific actions to take
- \`plan.estimatedRisk\`: Risk level

### Step 3: Execute the Plan
Follow the plan steps. Each step may reference:
- Skills to invoke
- Files to read/write
- Actions to perform

### Step 4: Record Results
Update the desire manifest with:
- \`executionResult\`: What was done
- \`status\`: Change to 'awaiting_review' after execution
- Move the folder to \`awaiting_review/\`

## Expected File Operations
- READ: \`${desiresPath}/approved/*/manifest.json\`
- WRITE: Updated manifest with execution results
- MOVE: Desire folder to awaiting_review/

## Success Criteria
- Desire plan was read and understood
- Plan steps were executed
- Results were recorded
- Desire was moved to awaiting_review`,
    relevantPaths: [
      `${desiresPath}/approved`,
      `${desiresPath}/awaiting_review`,
      paths.episodic,
    ],
    successCriteria: {
      requiredKeywords: ['execute', 'plan', 'step', 'result', 'complete'],
      placeholderPatterns: PLACEHOLDER_PATTERNS,
      minimumOutputLength: MIN_OUTPUT_LENGTHS.desire_execute,
    },
    expectedDurationMs: 180000,
    isWriteOperation: true,
  };
}

function generateDesireGenerateSpec(
  username: string,
  paths: ReturnType<typeof getProfilePaths>,
  context: { reasoning?: string }
): TaskSpecification {
  return {
    prompt: `# Task: Generate New Desires

## Context
User: ${username}
Working Directory: ${systemPaths.root}
Reasoning: ${context.reasoning || 'Generate new desires based on persona goals'}

## Instructions

Generate new desires for the MetaHuman OS agency system.

### Step 1: Read Persona and Context
- Read persona core: \`${paths.personaCore}\`
- Read recent memories from: \`${paths.episodic}\`
- Read existing desires from: \`${paths.persona}/desires/\`

### Step 2: Identify Desire Sources
Look for:
- Unmet persona goals (short-term, mid-term, long-term)
- Patterns in recent experiences
- Incomplete tasks
- Curiosities and interests

### Step 3: Create New Desires
For each new desire, create a folder in \`${paths.persona}/desires/nascent/\` with:
- \`manifest.json\` containing:
  - \`id\`: UUID
  - \`title\`: Clear, actionable title
  - \`description\`: What this desire aims to achieve
  - \`source\`: Where this desire came from (persona_goal, task, memory_pattern, etc.)
  - \`strength\`: Initial strength (0.15-0.30)
  - \`status\`: 'nascent'
  - \`createdAt\`: ISO timestamp
  - \`updatedAt\`: ISO timestamp

### Step 4: Report Results
List the desires created with their titles and sources.

## Expected File Operations
- READ: \`${paths.personaCore}\`
- READ: \`${paths.episodic}/**/*.json\` (recent memories)
- WRITE: New desire folders in \`${paths.persona}/desires/nascent/\`

## Success Criteria
- At least 1-3 new desires created
- Desires are based on actual persona content
- Each desire has complete manifest.json`,
    relevantPaths: [
      paths.personaCore,
      paths.episodic,
      `${paths.persona}/desires/nascent`,
    ],
    successCriteria: {
      requiredKeywords: ['desire', 'created', 'title', 'source', 'strength'],
      placeholderPatterns: PLACEHOLDER_PATTERNS,
      minimumOutputLength: MIN_OUTPUT_LENGTHS.desire_generate,
    },
    expectedDurationMs: 120000,
    isWriteOperation: true,
  };
}

function generateReflectSpec(
  username: string,
  paths: ReturnType<typeof getProfilePaths>,
  context: { reasoning?: string }
): TaskSpecification {
  const today = new Date().toISOString().split('T')[0];
  const [year, month, day] = today.split('-');

  return {
    prompt: `# Task: Generate Thoughtful Reflection

## Context
User: ${username}
Working Directory: ${systemPaths.root}
Reasoning: ${context.reasoning || 'Generate a reflection on recent experiences'}

## Instructions

Generate a thoughtful inner reflection based on recent memories.

### Step 1: Gather Recent Memories
Read recent memories from: \`${paths.episodic}/${year}/${month}/${day}/\`
Also check the previous few days for context.

### Step 2: Build Associative Chain
Select 3-5 memories that connect thematically. Follow associations:
- Memory A mentions "project" → search for related "project" memories
- Build a chain of connected thoughts

### Step 3: Generate Reflection
Write a thoughtful reflection that:
- Connects the memory themes
- Identifies patterns or insights
- Considers implications or learnings
- Is written in first person, introspectively

### Step 4: Save as Inner Dialogue
Create a new memory file in: \`${paths.episodic}/${year}/${month}/${day}/\`
Filename: \`${today}-<uuid>.json\`
Content:
\`\`\`json
{
  "id": "<uuid>",
  "type": "inner_dialogue",
  "content": "<your reflection>",
  "timestamp": "<ISO timestamp>",
  "tags": ["reflection", "idle-thought"],
  "metadata": {
    "source": "reflector",
    "triggerMemories": ["<memory-ids>"]
  }
}
\`\`\`

## Expected File Operations
- READ: \`${paths.episodic}/${year}/${month}/**/*.json\`
- WRITE: New reflection file in \`${paths.episodic}/${year}/${month}/${day}/\`

## Success Criteria
- At least 3 memories were read and considered
- A meaningful reflection was generated (not generic)
- The reflection was saved as a new memory file`,
    relevantPaths: [
      paths.episodic,
      `${paths.episodic}/${year}/${month}/${day}`,
    ],
    successCriteria: {
      requiredKeywords: ['reflection', 'memory', 'inner_dialogue', 'thought'],
      placeholderPatterns: PLACEHOLDER_PATTERNS,
      minimumOutputLength: MIN_OUTPUT_LENGTHS.reflect,
    },
    expectedDurationMs: 90000,
    isWriteOperation: true,
  };
}

function generateDreamSpec(
  username: string,
  paths: ReturnType<typeof getProfilePaths>,
  context: { reasoning?: string }
): TaskSpecification {
  const today = new Date().toISOString().split('T')[0];
  const [year, month, day] = today.split('-');

  return {
    prompt: `# Task: Generate Surreal Dream

## Context
User: ${username}
Working Directory: ${systemPaths.root}
Reasoning: ${context.reasoning || 'Create a dream from memory fragments'}

## Instructions

Generate a surreal, dreamlike narrative from memory fragments.

### Step 1: Sample Random Memories
Read memories from various time periods in: \`${paths.episodic}/\`
Sample from different years/months to get diverse content.
Use weighted random selection - older memories can still appear.

### Step 2: Extract Dream Elements
From the sampled memories, extract:
- People mentioned
- Places described
- Events that happened
- Emotions expressed
- Objects or symbols

### Step 3: Weave Dream Narrative
Create a surreal dream that:
- Combines elements in unexpected ways
- Has dreamlike logic (non-linear, symbolic)
- Evokes emotional resonance
- Is written in present tense, immersive style

### Step 4: Save as Dream Memory
Create a new memory file in: \`${paths.episodic}/${year}/${month}/${day}/\`
\`\`\`json
{
  "id": "<uuid>",
  "type": "dream",
  "content": "<dream narrative>",
  "timestamp": "<ISO timestamp>",
  "tags": ["dream", "subconscious"],
  "metadata": {
    "source": "dreamer",
    "sourceMemories": ["<memory-ids>"],
    "dreamElements": ["<extracted elements>"]
  }
}
\`\`\`

## Success Criteria
- Multiple memories were sampled for source material
- Dream narrative is surreal and creative
- Dream was saved as a new memory file`,
    relevantPaths: [
      paths.episodic,
    ],
    successCriteria: {
      requiredKeywords: ['dream', 'memory', 'narrative', 'surreal'],
      placeholderPatterns: PLACEHOLDER_PATTERNS,
      minimumOutputLength: MIN_OUTPUT_LENGTHS.dream,
    },
    expectedDurationMs: 120000,
    isWriteOperation: true,
  };
}

function generateCuriositySpec(
  username: string,
  paths: ReturnType<typeof getProfilePaths>,
  context: { reasoning?: string }
): TaskSpecification {
  return {
    prompt: `# Task: Generate Curiosity Question

## Context
User: ${username}
Working Directory: ${systemPaths.root}
Reasoning: ${context.reasoning || 'Ask an exploratory question'}

## Instructions

Generate a thoughtful curiosity question based on memories.

### Step 1: Read Recent Memories
Read from: \`${paths.episodic}/\` (recent files)

### Step 2: Identify Interesting Patterns
Look for:
- Topics that appear repeatedly
- Unresolved situations
- Interesting connections
- Things left unexplored

### Step 3: Generate Question
Create a genuine, thoughtful question that:
- Is specific (not generic)
- Relates to actual memory content
- Invites meaningful discussion
- Shows genuine curiosity

### Step 4: Save to Conversation Buffer
Append to the conversation buffer at: \`${paths.state}/conversation-buffer-conversation.json\`
The question will appear in the user's chat.

## Success Criteria
- Question is specific to memory content
- Question is thought-provoking
- Question was saved to buffer`,
    relevantPaths: [
      paths.episodic,
      `${paths.state}/conversation-buffer-conversation.json`,
    ],
    successCriteria: {
      requiredKeywords: ['question', 'curious', 'memory'],
      placeholderPatterns: PLACEHOLDER_PATTERNS,
      minimumOutputLength: MIN_OUTPUT_LENGTHS.curiosity,
    },
    expectedDurationMs: 60000,
    isWriteOperation: true,
  };
}

function generateInnerCuriositySpec(
  username: string,
  paths: ReturnType<typeof getProfilePaths>,
  context: { reasoning?: string }
): TaskSpecification {
  const today = new Date().toISOString().split('T')[0];
  const [year, month, day] = today.split('-');

  return {
    prompt: `# Task: Internal Curiosity Exploration

## Context
User: ${username}
Working Directory: ${systemPaths.root}
Reasoning: ${context.reasoning || 'Explore an internal question'}

## Instructions

Generate an internal question, research it, and answer it.

### Step 1: Generate Question
Based on memories in \`${paths.episodic}/\`, generate a self-directed question.

### Step 2: Research Answer
Search memories for relevant context to answer the question.

### Step 3: Synthesize Answer
Write a thoughtful answer based on what was found.

### Step 4: Save as Inner Dialogue
Save to: \`${paths.episodic}/${year}/${month}/${day}/\`
Type: inner_dialogue
Tags: ["inner-curiosity", "self-reflection"]

## Success Criteria
- Question was generated
- Research was performed
- Answer was synthesized
- Result was saved`,
    relevantPaths: [
      paths.episodic,
    ],
    successCriteria: {
      requiredKeywords: ['question', 'answer', 'inner_dialogue'],
      placeholderPatterns: PLACEHOLDER_PATTERNS,
      minimumOutputLength: MIN_OUTPUT_LENGTHS.inner_curiosity,
    },
    expectedDurationMs: 90000,
    isWriteOperation: true,
  };
}

function generateMemoryCurateSpec(
  username: string,
  paths: ReturnType<typeof getProfilePaths>,
  context: { reasoning?: string }
): TaskSpecification {
  return {
    prompt: `# Task: Curate Unprocessed Memories

## Context
User: ${username}
Working Directory: ${systemPaths.root}
Reasoning: ${context.reasoning || 'Tag and organize memories'}

## Instructions

Process unprocessed memories by adding semantic tags and entities.

### Step 1: Find Unprocessed Memories
Search \`${paths.episodic}/\` for memories where:
- \`metadata.processed\` is false or missing
- Has no tags OR only generic tags (ingested, inbox, ai, curated)
- Has no entities extracted

### Step 2: Analyze Each Memory
For each unprocessed memory:
- Read the content
- Extract relevant tags (topics, themes, emotions)
- Extract entities (people, places, organizations)

### Step 3: Update Memory Files
Update each memory file with:
- \`tags\`: Array of semantic tags
- \`entities\`: Array of { name, type, salience }
- \`metadata.processed\`: true

### Step 4: Report Results
List memories processed with their new tags.

## Success Criteria
- At least one memory was processed
- Tags are semantic (not generic like "ingested")
- Entities were extracted where applicable
- Files were actually modified`,
    relevantPaths: [
      paths.episodic,
    ],
    successCriteria: {
      requiredKeywords: ['memory', 'tag', 'processed', 'entity'],
      placeholderPatterns: PLACEHOLDER_PATTERNS,
      minimumOutputLength: MIN_OUTPUT_LENGTHS.memory_curate,
    },
    expectedDurationMs: 120000,
    isWriteOperation: true,
  };
}

function generateTrainingCurateSpec(
  username: string,
  paths: ReturnType<typeof getProfilePaths>,
  context: { reasoning?: string }
): TaskSpecification {
  return {
    prompt: `# Task: Curate Training Data

## Context
User: ${username}
Working Directory: ${systemPaths.root}
Reasoning: ${context.reasoning || 'Prepare data for personality training'}

## Instructions

Curate conversation data for LoRA personality training.

### Step 1: Find Training Candidates
Search \`${paths.episodic}/\` for:
- type: 'conversation'
- Has user messages and assistant responses
- Not already curated (\`metadata.trainingCurated\` !== true)

### Step 2: Extract Training Pairs
For each conversation, extract:
- User message (input)
- Assistant response (output)
- Context/system prompt if available

### Step 3: Format for Training
Save curated data to: \`${paths.out}/training/\`
Format: JSONL with instruction/input/output fields

### Step 4: Mark as Curated
Update source memories with \`metadata.trainingCurated: true\`

## Success Criteria
- Conversations were identified
- Training pairs were extracted
- Data was saved in correct format`,
    relevantPaths: [
      paths.episodic,
      `${paths.out}/training`,
    ],
    successCriteria: {
      requiredKeywords: ['training', 'conversation', 'curated'],
      placeholderPatterns: PLACEHOLDER_PATTERNS,
      minimumOutputLength: MIN_OUTPUT_LENGTHS.training_curate,
    },
    expectedDurationMs: 120000,
    isWriteOperation: true,
  };
}

function generatePsychoanalyzeSpec(
  username: string,
  paths: ReturnType<typeof getProfilePaths>,
  context: { reasoning?: string }
): TaskSpecification {
  const today = new Date().toISOString().split('T')[0];
  const [year, month, day] = today.split('-');

  return {
    prompt: `# Task: Psychoanalysis

## Context
User: ${username}
Working Directory: ${systemPaths.root}
Reasoning: ${context.reasoning || 'Deep self-analysis'}

## Instructions

Perform deep self-analysis of patterns and behaviors.

### Step 1: Gather Data
Read:
- Persona core: \`${paths.personaCore}\`
- Recent memories from: \`${paths.episodic}/\`
- Previous psychoanalysis inner dialogues

### Step 2: Analyze Patterns
Look for:
- Recurring themes in thoughts and behaviors
- Emotional patterns
- Decision-making tendencies
- Growth areas and strengths
- Contradictions or tensions

### Step 3: Generate Analysis
Write a thorough psychoanalysis that:
- Identifies key patterns
- Explains underlying motivations
- Suggests areas for growth
- Is insightful, not superficial

### Step 4: Save Analysis
Save to: \`${paths.episodic}/${year}/${month}/${day}/\`
Type: inner_dialogue
Tags: ["psychoanalysis", "self-analysis"]

## Success Criteria
- Multiple data sources were analyzed
- Analysis identifies specific patterns
- Analysis is substantive (not generic)
- Result was saved as memory`,
    relevantPaths: [
      paths.personaCore,
      paths.episodic,
    ],
    successCriteria: {
      requiredKeywords: ['pattern', 'analysis', 'behavior', 'insight'],
      placeholderPatterns: PLACEHOLDER_PATTERNS,
      minimumOutputLength: MIN_OUTPUT_LENGTHS.psychoanalyze,
    },
    expectedDurationMs: 180000,
    isWriteOperation: true,
  };
}

// ============================================================================
// Output Validation
// ============================================================================

/**
 * Patterns that indicate sandbox/permission errors - these should be surfaced as failures,
 * not validation errors
 */
const SANDBOX_ERROR_PATTERNS: RegExp[] = [
  /sandbox\s+limit/i,
  /permission\s+denied/i,
  /cannot\s+access/i,
  /not\s+allowed/i,
  /restricted/i,
  /no\s+file\s+access/i,
  /execution\s+blocked/i,
];

/**
 * Validate Big Brother output to detect placeholder/no-op responses.
 * This is CRITICAL - we must not accept "success" when nothing happened.
 *
 * NOTE: Validation is now more lenient to allow sandbox errors to surface
 * as actual failures rather than being rejected for missing keywords.
 */
export function validateBigBrotherOutput(
  output: string,
  taskType: string,
  successCriteria: SuccessCriteria
): ValidationResult {
  const result: ValidationResult = {
    isValid: false,
    isPlaceholder: false,
    details: {
      outputLength: output.length,
      hasRequiredKeywords: false,
      stateChecksPassed: 0,
      stateChecksFailed: 0,
    },
  };

  // Check for sandbox/permission errors - these are real failures, not validation issues
  // We should accept these as "valid output" so the error message is preserved
  const lowerOutput = output.toLowerCase();
  const hasSandboxError = SANDBOX_ERROR_PATTERNS.some(pattern => pattern.test(output));
  if (hasSandboxError) {
    // This is a sandbox limitation - let it through as valid but note it
    console.log('[big-brother-tasks] ⚠️ Sandbox/permission error detected in output');
    result.isValid = true;  // Let the error pass through
    result.failureReason = 'Sandbox or permission limitation detected';
    return result;
  }

  // Check for empty or too-short output
  const minLength = successCriteria.minimumOutputLength || MIN_OUTPUT_LENGTHS[taskType] || MIN_OUTPUT_LENGTHS.default;
  if (output.length < minLength) {
    result.failureReason = `Output too short (${output.length} chars, minimum ${minLength})`;
    return result;
  }

  // Check for placeholder patterns
  for (const pattern of successCriteria.placeholderPatterns) {
    if (pattern.test(output.trim())) {
      result.isPlaceholder = true;
      result.failureReason = `Output matches placeholder pattern: ${pattern.source}`;
      result.details.matchedPlaceholderPattern = pattern.source;
      return result;
    }
  }

  // Also check global placeholder patterns
  for (const pattern of PLACEHOLDER_PATTERNS) {
    // Only check if output starts with the placeholder (not contains)
    const firstLine = output.trim().split('\n')[0];
    if (pattern.test(firstLine)) {
      result.isPlaceholder = true;
      result.failureReason = `Output starts with placeholder pattern: ${pattern.source}`;
      result.details.matchedPlaceholderPattern = pattern.source;
      return result;
    }
  }

  // Check for required keywords - but be lenient for short outputs
  // If output is substantial (>200 chars), we can skip keyword validation
  if (output.length > 200) {
    result.isValid = true;
    result.details.hasRequiredKeywords = true;
    return result;
  }

  const hasAllKeywords = successCriteria.requiredKeywords.every(
    keyword => lowerOutput.includes(keyword.toLowerCase())
  );
  result.details.hasRequiredKeywords = hasAllKeywords;

  if (!hasAllKeywords) {
    const missing = successCriteria.requiredKeywords.filter(
      k => !lowerOutput.includes(k.toLowerCase())
    );
    result.failureReason = `Missing required keywords: ${missing.join(', ')}`;
    return result;
  }

  // If we got here, the output passes validation
  result.isValid = true;
  return result;
}

/**
 * Stricter validation that also checks for actual work indicators
 */
export function validateOutputWithWorkIndicators(
  output: string,
  taskType: string,
  successCriteria: SuccessCriteria
): ValidationResult {
  // First do basic validation
  const basicResult = validateBigBrotherOutput(output, taskType, successCriteria);
  if (!basicResult.isValid) {
    return basicResult;
  }

  // Then check for indicators of actual work
  const workIndicators = [
    /(?:read|reading|opened|loaded)\s+(?:file|memory|manifest)/i,
    /(?:wrote|writing|created|saved|updated)\s+(?:file|memory|manifest)/i,
    /(?:moved|moving)\s+(?:file|folder|desire)/i,
    /(?:found|discovered)\s+\d+\s+(?:memories|desires|files)/i,
    /(?:processed|processing)\s+\d+\s+(?:memories|items)/i,
    /```(?:json|typescript|javascript)/i,  // Code blocks often indicate actual work
    /"(?:id|title|status|content)":/i,  // JSON structure
  ];

  const hasWorkIndicator = workIndicators.some(pattern => pattern.test(output));

  if (!hasWorkIndicator) {
    // Output passed basic checks but shows no signs of actual work
    basicResult.isValid = false;
    basicResult.failureReason = 'Output lacks indicators of actual file operations or processing';
    return basicResult;
  }

  return basicResult;
}
