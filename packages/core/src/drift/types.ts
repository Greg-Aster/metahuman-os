/**
 * Drift System Types
 *
 * The Drift system monitors how well the LLM's outputs match the user's
 * communication style, measuring "drift" from authentic mirroring.
 *
 * Lower drift = better mirroring of the user's persona.
 *
 * Industry-standard evaluation methods incorporated:
 * - Big Five Personality Model (NEO-FFI) - https://arxiv.org/html/2406.17675v1
 * - Embedding-based cosine similarity - ConsistencyAI benchmark methodology
 * - Role adherence scoring - Confident AI evaluation metrics
 * - Consistency variance - LLMPTBench framework
 */

// ============================================================================
// Industry-Standard Evaluation Metrics
// ============================================================================

/**
 * Big Five Personality Traits (NEO-FFI Model)
 * Industry standard for personality assessment in AI systems.
 * Reference: https://arxiv.org/html/2406.17675v1
 */
export interface BigFiveTraits {
  /** Openness to experience (0-1) - creativity, curiosity, intellectual interests */
  openness: number;
  /** Conscientiousness (0-1) - organization, dependability, self-discipline */
  conscientiousness: number;
  /** Extraversion (0-1) - sociability, assertiveness, positive emotions */
  extraversion: number;
  /** Agreeableness (0-1) - cooperation, trust, altruism */
  agreeableness: number;
  /** Neuroticism (0-1) - emotional instability, anxiety, moodiness */
  neuroticism: number;
}

/**
 * Embedding-based similarity metrics.
 * Uses cosine similarity of sentence embeddings for objective measurement.
 * Reference: ConsistencyAI benchmark methodology.
 */
export interface EmbeddingSimilarity {
  /** Cosine similarity of message embeddings (0-1) */
  cosineSimilarity: number;
  /** Semantic similarity score (0-1) */
  semanticSimilarity: number;
  /** Embedding model used */
  embeddingModel: string;
}

/**
 * Consistency variance metrics (LLMPTBench framework).
 * Measures how stable the persona is across responses.
 * Lower standard deviation = more consistent.
 */
export interface ConsistencyMetrics {
  /** Standard deviation of style scores across responses */
  styleVariance: number;
  /** Standard deviation of tone scores across responses */
  toneVariance: number;
  /** Overall consistency score (0-1, higher = more consistent) */
  overallConsistency: number;
  /** Number of samples used for variance calculation */
  sampleSize: number;
}

/**
 * Role adherence metrics (Confident AI methodology).
 * Measures how well the LLM maintains its assigned persona.
 */
export interface RoleAdherenceMetrics {
  /** How well it stays in character (0-1) */
  characterConsistency: number;
  /** How well it maintains the user's communication style (0-1) */
  styleAdherence: number;
  /** Knowledge retention across conversations (0-1) */
  knowledgeRetention: number;
  /** Overall role adherence score (0-1) */
  overallAdherence: number;
}

// ============================================================================
// Persona Dimensions - What We Measure
// ============================================================================

/**
 * Individual metrics for a specific persona dimension.
 * Each metric compares user patterns vs LLM patterns.
 */
export interface DimensionMetrics {
  /** Name of this dimension */
  dimension: string;
  /** User's observed pattern/value */
  userPattern: string;
  /** LLM's observed pattern/value */
  llmPattern: string;
  /** Similarity score (0-1, higher = more similar) */
  similarity: number;
  /** Embedding-based similarity (objective measurement) */
  embeddingSimilarity?: number;
  /** Variance across multiple samples (lower = more consistent) */
  variance?: number;
  /** Specific examples from analysis */
  examples?: {
    user: string[];
    llm: string[];
  };
}

/**
 * All persona dimensions we analyze for drift.
 */
export interface PersonaDimensions {
  // === Writing Style ===
  /** Average sentence length (words) */
  sentenceLength: DimensionMetrics;
  /** Vocabulary complexity (simple/moderate/sophisticated) */
  vocabularyLevel: DimensionMetrics;
  /** Use of contractions (don't vs do not) */
  contractionUsage: DimensionMetrics;
  /** Punctuation patterns (exclamations, ellipses, etc.) */
  punctuationStyle: DimensionMetrics;
  /** Capitalization patterns */
  capitalization: DimensionMetrics;

