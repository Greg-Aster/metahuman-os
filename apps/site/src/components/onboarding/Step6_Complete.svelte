<script lang="ts">
  import { onMount } from 'svelte';
  import { apiFetch } from '../../lib/client/api-config';

  export let onComplete: () => void;
  export let onBack: () => void;

  interface OnboardingState {
    completed: boolean;
    currentStep: number;
    stepsCompleted: Record<string, boolean>;
    dataCollected: {
      identityQuestions: number;
      personalityQuestions: number;
      filesIngested: number;
      tasksCreated: number;
      memoriesCreated: number;
    };
  }

  let state: OnboardingState | null = null;
  let loading = true;
  let completing = false;
  let error = '';

  onMount(async () => {
    await loadState();
  });

  async function loadState() {
    loading = true;
    try {
      const response = await apiFetch('/api/onboarding/state');
      if (!response.ok) {
        throw new Error('Failed to load onboarding state');
      }
      const data = await response.json();
      state = data.state;
    } catch (err) {
      error = (err as Error).message;
    } finally {
      loading = false;
    }
  }

  async function handleComplete() {
    completing = true;
    error = '';

    try {
      const response = await apiFetch('/api/onboarding/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        throw new Error('Failed to complete onboarding');
      }

      // Call parent completion handler
      onComplete();
    } catch (err) {
      error = (err as Error).message;
      completing = false;
    }
  }

  function getTotalDataPoints(): number {
    if (!state) return 0;
    const { dataCollected } = state;
    return (
      dataCollected.identityQuestions +
      dataCollected.personalityQuestions +
      dataCollected.filesIngested +
      dataCollected.tasksCreated +
      dataCollected.memoriesCreated
    );
  }
</script>

