<script lang="ts">
  import PersonaGeneratorEmbed from './PersonaGeneratorEmbed.svelte';
  import Step3Personality from './Step3_Personality.svelte';

  export let onNext: () => void;
  export let onBack: () => void;

  let choice: 'pending' | 'full-interview' | 'quick-survey' | 'skip' = 'pending';
  let showSkipNotification = false;

  function handleStartFullInterview() {
    choice = 'full-interview';
  }

  function handleStartQuickSurvey() {
    choice = 'quick-survey';
  }

  function handleSkipBoth() {
    showSkipNotification = true;
    // Auto-continue after showing notification
    setTimeout(() => {
      onNext();
    }, 3000);
  }

  function handleInterviewComplete() {
    // Persona generator completed and applied
    onNext();
  }

  function handleSurveyComplete() {
    // Quick survey completed
    onNext();
  }

  function handleBackToChoice() {
    choice = 'pending';
  }
</script>

<div class="personality-choice">
  {#if choice === 'pending'}
    <div class="choice-screen">
      <div class="choice-header">
        <h2>Build Your Personality Profile</h2>
        <p class="choice-description">
          Choose how you'd like to set up your personality profile. You can complete a deep interview,
          answer a quick survey, or skip and do it later.
        </p>
      </div>

      <div class="choice-cards">
        <button class="choice-card primary" on:click={handleStartFullInterview}>
          <div class="card-icon">🧠</div>
          <h3>Full Persona Interview</h3>
          <p class="card-description">
            7-15 adaptive questions using motivational interviewing techniques.
            Takes 15-20 minutes.
          </p>
          <ul class="card-features">
            <li>✓ Therapeutic conversation style</li>
            <li>✓ Analyzes communication patterns</li>
            <li>✓ Extracts Big Five personality traits</li>
            <li>✓ Identifies values, goals, and interests</li>
            <li>✓ Can pause and resume anytime</li>
          </ul>
          <div class="card-badge best">Most Comprehensive</div>
        </button>

        <button class="choice-card" on:click={handleStartQuickSurvey}>
          <div class="card-icon">📝</div>
          <h3>Quick Survey</h3>
          <p class="card-description">
            7 simple questions about your personality and preferences.
            Takes about 5 minutes.
          </p>
          <ul class="card-features">
            <li>✓ Fast and straightforward</li>
            <li>✓ Basic personality extraction</li>
            <li>✓ Good starting point</li>
            <li>✓ Can enhance later with full interview</li>
          </ul>
          <div class="card-badge">Fastest</div>
        </button>

        <button class="choice-card secondary" on:click={handleSkipBoth}>
          <div class="card-icon">⏭️</div>
          <h3>Skip for Now</h3>
          <p class="card-description">
            Complete the personality interview later from the System menu.
          </p>
          <ul class="card-features">
            <li>• Get started immediately</li>
            <li>• Access from System → Generator</li>
            <li>• All sessions saved and resumable</li>
            <li>• Manually edit persona files anytime</li>
          </ul>
        </button>
      </div>

      <div class="choice-footer">
        <button class="btn-link" on:click={onBack}>
          ← Back
        </button>
      </div>
    </div>
  {:else if choice === 'full-interview'}
    <PersonaGeneratorEmbed onComplete={handleInterviewComplete} onBack={handleBackToChoice} />
  {:else if choice === 'quick-survey'}
    <Step3Personality
      onNext={handleSurveyComplete}
      onBack={handleBackToChoice}
      onSkip={handleSkipBoth}
    />
  {/if}

  {#if showSkipNotification}
    <div class="skip-notification">
      <div class="notification-content">
        <div class="notification-icon">ℹ️</div>
        <div class="notification-text">
          <strong>Personality interview skipped</strong>
          <p>You can complete it anytime from <strong>System → Generator</strong></p>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .personality-choice {
    width: 100%;
  }

  .choice-screen {
    display: flex;
    flex-direction: column;
    gap: 2rem;
  }

  .choice-header {
    text-align: center;
  }

  .choice-header h2 {
    font-size: 1.75rem;
    font-weight: 700;
    margin: 0 0 1rem;
    color: white;
  }

  :global(html:not(.dark)) .choice-header h2 {
    color: rgb(17, 24, 39);
  }

  .choice-description {
    font-size: 1rem;
    line-height: 1.6;
    color: rgba(255, 255, 255, 0.8);
    margin: 0;
    max-width: 600px;
    margin-left: auto;
    margin-right: auto;
  }

  :global(html:not(.dark)) .choice-description {
    color: rgba(0, 0, 0, 0.7);
  }

  .choice-cards {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1.5rem;
    margin-top: 1rem;
  }

  @media (max-width: 1024px) {
    .choice-cards {
      grid-template-columns: 1fr;
    }
  }

  .choice-card {
    background: rgba(255, 255, 255, 0.05);
    border: 2px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    padding: 2rem;
    cursor: pointer;
    transition: all 0.3s ease;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    position: relative;
    width: 100%;
    font-family: inherit;
  }

  :global(html:not(.dark)) .choice-card {
    background: rgba(0, 0, 0, 0.02);
    border-color: rgba(0, 0, 0, 0.1);
  }

  .choice-card:hover {
    border-color: rgba(96, 165, 250, 0.5);
    background: rgba(96, 165, 250, 0.1);
    transform: translateY(-2px);
  }

  .choice-card.primary:hover {
    border-color: rgba(96, 165, 250, 0.8);
    background: rgba(96, 165, 250, 0.15);
  }

  .card-icon {
    font-size: 3rem;
    margin-bottom: 1rem;
  }

  .choice-card h3 {
    font-size: 1.25rem;
    font-weight: 600;
    margin: 0 0 0.75rem;
    color: white;
  }

  :global(html:not(.dark)) .choice-card h3 {
    color: rgb(17, 24, 39);
  }

  .card-description {
    font-size: 0.875rem;
    line-height: 1.5;
    color: rgba(255, 255, 255, 0.7);
    margin: 0 0 1rem;
  }

  :global(html:not(.dark)) .card-description {
    color: rgba(0, 0, 0, 0.6);
  }

  .card-features {
    list-style: none;
    padding: 0;
    margin: 0 0 1.5rem;
    text-align: left;
    width: 100%;
  }

  .card-features li {
    font-size: 0.875rem;
    color: rgba(255, 255, 255, 0.8);
    margin-bottom: 0.5rem;
    padding-left: 0.5rem;
  }

  :global(html:not(.dark)) .card-features li {
    color: rgba(0, 0, 0, 0.7);
  }

  .card-badge {
    position: absolute;
    top: 1rem;
    right: 1rem;
    background: rgba(96, 165, 250, 0.2);
    color: #60a5fa;
    padding: 0.25rem 0.75rem;
    border-radius: 12px;
    font-size: 0.75rem;
    font-weight: 600;
    border: 1px solid rgba(96, 165, 250, 0.3);
  }

  .card-badge.best {
    background: rgba(167, 139, 250, 0.2);
    color: #a78bfa;
    border-color: rgba(167, 139, 250, 0.3);
  }

  :global(html:not(.dark)) .card-badge {
    background: rgba(37, 99, 235, 0.1);
    color: #2563eb;
    border-color: rgba(37, 99, 235, 0.2);
  }

  :global(html:not(.dark)) .card-badge.best {
    background: rgba(139, 92, 246, 0.1);
    color: #7c3aed;
    border-color: rgba(139, 92, 246, 0.2);
  }

  .btn {
    padding: 0.75rem 1.5rem;
    border-radius: 8px;
    font-size: 1rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
    border: none;
    width: 100%;
  }

  .btn-primary {
    background: linear-gradient(135deg, #60a5fa 0%, #a78bfa 100%);
    color: white;
  }

  .btn-primary:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(96, 165, 250, 0.4);
  }

  .btn-secondary {
    background: rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.9);
    border: 1px solid rgba(255, 255, 255, 0.2);
  }

  :global(html:not(.dark)) .btn-secondary {
    background: rgba(0, 0, 0, 0.05);
    color: rgba(0, 0, 0, 0.8);
    border-color: rgba(0, 0, 0, 0.2);
  }

  .btn-secondary:hover {
    background: rgba(255, 255, 255, 0.15);
    border-color: rgba(255, 255, 255, 0.3);
  }

  :global(html:not(.dark)) .btn-secondary:hover {
    background: rgba(0, 0, 0, 0.08);
    border-color: rgba(0, 0, 0, 0.3);
  }

  .choice-footer {
    text-align: center;
    margin-top: 1rem;
  }

  .btn-link {
    background: none;
    border: none;
    color: rgba(255, 255, 255, 0.6);
    font-size: 0.875rem;
    cursor: pointer;
    padding: 0.5rem 1rem;
    transition: color 0.2s;
  }

  :global(html:not(.dark)) .btn-link {
    color: rgba(0, 0, 0, 0.5);
  }

  .btn-link:hover {
    color: rgba(255, 255, 255, 0.9);
  }

  :global(html:not(.dark)) .btn-link:hover {
    color: rgba(0, 0, 0, 0.8);
  }

  /* Skip Notification */
  .skip-notification {
    position: fixed;
    top: 2rem;
    right: 2rem;
    z-index: 12000;
    animation: slideInRight 0.3s ease-out;
  }

  @keyframes slideInRight {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }

  .notification-content {
    background: rgb(15, 23, 42);
    border: 1px solid rgba(96, 165, 250, 0.3);
    border-radius: 12px;
    padding: 1rem 1.5rem;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
    display: flex;
    gap: 1rem;
    align-items: start;
    max-width: 400px;
  }

  :global(html:not(.dark)) .notification-content {
    background: white;
    border-color: rgba(37, 99, 235, 0.3);
  }

  .notification-icon {
    font-size: 1.5rem;
    flex-shrink: 0;
  }

  .notification-text strong {
    display: block;
    color: white;
    margin-bottom: 0.25rem;
    font-size: 0.9375rem;
  }

  :global(html:not(.dark)) .notification-text strong {
    color: rgb(17, 24, 39);
  }

  .notification-text p {
    margin: 0;
    font-size: 0.875rem;
    color: rgba(255, 255, 255, 0.7);
    line-height: 1.5;
  }

  :global(html:not(.dark)) .notification-text p {
    color: rgba(0, 0, 0, 0.6);
  }

  .notification-text strong {
    color: #60a5fa;
  }

  :global(html:not(.dark)) .notification-text p strong {
    color: #2563eb;
  }
</style>
