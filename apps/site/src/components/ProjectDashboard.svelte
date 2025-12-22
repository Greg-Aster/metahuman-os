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

<div class="project-dashboard">
  <!-- Header -->
  <div class="dashboard-header">
    <div class="header-title">
      <h2>Projects & Tasks</h2>
      <p class="header-subtitle">Manage projects, dependencies, and task suggestions</p>
    </div>
    <div class="header-actions">
      <button class="btn btn-primary" on:click={() => showCreateModal = true}>
        + New Project
      </button>
    </div>
  </div>

  <!-- Stats Row -->
  <div class="stats-row">
    <div class="stat-card">
      <div class="stat-value">{projects.filter(p => p.status === 'active').length}</div>
      <div class="stat-label">Active Projects</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">{actionableTasks.length}</div>
      <div class="stat-label">Actionable Tasks</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">{blockedTasks.length}</div>
      <div class="stat-label">Blocked Tasks</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">{suggestions.length}</div>
      <div class="stat-label">Pending Suggestions</div>
    </div>
  </div>

  <!-- Error display -->
  {#if error}
    <div class="error-banner">
      {error}
      <button on:click={() => error = ''}>Dismiss</button>
    </div>
  {/if}

  <!-- Tab Navigation -->
  <div class="tab-nav">
    <button class="tab-btn" class:active={activeTab === 'projects'} on:click={() => activeTab = 'projects'}>
      Projects ({projects.length})
    </button>
    <button class="tab-btn" class:active={activeTab === 'actionable'} on:click={() => activeTab = 'actionable'}>
      Actionable ({actionableTasks.length})
    </button>
    <button class="tab-btn" class:active={activeTab === 'blocked'} on:click={() => activeTab = 'blocked'}>
      Blocked ({blockedTasks.length})
    </button>
    <button class="tab-btn" class:active={activeTab === 'suggestions'} on:click={() => activeTab = 'suggestions'}>
      Suggestions ({suggestions.length})
    </button>
  </div>

  <!-- Content -->
  <div class="tab-content">
    {#if loading}
      <div class="loading-state">
        <div class="spinner"></div>
        <p>Loading...</p>
      </div>
    {:else if activeTab === 'projects'}
      <!-- Projects Tab -->
      <div class="search-bar">
        <input type="text" bind:value={searchQuery} placeholder="Search projects..." />
      </div>

      {#if filteredProjects.length === 0}
        <div class="empty-state">
          <div class="empty-icon">📁</div>
          <div class="empty-title">No projects yet</div>
          <div class="empty-desc">Create your first project to organize related tasks</div>
        </div>
      {:else}
        <div class="project-grid">
          {#each filteredProjects as project}
            <div class="project-card" on:click={() => selectProject(project)} on:keypress={() => selectProject(project)}>
              <div class="project-header">
                <h3 class="project-title">{project.title}</h3>
                <span class="badge {getStatusColor(project.status)}">{project.status}</span>
              </div>
              {#if project.description}
                <p class="project-desc">{project.description}</p>
              {/if}
              <div class="project-meta">
                <span class="badge {getPriorityColor(project.priority)}">{project.priority || 'P2'}</span>
                {#if project.progress !== undefined}
                  <div class="progress-bar">
                    <div class="progress-fill" style="width: {project.progress}%"></div>
                  </div>
                  <span class="progress-text">{project.progress}%</span>
                {/if}
              </div>
              {#if project.tags?.length}
                <div class="project-tags">
                  {#each project.tags.slice(0, 3) as tag}
                    <span class="tag">{tag}</span>
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
        <div class="empty-state">
          <div class="empty-icon">✅</div>
          <div class="empty-title">No actionable tasks</div>
          <div class="empty-desc">All tasks have blocking dependencies or are completed</div>
        </div>
      {:else}
        <div class="task-list">
          {#each actionableTasks as task}
            <div class="task-card">
              <div class="task-header">
                <h4 class="task-title">{task.title}</h4>
                <span class="badge {getPriorityColor(task.priority)}">{task.priority || 'P2'}</span>
              </div>
              <div class="task-meta">
                <span class="badge {getStatusColor(task.status)}">{task.status}</span>
                {#if task.projectId}
                  <span class="project-link">in project</span>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}

    {:else if activeTab === 'blocked'}
      <!-- Blocked Tasks Tab -->
      {#if blockedTasks.length === 0}
        <div class="empty-state">
          <div class="empty-icon">🔓</div>
          <div class="empty-title">No blocked tasks</div>
          <div class="empty-desc">All task dependencies are resolved</div>
        </div>
      {:else}
        <div class="task-list">
          {#each blockedTasks as task}
            <div class="task-card blocked">
              <div class="task-header">
                <h4 class="task-title">{task.title}</h4>
                <span class="badge bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300">blocked</span>
              </div>
              {#if task.dependencies?.length}
                <div class="blocked-by">
                  Blocked by {task.dependencies.length} task{task.dependencies.length > 1 ? 's' : ''}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}

    {:else if activeTab === 'suggestions'}
      <!-- Task Suggestions Tab -->
      <div class="suggestions-header">
        <p class="suggestions-info">Tasks extracted from your reflections and inner dialogues</p>
        <button class="btn btn-secondary" on:click={extractSuggestions}>
          Extract from Reflections
        </button>
      </div>

      {#if suggestions.length === 0}
        <div class="empty-state">
          <div class="empty-icon">💡</div>
          <div class="empty-title">No pending suggestions</div>
          <div class="empty-desc">Click "Extract from Reflections" to find actionable tasks</div>
        </div>
      {:else}
        <div class="suggestion-list">
          {#each suggestions as suggestion}
            <div class="suggestion-card">
              <div class="suggestion-header">
                <h4 class="suggestion-title">{suggestion.title}</h4>
                <span class="confidence {getConfidenceColor(suggestion.confidence)}">
                  {Math.round(suggestion.confidence * 100)}% confidence
                </span>
              </div>
              <p class="suggestion-desc">{suggestion.description}</p>
              <div class="suggestion-meta">
                <span class="badge {getPriorityColor(suggestion.priority)}">{suggestion.priority}</span>
                {#if suggestion.projectSuggestion}
                  <span class="project-suggestion">Suggested project: {suggestion.projectSuggestion}</span>
                {/if}
              </div>
              <div class="suggestion-source">
                <span class="source-label">From reflection:</span>
                <p class="source-content">{suggestion.sourceContent.substring(0, 150)}...</p>
              </div>
              <div class="suggestion-actions">
                <button class="btn btn-success" on:click={() => approveSuggestion(suggestion.id)}>
                  Approve
                </button>
                <button class="btn btn-danger" on:click={() => rejectSuggestion(suggestion.id)}>
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
    <div class="modal-overlay" on:click={() => selectedProject = null} on:keypress={() => selectedProject = null}>
      <div class="modal" on:click|stopPropagation on:keypress|stopPropagation>
        <div class="modal-header">
          <h3>{selectedProject.title}</h3>
          <button class="close-btn" on:click={() => selectedProject = null}>×</button>
        </div>
        <div class="modal-body">
          {#if selectedProject.description}
            <p class="project-description">{selectedProject.description}</p>
          {/if}
          <div class="project-stats">
            <span class="badge {getStatusColor(selectedProject.status)}">{selectedProject.status}</span>
            <span class="badge {getPriorityColor(selectedProject.priority)}">{selectedProject.priority}</span>
            {#if selectedProject.progress !== undefined}
              <span>{selectedProject.progress}% complete</span>
            {/if}
          </div>
          <h4>Tasks ({projectTasks.length})</h4>
          {#if projectTasks.length === 0}
            <p class="muted">No tasks in this project yet</p>
          {:else}
            <div class="project-task-list">
              {#each projectTasks as task}
                <div class="project-task-item">
                  <span class="task-status-dot {task.status === 'done' ? 'done' : ''}"></span>
                  <span class="task-name">{task.title}</span>
                  <span class="badge small {getStatusColor(task.status)}">{task.status}</span>
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
    <div class="modal-overlay" on:click={() => showCreateModal = false} on:keypress={() => showCreateModal = false}>
      <div class="modal" on:click|stopPropagation on:keypress|stopPropagation>
        <div class="modal-header">
          <h3>Create New Project</h3>
          <button class="close-btn" on:click={() => showCreateModal = false}>×</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label for="title">Title</label>
            <input id="title" type="text" bind:value={newProject.title} placeholder="Project title" />
          </div>
          <div class="form-group">
            <label for="description">Description</label>
            <textarea id="description" bind:value={newProject.description} placeholder="Optional description"></textarea>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label for="priority">Priority</label>
              <select id="priority" bind:value={newProject.priority}>
                <option value="P0">P0 - Critical</option>
                <option value="P1">P1 - High</option>
                <option value="P2">P2 - Normal</option>
                <option value="P3">P3 - Low</option>
              </select>
            </div>
            <div class="form-group">
              <label for="targetDate">Target Date</label>
              <input id="targetDate" type="date" bind:value={newProject.targetDate} />
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" on:click={() => showCreateModal = false}>Cancel</button>
          <button class="btn btn-primary" on:click={createProject} disabled={!newProject.title.trim()}>
            Create Project
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .project-dashboard {
    padding: 1.5rem;
    max-width: 1400px;
    margin: 0 auto;
  }

  .dashboard-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 1.5rem;
  }

  .header-title h2 {
    font-size: 1.75rem;
    font-weight: 700;
    color: var(--text-primary, #1f2937);
    margin: 0;
  }

  :global(.dark) .header-title h2 {
    color: #f3f4f6;
  }

  .header-subtitle {
    color: #6b7280;
    margin: 0.25rem 0 0 0;
    font-size: 0.875rem;
  }

  :global(.dark) .header-subtitle {
    color: #9ca3af;
  }

  .stats-row {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 1rem;
    margin-bottom: 1.5rem;
  }

  @media (max-width: 768px) {
    .stats-row {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  .stat-card {
    background: white;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    padding: 1rem;
    text-align: center;
  }

  :global(.dark) .stat-card {
    background: #1f2937;
    border-color: #374151;
  }

  .stat-value {
    font-size: 2rem;
    font-weight: 700;
    color: #3b82f6;
  }

  .stat-label {
    font-size: 0.75rem;
    color: #6b7280;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  :global(.dark) .stat-label {
    color: #9ca3af;
  }

  .tab-nav {
    display: flex;
    gap: 0.25rem;
    border-bottom: 1px solid #e5e7eb;
    margin-bottom: 1rem;
  }

  :global(.dark) .tab-nav {
    border-color: #374151;
  }

  .tab-btn {
    padding: 0.75rem 1rem;
    background: transparent;
    border: none;
    color: #6b7280;
    cursor: pointer;
    font-size: 0.875rem;
    border-bottom: 2px solid transparent;
    transition: all 0.2s;
  }

  .tab-btn:hover {
    color: #3b82f6;
  }

  .tab-btn.active {
    color: #3b82f6;
    border-bottom-color: #3b82f6;
  }

  :global(.dark) .tab-btn {
    color: #9ca3af;
  }

  :global(.dark) .tab-btn.active {
    color: #60a5fa;
    border-bottom-color: #60a5fa;
  }

  .search-bar {
    margin-bottom: 1rem;
  }

  .search-bar input {
    width: 100%;
    padding: 0.625rem 1rem;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    font-size: 0.875rem;
    background: white;
  }

  :global(.dark) .search-bar input {
    background: #1f2937;
    border-color: #374151;
    color: #f3f4f6;
  }

  .project-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 1rem;
  }

  .project-card {
    background: white;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    padding: 1rem;
    cursor: pointer;
    transition: all 0.2s;
  }

  .project-card:hover {
    border-color: #3b82f6;
    box-shadow: 0 4px 12px rgba(59, 130, 246, 0.15);
  }

  :global(.dark) .project-card {
    background: #1f2937;
    border-color: #374151;
  }

  :global(.dark) .project-card:hover {
    border-color: #60a5fa;
  }

  .project-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 0.5rem;
  }

  .project-title {
    font-size: 1rem;
    font-weight: 600;
    margin: 0;
    color: #1f2937;
  }

  :global(.dark) .project-title {
    color: #f3f4f6;
  }

  .project-desc {
    font-size: 0.875rem;
    color: #6b7280;
    margin: 0 0 0.75rem 0;
    line-height: 1.4;
  }

  :global(.dark) .project-desc {
    color: #9ca3af;
  }

  .project-meta {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }

  .progress-bar {
    flex: 1;
    height: 6px;
    background: #e5e7eb;
    border-radius: 3px;
    overflow: hidden;
  }

  :global(.dark) .progress-bar {
    background: #374151;
  }

  .progress-fill {
    height: 100%;
    background: #3b82f6;
    border-radius: 3px;
    transition: width 0.3s;
  }

  .progress-text {
    font-size: 0.75rem;
    color: #6b7280;
    min-width: 36px;
  }

  .project-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }

  .tag {
    font-size: 0.7rem;
    padding: 0.125rem 0.375rem;
    background: #f3f4f6;
    color: #6b7280;
    border-radius: 4px;
  }

  :global(.dark) .tag {
    background: #374151;
    color: #9ca3af;
  }

  .badge {
    display: inline-block;
    padding: 0.125rem 0.5rem;
    border-radius: 9999px;
    font-size: 0.75rem;
    font-weight: 500;
  }

  .badge.small {
    padding: 0.0625rem 0.375rem;
    font-size: 0.625rem;
  }

  .task-list, .suggestion-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .task-card, .suggestion-card {
    background: white;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    padding: 1rem;
  }

  :global(.dark) .task-card,
  :global(.dark) .suggestion-card {
    background: #1f2937;
    border-color: #374151;
  }

  .task-card.blocked {
    border-left: 3px solid #ef4444;
  }

  .task-header, .suggestion-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 0.5rem;
  }

  .task-title, .suggestion-title {
    font-weight: 600;
    margin: 0;
    color: #1f2937;
  }

  :global(.dark) .task-title,
  :global(.dark) .suggestion-title {
    color: #f3f4f6;
  }

  .task-meta {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  .blocked-by {
    font-size: 0.75rem;
    color: #ef4444;
    margin-top: 0.5rem;
  }

  .suggestions-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
  }

  .suggestions-info {
    color: #6b7280;
    font-size: 0.875rem;
    margin: 0;
  }

  :global(.dark) .suggestions-info {
    color: #9ca3af;
  }

  .suggestion-desc {
    font-size: 0.875rem;
    color: #4b5563;
    margin: 0 0 0.75rem 0;
  }

  :global(.dark) .suggestion-desc {
    color: #d1d5db;
  }

  .suggestion-meta {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    margin-bottom: 0.75rem;
  }

  .project-suggestion {
    font-size: 0.75rem;
    color: #3b82f6;
  }

  .suggestion-source {
    background: #f9fafb;
    border-radius: 6px;
    padding: 0.75rem;
    margin-bottom: 0.75rem;
  }

  :global(.dark) .suggestion-source {
    background: #111827;
  }

  .source-label {
    font-size: 0.625rem;
    text-transform: uppercase;
    color: #6b7280;
    letter-spacing: 0.05em;
  }

  .source-content {
    font-size: 0.75rem;
    color: #4b5563;
    margin: 0.25rem 0 0 0;
    font-style: italic;
  }

  :global(.dark) .source-content {
    color: #9ca3af;
  }

  .suggestion-actions {
    display: flex;
    gap: 0.5rem;
  }

  .confidence {
    font-size: 0.75rem;
    font-weight: 500;
  }

  .btn {
    padding: 0.5rem 1rem;
    border-radius: 6px;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    border: none;
    transition: all 0.2s;
  }

  .btn-primary {
    background: #3b82f6;
    color: white;
  }

  .btn-primary:hover {
    background: #2563eb;
  }

  .btn-primary:disabled {
    background: #93c5fd;
    cursor: not-allowed;
  }

  .btn-secondary {
    background: #f3f4f6;
    color: #374151;
  }

  :global(.dark) .btn-secondary {
    background: #374151;
    color: #f3f4f6;
  }

  .btn-secondary:hover {
    background: #e5e7eb;
  }

  :global(.dark) .btn-secondary:hover {
    background: #4b5563;
  }

  .btn-success {
    background: #10b981;
    color: white;
  }

  .btn-success:hover {
    background: #059669;
  }

  .btn-danger {
    background: #ef4444;
    color: white;
  }

  .btn-danger:hover {
    background: #dc2626;
  }

  .empty-state {
    text-align: center;
    padding: 3rem;
    color: #6b7280;
  }

  .empty-icon {
    font-size: 3rem;
    margin-bottom: 1rem;
  }

  .empty-title {
    font-size: 1.25rem;
    font-weight: 600;
    margin-bottom: 0.5rem;
    color: #374151;
  }

  :global(.dark) .empty-title {
    color: #d1d5db;
  }

  .empty-desc {
    font-size: 0.875rem;
  }

  .loading-state {
    text-align: center;
    padding: 3rem;
    color: #6b7280;
  }

  .spinner {
    width: 32px;
    height: 32px;
    border: 3px solid #e5e7eb;
    border-top-color: #3b82f6;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    margin: 0 auto 1rem;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .error-banner {
    background: #fef2f2;
    border: 1px solid #fecaca;
    color: #dc2626;
    padding: 0.75rem 1rem;
    border-radius: 6px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
  }

  :global(.dark) .error-banner {
    background: #450a0a;
    border-color: #7f1d1d;
    color: #fca5a5;
  }

  .error-banner button {
    background: transparent;
    border: none;
    color: inherit;
    cursor: pointer;
    font-weight: 500;
  }

  /* Modal styles */
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .modal {
    background: white;
    border-radius: 12px;
    width: 90%;
    max-width: 560px;
    max-height: 90vh;
    overflow: auto;
  }

  :global(.dark) .modal {
    background: #1f2937;
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 1.5rem;
    border-bottom: 1px solid #e5e7eb;
  }

  :global(.dark) .modal-header {
    border-color: #374151;
  }

  .modal-header h3 {
    margin: 0;
    font-size: 1.25rem;
    color: #1f2937;
  }

  :global(.dark) .modal-header h3 {
    color: #f3f4f6;
  }

  .close-btn {
    background: transparent;
    border: none;
    font-size: 1.5rem;
    cursor: pointer;
    color: #6b7280;
    line-height: 1;
  }

  .close-btn:hover {
    color: #1f2937;
  }

  :global(.dark) .close-btn:hover {
    color: #f3f4f6;
  }

  .modal-body {
    padding: 1.5rem;
  }

  .modal-footer {
    padding: 1rem 1.5rem;
    border-top: 1px solid #e5e7eb;
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
  }

  :global(.dark) .modal-footer {
    border-color: #374151;
  }

  .form-group {
    margin-bottom: 1rem;
  }

  .form-group label {
    display: block;
    font-size: 0.875rem;
    font-weight: 500;
    color: #374151;
    margin-bottom: 0.375rem;
  }

  :global(.dark) .form-group label {
    color: #d1d5db;
  }

  .form-group input,
  .form-group textarea,
  .form-group select {
    width: 100%;
    padding: 0.625rem;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    font-size: 0.875rem;
    background: white;
  }

  :global(.dark) .form-group input,
  :global(.dark) .form-group textarea,
  :global(.dark) .form-group select {
    background: #111827;
    border-color: #374151;
    color: #f3f4f6;
  }

  .form-group textarea {
    min-height: 80px;
    resize: vertical;
  }

  .form-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
  }

  .project-stats {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    margin: 1rem 0;
  }

  .project-task-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }

  .project-task-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem;
    background: #f9fafb;
    border-radius: 6px;
  }

  :global(.dark) .project-task-item {
    background: #111827;
  }

  .task-status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #d1d5db;
  }

  .task-status-dot.done {
    background: #10b981;
  }

  .task-name {
    flex: 1;
    font-size: 0.875rem;
    color: #1f2937;
  }

  :global(.dark) .task-name {
    color: #f3f4f6;
  }

  .muted {
    color: #6b7280;
    font-size: 0.875rem;
  }

  .project-description {
    color: #4b5563;
    margin-bottom: 1rem;
  }

  :global(.dark) .project-description {
    color: #d1d5db;
  }
</style>
