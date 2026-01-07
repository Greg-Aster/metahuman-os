<script lang="ts">
  import { onMount } from 'svelte';
  import { apiFetch } from '../lib/client/api-config';

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
      const res = await apiFetch('/api/profiles/list');
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
      const res = await apiFetch('/api/profiles/select', {
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

<div class="fixed inset-0 bg-black/85 backdrop-blur-sm flex items-center justify-center z-[10001] p-8">
  <div class="bg-slate-900 dark:bg-slate-900 border border-blue-400/30 dark:border-blue-400/30 rounded-2xl p-10 max-w-[600px] w-full max-h-[80vh] overflow-y-auto shadow-[0_8px_32px_rgba(96,165,250,0.2)] light:bg-white light:border-black/10 light:shadow-[0_8px_32px_rgba(0,0,0,0.15)]">
    <div class="text-center mb-8">
      <h2 class="text-blue-400 dark:text-blue-400 text-[1.75rem] font-bold m-0 mb-2">Select a Profile</h2>
      <p class="text-white/60 dark:text-white/60 text-[0.9rem] m-0">Choose a public profile to explore</p>
    </div>

    {#if loading}
      <div class="flex flex-col items-center gap-4 py-12 text-white/60 dark:text-white/60">
        <div class="w-10 h-10 border-[3px] border-white/10 dark:border-white/10 border-t-blue-400 dark:border-t-blue-400 rounded-full animate-spin"></div>
        <p>Loading profiles...</p>
      </div>
    {:else if error}
      <div class="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-500 text-[0.9rem] mb-4">
        <svg class="flex-shrink-0" width="16" height="16" viewBox="0 0 16 16" fill="none">
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
      <div class="flex flex-col items-center gap-4 py-12 text-center text-white/60 dark:text-white/60">
        <svg class="opacity-40" width="48" height="48" viewBox="0 0 24 24" fill="none">
          <path
            d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"
            fill="currentColor"
          />
        </svg>
        <h3 class="text-white/80 dark:text-white/80 text-xl m-0">No Public Profiles</h3>
        <p class="text-[0.9rem] max-w-[300px] m-0">There are currently no public profiles available to explore.</p>
      </div>
    {:else}
      <div class="flex flex-col gap-4 mb-8">
        {#each profiles as profile}
          <button
            class="flex items-center gap-4 p-5 bg-white/5 dark:bg-white/5 border border-white/10 dark:border-white/10 rounded-xl cursor-pointer transition-all text-left hover:enabled:bg-white/[0.08] hover:enabled:border-blue-400 hover:enabled:-translate-y-0.5 hover:enabled:shadow-[0_4px_12px_rgba(96,165,250,0.2)] disabled:opacity-50 disabled:cursor-not-allowed {profile.username === 'mutant-super-intelligence' ? 'mutant-profile' : ''}"
            on:click={() => selectProfile(profile.username)}
            disabled={selecting}
          >
            <div class="w-12 h-12 rounded-full bg-gradient-to-br from-blue-400 to-blue-300 dark:from-blue-400 dark:to-blue-300 flex items-center justify-center font-bold text-base text-white flex-shrink-0 {profile.username === 'mutant-super-intelligence' ? 'mutant-avatar' : ''}">
              {#if profile.username === 'mutant-super-intelligence'}
                🧬
              {:else}
                {getInitials(profile.displayName)}
              {/if}
            </div>
            <div class="flex-1 min-w-0">
              <div class="text-white dark:text-white font-semibold text-base overflow-hidden text-ellipsis whitespace-nowrap mb-1">{profile.displayName}</div>
              <div class="text-white/50 dark:text-white/50 text-sm overflow-hidden text-ellipsis whitespace-nowrap mb-2">
                {#if profile.username === 'mutant-super-intelligence'}
                  @merged-consciousness
                {:else}
                  @{profile.username}
                {/if}
              </div>
              <div class="inline-block px-2 py-0.5 rounded text-xs font-semibold {profile.username === 'mutant-super-intelligence' ? 'mutant-badge' : 'uppercase bg-green-500/20 text-green-500 border border-green-500/30'}">
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

    <div class="flex justify-center gap-4 mt-6">
      <button
        class="px-6 py-3 bg-white/5 dark:bg-white/5 border border-white/10 dark:border-white/10 rounded-lg text-white/80 dark:text-white/80 text-[0.9rem] font-medium cursor-pointer transition-all hover:enabled:bg-white/[0.08] hover:enabled:border-white/20 hover:enabled:text-white disabled:opacity-50 disabled:cursor-not-allowed"
        on:click={onCancel}
        disabled={selecting}
      >
        Back to Login
      </button>
    </div>
  </div>
</div>

<style>
  /* Easter Egg: Mutant Super Intelligence styling - animations only */
  .mutant-profile {
    background: linear-gradient(135deg, rgba(139, 92, 246, 0.15) 0%, rgba(236, 72, 153, 0.15) 50%, rgba(245, 158, 11, 0.15) 100%) !important;
    border: 2px solid !important;
    border-image: linear-gradient(135deg, #8b5cf6, #ec4899, #f59e0b) 1 !important;
    animation: mutantGlow 3s ease-in-out infinite;
  }

  @keyframes mutantGlow {
    0%, 100% { box-shadow: 0 0 20px rgba(139, 92, 246, 0.4); }
    33% { box-shadow: 0 0 20px rgba(236, 72, 153, 0.4); }
    66% { box-shadow: 0 0 20px rgba(245, 158, 11, 0.4); }
  }

  .mutant-profile:hover:not(:disabled) {
    transform: translateY(-4px) scale(1.02) !important;
    box-shadow: 0 8px 24px rgba(139, 92, 246, 0.5), 0 0 40px rgba(236, 72, 153, 0.3) !important;
  }

  .mutant-avatar {
    background: linear-gradient(135deg, #8b5cf6 0%, #ec4899 50%, #f59e0b 100%) !important;
    font-size: 1.5rem !important;
    animation: mutantSpin 10s linear infinite;
  }

  @keyframes mutantSpin {
    0% { transform: rotate(0deg); filter: hue-rotate(0deg); }
    100% { transform: rotate(360deg); filter: hue-rotate(360deg); }
  }

  .mutant-badge {
    background: linear-gradient(135deg, rgba(139, 92, 246, 0.3) 0%, rgba(236, 72, 153, 0.3) 50%, rgba(245, 158, 11, 0.3) 100%) !important;
    color: #f59e0b !important;
    border: 1px solid rgba(245, 158, 11, 0.5) !important;
    text-transform: none !important;
    font-weight: 700 !important;
  }
</style>
