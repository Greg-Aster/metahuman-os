<script lang="ts">
  import { onMount } from 'svelte';

  export let onReady: () => void = () => {};

  let bootData: any = null;
  let loadingSteps: Array<{ message: string; complete: boolean; timestamp?: number }> = [
    { message: 'Initializing MetaHuman OS', complete: false },
    { message: 'Loading persona identity', complete: false },
    { message: 'Connecting to local models', complete: false },
    { message: 'Mounting cognitive systems', complete: false },
    { message: 'Starting autonomous agents', complete: false },
    { message: 'System ready', complete: false },
  ];

  let currentStepIndex = 0;
  let isReady = false;
  let fadeOut = false;

  async function loadBootData() {
    try {
      const res = await fetch('/api/boot');
      if (res.ok) {
        bootData = await res.json();
        completeStep(1); // Persona loaded
      }
    } catch (error) {
      console.error('Failed to load boot data:', error);
    }
  }

  function completeStep(index: number) {
    if (index < loadingSteps.length) {
      loadingSteps[index].complete = true;
      loadingSteps[index].timestamp = Date.now();
      currentStepIndex = Math.max(currentStepIndex, index);
    }
  }

  async function progressLoading() {
    // Step 0: Initializing (immediate)
    completeStep(0);
    await new Promise(resolve => setTimeout(resolve, 200));

    // Step 1: Loading persona (wait for boot data)
    await loadBootData();
    await new Promise(resolve => setTimeout(resolve, 300));

    // Step 2: Connecting to models
    completeStep(2);
    await new Promise(resolve => setTimeout(resolve, 400));

    // Step 3: Mounting systems
    completeStep(3);
    await new Promise(resolve => setTimeout(resolve, 300));

    // Step 4: Starting agents
    completeStep(4);
    await new Promise(resolve => setTimeout(resolve, 400));

    // Step 5: Ready
    completeStep(5);
    await new Promise(resolve => setTimeout(resolve, 200));

    // Mark as ready and start fade out
    isReady = true;
    await new Promise(resolve => setTimeout(resolve, 500));
    fadeOut = true;

    // Call onReady callback after fade animation
    setTimeout(() => {
      onReady();
    }, 600);
  }

  onMount(() => {
    progressLoading();
  });

  function openUserGuide() {
    window.open('/docs/README.md', '_blank');
  }
</script>

