/**
 * Scaling Utilities
 *
 * Cold start handling, model routing, and metrics tracking for server deployments.
 */

// ============================================================================
// Cold Start Manager
// ============================================================================

export interface ColdStartConfig {
  /** Show warning after this many ms (default: 15000) */
  warningThresholdMs: number;
  /** Fail after this many ms (default: 120000) */
  maxWaitMs: number;
  /** Ping interval to keep model warm (0 = disabled) */
  keepWarmIntervalMs?: number;
}

export type ColdStartPhase = 'cold' | 'warming' | 'warm' | 'unknown';

export interface ColdStartStatus {
  phase: ColdStartPhase;
  lastActivityMs: number;
  estimatedWarmupMs: number;
}

/**
 * Manages cold start detection and user feedback
 */
export class ColdStartManager {
  private config: ColdStartConfig;
  private lastRequestTime: number = 0;
  private isWarmedUp: boolean = false;
  private keepWarmInterval: NodeJS.Timeout | null = null;

  constructor(config: Partial<ColdStartConfig> = {}) {
    this.config = {
      warningThresholdMs: config.warningThresholdMs ?? 15000,
      maxWaitMs: config.maxWaitMs ?? 120000,
      keepWarmIntervalMs: config.keepWarmIntervalMs ?? 0,
    };
  }

  /**
   * Estimate if the model is likely cold
   */
  estimateColdStart(): ColdStartStatus {
    const timeSinceLastRequest = Date.now() - this.lastRequestTime;

    // If no requests ever made, assume cold
    if (this.lastRequestTime === 0) {
      return {
        phase: 'cold',
        lastActivityMs: timeSinceLastRequest,
        estimatedWarmupMs: 30000, // Assume 30s cold start
      };
    }

    // If last request was within 5 minutes, likely still warm
    if (timeSinceLastRequest < 5 * 60 * 1000) {
      return {
        phase: 'warm',
        lastActivityMs: timeSinceLastRequest,
        estimatedWarmupMs: 0,
      };
    }

    // Between 5-15 minutes, uncertain
    if (timeSinceLastRequest < 15 * 60 * 1000) {
      return {
        phase: 'warming',
        lastActivityMs: timeSinceLastRequest,
        estimatedWarmupMs: 10000,
      };
    }

    // Over 15 minutes, likely cold
    return {
      phase: 'cold',
      lastActivityMs: timeSinceLastRequest,
      estimatedWarmupMs: 30000,
    };
  }

  /**
   * Wait for model with progress reporting
   */
  async waitForModel(
    checkFn: () => Promise<boolean>,
    onProgress?: (message: string, elapsedMs: number) => void
  ): Promise<void> {
    const startTime = Date.now();
    let warned = false;

    while (true) {
      try {
        const ready = await checkFn();
        if (ready) {
          this.recordRequest();
          return;
        }
      } catch (error) {
        // Check function failed, continue waiting
      }

      const elapsed = Date.now() - startTime;

      if (elapsed > this.config.maxWaitMs) {
        throw new Error(`Model warmup timeout after ${elapsed}ms`);
      }

      if (!warned && elapsed > this.config.warningThresholdMs) {
        warned = true;
        onProgress?.(`GPU warming up... (${Math.round(elapsed / 1000)}s)`, elapsed);
      } else if (warned) {
        onProgress?.(`Still warming up... (${Math.round(elapsed / 1000)}s)`, elapsed);
      }

      await this.sleep(1000);
    }
  }

  /**
   * Record that a request was made (updates warm status)
   */
  recordRequest(): void {
    this.lastRequestTime = Date.now();
    this.isWarmedUp = true;
  }

  /**
   * Start keep-warm pinging (if configured)
   */
  startKeepWarm(pingFn: () => Promise<void>): void {
    if (this.config.keepWarmIntervalMs && this.config.keepWarmIntervalMs > 0) {
      if (this.keepWarmInterval) {
        clearInterval(this.keepWarmInterval);
      }

      this.keepWarmInterval = setInterval(async () => {
        try {
          await pingFn();
          this.recordRequest();
          console.log('[cold-start] Keep-warm ping successful');
        } catch (error) {
          console.warn('[cold-start] Keep-warm ping failed:', error);
        }
      }, this.config.keepWarmIntervalMs);

      console.log(`[cold-start] Keep-warm enabled, pinging every ${this.config.keepWarmIntervalMs}ms`);
    }
  }

