<script lang="ts">
  import { activeView } from '../stores/navigation';
  import type { SvelteComponent } from 'svelte';
  import { apiFetch, isCapacitorNative } from '../lib/client/api-config';
  import { onMount } from 'svelte';

  // Mobile platform detection (for showing mobile-only settings)
  let isMobileApp = false;

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
      case 'ApprovalQueue':
        module = await import('./ApprovalQueue.svelte');
        break;
      case 'Terminal':
        module = await import('./Terminal.svelte');
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
      case 'NetworkSettings':
        module = await import('./NetworkSettings.svelte');
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
      case 'ServerSettings':
        module = await import('./ServerSettings.svelte');
        break;
      case 'TerminalManager':
        module = await import('./TerminalManager.svelte');
        break;
      case 'AgencyDashboard':
        module = await import('./AgencyDashboard.svelte');
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
let memoryTab: 'episodic' | 'reflections' | 'tasks' | 'curated' | 'ai-ingestor' | 'audio' | 'dreams' | 'curiosity' | 'functions' = 'episodic'
let voiceTab: 'upload' | 'training' | 'settings' = 'upload'
let trainingTab: 'wizard' | 'datasets' | 'manage' | 'system' | 'monitor' | 'adapters' = 'wizard'
let systemTab: 'chat' | 'lifeline' | 'settings' | 'security' | 'network' | 'storage' | 'addons' | 'scheduler' | 'server' = 'settings'
let dashboardTab: 'overview' | 'tasks' | 'approvals' = 'overview'
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
      // Load most recent 100 memories (paginated for performance)
      const res = await apiFetch('/api/memories_all?limit=100');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const episodicEvents = Array.isArray(data.episodic) ? data.episodic : [];
      const reflections = Array.isArray(data.reflections) ? data.reflections : [];
      const dreams = Array.isArray(data.dreams) ? data.dreams : [];
      tasksTab = Array.isArray(data.tasks) ? data.tasks : [];
      curatedTab = Array.isArray(data.curated) ? data.curated : [];
      curiosityQuestionsTab = Array.isArray(data.curiosityQuestions) ? data.curiosityQuestions : [];
      
      // DEBUG: Log all fetched events
      console.log('--- Memory Buckets Fetched ---', { episodicEvents, reflections, dreams });

      events = episodicEvents;
      reflectionMemories = reflections;
      dreamMemories = dreams;

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
        void loadComponent('NetworkSettings');
        void loadComponent('AddonsManager');
        void loadComponent('Lifeline');
        void loadComponent('SchedulerSettings');
        break;
      case 'terminal':
        void loadComponent('TerminalManager');
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

  // Detect mobile platform on mount
  onMount(() => {
    isMobileApp = isMobileAppCheck();
  });
</script>

