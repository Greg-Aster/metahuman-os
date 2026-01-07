<script lang="ts">
  import { onMount } from 'svelte';
  import { statusRefreshTrigger } from '../stores/navigation';
  import ProfileDangerZone from './ProfileDangerZone.svelte';
  import ProfileCreation from './ProfileCreation.svelte';
  import { apiFetch } from '../lib/client/api-config';

  interface User {
    id: string;
    username: string;
    role: 'owner' | 'standard' | 'guest' | 'anonymous';
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

  // Profile visibility state
  let profileVisibility: 'private' | 'public' = 'private';
  let savingVisibility = false;

  // Recovery codes state
  let recoveryCodes: string[] = [];
  let recoveryCodesLoading = false;
  let showRecoveryCodes = false;
  let regeneratingCodes = false;
  let showRegenerateConfirm = false;

  interface TunnelStatus {
    installed: boolean;
    running: boolean;
    enabled: boolean;
    hostname: string;
    pid?: number;
  }

  let tunnelStatus: TunnelStatus | null = null;
  let tunnelStatusLoading = false;
  let tunnelActionPending = false;

  // Reference to ProfileDangerZone component for refreshing
  let profileDangerZone: any;

  // Factory reset state
  let resettingFactory = false;

  onMount(async () => {
    await fetchCurrentUser();
    await loadTrustLevel();
    await loadAgentConfig();
    await loadTrustCoupling();
    await loadCognitiveLayersConfig();
    await fetchVisibility();
    await loadTunnelStatus();
    await loadRecoveryCodes();
  });

  async function fetchCurrentUser() {
    try {
      const response = await apiFetch('/api/auth/me');
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
      const response = await apiFetch('/api/auth/change-username', {
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
      const response = await apiFetch('/api/auth/change-password', {
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
      const response = await apiFetch('/api/auth/update-profile', {
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

  // Profile visibility functions
  async function fetchVisibility() {
    try {
      const res = await apiFetch('/api/profiles/visibility');
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
    error = '';
    success = '';

    try {
      const res = await apiFetch('/api/profiles/visibility', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visibility: profileVisibility }),
      });

      const data = await res.json();
      if (data.success) {
        success = 'Profile visibility updated successfully';
        setTimeout(() => success = '', 3000);
      } else {
        error = data.error || 'Failed to update visibility';
      }
    } catch (err) {
      error = 'Network error. Please try again.';
      console.error('Failed to save visibility:', err);
    } finally {
      savingVisibility = false;
    }
  }

  async function loadTunnelStatus() {
    tunnelStatusLoading = true;
    try {
      const res = await apiFetch('/api/cloudflare/status');
      if (res.ok) {
        tunnelStatus = await res.json();
      } else {
        console.warn('Failed to load tunnel status');
      }
    } catch (err) {
      console.error('Failed to load tunnel status:', err);
    } finally {
      tunnelStatusLoading = false;
    }
  }

  async function setTunnelEnabled(enable: boolean) {
    if (tunnelActionPending) return;

    tunnelActionPending = true;
    error = '';
    success = '';

    try {
      const res = await apiFetch('/api/cloudflare/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: enable }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        success = enable ? 'Cloudflare tunnel enabled' : 'Cloudflare tunnel disabled';
        await loadTunnelStatus();
      } else {
        error = data.error || 'Failed to update Cloudflare tunnel';
      }
    } catch (err) {
      error = 'Network error. Please try again.';
      console.error('Failed to toggle tunnel:', err);
    } finally {
      tunnelActionPending = false;
    }
  }

  // Trust Level state
  let trustLevel = '';
  let trustOptions: string[] = [];
  let trustLoading = false;
  let trustSaving = false;

  // Persona Summary state
  let includePersonaSummary = true;
  let personaSummaryLoading = false;
  let personaSummarySaving = false;

  // Trust Coupling state
  let trustCoupled = true;
  let couplingLoading = false;
  let couplingSaving = false;

  async function loadTrustLevel() {
    trustLoading = true;
    try {
      const response = await apiFetch('/api/trust');
      const data = await response.json();
      if (response.ok) {
        trustLevel = data.level || 'observe';
        trustOptions = data.available || [];
      }
    } catch (err) {
      console.error('Failed to load trust level:', err);
    } finally {
      trustLoading = false;
    }
  }

  async function handleTrustLevelChange(event: Event) {
    const target = event.target as HTMLSelectElement;
    const newLevel = target.value;

    trustSaving = true;
    error = '';
    success = '';

    try {
      const response = await apiFetch('/api/trust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level: newLevel }),
      });

      const data = await response.json();

      if (data.ok) {
        trustLevel = newLevel;
        success = `Trust level changed to: ${newLevel}`;
        // Trigger status refresh
        statusRefreshTrigger.update(n => n + 1);
      } else {
        error = data.error || 'Failed to change trust level';
        // Revert the select
        target.value = trustLevel;
      }
    } catch (err) {
      error = 'Network error. Please try again.';
      console.error(err);
      // Revert the select
      target.value = trustLevel;
    } finally {
      trustSaving = false;
    }
  }

  async function loadAgentConfig() {
    personaSummaryLoading = true;
    try {
      const response = await apiFetch('/api/agent-config');
      const data = await response.json();
      if (response.ok && data.config) {
        includePersonaSummary = data.config.includePersonaSummary ?? true;
      }
    } catch (err) {
      console.error('Failed to load agent config:', err);
    } finally {
      personaSummaryLoading = false;
    }
  }

  async function handlePersonaSummaryToggle() {
    personaSummarySaving = true;
    error = '';
    success = '';

    try {
      const response = await apiFetch('/api/agent-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ includePersonaSummary: !includePersonaSummary }),
      });

      const data = await response.json();

      if (data.success) {
        includePersonaSummary = !includePersonaSummary;
        success = `Persona summary ${includePersonaSummary ? 'enabled' : 'disabled'}`;
      } else {
        error = data.error || 'Failed to update persona summary setting';
      }
    } catch (err) {
      error = 'Network error. Please try again.';
      console.error(err);
    } finally {
      personaSummarySaving = false;
    }
  }

  async function loadTrustCoupling() {
    couplingLoading = true;
    try {
      const response = await apiFetch('/api/trust-coupling');
      const data = await response.json();
      if (response.ok && data.success) {
        trustCoupled = data.coupled ?? true;
      }
    } catch (err) {
      console.error('Failed to load trust coupling:', err);
    } finally {
      couplingLoading = false;
    }
  }

  async function handleCouplingToggle() {
    couplingSaving = true;
    error = '';
    success = '';

    try {
      const response = await apiFetch('/api/trust-coupling', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coupled: !trustCoupled }),
      });

      const data = await response.json();

      if (data.success) {
        trustCoupled = !trustCoupled;
        success = `Trust level ${trustCoupled ? 'coupled to' : 'decoupled from'} cognitive mode`;
        // Trigger status refresh
        statusRefreshTrigger.update(n => n + 1);
      } else {
        error = data.error || 'Failed to toggle coupling';
      }
    } catch (err) {
      error = 'Network error. Please try again.';
      console.error(err);
    } finally {
      couplingSaving = false;
    }
  }

  // Cognitive Layers configuration state
  let cognitiveLayersConfig = {
    useCognitivePipeline: true,
    enableSafetyChecks: true,
    enableResponseRefinement: true,
    enableBlockingMode: false
  };
  let cognitiveLayersLoading = false;
  let cognitiveLayersSaving = false;

  async function loadCognitiveLayersConfig() {
    cognitiveLayersLoading = true;
    try {
      const response = await apiFetch('/api/cognitive-layers-config');
      const data = await response.json();
      if (response.ok && data.success && data.config) {
        cognitiveLayersConfig = data.config;
      }
    } catch (err) {
      console.error('Failed to load cognitive layers config:', err);
    } finally {
      cognitiveLayersLoading = false;
    }
  }

  async function handleCognitiveLayerToggle(setting: keyof typeof cognitiveLayersConfig) {
    cognitiveLayersSaving = true;
    error = '';
    success = '';

    try {
      const newConfig = {
        ...cognitiveLayersConfig,
        [setting]: !cognitiveLayersConfig[setting]
      };

      const response = await apiFetch('/api/cognitive-layers-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newConfig)
      });

      const data = await response.json();

      if (data.success) {
        cognitiveLayersConfig = data.config;
        success = `Cognitive layer setting updated successfully`;
      } else {
        error = data.error || 'Failed to update cognitive layer settings';
      }
    } catch (err) {
      error = 'Network error. Please try again.';
      console.error(err);
    } finally {
      cognitiveLayersSaving = false;
    }
  }

  // Recovery codes functions
  async function loadRecoveryCodes() {
    recoveryCodesLoading = true;
    try {
      const response = await apiFetch('/api/recovery-codes');
      const data = await response.json();
      if (response.ok && data.success) {
        recoveryCodes = data.codes || [];
      }
    } catch (err) {
      console.error('Failed to load recovery codes:', err);
    } finally {
      recoveryCodesLoading = false;
    }
  }

  async function handleRegenerateCodes() {
    regeneratingCodes = true;
    error = '';
    success = '';

    try {
      const response = await apiFetch('/api/recovery-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const data = await response.json();

      if (data.success) {
        recoveryCodes = data.codes;
        showRecoveryCodes = true;
        showRegenerateConfirm = false;
        success = 'Recovery codes regenerated successfully! Save them in a secure place.';
      } else {
        error = data.error || 'Failed to regenerate recovery codes';
      }
    } catch (err) {
      error = 'Network error. Please try again.';
      console.error(err);
    } finally {
      regeneratingCodes = false;
    }
  }

  function copyAllCodesToClipboard() {
    const codesText = recoveryCodes.join('\n');
    navigator.clipboard.writeText(codesText).then(() => {
      success = 'Recovery codes copied to clipboard!';
      setTimeout(() => success = '', 3000);
    }).catch((err) => {
      error = 'Failed to copy to clipboard';
      console.error(err);
    });
  }

  async function resetFactorySettings() {
    if (resettingFactory) return;
    const confirmed = window.confirm('This will erase all memories, logs, and conversations, and restore factory defaults. This action cannot be undone. Continue?');
    if (!confirmed) return;

    resettingFactory = true;
    try {
      const res = await apiFetch('/api/factory-reset', { method: 'POST' });
      if (!res.ok) throw new Error('Factory reset failed');
      alert('Factory reset complete. The page will now reload.');
      window.location.reload();
    } catch (err) {
      console.error('[SecuritySettings] Factory reset error:', err);
      alert(`Factory reset failed: ${(err as Error).message}`);
    } finally {
      resettingFactory = false;
    }
  }
</script>

<div class="p-8 max-w-3xl mx-auto h-full overflow-y-auto overflow-x-hidden">
  <div class="mb-8">
    <h1 class="text-3xl font-bold text-gray-900 dark:text-gray-100 m-0 mb-2">🔒 Security & Account Settings</h1>
    <p class="text-gray-500 dark:text-gray-400 m-0">Manage your authentication and profile information</p>
  </div>

  {#if loading}
    <div class="flex flex-col items-center justify-center py-16 px-8">
      <div class="w-10 h-10 border-3 border-violet-500/20 border-t-violet-500 rounded-full animate-spin"></div>
      <p class="mt-4 text-gray-500 dark:text-gray-400">Loading account information...</p>
    </div>
  {:else if !currentUser}
    <div class="flex flex-col items-center justify-center py-16 px-8 text-center">
      <svg class="w-16 h-16 text-gray-400 dark:text-gray-600 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
      </svg>
      <h2 class="text-2xl font-semibold text-gray-900 dark:text-gray-100 m-0 mb-2">Authentication Required</h2>
      <p class="text-gray-500 dark:text-gray-400 m-0 mb-6">Please login to access security settings</p>
      <a href="/" class="inline-block px-6 py-3 bg-gradient-to-r from-violet-500 to-pink-600 text-white no-underline rounded-lg font-semibold transition-transform hover:-translate-y-0.5">Go to Login</a>
    </div>
  {:else}
    {#if error}
      <div class="flex items-center gap-3 p-4 rounded-lg mb-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200">
        <svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>
        <span class="flex-1">{error}</span>
        <button on:click={() => error = ''} class="ml-auto bg-transparent border-none text-2xl cursor-pointer text-inherit opacity-60 hover:opacity-100">×</button>
      </div>
    {/if}

    {#if success}
      <div class="flex items-center gap-3 p-4 rounded-lg mb-4 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-200">
        <svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>
        <span class="flex-1">{success}</span>
        <button on:click={() => success = ''} class="ml-auto bg-transparent border-none text-2xl cursor-pointer text-inherit opacity-60 hover:opacity-100">×</button>
      </div>
    {/if}

    <!-- Current User Info -->
    <div class="panel mb-6">
      <h2 class="text-xl font-semibold text-gray-900 dark:text-gray-100 m-0 mb-4">Account Information</h2>
      <div class="flex flex-col gap-3">
        <div class="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-800 last:border-b-0">
          <span class="font-medium text-gray-500 dark:text-gray-400">Username:</span>
          <span class="font-medium text-gray-900 dark:text-gray-100">{currentUser.username}</span>
        </div>
        <div class="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-800 last:border-b-0">
          <span class="font-medium text-gray-500 dark:text-gray-400">Role:</span>
          <span class="inline-block px-3 py-1 rounded-full text-xs font-semibold uppercase {currentUser.role === 'owner' ? 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300' : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'}">{currentUser.role}</span>
        </div>
        {#if currentUser.metadata?.displayName}
          <div class="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-800 last:border-b-0">
            <span class="font-medium text-gray-500 dark:text-gray-400">Display Name:</span>
            <span class="font-medium text-gray-900 dark:text-gray-100">{currentUser.metadata.displayName}</span>
          </div>
        {/if}
        {#if currentUser.metadata?.email}
          <div class="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-800 last:border-b-0">
            <span class="font-medium text-gray-500 dark:text-gray-400">Email:</span>
            <span class="font-medium text-gray-900 dark:text-gray-100">{currentUser.metadata.email}</span>
          </div>
        {/if}
        {#if currentUser.createdAt}
          <div class="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-800 last:border-b-0">
            <span class="font-medium text-gray-500 dark:text-gray-400">Created:</span>
            <span class="font-medium text-gray-900 dark:text-gray-100">{new Date(currentUser.createdAt).toLocaleString()}</span>
          </div>
        {/if}
      </div>
    </div>

    <!-- Change Username -->
    <div class="panel mb-6">
      <h2 class="text-xl font-semibold text-gray-900 dark:text-gray-100 m-0 mb-4">Change Username</h2>
      {#if !showChangeUsername}
        <p class="text-gray-500 dark:text-gray-400 m-0 mb-4">Your current username is <strong class="text-gray-900 dark:text-gray-100">{currentUser.username}</strong></p>
        <button class="btn-primary" on:click={() => showChangeUsername = true}>
          Change Username
        </button>
      {:else}
        <form on:submit|preventDefault={handleChangeUsername}>
          <div class="mb-4">
            <label for="newUsername" class="block font-medium text-gray-700 dark:text-gray-300 mb-2">New Username</label>
            <input
              id="newUsername"
              type="text"
              bind:value={newUsername}
              placeholder="Enter new username"
              disabled={usernameChanging}
              required
              class="input-field"
            />
            <small class="block mt-1 text-sm text-gray-500 dark:text-gray-400">Username must be 3-50 characters, alphanumeric with underscore/hyphen</small>
          </div>
          <div class="flex gap-3">
            <button type="submit" class="btn-primary" disabled={usernameChanging}>
              {usernameChanging ? 'Changing...' : 'Save Username'}
            </button>
            <button type="button" class="btn-secondary" on:click={cancelChangeUsername} disabled={usernameChanging}>
              Cancel
            </button>
          </div>
        </form>
      {/if}
    </div>

    <!-- Change Password -->
    <div class="panel mb-6">
      <h2 class="text-xl font-semibold text-gray-900 dark:text-gray-100 m-0 mb-4">Change Password</h2>
      {#if !showChangePassword}
        <p class="text-gray-500 dark:text-gray-400 m-0 mb-4">Update your password to keep your account secure</p>
        <button class="btn-primary" on:click={() => showChangePassword = true}>
          Change Password
        </button>
      {:else}
        <form on:submit|preventDefault={handleChangePassword}>
          <div class="mb-4">
            <label for="currentPassword" class="block font-medium text-gray-700 dark:text-gray-300 mb-2">Current Password</label>
            <input
              id="currentPassword"
              type="password"
              bind:value={currentPassword}
              placeholder="Enter current password"
              disabled={passwordChanging}
              required
              class="input-field"
            />
          </div>
          <div class="mb-4">
            <label for="newPassword" class="block font-medium text-gray-700 dark:text-gray-300 mb-2">New Password</label>
            <input
              id="newPassword"
              type="password"
              bind:value={newPassword}
              placeholder="Enter new password"
              disabled={passwordChanging}
              required
              class="input-field"
            />
          </div>
          <div class="mb-4">
            <label for="confirmPassword" class="block font-medium text-gray-700 dark:text-gray-300 mb-2">Confirm New Password</label>
            <input
              id="confirmPassword"
              type="password"
              bind:value={confirmPassword}
              placeholder="Confirm new password"
              disabled={passwordChanging}
              required
              class="input-field"
            />
          </div>
          <div class="flex gap-3">
            <button type="submit" class="btn-primary" disabled={passwordChanging}>
              {passwordChanging ? 'Changing...' : 'Save Password'}
            </button>
            <button type="button" class="btn-secondary" on:click={cancelChangePassword} disabled={passwordChanging}>
              Cancel
            </button>
          </div>
        </form>
      {/if}
    </div>

    <!-- Recovery Codes -->
    <div class="panel mb-6">
      <h2 class="text-xl font-semibold text-gray-900 dark:text-gray-100 m-0 mb-4">🔑 Recovery Codes</h2>
      <p class="text-gray-500 dark:text-gray-400 m-0 mb-4">Use recovery codes to reset your password if you forget it. Each code can only be used once.</p>

      {#if recoveryCodesLoading}
        <p class="text-gray-500 dark:text-gray-400 italic">Loading recovery codes...</p>
      {:else}
        <div class="mb-6">
          <div class="mb-4">
            <strong class="text-lg text-gray-900 dark:text-gray-100">{recoveryCodes.length} of 10 codes remaining</strong>
          </div>
          {#if recoveryCodes.length <= 3 && recoveryCodes.length > 0}
            <div class="flex gap-3 p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-700 rounded-lg mb-4">
              <svg class="flex-shrink-0 w-5 h-5 text-yellow-600 dark:text-yellow-400" width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M8 1L1 14h14L8 1z" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
                <path d="M8 6v3M8 11v1" stroke="currentColor" stroke-width="2" />
              </svg>
              <div class="flex-1">
                <strong class="block text-yellow-800 dark:text-yellow-300 mb-1 text-sm">Low Recovery Codes</strong>
                <p class="m-0 text-sm text-yellow-700 dark:text-yellow-400">You have {recoveryCodes.length} code{recoveryCodes.length === 1 ? '' : 's'} remaining. Consider regenerating new codes soon.</p>
              </div>
            </div>
          {:else if recoveryCodes.length === 0}
            <div class="flex gap-3 p-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg mb-4">
              <svg class="flex-shrink-0 w-5 h-5 text-red-600 dark:text-red-400" width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M8 1L1 14h14L8 1z" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
                <path d="M8 6v3M8 11v1" stroke="currentColor" stroke-width="2" />
              </svg>
              <div class="flex-1">
                <strong class="block text-red-800 dark:text-red-300 mb-1 text-sm">No Recovery Codes Available</strong>
                <p class="m-0 text-sm text-red-700 dark:text-red-400">You have no recovery codes left. Regenerate codes immediately to ensure you can recover your account.</p>
              </div>
            </div>
          {/if}
        </div>

        <div class="flex flex-wrap gap-3 mb-4">
          {#if recoveryCodes.length > 0 && !showRecoveryCodes}
            <button class="btn-secondary" on:click={() => showRecoveryCodes = true}>
              View Remaining Codes
            </button>
          {/if}

          {#if !showRegenerateConfirm}
            <button
              class="btn-primary"
              on:click={() => showRegenerateConfirm = true}
              disabled={regeneratingCodes}
            >
              Regenerate All Codes
            </button>
          {:else}
            <div class="w-full p-4 bg-yellow-50 dark:bg-yellow-900/20 border-2 border-yellow-300 dark:border-yellow-700 rounded-lg">
              <p class="m-0 mb-2 text-yellow-800 dark:text-yellow-300"><strong>⚠️ Are you sure?</strong></p>
              <p class="m-0 mb-4 text-yellow-700 dark:text-yellow-400">This will invalidate all existing recovery codes and generate 10 new ones.</p>
              <div class="flex gap-3">
                <button
                  class="btn-primary"
                  on:click={handleRegenerateCodes}
                  disabled={regeneratingCodes}
                >
                  {regeneratingCodes ? 'Regenerating...' : 'Yes, Regenerate'}
                </button>
                <button
                  class="btn-secondary"
                  on:click={() => showRegenerateConfirm = false}
                  disabled={regeneratingCodes}
                >
                  Cancel
                </button>
              </div>
            </div>
          {/if}
        </div>

        {#if showRecoveryCodes && recoveryCodes.length > 0}
          <div class="mt-6 p-6 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
            <div class="flex justify-between items-center mb-4 pb-3 border-b border-gray-200 dark:border-gray-700">
              <h3 class="text-base font-semibold text-gray-900 dark:text-gray-100 m-0">Your Recovery Codes</h3>
              <button class="btn-sm" on:click={copyAllCodesToClipboard}>
                📋 Copy All
              </button>
            </div>
            <div class="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3 mb-4">
              {#each recoveryCodes as code, index}
                <div class="flex items-center gap-2 p-3 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md">
                  <span class="text-xs font-semibold text-gray-500 dark:text-gray-400">{(index + 1).toString().padStart(2, '0')}.</span>
                  <code class="font-mono text-sm font-semibold text-violet-500 dark:text-violet-400 tracking-wider">{code}</code>
                </div>
              {/each}
            </div>
            <button class="btn-secondary" on:click={() => showRecoveryCodes = false}>
              Hide Codes
            </button>
          </div>
        {/if}
      {/if}
    </div>

    <!-- Update Profile -->
    <div class="panel mb-6">
      <h2 class="text-xl font-semibold text-gray-900 dark:text-gray-100 m-0 mb-4">Profile Information</h2>
      {#if !showChangeProfile}
        <p class="text-gray-500 dark:text-gray-400 m-0 mb-4">Update your display name and email</p>
        <button class="btn-primary" on:click={() => showChangeProfile = true}>
          Update Profile
        </button>
      {:else}
        <form on:submit|preventDefault={handleChangeProfile}>
          <div class="mb-4">
            <label for="displayName" class="block font-medium text-gray-700 dark:text-gray-300 mb-2">Display Name</label>
            <input
              id="displayName"
              type="text"
              bind:value={newDisplayName}
              placeholder="Your display name"
              disabled={profileChanging}
              class="input-field"
            />
          </div>
          <div class="mb-4">
            <label for="email" class="block font-medium text-gray-700 dark:text-gray-300 mb-2">Email (optional)</label>
            <input
              id="email"
              type="email"
              bind:value={newEmail}
              placeholder="your@email.com"
              disabled={profileChanging}
              class="input-field"
            />
          </div>
          <div class="flex gap-3">
            <button type="submit" class="btn-primary" disabled={profileChanging}>
              {profileChanging ? 'Updating...' : 'Save Profile'}
            </button>
            <button type="button" class="btn-secondary" on:click={cancelChangeProfile} disabled={profileChanging}>
              Cancel
            </button>
          </div>
        </form>
      {/if}
    </div>

    <!-- Remote Access Controls -->
    <div class="panel mb-6">
      <h2 class="text-xl font-semibold text-gray-900 dark:text-gray-100 m-0 mb-4">🌐 Remote Access</h2>
      <p class="text-gray-500 dark:text-gray-400 m-0 mb-4">Enable the Cloudflare tunnel to allow secure remote connections back to your MetaHuman node.</p>

      {#if tunnelStatusLoading && !tunnelStatus}
        <p class="text-gray-500 dark:text-gray-400 italic">Checking tunnel status...</p>
      {:else if tunnelStatus}
        <div class="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3 mb-4">
          <div class="flex flex-col gap-1">
            <span class="font-medium text-gray-500 dark:text-gray-400">cloudflared</span>
            <span class="inline-flex items-center justify-center rounded-full px-3 py-1.5 text-sm font-semibold {tunnelStatus.installed ? 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300' : 'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300'}">
              {tunnelStatus.installed ? 'Installed' : 'Missing'}
            </span>
          </div>
          <div class="flex flex-col gap-1">
            <span class="font-medium text-gray-500 dark:text-gray-400">Remote access</span>
            <span class="inline-flex items-center justify-center rounded-full px-3 py-1.5 text-sm font-semibold {tunnelStatus.enabled ? 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300' : 'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300'}">
              {tunnelStatus.enabled ? 'Enabled' : 'Disabled'}
            </span>
          </div>
          <div class="flex flex-col gap-1">
            <span class="font-medium text-gray-500 dark:text-gray-400">Runtime</span>
            <span class="inline-flex items-center justify-center rounded-full px-3 py-1.5 text-sm font-semibold {tunnelStatus.running ? 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300' : 'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300'}">
              {tunnelStatus.running ? 'Running' : 'Stopped'}
            </span>
          </div>
        </div>
      {:else}
        <p class="text-gray-500 dark:text-gray-400 text-sm">Tunnel status is currently unavailable. Try refreshing.</p>
      {/if}

      <div class="flex flex-wrap gap-3 items-center mt-2">
        <button
          type="button"
          class="btn-primary"
          on:click={() => setTunnelEnabled(true)}
          disabled={tunnelActionPending || tunnelStatusLoading || !tunnelStatus || tunnelStatus.enabled || !tunnelStatus.installed}
        >
          {tunnelActionPending ? 'Working...' : 'Enable Tunnel'}
        </button>
        <button
          type="button"
          class="btn-secondary"
          on:click={() => setTunnelEnabled(false)}
          disabled={tunnelActionPending || tunnelStatusLoading || !tunnelStatus || !tunnelStatus.enabled}
        >
          {tunnelActionPending ? 'Working...' : 'Disable Tunnel'}
        </button>
        <button
          type="button"
          class="px-6 py-3 rounded-lg font-semibold text-sm bg-transparent border border-dashed border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-300 cursor-pointer transition-all hover:border-solid hover:text-gray-900 dark:hover:text-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
          on:click={loadTunnelStatus}
          disabled={tunnelStatusLoading || tunnelActionPending}
        >
          Refresh Status
        </button>
      </div>

      <p class="text-gray-500 dark:text-gray-400 text-sm mt-4">
        Need to start or stop the process? Use the Network tab for full Cloudflare controls.
      </p>
    </div>

    <!-- Trust Coupling (Owner Only) -->
    {#if currentUser.role === 'owner'}
      <div class="panel mb-6">
        <h2 class="text-xl font-semibold text-gray-900 dark:text-gray-100 m-0 mb-4">🔗 Trust & Cognitive Mode Coupling</h2>
        <p class="text-gray-500 dark:text-gray-400 m-0 mb-4">Link trust level to cognitive mode for automatic permission adjustment</p>
        {#if couplingLoading}
          <p class="text-gray-500 dark:text-gray-400 italic">Loading coupling state...</p>
        {:else}
          <div class="flex flex-col gap-3">
            <label class="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={trustCoupled}
                on:change={handleCouplingToggle}
                disabled={couplingSaving}
                class="hidden peer"
              />
              <span class="relative w-12 h-6 bg-gray-300 dark:bg-gray-600 rounded-full transition-colors peer-checked:bg-violet-500 after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:w-5 after:h-5 after:bg-white after:rounded-full after:transition-transform peer-checked:after:translate-x-6 peer-disabled:opacity-50"></span>
              <span class="font-medium text-gray-900 dark:text-gray-100">
                {trustCoupled ? 'Coupled (automatic)' : 'Decoupled (manual)'}
              </span>
            </label>
            {#if couplingSaving}
              <span class="text-violet-500 text-sm italic">Saving...</span>
            {/if}
          </div>
          <div class="mt-2 p-3 bg-gray-100 dark:bg-gray-800 rounded-lg border-l-3 border-violet-500">
            {#if trustCoupled}
              <small class="block text-gray-600 dark:text-gray-400 leading-relaxed">
                ✓ Trust level adjusts automatically when switching cognitive modes:<br>
                • <strong>Dual Consciousness</strong> → supervised_auto (full autonomy with logging)<br>
                • <strong>Agent Mode</strong> → suggest (approval required)<br>
                • <strong>Emulation</strong> → observe (read-only, no actions)
              </small>
            {:else}
              <small class="block text-gray-600 dark:text-gray-400 leading-relaxed">
                ⚠️ Trust level must be manually adjusted. Cognitive mode changes won't affect permissions.
              </small>
            {/if}
          </div>
        {/if}
      </div>

      <!-- Trust Level (Owner Only) -->
      <div class="panel mb-6">
        <h2 class="text-xl font-semibold text-gray-900 dark:text-gray-100 m-0 mb-4">🔐 Trust Level (Progressive Autonomy)</h2>
        <p class="text-gray-500 dark:text-gray-400 m-0 mb-4">Controls what skills the operator can access and whether actions require approval</p>
        {#if trustLoading}
          <p class="text-gray-500 dark:text-gray-400 italic">Loading trust level...</p>
        {:else}
          <div class="flex flex-col gap-4">
            <div class="mb-4">
              <label for="trustLevel" class="block font-medium text-gray-700 dark:text-gray-300 mb-2">Current Trust Level</label>
              <select
                id="trustLevel"
                bind:value={trustLevel}
                on:change={handleTrustLevelChange}
                disabled={trustSaving}
                class="select-field"
              >
                {#each trustOptions as option}
                  <option value={option}>{option}</option>
                {/each}
              </select>
              <small class="block mt-1 text-sm text-gray-500 dark:text-gray-400">
                {#if trustLevel === 'observe'}
                  Monitor only, no actions, learn patterns
                {:else if trustLevel === 'suggest'}
                  Propose actions, require explicit approval for each
                {:else if trustLevel === 'supervised_auto'}
                  Execute within approved categories, log all actions
                {:else if trustLevel === 'bounded_auto'}
                  Full autonomy within defined trust boundaries
                {:else if trustLevel === 'adaptive_auto'}
                  Self-expand boundaries based on successful outcomes
                {/if}
              </small>
            </div>
            <div class="p-3 bg-gray-100 dark:bg-gray-800 border-l-3 border-violet-500 rounded text-sm text-gray-700 dark:text-gray-300">
              <strong>Trust Progression:</strong> observe → suggest → supervised_auto → bounded_auto → adaptive_auto
            </div>
          </div>
        {/if}
      </div>

      <!-- Persona Summary Toggle -->
      <div class="panel mb-6">
        <h2 class="text-xl font-semibold text-gray-900 dark:text-gray-100 m-0 mb-4">🧠 Persona Summary</h2>
        <p class="text-gray-500 dark:text-gray-400 m-0 mb-4">Include your persona identity, values, and goals in chat context</p>
        {#if personaSummaryLoading}
          <p class="text-gray-500 dark:text-gray-400 italic">Loading persona summary setting...</p>
        {:else}
          <div class="flex flex-col gap-3">
            <label class="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={includePersonaSummary}
                on:change={handlePersonaSummaryToggle}
                disabled={personaSummarySaving}
                class="hidden peer"
              />
              <span class="relative w-12 h-6 bg-gray-300 dark:bg-gray-600 rounded-full transition-colors peer-checked:bg-violet-500 after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:w-5 after:h-5 after:bg-white after:rounded-full after:transition-transform peer-checked:after:translate-x-6 peer-disabled:opacity-50"></span>
              <span class="font-medium text-gray-900 dark:text-gray-100">
                {includePersonaSummary ? 'Enabled' : 'Disabled'}
              </span>
            </label>
            <small class="text-gray-500 dark:text-gray-400">
              When enabled, the AI will have access to your persona's identity, values, goals, and personality traits.
              This helps the AI respond more consistently with your configured personality.
            </small>
          </div>
        {/if}
      </div>

      <!-- Cognitive Architecture Safety Controls -->
      <div class="panel mb-6">
        <h2 class="text-xl font-semibold text-gray-900 dark:text-gray-100 m-0 mb-4">🛡️ Cognitive Architecture (Layer 3 Safety)</h2>
        <p class="text-gray-500 dark:text-gray-400 m-0 mb-4">Configure safety validation and response refinement for all AI responses</p>
        {#if cognitiveLayersLoading}
          <p class="text-gray-500 dark:text-gray-400 italic">Loading cognitive layer settings...</p>
        {:else}
          <div class="flex flex-col gap-6 mb-6">
            <!-- Master Switch -->
            <div class="flex justify-between items-start gap-4 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
              <div class="flex-1">
                <h3 class="text-base font-semibold text-gray-900 dark:text-gray-100 m-0 mb-1">3-Layer Pipeline</h3>
                <p class="text-sm text-gray-500 dark:text-gray-400 m-0 mb-2">Enable full cognitive architecture (context → generation → validation)</p>
              </div>
              <label class="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={cognitiveLayersConfig.useCognitivePipeline}
                  on:change={() => handleCognitiveLayerToggle('useCognitivePipeline')}
                  disabled={cognitiveLayersSaving}
                  class="hidden peer"
                />
                <span class="relative w-12 h-6 bg-gray-300 dark:bg-gray-600 rounded-full transition-colors peer-checked:bg-violet-500 after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:w-5 after:h-5 after:bg-white after:rounded-full after:transition-transform peer-checked:after:translate-x-6 peer-disabled:opacity-50"></span>
                <span class="font-medium text-gray-900 dark:text-gray-100">
                  {cognitiveLayersConfig.useCognitivePipeline ? 'Enabled' : 'Disabled'}
                </span>
              </label>
            </div>

            <!-- Safety Checks -->
            <div class="flex justify-between items-start gap-4 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 {!cognitiveLayersConfig.useCognitivePipeline ? 'opacity-50' : ''}">
              <div class="flex-1">
                <h3 class="text-base font-semibold text-gray-900 dark:text-gray-100 m-0 mb-1">Safety Validation (Phase 4.2)</h3>
                <p class="text-sm text-gray-500 dark:text-gray-400 m-0 mb-2">Pattern-based detection of sensitive data, security violations, and harmful content</p>
                <small class="block text-xs font-medium text-violet-500">Non-blocking • &lt;5ms overhead</small>
              </div>
              <label class="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={cognitiveLayersConfig.enableSafetyChecks}
                  on:change={() => handleCognitiveLayerToggle('enableSafetyChecks')}
                  disabled={cognitiveLayersSaving || !cognitiveLayersConfig.useCognitivePipeline}
                  class="hidden peer"
                />
                <span class="relative w-12 h-6 bg-gray-300 dark:bg-gray-600 rounded-full transition-colors peer-checked:bg-violet-500 after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:w-5 after:h-5 after:bg-white after:rounded-full after:transition-transform peer-checked:after:translate-x-6 peer-disabled:opacity-50"></span>
                <span class="font-medium text-gray-900 dark:text-gray-100">
                  {cognitiveLayersConfig.enableSafetyChecks ? 'Enabled' : 'Disabled'}
                </span>
              </label>
            </div>

            <!-- Response Refinement -->
            <div class="flex justify-between items-start gap-4 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 {!cognitiveLayersConfig.useCognitivePipeline ? 'opacity-50' : ''}">
              <div class="flex-1">
                <h3 class="text-base font-semibold text-gray-900 dark:text-gray-100 m-0 mb-1">Response Refinement (Phase 4.3)</h3>
                <p class="text-sm text-gray-500 dark:text-gray-400 m-0 mb-2">Auto-sanitize API keys, passwords, file paths, and internal IPs</p>
                <small class="block text-xs font-medium text-violet-500">Non-blocking • &lt;10ms average</small>
              </div>
              <label class="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={cognitiveLayersConfig.enableResponseRefinement}
                  on:change={() => handleCognitiveLayerToggle('enableResponseRefinement')}
                  disabled={cognitiveLayersSaving || !cognitiveLayersConfig.useCognitivePipeline}
                  class="hidden peer"
                />
                <span class="relative w-12 h-6 bg-gray-300 dark:bg-gray-600 rounded-full transition-colors peer-checked:bg-violet-500 after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:w-5 after:h-5 after:bg-white after:rounded-full after:transition-transform peer-checked:after:translate-x-6 peer-disabled:opacity-50"></span>
                <span class="font-medium text-gray-900 dark:text-gray-100">
                  {cognitiveLayersConfig.enableResponseRefinement ? 'Enabled' : 'Disabled'}
                </span>
              </label>
            </div>

            <!-- Blocking Mode -->
            <div class="flex justify-between items-start gap-4 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border-l-3 border-amber-500 border border-gray-200 dark:border-gray-700 {!cognitiveLayersConfig.enableResponseRefinement ? 'opacity-50' : ''}">
              <div class="flex-1">
                <h3 class="text-base font-semibold text-gray-900 dark:text-gray-100 m-0 mb-1">⚠️ Blocking Mode (Phase 4.4)</h3>
                <p class="text-sm text-gray-500 dark:text-gray-400 m-0 mb-2">Send refined (sanitized) responses to users instead of originals</p>
                <small class="block text-xs font-medium">
                  {#if cognitiveLayersConfig.enableBlockingMode}
                    <strong class="text-red-600 dark:text-red-400">ENFORCEMENT MODE ACTIVE</strong> - Users receive sanitized responses
                  {:else}
                    <strong class="text-gray-500 dark:text-gray-400">MONITORING MODE</strong> - Users receive original responses, refinements logged
                  {/if}
                </small>
              </div>
              <label class="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={cognitiveLayersConfig.enableBlockingMode}
                  on:change={() => handleCognitiveLayerToggle('enableBlockingMode')}
                  disabled={cognitiveLayersSaving || !cognitiveLayersConfig.enableResponseRefinement}
                  class="hidden peer"
                />
                <span class="relative w-12 h-6 bg-gray-300 dark:bg-gray-600 rounded-full transition-colors peer-checked:bg-violet-500 after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:w-5 after:h-5 after:bg-white after:rounded-full after:transition-transform peer-checked:after:translate-x-6 peer-disabled:opacity-50"></span>
                <span class="font-medium text-gray-900 dark:text-gray-100">
                  {cognitiveLayersConfig.enableBlockingMode ? 'Enforcement' : 'Monitoring'}
                </span>
              </label>
            </div>
          </div>

          <!-- Info Panel -->
          <div class="bg-gray-100 dark:bg-gray-800 rounded-lg p-4 border-l-3 border-violet-500">
            <h4 class="text-sm font-semibold text-gray-900 dark:text-gray-100 m-0 mb-3">What gets detected & refined:</h4>
            <div class="grid grid-cols-2 sm:grid-cols-1 gap-4 mb-3">
              <div class="text-xs">
                <strong class="block text-gray-700 dark:text-gray-300 mb-1">Sensitive Data:</strong>
                <ul class="m-0 pl-5 list-disc">
                  <li class="text-gray-500 dark:text-gray-400 mb-0.5">API keys (sk-*, pk-*, Bearer)</li>
                  <li class="text-gray-500 dark:text-gray-400 mb-0.5">Passwords & credentials</li>
                  <li class="text-gray-500 dark:text-gray-400 mb-0.5">SSH private keys</li>
                </ul>
              </div>
              <div class="text-xs">
                <strong class="block text-gray-700 dark:text-gray-300 mb-1">Security Violations:</strong>
                <ul class="m-0 pl-5 list-disc">
                  <li class="text-gray-500 dark:text-gray-400 mb-0.5">File paths (/home/, /etc/, C:\)</li>
                  <li class="text-gray-500 dark:text-gray-400 mb-0.5">Internal IPs (192.168.*, 10.*)</li>
                  <li class="text-gray-500 dark:text-gray-400 mb-0.5">System configurations</li>
                </ul>
              </div>
            </div>
            <small class="block text-xs text-gray-500 dark:text-gray-400 mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
              All Layer 3 operations are fully audited to <code class="bg-gray-200 dark:bg-gray-700 text-violet-500 px-1.5 py-0.5 rounded text-[0.6875rem] font-mono">logs/audit/YYYY-MM-DD.ndjson</code>
            </small>
          </div>
        {/if}
      </div>
    {/if}

    <!-- Danger Zone -->
    <div class="bg-red-50 dark:bg-red-900/20 border-2 border-red-500 rounded-xl p-6 mb-6">
      <h2 class="text-xl font-semibold text-red-800 dark:text-red-200 m-0 mb-4">⚠️ Danger Zone</h2>
      <p class="text-sm text-red-700 dark:text-red-300 m-0 mb-4">
        Critical operations that can permanently affect your account, data, and system configuration. Proceed with caution.
      </p>

      <!-- Profile Visibility -->
      <div class="py-6 border-b border-red-500/30 first:pt-0 last:border-b-0 last:pb-0">
        <h3 class="text-lg font-semibold text-red-800 dark:text-red-200 m-0 mb-3">🌍 Profile Visibility</h3>
        <p class="text-sm text-red-700 dark:text-red-300 m-0 mb-4">Control who can view your profile as a guest user</p>

        <div class="mb-4">
          <select
            bind:value={profileVisibility}
            on:change={saveVisibility}
            disabled={savingVisibility}
            class="select-field"
          >
            <option value="private">🔒 Private - Owner only</option>
            <option value="public">🌍 Public - Anyone (including anonymous)</option>
          </select>
        </div>

        {#if profileVisibility === 'public'}
          <div class="flex gap-3 p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-700 rounded-lg">
            <svg class="flex-shrink-0 w-5 h-5 text-yellow-600 dark:text-yellow-400" width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M8 1L1 14h14L8 1z"
                stroke="currentColor"
                stroke-width="2"
                stroke-linejoin="round"
              />
              <path d="M8 6v3M8 11v1" stroke="currentColor" stroke-width="2" />
            </svg>
            <div class="flex-1">
              <strong class="block text-yellow-800 dark:text-yellow-300 mb-1 text-sm">Public Profile Warning</strong>
              <p class="m-0 text-sm text-yellow-700 dark:text-yellow-400">
                Guest users will be able to interact with your persona in read-only
                emulation mode. They cannot modify your data or access private information.
              </p>
            </div>
          </div>
        {/if}
      </div>

      <!-- Profile Deletion / Account Removal -->
      <div class="py-6 border-b border-red-500/30 first:pt-0 last:border-b-0 last:pb-0">
        {#if currentUser.role === 'owner'}
          <ProfileDangerZone bind:this={profileDangerZone} />
        {:else if currentUser.role === 'standard'}
          <ProfileDangerZone />
        {/if}
      </div>

      <!-- Factory Reset (Owner Only) -->
      {#if currentUser.role === 'owner'}
        <div class="py-6 border-b border-red-500/30 first:pt-0 last:border-b-0 last:pb-0">
          <h3 class="text-lg font-semibold text-red-800 dark:text-red-200 m-0 mb-3">⚠️ Factory Reset</h3>
          <p class="text-sm text-red-700 dark:text-red-300 m-0 mb-4">
            Delete all memories, conversations, and logs, and restore the default GPT-OSS base model. This action is permanent and cannot be undone.
          </p>
          <button class="btn-danger" on:click={resetFactorySettings} disabled={resettingFactory}>
            {resettingFactory ? 'Resetting…' : 'Reset to Factory Settings'}
          </button>
        </div>
      {/if}
    </div>

    <!-- Security Information -->
    <div class="panel mb-6">
      <h2 class="text-xl font-semibold text-gray-900 dark:text-gray-100 m-0 mb-4">Security Information</h2>
      <ul class="m-0 pl-6">
        <li class="text-gray-500 dark:text-gray-400 mb-2">Your password is hashed and never stored in plain text</li>
        <li class="text-gray-500 dark:text-gray-400 mb-2">Session cookies are HTTPOnly and secure</li>
        <li class="text-gray-500 dark:text-gray-400 mb-2">Owner sessions last 24 hours, guest sessions last 1 hour</li>
        <li class="text-gray-500 dark:text-gray-400 mb-2">Clear your browser cookies to log out from all devices</li>
        {#if currentUser.role === 'owner'}
          <li class="text-gray-500 dark:text-gray-400 mb-2">Trust level changes are audited and logged for security</li>
          <li class="text-gray-500 dark:text-gray-400 mb-2">All skill executions respect the current trust level</li>
        {/if}
      </ul>
    </div>
  {/if}
</div>

<style>
  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .animate-spin {
    animation: spin 0.8s linear infinite;
  }

  .border-3 {
    border-width: 3px;
  }

  .border-l-3 {
    border-left-width: 3px;
  }
</style>
