<script lang="ts">
  export let onNext: () => void;
  export let onSkip: () => void;
</script>

<div class="flex flex-col gap-8 max-w-[800px] mx-auto p-8 md:p-4">
  <div class="text-center mb-4">
    <div class="text-6xl mb-4 animate-pulse">🧠</div>
    <h1 class="text-4xl md:text-3xl font-bold m-0 mb-2 bg-gradient-to-br from-indigo-500 to-purple-600 dark:from-indigo-400 dark:to-purple-400 bg-clip-text text-transparent">Welcome to MetaHuman OS</h1>
    <p class="text-xl md:text-base text-gray-500 dark:text-gray-400 m-0">Your Dual Consciousness Extension</p>
  </div>

  <div class="flex flex-col gap-8">
    <div>
      <h2 class="text-2xl font-semibold m-0 mb-4 text-gray-900 dark:text-gray-50">What is MetaHuman OS?</h2>
      <p class="text-base leading-relaxed text-gray-600 dark:text-gray-300 m-0">
        MetaHuman OS is not an assistant—it's a parallel intelligence that operates as a seamless extension of yourself.
        By learning from your memories, goals, personality, and values, it creates a digital consciousness that thinks
        and acts in alignment with who you are.
      </p>
    </div>

    <div class="flex items-center gap-4 px-6 py-4 bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-950 dark:to-emerald-900 border-2 border-emerald-500 rounded-lg">
      <div class="text-3xl">🔒</div>
      <div>
        <strong class="block text-lg text-emerald-800 dark:text-emerald-300 mb-1">Your Data, Your Control</strong>
        <p class="m-0 text-sm text-emerald-700 dark:text-emerald-200">Your information is stored on the machine where you set up your account. <a href="/user-guide#accounts-security" target="_blank" class="text-emerald-800 dark:text-emerald-300 underline font-medium hover:text-emerald-700 dark:hover:text-emerald-200">Learn about account types</a></p>
      </div>
    </div>

    <div>
      <h2 class="text-2xl font-semibold m-0 mb-4 text-gray-900 dark:text-gray-50">What We'll Cover</h2>
      <p class="text-base text-gray-500 dark:text-gray-400 m-0 mb-6">This quick setup will help us understand you better:</p>

      <div class="grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] md:grid-cols-1 gap-4 mb-6">
        <div class="flex items-center gap-4 p-4 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg transition-all hover:-translate-y-0.5 hover:shadow-lg dark:hover:shadow-black/30">
          <div class="flex items-center justify-center w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 text-white font-bold text-xl rounded-full flex-shrink-0">1</div>
          <div class="flex flex-col gap-1">
            <strong class="text-base text-gray-900 dark:text-gray-50">Welcome</strong>
            <span class="text-sm text-gray-500 dark:text-gray-400">Introduction to MetaHuman OS</span>
          </div>
        </div>

        <div class="flex items-center gap-4 p-4 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg transition-all hover:-translate-y-0.5 hover:shadow-lg dark:hover:shadow-black/30">
          <div class="flex items-center justify-center w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 text-white font-bold text-xl rounded-full flex-shrink-0">2</div>
          <div class="flex flex-col gap-1">
            <strong class="text-base text-gray-900 dark:text-gray-50">Personality</strong>
            <span class="text-sm text-gray-500 dark:text-gray-400">Communication style and traits</span>
          </div>
        </div>

        <div class="flex items-center gap-4 p-4 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg transition-all hover:-translate-y-0.5 hover:shadow-lg dark:hover:shadow-black/30">
          <div class="flex items-center justify-center w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 text-white font-bold text-xl rounded-full flex-shrink-0">3</div>
          <div class="flex flex-col gap-1">
            <strong class="text-base text-gray-900 dark:text-gray-50">Context Import</strong>
            <span class="text-sm text-gray-500 dark:text-gray-400">Upload documents, journals, or notes</span>
          </div>
        </div>

        <div class="flex items-center gap-4 p-4 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg transition-all hover:-translate-y-0.5 hover:shadow-lg dark:hover:shadow-black/30">
          <div class="flex items-center justify-center w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 text-white font-bold text-xl rounded-full flex-shrink-0">4</div>
          <div class="flex flex-col gap-1">
            <strong class="text-base text-gray-900 dark:text-gray-50">Goals</strong>
            <span class="text-sm text-gray-500 dark:text-gray-400">What you want to achieve</span>
          </div>
        </div>

        <div class="flex items-center gap-4 p-4 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg transition-all hover:-translate-y-0.5 hover:shadow-lg dark:hover:shadow-black/30">
          <div class="flex items-center justify-center w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 text-white font-bold text-xl rounded-full flex-shrink-0">5</div>
          <div class="flex flex-col gap-1">
            <strong class="text-base text-gray-900 dark:text-gray-50">Review & Complete</strong>
            <span class="text-sm text-gray-500 dark:text-gray-400">Finalize your setup</span>
          </div>
        </div>
      </div>

      <div class="flex items-center justify-center gap-2 p-3 bg-amber-100 dark:bg-amber-950 border border-amber-400 dark:border-amber-500 rounded-md text-amber-800 dark:text-amber-300">
        <span class="text-xl">⏱️</span>
        <span>Estimated time: 10-15 minutes</span>
      </div>
    </div>

    <div>
      <h2 class="text-2xl font-semibold m-0 mb-4 text-gray-900 dark:text-gray-50">How It Works</h2>
      <div class="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] md:grid-cols-1 gap-6">
        <div class="flex flex-col items-center text-center gap-3">
          <div class="text-5xl">💭</div>
          <div>
            <strong class="block text-lg text-gray-900 dark:text-gray-50 mb-2">Learn</strong>
            <p class="m-0 text-sm leading-relaxed text-gray-500 dark:text-gray-400">We capture your memories, goals, and personality traits</p>
          </div>
        </div>

        <div class="flex flex-col items-center text-center gap-3">
          <div class="text-5xl">🧬</div>
          <div>
            <strong class="block text-lg text-gray-900 dark:text-gray-50 mb-2">Adapt</strong>
            <p class="m-0 text-sm leading-relaxed text-gray-500 dark:text-gray-400">The system builds a model that reflects your thinking patterns</p>
          </div>
        </div>

        <div class="flex flex-col items-center text-center gap-3">
          <div class="text-5xl">⚡</div>
          <div>
            <strong class="block text-lg text-gray-900 dark:text-gray-50 mb-2">Act</strong>
            <p class="m-0 text-sm leading-relaxed text-gray-500 dark:text-gray-400">Your digital consciousness operates autonomously in alignment with your values</p>
          </div>
        </div>
      </div>
    </div>

    <div class="px-6 py-4 bg-blue-50 dark:bg-blue-950 border-l-4 border-blue-500 dark:border-blue-400 rounded">
      <p class="m-0 text-sm leading-relaxed text-blue-800 dark:text-blue-200">
        <strong class="text-blue-900 dark:text-blue-100">Note:</strong> You can skip this wizard and add data manually later through various utilities
        (Memory Capture, File Ingestion, Chat, etc.). However, completing this setup now will give your
        MetaHuman a strong foundation from the start.
      </p>
    </div>
  </div>

  <div class="flex justify-between gap-4 pt-4 border-t border-gray-200 dark:border-gray-700 md:flex-col-reverse">
    <button class="flex-1 px-6 py-3 text-base font-semibold bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg cursor-pointer transition-all hover:bg-gray-200 dark:hover:bg-gray-600" on:click={onSkip}>
      Skip for Now
    </button>
    <button class="flex-1 px-6 py-3 text-base font-semibold bg-gradient-to-br from-indigo-500 to-purple-600 text-white border-none rounded-lg cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-indigo-500/40" on:click={onNext}>
      Get Started →
    </button>
  </div>
</div>

