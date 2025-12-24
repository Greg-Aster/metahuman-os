/**
 * Psychoanalyzer Agent — Core Logic (Chunked Multi-Stage Architecture)
 *
 * Reviews recent episodic memories using the psychotherapist model,
 * extracts personality insights, and incrementally updates persona files.
 *
 * KEY ARCHITECTURE:
 * - Processes persona in SECTIONS (chunks) to reduce token usage per call
 * - Compares current persona vs archived version vs memory evidence
 * - Allows more memories per analysis (better accuracy)
 * - Creates insights per section for granular tracking
 *
 * Sections processed:
 * 1. personality.traits (Big 5)
 * 2. values.core
 * 3. personality.interests
 * 4. goals (short/mid/long)
 * 5. context (domains, projects, focus)
 * 6. decisionHeuristics
 * 7. writingStyle
 *
 * This module provides:
 * - runPsychoanalysis() for single-user processing
 * - runCycle() for CLI usage
 * - run() for agent-runtime (mobile) usage
 */

import fs from 'node:fs';
import path from 'node:path';

import type { AgentContext, AgentInput, AgentResult } from '@metahuman/agent-runtime';
import {
  storageClient,
  systemPaths,
  ROOT,
  getTargetUser,
  withUserContext,
  audit,
} from '@metahuman/core';
import { callLLM } from '@metahuman/core/model-router';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface PsychoanalyzerConfig {
  enabled: boolean;
  memorySelection: {
    strategy: string;
    daysBack: number;
    maxMemories: number;
    minMemories: number;
    excludeTypes: string[];
    priorityTags: string[];
    userInputOnly?: boolean;
  };
  analysis: {
    model: string;
    temperature: number;
    focusAreas: string[];
    confidenceThreshold: number;
  };
  updateStrategy: {
    mode: string;
    preserveUserEdits: boolean;
    mergeStrategy: string;
    fields: Record<string, boolean>;
  };
  reconciliation: {
    enabled: boolean;
    removeStaleGoals: boolean;
    removeStaleInterests: boolean;
    updateGoalStatuses: boolean;
    removeContradictedValues: boolean;
    removeUnusedHeuristics: boolean;
  };
  insights: {
    enabled: boolean;
    filePath: string;
    maxEntries: number;
  };
  notifications: {
    createMemory: boolean;
    memoryType: string;
    title: string;
    includeChangeSummary: boolean;
  };
}

interface Memory {
  id: string;
  timestamp: string;
  content: string;
  type: string;
  tags?: string[];
  entities?: string[];
  importance?: number;
}

interface InsightEntry {
  timestamp: string;
  type: 'addition' | 'removal' | 'update';
  category: string;
  section?: string;             // Full section name (e.g., 'personality.traits') - optional for legacy
  items: string[];
  memoriesAnalyzed: number;
  confidence: number;
  reasoning?: string;           // LLM's reasoning for this change
  archiveCompared?: string;     // Which archive version was compared
  sessionId?: string;           // Groups all insights from one run
}

interface InsightsFile {
  version: string;
  lastUpdated: string;
  entries: InsightEntry[];
}

// Persona sections for chunked processing
type PersonaSection =
  | 'personality.traits'
  | 'values'
  | 'interests'
  | 'goals'
  | 'context'
  | 'decisionHeuristics'
  | 'writingStyle';

interface SectionAnalysisResult {
  section: PersonaSection;
  additions: any[];
  removals: string[];
  updates: any[];
  confidence: number;
  reasoning: string;
}

interface ArchiveInfo {
  filename: string;
  timestamp: string;
  persona: any;
}

export interface AnalysisResult {
  insights: {
    values?: Array<{ value: string; description: string; evidence: string[] }> | string[];
    goals?: {
      shortTerm?: Array<{ goal: string; status: string }>;
      midTerm?: Array<{ goal: string; status: string }>;
      longTerm?: Array<{ goal: string; status: string }>;
    } | string[];
    interests?: string[];
    communicationPatterns?: string[];
    decisionHeuristics?: Array<{ signal: string; response: string; evidence: string }>;
    personalityShifts?: string[];
    aesthetic?: string[];
    motifs?: string[];
  };
  removals?: {
    values?: string[];
    interests?: string[];
    goals?: string[];
  };
  reconciliation?: {
    staleGoals?: Array<{ goal: string; timeframe: string; reason: string }>;
    staleInterests?: Array<{ interest: string; reason: string }>;
    updatedGoals?: Array<{ goal: string; timeframe: string; newStatus: string; reason: string }>;
    removedValues?: Array<{ value: string; reason: string }>;
    removedHeuristics?: Array<{ signal: string; reason: string }>;
  };
  confidence: number;
  summary: string;
  memoriesAnalyzed: number;
  dateRange: { start: string; end: string };
}

export interface PsychoanalyzerOptions {
  singleUser?: boolean;
  username?: string;
}

export interface PsychoanalyzerResult {
  success: boolean;
  usersProcessed: number;
  errors: string[];
  stats: Record<string, UserPsychoanalyzerStats>;
}

export interface UserPsychoanalyzerStats {
  memoriesAnalyzed: number;
  confidence: number;
  changesApplied: number;
  skipped?: boolean;
  skipReason?: string;
}

// ─────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────

/**
 * Extract only user messages from conversation content
 * Handles formats like "User: message\n\nAssistant: response"
 */
function extractUserContent(content: string): string {
  const lines = content.split('\n');
  const userLines: string[] = [];
  let inUserBlock = false;

  for (const line of lines) {
    // Check for User: prefix (case insensitive)
    if (/^(User|user|USER|Me|me|Human|human):/.test(line)) {
      inUserBlock = true;
      // Extract content after the prefix
      const userContent = line.replace(/^(User|user|USER|Me|me|Human|human):\s*/, '');
      if (userContent.trim()) {
        userLines.push(userContent);
      }
    } else if (/^(Assistant|assistant|ASSISTANT|AI|ai|Bot|bot|System|system):/.test(line)) {
      // Stop collecting when we hit an assistant block
      inUserBlock = false;
    } else if (inUserBlock && line.trim()) {
      // Continue collecting lines in user block
      userLines.push(line);
    }
  }

  return userLines.join('\n').trim();
}

// ─────────────────────────────────────────────────────────────
// Insights Tracking
// ─────────────────────────────────────────────────────────────

