<script lang="ts">
  export let onNext: () => void;
  export let onSkip: () => void;
</script>

<div class="step-welcome">
  <div class="welcome-header">
    <div class="logo">🧠</div>
    <h1>Welcome to MetaHuman OS</h1>
    <p class="subtitle">Your Dual Consciousness Extension</p>
  </div>

  <div class="welcome-content">
    <div class="intro-section">
      <h2>What is MetaHuman OS?</h2>
      <p>
        MetaHuman OS is not an assistant—it's a parallel intelligence that operates as a seamless extension of yourself.
        By learning from your memories, goals, personality, and values, it creates a digital consciousness that thinks
        and acts in alignment with who you are.
      </p>
    </div>

    <div class="privacy-banner">
      <div class="privacy-icon">🔒</div>
      <div class="privacy-text">
        <strong>100% Local & Private</strong>
        <p>All your data stays on your machine. No cloud uploads, no external APIs.</p>
      </div>
    </div>

    <div class="onboarding-overview">
      <h2>What We'll Cover</h2>
      <p class="overview-intro">This quick setup will help us understand you better:</p>

      <div class="steps-preview">
        <div class="preview-step">
          <div class="step-number">1</div>
          <div class="step-info">
            <strong>Welcome</strong>
            <span>Introduction to MetaHuman OS</span>
          </div>
        </div>

        <div class="preview-step">
          <div class="step-number">2</div>
          <div class="step-info">
            <strong>Identity</strong>
            <span>Basic information about yourself</span>
          </div>
        </div>

        <div class="preview-step">
          <div class="step-number">3</div>
          <div class="step-info">
            <strong>Personality</strong>
            <span>Communication style and traits</span>
          </div>
        </div>

        <div class="preview-step">
          <div class="step-number">4</div>
          <div class="step-info">
            <strong>Context Import</strong>
            <span>Upload documents, journals, or notes</span>
          </div>
        </div>

        <div class="preview-step">
          <div class="step-number">5</div>
          <div class="step-info">
            <strong>Goals</strong>
            <span>What you want to achieve</span>
          </div>
        </div>

        <div class="preview-step">
          <div class="step-number">6</div>
          <div class="step-info">
            <strong>Review & Complete</strong>
            <span>Finalize your setup</span>
          </div>
        </div>
      </div>

      <div class="time-estimate">
        <span class="clock-icon">⏱️</span>
        <span>Estimated time: 10-15 minutes</span>
      </div>
    </div>

    <div class="how-it-works">
      <h2>How It Works</h2>
      <div class="work-steps">
        <div class="work-item">
          <div class="work-icon">💭</div>
          <div class="work-text">
            <strong>Learn</strong>
            <p>We capture your memories, goals, and personality traits</p>
          </div>
        </div>

        <div class="work-item">
          <div class="work-icon">🧬</div>
          <div class="work-text">
            <strong>Adapt</strong>
            <p>The system builds a model that reflects your thinking patterns</p>
          </div>
        </div>

        <div class="work-item">
          <div class="work-icon">⚡</div>
          <div class="work-text">
            <strong>Act</strong>
            <p>Your digital consciousness operates autonomously in alignment with your values</p>
          </div>
        </div>
      </div>
    </div>

    <div class="optional-notice">
      <p>
        <strong>Note:</strong> You can skip this wizard and add data manually later through various utilities
        (Memory Capture, File Ingestion, Chat, etc.). However, completing this setup now will give your
        MetaHuman a strong foundation from the start.
      </p>
    </div>
  </div>

  <div class="welcome-actions">
    <button class="btn btn-secondary" on:click={onSkip}>
      Skip for Now
    </button>
    <button class="btn btn-primary" on:click={onNext}>
      Get Started →
    </button>
  </div>
</div>

