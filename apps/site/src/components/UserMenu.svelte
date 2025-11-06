<script lang="ts">
  import { onMount } from 'svelte';

  interface User {
    id: string;
    username: string;
    role: 'owner' | 'guest' | 'anonymous';
  }

  let user: User | null = null;
  let loading = true;
  let menuOpen = false;

  onMount(async () => {
    await fetchUser();
  });

  async function fetchUser() {
    try {
      const response = await fetch('/api/auth/me');
      const data = await response.json();

      if (data.success && data.user) {
        user = data.user;
      } else {
        user = null;
      }
    } catch (err) {
      console.error('[UserMenu] Failed to fetch user:', err);
      user = null;
    } finally {
      loading = false;
    }
  }

  async function handleLogout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.href = '/';
    } catch (err) {
      console.error('[UserMenu] Logout failed:', err);
    }
  }

  function toggleMenu() {
    menuOpen = !menuOpen;
  }

  function closeMenu() {
    menuOpen = false;
  }

  // Close menu when clicking outside
  function handleClickOutside(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!target.closest('.user-menu')) {
      closeMenu();
    }
  }

  onMount(() => {
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  });
</script>

{#if loading}
  <div class="user-menu-loading">
    <div class="spinner-small"></div>
  </div>
{:else if user}
  <div class="user-menu">
    <button class="user-button" on:click={toggleMenu}>
      <div class="user-avatar">
        {user.username.charAt(0).toUpperCase()}
      </div>
      <span class="user-name">{user.username}</span>
      <svg
        class="chevron"
        class:open={menuOpen}
        width="12"
        height="12"
        viewBox="0 0 12 12"
        fill="none"
      >
        <path
          d="M2 4l4 4 4-4"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        />
      </svg>
    </button>

    {#if menuOpen}
      <div class="user-dropdown">
        <div class="dropdown-header">
          <div class="user-info">
            <div class="username">{user.username}</div>
          </div>
        </div>

        <div class="dropdown-divider"></div>

        <button class="dropdown-item" on:click={handleLogout}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M6 14H3a1 1 0 01-1-1V3a1 1 0 011-1h3M11 11l3-3-3-3M14 8H6"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
            />
          </svg>
          Logout
        </button>
      </div>
    {/if}
  </div>
{:else}
  <a href="/" class="login-link">Login</a>
{/if}

<style>
  .user-menu-loading {
    padding: 0.5rem;
  }

  .spinner-small {
    width: 20px;
    height: 20px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: #e94560;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .user-menu {
    position: relative;
  }

  .user-button {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.375rem 0.75rem;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    color: #fff;
    cursor: pointer;
    transition: all 0.2s;
  }

  .user-button:hover {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.2);
  }

  .user-avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: linear-gradient(135deg, #e94560 0%, #d63651 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 600;
    font-size: 0.75rem;
    color: #fff;
  }

  .user-name {
    font-size: 0.875rem;
    font-weight: 500;
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chevron {
    transition: transform 0.2s;
  }

  .chevron.open {
    transform: rotate(180deg);
  }

  .user-dropdown {
    position: absolute;
    top: calc(100% + 0.5rem);
    right: 0;
    min-width: 200px;
    background: rgba(30, 30, 40, 0.95);
    backdrop-filter: blur(10px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    overflow: hidden;
    z-index: 1000;
  }

  .dropdown-header {
    padding: 1rem;
  }

  .user-info {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .username {
    font-weight: 600;
    color: #fff;
    font-size: 0.9rem;
  }

  .dropdown-divider {
    height: 1px;
    background: rgba(255, 255, 255, 0.1);
  }

  .dropdown-item {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    background: transparent;
    border: none;
    color: rgba(255, 255, 255, 0.8);
    font-size: 0.875rem;
    cursor: pointer;
    transition: all 0.2s;
    text-align: left;
  }

  .dropdown-item:hover {
    background: rgba(255, 255, 255, 0.05);
    color: #fff;
  }

  .login-link {
    padding: 0.5rem 1rem;
    background: linear-gradient(135deg, #e94560 0%, #d63651 100%);
    border-radius: 8px;
    color: #fff;
    font-size: 0.875rem;
    font-weight: 600;
    text-decoration: none;
    transition: all 0.2s;
  }

  .login-link:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(233, 69, 96, 0.4);
  }
</style>
