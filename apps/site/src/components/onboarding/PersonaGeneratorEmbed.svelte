<script lang="ts">
  export let onComplete: () => void;
  export let onBack: () => void;

  interface Question {
    id: string;
    prompt: string;
    category: string;
    generatedAt: string;
  }

  interface Answer {
    questionId: string;
    content: string;
    answeredAt: string;
  }

  interface Session {
    sessionId: string;
    status: 'active' | 'completed' | 'finalized' | 'applied' | 'aborted';
    questions: Question[];
    answers: Answer[];
    categoryCoverage: Record<string, number>;
  }

  let currentSession: Session | null = null;
  let currentAnswer = '';
  let loading = false;
  let error = '';
  let messagesContainer: HTMLDivElement;

  // Auto-start session on mount
  import { onMount } from 'svelte';
  onMount(() => {
    startNewSession();
  });

  async function startNewSession() {
    loading = true;
    error = '';

    try {
      const response = await fetch('/api/persona/generator/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to start session');
      }

      const data = await response.json();
      currentSession = {
        sessionId: data.sessionId,
        status: 'active',
        questions: [data.question],
        answers: [],
        categoryCoverage: data.categoryCoverage,
      };

      // Save to localStorage for resume
      localStorage.setItem('persona-generator-session', data.sessionId);
    } catch (err: any) {
      error = err.message;
    } finally {
      loading = false;
    }
  }

  async function submitAnswer() {
    if (!currentAnswer.trim() || !currentSession) return;

    loading = true;
    error = '';

    const lastQuestion = currentSession.questions[currentSession.questions.length - 1];

    try {
      const response = await fetch('/api/persona/generator/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: currentSession.sessionId,
          questionId: lastQuestion.id,
          answer: currentAnswer,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to submit answer');
      }

      const data = await response.json();

      // Add answer to current session
      currentSession.answers = [
        ...currentSession.answers,
        {
          questionId: lastQuestion.id,
          content: currentAnswer,
          answeredAt: new Date().toISOString(),
        },
      ];

      currentAnswer = '';

      // Check if interview is complete
      if (data.isComplete) {
        currentSession.status = 'completed';
        await finalizeSession();
      } else if (data.nextQuestion) {
        // Add next question
        currentSession.questions = [...currentSession.questions, data.nextQuestion];
        currentSession.categoryCoverage = data.progress;
      }

      // Auto-scroll
      setTimeout(() => {
        if (messagesContainer) {
          messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
      }, 100);
    } catch (err: any) {
      error = err.message;
    } finally {
      loading = false;
    }
  }

  async function finalizeSession() {
    if (!currentSession) return;

    loading = true;
    error = '';

    try {
      const response = await fetch('/api/persona/generator/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: currentSession.sessionId }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to finalize session');
      }

      const data = await response.json();

      currentSession.status = 'finalized';

      // Auto-apply with merge strategy during onboarding
      await applyChanges(data);
    } catch (err: any) {
      error = err.message;
      loading = false;
    }
  }

  async function applyChanges(reviewData: any) {
    if (!currentSession) return;

    try {
      const response = await fetch('/api/persona/generator/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: currentSession.sessionId,
          strategy: 'merge', // Default to merge during onboarding
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to apply changes');
      }

      currentSession.status = 'applied';
      localStorage.removeItem('persona-generator-session');

      // Complete onboarding step
      setTimeout(() => {
        onComplete();
      }, 1500);
    } catch (err: any) {
      error = err.message;
    } finally {
      loading = false;
    }
  }

  function getCategoryColor(percentage: number): string {
    if (percentage >= 80) return '#10b981'; // green
    if (percentage >= 60) return '#f59e0b'; // amber
    return '#6b7280'; // gray
  }
</script>

