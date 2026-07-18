<script lang="ts">
  import { onMount } from 'svelte';
  import { apiFetch } from '../lib/client/api-config';

  interface Profile {
    username: string;
    displayName: string;
    visibility: 'private' | 'public';
    role: 'owner' | 'standard' | 'guest';
  }

  interface CurrentUser {
    username: string;
    role: string;
  }

  let profiles: Profile[] = [];
  let currentUser: CurrentUser | null = null;
  let loading = true;
  let error = '';
  let success = '';

  // Export function so parent can trigger refresh
  export async function refreshProfiles() {
    await loadProfiles();
  }

  // Deletion modal state
  let showDeleteModal = false;
  let profileToDelete: Profile | null = null;
  let confirmUsername = '';
  let deleting = false;

  onMount(async () => {
    await loadCurrentUser();
    await loadProfiles();
  });

  async function loadCurrentUser() {
    try {
      const response = await apiFetch('/api/auth/me');
      const data = await response.json();

      if (data.success && data.user) {
        currentUser = {
          username: data.user.username,
          role: data.user.role,
        };
      }
    } catch (err) {
      console.error('Failed to load current user:', err);
    }
  }

  async function loadProfiles() {
    loading = true;
    error = '';

    try {
      const response = await apiFetch('/api/profiles/list');
      const data = await response.json();

      if (data.success) {
        // Filter out special profiles (mutant-super-intelligence)
        let fetchedProfiles: Profile[] = data.profiles.filter(
          (p: Profile) => p.username !== 'mutant-super-intelligence'
        );

        // Standard users should only ever see their own account
        if (currentUser?.role === 'standard' && currentUser.username) {
          fetchedProfiles = fetchedProfiles.filter(
            (p) => p.username === currentUser?.username
          );
        }

        profiles = fetchedProfiles;
      } else {
        error = data.error || 'Failed to load profiles';
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load profiles';
      console.error(err);
    } finally {
      loading = false;
    }
  }

  function openDeleteModal(profile: Profile) {
    profileToDelete = profile;
    confirmUsername = '';
    showDeleteModal = true;
    error = '';
    success = '';
  }

  function closeDeleteModal() {
    showDeleteModal = false;
    profileToDelete = null;
    confirmUsername = '';
  }

  async function handleDelete() {
    if (!profileToDelete) return;

    if (confirmUsername !== profileToDelete.username) {
      error = 'Confirmation username does not match';
      return;
    }

    deleting = true;
    error = '';
    success = '';

    try {
      const response = await apiFetch('/api/profiles/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: profileToDelete.username,
          confirmUsername,
        }),
      });

      const data = await response.json();

      if (data.success) {
        success = `Profile '${profileToDelete.username}' has been deleted successfully. ${data.details.sessionsDeleted} session(s) terminated.`;

        // If user deleted their own account, log them out after a brief delay
        const deletedSelf = profileToDelete.username === currentUser?.username;

        closeDeleteModal();

        if (deletedSelf) {
          // Show success message briefly, then redirect to splash/login
          setTimeout(() => {
            window.location.href = '/';
          }, 2000);
        } else {
          // Refresh profile list for the owner
          await loadProfiles();
        }
      } else {
        error = data.error || 'Failed to delete profile';
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to delete profile';
      console.error(err);
    } finally {
      deleting = false;
    }
  }

  function canDeleteProfile(profile: Profile): boolean {
    if (!currentUser) return false;

    // Owner can delete any non-owner, non-guest profiles (except their own)
    if (currentUser.role === 'owner') {
      if (profile.role === 'owner') return false;
      if (profile.username === currentUser.username) return false;
      if (profile.username === 'guest') return false;
      return true;
    }

    // Standard users can ONLY delete their own account
    if (currentUser.role === 'standard') {
      return profile.username === currentUser.username;
    }

    // Guests and anonymous cannot delete anything
    return false;
  }

  function getDeleteDisabledReason(profile: Profile): string {
    if (!currentUser) return 'Not authenticated';

    if (currentUser.role === 'owner') {
      if (profile.role === 'owner') return 'Cannot delete owner account';
      if (profile.username === currentUser.username) return 'Cannot delete your own account as owner';
      if (profile.username === 'guest') return 'Cannot delete guest profile';
    }

    if (currentUser.role === 'standard') {
      if (profile.username !== currentUser.username) return 'Can only delete your own account';
    }

    if (currentUser.role === 'guest') {
      return 'Guests cannot delete profiles';
    }

    return 'Not authorized';
  }
</script>