  // === Tone & Voice ===
  /** Formality level (casual/neutral/formal) */
  formality: DimensionMetrics;
  /** Emotional tone (neutral/warm/enthusiastic/reserved) */
  emotionalTone: DimensionMetrics;
  /** Humor usage (none/occasional/frequent) */
  humorFrequency: DimensionMetrics;
  /** Directness (direct/diplomatic/indirect) */
  directness: DimensionMetrics;

  // === Language Patterns ===
  /** Common phrases/expressions */
  catchphrases: DimensionMetrics;
  /** Filler words (um, like, basically) */
  fillerWords: DimensionMetrics;
  /** Technical jargon usage */
  jargonUsage: DimensionMetrics;
  /** Emoji/emoticon usage */
  emojiUsage: DimensionMetrics;

  // === Communication Style ===
  /** Response length tendency */
  responseLength: DimensionMetrics;
  /** Question asking frequency */
  questionFrequency: DimensionMetrics;
  /** Use of examples/analogies */
  exampleUsage: DimensionMetrics;
  /** Hedging language (maybe, perhaps, I think) */
  hedgingLevel: DimensionMetrics;
}

// ============================================================================
// Drift Analysis Results
// ============================================================================

/**
 * Analysis of a single conversation exchange.
 */
export interface ExchangeAnalysis {
  /** Unique identifier */
  id: string;
  /** User's message */
  userMessage: string;
  /** LLM's response */
  llmResponse: string;
  /** Timestamp of exchange */
  timestamp: string;
  /** Per-dimension analysis */
  dimensions: Partial<PersonaDimensions>;
  /** Overall similarity for this exchange (0-1) */
  exchangeSimilarity: number;
  /** Notable differences observed */
  notableDifferences: string[];
}

/**
 * Aggregated drift analysis across multiple exchanges.
 */
export interface DriftAnalysis {
  /** Analysis period start */
  periodStart: string;
  /** Analysis period end */
  periodEnd: string;
  /** Number of exchanges analyzed */
  exchangeCount: number;
  /** Aggregated dimension metrics */
  dimensions: Partial<PersonaDimensions>;
  /** Overall drift score (0-1, lower = less drift = better mirroring) */
  overallDrift: number;
  /** Overall accuracy (1 - drift, as percentage) */
  accuracyPercent: number;
  /** Dimensions with highest drift (problem areas) */
  highDriftDimensions: string[];
  /** Dimensions with lowest drift (well-mirrored) */
  lowDriftDimensions: string[];
  /** Trend compared to previous period */
  trend: 'improving' | 'stable' | 'declining' | 'unknown';
  /** Trend delta (positive = improving) */
  trendDelta: number;

  // === Industry-Standard Metrics ===
  /** Big Five personality comparison (user vs LLM) */
  bigFive?: {
    user: BigFiveTraits;
    llm: BigFiveTraits;
    similarity: number;
  };
  /** Embedding-based similarity metrics */
  embeddingMetrics?: EmbeddingSimilarity;
  /** Consistency variance across responses */
  consistencyMetrics?: ConsistencyMetrics;
  /** Role adherence scoring */
  roleAdherence?: RoleAdherenceMetrics;
}

// ============================================================================
// Drift Reports
// ============================================================================

/**
 * A complete drift report generated by the drift monitor.
 */
export interface DriftReport {
  /** Unique report ID */
  id: string;
  /** Report generation timestamp */
  generatedAt: string;
  /** User this report is for */
  userId: string;
  /** Analysis results */
  analysis: DriftAnalysis;
  /** Individual exchange analyses (sample) */
  sampleExchanges: ExchangeAnalysis[];
  /** Recommendations for reducing drift */
  recommendations: DriftRecommendation[];
  /** Model used for analysis */
  analysisModel: string;
  /** Processing time in ms */
  processingTimeMs: number;
}

/**
 * Recommendation for improving mirroring accuracy.
 */
