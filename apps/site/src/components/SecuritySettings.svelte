<script lang="ts">
  import { onMount } from 'svelte';
  import { statusRefreshTrigger } from '../stores/navigation';
  import ProfileDangerZone from './ProfileDangerZone.svelte';
  import ProfileCreation from './ProfileCreation.svelte';

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

  // Profile visibility state
  let profileVisibility: 'private' | 'public' = 'private';
  let savingVisibility = false;

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

  onMount(async () => {
    await fetchCurrentUser();
    await loadTrustLevel();
    await loadAgentConfig();
    await loadTrustCoupling();
    await loadCognitiveLayersConfig();
    await fetchVisibility();
    await loadTunnelStatus();
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

  // Profile visibility functions
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
    error = '';
    success = '';

    try {
      const res = await fetch('/api/profiles/visibility', {
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
      const res = await fetch('/api/cloudflare/status');
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
      const res = await fetch('/api/cloudflare/toggle', {
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
      const response = await fetch('/api/trust');
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
      const response = await fetch('/api/trust', {
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
      const response = await fetch('/api/agent-config');
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
      const response = await fetch('/api/agent-config', {
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
      const response = await fetch('/api/trust-coupling');
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
      const response = await fetch('/api/trust-coupling', {
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
      const response = await fetch('/api/cognitive-layers-config');
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

      const response = await fetch('/api/cognitive-layers-config', {
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
      <a href="/" class="login-button">Go to Login</a>
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

    <!-- Profile Visibility -->
    <div class="card">
      <h2>🌍 Profile Visibility</h2>
      <p>Control who can view your profile as a guest user</p>

      <div class="form-group">
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

    <!-- Remote Access Controls -->
    <div class="card">
      <h2>🌐 Remote Access</h2>
      <p>Enable the Cloudflare tunnel to allow secure remote connections back to your MetaHuman node.</p>

      {#if tunnelStatusLoading && !tunnelStatus}
        <p class="loading-text">Checking tunnel status...</p>
      {:else if tunnelStatus}
        <div class="tunnel-status-grid">
          <div class="tunnel-status-row">
            <span class="label">cloudflared</span>
            <span class="status-pill" class:status-pill-ok={tunnelStatus.installed} class:status-pill-bad={!tunnelStatus.installed}>
              {tunnelStatus.installed ? 'Installed' : 'Missing'}
            </span>
          </div>
          <div class="tunnel-status-row">
            <span class="label">Remote access</span>
            <span class="status-pill" class:status-pill-ok={tunnelStatus.enabled} class:status-pill-bad={!tunnelStatus.enabled}>
              {tunnelStatus.enabled ? 'Enabled' : 'Disabled'}
            </span>
          </div>
          <div class="tunnel-status-row">
            <span class="label">Runtime</span>
            <span class="status-pill" class:status-pill-ok={tunnelStatus.running} class:status-pill-bad={!tunnelStatus.running}>
              {tunnelStatus.running ? 'Running' : 'Stopped'}
            </span>
          </div>
        </div>
      {:else}
        <p class="muted-text">Tunnel status is currently unavailable. Try refreshing.</p>
      {/if}

      <div class="remote-actions">
        <button
          type="button"
          class="btn btn-primary"
          on:click={() => setTunnelEnabled(true)}
          disabled={tunnelActionPending || tunnelStatusLoading || !tunnelStatus || tunnelStatus.enabled || !tunnelStatus.installed}
        >
          {tunnelActionPending ? 'Working...' : 'Enable Tunnel'}
        </button>
        <button
          type="button"
          class="btn btn-secondary"
          on:click={() => setTunnelEnabled(false)}
          disabled={tunnelActionPending || tunnelStatusLoading || !tunnelStatus || !tunnelStatus.enabled}
        >
          {tunnelActionPending ? 'Working...' : 'Disable Tunnel'}
        </button>
        <button
          type="button"
          class="btn btn-secondary btn-ghost"
          on:click={loadTunnelStatus}
          disabled={tunnelStatusLoading || tunnelActionPending}
        >
          Refresh Status
        </button>
      </div>

      <p class="helper-text">
        Need to start or stop the process? Use the Network tab for full Cloudflare controls.
      </p>
    </div>

    <!-- Trust Coupling (Owner Only) -->
    {#if currentUser.role === 'owner'}
      <div class="card">
        <h2>🔗 Trust & Cognitive Mode Coupling</h2>
        <p>Link trust level to cognitive mode for automatic permission adjustment</p>
        {#if couplingLoading}
          <p class="loading-text">Loading coupling state...</p>
        {:else}
          <div class="toggle-control">
            <label class="toggle-label">
              <input
                type="checkbox"
                checked={trustCoupled}
                on:change={handleCouplingToggle}
                disabled={couplingSaving}
              />
              <span class="toggle-switch"></span>
              <span class="toggle-text">
                {trustCoupled ? 'Coupled (automatic)' : 'Decoupled (manual)'}
              </span>
            </label>
            {#if couplingSaving}
              <span class="saving-indicator">Saving...</span>
            {/if}
          </div>
          <div class="coupling-info">
            {#if trustCoupled}
              <small>
                ✓ Trust level adjusts automatically when switching cognitive modes:<br>
                • <strong>Dual Consciousness</strong> → supervised_auto (full autonomy with logging)<br>
                • <strong>Agent Mode</strong> → suggest (approval required)<br>
                • <strong>Emulation</strong> → observe (read-only, no actions)
              </small>
            {:else}
              <small>
                ⚠️ Trust level must be manually adjusted. Cognitive mode changes won't affect permissions.
              </small>
            {/if}
          </div>
        {/if}
      </div>

      <!-- Trust Level (Owner Only) -->
      <div class="card">
        <h2>🔐 Trust Level (Progressive Autonomy)</h2>
        <p>Controls what skills the operator can access and whether actions require approval</p>
        {#if trustLoading}
          <p class="loading-text">Loading trust level...</p>
        {:else}
          <div class="trust-level-control">
            <div class="form-group">
              <label for="trustLevel">Current Trust Level</label>
              <select
                id="trustLevel"
                bind:value={trustLevel}
                on:change={handleTrustLevelChange}
                disabled={trustSaving}
              >
                {#each trustOptions as option}
                  <option value={option}>{option}</option>
                {/each}
              </select>
              <small>
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
            <div class="trust-info">
              <strong>Trust Progression:</strong> observe → suggest → supervised_auto → bounded_auto → adaptive_auto
            </div>
          </div>
        {/if}
      </div>

      <!-- Persona Summary Toggle -->
      <div class="card">
        <h2>🧠 Persona Summary</h2>
        <p>Include your persona identity, values, and goals in chat context</p>
        {#if personaSummaryLoading}
          <p class="loading-text">Loading persona summary setting...</p>
        {:else}
          <div class="toggle-control">
            <label class="toggle-label">
              <input
                type="checkbox"
                checked={includePersonaSummary}
                on:change={handlePersonaSummaryToggle}
                disabled={personaSummarySaving}
              />
              <span class="toggle-slider"></span>
              <span class="toggle-text">
                {includePersonaSummary ? 'Enabled' : 'Disabled'}
              </span>
            </label>
            <small>
              When enabled, the AI will have access to your persona's identity, values, goals, and personality traits.
              This helps the AI respond more consistently with your configured personality.
            </small>
          </div>
        {/if}
      </div>

      <!-- Cognitive Architecture Safety Controls -->
      <div class="card">
        <h2>🛡️ Cognitive Architecture (Layer 3 Safety)</h2>
        <p>Configure safety validation and response refinement for all AI responses</p>
        {#if cognitiveLayersLoading}
          <p class="loading-text">Loading cognitive layer settings...</p>
        {:else}
          <div class="cognitive-layers-grid">
            <!-- Master Switch -->
            <div class="setting-row">
              <div class="setting-header">
                <h3>3-Layer Pipeline</h3>
                <p class="setting-description">Enable full cognitive architecture (context → generation → validation)</p>
              </div>
              <label class="toggle-label">
                <input
                  type="checkbox"
                  checked={cognitiveLayersConfig.useCognitivePipeline}
                  on:change={() => handleCognitiveLayerToggle('useCognitivePipeline')}
                  disabled={cognitiveLayersSaving}
                />
                <span class="toggle-switch"></span>
                <span class="toggle-text">
                  {cognitiveLayersConfig.useCognitivePipeline ? 'Enabled' : 'Disabled'}
                </span>
              </label>
            </div>

            <!-- Safety Checks -->
            <div class="setting-row" class:disabled={!cognitiveLayersConfig.useCognitivePipeline}>
              <div class="setting-header">
                <h3>Safety Validation (Phase 4.2)</h3>
                <p class="setting-description">Pattern-based detection of sensitive data, security violations, and harmful content</p>
                <small class="setting-meta">Non-blocking • &lt;5ms overhead</small>
              </div>
              <label class="toggle-label">
                <input
                  type="checkbox"
                  checked={cognitiveLayersConfig.enableSafetyChecks}
                  on:change={() => handleCognitiveLayerToggle('enableSafetyChecks')}
                  disabled={cognitiveLayersSaving || !cognitiveLayersConfig.useCognitivePipeline}
                />
                <span class="toggle-switch"></span>
                <span class="toggle-text">
                  {cognitiveLayersConfig.enableSafetyChecks ? 'Enabled' : 'Disabled'}
                </span>
              </label>
            </div>

            <!-- Response Refinement -->
            <div class="setting-row" class:disabled={!cognitiveLayersConfig.useCognitivePipeline}>
              <div class="setting-header">
                <h3>Response Refinement (Phase 4.3)</h3>
                <p class="setting-description">Auto-sanitize API keys, passwords, file paths, and internal IPs</p>
                <small class="setting-meta">Non-blocking • &lt;10ms average</small>
              </div>
              <label class="toggle-label">
                <input
                  type="checkbox"
                  checked={cognitiveLayersConfig.enableResponseRefinement}
                  on:change={() => handleCognitiveLayerToggle('enableResponseRefinement')}
                  disabled={cognitiveLayersSaving || !cognitiveLayersConfig.useCognitivePipeline}
                />
                <span class="toggle-switch"></span>
                <span class="toggle-text">
                  {cognitiveLayersConfig.enableResponseRefinement ? 'Enabled' : 'Disabled'}
                </span>
              </label>
            </div>

            <!-- Blocking Mode -->
            <div class="setting-row blocking-mode" class:disabled={!cognitiveLayersConfig.enableResponseRefinement}>
              <div class="setting-header">
                <h3>⚠️ Blocking Mode (Phase 4.4)</h3>
                <p class="setting-description">Send refined (sanitized) responses to users instead of originals</p>
                <small class="setting-meta">
                  {#if cognitiveLayersConfig.enableBlockingMode}
                    <strong class="enforcement-mode">ENFORCEMENT MODE ACTIVE</strong> - Users receive sanitized responses
                  {:else}
                    <strong class="monitoring-mode">MONITORING MODE</strong> - Users receive original responses, refinements logged
                  {/if}
                </small>
              </div>
              <label class="toggle-label">
                <input
                  type="checkbox"
                  checked={cognitiveLayersConfig.enableBlockingMode}
                  on:change={() => handleCognitiveLayerToggle('enableBlockingMode')}
                  disabled={cognitiveLayersSaving || !cognitiveLayersConfig.enableResponseRefinement}
                />
                <span class="toggle-switch"></span>
                <span class="toggle-text">
                  {cognitiveLayersConfig.enableBlockingMode ? 'Enforcement' : 'Monitoring'}
                </span>
              </label>
            </div>
          </div>

          <!-- Info Panel -->
          <div class="cognitive-info-panel">
            <h4>What gets detected & refined:</h4>
            <div class="detection-grid">
              <div class="detection-category">
                <strong>Sensitive Data:</strong>
                <ul>
                  <li>API keys (sk-*, pk-*, Bearer)</li>
                  <li>Passwords & credentials</li>
                  <li>SSH private keys</li>
                </ul>
              </div>
              <div class="detection-category">
                <strong>Security Violations:</strong>
                <ul>
                  <li>File paths (/home/, /etc/, C:\)</li>
                  <li>Internal IPs (192.168.*, 10.*)</li>
                  <li>System configurations</li>
                </ul>
              </div>
            </div>
            <small class="info-footer">
              All Layer 3 operations are fully audited to <code>logs/audit/YYYY-MM-DD.ndjson</code>
            </small>
          </div>
        {/if}
      </div>
    {/if}

    <!-- Profile Creation (Owner Only) -->
    {#if currentUser.role === 'owner'}
      <ProfileCreation onProfileCreated={() => profileDangerZone?.refreshProfiles()} />
    {/if}

    <!-- Profile Deletion (Owner Only) -->
    {#if currentUser.role === 'owner'}
      <ProfileDangerZone bind:this={profileDangerZone} />
    {/if}

    <!-- Security Information -->
    <div class="card info-card">
      <h2>Security Information</h2>
      <ul>
        <li>Your password is hashed and never stored in plain text</li>
        <li>Session cookies are HTTPOnly and secure</li>
        <li>Owner sessions last 24 hours, guest sessions last 1 hour</li>
        <li>Clear your browser cookies to log out from all devices</li>
        {#if currentUser.role === 'owner'}
          <li>Trust level changes are audited and logged for security</li>
          <li>All skill executions respect the current trust level</li>
        {/if}
      </ul>
    </div>
  {/if}
</div>

<style>
  .security-container {
    padding: 2rem;
    max-width: 800px;
    margin: 0 auto;
    height: 100%;
    overflow-y: auto;
    overflow-x: hidden;
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

  .tunnel-status-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 0.75rem;
    margin-bottom: 1rem;
  }

  .tunnel-status-row {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .status-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 9999px;
    padding: 0.35rem 0.85rem;
    font-size: 0.85rem;
    font-weight: 600;
    background: rgb(229 231 235);
    color: rgb(55 65 81);
  }

  :global(.dark) .status-pill {
    background: rgb(31 41 55);
    color: rgb(229 231 235);
  }

  .status-pill-ok {
    background: rgb(209 250 229);
    color: rgb(22 101 52);
  }

  :global(.dark) .status-pill-ok {
    background: rgb(20 83 45);
    color: rgb(187 247 208);
  }

  .status-pill-bad {
    background: rgb(254 226 226);
    color: rgb(153 27 27);
  }

  :global(.dark) .status-pill-bad {
    background: rgb(127 29 29);
    color: rgb(254 226 226);
  }

  .remote-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    align-items: center;
    margin-top: 0.5rem;
  }

  .muted-text {
    color: rgb(107 114 128);
    font-size: 0.9rem;
  }

  :global(.dark) .muted-text {
    color: rgb(156 163 175);
  }

  .helper-text {
    color: rgb(107 114 128);
    font-size: 0.9rem;
    margin-top: 1rem;
  }

  :global(.dark) .helper-text {
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

  .btn-ghost {
    background: transparent;
    border: 1px dashed rgb(209 213 219);
    color: rgb(107 114 128);
  }

  :global(.dark) .btn-ghost {
    border-color: rgb(75 85 99);
    color: rgb(209 213 219);
  }

  .btn-ghost:hover:not(:disabled) {
    border-style: solid;
    color: rgb(31 41 55);
  }

  :global(.dark) .btn-ghost:hover:not(:disabled) {
    color: rgb(243 244 246);
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

  .loading-text {
    color: rgb(107 114 128);
    font-style: italic;
  }

  :global(.dark) .loading-text {
    color: rgb(156 163 175);
  }

  .trust-level-control {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .trust-info {
    padding: 0.75rem;
    background: rgb(243 244 246);
    border-left: 3px solid rgb(139, 92, 246);
    border-radius: 0.25rem;
    font-size: 0.875rem;
    color: rgb(55 65 81);
  }

  :global(.dark) .trust-info {
    background: rgb(31 41 55);
    color: rgb(209 213 219);
  }

  .form-group select {
    width: 100%;
    padding: 0.75rem;
    border: 1px solid rgb(209 213 219);
    border-radius: 0.5rem;
    font-size: 1rem;
    background: white;
    color: rgb(17 24 39);
    cursor: pointer;
  }

  :global(.dark) .form-group select {
    background: rgb(31 41 55);
    border-color: rgb(55 65 81);
    color: rgb(243 244 246);
  }

  .form-group select:focus {
    outline: none;
    border-color: rgb(139, 92, 246);
    box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.1);
  }

  .form-group select:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .toggle-control {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .toggle-label {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    cursor: pointer;
  }

  .toggle-label input[type="checkbox"] {
    display: none;
  }

  .toggle-slider,
  .toggle-switch {
    position: relative;
    width: 48px;
    height: 24px;
    background: rgb(209 213 219);
    border-radius: 9999px;
    transition: background 0.2s;
  }

  :global(.dark) .toggle-slider,
  :global(.dark) .toggle-switch {
    background: rgb(55 65 81);
  }

  .toggle-slider::after,
  .toggle-switch::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 20px;
    height: 20px;
    background: white;
    border-radius: 50%;
    transition: transform 0.2s;
  }

  .toggle-label input:checked + .toggle-slider,
  .toggle-label input:checked + .toggle-switch {
    background: rgb(139, 92, 246);
  }

  .toggle-label input:checked + .toggle-slider::after,
  .toggle-label input:checked + .toggle-switch::after {
    transform: translateX(24px);
  }

  .toggle-label input:disabled + .toggle-slider,
  .toggle-label input:disabled + .toggle-switch {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .toggle-text {
    font-weight: 500;
    color: rgb(17 24 39);
  }

  :global(.dark) .toggle-text {
    color: rgb(243 244 246);
  }

  .coupling-info {
    margin-top: 0.5rem;
    padding: 0.75rem;
    background: rgb(243 244 246);
    border-radius: 0.5rem;
    border-left: 3px solid rgb(139, 92, 246);
  }

  :global(.dark) .coupling-info {
    background: rgb(31 41 55);
  }

  .coupling-info small {
    display: block;
    color: rgb(75 85 99);
    line-height: 1.6;
  }

  :global(.dark) .coupling-info small {
    color: rgb(156 163 175);
  }

  .saving-indicator {
    color: rgb(139, 92, 246);
    font-size: 0.875rem;
    font-style: italic;
  }

  /* Cognitive Layers Styles */
  .cognitive-layers-grid {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    margin-bottom: 1.5rem;
  }

  .setting-row {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 1rem;
    padding: 1rem;
    background: rgb(249 250 251);
    border-radius: 0.5rem;
    border: 1px solid rgb(229 231 235);
  }

  :global(.dark) .setting-row {
    background: rgb(31 41 55);
    border-color: rgb(55 65 81);
  }

  .setting-row.disabled {
    opacity: 0.5;
  }

  .setting-row.blocking-mode {
    border-left: 3px solid rgb(245 158 11);
  }

  .setting-header {
    flex: 1;
  }

  .setting-header h3 {
    font-size: 1rem;
    font-weight: 600;
    color: rgb(17 24 39);
    margin: 0 0 0.25rem 0;
  }

  :global(.dark) .setting-header h3 {
    color: rgb(243 244 246);
  }

  .setting-description {
    font-size: 0.875rem;
    color: rgb(107 114 128);
    margin: 0 0 0.5rem 0;
  }

  :global(.dark) .setting-description {
    color: rgb(156 163 175);
  }

  .setting-meta {
    display: block;
    font-size: 0.75rem;
    color: rgb(139, 92, 246);
    font-weight: 500;
  }

  .enforcement-mode {
    color: rgb(220 38 38);
  }

  :global(.dark) .enforcement-mode {
    color: rgb(252 165 165);
  }

  .monitoring-mode {
    color: rgb(107 114 128);
  }

  :global(.dark) .monitoring-mode {
    color: rgb(156 163 175);
  }

  .cognitive-info-panel {
    background: rgb(243 244 246);
    border-radius: 0.5rem;
    padding: 1rem;
    border-left: 3px solid rgb(139, 92, 246);
  }

  :global(.dark) .cognitive-info-panel {
    background: rgb(31 41 55);
  }

  .cognitive-info-panel h4 {
    font-size: 0.875rem;
    font-weight: 600;
    color: rgb(17 24 39);
    margin: 0 0 0.75rem 0;
  }

  :global(.dark) .cognitive-info-panel h4 {
    color: rgb(243 244 246);
  }

  .detection-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
    margin-bottom: 0.75rem;
  }

  @media (max-width: 640px) {
    .detection-grid {
      grid-template-columns: 1fr;
    }
  }

  .detection-category {
    font-size: 0.75rem;
  }

  .detection-category strong {
    display: block;
    color: rgb(55 65 81);
    margin-bottom: 0.25rem;
  }

  :global(.dark) .detection-category strong {
    color: rgb(209 213 219);
  }

  .detection-category ul {
    margin: 0;
    padding-left: 1.25rem;
    list-style-type: disc;
  }

  .detection-category li {
    color: rgb(107 114 128);
    margin-bottom: 0.125rem;
  }

  :global(.dark) .detection-category li {
    color: rgb(156 163 175);
  }

  .info-footer {
    display: block;
    font-size: 0.75rem;
    color: rgb(107 114 128);
    margin-top: 0.75rem;
    padding-top: 0.75rem;
    border-top: 1px solid rgb(229 231 235);
  }

  :global(.dark) .info-footer {
    color: rgb(156 163 175);
    border-color: rgb(55 65 81);
  }

  .info-footer code {
    background: rgb(229 231 235);
    color: rgb(139, 92, 246);
    padding: 0.125rem 0.375rem;
    border-radius: 0.25rem;
    font-size: 0.6875rem;
    font-family: monospace;
  }

  :global(.dark) .info-footer code {
    background: rgb(55 65 81);
  }
</style>