<div class="center-content">
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
          <button class="tab-button" class:active={dashboardTab === 'overview'} on:click={() => dashboardTab = 'overview'}>Overview</button>
          <button class="tab-button" class:active={dashboardTab === 'tasks'} on:click={() => dashboardTab = 'tasks'}>Tasks</button>
          <button class="tab-button" class:active={dashboardTab === 'approvals'} on:click={() => dashboardTab = 'approvals'}>Approvals</button>
        </div>
        {#if dashboardTab === 'overview'}
          {#await loadComponent('Dashboard')}
            <div class="loading-placeholder">Loading dashboard...</div>
          {:then Component}
            <svelte:component this={Component} />
          {/await}
        {:else if dashboardTab === 'tasks'}
          {#await loadComponent('TaskManager')}
            <div class="loading-placeholder">Loading tasks...</div>
          {:then Component}
            <svelte:component this={Component} />
          {/await}
        {:else if dashboardTab === 'approvals'}
          {#await loadComponent('ApprovalQueue')}
            <div class="loading-placeholder">Loading approvals...</div>
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
          <button class="tab-button" class:active={voiceTab === 'upload'} on:click={() => voiceTab = 'upload'}>Upload & Transcribe</button>
          <button class="tab-button" class:active={voiceTab === 'training'} on:click={() => { voiceTab = 'training'; loadVoiceProvider(); }}>Voice Clone Training</button>
          <button class="tab-button" class:active={voiceTab === 'settings'} on:click={() => voiceTab = 'settings'}>Voice Settings</button>
        </div>
        {#if voiceTab === 'upload'}
          <div class="audio-grid">
            {#await loadComponent('AudioUpload')}
              <div class="loading-placeholder">Loading...</div>
            {:then Component}
              <svelte:component this={Component} />
            {/await}
            {#await loadComponent('AudioRecorder')}
              <div class="loading-placeholder">Loading...</div>
            {:then Component}
              <svelte:component this={Component} />
            {/await}
          </div>
        {:else if voiceTab === 'training'}
          {#await loadComponent('VoiceTrainingWidget')}
            <div class="loading-placeholder">Loading voice training...</div>
          {:then Component}
            <svelte:component this={Component} provider={currentVoiceProvider} />
          {/await}
        {:else if voiceTab === 'settings'}
          {#await loadComponent('VoiceSettings')}
            <div class="loading-placeholder">Loading settings...</div>
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
          <button class="tab-button" class:active={trainingTab === 'wizard'} on:click={() => trainingTab = 'wizard'}>🧙 Training Wizard</button>
          <button class="tab-button" class:active={trainingTab === 'datasets'} on:click={() => trainingTab = 'datasets'}>📜 Training History</button>
          <button class="tab-button" class:active={trainingTab === 'manage'} on:click={() => trainingTab = 'manage'}>📊 Dataset Management</button>
          <button class="tab-button" class:active={trainingTab === 'system'} on:click={() => trainingTab = 'system'}>⚙️ System Controls</button>
          <button class="tab-button" class:active={trainingTab === 'monitor'} on:click={() => trainingTab = 'monitor'}>📡 Training Monitor</button>
        </div>
        {#if trainingTab === 'wizard'}
          {#await loadComponent('TrainingWizard')}
            <div class="loading-placeholder">Loading training wizard...</div>
          {:then Component}
            <svelte:component this={Component} />
          {/await}
        {:else if trainingTab === 'datasets'}
          {#await loadComponent('TrainingHistory')}
            <div class="loading-placeholder">Loading training history...</div>
          {:then Component}
            <svelte:component this={Component} />
          {/await}
        {:else if trainingTab === 'manage'}
          {#await loadComponent('DatasetManagement')}
            <div class="loading-placeholder">Loading dataset management...</div>
          {:then Component}
            <svelte:component this={Component} />
          {/await}
        {:else if trainingTab === 'system'}
          {#await loadComponent('SystemControls')}
            <div class="loading-placeholder">Loading system controls...</div>
          {:then Component}
            <svelte:component this={Component} />
          {/await}
        {:else if trainingTab === 'monitor'}
          {#await loadComponent('TrainingMonitor')}
            <div class="loading-placeholder">Loading training monitor...</div>
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
          <button class="tab-button" class:active={personaTab==='editor'} on:click={() => personaTab='editor'}>Editor</button>
          <button class="tab-button" class:active={personaTab==='memory'} on:click={() => personaTab='memory'}>Memory</button>
          <button class="tab-button" class:active={personaTab==='generator'} on:click={() => personaTab='generator'}>Generator</button>
        </div>
        {#if personaTab === 'editor'}
          <div class="persona-editor-wrapper">
            {#await loadComponent('PersonaEditor')}
              <div class="loading-placeholder">Loading persona editor...</div>
            {:then Component}
              <svelte:component this={Component} />
            {/await}
          </div>
        {:else if personaTab === 'memory'}
          <div class="memory-section">
            {#await loadComponent('MemoryControls')}
              <div class="loading-placeholder">Loading memory controls...</div>
            {:then Component}
              <svelte:component this={Component} on:captured={loadEvents} />
            {/await}
          </div>
          <div class="tab-group">
            <button class="tab-button" class:active={memoryTab==='episodic'} on:click={() => memoryTab='episodic'}>Episodic</button>
            <button class="tab-button" class:active={memoryTab==='reflections'} on:click={() => memoryTab='reflections'}>Reflections</button>
            <button class="tab-button" class:active={memoryTab==='tasks'} on:click={() => memoryTab='tasks'}>Tasks</button>
            <button class="tab-button" class:active={memoryTab==='curated'} on:click={() => memoryTab='curated'}>Curated</button>
            <button class="tab-button" class:active={memoryTab==='ai-ingestor'} on:click={() => memoryTab='ai-ingestor'}>AI Ingestor</button>
            <button class="tab-button" class:active={memoryTab==='audio'} on:click={() => memoryTab='audio'}>Audio</button>
            <button class="tab-button" class:active={memoryTab==='dreams'} on:click={() => memoryTab='dreams'}>Dreams 💭</button>
            <button class="tab-button" class:active={memoryTab==='curiosity'} on:click={() => memoryTab='curiosity'}>Curiosity ❓</button>
            <button class="tab-button" class:active={memoryTab==='functions'} on:click={() => memoryTab='functions'}>Functions 🔧</button>
          </div>

          <!-- Search and Pagination Controls -->
          {#if !['tasks', 'curated', 'curiosity', 'functions'].includes(memoryTab)}
            <div class="memory-controls-bar">
              <div class="search-box">
                <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="11" cy="11" r="8"/>
                  <path d="m21 21-4.35-4.35"/>
                </svg>
                <input
                  type="text"
                  placeholder="Search memories..."
                  bind:value={searchQuery}
                  class="search-input"
                />
                {#if searchQuery}
                  <button class="search-clear" on:click={() => searchQuery = ''}>×</button>
                {/if}
              </div>
              <div class="pagination-info">
                {#if currentTotalItems > 0}
                  <span class="item-count">
                    {currentTotalItems} {currentTotalItems === 1 ? 'memory' : 'memories'}
                    {#if searchQuery}(filtered){/if}
                  </span>
                {/if}
              </div>
            </div>

            {#if currentTotalPages > 1}
              <div class="pagination-controls">
                <button
                  class="page-btn"
                  on:click={() => currentPage = 1}
                  disabled={currentPage === 1}
                  title="First page"
                >««</button>
                <button
                  class="page-btn"
                  on:click={() => currentPage = Math.max(1, currentPage - 1)}
                  disabled={currentPage === 1}
                  title="Previous page"
                >«</button>

                <span class="page-indicator">
                  Page {currentPage} of {currentTotalPages}
                </span>

                <button
                  class="page-btn"
                  on:click={() => currentPage = Math.min(currentTotalPages, currentPage + 1)}
                  disabled={currentPage === currentTotalPages}
                  title="Next page"
                >»</button>
                <button
                  class="page-btn"
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
          <div class="events-list">
            {#each paginatedEvents as event}
              {@const key = getEventKey(event)}
              {@const isOpen = key ? !!expanded[key] : false}
              <div class="event-card">
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
                    <button class="val-btn edit" title="Edit memory" on:click|stopPropagation={() => openMemoryEditor(event.relPath, 'Memory')}>
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
                <div class="event-card">
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
                <div class="event-card ai-ingestor-card">
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
          <div class="functions-list">
            {#if functionMemories.length > 0}
              {#each functionMemories as func}
                <div class="event-card function-card">
                  <div class="event-card-header">
                    <div class="function-header-content">
                      <div class="function-title-row">
                        <span class="function-icon">{func.trustLevel === 'verified' ? '✓' : '📝'}</span>
                        <span class="function-title">{func.title}</span>
                        <span class="function-trust-badge {func.trustLevel}">{func.trustLevel}</span>
                      </div>
                      <div class="function-summary">{func.summary}</div>
                    </div>
                  </div>
                  <div class="function-body">
                    <div class="function-stats">
                      <div class="stat-item">
                        <span class="stat-label">Uses:</span>
                        <span class="stat-value">{func.usageCount}</span>
                      </div>
                      <div class="stat-item">
                        <span class="stat-label">Quality:</span>
                        <span class="stat-value">{func.qualityScore ? (func.qualityScore * 100).toFixed(0) + '%' : 'N/A'}</span>
                      </div>
                      <div class="stat-item">
                        <span class="stat-label">Skills:</span>
                        <span class="stat-value">{func.skillsUsed.length}</span>
                      </div>
                    </div>
                    <div class="function-skills">
                      {#each func.skillsUsed as skill}
                        <span class="skill-tag">{skill}</span>
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
          <button class="tab-button" class:active={systemTab==='network'} on:click={() => systemTab='network'}>Network</button>
          {#if isMobileApp}
            <button class="tab-button" class:active={systemTab==='server'} on:click={() => systemTab='server'}>📡 Server</button>
          {/if}
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
          {#await loadComponent('NetworkSettings')}
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
        {:else if systemTab === 'server'}
          {#await loadComponent('ServerSettings')}
            <div class="loading-placeholder">Loading server settings...</div>
          {:then Component}
            <svelte:component this={Component} />
          {/await}
        {/if}
      </div>
    </div>
  {:else if $activeView === 'terminal'}
    <div class="view-container terminal-view">
      <div class="view-header">
        <h2 class="view-title">💻 Terminal</h2>
        <p class="view-subtitle">Multiple terminals with tab management</p>
      </div>
      <div class="view-content terminal-iframe-container">
        {#await loadComponent('TerminalManager')}
          <div class="loading-placeholder">Loading terminal manager...</div>
        {:then Component}
          <svelte:component this={Component} />
        {/await}
      </div>
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
  {:else if $activeView === 'system-coder'}
    <div class="view-container">
      <div class="view-header">
        <h2 class="view-title">🔧 System Coder</h2>
        <p class="view-subtitle">Self-healing code maintenance agent</p>
      </div>
      <div class="view-content">
        {#await loadComponent('SystemCoderDashboard')}
          <div class="loading-placeholder">Loading system coder dashboard...</div>
        {:then Component}
          <svelte:component this={Component} />
        {/await}
      </div>
    </div>
  {/if}
</div>

<style>
  /* Minimal custom styles - most styling now uses Tailwind classes from global CSS */

  .center-content {
    @apply flex flex-col h-full w-full overflow-hidden;
  }

  .terminal-view {
    padding: 0;
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .terminal-view .view-header {
    flex-shrink: 0;
  }

  .terminal-view .view-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .terminal-view .terminal-iframe-container {
    padding: 0;
    flex: 1;
    width: 100%;
    position: relative;
    min-height: 0;
  }

  .terminal-iframe {
    width: 100%;
    height: 100%;
    border: none;
    background: #000;
  }

  .audio-grid {
    @apply grid grid-cols-2 gap-4;
  }

  /* Events list - using flex gap */
  .events-list {
    @apply flex flex-col gap-4;
  }

  /* Event title button - custom behavior */
  .event-title-button {
    @apply flex-1 flex items-center gap-2 bg-transparent cursor-pointer text-left;
    border: 0;
    padding: 0;
    margin: 0;
    font: inherit;
  }

  .event-title-button:focus-visible {
    @apply outline-2 outline-blue-500/60 outline-offset-2;
  }

  .event-toggle-icon {
    @apply text-xs text-gray-500 dark:text-gray-400;
  }

  /* Validation controls */
  .validation-controls {
    @apply flex gap-1;
  }

  .val-btn {
    @apply w-7 h-7 rounded-md border border-black/15 dark:border-white/20
           bg-white dark:bg-white/5 font-bold cursor-pointer
           transition-all hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed;
  }

  .val-btn.edit {
    @apply text-blue-600 border-blue-600/30
           hover:bg-blue-50 dark:hover:bg-blue-900/20;
  }

  .val-btn.good {
    @apply text-green-600 border-green-600/30
           hover:bg-green-50 dark:hover:bg-green-900/20;
  }

  .val-btn.bad {
    @apply text-red-600 border-red-600/30
           hover:bg-red-50 dark:hover:bg-red-900/20;
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

  /* Event body content */
  .event-body {
    @apply mt-3 text-base leading-relaxed text-gray-700 dark:text-gray-300
           border-t border-black/10 dark:border-white/10 pt-3;
  }

  .event-body pre {
    @apply m-0 whitespace-pre-wrap break-words;
    font: inherit;
  }

  .event-body.loading,
  .event-body.error {
    @apply font-medium;
  }

  .event-body.error {
    @apply text-red-600;
  }

  /* Screen reader only */
  .sr-only {
    @apply absolute w-px h-px p-0 -m-px overflow-hidden whitespace-nowrap border-0;
    clip: rect(0, 0, 0, 0);
  }

  /* Persona panel */
  .persona-panel {
    @apply max-w-3xl mx-auto p-8;
  }

  .persona-form {
    @apply flex flex-col gap-7;
  }

  .persona-section h4 {
    @apply text-base font-semibold mb-3;
  }

  .form-grid {
    @apply grid gap-4 mb-4;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  }

  .field {
    @apply flex flex-col gap-1.5;
  }

  .field > span {
    @apply block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1;
  }

  .field input,
  .field textarea {
    @apply w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600
           bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
           focus:outline-none focus:ring-2 focus:ring-violet-500 dark:focus:ring-violet-400;
  }

  .field textarea {
    @apply min-h-[120px] resize-y;
  }

  .persona-actions {
    @apply flex justify-end;
  }

  .save-button {
    @apply px-4 py-2 rounded-lg font-semibold transition-all text-white
           disabled:opacity-50 disabled:cursor-not-allowed;
    background: linear-gradient(135deg, rgb(124 58 237), rgb(109 40 217));
    transition: transform 0.1s ease, box-shadow 0.2s ease;
  }

  .save-button:hover:not(:disabled) {
    box-shadow: 0 10px 25px rgba(124, 58, 237, 0.25);
  }

  .save-button:active:not(:disabled) {
    transform: translateY(1px);
  }

  .save-button:disabled {
    @apply opacity-70 cursor-wait;
  }

  .persona-alert {
    @apply rounded-lg px-4 py-3 mb-4 text-sm flex items-center justify-between gap-4;
  }

  .persona-alert.success {
    @apply bg-green-50 dark:bg-green-900/20
           border border-green-200 dark:border-green-700
           text-green-800 dark:text-green-300;
  }

  .persona-alert.error {
    @apply bg-red-50 dark:bg-red-900/20
           border border-red-200 dark:border-red-700
           text-red-800 dark:text-red-300;
  }

  .persona-alert.inline {
    @apply justify-start;
  }

  .retry-button {
    @apply bg-red-600 text-white font-semibold px-3.5 py-1.5 rounded-lg
           cursor-pointer transition-colors flex-shrink-0 hover:bg-red-700;
    appearance: none;
    border: none;
  }

  /* Scrollbar styling */
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

  /* Card type indicators - using border accent utilities */
  .ai-ingestor-card {
    @apply border-l-4 border-l-violet-600 dark:border-l-violet-400;
  }

  .audio-transcript-card {
    @apply border-l-4 border-l-blue-500 dark:border-l-blue-400;
  }

  .dream-card {
    @apply border-l-4 border-l-yellow-500 dark:border-l-yellow-400;
  }

  /* Tag wrapper */
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

  /* Onboarding Wrapper */
  .onboarding-wrapper {
    @apply max-w-4xl mx-auto py-4;
  }

  /* Curiosity Questions */
  .curiosity-question {
    border-left: 3px solid #7c3aed;
  }

  .curiosity-question.pending {
    background: rgba(124, 58, 237, 0.05);
  }

  :global(.dark) .curiosity-question.pending {
    background: rgba(167, 139, 250, 0.08);
  }

  .curiosity-question.answered {
    background: rgba(16, 185, 129, 0.05);
    border-left-color: #10b981;
  }

  :global(.dark) .curiosity-question.answered {
    background: rgba(52, 211, 153, 0.08);
    border-left-color: #34d399;
  }

  .question-text {
    font-style: italic;
    color: #4b5563;
    line-height: 1.6;
  }

  :global(.dark) .question-text {
    color: #d1d5db;
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

  /* Function Memory Styles */
  .functions-list {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .function-card {
    border-left: 3px solid #6366f1;
  }

  :global(.dark) .function-card {
    border-left-color: #818cf8;
  }

  .function-header-content {
    width: 100%;
  }

  .function-title-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 0.5rem;
  }

  .function-icon {
    font-size: 1.25rem;
    flex-shrink: 0;
  }

  .function-title {
    font-size: 1rem;
    font-weight: 600;
    color: #111827;
    flex: 1;
  }

  :global(.dark) .function-title {
    color: #f3f4f6;
  }

  .function-trust-badge {
    padding: 0.25rem 0.75rem;
    border-radius: 9999px;
    font-size: 0.75rem;
    font-weight: 500;
    text-transform: uppercase;
  }

  .function-trust-badge.verified {
    background: rgba(16, 185, 129, 0.1);
    color: #059669;
  }

  :global(.dark) .function-trust-badge.verified {
    background: rgba(52, 211, 153, 0.15);
    color: #34d399;
  }

  .function-trust-badge.draft {
    background: rgba(251, 191, 36, 0.1);
    color: #d97706;
  }

  :global(.dark) .function-trust-badge.draft {
    background: rgba(251, 191, 36, 0.15);
    color: #fbbf24;
  }

  .function-summary {
    font-size: 0.875rem;
    color: #6b7280;
    line-height: 1.5;
  }

  :global(.dark) .function-summary {
    color: #9ca3af;
  }

  .function-body {
    margin-top: 0.75rem;
    padding-top: 0.75rem;
    border-top: 1px solid #e5e7eb;
  }

  :global(.dark) .function-body {
    border-top-color: #374151;
  }

  .function-stats {
    display: flex;
    gap: 1.5rem;
    margin-bottom: 0.75rem;
  }

  .stat-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .stat-label {
    font-size: 0.75rem;
    color: #6b7280;
    font-weight: 500;
  }

  :global(.dark) .stat-label {
    color: #9ca3af;
  }

  .stat-value {
    font-size: 0.875rem;
    font-weight: 600;
    color: #111827;
  }

  :global(.dark) .stat-value {
    color: #f3f4f6;
  }

  .function-skills {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .skill-tag {
    padding: 0.25rem 0.625rem;
    background: #f3f4f6;
    border-radius: 0.375rem;
    font-size: 0.75rem;
    color: #4b5563;
    font-family: 'Courier New', monospace;
  }

  :global(.dark) .skill-tag {
    background: #374151;
    color: #d1d5db;
  }

  /* Search and Pagination Controls */
  .memory-controls-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1rem;
    padding: 0.75rem;
    background: rgba(0, 0, 0, 0.02);
    border-radius: 0.5rem;
    border: 1px solid rgba(0, 0, 0, 0.06);
  }

  :global(.dark) .memory-controls-bar {
    background: rgba(255, 255, 255, 0.03);
    border-color: rgba(255, 255, 255, 0.08);
  }

  .search-box {
    position: relative;
    flex: 1;
    max-width: 400px;
  }

  .search-icon {
    position: absolute;
    left: 0.75rem;
    top: 50%;
    transform: translateY(-50%);
    width: 1rem;
    height: 1rem;
    color: #9ca3af;
    pointer-events: none;
  }

  .search-input {
    width: 100%;
    padding: 0.5rem 2rem 0.5rem 2.25rem;
    border: 1px solid #d1d5db;
    border-radius: 0.375rem;
    font-size: 0.875rem;
    background: white;
    color: #1f2937;
    transition: border-color 0.15s, box-shadow 0.15s;
  }

  :global(.dark) .search-input {
    background: #1f2937;
    border-color: #374151;
    color: #f3f4f6;
  }

  .search-input:focus {
    outline: none;
    border-color: #7c3aed;
    box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.1);
  }

  .search-input::placeholder {
    color: #9ca3af;
  }

  .search-clear {
    position: absolute;
    right: 0.5rem;
    top: 50%;
    transform: translateY(-50%);
    width: 1.25rem;
    height: 1.25rem;
    border: none;
    background: #e5e7eb;
    border-radius: 50%;
    cursor: pointer;
    font-size: 0.875rem;
    line-height: 1;
    color: #6b7280;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s;
  }

  :global(.dark) .search-clear {
    background: #374151;
    color: #9ca3af;
  }

  .search-clear:hover {
    background: #d1d5db;
  }

  :global(.dark) .search-clear:hover {
    background: #4b5563;
  }

  .pagination-info {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .item-count {
    font-size: 0.75rem;
    color: #6b7280;
    white-space: nowrap;
  }

  :global(.dark) .item-count {
    color: #9ca3af;
  }

  .pagination-controls {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 1rem;
    padding: 0.5rem;
    background: rgba(0, 0, 0, 0.02);
    border-radius: 0.5rem;
  }

  :global(.dark) .pagination-controls {
    background: rgba(255, 255, 255, 0.03);
  }

  .page-btn {
    padding: 0.375rem 0.75rem;
    border: 1px solid #d1d5db;
    border-radius: 0.375rem;
    background: white;
    color: #374151;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
  }

  :global(.dark) .page-btn {
    background: #1f2937;
    border-color: #374151;
    color: #d1d5db;
  }

  .page-btn:hover:not(:disabled) {
    background: #f3f4f6;
    border-color: #9ca3af;
  }

  :global(.dark) .page-btn:hover:not(:disabled) {
    background: #374151;
    border-color: #6b7280;
  }

  .page-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .page-indicator {
    padding: 0 0.75rem;
    font-size: 0.875rem;
    color: #4b5563;
    font-weight: 500;
  }

  :global(.dark) .page-indicator {
    color: #9ca3af;
  }

  /* Persona Editor Wrapper - provides height constraint for PersonaEditor component */
  .persona-editor-wrapper {
    height: calc(100vh - 200px);
    min-height: 500px;
    overflow: hidden;
  }

  /* Loading placeholder for lazy-loaded components */
  .loading-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem;
    color: #9ca3af;
    font-size: 0.875rem;
    animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
  }

  @keyframes pulse {
    0%, 100% {
      opacity: 1;
    }
    50% {
      opacity: 0.5;
    }
  }

  :global(.dark) .loading-placeholder {
    color: #6b7280;
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
