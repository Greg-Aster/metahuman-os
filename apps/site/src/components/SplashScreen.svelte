<script lang="ts">
  import { onMount } from 'svelte';

  let bootData: any = null;
  let isVisible = false;
  let isLoading = true;
  let avatarError = false;

  async function loadBootData() {
    try {
      const res = await fetch('/api/boot');
      if (res.ok) {
        bootData = await res.json();
      }
    } catch (error) {
      console.error('Failed to load boot data:', error);
    } finally {
      isLoading = false;
    }
  }

  function handleClose() {
    isVisible = false;
    localStorage.setItem('hideWelcomeModal', 'true');
  }

  function openUserGuide() {
    window.open('/user-guide', '_blank');
  }

  onMount(() => {
    // Check if user has dismissed this before
    const hideModal = localStorage.getItem('hideWelcomeModal');
    if (hideModal !== 'true') {
      isVisible = true;
    }

    // Load persona data
    loadBootData();

    // Listen for toggle events from settings
    const handleToggle = (event: CustomEvent) => {
      if (event.detail.show) {
        // Re-enable modal
        isVisible = true;
        // Reload persona data in case it changed
        loadBootData();
      }
    };

    window.addEventListener('welcomeModalToggle', handleToggle as EventListener);

    return () => {
      window.removeEventListener('welcomeModalToggle', handleToggle as EventListener);
    };
  });
</script>

