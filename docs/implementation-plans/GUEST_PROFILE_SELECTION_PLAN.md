# Guest Profile Selection Feature - Implementation Plan

**Date:** 2025-11-06
**Status:** 📋 Planning Phase
**Priority:** High - Core multi-user feature

---

## Executive Summary

Enable guest users to browse and select **public** profiles, allowing them to interact with specific user personas in read-only emulation mode. Profile owners can control visibility (private or public) through system settings.

---

## Architecture Overview

### Current State
- "Continue as Guest" button doesn't create a session (just sets local flag)
- Anonymous users are forced into emulation mode by security policy
- Multi-user profile system exists (`profiles/{username}/`) but no UI for selection
- User data stored in `persona/users.json` (global database)

### Goal Architecture
- Guest users can browse and select public profiles
- Selected profile determines which persona data they interact with
- Guests remain in emulation mode (read-only, no operator, no memory writes)
- Profile owners can set visibility: private or public (friends = future scope)

### Security Boundaries
✅ **Already Enforced:**
- Guests CANNOT switch cognitive modes (forced emulation)
- Guests CANNOT write memories (security-policy.ts:123)
- Guests CANNOT access operator (emulation mode restriction)
- Mode switching owner-only (security-policy.ts:129)

⚠️ **Needs Implementation:**
- Profile visibility field on users (private/public) with safe defaults
- Session tracking of the selected profile
- Context resolution that honours the selected profile but still applies guest security rules
- Public profile warnings in UI and settings

---

## Phase 1: Backend - User Schema & Profile Visibility

### 1.1 Update User Schema
**File:** `packages/core/src/users.ts`

**Changes:**
```typescript
// Add to User interface metadata (line 20-30)
export interface User {
  id: string;
  username: string;
  passwordHash: string;
  role: 'owner' | 'guest';
  metadata?: {
    displayName?: string;
    email?: string;
    profileVisibility?: 'private' | 'public'; // NEW
  };
  createdAt: string;
  lastLogin?: string;
}

// Add helper functions
export function listVisibleProfiles(): User[] {
  const store = loadUsers();
  return store.users.filter(u => u.metadata?.profileVisibility === 'public');
}

export function updateProfileVisibility(
  userId: string,
  visibility: 'private' | 'public'
): boolean {
  const store = loadUsers();
  const user = store.users.find(u => u.id === userId);
  if (!user) return false;

  user.metadata = user.metadata || {};
  user.metadata.profileVisibility = visibility;

  saveUsers(store);
  audit({
    level: 'info',
    category: 'security',
    event: 'profile_visibility_changed',
    actor: user.username,
    details: { userId, visibility }
  });

  return true;
}
```

**Default Behavior:**
- New users default to `'private'`
- Existing users without the field are treated as `'private'` (backward compatibility)

---

### 1.2 Create Guest Session API
**File:** `apps/site/src/pages/api/auth/guest.ts` (NEW)

**Purpose:** Create anonymous session when "Continue as Guest" is clicked

```typescript
import type { APIRoute } from 'astro';
import { createSession } from '@metahuman/core/sessions';
import { audit } from '@metahuman/core/audit';

/**
 * POST /api/auth/guest
 *
 * Creates an anonymous session for guest browsing
 */
export const POST: APIRoute = async (context) => {
  try {
    // Create anonymous session (30 min expiry)
    const session = createSession('anonymous', 'anonymous');

    // Set session cookie
    context.cookies.set('mh_session', session.id, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
      maxAge: 30 * 60, // 30 minutes
    });

    audit({
      level: 'info',
      category: 'security',
      event: 'guest_session_created',
      actor: 'anonymous',
      details: { sessionId: session.id }
    });

    return new Response(
      JSON.stringify({
        success: true,
        session: {
          id: session.id,
          role: 'anonymous',
          expiresAt: session.expiresAt
        }
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    console.error('[auth/guest] Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: (error as Error).message || 'Failed to create guest session'
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
};
```

---

### 1.3 Create Profile List API
**File:** `apps/site/src/pages/api/profiles/list.ts` (NEW)

**Purpose:** Return profiles based on visitor type

