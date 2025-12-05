<script lang="ts">
  import { onMount } from 'svelte';
  import OnboardingWizard from './OnboardingWizard.svelte';
  import ProfileSelector from './ProfileSelector.svelte';
  import { apiFetch, isCapacitorNative, getApiBaseUrl } from '../lib/client/api-config';
  import { healthStatus, forceHealthCheck } from '../lib/client/server-health';
  import {
    validateLocalUser,
    registerLocalUser,
    cacheServerUser,
    hasLocalUsers,
    getAllLocalUsers,
    type LocalUser,
  } from '../lib/client/local-memory';

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
  let localUsers: LocalUser[] = [];

  // Form fields
  let username = '';
  let password = '';
  let confirmPassword = '';
  let displayName = '';
  let email = '';

  // Local profile options
  let profileType: 'local' | 'server' = 'server';

  // Recovery code fields
  let recoveryCode = '';
  let newPassword = '';
  let confirmNewPassword = '';
  let generatedRecoveryCodes: string[] = [];
  let registeredUsername = '';

  // Agreement checkboxes
  let agreeToTerms = false;
  let agreeToEthicalUse = false;

  // Subscribe to health status
  $: serverConnected = $healthStatus.connected;

  // Check if user is already authenticated
  async function checkAuth() {
    isMobile = isCapacitorNative();

    // Check for local users first
    try {
      localUsers = await getAllLocalUsers();
    } catch (e) {
      console.warn('Could not check local users:', e);
    }

    // Try server auth
    try {
      const res = await apiFetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        if (data.user) {
          isAuthenticated = true;
          isCheckingAuth = false;
          return;
        }
      }
    } catch (error) {
      console.warn('Server auth check failed (may be offline):', error);
    }

    isCheckingAuth = false;

    // If server unavailable, check health in background
    if (isMobile) {
      forceHealthCheck();
    }
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

  // Handle login - tries local first, then server
  async function handleLogin(e: Event) {
    e.preventDefault();
    error = '';
    loading = true;

    try {
      // First, try local authentication
      const localUser = await validateLocalUser(username, password);
      if (localUser) {
        console.log('[AuthGate] Local auth successful for:', username);

        // If it's a server profile and server is connected, also do server login
        if (localUser.profileType === 'server' && serverConnected) {
          try {
            const res = await apiFetch('/api/auth/login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ username, password }),
            });
            if (res.ok) {
              console.log('[AuthGate] Server login also successful');
            }
          } catch (e) {
            console.warn('[AuthGate] Server login failed, continuing with local:', e);
          }
        }

        isAuthenticated = true;
        window.location.reload();
        return;
      }

      // No local user found - try server if connected
      if (serverConnected) {
        const res = await apiFetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        });

        const data = await res.json();

        if (data.success) {
          // Cache the user locally for offline access
          const serverUrl = getApiBaseUrl();
          await cacheServerUser(username, password, serverUrl, data.user?.displayName);
          console.log('[AuthGate] Server login successful, cached locally');

          isAuthenticated = true;
          window.location.reload();
          return;
        } else {
          error = data.error || 'Login failed';
        }
      } else {
        // No local user and server offline
        error = 'User not found locally. Connect to server to sync.';
        view = 'sync-prompt';
      }
    } catch (err) {
      error = 'Login failed. Check your credentials.';
      console.error('Login error:', err);
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
    checkAuth();
    loadBootData();
  });
</script>

{#if !isAuthenticated || view === 'post-register' || view === 'onboarding' || view === 'recovery-codes'}
  <div class="auth-backdrop">
    <div class="auth-container" class:onboarding-container={view === 'onboarding'}>
      {#if view === 'onboarding'}
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
                required
                disabled={loading}
                autocomplete="current-password"
              />
            </div>

            {#if error}
              <div class="error-message">{error}</div>
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