<div class="splash-screen" class:fade-out={fadeOut}>
  <div class="splash-content">
    <!-- Header Section -->
    <div class="splash-header">
      <div class="logo-container">
        <div class="logo-pulse">
          <svg class="logo-icon" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
            <!-- Brain/Neural Network Icon -->
            <circle cx="50" cy="50" r="40" fill="none" stroke="currentColor" stroke-width="2" opacity="0.3"/>
            <circle cx="50" cy="50" r="30" fill="none" stroke="currentColor" stroke-width="2" opacity="0.5"/>
            <circle cx="50" cy="50" r="20" fill="none" stroke="currentColor" stroke-width="2" opacity="0.7"/>
            <circle cx="50" cy="50" r="5" fill="currentColor"/>

            <!-- Neural connections -->
            <line x1="50" y1="50" x2="30" y2="30" stroke="currentColor" stroke-width="1.5" opacity="0.6"/>
            <line x1="50" y1="50" x2="70" y2="30" stroke="currentColor" stroke-width="1.5" opacity="0.6"/>
            <line x1="50" y1="50" x2="70" y2="70" stroke="currentColor" stroke-width="1.5" opacity="0.6"/>
            <line x1="50" y1="50" x2="30" y2="70" stroke="currentColor" stroke-width="1.5" opacity="0.6"/>

            <circle cx="30" cy="30" r="3" fill="currentColor"/>
            <circle cx="70" cy="30" r="3" fill="currentColor"/>
            <circle cx="70" cy="70" r="3" fill="currentColor"/>
            <circle cx="30" cy="70" r="3" fill="currentColor"/>
          </svg>
        </div>
        <h1 class="title">MetaHuman OS</h1>
        <p class="subtitle">Autonomous Digital Personality Extension</p>
      </div>
    </div>

    <!-- Persona Information -->
    {#if bootData?.persona}
      <div class="persona-info">
        <div class="persona-avatar">
          {bootData.persona.identity?.name?.charAt(0).toUpperCase() || 'M'}
        </div>
        <div class="persona-details">
          <h2 class="persona-name">{bootData.persona.identity?.name || 'Loading...'}</h2>
          <p class="persona-role">{bootData.persona.identity?.role || ''}</p>
          {#if bootData.persona.identity?.purpose}
            <p class="persona-purpose">{bootData.persona.identity.purpose}</p>
          {/if}
        </div>
      </div>
    {:else}
      <div class="persona-info loading">
        <div class="persona-avatar skeleton">?</div>
        <div class="persona-details">
          <div class="skeleton-text"></div>
          <div class="skeleton-text short"></div>
        </div>
      </div>
    {/if}

    <!-- Loading Progress -->
    <div class="loading-section">
      <div class="loading-steps">
        {#each loadingSteps as step, i}
          <div class="loading-step" class:active={i === currentStepIndex} class:complete={step.complete}>
            <div class="step-icon">
              {#if step.complete}
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M13.5 4L6 11.5L2.5 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                </svg>
              {:else if i === currentStepIndex}
                <div class="spinner"></div>
              {:else}
                <div class="step-dot"></div>
              {/if}
            </div>
            <span class="step-message">{step.message}</span>
          </div>
        {/each}
      </div>
    </div>

    <!-- Quick Links -->
    <div class="quick-links">
      <button class="link-button" on:click={openUserGuide}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M8 1C4.13 1 1 4.13 1 8s3.13 7 7 7 7-3.13 7-7-3.13-7-7-7zm0 2c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm1 9H7V7h2v5z" fill="currentColor"/>
        </svg>
        User Guide
      </button>
      <a href="https://github.com/your-org/metahuman-os" target="_blank" class="link-button">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path fill-rule="evenodd" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" fill="currentColor"/>
        </svg>
        GitHub
      </a>
    </div>

    <!-- Version Info -->
    <div class="version-info">
      <span>v{bootData?.version || '1.0.0'}</span>
      {#if bootData?.modelInfo}
        <span class="separator">•</span>
        <span>{bootData.modelInfo.model || 'Local Models'}</span>
      {/if}
    </div>
  </div>
</div>

<style>
  .splash-screen {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    opacity: 1;
    transition: opacity 0.6s ease-out;
  }

  .splash-screen.fade-out {
    opacity: 0;
    pointer-events: none;
  }

  .splash-content {
    max-width: 600px;
    width: 90%;
    text-align: center;
    color: #ffffff;
  }

  /* Header */
  .splash-header {
    margin-bottom: 3rem;
  }

  .logo-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
  }

  .logo-pulse {
    width: 120px;
    height: 120px;
    display: flex;
    align-items: center;
    justify-content: center;
    animation: pulse 2s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { transform: scale(1); opacity: 1; }
    50% { transform: scale(1.05); opacity: 0.8; }
  }

  .logo-icon {
    width: 100%;
    height: 100%;
    color: #60a5fa;
    filter: drop-shadow(0 0 20px rgba(96, 165, 250, 0.5));
  }

  .title {
    font-size: 2.5rem;
    font-weight: 700;
    margin: 0;
    background: linear-gradient(135deg, #60a5fa 0%, #a78bfa 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .subtitle {
    font-size: 1rem;
    color: rgba(255, 255, 255, 0.7);
    margin: 0.5rem 0 0;
  }

  /* Persona Info */
  .persona-info {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    padding: 1.5rem;
    margin-bottom: 2rem;
    display: flex;
    align-items: center;
    gap: 1.5rem;
    backdrop-filter: blur(10px);
  }

  .persona-avatar {
    width: 60px;
    height: 60px;
    border-radius: 50%;
    background: linear-gradient(135deg, #60a5fa 0%, #a78bfa 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.8rem;
    font-weight: 700;
    color: white;
    flex-shrink: 0;
  }

  .persona-avatar.skeleton {
    background: rgba(255, 255, 255, 0.1);
    animation: skeleton-pulse 1.5s ease-in-out infinite;
  }

  @keyframes skeleton-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  .persona-details {
    flex: 1;
    text-align: left;
  }

  .persona-name {
    font-size: 1.5rem;
    font-weight: 600;
    margin: 0 0 0.25rem;
    color: #ffffff;
  }

  .persona-role {
    font-size: 0.9rem;
    color: rgba(255, 255, 255, 0.7);
    margin: 0 0 0.5rem;
  }

  .persona-purpose {
    font-size: 0.85rem;
    color: rgba(255, 255, 255, 0.6);
    margin: 0;
    line-height: 1.4;
  }

  .skeleton-text {
    height: 20px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    margin-bottom: 0.5rem;
    animation: skeleton-pulse 1.5s ease-in-out infinite;
  }

  .skeleton-text.short {
    width: 60%;
  }

  /* Loading Steps */
  .loading-section {
    margin-bottom: 2rem;
  }

  .loading-steps {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    text-align: left;
  }

  .loading-step {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem;
    border-radius: 6px;
    transition: all 0.3s ease;
    color: rgba(255, 255, 255, 0.5);
  }

  .loading-step.active {
    background: rgba(96, 165, 250, 0.1);
    color: rgba(255, 255, 255, 0.9);
  }

  .loading-step.complete {
    color: rgba(255, 255, 255, 0.7);
  }

  .step-icon {
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .step-icon svg {
    color: #10b981;
  }

  .spinner {
    width: 16px;
    height: 16px;
    border: 2px solid rgba(96, 165, 250, 0.3);
    border-top-color: #60a5fa;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .step-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.3);
  }

  .step-message {
    font-size: 0.9rem;
  }

  /* Quick Links */
  .quick-links {
    display: flex;
    gap: 1rem;
    justify-content: center;
    margin-bottom: 1.5rem;
  }

  .link-button {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    color: rgba(255, 255, 255, 0.8);
    text-decoration: none;
    font-size: 0.9rem;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .link-button:hover {
    background: rgba(255, 255, 255, 0.1);
    border-color: rgba(255, 255, 255, 0.2);
    color: #ffffff;
    transform: translateY(-1px);
  }

  /* Version Info */
  .version-info {
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
  }

  .separator {
    opacity: 0.5;
  }
</style>
