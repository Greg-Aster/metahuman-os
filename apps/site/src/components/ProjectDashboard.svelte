<script lang="ts">
  import { onMount } from 'svelte';
  import { apiFetch } from '../lib/client/api-config';

  // Types
  interface Project {
    id: string;
    title: string;
    description?: string;
    status: 'active' | 'paused' | 'completed' | 'archived';
    priority?: string;
    targetDate?: string;
    tags?: string[];
    progress?: number;
    created: string;
    updated: string;
  }

  interface Task {
    id: string;
    title: string;
    status: string;
    priority?: string;
    projectId?: string;
    dependencies?: string[];
  }

  interface TaskSuggestion {
    id: string;
    title: string;
    description: string;
    priority: string;
    confidence: number;
    status: 'pending' | 'approved' | 'rejected' | 'created';
    sourceContent: string;
    projectSuggestion?: string;
  }

  // State
  let projects: Project[] = [];
  let actionableTasks: Task[] = [];
  let blockedTasks: Task[] = [];
  let suggestions: TaskSuggestion[] = [];
  let loading = true;
  let error = '';
  let activeTab: 'projects' | 'actionable' | 'blocked' | 'suggestions' = 'projects';
  let searchQuery = '';
  let showCreateModal = false;
  let selectedProject: Project | null = null;
  let projectTasks: Task[] = [];

  // New project form
  let newProject = {
    title: '',
    description: '',
    priority: 'P2',
    targetDate: '',
  };

  // Load data
  async function loadProjects() {
    try {
      const res = await apiFetch('/api/projects');
      if (!res.ok) throw new Error('Failed to load projects');
      const data = await res.json();
      projects = data.projects || [];
    } catch (e) {
      error = (e as Error).message;
    }
  }

  async function loadActionableTasks() {
    try {
      const res = await apiFetch('/api/tasks/actionable');
      if (!res.ok) return;
      const data = await res.json();
      actionableTasks = data.tasks || [];
    } catch (e) {
      console.warn('Failed to load actionable tasks:', e);
    }
  }

  async function loadBlockedTasks() {
    try {
      const res = await apiFetch('/api/tasks/blocked');
      if (!res.ok) return;
      const data = await res.json();
      blockedTasks = data.tasks || [];
    } catch (e) {
      console.warn('Failed to load blocked tasks:', e);
    }
  }

  async function loadSuggestions() {
    try {
      const res = await apiFetch('/api/task-suggestions?status=pending');
      if (!res.ok) return;
      const data = await res.json();
      suggestions = data.suggestions || [];
    } catch (e) {
      console.warn('Failed to load suggestions:', e);
    }
  }

  async function loadAll() {
    loading = true;
    error = '';
    await Promise.all([
      loadProjects(),
      loadActionableTasks(),
      loadBlockedTasks(),
      loadSuggestions(),
    ]);
    loading = false;
  }

  onMount(() => {
    loadAll();
    const interval = setInterval(loadAll, 30000);
    return () => clearInterval(interval);
  });

  // Actions
  async function createProject() {
    if (!newProject.title.trim()) return;

    try {
      const res = await apiFetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newProject),
      });

      if (!res.ok) throw new Error('Failed to create project');

      showCreateModal = false;
      newProject = { title: '', description: '', priority: 'P2', targetDate: '' };
      await loadProjects();
    } catch (e) {
      error = (e as Error).message;
    }
  }

  async function selectProject(project: Project) {
    selectedProject = project;
    try {
      const res = await apiFetch(`/api/projects/${project.id}`);
      if (!res.ok) throw new Error('Failed to load project');
      const data = await res.json();
      projectTasks = data.tasks || [];
    } catch (e) {
      console.warn('Failed to load project tasks:', e);
      projectTasks = [];
    }
  }

  async function approveSuggestion(id: string) {
    try {
      const res = await apiFetch(`/api/task-suggestions/${id}/approve`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('Failed to approve');
      await loadSuggestions();
      await loadActionableTasks();
    } catch (e) {
      error = (e as Error).message;
    }
  }

  async function rejectSuggestion(id: string) {
    try {
      const res = await apiFetch(`/api/task-suggestions/${id}/reject`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('Failed to reject');
      await loadSuggestions();
    } catch (e) {
      error = (e as Error).message;
    }
  }

  async function extractSuggestions() {
    try {
      const res = await apiFetch('/api/task-suggestions/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxReflections: 20, minConfidence: 0.5 }),
      });
      if (!res.ok) throw new Error('Failed to extract');
      await loadSuggestions();
    } catch (e) {
      error = (e as Error).message;
    }
  }

  // Helpers
  function getPriorityColor(priority?: string): string {
    switch (priority) {
      case 'P0': return 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300';
      case 'P1': return 'bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-300';
      case 'P2': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300';
      case 'P3': return 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300';
      default: return 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300';
    }
  }

  function getStatusColor(status: string): string {
    switch (status) {
      case 'active': return 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300';
      case 'paused': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-300';
      case 'completed': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300';
      case 'todo': return 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300';
      case 'in_progress': return 'bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300';
      case 'blocked': return 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300';
      default: return 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300';
    }
  }

  function getConfidenceColor(confidence: number): string {
    if (confidence >= 0.8) return 'text-green-600 dark:text-green-400';
    if (confidence >= 0.6) return 'text-yellow-600 dark:text-yellow-400';
    return 'text-gray-500 dark:text-gray-400';
  }

  $: filteredProjects = projects.filter(p =>
    !searchQuery || p.title.toLowerCase().includes(searchQuery.toLowerCase())
  );
</script>

<div class="p-6 max-w-[1400px] mx-auto">
  <!-- Header -->
  <div class="flex justify-between items-start mb-6">
    <div>
      <h2 class="text-2xl font-bold text-gray-800 dark:text-gray-100">Projects & Tasks</h2>
      <p class="text-gray-500 dark:text-gray-400 text-sm mt-1">Manage projects, dependencies, and task suggestions</p>
    </div>
    <div>
      <button class="btn-primary" on:click={() => showCreateModal = true}>
        + New Project
      </button>
    </div>
  </div>

  <!-- Stats Row -->
  <div class="grid grid-cols-4 max-md:grid-cols-2 gap-4 mb-6">
    <div class="panel text-center">
      <div class="text-3xl font-bold text-blue-500">{projects.filter(p => p.status === 'active').length}</div>
      <div class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Active Projects</div>
    </div>
    <div class="panel text-center">
      <div class="text-3xl font-bold text-blue-500">{actionableTasks.length}</div>
      <div class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Actionable Tasks</div>
    </div>
    <div class="panel text-center">
      <div class="text-3xl font-bold text-blue-500">{blockedTasks.length}</div>
      <div class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Blocked Tasks</div>
    </div>
    <div class="panel text-center">
      <div class="text-3xl font-bold text-blue-500">{suggestions.length}</div>
      <div class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Pending Suggestions</div>
    </div>
  </div>

  <!-- Error display -->
  {#if error}
    <div class="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 px-4 py-3 rounded-md flex justify-between items-center mb-4">
      {error}
      <button class="bg-transparent border-none text-inherit cursor-pointer font-medium" on:click={() => error = ''}>Dismiss</button>
    </div>
  {/if}

  <!-- Tab Navigation -->
  <div class="flex gap-1 border-b border-gray-200 dark:border-gray-700 mb-4">
    <button
      class="px-4 py-3 bg-transparent border-none text-gray-500 dark:text-gray-400 text-sm cursor-pointer border-b-2 border-transparent transition-colors hover:text-blue-500 {activeTab === 'projects' ? '!text-blue-500 dark:!text-blue-400 !border-blue-500 dark:!border-blue-400' : ''}"
      on:click={() => activeTab = 'projects'}
    >
      Projects ({projects.length})
    </button>
    <button
      class="px-4 py-3 bg-transparent border-none text-gray-500 dark:text-gray-400 text-sm cursor-pointer border-b-2 border-transparent transition-colors hover:text-blue-500 {activeTab === 'actionable' ? '!text-blue-500 dark:!text-blue-400 !border-blue-500 dark:!border-blue-400' : ''}"
      on:click={() => activeTab = 'actionable'}
    >
      Actionable ({actionableTasks.length})
    </button>
    <button
      class="px-4 py-3 bg-transparent border-none text-gray-500 dark:text-gray-400 text-sm cursor-pointer border-b-2 border-transparent transition-colors hover:text-blue-500 {activeTab === 'blocked' ? '!text-blue-500 dark:!text-blue-400 !border-blue-500 dark:!border-blue-400' : ''}"
      on:click={() => activeTab = 'blocked'}
    >
      Blocked ({blockedTasks.length})
    </button>
    <button
      class="px-4 py-3 bg-transparent border-none text-gray-500 dark:text-gray-400 text-sm cursor-pointer border-b-2 border-transparent transition-colors hover:text-blue-500 {activeTab === 'suggestions' ? '!text-blue-500 dark:!text-blue-400 !border-blue-500 dark:!border-blue-400' : ''}"
      on:click={() => activeTab = 'suggestions'}
    >
      Suggestions ({suggestions.length})
    </button>
  </div>

  <!-- Content -->
  <div>
    {#if loading}
      <div class="text-center py-12 text-gray-500">
        <div class="w-8 h-8 border-3 border-gray-200 border-t-blue-500 rounded-full animate-spin mx-auto mb-4"></div>
        <p>Loading...</p>
      </div>
    {:else if activeTab === 'projects'}
      <!-- Projects Tab -->
      <div class="mb-4">
        <input
          type="text"
          bind:value={searchQuery}
          placeholder="Search projects..."
          class="input-field"
        />
      </div>

      {#if filteredProjects.length === 0}
        <div class="text-center py-12 text-gray-500">
          <div class="text-5xl mb-4">📁</div>
          <div class="text-xl font-semibold text-gray-600 dark:text-gray-300 mb-2">No projects yet</div>
          <div class="text-sm">Create your first project to organize related tasks</div>
        </div>
      {:else}
        <div class="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
          {#each filteredProjects as project}
            <div
              class="panel cursor-pointer transition-all hover:border-blue-500 hover:shadow-lg hover:shadow-blue-500/15 dark:hover:border-blue-400"
              on:click={() => selectProject(project)}
              on:keypress={() => selectProject(project)}
            >
              <div class="flex justify-between items-start mb-2">
                <h3 class="text-base font-semibold text-gray-800 dark:text-gray-100">{project.title}</h3>
                <span class="inline-block px-2 py-0.5 rounded-full text-xs font-medium {getStatusColor(project.status)}">{project.status}</span>
              </div>
              {#if project.description}
                <p class="text-sm text-gray-500 dark:text-gray-400 mb-3 leading-relaxed">{project.description}</p>
              {/if}
              <div class="flex items-center gap-2 mb-2">
                <span class="inline-block px-2 py-0.5 rounded-full text-xs font-medium {getPriorityColor(project.priority)}">{project.priority || 'P2'}</span>
                {#if project.progress !== undefined}
                  <div class="flex-1 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-sm overflow-hidden">
                    <div class="h-full bg-blue-500 rounded-sm transition-all" style="width: {project.progress}%"></div>
                  </div>
                  <span class="text-xs text-gray-500 min-w-[36px]">{project.progress}%</span>
                {/if}
              </div>
              {#if project.tags?.length}
                <div class="flex flex-wrap gap-1">
                  {#each project.tags.slice(0, 3) as tag}
                    <span class="text-[0.7rem] px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded">{tag}</span>
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}

    {:else if activeTab === 'actionable'}
      <!-- Actionable Tasks Tab -->
      {#if actionableTasks.length === 0}
        <div class="text-center py-12 text-gray-500">
          <div class="text-5xl mb-4">✅</div>
          <div class="text-xl font-semibold text-gray-600 dark:text-gray-300 mb-2">No actionable tasks</div>
          <div class="text-sm">All tasks have blocking dependencies or are completed</div>
        </div>
      {:else}
        <div class="flex flex-col gap-3">
          {#each actionableTasks as task}
            <div class="panel">
              <div class="flex justify-between items-start mb-2">
                <h4 class="font-semibold text-gray-800 dark:text-gray-100">{task.title}</h4>
                <span class="inline-block px-2 py-0.5 rounded-full text-xs font-medium {getPriorityColor(task.priority)}">{task.priority || 'P2'}</span>
              </div>
              <div class="flex gap-2 items-center">
                <span class="inline-block px-2 py-0.5 rounded-full text-xs font-medium {getStatusColor(task.status)}">{task.status}</span>
                {#if task.projectId}
                  <span class="text-blue-500 text-xs">in project</span>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}

    {:else if activeTab === 'blocked'}
      <!-- Blocked Tasks Tab -->
      {#if blockedTasks.length === 0}
        <div class="text-center py-12 text-gray-500">
          <div class="text-5xl mb-4">🔓</div>
          <div class="text-xl font-semibold text-gray-600 dark:text-gray-300 mb-2">No blocked tasks</div>
          <div class="text-sm">All task dependencies are resolved</div>
        </div>
      {:else}
        <div class="flex flex-col gap-3">
          {#each blockedTasks as task}
            <div class="panel border-l-[3px] !border-l-red-500">
              <div class="flex justify-between items-start mb-2">
                <h4 class="font-semibold text-gray-800 dark:text-gray-100">{task.title}</h4>
                <span class="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300">blocked</span>
              </div>
              {#if task.dependencies?.length}
                <div class="text-xs text-red-500 mt-2">
                  Blocked by {task.dependencies.length} task{task.dependencies.length > 1 ? 's' : ''}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}

    {:else if activeTab === 'suggestions'}
      <!-- Task Suggestions Tab -->
      <div class="flex justify-between items-center mb-4">
        <p class="text-gray-500 dark:text-gray-400 text-sm">Tasks extracted from your reflections and inner dialogues</p>
        <button class="btn-secondary" on:click={extractSuggestions}>
          Extract from Reflections
        </button>
      </div>

      {#if suggestions.length === 0}
        <div class="text-center py-12 text-gray-500">
          <div class="text-5xl mb-4">💡</div>
          <div class="text-xl font-semibold text-gray-600 dark:text-gray-300 mb-2">No pending suggestions</div>
          <div class="text-sm">Click "Extract from Reflections" to find actionable tasks</div>
        </div>
      {:else}
        <div class="flex flex-col gap-3">
          {#each suggestions as suggestion}
            <div class="panel">
              <div class="flex justify-between items-start mb-2">
                <h4 class="font-semibold text-gray-800 dark:text-gray-100">{suggestion.title}</h4>
                <span class="text-xs font-medium {getConfidenceColor(suggestion.confidence)}">
                  {Math.round(suggestion.confidence * 100)}% confidence
                </span>
              </div>
              <p class="text-sm text-gray-600 dark:text-gray-300 mb-3">{suggestion.description}</p>
              <div class="flex gap-2 items-center mb-3">
                <span class="inline-block px-2 py-0.5 rounded-full text-xs font-medium {getPriorityColor(suggestion.priority)}">{suggestion.priority}</span>
                {#if suggestion.projectSuggestion}
                  <span class="text-xs text-blue-500">Suggested project: {suggestion.projectSuggestion}</span>
                {/if}
              </div>
              <div class="bg-gray-50 dark:bg-gray-900 rounded-md p-3 mb-3">
                <span class="text-[0.625rem] uppercase text-gray-500 tracking-wide">From reflection:</span>
                <p class="text-xs text-gray-600 dark:text-gray-400 italic mt-1">{suggestion.sourceContent.substring(0, 150)}...</p>
              </div>
              <div class="flex gap-2">
                <button class="btn-success" on:click={() => approveSuggestion(suggestion.id)}>
                  Approve
                </button>
                <button class="btn-danger" on:click={() => rejectSuggestion(suggestion.id)}>
                  Reject
                </button>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    {/if}
  </div>

  <!-- Project Detail Modal -->
  {#if selectedProject}
    <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-[1000]" on:click={() => selectedProject = null} on:keypress={() => selectedProject = null}>
      <div class="bg-white dark:bg-gray-800 rounded-xl w-[90%] max-w-[560px] max-h-[90vh] overflow-auto" on:click|stopPropagation on:keypress|stopPropagation>
        <div class="flex justify-between items-center px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h3 class="text-xl font-semibold text-gray-800 dark:text-gray-100">{selectedProject.title}</h3>
          <button class="bg-transparent border-none text-2xl cursor-pointer text-gray-500 hover:text-gray-800 dark:hover:text-gray-100 leading-none" on:click={() => selectedProject = null}>×</button>
        </div>
        <div class="p-6">
          {#if selectedProject.description}
            <p class="text-gray-600 dark:text-gray-300 mb-4">{selectedProject.description}</p>
          {/if}
          <div class="flex gap-2 items-center my-4">
            <span class="inline-block px-2 py-0.5 rounded-full text-xs font-medium {getStatusColor(selectedProject.status)}">{selectedProject.status}</span>
            <span class="inline-block px-2 py-0.5 rounded-full text-xs font-medium {getPriorityColor(selectedProject.priority)}">{selectedProject.priority}</span>
            {#if selectedProject.progress !== undefined}
              <span class="text-sm text-gray-600 dark:text-gray-300">{selectedProject.progress}% complete</span>
            {/if}
          </div>
          <h4 class="font-semibold text-gray-800 dark:text-gray-100 mb-2">Tasks ({projectTasks.length})</h4>
          {#if projectTasks.length === 0}
            <p class="text-gray-500 text-sm">No tasks in this project yet</p>
          {:else}
            <div class="flex flex-col gap-2 mt-2">
              {#each projectTasks as task}
                <div class="flex items-center gap-2 p-2 bg-gray-50 dark:bg-gray-900 rounded-md">
                  <span class="w-2 h-2 rounded-full {task.status === 'done' ? 'bg-emerald-500' : 'bg-gray-300'}"></span>
                  <span class="flex-1 text-sm text-gray-800 dark:text-gray-100">{task.title}</span>
                  <span class="inline-block px-1.5 py-0.5 rounded-full text-[0.625rem] font-medium {getStatusColor(task.status)}">{task.status}</span>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      </div>
    </div>
  {/if}

  <!-- Create Project Modal -->
  {#if showCreateModal}
    <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-[1000]" on:click={() => showCreateModal = false} on:keypress={() => showCreateModal = false}>
      <div class="bg-white dark:bg-gray-800 rounded-xl w-[90%] max-w-[560px] max-h-[90vh] overflow-auto" on:click|stopPropagation on:keypress|stopPropagation>
        <div class="flex justify-between items-center px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h3 class="text-xl font-semibold text-gray-800 dark:text-gray-100">Create New Project</h3>
          <button class="bg-transparent border-none text-2xl cursor-pointer text-gray-500 hover:text-gray-800 dark:hover:text-gray-100 leading-none" on:click={() => showCreateModal = false}>×</button>
        </div>
        <div class="p-6">
          <div class="mb-4">
            <label for="title" class="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1.5">Title</label>
            <input id="title" type="text" bind:value={newProject.title} placeholder="Project title" class="input-field" />
          </div>
          <div class="mb-4">
            <label for="description" class="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1.5">Description</label>
            <textarea id="description" bind:value={newProject.description} placeholder="Optional description" class="input-field min-h-[80px] resize-y"></textarea>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label for="priority" class="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1.5">Priority</label>
              <select id="priority" bind:value={newProject.priority} class="select-field">
                <option value="P0">P0 - Critical</option>
                <option value="P1">P1 - High</option>
                <option value="P2">P2 - Normal</option>
                <option value="P3">P3 - Low</option>
              </select>
            </div>
            <div>
              <label for="targetDate" class="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1.5">Target Date</label>
              <input id="targetDate" type="date" bind:value={newProject.targetDate} class="input-field" />
            </div>
          </div>
        </div>
        <div class="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
          <button class="btn-secondary" on:click={() => showCreateModal = false}>Cancel</button>
          <button class="btn-primary" on:click={createProject} disabled={!newProject.title.trim()}>
            Create Project
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  .animate-spin {
    animation: spin 0.8s linear infinite;
  }
  .btn-success {
    @apply px-4 py-2 rounded-md font-medium text-sm transition-colors;
    @apply bg-emerald-500 text-white hover:bg-emerald-600;
  }
</style>
