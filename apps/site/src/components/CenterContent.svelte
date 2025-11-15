<script lang="ts">
  import { activeView } from '../stores/navigation';
  import ChatInterface from './ChatInterface.svelte';
  import Dashboard from './Dashboard.svelte';
  import TaskManager from './TaskManager.svelte';
  import ApprovalQueue from './ApprovalQueue.svelte';
  import Terminal from './Terminal.svelte';
  import MemoryControls from './MemoryControls.svelte';
  import AudioUpload from './AudioUpload.svelte';
  import AudioRecorder from './AudioRecorder.svelte';
  import VoiceTrainingWidget from './VoiceTrainingWidget.svelte';
  import VoiceSettings from './VoiceSettings.svelte';
  import AdapterDashboard from './AdapterDashboard.svelte';
  import TrainingMonitor from './TrainingMonitor.svelte';
  import OnboardingWizard from './OnboardingWizard.svelte';
  import Lifeline from './Lifeline.svelte';
  import OvernightLearnings from './OvernightLearnings.svelte';
  import SystemSettings from './SystemSettings.svelte';
  import SecuritySettings from './SecuritySettings.svelte';
  import NetworkSettings from './NetworkSettings.svelte';
  import ChatSettings from './ChatSettings.svelte';
  import MemoryEditor from './MemoryEditor.svelte';
  import PersonaGenerator from './PersonaGenerator.svelte';

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
let memoryTab: 'episodic' | 'reflections' | 'tasks' | 'curated' | 'ai-ingestor' | 'audio' | 'dreams' | 'curiosity' | 'functions' = 'episodic'
let voiceTab: 'upload' | 'training' | 'settings' = 'upload'
let trainingTab: 'setup' | 'datasets' | 'monitor' | 'adapters' = 'datasets'
let systemTab: 'persona' | 'generator' | 'chat' | 'lifeline' | 'settings' = 'persona'
let currentVoiceProvider: 'piper' | 'sovits' | 'rvc' = 'rvc'

// Legacy expansion state (no longer used but kept to prevent errors)
let expanded: Record<string, boolean> = {}
type MemoryContentState = { status: 'idle' | 'loading' | 'ready' | 'error'; content?: string; error?: string }
let memoryContent: Record<string, MemoryContentState> = {}

// Memory Editor state
let editorOpen = false
let editorRelPath = ''
let editorMemoryType = 'Memory'

type PersonaForm = {
  name: string
  humanName: string
  email: string
  role: string
  purpose: string
  avatar: string
  aliases: string
  tone: string
  humor: string
  formality: string
  verbosity: string
  narrativeStyle: string
  boundaries: string
}

let personaForm: PersonaForm = {
  name: '',
  humanName: '',
  email: '',
  role: '',
  purpose: '',
  avatar: '',
  aliases: '',
  tone: '',
  humor: '',
  formality: '',
  verbosity: '',
  narrativeStyle: '',
  boundaries: '',
}

let personaLoading = false
let personaLoaded = false
let personaError: string | null = null
let personaSaving = false
let personaSuccess: string | null = null

async function loadVoiceProvider() {
  try {
    const res = await fetch('/api/voice-settings');
    if (res.ok) {
      const data = await res.json();
      currentVoiceProvider = data.provider || 'rvc';
    }
  } catch (e) {
    console.error('[CenterContent] Error loading voice provider:', e);
  }
}

async function loadEvents() {
  if ($activeView !== 'memory') return;

  loadingEvents = true;
  eventsError = null;
    try {
      const res = await fetch('/api/memories_all');
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
    const res = await fetch('/api/functions?sortBy=qualityScore&sortOrder=desc');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    functionMemories = Array.isArray(data.functions) ? data.functions : [];
  } catch (err) {
    console.error('Failed to load functions:', err);
    eventsError = (err as Error).message;
  }
}

$: if ($activeView === 'memory') {
  loadEvents();
  loadFunctions();
}

$: if ($activeView === 'voice' && voiceTab === 'training') {
  loadVoiceProvider();
}

// Reset sub-tabs when navigating away from parent views
$: if ($activeView !== 'voice') {
  voiceTab = 'upload';
}

