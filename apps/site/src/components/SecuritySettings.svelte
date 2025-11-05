<script lang="ts">
  import { onMount } from 'svelte';

  interface User {
    id: string;
    username: string;
    role: 'owner' | 'guest' | 'anonymous';
    metadata?: {
      displayName?: string;
      email?: string;
    };
    createdAt?: string;
    lastLogin?: string;
  }

  let currentUser: User | null = null;
  let loading = true;
  let error = '';
  let success = '';

  // Change username state
  let showChangeUsername = false;
  let newUsername = '';
  let usernameChanging = false;

  // Change password state
  let showChangePassword = false;
  let currentPassword = '';
  let newPassword = '';
  let confirmPassword = '';
  let passwordChanging = false;

  // Change display name/email state
  let showChangeProfile = false;
  let newDisplayName = '';
  let newEmail = '';
  let profileChanging = false;

  onMount(async () => {
    await fetchCurrentUser();
  });

  async function fetchCurrentUser() {
    try {
      const response = await fetch('/api/auth/me');
      const data = await response.json();

      if (data.success && data.user) {
        currentUser = data.user;
        newDisplayName = data.user.metadata?.displayName || '';
        newEmail = data.user.metadata?.email || '';
      } else {
        error = 'Not authenticated';
      }
    } catch (err) {
      error = 'Failed to load user information';
      console.error(err);
    } finally {
      loading = false;
    }
  }

  async function handleChangeUsername() {
    if (!newUsername || newUsername.trim() === '') {
      error = 'Username cannot be empty';
      return;
    }

    usernameChanging = true;
    error = '';
    success = '';

    try {
      const response = await fetch('/api/auth/change-username', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newUsername }),
      });

      const data = await response.json();

      if (data.success) {
        success = 'Username changed successfully!';
        showChangeUsername = false;
        newUsername = '';
        await fetchCurrentUser();
      } else {
        error = data.error || 'Failed to change username';
      }
    } catch (err) {
      error = 'Network error. Please try again.';
      console.error(err);
    } finally {
      usernameChanging = false;
    }
  }

  async function handleChangePassword() {
    if (!currentPassword || !newPassword || !confirmPassword) {
      error = 'All password fields are required';
      return;
    }

    if (newPassword !== confirmPassword) {
      error = 'New passwords do not match';
      return;
    }

    if (newPassword.length < 4) {
      error = 'Password must be at least 4 characters';
      return;
    }

    passwordChanging = true;
    error = '';
    success = '';

    try {
      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      const data = await response.json();

      if (data.success) {
        success = 'Password changed successfully!';
        showChangePassword = false;
        currentPassword = '';
        newPassword = '';
        confirmPassword = '';
      } else {
        error = data.error || 'Failed to change password';
      }
    } catch (err) {
      error = 'Network error. Please try again.';
      console.error(err);
    } finally {
      passwordChanging = false;
    }
  }

  async function handleChangeProfile() {
    profileChanging = true;
    error = '';
    success = '';

    try {
      const response = await fetch('/api/auth/update-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: newDisplayName || undefined,
          email: newEmail || undefined,
        }),
      });

      const data = await response.json();

      if (data.success) {
        success = 'Profile updated successfully!';
        showChangeProfile = false;
        await fetchCurrentUser();
      } else {
        error = data.error || 'Failed to update profile';
      }
    } catch (err) {
      error = 'Network error. Please try again.';
      console.error(err);
    } finally {
      profileChanging = false;
    }
  }

  function cancelChangeUsername() {
    showChangeUsername = false;
    newUsername = '';
    error = '';
  }

  function cancelChangePassword() {
    showChangePassword = false;
    currentPassword = '';
    newPassword = '';
    confirmPassword = '';
    error = '';
  }

  function cancelChangeProfile() {
    showChangeProfile = false;
    if (currentUser) {
      newDisplayName = currentUser.metadata?.displayName || '';
      newEmail = currentUser.metadata?.email || '';
    }
    error = '';
  }
</script>

