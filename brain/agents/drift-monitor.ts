#!/usr/bin/env npx tsx
/**
 * Drift Monitor Agent
 *
 * Monitors how well the LLM's outputs match the user's communication style.
 * Compares user input messages to LLM outputs across multiple persona dimensions
 * and generates drift reports with accuracy metrics.
 *
 * Industry-standard evaluation methods:
 * - Big Five Personality Model (NEO-FFI)
 * - Embedding-based cosine similarity
 * - Role adherence scoring
 * - Consistency variance metrics
 *
 * Triggered by scheduler-service on configurable intervals.
 *
 * @author MetaHuman OS
 */

import { audit, captureEvent, getProfilePaths } from '@metahuman/core';
import { callLLM, type RouterMessage } from '@metahuman/core/model-router';
import { type EpisodicEvent } from '@metahuman/core';
import { listUsers } from '@metahuman/core';
import { getEmbedding, cosineSimilarity } from '@metahuman/core';
import {
  type DriftReport,
  type DriftAnalysis,
  type ExchangeAnalysis,
  type DimensionMetrics,
  type PersonaDimensions,
  type DriftRecommendation,
  type BigFiveTraits,
  type EmbeddingSimilarity,
  type ConsistencyMetrics,
  type RoleAdherenceMetrics,
  generateDriftReportId,
  calculateOverallDrift,
  driftToAccuracy,
} from '@metahuman/core';
import {
  loadDriftConfig,
  saveDriftReport,
  getLatestDriftReport,
} from '@metahuman/core';
import fs from 'node:fs';
import path from 'node:path';

const LOG_PREFIX = '[drift-monitor]';

// ============================================================================
// LLM Prompts
// ============================================================================

const ANALYSIS_SYSTEM_PROMPT = `You are a linguistic analyst specializing in communication style comparison.
Your task is to analyze pairs of messages (user input and LLM response) and measure how well
the LLM mirrors the user's communication style across multiple dimensions.

You will evaluate using industry-standard metrics:
1. Style dimensions (vocabulary, formality, punctuation, etc.)
2. Big Five personality traits (openness, conscientiousness, extraversion, agreeableness, neuroticism)
3. Role adherence (character consistency, style adherence, knowledge retention)

For each dimension, provide:
1. A description of the user's pattern
2. A description of the LLM's pattern
3. A similarity score (0.0 to 1.0, where 1.0 = identical style)

Be precise and objective. Focus on measurable linguistic features.

Respond ONLY with valid JSON matching the schema provided.`;

const ANALYSIS_USER_PROMPT = `Analyze the following conversation exchanges between a user and an LLM.
Measure how well the LLM mirrors the user's communication style.

## Exchanges to Analyze

{{EXCHANGES}}

## Dimensions to Analyze

### Style Dimensions
1. **sentenceLength**: Average sentence length (short/medium/long)
2. **vocabularyLevel**: Word complexity (simple/moderate/sophisticated)
3. **contractionUsage**: Use of contractions (frequent/occasional/rare)
4. **punctuationStyle**: Punctuation patterns (minimal/standard/expressive)
5. **formality**: Tone formality (casual/neutral/formal)
6. **emotionalTone**: Emotional expression (reserved/neutral/warm/enthusiastic)
7. **directness**: Communication style (direct/balanced/indirect)
8. **emojiUsage**: Emoji/emoticon usage (none/occasional/frequent)

### Big Five Personality Assessment
Rate each trait 0.0-1.0 based on communication patterns:
- **openness**: Creativity, curiosity, intellectual interests
- **conscientiousness**: Organization, detail-orientation, thoroughness
- **extraversion**: Sociability, expressiveness, energy
- **agreeableness**: Warmth, cooperation, supportiveness
- **neuroticism**: Anxiety indicators, emotional stability

### Role Adherence
- **characterConsistency**: Does the LLM maintain consistent personality? (0-1)
- **styleAdherence**: Does it match the user's style? (0-1)
- **knowledgeRetention**: Does it remember context appropriately? (0-1)

## Output Format

Return JSON:
{
  "dimensions": {
    "<dimension_name>": {
      "dimension": "<dimension_name>",
      "userPattern": "<description of user's pattern>",
      "llmPattern": "<description of LLM's pattern>",
      "similarity": <0.0-1.0>
    }
  },
  "bigFive": {
    "user": { "openness": 0.0-1.0, "conscientiousness": 0.0-1.0, "extraversion": 0.0-1.0, "agreeableness": 0.0-1.0, "neuroticism": 0.0-1.0 },
    "llm": { "openness": 0.0-1.0, "conscientiousness": 0.0-1.0, "extraversion": 0.0-1.0, "agreeableness": 0.0-1.0, "neuroticism": 0.0-1.0 },
    "similarity": <0.0-1.0>
  },
  "roleAdherence": {
    "characterConsistency": <0.0-1.0>,
    "styleAdherence": <0.0-1.0>,
    "knowledgeRetention": <0.0-1.0>,
    "overallAdherence": <0.0-1.0>
  },
  "overallSimilarity": <0.0-1.0>,
  "notableDifferences": ["<difference 1>", "<difference 2>"],
  "recommendations": [
    {
      "dimension": "<dimension>",
      "priority": "high|medium|low",
      "recommendation": "<what should change>",
      "action": "<specific action>",
      "expectedImprovement": "<expected result>"
    }
  ]
}`;

