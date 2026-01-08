<script lang="ts">
  import { activeView } from '../stores/navigation';
  import type { SvelteComponent } from 'svelte';
  import { apiFetch, isMobileApp } from '../lib/client/api-config';
  
  // Safe wrapper for isMobileApp to prevent runtime errors
  let isMobileAppSafe = false;
  
  // Check if we're in a browser environment and isMobileApp is available
  $: if (typeof window !== 'undefined' && typeof isMobileApp === 'function') {
    try {
      isMobileAppSafe = isMobileApp();
    } catch (e) {
      console.error('[CenterContent] Error calling isMobileApp:', e);
      isMobileAppSafe = false;
    }
  } else {
    isMobileAppSafe = false;
  }

  // PERFORMANCE OPTIMIZATION: Lazy load components
  // Only load ChatInterface eagerly (it's the default view and most common)
  import ChatInterface from './ChatInterface.svelte';

  // All other components are loaded dynamically when needed
  // This reduces initial bundle size from ~33 components to just 1

  // Cache for loaded components to avoid re-importing
  const componentCache = new Map<string, typeof SvelteComponent>();

  // Dynamic component loader
  async function loadComponent(name: string): Promise<typeof SvelteComponent> {
    if (componentCache.has(name)) {
      return componentCache.get(name)!;
    }

    let module;
    switch (name) {
      case 'Dashboard':
        module = await import('./Dashboard.svelte');
        break;
      case 'TaskManager':
        module = await import('./TaskManager.svelte');
        break;
      case 'ProjectDashboard':
        module = await import('./ProjectDashboard.svelte');
        break;
      case 'ApprovalQueue':
        module = await import('./ApprovalQueue.svelte');
        break;
      case 'MemoryControls':
        module = await import('./MemoryControls.svelte');
        break;
      case 'AudioUpload':
        module = await import('./AudioUpload.svelte');
        break;
      case 'AudioRecorder':
        module = await import('./AudioRecorder.svelte');
        break;
      case 'VoiceTrainingWidget':
        module = await import('./VoiceTrainingWidget.svelte');
        break;
      case 'VoiceSettings':
        module = await import('./VoiceSettings.svelte');
        break;
      case 'AdapterDashboard':
        module = await import('./AdapterDashboard.svelte');
        break;
      case 'TrainingMonitor':
        module = await import('./TrainingMonitor.svelte');
        break;
      case 'OnboardingWizard':
        module = await import('./OnboardingWizard.svelte');
        break;
      case 'TrainingWizard':
        module = await import('./TrainingWizard.svelte');
        break;
      case 'TrainingHistory':
        module = await import('./TrainingHistory.svelte');
        break;
      case 'DatasetManagement':
        module = await import('./DatasetManagement.svelte');
        break;
      case 'SystemControls':
        module = await import('./SystemControls.svelte');
        break;
      case 'Lifeline':
        module = await import('./Lifeline.svelte');
        break;
      case 'OvernightLearnings':
        module = await import('./OvernightLearnings.svelte');
        break;
      case 'SystemSettings':
        module = await import('./SystemSettings.svelte');
        break;
      case 'BackendSettings':
        module = await import('./BackendSettings.svelte');
        break;
      case 'SecuritySettings':
        module = await import('./SecuritySettings.svelte');
        break;
      case 'NetworkServerSettings':
        module = await import('./NetworkServerSettings.svelte');
        break;
      case 'ChatSettings':
        module = await import('./ChatSettings.svelte');
        break;
      case 'MemoryEditor':
        module = await import('./MemoryEditor.svelte');
        break;
      case 'PersonaGenerator':
        module = await import('./PersonaGenerator.svelte');
        break;
      case 'PersonaEditor':
        module = await import('./PersonaEditor.svelte');
        break;
      case 'AddonsManager':
        module = await import('./AddonsManager.svelte');
        break;
      case 'SchedulerSettings':
        module = await import('./SchedulerSettings.svelte');
        break;
      case 'ProfileLocation':
        module = await import('./ProfileLocation.svelte');
        break;
      case 'TerminalManager':
        module = await import('./TerminalManager.svelte');
        break;
      case 'AgencyDashboard':
        module = await import('./AgencyDashboard.svelte');
        break;
      case 'ActiveOperatorDashboard':
        module = await import('./ActiveOperatorDashboard.svelte');
        break;
      case 'UnifiedQueueDashboard':
        module = await import('./UnifiedQueueDashboard.svelte');
        break;
      case 'SystemCoderDashboard':
        module = await import('./SystemCoderDashboard.svelte');
        break;
      default:
        throw new Error(`Unknown component: ${name}`);
    }

    const component = module.default;
    componentCache.set(name, component);
    return component;
  }

  // Memory/Events (loaded from /api/memories)
  type EventItem = {
    id: string
    timestamp: string
    content: string
    tags?: string[]
    entities?: string[]
    links?: Array<{ type: string; target: string }>
    relPath: string
    validation?: { status?: 'correct' | 'incorrect'; by?: string; timestamp?: string }
    type?: string
  }

let events: EventItem[] = []
let tasksTab: Array<{ id: string; title: string; status: string; priority?: string; updated?: string; relPath: string }> = []
let curatedTab: Array<{ name: string; relPath: string }> = []
let aiIngestorMemories: EventItem[] = []
let audioTranscriptMemories: EventItem[] = []
let dreamMemories: EventItem[] = [];
let reflectionMemories: EventItem[] = [];
let prunedMemories: EventItem[] = [];
let curiosityQuestionsTab: Array<{ id: string; question: string; status: string; askedAt: string; relPath: string; seedMemories?: string[]; answeredAt?: string }> = []
let functionMemories: Array<{
  id: string
  title: string
  summary: string
  trustLevel: 'draft' | 'verified'
  usageCount: number
  qualityScore?: number
  createdAt: string
  skillsUsed: string[]
}> = []
let loadingEvents = false
let eventsError: string | null = null

// Pagination and search state
let searchQuery = ''
let currentPage = 1
const itemsPerPage = 50

let personaTab: 'editor' | 'memory' | 'generator' = 'editor'
let memoryTab: 'episodic' | 'reflections' | 'tasks' | 'curated' | 'ai-ingestor' | 'audio' | 'dreams' | 'curiosity' | 'functions' | 'pruned' = 'episodic'
let voiceTab: 'upload' | 'training' | 'settings' = 'upload'
let trainingTab: 'wizard' | 'datasets' | 'manage' | 'system' | 'monitor' | 'adapters' = 'wizard'
let systemTab: 'chat' | 'lifeline' | 'settings' | 'security' | 'network' | 'storage' | 'addons' | 'scheduler' = 'settings'
let dashboardTab: 'overview' | 'tasks' | 'approvals' | 'operator' | 'queue' = 'overview'
let currentVoiceProvider: 'piper' | 'sovits' | 'rvc' = 'rvc'


// Legacy expansion state (no longer used but kept to prevent errors)
let expanded: Record<string, boolean> = {}
type MemoryContentState = { status: 'idle' | 'loading' | 'ready' | 'error'; content?: string; error?: string }
let memoryContent: Record<string, MemoryContentState> = {}

// Memory Editor state
let editorOpen = false
let editorRelPath = ''
let editorMemoryType = 'Memory'

// Persona form removed - now using PersonaEditor component

async function loadVoiceProvider() {
  try {
    const res = await apiFetch('/api/voice-settings');
    if (res.ok) {
      const data = await res.json();
      currentVoiceProvider = data.provider || 'rvc';
    }
  } catch (e) {
    console.error('[CenterContent] Error loading voice provider:', e);
  }
}