```typescript
import type { APIRoute } from 'astro';
import { listVisibleProfiles, getUsers } from '@metahuman/core/users';
import { getUserContext } from '@metahuman/core/context';
import { getSecurityPolicy } from '@metahuman/core/security-policy';
import { withUserContext } from '../../middleware/userContext';

/**
 * GET /api/profiles/list
 *
 * Visibility rules:
 * - Anonymous guests → public profiles only
 * - Authenticated guests → public profiles only (friends = future scope)
 * - Owners/admins → all profiles (for moderation/support tasks)
 */
const handler: APIRoute = async (context) => {
  try {
    const policy = getSecurityPolicy(context);
    const userContext = getUserContext();

    const canSeeAll = userContext?.role === 'owner' && policy.canAccessAllProfiles;
    const profiles = canSeeAll ? getUsers() : listVisibleProfiles();

    const formatted = profiles.map(u => ({
      username: u.username,
      displayName: u.metadata?.displayName || u.username,
      visibility: u.metadata?.profileVisibility || 'private',
      role: u.role,
    }));

    return new Response(
      JSON.stringify({ success: true, profiles: formatted }),
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

export const GET = withUserContext(handler);
```

---

### 1.4 Create Profile Selection API
**File:** `apps/site/src/pages/api/profiles/select.ts` (NEW)

**Purpose:** Set active profile for guest session

```typescript
import type { APIRoute } from 'astro';
import { getSession, updateSession } from '@metahuman/core/sessions';
import { getUserByUsername } from '@metahuman/core/users';
import { profileExists } from '@metahuman/core/profile';
import { audit } from '@metahuman/core/audit';
import { getUserContext } from '@metahuman/core/context';
import { withUserContext } from '../../middleware/userContext';

/**
 * POST /api/profiles/select
 *
 * Sets the active profile for a guest session
 * Body: { "username": "greggles" }
 */
const handler: APIRoute = async (context) => {
  try {
    const policy = getSecurityPolicy(context);
    const userContext = getUserContext();

    // Only guests/anonymous can select profiles
    if (userContext?.role === 'owner') {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Owners cannot select guest profiles'
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

    // Update session with active profile
    const sessionCookie = context.cookies.get('mh_session');
    if (sessionCookie) {
      const session = getSession(sessionCookie.value);
      if (session) {
        session.metadata = session.metadata || {};
        session.metadata.activeProfile = username;
        updateSession(session);
      }
    }

    audit({
      level: 'info',
      category: 'security',
      event: 'guest_profile_selected',
      actor: userContext?.username || 'anonymous',
      details: { selectedProfile: username }
    });

    return new Response(
      JSON.stringify({ success: true, profile: username }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[profiles/select] Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: (error as Error).message || 'Failed to select profile'
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

export const POST = withUserContext(handler);
```

---

### 1.5 Create Profile Visibility API
**File:** `apps/site/src/pages/api/profiles/visibility.ts` (NEW)

**Purpose:** Update profile visibility (owner only)

```typescript
import type { APIRoute } from 'astro';
import { updateProfileVisibility } from '@metahuman/core/users';
import { getUserContext } from '@metahuman/core/context';
import { withUserContext } from '../../middleware/userContext';

/**
 * POST /api/profiles/visibility
 *
 * Updates the current user's profile visibility
 * Body: { "visibility": "public" | "private" }
 */
const handler: APIRoute = async (context) => {
  try {
    const userContext = getUserContext();

    if (!userContext || userContext.role === 'anonymous') {
      return new Response(
        JSON.stringify({ success: false, error: 'Authentication required' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const body = await context.request.json();
    const { visibility } = body;

    if (!['private', 'public'].includes(visibility)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid visibility value (private|public)' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const updated = updateProfileVisibility(userContext.userId, visibility);

    if (!updated) {
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to update visibility' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, visibility }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[profiles/visibility] Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: (error as Error).message || 'Failed to update visibility'
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

export const POST = withUserContext(handler);
```

---

## Phase 2: Frontend - Profile Selection UI

### 2.1 Fix Guest Button in AuthGate
**File:** `apps/site/src/components/AuthGate.svelte`

**Current (line 119):**
```typescript
function continueAsGuest() {
  isGuest = true; // Just sets local flag - BROKEN
}
```

