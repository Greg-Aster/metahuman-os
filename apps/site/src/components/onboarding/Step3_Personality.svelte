<script lang="ts">
  export let onNext: () => void;
  export let onBack: () => void;
  export let onSkip: () => void;

  interface Message {
    role: 'assistant' | 'user';
    content: string;
  }

  let messages: Message[] = [
    {
      role: 'assistant',
      content: "Hi! I'm going to ask you a few questions to understand your personality and communication style. This helps your MetaHuman speak and think more like you. Just answer naturally - there are no right or wrong answers!",
    },
  ];

  let currentQuestion = 0;
  let userResponse = '';
  let processing = false;
  let extracting = false;
  let error = '';

  const questions = [
    "Let's start simple: How would your closest friends describe your personality?",
    "What energizes you? What drains you?",
    "When you face a problem, do you prefer to think it through alone first, or talk it out with others?",
    "What values are most important to you in life? (e.g., honesty, creativity, family, achievement, etc.)",
    "Describe your ideal day off. What would you do?",
    "How do you prefer to communicate? (e.g., direct and concise, detailed and thorough, casual and friendly, etc.)",
    "What are you currently most excited or curious about?",
  ];

  async function handleSendResponse() {
    if (!userResponse.trim()) return;

    processing = true;
    error = '';

    // Add user response to conversation
    messages = [
      ...messages,
      { role: 'user', content: userResponse.trim() },
    ];

    const userMessage = userResponse.trim();
    userResponse = '';

    // Move to next question or finish
    if (currentQuestion < questions.length - 1) {
      currentQuestion++;

      // Add next question
      messages = [
        ...messages,
        {
          role: 'assistant',
          content: questions[currentQuestion],
        },
      ];
    } else {
      // All questions answered - show completion message
      messages = [
        ...messages,
        {
          role: 'assistant',
          content: "Perfect! I have a good sense of who you are. Let me process this information and extract your personality profile...",
        },
      ];

      // Extract personality from conversation
      await extractPersonality();
    }

    processing = false;

    // Scroll to bottom
    setTimeout(() => {
      const container = document.querySelector('.conversation-container');
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    }, 100);
  }

  async function extractPersonality() {
    extracting = true;
    error = '';

    try {
      const response = await fetch('/api/onboarding/extract-persona', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: messages.map(m => ({ role: m.role, content: m.content })),
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to extract personality');
      }

      const data = await response.json();

      // Show success message
      messages = [
        ...messages,
        {
          role: 'assistant',
          content: `Great! I've extracted your personality profile:\n\n✓ Big Five personality traits\n✓ Core values and priorities\n✓ Communication style preferences\n✓ Interests and goals\n\nAll saved to your persona profile. Ready to continue?`,
        },
      ];

      // Increment personality questions counter
      await fetch('/api/onboarding/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          updates: {
            dataCollected: {
              personalityQuestions: questions.length,
            },
          },
        }),
      });

    } catch (err) {
      error = (err as Error).message;
      messages = [
        ...messages,
        {
          role: 'assistant',
          content: `Hmm, I encountered an error while processing your responses: ${(err as Error).message}\n\nYou can continue to the next step and we'll use the raw conversation data for now.`,
        },
      ];
    } finally {
      extracting = false;
    }
  }

  function handleSkipPersonality() {
    if (confirm('Skip personality questions? You can always add this information later through the chat interface or persona editor.')) {
      onSkip();
    }
  }

  function handleKeyPress(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendResponse();
    }
  }
</script>

