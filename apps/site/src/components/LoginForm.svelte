<script lang="ts">
  let username = '';
  let password = '';
  let loading = false;
  let error = '';

  async function handleLogin() {
    error = '';
    loading = true;

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();

      if (data.success) {
        // Redirect to home page
        window.location.href = '/';
      } else {
        error = data.error || 'Login failed';
      }
    } catch (err) {
      error = 'Network error. Please try again.';
      console.error('[LoginForm] Error:', err);
    } finally {
      loading = false;
    }
  }

  function handleSubmit(e: Event) {
    e.preventDefault();
    handleLogin();
  }
</script>

<form on:submit={handleSubmit} class="login-form">
  {#if error}
    <div class="error-banner">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path
          d="M8 1L1 14h14L8 1z"
          stroke="currentColor"
          stroke-width="2"
          stroke-linejoin="round"
        />
        <path d="M8 6v3M8 11v1" stroke="currentColor" stroke-width="2" />
      </svg>
      <span>{error}</span>
    </div>
  {/if}

  <div class="form-group">
    <label for="username">Username</label>
    <input
      type="text"
      id="username"
      bind:value={username}
      placeholder="Enter your username"
      disabled={loading}
      required
      autocomplete="username"
    />
  </div>

  <div class="form-group">
    <label for="password">Password</label>
    <input
      type="password"
      id="password"
      bind:value={password}
      placeholder="Enter your password"
      disabled={loading}
      required
      autocomplete="current-password"
    />
  </div>

  <button type="submit" class="login-button" disabled={loading}>
    {#if loading}
      <span class="spinner"></span>
      Logging in...
    {:else}
      Login
    {/if}
  </button>
</form>

<style>
  .login-form {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .error-banner {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 1rem;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: 8px;
    color: #ef4444;
    font-size: 0.9rem;
  }

  .error-banner svg {
    flex-shrink: 0;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  label {
    color: rgba(255, 255, 255, 0.9);
    font-size: 0.9rem;
    font-weight: 500;
  }

  input {
    padding: 0.75rem 1rem;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    color: #fff;
    font-size: 1rem;
    transition: all 0.2s;
  }

  input:focus {
    outline: none;
    border-color: #e94560;
    background: rgba(255, 255, 255, 0.08);
  }

  input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  input::placeholder {
    color: rgba(255, 255, 255, 0.3);
  }

  .login-button {
    padding: 0.875rem 1.5rem;
    background: linear-gradient(135deg, #e94560 0%, #d63651 100%);
    border: none;
    border-radius: 8px;
    color: #fff;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
  }

  .login-button:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(233, 69, 96, 0.4);
  }

  .login-button:active:not(:disabled) {
    transform: translateY(0);
  }

  .login-button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .spinner {
    width: 16px;
    height: 16px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
