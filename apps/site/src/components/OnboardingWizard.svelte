<script lang="ts">
  import { onMount } from 'svelte';
  import { apiFetch } from '../lib/client/api-config';
  import Step1Welcome from './onboarding/Step1_Welcome.svelte';
  import Step2Identity from './onboarding/Step2_Identity.svelte';
  import Step3PersonalityChoice from './onboarding/Step3_PersonalityChoice.svelte';
  import Step4Context from './onboarding/Step4_Context.svelte';
  import Step5Goals from './onboarding/Step5_Goals.svelte';
  import Step6Complete from './onboarding/Step6_Complete.svelte';

  export let onComplete: () => void;

  let currentStep = 1;
  let loading = false;
  let error = '';
  let showSkipModal = false;

  interface OnboardingState {
    completed: boolean;
    currentStep: number;
    stepsCompleted: {
      welcome: boolean;
      identity: boolean;
      personality: boolean;
      context: boolean;
      goals: boolean;
      review: boolean;
    };
    dataCollected: {
      identityQuestions: number;
      personalityQuestions: number;
      filesIngested: number;
      tasksCreated: number;
      memoriesCreated: number;
    };
  }

  let state: OnboardingState | null = null;

  // Load onboarding state
  async function loadState() {
    try {
      loading = true;
      const res = await apiFetch('/api/onboarding/state');
      if (res.ok) {
        const data = await res.json();
        state = data.state;
        if (state) {
          currentStep = state.currentStep || 1;
        }
      }
    } catch (err) {
      console.error('Failed to load onboarding state:', err);
      error = 'Failed to load progress';
    } finally {
      loading = false;
    }
  }

  // Update state on backend
  async function updateState(updates: Partial<OnboardingState>) {
    try {
      const res = await apiFetch('/api/onboarding/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
      });
      if (res.ok) {
        const data = await res.json();
        state = data.state;
      }
    } catch (err) {
      console.error('Failed to update state:', err);
    }
  }

  // Navigate to next step
  async function nextStep() {
    if (currentStep < 6) {
      currentStep++;
      await updateState({ currentStep });
    }
  }

  // Navigate to previous step
  function prevStep() {
    if (currentStep > 1) {
      currentStep--;
    }
  }

  // Handle step completion
  async function handleStepComplete(step: keyof OnboardingState['stepsCompleted']) {
    if (!state) return;

    const updates: Partial<OnboardingState> = {
      stepsCompleted: {
        ...state.stepsCompleted,
        [step]: true,
      },
    };

    await updateState(updates);
    await nextStep();
  }

  // Complete onboarding
  async function completeOnboarding() {
    try {
      loading = true;
      const res = await apiFetch('/api/onboarding/complete', {
        method: 'POST',
      });
      if (res.ok) {
        onComplete();
      } else {
        error = 'Failed to complete onboarding';
      }
    } catch (err) {
      console.error('Failed to complete onboarding:', err);
      error = 'Failed to complete onboarding';
    } finally {
      loading = false;
    }
  }

  // Skip onboarding
  async function skipOnboarding(reason?: string) {
    try {
      loading = true;
      const res = await apiFetch('/api/onboarding/skip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      if (res.ok) {
        onComplete();
      } else {
        error = 'Failed to skip onboarding';
      }
    } catch (err) {
      console.error('Failed to skip onboarding:', err);
      error = 'Failed to skip onboarding';
    } finally {
      loading = false;
      showSkipModal = false;
    }
  }

  onMount(() => {
    loadState();
  });

  $: progressPercent = ((currentStep - 1) / 5) * 100;
</script>

