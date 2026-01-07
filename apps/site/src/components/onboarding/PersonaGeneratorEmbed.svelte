<script lang="ts">
  import { apiFetch } from '../../lib/client/api-config';

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
      const response = await apiFetch('/api/persona/generator/start', {
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
      const response = await apiFetch('/api/persona/generator/answer', {
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
      const response = await apiFetch('/api/persona/generator/finalize', {
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
      const response = await apiFetch('/api/persona/generator/apply', {
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

<div class="w-full flex flex-col gap-6">
  <div class="flex justify-between items-center pb-4 border-b border-white/10 dark:border-white/10">
    <h3 class="text-2xl font-bold m-0 text-white dark:text-white">Personality Interview</h3>
    <button class="btn-secondary text-sm py-2 px-4" on:click={onBack}>
      ← Back to Options
    </button>
  </div>

  {#if error}
    <div class="banner banner-error">{error}</div>
  {/if}

  {#if currentSession}
    <div class="flex flex-col gap-6">
      <!-- Progress Meter -->
      <div>
        <h4 class="text-base font-semibold mb-4 text-white/90 dark:text-white/90">Category Coverage</h4>
        <div class="flex flex-col gap-3">
          {#each Object.entries(currentSession?.categoryCoverage || {}) as [category, percentage]}
            <div class="flex items-center gap-4">
              <span class="text-sm text-white/70 dark:text-white/70 min-w-[120px] capitalize">{category}</span>
              <div class="flex-1 h-2 bg-white/10 dark:bg-white/10 rounded overflow-hidden">
                <div
                  class="h-full rounded transition-all duration-300"
                  style="width: {percentage}%; background-color: {getCategoryColor(percentage)}"
                ></div>
              </div>
              <span class="text-sm text-white/70 dark:text-white/70 min-w-[45px] text-right">{percentage}%</span>
            </div>
          {/each}
        </div>
      </div>

      <!-- Conversation -->
      <div class="conversation-area" bind:this={messagesContainer}>
        {#each currentSession?.questions || [] as question, i}
          <div class="interview-msg interview-msg-assistant">
            <div class="p-4 rounded-lg">
              <strong class="block text-white dark:text-white mb-2 text-sm">Psychotherapist:</strong>
              <p class="m-0 text-white/90 dark:text-white/90 leading-relaxed">{question.prompt}</p>
              <span class="block text-xs text-white/50 dark:text-white/50 mt-2 capitalize">{question.category}</span>
            </div>
          </div>

          {#if currentSession?.answers?.[i]}
            <div class="interview-msg interview-msg-user">
              <div class="p-4 rounded-lg">
                <strong class="block text-white dark:text-white mb-2 text-sm">You:</strong>
                <p class="m-0 text-white/90 dark:text-white/90 leading-relaxed">{currentSession.answers[i].content}</p>
              </div>
            </div>
          {/if}
        {/each}

        {#if loading && currentSession.status === 'active'}
          <div class="interview-msg interview-msg-assistant">
            <div class="p-4 rounded-lg">
              <em class="text-white/60">Thinking...</em>
            </div>
          </div>
        {/if}
      </div>

      <!-- Input Area -->
      {#if currentSession?.status === 'active' && (currentSession?.questions?.length || 0) > (currentSession?.answers?.length || 0)}
        <div class="flex flex-col gap-3">
          <textarea
            class="form-textarea bg-white/5 dark:bg-white/5 border-white/20 dark:border-white/20 text-white dark:text-white"
            bind:value={currentAnswer}
            placeholder="Type your answer here..."
            rows="4"
            disabled={loading}
            on:keydown={(e) => {
              if (e.key === 'Enter' && e.ctrlKey) {
                submitAnswer();
              }
            }}
          ></textarea>
          <div class="flex justify-between items-center">
            <button class="interview-submit-btn" on:click={submitAnswer} disabled={loading || !currentAnswer.trim()}>
              {loading ? 'Submitting...' : 'Submit Answer'}
            </button>
            <p class="text-xs text-white/50 dark:text-white/50 m-0">Press Ctrl+Enter to submit</p>
          </div>
        </div>
      {/if}

      {#if currentSession?.status === 'completed' || currentSession?.status === 'finalized'}
        <div class="banner banner-success text-center">
          <h4 class="text-lg font-semibold text-green-500 mb-2">✓ Interview Complete!</h4>
          <p class="text-sm text-white/80 dark:text-white/80 m-0">Processing your responses and updating your persona profile...</p>
        </div>
      {/if}

      {#if currentSession?.status === 'applied'}
        <div class="banner banner-success text-center">
          <h4 class="text-lg font-semibold text-green-500 mb-2">✓ Persona Applied Successfully</h4>
          <p class="text-sm text-white/80 dark:text-white/80 m-0">Your personality profile has been created. Continuing to next step...</p>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  /* Conversation area - scrollable message list */
  .conversation-area {
    @apply flex flex-col gap-4 max-h-[400px] overflow-y-auto p-4 rounded-lg bg-white/5;
  }

  /* Interview messages */
  .interview-msg {
    @apply flex flex-col;
  }
  .interview-msg-assistant > div {
    @apply bg-blue-400/10 border-l-[3px] border-l-blue-400;
  }
  .interview-msg-user > div {
    @apply bg-violet-400/10 border-l-[3px] border-l-violet-400;
  }

  /* Submit button with gradient */
  .interview-submit-btn {
    @apply py-3 px-6 rounded-lg text-base font-medium cursor-pointer transition-all border-0 text-white;
    background: linear-gradient(135deg, #60a5fa 0%, #a78bfa 100%);
  }
  .interview-submit-btn:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(96, 165, 250, 0.4);
  }
  .interview-submit-btn:disabled {
    @apply opacity-50 cursor-not-allowed;
  }
</style>