$: if ($activeView !== 'training') {
  trainingTab = 'datasets';
}

$: if ($activeView !== 'system') {
  systemTab = 'persona';
}

async function loadPersonaCore() {
  personaLoading = true;
  personaError = null;
  try {
    const res = await fetch('/api/persona-core');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.success || !data.persona) throw new Error(data.error || 'Failed to load persona');
    const persona = data.persona;
    const identity = persona.identity || {};
    const communication = persona.personality?.communicationStyle || {};
    personaForm = {
      name: identity.name || '',
      humanName: identity.humanName || '',
      email: identity.email || '',
      role: identity.role || '',
      purpose: identity.purpose || '',
      avatar: identity.avatar || '',
      aliases: Array.isArray(identity.aliases) ? identity.aliases.join(', ') : '',
      tone: Array.isArray(communication.tone) ? communication.tone.join(', ') : '',
      humor: communication.humor || '',
      formality: communication.formality || '',
      verbosity: communication.verbosity || '',
      narrativeStyle: persona.personality?.narrativeStyle || '',
      boundaries: Array.isArray(persona.values?.boundaries) ? persona.values.boundaries.join('\n') : '',
    };
    personaLoaded = true;
  } catch (error) {
    console.error('Failed to load persona core:', error);
    personaError = (error as Error).message;
  } finally {
    personaLoading = false;
  }
}

async function savePersonaCore() {
  if (personaSaving) return;
  personaSaving = true;
  personaError = null;
  personaSuccess = null;
  try {
    const payload = {
      identity: {
        name: personaForm.name,
        humanName: personaForm.humanName,
        email: personaForm.email,
        role: personaForm.role,
        purpose: personaForm.purpose,
        avatar: personaForm.avatar,
        aliases: personaForm.aliases.split(',').map((s) => s.trim()).filter(Boolean),
      },
      personality: {
        communicationStyle: {
          tone: personaForm.tone.split(',').map((s) => s.trim()).filter(Boolean),
          humor: personaForm.humor,
          formality: personaForm.formality,
          verbosity: personaForm.verbosity,
        },
        narrativeStyle: personaForm.narrativeStyle,
      },
      values: {
        boundaries: personaForm.boundaries.split('\n').map((s) => s.trim()).filter(Boolean),
      },
    };
    const res = await fetch('/api/persona-core', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data?.error || 'Failed to save persona');
    }
    personaSuccess = 'Persona settings saved successfully.';
    personaLoaded = false;
    setTimeout(() => { personaSuccess = null; }, 4000);
  } catch (error) {
    console.error('Failed to save persona core:', error);
    personaError = (error as Error).message;
  } finally {
    personaSaving = false;
  }
}

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
    const res = await fetch(`/api/memory-content?relPath=${encodeURIComponent(relPath)}`);
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

