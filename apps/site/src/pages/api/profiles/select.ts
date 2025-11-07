import type { APIRoute } from 'astro';
import { getUserByUsername, listVisibleProfiles } from '@metahuman/core/users';
import { profileExists, copyPersonaToGuest } from '@metahuman/core/profile';
import { audit } from '@metahuman/core/audit';
import { getSession, updateSession } from '@metahuman/core/sessions';

/**
 * POST /api/profiles/select
 *
 * Sets the active profile for a guest session
 * Body: { "username": "greggles" }
 */
export const POST: APIRoute = async (context) => {
  try {
    const userContext = context.locals.userContext;

    // Only guests/anonymous can select profiles
    if (userContext?.role === 'owner') {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Owners cannot select guest profiles',
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const body = await context.request.json();
    const { username } = body;

    if (!username) {
      return new Response(
        JSON.stringify({ success: false, error: 'Username required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Easter egg: Handle "mutant-super-intelligence" profile
    if (username === 'mutant-super-intelligence') {
      // Get all public profiles
      const publicProfiles = listVisibleProfiles();

      if (publicProfiles.length < 2) {
        return new Response(
          JSON.stringify({ success: false, error: 'Insufficient public profiles for merger' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Create a special merged persona for mutant-super-intelligence
      const { createMutantSuperIntelligence } = await import('@metahuman/core/profile');
      await createMutantSuperIntelligence(publicProfiles.map(p => p.username));

      // Store all public profile usernames in session for memory merging
      const sessionCookie = context.cookies.get('mh_session');
      if (sessionCookie) {
        const session = getSession(sessionCookie.value);
        if (session) {
          session.metadata = session.metadata || {};
          session.metadata.activeProfile = 'guest';
          session.metadata.sourceProfile = 'mutant-super-intelligence';
          session.metadata.mergedProfiles = publicProfiles.map(p => p.username);
          updateSession(session);
        }
      }

      audit({
        level: 'info',
        category: 'security',
        event: 'mutant_super_intelligence_activated',
        actor: userContext?.username || 'anonymous',
        details: { mergedProfiles: publicProfiles.map(p => p.username) },
      });

      return new Response(
        JSON.stringify({
          success: true,
          profile: 'guest',
          sourceProfile: 'mutant-super-intelligence',
          merged: true,
          profiles: publicProfiles.map(p => p.username)
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Verify profile exists
    if (!profileExists(username)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Profile not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Verify profile is public
    const user = getUserByUsername(username);
    const visibility = user?.metadata?.profileVisibility || 'private';

    if (visibility !== 'public') {
      return new Response(
        JSON.stringify({ success: false, error: 'Profile is not public' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Copy persona data from selected profile to guest profile
    await copyPersonaToGuest(username);

    // Update session with guest profile (NOT the source profile)
    const sessionCookie = context.cookies.get('mh_session');
    if (sessionCookie) {
      const session = getSession(sessionCookie.value);
      if (session) {
        session.metadata = session.metadata || {};
        // Set activeProfile to 'guest' (the actual profile being used)
        session.metadata.activeProfile = 'guest';
        // Store source profile name for display purposes
        session.metadata.sourceProfile = username;
        updateSession(session);
      }
    }

    audit({
      level: 'info',
      category: 'security',
      event: 'guest_profile_selected',
      actor: userContext?.username || 'anonymous',
      details: {
        selectedProfile: username,
        activeProfile: 'guest',
        personaCopied: true
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        profile: 'guest',
        sourceProfile: username
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[profiles/select] Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: (error as Error).message || 'Failed to select profile',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