async function loadEvents() {
  if ($activeView !== 'persona' || personaTab !== 'memory') return;

  loadingEvents = true;
  eventsError = null;
    try {
      // Load all memories (limit=0 means no limit, client-side pagination handles display)
      const res = await apiFetch('/api/memories_all?limit=0');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const episodicEvents = Array.isArray(data.episodic) ? data.episodic : [];
      const reflections = Array.isArray(data.reflections) ? data.reflections : [];
      const dreams = Array.isArray(data.dreams) ? data.dreams : [];
      const pruned = Array.isArray(data.pruned) ? data.pruned : [];
      tasksTab = Array.isArray(data.tasks) ? data.tasks : [];
      curatedTab = Array.isArray(data.curated) ? data.curated : [];
      curiosityQuestionsTab = Array.isArray(data.curiosityQuestions) ? data.curiosityQuestions : [];

      // DEBUG: Log all fetched events
      console.log('--- Memory Buckets Fetched ---', { episodicEvents, reflections, dreams, pruned });

      events = episodicEvents;
      reflectionMemories = reflections;
      dreamMemories = dreams;
      prunedMemories = pruned;

      // Filter for AI Ingestor memories (those with 'ingested' or 'ai' tags, or with source links)
      aiIngestorMemories = events.filter(event => 
        (event.tags && (event.tags.includes('ingested') || event.tags.includes('ai'))) ||
        (event.links && event.links.some(link => link.type === 'source'))
      );
      
      // Filter for Audio Transcript memories (those with 'audio' or 'transcript' tags)
      audioTranscriptMemories = events.filter(event => 
        event.tags && (event.tags.includes('audio') || event.tags.includes('transcript'))
      );
      
      // DEBUG: Log filtered audio memories
      console.log('--- Filtered Audio Memories ---', audioTranscriptMemories);

      const visibleItems = [
        ...events,
        ...reflectionMemories,
        ...aiIngestorMemories,
        ...audioTranscriptMemories,
        ...dreamMemories,
      ];
      const validKeys = new Set(
        visibleItems
          .map((item) => getEventKey(item))
          .filter((key): key is string => Boolean(key))
      );
      expanded = Object.fromEntries(
        Object.entries(expanded).filter(([key]) => validKeys.has(key))
      );
      memoryContent = Object.fromEntries(
        Object.entries(memoryContent).filter(([key]) => validKeys.has(key))
      );
      
    } catch (err) {
      console.error('Failed to load events:', err);
      eventsError = (err as Error).message;
    } finally {
      loadingEvents = false;
  }
}

async function loadFunctions() {
  try {
    const res = await apiFetch('/api/functions?sortBy=qualityScore&sortOrder=desc');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    functionMemories = Array.isArray(data.functions) ? data.functions : [];
  } catch (err) {
    console.error('Failed to load functions:', err);
    eventsError = (err as Error).message;
  }
}

$: if ($activeView === 'persona' && personaTab === 'memory') {
  loadEvents();
  loadFunctions();
}


$: if ($activeView === 'voice' && voiceTab === 'training') {
  loadVoiceProvider();
}

// Reset sub-tabs when navigating away from parent views
$: if ($activeView !== 'persona') {
  personaTab = 'editor';
}

$: if ($activeView !== 'voice') {
  voiceTab = 'upload';
}

$: if ($activeView !== 'training') {
  trainingTab = 'datasets';
}

$: if ($activeView !== 'system') {
  systemTab = 'settings';
}

$: if ($activeView !== 'dashboard') {
  dashboardTab = 'overview';
}

// Reset pagination when switching tabs or searching
$: if (memoryTab || searchQuery !== undefined) {
  currentPage = 1;
}

// Filter function for memories
function filterMemories<T extends { content?: string; tags?: string[]; timestamp?: string }>(items: T[], query: string): T[] {
  if (!query.trim()) return items;
  const q = query.toLowerCase();
  return items.filter(item => {
    const content = (item.content || '').toLowerCase();
    const tags = (item.tags || []).join(' ').toLowerCase();
    return content.includes(q) || tags.includes(q);
  });
}

// Paginate function
function paginate<T>(items: T[], page: number, perPage: number): T[] {
  const start = (page - 1) * perPage;
  return items.slice(start, start + perPage);
}

// Filtered and paginated episodic events
$: filteredEvents = filterMemories(events, searchQuery);
$: paginatedEvents = paginate(filteredEvents, currentPage, itemsPerPage);
$: totalEpisodicPages = Math.ceil(filteredEvents.length / itemsPerPage);

// Filtered and paginated reflections
$: filteredReflections = filterMemories(reflectionMemories, searchQuery);
$: paginatedReflections = paginate(filteredReflections, currentPage, itemsPerPage);
$: totalReflectionPages = Math.ceil(filteredReflections.length / itemsPerPage);

// Filtered and paginated dreams
$: filteredDreams = filterMemories(dreamMemories, searchQuery);
$: paginatedDreams = paginate(filteredDreams, currentPage, itemsPerPage);
$: totalDreamPages = Math.ceil(filteredDreams.length / itemsPerPage);

// Filtered and paginated pruned
$: filteredPruned = filterMemories(prunedMemories, searchQuery);
$: paginatedPruned = paginate(filteredPruned, currentPage, itemsPerPage);
$: totalPrunedPages = Math.ceil(filteredPruned.length / itemsPerPage);

// Filtered and paginated AI ingestor
$: filteredAiIngestor = filterMemories(aiIngestorMemories, searchQuery);
$: paginatedAiIngestor = paginate(filteredAiIngestor, currentPage, itemsPerPage);
$: totalAiIngestorPages = Math.ceil(filteredAiIngestor.length / itemsPerPage);

// Filtered and paginated audio
$: filteredAudio = filterMemories(audioTranscriptMemories, searchQuery);
$: paginatedAudio = paginate(filteredAudio, currentPage, itemsPerPage);
$: totalAudioPages = Math.ceil(filteredAudio.length / itemsPerPage);

// Get current page info based on active memory tab
$: currentTotalPages = (() => {
  switch (memoryTab) {
    case 'episodic': return totalEpisodicPages;
    case 'reflections': return totalReflectionPages;
    case 'dreams': return totalDreamPages;
    case 'pruned': return totalPrunedPages;
    case 'ai-ingestor': return totalAiIngestorPages;
    case 'audio': return totalAudioPages;
    default: return 1;
  }
})();

$: currentTotalItems = (() => {
  switch (memoryTab) {
    case 'episodic': return filteredEvents.length;
    case 'reflections': return filteredReflections.length;
    case 'dreams': return filteredDreams.length;
    case 'pruned': return filteredPruned.length;
    case 'ai-ingestor': return filteredAiIngestor.length;
    case 'audio': return filteredAudio.length;
    default: return 0;
  }
})();

// loadPersonaCore and savePersonaCore removed - now using PersonaEditor component

function getEventKey(item: { relPath?: string; id?: string; name?: string }): string | null {
  if (item.relPath) return item.relPath;
  if (item.id) return item.id;
  if ('name' in item && typeof item.name === 'string') return item.name;
  return null;
}

function toggleExpanded(item: { relPath?: string; id?: string; name?: string }) {
  const key = getEventKey(item);
  console.log('[toggleExpanded]', { key, item, currentlyExpanded: expanded[key || ''] });
  if (!key) return;
  const next = !expanded[key];
  // REASSIGN to trigger Svelte reactivity
  expanded = { ...expanded, [key]: next };
  console.log('[toggleExpanded] Updated expanded state:', { key, next, hasRelPath: !!item.relPath });
  if (next && item.relPath) {
    console.log('[toggleExpanded] Loading memory content for:', item.relPath);
    loadMemoryContent(item.relPath);
  }
}

function getPreview(content = '', limit = 160): string {
  if (!content) return '';
  return content.length > limit ? `${content.slice(0, limit)}…` : content;
}

// Map dialogueSource identifiers to friendly display labels
function formatDialogueSource(source: string): string {
  const labels: Record<string, string> = {
    'lizard-brain': '⚡ Lizard Brain',
    'agency-system': '📋 Agency',
    'reflector': '💭 Reflection',
    'curiosity': '❓ Curiosity',
    'dreamer': '🌙 Dream',
  };
  return labels[source] || source;
}

function openMemoryEditor(relPath: string, type: string = 'Memory') {
  editorRelPath = relPath
  editorMemoryType = type
  editorOpen = true
}

function handleEditorSaved() {
  // Reload memories to reflect changes
  loadEvents()
}

