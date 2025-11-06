<script lang="ts">
  import { onMount } from 'svelte';

  export let onNext: () => void;
  export let onBack: () => void;
  export let onSkip: () => void;

  let displayName = '';
  let pronouns = '';
  let location = '';
  let timezone = '';
  let bio = '';

  let saving = false;
  let error = '';

  // Auto-detect timezone
  onMount(() => {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  });

  async function handleNext() {
    // Validation
    if (!displayName.trim()) {
      error = 'Display name is required';
      return;
    }

    saving = true;
    error = '';

    try {
      // Save identity information to persona/core.json
      const response = await fetch('/api/persona', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          updates: {
            identity: {
              displayName: displayName.trim(),
              pronouns: pronouns.trim() || undefined,
              location: location.trim() || undefined,
              timezone: timezone || undefined,
              bio: bio.trim() || undefined,
            },
          },
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to save identity information');
      }

      // Increment identity questions counter
      await fetch('/api/onboarding/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          updates: {
            dataCollected: {
              identityQuestions: 1,
            },
          },
        }),
      });

      onNext();
    } catch (err) {
      error = (err as Error).message;
    } finally {
      saving = false;
    }
  }
</script>

<div class="step-identity">
  <div class="step-header">
    <h2>Tell Us About Yourself</h2>
    <p class="step-description">
      Basic information to help personalize your MetaHuman experience.
      This information will be stored in your local persona profile.
    </p>
  </div>

  <form class="identity-form" on:submit|preventDefault={handleNext}>
    <div class="form-group required">
      <label for="displayName">
        Display Name
        <span class="required-indicator">*</span>
      </label>
      <input
        id="displayName"
        type="text"
        bind:value={displayName}
        placeholder="How should we address you?"
        maxlength="100"
        required
      />
      <span class="help-text">Your preferred name or nickname</span>
    </div>

    <div class="form-group">
      <label for="pronouns">Pronouns</label>
      <input
        id="pronouns"
        type="text"
        bind:value={pronouns}
        placeholder="e.g., they/them, she/her, he/him"
        maxlength="50"
      />
      <span class="help-text">How you'd like to be referred to</span>
    </div>

    <div class="form-row">
      <div class="form-group">
        <label for="location">Location</label>
        <input
          id="location"
          type="text"
          bind:value={location}
          placeholder="e.g., San Francisco, CA"
          maxlength="100"
        />
        <span class="help-text">City or region (optional)</span>
      </div>

      <div class="form-group">
        <label for="timezone">Timezone</label>
        <input
          id="timezone"
          type="text"
          bind:value={timezone}
          placeholder="Auto-detected"
          maxlength="100"
        />
        <span class="help-text">For scheduling and time-aware features</span>
      </div>
    </div>

    <div class="form-group">
      <label for="bio">Short Bio</label>
      <textarea
        id="bio"
        bind:value={bio}
        placeholder="A brief description of yourself, your work, or your interests..."
        rows="4"
        maxlength="500"
      />
      <div class="char-count">{bio.length}/500</div>
      <span class="help-text">
        Help your MetaHuman understand your context and background
      </span>
    </div>

    {#if error}
      <div class="error-message">
        <span class="error-icon">⚠️</span>
        {error}
      </div>
    {/if}

    <div class="form-info">
      <div class="info-icon">💡</div>
      <div class="info-text">
        <strong>Privacy Note:</strong> All information stays on your local machine.
        You can edit this anytime in System Settings → Persona Editor.
      </div>
    </div>
  </form>

  <div class="step-actions">
    <button class="btn btn-secondary" on:click={onBack} disabled={saving}>
      ← Back
    </button>
    <button class="btn btn-ghost" on:click={onSkip} disabled={saving}>
      Skip
    </button>
    <button
      class="btn btn-primary"
      on:click={handleNext}
      disabled={saving || !displayName.trim()}
    >
      {saving ? 'Saving...' : 'Continue →'}
    </button>
  </div>
</div>

<style>
  .step-identity {
    display: flex;
    flex-direction: column;
    gap: 2rem;
    max-width: 700px;
    margin: 0 auto;
    padding: 2rem;
  }

  .step-header h2 {
    font-size: 1.8rem;
    font-weight: 600;
    margin: 0 0 0.5rem 0;
    color: #111827;
  }

  :global(.dark) .step-header h2 {
    color: #f9fafb;
  }

  .step-description {
    font-size: 1rem;
    line-height: 1.6;
    color: #6b7280;
    margin: 0;
  }

  :global(.dark) .step-description {
    color: #9ca3af;
  }

  .identity-form {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .form-group.required label::after {
    content: none;
  }

  .form-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
  }

  label {
    font-size: 0.95rem;
    font-weight: 600;
    color: #374151;
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  :global(.dark) label {
    color: #d1d5db;
  }

  .required-indicator {
    color: #ef4444;
    font-weight: 700;
  }

  input,
  textarea {
    padding: 0.75rem;
    font-size: 1rem;
    font-family: inherit;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    background: white;
    color: #111827;
    transition: all 0.2s ease;
  }

  :global(.dark) input,
  :global(.dark) textarea {
    background: #1f2937;
    border-color: #4b5563;
    color: #f9fafb;
  }

  input:focus,
  textarea:focus {
    outline: none;
    border-color: #667eea;
    box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
  }

  :global(.dark) input:focus,
  :global(.dark) textarea:focus {
    border-color: #818cf8;
    box-shadow: 0 0 0 3px rgba(129, 140, 248, 0.1);
  }

  textarea {
    resize: vertical;
    min-height: 100px;
  }

  .help-text {
    font-size: 0.85rem;
    color: #6b7280;
  }

  :global(.dark) .help-text {
    color: #9ca3af;
  }

  .char-count {
    align-self: flex-end;
    font-size: 0.8rem;
    color: #9ca3af;
    margin-top: -0.25rem;
  }

  :global(.dark) .char-count {
    color: #6b7280;
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

  .error-icon {
    font-size: 1.2rem;
  }

  .form-info {
    display: flex;
    align-items: start;
    gap: 0.75rem;
    padding: 1rem;
    background: #eff6ff;
    border-left: 4px solid #3b82f6;
    border-radius: 4px;
  }

  :global(.dark) .form-info {
    background: #1e3a8a;
    border-color: #60a5fa;
  }

  .info-icon {
    font-size: 1.5rem;
    flex-shrink: 0;
  }

  .info-text {
    font-size: 0.9rem;
    line-height: 1.5;
    color: #1e40af;
  }

  :global(.dark) .info-text {
    color: #bfdbfe;
  }

  .info-text strong {
    color: #1e3a8a;
  }

  :global(.dark) .info-text strong {
    color: #93c5fd;
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

  .btn-ghost {
    background: transparent;
    color: #6b7280;
  }

  :global(.dark) .btn-ghost {
    color: #9ca3af;
  }

  .btn-ghost:hover:not(:disabled) {
    color: #111827;
    background: #f3f4f6;
  }

  :global(.dark) .btn-ghost:hover:not(:disabled) {
    color: #f9fafb;
    background: #374151;
  }

  @media (max-width: 768px) {
    .step-identity {
      padding: 1rem;
    }

    .form-row {
      grid-template-columns: 1fr;
    }

    .step-actions {
      flex-direction: column;
    }

    .step-actions .btn {
      width: 100%;
    }
  }
</style>
