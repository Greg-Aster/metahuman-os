<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import ReviewApplyDialog from './ReviewApplyDialog.svelte';
  import { apiFetch } from '../lib/client/api-config';

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
  let showReviewDialog = false;
  let reviewData: any = null;
  let editingAnswerId: string | null = null;
  let editedAnswerText = '';
  let editLoading = false;

  // Session history
  let sessions: any[] = [];
  let showHistory = false;

  // Auto-resume notification
  let showResumeNotification = false;
  let resumableSessionId = '';

  // Auto-scroll
  let messagesContainer: HTMLDivElement;

  // Owner actions
  let showPurgeConfirm = false;
  let showResetConfirm = false;
  let ownerActionLoading = false;
  let ownerActionError = '';
  let resetConfirmText = '';

  // Quick Add Notes
  let showQuickNotes = false;
  let quickNotesText = '';
  let quickNotesLoading = false;
  let quickNotesError = '';
  let quickNotesSuccess = '';

  // Fun loading messages
  let loadingMessageIndex = 0;
  let loadingInterval: NodeJS.Timeout | null = null;

  const THINKING_MESSAGES = [
    "🧠 Analyzing your psyche's WiFi password...",
    "🔮 Consulting the cosmic unconscious...",
    "📚 Cross-referencing with Freud's dream journal...",
    "🎭 Decoding your inner theater's stage directions...",
    "🌀 Untangling the threads of your subconscious tapestry...",
    "🎪 Interviewing your id, ego, and superego...",
    "🌙 Transcribing messages from your shadow self...",
    "🎨 Painting a portrait of your personality landscape...",
    "🧩 Assembling the puzzle pieces of your psyche...",
    "🎯 Calibrating the empathy resonance chamber...",
    "🌊 Navigating the depths of your mental ocean...",
    "🎼 Composing a symphony of your behavioral patterns...",
    "🔬 Examining your personality under a microscope...",
    "🌳 Growing a family tree of your thought processes...",
    "⚡ Charging the neural network with introspective energy...",
    "🎲 Rolling the dice of existential probability...",
    "🌌 Mapping the constellations of your character...",
    "🎪 Balancing on the tightrope between nature and nurture...",
    "🧘 Meditating on the meaning of your meanings...",
    "🎭 Rehearsing for the play of your life story...",
  ];

  onMount(async () => {
    await loadSessionHistory();
    // Check for active session to resume
    const savedSessionId = localStorage.getItem('persona-generator-session');
    if (savedSessionId && sessions.some(s => s.sessionId === savedSessionId && s.status === 'active')) {
      showResumeNotification = true;
      resumableSessionId = savedSessionId;
    }
  });

  onDestroy(() => {
    if (loadingInterval) {
      clearInterval(loadingInterval);
    }
  });

  function startLoadingMessages() {
    loadingMessageIndex = 0;
    loadingInterval = setInterval(() => {
      loadingMessageIndex = (loadingMessageIndex + 1) % THINKING_MESSAGES.length;
    }, 3000);
  }

  function stopLoadingMessages() {
    if (loadingInterval) {
      clearInterval(loadingInterval);
      loadingInterval = null;
    }
  }

  async function loadSessionHistory() {
    try {
      const response = await apiFetch('/api/persona/generator/load');
      if (response.ok) {
        const data = await response.json();
        sessions = data.sessions || [];
      }
    } catch (err) {
      console.error('Failed to load session history:', err);
    }
  }

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
      editingAnswerId = null;
      editedAnswerText = '';

      localStorage.setItem('persona-generator-session', data.sessionId);
    } catch (err: any) {
      error = err.message;
    } finally {
      loading = false;
    }
  }

  async function resumeSession(sessionId: string, options?: { persist?: boolean }) {
    loading = true;
    error = '';
    const shouldPersist = options?.persist ?? true;

    try {
      const response = await apiFetch(`/api/persona/generator/load?sessionId=${sessionId}`);

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to load session');
      }

      const data = await response.json();
      currentSession = data.session;
      editingAnswerId = null;
      editedAnswerText = '';
      if (shouldPersist) {
        localStorage.setItem('persona-generator-session', sessionId);
      }
    } catch (err: any) {
      error = err.message;
      if (shouldPersist) {
        localStorage.removeItem('persona-generator-session');
      }
    } finally {
      loading = false;
    }
  }

  function reviewSession(sessionId: string) {
    resumeSession(sessionId, { persist: false });
  }

  function startEditAnswer(questionId: string, content: string) {
    editingAnswerId = questionId;
    editedAnswerText = content;
  }

  function cancelEditAnswer() {
    editingAnswerId = null;
    editedAnswerText = '';
  }

  async function saveEditedAnswer(questionId: string) {
    if (!currentSession) return;
    if (!editedAnswerText.trim()) {
      error = 'Answer cannot be empty';
      return;
    }

    editLoading = true;
    error = '';

    try {
      const response = await apiFetch('/api/persona/generator/update-answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: currentSession.sessionId,
          questionId,
          content: editedAnswerText.trim(),
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to update answer');
      }

      const data = await response.json();
      const updatedAnswer = data.answer;
      const updatedAnswers = currentSession.answers.map((answer) =>
        answer.questionId === questionId ? updatedAnswer : answer
      );
      currentSession = { ...currentSession, answers: updatedAnswers };
      editingAnswerId = null;
      editedAnswerText = '';
    } catch (err: any) {
      error = err.message;
    } finally {
      editLoading = false;
    }
  }

  async function submitAnswer() {
    if (!currentAnswer.trim() || !currentSession) return;

    loading = true;
    error = '';
    startLoadingMessages();

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

      currentSession.answers = [
        ...currentSession.answers,
        {
          questionId: lastQuestion.id,
          content: currentAnswer,
          answeredAt: new Date().toISOString(),
        },
      ];

      currentAnswer = '';

      if (data.isComplete) {
        currentSession.status = 'completed';
        await finalizeSession();
      } else if (data.nextQuestion) {
        currentSession.questions = [...currentSession.questions, data.nextQuestion];
        currentSession.categoryCoverage = data.progress;
      }

      setTimeout(() => {
        if (messagesContainer) {
          messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
      }, 100);
    } catch (err: any) {
      error = err.message;
    } finally {
      loading = false;
      stopLoadingMessages();
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
        body: JSON.stringify({
          sessionId: currentSession.sessionId,
          strategy: 'merge',
          copyToTraining: true,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to finalize session');
      }

      const data = await response.json();
      reviewData = data;
      showReviewDialog = true;
      currentSession.status = 'finalized';
    } catch (err: any) {
      error = err.message;
    } finally {
      loading = false;
    }
  }

  async function handleApply(strategy: 'replace' | 'merge' | 'append') {
    if (!currentSession) return;

    try {
      const response = await apiFetch('/api/persona/generator/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: currentSession.sessionId,
          strategy,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to apply persona');
      }

      localStorage.removeItem('persona-generator-session');
      currentSession.status = 'applied';
      showReviewDialog = false;
      await loadSessionHistory();

      alert('Persona updated successfully! Your changes have been applied.');

      setTimeout(() => {
        currentSession = null;
      }, 2000);
    } catch (err: any) {
      alert('Failed to apply persona: ' + err.message);
    }
  }

  function handleDiscard() {
    showReviewDialog = false;
    localStorage.removeItem('persona-generator-session');
    currentSession = null;
  }

  async function discardSession() {
    if (!currentSession) return;
    if (!confirm('Are you sure you want to discard this interview session?')) return;

    try {
      await apiFetch('/api/persona/generator/discard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: currentSession.sessionId }),
      });
    } catch (err) {
      console.error('Failed to discard session:', err);
    }

    localStorage.removeItem('persona-generator-session');
    currentSession = null;
    await loadSessionHistory();
  }

  function pauseSession() {
    currentSession = null;
  }

  function getCategoryColor(percentage: number): string {
    if (percentage >= 80) return '#10b981';
    if (percentage >= 60) return '#f59e0b';
    return '#6b7280';
  }

  async function handleQuickNotes() {
    if (!quickNotesText.trim()) {
      quickNotesError = 'Please enter some notes or observations';
      return;
    }

    quickNotesLoading = true;
    quickNotesError = '';
    quickNotesSuccess = '';

    try {
      const response = await apiFetch('/api/persona/generator/add-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: quickNotesText }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to add notes');
      }

      const data = await response.json();
      quickNotesSuccess = 'Notes processed and merged with your persona!';
      quickNotesText = '';

      setTimeout(() => {
        quickNotesSuccess = '';
        showQuickNotes = false;
      }, 3000);
    } catch (err: any) {
      quickNotesError = err.message;
    } finally {
      quickNotesLoading = false;
    }
  }

  async function handlePurgeSessions() {
    ownerActionLoading = true;
    ownerActionError = '';

    try {
      const response = await apiFetch('/api/persona/generator/purge-sessions', {
        method: 'POST',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to purge sessions');
      }

      const data = await response.json();
      showPurgeConfirm = false;
      localStorage.removeItem('persona-generator-session');
      await loadSessionHistory();
      alert(`Successfully purged ${data.deletedCount} session(s)`);
    } catch (err: any) {
      ownerActionError = err.message;
    } finally {
      ownerActionLoading = false;
    }
  }

  async function handleResetPersona() {
    if (resetConfirmText !== 'RESET') {
      ownerActionError = 'Please type "RESET" to confirm';
      return;
    }

    ownerActionLoading = true;
    ownerActionError = '';

    try {
      const response = await apiFetch('/api/persona/generator/reset-persona', {
        method: 'POST',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to reset persona');
      }

      const data = await response.json();
      showResetConfirm = false;
      resetConfirmText = '';
      alert(`Persona file reset successfully. Backup saved at: ${data.backupPath}`);
    } catch (err: any) {
      ownerActionError = err.message;
    } finally {
      ownerActionLoading = false;
    }
  }
</script>

<div class="h-full flex flex-col p-6 text-gray-200">
  <div class="mb-6">
    <h2 class="m-0 mb-2 text-gray-50">Persona Generator</h2>
    <p class="m-0 text-gray-400 text-sm">
      Interactive personality interview to build your digital persona
    </p>
  </div>

  {#if error}
    <div class="bg-red-900 border border-red-800 p-4 rounded-md mb-4">
      <strong>Error:</strong> {error}
    </div>
  {/if}

  {#if showResumeNotification && !currentSession}
    <div class="bg-blue-900 border border-blue-500 rounded-lg p-6 mb-6 flex flex-col gap-4">
      <div class="flex items-start gap-4">
        <span class="text-3xl leading-none">💭</span>
        <div class="flex-1">
          <strong class="block mb-2 text-gray-50">You have an unfinished interview</strong>
          <p class="m-0 text-gray-200">Would you like to continue where you left off?</p>
        </div>
      </div>
      <div class="flex gap-3">
        <button class="btn-primary" on:click={() => {
          resumeSession(resumableSessionId);
          showResumeNotification = false;
        }}>
          Resume Interview
        </button>
        <button class="btn-secondary" on:click={() => {
          localStorage.removeItem('persona-generator-session');
          showResumeNotification = false;
        }}>
          Start Fresh
        </button>
      </div>
    </div>
  {/if}

  {#if !currentSession}
    <div class="flex flex-col gap-6">
      <div>
        <h3 class="m-0 mb-4 text-gray-50">Welcome to the Persona Generator</h3>
        <p class="m-0 mb-4 leading-relaxed">
          This guided interview uses motivational interviewing techniques to understand
          your authentic personality, values, goals, and communication style.
        </p>
        <ul class="m-0 pl-6 leading-loose">
          <li>7-15 thoughtful questions adapted to your answers</li>
          <li>Tracks coverage across 5 personality categories</li>
          <li>Generates structured persona data from your responses</li>
          <li>Review and customize before applying changes</li>
          <li><strong>New sessions merge with existing persona</strong> - more data improves accuracy</li>
        </ul>
      </div>

      <!-- Quick Add Notes Section -->
      <div class="bg-gray-800 border-2 border-blue-500 rounded-lg p-6 mt-6">
        <div>
          <h4 class="m-0 mb-2 text-blue-400 text-base">📝 Quick Add Notes</h4>
          <p class="m-0 mb-4 text-gray-400 text-sm leading-relaxed">
            Add observations, thoughts, or details about yourself. The system will extract personality traits and merge them with your existing persona.
          </p>
        </div>

        {#if !showQuickNotes}
          <button class="btn-secondary" on:click={() => showQuickNotes = true}>
            Add Notes to Persona
          </button>
        {:else}
          <div class="mt-4">
            <textarea
              bind:value={quickNotesText}
              placeholder="Example: I've realized I'm more introverted than I thought. I prefer deep one-on-one conversations over group settings. I value authenticity and directness in communication..."
              rows="5"
              disabled={quickNotesLoading}
              class="w-full bg-gray-900 border border-gray-700 rounded-md p-3 text-gray-200 text-sm resize-y mb-3 min-h-[120px] focus:outline-none focus:border-blue-500 placeholder:text-gray-500"
            ></textarea>

            {#if quickNotesError}
              <div class="p-3 bg-red-900 border border-red-800 rounded-md text-red-200 text-sm mb-3">{quickNotesError}</div>
            {/if}

            {#if quickNotesSuccess}
              <div class="p-3 bg-emerald-900 border border-emerald-700 rounded-md text-emerald-200 text-sm mb-3">{quickNotesSuccess}</div>
            {/if}

            <div class="flex gap-3 justify-end">
              <button
                class="btn-secondary"
                on:click={() => {
                  showQuickNotes = false;
                  quickNotesText = '';
                  quickNotesError = '';
                }}
                disabled={quickNotesLoading}
              >
                Cancel
              </button>
              <button
                class="btn-primary"
                on:click={handleQuickNotes}
                disabled={quickNotesLoading || !quickNotesText.trim()}
              >
                {quickNotesLoading ? 'Processing...' : 'Add to Persona'}
              </button>
            </div>
          </div>
        {/if}
      </div>

      <div class="flex gap-4 flex-wrap">
        <button class="btn-primary" on:click={startNewSession} disabled={loading}>
          {loading ? 'Starting...' : 'Start New Interview'}
        </button>

        {#if sessions.length > 0}
          <button class="btn-secondary" on:click={() => (showHistory = !showHistory)}>
            {showHistory ? 'Hide' : 'Show'} Session History ({sessions.length})
          </button>
        {/if}
      </div>

      {#if showHistory && sessions.length > 0}
        <div class="bg-gray-800 rounded-lg p-6">
          <h4 class="m-0 mb-4 text-gray-50">Previous Sessions</h4>
          <div class="flex flex-col gap-3">
            {#each sessions as session}
              <div class="bg-gray-900 p-4 rounded-md flex flex-col gap-2">
                <div class="flex justify-between items-center">
                  <span class="font-mono text-gray-400 text-sm">{session.sessionId.slice(0, 8)}...</span>
                  <span class="px-3 py-1 rounded-full text-xs font-semibold
                    {session.status === 'active' ? 'bg-emerald-900 text-emerald-300' : ''}
                    {session.status === 'completed' ? 'bg-blue-900 text-blue-300' : ''}
                    {session.status === 'finalized' ? 'bg-amber-900 text-amber-200' : ''}
                    {session.status === 'applied' ? 'bg-green-900 text-green-300' : ''}
                    {session.status === 'aborted' ? 'bg-gray-700 text-gray-400' : ''}
                  ">{session.status}</span>
                </div>
                <div class="flex gap-4 text-sm text-gray-400">
                  <span>{session.questionCount} questions</span>
                  <span>{session.answerCount} answers</span>
                  <span>{new Date(session.createdAt).toLocaleDateString()}</span>
                </div>
                {#if session.status === 'active'}
                  <button class="btn-primary btn-sm" on:click={() => resumeSession(session.sessionId)}>
                    Resume
                  </button>
                {:else if session.status === 'completed'}
                  <button class="btn-primary btn-sm" on:click={() => reviewSession(session.sessionId)}>
                    Edit Session
                  </button>
                {:else if session.status === 'finalized' || session.status === 'applied'}
                  <button class="btn-secondary btn-sm" on:click={() => reviewSession(session.sessionId)}>
                    View
                  </button>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Owner Section -->
      <div class="bg-gray-800 border-2 border-red-900 rounded-lg p-6 mt-6">
        <h4 class="m-0 mb-3 text-red-300 text-base">⚠️ Owner Actions</h4>
        <p class="m-0 mb-4 text-red-300 text-sm">
          These actions are irreversible. Use with caution.
        </p>
        <div class="flex gap-3 flex-wrap">
          <button class="btn-danger" on:click={() => showPurgeConfirm = true}>
            Purge All Sessions
          </button>
          <button class="btn-danger" on:click={() => showResetConfirm = true}>
            Reset Persona File
          </button>
        </div>
      </div>
    </div>
  {:else}
    <div class="flex flex-col gap-4 flex-1 min-h-0">
      <!-- Compact Progress Meter -->
      <div class="bg-gray-800 rounded-lg px-4 py-3 shrink-0">
        <div class="flex items-center gap-4 flex-wrap">
          <span class="text-sm text-gray-400 font-semibold">Progress:</span>
          {#each Object.entries(currentSession?.categoryCoverage || {}) as [category, percentage]}
            <div class="flex items-center gap-2 bg-gray-700 px-3 py-1.5 rounded-full text-sm">
              <span class="text-gray-400 uppercase font-semibold tracking-wide">{category.charAt(0).toUpperCase() + category.slice(1, 4)}</span>
              <span class="font-bold tabular-nums" style="color: {getCategoryColor(percentage)}">{percentage}%</span>
            </div>
          {/each}
        </div>
      </div>

      <!-- Conversation -->
      <div class="flex-1 overflow-y-auto bg-gray-800 rounded-lg p-4 flex flex-col gap-4 min-h-0" bind:this={messagesContainer}>
        {#each currentSession?.questions || [] as question, i}
          <div class="flex justify-start">
            <div class="max-w-[75%] p-4 rounded-lg leading-relaxed bg-gray-700">
              <strong class="block mb-2 text-gray-50">Psychotherapist:</strong>
              <p class="m-0 text-gray-200">{question.prompt}</p>
              <span class="block mt-2 text-xs text-gray-400 italic">{question.category}</span>
            </div>
          </div>

          {#if currentSession?.answers?.[i]}
            <div class="flex justify-end">
              <div class="max-w-[75%] p-4 rounded-lg leading-relaxed bg-blue-900">
                <strong class="block mb-2 text-gray-50">You:</strong>
                {#if editingAnswerId === question.id}
                  <textarea
                    class="w-full mt-2 bg-gray-900 border border-gray-600 text-gray-50 rounded-md p-3 font-inherit resize-y"
                    bind:value={editedAnswerText}
                    rows="4"
                    disabled={editLoading}
                  ></textarea>
                  <div class="flex gap-3 mt-3">
                    <button
                      class="btn-primary"
                      on:click={() => saveEditedAnswer(question.id)}
                      disabled={editLoading}
                    >
                      {editLoading ? 'Saving...' : 'Save Changes'}
                    </button>
                    <button class="btn-secondary" on:click={cancelEditAnswer} disabled={editLoading}>
                      Cancel
                    </button>
                  </div>
                {:else}
                  <p class="m-0 text-gray-200">{currentSession.answers[i].content}</p>
                  <div class="mt-3 flex justify-between items-center gap-2 flex-wrap">
                    {#if currentSession.answers[i].editedAt}
                      <span class="text-xs text-gray-400 italic">
                        Edited {new Date(currentSession.answers[i].editedAt).toLocaleString()}
                      </span>
                    {/if}
                    <button
                      class="bg-transparent border-none text-blue-300 p-0 text-sm underline cursor-pointer hover:text-blue-200"
                      on:click={() => startEditAnswer(question.id, currentSession.answers[i].content)}
                    >
                      Edit Response
                    </button>
                  </div>
                {/if}
              </div>
            </div>
          {/if}
        {/each}

        {#if loading}
          <div class="flex justify-start">
            <div class="flex items-center gap-4 p-6 bg-gray-700 rounded-lg">
              <div class="text-3xl animate-pulse">🤔</div>
              <em class="flex-1 text-sm italic text-gray-400 leading-relaxed">{THINKING_MESSAGES[loadingMessageIndex]}</em>
            </div>
          </div>
        {/if}
      </div>

      <!-- Input Area -->
      {#if currentSession?.status === 'active' && (currentSession?.questions?.length || 0) > (currentSession?.answers?.length || 0)}
        <div class="bg-gray-800 rounded-lg p-4 shrink-0">
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
            class="w-full bg-gray-900 border border-gray-700 rounded-md p-3 text-gray-200 text-sm resize-y mb-3 focus:outline-none focus:border-blue-500 placeholder:text-gray-500"
          />
          <div class="flex gap-3">
            <button class="btn-primary" on:click={submitAnswer} disabled={loading || !currentAnswer.trim()}>
              {loading ? 'Submitting...' : 'Submit Answer'}
            </button>
            <button class="btn-secondary" on:click={pauseSession} disabled={loading}>
              Pause
            </button>
            <button class="btn-danger" on:click={discardSession} disabled={loading}>
              Discard
            </button>
          </div>
          <p class="mt-2 text-xs text-gray-500">Press Ctrl+Enter to submit</p>
        </div>
      {/if}

      {#if currentSession?.status === 'completed'}
        <div class="bg-gray-800 rounded-lg p-8 text-center">
          <h3 class="m-0 mb-2 text-gray-50">Interview Complete!</h3>
          {#if loading}
            <p class="m-0 text-gray-400">Finalizing your persona data...</p>
          {:else}
            <p class="m-0 text-gray-400">You can finalize again if the previous attempt failed.</p>
            <button class="btn-primary mt-4" on:click={finalizeSession}>
              Retry Finalize
            </button>
          {/if}
        </div>
      {/if}

      {#if currentSession?.status === 'applied'}
        <div class="bg-gray-800 rounded-lg p-8 text-center">
          <h3 class="m-0 mb-2 text-emerald-500">✓ Persona Applied Successfully</h3>
          <p class="m-0 text-gray-400">Your personality profile has been updated.</p>
        </div>
      {/if}
    </div>
  {/if}
</div>

{#if showReviewDialog && reviewData}
  <ReviewApplyDialog
    {reviewData}
    onApply={handleApply}
    onDiscard={handleDiscard}
  />
{/if}

<!-- Purge Confirmation Modal -->
{#if showPurgeConfirm}
  <div class="fixed inset-0 bg-black/75 flex items-center justify-center z-[10000] p-4" on:click={() => showPurgeConfirm = false}>
    <div class="bg-gray-800 border border-gray-700 rounded-lg max-w-[500px] w-full p-8 shadow-2xl" on:click|stopPropagation>
      <h3 class="m-0 mb-4 text-red-300">⚠️ Purge All Sessions</h3>
      <p class="m-0 mb-4 text-gray-200 leading-relaxed">
        This will permanently delete <strong class="text-gray-50">all interview sessions</strong> ({sessions.length} total)
        from your profile directory.
      </p>
      <p class="m-0 mb-6 p-3 bg-red-900 border border-red-800 rounded-md text-red-200 text-sm leading-relaxed">
        This action cannot be undone. Session transcripts will be lost forever.
      </p>

      {#if ownerActionError}
        <div class="m-0 mb-4 p-3 bg-red-900 border border-red-800 rounded-md text-red-200 text-sm">{ownerActionError}</div>
      {/if}

      <div class="flex gap-3 justify-end">
        <button class="btn-secondary" on:click={() => { showPurgeConfirm = false; ownerActionError = ''; }} disabled={ownerActionLoading}>
          Cancel
        </button>
        <button class="btn-danger" on:click={handlePurgeSessions} disabled={ownerActionLoading}>
          {ownerActionLoading ? 'Purging...' : 'Purge All Sessions'}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Reset Persona Confirmation Modal -->
{#if showResetConfirm}
  <div class="fixed inset-0 bg-black/75 flex items-center justify-center z-[10000] p-4" on:click={() => showResetConfirm = false}>
    <div class="bg-gray-800 border border-gray-700 rounded-lg max-w-[500px] w-full p-8 shadow-2xl" on:click|stopPropagation>
      <h3 class="m-0 mb-4 text-red-300">⚠️ Reset Persona File</h3>
      <p class="m-0 mb-4 text-gray-200 leading-relaxed">
        This will reset your <code class="bg-gray-900 px-1.5 py-0.5 rounded text-gray-50 font-mono text-sm">persona/core.json</code> file to default settings.
      </p>
      <p class="m-0 mb-6 p-3 bg-red-900 border border-red-800 rounded-md text-red-200 text-sm leading-relaxed">
        All personality traits, values, goals, and preferences will be lost.
        A backup will be created before resetting.
      </p>

      <div class="mb-6">
        <label for="reset-confirm" class="block mb-2 text-gray-200 text-sm">Type <strong class="text-red-300 font-mono">RESET</strong> to confirm:</label>
        <input
          id="reset-confirm"
          type="text"
          bind:value={resetConfirmText}
          placeholder="RESET"
          disabled={ownerActionLoading}
          class="w-full p-3 bg-gray-900 border border-gray-700 rounded-md text-gray-200 font-mono focus:outline-none focus:border-red-900"
        />
      </div>

      {#if ownerActionError}
        <div class="m-0 mb-4 p-3 bg-red-900 border border-red-800 rounded-md text-red-200 text-sm">{ownerActionError}</div>
      {/if}

      <div class="flex gap-3 justify-end">
        <button class="btn-secondary" on:click={() => { showResetConfirm = false; resetConfirmText = ''; ownerActionError = ''; }} disabled={ownerActionLoading}>
          Cancel
        </button>
        <button class="btn-danger" on:click={handleResetPersona} disabled={ownerActionLoading || resetConfirmText !== 'RESET'}>
          {ownerActionLoading ? 'Resetting...' : 'Reset Persona'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  @keyframes pulse {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.1); }
  }
  .animate-pulse {
    animation: pulse 2s ease-in-out infinite;
  }
</style>
