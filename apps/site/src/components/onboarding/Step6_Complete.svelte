<script lang="ts">
  import { onMount } from 'svelte';
  import { apiFetch } from '../../lib/client/api-config';

  export let onComplete: () => void;
  export let onBack: () => void;

  interface OnboardingState {
    completed: boolean;
    currentStep: number;
    stepsCompleted: Record<string, boolean>;
    dataCollected: {
      identityQuestions: number;
      personalityQuestions: number;
      filesIngested: number;
      tasksCreated: number;
      memoriesCreated: number;
    };
  }

  let state: OnboardingState | null = null;
  let loading = true;
  let completing = false;
  let error = '';

  onMount(async () => {
    await loadState();
  });

  async function loadState() {
    loading = true;
    try {
      const response = await apiFetch('/api/onboarding/state');
      if (!response.ok) {
        throw new Error('Failed to load onboarding state');
      }
      const data = await response.json();
      state = data.state;
    } catch (err) {
      error = (err as Error).message;
    } finally {
      loading = false;
    }
  }

  async function handleComplete() {
    completing = true;
    error = '';

    try {
      const response = await apiFetch('/api/onboarding/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        throw new Error('Failed to complete onboarding');
      }

      // Call parent completion handler
      onComplete();
    } catch (err) {
      error = (err as Error).message;
      completing = false;
    }
  }

  function getTotalDataPoints(): number {
    if (!state) return 0;
    const { dataCollected } = state;
    return (
      dataCollected.identityQuestions +
      dataCollected.personalityQuestions +
      dataCollected.filesIngested +
      dataCollected.tasksCreated +
      dataCollected.memoriesCreated
    );
  }
</script>