async function loadMemoryContent(relPath: string) {
  let current = memoryContent[relPath];
  if (current && (current.status === 'loading' || current.status === 'ready')) return;

  if (!current) {
    current = { status: 'loading' };
    memoryContent = { ...memoryContent, [relPath]: current };
  } else {
    current.status = 'loading';
    delete current.error;
    delete current.content;
    memoryContent = { ...memoryContent };
  }

  try {
    const res = await apiFetch(`/api/memory-content?relPath=${encodeURIComponent(relPath)}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data?.error || 'Failed to load memory content');
    }

    current.status = 'ready';
    current.content = data.content;
    memoryContent = { ...memoryContent };
  } catch (error) {
    current.status = 'error';
    current.error = (error as Error).message;
    delete current.content;
    memoryContent = { ...memoryContent };
  }
}

// Removed reactive persona loading - now handled by PersonaEditor component

  // Memory validation
  let saving: Record<string, boolean> = {}
  let deleting: Record<string, boolean> = {}
  async function setValidation(item: EventItem, status: 'correct' | 'incorrect') {
    if (saving[item.relPath]) return
    saving = { ...saving, [item.relPath]: true }
    try {
      const res = await apiFetch('/api/memories/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ relPath: item.relPath, status })
      })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to set validation')
      // update local state
      item.validation = { status }
    } catch (e) {
      console.error(e)
      alert((e as Error).message)
    } finally {
      saving = { ...saving, [item.relPath]: false }
    }
  }

  async function deleteMemory(item: EventItem) {
    if (deleting[item.relPath]) return
    deleting = { ...deleting, [item.relPath]: true }
    try {
      const res = await apiFetch('/api/memories/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ relPath: item.relPath })
      })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to delete memory')
      events = events.filter(e => e.relPath !== item.relPath)
    } catch (e) {
      console.error(e)
      alert((e as Error).message)
    } finally {
      deleting = { ...deleting, [item.relPath]: false }
    }
  }

  function onMinusClick(item: EventItem) {
    // Fast delete without confirmation per user request
    void deleteMemory(item)
  }

  // Lazy component loading helper
  type LoadedComponent = { component: typeof SvelteComponent; props?: any } | null;
  let loadedComponents: Record<string, LoadedComponent> = {};

  // Reactive loader for current view's components
  $: if ($activeView && $activeView !== 'chat') {
    // Pre-load components for the active view to avoid flash
    switch ($activeView) {
      case 'dashboard':
        void loadComponent('Dashboard');
        void loadComponent('TaskManager');
        void loadComponent('ApprovalQueue');
        break;
      case 'voice':
        void loadComponent('AudioUpload');
        void loadComponent('AudioRecorder');
        void loadComponent('VoiceTrainingWidget');
        void loadComponent('VoiceSettings');
        break;
      case 'training':
        void loadComponent('TrainingWizard');
        void loadComponent('TrainingHistory');
        void loadComponent('DatasetManagement');
        void loadComponent('SystemControls');
        void loadComponent('TrainingMonitor');
        break;
      case 'persona':
        void loadComponent('PersonaEditor');
        void loadComponent('MemoryControls');
        void loadComponent('PersonaGenerator');
        break;
      case 'system':
        void loadComponent('ChatSettings');
        void loadComponent('SystemSettings');
        void loadComponent('SecuritySettings');
        void loadComponent('ProfileLocation');
        void loadComponent('NetworkServerSettings');
        void loadComponent('AddonsManager');
        void loadComponent('Lifeline');
        void loadComponent('SchedulerSettings');
        break;
      case 'terminal':
        void loadComponent('TerminalManager');
        break;
      case 'projects':
        void loadComponent('ProjectDashboard');
        break;
    }
  }

  // Helper to render a lazy-loaded component
  async function getLazyComponent(name: string, props?: any): Promise<LoadedComponent> {
    const key = `${name}-${JSON.stringify(props || {})}`;
    if (loadedComponents[key]) {
      return loadedComponents[key];
    }

    const component = await loadComponent(name);
    const loaded = { component, props };
    loadedComponents = { ...loadedComponents, [key]: loaded };
    return loaded;
  }

  </script>

<div class="flex flex-col h-full w-full overflow-hidden">
  {#if $activeView === 'chat'}
    <ChatInterface />
  {:else if $activeView === 'dashboard'}
    <div class="view-container">
      <div class="view-header">
        <h2 class="view-title">📊 Dashboard</h2>
        <p class="view-subtitle">Overview, tasks & approvals</p>
      </div>
      <div class="view-content">
        <div class="tab-group">
          <button class="tab-button {dashboardTab === 'overview' ? 'active' : ''}" on:click={() => dashboardTab = 'overview'}>Overview</button>
          <button class="tab-button {dashboardTab === 'tasks' ? 'active' : ''}" on:click={() => dashboardTab = 'tasks'}>Tasks</button>
          <button class="tab-button {dashboardTab === 'approvals' ? 'active' : ''}" on:click={() => dashboardTab = 'approvals'}>Approvals</button>
          <button class="tab-button {dashboardTab === 'operator' ? 'active' : ''}" on:click={() => dashboardTab = 'operator'}>Active Operator</button>
          <button class="tab-button {dashboardTab === 'queue' ? 'active' : ''}" on:click={() => dashboardTab = 'queue'}>Queue Lanes</button>
        </div>
        {#if dashboardTab === 'overview'}
          {#await loadComponent('Dashboard')}
            <div class="flex items-center justify-center p-8 text-gray-400 dark:text-gray-500 text-sm animate-pulse">Loading dashboard...</div>
          {:then Component}
            <svelte:component this={Component} />
          {/await}
        {:else if dashboardTab === 'tasks'}
          {#await loadComponent('TaskManager')}
            <div class="flex items-center justify-center p-8 text-gray-400 dark:text-gray-500 text-sm animate-pulse">Loading tasks...</div>
          {:then Component}
            <svelte:component this={Component} />
          {/await}
        {:else if dashboardTab === 'approvals'}
          {#await loadComponent('ApprovalQueue')}
            <div class="flex items-center justify-center p-8 text-gray-400 dark:text-gray-500 text-sm animate-pulse">Loading approvals...</div>
          {:then Component}
            <svelte:component this={Component} />
          {/await}
        {:else if dashboardTab === 'operator'}
          {#await loadComponent('ActiveOperatorDashboard')}
            <div class="flex items-center justify-center p-8 text-gray-400 dark:text-gray-500 text-sm animate-pulse">Loading active operator...</div>
          {:then Component}
            <svelte:component this={Component} />
          {/await}
        {:else if dashboardTab === 'queue'}
          {#await loadComponent('UnifiedQueueDashboard')}
            <div class="flex items-center justify-center p-8 text-gray-400 dark:text-gray-500 text-sm animate-pulse">Loading queue lanes...</div>
          {:then Component}
            <svelte:component this={Component} />
          {/await}
        {/if}
      </div>
    </div>
  {:else if $activeView === 'voice'}
    <div class="view-container">
      <div class="view-header">
        <h2 class="view-title">🎤 Voice</h2>
        <p class="view-subtitle">Audio upload, transcription & voice training</p>
      </div>
      <div class="view-content">
        <div class="tab-group">
          <button class="tab-button {voiceTab === 'upload' ? 'active' : ''}" on:click={() => voiceTab = 'upload'}>Upload & Transcribe</button>
          <button class="tab-button {voiceTab === 'training' ? 'active' : ''}" on:click={() => { voiceTab = 'training'; loadVoiceProvider(); }}>Voice Clone Training</button>
          <button class="tab-button {voiceTab === 'settings' ? 'active' : ''}" on:click={() => voiceTab = 'settings'}>Voice Settings</button>
        </div>
        {#if voiceTab === 'upload'}
          <div class="grid grid-cols-2 gap-4">
            {#await loadComponent('AudioUpload')}
              <div class="flex items-center justify-center p-8 text-gray-400 dark:text-gray-500 text-sm animate-pulse">Loading...</div>
            {:then Component}
              <svelte:component this={Component} />
            {/await}
            {#await loadComponent('AudioRecorder')}
              <div class="flex items-center justify-center p-8 text-gray-400 dark:text-gray-500 text-sm animate-pulse">Loading...</div>
            {:then Component}
              <svelte:component this={Component} />
            {/await}
          </div>
        {:else if voiceTab === 'training'}
          {#await loadComponent('VoiceTrainingWidget')}
            <div class="flex items-center justify-center p-8 text-gray-400 dark:text-gray-500 text-sm animate-pulse">Loading voice training...</div>
          {:then Component}
            <svelte:component this={Component} provider={currentVoiceProvider} />
          {/await}
        {:else if voiceTab === 'settings'}
          {#await loadComponent('VoiceSettings')}
            <div class="flex items-center justify-center p-8 text-gray-400 dark:text-gray-500 text-sm animate-pulse">Loading settings...</div>
          {:then Component}
            <svelte:component this={Component} />
          {/await}
        {/if}
      </div>
    </div>
  {:else if $activeView === 'training'}
    <div class="view-container">
      <div class="view-header">
        <h2 class="view-title">🧠 AI Training</h2>
        <p class="view-subtitle">LoRA datasets, training & adapters</p>
      </div>
      <div class="view-content">
        <div class="tab-group">
          <button class="tab-button {trainingTab === 'wizard' ? 'active' : ''}" on:click={() => trainingTab = 'wizard'}>🧙 Training Wizard</button>
          <button class="tab-button {trainingTab === 'datasets' ? 'active' : ''}" on:click={() => trainingTab = 'datasets'}>📜 Training History</button>
          <button class="tab-button {trainingTab === 'manage' ? 'active' : ''}" on:click={() => trainingTab = 'manage'}>📊 Dataset Management</button>
          <button class="tab-button {trainingTab === 'system' ? 'active' : ''}" on:click={() => trainingTab = 'system'}>⚙️ System Controls</button>
          <button class="tab-button {trainingTab === 'monitor' ? 'active' : ''}" on:click={() => trainingTab = 'monitor'}>📡 Training Monitor</button>
        </div>
        {#if trainingTab === 'wizard'}
          {#await loadComponent('TrainingWizard')}
            <div class="flex items-center justify-center p-8 text-gray-400 dark:text-gray-500 text-sm animate-pulse">Loading training wizard...</div>
          {:then Component}
            <svelte:component this={Component} />
          {/await}
        {:else if trainingTab === 'datasets'}
          {#await loadComponent('TrainingHistory')}
            <div class="flex items-center justify-center p-8 text-gray-400 dark:text-gray-500 text-sm animate-pulse">Loading training history...</div>
          {:then Component}
            <svelte:component this={Component} />
          {/await}
        {:else if trainingTab === 'manage'}
          {#await loadComponent('DatasetManagement')}
            <div class="flex items-center justify-center p-8 text-gray-400 dark:text-gray-500 text-sm animate-pulse">Loading dataset management...</div>
          {:then Component}
            <svelte:component this={Component} />
          {/await}
        {:else if trainingTab === 'system'}
          {#await loadComponent('SystemControls')}
            <div class="flex items-center justify-center p-8 text-gray-400 dark:text-gray-500 text-sm animate-pulse">Loading system controls...</div>
          {:then Component}
            <svelte:component this={Component} />
          {/await}
        {:else if trainingTab === 'monitor'}
          {#await loadComponent('TrainingMonitor')}
            <div class="flex items-center justify-center p-8 text-gray-400 dark:text-gray-500 text-sm animate-pulse">Loading training monitor...</div>
          {:then Component}
            <svelte:component this={Component} />
          {/await}
        {/if}
      </div>
    </div>
  {:else if $activeView === 'persona'}
    <div class="view-container">
      <div class="view-header">
        <h2 class="view-title">👤 Persona</h2>
        <p class="view-subtitle">Identity, personality & memory</p>
      </div>
      <div class="view-content">
        <div class="tab-group">
          <button class="tab-button {personaTab==='editor' ? 'active' : ''}" on:click={() => personaTab='editor'}>Editor</button>
          <button class="tab-button {personaTab==='memory' ? 'active' : ''}" on:click={() => personaTab='memory'}>Memory</button>
          <button class="tab-button {personaTab==='generator' ? 'active' : ''}" on:click={() => personaTab='generator'}>Generator</button>
        </div>
        {#if personaTab === 'editor'}
          <div class="h-[calc(100vh-200px)] min-h-[500px] overflow-hidden">
            {#await loadComponent('PersonaEditor')}
              <div class="flex items-center justify-center p-8 text-gray-400 dark:text-gray-500 text-sm animate-pulse">Loading persona editor...</div>
            {:then Component}
              <svelte:component this={Component} />
            {/await}
          </div>
        {:else if personaTab === 'memory'}
          <div class="memory-section">
            {#await loadComponent('MemoryControls')}
              <div class="flex items-center justify-center p-8 text-gray-400 dark:text-gray-500 text-sm animate-pulse">Loading memory controls...</div>
            {:then Component}
              <svelte:component this={Component} on:captured={loadEvents} />
            {/await}
          </div>
          <div class="tab-group">
            <button class="tab-button {memoryTab==='episodic' ? 'active' : ''}" on:click={() => memoryTab='episodic'}>Episodic</button>
            <button class="tab-button {memoryTab==='reflections' ? 'active' : ''}" on:click={() => memoryTab='reflections'}>Reflections</button>
            <button class="tab-button {memoryTab==='tasks' ? 'active' : ''}" on:click={() => memoryTab='tasks'}>Tasks</button>
            <button class="tab-button {memoryTab==='curated' ? 'active' : ''}" on:click={() => memoryTab='curated'}>Curated</button>
            <button class="tab-button {memoryTab==='ai-ingestor' ? 'active' : ''}" on:click={() => memoryTab='ai-ingestor'}>AI Ingestor</button>
            <button class="tab-button {memoryTab==='audio' ? 'active' : ''}" on:click={() => memoryTab='audio'}>Audio</button>
            <button class="tab-button {memoryTab==='dreams' ? 'active' : ''}" on:click={() => memoryTab='dreams'}>Dreams 💭</button>
            <button class="tab-button {memoryTab==='curiosity' ? 'active' : ''}" on:click={() => memoryTab='curiosity'}>Curiosity ❓</button>
            <button class="tab-button {memoryTab==='functions' ? 'active' : ''}" on:click={() => memoryTab='functions'}>Functions 🔧</button>
            <button class="tab-button {memoryTab==='pruned' ? 'active' : ''}" on:click={() => memoryTab='pruned'}>Pruned 🗑️</button>
          </div>

          <!-- Search and Pagination Controls -->
          {#if !['tasks', 'curated', 'curiosity', 'functions'].includes(memoryTab)}
            <div class="flex justify-between items-center gap-4 mb-4 p-3 bg-black/[0.02] dark:bg-white/[0.03] rounded-lg border border-black/[0.06] dark:border-white/[0.08]">
              <div class="relative flex-1 max-w-[400px]">
                <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="11" cy="11" r="8"/>
                  <path d="m21 21-4.35-4.35"/>
                </svg>
                <input
                  type="text"
                  placeholder="Search memories..."
                  bind:value={searchQuery}
                  class="w-full py-2 pl-9 pr-8 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 transition-all focus:outline-none focus:border-violet-600 focus:ring-[3px] focus:ring-violet-600/10"
                />
                {#if searchQuery}
                  <button class="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 border-none bg-gray-200 dark:bg-gray-600 rounded-full cursor-pointer text-sm text-gray-500 dark:text-gray-400 flex items-center justify-center hover:bg-gray-300 dark:hover:bg-gray-500" on:click={() => searchQuery = ''}>×</button>
                {/if}
              </div>
              <div class="flex items-center gap-2">
                {#if currentTotalItems > 0}
                  <span class="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    {currentTotalItems} {currentTotalItems === 1 ? 'memory' : 'memories'}
                    {#if searchQuery}(filtered){/if}
                  </span>
                {/if}
              </div>
            </div>

            {#if currentTotalPages > 1}
              <div class="flex justify-center items-center gap-2 mb-4 p-2 bg-black/[0.02] dark:bg-white/[0.03] rounded-lg">
                <button
                  class="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-sm font-medium cursor-pointer transition-all hover:enabled:bg-gray-100 dark:hover:enabled:bg-gray-700 hover:enabled:border-gray-400 dark:hover:enabled:border-gray-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  on:click={() => currentPage = 1}
                  disabled={currentPage === 1}
                  title="First page"
                >««</button>
                <button
                  class="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-sm font-medium cursor-pointer transition-all hover:enabled:bg-gray-100 dark:hover:enabled:bg-gray-700 hover:enabled:border-gray-400 dark:hover:enabled:border-gray-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  on:click={() => currentPage = Math.max(1, currentPage - 1)}
                  disabled={currentPage === 1}
                  title="Previous page"
                >«</button>

                <span class="px-3 text-sm text-gray-600 dark:text-gray-400 font-medium">
                  Page {currentPage} of {currentTotalPages}
                </span>

                <button
                  class="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-sm font-medium cursor-pointer transition-all hover:enabled:bg-gray-100 dark:hover:enabled:bg-gray-700 hover:enabled:border-gray-400 dark:hover:enabled:border-gray-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  on:click={() => currentPage = Math.min(currentTotalPages, currentPage + 1)}
                  disabled={currentPage === currentTotalPages}
                  title="Next page"
                >»</button>
                <button
                  class="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-sm font-medium cursor-pointer transition-all hover:enabled:bg-gray-100 dark:hover:enabled:bg-gray-700 hover:enabled:border-gray-400 dark:hover:enabled:border-gray-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  on:click={() => currentPage = currentTotalPages}
                  disabled={currentPage === currentTotalPages}
                  title="Last page"
                >»»</button>
              </div>
            {/if}
          {/if}

          {#if loadingEvents}
          <div class="loading-state">Loading memories...</div>
        {:else if eventsError}
          <div class="empty-state">
            <div class="empty-icon">⚠️</div>
            <div class="empty-title">Failed to load memories</div>
            <div class="empty-description">{eventsError}</div>
          </div>
        {:else if memoryTab==='episodic' && events.length === 0}
          <div class="empty-state">
            <div class="empty-icon">🧩</div>
            <div class="empty-title">No memories yet</div>
            <div class="empty-description">
              Capture observations using the <code>mh capture</code> command
            </div>
          </div>
        {:else if memoryTab==='episodic'}
          <div class="flex flex-col gap-4">
            {#each paginatedEvents as event}
              {@const key = getEventKey(event)}
              {@const isOpen = key ? !!expanded[key] : false}
              <div class="event-card">
                <div class="event-card-header">
                  <button
                    class="flex-1 flex items-center gap-2 bg-transparent border-0 p-0 m-0 cursor-pointer text-left font-[inherit] focus-visible:outline-2 focus-visible:outline-blue-500/60 focus-visible:outline-offset-2"
                    type="button"
                    on:click={() => toggleExpanded(event)}
                    aria-expanded={isOpen}
                  >
                    <span class="event-card-title">{getPreview(event.content)}</span>
                    <span class="text-xs text-gray-500 dark:text-gray-400" aria-hidden="true">{isOpen ? '▲' : '▼'}</span>
                    <span class="sr-only">{isOpen ? 'Collapse memory' : 'Expand memory'}</span>
                  </button>
                  <div class="flex gap-1">
                    <button class="w-7 h-7 rounded-md border border-blue-600/30 bg-white dark:bg-white/5 font-bold cursor-pointer transition-all hover:scale-105 hover:bg-blue-50 dark:hover:bg-blue-900/20 text-blue-600 disabled:opacity-50 disabled:cursor-not-allowed" title="Edit memory" on:click|stopPropagation={() => openMemoryEditor(event.relPath, 'Memory')}>
                      <svg class="w-3 h-3 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
                      </svg>
                    </button>
                    <button class="w-7 h-7 rounded-md border border-green-600/30 bg-white dark:bg-white/5 font-bold cursor-pointer transition-all hover:scale-105 hover:bg-green-50 dark:hover:bg-green-900/20 text-green-600 disabled:opacity-50 disabled:cursor-not-allowed" title="Mark as correct" on:click={() => setValidation(event, 'correct')} disabled={saving[event.relPath] || event.validation?.status === 'correct'}>+
                    </button>
                    <button class="w-7 h-7 rounded-md border border-red-600/30 bg-white dark:bg-white/5 font-bold cursor-pointer transition-all hover:scale-105 hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 disabled:opacity-50 disabled:cursor-not-allowed" title="Delete memory" on:click={() => onMinusClick(event)} disabled={deleting[event.relPath]}>−
                    </button>
                  </div>
                </div>
                {#if isOpen}
                  {#if event.relPath}
                    {#if memoryContent[event.relPath]?.status === 'loading'}
                      <div class="event-body loading">Loading full memory…</div>
                    {:else if memoryContent[event.relPath]?.status === 'error'}
                      <div class="event-body error">Failed to load memory: {memoryContent[event.relPath]?.error}</div>
                    {:else}
                      <div class="event-body">
                        <pre>{memoryContent[event.relPath]?.content ?? event.content}</pre>
                      </div>
                    {/if}
                  {:else}
                    <div class="event-body">
                      <pre>{event.content}</pre>
                    </div>
                  {/if}
                {/if}
                <div class="event-card-meta">
                  <div class="event-card-time">{new Date(event.timestamp).toLocaleString()}</div>
                  {#if event.validation?.status}
                    <div class="event-valid {event.validation.status}">{event.validation.status}</div>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        {:else if memoryTab==='reflections'}
          <div class="events-list">
            {#if reflectionMemories.length === 0}
              <div class="empty-state">
                <div class="empty-icon">🪞</div>
                <div class="empty-title">No reflections yet</div>
                <div class="empty-description">
                  Reflections are generated by the boredom service and reflector agent. Trigger the reflector to populate this section.
                </div>
              </div>
            {:else}
              {#each paginatedReflections as event}
                {@const key = getEventKey(event)}
                {@const isOpen = key ? !!expanded[key] : false}
                {@const displayColor = event.metadata?.displayColor || ''}
                {@const dialogueSource = event.metadata?.dialogueSource || ''}
                <div class="event-card">
                  <div class="event-card-header">
                    <button
                      class="event-title-button"
                      type="button"
                      on:click={() => toggleExpanded(event)}
                      aria-expanded={isOpen}
                    >
                      {#if dialogueSource}
                        <span class="dialogue-source-badge" style={displayColor ? `background-color: ${displayColor}` : ''}>{formatDialogueSource(dialogueSource)}</span>
                      {/if}
                      <span class="event-card-title" style={displayColor ? `color: ${displayColor}` : ''}>{getPreview(event.content)}</span>
                      <span class="event-toggle-icon" aria-hidden="true">{isOpen ? '▲' : '▼'}</span>
                      <span class="sr-only">{isOpen ? 'Collapse memory' : 'Expand memory'}</span>
                    </button>
                    <div class="validation-controls">
                      <button class="val-btn edit" title="Edit reflection" on:click|stopPropagation={() => openMemoryEditor(event.relPath, 'Reflection')}>
                        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
                        </svg>
                      </button>
                      <button class="val-btn good" title="Mark as correct" on:click={() => setValidation(event, 'correct')} disabled={saving[event.relPath] || event.validation?.status === 'correct'}>+
                      </button>
                      <button class="val-btn bad" title="Delete memory" on:click={() => onMinusClick(event)} disabled={deleting[event.relPath]}>−
                      </button>
                    </div>
                  </div>
                  {#if isOpen}
                    {#if event.relPath}
                      {#if memoryContent[event.relPath]?.status === 'loading'}
                        <div class="event-body loading">Loading reflection…</div>
                      {:else if memoryContent[event.relPath]?.status === 'error'}
                        <div class="event-body error">Failed to load reflection: {memoryContent[event.relPath]?.error}</div>
                      {:else}
                        <div class="event-body">
                          <pre>{memoryContent[event.relPath]?.content ?? event.content}</pre>
                        </div>
                      {/if}
                    {:else}
                      <div class="event-body">
                        <pre>{event.content}</pre>
                      </div>
                    {/if}
                  {/if}
                  <div class="event-card-meta">
                    <div class="event-card-time">{new Date(event.timestamp).toLocaleString()}</div>
                    {#if event.validation?.status}
                      <div class="event-valid {event.validation.status}">{event.validation.status}</div>
                    {/if}
                  </div>
                </div>
              {/each}
            {/if}
          </div>
        {:else if memoryTab==='tasks'}
          <div class="events-list">
            {#each tasksTab as t}
              {@const key = getEventKey(t)}
              {@const isOpen = key ? !!expanded[key] : false}
              <div class="event-card">
                <div class="event-card-header">
                  <button
                    class="event-title-button"
                    type="button"
                    on:click={() => toggleExpanded(t)}
                    aria-expanded={isOpen}
                  >
                    <span class="event-card-title">{getPreview(t.title, 200)}</span>
                    <span class="event-toggle-icon" aria-hidden="true">{isOpen ? '▲' : '▼'}</span>
                    <span class="sr-only">{isOpen ? 'Collapse memory' : 'Expand memory'}</span>
                  </button>
                </div>
                {#if isOpen}
                  {#if t.relPath}
                    {#if memoryContent[t.relPath]?.status === 'loading'}
                      <div class="event-body loading">Loading task content…</div>
                    {:else if memoryContent[t.relPath]?.status === 'error'}
                      <div class="event-body error">Failed to load task: {memoryContent[t.relPath]?.error}</div>
                    {:else}
                      <div class="event-body">
                        <pre>{memoryContent[t.relPath]?.content ?? JSON.stringify(t, null, 2)}</pre>
                      </div>
                    {/if}
                  {:else}
                    <div class="event-body">
                      <pre>{JSON.stringify(t, null, 2)}</pre>
                    </div>
                  {/if}
                {/if}
                <div class="event-card-meta">
                  <div class="event-card-time">{t.updated ? new Date(t.updated).toLocaleString() : ''}</div>
                  <div class="event-valid">{t.status}{t.priority ? ` • ${t.priority}` : ''}</div>
                </div>
              </div>
            {/each}
            {#if tasksTab.length === 0}
              <div class="empty-state"><div class="empty-title">No active tasks</div></div>
            {/if}
          </div>
        {:else if memoryTab==='curated'}
          <div class="events-list">
            {#each curatedTab as c}
              {@const key = getEventKey(c)}
              {@const isOpen = key ? !!expanded[key] : false}
              <div class="event-card">
                <div class="event-card-header">
                  <button
                    class="event-title-button"
                    type="button"
                    on:click={() => toggleExpanded(c)}
                    aria-expanded={isOpen}
                  >
                    <span class="event-card-title">{c.name}</span>
                    <span class="event-toggle-icon" aria-hidden="true">{isOpen ? '▲' : '▼'}</span>
                    <span class="sr-only">{isOpen ? 'Collapse memory' : 'Expand memory'}</span>
                  </button>
                </div>
                {#if isOpen}
                  {#if c.relPath}
                    {#if memoryContent[c.relPath]?.status === 'loading'}
                      <div class="event-body loading">Loading curated content…</div>
                    {:else if memoryContent[c.relPath]?.status === 'error'}
                      <div class="event-body error">Failed to load file: {memoryContent[c.relPath]?.error}</div>
                    {:else}
                      <div class="event-body">
                        <pre>{memoryContent[c.relPath]?.content ?? ''}</pre>
                      </div>
                    {/if}
                  {:else}
                    <div class="event-body">
                      <pre>No file path available for this entry.</pre>
                    </div>
                  {/if}
                {/if}
                <div class="event-card-meta">
                  <div class="event-card-time">{c.relPath}</div>
                </div>
              </div>
            {/each}
            {#if curatedTab.length === 0}
              <div class="empty-state"><div class="empty-title">No curated files</div></div>
            {/if}
          </div>
        {:else if memoryTab==='ai-ingestor'}
          <div class="events-list">
            {#if aiIngestorMemories.length === 0}
              <div class="empty-state">
                <div class="empty-icon">🤖</div>
                <div class="empty-title">No AI Ingestor memories</div>
                <div class="empty-description">
                  AI Ingestor memories are created when files are processed through the AI Ingestor agent.
                  Run the ingestor to create AI-processed memories from inbox files.
                </div>
              </div>
            {:else}
              {#each paginatedAiIngestor as event}
                {@const key = getEventKey(event)}
                {@const isOpen = key ? !!expanded[key] : false}
                <div class="event-card border-l-4 border-l-violet-600 dark:border-l-violet-400">
                  <div class="event-card-header">
                    <button
                      class="event-title-button"
                      type="button"
                      on:click={() => toggleExpanded(event)}
                      aria-expanded={isOpen}
                    >
                      <span class="event-card-title">{getPreview(event.content)}</span>
                      <span class="event-toggle-icon" aria-hidden="true">{isOpen ? '▲' : '▼'}</span>
                      <span class="sr-only">{isOpen ? 'Collapse memory' : 'Expand memory'}</span>
                    </button>
                    <div class="validation-controls">
                      <button class="val-btn good" title="Mark as correct" on:click={() => setValidation(event, 'correct')} disabled={saving[event.relPath] || event.validation?.status === 'correct'}>+
                      </button>
                      <button class="val-btn bad" title="Delete memory" on:click={() => onMinusClick(event)} disabled={deleting[event.relPath]}>−
                      </button>
                    </div>
                  </div>
                  {#if isOpen}
                    {#if event.relPath}
                      {#if memoryContent[event.relPath]?.status === 'loading'}
                        <div class="event-body loading">Loading AI ingestor memory…</div>
                      {:else if memoryContent[event.relPath]?.status === 'error'}
                        <div class="event-body error">Failed to load memory: {memoryContent[event.relPath]?.error}</div>
                      {:else}
                        <div class="event-body">
                          <pre>{memoryContent[event.relPath]?.content ?? event.content}</pre>
                        </div>
                      {/if}
                    {:else}
                      <div class="event-body">
                        <pre>{event.content}</pre>
                      </div>
                    {/if}
                  {/if}
                  <div class="event-card-meta">
                    <div class="event-card-time">{new Date(event.timestamp).toLocaleString()}</div>
                    {#if event.validation?.status}
                      <div class="event-valid {event.validation.status}">{event.validation.status}</div>
                    {/if}
                    {#if event.tags && event.tags.length > 0}
                      <div class="event-tags">
                        {#each event.tags as tag}
                          <span class="event-tag">{tag}</span>
                        {/each}
                      </div>
                    {/if}
                    {#if event.links && event.links.length > 0}
                      <div class="event-links">
                        {#each event.links as link}
                          <span class="event-link">{link.type}: {link.target}</span>
                        {/each}
                      </div>
                    {/if}
                  </div>
                </div>
              {/each}
            {/if}
          </div>
        {:else if memoryTab==='audio'}
          <div class="events-list">
            {#if audioTranscriptMemories.length === 0}
              <div class="empty-state">
                <div class="empty-icon">🎵</div>
                <div class="empty-title">No Audio Transcript memories</div>
                <div class="empty-description">
                  Audio transcript memories are created when audio files are processed and transcribed.
                  Upload audio files to create transcript memories.
                </div>
              </div>
            {:else}
              {#each paginatedAudio as event}
                {@const key = getEventKey(event)}
                {@const isOpen = key ? !!expanded[key] : false}
                <div class="event-card audio-transcript-card">
                  <div class="event-card-header">
                    <button
                      class="event-title-button"
                      type="button"
                      on:click={() => toggleExpanded(event)}
                      aria-expanded={isOpen}
                    >
                      <span class="event-card-title">{getPreview(event.content)}</span>
                      <span class="event-toggle-icon" aria-hidden="true">{isOpen ? '▲' : '▼'}</span>
                      <span class="sr-only">{isOpen ? 'Collapse memory' : 'Expand memory'}</span>
                    </button>
                    <div class="validation-controls">
                      <button class="val-btn good" title="Mark as correct" on:click={() => setValidation(event, 'correct')} disabled={saving[event.relPath] || event.validation?.status === 'correct'}>+
                      </button>
                      <button class="val-btn bad" title="Delete memory" on:click={() => onMinusClick(event)} disabled={deleting[event.relPath]}>−
                      </button>
                    </div>
                  </div>
                  {#if isOpen}
                    {#if event.relPath}
                      {#if memoryContent[event.relPath]?.status === 'loading'}
                        <div class="event-body loading">Loading audio transcript…</div>
                      {:else if memoryContent[event.relPath]?.status === 'error'}
                        <div class="event-body error">Failed to load transcript: {memoryContent[event.relPath]?.error}</div>
                      {:else}
                        <div class="event-body">
                          <pre>{memoryContent[event.relPath]?.content ?? event.content}</pre>
                        </div>
                      {/if}
                    {:else}
                      <div class="event-body">
                        <pre>{event.content}</pre>
                      </div>
                    {/if}
                  {/if}
                  <div class="event-card-meta">
                    <div class="event-card-time">{new Date(event.timestamp).toLocaleString()}</div>
                    {#if event.validation?.status}
                      <div class="event-valid {event.validation.status}">{event.validation.status}</div>
                    {/if}
                    {#if event.tags && event.tags.length > 0}
                      <div class="event-tags">
                        {#each event.tags as tag}
                          <span class="event-tag">{tag}</span>
                        {/each}
                      </div>
                    {/if}
                    {#if event.links && event.links.length > 0}
                      <div class="event-links">
                        {#each event.links as link}
                          <span class="event-link">{link.type}: {link.target}</span>
                        {/each}
                      </div>
                    {/if}
                  </div>
                </div>
              {/each}
            {/if}
          </div>
        {:else if memoryTab === 'dreams'}
        <div class="events-list">

            {#if paginatedDreams.length > 0}
              {#each paginatedDreams as event (event.id)}
                {@const key = getEventKey(event)}
                {@const isOpen = key ? !!expanded[key] : false}
                <div class="event-card dream-card">
                  <div class="event-card-header">
                    <button
                      class="event-title-button"
                      type="button"
                      on:click={() => toggleExpanded(event)}
                      aria-expanded={isOpen}
                    >
                      <span class="event-card-title">{getPreview(event.content)}</span>
                      <span class="event-toggle-icon" aria-hidden="true">{isOpen ? '▲' : '▼'}</span>
                      <span class="sr-only">{isOpen ? 'Collapse memory' : 'Expand memory'}</span>
                    </button>
                    <div class="validation-controls">
                      <button class="val-btn edit" title="Edit dream" on:click|stopPropagation={() => openMemoryEditor(event.relPath, 'Dream')}>
                        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                  {#if isOpen}
                    {#if event.relPath}
                      {#if memoryContent[event.relPath]?.status === 'loading'}
                        <div class="event-body loading">Loading dream memory…</div>
                    {:else if memoryContent[event.relPath]?.status === 'error'}
                      <div class="event-body error">Failed to load dream: {memoryContent[event.relPath]?.error}</div>
                    {:else}
                      <div class="event-body">
                        <pre>{memoryContent[event.relPath]?.content ?? event.content}</pre>
                      </div>
                    {/if}
                  {:else}
                    <div class="event-body">
                      <pre>{event.content}</pre>
                    </div>
                  {/if}
                {/if}
                <div class="event-card-meta">
                  <div class="event-card-time">{new Date(event.timestamp).toLocaleString()}</div>
                  {#if event.metadata?.sources && event.metadata.sources.length > 0}
                     <div class="event-links">
                       Sources:
                       {#each event.metadata.sources as sourceId}
                         <span class="event-link">{sourceId.slice(0, 10)}...</span>
                       {/each}
                     </div>
                  {/if}
                </div>
              </div>
            {/each}
          {:else}
            <p class="empty-state">No dreams recorded recently. Dreams are generated during the nightly sleep cycle based on recent memories.</p>
          {/if}
        </div>
        {:else if memoryTab === 'curiosity'}
        <div class="memory-list">
          {#if curiosityQuestionsTab.length > 0}
            {#each curiosityQuestionsTab as question}
              <div class="event-card curiosity-question" class:pending={question.status === 'pending'} class:answered={question.status === 'answered'}>
                <div class="event-card-header">
                  <span class="event-icon">{question.status === 'pending' ? '❓' : '✅'}</span>
                  <div class="event-card-meta">
                    <span class="event-card-type">{question.status}</span>
                    <span class="event-card-time">{new Date(question.askedAt).toLocaleString()}</span>
                  </div>
                </div>
                <div class="event-card-content question-text">
                  {question.question}
                </div>
                <div class="event-card-footer">
                  <button class="btn-view" on:click={() => openMemoryEditor(question.relPath, 'Question')}>
                    View Details
                  </button>
                  {#if question.status === 'pending'}
                    <button class="btn-reply" on:click={() => {
                      activeView.set('chat');
                    }}>
                      Reply in Chat
                    </button>
                  {/if}
                  {#if question.answeredAt}
                    <span class="answered-badge">Answered {new Date(question.answeredAt).toLocaleDateString()}</span>
                  {/if}
                </div>
              </div>
            {/each}
          {:else}
            <div class="empty-state">
              <div class="empty-icon">❓</div>
              <div class="empty-title">No Curiosity Questions Yet</div>
              <div class="empty-description">
                The curiosity system asks thoughtful questions during idle periods.
                Adjust settings in System → Settings to enable.
              </div>
            </div>
          {/if}
        </div>
        {:else if memoryTab === 'functions'}
          <div class="flex flex-col gap-4">
            {#if functionMemories.length > 0}
              {#each functionMemories as func}
                <div class="event-card border-l-[3px] border-l-indigo-500 dark:border-l-indigo-400">
                  <div class="event-card-header">
                    <div class="w-full">
                      <div class="flex items-center gap-3 mb-2">
                        <span class="text-xl flex-shrink-0">{func.trustLevel === 'verified' ? '✓' : '📝'}</span>
                        <span class="text-base font-semibold text-gray-900 dark:text-gray-100 flex-1">{func.title}</span>
                        <span class="px-3 py-1 rounded-full text-xs font-medium uppercase {func.trustLevel === 'verified' ? 'bg-emerald-500/10 text-emerald-600 dark:bg-emerald-400/15 dark:text-emerald-400' : 'bg-amber-400/10 text-amber-600 dark:bg-amber-400/15 dark:text-amber-400'}">{func.trustLevel}</span>
                      </div>
                      <div class="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">{func.summary}</div>
                    </div>
                  </div>
                  <div class="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                    <div class="flex gap-6 mb-3">
                      <div class="flex items-center gap-2">
                        <span class="text-xs text-gray-500 dark:text-gray-400 font-medium">Uses:</span>
                        <span class="text-sm font-semibold text-gray-900 dark:text-gray-100">{func.usageCount}</span>
                      </div>
                      <div class="flex items-center gap-2">
                        <span class="text-xs text-gray-500 dark:text-gray-400 font-medium">Quality:</span>
                        <span class="text-sm font-semibold text-gray-900 dark:text-gray-100">{func.qualityScore ? (func.qualityScore * 100).toFixed(0) + '%' : 'N/A'}</span>
                      </div>
                      <div class="flex items-center gap-2">
                        <span class="text-xs text-gray-500 dark:text-gray-400 font-medium">Skills:</span>
                        <span class="text-sm font-semibold text-gray-900 dark:text-gray-100">{func.skillsUsed.length}</span>
                      </div>
                    </div>
                    <div class="flex flex-wrap gap-2">
                      {#each func.skillsUsed as skill}
                        <span class="px-2.5 py-1 bg-gray-100 dark:bg-gray-700 rounded-md text-xs text-gray-600 dark:text-gray-300 font-mono">{skill}</span>
                      {/each}
                    </div>
                  </div>
                  <div class="event-card-meta">
                    <div class="event-card-time">{new Date(func.createdAt).toLocaleString()}</div>
                  </div>
                </div>
              {/each}
            {:else}
              <div class="empty-state">
                <div class="empty-icon">🔧</div>
                <div class="empty-title">No Functions Yet</div>
                <div class="empty-description">
                  Functions are automatically learned from successful operator executions.
                  The system will create draft functions as it discovers multi-step patterns.
                </div>
              </div>
            {/if}
          </div>
        {:else if memoryTab === 'pruned'}
          <div class="events-list">
            {#if prunedMemories.length === 0}
              <div class="empty-state">
                <div class="empty-icon">🗑️</div>
                <div class="empty-title">No pruned memories</div>
                <div class="empty-description">
                  Pruned memories will appear here after running the Memory Pruner agent.
                  Use the "Run Pruner" button in the Memory Controls section above.
                </div>
              </div>
            {:else}
              {#each paginatedPruned as event}
                <div class="event-card pruned-card">
                  <div class="event-card-header">
                    <div class="event-card-time">
                      {new Date(event.timestamp).toLocaleString()}
                    </div>
                    <div class="validation-controls">
                      <button class="val-btn edit" title="View pruned memory" on:click|stopPropagation={() => openMemoryEditor(event.relPath, 'Pruned Memory')}>
                        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                  <div class="event-body">{event.content}</div>
                  {#if event.tags && event.tags.length > 0}
                    <div class="event-tags">
                      {#each event.tags.slice(0, 5) as tag}
                        <span class="tag">{tag}</span>
                      {/each}
                    </div>
                  {/if}
                </div>
              {/each}
            {/if}
          </div>
        {/if}
        {:else if personaTab === 'generator'}
          {#await loadComponent('PersonaGenerator')}
            <div class="loading-placeholder">Loading persona generator...</div>
          {:then Component}
            <svelte:component this={Component} />
          {/await}
        {/if}
      </div>
    </div>
  {:else if $activeView === 'system'}
    <div class="view-container" class:terminal-view={systemTab === 'terminal'}>
      <div class="view-header">
        <h2 class="view-title">⚙️ System</h2>
        <p class="view-subtitle">Tools & settings</p>
      </div>
      <div class="view-content">
        <div class="tab-group">
          <button class="tab-button" class:active={systemTab==='chat'} on:click={() => systemTab='chat'}>Chat</button>
          <button class="tab-button" class:active={systemTab==='settings'} on:click={() => systemTab='settings'}>Settings</button>
          <button class="tab-button" class:active={systemTab==='backend'} on:click={() => systemTab='backend'}>Backend</button>
          <button class="tab-button" class:active={systemTab==='security'} on:click={() => systemTab='security'}>Security</button>
          <button class="tab-button" class:active={systemTab==='storage'} on:click={() => systemTab='storage'}>Storage</button>
          <button class="tab-button" class:active={systemTab==='network'} on:click={() => systemTab='network'}>🌐 Network</button>
          <button class="tab-button" class:active={systemTab==='addons'} on:click={() => systemTab='addons'}>Addons</button>
          <button class="tab-button" class:active={systemTab==='scheduler'} on:click={() => systemTab='scheduler'}>Scheduler</button>
          <button class="tab-button" class:active={systemTab==='lifeline'} on:click={() => systemTab='lifeline'}>Lifeline</button>
        </div>
        {#if systemTab === 'chat'}
          {#await loadComponent('ChatSettings')}
            <div class="loading-placeholder">Loading chat settings...</div>
          {:then Component}
            <svelte:component this={Component} />
          {/await}
        {:else if systemTab === 'settings'}
          {#await loadComponent('SystemSettings')}
            <div class="loading-placeholder">Loading system settings...</div>
          {:then Component}
            <svelte:component this={Component} />
          {/await}
        {:else if systemTab === 'backend'}
          {#await loadComponent('BackendSettings')}
            <div class="loading-placeholder">Loading backend settings...</div>
          {:then Component}
            <svelte:component this={Component} />
          {/await}
        {:else if systemTab === 'security'}
          {#await loadComponent('SecuritySettings')}
            <div class="loading-placeholder">Loading security settings...</div>
          {:then Component}
            <svelte:component this={Component} />
          {/await}
        {:else if systemTab === 'storage'}
          {#await loadComponent('ProfileLocation')}
            <div class="loading-placeholder">Loading storage settings...</div>
          {:then Component}
            <svelte:component this={Component} />
          {/await}
        {:else if systemTab === 'network'}
          {#await loadComponent('NetworkServerSettings')}
            <div class="loading-placeholder">Loading network settings...</div>
          {:then Component}
            <svelte:component this={Component} />
          {/await}
        {:else if systemTab === 'addons'}
          {#await loadComponent('AddonsManager')}
            <div class="loading-placeholder">Loading addons manager...</div>
          {:then Component}
            <svelte:component this={Component} />
          {/await}
        {:else if systemTab === 'lifeline'}
          {#await loadComponent('Lifeline')}
            <div class="loading-placeholder">Loading lifeline...</div>
          {:then Component}
            <svelte:component this={Component} />
          {/await}
        {:else if systemTab === 'scheduler'}
          {#await loadComponent('SchedulerSettings')}
            <div class="loading-placeholder">Loading scheduler settings...</div>
          {:then Component}
            <svelte:component this={Component} />
          {/await}
        {/if}
      </div>
    </div>
  {:else if $activeView === 'terminal'}
    <div class="view-container terminal-view">
      <div class="view-header">
        <h2 class="view-title">💻 System</h2>
        <p class="view-subtitle">System console with tabbed sessions</p>
      </div>
      <div class="view-content terminal-iframe-container">
        {#await loadComponent('TerminalManager')}
          <div class="loading-placeholder">Loading terminal manager...</div>
        {:then Component}
          <svelte:component this={Component} />
        {/await}
      </div>
    </div>
  {:else if $activeView === 'projects'}
    <div class="view-container">
      {#await loadComponent('ProjectDashboard')}
        <div class="loading-placeholder">Loading projects...</div>
      {:then Component}
        <svelte:component this={Component} />
      {/await}
    </div>
  {:else if $activeView === 'agency'}
    <div class="view-container">
      <div class="view-header">
        <h2 class="view-title">🎯 Agency</h2>
        <p class="view-subtitle">Autonomous desires and intentions</p>
      </div>
      <div class="view-content">
        {#await loadComponent('AgencyDashboard')}
          <div class="loading-placeholder">Loading agency dashboard...</div>
        {:then Component}
          <svelte:component this={Component} />
        {/await}
      </div>
    </div>
  {/if}
</div>

<style>
  /* Minimal custom styles for CenterContent - essential styles only */

  /* Terminal view - layout-specific */
  .terminal-view {
    @apply p-0 flex flex-col h-full;
  }

  .terminal-view .view-header {
    @apply flex-shrink-0;
  }

  .terminal-view .view-content {
    @apply flex-1 flex flex-col min-h-0;
  }

  .terminal-view .terminal-iframe-container {
    @apply p-0 flex-1 w-full relative min-h-0;
  }

  .terminal-iframe {
    @apply w-full h-full border-none bg-black;
  }

  /* Event body content */
  .event-body {
    @apply mt-3 text-base leading-relaxed text-gray-700 dark:text-gray-300
           border-t border-black/10 dark:border-white/10 pt-3;
  }

  .event-body pre {
    @apply m-0 whitespace-pre-wrap break-words font-[inherit];
  }

  .event-body.loading,
  .event-body.error {
    @apply font-medium;
  }

  .event-body.error {
    @apply text-red-600;
  }

  /* Event status badges */
  .event-valid {
    @apply text-xs uppercase tracking-wide px-1.5 py-0.5 rounded;
  }

  .event-valid.correct {
    @apply text-green-600 bg-green-600/10;
  }

  .event-valid.incorrect {
    @apply text-red-600 bg-red-600/10;
  }

  /* Card type indicators */
  .ai-ingestor-card {
    @apply border-l-4 border-l-violet-600 dark:border-l-violet-400;
  }

  .audio-transcript-card {
    @apply border-l-4 border-l-blue-500 dark:border-l-blue-400;
  }

  .dream-card {
    @apply border-l-4 border-l-yellow-500 dark:border-l-yellow-400;
  }

  .pruned-card {
    @apply border-l-[3px] border-l-gray-400 dark:border-l-gray-500 opacity-85;
  }

  /* Tags and links */
  .event-tags,
  .event-links {
    @apply flex flex-wrap gap-1 mt-1;
  }

  .event-tag {
    @apply text-xs px-1.5 py-0.5 rounded bg-violet-600/10 dark:bg-violet-400/20
           text-violet-700 dark:text-violet-300 font-medium;
  }

  .event-link {
    @apply text-xs px-1.5 py-0.5 rounded bg-blue-500/10 dark:bg-blue-400/20
           text-blue-600 dark:text-blue-400 font-medium;
  }

  /* Curiosity questions */
  .curiosity-question {
    @apply border-l-[3px] border-l-violet-600;
  }

  .curiosity-question.pending {
    @apply bg-violet-600/5 dark:bg-violet-400/[0.08];
  }

  .curiosity-question.answered {
    @apply bg-emerald-500/5 dark:bg-emerald-400/[0.08] border-l-emerald-500 dark:border-l-emerald-400;
  }

  .question-text {
    @apply italic text-gray-600 dark:text-gray-300 leading-relaxed;
  }

  .btn-view, .btn-reply {
    @apply px-3 py-1.5 text-sm font-medium rounded-md transition-colors;
  }

  .btn-view {
    @apply bg-gray-100 hover:bg-gray-200 text-gray-700
           dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-gray-200;
  }

  .btn-reply {
    @apply bg-purple-600 hover:bg-purple-700 text-white
           dark:bg-purple-700 dark:hover:bg-purple-600;
  }

  .answered-badge {
    @apply text-xs px-2 py-1 rounded-full bg-green-100 text-green-700
           dark:bg-green-900/30 dark:text-green-400;
  }

  /* Dialogue source badge */
  .dialogue-source-badge {
    @apply text-xs px-2 py-0.5 rounded-full font-medium mr-2 text-white lowercase flex-shrink-0 bg-gray-500;
  }

  /* Scrollbar styling - can't be done with Tailwind */
  .view-content::-webkit-scrollbar {
    width: 8px;
  }

  .view-content::-webkit-scrollbar-track {
    background: transparent;
  }

  .view-content::-webkit-scrollbar-thumb {
    @apply bg-black/20 dark:bg-white/20 rounded;
  }

  .view-content::-webkit-scrollbar-thumb:hover {
    @apply bg-black/30 dark:bg-white/30;
  }

</style>

<!-- Memory Editor Modal (lazy-loaded when opened) -->
{#if editorOpen}
  {#await loadComponent('MemoryEditor')}
    <!-- Modal loading state -->
  {:then Component}
    <svelte:component
      this={Component}
      bind:isOpen={editorOpen}
      relPath={editorRelPath}
      memoryType={editorMemoryType}
      on:saved={handleEditorSaved}
      on:close={() => editorOpen = false}
    />
  {/await}
{/if}
