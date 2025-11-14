import type { APIRoute } from 'astro';
import { listFunctions } from '@metahuman/core/function-memory';
import { withUserContext } from '../../../middleware/userContext';

/**
 * GET /api/functions/stats
 *
 * Get statistics and insights about function memory
 */
const getHandler: APIRoute = async () => {
  try {
    // Get all functions
    const allFunctions = await listFunctions();

    // Calculate statistics
    const verified = allFunctions.filter(f => f.metadata.trustLevel === 'verified');
    const drafts = allFunctions.filter(f => f.metadata.trustLevel === 'draft');

    const totalUsageCount = allFunctions.reduce(
      (sum, f) => sum + f.metadata.usageCount,
      0
    );

    const totalSuccessCount = allFunctions.reduce(
      (sum, f) => sum + f.metadata.successCount,
      0
    );

    const avgQualityScore = allFunctions.length > 0
      ? allFunctions.reduce((sum, f) => sum + (f.metadata.qualityScore || 0), 0) / allFunctions.length
      : 0;

    // Top skills used
    const skillCounts: Record<string, number> = {};
    allFunctions.forEach(f => {
      f.skillsUsed.forEach(skill => {
        skillCounts[skill] = (skillCounts[skill] || 0) + 1;
      });
    });

    const topSkills = Object.entries(skillCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([skill, count]) => ({ skill, count }));

    // Pattern type distribution
    const patternTypes: Record<string, number> = {};
    allFunctions.forEach(f => {
      const patternType = f.tags.find(tag =>
        ['crud', 'data_transform', 'search_analyze', 'communication', 'file_management', 'general'].includes(tag)
      ) || 'unknown';
      patternTypes[patternType] = (patternTypes[patternType] || 0) + 1;
    });

    // Most used functions (top 5)
    const mostUsed = [...allFunctions]
      .sort((a, b) => b.metadata.usageCount - a.metadata.usageCount)
      .slice(0, 5)
      .map(f => ({
        id: f.id,
        title: f.title,
        usageCount: f.metadata.usageCount,
        successRate: f.metadata.usageCount > 0
          ? f.metadata.successCount / f.metadata.usageCount
          : 0,
        qualityScore: f.metadata.qualityScore || 0,
      }));

    // Highest quality functions (top 5)
    const highestQuality = [...allFunctions]
      .filter(f => f.metadata.usageCount > 0) // Only consider used functions
      .sort((a, b) => (b.metadata.qualityScore || 0) - (a.metadata.qualityScore || 0))
      .slice(0, 5)
      .map(f => ({
        id: f.id,
        title: f.title,
        qualityScore: f.metadata.qualityScore || 0,
        usageCount: f.metadata.usageCount,
        successRate: f.metadata.usageCount > 0
          ? f.metadata.successCount / f.metadata.usageCount
          : 0,
      }));

    // Recent activity (last 7 days)
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentlyUsed = allFunctions.filter(
      f => f.metadata.lastUsedAt && new Date(f.metadata.lastUsedAt).getTime() > sevenDaysAgo
    );

    const recentlyCreated = allFunctions.filter(
      f => new Date(f.metadata.createdAt).getTime() > sevenDaysAgo
    );

    const stats = {
      total: allFunctions.length,
      verified: verified.length,
      drafts: drafts.length,
      totalUsageCount,
      totalSuccessCount,
      overallSuccessRate: totalUsageCount > 0 ? totalSuccessCount / totalUsageCount : 0,
      avgQualityScore,
      topSkills,
      patternTypes,
      mostUsed,
      highestQuality,
      recentActivity: {
        usedLast7Days: recentlyUsed.length,
        createdLast7Days: recentlyCreated.length,
      },
    };

    return new Response(JSON.stringify(stats), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  } catch (error) {
    console.error('[API /api/functions/stats] Error calculating stats:', error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
  }
};

// Wrap with user context middleware
export const GET = withUserContext(getHandler);
