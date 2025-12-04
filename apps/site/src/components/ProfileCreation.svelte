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

<div class="profile-creation">
  <h2>➕ Create Profile</h2>
  <p class="description">
    Create a new user account with full profile directory structure and authentication credentials.
  </p>

  {#if error}
    <div class="error-message">{error}</div>
  {/if}

  {#if success}
    <div class="success-message">{success}</div>
  {/if}

  {#if !showForm}
    <button class="btn-create" on:click={() => (showForm = true)}>
      Create New Profile
    </button>
  {:else}
    <form on:submit|preventDefault={handleCreate} class="creation-form">
      <div class="form-group">
        <label for="username">
          Username <span class="required">*</span>
        </label>
        <input
          id="username"
          type="text"
          bind:value={username}
          placeholder="john-doe"
          disabled={creating}
          required
        />
        <small>3-50 characters, letters, numbers, underscore, and hyphen only</small>
      </div>

      <div class="form-group">
        <label for="password">
          Password <span class="required">*</span>
        </label>
        <input
          id="password"
          type="password"
          bind:value={password}
          placeholder="Minimum 6 characters"
          disabled={creating}
          required
        />
      </div>

      <div class="form-group">
        <label for="confirmPassword">
          Confirm Password <span class="required">*</span>
        </label>
        <input
          id="confirmPassword"
          type="password"
          bind:value={confirmPassword}
          placeholder="Re-enter password"
          disabled={creating}
          required
        />
      </div>

      <div class="form-group">
        <label for="displayName">
          Display Name <span class="optional">(optional)</span>
        </label>
        <input
          id="displayName"
          type="text"
          bind:value={displayName}
          placeholder="John Doe"
          disabled={creating}
        />
      </div>

      <div class="form-group">
        <label for="email">
          Email <span class="optional">(optional)</span>
        </label>
        <input
          id="email"
          type="email"
          bind:value={email}
          placeholder="john@example.com"
          disabled={creating}
        />
      </div>

      <div class="form-group">
        <label for="role">
          Role <span class="required">*</span>
        </label>
        <select id="role" bind:value={role} disabled={creating}>
          <option value="standard">Standard User</option>
          <option value="guest">Guest</option>
          <option value="owner">Owner</option>
        </select>
        <small>
          {#if role === 'owner'}
            <strong>Owner:</strong> Full system access, can create/delete profiles, change settings
          {:else if role === 'standard'}
            <strong>Standard User:</strong> Full access to own profile, read-only docs, cannot access other profiles
          {:else}
            <strong>Guest:</strong> Read-only access to docs and shared content
          {/if}
        </small>
      </div>

      <div class="form-actions">
        <button
          type="button"
          class="btn-cancel"
          on:click={handleCancel}
          disabled={creating}
        >
          Cancel
        </button>
        <button type="submit" class="btn-submit" disabled={creating}>
          {creating ? 'Creating...' : 'Create Profile'}
        </button>
      </div>
    </form>
  {/if}
</div>

<style>
  .profile-creation {
    padding: 1.5rem;
    border: 2px solid #10b981;
    border-radius: 8px;
    background: #f0fdf4;
    margin-bottom: 2rem;
  }

  :global(.dark) .profile-creation {
    background: #064e3b;
    border-color: #059669;
  }

  .profile-creation h2 {
    margin: 0 0 0.5rem 0;
    color: #059669;
    font-size: 1.25rem;
  }

  :global(.dark) .profile-creation h2 {
    color: #6ee7b7;
  }

  .description {
    margin: 0 0 1rem 0;
    color: #065f46;
    font-size: 0.875rem;
  }

  :global(.dark) .description {
    color: #a7f3d0;
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

  .btn-create {
    padding: 0.75rem 1.5rem;
    background: #10b981;
    color: white;
    border: none;
    border-radius: 6px;
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.2s;
  }

  .btn-create:hover {
    background: #059669;
  }

  .creation-form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .form-group label {
    font-weight: 600;
    font-size: 0.875rem;
    color: #065f46;
  }

  :global(.dark) .form-group label {
    color: #d1fae5;
  }

  .required {
    color: #dc2626;
  }

  .optional {
    font-weight: 400;
    color: #6b7280;
  }

  :global(.dark) .optional {
    color: #9ca3af;
  }

  .form-group input,
  .form-group select {
    padding: 0.75rem;
    border: 1px solid #d1d5db;
    border-radius: 4px;
    font-size: 0.875rem;
    background: white;
    color: #1f2937;
  }

  :global(.dark) .form-group input,
  :global(.dark) .form-group select {
    background: #1f2937;
    border-color: #4b5563;
    color: #f3f4f6;
  }

  .form-group input:focus,
  .form-group select:focus {
    outline: none;
    border-color: #10b981;
    box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.1);
  }

  .form-group input:disabled,
  .form-group select:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .form-group small {
    font-size: 0.75rem;
    color: #6b7280;
  }

  :global(.dark) .form-group small {
    color: #9ca3af;
  }

  .form-actions {
    display: flex;
    gap: 0.75rem;
    justify-content: flex-end;
    margin-top: 0.5rem;
  }

  .btn-cancel,
  .btn-submit {
    padding: 0.75rem 1.5rem;
    border: none;
    border-radius: 4px;
    font-size: 0.875rem;
    font-weight: 600;
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

  .btn-submit {
    background: #10b981;
    color: white;
  }

  .btn-submit:hover:not(:disabled) {
    background: #059669;
  }

  .btn-submit:disabled,
  .btn-cancel:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