  /**
   * Stop keep-warm pinging
   */
  stopKeepWarm(): void {
    if (this.keepWarmInterval) {
      clearInterval(this.keepWarmInterval);
      this.keepWarmInterval = null;
      console.log('[cold-start] Keep-warm disabled');
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================================
// Model Router (Fast/Slow Routing)
// ============================================================================

export interface ModelTier {
  name: string;
  modelId: string;
  maxComplexity: number; // 0-1 scale
  avgLatencyMs: number;
  costPerToken: number;
}

export interface ModelRouterConfig {
  tiers: ModelTier[];
  defaultTier: string;
}

/**
 * Routes requests to appropriate model tier based on complexity
 */
export class ModelRouter {
  private tiers: ModelTier[];
  private defaultTier: string;

  constructor(config: ModelRouterConfig) {
    this.tiers = config.tiers.sort((a, b) => a.maxComplexity - b.maxComplexity);
    this.defaultTier = config.defaultTier;
  }

  /**
   * Estimate request complexity (0-1 scale)
   */
  estimateComplexity(messages: Array<{ role: string; content: string }>): number {
    // Simple heuristics for complexity estimation
    let complexity = 0.5; // Start at medium

    const fullText = messages.map(m => m.content).join(' ');
    const wordCount = fullText.split(/\s+/).length;
    const hasCode = /```|function\s|class\s|import\s|export\s/.test(fullText);
    const hasJson = /{[^}]+}|\[.+\]/.test(fullText);
    const hasAnalysis = /analyze|explain|compare|evaluate|review/.test(fullText.toLowerCase());

    // Adjust based on content
    if (wordCount < 50) complexity -= 0.2;
    if (wordCount > 500) complexity += 0.2;
    if (hasCode) complexity += 0.3;
    if (hasJson) complexity += 0.1;
    if (hasAnalysis) complexity += 0.2;

    // Clamp to 0-1
    return Math.max(0, Math.min(1, complexity));
  }

  /**
   * Select appropriate model tier for a request
   */
  selectTier(messages: Array<{ role: string; content: string }>): ModelTier {
    const complexity = this.estimateComplexity(messages);

    for (const tier of this.tiers) {
      if (complexity <= tier.maxComplexity) {
        console.log(`[model-router] Complexity ${complexity.toFixed(2)} → ${tier.name}`);
        return tier;
      }
    }

    // Fall back to default
    const defaultTierObj = this.tiers.find(t => t.name === this.defaultTier);
    return defaultTierObj || this.tiers[this.tiers.length - 1];
  }
}

// ============================================================================
// Metrics Tracker
// ============================================================================

export interface RequestMetrics {
  requestId: string;
  userId?: string;
  modelId: string;
  startTime: number;
  endTime?: number;
  promptTokens?: number;
  completionTokens?: number;
  success: boolean;
  error?: string;
}

/**
 * Tracks usage metrics for billing and analytics
 */
export class MetricsTracker {
  private metrics: RequestMetrics[] = [];
  private maxMetrics: number;

  constructor(maxMetrics: number = 10000) {
    this.maxMetrics = maxMetrics;
  }

  /**
   * Start tracking a request
   */
  startRequest(requestId: string, modelId: string, userId?: string): void {
    this.metrics.push({
      requestId,
      userId,
      modelId,
      startTime: Date.now(),
      success: false,
    });

    // Trim old metrics if over limit
    if (this.metrics.length > this.maxMetrics) {
      this.metrics = this.metrics.slice(-this.maxMetrics);
    }
  }

  /**
   * Complete a request
   */
  completeRequest(
    requestId: string,
    tokens?: { prompt: number; completion: number }
  ): void {
    const metric = this.metrics.find(m => m.requestId === requestId);
    if (metric) {
      metric.endTime = Date.now();
      metric.promptTokens = tokens?.prompt;
      metric.completionTokens = tokens?.completion;
      metric.success = true;
    }
  }

  /**
   * Mark request as failed
   */
  failRequest(requestId: string, error: string): void {
    const metric = this.metrics.find(m => m.requestId === requestId);
    if (metric) {
      metric.endTime = Date.now();
      metric.success = false;
      metric.error = error;
    }
  }

  /**
   * Get aggregated metrics for a time period
   */
  getAggregatedMetrics(sinceMs: number = 24 * 60 * 60 * 1000): {
    totalRequests: number;
    successRate: number;
    avgLatencyMs: number;
    totalPromptTokens: number;
    totalCompletionTokens: number;
    requestsByUser: Record<string, number>;
    requestsByModel: Record<string, number>;
  } {
    const cutoff = Date.now() - sinceMs;
    const relevant = this.metrics.filter(m => m.startTime >= cutoff);

    const successful = relevant.filter(m => m.success);
    const latencies = successful
      .filter(m => m.endTime)
      .map(m => m.endTime! - m.startTime);

    const requestsByUser: Record<string, number> = {};
    const requestsByModel: Record<string, number> = {};

    for (const m of relevant) {
      if (m.userId) {
        requestsByUser[m.userId] = (requestsByUser[m.userId] || 0) + 1;
      }
      requestsByModel[m.modelId] = (requestsByModel[m.modelId] || 0) + 1;
    }

    return {
      totalRequests: relevant.length,
      successRate: relevant.length > 0 ? successful.length / relevant.length : 0,
      avgLatencyMs: latencies.length > 0
        ? latencies.reduce((a, b) => a + b, 0) / latencies.length
        : 0,
      totalPromptTokens: relevant.reduce((sum, m) => sum + (m.promptTokens || 0), 0),
      totalCompletionTokens: relevant.reduce((sum, m) => sum + (m.completionTokens || 0), 0),
      requestsByUser,
      requestsByModel,
    };
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

export function createColdStartManager(config?: Partial<ColdStartConfig>): ColdStartManager {
  return new ColdStartManager(config);
}

export function createModelRouter(config: ModelRouterConfig): ModelRouter {
  return new ModelRouter(config);
}

export function createMetricsTracker(maxMetrics?: number): MetricsTracker {
  return new MetricsTracker(maxMetrics);
}