<style>
  .step-welcome {
    display: flex;
    flex-direction: column;
    gap: 2rem;
    max-width: 800px;
    margin: 0 auto;
    padding: 2rem;
  }

  .welcome-header {
    text-align: center;
    margin-bottom: 1rem;
  }

  .logo {
    font-size: 4rem;
    margin-bottom: 1rem;
    animation: pulse 2s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.05); }
  }

  .welcome-header h1 {
    font-size: 2.5rem;
    font-weight: 700;
    margin: 0 0 0.5rem 0;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  :global(.dark) .welcome-header h1 {
    background: linear-gradient(135deg, #818cf8 0%, #a78bfa 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .subtitle {
    font-size: 1.2rem;
    color: #6b7280;
    margin: 0;
  }

  :global(.dark) .subtitle {
    color: #9ca3af;
  }

  .welcome-content {
    display: flex;
    flex-direction: column;
    gap: 2rem;
  }

  .intro-section h2,
  .onboarding-overview h2,
  .how-it-works h2 {
    font-size: 1.5rem;
    font-weight: 600;
    margin: 0 0 1rem 0;
    color: #111827;
  }

  :global(.dark) .intro-section h2,
  :global(.dark) .onboarding-overview h2,
  :global(.dark) .how-it-works h2 {
    color: #f9fafb;
  }

  .intro-section p {
    font-size: 1rem;
    line-height: 1.6;
    color: #4b5563;
    margin: 0;
  }

  :global(.dark) .intro-section p {
    color: #d1d5db;
  }

  .privacy-banner {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1rem 1.5rem;
    background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%);
    border: 2px solid #10b981;
    border-radius: 8px;
  }

  :global(.dark) .privacy-banner {
    background: linear-gradient(135deg, #064e3b 0%, #065f46 100%);
    border-color: #10b981;
  }

  .privacy-icon {
    font-size: 2rem;
  }

  .privacy-text strong {
    display: block;
    font-size: 1.1rem;
    color: #065f46;
    margin-bottom: 0.25rem;
  }

  :global(.dark) .privacy-text strong {
    color: #6ee7b7;
  }

  .privacy-text p {
    margin: 0;
    font-size: 0.9rem;
    color: #047857;
  }

  :global(.dark) .privacy-text p {
    color: #a7f3d0;
  }

  .overview-intro {
    font-size: 1rem;
    color: #6b7280;
    margin: 0 0 1.5rem 0;
  }

  :global(.dark) .overview-intro {
    color: #9ca3af;
  }

  .steps-preview {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    gap: 1rem;
    margin-bottom: 1.5rem;
  }

  .preview-step {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1rem;
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    transition: all 0.2s ease;
  }

  :global(.dark) .preview-step {
    background: #1f2937;
    border-color: #374151;
  }

  .preview-step:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  }

  :global(.dark) .preview-step:hover {
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  }

  .step-number {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    font-weight: 700;
    font-size: 1.2rem;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .step-info {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .step-info strong {
    font-size: 1rem;
    color: #111827;
  }

  :global(.dark) .step-info strong {
    color: #f9fafb;
  }

  .step-info span {
    font-size: 0.85rem;
    color: #6b7280;
  }

  :global(.dark) .step-info span {
    color: #9ca3af;
  }

  .time-estimate {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.75rem;
    background: #fef3c7;
    border: 1px solid #fbbf24;
    border-radius: 6px;
    font-size: 0.95rem;
    color: #92400e;
  }

  :global(.dark) .time-estimate {
    background: #451a03;
    border-color: #f59e0b;
    color: #fcd34d;
  }

  .clock-icon {
    font-size: 1.2rem;
  }

  .work-steps {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1.5rem;
  }

  .work-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 0.75rem;
  }

  .work-icon {
    font-size: 3rem;
  }

  .work-text strong {
    display: block;
    font-size: 1.1rem;
    color: #111827;
    margin-bottom: 0.5rem;
  }

  :global(.dark) .work-text strong {
    color: #f9fafb;
  }

  .work-text p {
    margin: 0;
    font-size: 0.9rem;
    line-height: 1.5;
    color: #6b7280;
  }

  :global(.dark) .work-text p {
    color: #9ca3af;
  }

  .optional-notice {
    padding: 1rem 1.5rem;
    background: #eff6ff;
    border-left: 4px solid #3b82f6;
    border-radius: 4px;
  }

  :global(.dark) .optional-notice {
    background: #1e3a8a;
    border-color: #60a5fa;
  }

  .optional-notice p {
    margin: 0;
    font-size: 0.9rem;
    line-height: 1.6;
    color: #1e40af;
  }

  :global(.dark) .optional-notice p {
    color: #bfdbfe;
  }

  .optional-notice strong {
    color: #1e3a8a;
  }

  :global(.dark) .optional-notice strong {
    color: #93c5fd;
  }

  .welcome-actions {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    padding-top: 1rem;
    border-top: 1px solid #e5e7eb;
  }

  :global(.dark) .welcome-actions {
    border-color: #374151;
  }

  .btn {
    flex: 1;
    padding: 0.75rem 1.5rem;
    font-size: 1rem;
    font-weight: 600;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .btn-primary {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
  }

  .btn-primary:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
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

  .btn-secondary:hover {
    background: #e5e7eb;
  }

  :global(.dark) .btn-secondary:hover {
    background: #4b5563;
  }

  @media (max-width: 768px) {
    .step-welcome {
      padding: 1rem;
    }

    .welcome-header h1 {
      font-size: 2rem;
    }

    .subtitle {
      font-size: 1rem;
    }

    .steps-preview {
      grid-template-columns: 1fr;
    }

    .work-steps {
      grid-template-columns: 1fr;
    }

    .welcome-actions {
      flex-direction: column-reverse;
    }
  }
</style>
