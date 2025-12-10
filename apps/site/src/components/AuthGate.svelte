<script lang="ts">
  import { onMount } from 'svelte';
  import OnboardingWizard from './OnboardingWizard.svelte';
  import ProfileSelector from './ProfileSelector.svelte';
  import { apiFetch, isCapacitorNative, getApiBaseUrl, initServerUrl, getSyncServerUrl, remoteFetch, normalizeUrl } from '../lib/client/api-config';
  import { healthStatus, forceHealthCheck } from '../lib/client/server-health';

  // Simple localStorage for session (same concept as cookies on web)
  // NO IndexedDB complexity - just store the session ID
  function getStoredSession(): { sessionId: string; username: string } | null {
    try {
      const stored = localStorage.getItem('mh_session');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  }

  function storeSession(sessionId: string, username: string): void {
    localStorage.setItem('mh_session', JSON.stringify({ sessionId, username }));
  }

  function clearStoredSession(): void {
    localStorage.removeItem('mh_session');
  }

  let view: 'splash' | 'login' | 'register' | 'register-type' | 'register-local' | 'post-register' | 'onboarding' | 'forgot-password' | 'recovery-codes' | 'sync-prompt' = 'splash';
  let isAuthenticated = false;
  let isCheckingAuth = true;
  let bootData: any = null;
  let error = '';
  let loading = false;
  let showProfileSelector = false;
  let guestSessionError = '';

  // Server connection state
  let serverConnected = false;
  let isMobile = false;

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
  // IDENTICAL for web and mobile - just check the API
  async function checkAuth() {
    console.log('[AuthGate] checkAuth() starting');
    isMobile = isCapacitorNative();

    // Check API auth - SAME code path for web and mobile
    // Web: cookie sent automatically
    // Mobile: session ID passed via nodeBridge
    try {
      const res = await apiFetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        if (data.user) {
          console.log('[AuthGate] Auth successful for:', data.user.username);
          isAuthenticated = true;
          isCheckingAuth = false;
          return;
        }
      }
    } catch (error) {
      console.warn('[AuthGate] Auth check failed:', error);
    }

    // No authentication found - show login screen
    console.log('[AuthGate] No auth found, showing login screen');
    isCheckingAuth = false;
  }

  // Load boot data (persona info for splash)
  async function loadBootData() {
    try {
      const res = await apiFetch('/api/boot');
      if (res.ok) {
        bootData = await res.json();
      }
    } catch (error) {
      console.warn('Failed to load boot data (may be offline):', error);
    }
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
        error = `✅ LOGIN SUCCESS! Welcome back, ${data.user.username}. Profile loaded and ready.`;
        console.log('[AuthGate] LOGIN SUCCESS: Profile validation passed, proceeding...');
        
        setTimeout(() => {
          isAuthenticated = true;
          window.location.reload();
        }, 1500);
      }

      // Login failed - show error and determine if user might need to sync
      // User can click "Sync from Server" button if they need to create/sync account
      // DON'T auto-redirect to sync-prompt - that was confusing for wrong password
      error = data.error || 'Login failed. Check your credentials.';

      // Show sync hint to help users who may need to sync from another device
      // On mobile: Always show hint (likely setting up new device)
      // On web: Show hint for any authentication failure (user might need to sync)
      // The hint is dismissible and clears when user starts typing
      showSyncHint = isMobile || error.toLowerCase().includes('invalid');
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

      // Step 2: Create the user locally (via API) so they exist in local users.json
      // This makes web and mobile identical - both use users.json
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
        error = createData.error || 'Failed to create local profile';
        return;
      }

      // Store session now so profile sync requests are authenticated
      if (createData.sessionId) {
        storeSession(createData.sessionId, username);
      }

      // Step 3: Export profile data from remote and import locally
      console.log('[AuthGate] Downloading profile data from remote...');
      
      // Show progress notification
      error = '📥 SYNCING: Downloading profile data from server...';
      
      let profileBundle = null;
      let syncStrategy = 'unknown';
      
      try {
        // Try priority export first (essential files only to avoid OOM)
        console.log('[AuthGate] Attempting priority sync (persona + config only)...');
        error = '📥 SYNCING: Downloading essential profile data (persona, config, conversations)...';

        const priorityRes = await remoteFetch(`${normalizedSyncUrl}/api/profile-sync/export-priority`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Cookie': `mh_session=${serverSessionId}`
          },
        });

        if (priorityRes.ok) {
          profileBundle = await priorityRes.json();
          syncStrategy = 'priority';
          error = `📥 SYNCING: Downloaded ${profileBundle.stats?.totalFiles || 0} files from server (${Math.round((profileBundle.stats?.totalSize || 0) / 1024)}KB)`;
        } else {
          // Show UI error for priority export failure
          const priorityError = await priorityRes.text().catch(() => 'Network error');
          
          // Fallback to full export (may cause OOM on large profiles)
          error = '📥 SYNCING: Priority sync failed, trying full profile download...';

          const fullRes = await remoteFetch(`${normalizedSyncUrl}/api/profile-sync/export`, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
              'Cookie': `mh_session=${serverSessionId}`
            },
          });

          if (fullRes.ok) {
            profileBundle = await fullRes.json();
            syncStrategy = 'full';
            error = `📥 SYNCING: Downloaded complete profile - ${profileBundle.stats?.totalFiles || 0} files (${Math.round((profileBundle.stats?.totalSize || 0) / 1024)}KB)`;
          } else {
            const fullError = await fullRes.text().catch(() => 'Network error');
            // STOP HERE - DO NOT LOG USER IN WITH EMPTY PROFILE
            error = `SYNC FAILED: Cannot download profile from server. Priority sync (${priorityRes.status}): ${priorityError}. Full sync (${fullRes.status}): ${fullError}. You cannot log in without syncing your profile data.`;
            return;
          }
        }

        // Import profile bundle locally
        if (profileBundle) {
          error = '💾 SYNCING: Importing profile files to local storage...';
          
          const importRes = await apiFetch('/api/profile-sync/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(profileBundle),
          });

          if (!importRes.ok) {
            const importError = await importRes.text().catch(() => 'Unknown import error');
            error = `IMPORT FAILED: Cannot save profile data locally. Error (${importRes.status}): ${importError}. Your profile was not synced.`;
            return;
          }

          const importData = await importRes.json();
          if (!importData.success) {
            error = `IMPORT FAILED: ${importData.error || 'Failed to save profile files'}. Your profile was not synced.`;
            return;
          }

          // SUCCESS - profile actually synced
          if (!importData.imported || importData.imported === 0) {
            error = `SYNC INCOMPLETE: No files were imported. Your profile is empty.`;
            return;
          }
          
          // SHOW SUCCESS MESSAGE
          error = `✅ SYNC SUCCESS! Imported ${importData.imported} files from ${syncServerUrl}. Profile ready!`;
          console.log(`[AuthGate] SYNC SUCCESS: ${importData.imported} files imported via ${syncStrategy} sync`);
        } else {
          error = 'SYNC FAILED: No profile data received from server. Cannot log you in with empty profile.';
          return;
        }
      } catch (profileErr) {
        error = `SYNC NETWORK ERROR: Cannot connect to server or download profile. ${profileErr instanceof Error ? profileErr.message : 'Connection failed'}. Check your network and server URL.`;
        return;
      }

      // SUCCESS - Actually synced profile data
      // Give user a moment to see the success message
      setTimeout(() => {
        isAuthenticated = true;
        window.location.reload();
      }, 2000);
    } catch (err) {
      error = `SYNC FAILED: ${err instanceof Error ? err.message : 'Unknown error'}. You cannot log in without syncing your profile.`;
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
        // Store recovery codes
        if (data.recoveryCodes && Array.isArray(data.recoveryCodes)) {
          generatedRecoveryCodes = data.recoveryCodes;
          // Show recovery codes first
          view = 'recovery-codes';
        } else {
          // Fallback to post-register if no codes
          view = 'post-register';
        }
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
    checkAuth();
    loadBootData();
  });