<div class="onboarding-backdrop">
  <div class="onboarding-container">
    <!-- Progress Bar -->
    <div class="progress-bar">
      <div class="progress-fill" style="width: {progressPercent}%"></div>
    </div>

    <div class="progress-text">
      Step {currentStep} of 6
    </div>

    <!-- Step Content -->
    <div class="step-content">
      {#if currentStep === 1}
        <Step1Welcome onNext={() => handleStepComplete('welcome')} onSkip={() => showSkipModal = true} />
      {:else if currentStep === 2}
        <Step2Identity
          onNext={() => handleStepComplete('identity')}
          onBack={prevStep}
          onSkip={() => showSkipModal = true}
        />
      {:else if currentStep === 3}
        <Step3PersonalityChoice
          onNext={() => handleStepComplete('personality')}
          onBack={prevStep}
        />
      {:else if currentStep === 4}
        <Step4Context
          onNext={() => handleStepComplete('context')}
          onBack={prevStep}
          onSkip={() => showSkipModal = true}
        />
      {:else if currentStep === 5}
        <Step5Goals
          onNext={() => handleStepComplete('goals')}
          onBack={prevStep}
          onSkip={() => showSkipModal = true}
        />
      {:else if currentStep === 6}
        <Step6Complete
          state={state}
          onComplete={completeOnboarding}
          onBack={prevStep}
        />
      {/if}
    </div>

    {#if error}
      <div class="error-message">{error}</div>
    {/if}
  </div>

  <!-- Skip Modal -->
  {#if showSkipModal}
    <div class="modal-backdrop" on:click={() => showSkipModal = false}>
      <div class="modal-content" on:click|stopPropagation>
        <h2>Skip Onboarding?</h2>

        <p class="modal-description">
          MetaHuman OS works best with your personal data to create an accurate dual consciousness emulation.
        </p>

        <div class="modal-section">
          <h3>You can input data later through:</h3>

          <div class="utility-list">
            <div class="utility-item">
              <div class="utility-icon">📝</div>
              <div class="utility-info">
                <strong>Memory Capture</strong>
                <ul>
                  <li>Chat interface (main view)</li>
                  <li>CLI: <code>./bin/mh capture "text"</code></li>
                  <li>API: <code>POST /api/capture</code></li>
                </ul>
              </div>
            </div>

            <div class="utility-item">
              <div class="utility-icon">📁</div>
              <div class="utility-info">
                <strong>File Ingestion</strong>
                <ul>
                  <li>Memory view → Upload tab</li>
                  <li>CLI: <code>./bin/mh ingest &lt;file&gt;</code></li>
                  <li>Drop files in: <code>memory/inbox/</code></li>
                </ul>
              </div>
            </div>

            <div class="utility-item">
              <div class="utility-icon">🎤</div>
              <div class="utility-info">
                <strong>Audio Upload</strong>
                <ul>
                  <li>Audio view → Upload tab</li>
                  <li>CLI: <code>./bin/mh audio ingest &lt;file&gt;</code></li>
                </ul>
              </div>
            </div>

            <div class="utility-item">
              <div class="utility-icon">✏️</div>
              <div class="utility-info">
                <strong>Manual Persona Editing</strong>
                <ul>
                  <li>System settings → Persona Editor</li>
                  <li>Direct JSON: <code>profiles/&#123;username&#125;/persona/core.json</code></li>
                </ul>
              </div>
            </div>
          </div>

          <p class="user-guide-link">
            📖 For detailed guidance, see the <a href="/user-guide" target="_blank">User Guide</a>
          </p>
        </div>

        <div class="modal-actions">
          <button class="btn btn-secondary" on:click={() => showSkipModal = false}>
            Continue Onboarding
          </button>
          <button class="btn btn-ghost" on:click={() => skipOnboarding('user_declined')}>
            Skip to App
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .onboarding-backdrop {
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

  :global(html:not(.dark)) .onboarding-backdrop {
    background: linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 50%, #cbd5e1 100%);
  }

  .onboarding-container {
    background: rgb(15, 23, 42);
    border-radius: 16px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
    max-width: 800px;
    width: 100%;
    padding: 2rem;
    animation: slideIn 0.3s ease-out;
  }

  :global(html:not(.dark)) .onboarding-container {
    background: white;
    border: 1px solid rgba(0, 0, 0, 0.1);
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

  .progress-bar {
    width: 100%;
    height: 8px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    overflow: hidden;
    margin-bottom: 0.5rem;
  }

  :global(html:not(.dark)) .progress-bar {
    background: rgba(0, 0, 0, 0.1);
  }

  .progress-fill {
    height: 100%;
    background: linear-gradient(135deg, #60a5fa 0%, #a78bfa 100%);
    transition: width 0.3s ease;
    border-radius: 4px;
  }

  .progress-text {
    text-align: center;
    font-size: 0.875rem;
    color: rgba(255, 255, 255, 0.6);
    margin-bottom: 2rem;
  }

  :global(html:not(.dark)) .progress-text {
    color: rgba(0, 0, 0, 0.6);
  }

  .step-content {
    min-height: 400px;
  }

  .error-message {
    padding: 0.75rem 1rem;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: 8px;
    color: #ef4444;
    font-size: 0.875rem;
    margin-top: 1rem;
  }

  /* Skip Modal */
  .modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.75);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 11000;
    padding: 1rem;
  }

  .modal-content {
    background: rgb(15, 23, 42);
    border-radius: 16px;
    max-width: 600px;
    width: 100%;
    padding: 2rem;
    max-height: 80vh;
    overflow-y: auto;
  }

  :global(html:not(.dark)) .modal-content {
    background: white;
  }

  .modal-content h2 {
    font-size: 1.5rem;
    font-weight: 700;
    margin: 0 0 1rem;
    color: white;
  }

  :global(html:not(.dark)) .modal-content h2 {
    color: rgb(17, 24, 39);
  }

  .modal-description {
    color: rgba(255, 255, 255, 0.8);
    margin-bottom: 1.5rem;
    line-height: 1.6;
  }

  :global(html:not(.dark)) .modal-description {
    color: rgba(0, 0, 0, 0.7);
  }

  .modal-section h3 {
    font-size: 1rem;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.9);
    margin: 0 0 1rem;
  }

  :global(html:not(.dark)) .modal-section h3 {
    color: rgba(0, 0, 0, 0.9);
  }

  .utility-list {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    margin-bottom: 1.5rem;
  }

  .utility-item {
    display: flex;
    gap: 1rem;
    padding: 1rem;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.1);
  }

  :global(html:not(.dark)) .utility-item {
    background: rgba(0, 0, 0, 0.03);
    border-color: rgba(0, 0, 0, 0.1);
  }

  .utility-icon {
    font-size: 1.5rem;
    flex-shrink: 0;
  }

  .utility-info {
    flex: 1;
  }

  .utility-info strong {
    display: block;
    color: rgba(255, 255, 255, 0.9);
    margin-bottom: 0.5rem;
  }

  :global(html:not(.dark)) .utility-info strong {
    color: rgba(0, 0, 0, 0.9);
  }

  .utility-info ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .utility-info li {
    font-size: 0.875rem;
    color: rgba(255, 255, 255, 0.7);
    margin-bottom: 0.25rem;
  }

  :global(html:not(.dark)) .utility-info li {
    color: rgba(0, 0, 0, 0.6);
  }

  .utility-info code {
    background: rgba(255, 255, 255, 0.1);
    padding: 0.125rem 0.375rem;
    border-radius: 4px;
    font-size: 0.8125rem;
    color: #60a5fa;
  }

  :global(html:not(.dark)) .utility-info code {
    background: rgba(0, 0, 0, 0.06);
    color: #2563eb;
  }

  .user-guide-link {
    text-align: center;
    font-size: 0.875rem;
    color: rgba(255, 255, 255, 0.7);
    margin-top: 1rem;
  }

  :global(html:not(.dark)) .user-guide-link {
    color: rgba(0, 0, 0, 0.6);
  }

  .user-guide-link a {
    color: #60a5fa;
    text-decoration: underline;
  }

  :global(html:not(.dark)) .user-guide-link a {
    color: #2563eb;
  }

  .modal-actions {
    display: flex;
    gap: 1rem;
    justify-content: center;
    margin-top: 2rem;
  }

  .btn {
    padding: 0.75rem 1.5rem;
    border-radius: 8px;
    font-size: 1rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
    border: none;
  }

  .btn-secondary {
    background: linear-gradient(135deg, #60a5fa 0%, #a78bfa 100%);
    color: white;
  }

  .btn-secondary:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(96, 165, 250, 0.4);
  }

  .btn-ghost {
    background: transparent;
    color: rgba(255, 255, 255, 0.7);
    border: 1px solid rgba(255, 255, 255, 0.2);
  }

  .btn-ghost:hover {
    color: white;
    border-color: rgba(255, 255, 255, 0.4);
  }

  :global(html:not(.dark)) .btn-ghost {
    color: rgba(0, 0, 0, 0.6);
    border-color: rgba(0, 0, 0, 0.2);
  }

  :global(html:not(.dark)) .btn-ghost:hover {
    color: rgba(0, 0, 0, 0.9);
    border-color: rgba(0, 0, 0, 0.4);
  }

  @media (max-width: 640px) {
    .onboarding-container {
      padding: 1.5rem;
    }

    .modal-content {
      padding: 1.5rem;
    }

    .utility-item {
      flex-direction: column;
      gap: 0.5rem;
    }

    .modal-actions {
      flex-direction: column;
    }
  }
</style>