**New Implementation:**
```typescript
let showProfileSelector = false;
let guestSessionError = '';

async function continueAsGuest() {
  try {
    guestSessionError = '';
    const res = await fetch('/api/auth/guest', { method: 'POST' });
    const data = await res.json();

    if (data.success) {
      showProfileSelector = true; // Show profile selector modal
    } else {
      guestSessionError = data.error || 'Failed to create guest session';
    }
  } catch (err) {
    console.error('[AuthGate] Guest session error:', err);
    guestSessionError = 'Network error. Please try again.';
  }
}
```

---

### 2.2 Create Profile Selector Component
**File:** `apps/site/src/components/ProfileSelector.svelte` (NEW)

**Features:**
- Modal overlay (similar to AuthGate design)
- Display public profiles as cards with avatar + display name
- Click card → select profile and navigate to main app
- "No public profiles available" fallback message
- Cancel button → return to login splash

**Full Implementation:**

```svelte
<script lang="ts">
  import { onMount } from 'svelte';

  export let onSelect: (username: string) => void;
  export let onCancel: () => void;

  interface Profile {
    username: string;
    displayName: string;
  visibility: 'private' | 'public';
    role: 'owner' | 'guest' | 'anonymous';
  }

  let profiles: Profile[] = [];
  let loading = true;
  let error = '';
  let selecting = false;

  onMount(async () => {
    await fetchProfiles();
  });

  async function fetchProfiles() {
    try {
      const res = await fetch('/api/profiles/list');
      const data = await res.json();

      if (data.success) {
        profiles = data.profiles;
      } else {
        error = data.error || 'Failed to load profiles';
      }
    } catch (err) {
      console.error('[ProfileSelector] Error:', err);
      error = 'Network error. Please try again.';
    } finally {
      loading = false;
    }
  }

  async function selectProfile(username: string) {
    if (selecting) return;
    selecting = true;
    error = '';

    try {
      const res = await fetch('/api/profiles/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username })
      });

      const data = await res.json();

      if (data.success) {
        onSelect(username);
        window.location.href = '/'; // Navigate to main app
      } else {
        error = data.error || 'Failed to select profile';
        selecting = false;
      }
    } catch (err) {
      console.error('[ProfileSelector] Select error:', err);
      error = 'Network error. Please try again.';
      selecting = false;
    }
  }

  function getInitials(name: string): string {
    return name
      .split(' ')
      .map(word => word[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }
</script>

<div class="modal-overlay">
  <div class="modal-container">
    <div class="modal-header">
      <h2>Select a Profile</h2>
      <p>Choose a public profile to explore</p>
    </div>

    {#if loading}
      <div class="loading-state">
        <div class="spinner"></div>
        <p>Loading profiles...</p>
      </div>
    {:else if error}
      <div class="error-banner">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path
            d="M8 1L1 14h14L8 1z"
            stroke="currentColor"
            stroke-width="2"
            stroke-linejoin="round"
          />
          <path d="M8 6v3M8 11v1" stroke="currentColor" stroke-width="2" />
        </svg>
        <span>{error}</span>
      </div>
    {:else if profiles.length === 0}
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
          <path
            d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"
            fill="currentColor"
          />
        </svg>
        <h3>No Public Profiles</h3>
        <p>There are currently no public profiles available to explore.</p>
      </div>
    {:else}
      <div class="profiles-grid">
        {#each profiles as profile}
          <button
            class="profile-card"
            on:click={() => selectProfile(profile.username)}
            disabled={selecting}
          >
            <div class="profile-avatar">
              {getInitials(profile.displayName)}
            </div>
            <div class="profile-info">
              <div class="profile-name">{profile.displayName}</div>
              <div class="profile-username">@{profile.username}</div>
              <div class="profile-badge public">Public</div>
            </div>
          </button>
        {/each}
      </div>
    {/if}

    <div class="modal-actions">
      <button class="cancel-button" on:click={onCancel} disabled={selecting}>
        Back to Login
      </button>
    </div>
  </div>
</div>

<style>
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.85);
    backdrop-filter: blur(8px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    padding: 2rem;
  }

  .modal-container {
    background: rgba(26, 26, 46, 0.95);
    border: 1px solid rgba(233, 69, 96, 0.3);
    border-radius: 16px;
    padding: 2.5rem;
    max-width: 600px;
    width: 100%;
    max-height: 80vh;
    overflow-y: auto;
    box-shadow: 0 8px 32px rgba(233, 69, 96, 0.2);
  }

  .modal-header {
    text-align: center;
    margin-bottom: 2rem;
  }

  .modal-header h2 {
    color: #e94560;
    font-size: 1.75rem;
    font-weight: 700;
    margin: 0 0 0.5rem 0;
  }

  .modal-header p {
    color: rgba(255, 255, 255, 0.6);
    font-size: 0.9rem;
    margin: 0;
  }

  .loading-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    padding: 3rem 0;
    color: rgba(255, 255, 255, 0.6);
  }

  .spinner {
    width: 40px;
    height: 40px;
    border: 3px solid rgba(255, 255, 255, 0.1);
    border-top-color: #e94560;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .error-banner {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 1rem;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: 8px;
    color: #ef4444;
    font-size: 0.9rem;
    margin-bottom: 1rem;
  }

  .error-banner svg {
    flex-shrink: 0;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    padding: 3rem 0;
    text-align: center;
    color: rgba(255, 255, 255, 0.6);
  }

  .empty-state svg {
    opacity: 0.4;
  }

  .empty-state h3 {
    color: rgba(255, 255, 255, 0.8);
    font-size: 1.25rem;
    margin: 0;
  }

  .empty-state p {
    font-size: 0.9rem;
    max-width: 300px;
    margin: 0;
  }

  .profiles-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
    gap: 1rem;
    margin-bottom: 2rem;
  }

  .profile-card {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1.25rem;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    cursor: pointer;
    transition: all 0.2s;
    text-align: left;
  }

  .profile-card:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.08);
    border-color: #e94560;
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(233, 69, 96, 0.2);
  }

  .profile-card:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .profile-avatar {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: linear-gradient(135deg, #e94560 0%, #d63651 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-size: 1rem;
    color: #fff;
    flex-shrink: 0;
  }

  .profile-info {
    flex: 1;
    min-width: 0;
  }

  .profile-name {
    color: #fff;
    font-weight: 600;
    font-size: 1rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin-bottom: 0.25rem;
  }

  .profile-username {
    color: rgba(255, 255, 255, 0.5);
    font-size: 0.875rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin-bottom: 0.5rem;
  }

  .profile-badge {
    display: inline-block;
    padding: 0.125rem 0.5rem;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
  }

  .profile-badge.public {
    background: rgba(34, 197, 94, 0.2);
    color: #22c55e;
    border: 1px solid rgba(34, 197, 94, 0.3);
  }

  .modal-actions {
    display: flex;
    justify-content: center;
    gap: 1rem;
    margin-top: 1.5rem;
  }

  .cancel-button {
    padding: 0.75rem 1.5rem;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    color: rgba(255, 255, 255, 0.8);
    font-size: 0.9rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }

  .cancel-button:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.2);
    color: #fff;
  }

  .cancel-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
```