</script>

{#if !isAuthenticated || view === 'post-register' || view === 'onboarding' || view === 'recovery-codes'}
  <div class="auth-backdrop">
    <div class="auth-container" class:onboarding-container={view === 'onboarding'}>
      {#if isCheckingAuth}
        <!-- Loading state while checking authentication -->
        <div class="splash-content">
          <div class="logo-section">
            <div class="logo-icon loading-pulse">
              <span class="logo-letter">🧠💻</span>
            </div>
            <h1 class="app-title">MetaHuman OS</h1>
            <p class="app-tagline">Checking authentication...</p>
          </div>
        </div>
      {:else if view === 'onboarding'}
        <!-- Onboarding Wizard -->
        <OnboardingWizard onComplete={handleOnboardingComplete} />
      {:else if view === 'post-register'}
        <!-- Post-Registration Options -->
        <div class="form-content">
          <div class="form-header">
            <div class="success-icon">✓</div>
            <h2>Account Created Successfully!</h2>
            <p>Welcome to MetaHuman OS</p>
          </div>

          <div class="post-register-options">
            <div class="option-card primary-option">
              <div class="option-icon">🧭</div>
              <h3>Setup Wizard (Recommended)</h3>
              <p>
                Guide me through setting up my digital consciousness with personalized questions,
                document import, and goal setting. Takes about 10-15 minutes.
              </p>
              <button class="btn btn-primary btn-block" on:click={startOnboarding}>
                Start Setup Wizard →
              </button>
            </div>

            <div class="option-card">
              <div class="option-icon">🚀</div>
              <h3>Skip and Explore</h3>
              <p>
                I'll add my data later through Memory Capture, Chat, File Ingestion,
                or other utilities. Let me explore the system first.
              </p>
              <button class="btn btn-secondary btn-block" on:click={skipOnboarding}>
                Continue to App
              </button>
            </div>
          </div>

          <div class="wizard-info">
            <p><strong>What the wizard does:</strong></p>
            <ul>
              <li>Captures your identity, personality, and communication style</li>
              <li>Imports documents and journals for context</li>
              <li>Sets up your goals and tasks</li>
              <li>All data stays 100% local on your machine</li>
            </ul>
          </div>
        </div>
      {:else if view === 'splash'}
        <!-- Splash Screen / Welcome -->
        <div class="splash-content">
          <div class="logo-section">
            <div class="logo-icon">
              {#if bootData?.persona?.identity?.icon}
                <img src={bootData.persona.identity.icon} alt="Logo" class="logo-img" />
              {:else}
                <span class="logo-letter">🧠💻</span>
              {/if}
            </div>
            <h1 class="app-title">MetaHuman OS</h1>
            <p class="app-tagline">Autonomous Digital Personality Extension</p>
          </div>

          <div class="welcome-text">
            <p>
              MetaHuman OS is a personal AI system that mirrors your identity, memories, and
              personality. It operates autonomously as a seamless extension of yourself.
            </p>
          </div>

          <div class="action-buttons">
            <button class="btn btn-primary" on:click={() => view = 'login'}>
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
                <path d="M8 8a3 3 0 100-6 3 3 0 000 6zm0 2c-2.67 0-8 1.34-8 4v1h16v-1c0-2.66-5.33-4-8-4z" fill="currentColor"/>
              </svg>
              Login
            </button>
            <button class="btn btn-secondary" on:click={() => view = 'register'}>
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
                <path d="M8 1a3 3 0 100 6 3 3 0 000-6zM6 9c-2.67 0-8 1.34-8 4v2h9v-2c0-1.48-1.21-2.77-3-3.46zM14 9h-2v2h-2v2h2v2h2v-2h2v-2h-2V9z" fill="currentColor"/>
              </svg>
              Create Account
            </button>
            <button class="btn btn-ghost" on:click={continueAsGuest}>
              Continue as Guest
            </button>
          </div>

          <div class="footer-info">
            <p class="license-text">
              <strong>CC BY-NC</strong> — Attribution - Non-Commercial
            </p>
            <p class="license-notice">
              The maker of this program lives in extreme poverty. Do not use the code of this project for profit.
            </p>

            <div class="footer-links">
              <a href="/user-guide" target="_blank" class="footer-link">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M8 1C4.13 1 1 4.13 1 8s3.13 7 7 7 7-3.13 7-7-3.13-7-7-7zm0 2c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm1 9H7V7h2v5z" fill="currentColor"/>
                </svg>
                User Guide
              </a>
              <a href="https://github.com/Greg-Aster/metahuman-os" target="_blank" class="footer-link">
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
        <div class="form-content">
          <button class="back-button" on:click={() => view = 'splash'}>
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
              <path d="M8 14L2 8l6-6M2 8h12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>

          <div class="form-header">
            <h2>Welcome Back</h2>
            <p>Sign in to your MetaHuman OS account</p>
          </div>

          <form on:submit={handleLogin}>
            <div class="form-group">
              <label for="login-username">Username</label>
              <input
                id="login-username"
                type="text"
                bind:value={username}
                on:input={() => { showSyncHint = false; error = ''; }}
                required
                disabled={loading}
                autocomplete="username"
              />
            </div>

            <div class="form-group">
              <label for="login-password">Password</label>
              <input
                id="login-password"
                type="password"
                bind:value={password}
                on:input={() => { showSyncHint = false; error = ''; }}
                required
                disabled={loading}
                autocomplete="current-password"
              />
            </div>

            {#if error}
              <div class="error-message">{error}</div>
            {/if}

            {#if showSyncHint}
              <div class="sync-hint">
                <div class="sync-hint-icon">🔄</div>
                <div class="sync-hint-content">
                  <strong>First time on this device?</strong>
                  <p>Your account may exist on another server. Sync to pull your profile here.</p>
                  <button class="btn btn-secondary" on:click={() => view = 'sync-prompt'}>
                    Sync from Server
                  </button>
                </div>
              </div>
            {/if}

            <button type="submit" class="btn btn-primary btn-block" disabled={loading}>
              {loading ? 'Signing in...' : 'Sign In'}
            </button>

            <div class="forgot-password-link">
              <button class="link-button" on:click={() => view = 'forgot-password'}>
                Forgot password?
              </button>
            </div>
          </form>

          <div class="form-footer">
            <p>
              Don't have an account?
              <button class="link-button" on:click={() => view = 'register'}>Create one</button>
            </p>
            {#if !showSyncHint}
              <p class="sync-link">
                Need to sync from another device?
                <button class="link-button" on:click={() => view = 'sync-prompt'}>Sync from Server</button>
              </p>
            {/if}
          </div>
        </div>
      {:else if view === 'register'}
        <!-- Registration Form -->
        <div class="form-content">
          <button class="back-button" on:click={() => view = 'splash'}>
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
              <path d="M8 14L2 8l6-6M2 8h12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>

          <div class="form-header">
            <h2>Create Account</h2>
            <p>Set up your personal MetaHuman OS instance</p>
          </div>

          <form on:submit={handleRegister}>
            <div class="form-group">
              <label for="reg-username">Username *</label>
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
              />
            </div>

            <div class="form-group">
              <label for="reg-display-name">Display Name</label>
              <input
                id="reg-display-name"
                type="text"
                bind:value={displayName}
                disabled={loading}
                placeholder="Optional"
              />
            </div>

            <div class="form-group">
              <label for="reg-email">Email</label>
              <input
                id="reg-email"
                type="email"
                bind:value={email}
                disabled={loading}
                placeholder="Optional"
                autocomplete="email"
              />
            </div>

            <div class="form-group">
              <label for="reg-password">Password *</label>
              <input
                id="reg-password"
                type="password"
                bind:value={password}
                required
                disabled={loading}
                autocomplete="new-password"
                minlength="6"
              />
            </div>

            <div class="form-group">
              <label for="reg-confirm-password">Confirm Password *</label>
              <input
                id="reg-confirm-password"
                type="password"
                bind:value={confirmPassword}
                required
                disabled={loading}
                autocomplete="new-password"
                minlength="6"
              />
            </div>

            {#if error}
              <div class="error-message">{error}</div>
            {/if}

            <!-- Terms of Service Agreement -->
            <div class="form-group checkbox-group">
              <label class="checkbox-label">
                <input
                  type="checkbox"
                  bind:checked={agreeToTerms}
                  disabled={loading}
                  required
                />
                <span>
                  I agree to the <a href="/user-guide#21-terms-of-service" target="_blank" rel="noopener noreferrer" class="tos-link">Terms of Service</a>
                </span>
              </label>
            </div>

            <!-- Ethical Use Policy Agreement -->
            <div class="form-group checkbox-group">
              <label class="checkbox-label">
                <input
                  type="checkbox"
                  bind:checked={agreeToEthicalUse}
                  disabled={loading}
                  required
                />
                <span class="ethical-use-text">
                  I will NOT impersonate any individual without their express consent,
                  I will NOT use this program to create malicious AI designed to harm others,
                  and I will NOT make Skynet.
                  <a href="/user-guide#22-ethical-use-policy" target="_blank" rel="noopener noreferrer" class="tos-link">Full Ethical Use Policy</a>
                </span>
              </label>
            </div>

            <button type="submit" class="btn btn-primary btn-block" disabled={loading || !agreeToTerms || !agreeToEthicalUse}>
              {loading ? 'Creating account...' : 'Create Account'}
            </button>
          </form>

          <div class="form-footer">
            <p>
              Already have an account?
              <button class="link-button" on:click={() => view = 'login'}>Sign in</button>
            </p>
          </div>
        </div>
      {:else if view === 'forgot-password'}
        <!-- Forgot Password / Recovery Code Form -->
        <div class="form-content">
          <button class="back-button" on:click={() => view = 'login'}>
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
              <path d="M8 14L2 8l6-6M2 8h12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>

          <div class="form-header">
            <h2>Reset Password</h2>
            <p>Use a recovery code to reset your password</p>
          </div>

          <form on:submit={handlePasswordReset}>
            <div class="form-group">
              <label for="reset-username">Username</label>
              <input
                id="reset-username"
                type="text"
                bind:value={username}
                required
                disabled={loading}
                autocomplete="username"
              />
            </div>

            <div class="form-group">
              <label for="recovery-code">Recovery Code</label>
              <input
                id="recovery-code"
                type="text"
                bind:value={recoveryCode}
                required
                disabled={loading}
                placeholder="XXXX-XXXX-XXXX-XXXX"
                pattern="[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}"
                title="Format: XXXX-XXXX-XXXX-XXXX"
                style="text-transform: uppercase; font-family: monospace;"
              />
              <small style="display: block; margin-top: 0.5rem; color: rgba(255,255,255,0.6); font-size: 0.8rem;">
                Enter one of your 10 recovery codes. Each code can only be used once.
              </small>
            </div>

            <div class="form-group">
              <label for="new-password">New Password</label>
              <input
                id="new-password"
                type="password"
                bind:value={newPassword}
                required
                disabled={loading}
                autocomplete="new-password"
                minlength="6"
              />
            </div>

            <div class="form-group">
              <label for="confirm-new-password">Confirm New Password</label>
              <input
                id="confirm-new-password"
                type="password"
                bind:value={confirmNewPassword}
                required
                disabled={loading}
                autocomplete="new-password"
                minlength="6"
              />
            </div>

            {#if error}
              <div class="error-message">{error}</div>
            {/if}

            <button type="submit" class="btn btn-primary btn-block" disabled={loading}>
              {loading ? 'Resetting password...' : 'Reset Password'}
            </button>
          </form>

          <div class="form-footer">
            <p>
              Remember your password?
              <button class="link-button" on:click={() => view = 'login'}>Sign in</button>
            </p>
          </div>
        </div>
      {:else if view === 'sync-prompt'}
        <!-- User Not Found - shown when user not found locally -->
        <div class="form-content">
          <button class="back-button" on:click={() => view = 'login'}>
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
              <path d="M8 14L2 8l6-6M2 8h12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>

          <div class="form-header">
            <div class="offline-icon">👤</div>
            <h2>User Not Found</h2>
            <p>No local profile for "{username}"</p>
          </div>

          {#if error}
            <div class="error-message">{error}</div>
          {/if}

          <div class="offline-options">
            <!-- Option 1: Sync from server -->
            <div class="option-card primary-option">
              <div class="option-icon">🔄</div>
              <h3>Sync from Server</h3>
              <p>Pull existing profile from a MetaHuman server</p>

              <div class="form-group" style="margin-bottom: 0.5rem;">
                <label for="sync-server" style="font-size: 0.75rem; opacity: 0.8; margin-bottom: 0.25rem; display: block;">Server URL</label>
                <input
                  id="sync-server"
                  type="url"
                  bind:value={syncServerUrl}
                  placeholder="https://mh.dndiy.org"
                  disabled={syncLoading}
                  style="width: 100%; padding: 0.5rem; border-radius: 6px; border: 1px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.05); color: white; font-size: 0.875rem;"
                />
              </div>

              <div class="form-group" style="margin-bottom: 0.5rem;">
                <label for="sync-username" style="font-size: 0.75rem; opacity: 0.8; margin-bottom: 0.25rem; display: block;">Username</label>
                <input
                  id="sync-username"
                  type="text"
                  bind:value={username}
                  placeholder="Your username"
                  disabled={syncLoading}
                  autocomplete="username"
                  style="width: 100%; padding: 0.5rem; border-radius: 6px; border: 1px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.05); color: white; font-size: 0.875rem;"
                />
              </div>

              <div class="form-group" style="margin-bottom: 0.75rem;">
                <label for="sync-password" style="font-size: 0.75rem; opacity: 0.8; margin-bottom: 0.25rem; display: block;">Password</label>
                <input
                  id="sync-password"
                  type="password"
                  bind:value={password}
                  placeholder="Your password"
                  disabled={syncLoading}
                  autocomplete="current-password"
                  style="width: 100%; padding: 0.5rem; border-radius: 6px; border: 1px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.05); color: white; font-size: 0.875rem;"
                />
              </div>

              <button class="btn btn-primary btn-block" on:click={handleSyncFromServer} disabled={syncLoading || !syncServerUrl || !username || !password}>
                {syncLoading ? 'Syncing...' : 'Sync Profile'}
              </button>
            </div>

            <!-- Option 2: Create local profile -->
            <div class="option-card">
              <div class="option-icon">➕</div>
              <h3>Create Local Profile</h3>
              <p>Create a new profile as "{username}" on this device</p>
              <button class="btn btn-secondary btn-block" on:click={handleOfflineLogin} disabled={loading}>
                {loading ? 'Creating...' : 'Create Profile'}
              </button>
            </div>
          </div>
        </div>
      {:else if view === 'register-local'}
        <!-- Local Profile Registration -->
        <div class="form-content">
          <button class="back-button" on:click={() => view = 'splash'}>
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
              <path d="M8 14L2 8l6-6M2 8h12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>

          <div class="form-header">
            <h2>Create Local Profile</h2>
            <p>This profile will be stored on your device only</p>
          </div>

          <form on:submit|preventDefault={handleLocalRegister}>
            <div class="form-group">
              <label for="local-username">Username *</label>
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
              />
            </div>

            <div class="form-group">
              <label for="local-display-name">Display Name</label>
              <input
                id="local-display-name"
                type="text"
                bind:value={displayName}
                disabled={loading}
                placeholder="Optional"
              />
            </div>

            <div class="form-group">
              <label for="local-password">Password *</label>
              <input
                id="local-password"
                type="password"
                bind:value={password}
                required
                disabled={loading}
                autocomplete="new-password"
                minlength="6"
              />
            </div>

            <div class="form-group">
              <label for="local-confirm-password">Confirm Password *</label>
              <input
                id="local-confirm-password"
                type="password"
                bind:value={confirmPassword}
                required
                disabled={loading}
                autocomplete="new-password"
                minlength="6"
              />
            </div>

            {#if error}
              <div class="error-message">{error}</div>
            {/if}

            <div class="local-profile-note">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M8 1C4.13 1 1 4.13 1 8s3.13 7 7 7 7-3.13 7-7-3.13-7-7-7zm0 2c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm1 9H7V7h2v5z" fill="currentColor"/>
              </svg>
              <span>This creates a local profile. Connect to a server later to sync your data.</span>
            </div>

            <button type="submit" class="btn btn-primary btn-block" disabled={loading}>
              {loading ? 'Creating...' : 'Create Local Profile'}
            </button>
          </form>
        </div>
      {:else if view === 'recovery-codes'}
        <!-- Recovery Codes Display (After Registration) -->
        <div class="form-content recovery-codes-view">
          <div class="form-header">
            <div class="success-icon">🔑</div>
            <h2>Save Your Recovery Codes</h2>
            <p>These codes can be used to reset your password if you forget it</p>
          </div>

          <div class="recovery-codes-warning">
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none" style="flex-shrink: 0;">
              <path d="M8 1L1 14h14L8 1z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
              <path d="M8 6v3M8 11v1" stroke="currentColor" stroke-width="2"/>
            </svg>
            <div>
              <strong>IMPORTANT:</strong> Save these codes in a secure location (password manager, printed copy, etc.).
              Each code can only be used once. You won't see them again!
            </div>
          </div>

          <div class="recovery-codes-grid">
            {#each generatedRecoveryCodes as code, index}
              <div class="recovery-code-item">
                <span class="code-number">{index + 1}.</span>
                <code class="code-value">{code}</code>
              </div>
            {/each}
          </div>

          <div class="recovery-codes-actions">
            <button
              class="btn btn-secondary"
              on:click={() => {
                const codesText = generatedRecoveryCodes.map((c, i) => `${i + 1}. ${c}`).join('\n');
                navigator.clipboard.writeText(codesText);
                alert('Recovery codes copied to clipboard!');
              }}
            >
              📋 Copy All Codes
            </button>
            <button
              class="btn btn-primary"
              on:click={() => view = 'post-register'}
            >
              I've Saved My Codes →
            </button>
          </div>

          <div class="recovery-codes-footer">
            <p><strong>What are recovery codes?</strong></p>
            <p>Recovery codes allow you to reset your password if you forget it. Keep them safe and never share them with anyone.</p>
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
{/if}

<style>
  .auth-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: linear-gradient(135deg, #1e293b 0%, #0f172a 50%, #020617 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    padding: 1rem;
    overflow-y: auto;
  }

  :global(html:not(.dark)) .auth-backdrop {
    background: linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 50%, #cbd5e1 100%);
  }

  .auth-container {
    background: rgb(15, 23, 42);
    border-radius: 16px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
    max-width: 500px;
    width: 100%;
    padding: 3rem 2.5rem;
    animation: slideIn 0.3s ease-out;
  }

  .onboarding-container {
    max-width: 1000px;
    max-height: 90vh;
    overflow-y: auto;
    padding: 2rem;
  }

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

  @keyframes pulse {
    0%, 100% {
      opacity: 1;
      transform: scale(1);
    }
    50% {
      opacity: 0.7;
      transform: scale(1.05);
    }
  }

  .loading-pulse {
    animation: pulse 1.5s ease-in-out infinite;
  }

  :global(html:not(.dark)) .auth-container {
    background: white;
    border: 1px solid rgba(0, 0, 0, 0.1);
  }

  /* Splash Content */
  .splash-content {
    text-align: center;
  }

  .logo-section {
    margin-bottom: 2rem;
  }

  .logo-icon {
    width: 100px;
    height: 100px;
    margin: 0 auto 1.5rem;
    border-radius: 50%;
    background: linear-gradient(135deg, #60a5fa 0%, #a78bfa 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 8px 24px rgba(96, 165, 250, 0.4);
  }

  .logo-img {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    object-fit: cover;
  }

  .logo-letter {
    font-size: 2.5rem;
    font-weight: 700;
    color: white;
  }

  .app-title {
    font-size: 2rem;
    font-weight: 700;
    margin: 0 0 0.5rem;
    background: linear-gradient(135deg, #60a5fa 0%, #a78bfa 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  :global(html:not(.dark)) .app-title {
    background: linear-gradient(135deg, #2563eb 0%, #7c3aed 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .app-tagline {
    font-size: 1rem;
    color: rgba(255, 255, 255, 0.6);
    margin: 0;
  }

  :global(html:not(.dark)) .app-tagline {
    color: rgba(0, 0, 0, 0.6);
  }

  .welcome-text {
    margin: 2rem 0;
    padding: 1.5rem;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.1);
  }

  :global(html:not(.dark)) .welcome-text {
    background: rgba(0, 0, 0, 0.03);
    border-color: rgba(0, 0, 0, 0.1);
  }

  .welcome-text p {
    margin: 0;
    line-height: 1.6;
    color: rgba(255, 255, 255, 0.8);
  }

  :global(html:not(.dark)) .welcome-text p {
    color: rgba(0, 0, 0, 0.7);
  }

  .action-buttons {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin: 2rem 0;
  }

  .footer-info {
    margin-top: 2rem;
    padding-top: 1.5rem;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
  }

  :global(html:not(.dark)) .footer-info {
    border-top-color: rgba(0, 0, 0, 0.1);
  }

  .license-text {
    font-size: 0.875rem;
    color: rgba(255, 255, 255, 0.7);
    margin: 0 0 0.5rem 0;
    text-align: center;
  }

  :global(html:not(.dark)) .license-text {
    color: rgba(0, 0, 0, 0.7);
  }

  .license-text strong {
    color: rgba(255, 255, 255, 0.9);
  }

  :global(html:not(.dark)) .license-text strong {
    color: rgba(0, 0, 0, 0.9);
  }

  .license-notice {
    font-size: 0.75rem;
    line-height: 1.5;
    color: rgba(255, 255, 255, 0.5);
    margin: 0 0 1rem 0;
    text-align: center;
  }

  :global(html:not(.dark)) .license-notice {
    color: rgba(0, 0, 0, 0.5);
  }

  .footer-links {
    display: flex;
    justify-content: center;
    gap: 0.75rem;
    margin-top: 1rem;
  }

  .footer-link {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.5rem 0.875rem;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 20px;
    font-size: 0.8125rem;
    color: rgba(255, 255, 255, 0.7);
    text-decoration: none;
    transition: all 0.2s;
  }

  .footer-link:hover {
    background: rgba(255, 255, 255, 0.1);
    border-color: rgba(255, 255, 255, 0.3);
    color: rgba(255, 255, 255, 0.9);
    transform: translateY(-1px);
  }

  :global(html:not(.dark)) .footer-link {
    background: rgba(0, 0, 0, 0.03);
    border-color: rgba(0, 0, 0, 0.15);
    color: rgba(0, 0, 0, 0.6);
  }

  :global(html:not(.dark)) .footer-link:hover {
    background: rgba(0, 0, 0, 0.06);
    border-color: rgba(0, 0, 0, 0.3);
    color: rgba(0, 0, 0, 0.9);
  }

  .footer-link svg {
    flex-shrink: 0;
  }

  /* Form Content */
  .form-content {
    position: relative;
  }

  .back-button {
    position: absolute;
    top: -1rem;
    left: -0.5rem;
    width: 36px;
    height: 36px;
    border-radius: 8px;
    border: none;
    background: rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.7);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
  }

  .back-button:hover {
    background: rgba(255, 255, 255, 0.2);
    color: white;
  }

  :global(html:not(.dark)) .back-button {
    background: rgba(0, 0, 0, 0.05);
    color: rgba(0, 0, 0, 0.6);
  }

  :global(html:not(.dark)) .back-button:hover {
    background: rgba(0, 0, 0, 0.1);
    color: rgba(0, 0, 0, 0.9);
  }

  .form-header {
    text-align: center;
    margin-bottom: 2rem;
  }

  .form-header h2 {
    font-size: 1.75rem;
    font-weight: 700;
    margin: 0 0 0.5rem;
    color: white;
  }

  :global(html:not(.dark)) .form-header h2 {
    color: rgb(17, 24, 39);
  }

  .form-header p {
    font-size: 0.95rem;
    color: rgba(255, 255, 255, 0.6);
    margin: 0;
  }

  :global(html:not(.dark)) .form-header p {
    color: rgba(0, 0, 0, 0.6);
  }

  .form-group {
    margin-bottom: 1.25rem;
  }

  .form-group label {
    display: block;
    font-size: 0.875rem;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.8);
    margin-bottom: 0.5rem;
  }

  :global(html:not(.dark)) .form-group label {
    color: rgba(0, 0, 0, 0.8);
  }

  .form-group input {
    width: 100%;
    padding: 0.75rem 1rem;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 8px;
    color: white;
    font-size: 1rem;
    transition: all 0.2s;
  }

  .form-group input:focus {
    outline: none;
    border-color: #60a5fa;
    background: rgba(255, 255, 255, 0.08);
  }

  .form-group input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  :global(html:not(.dark)) .form-group input {
    background: rgba(0, 0, 0, 0.03);
    border-color: rgba(0, 0, 0, 0.2);
    color: rgb(17, 24, 39);
  }

  :global(html:not(.dark)) .form-group input:focus {
    background: rgba(0, 0, 0, 0.05);
    border-color: #2563eb;
  }

  /* Checkbox group styles */
  .checkbox-group {
    margin-bottom: 1rem;
    padding: 0.75rem;
    background: rgba(59, 130, 246, 0.05);
    border: 1px solid rgba(59, 130, 246, 0.2);
    border-radius: 8px;
  }

  :global(html:not(.dark)) .checkbox-group {
    background: rgba(37, 99, 235, 0.05);
    border-color: rgba(37, 99, 235, 0.2);
  }

  .checkbox-label {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    cursor: pointer;
    font-size: 0.85rem;
    line-height: 1.5;
    color: rgba(255, 255, 255, 0.85);
  }

  :global(html:not(.dark)) .checkbox-label {
    color: rgba(0, 0, 0, 0.8);
  }

  .checkbox-label input[type="checkbox"] {
    width: auto;
    margin-top: 0.25rem;
    cursor: pointer;
    flex-shrink: 0;
    accent-color: #3b82f6;
  }

  .checkbox-label span {
    flex: 1;
  }

  .ethical-use-text {
    font-size: 0.8rem;
    line-height: 1.6;
  }

  .tos-link {
    color: #60a5fa;
    text-decoration: underline;
    font-weight: 500;
  }

  .tos-link:hover {
    color: #93c5fd;
  }

  :global(html:not(.dark)) .tos-link {
    color: #2563eb;
  }

  :global(html:not(.dark)) .tos-link:hover {
    color: #1d4ed8;
  }

  .error-message {
    padding: 0.75rem 1rem;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: 8px;
    color: #ef4444;
    font-size: 0.875rem;
    margin-bottom: 1rem;
  }

  .form-footer {
    margin-top: 1.5rem;
    text-align: center;
    font-size: 0.9rem;
    color: rgba(255, 255, 255, 0.6);
  }

  :global(html:not(.dark)) .form-footer {
    color: rgba(0, 0, 0, 0.6);
  }

  .sync-hint {
    display: flex;
    gap: 0.75rem;
    padding: 1rem;
    margin: 1rem 0;
    background: linear-gradient(135deg, rgba(59, 130, 246, 0.15), rgba(139, 92, 246, 0.15));
    border: 1px solid rgba(59, 130, 246, 0.3);
    border-radius: 0.75rem;
    align-items: flex-start;
  }

  .sync-hint-icon {
    font-size: 1.5rem;
    line-height: 1;
  }

  .sync-hint-content {
    flex: 1;
  }

  .sync-hint-content strong {
    display: block;
    color: #60a5fa;
    margin-bottom: 0.25rem;
  }

  .sync-hint-content p {
    font-size: 0.85rem;
    color: rgba(255, 255, 255, 0.7);
    margin: 0 0 0.75rem 0;
  }

  .sync-hint-content .btn {
    width: 100%;
    padding: 0.5rem 1rem;
    font-size: 0.9rem;
  }

  :global(.dark) .sync-hint-content p {
    color: rgba(255, 255, 255, 0.7);
  }

  :global(:not(.dark)) .sync-hint-content p {
    color: rgba(0, 0, 0, 0.6);
  }

  :global(:not(.dark)) .sync-hint-content strong {
    color: #3b82f6;
  }

  :global(:not(.dark)) .sync-hint {
    background: linear-gradient(135deg, rgba(59, 130, 246, 0.1), rgba(139, 92, 246, 0.1));
  }

  .sync-link {
    font-size: 0.8rem;
    margin-top: 0.5rem;
    opacity: 0.8;
  }

  .link-button {
    background: none;
    border: none;
    color: #60a5fa;
    cursor: pointer;
    text-decoration: underline;
    font-size: inherit;
    padding: 0;
  }

  .link-button:hover {
    color: #93c5fd;
  }

  :global(html:not(.dark)) .link-button {
    color: #2563eb;
  }

  :global(html:not(.dark)) .link-button:hover {
    color: #1d4ed8;
  }

  /* Buttons */
  .btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.875rem 1.5rem;
    border-radius: 10px;
    font-size: 1rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
    border: none;
    width: 100%;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-primary {
    background: linear-gradient(135deg, #60a5fa 0%, #a78bfa 100%);
    color: white;
  }

  .btn-primary:not(:disabled):hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(96, 165, 250, 0.4);
  }

  .btn-secondary {
    background: rgba(255, 255, 255, 0.1);
    color: white;
    border: 1px solid rgba(255, 255, 255, 0.2);
  }

  .btn-secondary:hover {
    background: rgba(255, 255, 255, 0.15);
  }

  :global(html:not(.dark)) .btn-secondary {
    background: rgba(0, 0, 0, 0.05);
    color: rgba(0, 0, 0, 0.8);
    border-color: rgba(0, 0, 0, 0.2);
  }

  :global(html:not(.dark)) .btn-secondary:hover {
    background: rgba(0, 0, 0, 0.08);
  }

  .btn-ghost {
    background: transparent;
    color: rgba(255, 255, 255, 0.7);
    border: 1px solid transparent;
  }

  .btn-ghost:hover {
    color: white;
    border-color: rgba(255, 255, 255, 0.2);
  }

  :global(html:not(.dark)) .btn-ghost {
    color: rgba(0, 0, 0, 0.6);
  }

  :global(html:not(.dark)) .btn-ghost:hover {
    color: rgba(0, 0, 0, 0.9);
    border-color: rgba(0, 0, 0, 0.2);
  }

  .btn-block {
    width: 100%;
  }

  /* Post-Registration Styles */
  .success-icon {
    width: 60px;
    height: 60px;
    margin: 0 auto 1rem;
    background: linear-gradient(135deg, #10b981 0%, #059669 100%);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 2rem;
    color: white;
  }

  .post-register-options {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    margin: 2rem 0;
  }

  .option-card {
    padding: 1.5rem;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    transition: all 0.2s;
  }

  :global(html:not(.dark)) .option-card {
    background: rgba(0, 0, 0, 0.03);
    border-color: rgba(0, 0, 0, 0.1);
  }

  .option-card.primary-option {
    border-color: #60a5fa;
    background: linear-gradient(135deg, rgba(96, 165, 250, 0.1) 0%, rgba(167, 139, 250, 0.1) 100%);
  }

  .option-icon {
    font-size: 2rem;
    margin-bottom: 0.75rem;
  }

  .option-card h3 {
    font-size: 1.2rem;
    font-weight: 600;
    margin: 0 0 0.5rem 0;
    color: white;
  }

  :global(html:not(.dark)) .option-card h3 {
    color: rgb(17, 24, 39);
  }

  .option-card p {
    margin: 0 0 1rem 0;
    font-size: 0.9rem;
    line-height: 1.5;
    color: rgba(255, 255, 255, 0.7);
  }

  :global(html:not(.dark)) .option-card p {
    color: rgba(0, 0, 0, 0.7);
  }

  .wizard-info {
    margin-top: 1.5rem;
    padding: 1rem 1.5rem;
    background: rgba(255, 255, 255, 0.05);
    border-left: 4px solid #60a5fa;
    border-radius: 4px;
  }

  :global(html:not(.dark)) .wizard-info {
    background: rgba(0, 0, 0, 0.03);
  }

  .wizard-info p {
    margin: 0 0 0.5rem 0;
    font-size: 0.9rem;
    color: rgba(255, 255, 255, 0.8);
  }

  :global(html:not(.dark)) .wizard-info p {
    color: rgba(0, 0, 0, 0.8);
  }

  .wizard-info ul {
    margin: 0;
    padding-left: 1.5rem;
    font-size: 0.85rem;
    line-height: 1.6;
    color: rgba(255, 255, 255, 0.7);
  }

  :global(html:not(.dark)) .wizard-info ul {
    color: rgba(0, 0, 0, 0.7);
  }

  /* Forgot Password Link */
  .forgot-password-link {
    text-align: center;
    margin-top: 0.75rem;
  }

  /* Recovery Codes View */
  .recovery-codes-view {
    max-width: 600px;
  }

  .recovery-codes-warning {
    display: flex;
    gap: 0.75rem;
    padding: 1rem;
    background: rgba(245, 158, 11, 0.1);
    border: 1px solid rgba(245, 158, 11, 0.3);
    border-radius: 8px;
    margin: 1.5rem 0;
    color: #fbbf24;
    font-size: 0.875rem;
    line-height: 1.5;
  }

  :global(html:not(.dark)) .recovery-codes-warning {
    background: rgba(245, 158, 11, 0.1);
    border-color: rgba(245, 158, 11, 0.4);
    color: #d97706;
  }

  .recovery-codes-warning strong {
    color: #f59e0b;
  }

  :global(html:not(.dark)) .recovery-codes-warning strong {
    color: #b45309;
  }

  .recovery-codes-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.75rem;
    margin: 1.5rem 0;
  }

  @media (max-width: 640px) {
    .recovery-codes-grid {
      grid-template-columns: 1fr;
    }
  }

  .recovery-code-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
  }

  :global(html:not(.dark)) .recovery-code-item {
    background: rgba(0, 0, 0, 0.03);
    border-color: rgba(0, 0, 0, 0.1);
  }

  .code-number {
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.5);
    min-width: 20px;
  }

  :global(html:not(.dark)) .code-number {
    color: rgba(0, 0, 0, 0.5);
  }

  .code-value {
    font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
    font-size: 0.9rem;
    color: #60a5fa;
    background: rgba(96, 165, 250, 0.1);
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    letter-spacing: 0.5px;
  }

  :global(html:not(.dark)) .code-value {
    color: #2563eb;
    background: rgba(37, 99, 235, 0.1);
  }

  .recovery-codes-actions {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin: 1.5rem 0;
  }

  .recovery-codes-footer {
    margin-top: 1.5rem;
    padding-top: 1.5rem;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    font-size: 0.875rem;
    color: rgba(255, 255, 255, 0.6);
  }

  :global(html:not(.dark)) .recovery-codes-footer {
    border-top-color: rgba(0, 0, 0, 0.1);
    color: rgba(0, 0, 0, 0.6);
  }

  .recovery-codes-footer p {
    margin: 0.5rem 0;
  }

  .recovery-codes-footer strong {
    color: rgba(255, 255, 255, 0.9);
  }

  :global(html:not(.dark)) .recovery-codes-footer strong {
    color: rgba(0, 0, 0, 0.9);
  }

  /* Local Mode Banner (Mobile Standalone) */
  .local-mode-banner {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    background: linear-gradient(135deg, rgba(96, 165, 250, 0.2) 0%, rgba(167, 139, 250, 0.2) 100%);
    border: 1px solid rgba(96, 165, 250, 0.4);
    border-radius: 8px;
    margin-bottom: 1.5rem;
    color: #60a5fa;
    font-size: 0.9rem;
    font-weight: 500;
  }

  :global(html:not(.dark)) .local-mode-banner {
    background: linear-gradient(135deg, rgba(37, 99, 235, 0.15) 0%, rgba(124, 58, 237, 0.15) 100%);
    color: #2563eb;
  }

  .local-indicator {
    font-size: 1.2rem;
  }

  /* Offline Banner on Splash (legacy, kept for server offline scenarios) */
  .offline-banner {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    background: linear-gradient(135deg, rgba(249, 115, 22, 0.2) 0%, rgba(220, 38, 38, 0.2) 100%);
    border: 1px solid rgba(249, 115, 22, 0.4);
    border-radius: 8px;
    margin-bottom: 1.5rem;
    color: #fb923c;
    font-size: 0.9rem;
  }

  :global(html:not(.dark)) .offline-banner {
    background: linear-gradient(135deg, rgba(249, 115, 22, 0.15) 0%, rgba(220, 38, 38, 0.15) 100%);
    color: #ea580c;
  }

  .offline-indicator {
    font-size: 1.2rem;
  }

  /* Offline / Sync Prompt Styles */
  .offline-icon {
    width: 60px;
    height: 60px;
    margin: 0 auto 1rem;
    background: linear-gradient(135deg, #f97316 0%, #dc2626 100%);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 2rem;
  }

  .offline-info {
    padding: 1rem;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: 8px;
    margin-bottom: 1.5rem;
    color: rgba(255, 255, 255, 0.8);
    font-size: 0.9rem;
  }

  :global(html:not(.dark)) .offline-info {
    color: rgba(0, 0, 0, 0.8);
  }

  .offline-options {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    margin-bottom: 1.5rem;
  }

  .local-users-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }

  .local-user-btn {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.75rem 1rem;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 8px;
    color: white;
    cursor: pointer;
    transition: all 0.2s;
  }

  .local-user-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    border-color: rgba(255, 255, 255, 0.3);
  }

  :global(html:not(.dark)) .local-user-btn {
    background: rgba(0, 0, 0, 0.03);
    border-color: rgba(0, 0, 0, 0.2);
    color: rgba(0, 0, 0, 0.9);
  }

  :global(html:not(.dark)) .local-user-btn:hover {
    background: rgba(0, 0, 0, 0.06);
  }

  .user-type {
    font-size: 0.75rem;
    padding: 0.25rem 0.5rem;
    background: rgba(96, 165, 250, 0.2);
    border-radius: 4px;
    color: #60a5fa;
  }

  .server-status {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    justify-content: center;
    padding: 0.75rem;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 8px;
    font-size: 0.85rem;
    color: rgba(255, 255, 255, 0.6);
  }

  :global(html:not(.dark)) .server-status {
    background: rgba(0, 0, 0, 0.03);
    color: rgba(0, 0, 0, 0.6);
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #10b981;
  }

  .status-dot.offline {
    background: #ef4444;
  }

  .local-profile-note {
    display: flex;
    gap: 0.5rem;
    padding: 0.75rem;
    background: rgba(96, 165, 250, 0.1);
    border: 1px solid rgba(96, 165, 250, 0.3);
    border-radius: 8px;
    margin-bottom: 1rem;
    font-size: 0.85rem;
    color: rgba(255, 255, 255, 0.8);
  }

  :global(html:not(.dark)) .local-profile-note {
    color: rgba(0, 0, 0, 0.8);
  }

  .local-profile-note svg {
    flex-shrink: 0;
    color: #60a5fa;
  }

  /* Responsive */
  @media (max-width: 640px) {
    .auth-container {
      padding: 2rem 1.5rem;
    }

    .logo-icon {
      width: 80px;
      height: 80px;
    }

    .logo-letter {
      font-size: 2rem;
    }

    .app-title {
      font-size: 1.75rem;
    }
  }
</style>