async function logInsights(
  config: PsychoanalyzerConfig,
  entries: InsightEntry[]
): Promise<void> {
  if (!config.insights?.enabled || entries.length === 0) return;

  const insightsResult = storageClient.resolvePath({
    category: 'config',
    subcategory: 'persona',
    relativePath: 'insights.json',
  });

  if (!insightsResult.success || !insightsResult.path) {
    console.log('[psychoanalyzer] Could not resolve insights path');
    return;
  }

  const insightsPath = insightsResult.path;
  let insightsFile: InsightsFile;

  // Load existing or create new
  if (fs.existsSync(insightsPath)) {
    try {
      insightsFile = JSON.parse(fs.readFileSync(insightsPath, 'utf-8'));
    } catch {
      insightsFile = { version: '1.0.0', lastUpdated: '', entries: [] };
    }
  } else {
    insightsFile = { version: '1.0.0', lastUpdated: '', entries: [] };
  }

  // Add new entries at the beginning
  insightsFile.entries.unshift(...entries);

  // Trim to max entries
  if (insightsFile.entries.length > config.insights.maxEntries) {
    insightsFile.entries = insightsFile.entries.slice(0, config.insights.maxEntries);
  }

  insightsFile.lastUpdated = new Date().toISOString();

  // Ensure directory exists
  const dir = path.dirname(insightsPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(insightsPath, JSON.stringify(insightsFile, null, 2), 'utf-8');
  console.log(`[psychoanalyzer] Logged ${entries.length} insight(s) to ${insightsPath}`);
}

// ─────────────────────────────────────────────────────────────
// Archive Management
// ─────────────────────────────────────────────────────────────

/**
 * Load the most recent archived persona for comparison
 */
function loadLatestArchive(): ArchiveInfo | null {
  const archiveResult = storageClient.resolvePath({
    category: 'config',
    subcategory: 'persona',
    relativePath: 'archives',
  });

  if (!archiveResult.success || !archiveResult.path || !fs.existsSync(archiveResult.path)) {
    console.log('[psychoanalyzer] No archive directory found');
    return null;
  }

  const archiveDir = archiveResult.path;
  const files = fs.readdirSync(archiveDir)
    .filter(f => f.startsWith('core-') && f.endsWith('.json'))
    .sort()
    .reverse(); // Most recent first

  if (files.length === 0) {
    console.log('[psychoanalyzer] No archived personas found');
    return null;
  }

  const latestFile = files[0];
  const archivePath = path.join(archiveDir, latestFile);

  try {
    const persona = JSON.parse(fs.readFileSync(archivePath, 'utf-8'));
    // Extract timestamp from filename: core-YYYY-MM-DD-HHmmss.json
    const timestampMatch = latestFile.match(/core-(\d{4}-\d{2}-\d{2}-\d{6})\.json/);
    const timestamp = timestampMatch ? timestampMatch[1] : 'unknown';

    console.log(`[psychoanalyzer] Loaded archive for comparison: ${latestFile}`);
    return { filename: latestFile, timestamp, persona };
  } catch (error) {
    console.error(`[psychoanalyzer] Failed to load archive ${latestFile}:`, error);
    return null;
  }
}

/**
 * Create an archive of the current persona before making changes
 */
function createArchive(currentPersona: any): string | null {
  const archiveResult = storageClient.resolvePath({
    category: 'config',
    subcategory: 'persona',
    relativePath: 'archives',
  });

  if (!archiveResult.success || !archiveResult.path) {
    console.log('[psychoanalyzer] Could not resolve archive path');
    return null;
  }

  const archiveDir = archiveResult.path;
  if (!fs.existsSync(archiveDir)) {
    fs.mkdirSync(archiveDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19).replace('T', '-');
  const filename = `core-${timestamp}.json`;
  const archivePath = path.join(archiveDir, filename);

  fs.writeFileSync(archivePath, JSON.stringify(currentPersona, null, 2), 'utf-8');
  console.log(`[psychoanalyzer] Created archive: ${filename}`);
  return filename;
}

// ─────────────────────────────────────────────────────────────
// Chunked Section Analysis
// ─────────────────────────────────────────────────────────────

/**
 * Section definitions for chunked processing
 */
const PERSONA_SECTIONS: { section: PersonaSection; displayName: string; configKey: string }[] = [
  { section: 'personality.traits', displayName: 'Personality Traits (Big 5)', configKey: 'personality.traits' },
  { section: 'values', displayName: 'Core Values', configKey: 'values.core' },
  { section: 'interests', displayName: 'Interests', configKey: 'personality.interests' },
  { section: 'goals', displayName: 'Goals', configKey: 'goals' },
  { section: 'context', displayName: 'Context & Focus', configKey: 'context.currentFocus' },
  { section: 'decisionHeuristics', displayName: 'Decision Heuristics', configKey: 'decisionHeuristics' },
  { section: 'writingStyle', displayName: 'Writing Style', configKey: 'writingStyle.motifs' },
];

/**
 * Extract section data from a persona object
 */
function extractSectionData(persona: any, section: PersonaSection): string {
  switch (section) {
    case 'personality.traits':
      const traits = persona?.personality?.traits;
      if (!traits) return 'No traits defined';
      return `Openness: ${traits.openness}, Conscientiousness: ${traits.conscientiousness}, ` +
             `Extraversion: ${traits.extraversion}, Agreeableness: ${traits.agreeableness}, ` +
             `Neuroticism: ${traits.neuroticism}${traits.notes ? ` (Notes: ${traits.notes})` : ''}`;

    case 'values':
      const values = persona?.values?.core || [];
      if (values.length === 0) return 'No values defined';
      return values.map((v: any) => typeof v === 'string' ? v : `${v.value}: ${v.description || ''}`).join('\n- ');

    case 'interests':
      const interests = persona?.personality?.interests || [];
      return interests.length > 0 ? interests.join(', ') : 'No interests defined';

    case 'goals':
      const goals = persona?.goals || {};
      const allGoals: string[] = [];
      if (goals.shortTerm?.length) allGoals.push(`Short-term: ${goals.shortTerm.map((g: any) => typeof g === 'string' ? g : g.goal).join(', ')}`);
      if (goals.midTerm?.length) allGoals.push(`Mid-term: ${goals.midTerm.map((g: any) => typeof g === 'string' ? g : g.goal).join(', ')}`);
      if (goals.longTerm?.length) allGoals.push(`Long-term: ${goals.longTerm.map((g: any) => typeof g === 'string' ? g : g.goal).join(', ')}`);
      return allGoals.length > 0 ? allGoals.join('\n') : 'No goals defined';

    case 'context':
      const ctx = persona?.context || {};
      const contextParts: string[] = [];
      if (ctx.domains?.length) contextParts.push(`Domains: ${ctx.domains.join(', ')}`);
      if (ctx.currentFocus?.length) contextParts.push(`Focus: ${ctx.currentFocus.join(', ')}`);
      if (ctx.projects?.length) contextParts.push(`Projects: ${ctx.projects.map((p: any) => p.name).join(', ')}`);
      return contextParts.length > 0 ? contextParts.join('\n') : 'No context defined';

    case 'decisionHeuristics':
      const heuristics = persona?.decisionHeuristics || [];
      if (heuristics.length === 0) return 'No heuristics defined';
      return heuristics.map((h: any) => `Signal: "${h.signal}" → Response: "${h.response}"`).join('\n');

    case 'writingStyle':
      const style = persona?.writingStyle;
      if (!style) return 'No writing style defined';
      const styleParts: string[] = [];
      if (style.structure) styleParts.push(`Structure: ${style.structure}`);
      if (style.motifs?.length) styleParts.push(`Motifs: ${style.motifs.join(', ')}`);
      if (style.defaultMantra) styleParts.push(`Mantra: ${style.defaultMantra}`);
      return styleParts.join('\n');

    default:
      return 'Unknown section';
  }
}

/**
 * Build section-specific prompt for analysis
 */
function buildSectionPrompt(
  section: PersonaSection,
  displayName: string,
  currentData: string,
  archivedData: string,
  transcript: string,
  memoriesCount: number
): string {
  // Special prompt for Big 5 personality traits - requires numeric score adjustments
  if (section === 'personality.traits') {
    return `You are a psychoanalyst evaluating Big 5 personality trait scores based on actual user behavior.

## CURRENT BIG 5 SCORES (0.0 to 1.0 scale)
${currentData}

## PREVIOUS SCORES (stability reference)
${archivedData}

## ACTUAL USER BEHAVIOR (${memoriesCount} messages - this is the TRUTH)
${transcript}

## BIG 5 TRAIT DEFINITIONS
- **Openness** (0-1): Curiosity, creativity, preference for novelty vs routine
- **Conscientiousness** (0-1): Organization, dependability, self-discipline vs flexibility
- **Extraversion** (0-1): Sociability, assertiveness, talkativeness vs reserved/introspective
- **Agreeableness** (0-1): Cooperation, trust, helpfulness vs skepticism/competitiveness
- **Neuroticism** (0-1): Emotional instability, anxiety, moodiness vs calm/resilience

## YOUR TASK
Analyze the user's messages to assess if the Big 5 scores are accurate:

1. What behaviors in these messages suggest about each trait?
2. Do current scores match observed behavior? If not, what should they be?
3. Only suggest changes if messages clearly contradict current scores
4. Small adjustments (±0.05-0.15) are typical; large changes need strong evidence

Return ONLY a compact JSON object:
{
  "additions": [],
  "removals": [],
  "updates": [
    {"field": "neuroticism", "oldValue": "0.45", "newValue": "0.55", "reason": "User shows anxiety about health, mortality, and being understood"},
    {"field": "extraversion", "oldValue": "0.35", "newValue": "0.25", "reason": "User expresses loneliness and prefers intimate AI interaction over social engagement"}
  ],
  "confidence": 0.8,
  "reasoning": "Summary of personality patterns observed in messages"
}

CRITICAL:
- For Big 5, use UPDATES only (not additions/removals)
- Values must be between 0.0 and 1.0
- Include both oldValue and newValue as strings
- Base changes on MESSAGE EVIDENCE, not assumptions`;
  }

  // Section-specific guidance - PERSONA IS INJECTED INTO EVERY CONVERSATION
  // It must be LEAN and capture ESSENCE, not comprehensive life documentation
  // NOTE: Examples show ABSTRACTION LEVEL only, not specific content to look for
  const sectionGuidance: Record<string, string> = {
    'values': `⚠️ KEEP TO 5-7 CORE VALUES MAX. This gets injected into every chat.

Focus on FUNDAMENTAL BELIEFS that define character:
- What drives this person at their deepest level?
- These should be TIMELESS, not situational
- If it could change next month, it's NOT a core value

ABSTRACTION LEVEL (don't copy these, find YOUR OWN from the messages):
✓ RIGHT LEVEL: deep psychological needs, existential concerns, core fears/desires
✗ TOO SPECIFIC: interests in topics, current activities, temporary preferences
✗ REMOVE: Anything task-like, topic-specific, or that could be a hobby`,

    'interests': `⚠️ KEEP TO 5-8 BROAD DOMAINS MAX. Specific interests are tracked in memories.

Only include LIFE DOMAINS that define who they are:
- These are stable personality markers, not hobbies
- One-word or two-word categories only
- If it's a specific topic/project, REMOVE IT

ABSTRACTION LEVEL:
✓ RIGHT LEVEL: broad fields (like "music" not "jazz"), life domains, stable passions
✗ TOO SPECIFIC: particular topics, events, shows, projects, activities
✗ REMOVE: Anything specific enough that the LLM will parrot it back`,

    'goals': `⚠️ KEEP TO 2-3 LIFE ASPIRATIONS MAX. Tasks/projects are tracked elsewhere.

Only include EXISTENTIAL DIRECTION, not tasks:
- Who do they want to BECOME? (not what do they want to DO)
- These are identity-level aspirations
- Specific goals/projects belong in the tasks system

ABSTRACTION LEVEL:
✓ RIGHT LEVEL: identity transformation, ways of being, life themes
✗ TOO SPECIFIC: projects, trips, skills to learn, things to build
✗ REMOVE: Anything that could be a task or has a completion date`,

    'context': `⚠️ KEEP TO 2-4 EMOTIONAL STATES MAX. Projects are tracked elsewhere.

Only include PSYCHOLOGICAL CONTEXT, not activities:
- What emotional season are they in?
- What psychological patterns are active?
- NOT what they're working on (that's in tasks/desires)

ABSTRACTION LEVEL:
✓ RIGHT LEVEL: emotional phases, psychological states, life seasons
✗ TOO SPECIFIC: projects, activities, things they're doing
✗ REMOVE: Anything project-based or activity-based`,

    'decisionHeuristics': `⚠️ KEEP TO 5-7 CORE PATTERNS MAX.

Only include PSYCHOLOGICAL COPING MECHANISMS:
- How do they handle stress, vulnerability, conflict?
- What are their defense mechanisms?
- NOT specific topics or situations

ABSTRACTION LEVEL:
✓ RIGHT LEVEL: coping patterns, emotional responses, defense mechanisms
✗ TOO SPECIFIC: responses to particular topics, specific behaviors to repeat
✗ REMOVE: Anything the LLM might parrot as a specific behavior`,

    'writingStyle': `⚠️ KEEP TO 3-5 COMMUNICATION TRAITS MAX.

Only include HOW they communicate, not WHAT they say:
- Tone, structure, formality level
- NOT specific phrases, jokes, or recurring topics

ABSTRACTION LEVEL:
✓ RIGHT LEVEL: sentence structure, tone shifts, formality patterns
✗ TOO SPECIFIC: particular phrases, jokes, catchphrases, recurring words
✗ REMOVE: Any specific phrase the LLM might repeat verbatim`,
  };

  const guidance = sectionGuidance[section] || '';

  // Generic prompt for other sections (arrays of strings)
  return `You are a psychoanalyst maintaining a MINIMAL CORE PERSONALITY PROFILE.

⚠️ CRITICAL CONTEXT: This persona gets INJECTED INTO EVERY CONVERSATION with the AI.
If you add "hotdog jokes" here, the AI will make hotdog jokes constantly.
If you add "interested in travel", the AI will bring up travel unprompted.
The persona must be LEAN - only CORE IDENTITY that should color EVERY interaction.

## CURRENT PERSONA: ${displayName.toUpperCase()}
${currentData}

## PREVIOUS PERSONA (stability reference)
${archivedData}

## RECENT USER BEHAVIOR (${memoriesCount} messages)
${transcript}

## SECTION-SPECIFIC GUIDANCE
${guidance}

## YOUR TASK - AGGRESSIVE PRUNING
The persona is BLOATED. Your job is to SHRINK it to essential character traits.

PRIORITY ORDER:
1. REMOVE items that are too specific (topics, tasks, projects, specific phrases)
2. REMOVE items that the LLM will parrot annoyingly
3. REMOVE items tracked elsewhere (tasks, memories, desires systems)
4. CONSOLIDATE similar items into broader categories
5. Only ADD if something is FUNDAMENTALLY missing about core identity

BIAS TOWARD REMOVAL. A smaller, tighter persona is better than a comprehensive one.
Think: "What MUST the AI know to embody this person's ESSENCE?"
NOT: "What interesting details can we capture?"

Return ONLY a compact JSON object:
{
  "additions": ["only if CRITICAL identity gap - prefer empty"],
  "removals": ["specific items that don't belong in CORE identity"],
  "updates": [],
  "confidence": 0.8,
  "reasoning": "Why these changes tighten the persona"
}

CRITICAL TESTS before adding ANYTHING:
1. "If the AI sees this in EVERY conversation, will it help or annoy?"
2. "Is this WHO they ARE, or WHAT they're DOING right now?"
3. "Could this change in 6 months?" (if yes, don't add it)
4. "Am I adding this because I saw it, or because it's CORE to their identity?"

PREFER EMPTY additions array. The goal is to SHRINK the persona over time.`;
}

/**
 * Analyze a single persona section by comparing current vs archive vs memories
 */
async function analyzeSection(
  section: PersonaSection,
  displayName: string,
  currentPersona: any,
  archivedPersona: any | null,
  memories: Memory[],
  config: PsychoanalyzerConfig
): Promise<SectionAnalysisResult> {
  const currentData = extractSectionData(currentPersona, section);
  const archivedData = archivedPersona ? extractSectionData(archivedPersona, section) : 'No previous version';

  // Build memory transcript (can use more since section is smaller)
  const transcript = memories.map((m, i) =>
    `[${i + 1}] ${m.timestamp.slice(0, 10)}: ${m.content.slice(0, 500)}${m.content.length > 500 ? '...' : ''}`
  ).join('\n\n');

  const prompt = buildSectionPrompt(section, displayName, currentData, archivedData, transcript, memories.length);

  try {
    const response = await callLLM({
      role: 'psychotherapist',
      messages: [{ role: 'user', content: prompt }],
      options: { temperature: config.analysis.temperature, maxTokens: 800 },
    });

    const content = typeof response === 'string' ? response : response.content;
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { section, additions: [], removals: [], updates: [], confidence: 0.5, reasoning: 'Failed to parse response' };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      section,
      additions: parsed.additions || [],
      removals: parsed.removals || [],
      updates: parsed.updates || [],
      confidence: parsed.confidence || 0.5,
      reasoning: parsed.reasoning || '',
    };
  } catch (error) {
    console.error(`[psychoanalyzer] Failed to analyze section ${section}:`, error);
    return { section, additions: [], removals: [], updates: [], confidence: 0, reasoning: `Error: ${(error as Error).message}` };
  }
}

/**
 * Apply changes from section analysis to the persona
 */
interface InsightContext {
  memoriesAnalyzed: number;
  archiveCompared?: string;
  sessionId: string;
}

function applySectionChanges(
  persona: any,
  section: PersonaSection,
  result: SectionAnalysisResult,
  config: PsychoanalyzerConfig,
  ctx: InsightContext
): { changes: string[]; insights: InsightEntry[] } {
  const changes: string[] = [];
  const insights: InsightEntry[] = [];
  const timestamp = new Date().toISOString();

  // Helper to create insight entry with full context
  const createInsight = (type: 'addition' | 'removal' | 'update', category: string, items: string[]): InsightEntry => ({
    timestamp,
    type,
    category,
    section,
    items,
    memoriesAnalyzed: ctx.memoriesAnalyzed,
    confidence: result.confidence,
    reasoning: result.reasoning,
    archiveCompared: ctx.archiveCompared,
    sessionId: ctx.sessionId,
  });

  if (result.confidence < config.analysis.confidenceThreshold) {
    console.log(`[psychoanalyzer] Skipping ${section}: confidence ${result.confidence.toFixed(2)} below threshold`);
    return { changes, insights };
  }

  // Apply additions
  if (result.additions.length > 0) {
    switch (section) {
      case 'values':
        if (config.reconciliation?.removeContradictedValues !== false) {
          persona.values = persona.values || { core: [] };
          const existing = persona.values.core || [];
          const newItems = result.additions.filter((a: string) =>
            !existing.some((e: any) => (typeof e === 'string' ? e : e.value).toLowerCase() === a.toLowerCase())
          );
          if (newItems.length > 0) {
            persona.values.core = [...existing, ...newItems];
            changes.push(`Added ${newItems.length} value(s): ${newItems.join(', ')}`);
            insights.push(createInsight('addition', 'values', newItems));
          }
        }
        break;

      case 'interests':
        if (config.updateStrategy.fields['personality.interests']) {
          persona.personality = persona.personality || { interests: [] };
          const existing = persona.personality.interests || [];
          const newItems = result.additions.filter((a: string) => !existing.includes(a));
          if (newItems.length > 0) {
            persona.personality.interests = [...existing, ...newItems];
            changes.push(`Added ${newItems.length} interest(s): ${newItems.join(', ')}`);
            insights.push(createInsight('addition', 'interests', newItems));
          }
        }
        break;

      case 'goals':
        if (config.updateStrategy.fields['goals']) {
          persona.goals = persona.goals || { shortTerm: [], midTerm: [], longTerm: [] };
          const existing = persona.goals.shortTerm || [];
          const newItems = result.additions.filter((a: string) => !existing.includes(a));
          if (newItems.length > 0) {
            persona.goals.shortTerm = [...existing, ...newItems];
            changes.push(`Added ${newItems.length} goal(s): ${newItems.join(', ')}`);
            insights.push(createInsight('addition', 'goals', newItems));
          }
        }
        break;

      case 'context':
        if (config.updateStrategy.fields['context.currentFocus']) {
          persona.context = persona.context || { domains: [], projects: [], currentFocus: [] };
          const existing = persona.context.currentFocus || [];
          const newItems = result.additions.filter((a: string) => !existing.includes(a));
          if (newItems.length > 0) {
            persona.context.currentFocus = [...existing, ...newItems];
            changes.push(`Added ${newItems.length} focus area(s): ${newItems.join(', ')}`);
            insights.push(createInsight('addition', 'context.currentFocus', newItems));
          }
        }
        break;

      case 'writingStyle':
        if (config.updateStrategy.fields['writingStyle.motifs']) {
          persona.writingStyle = persona.writingStyle || { structure: '', motifs: [], defaultMantra: '' };
          const existing = persona.writingStyle.motifs || [];
          const newItems = result.additions.filter((a: string) => !existing.includes(a));
          if (newItems.length > 0) {
            persona.writingStyle.motifs = [...existing, ...newItems];
            changes.push(`Added ${newItems.length} motif(s): ${newItems.join(', ')}`);
            insights.push(createInsight('addition', 'writingStyle.motifs', newItems));
          }
        }
        break;

      case 'decisionHeuristics':
        if (config.updateStrategy.fields['decisionHeuristics']) {
          persona.decisionHeuristics = persona.decisionHeuristics || [];
          const existing = persona.decisionHeuristics;
          // New heuristics can be strings or objects - add as simple strings for now
          const newItems = result.additions.filter((a: string) =>
            !existing.some((h: any) => {
              const hStr = typeof h === 'string' ? h : (h.signal || h.trigger || JSON.stringify(h));
              return hStr.toLowerCase().includes(a.toLowerCase()) || a.toLowerCase().includes(hStr.toLowerCase());
            })
          );
          if (newItems.length > 0) {
            // Add as simple trigger strings that can be refined later
            persona.decisionHeuristics = [...existing, ...newItems.map((a: string) => ({ signal: a, response: 'pending elaboration' }))];
            changes.push(`Added ${newItems.length} heuristic(s): ${newItems.join(', ')}`);
            insights.push(createInsight('addition', 'decisionHeuristics', newItems));
          }
        }
        break;
    }
  }

  // Apply removals
  if (result.removals.length > 0) {
    switch (section) {
      case 'values':
        if (config.reconciliation?.removeContradictedValues) {
          const existing = persona.values?.core || [];
          const before = existing.length;
          persona.values.core = existing.filter((v: any) => {
            const valueStr = typeof v === 'string' ? v : v.value;
            return !result.removals.some((r: string) =>
              valueStr.toLowerCase().includes(r.toLowerCase()) || r.toLowerCase().includes(valueStr.toLowerCase())
            );
          });
          const removed = before - persona.values.core.length;
          if (removed > 0) {
            changes.push(`Removed ${removed} value(s): ${result.removals.join(', ')}`);
            insights.push(createInsight('removal', 'values', result.removals));
          }
        }
        break;

      case 'interests':
        if (config.reconciliation?.removeStaleInterests) {
          const existing = persona.personality?.interests || [];
          const before = existing.length;
          persona.personality.interests = existing.filter((i: string) =>
            !result.removals.some((r: string) => i.toLowerCase().includes(r.toLowerCase()) || r.toLowerCase().includes(i.toLowerCase()))
          );
          const removed = before - persona.personality.interests.length;
          if (removed > 0) {
            changes.push(`Removed ${removed} interest(s): ${result.removals.join(', ')}`);
            insights.push(createInsight('removal', 'interests', result.removals));
          }
        }
        break;

      case 'goals':
        if (config.reconciliation?.removeStaleGoals) {
          let totalRemoved = 0;
          for (const timeframe of ['shortTerm', 'midTerm', 'longTerm'] as const) {
            const existing = persona.goals?.[timeframe] || [];
            const before = existing.length;
            persona.goals[timeframe] = existing.filter((g: any) => {
              const goalStr = typeof g === 'string' ? g : g.goal;
              return !result.removals.some((r: string) =>
                goalStr.toLowerCase().includes(r.toLowerCase()) || r.toLowerCase().includes(goalStr.toLowerCase())
              );
            });
            totalRemoved += before - persona.goals[timeframe].length;
          }
          if (totalRemoved > 0) {
            changes.push(`Removed ${totalRemoved} goal(s): ${result.removals.join(', ')}`);
            insights.push(createInsight('removal', 'goals', result.removals));
          }
        }
        break;

      case 'context':
        if (config.updateStrategy.fields['context.currentFocus']) {
          const existing = persona.context?.currentFocus || [];
          const before = existing.length;
          persona.context.currentFocus = existing.filter((c: string) =>
            !result.removals.some((r: string) => c.toLowerCase().includes(r.toLowerCase()) || r.toLowerCase().includes(c.toLowerCase()))
          );
          const removed = before - persona.context.currentFocus.length;
          if (removed > 0) {
            changes.push(`Removed ${removed} focus area(s): ${result.removals.join(', ')}`);
            insights.push(createInsight('removal', 'context.currentFocus', result.removals));
          }
        }
        break;

      case 'decisionHeuristics':
        if (config.reconciliation?.removeUnusedHeuristics) {
          const existing = persona.decisionHeuristics || [];
          const before = existing.length;
          persona.decisionHeuristics = existing.filter((h: any) => {
            const hStr = typeof h === 'string' ? h : (h.trigger || h.heuristic || JSON.stringify(h));
            return !result.removals.some((r: string) =>
              hStr.toLowerCase().includes(r.toLowerCase()) || r.toLowerCase().includes(hStr.toLowerCase())
            );
          });
          const removed = before - persona.decisionHeuristics.length;
          if (removed > 0) {
            changes.push(`Removed ${removed} heuristic(s): ${result.removals.join(', ')}`);
            insights.push(createInsight('removal', 'decisionHeuristics', result.removals));
          }
        }
        break;

      case 'writingStyle':
        if (config.updateStrategy.fields['writingStyle.motifs']) {
          persona.writingStyle = persona.writingStyle || { motifs: [] };
          const existing = persona.writingStyle.motifs || [];
          const before = existing.length;
          persona.writingStyle.motifs = existing.filter((m: string) =>
            !result.removals.some((r: string) => m.toLowerCase().includes(r.toLowerCase()) || r.toLowerCase().includes(m.toLowerCase()))
          );
          const removed = before - persona.writingStyle.motifs.length;
          if (removed > 0) {
            changes.push(`Removed ${removed} motif(s): ${result.removals.join(', ')}`);
            insights.push(createInsight('removal', 'writingStyle.motifs', result.removals));
          }
        }
        break;
    }
  }

  // Apply updates (for traits, etc.)
  if (result.updates.length > 0 && section === 'personality.traits') {
    persona.personality = persona.personality || {};
    persona.personality.traits = persona.personality.traits || {};
    for (const update of result.updates) {
      if (['openness', 'conscientiousness', 'extraversion', 'agreeableness', 'neuroticism'].includes(update.field)) {
        const newVal = parseFloat(update.newValue);
        if (!isNaN(newVal) && newVal >= 0 && newVal <= 1) {
          persona.personality.traits[update.field] = newVal;
          changes.push(`Updated ${update.field}: ${update.oldValue} → ${update.newValue}`);
          insights.push(createInsight('update', 'personality.traits', [`${update.field}: ${update.oldValue} → ${update.newValue} (${update.reason || 'no reason given'})`]));
        }
      }
    }
  }

  return { changes, insights };
}

/**
 * Run chunked multi-stage analysis
 */
async function runChunkedAnalysis(
  memories: Memory[],
  config: PsychoanalyzerConfig
): Promise<{ persona: any; changes: string[]; insights: InsightEntry[]; sectionsProcessed: number }> {
  console.log('[psychoanalyzer] Starting chunked multi-stage analysis...');

  // Generate session ID for this analysis run
  const sessionId = `psych-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Load current persona
  const personaResult = storageClient.resolvePath({ category: 'config', subcategory: 'persona', relativePath: 'core.json' });
  if (!personaResult.success || !personaResult.path || !fs.existsSync(personaResult.path)) {
    throw new Error('Cannot load current persona');
  }
  const currentPersona = JSON.parse(fs.readFileSync(personaResult.path, 'utf-8'));

  // Load latest archive for comparison
  const archive = loadLatestArchive();
  const archivedPersona = archive?.persona || null;

  // Create archive of current state before making changes
  const newArchiveFile = createArchive(currentPersona);

  const allChanges: string[] = [];
  const allInsights: InsightEntry[] = [];
  let sectionsProcessed = 0;

  // Build insight context for this session
  const insightCtx: InsightContext = {
    memoriesAnalyzed: memories.length,
    archiveCompared: archive?.filename,
    sessionId,
  };

  // Process each section
  for (const { section, displayName, configKey } of PERSONA_SECTIONS) {
    // Check if this section is enabled in config
    if (!config.updateStrategy.fields[configKey]) {
      console.log(`[psychoanalyzer] Skipping ${section}: disabled in config`);
      continue;
    }

    console.log(`[psychoanalyzer] Analyzing section: ${displayName}...`);

    const result = await analyzeSection(section, displayName, currentPersona, archivedPersona, memories, config);

    console.log(`[psychoanalyzer]   ${section}: confidence=${result.confidence.toFixed(2)}, ` +
                `additions=${result.additions.length}, removals=${result.removals.length}, updates=${result.updates.length}`);

    if (result.reasoning) {
      console.log(`[psychoanalyzer]   Reasoning: ${result.reasoning}`);
    }

    // Apply changes with full context
    const { changes, insights } = applySectionChanges(currentPersona, section, result, config, insightCtx);
    allChanges.push(...changes);
    allInsights.push(...insights);
    sectionsProcessed++;

    // Small delay between sections to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // Update timestamp
  currentPersona.lastUpdated = new Date().toISOString();

  // Save updated persona if there were changes
  if (allChanges.length > 0) {
    fs.writeFileSync(personaResult.path, JSON.stringify(currentPersona, null, 2), 'utf-8');
    console.log(`[psychoanalyzer] Saved ${allChanges.length} changes to persona`);

    // Log insights
    await logInsights(config, allInsights);
  } else {
    console.log('[psychoanalyzer] No changes needed - persona is accurate');
  }

  return { persona: currentPersona, changes: allChanges, insights: allInsights, sectionsProcessed };
}

// ─────────────────────────────────────────────────────────────
// Core Functions
// ─────────────────────────────────────────────────────────────

export async function loadConfig(): Promise<PsychoanalyzerConfig> {
  // Try user profile config first, fall back to system default
  const profileResult = storageClient.resolvePath({ category: 'config', subcategory: 'etc', relativePath: 'psychoanalyzer.json' });

  if (profileResult.success && profileResult.path && fs.existsSync(profileResult.path)) {
    console.log('[psychoanalyzer] Using profile config:', profileResult.path);
    return JSON.parse(fs.readFileSync(profileResult.path, 'utf-8'));
  }

  // Fall back to system default (for initialization)
  const systemConfigPath = path.join(systemPaths.etc, 'psychoanalyzer.json');
  if (fs.existsSync(systemConfigPath)) {
    console.log('[psychoanalyzer] Using system default config (copy to profile to customize)');
    return JSON.parse(fs.readFileSync(systemConfigPath, 'utf-8'));
  }

  throw new Error('Psychoanalyzer configuration not found');
}

export async function selectMemories(config: PsychoanalyzerConfig): Promise<Memory[]> {
  console.log('[psychoanalyzer] Selecting memories for analysis...');

  const episodicResult = storageClient.resolvePath({ category: 'memory', subcategory: 'episodic' });
  const episodicPath = episodicResult.success && episodicResult.path ? episodicResult.path : null;
  if (!episodicPath) {
    throw new Error('Cannot resolve episodic memory path');
  }

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - config.memorySelection.daysBack);

  const memories: Memory[] = [];

  // Collect all JSON files from the episodic directory, handling nested year/month/day structure
  const collectJsonFiles = (dir: string): string[] => {
    const files: string[] = [];
    if (!fs.existsSync(dir)) return files;

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Recurse into subdirectories (year, month, day folders)
        files.push(...collectJsonFiles(fullPath));
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        files.push(fullPath);
      }
    }
    return files;
  };

  const allFiles = collectJsonFiles(episodicPath);
  console.log(`[psychoanalyzer] Found ${allFiles.length} total memory files`);

  // Sort by filename (which includes timestamp) in reverse order (newest first)
  allFiles.sort().reverse();

  // First pass: collect all eligible memories
  const eligibleMemories: Memory[] = [];
  for (const filePath of allFiles) {
    try {
      const memory: Memory = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

      const memoryDate = new Date(memory.timestamp);
      if (memoryDate < cutoffDate) continue;
      if (config.memorySelection.excludeTypes.includes(memory.type)) continue;

      // Extract only user input if configured
      if (config.memorySelection.userInputOnly) {
        const userContent = extractUserContent(memory.content);
        if (!userContent) continue; // Skip if no user content found
        memory.content = userContent;
      }

      eligibleMemories.push(memory);
    } catch {
      // Skip malformed files
    }
  }

  console.log(`[psychoanalyzer] Found ${eligibleMemories.length} eligible memories in date range`);

  // Second pass: select memories based on strategy
  if (config.memorySelection.strategy === 'weighted_random' && eligibleMemories.length > config.memorySelection.maxMemories) {
    // Weighted random sampling - more recent memories have higher weight
    const now = Date.now();
    const weights = eligibleMemories.map(m => {
      const ageMs = now - new Date(m.timestamp).getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      // Exponential decay weight - 1 day = 1.0, 7 days = 0.5, 14 days = 0.25
      return Math.exp(-ageDays / 10);
    });

    // Weighted random selection without replacement
    const selected = new Set<number>();
    while (selected.size < config.memorySelection.maxMemories && selected.size < eligibleMemories.length) {
      const totalWeight = weights.reduce((sum, w, i) => selected.has(i) ? sum : sum + w, 0);
      let random = Math.random() * totalWeight;
      for (let i = 0; i < weights.length; i++) {
        if (selected.has(i)) continue;
        random -= weights[i];
        if (random <= 0) {
          selected.add(i);
          const memory = eligibleMemories[i];
          const hasPriorityTag = memory.tags?.some(tag =>
            config.memorySelection.priorityTags.includes(tag)
          );
          if (hasPriorityTag) {
            memories.unshift(memory);
          } else {
            memories.push(memory);
          }
          break;
        }
      }
    }
  } else {
    // Default: take most recent memories
    for (const memory of eligibleMemories) {
      if (memories.length >= config.memorySelection.maxMemories) break;
      const hasPriorityTag = memory.tags?.some(tag =>
        config.memorySelection.priorityTags.includes(tag)
      );
      if (hasPriorityTag) {
        memories.unshift(memory);
      } else {
        memories.push(memory);
      }
    }
  }

  const selected = memories.slice(0, config.memorySelection.maxMemories);
  console.log(`[psychoanalyzer] Selected ${selected.length} memories from last ${config.memorySelection.daysBack} days`);

  return selected;
}

export async function analyzeMemories(memories: Memory[], config: PsychoanalyzerConfig): Promise<AnalysisResult> {
  console.log('[psychoanalyzer] Analyzing memories with psychotherapist model...');

  const transcript = memories.map((m, i) =>
    `[${i + 1}] ${m.timestamp} (${m.type})\n${m.content}\n${m.tags ? `Tags: ${m.tags.join(', ')}` : ''}`
  ).join('\n\n---\n\n');

  const dateRange = {
    start: memories[memories.length - 1].timestamp,
    end: memories[0].timestamp,
  };

  // Load current persona to identify stale content for removal
  let currentPersona: any = {};
  try {
    const personaResult = storageClient.resolvePath({ category: 'config', subcategory: 'persona', relativePath: 'core.json' });
    if (personaResult.success && personaResult.path && fs.existsSync(personaResult.path)) {
      currentPersona = JSON.parse(fs.readFileSync(personaResult.path, 'utf-8'));
    }
  } catch {
    // Continue with empty persona if load fails
  }

  // Extract current items for reconciliation
  const currentValues = (currentPersona.values?.core || []).map((v: any) => typeof v === 'string' ? v : v.value);
  const currentInterests = currentPersona.personality?.interests || [];
  const currentGoals = [
    ...(currentPersona.goals?.shortTerm || []).map((g: any) => typeof g === 'string' ? g : g.goal),
    ...(currentPersona.goals?.midTerm || []).map((g: any) => typeof g === 'string' ? g : g.goal),
    ...(currentPersona.goals?.longTerm || []).map((g: any) => typeof g === 'string' ? g : g.goal),
  ];

  const analysisPrompt = `You are reviewing a persona profile to ensure it accurately reflects the user based on recent conversations.

# CURRENT PERSONA (review each item for accuracy)
Values: ${currentValues.length > 0 ? currentValues.join(', ') : 'none'}
Interests: ${currentInterests.length > 0 ? currentInterests.join(', ') : 'none'}
Goals: ${currentGoals.length > 0 ? currentGoals.join(', ') : 'none'}

# RECENT USER MESSAGES (evidence for review)
${transcript}

## YOUR TASK
1. REVIEW each existing persona item against the evidence
2. IDENTIFY items that are outdated, completed, or no longer relevant
3. IDENTIFY new patterns that should be added
4. Aim for a BALANCED result - removals are as important as additions

Return ONLY a compact JSON object (no extra text):
{
  "insights": {
    "values": ["genuinely_new_value"],
    "interests": ["genuinely_new_interest"],
    "goals": ["genuinely_new_goal"],
    "patterns": ["behavioral_pattern"]
  },
  "removals": {
    "values": ["value_no_longer_supported_by_evidence"],
    "interests": ["interest_not_mentioned_recently"],
    "goals": ["completed_or_abandoned_goal"]
  },
  "confidence": 0.8,
  "summary": "One sentence summary of persona accuracy"
}

## REMOVAL CRITERIA
Remove items that:
- Are NOT supported by recent conversations
- Contradict recent user statements
- Represent completed/abandoned goals
- Show interests the user no longer discusses
- Were inferred too speculatively

## ADDITION CRITERIA
Only add items that:
- Are clearly demonstrated in multiple messages
- Represent consistent patterns, not one-off mentions
- Add meaningful new information about the user`;

  const messages = [{ role: 'user' as const, content: analysisPrompt }];

  const response = await callLLM({
    role: 'psychotherapist',
    messages,
    options: { temperature: config.analysis.temperature, maxTokens: 1500 },
  });

  let analysisResult: AnalysisResult;
  try {
    const content = typeof response === 'string' ? response : response.content;
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in response');

    const parsed = JSON.parse(jsonMatch[0]);
    analysisResult = {
      ...parsed,
      memoriesAnalyzed: memories.length,
      dateRange,
    };
  } catch {
    throw new Error('Failed to parse psychotherapist analysis');
  }

  console.log(`[psychoanalyzer] Analysis complete (confidence: ${analysisResult.confidence.toFixed(2)})`);
  return analysisResult;
}

export async function updatePersona(
  analysis: AnalysisResult,
  config: PsychoanalyzerConfig
): Promise<{ updated: any; changes: string[] }> {
  console.log('[psychoanalyzer] Updating persona with new insights...');

  if (analysis.confidence < config.analysis.confidenceThreshold) {
    console.log(`[psychoanalyzer] Confidence ${analysis.confidence.toFixed(2)} below threshold, skipping update`);
    return { updated: null, changes: [] };
  }

  const personaResult = storageClient.resolvePath({ category: 'config', subcategory: 'persona', relativePath: 'core.json' });
  const personaPath = personaResult.success && personaResult.path ? personaResult.path : null;
  if (!personaPath) {
    throw new Error('Cannot resolve persona core path');
  }
  const currentPersona = JSON.parse(fs.readFileSync(personaPath, 'utf-8'));
  const changes: string[] = [];
  const insightEntries: InsightEntry[] = [];
  const timestamp = new Date().toISOString();

  const insights = analysis.insights;

  // Update values
  if (config.updateStrategy.fields['values.core'] && insights.values) {
    const existingValues = currentPersona.values?.core || [];
    const newValues = insights.values.filter((v: any) =>
      !existingValues.some((ev: any) => ev.value === v.value || ev === v)
    );
    if (newValues.length > 0) {
      currentPersona.values = currentPersona.values || {};
      currentPersona.values.core = [...existingValues, ...newValues];
      changes.push(`Added ${newValues.length} new value(s)`);

      // Log insight
      insightEntries.push({
        timestamp,
        type: 'addition',
        category: 'values',
        items: newValues.map((v: any) => typeof v === 'string' ? v : v.value),
        memoriesAnalyzed: analysis.memoriesAnalyzed,
        confidence: analysis.confidence,
      });
    }
  }

  // Update interests
  if (config.updateStrategy.fields['personality.interests'] && insights.interests) {
    currentPersona.personality = currentPersona.personality || {};
    const existing = currentPersona.personality.interests || [];
    const newInterests = insights.interests.filter((i: string) => !existing.includes(i));
    if (newInterests.length > 0) {
      currentPersona.personality.interests = [...existing, ...newInterests];
      changes.push(`Added ${newInterests.length} new interest(s)`);

      // Log insight
      insightEntries.push({
        timestamp,
        type: 'addition',
        category: 'interests',
        items: newInterests,
        memoriesAnalyzed: analysis.memoriesAnalyzed,
        confidence: analysis.confidence,
      });
    }
  }

  // Update goals if present (goals can be array of strings or object with shortTerm/midTerm/longTerm)
  if (config.updateStrategy.fields['goals'] && insights.goals) {
    currentPersona.goals = currentPersona.goals || {};
    const goalsArray = Array.isArray(insights.goals) ? insights.goals : [];
    if (goalsArray.length > 0) {
      const existingGoals = currentPersona.goals.shortTerm || [];
      const newGoals = goalsArray.filter((g: string) => !existingGoals.includes(g));
      if (newGoals.length > 0) {
        currentPersona.goals.shortTerm = [...existingGoals, ...newGoals];
        changes.push(`Added ${newGoals.length} new goal(s)`);

        // Log insight
        insightEntries.push({
          timestamp,
          type: 'addition',
          category: 'goals',
          items: newGoals,
          memoriesAnalyzed: analysis.memoriesAnalyzed,
          confidence: analysis.confidence,
        });
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  // REMOVALS: Process items flagged for removal
  // ─────────────────────────────────────────────────────────────
  const removals = analysis.removals;

  // Remove stale values
  if (config.reconciliation?.removeContradictedValues && removals?.values && removals.values.length > 0) {
    const existingValues = currentPersona.values?.core || [];
    const valuesToRemove = removals.values;
    const filteredValues = existingValues.filter((v: any) => {
      const valueStr = typeof v === 'string' ? v : v.value;
      return !valuesToRemove.some((rv: string) =>
        valueStr.toLowerCase().includes(rv.toLowerCase()) ||
        rv.toLowerCase().includes(valueStr.toLowerCase())
      );
    });
    const removedCount = existingValues.length - filteredValues.length;
    if (removedCount > 0) {
      currentPersona.values.core = filteredValues;
      changes.push(`Removed ${removedCount} outdated value(s)`);

      insightEntries.push({
        timestamp,
        type: 'removal',
        category: 'values',
        items: valuesToRemove,
        memoriesAnalyzed: analysis.memoriesAnalyzed,
        confidence: analysis.confidence,
      });
    }
  }

  // Remove stale interests
  if (config.reconciliation?.removeStaleInterests && removals?.interests && removals.interests.length > 0) {
    const existingInterests = currentPersona.personality?.interests || [];
    const interestsToRemove = removals.interests;
    const filteredInterests = existingInterests.filter((i: string) =>
      !interestsToRemove.some((ri: string) =>
        i.toLowerCase().includes(ri.toLowerCase()) ||
        ri.toLowerCase().includes(i.toLowerCase())
      )
    );
    const removedCount = existingInterests.length - filteredInterests.length;
    if (removedCount > 0) {
      currentPersona.personality.interests = filteredInterests;
      changes.push(`Removed ${removedCount} stale interest(s)`);

      insightEntries.push({
        timestamp,
        type: 'removal',
        category: 'interests',
        items: interestsToRemove,
        memoriesAnalyzed: analysis.memoriesAnalyzed,
        confidence: analysis.confidence,
      });
    }
  }

  // Remove stale/completed goals
  if (config.reconciliation?.removeStaleGoals && removals?.goals && removals.goals.length > 0) {
    const goalsToRemove = removals.goals;
    let totalRemoved = 0;

    // Check all goal timeframes
    for (const timeframe of ['shortTerm', 'midTerm', 'longTerm'] as const) {
      const existingGoals = currentPersona.goals?.[timeframe] || [];
      const filteredGoals = existingGoals.filter((g: any) => {
        const goalStr = typeof g === 'string' ? g : g.goal;
        return !goalsToRemove.some((rg: string) =>
          goalStr.toLowerCase().includes(rg.toLowerCase()) ||
          rg.toLowerCase().includes(goalStr.toLowerCase())
        );
      });
      const removedCount = existingGoals.length - filteredGoals.length;
      if (removedCount > 0) {
        currentPersona.goals[timeframe] = filteredGoals;
        totalRemoved += removedCount;
      }
    }

    if (totalRemoved > 0) {
      changes.push(`Removed ${totalRemoved} completed/stale goal(s)`);

      insightEntries.push({
        timestamp,
        type: 'removal',
        category: 'goals',
        items: goalsToRemove,
        memoriesAnalyzed: analysis.memoriesAnalyzed,
        confidence: analysis.confidence,
      });
    }
  }

  currentPersona.lastUpdated = timestamp;

  if (changes.length > 0) {
    fs.writeFileSync(personaPath, JSON.stringify(currentPersona, null, 2), 'utf-8');
    console.log(`[psychoanalyzer] Applied ${changes.length} update(s) to persona`);

    // Log insights to tracking file
    await logInsights(config, insightEntries);
  }

  return { updated: currentPersona, changes };
}

/**
 * Run psychoanalysis for a single user using chunked multi-stage analysis
 *
 * Benefits of chunked approach:
 * - Lower token usage per LLM call (only one persona section at a time)
 * - Can use more memories for better accuracy
 * - Compares current vs archived persona for stability
 * - More granular insights tracking
 */
export async function runPsychoanalysis(username: string): Promise<UserPsychoanalyzerStats> {
  return await withUserContext({ userId: username, username, role: 'owner' }, async () => {
    console.log(`[psychoanalyzer] Processing user: ${username}`);

    const config = await loadConfig();

    if (!config.enabled) {
      return { memoriesAnalyzed: 0, confidence: 0, changesApplied: 0, skipped: true, skipReason: 'disabled' };
    }

    const memories = await selectMemories(config);

    if (memories.length < config.memorySelection.minMemories) {
      return {
        memoriesAnalyzed: memories.length,
        confidence: 0,
        changesApplied: 0,
        skipped: true,
        skipReason: `Insufficient memories (${memories.length}/${config.memorySelection.minMemories})`,
      };
    }

    // Use chunked multi-stage analysis for better accuracy and lower token usage
    console.log(`[psychoanalyzer] Using chunked analysis with ${memories.length} memories`);
    const result = await runChunkedAnalysis(memories, config);

    // Calculate average confidence across sections (use 0.7 as default if no sections processed)
    const avgConfidence = result.sectionsProcessed > 0 ? 0.75 : 0;

    return {
      memoriesAnalyzed: memories.length,
      confidence: avgConfidence,
      changesApplied: result.changes.length,
    };
  });
}

// ─────────────────────────────────────────────────────────────
// CLI Entry Point
// ─────────────────────────────────────────────────────────────

export async function runCycle(options: PsychoanalyzerOptions = {}): Promise<PsychoanalyzerResult> {
  const result: PsychoanalyzerResult = {
    success: true,
    usersProcessed: 0,
    errors: [],
    stats: {},
  };

  try {
    // SECURITY: Get target user - prioritizes explicit username, then API trigger, then most recently active
    let username: string | null = null;

    if (options.username) {
      username = options.username;
    } else if (options.singleUser) {
      username = 'default';
    } else {
      const activeUser = getTargetUser();
      if (activeUser) {
        username = activeUser.username;
      }
    }

    if (!username) {
      console.log('[psychoanalyzer] No active user found');
      return result;
    }

    console.log(`[psychoanalyzer] Processing user: ${username}`);

    {
      try {
        const stats = await runPsychoanalysis(username);
        result.stats[username] = stats;
        result.usersProcessed++;

        audit({
          category: 'action',
          level: 'info',
          event: 'psychoanalyzer_completed',
          actor: 'psychoanalyzer',
          details: {
            username,
            memoriesAnalyzed: stats.memoriesAnalyzed,
            confidence: stats.confidence,
            changesApplied: stats.changesApplied,
          },
        });
      } catch (error) {
        const errorMsg = `Error processing ${username}: ${(error as Error).message}`;
        result.errors.push(errorMsg);
        console.error(`[psychoanalyzer] ${errorMsg}`);
      }
    }

    return result;
  } catch (error) {
    result.success = false;
    result.errors.push((error as Error).message);
    return result;
  }
}

// ─────────────────────────────────────────────────────────────
// Agent Runtime Entry Point
// ─────────────────────────────────────────────────────────────

export async function run(ctx: AgentContext, input: AgentInput): Promise<AgentResult> {
  const startTime = Date.now();
  const args = input.args || [];
  const opts = input.options || {};

  let username = opts.username as string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--username' && i + 1 < args.length) {
      username = args[i + 1];
      break;
    }
  }

  const options: PsychoanalyzerOptions = {
    singleUser: args.includes('--single-user') || opts.singleUser === true,
    username: username || ctx.userId,
  };

  const result = await runCycle(options);

  return {
    success: result.success,
    data: {
      usersProcessed: result.usersProcessed,
      stats: result.stats,
    },
    errors: result.errors.length > 0 ? result.errors : undefined,
    durationMs: Date.now() - startTime,
  };
}