<div class="mt-8 p-6 border-2 border-red-600 rounded-lg bg-red-50 dark:bg-red-950 dark:border-red-800">
  <h2 class="m-0 mb-2 text-xl font-semibold text-red-600 dark:text-red-300">⚠️ Danger Zone</h2>
  <p class="m-0 mb-4 text-sm text-red-800 dark:text-red-300">
    {#if currentUser?.role === 'standard'}
      Delete your account and all associated data. This action is irreversible.
    {:else}
      Actions in this section are irreversible and permanently delete user data.
    {/if}
  </p>

  {#if loading}
    <div class="p-4 text-center text-gray-500">Loading profiles...</div>
  {:else if error && !success}
    <div class="p-3 mb-4 bg-red-100 dark:bg-red-900 border border-red-200 dark:border-red-800 rounded text-red-800 dark:text-red-200 text-sm">{error}</div>
  {/if}

  {#if success}
    <div class="p-3 mb-4 bg-green-100 dark:bg-green-900 border border-green-200 dark:border-green-700 rounded text-green-800 dark:text-green-200 text-sm">{success}</div>
  {/if}

  {#if !loading && profiles.length > 0}
    <div class="overflow-x-auto">
      <table class="w-full border-collapse bg-white dark:bg-gray-800 rounded">
        <thead>
          <tr>
            <th class="p-3 text-left bg-gray-50 dark:bg-gray-900 border-b-2 border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-300">Username</th>
            <th class="p-3 text-left bg-gray-50 dark:bg-gray-900 border-b-2 border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-300">Display Name</th>
            <th class="p-3 text-left bg-gray-50 dark:bg-gray-900 border-b-2 border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-300">Role</th>
            <th class="p-3 text-left bg-gray-50 dark:bg-gray-900 border-b-2 border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-300">Visibility</th>
            <th class="p-3 text-left bg-gray-50 dark:bg-gray-900 border-b-2 border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-300">Actions</th>
          </tr>
        </thead>
        <tbody>
          {#each profiles as profile, i}
            <tr>
              <td class="p-3 border-b border-gray-200 dark:border-gray-700 text-sm dark:text-gray-300 {i === profiles.length - 1 ? 'border-b-0' : ''}"><strong>{profile.username}</strong></td>
              <td class="p-3 border-b border-gray-200 dark:border-gray-700 text-sm dark:text-gray-300 {i === profiles.length - 1 ? 'border-b-0' : ''}">{profile.displayName}</td>
              <td class="p-3 border-b border-gray-200 dark:border-gray-700 text-sm {i === profiles.length - 1 ? 'border-b-0' : ''}">
                <span class="inline-block px-2 py-1 rounded text-xs font-semibold uppercase {profile.role === 'owner' ? 'bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200' : 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200'}">
                  {profile.role}
                </span>
              </td>
              <td class="p-3 border-b border-gray-200 dark:border-gray-700 text-sm {i === profiles.length - 1 ? 'border-b-0' : ''}">
                <span class="inline-block px-2 py-1 rounded text-xs font-semibold uppercase {profile.visibility === 'public' ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200' : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'}">
                  {profile.visibility}
                </span>
              </td>
              <td class="p-3 border-b border-gray-200 dark:border-gray-700 text-sm {i === profiles.length - 1 ? 'border-b-0' : ''}">
                {#if canDeleteProfile(profile)}
                  <button
                    class="px-3 py-1.5 bg-red-600 text-white border-none rounded text-sm cursor-pointer transition-colors hover:enabled:bg-red-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:text-gray-400 dark:disabled:text-gray-500 disabled:cursor-not-allowed"
                    on:click={() => openDeleteModal(profile)}
                  >
                    {profile.username === currentUser?.username ? 'Delete My Account' : 'Delete Profile'}
                  </button>
                {:else}
                  <button
                    class="px-3 py-1.5 bg-red-600 text-white border-none rounded text-sm cursor-pointer transition-colors hover:enabled:bg-red-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:text-gray-400 dark:disabled:text-gray-500 disabled:cursor-not-allowed"
                    disabled
                    title={getDeleteDisabledReason(profile)}
                  >
                    {profile.username === currentUser?.username ? 'Delete My Account' : 'Delete Profile'}
                  </button>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<!-- Delete Confirmation Modal -->
{#if showDeleteModal && profileToDelete}
  <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-[1000]" on:click={closeDeleteModal}>
    <div class="bg-white dark:bg-gray-800 dark:text-gray-300 rounded-lg p-6 max-w-[600px] w-[90%] max-h-[80vh] overflow-y-auto" on:click|stopPropagation>
      <h3 class="m-0 mb-4 text-xl font-semibold text-red-600 dark:text-red-300">⚠️ Delete Profile</h3>

      <p class="m-0 mb-4 text-sm">
        You are about to permanently delete the profile for <strong>{profileToDelete.username}</strong>.
      </p>

      <div class="p-4 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded mb-4">
        <p class="m-0 mb-2 text-sm font-semibold"><strong>This action will:</strong></p>
        <ul class="m-0 mb-2 pl-6 text-sm">
          <li class="mb-1">Terminate all active sessions for this user</li>
          <li class="mb-1">Remove the user account from the system</li>
          <li class="mb-1">Permanently delete the <code class="bg-red-100 dark:bg-red-900 px-1 py-0.5 rounded font-mono text-[0.8em]">profiles/{profileToDelete.username}/</code> directory</li>
          <li class="mb-1">Delete all memories, tasks, configurations, and persona data</li>
        </ul>
        <p class="mt-2 mb-0 text-red-600 dark:text-red-300 font-bold">⚠️ <strong>This action is irreversible</strong></p>
      </div>

      <div class="mb-4">
        <label for="confirm-username" class="block mb-2 text-sm font-semibold">
          Type <strong>{profileToDelete.username}</strong> to confirm:
        </label>
        <input
          id="confirm-username"
          type="text"
          bind:value={confirmUsername}
          placeholder="Enter username to confirm"
          disabled={deleting}
          class="w-full p-2 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:border-blue-500 focus:ring-[3px] focus:ring-blue-500/10"
        />
      </div>

      {#if error}
        <div class="p-3 mb-4 bg-red-100 dark:bg-red-900 border border-red-200 dark:border-red-800 rounded text-red-800 dark:text-red-200 text-sm">{error}</div>
      {/if}

      <div class="flex gap-3 justify-end">
        <button
          class="px-4 py-2 border-none rounded text-sm cursor-pointer transition-colors bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:enabled:bg-gray-300 dark:hover:enabled:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
          on:click={closeDeleteModal}
          disabled={deleting}
        >
          Cancel
        </button>
        <button
          class="px-4 py-2 border-none rounded text-sm cursor-pointer transition-colors bg-red-600 text-white hover:enabled:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
          on:click={handleDelete}
          disabled={deleting || confirmUsername !== profileToDelete.username}
        >
          {deleting ? 'Deleting...' : 'Delete Profile'}
        </button>
      </div>
    </div>
  </div>
{/if}
