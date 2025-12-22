/**
 * Goal Review System
 *
 * Generates periodic reviews of long-running goals and projects.
 * Part of Phase 4: Continual Learning
 *
 * Features:
 * - Weekly goal progress reviews
 * - Task completion analysis
 * - Blocker identification
 * - Priority suggestions
 * - Historical review tracking
 */

import * as fs from 'fs';
import * as path from 'path';
import { storageClient } from './storage-router.js';
import { callLLM } from './model-router.js';
import { audit } from './audit.js';
import {
  listProjects,
  getProject,
  getProjectTasks,
  listActiveTasks,
  getActionableTasks,
  getBlockedTasks,
  type Project,
  type Task,
} from './memory.js';

// ============================================================================
// Types
// ============================================================================

export interface GoalProgress {
  projectId: string;
  title: string;
  tasksTotal: number;
  tasksCompleted: number;
  tasksInProgress: number;
  tasksBlocked: number;
  progressPercent: number;
  lastActivity?: string;
  blockers: string[];
}

export interface WeeklyReview {
  id: string;
  weekOf: string; // ISO date of the Monday of the week
  generatedAt: string;
  projects: GoalProgress[];
  overallProgress: {
    totalProjects: number;
    activeProjects: number;
    completedProjects: number;
    totalTasks: number;
    completedTasks: number;
    blockedTasks: number;
  };
  insights: string[];
  recommendations: string[];
  focusAreas: string[];
  celebrateWins: string[];
  concernAreas: string[];
}

export interface ReviewOptions {
  /** Include archived projects */
  includeArchived?: boolean;
  /** Number of weeks to look back for trends */
  weeksBack?: number;
  /** Generate AI-powered insights */
  generateInsights?: boolean;
}

// ============================================================================
// Storage
// ============================================================================

function getReviewsPath(): string {
  const stateResult = storageClient.resolvePath({
    category: 'state',
  });
  if (!stateResult.success || !stateResult.path) {
    throw new Error('Cannot resolve state path');
  }
  return path.join(stateResult.path, 'goal-reviews');
}