// ============================================================================
// Exchange Collection
// ============================================================================

interface ConversationExchange {
  userMessage: string;
  llmResponse: string;
  timestamp: string;
  memoryId: string;
}

/**
 * Parse combined "User: ...\n\nAssistant: ..." format into separate messages.
 * Handles variations like "Me:", "User:", "user:", etc.
 */
function parseConversationContent(content: string): { userMessage: string; llmResponse: string } | null {
  if (!content) return null;

  // Try to split on common patterns
  // Pattern: "User: <message>\n\nAssistant: <response>"
  // Also handles: "Me:", "user:", "me:", etc.
  const patterns = [
    /^(?:User|Me|user|me):\s*([\s\S]*?)\n\n(?:Assistant|assistant):\s*([\s\S]*)$/,
    /^(?:User|Me|user|me):\s*([\s\S]*?)\n(?:Assistant|assistant):\s*([\s\S]*)$/,
  ];

  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match && match[1] && match[2]) {
      return {
        userMessage: match[1].trim(),
        llmResponse: match[2].trim(),
      };
    }
  }

  return null;
}

/**
 * Recursively find all JSON files in a directory.
 */
function findJsonFiles(dir: string, files: string[] = []): string[] {
  if (!fs.existsSync(dir)) return files;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findJsonFiles(fullPath, files);
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      files.push(fullPath);
    }
  }
  return files;
}

/**
 * Collect recent conversation exchanges for analysis.
 */
async function collectExchanges(
  username: string,
  maxExchanges: number,
  windowDays: number
): Promise<ConversationExchange[]> {
  const profilePaths = getProfilePaths(username);
  const episodicPath = profilePaths.episodic;

  if (!fs.existsSync(episodicPath)) {
    return [];
  }

  const exchanges: ConversationExchange[] = [];
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - windowDays);

  // Find all JSON files recursively (handles YYYY/, YYYY/MM/DD/, etc.)
  const allFiles = findJsonFiles(episodicPath);

  // Sort by filename (which contains timestamp) newest first
  allFiles.sort((a, b) => b.localeCompare(a));

  for (const filePath of allFiles) {
    if (exchanges.length >= maxExchanges) break;

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const event = JSON.parse(content) as EpisodicEvent;

      // Check date
      const eventDate = new Date(event.timestamp);
      if (eventDate < cutoffDate) continue;

      // Only analyze conversation types
      if (event.type !== 'conversation') continue;

      // Try to extract user/assistant messages
      // Method 1: Separate content and response fields (legacy format)
      if (event.content && (event as { response?: string }).response) {
        exchanges.push({
          userMessage: event.content,
          llmResponse: (event as { response?: string }).response!,
          timestamp: event.timestamp,
          memoryId: event.id,
        });
        continue;
      }

      // Method 2: Combined format "User: ... Assistant: ..."
      if (event.content) {
        const parsed = parseConversationContent(event.content);
        if (parsed) {
          exchanges.push({
            userMessage: parsed.userMessage,
            llmResponse: parsed.llmResponse,
            timestamp: event.timestamp,
            memoryId: event.id,
          });
        }
      }
    } catch (error) {
      // Skip invalid files
    }
  }

  return exchanges;
}

