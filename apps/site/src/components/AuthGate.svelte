<script lang="ts">
  import { onMount } from 'svelte';
  import OnboardingWizard from './OnboardingWizard.svelte';
  import ProfileSelector from './ProfileSelector.svelte';
  import { apiFetch, getApiBaseUrl, initServerUrl, getSyncServerUrl, remoteFetch, normalizeUrl, isMobileApp } from '../lib/client/api-config';
  import { healthStatus, forceHealthCheck } from '../lib/client/server-health';
  import { canSyncOnLogin } from '../lib/client/sync-settings';
  import { runTriggerNow } from '../lib/stores/trigger-manager';
  import { clearSecurityPolicy, fetchSecurityPolicy } from '../stores/security-policy';

  function storeSession(sessionId: string, username: string): void {
    if (!isMobileApp()) return;
    localStorage.setItem('mh_session', JSON.stringify({ sessionId, username }));
  }

  function clearStoredSession(): void {
    localStorage.removeItem('mh_session');
  }

  let handlingAuthFailure = false;
  let apiActionNotice: { state: 'pending' | 'success' | 'error'; message: string } | null = null;
  let apiActionNoticeTimer: ReturnType<typeof setTimeout> | null = null;

  async function clearServerSessionCookie(): Promise<void> {
    try {
      await fetch(`${getApiBaseUrl()}/api/auth/logout`, {
        method: 'POST',
        credentials: 'same-origin',
      });
    } catch (err) {
      console.warn('[AuthGate] Failed to clear server session cookie:', err);
    }
  }

  async function handleApiAuthFailure(event: Event): Promise<void> {
    const detail = (event as CustomEvent<{ status?: number; path?: string; payload?: unknown }>).detail;
    if (handlingAuthFailure || !isAuthenticated) return;

    handlingAuthFailure = true;
    console.warn('[AuthGate] API auth failure detected:', detail);
    clearStoredSession();
    clearSecurityPolicy();
    await clearServerSessionCookie();

    error = 'Your session expired or became invalid. Please log in again.';
    view = 'login';
    isAuthenticated = false;
    isCheckingAuth = false;
    handlingAuthFailure = false;
  }

  function handleApiAction(event: Event): void {
    const detail = (event as CustomEvent<{
      state?: 'pending' | 'success' | 'error';
      message?: string;
    }>).detail;
    if (!detail?.state || !detail.message) return;

    if (apiActionNoticeTimer) {
      clearTimeout(apiActionNoticeTimer);
      apiActionNoticeTimer = null;
    }

    apiActionNotice = {
      state: detail.state,
      message: detail.message,
    };

    if (detail.state !== 'pending') {
      apiActionNoticeTimer = setTimeout(() => {
        apiActionNotice = null;
        apiActionNoticeTimer = null;
      }, detail.state === 'success' ? 2200 : 6000);
    }
  }

  let view: 'splash' | 'login' | 'register' | 'register-type' | 'register-local' | 'post-register' | 'onboarding' | 'forgot-password' | 'recovery-codes' | 'sync-prompt' = 'splash';
  let isAuthenticated = false;
  let isCheckingAuth = true;
  let error = '';
  let loading = false;
  let showProfileSelector = false;
  let guestSessionError = '';
  let successMessage = '';

  // Server connection state
  let serverConnected = false;

  // Form fields
  let username = '';
  let password = '';
  let confirmPassword = '';
  let displayName = '';
  let email = '';

  // Local profile options
  let profileType: 'local' | 'server' = 'local';  // Default to local-first

  // Sync server URL (for pulling profiles from a remote server)
  let syncServerUrl = getSyncServerUrl();
  let syncLoading = false;

  // Recovery code fields
  let recoveryCode = '';
  let newPassword = '';
  let confirmNewPassword = '';
  let generatedRecoveryCodes: string[] = [];
  let registeredUsername = '';

  // Track if login failure suggests user doesn't exist (for sync hint)
  let showSyncHint = false;

  // Agreement checkboxes
  let agreeToTerms = false;
  let agreeToEthicalUse = false;

  // Subscribe to health status
  $: serverConnected = $healthStatus.connected;

  // Check if user is already authenticated
  async function checkAuth() {
    console.log('[AuthGate] checkAuth() starting');

    try {
      const res = await apiFetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        if (data.user) {
          console.log('[AuthGate] Auth successful for:', data.user.username);
          await fetchSecurityPolicy();
          isAuthenticated = true;
          isCheckingAuth = false;
          return;
        }
      } else {
        // Check if this is an encryption locked error
        try {
          const errorData = await res.json();
          if (errorData.data?.encryptionLocked) {
            console.log('[AuthGate] Encrypted storage is locked for:', errorData.data.username);
            // Pre-fill username and show login form with unlock message
            username = errorData.data.username;
            loginError = `Your encrypted storage is locked. Please enter your password to unlock.`;
            view = 'login';
            isCheckingAuth = false;
            return;
          }
        } catch {
          // Failed to parse error response, continue to show login screen
        }
      }
    } catch (error) {
      console.warn('[AuthGate] Auth check failed:', error);
    }

    // No authentication found - show login screen
    console.log('[AuthGate] No auth found, showing login screen');
    clearSecurityPolicy();
    isCheckingAuth = false;
  }

  // Handle login - IDENTICAL for web and mobile
  // Uses the API endpoint which validates against users.json
  // Web: cookie set automatically | Mobile: session ID returned and stored
  async function handleLogin(e: Event) {
    e.preventDefault();
    error = '';
    loading = true;

    try {
      // Call API login - SAME code path for both web and mobile
      // Web: hits /api/auth/login directly
      // Mobile: hits /api/auth/login via nodeBridge -> nodejs-mobile
      const res = await apiFetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();
      console.log('[AuthGate] Login response:', data);

      if (data.success && data.user) {
        // Store session ID in localStorage (mobile needs this, web uses cookie)
        if (data.sessionId) {
          storeSession(data.sessionId, data.user.username);
        }

        // VALIDATE PROFILE COMPLETENESS - Don't allow login with empty profile
        try {
          const personaRes = await apiFetch('/api/persona-core');
          if (!personaRes.ok) {
            error = `PROFILE INCOMPLETE: Your profile exists but core persona data is missing. You must sync from server to get your profile data. Status: ${personaRes.status}`;
            showSyncHint = true;
            return;
          }

          const personaData = await personaRes.json();
          if (!personaData || !personaData.persona || !personaData.persona.identity || !personaData.persona.identity.name) {
            error = `PROFILE EMPTY: Your persona data is missing or corrupted. You must sync from server to restore your profile.`;
            showSyncHint = true;
            return;
          }
        } catch (personaErr) {
          error = `PROFILE CHECK FAILED: Cannot verify your profile is complete. You may need to sync from server.`;
          showSyncHint = true;
          return;
        }

        // Profile is complete - proceed with login
        console.log('[AuthGate] LOGIN SUCCESS: Profile validation passed');

        // Check if auto-sync on login is enabled - trigger profile-sync agent in background
        // Uses profile-sync to sync: persona, conversation buffer, and memories
        // Flags:
        //   --pull-only: Only download, don't push to server
        //   --full: Ignore lastMemorySyncAt, do complete memory sync
        //   --skip-config: Don't overwrite device-specific configs (models.json, etc.)
        const shouldSync = await canSyncOnLogin();
        if (shouldSync) {
          console.log('[AuthGate] Auto-sync on login enabled, triggering profile-sync agent...');
          // Fire-and-forget: agent runs in background while app loads
          runTriggerNow('profile-sync', ['--pull-only', '--full', '--skip-config'])
            .then(taskId => console.log(`[AuthGate] Profile-sync queued as ${taskId}`))
            .catch(err => console.warn('[AuthGate] Profile-sync trigger failed:', err));
          successMessage = `LOGIN SUCCESS! Welcome back, ${data.user.username}. Syncing profile in background...`;
        } else {
          successMessage = `LOGIN SUCCESS! Welcome back, ${data.user.username}. Profile loaded and ready.`;
        }
        error = ''; // Clear any previous errors

        console.log('[AuthGate] Proceeding to app...');

        setTimeout(() => {
          isAuthenticated = true;
          window.location.reload();
        }, 1500);
        return; // Don't fall through to error handling
      }

      // Login failed - show error and determine if user might need to sync
      // User can click "Sync from Server" button if they need to create/sync account
      // DON'T auto-redirect to sync-prompt - that was confusing for wrong password
      error = data.error || 'Login failed. Check your credentials.';

      // Always show sync hint on login failure - users can sync profiles from any device
      showSyncHint = true;
    } catch (err) {
      error = 'Login failed. Check your credentials.';
      console.error('Login error:', err);
    } finally {
      loading = false;
    }
  }

  // Sync profile from remote server
  // IDENTICAL for web and mobile - uses fetchExternal to handle CORS on mobile
  async function handleSyncFromServer() {
    error = '';
    syncLoading = true;

    try {
      console.log('[AuthGate] Syncing from server:', syncServerUrl);
      console.log('[AuthGate] Username:', username);
      console.log('[AuthGate] Password length:', password?.length || 0);

      if (!username || !password) {
        error = 'Please enter both username and password on the login screen first';
        syncLoading = false;
        return;
      }

      // Step 1: Authenticate with the remote server to verify credentials
      // Uses remoteFetch which handles CORS on mobile via CapacitorHttp
      const requestBody = { username, password };
      const normalizedSyncUrl = normalizeUrl(syncServerUrl);
      console.log('[AuthGate] Sending to remote server:', normalizedSyncUrl + '/api/auth/login');
      console.log('[AuthGate] Request body keys:', Object.keys(requestBody));

      const serverRes = await remoteFetch(`${normalizedSyncUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(requestBody),
      });

      console.log('[AuthGate] Remote server response status:', serverRes.status);

      if (!serverRes.ok) {
        const errorText = await serverRes.text().catch(() => 'Unknown error');
        error = `Server error (${serverRes.status}): ${errorText}`;
        return;
      }

      const serverData = await serverRes.json();
      if (!serverData.success || !serverData.user) {
        error = serverData.error || 'Server login failed. Check credentials.';
        return;
      }

      console.log('[AuthGate] Server auth successful for:', serverData.user.username);

      // Capture server session ID for remote API calls
      const serverSessionId = serverData.sessionId;
      console.log('[AuthGate] Server session ID captured:', serverSessionId?.slice(0, 8) + '...');

      // Step 2: Download profile data from remote BEFORE creating local user
      // This prevents empty profiles if download fails
      console.log('[AuthGate] Downloading profile data from remote...');
      error = '📥 SYNCING: Downloading profile data from server...';

      let profileBundle = null;
      let syncStrategy = 'unknown';

      try {
        // Try priority export first (essential files only to avoid OOM)
        console.log('[AuthGate] Attempting priority sync (persona + config only)...');
        error = '📥 SYNCING: Downloading essential profile data (persona, config, conversations)...';

        console.log('[AuthGate] Calling export-priority with credentials (POST)');
        console.log('[AuthGate] Full URL:', `${normalizedSyncUrl}/api/profile-sync/export-priority`);

        // Use POST with credentials in body - avoids cross-origin cookie issues
        const priorityRes = await remoteFetch(`${normalizedSyncUrl}/api/profile-sync/export-priority`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ username, password }),
        });

        console.log('[AuthGate] Export-priority response:', priorityRes.status);

        if (priorityRes.ok) {
          profileBundle = await priorityRes.json();
          syncStrategy = 'priority';
          error = `📥 SYNCING: Downloaded ${profileBundle.stats?.totalFiles || 0} files from server (${Math.round((profileBundle.stats?.totalSize || 0) / 1024)}KB)`;
        } else {
          // Priority export failed - DO NOT create local user
          const priorityError = await priorityRes.text().catch(() => 'Network error');
          console.error('[AuthGate] Export-priority failed:', priorityRes.status, priorityError);
          error = `SYNC FAILED: Cannot download profile from server (${priorityRes.status}). ${priorityError}`;
          return;
        }
      } catch (profileErr) {
        // Download failed - DO NOT create local user
        error = `SYNC NETWORK ERROR: Cannot connect to server or download profile. ${profileErr instanceof Error ? profileErr.message : 'Connection failed'}. Check your network and server URL.`;
        return;
      }

      // Profile downloaded successfully - NOW create local user
      if (!profileBundle || !profileBundle.files || profileBundle.files.length === 0) {
        error = 'SYNC FAILED: No profile data received from server.';
        return;
      }

      // Step 3: Create the user locally ONLY after profile downloaded successfully
      console.log('[AuthGate] Profile downloaded, creating local user...');
      error = '👤 Creating local user account...';

      const createRes = await apiFetch('/api/auth/sync-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          password,
          displayName: serverData.user.displayName || serverData.user.username,
          role: serverData.user.role,
          serverUrl: syncServerUrl,
        }),
      });

      const createData = await createRes.json();
      if (!createData.success) {
        error = createData.error || 'Failed to create local user account';
        return;
      }

      // Store session for authenticated import
      if (createData.sessionId) {
        storeSession(createData.sessionId, username);
      }

      // Step 4: Import profile bundle locally
      error = '💾 SYNCING: Importing profile files to local storage...';
      console.log(`[AuthGate] Calling import with ${profileBundle.files?.length || 0} files`);

      const importRes = await apiFetch('/api/profile-sync/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profileBundle),
      });

      console.log(`[AuthGate] Import response status: ${importRes.status}`);

      if (!importRes.ok) {
        const importError = await importRes.text().catch(() => 'Unknown import error');
        console.error(`[AuthGate] Import failed: ${importRes.status} - ${importError}`);
        error = `IMPORT FAILED: Cannot save profile data locally. Error (${importRes.status}): ${importError}. Your profile was not synced.`;
        return;
      }

      const importData = await importRes.json();
      console.log(`[AuthGate] Import result:`, importData);

      if (!importData.success) {
        console.error(`[AuthGate] Import unsuccessful:`, importData.error);
        error = `IMPORT FAILED: ${importData.error || 'Failed to save profile files'}. Your profile was not synced.`;
        return;
      }

      // SUCCESS - profile actually synced
      if (!importData.imported || importData.imported === 0) {
        error = `SYNC INCOMPLETE: No files were imported. Your profile is empty.`;
        return;
      }

      // SHOW SUCCESS MESSAGE
      successMessage = `SYNC SUCCESS! Imported ${importData.imported} files from ${syncServerUrl}. Profile ready!`;
      error = ''; // Clear any previous errors
      console.log(`[AuthGate] SYNC SUCCESS: ${importData.imported} files imported via ${syncStrategy} sync`);

      // SUCCESS - Actually synced profile data
      // Give user a moment to see the success message
      setTimeout(() => {
        isAuthenticated = true;
        window.location.reload();
      }, 2000);
    } catch (err) {
      error = `SYNC FAILED: ${err instanceof Error ? err.message : 'Unknown error'}`;
    } finally {
      syncLoading = false;
    }
  }

  // Create local profile via API - IDENTICAL for web and mobile
  async function handleOfflineLogin() {
    error = '';
    loading = true;

    try {
      // Create profile via API - works for both web and mobile
      const res = await apiFetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          password,
          displayName: displayName || username,
        }),
      });

      const data = await res.json();
      if (!data.success) {
        error = data.error || 'Failed to create profile';
        return;
      }

      // Store session and reload
      if (data.sessionId) {
        storeSession(data.sessionId, username);
      }

      console.log('[AuthGate] Created local profile:', username);
      isAuthenticated = true;
      window.location.reload();
    } catch (err) {
      if (err instanceof Error && err.message.includes('already exists')) {
        error = 'User already exists locally. Try logging in normally.';
        view = 'login';
      } else {
        error = err instanceof Error ? err.message : 'Failed to create profile';
      }
      console.error('Create profile error:', err);
    } finally {
      loading = false;
    }
  }

  // Handle registration
  async function handleRegister(e: Event) {
    e.preventDefault();
    error = '';

    // Validate password confirmation
    if (password !== confirmPassword) {
      error = 'Passwords do not match';
      return;
    }

    // Validate agreements
    if (!agreeToTerms) {
      error = 'You must agree to the Terms of Service to create an account';
      return;
    }

    if (!agreeToEthicalUse) {
      error = 'You must agree to the Ethical Use Policy to create an account';
      return;
    }

    loading = true;

    try {
      const res = await apiFetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          password,
          displayName: displayName || username,
          email: email || undefined,
        }),
      });

      const data = await res.json();

      if (data.success) {
        isAuthenticated = true;
        registeredUsername = username;
        // Recovery codes are stored server-side and can be found in Settings > Security
        // Skip directly to post-register options
        view = 'post-register';
      } else {
        error = data.error || 'Registration failed';
      }
    } catch (err) {
      error = 'Network error. Please try again.';
      console.error('Registration error:', err);
    } finally {
      loading = false;
    }
  }

  // Handle local profile registration (for offline use)
  // Uses the same API as handleRegister - IDENTICAL code path for web and mobile
  async function handleLocalRegister() {
    error = '';

    if (password !== confirmPassword) {
      error = 'Passwords do not match';
      return;
    }

    if (password.length < 6) {
      error = 'Password must be at least 6 characters';
      return;
    }

    loading = true;

    try {
      // Use API to create profile - SAME code path for both web and mobile
      const res = await apiFetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          password,
          displayName: displayName || username,
        }),
      });

      const data = await res.json();
      if (!data.success) {
        error = data.error || 'Failed to create profile';
        return;
      }

      // Store session and reload
      if (data.sessionId) {
        storeSession(data.sessionId, username);
      }

      console.log('[AuthGate] Created local profile:', username);
      isAuthenticated = true;
      window.location.reload();
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to create local profile';
      console.error('Local registration error:', err);
    } finally {
      loading = false;
    }
  }

  // Handle password reset with recovery code
  async function handlePasswordReset(e: Event) {
    e.preventDefault();
    error = '';

    // Validate inputs
    if (!username || !recoveryCode || !newPassword || !confirmNewPassword) {
      error = 'All fields are required';
      return;
    }

    if (newPassword !== confirmNewPassword) {
      error = 'Passwords do not match';
      return;
    }

    if (newPassword.length < 6) {
      error = 'Password must be at least 6 characters';
      return;
    }

    loading = true;

    try {
      const res = await apiFetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          recoveryCode: recoveryCode.toUpperCase().trim(),
          newPassword,
        }),
      });

      const data = await res.json();

      if (data.success) {
        // Clear form
        username = '';
        recoveryCode = '';
        newPassword = '';
        confirmNewPassword = '';
        // Show login with success message
        error = '';
        view = 'login';
        // Show success (reuse error field with success styling)
        setTimeout(() => {
          alert('Password reset successfully! Please login with your new password.');
        }, 100);
      } else {
        error = data.error || 'Password reset failed';
      }
    } catch (err) {
      error = 'Network error. Please try again.';
      console.error('Password reset error:', err);
    } finally {
      loading = false;
    }
  }

  // Handle onboarding completion
  function handleOnboardingComplete() {
    window.location.reload(); // Reload to initialize full app
  }

  // Start onboarding wizard
  function startOnboarding() {
    view = 'onboarding';
  }

  // Skip onboarding and go to app
  function skipOnboarding() {
    window.location.reload(); // Reload to initialize full app
  }

  // Continue as guest (anonymous access)
  async function continueAsGuest() {
    try {
      console.log('[AuthGate] Continue as guest clicked');
      guestSessionError = '';
      const res = await apiFetch('/api/auth/guest', { method: 'POST' });
      const data = await res.json();
      console.log('[AuthGate] Guest session response:', data);

      if (data.success) {
        console.log('[AuthGate] Setting showProfileSelector = true');
        showProfileSelector = true; // Show profile selector modal
        console.log('[AuthGate] showProfileSelector is now:', showProfileSelector);
      } else {
        guestSessionError = data.error || 'Failed to create guest session';
      }
    } catch (err) {
      console.error('[AuthGate] Guest session error:', err);
      guestSessionError = 'Network error. Please try again.';
    }
  }

  // Handle profile selection
  function handleProfileSelected(username: string) {
    console.log('[AuthGate] Profile selected:', username);
    // Navigation handled by ProfileSelector
  }

  // Handle profile selector cancel
  function handleProfileCancel() {
    showProfileSelector = false;
    guestSessionError = '';
  }

  onMount(() => {
    console.log('[AuthGate] Component mounted, starting auth check');
    window.addEventListener('mh:api-auth-failure', handleApiAuthFailure);
    window.addEventListener('mh:api-action', handleApiAction);
    checkAuth();
    return () => {
      window.removeEventListener('mh:api-auth-failure', handleApiAuthFailure);
      window.removeEventListener('mh:api-action', handleApiAction);
      if (apiActionNoticeTimer) clearTimeout(apiActionNoticeTimer);
    };
  });
</script>

{#if !isAuthenticated || view === 'post-register' || view === 'onboarding' || view === 'recovery-codes'}
  <div class="fixed inset-0 flex items-center justify-center z-[10000] p-4 overflow-y-auto
              bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950
              dark:from-slate-800 dark:via-slate-900 dark:to-slate-950
              [html:not(.dark)_&]:from-slate-100 [html:not(.dark)_&]:via-slate-200 [html:not(.dark)_&]:to-slate-300">
    <div class="bg-slate-900 rounded-2xl shadow-2xl max-w-[500px] w-full p-10 animate-slideIn
                dark:bg-slate-900
                [html:not(.dark)_&]:bg-white [html:not(.dark)_&]:border [html:not(.dark)_&]:border-black/10
                {view === 'onboarding' ? 'max-w-[1000px] max-h-[90vh] overflow-y-auto !p-8' : ''}">
      {#if isCheckingAuth}
        <!-- Loading state while checking authentication -->
        <div class="text-center">
          <div class="mb-8">
            <div class="w-24 h-24 mx-auto mb-6 rounded-full bg-gradient-to-br from-blue-400 to-purple-400 flex items-center justify-center shadow-lg shadow-blue-400/40 animate-pulse">
              <span class="text-4xl font-bold text-white">🧠💻</span>
            </div>
            <h1 class="text-3xl font-bold m-0 mb-2 bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent
                       [html:not(.dark)_&]:from-blue-600 [html:not(.dark)_&]:to-purple-600">MetaHuman OS</h1>
            <p class="text-base text-white/60 m-0 [html:not(.dark)_&]:text-black/60">Checking authentication...</p>
          </div>
        </div>
      {:else if view === 'onboarding'}
        <!-- Onboarding Wizard -->
        <OnboardingWizard onComplete={handleOnboardingComplete} />
      {:else if view === 'post-register'}
        <!-- Post-Registration Options -->
        <div class="relative">
          <div class="text-center mb-8">
            <div class="w-16 h-16 mx-auto mb-4 bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-full flex items-center justify-center text-3xl text-white">✓</div>
            <h2 class="text-2xl font-bold m-0 mb-2 text-white [html:not(.dark)_&]:text-gray-900">Account Created Successfully!</h2>
            <p class="text-base text-white/60 m-0 [html:not(.dark)_&]:text-black/60">Welcome to MetaHuman OS</p>
          </div>

          <div class="flex flex-col gap-4 my-8">
            <div class="p-6 bg-gradient-to-br from-blue-400/10 to-purple-400/10 border border-blue-400 rounded-xl transition-all
                        [html:not(.dark)_&]:bg-black/5 [html:not(.dark)_&]:border-black/10">
              <div class="text-3xl mb-3">🧭</div>
              <h3 class="text-xl font-semibold m-0 mb-2 text-white [html:not(.dark)_&]:text-gray-900">Setup Wizard (Recommended)</h3>
              <p class="m-0 mb-4 text-sm leading-relaxed text-white/70 [html:not(.dark)_&]:text-black/70">
                Guide me through setting up my digital consciousness with personalized questions,
                document import, and goal setting. Takes about 10-15 minutes.
              </p>
              <button class="btn-primary w-full" on:click={startOnboarding}>
                Start Setup Wizard →
              </button>
            </div>

            <div class="p-6 bg-white/5 border border-white/10 rounded-xl transition-all
                        [html:not(.dark)_&]:bg-black/5 [html:not(.dark)_&]:border-black/10">
              <div class="text-3xl mb-3">🚀</div>
              <h3 class="text-xl font-semibold m-0 mb-2 text-white [html:not(.dark)_&]:text-gray-900">Skip and Explore</h3>
              <p class="m-0 mb-4 text-sm leading-relaxed text-white/70 [html:not(.dark)_&]:text-black/70">
                I'll add my data later through Memory Capture, Chat, File Ingestion,
                or other utilities. Let me explore the system first.
              </p>
              <button class="btn-secondary w-full" on:click={skipOnboarding}>
                Continue to App
              </button>
            </div>
          </div>

          <div class="mt-6 p-4 bg-white/5 border-l-4 border-blue-400 rounded
                      [html:not(.dark)_&]:bg-black/5">
            <p class="m-0 mb-2 text-sm text-white/80 [html:not(.dark)_&]:text-black/80"><strong>What the wizard does:</strong></p>
            <ul class="m-0 pl-6 text-sm leading-relaxed text-white/70 [html:not(.dark)_&]:text-black/70">
              <li>Captures your identity, personality, and communication style</li>
              <li>Imports documents and journals for context</li>
              <li>Sets up your goals and tasks</li>
              <li>All data stays 100% local on your machine</li>
            </ul>
          </div>
        </div>
      {:else if view === 'splash'}
        <!-- Splash Screen / Welcome -->
        <div class="text-center">
          <div class="mb-8">
            <div class="w-24 h-24 mx-auto mb-6 rounded-full bg-gradient-to-br from-blue-400 to-purple-400 flex items-center justify-center shadow-lg shadow-blue-400/40">
              <span class="text-4xl font-bold text-white">🧠💻</span>
            </div>
            <h1 class="text-3xl font-bold m-0 mb-2 bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent
                       [html:not(.dark)_&]:from-blue-600 [html:not(.dark)_&]:to-purple-600">MetaHuman OS</h1>
            <p class="text-base text-white/60 m-0 [html:not(.dark)_&]:text-black/60">Autonomous Digital Personality Extension</p>
          </div>

          <div class="my-8 p-6 bg-white/5 rounded-xl border border-white/10 [html:not(.dark)_&]:bg-black/5 [html:not(.dark)_&]:border-black/10">
            <p class="m-0 leading-relaxed text-white/80 [html:not(.dark)_&]:text-black/70">
              MetaHuman OS is a personal AI system that mirrors your identity, memories, and
              personality. It operates autonomously as a seamless extension of yourself.
            </p>
          </div>

          <div class="flex flex-col gap-3 my-8">
            <button class="btn-primary flex items-center justify-center gap-2" on:click={() => view = 'login'}>
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
                <path d="M8 8a3 3 0 100-6 3 3 0 000 6zm0 2c-2.67 0-8 1.34-8 4v1h16v-1c0-2.66-5.33-4-8-4z" fill="currentColor"/>
              </svg>
              Login
            </button>
            <button class="btn-secondary flex items-center justify-center gap-2" on:click={() => view = 'register'}>
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
                <path d="M8 1a3 3 0 100 6 3 3 0 000-6zM6 9c-2.67 0-8 1.34-8 4v2h9v-2c0-1.48-1.21-2.77-3-3.46zM14 9h-2v2h-2v2h2v2h2v-2h2v-2h-2V9z" fill="currentColor"/>
              </svg>
              Create Account
            </button>
            <button class="w-full flex items-center justify-center gap-2 py-3.5 px-6 rounded-xl text-base font-medium cursor-pointer transition-all border border-transparent bg-transparent text-white/70 hover:text-white hover:border-white/20
                          [html:not(.dark)_&]:text-black/60 [html:not(.dark)_&]:hover:text-black/90 [html:not(.dark)_&]:hover:border-black/20" on:click={continueAsGuest}>
              Continue as Guest
            </button>
          </div>

          <div class="mt-8 pt-6 border-t border-white/10 [html:not(.dark)_&]:border-black/10">
            <p class="text-sm text-white/70 m-0 mb-2 text-center [html:not(.dark)_&]:text-black/70">
              <strong class="text-white/90 [html:not(.dark)_&]:text-black/90">CC BY-NC</strong> — Attribution - Non-Commercial
            </p>
            <p class="text-xs leading-relaxed text-white/50 m-0 mb-4 text-center [html:not(.dark)_&]:text-black/50">
              The maker of this program lives in extreme poverty. Do not use the code of this project for profit.
            </p>

            <div class="flex justify-center gap-3 mt-4">
              <a href="/user-guide" target="_blank" class="inline-flex items-center gap-1.5 py-2 px-3.5 bg-white/5 border border-white/15 rounded-full text-sm text-white/70 no-underline transition-all hover:bg-white/10 hover:border-white/30 hover:text-white/90 hover:-translate-y-0.5
                         [html:not(.dark)_&]:bg-black/5 [html:not(.dark)_&]:border-black/15 [html:not(.dark)_&]:text-black/60 [html:not(.dark)_&]:hover:bg-black/10 [html:not(.dark)_&]:hover:border-black/30 [html:not(.dark)_&]:hover:text-black/90">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M8 1C4.13 1 1 4.13 1 8s3.13 7 7 7 7-3.13 7-7-3.13-7-7-7zm0 2c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm1 9H7V7h2v5z" fill="currentColor"/>
                </svg>
                User Guide
              </a>
              <a href="https://github.com/Greg-Aster/metahuman-os" target="_blank" class="inline-flex items-center gap-1.5 py-2 px-3.5 bg-white/5 border border-white/15 rounded-full text-sm text-white/70 no-underline transition-all hover:bg-white/10 hover:border-white/30 hover:text-white/90 hover:-translate-y-0.5
                         [html:not(.dark)_&]:bg-black/5 [html:not(.dark)_&]:border-black/15 [html:not(.dark)_&]:text-black/60 [html:not(.dark)_&]:hover:bg-black/10 [html:not(.dark)_&]:hover:border-black/30 [html:not(.dark)_&]:hover:text-black/90">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path fill-rule="evenodd" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" fill="currentColor"/>
                </svg>
                GitHub
              </a>
            </div>
          </div>
        </div>
      {:else if view === 'login'}
        <!-- Login Form -->
        <div class="relative">
          <button class="absolute -top-4 -left-2 w-9 h-9 rounded-lg border-none bg-white/10 text-white/70 cursor-pointer flex items-center justify-center transition-all hover:bg-white/20 hover:text-white
                        [html:not(.dark)_&]:bg-black/5 [html:not(.dark)_&]:text-black/60 [html:not(.dark)_&]:hover:bg-black/10 [html:not(.dark)_&]:hover:text-black/90" on:click={() => view = 'splash'}>
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
              <path d="M8 14L2 8l6-6M2 8h12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>

          <div class="text-center mb-8">
            <h2 class="text-2xl font-bold m-0 mb-2 text-white [html:not(.dark)_&]:text-gray-900">Welcome Back</h2>
            <p class="text-base text-white/60 m-0 [html:not(.dark)_&]:text-black/60">Sign in to your MetaHuman OS account</p>
          </div>

          <form on:submit={handleLogin}>
            <div class="mb-5">
              <label for="login-username" class="block text-sm font-medium text-white/80 mb-2 [html:not(.dark)_&]:text-black/80">Username</label>
              <input
                id="login-username"
                type="text"
                bind:value={username}
                on:input={() => { showSyncHint = false; error = ''; successMessage = ''; }}
                required
                disabled={loading}
                autocomplete="username"
                class="input-field"
              />
            </div>

            <div class="mb-5">
              <label for="login-password" class="block text-sm font-medium text-white/80 mb-2 [html:not(.dark)_&]:text-black/80">Password</label>
              <input
                id="login-password"
                type="password"
                bind:value={password}
                on:input={() => { showSyncHint = false; error = ''; successMessage = ''; }}
                required
                disabled={loading}
                autocomplete="current-password"
                class="input-field"
              />
            </div>

            {#if error}
              <div class="py-3 px-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-500 text-sm mb-4">{error}</div>
            {/if}

            {#if successMessage}
              <div class="py-3 px-4 bg-green-500/10 border border-green-500/30 rounded-lg text-green-500 text-sm mb-4 [html:not(.dark)_&]:text-green-600">✅ {successMessage}</div>
            {/if}

            {#if showSyncHint}
              <div class="flex gap-3 p-4 my-4 bg-gradient-to-br from-blue-500/15 to-purple-500/15 border border-blue-500/30 rounded-xl items-start
                          [html:not(.dark)_&]:from-blue-500/10 [html:not(.dark)_&]:to-purple-500/10">
                <div class="text-2xl leading-none">🔄</div>
                <div class="flex-1">
                  <strong class="block text-blue-400 mb-1 [html:not(.dark)_&]:text-blue-500">First time on this device?</strong>
                  <p class="text-sm text-white/70 m-0 mb-3 [html:not(.dark)_&]:text-black/60">Your account may exist on another server. Sync to pull your profile here.</p>
                  <button type="button" class="btn-secondary w-full py-2 px-4 text-sm" on:click={() => view = 'sync-prompt'}>
                    Sync from Server
                  </button>
                </div>
              </div>
            {/if}

            <button type="submit" class="btn-primary w-full" disabled={loading}>
              {loading ? 'Signing in...' : 'Sign In'}
            </button>

            <div class="text-center mt-3">
              <button type="button" class="bg-transparent border-none text-blue-400 cursor-pointer underline text-inherit p-0 hover:text-blue-300 [html:not(.dark)_&]:text-blue-600 [html:not(.dark)_&]:hover:text-blue-800" on:click={() => view = 'forgot-password'}>
                Forgot password?
              </button>
            </div>
          </form>

          <div class="mt-6 text-center text-sm text-white/60 [html:not(.dark)_&]:text-black/60">
            <p>
              Don't have an account?
              <button class="bg-transparent border-none text-blue-400 cursor-pointer underline text-inherit p-0 hover:text-blue-300 [html:not(.dark)_&]:text-blue-600 [html:not(.dark)_&]:hover:text-blue-800" on:click={() => view = 'register'}>Create one</button>
            </p>
            {#if !showSyncHint}
              <p class="text-xs mt-2 opacity-80">
                Need to sync from another device?
                <button class="bg-transparent border-none text-blue-400 cursor-pointer underline text-inherit p-0 hover:text-blue-300 [html:not(.dark)_&]:text-blue-600 [html:not(.dark)_&]:hover:text-blue-800" on:click={() => view = 'sync-prompt'}>Sync from Server</button>
              </p>
            {/if}
          </div>
        </div>
      {:else if view === 'register'}
        <!-- Registration Form -->
        <div class="relative">
          <button class="absolute -top-4 -left-2 w-9 h-9 rounded-lg border-none bg-white/10 text-white/70 cursor-pointer flex items-center justify-center transition-all hover:bg-white/20 hover:text-white
                        [html:not(.dark)_&]:bg-black/5 [html:not(.dark)_&]:text-black/60 [html:not(.dark)_&]:hover:bg-black/10 [html:not(.dark)_&]:hover:text-black/90" on:click={() => view = 'splash'}>
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
              <path d="M8 14L2 8l6-6M2 8h12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>

          <div class="text-center mb-8">
            <h2 class="text-2xl font-bold m-0 mb-2 text-white [html:not(.dark)_&]:text-gray-900">Create Account</h2>
            <p class="text-base text-white/60 m-0 [html:not(.dark)_&]:text-black/60">Set up your personal MetaHuman OS instance</p>
          </div>

          <form on:submit={handleRegister}>
            <div class="mb-5">
              <label for="reg-username" class="block text-sm font-medium text-white/80 mb-2 [html:not(.dark)_&]:text-black/80">Username *</label>
              <input
                id="reg-username"
                type="text"
                bind:value={username}
                required
                disabled={loading}
                autocomplete="username"
                pattern="[a-zA-Z0-9_-]+"
                title="Letters, numbers, underscore, and hyphen only"
                minlength="3"
                maxlength="50"
                class="input-field"
              />
            </div>

            <div class="mb-5">
              <label for="reg-display-name" class="block text-sm font-medium text-white/80 mb-2 [html:not(.dark)_&]:text-black/80">Display Name</label>
              <input
                id="reg-display-name"
                type="text"
                bind:value={displayName}
                disabled={loading}
                placeholder="Optional"
                class="input-field"
              />
            </div>

            <div class="mb-5">
              <label for="reg-email" class="block text-sm font-medium text-white/80 mb-2 [html:not(.dark)_&]:text-black/80">Email</label>
              <input
                id="reg-email"
                type="email"
                bind:value={email}
                disabled={loading}
                placeholder="Optional"
                autocomplete="email"
                class="input-field"
              />
            </div>

            <div class="mb-5">
              <label for="reg-password" class="block text-sm font-medium text-white/80 mb-2 [html:not(.dark)_&]:text-black/80">Password *</label>
              <input
                id="reg-password"
                type="password"
                bind:value={password}
                required
                disabled={loading}
                autocomplete="new-password"
                minlength="6"
                class="input-field"
              />
            </div>

            <div class="mb-5">
              <label for="reg-confirm-password" class="block text-sm font-medium text-white/80 mb-2 [html:not(.dark)_&]:text-black/80">Confirm Password *</label>
              <input
                id="reg-confirm-password"
                type="password"
                bind:value={confirmPassword}
                required
                disabled={loading}
                autocomplete="new-password"
                minlength="6"
                class="input-field"
              />
            </div>

            {#if error}
              <div class="py-3 px-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-500 text-sm mb-4">{error}</div>
            {/if}

            <!-- Terms of Service Agreement -->
            <div class="mb-4 p-3 bg-blue-500/5 border border-blue-500/20 rounded-lg [html:not(.dark)_&]:bg-blue-600/5 [html:not(.dark)_&]:border-blue-600/20">
              <label class="flex items-start gap-3 cursor-pointer text-sm leading-relaxed text-white/85 [html:not(.dark)_&]:text-black/80">
                <input
                  type="checkbox"
                  bind:checked={agreeToTerms}
                  disabled={loading}
                  required
                  class="w-auto mt-1 cursor-pointer flex-shrink-0 accent-blue-500"
                />
                <span class="flex-1">
                  I agree to the <a href="/user-guide#21-terms-of-service" target="_blank" rel="noopener noreferrer" class="text-blue-400 underline font-medium hover:text-blue-300 [html:not(.dark)_&]:text-blue-600 [html:not(.dark)_&]:hover:text-blue-800">Terms of Service</a>
                </span>
              </label>
            </div>

            <!-- Ethical Use Policy Agreement -->
            <div class="mb-4 p-3 bg-blue-500/5 border border-blue-500/20 rounded-lg [html:not(.dark)_&]:bg-blue-600/5 [html:not(.dark)_&]:border-blue-600/20">
              <label class="flex items-start gap-3 cursor-pointer text-sm leading-relaxed text-white/85 [html:not(.dark)_&]:text-black/80">
                <input
                  type="checkbox"
                  bind:checked={agreeToEthicalUse}
                  disabled={loading}
                  required
                  class="w-auto mt-1 cursor-pointer flex-shrink-0 accent-blue-500"
                />
                <span class="flex-1 text-xs leading-relaxed">
                  I will NOT impersonate any individual without their express consent,
                  I will NOT use this program to create malicious AI designed to harm others,
                  and I will NOT make Skynet.
                  <a href="/user-guide#22-ethical-use-policy" target="_blank" rel="noopener noreferrer" class="text-blue-400 underline font-medium hover:text-blue-300 [html:not(.dark)_&]:text-blue-600 [html:not(.dark)_&]:hover:text-blue-800">Full Ethical Use Policy</a>
                </span>
              </label>
            </div>

            <button type="submit" class="btn-primary w-full" disabled={loading || !agreeToTerms || !agreeToEthicalUse}>
              {loading ? 'Creating account...' : 'Create Account'}
            </button>
          </form>

          <div class="mt-6 text-center text-sm text-white/60 [html:not(.dark)_&]:text-black/60">
            <p>
              Already have an account?
              <button class="bg-transparent border-none text-blue-400 cursor-pointer underline text-inherit p-0 hover:text-blue-300 [html:not(.dark)_&]:text-blue-600 [html:not(.dark)_&]:hover:text-blue-800" on:click={() => view = 'login'}>Sign in</button>
            </p>
          </div>
        </div>
      {:else if view === 'forgot-password'}
        <!-- Forgot Password / Recovery Code Form -->
        <div class="relative">
          <button class="absolute -top-4 -left-2 w-9 h-9 rounded-lg border-none bg-white/10 text-white/70 cursor-pointer flex items-center justify-center transition-all hover:bg-white/20 hover:text-white
                        [html:not(.dark)_&]:bg-black/5 [html:not(.dark)_&]:text-black/60 [html:not(.dark)_&]:hover:bg-black/10 [html:not(.dark)_&]:hover:text-black/90" on:click={() => view = 'login'}>
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
              <path d="M8 14L2 8l6-6M2 8h12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>

          <div class="text-center mb-8">
            <h2 class="text-2xl font-bold m-0 mb-2 text-white [html:not(.dark)_&]:text-gray-900">Reset Password</h2>
            <p class="text-base text-white/60 m-0 [html:not(.dark)_&]:text-black/60">Use a recovery code to reset your password</p>
          </div>

          <form on:submit={handlePasswordReset}>
            <div class="mb-5">
              <label for="reset-username" class="block text-sm font-medium text-white/80 mb-2 [html:not(.dark)_&]:text-black/80">Username</label>
              <input
                id="reset-username"
                type="text"
                bind:value={username}
                required
                disabled={loading}
                autocomplete="username"
                class="input-field"
              />
            </div>

            <div class="mb-5">
              <label for="recovery-code" class="block text-sm font-medium text-white/80 mb-2 [html:not(.dark)_&]:text-black/80">Recovery Code</label>
              <input
                id="recovery-code"
                type="text"
                bind:value={recoveryCode}
                required
                disabled={loading}
                placeholder="XXXX-XXXX-XXXX-XXXX"
                pattern="[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}"
                title="Format: XXXX-XXXX-XXXX-XXXX"
                class="input-field uppercase font-mono"
              />
              <small class="block mt-2 text-white/60 text-xs [html:not(.dark)_&]:text-black/60">
                Enter one of your 10 recovery codes. Each code can only be used once.
              </small>
            </div>

            <div class="mb-5">
              <label for="new-password" class="block text-sm font-medium text-white/80 mb-2 [html:not(.dark)_&]:text-black/80">New Password</label>
              <input
                id="new-password"
                type="password"
                bind:value={newPassword}
                required
                disabled={loading}
                autocomplete="new-password"
                minlength="6"
                class="input-field"
              />
            </div>

            <div class="mb-5">
              <label for="confirm-new-password" class="block text-sm font-medium text-white/80 mb-2 [html:not(.dark)_&]:text-black/80">Confirm New Password</label>
              <input
                id="confirm-new-password"
                type="password"
                bind:value={confirmNewPassword}
                required
                disabled={loading}
                autocomplete="new-password"
                minlength="6"
                class="input-field"
              />
            </div>

            {#if error}
              <div class="py-3 px-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-500 text-sm mb-4">{error}</div>
            {/if}

            <button type="submit" class="btn-primary w-full" disabled={loading}>
              {loading ? 'Resetting password...' : 'Reset Password'}
            </button>
          </form>

          <div class="mt-6 text-center text-sm text-white/60 [html:not(.dark)_&]:text-black/60">
            <p>
              Remember your password?
              <button class="bg-transparent border-none text-blue-400 cursor-pointer underline text-inherit p-0 hover:text-blue-300 [html:not(.dark)_&]:text-blue-600 [html:not(.dark)_&]:hover:text-blue-800" on:click={() => view = 'login'}>Sign in</button>
            </p>
          </div>
        </div>
      {:else if view === 'sync-prompt'}
        <!-- User Not Found - shown when user not found locally -->
        <div class="relative">
          <button class="absolute -top-4 -left-2 w-9 h-9 rounded-lg border-none bg-white/10 text-white/70 cursor-pointer flex items-center justify-center transition-all hover:bg-white/20 hover:text-white
                        [html:not(.dark)_&]:bg-black/5 [html:not(.dark)_&]:text-black/60 [html:not(.dark)_&]:hover:bg-black/10 [html:not(.dark)_&]:hover:text-black/90" on:click={() => view = 'login'}>
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
              <path d="M8 14L2 8l6-6M2 8h12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>

          <div class="text-center mb-8">
            <div class="w-16 h-16 mx-auto mb-4 bg-gradient-to-br from-orange-500 to-red-600 rounded-full flex items-center justify-center text-3xl">👤</div>
            <h2 class="text-2xl font-bold m-0 mb-2 text-white [html:not(.dark)_&]:text-gray-900">User Not Found</h2>
            <p class="text-base text-white/60 m-0 [html:not(.dark)_&]:text-black/60">No local profile for "{username}"</p>
          </div>

          {#if error}
            <div class="py-3 px-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-500 text-sm mb-4">{error}</div>
          {/if}

          {#if successMessage}
            <div class="py-3 px-4 bg-green-500/10 border border-green-500/30 rounded-lg text-green-500 text-sm mb-4 [html:not(.dark)_&]:text-green-600">✅ {successMessage}</div>
          {/if}

          <div class="flex flex-col gap-4 mb-6">
            <!-- Option 1: Sync from server -->
            <div class="p-6 bg-gradient-to-br from-blue-400/10 to-purple-400/10 border border-blue-400 rounded-xl transition-all">
              <div class="text-3xl mb-3">🔄</div>
              <h3 class="text-xl font-semibold m-0 mb-2 text-white [html:not(.dark)_&]:text-gray-900">Sync from Server</h3>
              <p class="m-0 mb-4 text-sm leading-relaxed text-white/70 [html:not(.dark)_&]:text-black/70">Pull existing profile from a MetaHuman server</p>

              <div class="mb-2">
                <label for="sync-server" class="block text-xs opacity-80 mb-1">Server URL</label>
                <input
                  id="sync-server"
                  type="url"
                  bind:value={syncServerUrl}
                  placeholder="https://your-metahuman-server.example"
                  disabled={syncLoading}
                  class="w-full py-2 px-3 rounded-md border border-white/20 bg-white/5 text-white text-sm [html:not(.dark)_&]:bg-black/5 [html:not(.dark)_&]:border-black/20 [html:not(.dark)_&]:text-gray-900"
                />
              </div>

              <div class="mb-2">
                <label for="sync-username" class="block text-xs opacity-80 mb-1">Username</label>
                <input
                  id="sync-username"
                  type="text"
                  bind:value={username}
                  placeholder="Your username"
                  disabled={syncLoading}
                  autocomplete="username"
                  class="w-full py-2 px-3 rounded-md border border-white/20 bg-white/5 text-white text-sm [html:not(.dark)_&]:bg-black/5 [html:not(.dark)_&]:border-black/20 [html:not(.dark)_&]:text-gray-900"
                />
              </div>

              <div class="mb-3">
                <label for="sync-password" class="block text-xs opacity-80 mb-1">Password</label>
                <input
                  id="sync-password"
                  type="password"
                  bind:value={password}
                  placeholder="Your password"
                  disabled={syncLoading}
                  autocomplete="current-password"
                  class="w-full py-2 px-3 rounded-md border border-white/20 bg-white/5 text-white text-sm [html:not(.dark)_&]:bg-black/5 [html:not(.dark)_&]:border-black/20 [html:not(.dark)_&]:text-gray-900"
                />
              </div>

              <button class="btn-primary w-full" on:click={handleSyncFromServer} disabled={syncLoading || !syncServerUrl || !username || !password}>
                {syncLoading ? 'Syncing...' : 'Sync Profile'}
              </button>
            </div>

            <!-- Option 2: Create local profile -->
            <div class="p-6 bg-white/5 border border-white/10 rounded-xl transition-all [html:not(.dark)_&]:bg-black/5 [html:not(.dark)_&]:border-black/10">
              <div class="text-3xl mb-3">➕</div>
              <h3 class="text-xl font-semibold m-0 mb-2 text-white [html:not(.dark)_&]:text-gray-900">Create Local Profile</h3>
              <p class="m-0 mb-4 text-sm leading-relaxed text-white/70 [html:not(.dark)_&]:text-black/70">Create a new profile as "{username}" on this device</p>
              <button class="btn-secondary w-full" on:click={handleOfflineLogin} disabled={loading}>
                {loading ? 'Creating...' : 'Create Profile'}
              </button>
            </div>
          </div>
        </div>
      {:else if view === 'register-local'}
        <!-- Local Profile Registration -->
        <div class="relative">
          <button class="absolute -top-4 -left-2 w-9 h-9 rounded-lg border-none bg-white/10 text-white/70 cursor-pointer flex items-center justify-center transition-all hover:bg-white/20 hover:text-white
                        [html:not(.dark)_&]:bg-black/5 [html:not(.dark)_&]:text-black/60 [html:not(.dark)_&]:hover:bg-black/10 [html:not(.dark)_&]:hover:text-black/90" on:click={() => view = 'splash'}>
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
              <path d="M8 14L2 8l6-6M2 8h12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>

          <div class="text-center mb-8">
            <h2 class="text-2xl font-bold m-0 mb-2 text-white [html:not(.dark)_&]:text-gray-900">Create Local Profile</h2>
            <p class="text-base text-white/60 m-0 [html:not(.dark)_&]:text-black/60">This profile will be stored on your device only</p>
          </div>

          <form on:submit|preventDefault={handleLocalRegister}>
            <div class="mb-5">
              <label for="local-username" class="block text-sm font-medium text-white/80 mb-2 [html:not(.dark)_&]:text-black/80">Username *</label>
              <input
                id="local-username"
                type="text"
                bind:value={username}
                required
                disabled={loading}
                autocomplete="username"
                pattern="[a-zA-Z0-9_-]+"
                title="Letters, numbers, underscore, and hyphen only"
                minlength="3"
                maxlength="50"
                class="input-field"
              />
            </div>

            <div class="mb-5">
              <label for="local-display-name" class="block text-sm font-medium text-white/80 mb-2 [html:not(.dark)_&]:text-black/80">Display Name</label>
              <input
                id="local-display-name"
                type="text"
                bind:value={displayName}
                disabled={loading}
                placeholder="Optional"
                class="input-field"
              />
            </div>

            <div class="mb-5">
              <label for="local-password" class="block text-sm font-medium text-white/80 mb-2 [html:not(.dark)_&]:text-black/80">Password *</label>
              <input
                id="local-password"
                type="password"
                bind:value={password}
                required
                disabled={loading}
                autocomplete="new-password"
                minlength="6"
                class="input-field"
              />
            </div>

            <div class="mb-5">
              <label for="local-confirm-password" class="block text-sm font-medium text-white/80 mb-2 [html:not(.dark)_&]:text-black/80">Confirm Password *</label>
              <input
                id="local-confirm-password"
                type="password"
                bind:value={confirmPassword}
                required
                disabled={loading}
                autocomplete="new-password"
                minlength="6"
                class="input-field"
              />
            </div>

            {#if error}
              <div class="py-3 px-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-500 text-sm mb-4">{error}</div>
            {/if}

            <div class="flex gap-2 p-3 bg-blue-400/10 border border-blue-400/30 rounded-lg mb-4 text-sm text-white/80 [html:not(.dark)_&]:text-black/80">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" class="flex-shrink-0 text-blue-400">
                <path d="M8 1C4.13 1 1 4.13 1 8s3.13 7 7 7 7-3.13 7-7-3.13-7-7-7zm0 2c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm1 9H7V7h2v5z" fill="currentColor"/>
              </svg>
              <span>This creates a local profile. Connect to a server later to sync your data.</span>
            </div>

            <button type="submit" class="btn-primary w-full" disabled={loading}>
              {loading ? 'Creating...' : 'Create Local Profile'}
            </button>
          </form>
        </div>
      {:else if view === 'recovery-codes'}
        <!-- Recovery Codes Display (After Registration) -->
        <div class="relative max-w-[600px]">
          <div class="text-center mb-8">
            <div class="w-16 h-16 mx-auto mb-4 bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-full flex items-center justify-center text-3xl text-white">🔑</div>
            <h2 class="text-2xl font-bold m-0 mb-2 text-white [html:not(.dark)_&]:text-gray-900">Save Your Recovery Codes</h2>
            <p class="text-base text-white/60 m-0 [html:not(.dark)_&]:text-black/60">These codes can be used to reset your password if you forget it</p>
          </div>

          <div class="flex gap-3 p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg my-6 text-amber-400 text-sm leading-relaxed
                      [html:not(.dark)_&]:bg-amber-500/10 [html:not(.dark)_&]:border-amber-500/40 [html:not(.dark)_&]:text-amber-700">
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none" class="flex-shrink-0">
              <path d="M8 1L1 14h14L8 1z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
              <path d="M8 6v3M8 11v1" stroke="currentColor" stroke-width="2"/>
            </svg>
            <div>
              <strong class="text-amber-500 [html:not(.dark)_&]:text-amber-800">IMPORTANT:</strong> Save these codes in a secure location (password manager, printed copy, etc.).
              Each code can only be used once. You won't see them again!
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3 my-6 max-sm:grid-cols-1">
            {#each generatedRecoveryCodes as code, index}
              <div class="flex items-center gap-2 py-3 px-4 bg-white/5 border border-white/10 rounded-lg [html:not(.dark)_&]:bg-black/5 [html:not(.dark)_&]:border-black/10">
                <span class="text-xs text-white/50 min-w-[20px] [html:not(.dark)_&]:text-black/50">{index + 1}.</span>
                <code class="font-mono text-sm text-blue-400 bg-blue-400/10 py-1 px-2 rounded tracking-wide [html:not(.dark)_&]:text-blue-600 [html:not(.dark)_&]:bg-blue-600/10">{code}</code>
              </div>
            {/each}
          </div>

          <div class="flex flex-col gap-3 my-6">
            <button
              class="btn-secondary"
              on:click={() => {
                const codesText = generatedRecoveryCodes.map((c, i) => `${i + 1}. ${c}`).join('\n');
                navigator.clipboard.writeText(codesText);
                alert('Recovery codes copied to clipboard!');
              }}
            >
              📋 Copy All Codes
            </button>
            <button
              class="btn-primary"
              on:click={() => view = 'post-register'}
            >
              I've Saved My Codes →
            </button>
          </div>

          <div class="mt-6 pt-6 border-t border-white/10 text-sm text-white/60 [html:not(.dark)_&]:border-black/10 [html:not(.dark)_&]:text-black/60">
            <p class="my-2"><strong class="text-white/90 [html:not(.dark)_&]:text-black/90">What are recovery codes?</strong></p>
            <p class="my-2">Recovery codes allow you to reset your password if you forget it. Keep them safe and never share them with anyone.</p>
          </div>
        </div>
      {/if}
    </div>
  </div>

  <!-- Profile Selector Modal (for guest access) -->
  {#if showProfileSelector}
    <ProfileSelector
      onSelect={handleProfileSelected}
      onCancel={handleProfileCancel}
    />
  {/if}
{:else}
  <!-- User is authenticated - render main app -->
  <!-- Children are ONLY mounted when user is logged in -->
  <slot />
  {#if apiActionNotice}
    <div
      class="fixed right-5 bottom-5 z-[10001] max-w-[360px] rounded-lg border px-4 py-3 text-sm shadow-xl backdrop-blur-md
             {apiActionNotice.state === 'pending'
               ? 'border-blue-400/40 bg-blue-950/90 text-blue-100'
               : apiActionNotice.state === 'success'
                 ? 'border-emerald-400/40 bg-emerald-950/90 text-emerald-100'
                 : 'border-red-400/40 bg-red-950/90 text-red-100'}"
      role="status"
      aria-live="polite"
    >
      <div class="flex items-center gap-2">
        <span class="inline-block h-2 w-2 rounded-full
                    {apiActionNotice.state === 'pending'
                      ? 'bg-blue-300 animate-pulse'
                      : apiActionNotice.state === 'success'
                        ? 'bg-emerald-300'
                        : 'bg-red-300'}"></span>
        <span>{apiActionNotice.message}</span>
      </div>
    </div>
  {/if}
{/if}

<style>
  @keyframes slideIn {
    from {
      transform: translateY(-20px);
      opacity: 0;
    }
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }

  .animate-slideIn {
    animation: slideIn 0.3s ease-out;
  }
</style>
