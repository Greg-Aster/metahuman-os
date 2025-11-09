<script lang="ts">
  import { onMount } from 'svelte';

  interface Profile {
    username: string;
    displayName: string;
    visibility: 'private' | 'public';
    role: 'owner' | 'guest';
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
      const response = await fetch('/api/auth/me');
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
      const response = await fetch('/api/profiles/list');
      const data = await response.json();

      if (data.success) {
        // Filter out special profiles (mutant-super-intelligence)
        profiles = data.profiles.filter(
          (p: Profile) => p.username !== 'mutant-super-intelligence'
        );
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
      const response = await fetch('/api/profiles/delete', {
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
        closeDeleteModal();
        await loadProfiles(); // Refresh list
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
    if (profile.role === 'owner') return false;
    if (profile.username === currentUser.username) return false;
    if (profile.username === 'guest') return false;
    return true;
  }

  function getDeleteDisabledReason(profile: Profile): string {
    if (profile.role === 'owner') return 'Cannot delete owner account';
    if (profile.username === currentUser?.username) return 'Cannot delete your own account';
    if (profile.username === 'guest') return 'Cannot delete guest profile';
    return '';
  }
</script>

<div class="danger-zone">
  <h2>⚠️ Danger Zone</h2>
  <p class="warning-text">
    Actions in this section are irreversible and permanently delete user data.
  </p>

  {#if loading}
    <div class="loading">Loading profiles...</div>
  {:else if error && !success}
    <div class="error-message">{error}</div>
  {/if}

  {#if success}
    <div class="success-message">{success}</div>
  {/if}

  {#if !loading && profiles.length > 0}
    <div class="profile-table-container">
      <table class="profile-table">
        <thead>
          <tr>
            <th>Username</th>
            <th>Display Name</th>
            <th>Role</th>
            <th>Visibility</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {#each profiles as profile}
            <tr>
              <td><strong>{profile.username}</strong></td>
              <td>{profile.displayName}</td>
              <td>
                <span class="role-badge" class:role-owner={profile.role === 'owner'}>
                  {profile.role}
                </span>
              </td>
              <td>
                <span class="visibility-badge" class:visibility-public={profile.visibility === 'public'}>
                  {profile.visibility}
                </span>
              </td>
              <td>
                {#if canDeleteProfile(profile)}
                  <button
                    class="delete-btn"
                    on:click={() => openDeleteModal(profile)}
                  >
                    Delete Profile
                  </button>
                {:else}
                  <button
                    class="delete-btn"
                    disabled
                    title={getDeleteDisabledReason(profile)}
                  >
                    Delete Profile
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
  <div class="modal-overlay" on:click={closeDeleteModal}>
    <div class="modal-content" on:click|stopPropagation>
      <h3>⚠️ Delete Profile</h3>

      <p class="modal-warning">
        You are about to permanently delete the profile for <strong>{profileToDelete.username}</strong>.
      </p>

      <div class="modal-details">
        <p><strong>This action will:</strong></p>
        <ul>
          <li>Terminate all active sessions for this user</li>
          <li>Remove the user account from the system</li>
          <li>Permanently delete the <code>profiles/{profileToDelete.username}/</code> directory</li>
          <li>Delete all memories, tasks, configurations, and persona data</li>
        </ul>
        <p class="irreversible-warning">⚠️ <strong>This action is irreversible</strong></p>
      </div>

      <div class="confirmation-section">
        <label for="confirm-username">
          Type <strong>{profileToDelete.username}</strong> to confirm:
        </label>
        <input
          id="confirm-username"
          type="text"
          bind:value={confirmUsername}
          placeholder="Enter username to confirm"
          disabled={deleting}
        />
      </div>

      {#if error}
        <div class="error-message">{error}</div>
      {/if}

      <div class="modal-actions">
        <button
          class="btn-cancel"
          on:click={closeDeleteModal}
          disabled={deleting}
        >
          Cancel
        </button>
        <button
          class="btn-delete-confirm"
          on:click={handleDelete}
          disabled={deleting || confirmUsername !== profileToDelete.username}
        >
          {deleting ? 'Deleting...' : 'Delete Profile'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .danger-zone {
    margin-top: 2rem;
    padding: 1.5rem;
    border: 2px solid #dc2626;
    border-radius: 8px;
    background: #fef2f2;
  }

  :global(.dark) .danger-zone {
    background: #450a0a;
    border-color: #991b1b;
  }

  .danger-zone h2 {
    margin: 0 0 0.5rem 0;
    color: #dc2626;
    font-size: 1.25rem;
  }

  :global(.dark) .danger-zone h2 {
    color: #fca5a5;
  }

  .warning-text {
    margin: 0 0 1rem 0;
    color: #991b1b;
    font-size: 0.875rem;
  }

  :global(.dark) .warning-text {
    color: #fca5a5;
  }

  .loading {
    padding: 1rem;
    text-align: center;
    color: #6b7280;
  }

  .error-message {
    padding: 0.75rem;
    margin-bottom: 1rem;
    background: #fee2e2;
    border: 1px solid #fecaca;
    border-radius: 4px;
    color: #991b1b;
    font-size: 0.875rem;
  }

  :global(.dark) .error-message {
    background: #7f1d1d;
    border-color: #991b1b;
    color: #fecaca;
  }

  .success-message {
    padding: 0.75rem;
    margin-bottom: 1rem;
    background: #d1fae5;
    border: 1px solid #a7f3d0;
    border-radius: 4px;
    color: #065f46;
    font-size: 0.875rem;
  }

  :global(.dark) .success-message {
    background: #064e3b;
    border-color: #059669;
    color: #a7f3d0;
  }

  .profile-table-container {
    overflow-x: auto;
  }

  .profile-table {
    width: 100%;
    border-collapse: collapse;
    background: white;
    border-radius: 4px;
  }

  :global(.dark) .profile-table {
    background: #1f2937;
  }

  .profile-table th {
    padding: 0.75rem;
    text-align: left;
    background: #f9fafb;
    border-bottom: 2px solid #e5e7eb;
    font-size: 0.875rem;
    font-weight: 600;
    color: #374151;
  }

  :global(.dark) .profile-table th {
    background: #111827;
    border-color: #374151;
    color: #d1d5db;
  }

  .profile-table td {
    padding: 0.75rem;
    border-bottom: 1px solid #e5e7eb;
    font-size: 0.875rem;
  }

  :global(.dark) .profile-table td {
    border-color: #374151;
    color: #d1d5db;
  }

  .profile-table tr:last-child td {
    border-bottom: none;
  }

  .role-badge,
  .visibility-badge {
    display: inline-block;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
  }

  .role-badge {
    background: #dbeafe;
    color: #1e40af;
  }

  .role-badge.role-owner {
    background: #fef3c7;
    color: #92400e;
  }

  :global(.dark) .role-badge {
    background: #1e3a8a;
    color: #bfdbfe;
  }

  :global(.dark) .role-badge.role-owner {
    background: #78350f;
    color: #fde68a;
  }

  .visibility-badge {
    background: #e5e7eb;
    color: #374151;
  }

  .visibility-badge.visibility-public {
    background: #d1fae5;
    color: #065f46;
  }

  :global(.dark) .visibility-badge {
    background: #374151;
    color: #d1d5db;
  }

  :global(.dark) .visibility-badge.visibility-public {
    background: #064e3b;
    color: #a7f3d0;
  }

  .delete-btn {
    padding: 0.375rem 0.75rem;
    background: #dc2626;
    color: white;
    border: none;
    border-radius: 4px;
    font-size: 0.875rem;
    cursor: pointer;
    transition: background 0.2s;
  }

  .delete-btn:hover:not(:disabled) {
    background: #b91c1c;
  }

  .delete-btn:disabled {
    background: #d1d5db;
    cursor: not-allowed;
    color: #9ca3af;
  }

  :global(.dark) .delete-btn:disabled {
    background: #374151;
    color: #6b7280;
  }

  /* Modal Styles */
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .modal-content {
    background: white;
    border-radius: 8px;
    padding: 1.5rem;
    max-width: 600px;
    width: 90%;
    max-height: 80vh;
    overflow-y: auto;
  }

  :global(.dark) .modal-content {
    background: #1f2937;
    color: #d1d5db;
  }

  .modal-content h3 {
    margin: 0 0 1rem 0;
    color: #dc2626;
    font-size: 1.25rem;
  }

  :global(.dark) .modal-content h3 {
    color: #fca5a5;
  }

  .modal-warning {
    margin: 0 0 1rem 0;
    font-size: 0.875rem;
  }

  .modal-details {
    padding: 1rem;
    background: #fef2f2;
    border: 1px solid #fecaca;
    border-radius: 4px;
    margin-bottom: 1rem;
  }

  :global(.dark) .modal-details {
    background: #450a0a;
    border-color: #991b1b;
  }

  .modal-details p {
    margin: 0 0 0.5rem 0;
    font-size: 0.875rem;
    font-weight: 600;
  }

  .modal-details ul {
    margin: 0 0 0.5rem 0;
    padding-left: 1.5rem;
    font-size: 0.875rem;
  }

  .modal-details li {
    margin-bottom: 0.25rem;
  }

  .modal-details code {
    background: #fee2e2;
    padding: 0.125rem 0.25rem;
    border-radius: 3px;
    font-family: monospace;
    font-size: 0.8em;
  }

  :global(.dark) .modal-details code {
    background: #7f1d1d;
  }

  .irreversible-warning {
    margin: 0.5rem 0 0 0;
    color: #dc2626;
    font-weight: 700;
  }

  :global(.dark) .irreversible-warning {
    color: #fca5a5;
  }

  .confirmation-section {
    margin-bottom: 1rem;
  }

  .confirmation-section label {
    display: block;
    margin-bottom: 0.5rem;
    font-size: 0.875rem;
    font-weight: 600;
  }

  .confirmation-section input {
    width: 100%;
    padding: 0.5rem;
    border: 1px solid #d1d5db;
    border-radius: 4px;
    font-size: 0.875rem;
  }

  :global(.dark) .confirmation-section input {
    background: #374151;
    border-color: #4b5563;
    color: #f3f4f6;
  }

  .confirmation-section input:focus {
    outline: none;
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
  }

  .modal-actions {
    display: flex;
    gap: 0.75rem;
    justify-content: flex-end;
  }

  .btn-cancel,
  .btn-delete-confirm {
    padding: 0.5rem 1rem;
    border: none;
    border-radius: 4px;
    font-size: 0.875rem;
    cursor: pointer;
    transition: background 0.2s;
  }

  .btn-cancel {
    background: #e5e7eb;
    color: #374151;
  }

  .btn-cancel:hover:not(:disabled) {
    background: #d1d5db;
  }

  :global(.dark) .btn-cancel {
    background: #374151;
    color: #d1d5db;
  }

  :global(.dark) .btn-cancel:hover:not(:disabled) {
    background: #4b5563;
  }

  .btn-delete-confirm {
    background: #dc2626;
    color: white;
  }

  .btn-delete-confirm:hover:not(:disabled) {
    background: #b91c1c;
  }

  .btn-delete-confirm:disabled,
  .btn-cancel:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