---

### 2.3 Update AuthGate to Show Profile Selector
**File:** `apps/site/src/components/AuthGate.svelte`

**Add import (line 2):**
```typescript
import ProfileSelector from './ProfileSelector.svelte';
```

**Add after the splash container (line ~200):**
```svelte
{#if showProfileSelector}
  <ProfileSelector
    onSelect={(username) => {
      console.log('[AuthGate] Profile selected:', username);
      // Navigation handled by ProfileSelector
    }}
    onCancel={() => {
      showProfileSelector = false;
      guestSessionError = '';
    }}
  />
{/if}
```

---

## Phase 3: Settings - Profile Visibility Controls

### 3.1 Add System Menu to LeftSidebar
**File:** `apps/site/src/components/LeftSidebar.svelte`

**Add after line 570 (in menu items section):**
```svelte
<button
  class="menu-item"
  class:active={activeView === 'system'}
  on:click={() => navigateTo('system')}
  title="System Settings"
>
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
    <path
      d="M10 6a4 4 0 100 8 4 4 0 000-8zM8 10a2 2 0 114 0 2 2 0 01-4 0z"
      fill="currentColor"
    />
    <path
      d="M10 2c-.6 0-1.1.4-1.3 1-.2.6-.8 1-1.4 1-.7 0-1.3-.6-1.3-1.3-.4-.6-1-1-1.7-.7-.6.2-1 .8-.9 1.4.1.7-.3 1.3-1 1.5-.6.2-1.1.7-1.1 1.4 0 .6.4 1.1 1 1.3.7.2 1.1.8 1 1.5-.1.7.3 1.2.9 1.4.6.2 1.3-.1 1.7-.7 0-.7.6-1.3 1.3-1.3.6 0 1.2.4 1.4 1 .2.6.7 1 1.3 1 .6 0 1.1-.4 1.3-1 .2-.6.8-1 1.4-1 .7 0 1.3.6 1.3 1.3.4.6 1 1 1.7.7.6-.2 1-.8.9-1.4-.1-.7.3-1.3 1-1.5.6-.2 1.1-.7 1.1-1.4 0-.6-.4-1.1-1-1.3-.7-.2-1.1-.8-1-1.5.1-.7-.3-1.2-.9-1.4-.6-.2-1.3.1-1.7.7 0 .7-.6 1.3-1.3 1.3-.6 0-1.2-.4-1.4-1C11.1 2.4 10.6 2 10 2z"
      fill="currentColor"
    />
  </svg>
  <span>System</span>
  {#if profileVisibility === 'public'}
    <span class="badge public">Public</span>
  {/if}
</button>
```

