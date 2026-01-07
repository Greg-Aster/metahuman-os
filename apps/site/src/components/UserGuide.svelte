<script lang="ts">
  import { onMount } from 'svelte';

  interface Chapter {
    id: string;
    title: string;
    content?: string;
    number: string;
    category: string;
    path: string;
  }

  interface Category {
    id: string;
    name: string;
    chapters: Chapter[];
    order: number;
  }

  let categories: Category[] = [];
  let chapters: Chapter[] = [];
  let currentChapter: Chapter | null = null;
  let prevChapter: { id: string; title: string } | null = null;
  let nextChapter: { id: string; title: string } | null = null;
  let loading = true;
  let error = '';
  let collapsedCategories: Set<string> = new Set();

  // Load chapter list on mount
  onMount(async () => {
    try {
      const response = await fetch('/api/user-guide');
      if (!response.ok) throw new Error('Failed to load user guide');

      const data = await response.json();
      categories = data.categories || [];

      // Flatten chapters for navigation
      chapters = categories.flatMap(c => c.chapters);

      // Load first chapter by default or from hash
      const hash = window.location.hash.substring(1);
      const initialChapterId = hash || (chapters[0]?.id);

      if (initialChapterId) {
        await loadChapter(initialChapterId);
      }

      loading = false;
    } catch (e) {
      error = (e as Error).message;
      loading = false;
    }

    // Listen for hash changes
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  });

  function handleHashChange() {
    const hash = window.location.hash.substring(1);
    if (hash && hash !== currentChapter?.id) {
      loadChapter(hash);
    }
  }

  async function loadChapter(chapterId: string) {
    try {
      const response = await fetch(`/api/user-guide/${encodeURIComponent(chapterId)}`);
      if (!response.ok) throw new Error('Chapter not found');

      const data = await response.json();
      currentChapter = data.chapter;
      prevChapter = data.prev;
      nextChapter = data.next;

      // Update URL hash without triggering hashchange
      history.replaceState(null, '', `#${chapterId}`);

      // Scroll content to top
      const contentArea = document.querySelector('.chapter-content');
      if (contentArea) contentArea.scrollTop = 0;
    } catch (e) {
      console.error('Failed to load chapter:', e);
    }
  }

  function toggleCategory(categoryId: string) {
    if (collapsedCategories.has(categoryId)) {
      collapsedCategories.delete(categoryId);
    } else {
      collapsedCategories.add(categoryId);
    }
    collapsedCategories = collapsedCategories; // Trigger reactivity
  }

  function navigateTo(chapterId: string) {
    loadChapter(chapterId);
  }
</script>

