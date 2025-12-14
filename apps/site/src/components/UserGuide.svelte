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

<div class="user-guide-container">
  <!-- Chapter Index Sidebar -->
  <aside class="chapter-sidebar">
    <div class="sidebar-header">
      <h2>User Guide</h2>
      <p class="subtitle">MetaHuman OS Manual</p>
    </div>

    <nav class="chapter-nav">
      {#if loading}
        <div class="loading-state">Loading...</div>
      {:else if error}
        <div class="error-state">{error}</div>
      {:else}
        {#each categories as category, categoryIndex}
          <div class="category-section" class:collapsed={collapsedCategories.has(category.id)}>
            <button
              class="category-header"
              on:click={() => toggleCategory(category.id)}
            >
              <span class="category-name">{category.name}</span>
              <span class="category-toggle">{collapsedCategories.has(category.id) ? '>' : 'v'}</span>
            </button>
            <ul class="chapter-list">
              {#each category.chapters as chapter}
                <li class="chapter-item">
                  <button
                    class="chapter-button"
                    class:active={currentChapter?.id === chapter.id}
                    on:click={() => navigateTo(chapter.id)}
                  >
                    <span class="chapter-number">{chapter.number}</span>
                    <span class="chapter-title">{chapter.title}</span>
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
  <main class="chapter-content">
    {#if loading}
      <div class="loading-state">Loading user guide...</div>
    {:else if error}
      <div class="empty-state">
        <h2>User Guide Unavailable</h2>
        <p>{error}</p>
      </div>
    {:else if currentChapter}
      <article class="chapter">
        <div class="chapter-body">
          <div class="markdown-content">
            {@html currentChapter.content}
          </div>
        </div>

        <nav class="chapter-navigation">
          {#if prevChapter}
            <button
              class="nav-button prev-button"
              on:click={() => navigateTo(prevChapter.id)}
            >
              <span class="nav-arrow">←</span>
              <span class="nav-label">
                <span class="nav-direction">Previous</span>
                <span class="nav-title">{prevChapter.title}</span>
              </span>
            </button>
          {/if}

          {#if nextChapter}
            <button
              class="nav-button next-button"
              on:click={() => navigateTo(nextChapter.id)}
            >
              <span class="nav-label">
                <span class="nav-direction">Next</span>
                <span class="nav-title">{nextChapter.title}</span>
              </span>
              <span class="nav-arrow">→</span>
            </button>
          {/if}
        </nav>
      </article>
    {:else}
      <div class="empty-state">
        <h2>Select a Chapter</h2>
        <p>Choose a chapter from the sidebar to begin reading.</p>
      </div>
    {/if}
  </main>
</div>

<style>
  .user-guide-container {
    display: flex;
    height: 100vh;
    background: white;
    color: rgb(17 24 39);
  }

  :global(.dark) .user-guide-container {
    background: rgb(3 7 18);
    color: rgb(243 244 246);
  }

  /* Chapter Sidebar */
  .chapter-sidebar {
    width: 280px;
    border-right: 1px solid rgb(229 231 235);
    display: flex;
    flex-direction: column;
    background: rgb(249 250 251);
    flex-shrink: 0;
  }

  :global(.dark) .chapter-sidebar {
    border-right-color: rgb(31 41 55);
    background: rgb(17 24 39);
  }

  .sidebar-header {
    padding: 2rem 1.5rem 1.5rem;
    border-bottom: 1px solid rgb(229 231 235);
  }

  :global(.dark) .sidebar-header {
    border-bottom-color: rgb(31 41 55);
  }

  .sidebar-header h2 {
    font-size: 1.5rem;
    font-weight: 700;
    margin: 0 0 0.5rem 0;
    color: rgb(17 24 39);
  }

  :global(.dark) .sidebar-header h2 {
    color: rgb(243 244 246);
  }

  .subtitle {
    font-size: 0.875rem;
    color: rgb(107 114 128);
    margin: 0;
  }

  :global(.dark) .subtitle {
    color: rgb(156 163 175);
  }

  .chapter-nav {
    flex: 1;
    overflow-y: auto;
    padding: 0.5rem 0;
  }

  .loading-state,
  .error-state {
    padding: 1rem 1.5rem;
    color: rgb(107 114 128);
  }

  /* Category Sections */
  .category-section {
    margin: 0;
  }

  .category-header {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.625rem 1.5rem;
    border: none;
    background: rgb(243 244 246);
    color: rgb(17 24 39);
    font-weight: 700;
    font-size: 0.8125rem;
    text-align: left;
    cursor: pointer;
    transition: all 0.2s;
    text-transform: uppercase;
    letter-spacing: 0.025em;
  }

  :global(.dark) .category-header {
    background: rgb(31 41 55);
    color: rgb(209 213 219);
  }

  .category-header:hover {
    background: rgb(229 231 235);
  }

  :global(.dark) .category-header:hover {
    background: rgb(55 65 81);
  }

  .category-name {
    flex: 1;
  }

  .category-toggle {
    font-size: 0.75rem;
    color: rgb(107 114 128);
    transition: transform 0.2s;
  }

  :global(.dark) .category-toggle {
    color: rgb(156 163 175);
  }

  .chapter-list {
    list-style: none;
    padding: 0;
    margin: 0;
    max-height: 1000px;
    overflow: hidden;
    transition: max-height 0.3s ease-in-out, opacity 0.2s;
    opacity: 1;
  }

  .category-section.collapsed .chapter-list {
    max-height: 0;
    opacity: 0;
  }

  .chapter-item {
    margin: 0;
  }

  .chapter-button {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 1.5rem;
    border: none;
    background: transparent;
    color: rgb(75 85 99);
    text-align: left;
    cursor: pointer;
    transition: all 0.2s;
    font-size: 0.9375rem;
  }

  :global(.dark) .chapter-button {
    color: rgb(156 163 175);
  }

  .chapter-button:hover {
    background: rgb(243 244 246);
    color: rgb(17 24 39);
  }

  :global(.dark) .chapter-button:hover {
    background: rgb(31 41 55);
    color: rgb(243 244 246);
  }

  .chapter-button.active {
    background: rgb(239 246 255);
    color: rgb(37 99 235);
    font-weight: 600;
  }

  :global(.dark) .chapter-button.active {
    background: rgb(30 58 138);
    color: rgb(147 197 253);
  }

  .chapter-number {
    font-weight: 700;
    font-size: 0.875rem;
    min-width: 1.5rem;
    color: rgb(107 114 128);
  }

  :global(.dark) .chapter-number {
    color: rgb(156 163 175);
  }

  .chapter-button.active .chapter-number {
    color: rgb(37 99 235);
  }

  :global(.dark) .chapter-button.active .chapter-number {
    color: rgb(147 197 253);
  }

  .chapter-title {
    flex: 1;
  }

  /* Chapter Content */
  .chapter-content {
    flex: 1;
    overflow-y: auto;
    background: white;
  }

  :global(.dark) .chapter-content {
    background: rgb(3 7 18);
  }

  .chapter {
    max-width: 800px;
    margin: 0 auto;
    padding: 3rem 2rem;
  }

  .chapter-body {
    min-height: calc(100vh - 12rem);
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: 2rem;
    text-align: center;
  }

  .empty-state h2 {
    font-size: 1.5rem;
    margin-bottom: 0.5rem;
    color: rgb(17 24 39);
  }

  :global(.dark) .empty-state h2 {
    color: rgb(243 244 246);
  }

  .empty-state p {
    color: rgb(107 114 128);
  }

  :global(.dark) .empty-state p {
    color: rgb(156 163 175);
  }

  /* Chapter Navigation (Prev/Next) */
  .chapter-navigation {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    margin-top: 3rem;
    padding-top: 2rem;
    border-top: 1px solid rgb(229 231 235);
  }

  :global(.dark) .chapter-navigation {
    border-top-color: rgb(31 41 55);
  }

  .nav-button {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 1rem 1.25rem;
    border: 1px solid rgb(229 231 235);
    border-radius: 0.5rem;
    background: white;
    color: rgb(17 24 39);
    cursor: pointer;
    transition: all 0.2s;
    font-size: 0.9375rem;
    max-width: 45%;
  }

  :global(.dark) .nav-button {
    border-color: rgb(31 41 55);
    background: rgb(17 24 39);
    color: rgb(243 244 246);
  }

  .nav-button:hover {
    border-color: rgb(37 99 235);
    background: rgb(239 246 255);
    transform: translateY(-1px);
  }

  :global(.dark) .nav-button:hover {
    border-color: rgb(59 130 246);
    background: rgb(30 58 138);
  }

  .next-button {
    margin-left: auto;
  }

  .nav-arrow {
    font-size: 1.25rem;
    font-weight: 600;
    color: rgb(37 99 235);
  }

  :global(.dark) .nav-arrow {
    color: rgb(147 197 253);
  }

  .nav-label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .nav-direction {
    font-size: 0.75rem;
    text-transform: uppercase;
    font-weight: 600;
    color: rgb(107 114 128);
    letter-spacing: 0.05em;
  }

  :global(.dark) .nav-direction {
    color: rgb(156 163 175);
  }

  .nav-title {
    font-weight: 500;
  }

  /* Markdown Content Styling */
  .markdown-content {
    line-height: 1.75;
  }

  .markdown-content :global(h1) {
    font-size: 2.25rem;
    font-weight: 800;
    margin: 0 0 1.5rem 0;
    color: rgb(17 24 39);
    line-height: 1.2;
  }

  :global(.dark) .markdown-content :global(h1) {
    color: rgb(243 244 246);
  }

  .markdown-content :global(h2) {
    font-size: 1.875rem;
    font-weight: 700;
    margin: 2.5rem 0 1rem 0;
    color: rgb(17 24 39);
    line-height: 1.3;
  }

  :global(.dark) .markdown-content :global(h2) {
    color: rgb(243 244 246);
  }

  .markdown-content :global(h3) {
    font-size: 1.5rem;
    font-weight: 600;
    margin: 2rem 0 0.75rem 0;
    color: rgb(17 24 39);
    line-height: 1.4;
  }

  :global(.dark) .markdown-content :global(h3) {
    color: rgb(243 244 246);
  }

  .markdown-content :global(h4) {
    font-size: 1.25rem;
    font-weight: 600;
    margin: 1.5rem 0 0.75rem 0;
    color: rgb(55 65 81);
    line-height: 1.5;
  }

  :global(.dark) .markdown-content :global(h4) {
    color: rgb(209 213 219);
  }

  .markdown-content :global(p) {
    margin-bottom: 1.25rem;
    color: rgb(55 65 81);
  }

  :global(.dark) .markdown-content :global(p) {
    color: rgb(209 213 219);
  }

  .markdown-content :global(strong) {
    font-weight: 600;
    color: rgb(17 24 39);
  }

  :global(.dark) .markdown-content :global(strong) {
    color: rgb(243 244 246);
  }

  .markdown-content :global(code) {
    background: rgb(243 244 246);
    padding: 0.2rem 0.4rem;
    border-radius: 0.25rem;
    font-family: 'Monaco', 'Courier New', monospace;
    font-size: 0.875em;
    color: rgb(220 38 38);
    font-weight: 500;
  }

  :global(.dark) .markdown-content :global(code) {
    background: rgb(31 41 55);
    color: rgb(252 165 165);
  }

  .markdown-content :global(pre) {
    background: rgb(31 41 55);
    padding: 1.25rem;
    border-radius: 0.5rem;
    overflow-x: auto;
    margin: 1.5rem 0;
    border: 1px solid rgb(55 65 81);
  }

  :global(.dark) .markdown-content :global(pre) {
    background: rgb(17 24 39);
    border-color: rgb(31 41 55);
  }

  .markdown-content :global(pre code) {
    background: none;
    padding: 0;
    color: rgb(229 231 235);
    font-size: 0.875rem;
    line-height: 1.7;
  }

  .markdown-content :global(ul),
  .markdown-content :global(ol) {
    margin-bottom: 1.25rem;
    padding-left: 1.75rem;
    color: rgb(55 65 81);
  }

  :global(.dark) .markdown-content :global(ul),
  :global(.dark) .markdown-content :global(ol) {
    color: rgb(209 213 219);
  }

  .markdown-content :global(li) {
    margin-bottom: 0.5rem;
    line-height: 1.75;
  }

  .markdown-content :global(li > p) {
    margin-bottom: 0.5rem;
  }

  .markdown-content :global(a) {
    color: rgb(37 99 235);
    text-decoration: none;
    font-weight: 500;
  }

  :global(.dark) .markdown-content :global(a) {
    color: rgb(96 165 250);
  }

  .markdown-content :global(a:hover) {
    text-decoration: underline;
  }

  .markdown-content :global(blockquote) {
    border-left: 4px solid rgb(37 99 235);
    padding-left: 1.25rem;
    margin: 1.5rem 0;
    color: rgb(75 85 99);
    font-style: italic;
  }

  :global(.dark) .markdown-content :global(blockquote) {
    border-left-color: rgb(59 130 246);
    color: rgb(156 163 175);
  }

  .markdown-content :global(table) {
    width: 100%;
    border-collapse: collapse;
    margin: 1.5rem 0;
    font-size: 0.9375rem;
  }

  .markdown-content :global(th),
  .markdown-content :global(td) {
    padding: 0.75rem;
    text-align: left;
    border-bottom: 1px solid rgb(229 231 235);
  }

  :global(.dark) .markdown-content :global(th),
  :global(.dark) .markdown-content :global(td) {
    border-bottom-color: rgb(31 41 55);
  }

  .markdown-content :global(th) {
    font-weight: 600;
    color: rgb(17 24 39);
    background: rgb(249 250 251);
  }

  :global(.dark) .markdown-content :global(th) {
    color: rgb(243 244 246);
    background: rgb(17 24 39);
  }

  .markdown-content :global(td) {
    color: rgb(55 65 81);
  }

  :global(.dark) .markdown-content :global(td) {
    color: rgb(209 213 219);
  }

  .markdown-content :global(hr) {
    border: none;
    border-top: 1px solid rgb(229 231 235);
    margin: 2rem 0;
  }

  :global(.dark) .markdown-content :global(hr) {
    border-top-color: rgb(31 41 55);
  }
</style>
