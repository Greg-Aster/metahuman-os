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
  import AdapterDashboard from './AdapterDashboard.svelte';
  import TrainingMonitor from './TrainingMonitor.svelte';
  import Lifeline from './Lifeline.svelte';
  import OvernightLearnings from './OvernightLearnings.svelte';

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
let loadingEvents = false
let eventsError: string | null = null
let memoryTab: 'episodic' | 'reflections' | 'tasks' | 'curated' | 'ai-ingestor' | 'audio' | 'dreams' = 'episodic'
let voiceTab: 'upload' | 'training' = 'upload'
let trainingTab: 'datasets' | 'monitor' | 'adapters' = 'datasets'
let systemTab: 'persona' | 'lifeline' | 'terminal' = 'persona'
let expanded: Record<string, boolean> = {}
type MemoryContentState = { status: 'idle' | 'loading' | 'ready' | 'error'; content?: string; error?: string }
let memoryContent: Record<string, MemoryContentState> = {}

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

$: if ($activeView === 'memory') {
  loadEvents();
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

function isExpanded(item: { relPath?: string; id?: string; name?: string }): boolean {
  const key = getEventKey(item);
  return key ? !!expanded[key] : false;
}

function toggleExpanded(item: { relPath?: string; id?: string; name?: string }) {
  const key = getEventKey(item);
  if (!key) return;
  const next = !expanded[key];
  expanded = { ...expanded, [key]: next };
  if (next && item.relPath) {
    loadMemoryContent(item.relPath);
  }
}

function getPreview(content = '', limit = 160): string {
  if (!content) return '';
  return content.length > limit ? `${content.slice(0, limit)}…` : content;
}

async function loadMemoryContent(relPath: string) {
  const current = memoryContent[relPath];
  if (current && (current.status === 'loading' || current.status === 'ready')) return;

  memoryContent = { ...memoryContent, [relPath]: { status: 'loading' } };
  try {
    const res = await fetch(`/api/memory-content?relPath=${encodeURIComponent(relPath)}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data?.error || 'Failed to load memory content');
    }
    memoryContent = { ...memoryContent, [relPath]: { status: 'ready', content: data.content } };
  } catch (error) {
    memoryContent = {
      ...memoryContent,
      [relPath]: { status: 'error', error: (error as Error).message },
    };
  }
}

function getMemoryContent(item: { relPath?: string; content?: string }): MemoryContentState {
  if (!item.relPath) {
    return { status: 'ready', content: item.content ?? '' };
  }
  return memoryContent[item.relPath] ?? { status: 'idle', content: item.content ?? '' };
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
        <div class="memory-tabs">
          <button class="mem-tab" class:active={memoryTab==='episodic'} on:click={() => memoryTab='episodic'}>Episodic</button>
          <button class="mem-tab" class:active={memoryTab==='reflections'} on:click={() => memoryTab='reflections'}>Reflections</button>
          <button class="mem-tab" class:active={memoryTab==='tasks'} on:click={() => memoryTab='tasks'}>Tasks</button>
          <button class="mem-tab" class:active={memoryTab==='curated'} on:click={() => memoryTab='curated'}>Curated</button>
          <button class="mem-tab" class:active={memoryTab==='ai-ingestor'} on:click={() => memoryTab='ai-ingestor'}>AI Ingestor</button>
          <button class="mem-tab" class:active={memoryTab==='audio'} on:click={() => memoryTab='audio'}>Audio</button>
          <button class="mem-tab" class:active={memoryTab==='dreams'} on:click={() => memoryTab='dreams'}>Dreams 💭</button>
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
              <div class="event-card">
                <div class="event-header">
                  <button
                    class="event-title-button"
                    type="button"
                    on:click={() => toggleExpanded(event)}
                    aria-expanded={isExpanded(event)}
                  >
                    <span class="event-title">{getPreview(event.content)}</span>
                    <span class="event-toggle-icon" aria-hidden="true">{isExpanded(event) ? '▲' : '▼'}</span>
                    <span class="sr-only">{isExpanded(event) ? 'Collapse memory' : 'Expand memory'}</span>
                  </button>
                  <div class="validation-controls">
                    <button class="val-btn good" title="Mark as correct" on:click={() => setValidation(event, 'correct')} disabled={saving[event.relPath] || event.validation?.status === 'correct'}>+
                    </button>
                    <button class="val-btn bad" title="Delete memory" on:click={() => onMinusClick(event)} disabled={deleting[event.relPath]}>−
                    </button>
                  </div>
                </div>
                {#if isExpanded(event)}
                  {@const state = getMemoryContent(event)}
                  {#if state.status === 'loading'}
                    <div class="event-body loading">Loading full memory…</div>
                  {:else if state.status === 'error'}
                    <div class="event-body error">Failed to load memory: {state.error}</div>
                  {:else}
                    <div class="event-body">
                      <pre>{state.content ?? event.content}</pre>
                    </div>
                  {/if}
                {/if}
                <div class="event-meta">
                  <div class="event-when">{new Date(event.timestamp).toLocaleString()}</div>
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
                <div class="event-card">
                  <div class="event-header">
                    <button
                      class="event-title-button"
                      type="button"
                      on:click={() => toggleExpanded(event)}
                      aria-expanded={isExpanded(event)}
                    >
                      <span class="event-title">{getPreview(event.content)}</span>
                      <span class="event-toggle-icon" aria-hidden="true">{isExpanded(event) ? '▲' : '▼'}</span>
                      <span class="sr-only">{isExpanded(event) ? 'Collapse memory' : 'Expand memory'}</span>
                    </button>
                    <div class="validation-controls">
                      <button class="val-btn good" title="Mark as correct" on:click={() => setValidation(event, 'correct')} disabled={saving[event.relPath] || event.validation?.status === 'correct'}>+
                      </button>
                      <button class="val-btn bad" title="Delete memory" on:click={() => onMinusClick(event)} disabled={deleting[event.relPath]}>−
                      </button>
                    </div>
                  </div>
                  {#if isExpanded(event)}
                    {@const state = getMemoryContent(event)}
                    {#if state.status === 'loading'}
                      <div class="event-body loading">Loading reflection…</div>
                    {:else if state.status === 'error'}
                      <div class="event-body error">Failed to load reflection: {state.error}</div>
                    {:else}
                      <div class="event-body">
                        <pre>{state.content ?? event.content}</pre>
                      </div>
                    {/if}
                  {/if}
                  <div class="event-meta">
                    <div class="event-when">{new Date(event.timestamp).toLocaleString()}</div>
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
              <div class="event-card">
                <div class="event-header">
                  <button
                    class="event-title-button"
                    type="button"
                    on:click={() => toggleExpanded(t)}
                    aria-expanded={isExpanded(t)}
                  >
                    <span class="event-title">{getPreview(t.title, 200)}</span>
                    <span class="event-toggle-icon" aria-hidden="true">{isExpanded(t) ? '▲' : '▼'}</span>
                    <span class="sr-only">{isExpanded(t) ? 'Collapse memory' : 'Expand memory'}</span>
                  </button>
                </div>
                {#if isExpanded(t)}
                  {@const state = getMemoryContent(t)}
                  {#if state.status === 'loading'}
                    <div class="event-body loading">Loading task content…</div>
                  {:else if state.status === 'error'}
                    <div class="event-body error">Failed to load task: {state.error}</div>
                  {:else}
                    <div class="event-body">
                      <pre>{state.content ?? JSON.stringify(t, null, 2)}</pre>
                    </div>
                  {/if}
                {/if}
                <div class="event-meta">
                  <div class="event-when">{t.updated ? new Date(t.updated).toLocaleString() : ''}</div>
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
              <div class="event-card">
                <div class="event-header">
                  <button
                    class="event-title-button"
                    type="button"
                    on:click={() => toggleExpanded(c)}
                    aria-expanded={isExpanded(c)}
                  >
                    <span class="event-title">{c.name}</span>
                    <span class="event-toggle-icon" aria-hidden="true">{isExpanded(c) ? '▲' : '▼'}</span>
                    <span class="sr-only">{isExpanded(c) ? 'Collapse memory' : 'Expand memory'}</span>
                  </button>
                </div>
                {#if isExpanded(c)}
                  {@const state = getMemoryContent(c)}
                  {#if state.status === 'loading'}
                    <div class="event-body loading">Loading curated content…</div>
                  {:else if state.status === 'error'}
                    <div class="event-body error">Failed to load file: {state.error}</div>
                  {:else}
                    <div class="event-body">
                      <pre>{state.content ?? ''}</pre>
                    </div>
                  {/if}
                {/if}
                <div class="event-meta">
                  <div class="event-when">{c.relPath}</div>
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
                <div class="event-card ai-ingestor-card">
                  <div class="event-header">
                    <button
                      class="event-title-button"
                      type="button"
                      on:click={() => toggleExpanded(event)}
                      aria-expanded={isExpanded(event)}
                    >
                      <span class="event-title">{getPreview(event.content)}</span>
                      <span class="event-toggle-icon" aria-hidden="true">{isExpanded(event) ? '▲' : '▼'}</span>
                      <span class="sr-only">{isExpanded(event) ? 'Collapse memory' : 'Expand memory'}</span>
                    </button>
                    <div class="validation-controls">
                      <button class="val-btn good" title="Mark as correct" on:click={() => setValidation(event, 'correct')} disabled={saving[event.relPath] || event.validation?.status === 'correct'}>+
                      </button>
                      <button class="val-btn bad" title="Delete memory" on:click={() => onMinusClick(event)} disabled={deleting[event.relPath]}>−
                      </button>
                    </div>
                  </div>
                  {#if isExpanded(event)}
                    {@const state = getMemoryContent(event)}
                    {#if state.status === 'loading'}
                      <div class="event-body loading">Loading AI ingestor memory…</div>
                    {:else if state.status === 'error'}
                      <div class="event-body error">Failed to load memory: {state.error}</div>
                    {:else}
                      <div class="event-body">
                        <pre>{state.content ?? event.content}</pre>
                      </div>
                    {/if}
                  {/if}
                  <div class="event-meta">
                    <div class="event-when">{new Date(event.timestamp).toLocaleString()}</div>
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
                <div class="event-card audio-transcript-card">
                  <div class="event-header">
                    <button
                      class="event-title-button"
                      type="button"
                      on:click={() => toggleExpanded(event)}
                      aria-expanded={isExpanded(event)}
                    >
                      <span class="event-title">{getPreview(event.content)}</span>
                      <span class="event-toggle-icon" aria-hidden="true">{isExpanded(event) ? '▲' : '▼'}</span>
                      <span class="sr-only">{isExpanded(event) ? 'Collapse memory' : 'Expand memory'}</span>
                    </button>
                    <div class="validation-controls">
                      <button class="val-btn good" title="Mark as correct" on:click={() => setValidation(event, 'correct')} disabled={saving[event.relPath] || event.validation?.status === 'correct'}>+
                      </button>
                      <button class="val-btn bad" title="Delete memory" on:click={() => onMinusClick(event)} disabled={deleting[event.relPath]}>−
                      </button>
                    </div>
                  </div>
                  {#if isExpanded(event)}
                    {@const state = getMemoryContent(event)}
                    {#if state.status === 'loading'}
                      <div class="event-body loading">Loading audio transcript…</div>
                    {:else if state.status === 'error'}
                      <div class="event-body error">Failed to load transcript: {state.error}</div>
                    {:else}
                      <div class="event-body">
                        <pre>{state.content ?? event.content}</pre>
                      </div>
                    {/if}
                  {/if}
                  <div class="event-meta">
                    <div class="event-when">{new Date(event.timestamp).toLocaleString()}</div>
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
              <div class="event-card dream-card">
                <div class="event-header">
                  <button
                    class="event-title-button"
                    type="button"
                    on:click={() => toggleExpanded(event)}
                    aria-expanded={isExpanded(event)}
                  >
                    <span class="event-title">{getPreview(event.content)}</span>
                    <span class="event-toggle-icon" aria-hidden="true">{isExpanded(event) ? '▲' : '▼'}</span>
                    <span class="sr-only">{isExpanded(event) ? 'Collapse memory' : 'Expand memory'}</span>
                  </button>
                </div>
                {#if isExpanded(event)}
                  {@const state = getMemoryContent(event)}
                  {#if state.status === 'loading'}
                    <div class="event-body loading">Loading dream memory…</div>
                  {:else if state.status === 'error'}
                    <div class="event-body error">Failed to load dream: {state.error}</div>
                  {:else}
                    <div class="event-body">
                      <pre>{state.content ?? event.content}</pre>
                    </div>
                  {/if}
                {/if}
                <div class="event-meta">
                  <div class="event-when">{new Date(event.timestamp).toLocaleString()}</div>
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
        <div class="memory-tabs">
          <button class="mem-tab" class:active={voiceTab==='upload'} on:click={() => voiceTab='upload'}>Upload & Transcribe</button>
          <button class="mem-tab" class:active={voiceTab==='training'} on:click={() => voiceTab='training'}>Voice Clone Training</button>
        </div>
        {#if voiceTab === 'upload'}
          <div class="audio-grid">
            <AudioUpload />
            <AudioRecorder />
          </div>
        {:else if voiceTab === 'training'}
          <VoiceTrainingWidget />
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
        <div class="memory-tabs">
          <button class="mem-tab" class:active={trainingTab==='datasets'} on:click={() => trainingTab='datasets'}>Datasets</button>
          <button class="mem-tab" class:active={trainingTab==='monitor'} on:click={() => trainingTab='monitor'}>Training Monitor</button>
          <button class="mem-tab" class:active={trainingTab==='adapters'} on:click={() => trainingTab='adapters'}>Adapters</button>
        </div>
        {#if trainingTab === 'datasets'}
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
        <div class="memory-tabs">
          <button class="mem-tab" class:active={systemTab==='persona'} on:click={() => systemTab='persona'}>Persona</button>
          <button class="mem-tab" class:active={systemTab==='lifeline'} on:click={() => systemTab='lifeline'}>Lifeline</button>
          <button class="mem-tab" class:active={systemTab==='terminal'} on:click={() => systemTab='terminal'}>Terminal</button>
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
                      <input type="text" bind:value={personaForm.name} placeholder="MetaHuman Greg" />
                    </label>
                    <label class="field">
                      <span>Human Name</span>
                      <input type="text" bind:value={personaForm.humanName} placeholder="Gregory Aster" />
                    </label>
                    <label class="field">
                      <span>Email</span>
                      <input type="email" bind:value={personaForm.email} placeholder="greg@example.com" />
                    </label>
                    <label class="field">
                      <span>Avatar Path / URL</span>
                      <input type="text" bind:value={personaForm.avatar} placeholder="/assets/avatar/avatar.png" />
                    </label>
                    <label class="field">
                      <span>Role</span>
                      <input type="text" bind:value={personaForm.role} placeholder="Digital persona…" />
                    </label>
                    <label class="field">
                      <span>Aliases (comma separated)</span>
                      <input type="text" bind:value={personaForm.aliases} placeholder="Greg, MetaHuman Greg" />
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
        {:else if systemTab === 'lifeline'}
          <Lifeline />
        {:else if systemTab === 'terminal'}
          <Terminal />
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .center-content {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    overflow: hidden;
  }

  .view-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .view-container.terminal-view {
    padding: 0;
  }

  .view-header {
    padding: 1.5rem 2rem 1rem;
    border-bottom: 1px solid rgba(0, 0, 0, 0.1);
    flex-shrink: 0;
  }

  :global(.dark) .view-header {
    border-bottom-color: rgba(255, 255, 255, 0.1);
  }

  .view-title {
    font-size: 1.5rem;
    font-weight: 700;
    color: rgb(17 24 39);
    margin: 0 0 0.25rem 0;
  }

  :global(.dark) .view-title {
    color: rgb(243 244 246);
  }

  .view-subtitle {
    font-size: 0.875rem;
    color: rgb(107 114 128);
    margin: 0;
  }

  :global(.dark) .view-subtitle {
    color: rgb(156 163 175);
  }

  .view-content {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 2rem;
  }

  .audio-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1rem;
  }

  .memory-tabs { display: flex; gap: 0.5rem; margin-bottom: 0.75rem; }
  .mem-tab { padding: 0.35rem 0.75rem; border-radius: 9999px; border: 1px solid rgba(0,0,0,0.15); background: white; cursor: pointer; font-weight: 600; font-size: 0.85rem; }
  .mem-tab.active { background: rgb(124 58 237); color: white; border-color: transparent; }
  :global(.dark) .mem-tab { background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.2); color: rgb(209 213 219) }
  :global(.dark) .mem-tab.active { background: rgb(167 139 250); color: rgb(17 24 39); }

  /* Loading/Empty States */
  .loading-state,
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: rgb(107 114 128);
  }

  :global(.dark) .loading-state,
  :global(.dark) .empty-state {
    color: rgb(156 163 175);
  }

  .empty-icon {
    font-size: 4rem;
    margin-bottom: 1rem;
    opacity: 0.5;
  }

  .empty-title {
    font-size: 1.25rem;
    font-weight: 600;
    margin-bottom: 0.5rem;
    color: rgb(17 24 39);
  }

  :global(.dark) .empty-title {
    color: rgb(243 244 246);
  }

  .empty-description {
    font-size: 0.875rem;
    text-align: center;
    max-width: 400px;
  }

  .empty-description code {
    padding: 0.125rem 0.375rem;
    border-radius: 0.25rem;
    background: rgba(0, 0, 0, 0.1);
    font-family: monospace;
    font-size: 0.875em;
  }

  :global(.dark) .empty-description code {
    background: rgba(255, 255, 255, 0.1);
  }

  /* Events List */
  .events-list {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .event-card {
    padding: 1rem;
    border-radius: 0.5rem;
    border: 1px solid rgba(0, 0, 0, 0.1);
    background: white;
  }

  :global(.dark) .event-card {
    border-color: rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.05);
  }

  .event-title {
    font-weight: 600;
    color: rgb(17 24 39);
    margin: 0;
  }

  :global(.dark) .event-title {
    color: rgb(243 244 246);
  }

  .event-title-button {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background: none;
    border: none;
    padding: 0;
    margin: 0;
    cursor: pointer;
    text-align: left;
    color: inherit;
    font: inherit;
  }

  .event-title-button:focus-visible {
    outline: 2px solid rgba(59, 130, 246, 0.6);
    outline-offset: 2px;
  }

  .event-toggle-icon {
    font-size: 0.75rem;
    color: rgb(107 114 128);
  }

  :global(.dark) .event-toggle-icon {
    color: rgb(156 163 175);
  }

  .event-when {
    font-size: 0.875rem;
    color: rgb(107 114 128);
  }

  :global(.dark) .event-when {
    color: rgb(156 163 175);
  }

  .event-header { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; }
  .validation-controls { display: flex; gap: 0.25rem; }
  .val-btn { width: 28px; height: 28px; border-radius: 6px; border: 1px solid rgba(0,0,0,0.15); background: white; font-weight: 700; cursor: pointer; }
  .val-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .val-btn.good { color: rgb(22 163 74); border-color: rgba(22,163,74,0.3); }
  .val-btn.bad { color: rgb(220 38 38); border-color: rgba(220,38,38,0.3); }
  :global(.dark) .val-btn { background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.2); }

  .event-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 0.5rem;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .event-valid { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; padding: 0.15rem 0.4rem; border-radius: 0.25rem; }
  .event-valid.correct { color: rgb(22 163 74); background: rgba(22,163,74,0.1); }
  .event-valid.incorrect { color: rgb(220 38 38); background: rgba(220,38,38,0.1); }

  .event-body {
    margin-top: 0.75rem;
    font-size: 0.95rem;
    line-height: 1.55;
    color: rgb(55 65 81);
    border-top: 1px solid rgba(0, 0, 0, 0.08);
    padding-top: 0.75rem;
  }

  :global(.dark) .event-body {
    color: rgb(209 213 219);
    border-top-color: rgba(255, 255, 255, 0.1);
  }

  .event-body pre {
    margin: 0;
    font: inherit;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .event-body.loading,
  .event-body.error {
    font-weight: 500;
  }

  .event-body.error {
    color: rgb(220 38 38);
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  /* Persona Info */
  .persona-panel {
    max-width: 760px;
    margin: 0 auto;
    padding: 2rem 2.5rem;
  }

  .persona-form {
    display: flex;
    flex-direction: column;
    gap: 1.75rem;
  }

  .persona-section h4 {
    font-size: 1rem;
    font-weight: 600;
    margin-bottom: 0.75rem;
  }

  .form-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 1rem;
    margin-bottom: 1rem;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .field > span {
    font-size: 0.8rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: rgb(107 114 128);
  }

  :global(.dark) .field > span {
    color: rgb(156 163 175);
  }

  .field input,
  .field textarea {
    border: 1px solid rgba(0,0,0,0.12);
    border-radius: 0.5rem;
    padding: 0.55rem 0.75rem;
    font-size: 0.9rem;
    background: white;
    color: rgb(17 24 39);
    transition: border-color 0.2s, box-shadow 0.2s;
  }

  .field textarea {
    min-height: 120px;
    resize: vertical;
  }

  :global(.dark) .field input,
  :global(.dark) .field textarea {
    background: rgb(17 24 39);
    color: rgb(243 244 246);
    border-color: rgba(255,255,255,0.15);
  }

  .field input:focus,
  .field textarea:focus {
    border-color: rgb(124 58 237);
    box-shadow: 0 0 0 2px rgba(124, 58, 237, 0.15);
    outline: none;
  }

  .persona-actions {
    display: flex;
    justify-content: flex-end;
  }

  .save-button {
    appearance: none;
    border: none;
    background: linear-gradient(135deg, rgb(124 58 237), rgb(109 40 217));
    color: white;
    font-weight: 600;
    font-size: 0.95rem;
    padding: 0.65rem 1.5rem;
    border-radius: 0.5rem;
    cursor: pointer;
    transition: transform 0.1s ease, box-shadow 0.2s ease;
  }

  .save-button:hover:not(:disabled) {
    box-shadow: 0 10px 25px rgba(124, 58, 237, 0.25);
  }

  .save-button:active:not(:disabled) {
    transform: translateY(1px);
  }

  .save-button:disabled {
    opacity: 0.7;
    cursor: wait;
  }

  .persona-alert {
    border-radius: 0.5rem;
    padding: 0.75rem 1rem;
    margin-bottom: 1rem;
    font-size: 0.85rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }

  .persona-alert.success {
    background: rgba(16, 185, 129, 0.15);
    color: rgb(5 150 105);
  }

  :global(.dark) .persona-alert.success {
    background: rgba(16, 185, 129, 0.2);
    color: rgb(52 211 153);
  }

  .persona-alert.error {
    background: rgba(239, 68, 68, 0.15);
    color: rgb(220 38 38);
  }

  :global(.dark) .persona-alert.error {
    background: rgba(239, 68, 68, 0.2);
    color: rgb(248 113 113);
  }

  .persona-alert.inline {
    justify-content: flex-start;
  }

  .retry-button {
    appearance: none;
    border: none;
    background: rgb(220 38 38);
    color: white;
    font-weight: 600;
    padding: 0.4rem 0.9rem;
    border-radius: 0.5rem;
    cursor: pointer;
    transition: background 0.2s ease;
    flex-shrink: 0;
  }

  .retry-button:hover {
    background: rgb(185 28 28);
  }

  .muted {
    color: rgb(107 114 128);
    line-height: 1.6;
  }

  :global(.dark) .muted {
    color: rgb(156 163 175);
  }

  /* Scrollbar */
  .view-content::-webkit-scrollbar {
    width: 8px;
  }

  .view-content::-webkit-scrollbar-track {
    background: transparent;
  }

  .view-content::-webkit-scrollbar-thumb {
    background: rgba(0, 0, 0, 0.2);
    border-radius: 4px;
  }

  :global(.dark) .view-content::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.2);
  }

  .view-content::-webkit-scrollbar-thumb:hover {
    background: rgba(0, 0, 0, 0.3);
  }

  :global(.dark) .view-content::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.3);
  }

  /* AI Ingestor Styles */
  .ai-ingestor-card {
    border-left: 3px solid rgb(124 58 237);
  }

  :global(.dark) .ai-ingestor-card {
    border-left-color: rgb(167 139 250);
  }

  .event-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    margin-top: 0.25rem;
  }

  .event-tag {
    font-size: 0.7rem;
    padding: 0.125rem 0.375rem;
    border-radius: 0.25rem;
    background: rgba(124, 58, 237, 0.1);
    color: rgb(124 58 237);
    font-weight: 500;
  }

  :global(.dark) .event-tag {
    background: rgba(167, 139, 250, 0.2);
    color: rgb(167 139 250);
  }

  .event-links {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    margin-top: 0.25rem;
  }

  .event-link {
    font-size: 0.7rem;
    padding: 0.125rem 0.375rem;
    border-radius: 0.25rem;
    background: rgba(59, 130, 246, 0.1);
    color: rgb(59 130 246);
    font-weight: 500;
  }

  :global(.dark) .event-link {
    background: rgba(96, 165, 250, 0.2);
    color: rgb(96 165 250);
  }

  /* Audio Transcript Styles */
  .audio-transcript-card {
    border-left: 3px solid rgb(59 130 246);
  }

  :global(.dark) .audio-transcript-card {
    border-left-color: rgb(96 165 250);
  }

.dream-card {
  border-left: 3px solid rgb(250 204 21); /* Example: Yellow border */
}
:global(.dark) .dream-card {
  border-left-color: rgb(253 224 71); /* Example: Lighter yellow for dark mode */
}
</style>
