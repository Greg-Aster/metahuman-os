<script lang="ts">
  import PersonaGeneratorEmbed from './PersonaGeneratorEmbed.svelte';
  import Step3Personality from './Step3_Personality.svelte';

  export let onNext: () => void;
  export let onBack: () => void;

  let choice: 'pending' | 'full-interview' | 'quick-survey' | 'skip' = 'pending';
  let showSkipNotification = false;

  function handleStartFullInterview() {
    choice = 'full-interview';
  }

  function handleStartQuickSurvey() {
    choice = 'quick-survey';
  }

  function handleSkipBoth() {
    showSkipNotification = true;
    // Auto-continue after showing notification
    setTimeout(() => {
      onNext();
    }, 3000);
  }

  function handleInterviewComplete() {
    // Persona generator completed and applied
    onNext();
  }

  function handleSurveyComplete() {
    // Quick survey completed
    onNext();
  }

  function handleBackToChoice() {
    choice = 'pending';
  }
</script>

<div class="w-full">
  {#if choice === 'pending'}
    <div class="flex flex-col gap-8">
      <div class="text-center">
        <h2 class="text-3xl font-bold mb-4 text-white dark:text-white">Build Your Personality Profile</h2>
        <p class="text-base leading-relaxed text-white/80 dark:text-white/80 max-w-[600px] mx-auto">
          Choose how you'd like to set up your personality profile. You can complete a deep interview,
          answer a quick survey, or skip and do it later.
        </p>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-4">
        <button class="choice-card choice-card-primary" on:click={handleStartFullInterview}>
          <div class="text-5xl mb-4">🧠</div>
          <h3 class="text-xl font-semibold mb-3 text-white dark:text-white">Full Persona Interview</h3>
          <p class="text-sm leading-relaxed text-white/70 dark:text-white/70 mb-4">
            7-15 adaptive questions using motivational interviewing techniques.
            Takes 15-20 minutes.
          </p>
          <ul class="list-none p-0 mb-6 text-left w-full">
            <li class="text-sm text-white/80 dark:text-white/80 mb-2 pl-2">✓ Therapeutic conversation style</li>
            <li class="text-sm text-white/80 dark:text-white/80 mb-2 pl-2">✓ Analyzes communication patterns</li>
            <li class="text-sm text-white/80 dark:text-white/80 mb-2 pl-2">✓ Extracts Big Five personality traits</li>
            <li class="text-sm text-white/80 dark:text-white/80 mb-2 pl-2">✓ Identifies values, goals, and interests</li>
            <li class="text-sm text-white/80 dark:text-white/80 mb-2 pl-2">✓ Can pause and resume anytime</li>
          </ul>
          <div class="choice-badge choice-badge-best">Most Comprehensive</div>
        </button>

        <button class="choice-card" on:click={handleStartQuickSurvey}>
          <div class="text-5xl mb-4">📝</div>
          <h3 class="text-xl font-semibold mb-3 text-white dark:text-white">Quick Survey</h3>
          <p class="text-sm leading-relaxed text-white/70 dark:text-white/70 mb-4">
            7 simple questions about your personality and preferences.
            Takes about 5 minutes.
          </p>
          <ul class="list-none p-0 mb-6 text-left w-full">
            <li class="text-sm text-white/80 dark:text-white/80 mb-2 pl-2">✓ Fast and straightforward</li>
            <li class="text-sm text-white/80 dark:text-white/80 mb-2 pl-2">✓ Basic personality extraction</li>
            <li class="text-sm text-white/80 dark:text-white/80 mb-2 pl-2">✓ Good starting point</li>
            <li class="text-sm text-white/80 dark:text-white/80 mb-2 pl-2">✓ Can enhance later with full interview</li>
          </ul>
          <div class="choice-badge">Fastest</div>
        </button>

        <button class="choice-card" on:click={handleSkipBoth}>
          <div class="text-5xl mb-4">⏭️</div>
          <h3 class="text-xl font-semibold mb-3 text-white dark:text-white">Skip for Now</h3>
          <p class="text-sm leading-relaxed text-white/70 dark:text-white/70 mb-4">
            Complete the personality interview later from the System menu.
          </p>
          <ul class="list-none p-0 mb-6 text-left w-full">
            <li class="text-sm text-white/80 dark:text-white/80 mb-2 pl-2">• Get started immediately</li>
            <li class="text-sm text-white/80 dark:text-white/80 mb-2 pl-2">• Access from System → Generator</li>
            <li class="text-sm text-white/80 dark:text-white/80 mb-2 pl-2">• All sessions saved and resumable</li>
            <li class="text-sm text-white/80 dark:text-white/80 mb-2 pl-2">• Manually edit persona files anytime</li>
          </ul>
        </button>
      </div>

      <div class="text-center mt-4">
        <button class="bg-transparent border-0 text-white/60 dark:text-white/60 text-sm cursor-pointer px-4 py-2 transition-colors hover:text-white/90" on:click={onBack}>
          ← Back
        </button>
      </div>
    </div>
  {:else if choice === 'full-interview'}
    <PersonaGeneratorEmbed onComplete={handleInterviewComplete} onBack={handleBackToChoice} />
  {:else if choice === 'quick-survey'}
    <Step3Personality
      onNext={handleSurveyComplete}
      onBack={handleBackToChoice}
      onSkip={handleSkipBoth}
    />
  {/if}

  {#if showSkipNotification}
    <div class="skip-notification">
      <div class="flex gap-4 items-start max-w-[400px] p-4 px-6 rounded-xl border border-blue-400/30 bg-slate-900 shadow-xl">
        <div class="text-2xl flex-shrink-0">ℹ️</div>
        <div>
          <strong class="block text-white mb-1 text-[0.9375rem]">Personality interview skipped</strong>
          <p class="m-0 text-sm text-white/70 leading-relaxed">You can complete it anytime from <strong class="text-blue-400">System → Generator</strong></p>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  /* Choice card - interactive selection cards */
  .choice-card {
    @apply bg-white/5 border-2 border-white/10 rounded-xl p-8 cursor-pointer transition-all
           flex flex-col items-center text-center relative w-full;
  }
  .choice-card:hover {
    @apply border-blue-400/50 bg-blue-400/10;
    transform: translateY(-2px);
  }
  .choice-card-primary:hover {
    @apply border-blue-400/80 bg-blue-400/15;
  }

  /* Choice badge */
  .choice-badge {
    @apply absolute top-4 right-4 px-3 py-1 rounded-xl text-xs font-semibold
           bg-blue-400/20 text-blue-400 border border-blue-400/30;
  }
  .choice-badge-best {
    @apply bg-violet-400/20 text-violet-400 border-violet-400/30;
  }

  /* Skip notification - slide in from right */
  .skip-notification {
    @apply fixed top-8 right-8 z-[12000];
    animation: slideInRight 0.3s ease-out;
  }
  @keyframes slideInRight {
    from { transform: translateX(100%); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }
</style>
