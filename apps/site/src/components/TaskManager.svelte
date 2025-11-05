<script lang="ts">
  import { onMount } from 'svelte';
  import { canWriteMemory } from '../stores/security-policy';

  type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'done' | 'cancelled';

  interface Task {
    id: string;
    title: string;
    description?: string;
    status: TaskStatus;
    priority?: string;
    due?: string;
    tags?: string[];
    created: string;
    updated: string;
    completed?: string;
    listId?: string;
    start?: string;
    end?: string;
  }

  interface TaskList {
    id: string;
    name: string;
    description?: string;
    color?: string;
    owner?: string;
  }

  interface CalendarDay {
    date: Date;
    label: string;
    isToday: boolean;
    tasks: Task[];
  }

  let tasks: Task[] = [];
  let completedTasks: Task[] = [];
  let taskLists: TaskList[] = [];

  let loading = true;
  let error = '';
  let agentStatus = '';

  let newTaskTitle = '';
  let showNewTask = false;

  let filterStatus: 'all' | TaskStatus = 'all';
  let showCompleted = false;
  let searchTerm = '';
  let selectedList: string = 'all';

  let viewMode: 'list' | 'calendar' = 'list';
  let calendarAnchor = new Date();
  let calendarDays: CalendarDay[] = [];

  let filteredTasks: Task[] = [];
  let filteredCompletedTasks: Task[] = [];

  function startOfWeek(date: Date): Date {
    const d = new Date(date);
    const day = d.getDay();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - day);
    return d;
  }

  function addDays(date: Date, amount: number): Date {
    const d = new Date(date);
    d.setDate(d.getDate() + amount);
    return d;
  }

  function occursOnDay(task: Task, day: Date): boolean {
    const dayStart = new Date(day);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setHours(23, 59, 59, 999);

    const start = task.start ? new Date(task.start) : null;
    const end = task.end ? new Date(task.end) : null;
    const due = task.due ? new Date(task.due) : null;

    if (start && end) {
      return start <= dayEnd && end >= dayStart;
    }
    if (start) {
      return start >= dayStart && start <= dayEnd;
    }
    if (due) {
      return due >= dayStart && due <= dayEnd;
    }
    return false;
  }

  function rebuildCalendar(): void {
    const weekStart = startOfWeek(calendarAnchor);
    const days: CalendarDay[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const active = tasks.filter(task => {
      if (task.status === 'done' || task.status === 'cancelled') return false;
      if (filterStatus !== 'all' && task.status !== filterStatus) return false;
      return matchesSearch(task);
    });

    for (let i = 0; i < 7; i++) {
      const date = addDays(weekStart, i);
      const label = date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
      const isToday = date.getTime() === today.getTime();
      const tasksForDay = active.filter(task => occursOnDay(task, date));
      days.push({ date, label, isToday, tasks: tasksForDay });
    }

    calendarDays = days;
  }

  async function loadTasks() {
    loading = true;
    try {
      const params = new URLSearchParams();
      if (selectedList !== 'all') {
        params.set('list', selectedList);
      }

      const url = params.size ? `/api/tasks?${params.toString()}` : '/api/tasks';
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to load tasks');

      const data = await res.json();
      const active = Array.isArray(data?.tasks) ? data.tasks : [];
      const completed = Array.isArray(data?.completedTasks) ? data.completedTasks : [];

      tasks = active;
      completedTasks = completed;
      error = '';
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
      rebuildCalendar();
    }
  }

  async function loadTaskLists() {
    try {
      const res = await fetch('/api/task-lists');
      if (!res.ok) throw new Error('Failed to load task lists');
      const data = await res.json();
      taskLists = Array.isArray(data?.lists) ? data.lists : [];
    } catch (e) {
      error = (e as Error).message;
    }
  }

  async function createTask() {
    if (!newTaskTitle.trim()) return;

    try {
      const payload: Record<string, unknown> = { title: newTaskTitle.trim() };
      if (selectedList !== 'all') {
        payload.listId = selectedList;
      }

      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error('Failed to create task');

      newTaskTitle = '';
      showNewTask = false;
      await loadTasks();
    } catch (e) {
      error = (e as Error).message;
    }
  }

  async function updateTaskStatus(taskId: string, status: TaskStatus) {
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

  function getStatusColor(status: TaskStatus) {
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
    ].join(' ').toLowerCase();
    return haystack.includes(term);
  }

  function setStatus(status: 'all' | TaskStatus) {
    filterStatus = status;
  }

  function selectList(id: string) {
    selectedList = id;
    void loadTasks();
  }

  function toggleView(mode: 'list' | 'calendar') {
    viewMode = mode;
    if (mode === 'calendar') {
      rebuildCalendar();
    }
  }

  function changeWeek(offset: number) {
    calendarAnchor = addDays(calendarAnchor, offset * 7);
    rebuildCalendar();
  }

  function resetWeek() {
    calendarAnchor = new Date();
    rebuildCalendar();
  }

  function dayTaskTime(task: Task): string {
    const ref = task.start || task.due;
    if (!ref) return '';
    const d = new Date(ref);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  async function promptNewList() {
    if (typeof window === 'undefined') return;
    const name = window.prompt('Task list name?');
    if (!name || !name.trim()) return;
    try {
      const res = await fetch('/api/task-lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!res.ok) throw new Error('Failed to create list');
      const data = await res.json();
      await loadTaskLists();
      const filepath = data?.filepath;
      if (typeof filepath === 'string') {
        const id = filepath.split('/').pop()?.replace('.json', '');
        if (id) {
          selectedList = id;
          await loadTasks();
        }
      }
    } catch (e) {
      error = (e as Error).message;
    }
  }

  $: filteredTasks = (filterStatus === 'all'
    ? tasks
    : tasks.filter(task => task.status === filterStatus)).filter(matchesSearch);

  $: filteredCompletedTasks = completedTasks.filter(matchesSearch);

  $: {
    filteredTasks;
    filteredCompletedTasks;
    calendarAnchor;
    rebuildCalendar();
  }

  onMount(() => {
    void loadTaskLists();
    void loadTasks();
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
      <div class="flex rounded border border-gray-300 dark:border-gray-600 overflow-hidden text-sm">
        <button
          class={`px-3 py-1 ${viewMode === 'list' ? 'bg-brand text-white' : 'bg-gray-100 dark:bg-gray-800'}`}
          on:click={() => toggleView('list')}
          aria-pressed={viewMode === 'list'}
        >
          List
        </button>
        <button
          class={`px-3 py-1 ${viewMode === 'calendar' ? 'bg-brand text-white' : 'bg-gray-100 dark:bg-gray-800'}`}
          on:click={() => toggleView('calendar')}
          aria-pressed={viewMode === 'calendar'}
        >
          Calendar
        </button>
      </div>
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
        disabled={!$canWriteMemory}
        title={$canWriteMemory ? 'Create a new task' : 'Task creation disabled in read-only mode'}
      >
        + New Task
      </button>
    </div>
  </div>

  {#if agentStatus}
    <div class="p-2 text-sm text-center rounded bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
      {agentStatus}
    </div>
  {/if}

  <!-- Status Filters -->
  <div class="flex gap-2 text-sm">
    <button
      on:click={() => setStatus('all')}
      class="px-3 py-1 rounded {filterStatus === 'all' ? 'bg-brand text-white' : 'bg-gray-100 dark:bg-gray-800'}"
    >
      All
    </button>
    <button
      on:click={() => setStatus('todo')}
      class="px-3 py-1 rounded {filterStatus === 'todo' ? 'bg-brand text-white' : 'bg-gray-100 dark:bg-gray-800'}"
    >
      Todo
    </button>
    <button
      on:click={() => setStatus('in_progress')}
      class="px-3 py-1 rounded {filterStatus === 'in_progress' ? 'bg-brand text-white' : 'bg-gray-100 dark:bg-gray-800'}"
    >
      In Progress
    </button>
    <button
      on:click={() => setStatus('blocked')}
      class="px-3 py-1 rounded {filterStatus === 'blocked' ? 'bg-brand text-white' : 'bg-gray-100 dark:bg-gray-800'}"
    >
      Blocked
    </button>
    <button
      on:click={() => setStatus('done')}
      class="px-3 py-1 rounded {filterStatus === 'done' ? 'bg-brand text-white' : 'bg-gray-100 dark:bg-gray-800'}"
    >
      Done
    </button>
    <button
      on:click={() => setStatus('cancelled')}
      class="px-3 py-1 rounded {filterStatus === 'cancelled' ? 'bg-brand text-white' : 'bg-gray-100 dark:bg-gray-800'}"
    >
      Cancelled
    </button>
    {#if viewMode === 'list'}
      <button
        on:click={() => showCompleted = !showCompleted}
        class="ml-auto px-3 py-1 rounded border border-brand/40 text-brand hover:bg-brand/5"
      >
        {showCompleted ? 'Hide Completed' : `Show Completed (${filteredCompletedTasks.length})`}
      </button>
    {/if}
  </div>

  <!-- Task Lists -->
  <div class="flex items-center gap-2 text-xs overflow-x-auto pb-2">
    <span class="uppercase tracking-wide text-gray-500 dark:text-gray-400">Lists:</span>
    <button
      on:click={() => selectList('all')}
      class={`px-3 py-1 rounded-full border ${selectedList === 'all' ? 'bg-brand text-white border-brand' : 'border-gray-300 dark:border-gray-600'}`}
    >
      All
    </button>
    {#each taskLists as list (list.id)}
      <button
        on:click={() => selectList(list.id)}
        class={`px-3 py-1 rounded-full border ${selectedList === list.id ? 'bg-brand text-white border-brand' : 'border-gray-300 dark:border-gray-600'}`}
        title={list.description}
      >
        {list.name}
      </button>
    {/each}
    <button
      class="px-3 py-1 rounded-full border border-dashed border-brand text-brand hover:bg-brand/5"
      on:click={promptNewList}
    >
      + New List
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

  {#if error}
    <div class="card p-4 border border-red-400 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300">
      {error}
    </div>
  {/if}

  {#if viewMode === 'list'}
    <!-- Task List View -->
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
                  {#if task.listId}
                    <span class="text-[11px] px-2 py-0.5 rounded-full bg-gray-200 dark:bg-gray-700">
                      {taskLists.find(l => l.id === task.listId)?.name ?? task.listId}
                    </span>
                  {/if}
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
                <div class="mt-2 text-xs muted space-y-1">
                  {#if task.start || task.end}
                    <div>
                      {#if task.start}Start: {formatDate(task.start)}{/if}
                      {#if task.end}
                        <span class="ml-2">End: {formatDate(task.end)}</span>
                      {/if}
                    </div>
                  {/if}
                  {#if task.due}
                    <div>Due: {formatDate(task.due)}</div>
                  {/if}
                  <div>Created: {formatDate(task.created)}</div>
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
  {:else}
    <!-- Calendar View -->
    <div class="card p-4">
      <div class="flex items-center justify-between mb-4">
        <div>
          <div class="text-sm uppercase tracking-wide text-gray-500 dark:text-gray-400">Week of</div>
          <div class="text-lg font-semibold">
            {startOfWeek(calendarAnchor).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
          </div>
        </div>
        <div class="flex items-center gap-2">
          <button class="btn-secondary" on:click={() => changeWeek(-1)} aria-label="Previous week">←</button>
          <button class="btn-secondary" on:click={resetWeek}>This Week</button>
          <button class="btn-secondary" on:click={() => changeWeek(1)} aria-label="Next week">→</button>
        </div>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3">
        {#each calendarDays as day (day.date.toISOString())}
          <div class="border rounded-lg p-3 bg-white dark:bg-gray-900/60 dark:border-gray-700">
            <div class="flex items-center justify-between mb-2">
              <span class="text-sm font-semibold">{day.label}</span>
              {#if day.isToday}
                <span class="text-xs px-2 py-0.5 rounded bg-brand/10 text-brand">Today</span>
              {/if}
            </div>
            {#if day.tasks.length === 0}
              <p class="text-xs text-gray-500 dark:text-gray-400">No scheduled tasks.</p>
            {:else}
              <div class="space-y-2">
                {#each day.tasks as task (task.id)}
                  <div class="rounded border px-2 py-1 text-xs border-brand/30 bg-brand/5">
                    <div class="font-semibold">{task.title}</div>
                    {#if dayTaskTime(task)}
                      <div class="text-[11px] text-gray-600 dark:text-gray-400">{dayTaskTime(task)}</div>
                    {/if}
                    {#if task.listId}
                      <div class="text-[11px] text-gray-500 dark:text-gray-400">
                        List: {taskLists.find(l => l.id === task.listId)?.name ?? task.listId}
                      </div>
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>