**Add to script section:**
```typescript
let profileVisibility: 'private' | 'public' = 'private';

async function fetchProfileVisibility() {
  try {
    const res = await fetch('/api/profiles/visibility');
    if (res.ok) {
      const data = await res.json();
      profileVisibility = data.visibility || 'private';
    }
  } catch (e) {
    console.error('Failed to fetch profile visibility:', e);
  }
}

onMount(() => {
  // ... existing code
  fetchProfileVisibility();
});
```

**Add to styles:**
```css
.badge {
  padding: 0.125rem 0.375rem;
  border-radius: 4px;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  margin-left: auto;
}

.badge.public {
  background: rgba(34, 197, 94, 0.2);
  color: #22c55e;
}

```

---

### 3.2 Update SecuritySettings Component
**File:** `apps/site/src/components/SecuritySettings.svelte`

**Add to script section:**
```typescript
let profileVisibility: 'private' | 'public' = 'private';
let savingVisibility = false;

async function fetchVisibility() {
  try {
    const res = await fetch('/api/profiles/visibility');
    if (res.ok) {
      const data = await res.json();
      profileVisibility = data.visibility || 'private';
    }
  } catch (e) {
    console.error('Failed to fetch visibility:', e);
  }
}

async function saveVisibility() {
  if (savingVisibility) return;
  savingVisibility = true;

  try {
    const res = await fetch('/api/profiles/visibility', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visibility: profileVisibility })
    });

    const data = await res.json();
    if (!data.success) {
      console.error('Failed to update visibility:', data.error);
    }
  } catch (err) {
    console.error('Failed to save visibility:', err);
  } finally {
    savingVisibility = false;
  }
}

onMount(() => {
  fetchVisibility();
});
```

**Add to template (after existing security settings):**
```svelte
<div class="setting-section">
  <h3>Profile Visibility</h3>
  <p class="setting-description">
    Control who can view your profile as a guest user
  </p>

  <div class="setting-control">
    <select
      bind:value={profileVisibility}
      on:change={saveVisibility}
      disabled={savingVisibility}
      class="visibility-select"
    >
      <option value="private">🔒 Private - Owner only</option>
      <option value="public">🌍 Public - Anyone (including anonymous)</option>
    </select>
  </div>

  {#if profileVisibility === 'public'}
    <div class="warning-box">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path
          d="M8 1L1 14h14L8 1z"
          stroke="currentColor"
          stroke-width="2"
          stroke-linejoin="round"
        />
        <path d="M8 6v3M8 11v1" stroke="currentColor" stroke-width="2" />
      </svg>
      <div>
        <strong>Public Profile Warning</strong>
        <p>
          Guest users will be able to interact with your persona in read-only
          emulation mode. They cannot modify your data or access private information.
        </p>
      </div>
    </div>
  {/if}

</div>
```

