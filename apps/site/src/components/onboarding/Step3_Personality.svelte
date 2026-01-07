<script lang="ts">
  import { apiFetch } from '../../lib/client/api-config';

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
      const response = await apiFetch('/api/onboarding/extract-persona', {
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
      await apiFetch('/api/onboarding/state', {
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

<div class="flex flex-col gap-6 max-w-[800px] mx-auto p-8 md:p-4 h-full">
  <div>
    <h2 class="text-3xl font-semibold m-0 mb-2 text-gray-900 dark:text-gray-50">Let's Talk About You</h2>
    <p class="text-base leading-relaxed text-gray-500 dark:text-gray-400 m-0">
      Answer a few conversational questions so your MetaHuman can understand your personality,
      values, and communication style. This takes about 5 minutes.
    </p>
  </div>

  <div class="conversation-container flex-1 overflow-y-auto p-4 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg min-h-[400px] max-h-[500px]">
    <div class="flex flex-col gap-4">
      {#each messages as message, i}
        <div class="flex gap-3 items-start {message.role === 'user' ? 'flex-row-reverse' : ''}">
          <div class="w-10 h-10 rounded-full flex items-center justify-center text-2xl flex-shrink-0 {message.role === 'assistant' ? 'bg-gradient-to-br from-indigo-500 to-purple-600' : 'bg-gradient-to-br from-emerald-500 to-emerald-600'}">
            {#if message.role === 'assistant'}
              🧠
            {:else}
              👤
            {/if}
          </div>
          <div class="max-w-[70%] md:max-w-[85%] p-4 rounded-xl shadow-sm {message.role === 'assistant' ? 'bg-white dark:bg-gray-700 rounded-tl-sm' : 'bg-blue-50 dark:bg-blue-900 rounded-tr-sm'}">
            {#each message.content.split('\n') as line}
              <p class="m-0 text-[0.95rem] leading-relaxed {message.role === 'assistant' ? 'text-gray-700 dark:text-gray-300' : 'text-blue-800 dark:text-blue-200'} [&+p]:mt-2">{line}</p>
            {/each}
          </div>
        </div>
      {/each}

      {#if extracting}
        <div class="flex gap-3 items-start">
          <div class="w-10 h-10 rounded-full flex items-center justify-center text-2xl flex-shrink-0 bg-gradient-to-br from-indigo-500 to-purple-600">🧠</div>
          <div class="max-w-[70%] p-4 rounded-xl rounded-tl-sm shadow-sm bg-white dark:bg-gray-700 flex flex-col gap-3">
            <div class="typing-indicator flex gap-1">
              <span class="w-2 h-2 rounded-full bg-indigo-500 animate-typing"></span>
              <span class="w-2 h-2 rounded-full bg-indigo-500 animate-typing [animation-delay:0.2s]"></span>
              <span class="w-2 h-2 rounded-full bg-indigo-500 animate-typing [animation-delay:0.4s]"></span>
            </div>
            <p class="m-0 text-[0.95rem] leading-relaxed text-gray-700 dark:text-gray-300">Analyzing personality traits...</p>
          </div>
        </div>
      {/if}
    </div>
  </div>

  {#if currentQuestion < questions.length || extracting}
    <div class="flex gap-4 items-end md:flex-col md:items-stretch">
      <textarea
        bind:value={userResponse}
        on:keypress={handleKeyPress}
        placeholder="Type your response here... (Press Enter to send, Shift+Enter for new line)"
        rows="3"
        disabled={processing || extracting}
        class="flex-1 p-3 text-base font-inherit border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-50 resize-y min-h-[80px] focus:outline-none focus:border-indigo-500 focus:ring-[3px] focus:ring-indigo-500/10 disabled:opacity-50 disabled:cursor-not-allowed"
      />
      <button
        class="px-6 py-3 text-base font-semibold border-none rounded-lg cursor-pointer bg-gradient-to-br from-indigo-500 to-purple-600 text-white whitespace-nowrap transition-all hover:enabled:-translate-y-0.5 hover:enabled:shadow-lg hover:enabled:shadow-indigo-500/40 disabled:opacity-50 disabled:cursor-not-allowed md:w-full"
        on:click={handleSendResponse}
        disabled={!userResponse.trim() || processing || extracting}
      >
        {processing ? 'Sending...' : 'Send →'}
      </button>
    </div>
  {/if}

  {#if error}
    <div class="flex items-center gap-2 px-4 py-3 bg-red-100 dark:bg-red-900 border border-red-500 rounded-md text-red-800 dark:text-red-200 text-sm">
      <span>⚠️</span>
      {error}
    </div>
  {/if}

  <div class="flex flex-col gap-2">
    <span class="text-sm text-gray-500 dark:text-gray-400 text-center">Question {Math.min(currentQuestion + 1, questions.length)} of {questions.length}</span>
    <div class="h-2 bg-gray-200 dark:bg-gray-700 rounded overflow-hidden">
      <div
        class="h-full bg-gradient-to-r from-indigo-500 to-purple-600 transition-[width] duration-300"
        style="width: {((currentQuestion + 1) / questions.length) * 100}%"
      ></div>
    </div>
  </div>

  <div class="flex justify-between gap-4 pt-4 border-t border-gray-200 dark:border-gray-700 md:flex-col">
    <button class="px-6 py-3 text-base font-semibold rounded-lg cursor-pointer transition-all bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 hover:enabled:bg-gray-200 dark:hover:enabled:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed" on:click={onBack} disabled={processing || extracting}>
      ← Back
    </button>
    <button class="px-6 py-3 text-base font-semibold rounded-lg cursor-pointer transition-all bg-transparent text-gray-500 dark:text-gray-400 border-none hover:enabled:text-gray-900 dark:hover:enabled:text-gray-50 hover:enabled:bg-gray-100 dark:hover:enabled:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed" on:click={handleSkipPersonality} disabled={processing || extracting}>
      Skip
    </button>
    <button
      class="px-6 py-3 text-base font-semibold rounded-lg cursor-pointer transition-all bg-gradient-to-br from-indigo-500 to-purple-600 text-white border-none hover:enabled:-translate-y-0.5 hover:enabled:shadow-lg hover:enabled:shadow-indigo-500/40 disabled:opacity-50 disabled:cursor-not-allowed"
      on:click={onNext}
      disabled={currentQuestion < questions.length || extracting}
    >
      {extracting ? 'Processing...' : 'Continue →'}
    </button>
  </div>
</div>

<style>
  /* Custom typing animation for chat bubbles */
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

  .animate-typing {
    animation: typing 1.4s infinite;
  }
</style>