<div class="embed-generator">
  <div class="embed-header">
    <h3>Personality Interview</h3>
    <button class="btn-back" on:click={onBack}>
      ← Back to Options
    </button>
  </div>

  {#if error}
    <div class="error-message">{error}</div>
  {/if}

  {#if currentSession}
    <div class="interview-content">
      <!-- Progress Meter -->
      <div class="progress-section">
        <h4>Category Coverage</h4>
        <div class="progress-bars">
          {#each Object.entries(currentSession?.categoryCoverage || {}) as [category, percentage]}
            <div class="progress-item">
              <span class="category-name">{category}</span>
              <div class="progress-bar-container">
                <div
                  class="progress-bar-fill"
                  style="width: {percentage}%; background-color: {getCategoryColor(percentage)}"
                />
              </div>
              <span class="category-percentage">{percentage}%</span>
            </div>
          {/each}
        </div>
      </div>

      <!-- Conversation -->
      <div class="conversation" bind:this={messagesContainer}>
        {#each currentSession?.questions || [] as question, i}
          <div class="message assistant">
            <div class="message-content">
              <strong>Psychotherapist:</strong>
              <p>{question.prompt}</p>
              <span class="message-meta">{question.category}</span>
            </div>
          </div>

          {#if currentSession?.answers?.[i]}
            <div class="message user">
              <div class="message-content">
                <strong>You:</strong>
                <p>{currentSession.answers[i].content}</p>
              </div>
            </div>
          {/if}
        {/each}

        {#if loading && currentSession.status === 'active'}
          <div class="message assistant">
            <div class="message-content">
              <em>Thinking...</em>
            </div>
          </div>
        {/if}
      </div>

      <!-- Input Area -->
      {#if currentSession?.status === 'active' && (currentSession?.questions?.length || 0) > (currentSession?.answers?.length || 0)}
        <div class="input-area">
          <textarea
            bind:value={currentAnswer}
            placeholder="Type your answer here..."
            rows="4"
            disabled={loading}
            on:keydown={(e) => {
              if (e.key === 'Enter' && e.ctrlKey) {
                submitAnswer();
              }
            }}
          />
          <div class="input-actions">
            <button class="btn btn-primary" on:click={submitAnswer} disabled={loading || !currentAnswer.trim()}>
              {loading ? 'Submitting...' : 'Submit Answer'}
            </button>
            <p class="hint">Press Ctrl+Enter to submit</p>
          </div>
        </div>
      {/if}

      {#if currentSession?.status === 'completed' || currentSession?.status === 'finalized'}
        <div class="completion-message">
          <h4>✓ Interview Complete!</h4>
          <p>Processing your responses and updating your persona profile...</p>
        </div>
      {/if}

      {#if currentSession?.status === 'applied'}
        <div class="success-message">
          <h4>✓ Persona Applied Successfully</h4>
          <p>Your personality profile has been created. Continuing to next step...</p>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .embed-generator {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .embed-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-bottom: 1rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  :global(html:not(.dark)) .embed-header {
    border-bottom-color: rgba(0, 0, 0, 0.1);
  }

  .embed-header h3 {
    font-size: 1.5rem;
    font-weight: 700;
    margin: 0;
    color: white;
  }

  :global(html:not(.dark)) .embed-header h3 {
    color: rgb(17, 24, 39);
  }

  .btn-back {
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.2);
    color: rgba(255, 255, 255, 0.9);
    padding: 0.5rem 1rem;
    border-radius: 6px;
    font-size: 0.875rem;
    cursor: pointer;
    transition: all 0.2s;
  }

  :global(html:not(.dark)) .btn-back {
    background: rgba(0, 0, 0, 0.05);
    border-color: rgba(0, 0, 0, 0.2);
    color: rgba(0, 0, 0, 0.8);
  }

  .btn-back:hover {
    background: rgba(255, 255, 255, 0.15);
    border-color: rgba(255, 255, 255, 0.3);
  }

  :global(html:not(.dark)) .btn-back:hover {
    background: rgba(0, 0, 0, 0.08);
    border-color: rgba(0, 0, 0, 0.3);
  }

  .error-message {
    padding: 0.75rem 1rem;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: 8px;
    color: #ef4444;
    font-size: 0.875rem;
  }

  .interview-content {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .progress-section h4 {
    font-size: 1rem;
    font-weight: 600;
    margin: 0 0 1rem;
    color: rgba(255, 255, 255, 0.9);
  }

  :global(html:not(.dark)) .progress-section h4 {
    color: rgba(0, 0, 0, 0.9);
  }

  .progress-bars {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .progress-item {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .category-name {
    font-size: 0.875rem;
    color: rgba(255, 255, 255, 0.7);
    min-width: 120px;
    text-transform: capitalize;
  }

  :global(html:not(.dark)) .category-name {
    color: rgba(0, 0, 0, 0.7);
  }

  .progress-bar-container {
    flex: 1;
    height: 8px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    overflow: hidden;
  }

  :global(html:not(.dark)) .progress-bar-container {
    background: rgba(0, 0, 0, 0.1);
  }

  .progress-bar-fill {
    height: 100%;
    transition: width 0.3s ease;
    border-radius: 4px;
  }

  .category-percentage {
    font-size: 0.875rem;
    color: rgba(255, 255, 255, 0.7);
    min-width: 45px;
    text-align: right;
  }

  :global(html:not(.dark)) .category-percentage {
    color: rgba(0, 0, 0, 0.7);
  }

  .conversation {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    max-height: 400px;
    overflow-y: auto;
    padding: 1rem;
    background: rgba(255, 255, 255, 0.02);
    border-radius: 8px;
  }

  :global(html:not(.dark)) .conversation {
    background: rgba(0, 0, 0, 0.02);
  }

  .message {
    display: flex;
    flex-direction: column;
  }

  .message.assistant .message-content {
    background: rgba(96, 165, 250, 0.1);
    border-left: 3px solid #60a5fa;
  }

  .message.user .message-content {
    background: rgba(167, 139, 250, 0.1);
    border-left: 3px solid #a78bfa;
  }

  .message-content {
    padding: 1rem;
    border-radius: 8px;
  }

  .message-content strong {
    display: block;
    color: white;
    margin-bottom: 0.5rem;
    font-size: 0.875rem;
  }

  :global(html:not(.dark)) .message-content strong {
    color: rgb(17, 24, 39);
  }

  .message-content p {
    margin: 0;
    color: rgba(255, 255, 255, 0.9);
    line-height: 1.6;
  }

  :global(html:not(.dark)) .message-content p {
    color: rgba(0, 0, 0, 0.9);
  }

  .message-meta {
    display: block;
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.5);
    margin-top: 0.5rem;
    text-transform: capitalize;
  }

  :global(html:not(.dark)) .message-meta {
    color: rgba(0, 0, 0, 0.5);
  }

  .input-area {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .input-area textarea {
    width: 100%;
    padding: 0.75rem;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 8px;
    color: white;
    font-size: 0.9375rem;
    font-family: inherit;
    resize: vertical;
  }

  :global(html:not(.dark)) .input-area textarea {
    background: rgba(0, 0, 0, 0.05);
    border-color: rgba(0, 0, 0, 0.2);
    color: rgb(17, 24, 39);
  }

  .input-area textarea:focus {
    outline: none;
    border-color: #60a5fa;
  }

  .input-actions {
    display: flex;
    justify-content: space-between;
    align-items: center;
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

  .btn-primary {
    background: linear-gradient(135deg, #60a5fa 0%, #a78bfa 100%);
    color: white;
  }

  .btn-primary:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(96, 165, 250, 0.4);
  }

  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .hint {
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.5);
    margin: 0;
  }

  :global(html:not(.dark)) .hint {
    color: rgba(0, 0, 0, 0.5);
  }

  .completion-message,
  .success-message {
    padding: 1.5rem;
    background: rgba(16, 185, 129, 0.1);
    border: 1px solid rgba(16, 185, 129, 0.3);
    border-radius: 8px;
    text-align: center;
  }

  .completion-message h4,
  .success-message h4 {
    font-size: 1.125rem;
    font-weight: 600;
    color: #10b981;
    margin: 0 0 0.5rem;
  }

  .completion-message p,
  .success-message p {
    font-size: 0.875rem;
    color: rgba(255, 255, 255, 0.8);
    margin: 0;
  }

  :global(html:not(.dark)) .completion-message p,
  :global(html:not(.dark)) .success-message p {
    color: rgba(0, 0, 0, 0.7);
  }
</style>
