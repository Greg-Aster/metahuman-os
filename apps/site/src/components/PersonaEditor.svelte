<script lang="ts">
  import { onMount } from 'svelte';
  import { apiFetch } from '../lib/client/api-config';

  type PersonaCore = {
    $schema?: string;
    version?: string;
    lastUpdated?: string;
    identity: {
      name: string;
      role: string;
      purpose: string;
      humanName: string;
      email: string;
      icon: string;
      aliases: string[];
    };
    personality: {
      communicationStyle: {
        tone: string[];
        humor: string;
        formality: string;
        verbosity: string;
        vocabularyLevel: string;
        preferredPronouns: string;
      };
      cadence?: {
        modes: string[];
        energyPeaks: string[];
        loopSignals: string[];
      };
      traits?: {
        openness: number;
        conscientiousness: number;
        extraversion: number;
        agreeableness: number;
        neuroticism: number;
        notes: string;
      };
      archetypes?: string[];
      aesthetic?: string[];
      narrativeStyle: string;
      interests?: string[];
    };
    values: {
      core?: Array<{ value: string; description: string; priority: number }>;
      boundaries: string[];
    };
    decisionHeuristics?: Array<{ signal: string; response: string; evidence?: string }>;
    writingStyle?: {
      structure: string;
      motifs: string[];
      defaultMantra: string;
    };
    goals?: {
      shortTerm: Array<{ goal: string; status: string; notes?: string }>;
      midTerm: Array<{ goal: string; status: string; notes?: string }>;
      longTerm: Array<{ goal: string; status: string; notes?: string }>;
    };
    context?: {
      domains: string[];
      projects: Array<{ name: string; status: string; summary?: string }>;
      currentFocus: string[];
    };
    notes?: string;
    background?: string;
  };

  type Facet = {
    name: string;
    description: string;
    personaFile: string | null;
    enabled: boolean;
    color: string;
    usageHints: string[];
  };

  type FacetsConfig = {
    $schema?: string;
    version?: string;
    lastUpdated?: string;
    activeFacet: string;
    description: string;
    facets: Record<string, Facet>;
  };

  let editorTab: 'core' | 'facets' | 'archives' = 'core';
  let coreTab: 'identity' | 'personality' | 'values' | 'goals' | 'context' | 'advanced' = 'identity';

  let personaCore: PersonaCore | null = null;
  let facetsConfig: FacetsConfig | null = null;

  let loading = false;
  let saving = false;
  let error: string | null = null;
  let success: string | null = null;

  // Archive management state
  type Archive = {
    filename: string;
    timestamp: string;
    createdAt: string;
    version: string;
    lastUpdated: string | null;
    identity: { name: string; role: string };
    size: number;
  };
  let archives: Archive[] = [];
  let loadingArchives = false;
  let archivesLoaded = false; // Track if we've attempted to load
  let selectedArchive: any = null;
  let viewingArchive = false;

  onMount(() => {
    loadPersonaData();
  });

  async function loadPersonaData() {
    loading = true;
    error = null;
    try {
      // Load persona core
      const coreRes = await apiFetch('/api/persona-core-manage');
      const coreData = await coreRes.json();
      if (!coreData.success) throw new Error(coreData.error || 'Failed to load persona core');
      personaCore = coreData.persona;

      // Load facets
      const facetsRes = await apiFetch('/api/persona-facets-manage');
      const facetsData = await facetsRes.json();
      if (!facetsData.success) throw new Error(facetsData.error || 'Failed to load facets');
      facetsConfig = facetsData.facets;
    } catch (e) {
      console.error('Failed to load persona data:', e);
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }

  async function savePersonaCore() {
    if (!personaCore) return;
    saving = true;
    error = null;
    success = null;
    try {
      const res = await apiFetch('/api/persona-core-manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ persona: personaCore }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed to save persona core');
      success = 'Persona core saved successfully!';
      setTimeout(() => { success = null; }, 3000);
    } catch (e) {
      console.error('Failed to save persona core:', e);
      error = (e as Error).message;
    } finally {
      saving = false;
    }
  }

  async function saveFacets() {
    if (!facetsConfig) return;
    saving = true;
    error = null;
    success = null;
    try {
      const res = await apiFetch('/api/persona-facets-manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facets: facetsConfig }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed to save facets');
      success = 'Facets saved successfully!';
      setTimeout(() => { success = null; }, 3000);
    } catch (e) {
      console.error('Failed to save facets:', e);
      error = (e as Error).message;
    } finally {
      saving = false;
    }
  }

  function addCoreValue() {
    if (!personaCore) return;
    if (!personaCore.values.core) personaCore.values.core = [];
    personaCore.values.core.push({ value: '', description: '', priority: personaCore.values.core.length + 1 });
    personaCore = personaCore; // Trigger reactivity
  }

  function removeCoreValue(index: number) {
    if (!personaCore || !personaCore.values.core) return;
    personaCore.values.core.splice(index, 1);
    personaCore = personaCore;
  }

  function addDecisionHeuristic() {
    if (!personaCore) return;
    if (!personaCore.decisionHeuristics) personaCore.decisionHeuristics = [];
    personaCore.decisionHeuristics.push({ signal: '', response: '', evidence: '' });
    personaCore = personaCore;
  }

  function removeDecisionHeuristic(index: number) {
    if (!personaCore || !personaCore.decisionHeuristics) return;
    personaCore.decisionHeuristics.splice(index, 1);
    personaCore = personaCore;
  }

  function addGoal(type: 'shortTerm' | 'midTerm' | 'longTerm') {
    if (!personaCore) return;
    if (!personaCore.goals) {
      personaCore.goals = { shortTerm: [], midTerm: [], longTerm: [] };
    }
    personaCore.goals[type].push({ goal: '', status: 'pending', notes: '' });
    personaCore = personaCore;
  }

  function removeGoal(type: 'shortTerm' | 'midTerm' | 'longTerm', index: number) {
    if (!personaCore || !personaCore.goals) return;
    personaCore.goals[type].splice(index, 1);
    personaCore = personaCore;
  }

  function addProject() {
    if (!personaCore) return;
    if (!personaCore.context) personaCore.context = { domains: [], projects: [], currentFocus: [] };
    personaCore.context.projects.push({ name: '', status: 'active', summary: '' });
    personaCore = personaCore;
  }

  function removeProject(index: number) {
    if (!personaCore || !personaCore.context) return;
    personaCore.context.projects.splice(index, 1);
    personaCore = personaCore;
  }

  function addFacet() {
    if (!facetsConfig) return;
    const facetId = `facet_${Date.now()}`;
    facetsConfig.facets[facetId] = {
      name: 'New Facet',
      description: '',
      personaFile: 'core.json',
      enabled: true,
      color: 'blue',
      usageHints: []
    };
    facetsConfig = facetsConfig;
  }

  function removeFacet(facetId: string) {
    if (!facetsConfig) return;
    if (facetId === 'default') {
      alert('Cannot remove the default facet');
      return;
    }
    delete facetsConfig.facets[facetId];
    if (facetsConfig.activeFacet === facetId) {
      facetsConfig.activeFacet = 'default';
    }
    facetsConfig = facetsConfig;
  }

  // Archive management functions
  async function loadArchives() {
    console.log('[PersonaEditor] Loading archives...');
    loadingArchives = true;
    error = null;
    try {
      const res = await apiFetch('/api/persona-archives');
      console.log('[PersonaEditor] Archive response status:', res.status);

      if (!res.ok) {
        const text = await res.text();
        console.error('[PersonaEditor] Archive error response:', text);
        throw new Error(`HTTP ${res.status}: ${text}`);
      }

      const data = await res.json();
      console.log('[PersonaEditor] Archive data:', data);

      if (!data.success) throw new Error(data.error || 'Failed to load archives');
      archives = data.archives;
      archivesLoaded = true; // Mark as loaded
      console.log('[PersonaEditor] Loaded archives:', archives.length);
    } catch (e) {
      console.error('[PersonaEditor] Failed to load archives:', e);
      error = (e as Error).message;
      archivesLoaded = true; // Mark as attempted even if failed
    } finally {
      loadingArchives = false;
    }
  }

  async function viewArchive(filename: string) {
    loading = true;
    error = null;
    try {
      const res = await apiFetch('/api/persona-archives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'view', filename }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed to view archive');
      selectedArchive = data.persona;
      viewingArchive = true;
    } catch (e) {
      console.error('Failed to view archive:', e);
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }

  async function restoreArchive(filename: string) {
    if (!confirm(`Are you sure you want to restore this archive? Your current persona will be backed up first.`)) {
      return;
    }

    saving = true;
    error = null;
    success = null;
    try {
      const res = await apiFetch('/api/persona-archives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'restore', filename }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed to restore archive');
      success = `Persona restored successfully! Current version backed up as ${data.backupFile}`;

      // Reload persona data
      await loadPersonaData();

      // Reload archives to show new backup
      await loadArchives();

      setTimeout(() => { success = null; }, 5000);
    } catch (e) {
      console.error('Failed to restore archive:', e);
      error = (e as Error).message;
    } finally {
      saving = false;
    }
  }

  async function deleteArchive(filename: string) {
    if (!confirm(`Are you sure you want to delete this archive? This cannot be undone.`)) {
      return;
    }

    saving = true;
    error = null;
    success = null;
    try {
      const res = await apiFetch('/api/persona-archives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', filename }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed to delete archive');
      success = 'Archive deleted successfully!';
      await loadArchives();
      setTimeout(() => { success = null; }, 3000);
    } catch (e) {
      console.error('Failed to delete archive:', e);
      error = (e as Error).message;
    } finally {
      saving = false;
    }
  }

  function closeArchiveViewer() {
    viewingArchive = false;
    selectedArchive = null;
  }

  function formatTimestamp(timestamp: string): string {
    // Convert YYYY-MM-DD-HHmmss to readable format
    const match = timestamp.match(/(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})/);
    if (match) {
      const [_, year, month, day, hour, min, sec] = match;
      return `${year}-${month}-${day} ${hour}:${min}:${sec}`;
    }
    return timestamp;
  }

  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  // Load archives when switching to archives tab (only once)
  $: if (editorTab === 'archives' && !archivesLoaded && !loadingArchives) {
    loadArchives();
  }
</script>

<div class="persona-editor">
  {#if loading && !personaCore}
    <div class="loading-state">Loading persona data...</div>
  {:else if error && !personaCore}
    <div class="error-state">
      <div class="error-title">Failed to load persona data</div>
      <div class="error-message">{error}</div>
      <button class="retry-btn" on:click={loadPersonaData}>Retry</button>
    </div>
  {:else if personaCore}
    <div class="editor-header">
      <div class="tab-group">
        <button class="editor-tab" class:active={editorTab === 'core'} on:click={() => editorTab = 'core'}>
          Core Identity
        </button>
        <button class="editor-tab" class:active={editorTab === 'facets'} on:click={() => editorTab = 'facets'}>
          Facets
        </button>
        <button class="editor-tab" class:active={editorTab === 'archives'} on:click={() => editorTab = 'archives'}>
          Archives
        </button>
      </div>

      {#if success}
        <div class="success-banner">{success}</div>
      {/if}
      {#if error}
        <div class="error-banner">{error}</div>
      {/if}
    </div>

    {#if editorTab === 'core'}
      <div class="editor-content">
        <div class="sub-tab-group">
          <button class="sub-tab" class:active={coreTab === 'identity'} on:click={() => coreTab = 'identity'}>Identity</button>
          <button class="sub-tab" class:active={coreTab === 'personality'} on:click={() => coreTab = 'personality'}>Personality</button>
          <button class="sub-tab" class:active={coreTab === 'values'} on:click={() => coreTab = 'values'}>Values</button>
          <button class="sub-tab" class:active={coreTab === 'goals'} on:click={() => coreTab = 'goals'}>Goals</button>
          <button class="sub-tab" class:active={coreTab === 'context'} on:click={() => coreTab = 'context'}>Context</button>
          <button class="sub-tab" class:active={coreTab === 'advanced'} on:click={() => coreTab = 'advanced'}>Advanced</button>
        </div>

        <div class="form-container">
          {#if coreTab === 'identity'}
            <section class="form-section">
              <h3>Identity</h3>
              <div class="form-grid">
                <label>
                  <span>AI Name</span>
                  <input type="text" bind:value={personaCore.identity.name} />
                </label>
                <label>
                  <span>Human Name</span>
                  <input type="text" bind:value={personaCore.identity.humanName} />
                </label>
                <label>
                  <span>Email</span>
                  <input type="email" bind:value={personaCore.identity.email} />
                </label>
                <label>
                  <span>Icon Path</span>
                  <input type="text" bind:value={personaCore.identity.icon} />
                </label>
              </div>
              <label>
                <span>Role</span>
                <input type="text" bind:value={personaCore.identity.role} />
              </label>
              <label>
                <span>Purpose</span>
                <textarea rows="3" bind:value={personaCore.identity.purpose}></textarea>
              </label>
              <label>
                <span>Aliases (one per line)</span>
                <textarea rows="3" value={personaCore.identity.aliases.join('\n')} on:input={(e) => {
                  personaCore.identity.aliases = e.currentTarget.value.split('\n').map(s => s.trim()).filter(Boolean);
                }}></textarea>
              </label>
            </section>

          {:else if coreTab === 'personality'}
            <section class="form-section">
              <h3>Communication Style</h3>
              <div class="form-grid">
                <label>
                  <span>Tone (one per line)</span>
                  <textarea rows="3" value={personaCore.personality.communicationStyle.tone.join('\n')} on:input={(e) => {
                    personaCore.personality.communicationStyle.tone = e.currentTarget.value.split('\n').map(s => s.trim()).filter(Boolean);
                  }}></textarea>
                </label>
                <label>
                  <span>Humor</span>
                  <input type="text" bind:value={personaCore.personality.communicationStyle.humor} />
                </label>
                <label>
                  <span>Formality</span>
                  <input type="text" bind:value={personaCore.personality.communicationStyle.formality} />
                </label>
                <label>
                  <span>Verbosity</span>
                  <input type="text" bind:value={personaCore.personality.communicationStyle.verbosity} />
                </label>
                <label>
                  <span>Vocabulary Level</span>
                  <input type="text" bind:value={personaCore.personality.communicationStyle.vocabularyLevel} />
                </label>
                <label>
                  <span>Preferred Pronouns</span>
                  <input type="text" bind:value={personaCore.personality.communicationStyle.preferredPronouns} />
                </label>
              </div>
              <label>
                <span>Narrative Style</span>
                <textarea rows="3" bind:value={personaCore.personality.narrativeStyle}></textarea>
              </label>
            </section>

            {#if personaCore.personality.traits}
              <section class="form-section">
                <h3>Personality Traits (Big Five)</h3>
                <div class="traits-grid">
                  <label>
                    <span>Openness ({personaCore.personality.traits.openness})</span>
                    <input type="range" min="0" max="1" step="0.05" bind:value={personaCore.personality.traits.openness} />
                  </label>
                  <label>
                    <span>Conscientiousness ({personaCore.personality.traits.conscientiousness})</span>
                    <input type="range" min="0" max="1" step="0.05" bind:value={personaCore.personality.traits.conscientiousness} />
                  </label>
                  <label>
                    <span>Extraversion ({personaCore.personality.traits.extraversion})</span>
                    <input type="range" min="0" max="1" step="0.05" bind:value={personaCore.personality.traits.extraversion} />
                  </label>
                  <label>
                    <span>Agreeableness ({personaCore.personality.traits.agreeableness})</span>
                    <input type="range" min="0" max="1" step="0.05" bind:value={personaCore.personality.traits.agreeableness} />
                  </label>
                  <label>
                    <span>Neuroticism ({personaCore.personality.traits.neuroticism})</span>
                    <input type="range" min="0" max="1" step="0.05" bind:value={personaCore.personality.traits.neuroticism} />
                  </label>
                </div>
                <label>
                  <span>Traits Notes</span>
                  <textarea rows="2" bind:value={personaCore.personality.traits.notes}></textarea>
                </label>
              </section>
            {/if}

            <section class="form-section">
              <h3>Other Personality Traits</h3>
              <label>
                <span>Archetypes (one per line)</span>
                <textarea rows="3" value={personaCore.personality.archetypes?.join('\n') || ''} on:input={(e) => {
                  personaCore.personality.archetypes = e.currentTarget.value.split('\n').map(s => s.trim()).filter(Boolean);
                }}></textarea>
              </label>
              <label>
                <span>Aesthetic (one per line)</span>
                <textarea rows="3" value={personaCore.personality.aesthetic?.join('\n') || ''} on:input={(e) => {
                  personaCore.personality.aesthetic = e.currentTarget.value.split('\n').map(s => s.trim()).filter(Boolean);
                }}></textarea>
              </label>
              <label>
                <span>Interests (one per line)</span>
                <textarea rows="3" value={personaCore.personality.interests?.join('\n') || ''} on:input={(e) => {
                  personaCore.personality.interests = e.currentTarget.value.split('\n').map(s => s.trim()).filter(Boolean);
                }}></textarea>
              </label>
            </section>

          {:else if coreTab === 'values'}
            <section class="form-section">
              <h3>Core Values</h3>
              {#if personaCore.values.core}
                {#each personaCore.values.core as coreValue, i}
                  <div class="value-item">
                    <div class="value-header">
                      <span class="value-number">#{coreValue.priority}</span>
                      <button class="btn-remove" on:click={() => removeCoreValue(i)}>Remove</button>
                    </div>
                    <label>
                      <span>Value</span>
                      <input type="text" bind:value={coreValue.value} />
                    </label>
                    <label>
                      <span>Description</span>
                      <textarea rows="2" bind:value={coreValue.description}></textarea>
                    </label>
                    <label>
                      <span>Priority</span>
                      <input type="number" min="1" bind:value={coreValue.priority} />
                    </label>
                  </div>
                {/each}
              {/if}
              <button class="btn-add" on:click={addCoreValue}>+ Add Core Value</button>
            </section>

            <section class="form-section">
              <h3>Boundaries</h3>
              <label>
                <span>Boundaries (one per line)</span>
                <textarea rows="5" value={personaCore.values.boundaries.join('\n')} on:input={(e) => {
                  personaCore.values.boundaries = e.currentTarget.value.split('\n').map(s => s.trim()).filter(Boolean);
                }}></textarea>
              </label>
            </section>

          {:else if coreTab === 'goals'}
            <section class="form-section">
              <h3>Short-Term Goals</h3>
              {#if personaCore.goals?.shortTerm}
                {#each personaCore.goals.shortTerm as goal, i}
                  <div class="goal-item">
                    <button class="btn-remove" on:click={() => removeGoal('shortTerm', i)}>Remove</button>
                    <label>
                      <span>Goal</span>
                      <input type="text" bind:value={goal.goal} />
                    </label>
                    <label>
                      <span>Status</span>
                      <select bind:value={goal.status}>
                        <option value="pending">Pending</option>
                        <option value="active">Active</option>
                        <option value="completed">Completed</option>
                        <option value="paused">Paused</option>
                      </select>
                    </label>
                    <label>
                      <span>Notes</span>
                      <textarea rows="2" bind:value={goal.notes}></textarea>
                    </label>
                  </div>
                {/each}
              {/if}
              <button class="btn-add" on:click={() => addGoal('shortTerm')}>+ Add Short-Term Goal</button>
            </section>

            <section class="form-section">
              <h3>Mid-Term Goals</h3>
              {#if personaCore.goals?.midTerm}
                {#each personaCore.goals.midTerm as goal, i}
                  <div class="goal-item">
                    <button class="btn-remove" on:click={() => removeGoal('midTerm', i)}>Remove</button>
                    <label>
                      <span>Goal</span>
                      <input type="text" bind:value={goal.goal} />
                    </label>
                    <label>
                      <span>Status</span>
                      <select bind:value={goal.status}>
                        <option value="pending">Pending</option>
                        <option value="active">Active</option>
                        <option value="design">Design</option>
                        <option value="planning">Planning</option>
                        <option value="completed">Completed</option>
                      </select>
                    </label>
                    <label>
                      <span>Notes</span>
                      <textarea rows="2" bind:value={goal.notes}></textarea>
                    </label>
                  </div>
                {/each}
              {/if}
              <button class="btn-add" on:click={() => addGoal('midTerm')}>+ Add Mid-Term Goal</button>
            </section>

            <section class="form-section">
              <h3>Long-Term Goals</h3>
              {#if personaCore.goals?.longTerm}
                {#each personaCore.goals.longTerm as goal, i}
                  <div class="goal-item">
                    <button class="btn-remove" on:click={() => removeGoal('longTerm', i)}>Remove</button>
                    <label>
                      <span>Goal</span>
                      <input type="text" bind:value={goal.goal} />
                    </label>
                    <label>
                      <span>Status</span>
                      <select bind:value={goal.status}>
                        <option value="aspirational">Aspirational</option>
                        <option value="ongoing">Ongoing</option>
                        <option value="active">Active</option>
                        <option value="completed">Completed</option>
                      </select>
                    </label>
                    <label>
                      <span>Notes</span>
                      <textarea rows="2" bind:value={goal.notes}></textarea>
                    </label>
                  </div>
                {/each}
              {/if}
              <button class="btn-add" on:click={() => addGoal('longTerm')}>+ Add Long-Term Goal</button>
            </section>

          {:else if coreTab === 'context'}
            <section class="form-section">
              <h3>Domains</h3>
              <label>
                <span>Domains of Expertise (one per line)</span>
                <textarea rows="4" value={personaCore.context?.domains?.join('\n') || ''} on:input={(e) => {
                  if (!personaCore.context) personaCore.context = { domains: [], projects: [], currentFocus: [] };
                  personaCore.context.domains = e.currentTarget.value.split('\n').map(s => s.trim()).filter(Boolean);
                }}></textarea>
              </label>
            </section>

            <section class="form-section">
              <h3>Projects</h3>
              {#if personaCore.context?.projects}
                {#each personaCore.context.projects as project, i}
                  <div class="project-item">
                    <button class="btn-remove" on:click={() => removeProject(i)}>Remove</button>
                    <label>
                      <span>Project Name</span>
                      <input type="text" bind:value={project.name} />
                    </label>
                    <label>
                      <span>Status</span>
                      <select bind:value={project.status}>
                        <option value="active">Active</option>
                        <option value="paused">Paused</option>
                        <option value="completed">Completed</option>
                        <option value="planning">Planning</option>
                      </select>
                    </label>
                    <label>
                      <span>Summary</span>
                      <textarea rows="2" bind:value={project.summary}></textarea>
                    </label>
                  </div>
                {/each}
              {/if}
              <button class="btn-add" on:click={addProject}>+ Add Project</button>
            </section>

            <section class="form-section">
              <h3>Current Focus</h3>
              <label>
                <span>Current Focus Areas (one per line)</span>
                <textarea rows="4" value={personaCore.context?.currentFocus?.join('\n') || ''} on:input={(e) => {
                  if (!personaCore.context) personaCore.context = { domains: [], projects: [], currentFocus: [] };
                  personaCore.context.currentFocus = e.currentTarget.value.split('\n').map(s => s.trim()).filter(Boolean);
                }}></textarea>
              </label>
            </section>

          {:else if coreTab === 'advanced'}
            <section class="form-section">
              <h3>Decision Heuristics</h3>
              {#if personaCore.decisionHeuristics}
                {#each personaCore.decisionHeuristics as heuristic, i}
                  <div class="heuristic-item">
                    <button class="btn-remove" on:click={() => removeDecisionHeuristic(i)}>Remove</button>
                    <label>
                      <span>Signal</span>
                      <input type="text" bind:value={heuristic.signal} />
                    </label>
                    <label>
                      <span>Response</span>
                      <textarea rows="2" bind:value={heuristic.response}></textarea>
                    </label>
                    <label>
                      <span>Evidence (optional)</span>
                      <input type="text" bind:value={heuristic.evidence} />
                    </label>
                  </div>
                {/each}
              {/if}
              <button class="btn-add" on:click={addDecisionHeuristic}>+ Add Decision Heuristic</button>
            </section>

            <section class="form-section">
              <h3>Writing Style</h3>
              {#if personaCore.writingStyle}
                <label>
                  <span>Structure</span>
                  <textarea rows="2" bind:value={personaCore.writingStyle.structure}></textarea>
                </label>
                <label>
                  <span>Motifs (one per line)</span>
                  <textarea rows="3" value={personaCore.writingStyle.motifs?.join('\n') || ''} on:input={(e) => {
                    if (!personaCore.writingStyle) personaCore.writingStyle = { structure: '', motifs: [], defaultMantra: '' };
                    personaCore.writingStyle.motifs = e.currentTarget.value.split('\n').map(s => s.trim()).filter(Boolean);
                  }}></textarea>
                </label>
                <label>
                  <span>Default Mantra</span>
                  <input type="text" bind:value={personaCore.writingStyle.defaultMantra} />
                </label>
              {/if}
            </section>

            <section class="form-section">
              <h3>Background & Notes</h3>
              <label>
                <span>Background</span>
                <textarea rows="4" bind:value={personaCore.background}></textarea>
              </label>
              <label>
                <span>Notes</span>
                <textarea rows="4" bind:value={personaCore.notes}></textarea>
              </label>
            </section>
          {/if}

          <div class="form-actions">
            <button class="btn-save" on:click={savePersonaCore} disabled={saving}>
              {saving ? 'Saving...' : 'Save Core Identity'}
            </button>
          </div>
        </div>
      </div>

    {:else if editorTab === 'facets' && facetsConfig}
      <div class="editor-content">
        <div class="facets-header">
          <h3>Persona Facets</h3>
          <button class="btn-add" on:click={addFacet}>+ Add Facet</button>
        </div>

        <div class="facets-list">
          {#each Object.entries(facetsConfig.facets) as [facetId, facet]}
            <div class="facet-card">
              <div class="facet-header">
                <h4>{facet.name}</h4>
                {#if facetId !== 'default'}
                  <button class="btn-remove-small" on:click={() => removeFacet(facetId)}>Remove</button>
                {/if}
              </div>
              <div class="facet-body">
                <label>
                  <span>Name</span>
                  <input type="text" bind:value={facet.name} />
                </label>
                <label>
                  <span>Description</span>
                  <textarea rows="2" bind:value={facet.description}></textarea>
                </label>
                <div class="form-grid-small">
                  <label>
                    <span>Persona File</span>
                    <input type="text" bind:value={facet.personaFile} />
                  </label>
                  <label>
                    <span>Color</span>
                    <input type="text" bind:value={facet.color} />
                  </label>
                  <label class="checkbox-label">
                    <input type="checkbox" bind:checked={facet.enabled} />
                    <span>Enabled</span>
                  </label>
                </div>
                <label>
                  <span>Usage Hints (one per line)</span>
                  <textarea rows="2" value={facet.usageHints?.join('\n') || ''} on:input={(e) => {
                    facet.usageHints = e.currentTarget.value.split('\n').map(s => s.trim()).filter(Boolean);
                  }}></textarea>
                </label>
              </div>
            </div>
          {/each}
        </div>

        <div class="form-actions">
          <button class="btn-save" on:click={saveFacets} disabled={saving}>
            {saving ? 'Saving...' : 'Save Facets'}
          </button>
        </div>
      </div>

    {:else if editorTab === 'archives'}
      <div class="editor-content">
        <div class="archives-header">
          <div>
            <h3>Persona Archives</h3>
            <p class="archives-description">
              View and restore previous versions of your persona profile. Archives are automatically created by the psychoanalyzer agent before updates.
            </p>
          </div>
          <button class="btn-refresh" on:click={loadArchives} disabled={loadingArchives}>
            {loadingArchives ? 'Loading...' : 'Refresh'}
          </button>
        </div>

        {#if error}
          <div class="error-state">
            <div class="error-title">Failed to load archives</div>
            <div class="error-message">{error}</div>
            <button class="retry-btn" on:click={loadArchives}>Retry</button>
          </div>
        {:else if loadingArchives && archives.length === 0}
          <div class="loading-state">Loading archives...</div>
        {:else if archives.length === 0}
          <div class="empty-state">
            <p>No archives found. Archives are created automatically when the psychoanalyzer agent updates your persona.</p>
          </div>
        {:else}
          <div class="archives-list">
            {#each archives as archive}
              <div class="archive-card">
                <div class="archive-header">
                  <div class="archive-info">
                    <h4>{archive.identity.name}</h4>
                    <span class="archive-timestamp">{formatTimestamp(archive.timestamp)}</span>
                  </div>
                  <div class="archive-actions">
                    <button class="btn-view" on:click={() => viewArchive(archive.filename)}>View</button>
                    <button class="btn-restore" on:click={() => restoreArchive(archive.filename)} disabled={saving}>
                      Restore
                    </button>
                    <button class="btn-delete" on:click={() => deleteArchive(archive.filename)} disabled={saving}>
                      Delete
                    </button>
                  </div>
                </div>
                <div class="archive-meta">
                  <span>Role: {archive.identity.role}</span>
                  <span>Version: {archive.version}</span>
                  <span>Size: {formatFileSize(archive.size)}</span>
                </div>
              </div>
            {/each}
          </div>
        {/if}

        {#if viewingArchive && selectedArchive}
          <div class="archive-viewer-overlay" on:click={closeArchiveViewer} on:keydown={(e) => e.key === 'Escape' && closeArchiveViewer()} role="button" tabindex="-1">
            <div class="archive-viewer" on:click|stopPropagation role="dialog" aria-modal="true">
              <div class="archive-viewer-header">
                <h3>Archive Viewer</h3>
                <button class="btn-close" on:click={closeArchiveViewer}>×</button>
              </div>
              <div class="archive-viewer-content">
                <pre>{JSON.stringify(selectedArchive, null, 2)}</pre>
              </div>
              <div class="archive-viewer-actions">
                <button class="btn-close-footer" on:click={closeArchiveViewer}>Close</button>
              </div>
            </div>
          </div>
        {/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  .persona-editor {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .loading-state, .error-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 3rem;
    gap: 1rem;
  }

  .error-title {
    font-size: 1.25rem;
    font-weight: 600;
    color: #dc2626;
  }

  .error-message {
    color: #991b1b;
  }

  .retry-btn {
    padding: 0.5rem 1rem;
    background: #dc2626;
    color: white;
    border: none;
    border-radius: 0.5rem;
    cursor: pointer;
    font-weight: 600;
  }

  .editor-header {
    border-bottom: 1px solid #e5e7eb;
    padding: 1rem;
  }

  :global(.dark) .editor-header {
    border-bottom-color: #374151;
  }

  .tab-group {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }

  .editor-tab {
    padding: 0.5rem 1rem;
    background: transparent;
    border: 1px solid #d1d5db;
    border-radius: 0.5rem;
    cursor: pointer;
    font-weight: 500;
    transition: all 0.2s;
  }

  .editor-tab.active {
    background: #7c3aed;
    color: white;
    border-color: #7c3aed;
  }

  :global(.dark) .editor-tab {
    border-color: #4b5563;
    color: #d1d5db;
  }

  :global(.dark) .editor-tab.active {
    background: #8b5cf6;
    border-color: #8b5cf6;
  }

  .success-banner {
    padding: 0.75rem;
    background: #d1fae5;
    color: #065f46;
    border-radius: 0.5rem;
    font-weight: 500;
  }

  :global(.dark) .success-banner {
    background: #064e3b;
    color: #6ee7b7;
  }

  .error-banner {
    padding: 0.75rem;
    background: #fee2e2;
    color: #991b1b;
    border-radius: 0.5rem;
    font-weight: 500;
  }

  :global(.dark) .error-banner {
    background: #7f1d1d;
    color: #fca5a5;
  }

  .editor-content {
    flex: 1;
    overflow-y: auto;
    padding: 1rem;
  }

  .sub-tab-group {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-bottom: 1.5rem;
  }

  .sub-tab {
    padding: 0.375rem 0.75rem;
    background: #f3f4f6;
    border: none;
    border-radius: 0.375rem;
    cursor: pointer;
    font-size: 0.875rem;
    font-weight: 500;
    transition: all 0.2s;
  }

  .sub-tab.active {
    background: #6366f1;
    color: white;
  }

  :global(.dark) .sub-tab {
    background: #374151;
    color: #d1d5db;
  }

  :global(.dark) .sub-tab.active {
    background: #818cf8;
  }

  .form-container {
    max-width: 900px;
  }

  .form-section {
    margin-bottom: 2rem;
    padding: 1.5rem;
    background: #f9fafb;
    border-radius: 0.5rem;
  }

  :global(.dark) .form-section {
    background: #1f2937;
  }

  .form-section h3 {
    margin: 0 0 1rem 0;
    font-size: 1.125rem;
    font-weight: 600;
  }

  .form-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    gap: 1rem;
  }

  .form-grid-small {
    display: grid;
    grid-template-columns: 1fr 1fr auto;
    gap: 1rem;
    align-items: end;
  }

  .traits-grid {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  label > span {
    font-weight: 500;
    font-size: 0.875rem;
    color: #374151;
  }

  :global(.dark) label > span {
    color: #d1d5db;
  }

  input[type="text"],
  input[type="email"],
  input[type="number"],
  textarea,
  select {
    padding: 0.5rem;
    border: 1px solid #d1d5db;
    border-radius: 0.375rem;
    background: white;
    color: #111827;
    font-family: inherit;
  }

  :global(.dark) input[type="text"],
  :global(.dark) input[type="email"],
  :global(.dark) input[type="number"],
  :global(.dark) textarea,
  :global(.dark) select {
    background: #111827;
    border-color: #4b5563;
    color: #f3f4f6;
  }

  input[type="range"] {
    width: 100%;
  }

  .checkbox-label {
    flex-direction: row;
    align-items: center;
    gap: 0.5rem;
  }

  .checkbox-label input[type="checkbox"] {
    width: auto;
  }

  .value-item,
  .goal-item,
  .project-item,
  .heuristic-item {
    padding: 1rem;
    background: white;
    border: 1px solid #e5e7eb;
    border-radius: 0.5rem;
    margin-bottom: 1rem;
  }

  :global(.dark) .value-item,
  :global(.dark) .goal-item,
  :global(.dark) .project-item,
  :global(.dark) .heuristic-item {
    background: #111827;
    border-color: #374151;
  }

  .value-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.75rem;
  }

  .value-number {
    font-weight: 600;
    color: #7c3aed;
  }

  .btn-add,
  .btn-remove,
  .btn-save {
    padding: 0.5rem 1rem;
    border: none;
    border-radius: 0.375rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }

  .btn-add {
    background: #10b981;
    color: white;
  }

  .btn-add:hover {
    background: #059669;
  }

  .btn-remove,
  .btn-remove-small {
    background: #ef4444;
    color: white;
    font-size: 0.875rem;
    padding: 0.375rem 0.75rem;
  }

  .btn-remove:hover,
  .btn-remove-small:hover {
    background: #dc2626;
  }

  .btn-save {
    background: #7c3aed;
    color: white;
    font-size: 1rem;
    padding: 0.75rem 1.5rem;
  }

  .btn-save:hover:not(:disabled) {
    background: #6d28d9;
  }

  .btn-save:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .form-actions {
    margin-top: 2rem;
    display: flex;
    justify-content: flex-end;
  }

  .facets-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1.5rem;
  }

  .facets-header h3 {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 600;
  }

  .facets-list {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    margin-bottom: 2rem;
  }

  .facet-card {
    padding: 1.5rem;
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 0.5rem;
  }

  :global(.dark) .facet-card {
    background: #1f2937;
    border-color: #374151;
  }

  .facet-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
  }

  .facet-header h4 {
    margin: 0;
    font-size: 1.125rem;
    font-weight: 600;
  }

  .facet-body {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  /* Archives styles */
  .archives-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 1.5rem;
  }

  .archives-header h3 {
    margin: 0 0 0.5rem 0;
    font-size: 1.25rem;
    font-weight: 600;
  }

  .archives-description {
    margin: 0;
    font-size: 0.875rem;
    color: #6b7280;
    max-width: 600px;
  }

  :global(.dark) .archives-description {
    color: #9ca3af;
  }

  .btn-refresh {
    padding: 0.5rem 1rem;
    background: #6366f1;
    color: white;
    border: none;
    border-radius: 0.375rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }

  .btn-refresh:hover:not(:disabled) {
    background: #4f46e5;
  }

  .btn-refresh:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .empty-state {
    padding: 3rem;
    text-align: center;
    color: #6b7280;
  }

  :global(.dark) .empty-state {
    color: #9ca3af;
  }

  .archives-list {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .archive-card {
    padding: 1.25rem;
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 0.5rem;
    transition: all 0.2s;
  }

  .archive-card:hover {
    border-color: #7c3aed;
    box-shadow: 0 2px 8px rgba(124, 58, 237, 0.1);
  }

  :global(.dark) .archive-card {
    background: #1f2937;
    border-color: #374151;
  }

  :global(.dark) .archive-card:hover {
    border-color: #8b5cf6;
    box-shadow: 0 2px 8px rgba(139, 92, 246, 0.2);
  }

  .archive-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 0.75rem;
  }

  .archive-info h4 {
    margin: 0 0 0.25rem 0;
    font-size: 1.125rem;
    font-weight: 600;
    color: #111827;
  }

  :global(.dark) .archive-info h4 {
    color: #f3f4f6;
  }

  .archive-timestamp {
    font-size: 0.875rem;
    color: #6b7280;
    font-family: 'Courier New', monospace;
  }

  :global(.dark) .archive-timestamp {
    color: #9ca3af;
  }

  .archive-actions {
    display: flex;
    gap: 0.5rem;
  }

  .btn-view,
  .btn-restore,
  .btn-delete {
    padding: 0.375rem 0.75rem;
    border: none;
    border-radius: 0.375rem;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }

  .btn-view {
    background: #6366f1;
    color: white;
  }

  .btn-view:hover {
    background: #4f46e5;
  }

  .btn-restore {
    background: #10b981;
    color: white;
  }

  .btn-restore:hover:not(:disabled) {
    background: #059669;
  }

  .btn-restore:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .btn-delete {
    background: #ef4444;
    color: white;
  }

  .btn-delete:hover:not(:disabled) {
    background: #dc2626;
  }

  .btn-delete:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .archive-meta {
    display: flex;
    gap: 1.5rem;
    font-size: 0.875rem;
    color: #6b7280;
  }

  :global(.dark) .archive-meta {
    color: #9ca3af;
  }

  /* Archive Viewer Modal */
  .archive-viewer-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .archive-viewer {
    background: white;
    border-radius: 0.5rem;
    width: 90%;
    max-width: 900px;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
  }

  :global(.dark) .archive-viewer {
    background: #1f2937;
  }

  .archive-viewer-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1.25rem;
    border-bottom: 1px solid #e5e7eb;
  }

  :global(.dark) .archive-viewer-header {
    border-bottom-color: #374151;
  }

  .archive-viewer-header h3 {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 600;
  }

  .btn-close {
    background: none;
    border: none;
    font-size: 2rem;
    line-height: 1;
    color: #6b7280;
    cursor: pointer;
    padding: 0;
    width: 2rem;
    height: 2rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 0.375rem;
    transition: all 0.2s;
  }

  .btn-close:hover {
    background: #f3f4f6;
    color: #111827;
  }

  :global(.dark) .btn-close:hover {
    background: #374151;
    color: #f3f4f6;
  }

  .archive-viewer-content {
    flex: 1;
    overflow-y: auto;
    padding: 1.5rem;
  }

  .archive-viewer-content pre {
    margin: 0;
    padding: 1rem;
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 0.375rem;
    font-size: 0.875rem;
    overflow-x: auto;
    color: #111827;
  }

  :global(.dark) .archive-viewer-content pre {
    background: #111827;
    border-color: #374151;
    color: #f3f4f6;
  }

  .archive-viewer-actions {
    padding: 1rem 1.25rem;
    border-top: 1px solid #e5e7eb;
    display: flex;
    justify-content: flex-end;
  }

  :global(.dark) .archive-viewer-actions {
    border-top-color: #374151;
  }

  .btn-close-footer {
    padding: 0.5rem 1rem;
    background: #6b7280;
    color: white;
    border: none;
    border-radius: 0.375rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }

  .btn-close-footer:hover {
    background: #4b5563;
  }
</style>