<div class="flex flex-col gap-10 max-w-4xl mx-auto p-8 md:p-4">
  {#if loading}
    <div class="flex flex-col items-center gap-4 py-12 px-8">
      <div class="w-12 h-12 border-4 border-gray-200 dark:border-gray-600 border-t-indigo-500 rounded-full animate-spin"></div>
      <p class="text-gray-500 dark:text-gray-400">Loading your progress...</p>
    </div>
  {:else if state}
    <div class="flex flex-col items-center text-center gap-4 py-8 px-4">
      <div class="text-7xl animate-bounce">🎉</div>
      <h1 class="text-4xl md:text-3xl font-bold bg-gradient-to-br from-indigo-500 to-purple-600 dark:from-indigo-400 dark:to-purple-400 bg-clip-text text-transparent">You're All Set!</h1>
      <p class="text-lg leading-relaxed text-gray-500 dark:text-gray-400 max-w-xl">
        Your MetaHuman is ready to begin learning and operating as your digital consciousness.
      </p>
    </div>

    <div class="flex flex-col gap-6 p-8 bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-800 dark:to-gray-900 rounded-xl">
      <h2 class="text-2xl font-semibold text-gray-900 dark:text-gray-50 text-center">What We've Captured</h2>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {#if state.dataCollected.identityQuestions > 0}
          <div class="flex items-center gap-4 p-5 bg-white dark:bg-gray-700 rounded-lg shadow-sm dark:shadow-black/20">
            <div class="text-4xl">👤</div>
            <div class="flex flex-col gap-1">
              <div class="text-3xl font-bold text-indigo-500">{state.dataCollected.identityQuestions}</div>
              <div class="text-sm text-gray-500 dark:text-gray-400">Identity Details</div>
            </div>
          </div>
        {/if}

        {#if state.dataCollected.personalityQuestions > 0}
          <div class="flex items-center gap-4 p-5 bg-white dark:bg-gray-700 rounded-lg shadow-sm dark:shadow-black/20">
            <div class="text-4xl">🧠</div>
            <div class="flex flex-col gap-1">
              <div class="text-3xl font-bold text-indigo-500">{state.dataCollected.personalityQuestions}</div>
              <div class="text-sm text-gray-500 dark:text-gray-400">Personality Questions</div>
            </div>
          </div>
        {/if}

        {#if state.dataCollected.filesIngested > 0}
          <div class="flex items-center gap-4 p-5 bg-white dark:bg-gray-700 rounded-lg shadow-sm dark:shadow-black/20">
            <div class="text-4xl">📁</div>
            <div class="flex flex-col gap-1">
              <div class="text-3xl font-bold text-indigo-500">{state.dataCollected.filesIngested}</div>
              <div class="text-sm text-gray-500 dark:text-gray-400">Files Imported</div>
            </div>
          </div>
        {/if}

        {#if state.dataCollected.tasksCreated > 0}
          <div class="flex items-center gap-4 p-5 bg-white dark:bg-gray-700 rounded-lg shadow-sm dark:shadow-black/20">
            <div class="text-4xl">✓</div>
            <div class="flex flex-col gap-1">
              <div class="text-3xl font-bold text-indigo-500">{state.dataCollected.tasksCreated}</div>
              <div class="text-sm text-gray-500 dark:text-gray-400">Tasks Created</div>
            </div>
          </div>
        {/if}
      </div>

      <div class="text-center text-lg text-gray-700 dark:text-gray-300 pt-4 border-t border-gray-200 dark:border-gray-600">
        <strong class="text-indigo-500 text-xl">{getTotalDataPoints()}</strong> total data points captured
      </div>
    </div>

    <div>
      <h2 class="text-2xl font-semibold text-gray-900 dark:text-gray-50 mb-6">What Happens Next?</h2>
      <div class="flex flex-col gap-4">
        <div class="flex gap-4 p-5 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg">
          <div class="w-10 h-10 flex items-center justify-center bg-gradient-to-br from-indigo-500 to-purple-600 text-white font-bold text-xl rounded-full flex-shrink-0">1</div>
          <div>
            <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-50 mb-2">Background Processing</h3>
            <p class="text-base leading-relaxed text-gray-500 dark:text-gray-400">
              The Organizer agent will enrich your memories with tags, entities, and connections.
              This happens automatically in the background.
            </p>
          </div>
        </div>

        <div class="flex gap-4 p-5 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg">
          <div class="w-10 h-10 flex items-center justify-center bg-gradient-to-br from-indigo-500 to-purple-600 text-white font-bold text-xl rounded-full flex-shrink-0">2</div>
          <div>
            <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-50 mb-2">Personality Modeling</h3>
            <p class="text-base leading-relaxed text-gray-500 dark:text-gray-400">
              Your MetaHuman will analyze your communication patterns and personality traits
              to build a model that thinks like you.
            </p>
          </div>
        </div>

        <div class="flex gap-4 p-5 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg">
          <div class="w-10 h-10 flex items-center justify-center bg-gradient-to-br from-indigo-500 to-purple-600 text-white font-bold text-xl rounded-full flex-shrink-0">3</div>
          <div>
            <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-50 mb-2">Continuous Learning</h3>
            <p class="text-base leading-relaxed text-gray-500 dark:text-gray-400">
              As you use the system, your MetaHuman will learn from your decisions,
              preferences, and interactions to become more aligned with you over time.
            </p>
          </div>
        </div>

        <div class="flex gap-4 p-5 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg">
          <div class="w-10 h-10 flex items-center justify-center bg-gradient-to-br from-indigo-500 to-purple-600 text-white font-bold text-xl rounded-full flex-shrink-0">4</div>
          <div>
            <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-50 mb-2">Autonomous Operation</h3>
            <p class="text-base leading-relaxed text-gray-500 dark:text-gray-400">
              Background agents will work on your goals, generate reflections,
              and perform tasks autonomously while respecting your trust boundaries.
            </p>
          </div>
        </div>
      </div>
    </div>

    <div>
      <h2 class="text-2xl font-semibold text-gray-900 dark:text-gray-50 mb-6">Explore Key Features</h2>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div class="flex flex-col items-center text-center gap-3 p-6 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg transition-all hover:-translate-y-1 hover:shadow-lg">
          <div class="text-4xl">💬</div>
          <h3 class="text-base font-semibold text-gray-900 dark:text-gray-50">Chat Interface</h3>
          <p class="text-sm leading-snug text-gray-500 dark:text-gray-400">Have conversations with your digital consciousness</p>
        </div>

        <div class="flex flex-col items-center text-center gap-3 p-6 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg transition-all hover:-translate-y-1 hover:shadow-lg">
          <div class="text-4xl">📝</div>
          <h3 class="text-base font-semibold text-gray-900 dark:text-gray-50">Memory Capture</h3>
          <p class="text-sm leading-snug text-gray-500 dark:text-gray-400">Record observations, events, and thoughts</p>
        </div>

        <div class="flex flex-col items-center text-center gap-3 p-6 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg transition-all hover:-translate-y-1 hover:shadow-lg">
          <div class="text-4xl">📊</div>
          <h3 class="text-base font-semibold text-gray-900 dark:text-gray-50">Dashboard</h3>
          <p class="text-sm leading-snug text-gray-500 dark:text-gray-400">Monitor system status and agent activity</p>
        </div>

        <div class="flex flex-col items-center text-center gap-3 p-6 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg transition-all hover:-translate-y-1 hover:shadow-lg">
          <div class="text-4xl">✅</div>
          <h3 class="text-base font-semibold text-gray-900 dark:text-gray-50">Task Manager</h3>
          <p class="text-sm leading-snug text-gray-500 dark:text-gray-400">Track goals and manage your to-do list</p>
        </div>

        <div class="flex flex-col items-center text-center gap-3 p-6 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg transition-all hover:-translate-y-1 hover:shadow-lg">
          <div class="text-4xl">🔍</div>
          <h3 class="text-base font-semibold text-gray-900 dark:text-gray-50">Memory Browser</h3>
          <p class="text-sm leading-snug text-gray-500 dark:text-gray-400">Search and explore your episodic memories</p>
        </div>

        <div class="flex flex-col items-center text-center gap-3 p-6 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg transition-all hover:-translate-y-1 hover:shadow-lg">
          <div class="text-4xl">⚙️</div>
          <h3 class="text-base font-semibold text-gray-900 dark:text-gray-50">Settings</h3>
          <p class="text-sm leading-snug text-gray-500 dark:text-gray-400">Configure persona, models, and preferences</p>
        </div>
      </div>
    </div>

    <div class="flex items-start gap-4 p-6 bg-gradient-to-br from-emerald-50 to-green-100 dark:from-emerald-900 dark:to-green-900 border-2 border-emerald-500 rounded-lg">
      <div class="text-3xl flex-shrink-0">🔒</div>
      <div>
        <strong class="block text-lg text-emerald-800 dark:text-emerald-300 mb-2">Your Privacy is Protected</strong>
        <p class="text-base leading-relaxed text-emerald-700 dark:text-emerald-200">
          All your data remains on your local machine. MetaHuman OS operates 100% locally
          with no cloud dependencies, no external API calls, and no data sharing.
        </p>
      </div>
    </div>

    {#if error}
      <div class="flex items-center gap-2 px-4 py-3 bg-red-100 dark:bg-red-900 border border-red-500 rounded-md text-red-800 dark:text-red-200 text-sm">
        <span class="text-xl">⚠️</span>
        {error}
      </div>
    {/if}
  {:else}
    <div class="flex flex-col items-center gap-4 py-12 px-8 text-center">
      <span class="text-xl">⚠️</span>
      <p class="text-gray-500 dark:text-gray-400">Failed to load onboarding data</p>
    </div>
  {/if}

  <div class="flex justify-between gap-4 pt-4 border-t border-gray-200 dark:border-gray-700 md:flex-col">
    <button class="px-6 py-3 text-base font-semibold bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg cursor-pointer transition-all hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed" on:click={onBack} disabled={completing}>
      ← Back
    </button>
    <button
      class="px-8 py-4 text-lg font-semibold bg-gradient-to-br from-indigo-500 to-purple-600 text-white border-none rounded-lg cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-indigo-500/40 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:transform-none disabled:hover:shadow-none"
      on:click={handleComplete}
      disabled={completing}
    >
      {completing ? 'Finalizing...' : 'Complete Onboarding 🚀'}
    </button>
  </div>
</div>

