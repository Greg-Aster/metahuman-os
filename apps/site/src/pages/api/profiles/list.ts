import type { APIRoute } from 'astro';
import { listVisibleProfiles, listUsers } from '@metahuman/core/users';

/**
 * GET /api/profiles/list
 *
 * Returns list of visible profiles based on user role:
 * - Anonymous/guests: Only public profiles
 * - Owners: All profiles (for administration)
 */
export const GET: APIRoute = async (context) => {
  try {
    const userContext = context.locals.userContext;

    // Determine if user can see all profiles (owner/admin only)
    const canSeeAll = userContext?.role === 'owner';

    // Get appropriate profile list
    const users = canSeeAll ? listUsers() : listVisibleProfiles();

    // Format for API response
    const profiles = users.map((u) => ({
      username: u.username,
      displayName: u.metadata?.displayName || u.username,
      visibility: u.metadata?.profileVisibility || 'private',
      role: u.role,
    }));

    // Easter egg: Add "Mutant Super Intelligence" profile if there are multiple public profiles
    const publicProfiles = profiles.filter(p => p.visibility === 'public');
    if (publicProfiles.length >= 2 && !canSeeAll) {
      profiles.unshift({
        username: 'mutant-super-intelligence',
        displayName: 'Mutant Super Intelligence',
        visibility: 'public' as const,
        role: 'guest' as const,
      });
    }

    return new Response(
      JSON.stringify({ success: true, profiles }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('[profiles/list] Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: (error as Error).message || 'Failed to list profiles',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