**Add styles:**
```css
.setting-section {
  margin-bottom: 2rem;
  padding-bottom: 2rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.setting-section:last-child {
  border-bottom: none;
  margin-bottom: 0;
  padding-bottom: 0;
}

.setting-section h3 {
  color: #e94560;
  font-size: 1.1rem;
  margin: 0 0 0.5rem 0;
}

.setting-description {
  color: rgba(255, 255, 255, 0.6);
  font-size: 0.9rem;
  margin: 0 0 1rem 0;
}

.setting-control {
  margin-bottom: 1rem;
}

.visibility-select {
  width: 100%;
  padding: 0.75rem 1rem;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: #fff;
  font-size: 0.95rem;
  cursor: pointer;
  transition: all 0.2s;
}

.visibility-select:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.2);
}

.visibility-select:focus {
  outline: none;
  border-color: #e94560;
}

.visibility-select:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.warning-box {
  display: flex;
  gap: 0.75rem;
  padding: 1rem;
  background: rgba(245, 158, 11, 0.1);
  border: 1px solid rgba(245, 158, 11, 0.3);
  border-radius: 8px;
  color: #f59e0b;
  font-size: 0.85rem;
}

.warning-box svg {
  flex-shrink: 0;
  margin-top: 0.125rem;
}

.warning-box strong {
  display: block;
  margin-bottom: 0.25rem;
}

.warning-box p {
  margin: 0;
  opacity: 0.9;
}

.info-box {
  display: flex;
  gap: 0.75rem;
  padding: 1rem;
  background: rgba(59, 130, 246, 0.1);
  border: 1px solid rgba(59, 130, 246, 0.3);
  border-radius: 8px;
  color: #3b82f6;
  font-size: 0.85rem;
}

.info-box svg {
  flex-shrink: 0;
  margin-top: 0.125rem;
}

.info-box strong {
  display: block;
  margin-bottom: 0.25rem;
}

.info-box p {
  margin: 0;
  opacity: 0.9;
}
```

---

## Phase 4: Security & Middleware Updates

### 4.1 Update Session Interface
**File:** `packages/core/src/sessions.ts`

**Add to Session interface:**
```typescript
export interface Session {
  id: string;
  userId: string;
  username: string;
  role: 'owner' | 'guest' | 'anonymous';
  createdAt: string;
  expiresAt: string;
  metadata?: {
    activeProfile?: string;  // NEW: Selected profile for guest users
    [key: string]: any;
  };
}
```

**Add helper functions:**
```typescript
export function getActiveProfile(sessionId: string): string | null {
  const session = getSession(sessionId);
  return session?.metadata?.activeProfile || null;
}

export function setActiveProfile(sessionId: string, username: string): boolean {
  const session = getSession(sessionId);
  if (!session) return false;

  session.metadata = session.metadata || {};
  session.metadata.activeProfile = username;

  updateSession(session);
  return true;
}
```

---

### 4.2 Update Context Resolution
**File:** `packages/core/src/context.ts`

**Enhancements:**
1. Extend `UserContext` to include an optional `profileOverride?: string`.
2. When `withUserContext` runs, look up the current session via `getSession(sessionId)` and, if `metadata.activeProfile` is set, populate `profileOverride`.
3. In `getUserContext()`, if `profileOverride` is present and the user is not an owner, return `getProfilePaths(profileOverride)` for `profilePaths`. Always fall back to the user’s own profile otherwise.

```typescript
interface UserContext {
  userId: string;
  username: string;
  role: 'owner' | 'guest' | 'anonymous';
  profilePaths: ReturnType<typeof getProfilePaths>;
  profileOverride?: string; // NEW
}

export function withUserContext<T>(sessionInfo: SessionInfo, fn: () => T | Promise<T>) {
  const activeProfile = sessionInfo.metadata?.activeProfile;
  const profileUser = activeProfile && sessionInfo.role !== 'owner'
    ? activeProfile
    : sessionInfo.username;

  const context: UserContext = {
    userId: sessionInfo.userId,
    username: sessionInfo.username,
    role: sessionInfo.role,
    profilePaths: getProfilePaths(profileUser),
    profileOverride: activeProfile,
  };

  return asyncLocalStorage.run(context, fn);
}
```

