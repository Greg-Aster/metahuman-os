<script lang="ts">
  import { apiFetch } from '../lib/client/api-config';

  export let onProfileCreated: (() => void) | undefined = undefined;

  let username = '';
  let password = '';
  let confirmPassword = '';
  let displayName = '';
  let email = '';
  let role: 'owner' | 'standard' | 'guest' = 'standard';
  let creating = false;
  let error = '';
  let success = '';
  let showForm = false;

  async function handleCreate() {
    error = '';
    success = '';

    // Client-side validation
    if (!username || username.trim() === '') {
      error = 'Username is required';
      return;
    }

    if (username.length < 3 || username.length > 50) {
      error = 'Username must be 3-50 characters';
      return;
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
      error = 'Username can only contain letters, numbers, underscore, and hyphen';
      return;
    }

    if (!password || password.trim() === '') {
      error = 'Password is required';
      return;
    }

    if (password.length < 6) {
      error = 'Password must be at least 6 characters';
      return;
    }

    if (password !== confirmPassword) {
      error = 'Passwords do not match';
      return;
    }

    creating = true;

    try {
      const response = await apiFetch('/api/profiles/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          password,
          displayName: displayName.trim() || undefined,
          email: email.trim() || undefined,
          role,
        }),
      });

      const data = await response.json();

      if (data.success) {
        const roleMessage =
          role === 'owner'
            ? 'User can now log in with owner privileges.'
            : role === 'standard'
            ? 'User can now log in with full access to their own profile.'
            : 'User can now log in as a read-only guest.';

        success = `Profile '${username}' created successfully! ${roleMessage}`;

        // Reset form
        username = '';
        password = '';
        confirmPassword = '';
        displayName = '';
        email = '';
        role = 'standard';
        showForm = false;

        // Notify parent to refresh
        if (onProfileCreated) {
          onProfileCreated();
        }
      } else {
        error = data.error || 'Failed to create profile';
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to create profile';
      console.error(err);
    } finally {
      creating = false;
    }
  }

  function handleCancel() {
    showForm = false;
    username = '';
    password = '';
    confirmPassword = '';
    displayName = '';
    email = '';
    role = 'standard';
    error = '';
    success = '';
  }
</script>

<div class="p-6 border-2 border-green-500 rounded-lg bg-green-50 dark:bg-green-950 mb-8">
  <h2 class="m-0 mb-2 text-xl text-green-600 dark:text-green-300">➕ Create Profile</h2>
  <p class="m-0 mb-4 text-sm text-green-700 dark:text-green-200">
    Create a new user account with full profile directory structure and authentication credentials.
  </p>

  {#if error}
    <div class="banner banner-error mb-4">{error}</div>
  {/if}

  {#if success}
    <div class="banner banner-success mb-4">{success}</div>
  {/if}

  {#if !showForm}
    <button class="py-3 px-6 bg-green-500 text-white border-0 rounded-md text-sm font-semibold cursor-pointer hover:bg-green-600 transition-colors" on:click={() => (showForm = true)}>
      Create New Profile
    </button>
  {:else}
    <form on:submit|preventDefault={handleCreate} class="flex flex-col gap-4">
      <div class="form-group">
        <label for="username" class="font-semibold text-sm text-green-700 dark:text-green-200">
          Username <span class="text-red-500">*</span>
        </label>
        <input
          id="username"
          type="text"
          bind:value={username}
          placeholder="john-doe"
          disabled={creating}
          required
          class="form-input"
        />
        <small class="text-xs text-gray-500 dark:text-gray-400">3-50 characters, letters, numbers, underscore, and hyphen only</small>
      </div>

      <div class="form-group">
        <label for="password" class="font-semibold text-sm text-green-700 dark:text-green-200">
          Password <span class="text-red-500">*</span>
        </label>
        <input
          id="password"
          type="password"
          bind:value={password}
          placeholder="Minimum 6 characters"
          disabled={creating}
          required
          class="form-input"
        />
      </div>

      <div class="form-group">
        <label for="confirmPassword" class="font-semibold text-sm text-green-700 dark:text-green-200">
          Confirm Password <span class="text-red-500">*</span>
        </label>
        <input
          id="confirmPassword"
          type="password"
          bind:value={confirmPassword}
          placeholder="Re-enter password"
          disabled={creating}
          required
          class="form-input"
        />
      </div>

      <div class="form-group">
        <label for="displayName" class="font-semibold text-sm text-green-700 dark:text-green-200">
          Display Name <span class="font-normal text-gray-500">(optional)</span>
        </label>
        <input
          id="displayName"
          type="text"
          bind:value={displayName}
          placeholder="John Doe"
          disabled={creating}
          class="form-input"
        />
      </div>

      <div class="form-group">
        <label for="email" class="font-semibold text-sm text-green-700 dark:text-green-200">
          Email <span class="font-normal text-gray-500">(optional)</span>
        </label>
        <input
          id="email"
          type="email"
          bind:value={email}
          placeholder="john@example.com"
          disabled={creating}
          class="form-input"
        />
      </div>

      <div class="form-group">
        <label for="role" class="font-semibold text-sm text-green-700 dark:text-green-200">
          Role <span class="text-red-500">*</span>
        </label>
        <select id="role" bind:value={role} disabled={creating} class="form-input">
          <option value="standard">Standard User</option>
          <option value="guest">Guest</option>
          <option value="owner">Owner</option>
        </select>
        <small class="text-xs text-gray-500 dark:text-gray-400">
          {#if role === 'owner'}
            <strong>Owner:</strong> Full system access, can create/delete profiles, change settings
          {:else if role === 'standard'}
            <strong>Standard User:</strong> Full access to own profile, read-only docs, cannot access other profiles
          {:else}
            <strong>Guest:</strong> Read-only access to docs and shared content
          {/if}
        </small>
      </div>

      <div class="flex gap-3 justify-end mt-2">
        <button
          type="button"
          class="btn-secondary"
          on:click={handleCancel}
          disabled={creating}
        >
          Cancel
        </button>
        <button type="submit" class="py-3 px-6 bg-green-500 text-white border-0 rounded text-sm font-semibold cursor-pointer hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed" disabled={creating}>
          {creating ? 'Creating...' : 'Create Profile'}
        </button>
      </div>
    </form>
  {/if}
</div>

<style>
  /* Form group layout */
  .form-group {
    @apply flex flex-col gap-2;
  }

  /* Focus ring for green theme */
  .form-group :global(input:focus),
  .form-group :global(select:focus) {
    @apply ring-2 ring-green-500/20 border-green-500;
  }
</style>
