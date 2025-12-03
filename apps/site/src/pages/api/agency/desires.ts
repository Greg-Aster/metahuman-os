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
  type Desire,
  type DesireStatus,
  generateDesireId,
} from '@metahuman/core';

/**
 * GET /api/agency/desires
 * Returns desires filtered by status
 * Query params:
 *   - status: 'nascent' | 'pending' | 'evaluating' | 'planning' | 'reviewing' | 'approved' | 'executing' | 'completed' | 'rejected' | 'abandoned' | 'failed' | 'all'
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
        'approved', 'executing', 'completed', 'rejected', 'abandoned', 'failed'
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
      return new Response(
        JSON.stringify({ error: 'Authentication required to create desires.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const body = await request.json();
    const { title, description, reason, risk = 'low', source = 'manual' } = body;

    if (!title || !description) {
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
      decayRate: 0.02, // Standard decay rate per hour
      reinforcements: 0,
      risk: risk as Desire['risk'],
      requiredTrustLevel: risk === 'high' || risk === 'critical' ? 'bounded_auto' : 'supervised_auto',
      createdAt: now,
      updatedAt: now,
      lastDecayAt: now,
    };

    await saveDesire(desire, user.username);

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

    return new Response(JSON.stringify({ desire, success: true }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

export const GET = getHandler;
export const POST = postHandler;