// ============================================================================
// Embedding-Based Analysis
// ============================================================================

/**
 * Calculate embedding similarity between user and LLM texts.
 * Uses cosine similarity of sentence embeddings for objective measurement.
 */
async function calculateEmbeddingSimilarity(
  userTexts: string[],
  llmTexts: string[]
): Promise<EmbeddingSimilarity | null> {
  try {
    if (userTexts.length === 0 || llmTexts.length === 0) {
      return null;
    }

    // Combine texts for embedding
    const userCombined = userTexts.slice(0, 10).join(' ').substring(0, 2000);
    const llmCombined = llmTexts.slice(0, 10).join(' ').substring(0, 2000);

    // Get embeddings
    const userEmbedding = await getEmbedding(userCombined);
    const llmEmbedding = await getEmbedding(llmCombined);

    if (!userEmbedding || !llmEmbedding) {
      return null;
    }

    // Calculate cosine similarity
    const similarity = cosineSimilarity(userEmbedding, llmEmbedding);

    return {
      cosineSimilarity: similarity,
      semanticSimilarity: similarity, // Same for now, could use different method
      embeddingModel: 'nomic-embed-text', // Default model
    };
  } catch (error) {
    console.error(`${LOG_PREFIX} Embedding similarity error:`, error);
    return null;
  }
}

/**
 * Calculate consistency variance across responses.
 * Lower variance = more consistent persona.
 */
function calculateConsistencyMetrics(
  llmResponses: string[],
  dimensionSimilarities: number[]
): ConsistencyMetrics {
  if (dimensionSimilarities.length === 0) {
    return {
      styleVariance: 0.5,
      toneVariance: 0.5,
      overallConsistency: 0.5,
      sampleSize: 0,
    };
  }

  // Calculate standard deviation
  const mean = dimensionSimilarities.reduce((a, b) => a + b, 0) / dimensionSimilarities.length;
  const squaredDiffs = dimensionSimilarities.map(v => Math.pow(v - mean, 2));
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / squaredDiffs.length;
  const stdDev = Math.sqrt(variance);

  // Convert to consistency score (lower variance = higher consistency)
  const consistencyScore = Math.max(0, 1 - stdDev * 2);

  return {
    styleVariance: stdDev,
    toneVariance: stdDev, // Could differentiate if we track separately
    overallConsistency: consistencyScore,
    sampleSize: dimensionSimilarities.length,
  };
}

// ============================================================================
// LLM Analysis
// ============================================================================

interface LLMAnalysisResult {
  dimensions: Record<string, DimensionMetrics>;
  bigFive?: {
    user: BigFiveTraits;
    llm: BigFiveTraits;
    similarity: number;
  };
  roleAdherence?: RoleAdherenceMetrics;
  overallSimilarity: number;
  notableDifferences: string[];
  recommendations: DriftRecommendation[];
}

/**
 * Analyze exchanges using LLM.
 */
async function analyzeExchanges(exchanges: ConversationExchange[]): Promise<LLMAnalysisResult | null> {
  if (exchanges.length === 0) {
    return null;
  }

  // Format exchanges for prompt (limit to 6 exchanges with 250 char truncation to fit context)
  const exchangeText = exchanges.slice(0, 6).map((ex, i) => `
### Exchange ${i + 1} (${ex.timestamp.split('T')[0]})
**User**: ${ex.userMessage.substring(0, 250)}${ex.userMessage.length > 250 ? '...' : ''}
**LLM**: ${ex.llmResponse.substring(0, 250)}${ex.llmResponse.length > 250 ? '...' : ''}
`).join('\n');

  const userPrompt = ANALYSIS_USER_PROMPT.replace('{{EXCHANGES}}', exchangeText);

  const messages: RouterMessage[] = [
    { role: 'system', content: ANALYSIS_SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ];

  try {
    const response = await callLLM({
      role: 'curator', // Use curator model for analysis
      messages,
      options: { temperature: 0.3, responseFormat: 'json' },
    });

    if (!response.content) {
      console.error(`${LOG_PREFIX} Empty LLM response`);
      return null;
    }

    // Extract JSON from response
    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error(`${LOG_PREFIX} Could not parse JSON from response`);
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]) as LLMAnalysisResult;
    return parsed;
  } catch (error) {
    console.error(`${LOG_PREFIX} Analysis error:`, error);
    return null;
  }
}