<div class="flex h-screen bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100">
  <!-- Chapter Index Sidebar -->
  <aside class="w-[280px] border-r border-gray-200 dark:border-gray-800 flex flex-col bg-gray-50 dark:bg-gray-900 shrink-0">
    <div class="p-6 pb-4 border-b border-gray-200 dark:border-gray-800">
      <h2 class="text-2xl font-bold mb-2 text-gray-900 dark:text-gray-100">User Guide</h2>
      <p class="text-sm text-gray-500 dark:text-gray-400 m-0">MetaHuman OS Manual</p>
    </div>

    <nav class="flex-1 overflow-y-auto py-2">
      {#if loading}
        <div class="px-6 py-4 text-gray-500">Loading...</div>
      {:else if error}
        <div class="px-6 py-4 text-red-500">{error}</div>
      {:else}
        {#each categories as category}
          <div class="category-section" class:collapsed={collapsedCategories.has(category.id)}>
            <button
              class="w-full flex items-center justify-between px-6 py-2.5 border-0 bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-200 font-bold text-[0.8125rem] text-left cursor-pointer transition-colors uppercase tracking-wide hover:bg-gray-200 dark:hover:bg-gray-700"
              on:click={() => toggleCategory(category.id)}
            >
              <span class="flex-1">{category.name}</span>
              <span class="text-xs text-gray-500 dark:text-gray-400">{collapsedCategories.has(category.id) ? '>' : 'v'}</span>
            </button>
            <ul class="list-none p-0 m-0 chapter-list">
              {#each category.chapters as chapter}
                <li>
                  <button
                    class="w-full flex items-center gap-3 px-6 py-3 border-0 bg-transparent text-gray-600 dark:text-gray-400 text-left cursor-pointer transition-colors text-[0.9375rem] hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-100
                           {currentChapter?.id === chapter.id ? 'bg-blue-50 dark:bg-blue-900 text-blue-600 dark:text-blue-300 font-semibold' : ''}"
                    on:click={() => navigateTo(chapter.id)}
                  >
                    <span class="font-bold text-sm min-w-[1.5rem] {currentChapter?.id === chapter.id ? 'text-blue-600 dark:text-blue-300' : 'text-gray-500 dark:text-gray-400'}">{chapter.number}</span>
                    <span class="flex-1">{chapter.title}</span>
                  </button>
                </li>
              {/each}
            </ul>
          </div>
        {/each}
      {/if}
    </nav>
  </aside>

  <!-- Chapter Content -->
  <main class="chapter-content flex-1 overflow-y-auto bg-white dark:bg-gray-950">
    {#if loading}
      <div class="p-8 text-gray-500">Loading user guide...</div>
    {:else if error}
      <div class="flex flex-col items-center justify-center h-full p-8 text-center">
        <h2 class="text-2xl mb-2 text-gray-900 dark:text-gray-100">User Guide Unavailable</h2>
        <p class="text-gray-500 dark:text-gray-400">{error}</p>
      </div>
    {:else if currentChapter}
      <article class="max-w-[800px] mx-auto py-12 px-8">
        <div class="min-h-[calc(100vh-12rem)]">
          <div class="prose-content">
            {@html currentChapter.content}
          </div>
        </div>

        <nav class="flex justify-between gap-4 mt-12 pt-8 border-t border-gray-200 dark:border-gray-800">
          {#if prevChapter}
            <button
              class="flex items-center gap-3 px-5 py-4 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 cursor-pointer transition-all text-[0.9375rem] max-w-[45%] hover:border-blue-600 dark:hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/50 hover:-translate-y-0.5"
              on:click={() => navigateTo(prevChapter.id)}
            >
              <span class="text-xl font-semibold text-blue-600 dark:text-blue-400">←</span>
              <span class="flex flex-col gap-1">
                <span class="text-xs uppercase font-semibold text-gray-500 dark:text-gray-400 tracking-wide">Previous</span>
                <span class="font-medium">{prevChapter.title}</span>
              </span>
            </button>
          {/if}

          {#if nextChapter}
            <button
              class="flex items-center gap-3 px-5 py-4 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 cursor-pointer transition-all text-[0.9375rem] max-w-[45%] ml-auto hover:border-blue-600 dark:hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/50 hover:-translate-y-0.5"
              on:click={() => navigateTo(nextChapter.id)}
            >
              <span class="flex flex-col gap-1">
                <span class="text-xs uppercase font-semibold text-gray-500 dark:text-gray-400 tracking-wide">Next</span>
                <span class="font-medium">{nextChapter.title}</span>
              </span>
              <span class="text-xl font-semibold text-blue-600 dark:text-blue-400">→</span>
            </button>
          {/if}
        </nav>
      </article>
    {:else}
      <div class="flex flex-col items-center justify-center h-full p-8 text-center">
        <h2 class="text-2xl mb-2 text-gray-900 dark:text-gray-100">Select a Chapter</h2>
        <p class="text-gray-500 dark:text-gray-400">Choose a chapter from the sidebar to begin reading.</p>
      </div>
    {/if}
  </main>
</div>

<style>
  /* Collapsible chapter list animation */
  .chapter-list {
    max-height: 1000px;
    overflow: hidden;
    transition: max-height 0.3s ease-in-out, opacity 0.2s;
    opacity: 1;
  }

  .category-section.collapsed .chapter-list {
    max-height: 0;
    opacity: 0;
  }
</style>