<div class="step-personality">
  <div class="step-header">
    <h2>Let's Talk About You</h2>
    <p class="step-description">
      Answer a few conversational questions so your MetaHuman can understand your personality,
      values, and communication style. This takes about 5 minutes.
    </p>
  </div>

  <div class="conversation-container">
    <div class="messages">
      {#each messages as message, i}
        <div class="message {message.role}">
          <div class="message-avatar">
            {#if message.role === 'assistant'}
              🧠
            {:else}
              👤
            {/if}
          </div>
          <div class="message-bubble">
            {#each message.content.split('\n') as line}
              <p>{line}</p>
            {/each}
          </div>
        </div>
      {/each}

      {#if extracting}
        <div class="message assistant">
          <div class="message-avatar">🧠</div>
          <div class="message-bubble processing">
            <div class="typing-indicator">
              <span></span>
              <span></span>
              <span></span>
            </div>
            <p>Analyzing personality traits...</p>
          </div>
        </div>
      {/if}
    </div>
  </div>

  {#if currentQuestion < questions.length || extracting}
    <div class="input-container">
      <textarea
        bind:value={userResponse}
        on:keypress={handleKeyPress}
        placeholder="Type your response here... (Press Enter to send, Shift+Enter for new line)"
        rows="3"
        disabled={processing || extracting}
      />
      <button
        class="btn btn-send"
        on:click={handleSendResponse}
        disabled={!userResponse.trim() || processing || extracting}
      >
        {processing ? 'Sending...' : 'Send →'}
      </button>
    </div>
  {/if}

  {#if error}
    <div class="error-message">
      <span class="error-icon">⚠️</span>
      {error}
    </div>
  {/if}

  <div class="progress-indicator">
    <span class="progress-label">Question {Math.min(currentQuestion + 1, questions.length)} of {questions.length}</span>
    <div class="progress-bar">
      <div
        class="progress-fill"
        style="width: {((currentQuestion + 1) / questions.length) * 100}%"
      />
    </div>
  </div>

  <div class="step-actions">
    <button class="btn btn-secondary" on:click={onBack} disabled={processing || extracting}>
      ← Back
    </button>
    <button class="btn btn-ghost" on:click={handleSkipPersonality} disabled={processing || extracting}>
      Skip
    </button>
    <button
      class="btn btn-primary"
      on:click={onNext}
      disabled={currentQuestion < questions.length || extracting}
    >
      {extracting ? 'Processing...' : 'Continue →'}
    </button>
  </div>
</div>

<style>
  .step-personality {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    max-width: 800px;
    margin: 0 auto;
    padding: 2rem;
    height: 100%;
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

  .conversation-container {
    flex: 1;
    overflow-y: auto;
    padding: 1rem;
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    min-height: 400px;
    max-height: 500px;
  }

  :global(.dark) .conversation-container {
    background: #1f2937;
    border-color: #374151;
  }

  .messages {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .message {
    display: flex;
    gap: 0.75rem;
    align-items: start;
  }

  .message.user {
    flex-direction: row-reverse;
  }

  .message-avatar {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.5rem;
    flex-shrink: 0;
    background: #e5e7eb;
  }

  :global(.dark) .message-avatar {
    background: #374151;
  }

  .message.assistant .message-avatar {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  }

  .message.user .message-avatar {
    background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  }

  .message-bubble {
    max-width: 70%;
    padding: 1rem;
    border-radius: 12px;
    background: white;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
  }

  :global(.dark) .message-bubble {
    background: #374151;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  }

  .message.assistant .message-bubble {
    border-top-left-radius: 4px;
  }

  .message.user .message-bubble {
    border-top-right-radius: 4px;
    background: #eff6ff;
  }

  :global(.dark) .message.user .message-bubble {
    background: #1e3a8a;
  }

  .message-bubble p {
    margin: 0;
    font-size: 0.95rem;
    line-height: 1.5;
    color: #374151;
  }

  :global(.dark) .message-bubble p {
    color: #d1d5db;
  }

  .message.user .message-bubble p {
    color: #1e40af;
  }

  :global(.dark) .message.user .message-bubble p {
    color: #bfdbfe;
  }

  .message-bubble p + p {
    margin-top: 0.5rem;
  }

  .message-bubble.processing {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .typing-indicator {
    display: flex;
    gap: 0.25rem;
  }

  .typing-indicator span {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #667eea;
    animation: typing 1.4s infinite;
  }

  .typing-indicator span:nth-child(2) {
    animation-delay: 0.2s;
  }

  .typing-indicator span:nth-child(3) {
    animation-delay: 0.4s;
  }

  @keyframes typing {
    0%, 60%, 100% {
      opacity: 0.3;
      transform: translateY(0);
    }
    30% {
      opacity: 1;
      transform: translateY(-8px);
    }
  }

  .input-container {
    display: flex;
    gap: 1rem;
    align-items: flex-end;
  }

  textarea {
    flex: 1;
    padding: 0.75rem;
    font-size: 1rem;
    font-family: inherit;
    border: 1px solid #d1d5db;
    border-radius: 8px;
    background: white;
    color: #111827;
    resize: vertical;
    min-height: 80px;
  }

  :global(.dark) textarea {
    background: #1f2937;
    border-color: #4b5563;
    color: #f9fafb;
  }

  textarea:focus {
    outline: none;
    border-color: #667eea;
    box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
  }

  textarea:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-send {
    padding: 0.75rem 1.5rem;
    font-size: 1rem;
    font-weight: 600;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    transition: all 0.2s ease;
    white-space: nowrap;
  }

  .btn-send:hover:not(:disabled) {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
  }

  .btn-send:disabled {
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

  .progress-indicator {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .progress-label {
    font-size: 0.9rem;
    color: #6b7280;
    text-align: center;
  }

  :global(.dark) .progress-label {
    color: #9ca3af;
  }

  .progress-bar {
    height: 8px;
    background: #e5e7eb;
    border-radius: 4px;
    overflow: hidden;
  }

  :global(.dark) .progress-bar {
    background: #374151;
  }

  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
    transition: width 0.3s ease;
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
    .step-personality {
      padding: 1rem;
    }

    .message-bubble {
      max-width: 85%;
    }

    .input-container {
      flex-direction: column;
      align-items: stretch;
    }

    .btn-send {
      width: 100%;
    }

    .step-actions {
      flex-direction: column;
    }
  }
</style>
