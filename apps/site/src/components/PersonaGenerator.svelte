<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import ReviewApplyDialog from './ReviewApplyDialog.svelte';

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

  // Session history
  let sessions: any[] = [];
  let showHistory = false;

  // Auto-resume notification
  let showResumeNotification = false;
  let resumableSessionId = '';

  // Auto-scroll
  let messagesContainer: HTMLDivElement;

  // Admin actions
  let showPurgeConfirm = false;
  let showResetConfirm = false;
  let adminLoading = false;
  let adminError = '';
  let resetConfirmText = '';

  onMount(async () => {
    await loadSessionHistory();
    // Check for active session to resume
    const savedSessionId = localStorage.getItem('persona-generator-session');
    if (savedSessionId && sessions.some(s => s.sessionId === savedSessionId && s.status === 'active')) {
      showResumeNotification = true;
      resumableSessionId = savedSessionId;
    }
  });

  async function loadSessionHistory() {
    try {
      const response = await fetch('/api/persona/generator/load');
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

  async function resumeSession(sessionId: string) {
    loading = true;
    error = '';

    try {
      const response = await fetch(`/api/persona/generator/load?sessionId=${sessionId}`);

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to load session');
      }

      const data = await response.json();
      currentSession = data.session;
      localStorage.setItem('persona-generator-session', sessionId);
    } catch (err: any) {
      error = err.message;
      localStorage.removeItem('persona-generator-session');
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
      const response = await fetch('/api/persona/generator/apply', {
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

      // Success - clear session and refresh
      localStorage.removeItem('persona-generator-session');
      currentSession.status = 'applied';
      showReviewDialog = false;
      await loadSessionHistory();

      // Show success message
      alert('Persona updated successfully! Your changes have been applied.');

      // Clear session after short delay
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
      await fetch('/api/persona/generator/discard', {
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
    // Session is already saved server-side, just clear UI
    currentSession = null;
  }

  function getCategoryColor(percentage: number): string {
    if (percentage >= 80) return '#10b981'; // green
    if (percentage >= 60) return '#f59e0b'; // orange
    return '#6b7280'; // gray
  }

  async function handlePurgeSessions() {
    adminLoading = true;
    adminError = '';

    try {
      const response = await fetch('/api/persona/generator/purge-sessions', {
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
      adminError = err.message;
    } finally {
      adminLoading = false;
    }
  }

  async function handleResetPersona() {
    if (resetConfirmText !== 'RESET') {
      adminError = 'Please type "RESET" to confirm';
      return;
    }

    adminLoading = true;
    adminError = '';

    try {
      const response = await fetch('/api/persona/generator/reset-persona', {
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
      adminError = err.message;
    } finally {
      adminLoading = false;
    }
  }
</script>

<div class="persona-generator">
  <div class="header">
    <h2>Persona Generator</h2>
    <p class="subtitle">
      Interactive personality interview to build your digital persona
    </p>
  </div>

  {#if error}
    <div class="error-banner">
      <strong>Error:</strong> {error}
    </div>
  {/if}

  {#if showResumeNotification && !currentSession}
    <div class="resume-notification">
      <div class="notification-content">
        <span class="notification-icon">💭</span>
        <div class="notification-text">
          <strong>You have an unfinished interview</strong>
          <p>Would you like to continue where you left off?</p>
        </div>
      </div>
      <div class="notification-actions">
        <button class="primary" on:click={() => {
          resumeSession(resumableSessionId);
          showResumeNotification = false;
        }}>
          Resume Interview
        </button>
        <button class="secondary" on:click={() => {
          localStorage.removeItem('persona-generator-session');
          showResumeNotification = false;
        }}>
          Start Fresh
        </button>
      </div>
    </div>
  {/if}

  {#if !currentSession}
    <div class="start-screen">
      <div class="intro">
        <h3>Welcome to the Persona Generator</h3>
        <p>
          This guided interview uses motivational interviewing techniques to understand
          your authentic personality, values, goals, and communication style.
        </p>
        <ul>
          <li>7-15 thoughtful questions adapted to your answers</li>
          <li>Tracks coverage across 5 personality categories</li>
          <li>Generates structured persona data from your responses</li>
          <li>Review and customize before applying changes</li>
        </ul>
      </div>

      <div class="actions">
        <button class="primary" on:click={startNewSession} disabled={loading}>
          {loading ? 'Starting...' : 'Start New Interview'}
        </button>

        {#if sessions.length > 0}
          <button class="secondary" on:click={() => (showHistory = !showHistory)}>
            {showHistory ? 'Hide' : 'Show'} Session History ({sessions.length})
          </button>
        {/if}
      </div>

      {#if showHistory && sessions.length > 0}
        <div class="session-history">
          <h4>Previous Sessions</h4>
          <div class="session-list">
            {#each sessions as session}
              <div class="session-card">
                <div class="session-meta">
                  <span class="session-id">{session.sessionId.slice(0, 8)}...</span>
                  <span class="session-status status-{session.status}">{session.status}</span>
                </div>
                <div class="session-details">
                  <span>{session.questionCount} questions</span>
                  <span>{session.answerCount} answers</span>
                  <span>{new Date(session.createdAt).toLocaleDateString()}</span>
                </div>
                {#if session.status === 'active'}
                  <button class="resume-btn" on:click={() => resumeSession(session.sessionId)}>
                    Resume
                  </button>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Admin Section -->
      <div class="admin-section">
        <h4>⚠️ Administrative Actions</h4>
        <p class="admin-warning">
          These actions are irreversible. Use with caution.
        </p>
        <div class="admin-actions">
          <button class="danger" on:click={() => showPurgeConfirm = true}>
            Purge All Sessions
          </button>
          <button class="danger" on:click={() => showResetConfirm = true}>
            Reset Persona File
          </button>
        </div>
      </div>
    </div>
  {:else}
    <div class="interview-screen">
      <!-- Compact Progress Meter -->
      <div class="progress-section-compact">
        <div class="progress-header">
          <span class="progress-label">Progress:</span>
          {#each Object.entries(currentSession?.categoryCoverage || {}) as [category, percentage]}
            <div class="progress-pill">
              <span class="pill-category">{category.charAt(0).toUpperCase() + category.slice(1, 4)}</span>
              <span class="pill-percentage" style="color: {getCategoryColor(percentage)}">{percentage}%</span>
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

        {#if loading}
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
            <button class="primary" on:click={submitAnswer} disabled={loading || !currentAnswer.trim()}>
              {loading ? 'Submitting...' : 'Submit Answer'}
            </button>
            <button class="secondary" on:click={pauseSession} disabled={loading}>
              Pause
            </button>
            <button class="danger" on:click={discardSession} disabled={loading}>
              Discard
            </button>
          </div>
          <p class="hint">Press Ctrl+Enter to submit</p>
        </div>
      {/if}

      {#if currentSession?.status === 'completed'}
        <div class="completion-message">
          <h3>Interview Complete!</h3>
          <p>Finalizing your persona data...</p>
        </div>
      {/if}

      {#if currentSession?.status === 'applied'}
        <div class="success-message">
          <h3>✓ Persona Applied Successfully</h3>
          <p>Your personality profile has been updated.</p>
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
  <div class="modal-backdrop" on:click={() => showPurgeConfirm = false}>
    <div class="modal-content" on:click|stopPropagation>
      <h3>⚠️ Purge All Sessions</h3>
      <p class="modal-description">
        This will permanently delete <strong>all interview sessions</strong> ({sessions.length} total)
        from your profile directory.
      </p>
      <p class="modal-warning">
        This action cannot be undone. Session transcripts will be lost forever.
      </p>

      {#if adminError}
        <div class="modal-error">{adminError}</div>
      {/if}

      <div class="modal-actions">
        <button class="secondary" on:click={() => { showPurgeConfirm = false; adminError = ''; }} disabled={adminLoading}>
          Cancel
        </button>
        <button class="danger" on:click={handlePurgeSessions} disabled={adminLoading}>
          {adminLoading ? 'Purging...' : 'Purge All Sessions'}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Reset Persona Confirmation Modal -->
{#if showResetConfirm}
  <div class="modal-backdrop" on:click={() => showResetConfirm = false}>
    <div class="modal-content" on:click|stopPropagation>
      <h3>⚠️ Reset Persona File</h3>
      <p class="modal-description">
        This will reset your <code>persona/core.json</code> file to default settings.
      </p>
      <p class="modal-warning">
        All personality traits, values, goals, and preferences will be lost.
        A backup will be created before resetting.
      </p>

      <div class="confirmation-input">
        <label for="reset-confirm">Type <strong>RESET</strong> to confirm:</label>
        <input
          id="reset-confirm"
          type="text"
          bind:value={resetConfirmText}
          placeholder="RESET"
          disabled={adminLoading}
        />
      </div>

      {#if adminError}
        <div class="modal-error">{adminError}</div>
      {/if}

      <div class="modal-actions">
        <button class="secondary" on:click={() => { showResetConfirm = false; resetConfirmText = ''; adminError = ''; }} disabled={adminLoading}>
          Cancel
        </button>
        <button class="danger" on:click={handleResetPersona} disabled={adminLoading || resetConfirmText !== 'RESET'}>
          {adminLoading ? 'Resetting...' : 'Reset Persona'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .persona-generator {
    height: 100%;
    display: flex;
    flex-direction: column;
    padding: 1.5rem;
    color: #e5e7eb;
  }

  .header {
    margin-bottom: 1.5rem;
  }

  .header h2 {
    margin: 0 0 0.5rem 0;
    color: #f9fafb;
  }

  .subtitle {
    margin: 0;
    color: #9ca3af;
    font-size: 0.9rem;
  }

  .error-banner {
    background: #7f1d1d;
    border: 1px solid #991b1b;
    padding: 1rem;
    border-radius: 0.375rem;
    margin-bottom: 1rem;
  }

  .resume-notification {
    background: #1e3a8a;
    border: 1px solid #3b82f6;
    border-radius: 0.5rem;
    padding: 1.5rem;
    margin-bottom: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .notification-content {
    display: flex;
    align-items: flex-start;
    gap: 1rem;
  }

  .notification-icon {
    font-size: 2rem;
    line-height: 1;
  }

  .notification-text {
    flex: 1;
  }

  .notification-text strong {
    display: block;
    margin-bottom: 0.5rem;
    color: #f9fafb;
  }

  .notification-text p {
    margin: 0;
    color: #e5e7eb;
  }

  .notification-actions {
    display: flex;
    gap: 0.75rem;
  }

  .start-screen {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .intro h3 {
    margin: 0 0 1rem 0;
    color: #f9fafb;
  }

  .intro p {
    margin: 0 0 1rem 0;
    line-height: 1.6;
  }

  .intro ul {
    margin: 0;
    padding-left: 1.5rem;
    line-height: 1.8;
  }

  .actions {
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
  }

  button {
    padding: 0.75rem 1.5rem;
    border-radius: 0.375rem;
    border: none;
    font-size: 0.95rem;
    cursor: pointer;
    transition: all 0.2s;
  }

  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  button.primary {
    background: #3b82f6;
    color: white;
  }

  button.primary:hover:not(:disabled) {
    background: #2563eb;
  }

  button.secondary {
    background: #374151;
    color: #e5e7eb;
  }

  button.secondary:hover:not(:disabled) {
    background: #4b5563;
  }

  button.danger {
    background: #7f1d1d;
    color: #fecaca;
  }

  button.danger:hover:not(:disabled) {
    background: #991b1b;
  }

  .session-history {
    background: #1f2937;
    border-radius: 0.5rem;
    padding: 1.5rem;
  }

  .session-history h4 {
    margin: 0 0 1rem 0;
    color: #f9fafb;
  }

  .session-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .session-card {
    background: #111827;
    padding: 1rem;
    border-radius: 0.375rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .session-meta {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .session-id {
    font-family: monospace;
    color: #9ca3af;
    font-size: 0.85rem;
  }

  .session-status {
    padding: 0.25rem 0.75rem;
    border-radius: 9999px;
    font-size: 0.75rem;
    font-weight: 600;
  }

  .status-active {
    background: #065f46;
    color: #6ee7b7;
  }

  .status-completed {
    background: #1e3a8a;
    color: #93c5fd;
  }

  .status-finalized {
    background: #713f12;
    color: #fde68a;
  }

  .status-applied {
    background: #14532d;
    color: #86efac;
  }

  .status-aborted {
    background: #374151;
    color: #9ca3af;
  }

  .session-details {
    display: flex;
    gap: 1rem;
    font-size: 0.85rem;
    color: #9ca3af;
  }

  .resume-btn {
    padding: 0.5rem 1rem;
    background: #3b82f6;
    color: white;
    font-size: 0.85rem;
  }

  .interview-screen {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    flex: 1;
    min-height: 0;
  }

  /* Compact horizontal progress meter */
  .progress-section-compact {
    background: #1f2937;
    border-radius: 0.5rem;
    padding: 0.75rem 1rem;
    flex-shrink: 0;
  }

  .progress-header {
    display: flex;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .progress-label {
    font-size: 0.875rem;
    color: #9ca3af;
    font-weight: 600;
  }

  .progress-pill {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background: #374151;
    padding: 0.375rem 0.75rem;
    border-radius: 9999px;
    font-size: 0.8125rem;
  }

  .pill-category {
    color: #9ca3af;
    text-transform: uppercase;
    font-weight: 600;
    letter-spacing: 0.025em;
  }

  .pill-percentage {
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .conversation {
    flex: 1;
    overflow-y: auto;
    background: #1f2937;
    border-radius: 0.5rem;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    min-height: 0;
  }

  .message {
    display: flex;
  }

  .message.assistant {
    justify-content: flex-start;
  }

  .message.user {
    justify-content: flex-end;
  }

  .message-content {
    max-width: 75%;
    padding: 1rem;
    border-radius: 0.5rem;
    line-height: 1.6;
  }

  .message.assistant .message-content {
    background: #374151;
  }

  .message.user .message-content {
    background: #1e3a8a;
  }

  .message-content strong {
    display: block;
    margin-bottom: 0.5rem;
    color: #f9fafb;
  }

  .message-content p {
    margin: 0;
    color: #e5e7eb;
  }

  .message-meta {
    display: block;
    margin-top: 0.5rem;
    font-size: 0.75rem;
    color: #9ca3af;
    font-style: italic;
  }

  .input-area {
    background: #1f2937;
    border-radius: 0.5rem;
    padding: 1rem;
    flex-shrink: 0;
  }

  textarea {
    width: 100%;
    background: #111827;
    border: 1px solid #374151;
    border-radius: 0.375rem;
    padding: 0.75rem;
    color: #e5e7eb;
    font-family: inherit;
    font-size: 0.95rem;
    resize: vertical;
    margin-bottom: 0.75rem;
  }

  textarea:focus {
    outline: none;
    border-color: #3b82f6;
  }

  textarea::placeholder {
    color: #6b7280;
  }

  .input-actions {
    display: flex;
    gap: 0.75rem;
  }

  .hint {
    margin: 0.5rem 0 0 0;
    font-size: 0.75rem;
    color: #6b7280;
  }

  .completion-message,
  .success-message {
    background: #1f2937;
    border-radius: 0.5rem;
    padding: 2rem;
    text-align: center;
  }

  .completion-message h3,
  .success-message h3 {
    margin: 0 0 0.5rem 0;
    color: #f9fafb;
  }

  .success-message h3 {
    color: #10b981;
  }

  .completion-message p,
  .success-message p {
    margin: 0;
    color: #9ca3af;
  }

  /* Admin Section */
  .admin-section {
    background: #1f2937;
    border: 2px solid #7f1d1d;
    border-radius: 0.5rem;
    padding: 1.5rem;
    margin-top: 1.5rem;
  }

  .admin-section h4 {
    margin: 0 0 0.75rem 0;
    color: #fca5a5;
    font-size: 1rem;
  }

  .admin-warning {
    margin: 0 0 1rem 0;
    color: #fca5a5;
    font-size: 0.85rem;
  }

  .admin-actions {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  /* Confirmation Modals */
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
    z-index: 10000;
    padding: 1rem;
  }

  .modal-content {
    background: #1f2937;
    border: 1px solid #374151;
    border-radius: 0.5rem;
    max-width: 500px;
    width: 100%;
    padding: 2rem;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  }

  .modal-content h3 {
    margin: 0 0 1rem 0;
    color: #fca5a5;
  }

  .modal-description {
    margin: 0 0 1rem 0;
    color: #e5e7eb;
    line-height: 1.6;
  }

  .modal-description strong,
  .modal-description code {
    color: #f9fafb;
  }

  .modal-description code {
    background: #111827;
    padding: 0.125rem 0.375rem;
    border-radius: 0.25rem;
    font-family: monospace;
    font-size: 0.9em;
  }

  .modal-warning {
    margin: 0 0 1.5rem 0;
    padding: 0.75rem 1rem;
    background: #7f1d1d;
    border: 1px solid #991b1b;
    border-radius: 0.375rem;
    color: #fecaca;
    font-size: 0.85rem;
    line-height: 1.5;
  }

  .modal-error {
    margin: 0 0 1rem 0;
    padding: 0.75rem 1rem;
    background: #7f1d1d;
    border: 1px solid #991b1b;
    border-radius: 0.375rem;
    color: #fecaca;
    font-size: 0.85rem;
  }

  .confirmation-input {
    margin-bottom: 1.5rem;
  }

  .confirmation-input label {
    display: block;
    margin-bottom: 0.5rem;
    color: #e5e7eb;
    font-size: 0.9rem;
  }

  .confirmation-input strong {
    color: #fca5a5;
    font-family: monospace;
  }

  .confirmation-input input {
    width: 100%;
    padding: 0.75rem;
    background: #111827;
    border: 1px solid #374151;
    border-radius: 0.375rem;
    color: #e5e7eb;
    font-size: 1rem;
    font-family: monospace;
  }

  .confirmation-input input:focus {
    outline: none;
    border-color: #7f1d1d;
  }

  .modal-actions {
    display: flex;
    gap: 0.75rem;
    justify-content: flex-end;
  }
</style>
