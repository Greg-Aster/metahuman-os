<script lang="ts">
  import { onMount } from 'svelte';

  export let onSelect: (username: string) => void;
  export let onCancel: () => void;

  interface Profile {
    username: string;
    displayName: string;
    visibility: 'private' | 'public';
    role: 'owner' | 'guest' | 'anonymous';
  }

  let profiles: Profile[] = [];
  let loading = true;
  let error = '';
  let selecting = false;

  onMount(async () => {
    await fetchProfiles();
  });

  async function fetchProfiles() {
    try {
      const res = await fetch('/api/profiles/list');
      const data = await res.json();

      if (data.success) {
        profiles = data.profiles;
      } else {
        error = data.error || 'Failed to load profiles';
      }
    } catch (err) {
      console.error('[ProfileSelector] Error:', err);
      error = 'Network error. Please try again.';
    } finally {
      loading = false;
    }
  }

  async function selectProfile(username: string) {
    if (selecting) return;
    selecting = true;
    error = '';

    try {
      const res = await fetch('/api/profiles/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });

      const data = await res.json();

      if (data.success) {
        onSelect(username);
        window.location.href = '/'; // Navigate to main app
      } else {
        error = data.error || 'Failed to select profile';
        selecting = false;
      }
    } catch (err) {
      console.error('[ProfileSelector] Select error:', err);
      error = 'Network error. Please try again.';
      selecting = false;
    }
  }

  function getInitials(name: string): string {
    return name
      .split(' ')
      .map((word) => word[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }
</script>

<div class="modal-overlay">
  <div class="modal-container">
    <div class="modal-header">
      <h2>Select a Profile</h2>
      <p>Choose a public profile to explore</p>
    </div>

    {#if loading}
      <div class="loading-state">
        <div class="spinner"></div>
        <p>Loading profiles...</p>
      </div>
    {:else if error}
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
    {:else if profiles.length === 0}
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
          <path
            d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"
            fill="currentColor"
          />
        </svg>
        <h3>No Public Profiles</h3>
        <p>There are currently no public profiles available to explore.</p>
      </div>
    {:else}
      <div class="profiles-grid">
        {#each profiles as profile}
          <button
            class="profile-card"
            class:mutant-profile={profile.username === 'mutant-super-intelligence'}
            on:click={() => selectProfile(profile.username)}
            disabled={selecting}
          >
            <div class="profile-avatar" class:mutant-avatar={profile.username === 'mutant-super-intelligence'}>
              {#if profile.username === 'mutant-super-intelligence'}
                🧬
              {:else}
                {getInitials(profile.displayName)}
              {/if}
            </div>
            <div class="profile-info">
              <div class="profile-name">{profile.displayName}</div>
              <div class="profile-username">
                {#if profile.username === 'mutant-super-intelligence'}
                  @merged-consciousness
                {:else}
                  @{profile.username}
                {/if}
              </div>
              <div class="profile-badge" class:mutant-badge={profile.username === 'mutant-super-intelligence'} class:public={profile.username !== 'mutant-super-intelligence'}>
                {#if profile.username === 'mutant-super-intelligence'}
                  🧠 Merged conciousness of all public profiles.
                {:else}
                  Public
                {/if}
              </div>
            </div>
          </button>
        {/each}
      </div>
    {/if}

    <div class="modal-actions">
      <button class="cancel-button" on:click={onCancel} disabled={selecting}>
        Back to Login
      </button>
    </div>
  </div>
</div>

<style>
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.85);
    backdrop-filter: blur(8px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10001; /* Above AuthGate backdrop (10000) */
    padding: 2rem;
  }

  .modal-container {
    background: rgb(15, 23, 42);
    border: 1px solid rgba(96, 165, 250, 0.3);
    border-radius: 16px;
    padding: 2.5rem;
    max-width: 600px;
    width: 100%;
    max-height: 80vh;
    overflow-y: auto;
    box-shadow: 0 8px 32px rgba(96, 165, 250, 0.2);
  }

  :global(html:not(.dark)) .modal-container {
    background: white;
    border-color: rgba(0, 0, 0, 0.1);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
  }

  .modal-header {
    text-align: center;
    margin-bottom: 2rem;
  }

  .modal-header h2 {
    color: rgb(96, 165, 250);
    font-size: 1.75rem;
    font-weight: 700;
    margin: 0 0 0.5rem 0;
  }

  :global(html:not(.dark)) .modal-header h2 {
    color: rgb(37, 99, 235);
  }

  .modal-header p {
    color: rgba(255, 255, 255, 0.6);
    font-size: 0.9rem;
    margin: 0;
  }

  :global(html:not(.dark)) .modal-header p {
    color: rgba(0, 0, 0, 0.6);
  }

  .loading-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    padding: 3rem 0;
    color: rgba(255, 255, 255, 0.6);
  }

  :global(html:not(.dark)) .loading-state {
    color: rgba(0, 0, 0, 0.6);
  }

  .spinner {
    width: 40px;
    height: 40px;
    border: 3px solid rgba(255, 255, 255, 0.1);
    border-top-color: rgb(96, 165, 250);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  :global(html:not(.dark)) .spinner {
    border-color: rgba(0, 0, 0, 0.1);
    border-top-color: rgb(37, 99, 235);
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
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
    margin-bottom: 1rem;
  }

  .error-banner svg {
    flex-shrink: 0;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    padding: 3rem 0;
    text-align: center;
    color: rgba(255, 255, 255, 0.6);
  }

  :global(html:not(.dark)) .empty-state {
    color: rgba(0, 0, 0, 0.6);
  }

  .empty-state svg {
    opacity: 0.4;
  }

  .empty-state h3 {
    color: rgba(255, 255, 255, 0.8);
    font-size: 1.25rem;
    margin: 0;
  }

  :global(html:not(.dark)) .empty-state h3 {
    color: rgba(0, 0, 0, 0.8);
  }

  .empty-state p {
    font-size: 0.9rem;
    max-width: 300px;
    margin: 0;
  }

  .profiles-grid {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    margin-bottom: 2rem;
  }

  .profile-card {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1.25rem;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    cursor: pointer;
    transition: all 0.2s;
    text-align: left;
  }

  :global(html:not(.dark)) .profile-card {
    background: rgba(0, 0, 0, 0.03);
    border-color: rgba(0, 0, 0, 0.1);
  }

  .profile-card:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgb(96, 165, 250);
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(96, 165, 250, 0.2);
  }

  :global(html:not(.dark)) .profile-card:hover:not(:disabled) {
    background: rgba(0, 0, 0, 0.05);
    border-color: rgb(37, 99, 235);
    box-shadow: 0 4px 12px rgba(37, 99, 235, 0.15);
  }

  .profile-card:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .profile-avatar {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: linear-gradient(135deg, rgb(96, 165, 250) 0%, rgb(147, 197, 253) 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-size: 1rem;
    color: #fff;
    flex-shrink: 0;
  }

  :global(html:not(.dark)) .profile-avatar {
    background: linear-gradient(135deg, rgb(37, 99, 235) 0%, rgb(59, 130, 246) 100%);
  }

  .profile-info {
    flex: 1;
    min-width: 0;
  }

  .profile-name {
    color: #fff;
    font-weight: 600;
    font-size: 1rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin-bottom: 0.25rem;
  }

  :global(html:not(.dark)) .profile-name {
    color: rgb(17, 24, 39);
  }

  .profile-username {
    color: rgba(255, 255, 255, 0.5);
    font-size: 0.875rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin-bottom: 0.5rem;
  }

  :global(html:not(.dark)) .profile-username {
    color: rgba(0, 0, 0, 0.5);
  }

  .profile-badge {
    display: inline-block;
    padding: 0.125rem 0.5rem;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
  }

  .profile-badge.public {
    background: rgba(34, 197, 94, 0.2);
    color: #22c55e;
    border: 1px solid rgba(34, 197, 94, 0.3);
  }

  /* Easter Egg: Mutant Super Intelligence styling */
  .mutant-profile {
    background: linear-gradient(135deg, rgba(139, 92, 246, 0.15) 0%, rgba(236, 72, 153, 0.15) 50%, rgba(245, 158, 11, 0.15) 100%);
    border: 2px solid;
    border-image: linear-gradient(135deg, #8b5cf6, #ec4899, #f59e0b) 1;
    animation: mutantGlow 3s ease-in-out infinite;
  }

  @keyframes mutantGlow {
    0%, 100% {
      box-shadow: 0 0 20px rgba(139, 92, 246, 0.4);
    }
    33% {
      box-shadow: 0 0 20px rgba(236, 72, 153, 0.4);
    }
    66% {
      box-shadow: 0 0 20px rgba(245, 158, 11, 0.4);
    }
  }

  .mutant-profile:hover:not(:disabled) {
    transform: translateY(-4px) scale(1.02);
    box-shadow: 0 8px 24px rgba(139, 92, 246, 0.5), 0 0 40px rgba(236, 72, 153, 0.3);
  }

  .mutant-avatar {
    background: linear-gradient(135deg, #8b5cf6 0%, #ec4899 50%, #f59e0b 100%);
    font-size: 1.5rem;
    animation: mutantSpin 10s linear infinite;
  }

  @keyframes mutantSpin {
    0% {
      transform: rotate(0deg);
      filter: hue-rotate(0deg);
    }
    100% {
      transform: rotate(360deg);
      filter: hue-rotate(360deg);
    }
  }

  .profile-badge.mutant-badge {
    background: linear-gradient(135deg, rgba(139, 92, 246, 0.3) 0%, rgba(236, 72, 153, 0.3) 50%, rgba(245, 158, 11, 0.3) 100%);
    color: #f59e0b;
    border: 1px solid rgba(245, 158, 11, 0.5);
    text-transform: none;
    font-weight: 700;
  }

  .modal-actions {
    display: flex;
    justify-content: center;
    gap: 1rem;
    margin-top: 1.5rem;
  }

  .cancel-button {
    padding: 0.75rem 1.5rem;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    color: rgba(255, 255, 255, 0.8);
    font-size: 0.9rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }

  :global(html:not(.dark)) .cancel-button {
    background: rgba(0, 0, 0, 0.03);
    border-color: rgba(0, 0, 0, 0.1);
    color: rgba(0, 0, 0, 0.8);
  }

  .cancel-button:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.2);
    color: #fff;
  }

  :global(html:not(.dark)) .cancel-button:hover:not(:disabled) {
    background: rgba(0, 0, 0, 0.05);
    border-color: rgba(0, 0, 0, 0.2);
    color: rgba(0, 0, 0, 0.9);
  }

  .cancel-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