{#if isVisible}
  <div class="modal-backdrop" on:click={handleClose}>
    <div class="welcome-modal" on:click|stopPropagation>
      <!-- Close button -->
      <button class="close-button" on:click={handleClose} title="Close">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M15 5L5 15M5 5l10 10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </button>

      {#if isLoading}
        <!-- Loading state -->
        <div class="loading-state">
          <div class="spinner"></div>
          <p>Loading persona information...</p>
        </div>
      {:else if bootData?.persona}
        <!-- Persona Introduction -->
        <div class="modal-content">
          <!-- Header with Avatar -->
          <div class="persona-header">
            <div class="persona-avatar">
              {#if bootData.persona.identity?.icon && !avatarError}
                <img
                  src={bootData.persona.identity.icon}
                  alt={bootData.persona.identity?.name || 'Avatar'}
                  class="avatar-image"
                  on:error={() => avatarError = true}
                />
              {:else}
                <span class="avatar-letter">
                  {bootData.persona.identity?.name?.charAt(0).toUpperCase() || 'M'}
                </span>
              {/if}
            </div>
            <div class="persona-intro">
              <h1 class="persona-name">{bootData.persona.identity?.name || 'MetaHuman OS'}</h1>
              <p class="persona-tagline">Autonomous Digital Personality Extension</p>
            </div>
          </div>

          <!-- Persona Details -->
          <div class="persona-details">
            <div class="detail-section">
              <h3>Role</h3>
              <p>{bootData.persona.identity?.role || 'Digital assistant and cognitive augmentation system'}</p>
            </div>

            {#if bootData.persona.identity?.purpose}
              <div class="detail-section">
                <h3>Purpose</h3>
                <p>{bootData.persona.identity.purpose}</p>
              </div>
            {/if}

            {#if bootData.persona.values?.core}
              <div class="detail-section">
                <h3>Core Values</h3>
                <div class="values-list">
                  {#each bootData.persona.values.core.slice(0, 3) as value}
                    <div class="value-item">
                      <span class="value-icon">•</span>
                      <span class="value-name">{value.value}</span>
                      <span class="value-desc">— {value.description}</span>
                    </div>
                  {/each}
                </div>
              </div>
            {/if}
          </div>

          <!-- Action Links -->
          <div class="action-links">
            <button class="action-button primary" on:click={openUserGuide}>
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
                <path d="M8 1C4.13 1 1 4.13 1 8s3.13 7 7 7 7-3.13 7-7-3.13-7-7-7zm0 2c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm1 9H7V7h2v5z" fill="currentColor"/>
              </svg>
              View User Guide
            </button>
            <a href="https://github.com/Greg-Aster/metahuman-os" target="_blank" class="action-button secondary">
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
                <path fill-rule="evenodd" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" fill="currentColor"/>
              </svg>
              GitHub Repository
            </a>
          </div>

          <!-- Footer with "Don't show again" -->
          <div class="modal-footer">
            <label class="dont-show-again">
              <input type="checkbox" on:change={handleClose} />
              <span>Don't show this again</span>
            </label>
            <div class="version-info">
              v{bootData?.version || '1.0.0'}
              {#if bootData?.modelInfo?.model}
                <span class="separator">•</span>
                <span>{bootData.modelInfo.model}</span>
              {/if}
            </div>
          </div>
        </div>
      {:else}
        <!-- Fallback if persona data failed to load -->
        <div class="modal-content">
          <div class="persona-header">
            <div class="persona-avatar">
              <span class="avatar-letter">M</span>
            </div>
            <div class="persona-intro">
              <h1 class="persona-name">MetaHuman OS</h1>
              <p class="persona-tagline">Autonomous Digital Personality Extension</p>
            </div>
          </div>

          <div class="persona-details">
            <p>Welcome to MetaHuman OS. Your digital personality extension is ready.</p>
          </div>

          <div class="action-links">
            <button class="action-button primary" on:click={openUserGuide}>View User Guide</button>
            <a href="https://github.com/Greg-Aster/metahuman-os" target="_blank" class="action-button secondary">GitHub Repository</a>
          </div>

          <div class="modal-footer">
            <label class="dont-show-again">
              <input type="checkbox" on:change={handleClose} />
              <span>Don't show this again</span>
            </label>
          </div>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    padding: 1rem;
    animation: fadeIn 0.2s ease-out;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .welcome-modal {
    background: rgb(15, 23, 42);
    border-radius: 16px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
    max-width: 600px;
    width: 100%;
    max-height: 90vh;
    overflow-y: auto;
    position: relative;
    animation: slideIn 0.3s ease-out;
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

  :global(.dark) .welcome-modal {
    background: rgb(15, 23, 42);
    border: 1px solid rgba(255, 255, 255, 0.1);
  }

  :global(html:not(.dark)) .welcome-modal {
    background: white;
    border: 1px solid rgba(0, 0, 0, 0.1);
  }

  .close-button {
    position: absolute;
    top: 1rem;
    right: 1rem;
    width: 32px;
    height: 32px;
    border-radius: 6px;
    border: none;
    background: rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.7);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
    z-index: 1;
  }

  .close-button:hover {
    background: rgba(255, 255, 255, 0.2);
    color: white;
  }

  :global(html:not(.dark)) .close-button {
    background: rgba(0, 0, 0, 0.05);
    color: rgba(0, 0, 0, 0.5);
  }

  :global(html:not(.dark)) .close-button:hover {
    background: rgba(0, 0, 0, 0.1);
    color: rgba(0, 0, 0, 0.8);
  }

  .loading-state {
    padding: 3rem 2rem;
    text-align: center;
    color: rgba(255, 255, 255, 0.7);
  }

  :global(html:not(.dark)) .loading-state {
    color: rgba(0, 0, 0, 0.6);
  }

  .spinner {
    width: 40px;
    height: 40px;
    border: 3px solid rgba(96, 165, 250, 0.3);
    border-top-color: #60a5fa;
    border-radius: 50%;
    margin: 0 auto 1rem;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .modal-content {
    padding: 2.5rem 2rem 2rem;
  }

  /* Persona Header */
  .persona-header {
    display: flex;
    align-items: center;
    gap: 1.5rem;
    margin-bottom: 2rem;
    padding-bottom: 2rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  :global(html:not(.dark)) .persona-header {
    border-bottom-color: rgba(0, 0, 0, 0.1);
  }

  .persona-avatar {
    width: 80px;
    height: 80px;
    border-radius: 50%;
    background: linear-gradient(135deg, #60a5fa 0%, #a78bfa 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    box-shadow: 0 4px 12px rgba(96, 165, 250, 0.3);
    overflow: hidden;
    position: relative;
  }

  .avatar-image {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 50%;
  }

  .avatar-letter {
    font-size: 2rem;
    font-weight: 700;
    color: white;
  }

  .persona-intro {
    flex: 1;
    min-width: 0;
  }

  .persona-name {
    font-size: 1.75rem;
    font-weight: 700;
    margin: 0 0 0.5rem;
    color: white;
  }

  :global(html:not(.dark)) .persona-name {
    color: rgb(17, 24, 39);
  }

  .persona-tagline {
    font-size: 0.95rem;
    color: rgba(255, 255, 255, 0.6);
    margin: 0;
  }

  :global(html:not(.dark)) .persona-tagline {
    color: rgba(0, 0, 0, 0.5);
  }

  /* Persona Details */
  .persona-details {
    margin-bottom: 2rem;
  }

  .detail-section {
    margin-bottom: 1.5rem;
  }

  .detail-section:last-child {
    margin-bottom: 0;
  }

  .detail-section h3 {
    font-size: 0.875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: rgba(255, 255, 255, 0.5);
    margin: 0 0 0.5rem;
  }

  :global(html:not(.dark)) .detail-section h3 {
    color: rgba(0, 0, 0, 0.5);
  }

  .detail-section p {
    font-size: 0.95rem;
    line-height: 1.6;
    color: rgba(255, 255, 255, 0.8);
    margin: 0;
  }

  :global(html:not(.dark)) .detail-section p {
    color: rgba(0, 0, 0, 0.8);
  }

  .values-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .value-item {
    display: flex;
    align-items: baseline;
    font-size: 0.9rem;
    color: rgba(255, 255, 255, 0.8);
  }

  :global(html:not(.dark)) .value-item {
    color: rgba(0, 0, 0, 0.8);
  }

  .value-icon {
    color: #60a5fa;
    margin-right: 0.5rem;
    font-weight: bold;
  }

  .value-name {
    font-weight: 600;
    text-transform: capitalize;
    margin-right: 0.25rem;
  }

  .value-desc {
    color: rgba(255, 255, 255, 0.6);
  }

  :global(html:not(.dark)) .value-desc {
    color: rgba(0, 0, 0, 0.6);
  }

  /* Action Links */
  .action-links {
    display: flex;
    gap: 0.75rem;
    margin-bottom: 1.5rem;
  }

  .action-button {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    border-radius: 8px;
    font-size: 0.9rem;
    font-weight: 500;
    text-decoration: none;
    cursor: pointer;
    transition: all 0.2s;
    border: none;
  }

  .action-button.primary {
    background: linear-gradient(135deg, #60a5fa 0%, #a78bfa 100%);
    color: white;
  }

  .action-button.primary:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(96, 165, 250, 0.4);
  }

  .action-button.secondary {
    background: rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.9);
    border: 1px solid rgba(255, 255, 255, 0.2);
  }

  .action-button.secondary:hover {
    background: rgba(255, 255, 255, 0.15);
    border-color: rgba(255, 255, 255, 0.3);
  }

  :global(html:not(.dark)) .action-button.secondary {
    background: rgba(0, 0, 0, 0.05);
    color: rgba(0, 0, 0, 0.8);
    border-color: rgba(0, 0, 0, 0.1);
  }

  :global(html:not(.dark)) .action-button.secondary:hover {
    background: rgba(0, 0, 0, 0.08);
    border-color: rgba(0, 0, 0, 0.2);
  }

  /* Modal Footer */
  .modal-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-top: 1.5rem;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
  }

  :global(html:not(.dark)) .modal-footer {
    border-top-color: rgba(0, 0, 0, 0.1);
  }

  .dont-show-again {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.875rem;
    color: rgba(255, 255, 255, 0.7);
    cursor: pointer;
    user-select: none;
  }

  :global(html:not(.dark)) .dont-show-again {
    color: rgba(0, 0, 0, 0.6);
  }

  .dont-show-again input[type="checkbox"] {
    cursor: pointer;
  }

  .version-info {
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.4);
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  :global(html:not(.dark)) .version-info {
    color: rgba(0, 0, 0, 0.4);
  }

  .separator {
    opacity: 0.5;
  }

  /* Responsive */
  @media (max-width: 640px) {
    .modal-content {
      padding: 2rem 1.5rem 1.5rem;
    }

    .persona-header {
      flex-direction: column;
      text-align: center;
    }

    .persona-avatar {
      width: 60px;
      height: 60px;
    }

    .avatar-letter {
      font-size: 1.5rem;
    }

    .persona-name {
      font-size: 1.5rem;
    }

    .action-links {
      flex-direction: column;
    }

    .modal-footer {
      flex-direction: column;
      gap: 1rem;
      align-items: flex-start;
    }
  }
</style>