<div class="security-container">
  <div class="security-header">
    <h1>🔒 Security & Account Settings</h1>
    <p>Manage your authentication and profile information</p>
  </div>

  {#if loading}
    <div class="loading-state">
      <div class="spinner"></div>
      <p>Loading account information...</p>
    </div>
  {:else if !currentUser}
    <div class="not-authenticated">
      <svg class="w-16 h-16 text-gray-400 dark:text-gray-600 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
      </svg>
      <h2>Authentication Required</h2>
      <p>Please login to access security settings</p>
      <a href="/login" class="login-button">Go to Login</a>
    </div>
  {:else}
    {#if error}
      <div class="alert alert-error">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>
        <span>{error}</span>
        <button on:click={() => error = ''} class="alert-close">×</button>
      </div>
    {/if}

    {#if success}
      <div class="alert alert-success">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>
        <span>{success}</span>
        <button on:click={() => success = ''} class="alert-close">×</button>
      </div>
    {/if}

    <!-- Current User Info -->
    <div class="card">
      <h2>Account Information</h2>
      <div class="user-info-grid">
        <div class="info-row">
          <span class="label">Username:</span>
          <span class="value">{currentUser.username}</span>
        </div>
        <div class="info-row">
          <span class="label">Role:</span>
          <span class="value role-badge role-{currentUser.role}">{currentUser.role}</span>
        </div>
        {#if currentUser.metadata?.displayName}
          <div class="info-row">
            <span class="label">Display Name:</span>
            <span class="value">{currentUser.metadata.displayName}</span>
          </div>
        {/if}
        {#if currentUser.metadata?.email}
          <div class="info-row">
            <span class="label">Email:</span>
            <span class="value">{currentUser.metadata.email}</span>
          </div>
        {/if}
        {#if currentUser.createdAt}
          <div class="info-row">
            <span class="label">Created:</span>
            <span class="value">{new Date(currentUser.createdAt).toLocaleString()}</span>
          </div>
        {/if}
      </div>
    </div>

    <!-- Change Username -->
    <div class="card">
      <h2>Change Username</h2>
      {#if !showChangeUsername}
        <p>Your current username is <strong>{currentUser.username}</strong></p>
        <button class="btn btn-primary" on:click={() => showChangeUsername = true}>
          Change Username
        </button>
      {:else}
        <form on:submit|preventDefault={handleChangeUsername}>
          <div class="form-group">
            <label for="newUsername">New Username</label>
            <input
              id="newUsername"
              type="text"
              bind:value={newUsername}
              placeholder="Enter new username"
              disabled={usernameChanging}
              required
            />
            <small>Username must be 3-50 characters, alphanumeric with underscore/hyphen</small>
          </div>
          <div class="form-actions">
            <button type="submit" class="btn btn-primary" disabled={usernameChanging}>
              {usernameChanging ? 'Changing...' : 'Save Username'}
            </button>
            <button type="button" class="btn btn-secondary" on:click={cancelChangeUsername} disabled={usernameChanging}>
              Cancel
            </button>
          </div>
        </form>
      {/if}
    </div>

    <!-- Change Password -->
    <div class="card">
      <h2>Change Password</h2>
      {#if !showChangePassword}
        <p>Update your password to keep your account secure</p>
        <button class="btn btn-primary" on:click={() => showChangePassword = true}>
          Change Password
        </button>
      {:else}
        <form on:submit|preventDefault={handleChangePassword}>
          <div class="form-group">
            <label for="currentPassword">Current Password</label>
            <input
              id="currentPassword"
              type="password"
              bind:value={currentPassword}
              placeholder="Enter current password"
              disabled={passwordChanging}
              required
            />
          </div>
          <div class="form-group">
            <label for="newPassword">New Password</label>
            <input
              id="newPassword"
              type="password"
              bind:value={newPassword}
              placeholder="Enter new password"
              disabled={passwordChanging}
              required
            />
          </div>
          <div class="form-group">
            <label for="confirmPassword">Confirm New Password</label>
            <input
              id="confirmPassword"
              type="password"
              bind:value={confirmPassword}
              placeholder="Confirm new password"
              disabled={passwordChanging}
              required
            />
          </div>
          <div class="form-actions">
            <button type="submit" class="btn btn-primary" disabled={passwordChanging}>
              {passwordChanging ? 'Changing...' : 'Save Password'}
            </button>
            <button type="button" class="btn btn-secondary" on:click={cancelChangePassword} disabled={passwordChanging}>
              Cancel
            </button>
          </div>
        </form>
      {/if}
    </div>

    <!-- Update Profile -->
    <div class="card">
      <h2>Profile Information</h2>
      {#if !showChangeProfile}
        <p>Update your display name and email</p>
        <button class="btn btn-primary" on:click={() => showChangeProfile = true}>
          Update Profile
        </button>
      {:else}
        <form on:submit|preventDefault={handleChangeProfile}>
          <div class="form-group">
            <label for="displayName">Display Name</label>
            <input
              id="displayName"
              type="text"
              bind:value={newDisplayName}
              placeholder="Your display name"
              disabled={profileChanging}
            />
          </div>
          <div class="form-group">
            <label for="email">Email (optional)</label>
            <input
              id="email"
              type="email"
              bind:value={newEmail}
              placeholder="your@email.com"
              disabled={profileChanging}
            />
          </div>
          <div class="form-actions">
            <button type="submit" class="btn btn-primary" disabled={profileChanging}>
              {profileChanging ? 'Updating...' : 'Save Profile'}
            </button>
            <button type="button" class="btn btn-secondary" on:click={cancelChangeProfile} disabled={profileChanging}>
              Cancel
            </button>
          </div>
        </form>
      {/if}
    </div>

    <!-- Security Information -->
    <div class="card info-card">
      <h2>Security Information</h2>
      <ul>
        <li>Your password is hashed and never stored in plain text</li>
        <li>Session cookies are HTTPOnly and secure</li>
        <li>Owner sessions last 24 hours, guest sessions last 1 hour</li>
        <li>Clear your browser cookies to log out from all devices</li>
      </ul>
    </div>
  {/if}
</div>

<style>
  .security-container {
    padding: 2rem;
    max-width: 800px;
    margin: 0 auto;
  }

  .security-header {
    margin-bottom: 2rem;
  }

  .security-header h1 {
    font-size: 2rem;
    font-weight: 700;
    color: rgb(17 24 39);
    margin: 0 0 0.5rem 0;
  }

  :global(.dark) .security-header h1 {
    color: rgb(243 244 246);
  }

  .security-header p {
    color: rgb(107 114 128);
    margin: 0;
  }

  :global(.dark) .security-header p {
    color: rgb(156 163 175);
  }

  .loading-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 4rem 2rem;
  }

  .spinner {
    width: 40px;
    height: 40px;
    border: 3px solid rgba(139, 92, 246, 0.2);
    border-top-color: rgb(139, 92, 246);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .loading-state p {
    margin-top: 1rem;
    color: rgb(107 114 128);
  }

  :global(.dark) .loading-state p {
    color: rgb(156 163 175);
  }

  .not-authenticated {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 4rem 2rem;
    text-align: center;
  }

  .not-authenticated h2 {
    font-size: 1.5rem;
    font-weight: 600;
    color: rgb(17 24 39);
    margin: 0 0 0.5rem 0;
  }

  :global(.dark) .not-authenticated h2 {
    color: rgb(243 244 246);
  }

  .not-authenticated p {
    color: rgb(107 114 128);
    margin: 0 0 1.5rem 0;
  }

  :global(.dark) .not-authenticated p {
    color: rgb(156 163 175);
  }

  .login-button {
    display: inline-block;
    padding: 0.75rem 1.5rem;
    background: linear-gradient(135deg, rgb(139, 92, 246) 0%, rgb(219, 39, 119) 100%);
    color: white;
    text-decoration: none;
    border-radius: 0.5rem;
    font-weight: 600;
    transition: transform 0.2s;
  }

  .login-button:hover {
    transform: translateY(-2px);
  }

  .alert {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 1rem;
    border-radius: 0.5rem;
    margin-bottom: 1rem;
  }

  .alert-error {
    background: rgb(254 242 242);
    border: 1px solid rgb(254 226 226);
    color: rgb(153 27 27);
  }

  :global(.dark) .alert-error {
    background: rgb(127 29 29 / 0.3);
    border-color: rgb(153 27 27);
    color: rgb(254 226 226);
  }

  .alert-success {
    background: rgb(240 253 244);
    border: 1px solid rgb(187 247 208);
    color: rgb(22 101 52);
  }

  :global(.dark) .alert-success {
    background: rgb(20 83 45 / 0.3);
    border-color: rgb(22 101 52);
    color: rgb(187 247 208);
  }

  .alert-close {
    margin-left: auto;
    background: transparent;
    border: none;
    font-size: 1.5rem;
    cursor: pointer;
    color: inherit;
    opacity: 0.6;
  }

  .alert-close:hover {
    opacity: 1;
  }

  .card {
    background: white;
    border: 1px solid rgb(229 231 235);
    border-radius: 0.75rem;
    padding: 1.5rem;
    margin-bottom: 1.5rem;
  }

  :global(.dark) .card {
    background: rgb(17 24 39);
    border-color: rgb(55 65 81);
  }

  .card h2 {
    font-size: 1.25rem;
    font-weight: 600;
    color: rgb(17 24 39);
    margin: 0 0 1rem 0;
  }

  :global(.dark) .card h2 {
    color: rgb(243 244 246);
  }

  .card p {
    color: rgb(107 114 128);
    margin: 0 0 1rem 0;
  }

  :global(.dark) .card p {
    color: rgb(156 163 175);
  }

  .user-info-grid {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .info-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.5rem 0;
    border-bottom: 1px solid rgb(243 244 246);
  }

  :global(.dark) .info-row {
    border-color: rgb(31 41 55);
  }

  .info-row:last-child {
    border-bottom: none;
  }

  .label {
    font-weight: 500;
    color: rgb(107 114 128);
  }

  :global(.dark) .label {
    color: rgb(156 163 175);
  }

  .value {
    color: rgb(17 24 39);
    font-weight: 500;
  }

  :global(.dark) .value {
    color: rgb(243 244 246);
  }

  .role-badge {
    display: inline-block;
    padding: 0.25rem 0.75rem;
    border-radius: 9999px;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
  }

  .role-badge.role-owner {
    background: rgb(243 232 255);
    color: rgb(107 33 168);
  }

  :global(.dark) .role-badge.role-owner {
    background: rgb(88 28 135 / 0.3);
    color: rgb(216 180 254);
  }

  .role-badge.role-guest {
    background: rgb(219 234 254);
    color: rgb(30 64 175);
  }

  :global(.dark) .role-badge.role-guest {
    background: rgb(30 58 138 / 0.3);
    color: rgb(191 219 254);
  }

  .form-group {
    margin-bottom: 1rem;
  }

  .form-group label {
    display: block;
    font-weight: 500;
    color: rgb(55 65 81);
    margin-bottom: 0.5rem;
  }

  :global(.dark) .form-group label {
    color: rgb(209 213 219);
  }

  .form-group input {
    width: 100%;
    padding: 0.75rem;
    border: 1px solid rgb(209 213 219);
    border-radius: 0.5rem;
    font-size: 1rem;
    background: white;
    color: rgb(17 24 39);
  }

  :global(.dark) .form-group input {
    background: rgb(31 41 55);
    border-color: rgb(55 65 81);
    color: rgb(243 244 246);
  }

  .form-group input:focus {
    outline: none;
    border-color: rgb(139, 92, 246);
    box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.1);
  }

  .form-group input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .form-group small {
    display: block;
    margin-top: 0.25rem;
    font-size: 0.875rem;
    color: rgb(107 114 128);
  }

  :global(.dark) .form-group small {
    color: rgb(156 163 175);
  }

  .form-actions {
    display: flex;
    gap: 0.75rem;
  }

  .btn {
    padding: 0.75rem 1.5rem;
    border-radius: 0.5rem;
    font-weight: 600;
    font-size: 0.875rem;
    cursor: pointer;
    transition: all 0.2s;
    border: none;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-primary {
    background: linear-gradient(135deg, rgb(139, 92, 246) 0%, rgb(219, 39, 119) 100%);
    color: white;
  }

  .btn-primary:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(139, 92, 246, 0.4);
  }

  .btn-secondary {
    background: rgb(243 244 246);
    color: rgb(55 65 81);
  }

  :global(.dark) .btn-secondary {
    background: rgb(55 65 81);
    color: rgb(209 213 219);
  }

  .btn-secondary:hover:not(:disabled) {
    background: rgb(229 231 235);
  }

  :global(.dark) .btn-secondary:hover:not(:disabled) {
    background: rgb(75 85 99);
  }

  .info-card ul {
    margin: 0;
    padding-left: 1.5rem;
  }

  .info-card li {
    color: rgb(107 114 128);
    margin-bottom: 0.5rem;
  }

  :global(.dark) .info-card li {
    color: rgb(156 163 175);
  }
</style>