function ensureReviewsDir(): string {
  const dir = getReviewsPath();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function generateReviewId(): string {
  return `review-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getWeekStart(date: Date = new Date()): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust for Monday
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().split('T')[0];
}

// ============================================================================
// Progress Calculation
// ============================================================================

function calculateGoalProgress(project: Project, tasks: Task[]): GoalProgress {
  const completed = tasks.filter((t) => t.status === 'done');
  const inProgress = tasks.filter((t) => t.status === 'in_progress');
  const blocked = tasks.filter((t) => t.status === 'blocked');

  const progressPercent =
    tasks.length > 0 ? Math.round((completed.length / tasks.length) * 100) : 0;

  // Find last activity
  const allDates = tasks
    .map((t) => t.updated || t.created)
    .filter(Boolean)
    .sort()
    .reverse();
  const lastActivity = allDates[0];

  // Identify blockers
  const blockers = blocked.map((t) => t.title);

  return {
    projectId: project.id,
    title: project.title,
    tasksTotal: tasks.length,
    tasksCompleted: completed.length,
    tasksInProgress: inProgress.length,
    tasksBlocked: blocked.length,
    progressPercent,
    lastActivity,
    blockers,
  };
}

// ============================================================================
// LLM Insights
// ============================================================================

const INSIGHTS_PROMPT = `You are analyzing a weekly goal review to provide insights and recommendations.

Given the following project/goal progress data:
{data}

Provide:
1. 2-3 key insights about overall progress patterns
2. 2-3 specific recommendations for the coming week
3. 1-2 focus areas that need attention
4. Any wins worth celebrating (tasks completed, progress made)
5. Any concerning areas (stalled projects, many blockers)

Be specific and actionable. Reference actual project names and task counts.

Respond in JSON:
{
  "insights": ["insight 1", "insight 2"],
  "recommendations": ["recommendation 1", "recommendation 2"],
  "focusAreas": ["area 1"],
  "celebrateWins": ["win 1"],
  "concernAreas": ["concern 1"] or []
}`;

interface LLMInsights {
  insights: string[];
  recommendations: string[];
  focusAreas: string[];
  celebrateWins: string[];
  concernAreas: string[];
}

async function generateInsights(
  projects: GoalProgress[],
  overall: WeeklyReview['overallProgress']
): Promise<LLMInsights> {
  const defaultInsights: LLMInsights = {
    insights: [],
    recommendations: [],
    focusAreas: [],
    celebrateWins: [],
    concernAreas: [],
  };

  if (projects.length === 0) {
    return {
      ...defaultInsights,
      insights: ['No active projects to review.'],
      recommendations: ['Consider creating projects to organize your goals.'],
    };
  }

  const dataContext = JSON.stringify(
    {
      projects: projects.map((p) => ({
        title: p.title,
        progress: `${p.progressPercent}%`,
        completed: p.tasksCompleted,
        inProgress: p.tasksInProgress,
        blocked: p.tasksBlocked,
        blockers: p.blockers,
      })),
      overall: {
        activeProjects: overall.activeProjects,
        totalTasks: overall.totalTasks,
        completed: overall.completedTasks,
        blocked: overall.blockedTasks,
      },
    },
    null,
    2
  );

  try {
    const response = await callLLM({
      role: 'curator',
      messages: [
        {
          role: 'user',
          content: INSIGHTS_PROMPT.replace('{data}', dataContext),
        },
      ],
      options: {
        temperature: 0.5,
        responseFormat: { type: 'json_object' },
      },
    });

    if (!response.success || !response.text) {
      return defaultInsights;
    }

    const parsed = JSON.parse(response.text);
    return {
      insights: parsed.insights || [],
      recommendations: parsed.recommendations || [],
      focusAreas: parsed.focusAreas || [],
      celebrateWins: parsed.celebrateWins || [],
      concernAreas: parsed.concernAreas || [],
    };
  } catch (error) {
    console.warn('[goal-review] Failed to generate insights:', (error as Error).message);
    return defaultInsights;
  }
}

// ============================================================================
// Main Functions
// ============================================================================

/**
 * Generate a weekly review of all goals/projects.
 */
export async function generateWeeklyReview(
  options: ReviewOptions = {}
): Promise<WeeklyReview> {
  const { includeArchived = false, generateInsights: shouldGenerateInsights = true } = options;

  const weekOf = getWeekStart();
  const projects = listProjects(includeArchived);

  // Calculate progress for each project
  const projectProgress: GoalProgress[] = [];
  let totalTasks = 0;
  let completedTasks = 0;
  let blockedTasks = 0;

  for (const project of projects) {
    if (project.status === 'archived' && !includeArchived) continue;

    const tasks = getProjectTasks(project.id);
    const progress = calculateGoalProgress(project, tasks);
    projectProgress.push(progress);

    totalTasks += progress.tasksTotal;
    completedTasks += progress.tasksCompleted;
    blockedTasks += progress.tasksBlocked;
  }

  // Calculate overall progress
  const activeProjects = projects.filter((p) => p.status === 'active').length;
  const completedProjects = projects.filter((p) => p.status === 'completed').length;

  const overallProgress = {
    totalProjects: projects.length,
    activeProjects,
    completedProjects,
    totalTasks,
    completedTasks,
    blockedTasks,
  };

  // Generate LLM insights if requested
  let insights: LLMInsights = {
    insights: [],
    recommendations: [],
    focusAreas: [],
    celebrateWins: [],
    concernAreas: [],
  };

  if (shouldGenerateInsights) {
    insights = await generateInsights(projectProgress, overallProgress);
  }

  // Build review
  const review: WeeklyReview = {
    id: generateReviewId(),
    weekOf,
    generatedAt: new Date().toISOString(),
    projects: projectProgress,
    overallProgress,
    insights: insights.insights,
    recommendations: insights.recommendations,
    focusAreas: insights.focusAreas,
    celebrateWins: insights.celebrateWins,
    concernAreas: insights.concernAreas,
  };

  // Save review
  const dir = ensureReviewsDir();
  const filepath = path.join(dir, `${review.id}.json`);
  fs.writeFileSync(filepath, JSON.stringify(review, null, 2));

  audit({
    category: 'action',
    level: 'info',
    event: 'weekly_review_generated',
    actor: 'goal-review',
    details: {
      reviewId: review.id,
      weekOf,
      projectCount: projectProgress.length,
      totalTasks,
    },
  });

  return review;
}

/**
 * Get the latest weekly review.
 */
export function getLatestReview(): WeeklyReview | null {
  const dir = getReviewsPath();
  if (!fs.existsSync(dir)) return null;

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  if (files.length === 0) return null;

  // Sort by filename (which includes timestamp)
  files.sort().reverse();

  try {
    const content = fs.readFileSync(path.join(dir, files[0]), 'utf8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Get a specific review by ID.
 */
export function getReview(id: string): WeeklyReview | null {
  const dir = getReviewsPath();
  const filepath = path.join(dir, `${id}.json`);

  if (!fs.existsSync(filepath)) return null;

  try {
    return JSON.parse(fs.readFileSync(filepath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * List all reviews.
 */
export function listReviews(limit = 10): WeeklyReview[] {
  const dir = getReviewsPath();
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  files.sort().reverse(); // Newest first

  const reviews: WeeklyReview[] = [];
  for (const file of files.slice(0, limit)) {
    try {
      const content = fs.readFileSync(path.join(dir, file), 'utf8');
      reviews.push(JSON.parse(content));
    } catch {
      // Skip malformed files
    }
  }

  return reviews;
}

/**
 * Get review for a specific week.
 */
export function getReviewForWeek(weekOf: string): WeeklyReview | null {
  const reviews = listReviews(52); // Look back up to a year
  return reviews.find((r) => r.weekOf === weekOf) || null;
}

/**
 * Check if a review exists for the current week.
 */
export function hasCurrentWeekReview(): boolean {
  const weekOf = getWeekStart();
  return getReviewForWeek(weekOf) !== null;
}

/**
 * Get quick goal status summary (no LLM).
 */
export function getGoalSummary(): {
  activeProjects: number;
  totalTasks: number;
  completedTasks: number;
  blockedTasks: number;
  actionableTasks: number;
  progressPercent: number;
} {
  const projects = listProjects(false);
  const activeProjects = projects.filter((p) => p.status === 'active').length;

  const allTasks = listActiveTasks();
  const completedTasks = allTasks.filter((t) => t.status === 'done').length;
  const blockedTasks = allTasks.filter((t) => t.status === 'blocked').length;
  const actionable = getActionableTasks();

  const progressPercent =
    allTasks.length > 0 ? Math.round((completedTasks / allTasks.length) * 100) : 0;

  return {
    activeProjects,
    totalTasks: allTasks.length,
    completedTasks,
    blockedTasks,
    actionableTasks: actionable.length,
    progressPercent,
  };
}

/**
 * Delete a review.
 */
export function deleteReview(id: string): boolean {
  const dir = getReviewsPath();
  const filepath = path.join(dir, `${id}.json`);

  if (!fs.existsSync(filepath)) return false;

  try {
    fs.unlinkSync(filepath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Clean up old reviews (keep last N weeks).
 */
export function cleanupReviews(keepWeeks = 12): number {
  const dir = getReviewsPath();
  if (!fs.existsSync(dir)) return 0;

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  files.sort().reverse();

  let removed = 0;
  for (const file of files.slice(keepWeeks)) {
    try {
      fs.unlinkSync(path.join(dir, file));
      removed++;
    } catch {
      // Skip errors
    }
  }

  return removed;
}

// ============================================================================
// Export
// ============================================================================

export const goalReview = {
  generateWeeklyReview,
  getLatestReview,
  getReview,
  listReviews,
  getReviewForWeek,
  hasCurrentWeekReview,
  getGoalSummary,
  deleteReview,
  cleanupReviews,
};