> **Revalidation:** `withUserContext` must look up the selected profile on every request. If the profile no longer exists or is no longer public, clear `activeProfile` from the session and run with the anonymous context instead (returning a 410/401 so the UI can prompt the guest to choose another profile).

---

### 4.3 Add Profile Visibility Endpoint (GET)
**File:** `apps/site/src/pages/api/profiles/visibility.ts`

**Add GET handler:**
```typescript
const getHandler: APIRoute = async (context) => {
  try {
    const userContext = context.locals.userContext;

    if (!userContext || userContext.role === 'anonymous') {
      return new Response(
        JSON.stringify({ success: false, error: 'Authentication required' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const user = getUserById(userContext.userId);
    const visibility = user?.metadata?.profileVisibility || 'private';

    return new Response(
      JSON.stringify({ success: true, visibility }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[profiles/visibility] GET error:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Failed to get visibility' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

export const GET = withUserContext(getHandler);
// POST handler already defined above
```

---

## Implementation Timeline

### **Stage 1: Core Infrastructure** (30-45 minutes)
- [ ] Update User schema with `profileVisibility` field
- [ ] Add `listVisibleProfiles()` and `updateProfileVisibility()` functions
- [ ] Create `/api/auth/guest` endpoint
- [ ] Create `/api/profiles/list` endpoint
- [ ] Create `/api/profiles/select` endpoint
- [ ] Create `/api/profiles/visibility` endpoint (GET + POST)
- [ ] Update Session interface with `activeProfile` metadata
- [ ] Update context resolution to use active profile
- [ ] Update `withUserContext` middleware to load sessions and revalidate active profiles

### **Stage 2: Profile Selection UI** (45-60 minutes)
- [ ] Create `ProfileSelector.svelte` component
- [ ] Update `AuthGate.svelte` to fix guest button
- [ ] Wire up profile selection flow
- [ ] Add error handling and loading states
- [ ] Test guest session creation
- [ ] Test profile selection flow

### **Stage 3: Settings UI** (30-45 minutes)
- [ ] Add system menu item to `LeftSidebar.svelte`
- [ ] Add profile visibility badge to sidebar
- [ ] Update `SecuritySettings.svelte` with visibility controls
- [ ] Add warning/info boxes for visibility states
- [ ] Test visibility updates
- [ ] Verify badge updates in real-time

