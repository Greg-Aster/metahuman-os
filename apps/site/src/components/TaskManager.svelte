<script lang="ts">
  import { onMount } from 'svelte';

  interface Task {
    id: string;
    title: string;
    description?: string;
    status: 'todo' | 'in_progress' | 'blocked' | 'done' | 'cancelled';
    priority?: string;
    due?: string;
    tags?: string[];
    created: string;
    updated: string;
    completed?: string;
  }

  let tasks: Task[] = [];
  let completedTasks: Task[] = [];
  let loading = true;
  let error = '';
  let newTaskTitle = '';
  let showNewTask = false;
  let filterStatus: string = 'all';
  let agentStatus = '';
  let showCompleted = false;
  let searchTerm = '';
  let filteredTasks: Task[] = [];
  let filteredCompletedTasks: Task[] = [];

  async function loadTasks() {
    try {
      const res = await fetch('/api/tasks');
      if (!res.ok) throw new Error('Failed to load tasks');
      const data = await res.json();
      const status = typeof data?.status === 'string' ? data.status : 'all';
      const activeList = Array.isArray(data?.tasks) ? data.tasks : [];
      const completedList = Array.isArray(data?.completedTasks)
        ? data.completedTasks
        : status === 'completed'
          ? activeList
          : [];

      if (status === 'completed') {
        tasks = [];
        completedTasks = activeList;
      } else if (status === 'active') {
        tasks = activeList;
        completedTasks = completedList;
      } else {
        tasks = activeList;
        completedTasks = completedList;
      }
      loading = false;
    } catch (e) {
      error = (e as Error).message;
      loading = false;
    }
  }

  async function createTask() {
    if (!newTaskTitle.trim()) return;

    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTaskTitle }),
      });

      if (!res.ok) throw new Error('Failed to create task');

      newTaskTitle = '';
      showNewTask = false;
      await loadTasks();
    } catch (e) {
      error = (e as Error).message;
    }
  }

  async function updateTaskStatus(taskId: string, status: Task['status']) {
    try {
      const res = await fetch('/api/tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, status }),
      });

      if (!res.ok) throw new Error('Failed to update task');

      await loadTasks();
    } catch (e) {
      error = (e as Error).message;
    }
  }

  function formatDate(iso?: string): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  }

  async function runOrganizerAgent() {
    agentStatus = 'Starting agent...';
    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentName: 'organizer' }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to start agent');
      }
      agentStatus = data.message;
    } catch (e) {
      agentStatus = (e as Error).message;
    } finally {
      setTimeout(() => (agentStatus = ''), 5000);
    }
  }

  function getPriorityColor(priority?: string) {
    switch (priority) {
      case 'P0': return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
      case 'P1': return 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200';
      case 'P2': return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
      case 'P3': return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200';
      default: return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200';
    }
  }

  function getStatusColor(status: Task['status']) {
    switch (status) {
      case 'todo': return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
      case 'in_progress': return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
      case 'blocked': return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
      case 'done': return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
      case 'cancelled': return 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400';
    }
  }

  function matchesSearch(task: Task): boolean {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.trim().toLowerCase();
    const haystack = [
      task.title,
      task.description || '',
      ...(task.tags || []),
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(term);
  }

  $: filteredTasks = (filterStatus === 'all'
    ? tasks
    : tasks.filter(t => t.status === filterStatus)).filter(matchesSearch);

  $: filteredCompletedTasks = completedTasks.filter(matchesSearch);

  onMount(() => {
    loadTasks();
    // Refresh every 10 seconds
    const interval = setInterval(loadTasks, 10000);
    return () => clearInterval(interval);
  });
</script>

<div class="space-y-4">
  <!-- Header -->
  <div class="flex flex-wrap items-center justify-between gap-3">
    <div class="flex items-center gap-3">
      <h2 class="text-xl font-semibold">Tasks</h2>
      <span class="text-sm muted">Active: {filteredTasks.length}</span>
      <span class="text-xs px-2 py-0.5 rounded bg-gray-200 dark:bg-gray-700">
        Completed: {filteredCompletedTasks.length}
      </span>
    </div>
    <div class="flex items-center gap-2 flex-wrap justify-end">
      <div class="relative">
        <input
          type="search"
          bind:value={searchTerm}
          placeholder="Search tasks..."
          class="pl-3 pr-9 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
        />
        <svg
          class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      </div>
      <button
        on:click={runOrganizerAgent}
        class="btn-secondary"
        title="Run background agent to process memories"
      >
        Run Organizer Agent
      </button>
      <button
        on:click={() => showNewTask = !showNewTask}
        class="btn"
      >
        + New Task
      </button>
    </div>
  </div>

  <!-- Agent Status -->
  {#if agentStatus}
    <div class="p-2 text-sm text-center rounded bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
      {agentStatus}
    </div>
  {/if}

  <!-- Filter -->
  <div class="flex gap-2 text-sm">
    <button
      on:click={() => filterStatus = 'all'}
      class="px-3 py-1 rounded {filterStatus === 'all' ? 'bg-brand text-white' : 'bg-gray-100 dark:bg-gray-800'}"
    >
      All
    </button>
    <button
      on:click={() => filterStatus = 'todo'}
      class="px-3 py-1 rounded {filterStatus === 'todo' ? 'bg-brand text-white' : 'bg-gray-100 dark:bg-gray-800'}"
    >
      Todo
    </button>
    <button
      on:click={() => filterStatus = 'in_progress'}
      class="px-3 py-1 rounded {filterStatus === 'in_progress' ? 'bg-brand text-white' : 'bg-gray-100 dark:bg-gray-800'}"
    >
      In Progress
    </button>
    <button
      on:click={() => filterStatus = 'blocked'}
      class="px-3 py-1 rounded {filterStatus === 'blocked' ? 'bg-brand text-white' : 'bg-gray-100 dark:bg-gray-800'}"
    >
      Blocked
    </button>
    <button
      on:click={() => showCompleted = !showCompleted}
      class="ml-auto px-3 py-1 rounded border border-brand/40 text-brand hover:bg-brand/5"
    >
      {showCompleted ? 'Hide Completed' : `Show Completed (${filteredCompletedTasks.length})`}
    </button>
  </div>

  <!-- New Task Form -->
  {#if showNewTask}
    <div class="card p-4 border-2 border-brand/40">
      <input
        type="text"
        bind:value={newTaskTitle}
        on:keydown={(e) => e.key === 'Enter' && createTask()}
        placeholder="Task title..."
        class="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
      />
      <div class="flex gap-2 mt-3">
        <button on:click={createTask} class="btn">Create</button>
        <button on:click={() => showNewTask = false} class="px-4 py-2 rounded bg-gray-200 dark:bg-gray-700">
          Cancel
        </button>
      </div>
    </div>
  {/if}

  <!-- Error -->
  {#if error}
    <div class="card p-4 border-red-500">
      <p class="text-red-600 dark:text-red-400">{error}</p>
    </div>
  {/if}

  <!-- Task List -->
  {#if loading}
    <div class="space-y-3">
      {#each [1, 2, 3] as _}
        <div class="card p-4 animate-pulse">
          <div class="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4"></div>
        </div>
      {/each}
    </div>
  {:else if filteredTasks.length === 0}
    <div class="card p-8 text-center muted">
      <p>{searchTerm ? 'No tasks match your search.' : 'No active tasks found.'}</p>
      <button on:click={() => showNewTask = true} class="mt-3 text-brand hover:underline">
        Create your first task
      </button>
    </div>
  {:else}
    <div class="space-y-3">
      {#each filteredTasks as task (task.id)}
        <div class="card p-4 hover:ring-2 hover:ring-brand/40 transition">
          <div class="flex items-start justify-between gap-4">
            <div class="flex-1">
              <div class="flex items-center gap-2 mb-2">
                {#if task.priority}
                  <span class="text-xs px-2 py-0.5 rounded-full font-semibold {getPriorityColor(task.priority)}">
                    {task.priority}
                  </span>
                {/if}
                <span class="text-xs px-2 py-0.5 rounded-full font-semibold {getStatusColor(task.status)}">
                  {task.status.replace('_', ' ')}
                </span>
              </div>
              <h3 class="font-semibold mb-1">{task.title}</h3>
              {#if task.description}
                <p class="text-sm muted">{task.description}</p>
              {/if}
              {#if task.tags?.length}
                <div class="mt-2 flex flex-wrap gap-1">
                  {#each task.tags as tag}
                    <span class="text-xs px-2 py-0.5 rounded bg-gray-200 dark:bg-gray-700">{tag}</span>
                  {/each}
                </div>
              {/if}
              {#if task.due}
                <div class="mt-2 text-xs muted">
                  Due: {formatDate(task.due)}
                </div>
              {/if}
              <div class="mt-2 text-xs muted">
                Created: {formatDate(task.created)}
              </div>
            </div>

            <div class="flex flex-col gap-1">
              {#if task.status === 'todo'}
                <button
                  on:click={() => updateTaskStatus(task.id, 'in_progress')}
                  class="text-xs px-3 py-1 rounded bg-blue-100 hover:bg-blue-200 dark:bg-blue-900 dark:hover:bg-blue-800"
                >
                  Start
                </button>
              {/if}
              {#if task.status === 'in_progress'}
                <button
                  on:click={() => updateTaskStatus(task.id, 'done')}
                  class="text-xs px-3 py-1 rounded bg-green-100 hover:bg-green-200 dark:bg-green-900 dark:hover:bg-green-800"
                >
                  Complete
                </button>
                <button
                  on:click={() => updateTaskStatus(task.id, 'blocked')}
                  class="text-xs px-3 py-1 rounded bg-red-100 hover:bg-red-200 dark:bg-red-900 dark:hover:bg-red-800"
                >
                  Block
                </button>
              {/if}
              {#if task.status === 'blocked'}
                <button
                  on:click={() => updateTaskStatus(task.id, 'in_progress')}
                  class="text-xs px-3 py-1 rounded bg-blue-100 hover:bg-blue-200 dark:bg-blue-900 dark:hover:bg-blue-800"
                >
                  Unblock
                </button>
              {/if}
              {#if task.status !== 'done' && task.status !== 'cancelled'}
                <button
                  on:click={() => updateTaskStatus(task.id, 'cancelled')}
                  class="text-xs px-3 py-1 rounded bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700"
                >
                  Cancel
                </button>
              {/if}
            </div>
          </div>
        </div>
      {/each}
    </div>
  {/if}

  <!-- Completed Tasks -->
  {#if showCompleted}
    <div class="mt-8 space-y-3">
      <h3 class="text-lg font-semibold flex items-center gap-2">
        Completed Tasks
        <span class="text-xs px-2 py-0.5 rounded bg-gray-200 dark:bg-gray-700">
          {filteredCompletedTasks.length}
        </span>
      </h3>
      {#if filteredCompletedTasks.length === 0}
        <div class="card p-6 text-center muted">
          <p>No completed tasks yet.</p>
        </div>
      {:else}
        {#each filteredCompletedTasks as task (task.id)}
          <div class="card p-4 bg-gray-50 dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700">
            <div class="flex items-start justify-between gap-4">
              <div class="flex-1">
                <div class="flex items-center gap-2 mb-2">
                  <span class="text-xs px-2 py-0.5 rounded-full font-semibold {getStatusColor(task.status)}">
                    {task.status.replace('_', ' ')}
                  </span>
                  {#if task.priority}
                    <span class="text-xs px-2 py-0.5 rounded-full font-semibold {getPriorityColor(task.priority)}">
                      {task.priority}
                    </span>
                  {/if}
                </div>
                <h4 class="font-semibold mb-1 line-through decoration-brand/60">{task.title}</h4>
                {#if task.description}
                  <p class="text-sm muted">{task.description}</p>
                {/if}
                {#if task.tags?.length}
                  <div class="mt-2 flex flex-wrap gap-1">
                    {#each task.tags as tag}
                      <span class="text-xs px-2 py-0.5 rounded bg-gray-200 dark:bg-gray-700">{tag}</span>
                    {/each}
                  </div>
                {/if}
                <div class="mt-2 text-xs muted space-y-1">
                  <div>Completed: {formatDate(task.completed || task.updated)}</div>
                  <div>Created: {formatDate(task.created)}</div>
                </div>
              </div>
              <div class="flex flex-col gap-1">
                <button
                  on:click={() => updateTaskStatus(task.id, 'todo')}
                  class="text-xs px-3 py-1 rounded bg-blue-100 hover:bg-blue-200 dark:bg-blue-900 dark:hover:bg-blue-800"
                >
                  Reopen
                </button>
                {#if task.status !== 'cancelled'}
                  <button
                    on:click={() => updateTaskStatus(task.id, 'cancelled')}
                    class="text-xs px-3 py-1 rounded bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700"
                  >
                    Cancel
                  </button>
                {/if}
              </div>
            </div>
          </div>
        {/each}
      {/if}
    </div>
  {/if}
</div>
