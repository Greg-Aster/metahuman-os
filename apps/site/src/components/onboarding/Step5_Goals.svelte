<script lang="ts">
  import { apiFetch } from '../../lib/client/api-config';

  export let onNext: () => void;
  export let onBack: () => void;
  export let onSkip: () => void;

  interface Goal {
    id: string;
    title: string;
    category: 'short' | 'mid' | 'long';
    description?: string;
  }

  let goals: Goal[] = [];
  let currentGoal = {
    title: '',
    category: 'short' as 'short' | 'mid' | 'long',
    description: '',
  };

  let saving = false;
  let error = '';

  const categories = [
    { value: 'short', label: 'Short-term (1-3 months)', icon: '🎯' },
    { value: 'mid', label: 'Mid-term (3-12 months)', icon: '📈' },
    { value: 'long', label: 'Long-term (1+ years)', icon: '🌟' },
  ];

  function addGoal() {
    if (!currentGoal.title.trim()) {
      error = 'Goal title is required';
      return;
    }

    const newGoal: Goal = {
      id: crypto.randomUUID(),
      title: currentGoal.title.trim(),
      category: currentGoal.category,
      description: currentGoal.description.trim() || undefined,
    };

    goals = [...goals, newGoal];

    // Reset form
    currentGoal = {
      title: '',
      category: 'short',
      description: '',
    };
    error = '';
  }

  function removeGoal(id: string) {
    goals = goals.filter(g => g.id !== id);
  }

  async function handleNext() {
    if (goals.length === 0) {
      // Skip is OK - user might want to add goals later
      onNext();
      return;
    }

    saving = true;
    error = '';

    try {
      // Group goals by category for persona/core.json
      const groupedGoals = {
        shortTerm: goals.filter(g => g.category === 'short').map(g => g.title),
        midTerm: goals.filter(g => g.category === 'mid').map(g => g.title),
        longTerm: goals.filter(g => g.category === 'long').map(g => g.title),
      };

      // Save goals to persona/core.json
      const personaResponse = await apiFetch('/api/persona', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          updates: {
            goals: groupedGoals,
          },
        }),
      });

      if (!personaResponse.ok) {
        throw new Error('Failed to save goals to persona');
      }

      // Create tasks for short-term goals
      let tasksCreated = 0;
      for (const goal of goals.filter(g => g.category === 'short')) {
        const taskResponse = await apiFetch('/api/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: goal.title,
            description: goal.description,
            priority: 'medium',
            status: 'active',
          }),
        });

        if (taskResponse.ok) {
          tasksCreated++;
        }
      }

      // Update onboarding state
      await apiFetch('/api/onboarding/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          updates: {
            dataCollected: {
              tasksCreated,
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

  function getCategoryIcon(category: 'short' | 'mid' | 'long'): string {
    const cat = categories.find(c => c.value === category);
    return cat?.icon || '🎯';
  }

  function getCategoryLabel(category: 'short' | 'mid' | 'long'): string {
    const cat = categories.find(c => c.value === category);
    return cat?.label || 'Short-term';
  }
</script>

<div class="step-goals">
  <div class="step-header">
    <h2>What Are Your Goals?</h2>
    <p class="step-description">
      Tell your MetaHuman what you want to achieve. These goals will guide its autonomous actions
      and help it prioritize tasks that align with your objectives.
    </p>
  </div>

  <div class="goal-form">
    <div class="form-group">
      <label for="title">
        Goal Title
        <span class="required-indicator">*</span>
      </label>
      <input
        id="title"
        type="text"
        bind:value={currentGoal.title}
        placeholder="What do you want to achieve?"
        maxlength="200"
      />
    </div>

    <div class="form-group">
      <label for="category">Timeframe</label>
      <div class="category-buttons">
        {#each categories as cat}
          <button
            type="button"
            class="category-btn"
            class:active={currentGoal.category === cat.value}
            on:click={() => currentGoal.category = cat.value}
          >
            <span class="category-icon">{cat.icon}</span>
            <span class="category-label">{cat.label}</span>
          </button>
        {/each}
      </div>
    </div>

    <div class="form-group">
      <label for="description">Description (optional)</label>
      <textarea
        id="description"
        bind:value={currentGoal.description}
        placeholder="Add more details about this goal..."
        rows="3"
        maxlength="500"
      />
      <div class="char-count">{currentGoal.description.length}/500</div>
    </div>

    <button
      class="btn btn-add"
      on:click={addGoal}
      disabled={!currentGoal.title.trim()}
    >
      ➕ Add Goal
    </button>

    {#if error}
      <div class="error-message">
        <span class="error-icon">⚠️</span>
        {error}
      </div>
    {/if}
  </div>

  {#if goals.length > 0}
    <div class="goals-list">
      <h3>Your Goals ({goals.length})</h3>
      <div class="goals">
        {#each goals as goal}
          <div class="goal-card">
            <div class="goal-header">
              <div class="goal-category">
                <span class="category-icon">{getCategoryIcon(goal.category)}</span>
                <span class="category-text">{getCategoryLabel(goal.category)}</span>
              </div>
              <button
                class="btn-remove"
                on:click={() => removeGoal(goal.id)}
                aria-label="Remove goal"
              >
                ✕
              </button>
            </div>
            <div class="goal-content">
              <h4 class="goal-title">{goal.title}</h4>
              {#if goal.description}
                <p class="goal-description">{goal.description}</p>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    </div>
  {:else}
    <div class="empty-state">
      <div class="empty-icon">🎯</div>
      <h3>No goals yet</h3>
      <p>Add your first goal above to get started</p>
    </div>
  {/if}

  <div class="goals-info">
    <div class="info-icon">💡</div>
    <div class="info-text">
      <strong>Why set goals?</strong>
      <ul>
        <li>Your MetaHuman will prioritize actions that align with your objectives</li>
        <li>Short-term goals will be automatically converted into actionable tasks</li>
        <li>The system will track progress and suggest next steps</li>
        <li>Autonomous agents will work towards these goals in the background</li>
      </ul>
      <p>
        You can always add, edit, or remove goals later through the Task Manager or Persona Editor.
      </p>
    </div>
  </div>

  <div class="skip-notice">
    <p>
      <strong>Not sure what goals to add?</strong> No problem! You can skip this step
      and define goals later as you use the system.
    </p>
  </div>

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
      disabled={saving}
    >
      {saving ? 'Saving...' : 'Continue →'}
    </button>
  </div>
</div>

<style>
  .step-goals {
    display: flex;
    flex-direction: column;
    gap: 2rem;
    max-width: 800px;
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

  .goal-form {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    padding: 1.5rem;
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 12px;
  }

  :global(.dark) .goal-form {
    background: #1f2937;
    border-color: #374151;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
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
    background: #374151;
    border-color: #4b5563;
    color: #f9fafb;
  }

  input:focus,
  textarea:focus {
    outline: none;
    border-color: #667eea;
    box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
  }

  textarea {
    resize: vertical;
    min-height: 80px;
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

  .category-buttons {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .category-btn {
    flex: 1;
    min-width: 150px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    padding: 1rem;
    background: white;
    border: 2px solid #d1d5db;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  :global(.dark) .category-btn {
    background: #374151;
    border-color: #4b5563;
  }

  .category-btn:hover {
    border-color: #667eea;
    transform: translateY(-2px);
  }

  .category-btn.active {
    border-color: #667eea;
    background: linear-gradient(135deg, rgba(102, 126, 234, 0.1) 0%, rgba(118, 75, 162, 0.1) 100%);
  }

  :global(.dark) .category-btn.active {
    background: linear-gradient(135deg, rgba(129, 140, 248, 0.1) 0%, rgba(167, 139, 250, 0.1) 100%);
  }

  .category-icon {
    font-size: 2rem;
  }

  .category-label {
    font-size: 0.9rem;
    font-weight: 500;
    color: #374151;
    text-align: center;
  }

  :global(.dark) .category-label {
    color: #d1d5db;
  }

  .btn-add {
    padding: 0.75rem 1.5rem;
    font-size: 1rem;
    font-weight: 600;
    background: linear-gradient(135deg, #10b981 0%, #059669 100%);
    color: white;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .btn-add:hover:not(:disabled) {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(16, 185, 129, 0.4);
  }

  .btn-add:disabled {
    opacity: 0.5;
    cursor: not-allowed;
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

  .goals-list {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .goals-list h3 {
    font-size: 1.2rem;
    font-weight: 600;
    margin: 0;
    color: #111827;
  }

  :global(.dark) .goals-list h3 {
    color: #f9fafb;
  }

  .goals {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .goal-card {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 1rem;
    background: white;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    transition: all 0.2s ease;
  }

  :global(.dark) .goal-card {
    background: #374151;
    border-color: #4b5563;
  }

  .goal-card:hover {
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  }

  .goal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .goal-category {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.375rem 0.75rem;
    background: #f3f4f6;
    border-radius: 6px;
  }

  :global(.dark) .goal-category {
    background: #1f2937;
  }

  .category-text {
    font-size: 0.85rem;
    font-weight: 500;
    color: #6b7280;
  }

  :global(.dark) .category-text {
    color: #9ca3af;
  }

  .btn-remove {
    padding: 0.25rem 0.5rem;
    font-size: 1.2rem;
    color: #ef4444;
    background: transparent;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .btn-remove:hover {
    background: #fee2e2;
    color: #dc2626;
  }

  :global(.dark) .btn-remove:hover {
    background: #7f1d1d;
  }

  .goal-content {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .goal-title {
    font-size: 1.1rem;
    font-weight: 600;
    margin: 0;
    color: #111827;
  }

  :global(.dark) .goal-title {
    color: #f9fafb;
  }

  .goal-description {
    margin: 0;
    font-size: 0.9rem;
    line-height: 1.5;
    color: #6b7280;
  }

  :global(.dark) .goal-description {
    color: #9ca3af;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    padding: 3rem 2rem;
    text-align: center;
  }

  .empty-icon {
    font-size: 4rem;
    opacity: 0.5;
  }

  .empty-state h3 {
    font-size: 1.2rem;
    font-weight: 600;
    margin: 0;
    color: #374151;
  }

  :global(.dark) .empty-state h3 {
    color: #d1d5db;
  }

  .empty-state p {
    margin: 0;
    font-size: 0.95rem;
    color: #6b7280;
  }

  :global(.dark) .empty-state p {
    color: #9ca3af;
  }

  .goals-info {
    display: flex;
    align-items: start;
    gap: 0.75rem;
    padding: 1rem;
    background: #eff6ff;
    border-left: 4px solid #3b82f6;
    border-radius: 4px;
  }

  :global(.dark) .goals-info {
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

  .info-text ul {
    margin: 0.5rem 0;
    padding-left: 1.5rem;
  }

  .info-text p {
    margin: 0.5rem 0 0 0;
  }

  .skip-notice {
    padding: 1rem 1.5rem;
    background: #fef3c7;
    border-left: 4px solid #fbbf24;
    border-radius: 4px;
  }

  :global(.dark) .skip-notice {
    background: #451a03;
    border-color: #f59e0b;
  }

  .skip-notice p {
    margin: 0;
    font-size: 0.9rem;
    line-height: 1.6;
    color: #92400e;
  }

  :global(.dark) .skip-notice p {
    color: #fcd34d;
  }

  .skip-notice strong {
    color: #78350f;
  }

  :global(.dark) .skip-notice strong {
    color: #fbbf24;
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
    .step-goals {
      padding: 1rem;
    }

    .category-buttons {
      flex-direction: column;
    }

    .category-btn {
      min-width: 100%;
    }

    .step-actions {
      flex-direction: column;
    }
  }
</style>