### **Stage 4: Testing & Polish** (30 minutes)
- [ ] Test end-to-end guest flow (anonymous → select public profile → chat)
- [ ] Verify emulation mode enforcement (no writes, no operator)
- [ ] Test profile isolation (guests can't access other profiles)
- [ ] Test visibility changes (private ↔ public)
- [ ] Error handling edge cases
- [ ] Add loading states and transitions
- [ ] Update CLAUDE.md with new feature documentation

**Total Estimated Time:** 2-3 hours

---

## Testing Checklist

### Backend Tests
- [ ] User schema accepts profileVisibility field
- [ ] listVisibleProfiles() filters correctly
- [ ] updateProfileVisibility() updates and audits
- [ ] /api/auth/guest creates anonymous session
- [ ] /api/profiles/list filters by role (anonymous/guest/owner)
- [ ] /api/profiles/select validates visibility
- [ ] /api/profiles/select blocks private profiles
- [ ] /api/profiles/visibility requires authentication
- [ ] Session metadata stores activeProfile

### Frontend Tests
- [ ] "Continue as Guest" creates session
- [ ] ProfileSelector displays public profiles
- [ ] ProfileSelector displays empty state
- [ ] Profile cards show correct public badge
- [ ] Clicking profile selects and navigates
- [ ] Cancel button returns to login
- [ ] Visibility selector updates in settings
- [ ] Sidebar badge shows current visibility
- [ ] Warning boxes display for public profiles

### Security Tests
- [ ] Anonymous users see only public profiles
- [ ] Anonymous users cannot select private profiles
- [ ] Guest users see only public profiles
- [ ] Guests are forced into emulation mode
- [ ] Guests cannot write memories
- [ ] Guests cannot access operator
- [ ] Guests cannot switch cognitive modes
- [ ] Profile paths resolve to selected profile
- [ ] Visibility changes invalidate stale selections
- [ ] No cross-profile data leakage

### Edge Cases
- [ ] No public profiles available → show empty state
- [ ] Network errors → show error message
- [ ] Invalid profile selection → show error
- [ ] Session expiry → redirect to login
- [ ] Profile deleted after selection → graceful failure
- [ ] Visibility change while guest viewing → no crash

---

## Security Audit

### ✅ Already Enforced (No Changes Needed)
- Emulation mode forced for anonymous users (security-policy.ts:381)
- Memory writes blocked for guests (security-policy.ts:123)
- Operator disabled in emulation mode (cognitive-mode.ts)
- Mode switching owner-only (security-policy.ts:129)

### ⚠️ New Security Considerations
1. **Profile Visibility Filtering**
   - API must filter profiles by visibility level
   - Anonymous users → public only
   - Authenticated guests → public only (friends visibility reserved for future feature)

2. **Profile Selection Validation**
   - Must verify profile exists before selection
   - Must verify profile visibility matches user role
   - Must prevent owner profiles from being selected as guests

3. **Session Isolation**
   - Active profile stored in session metadata
   - Context resolution uses active profile for path mapping
   - Revalidate active profile visibility on every request (auto-clear if profile becomes private)
   - No cross-profile access possible

4. **Audit Trail**
   - Log guest session creation
   - Log profile selection
   - Log visibility changes
   - Track guest activity per profile

---

## File Summary

### New Files to Create (7)
1. `apps/site/src/pages/api/auth/guest.ts` - Guest session creation
2. `apps/site/src/pages/api/profiles/list.ts` - List visible profiles
3. `apps/site/src/pages/api/profiles/select.ts` - Select active profile
4. `apps/site/src/pages/api/profiles/visibility.ts` - Update visibility settings
5. `apps/site/src/components/ProfileSelector.svelte` - Profile selection modal

### Files to Modify (7)
1. `packages/core/src/users.ts` - Add profileVisibility field and helpers
2. `packages/core/src/sessions.ts` - Add activeProfile metadata
3. `packages/core/src/context.ts` - Update path resolution for active profile
4. `apps/site/src/components/AuthGate.svelte` - Fix guest button and add selector
5. `apps/site/src/components/LeftSidebar.svelte` - Add system menu and badge
6. `apps/site/src/components/SecuritySettings.svelte` - Add visibility controls
7. `apps/site/src/middleware/userContext.ts` - Resolve sessions and set profile overrides

---

## Success Criteria

**Feature is complete when:**
1. ✅ Guest users can create anonymous sessions
2. ✅ Guest users see a profile selector after clicking "Continue as Guest"
3. ✅ Profile selector displays public profiles to guests (private profiles are hidden)
4. ✅ Guest users can select a profile and navigate to main app
5. ✅ Selected profile determines which persona data is loaded
6. ✅ Guests remain in emulation mode (read-only, no operator)
7. ✅ Guest conversations are not persisted to memory (existing write guards enforced)
8. ✅ Profile owners can set visibility (private/public)
9. ✅ Visibility settings appear in system settings
10. ✅ Sidebar shows profile visibility badge
11. ✅ All security boundaries enforced (no writes, no mode switching)

---

## Future Enhancements (Out of Scope)

- **Profile Search/Filter** - Search profiles by name
- **Profile Preview** - View profile info before selecting
- **Profile Ratings** - Community ratings for public profiles
- **Profile Categories** - Tag profiles (educator, creative, technical, etc.)
- **Guest Activity Limits** - Rate limiting for guest interactions
- **Profile Analytics** - Track how many guests viewed your profile
- **Friends System** - Manage friend requests for friends visibility
- **Profile Customization** - Custom profile descriptions and avatars

---

## Questions for User

1. **Default Visibility:** Should new users default to `private` or allow them to choose during registration?
2. **Anonymous Sessions:** 30-minute expiry acceptable for anonymous guests?
3. **Profile Selection Persistence:** Should selected profile persist across sessions (cookie)?
4. **Owner Profile:** Should owner's profile appear in public list, or always private?
5. **Multiple Profiles:** In the future, should one user be able to create multiple public profiles?

---

**Last Updated:** 2025-11-06
**Author:** Claude (AI Agent)
**Review Status:** Pending User Review