<div class="step-complete">
  {#if loading}
    <div class="loading">
      <div class="spinner"></div>
      <p>Loading your progress...</p>
    </div>
  {:else if state}
    <div class="completion-header">
      <div class="celebration-icon">🎉</div>
      <h1>You're All Set!</h1>
      <p class="celebration-message">
        Your MetaHuman is ready to begin learning and operating as your digital consciousness.
      </p>
    </div>

    <div class="summary-section">
      <h2>What We've Captured</h2>
      <div class="summary-grid">
        {#if state.dataCollected.identityQuestions > 0}
          <div class="summary-item">
            <div class="summary-icon">👤</div>
            <div class="summary-content">
              <div class="summary-number">{state.dataCollected.identityQuestions}</div>
              <div class="summary-label">Identity Details</div>
            </div>
          </div>
        {/if}

        {#if state.dataCollected.personalityQuestions > 0}
          <div class="summary-item">
            <div class="summary-icon">🧠</div>
            <div class="summary-content">
              <div class="summary-number">{state.dataCollected.personalityQuestions}</div>
              <div class="summary-label">Personality Questions</div>
            </div>
          </div>
        {/if}

        {#if state.dataCollected.filesIngested > 0}
          <div class="summary-item">
            <div class="summary-icon">📁</div>
            <div class="summary-content">
              <div class="summary-number">{state.dataCollected.filesIngested}</div>
              <div class="summary-label">Files Imported</div>
            </div>
          </div>
        {/if}

        {#if state.dataCollected.tasksCreated > 0}
          <div class="summary-item">
            <div class="summary-icon">✓</div>
            <div class="summary-content">
              <div class="summary-number">{state.dataCollected.tasksCreated}</div>
              <div class="summary-label">Tasks Created</div>
            </div>
          </div>
        {/if}
      </div>

      <div class="total-data">
        <strong>{getTotalDataPoints()}</strong> total data points captured
      </div>
    </div>

    <div class="next-steps">
      <h2>What Happens Next?</h2>
      <div class="steps">
        <div class="next-step">
          <div class="step-number">1</div>
          <div class="step-content">
            <h3>Background Processing</h3>
            <p>
              The Organizer agent will enrich your memories with tags, entities, and connections.
              This happens automatically in the background.
            </p>
          </div>
        </div>

        <div class="next-step">
          <div class="step-number">2</div>
          <div class="step-content">
            <h3>Personality Modeling</h3>
            <p>
              Your MetaHuman will analyze your communication patterns and personality traits
              to build a model that thinks like you.
            </p>
          </div>
        </div>

        <div class="next-step">
          <div class="step-number">3</div>
          <div class="step-content">
            <h3>Continuous Learning</h3>
            <p>
              As you use the system, your MetaHuman will learn from your decisions,
              preferences, and interactions to become more aligned with you over time.
            </p>
          </div>
        </div>

        <div class="next-step">
          <div class="step-number">4</div>
          <div class="step-content">
            <h3>Autonomous Operation</h3>
            <p>
              Background agents will work on your goals, generate reflections,
              and perform tasks autonomously while respecting your trust boundaries.
            </p>
          </div>
        </div>
      </div>
    </div>

    <div class="explore-features">
      <h2>Explore Key Features</h2>
      <div class="features-grid">
        <div class="feature-card">
          <div class="feature-icon">💬</div>
          <h3>Chat Interface</h3>
          <p>Have conversations with your digital consciousness</p>
        </div>

        <div class="feature-card">
          <div class="feature-icon">📝</div>
          <h3>Memory Capture</h3>
          <p>Record observations, events, and thoughts</p>
        </div>

        <div class="feature-card">
          <div class="feature-icon">📊</div>
          <h3>Dashboard</h3>
          <p>Monitor system status and agent activity</p>
        </div>

        <div class="feature-card">
          <div class="feature-icon">✅</div>
          <h3>Task Manager</h3>
          <p>Track goals and manage your to-do list</p>
        </div>

        <div class="feature-card">
          <div class="feature-icon">🔍</div>
          <h3>Memory Browser</h3>
          <p>Search and explore your episodic memories</p>
        </div>

        <div class="feature-card">
          <div class="feature-icon">⚙️</div>
          <h3>Settings</h3>
          <p>Configure persona, models, and preferences</p>
        </div>
      </div>
    </div>

    <div class="privacy-reminder">
      <div class="privacy-icon">🔒</div>
      <div class="privacy-text">
        <strong>Your Privacy is Protected</strong>
        <p>
          All your data remains on your local machine. MetaHuman OS operates 100% locally
          with no cloud dependencies, no external API calls, and no data sharing.
        </p>
      </div>
    </div>

    {#if error}
      <div class="error-message">
        <span class="error-icon">⚠️</span>
        {error}
      </div>
    {/if}
  {:else}
    <div class="error-state">
      <span class="error-icon">⚠️</span>
      <p>Failed to load onboarding data</p>
    </div>
  {/if}

  <div class="step-actions">
    <button class="btn btn-secondary" on:click={onBack} disabled={completing}>
      ← Back
    </button>
    <button
      class="btn btn-primary btn-large"
      on:click={handleComplete}
      disabled={completing}
    >
      {completing ? 'Finalizing...' : 'Complete Onboarding 🚀'}
    </button>
  </div>
</div>

<style>
  .step-complete {
    display: flex;
    flex-direction: column;
    gap: 2.5rem;
    max-width: 900px;
    margin: 0 auto;
    padding: 2rem;
  }

  .loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    padding: 3rem 2rem;
  }

  .spinner {
    width: 50px;
    height: 50px;
    border: 4px solid #e5e7eb;
    border-top-color: #667eea;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .loading p {
    color: #6b7280;
  }

  :global(.dark) .loading p {
    color: #9ca3af;
  }

  .completion-header {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 1rem;
    padding: 2rem 1rem;
  }

  .celebration-icon {
    font-size: 5rem;
    animation: bounce 2s ease-in-out infinite;
  }

  @keyframes bounce {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-20px); }
  }

  .completion-header h1 {
    font-size: 2.5rem;
    font-weight: 700;
    margin: 0;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  :global(.dark) .completion-header h1 {
    background: linear-gradient(135deg, #818cf8 0%, #a78bfa 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .celebration-message {
    font-size: 1.1rem;
    line-height: 1.6;
    color: #6b7280;
    margin: 0;
    max-width: 600px;
  }

  :global(.dark) .celebration-message {
    color: #9ca3af;
  }

  .summary-section {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    padding: 2rem;
    background: linear-gradient(135deg, #f9fafb 0%, #f3f4f6 100%);
    border-radius: 12px;
  }

  :global(.dark) .summary-section {
    background: linear-gradient(135deg, #1f2937 0%, #111827 100%);
  }

  .summary-section h2 {
    font-size: 1.5rem;
    font-weight: 600;
    margin: 0;
    color: #111827;
    text-align: center;
  }

  :global(.dark) .summary-section h2 {
    color: #f9fafb;
  }

  .summary-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1rem;
  }

  .summary-item {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1.25rem;
    background: white;
    border-radius: 8px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
  }

  :global(.dark) .summary-item {
    background: #374151;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  }

  .summary-icon {
    font-size: 2.5rem;
  }

  .summary-content {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .summary-number {
    font-size: 1.8rem;
    font-weight: 700;
    color: #667eea;
  }

  .summary-label {
    font-size: 0.9rem;
    color: #6b7280;
  }

  :global(.dark) .summary-label {
    color: #9ca3af;
  }

  .total-data {
    text-align: center;
    font-size: 1.1rem;
    color: #374151;
    padding-top: 1rem;
    border-top: 1px solid #e5e7eb;
  }

  :global(.dark) .total-data {
    color: #d1d5db;
    border-color: #4b5563;
  }

  .total-data strong {
    color: #667eea;
    font-size: 1.3rem;
  }

  .next-steps h2,
  .explore-features h2 {
    font-size: 1.5rem;
    font-weight: 600;
    margin: 0 0 1.5rem 0;
    color: #111827;
  }

  :global(.dark) .next-steps h2,
  :global(.dark) .explore-features h2 {
    color: #f9fafb;
  }

  .steps {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .next-step {
    display: flex;
    gap: 1rem;
    padding: 1.25rem;
    background: white;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
  }

  :global(.dark) .next-step {
    background: #374151;
    border-color: #4b5563;
  }

  .step-number {
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    font-weight: 700;
    font-size: 1.2rem;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .step-content h3 {
    font-size: 1.1rem;
    font-weight: 600;
    margin: 0 0 0.5rem 0;
    color: #111827;
  }

  :global(.dark) .step-content h3 {
    color: #f9fafb;
  }

  .step-content p {
    margin: 0;
    font-size: 0.95rem;
    line-height: 1.5;
    color: #6b7280;
  }

  :global(.dark) .step-content p {
    color: #9ca3af;
  }

  .features-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 1rem;
  }

  .feature-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 0.75rem;
    padding: 1.5rem 1rem;
    background: white;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    transition: all 0.2s ease;
  }

  :global(.dark) .feature-card {
    background: #374151;
    border-color: #4b5563;
  }

  .feature-card:hover {
    transform: translateY(-4px);
    box-shadow: 0 8px 16px rgba(0, 0, 0, 0.1);
  }

  .feature-icon {
    font-size: 2.5rem;
  }

  .feature-card h3 {
    font-size: 1rem;
    font-weight: 600;
    margin: 0;
    color: #111827;
  }

  :global(.dark) .feature-card h3 {
    color: #f9fafb;
  }

  .feature-card p {
    margin: 0;
    font-size: 0.85rem;
    line-height: 1.4;
    color: #6b7280;
  }

  :global(.dark) .feature-card p {
    color: #9ca3af;
  }

  .privacy-reminder {
    display: flex;
    align-items: start;
    gap: 1rem;
    padding: 1.5rem;
    background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%);
    border: 2px solid #10b981;
    border-radius: 8px;
  }

  :global(.dark) .privacy-reminder {
    background: linear-gradient(135deg, #064e3b 0%, #065f46 100%);
    border-color: #10b981;
  }

  .privacy-icon {
    font-size: 2rem;
    flex-shrink: 0;
  }

  .privacy-text strong {
    display: block;
    font-size: 1.1rem;
    color: #065f46;
    margin-bottom: 0.5rem;
  }

  :global(.dark) .privacy-text strong {
    color: #6ee7b7;
  }

  .privacy-text p {
    margin: 0;
    font-size: 0.95rem;
    line-height: 1.6;
    color: #047857;
  }

  :global(.dark) .privacy-text p {
    color: #a7f3d0;
  }

  .error-message {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    background: #fee2e2;
    border: 1px solid #ef4444;
    border-radius: 6px;
    color: #991b1b;
    font-size: 0.9rem;
  }

  :global(.dark) .error-message {
    background: #7f1d1d;
    border-color: #ef4444;
    color: #fecaca;
  }

  .error-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    padding: 3rem 2rem;
    text-align: center;
  }

  .error-icon {
    font-size: 1.2rem;
  }

  .step-actions {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    padding-top: 1rem;
    border-top: 1px solid #e5e7eb;
  }

  :global(.dark) .step-actions {
    border-color: #374151;
  }

  .btn {
    padding: 0.75rem 1.5rem;
    font-size: 1rem;
    font-weight: 600;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-primary {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
  }

  .btn-primary:hover:not(:disabled) {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
  }

  .btn-large {
    padding: 1rem 2rem;
    font-size: 1.1rem;
  }

  .btn-secondary {
    background: #f3f4f6;
    color: #374151;
    border: 1px solid #d1d5db;
  }

  :global(.dark) .btn-secondary {
    background: #374151;
    color: #d1d5db;
    border-color: #4b5563;
  }

  .btn-secondary:hover:not(:disabled) {
    background: #e5e7eb;
  }

  :global(.dark) .btn-secondary:hover:not(:disabled) {
    background: #4b5563;
  }

  @media (max-width: 768px) {
    .step-complete {
      padding: 1rem;
    }

    .completion-header h1 {
      font-size: 2rem;
    }

    .summary-grid {
      grid-template-columns: 1fr;
    }

    .features-grid {
      grid-template-columns: 1fr;
    }

    .step-actions {
      flex-direction: column;
    }
  }
</style>