/**
 * Determine trend compared to previous report.
 */
function calculateTrend(
  currentDrift: number,
  previousReport: DriftReport | null
): { trend: DriftAnalysis['trend']; delta: number } {
  if (!previousReport) {
    return { trend: 'unknown', delta: 0 };
  }

  const previousDrift = previousReport.analysis.overallDrift;
  const delta = previousDrift - currentDrift; // Positive = improving (less drift)

  if (Math.abs(delta) < 0.02) {
    return { trend: 'stable', delta };
  } else if (delta > 0) {
    return { trend: 'improving', delta };
  } else {
    return { trend: 'declining', delta };
  }
}

// ============================================================================
// Report Generation
// ============================================================================

/**
 * Generate a drift report for a user.
 */
async function generateDriftReport(username: string): Promise<DriftReport | null> {
  const startTime = Date.now();
  const config = await loadDriftConfig(username);

  if (!config.enabled) {
    console.log(`${LOG_PREFIX} Drift monitoring disabled for ${username}`);
    return null;
  }

  console.log(`${LOG_PREFIX} Analyzing drift for ${username}...`);

  // Collect exchanges
  const exchanges = await collectExchanges(
    username,
    config.maxExchangesPerRun,
    config.analysisWindowDays
  );

  if (exchanges.length < config.minExchangesForReport) {
    console.log(`${LOG_PREFIX} Not enough exchanges (${exchanges.length} < ${config.minExchangesForReport})`);
    return null;
  }

  console.log(`${LOG_PREFIX} Found ${exchanges.length} exchanges to analyze`);

  // Run analyses in parallel
  const [llmAnalysis, embeddingMetrics] = await Promise.all([
    analyzeExchanges(exchanges),
    calculateEmbeddingSimilarity(
      exchanges.map(e => e.userMessage),
      exchanges.map(e => e.llmResponse)
    ),
  ]);

  if (!llmAnalysis) {
    console.log(`${LOG_PREFIX} LLM analysis failed`);
    return null;
  }

  // Calculate consistency metrics
  const dimensionSimilarities = Object.values(llmAnalysis.dimensions)
    .filter(d => d !== undefined)
    .map(d => d.similarity);
  const consistencyMetrics = calculateConsistencyMetrics(
    exchanges.map(e => e.llmResponse),
    dimensionSimilarities
  );

  // Get previous report for trend
  const previousReport = await getLatestDriftReport(username);
  const overallDrift = calculateOverallDrift(llmAnalysis.dimensions as Partial<PersonaDimensions>);
  const { trend, delta } = calculateTrend(overallDrift, previousReport);

  // Build dimension lists
  const dimensionEntries = Object.entries(llmAnalysis.dimensions)
    .filter(([, v]) => v !== undefined)
    .map(([name, metrics]) => ({ name, drift: 1 - metrics.similarity }))
    .sort((a, b) => b.drift - a.drift);

  const highDriftDimensions = dimensionEntries
    .filter(d => d.drift > 0.3)
    .slice(0, 5)
    .map(d => d.name);

  const lowDriftDimensions = dimensionEntries
    .filter(d => d.drift < 0.2)
    .slice(0, 5)
    .map(d => d.name);

  // Build analysis object with industry-standard metrics
  const driftAnalysis: DriftAnalysis = {
    periodStart: exchanges[exchanges.length - 1]?.timestamp || new Date().toISOString(),
    periodEnd: exchanges[0]?.timestamp || new Date().toISOString(),
    exchangeCount: exchanges.length,
    dimensions: llmAnalysis.dimensions as Partial<PersonaDimensions>,
    overallDrift,
    accuracyPercent: driftToAccuracy(overallDrift),
    highDriftDimensions,
    lowDriftDimensions,
    trend,
    trendDelta: delta,
    // Industry-standard metrics
    bigFive: llmAnalysis.bigFive,
    embeddingMetrics: embeddingMetrics || undefined,
    consistencyMetrics,
    roleAdherence: llmAnalysis.roleAdherence,
  };

  // Build sample exchanges
  const sampleExchanges: ExchangeAnalysis[] = exchanges.slice(0, 5).map(ex => ({
    id: ex.memoryId,
    userMessage: ex.userMessage,
    llmResponse: ex.llmResponse,
    timestamp: ex.timestamp,
    dimensions: llmAnalysis.dimensions as Partial<PersonaDimensions>,
    exchangeSimilarity: llmAnalysis.overallSimilarity,
    notableDifferences: llmAnalysis.notableDifferences,
  }));

  // Build report
  const report: DriftReport = {
    id: generateDriftReportId(),
    generatedAt: new Date().toISOString(),
    userId: username,
    analysis: driftAnalysis,
    sampleExchanges,
    recommendations: llmAnalysis.recommendations || [],
    analysisModel: 'curator',
    processingTimeMs: Date.now() - startTime,
  };

  // Save report
  await saveDriftReport(username, report);

  console.log(`${LOG_PREFIX} Report generated: ${report.id}`);
  console.log(`${LOG_PREFIX}   Accuracy: ${driftAnalysis.accuracyPercent}%`);
  console.log(`${LOG_PREFIX}   Trend: ${trend} (${delta > 0 ? '+' : ''}${(delta * 100).toFixed(1)}%)`);
  console.log(`${LOG_PREFIX}   Embedding similarity: ${embeddingMetrics?.cosineSimilarity?.toFixed(2) || 'N/A'}`);
  console.log(`${LOG_PREFIX}   Consistency: ${(consistencyMetrics.overallConsistency * 100).toFixed(0)}%`);
  console.log(`${LOG_PREFIX}   High drift: ${highDriftDimensions.join(', ') || 'none'}`);

  // Audit
  audit({
    category: 'agent',
    level: 'info',
    event: 'drift_report_generated',
    actor: 'drift-monitor',
    details: {
      userId: username,
      reportId: report.id,
      accuracy: driftAnalysis.accuracyPercent,
      embeddingSimilarity: embeddingMetrics?.cosineSimilarity,
      consistency: consistencyMetrics.overallConsistency,
      trend,
      exchangeCount: exchanges.length,
      processingTimeMs: report.processingTimeMs,
    },
  });

  // Log to inner dialogue if configured
  if (config.logToInnerDialogue) {
    const trendEmoji = trend === 'improving' ? '📈' : trend === 'declining' ? '📉' : '➡️';
    const accuracyEmoji = driftAnalysis.accuracyPercent >= 80 ? '✨' : driftAnalysis.accuracyPercent >= 60 ? '👍' : '⚠️';

    captureEvent(
      `${accuracyEmoji} Drift analysis complete. My communication style mirrors the user at ${driftAnalysis.accuracyPercent}% accuracy. ${trendEmoji} Trend: ${trend}. Embedding similarity: ${embeddingMetrics?.cosineSimilarity?.toFixed(2) || 'N/A'}. ${highDriftDimensions.length > 0 ? `Areas to improve: ${highDriftDimensions.join(', ')}.` : 'All dimensions looking good!'}`,
      {
        type: 'inner_dialogue',
        tags: ['drift', 'analysis', 'persona', 'inner'],
        metadata: {
          source: 'drift-monitor',
          reportId: report.id,
          accuracy: driftAnalysis.accuracyPercent,
        },
      }
    );
  }

  return report;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log(`${LOG_PREFIX} Starting drift monitor...`);

  try {
    // Get all users
    const users = listUsers();
    const owners = users.filter(u => u.role === 'owner');

    if (owners.length === 0) {
      console.log(`${LOG_PREFIX} No owner users found`);
      return;
    }

    // Process each owner
    for (const user of owners) {
      try {
        await generateDriftReport(user.username);
      } catch (error) {
        console.error(`${LOG_PREFIX} Error processing ${user.username}:`, error);
      }
    }

    console.log(`${LOG_PREFIX} Drift monitoring complete`);
  } catch (error) {
    console.error(`${LOG_PREFIX} Fatal error:`, error);
    process.exit(1);
  }
}

// Run if called directly
main().catch(console.error);

export { generateDriftReport };
