import type { APIRoute } from 'astro';
import {
  getAuthenticatedUser,
  getUserOrAnonymous,
  audit,
} from '@metahuman/core';
import {
  listDesiresByStatus,
  listActiveDesires,
  listPendingDesires,
  saveDesire,
  createDesireFolder,
  saveDesireManifest,
  addScratchpadEntryToFolder,
  type Desire,
  type DesireStatus,
  generateDesireId,
  initializeDesireMetrics,
  initializeScratchpadSummary,
} from '@metahuman/core';

const LOG_PREFIX = '[API:agency/desires]';

/**
 * GET /api/agency/desires
 * Returns desires filtered by status
 * Query params:
 *   - status: 'nascent' | 'pending' | 'evaluating' | 'planning' | 'reviewing' | 'approved' | 'executing' | 'awaiting_review' | 'completed' | 'rejected' | 'abandoned' | 'failed' | 'all'
 */
const getHandler: APIRoute = async ({ cookies, request }) => {
  try {
    const user = getUserOrAnonymous(cookies);
    if (user.role === 'anonymous') {
      return new Response(
        JSON.stringify({ error: 'Authentication required to view desires.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const url = new URL(request.url);
    const status = url.searchParams.get('status') || 'all';

    let desires: Desire[];

    if (status === 'all') {
      // Get all desires across all statuses
      const statuses: DesireStatus[] = [
        'nascent', 'pending', 'evaluating', 'planning', 'reviewing',
        'approved', 'executing', 'awaiting_review', 'completed', 'rejected', 'abandoned', 'failed'
      ];
      desires = [];
      for (const s of statuses) {
        const d = await listDesiresByStatus(s, user.username);
        desires.push(...d);
      }
    } else if (status === 'active') {
      desires = await listActiveDesires(user.username);
    } else if (status === 'pending') {
      desires = await listPendingDesires(user.username);
    } else {
      desires = await listDesiresByStatus(status as DesireStatus, user.username);
    }

    // Sort by createdAt descending
    desires.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return new Response(JSON.stringify({ desires, count: desires.length }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

/**
 * POST /api/agency/desires
 * Create a new desire manually
 * Body: { title, description, reason, risk?, source? }
 */
const postHandler: APIRoute = async ({ cookies, request }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    if (!user) {
      console.log(`${LOG_PREFIX} ❌ Authentication required for POST`);
      return new Response(
        JSON.stringify({ error: 'Authentication required to create desires.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const body = await request.json();
    const { title, description, reason, risk = 'low', source = 'manual' } = body;

    console.log(`${LOG_PREFIX} ➕ Creating new desire: "${title}"`);

    if (!title || !description) {
      console.log(`${LOG_PREFIX} ❌ Missing required fields`);
      return new Response(
        JSON.stringify({ error: 'Missing required fields: title, description' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const now = new Date().toISOString();
    const desire: Desire = {
      id: generateDesireId(),
      title,
      description,
      reason: reason || 'User-created desire',
      source: source as Desire['source'],
      sourceId: `manual-${Date.now()}`,
      status: 'pending',
      strength: 0.8, // High initial strength for manual desires
      baseWeight: 1.0, // Manual desires get full weight
      threshold: 0.7, // Standard activation threshold
      decayRate: 0.03, // Standard decay rate per run
      lastReviewedAt: now,
      reinforcements: 0,
      runCount: 1,
      risk: risk as Desire['risk'],
      requiredTrustLevel: risk === 'high' || risk === 'critical' ? 'bounded_auto' : 'supervised_auto',
      metrics: initializeDesireMetrics(), // Initialize behavioral metrics
      scratchpad: initializeScratchpadSummary(), // Initialize scratchpad summary
      createdAt: now,
      updatedAt: now,
    };

    console.log(`${LOG_PREFIX}    ID: ${desire.id}`);
    console.log(`${LOG_PREFIX}    Risk: ${risk}, Source: ${source}`);
    console.log(`${LOG_PREFIX}    Saving to storage...`);

    // Save to flat-file storage (for backward compatibility)
    await saveDesire(desire, user.username);

    // Also create folder-based storage structure
    console.log(`${LOG_PREFIX}    Creating folder structure...`);
    await createDesireFolder(desire.id, user.username);
    await saveDesireManifest(desire, user.username);

    // Add initial scratchpad entry
    await addScratchpadEntryToFolder(desire.id, {
      timestamp: now,
      type: 'origin',
      description: `Desire "${title}" created manually by ${user.username}`,
      actor: 'user',
      data: {
        source,
        risk,
        initialStrength: desire.strength,
        username: user.username,
      },
    }, user.username);

    audit({
      category: 'agent',
      level: 'info',
      event: 'desire_created_manually',
      actor: user.username,
      details: {
        desireId: desire.id,
        title: desire.title,
      },
    });

    console.log(`${LOG_PREFIX} ✅ Desire created: "${desire.title}" (${desire.id})`);
    return new Response(JSON.stringify({ desire, success: true }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error(`${LOG_PREFIX} ❌ Error creating desire:`, error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

export const GET = getHandler;
export const POST = postHandler;