$: if ($activeView === 'system' && systemTab === 'persona' && !personaLoaded && !personaLoading) {
  loadPersonaCore();
}

  // Memory validation
  let saving: Record<string, boolean> = {}
  let deleting: Record<string, boolean> = {}
  async function setValidation(item: EventItem, status: 'correct' | 'incorrect') {
    if (saving[item.relPath]) return
    saving = { ...saving, [item.relPath]: true }
    try {
      const res = await fetch('/api/memories/validate', {
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
      const res = await fetch('/api/memories/delete', {
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
</script>

<div class="center-content">
  {#if $activeView === 'chat'}
    <ChatInterface />
  {:else if $activeView === 'dashboard'}
    <div class="view-container">
      <div class="view-header">
        <h2 class="view-title">📊 Dashboard</h2>
        <p class="view-subtitle">System overview and status</p>
      </div>
      <div class="view-content">
        <Dashboard />
      </div>
    </div>
  {:else if $activeView === 'tasks'}
    <div class="view-container">
      <div class="view-header">
        <h2 class="view-title">✓ Tasks</h2>
        <p class="view-subtitle">Manage your tasks and goals</p>
      </div>
      <div class="view-content">
        <TaskManager />
      </div>
    </div>
  {:else if $activeView === 'approvals'}
    <div class="view-container">
      <div class="view-header">
        <h2 class="view-title">✋ Approval Queue</h2>
        <p class="view-subtitle">Review and approve skill executions</p>
      </div>
      <div class="view-content">
        <ApprovalQueue />
      </div>
    </div>
  {:else if $activeView === 'memory'}
    <div class="view-container">
      <div class="view-header">
        <h2 class="view-title">🧩 Memory</h2>
        <p class="view-subtitle">Episodic events and experiences</p>
      </div>
      <div class="view-content">
        <div class="memory-section">
          <MemoryControls on:captured={loadEvents} />
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
            {#each events as event}
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
              {#each reflectionMemories as event}
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
              {#each aiIngestorMemories as event}
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
              {#each audioTranscriptMemories as event}
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

            {#if dreamMemories.length > 0}
              {#each dreamMemories as event (event.id)}
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
                  <button class="btn-view" on:click={() => openEditor(question.relPath, 'Question')}>
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
            <AudioUpload />
            <AudioRecorder />
          </div>
        {:else if voiceTab === 'training'}
          <VoiceTrainingWidget provider={currentVoiceProvider} />
        {:else if voiceTab === 'settings'}
          <VoiceSettings />
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
          <button class="tab-button" class:active={trainingTab === 'setup'} on:click={() => trainingTab = 'setup'}>🧭 Setup Wizard</button>
          <button class="tab-button" class:active={trainingTab === 'datasets'} on:click={() => trainingTab = 'datasets'}>Datasets</button>
          <button class="tab-button" class:active={trainingTab === 'monitor'} on:click={() => trainingTab = 'monitor'}>Training Monitor</button>
          <button class="tab-button" class:active={trainingTab === 'adapters'} on:click={() => trainingTab = 'adapters'}>Adapters</button>
        </div>
        {#if trainingTab === 'setup'}
          <div class="onboarding-wrapper">
            <OnboardingWizard onComplete={() => {
              trainingTab = 'datasets';
              alert('Onboarding completed! Your data has been saved.');
            }} />
          </div>
        {:else if trainingTab === 'datasets'}
          <AdapterDashboard />
        {:else if trainingTab === 'monitor'}
          <TrainingMonitor />
        {:else if trainingTab === 'adapters'}
          <div class="empty-state">
            <div class="empty-icon">🧠</div>
            <div class="empty-title">Active Adapters</div>
            <div class="empty-description">
              Adapter management interface coming soon. Check the Settings tab in the right sidebar for current adapter status.
            </div>
          </div>
        {/if}
      </div>
    </div>
  {:else if $activeView === 'system'}
    <div class="view-container" class:terminal-view={systemTab === 'terminal'}>
      <div class="view-header">
        <h2 class="view-title">⚙️ System</h2>
        <p class="view-subtitle">Persona, tools & settings</p>
      </div>
      <div class="view-content">
        <div class="tab-group">
          <button class="tab-button" class:active={systemTab==='persona'} on:click={() => systemTab='persona'}>Persona</button>
          <button class="tab-button" class:active={systemTab==='generator'} on:click={() => systemTab='generator'}>Generator</button>
          <button class="tab-button" class:active={systemTab==='chat'} on:click={() => systemTab='chat'}>Chat</button>
          <button class="tab-button" class:active={systemTab==='settings'} on:click={() => systemTab='settings'}>Settings</button>
          <button class="tab-button" class:active={systemTab==='lifeline'} on:click={() => systemTab='lifeline'}>Lifeline</button>
        </div>
        {#if systemTab === 'persona'}
          <div class="persona-panel">
            {#if personaLoading && !personaLoaded}
              <p class="muted">Loading persona settings…</p>
            {:else if personaError && !personaLoaded}
              <div class="persona-alert error">
                <div>
                  <strong>Failed to load persona settings.</strong>
                  <div>{personaError}</div>
                </div>
                <button class="retry-button" on:click={loadPersonaCore}>Retry</button>
              </div>
            {:else}
              {#if personaError}
                <div class="persona-alert error inline">
                  <div>{personaError}</div>
                </div>
              {/if}
              {#if personaSuccess}
                <div class="persona-alert success">
                  {personaSuccess}
                </div>
              {/if}
              <form class="persona-form" on:submit|preventDefault={savePersonaCore}>
                <section class="persona-section">
                  <h4>Identity</h4>
                  <div class="form-grid">
                    <label class="field">
                      <span>AI Name</span>
                      <input type="text" bind:value={personaForm.name} placeholder="Destroyer of Worlds" />
                    </label>
                    <label class="field">
                      <span>Human Name</span>
                      <input type="text" bind:value={personaForm.humanName} placeholder="MeatPerson" />
                    </label>
                    <label class="field">
                      <span>Email</span>
                      <input type="email" bind:value={personaForm.email} placeholder="Robot@destroy-all-humans.io" />
                    </label>
                    <label class="field">
                      <span>Avatar Path / URL</span>
                      <input type="text" bind:value={personaForm.avatar} placeholder="/profiles/username/avatar.png" />
                    </label>
                    <label class="field">
                      <span>Role</span>
                      <input type="text" bind:value={personaForm.role} placeholder="Digital persona…" />
                    </label>
                    <label class="field">
                      <span>Aliases (comma separated)</span>
                      <input type="text" bind:value={personaForm.aliases} placeholder="MetaHuman, IwanTthEMeThatIsinsideYOU" />
                    </label>
                  </div>
                  <label class="field">
                    <span>Purpose</span>
                    <textarea rows="3" bind:value={personaForm.purpose}></textarea>
                  </label>
                </section>

                <section class="persona-section">
                  <h4>Communication Style</h4>
                  <div class="form-grid">
                    <label class="field">
                      <span>Tone (comma separated)</span>
                      <input type="text" bind:value={personaForm.tone} placeholder="direct, friendly, pragmatic" />
                    </label>
                    <label class="field">
                      <span>Humor</span>
                      <input type="text" bind:value={personaForm.humor} placeholder="dry, occasional" />
                    </label>
                    <label class="field">
                      <span>Formality</span>
                      <input type="text" bind:value={personaForm.formality} placeholder="casual-professional" />
                    </label>
                    <label class="field">
                      <span>Verbosity</span>
                      <input type="text" bind:value={personaForm.verbosity} placeholder="concise with detail when needed" />
                    </label>
                  </div>
                  <label class="field">
                    <span>Narrative Style</span>
                    <textarea rows="3" bind:value={personaForm.narrativeStyle}></textarea>
                  </label>
                </section>

                <section class="persona-section">
                  <h4>Boundaries</h4>
                  <label class="field">
                    <span>Core Boundaries (one per line)</span>
                    <textarea rows="4" bind:value={personaForm.boundaries} placeholder="No deceptive communication&#10;Respect privacy of others"></textarea>
                  </label>
                </section>

                <div class="persona-actions">
                  <button type="submit" class="save-button" disabled={personaSaving}>
                    {personaSaving ? 'Saving…' : 'Save Persona'}
                  </button>
                </div>
              </form>
            {/if}
          </div>
        {:else if systemTab === 'generator'}
          <PersonaGenerator />
        {:else if systemTab === 'chat'}
          <ChatSettings />
        {:else if systemTab === 'settings'}
          <SystemSettings />
        {:else if systemTab === 'lifeline'}
          <Lifeline />
        {/if}
      </div>
    </div>
  {:else if $activeView === 'terminal'}
    <div class="view-container terminal-view">
      <div class="view-header">
        <h2 class="view-title">💻 Terminal</h2>
        <p class="view-subtitle">Command line interface</p>
      </div>
      <div class="view-content">
        <Terminal />
      </div>
    </div>
  {:else if $activeView === 'network'}
    <div class="view-container network-view">
      <NetworkSettings />
    </div>
  {:else if $activeView === 'security'}
    <div class="view-container security-view">
      <SecuritySettings />
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
</style>

<!-- Memory Editor Modal -->
<MemoryEditor
  bind:isOpen={editorOpen}
  relPath={editorRelPath}
  memoryType={editorMemoryType}
  on:saved={handleEditorSaved}
  on:close={() => editorOpen = false}
/>