export interface DriftRecommendation {
  /** Which dimension this addresses */
  dimension: string;
  /** Priority (high/medium/low) */
  priority: 'high' | 'medium' | 'low';
  /** Human-readable recommendation */
  recommendation: string;
  /** Specific action to take */
  action: string;
  /** Expected improvement if addressed */
  expectedImprovement: string;
}

// ============================================================================
// Drift Metrics Summary
// ============================================================================

/**
 * Summary metrics for dashboard display.
 */
export interface DriftMetricsSummary {
  /** Current overall accuracy percentage */
  currentAccuracy: number;
  /** Accuracy change from last period */
  accuracyChange: number;
  /** Trend direction */
  trend: 'improving' | 'stable' | 'declining' | 'unknown';
  /** Best performing dimensions */
  strongestDimensions: Array<{
    name: string;
    accuracy: number;
  }>;
  /** Worst performing dimensions (opportunities) */
  weakestDimensions: Array<{
    name: string;
    accuracy: number;
  }>;
  /** Last analysis timestamp */
  lastAnalyzedAt: string;
  /** Total exchanges analyzed all-time */
  totalExchangesAnalyzed: number;
  /** Reports generated */
  reportCount: number;
}

// ============================================================================
// Configuration
// ============================================================================

/**
 * Drift monitor configuration.
 */
export interface DriftConfig {
  /** Whether drift monitoring is enabled */
  enabled: boolean;
  /** Minimum exchanges before generating report */
  minExchangesForReport: number;
  /** Maximum exchanges to analyze per run */
  maxExchangesPerRun: number;
  /** Days of history to analyze */
  analysisWindowDays: number;
  /** Dimensions to analyze (or 'all') */
  enabledDimensions: string[] | 'all';
  /** Drift threshold for alerts (0-1) */
  alertThreshold: number;
  /** Whether to log to inner dialogue */
  logToInnerDialogue: boolean;
}

/**
 * Default drift configuration.
 */
export const DEFAULT_DRIFT_CONFIG: DriftConfig = {
  enabled: true,
  minExchangesForReport: 10,
  maxExchangesPerRun: 50,
  analysisWindowDays: 7,
  enabledDimensions: 'all',
  alertThreshold: 0.4, // Alert if drift > 40%
  logToInnerDialogue: true,
};

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate a unique drift report ID.
 */
export function generateDriftReportId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `drift-${timestamp}-${random}`;
}

/**
 * Calculate overall drift from dimension metrics.
 * Returns value 0-1 where 0 = perfect match, 1 = completely different.
 */
export function calculateOverallDrift(dimensions: Partial<PersonaDimensions>): number {
  const values = Object.values(dimensions).filter(d => d !== undefined) as DimensionMetrics[];
  if (values.length === 0) return 0.5; // Unknown

  const totalSimilarity = values.reduce((sum, d) => sum + d.similarity, 0);
  const avgSimilarity = totalSimilarity / values.length;

  // Drift is inverse of similarity
  return 1 - avgSimilarity;
}

/**
 * Convert drift score to accuracy percentage.
 */
export function driftToAccuracy(drift: number): number {
  return Math.round((1 - drift) * 100);
}

/**
 * Get drift level description.
 */
export function getDriftLevel(drift: number): 'excellent' | 'good' | 'moderate' | 'poor' | 'critical' {
  if (drift < 0.1) return 'excellent';
  if (drift < 0.25) return 'good';
  if (drift < 0.4) return 'moderate';
  if (drift < 0.6) return 'poor';
  return 'critical';
}

/**
 * Initialize empty dimension metrics.
 */
export function initializeDimensionMetrics(dimension: string): DimensionMetrics {
  return {
    dimension,
    userPattern: 'unknown',
    llmPattern: 'unknown',
    similarity: 0.5,
  };
}

/**
 * Get all dimension names.
 */
export function getAllDimensionNames(): string[] {
  return [
    'sentenceLength',
    'vocabularyLevel',
    'contractionUsage',
    'punctuationStyle',
    'capitalization',
    'formality',
    'emotionalTone',
    'humorFrequency',
    'directness',
    'catchphrases',
    'fillerWords',
    'jargonUsage',
    'emojiUsage',
    'responseLength',
    'questionFrequency',
    'exampleUsage',
    'hedgingLevel',
  ];
}
