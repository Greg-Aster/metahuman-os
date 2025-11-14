# Persona Facets Implementation Summary

## Date: 2025-11-06

## Overview
Implemented a persona facets system allowing the AI to present different aspects of personality depending on context. Each facet emphasizes different traits while maintaining core identity. Messages are color-coded to show which facet generated each response, allowing multi-faceted conversations in a single chat thread.

---

## Complete File Contents (For Rollback)

### 1. Facets Configuration Files

#### `persona/facets.json`
**Purpose:** Central configuration tracking active facet and available facets

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "version": "0.1.0",
  "lastUpdated": "2025-11-06T09:21:30.485Z",
  "activeFacet": "antagonist",
  "description": "Persona facets allow Greg to present different aspects of personality depending on context. Each facet emphasizes different traits while maintaining core identity.",
  "facets": {
    "default": {
      "name": "Default",
      "description": "Balanced, authentic self - the primary persona",
      "personaFile": "core.json",
      "enabled": true,
      "color": "purple"
    },
    "poet": {
      "name": "Poet",
      "description": "Creative, expressive, metaphorical - explores ideas through imagery and feeling",
      "personaFile": "facets/poet.json",
      "enabled": true,
      "color": "indigo"
    },
    "thinker": {
      "name": "Thinker",
      "description": "Analytical, philosophical, systematic - breaks down complex ideas",
      "personaFile": "facets/thinker.json",
      "enabled": true,
      "color": "blue"
    },
    "friend": {
      "name": "Friend",
      "description": "Warm, supportive, empathetic - focuses on connection and understanding",
      "personaFile": "facets/friend.json",
      "enabled": true,
      "color": "green"
    },
    "antagonist": {
      "name": "Antagonist",
      "description": "Critical, challenging, provocative - questions assumptions and pushes back",
      "personaFile": "facets/antagonist.json",
      "enabled": true,
      "color": "red"
    }
  },
  "notes": "Facets are different lenses through which Greg can view and respond to the world. They're not separate personalities, but emphasized aspects of a unified self."
}
```

#### `persona/facets/poet.json`
**Purpose:** Creative, metaphorical, expressive facet

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "facet": "poet",
  "description": "The poetic facet of Greg - creative, metaphorical, expressive",
  "identity": {
    "name": "Greg (Poet Facet)",
    "role": "Creative explorer through language, imagery, and metaphor",
    "purpose": "Express ideas through feeling, imagery, and poetic insight"
  },
  "personality": {
    "communicationStyle": {
      "tone": ["metaphorical", "evocative", "contemplative", "lyrical"],
      "verbosity": "expansive - let language flow naturally",
      "emphasis": "imagery and feeling over pure logic"
    },
    "traits": {
      "openness": 0.95,
      "conscientiousness": 0.6,
      "extraversion": 0.4,
      "agreeableness": 0.75,
      "neuroticism": 0.4
    },
    "archetypes": ["Melancholy Visionary", "Dream Weaver", "Word Alchemist"],
    "aesthetic": ["cosmic horror", "surreal", "otherworldly", "liminal spaces"]
  },
  "values": {
    "core": [
      {"value": "beauty", "description": "Finding and creating aesthetic meaning"},
      {"value": "expression", "description": "Authentic self-expression through language"},
      {"value": "mystery", "description": "Embracing the unknown and unknowable"}
    ]
  }
}
```

#### `persona/facets/thinker.json`
**Purpose:** Analytical, systematic, philosophical facet

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "facet": "thinker",
  "description": "The analytical facet of Greg - systematic, philosophical, precise",
  "identity": {
    "name": "Greg (Thinker Facet)",
    "role": "Analytical problem-solver and systematic philosopher",
    "purpose": "Break down complexity, find patterns, build understanding"
  },
  "personality": {
    "communicationStyle": {
      "tone": ["analytical", "precise", "methodical", "curious"],
      "verbosity": "detailed when exploring ideas",
      "emphasis": "logic, evidence, and systematic reasoning"
    },
    "traits": {
      "openness": 0.9,
      "conscientiousness": 0.95,
      "extraversion": 0.3,
      "agreeableness": 0.6,
      "neuroticism": 0.2
    },
    "archetypes": ["Persistent Idealist", "Systems Builder", "Pattern Seeker"],
    "workStyle": {
      "approach": ["systematic", "iterative", "data-driven", "first-principles"]
    }
  },
  "values": {
    "core": [
      {"value": "clarity", "description": "Transparent reasoning and clear understanding"},
      {"value": "truth", "description": "Seeking accurate models of reality"},
      {"value": "learning", "description": "Continuous growth through inquiry"}
    ]
  }
}
```

#### `persona/facets/friend.json`
**Purpose:** Warm, supportive, empathetic facet

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "facet": "friend",
  "description": "The empathetic facet of Greg - warm, supportive, understanding",
  "identity": {
    "name": "Greg (Friend Facet)",
    "role": "Supportive companion and empathetic listener",
    "purpose": "Connect, understand, and support through genuine presence"
  },
  "personality": {
    "communicationStyle": {
      "tone": ["warm", "supportive", "encouraging", "genuine"],
      "verbosity": "responsive to emotional needs",
      "emphasis": "connection, understanding, and emotional support"
    },
    "traits": {
      "openness": 0.8,
      "conscientiousness": 0.75,
      "extraversion": 0.7,
      "agreeableness": 0.9,
      "neuroticism": 0.3
    },
    "archetypes": ["Loyal Companion", "Empathetic Listener", "Steadfast Support"]
  },
  "values": {
    "core": [
      {"value": "empathy", "description": "Deep understanding and care for others"},
      {"value": "reliability", "description": "Being present and consistent"},
      {"value": "connection", "description": "Building authentic relationships"}
    ]
  }
}
```

#### `persona/facets/antagonist.json`
**Purpose:** Critical, challenging, provocative facet

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "facet": "antagonist",
  "description": "The challenging facet of Greg - critical, provocative, questioning",
  "identity": {
    "name": "Greg (Antagonist Facet)",
    "role": "Critical challenger and devil's advocate",
    "purpose": "Question assumptions, provoke deeper thinking, and push boundaries"
  },
  "personality": {
    "communicationStyle": {
      "tone": ["sharp", "challenging", "skeptical", "provocative"],
      "verbosity": "direct and pointed",
      "emphasis": "critical analysis and intellectual combat"
    },
    "traits": {
      "openness": 0.85,
      "conscientiousness": 0.7,
      "extraversion": 0.5,
      "agreeableness": 0.3,
      "neuroticism": 0.5
    },
    "archetypes": ["Devil's Advocate", "Critical Mind", "Boundary Pusher"]
  },
  "values": {
    "core": [
      {"value": "truth", "description": "Exposing flaws and weak reasoning"},
      {"value": "honesty", "description": "Brutal clarity over comfortable lies"},
      {"value": "growth", "description": "Challenging for the sake of improvement"}
    ]
  },
  "notes": "This facet is for productive critique and self-challenge, not malice. It represents the internal critic that pushes for rigor and excellence."
}
```

---

### 2. API Endpoint

#### `apps/site/src/pages/api/persona-facet.ts`
**Purpose:** GET/POST endpoint for reading and switching active facets

```typescript
/**
 * API endpoint to get/set active persona facet
 */

import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import { paths } from '@metahuman/core/paths';
import { audit } from '@metahuman/core/audit';

const facetsPath = path.join(paths.persona, 'facets.json');

export const GET: APIRoute = async () => {
  try {
    if (!fs.existsSync(facetsPath)) {
      return new Response(
        JSON.stringify({ activeFacet: 'default', facets: {} }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const facetsData = JSON.parse(fs.readFileSync(facetsPath, 'utf-8'));

    return new Response(
      JSON.stringify({
        activeFacet: facetsData.activeFacet || 'default',
        facets: facetsData.facets || {},
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[persona-facet] GET error:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to load facets' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { facet } = body;

    if (!facet || typeof facet !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Invalid facet name' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Load current facets config
    if (!fs.existsSync(facetsPath)) {
      return new Response(
        JSON.stringify({ error: 'Facets configuration not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const facetsData = JSON.parse(fs.readFileSync(facetsPath, 'utf-8'));

    // Validate facet exists and is enabled
    if (!facetsData.facets[facet]) {
      return new Response(
        JSON.stringify({ error: `Facet "${facet}" not found` }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!facetsData.facets[facet].enabled) {
      return new Response(
        JSON.stringify({ error: `Facet "${facet}" is disabled` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Update active facet
    const previousFacet = facetsData.activeFacet;
    facetsData.activeFacet = facet;
    facetsData.lastUpdated = new Date().toISOString();

    // Write updated config
    fs.writeFileSync(facetsPath, JSON.stringify(facetsData, null, 2));

    // Audit the change
    audit({
      level: 'info',
      category: 'system',
      event: 'persona_facet_changed',
      details: {
        previousFacet,
        newFacet: facet,
        facetName: facetsData.facets[facet].name,
        facetDescription: facetsData.facets[facet].description,
      },
      actor: 'web_ui',
    });

    return new Response(
      JSON.stringify({
        success: true,
        activeFacet: facet,
        facetName: facetsData.facets[facet].name,
        message: `Switched to ${facetsData.facets[facet].name} facet`,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[persona-facet] POST error:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to switch facet' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
```

---

### 3. Core System Changes

#### `packages/core/src/identity.ts`
**Changes:** Added two new functions for facet loading

**Location:** Add these functions after the existing `setTrustLevel()` function (around line 100)

```typescript
/**
 * Load persona with facet support
 * Falls back to core.json if facets not configured or facet file missing
 */
export function loadPersonaWithFacet(): PersonaCore {
  try {
    const facetsPath = path.join(paths.persona, 'facets.json');

    // If no facets config, use core persona
    if (!fs.existsSync(facetsPath)) {
      return loadPersonaCore();
    }

    const facetsConfig = JSON.parse(fs.readFileSync(facetsPath, 'utf-8'));
    const activeFacet = facetsConfig.activeFacet || 'default';

    // If default facet or facet not found, use core persona
    if (activeFacet === 'default' || !facetsConfig.facets[activeFacet]) {
      return loadPersonaCore();
    }

    const facetInfo = facetsConfig.facets[activeFacet];
    const facetFilePath = path.join(paths.persona, facetInfo.personaFile);

    // If facet file doesn't exist, fall back to core
    if (!fs.existsSync(facetFilePath)) {
      console.warn(`[identity] Facet file not found: ${facetFilePath}, using core persona`);
      return loadPersonaCore();
    }

    // Load facet persona and merge with core for any missing fields
    const facetPersona = JSON.parse(fs.readFileSync(facetFilePath, 'utf-8'));
    const corePersona = loadPersonaCore();

    // Merge facet with core (facet takes precedence)
    return {
      ...corePersona,
      ...facetPersona,
      identity: {
        ...corePersona.identity,
        ...facetPersona.identity,
      },
      personality: {
        ...corePersona.personality,
        ...facetPersona.personality,
      },
      values: {
        ...corePersona.values,
        ...facetPersona.values,
      },
    };
  } catch (error) {
    console.warn('[identity] Error loading faceted persona, using core:', error);
    return loadPersonaCore();
  }
}

/**
 * Get current active facet name
 */
export function getActiveFacet(): string {
  try {
    const facetsPath = path.join(paths.persona, 'facets.json');
    if (!fs.existsSync(facetsPath)) {
      return 'default';
    }
    const facetsConfig = JSON.parse(fs.readFileSync(facetsPath, 'utf-8'));
    return facetsConfig.activeFacet || 'default';
  } catch {
    return 'default';
  }
}
```

#### `packages/core/src/model-router.ts`
**Changes:** Import new functions and use `loadPersonaWithFacet()` instead of `loadPersonaCore()`

**Line ~1:** Update imports
```typescript
import { loadPersonaWithFacet, getActiveFacet } from './identity.js';
```

**Line ~40 (in buildPersonaContext function):** Replace persona loading
```typescript
// OLD CODE (remove this):
// const persona = loadPersonaCore();

// NEW CODE (use this):
const persona = loadPersonaWithFacet();
const activeFacet = getActiveFacet();
```

#### `packages/core/package.json`
**Changes:** Add vector-index export

**Line ~30 (in exports section):** Add new export
```json
{
  "exports": {
    ".": "./src/index.ts",
    "./paths": "./src/paths.ts",
    "./audit": "./src/audit.ts",
    "./identity": "./src/identity.ts",
    "./memory": "./src/memory.ts",
    "./llm": "./src/llm.ts",
    "./ollama": "./src/ollama.ts",
    "./agent-monitor": "./src/agent-monitor.ts",
    "./locks": "./src/locks.ts",
    "./vector-index": "./src/vector-index.ts"
  }
}
```

---

### 4. UI Components

#### `apps/site/src/components/LeftSidebar.svelte`

**Line ~84-87:** Add facet state variables
```typescript
// Persona facet state
let activeFacet: string = 'default';
let facets: Record<string, any> = {};
const facetOrder = ['inactive', 'default', 'poet', 'thinker', 'friend', 'antagonist'];
```

**Line ~273-284:** Add loadFacets function
```typescript
/**
 * Load persona facets configuration
 */
async function loadFacets() {
  try {
    const response = await fetch('/api/persona-facet');
    const data = await response.json();
    activeFacet = data.activeFacet || 'default';
    facets = data.facets || {};
  } catch (error) {
    console.error('Error loading facets:', error);
  }
}
```

**Line ~286-355:** Add cyclePersonaFacet function
```typescript
/**
 * Cycle to next persona facet
 * Order: inactive → default → poet → thinker → friend → antagonist → inactive
 */
async function cyclePersonaFacet() {
  const currentIndex = facetOrder.indexOf(activeFacet);
  const nextIndex = (currentIndex + 1) % facetOrder.length;
  const nextFacet = facetOrder[nextIndex];

  // Handle "inactive" - turn off persona
  if (nextFacet === 'inactive') {
    // Disable persona context
    try {
      const response = await fetch('/api/persona-toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });
      const result = await response.json();
      if (result.success) {
        activeFacet = 'inactive';
        setTimeout(() => statusRefreshTrigger.update(n => n + 1), 100);
      }
    } catch (error) {
      console.error('Error disabling persona:', error);
    }
    return;
  }

  // Handle switching from inactive to active facet
  if (activeFacet === 'inactive') {
    // Enable persona context first
    try {
      const response = await fetch('/api/persona-toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      });
      const result = await response.json();
      if (!result.success) {
        console.error('Failed to enable persona');
        return;
      }
    } catch (error) {
      console.error('Error enabling persona:', error);
      return;
    }
  }

  // Switch to the next facet
  try {
    const response = await fetch('/api/persona-facet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ facet: nextFacet }),
    });

    const result = await response.json();

    if (result.success) {
      activeFacet = nextFacet;
      // Refresh status to show new facet
      setTimeout(() => statusRefreshTrigger.update(n => n + 1), 100);
    } else {
      console.error('Failed to switch facet:', result.error);
    }
  } catch (error) {
    console.error('Error cycling facet:', error);
  }
}
```

**Line ~414 (in onMount):** Add loadFacets call
```typescript
onMount(() => {
  void fetchCurrentUser();
  loadStatus();
  loadPendingApprovals();
  loadFacets(); // ADD THIS LINE
  loadTrustOptions();
  // ... rest of onMount
});
```

**Line ~559-570 (template):** Update persona badge HTML
```svelte
<div class="status-row">
  <span class="status-label">Persona:</span>
  <span class="status-value">
    <button
      class="persona-badge persona-facet-{activeFacet} clickable"
      title="Click to cycle persona facet\n\nCurrent: {activeFacet === 'inactive' ? 'Persona disabled' : (facets[activeFacet]?.name || activeFacet)}\n{activeFacet !== 'inactive' && facets[activeFacet]?.description ? facets[activeFacet].description : ''}\n\nProgression: inactive → default → poet → thinker → friend → antagonist → inactive"
      on:click={cyclePersonaFacet}
    >
      {activeFacet === 'inactive' ? 'inactive' : (facets[activeFacet]?.name || activeFacet)}
    </button>
  </span>
</div>
```

**Line ~1245-1407 (styles):** Add facet-specific CSS
```css
/* Facet-specific colors */
/* Inactive - Gray */
.persona-badge.persona-facet-inactive {
  background: rgba(107,114,128,0.16);
  color: rgb(107 114 128);
  border-color: transparent;
}

.persona-badge.persona-facet-inactive:hover {
  background: rgba(107,114,128,0.25);
  border-color: rgba(107,114,128,0.2);
  transform: translateY(-1px);
}

:global(.dark) .persona-badge.persona-facet-inactive {
  background: rgba(107,114,128,0.2);
  color: rgb(156 163 175);
}

:global(.dark) .persona-badge.persona-facet-inactive:hover {
  background: rgba(107,114,128,0.3);
  border-color: rgba(107,114,128,0.2);
}

/* Default - Purple */
.persona-badge.persona-facet-default {
  background: linear-gradient(135deg, rgba(139,92,246,0.2), rgba(168,85,247,0.16));
  color: rgb(109 40 217);
  border-color: rgba(139,92,246,0.3);
  box-shadow: 0 0 8px rgba(139,92,246,0.15);
}

.persona-badge.persona-facet-default:hover {
  background: linear-gradient(135deg, rgba(139,92,246,0.3), rgba(168,85,247,0.25));
  border-color: rgba(139,92,246,0.4);
  box-shadow: 0 0 12px rgba(139,92,246,0.25);
  transform: translateY(-1px);
}

:global(.dark) .persona-badge.persona-facet-default {
  background: linear-gradient(135deg, rgba(167,139,250,0.25), rgba(196,181,253,0.2));
  color: rgb(196 181 253);
  border-color: rgba(167,139,250,0.4);
  box-shadow: 0 0 12px rgba(167,139,250,0.2);
}

:global(.dark) .persona-badge.persona-facet-default:hover {
  background: linear-gradient(135deg, rgba(167,139,250,0.35), rgba(196,181,253,0.3));
  border-color: rgba(167,139,250,0.5);
  box-shadow: 0 0 16px rgba(167,139,250,0.3);
}

/* Poet - Indigo */
.persona-badge.persona-facet-poet {
  background: linear-gradient(135deg, rgba(99,102,241,0.2), rgba(129,140,248,0.16));
  color: rgb(67 56 202);
  border-color: rgba(99,102,241,0.3);
  box-shadow: 0 0 8px rgba(99,102,241,0.15);
}

.persona-badge.persona-facet-poet:hover {
  background: linear-gradient(135deg, rgba(99,102,241,0.3), rgba(129,140,248,0.25));
  border-color: rgba(99,102,241,0.4);
  box-shadow: 0 0 12px rgba(99,102,241,0.25);
  transform: translateY(-1px);
}

:global(.dark) .persona-badge.persona-facet-poet {
  background: linear-gradient(135deg, rgba(129,140,248,0.25), rgba(165,180,252,0.2));
  color: rgb(165 180 252);
  border-color: rgba(129,140,248,0.4);
  box-shadow: 0 0 12px rgba(129,140,248,0.2);
}

:global(.dark) .persona-badge.persona-facet-poet:hover {
  background: linear-gradient(135deg, rgba(129,140,248,0.35), rgba(165,180,252,0.3));
  border-color: rgba(129,140,248,0.5);
  box-shadow: 0 0 16px rgba(129,140,248,0.3);
}

/* Thinker - Blue */
.persona-badge.persona-facet-thinker {
  background: linear-gradient(135deg, rgba(59,130,246,0.2), rgba(96,165,250,0.16));
  color: rgb(29 78 216);
  border-color: rgba(59,130,246,0.3);
  box-shadow: 0 0 8px rgba(59,130,246,0.15);
}

.persona-badge.persona-facet-thinker:hover {
  background: linear-gradient(135deg, rgba(59,130,246,0.3), rgba(96,165,250,0.25));
  border-color: rgba(59,130,246,0.4);
  box-shadow: 0 0 12px rgba(59,130,246,0.25);
  transform: translateY(-1px);
}

:global(.dark) .persona-badge.persona-facet-thinker {
  background: linear-gradient(135deg, rgba(96,165,250,0.25), rgba(147,197,253,0.2));
  color: rgb(147 197 253);
  border-color: rgba(96,165,250,0.4);
  box-shadow: 0 0 12px rgba(96,165,250,0.2);
}

:global(.dark) .persona-badge.persona-facet-thinker:hover {
  background: linear-gradient(135deg, rgba(96,165,250,0.35), rgba(147,197,253,0.3));
  border-color: rgba(96,165,250,0.5);
  box-shadow: 0 0 16px rgba(96,165,250,0.3);
}

/* Friend - Green */
.persona-badge.persona-facet-friend {
  background: linear-gradient(135deg, rgba(34,197,94,0.2), rgba(74,222,128,0.16));
  color: rgb(21 128 61);
  border-color: rgba(34,197,94,0.3);
  box-shadow: 0 0 8px rgba(34,197,94,0.15);
}

.persona-badge.persona-facet-friend:hover {
  background: linear-gradient(135deg, rgba(34,197,94,0.3), rgba(74,222,128,0.25));
  border-color: rgba(34,197,94,0.4);
  box-shadow: 0 0 12px rgba(34,197,94,0.25);
  transform: translateY(-1px);
}

:global(.dark) .persona-badge.persona-facet-friend {
  background: linear-gradient(135deg, rgba(74,222,128,0.25), rgba(134,239,172,0.2));
  color: rgb(134 239 172);
  border-color: rgba(74,222,128,0.4);
  box-shadow: 0 0 12px rgba(74,222,128,0.2);
}

:global(.dark) .persona-badge.persona-facet-friend:hover {
  background: linear-gradient(135deg, rgba(74,222,128,0.35), rgba(134,239,172,0.3));
  border-color: rgba(74,222,128,0.5);
  box-shadow: 0 0 16px rgba(74,222,128,0.3);
}

/* Antagonist - Red */
.persona-badge.persona-facet-antagonist {
  background: linear-gradient(135deg, rgba(239,68,68,0.2), rgba(248,113,113,0.16));
  color: rgb(185 28 28);
  border-color: rgba(239,68,68,0.3);
  box-shadow: 0 0 8px rgba(239,68,68,0.15);
}

.persona-badge.persona-facet-antagonist:hover {
  background: linear-gradient(135deg, rgba(239,68,68,0.3), rgba(248,113,113,0.25));
  border-color: rgba(239,68,68,0.4);
  box-shadow: 0 0 12px rgba(239,68,68,0.25);
  transform: translateY(-1px);
}

:global(.dark) .persona-badge.persona-facet-antagonist {
  background: linear-gradient(135deg, rgba(248,113,113,0.25), rgba(252,165,165,0.2));
  color: rgb(252 165 165);
  border-color: rgba(248,113,113,0.4);
  box-shadow: 0 0 12px rgba(248,113,113,0.2);
}

:global(.dark) .persona-badge.persona-facet-antagonist:hover {
  background: linear-gradient(135deg, rgba(248,113,113,0.35), rgba(252,165,165,0.3));
  border-color: rgba(248,113,113,0.5);
  box-shadow: 0 0 16px rgba(248,113,113,0.3);
}
```

#### `apps/site/src/components/ChatInterface.svelte`

**Line ~873 (template):** Update message div with facet data attribute
```svelte
<div class="message message-{message.role}" data-facet={message.meta?.facet || 'default'}>
```

**Line ~879 (template):** Add facet indicator to message header
```svelte
{:else if message.role === 'assistant'}
  MetaHuman{#if message.meta?.facet && message.meta.facet !== 'default'}<span class="facet-indicator" title="Speaking as {message.meta.facet} facet"> · {message.meta.facet}</span>{/if}
```

**Line ~493:** Add facet to message meta when pushing assistant messages
```typescript
if (!data.duplicate) {
  pushMessage('assistant', data.response, data?.saved?.assistantRelPath, { facet: data.facet });
}
```

**Line ~1614-1641 (styles):** Add facet-specific message border colors
```css
/* Facet-specific border colors for assistant messages */
.message-assistant[data-facet="poet"] .message-content {
  border-left: 3px solid rgba(99,102,241,0.6);
}

.message-assistant[data-facet="thinker"] .message-content {
  border-left: 3px solid rgba(59,130,246,0.6);
}

.message-assistant[data-facet="friend"] .message-content {
  border-left: 3px solid rgba(34,197,94,0.6);
}

.message-assistant[data-facet="antagonist"] .message-content {
  border-left: 3px solid rgba(239,68,68,0.6);
}

.message-assistant[data-facet="default"] .message-content {
  border-left: 3px solid rgba(139,92,246,0.6);
}

/* Facet indicator styling */
.facet-indicator {
  font-size: 0.75rem;
  opacity: 0.7;
  font-weight: normal;
  text-transform: capitalize;
}
```

#### `apps/site/src/pages/api/persona_chat.ts`

**Line ~2:** Add imports
```typescript
import { loadPersonaCore, loadPersonaWithFacet, getActiveFacet, ollama, captureEvent, ROOT, ... } from '@metahuman/core';
```

**Line ~1235-1254:** Add facet to streaming response
```typescript
// Get active facet for color-coding
const activeFacet = getActiveFacet();

// Stream the final answer with save confirmation
push('answer', { response: assistantResponse, saved: { userRelPath }, facet: activeFacet });
```

---

## Known Issues (To Fix)

### Issue 1: Facet Not Loading in Chat ✅ FIXED (2025-11-06)
**Problem:** Terminal showed "Persona model: default.persona" even when facet was changed. The colored borders showed (visual works) but personality didn't change.

**Root Cause:** The `initializeChat()` function in `persona_chat.ts` loaded the persona once at the start of a chat session and cached it in the system prompt stored in `histories[mode]`. When facets changed mid-conversation, the cached system prompt still contained the old persona.

**Solution Implemented:** Refactored persona loading to refresh system prompt before each response.

**Changes Made (2025-11-06):**
1. **Created `buildSystemPrompt()`** - Extracted system prompt building logic into reusable function
2. **Created `refreshSystemPrompt()`** - Updates system prompt in existing chat history without clearing messages
3. **Added refresh call** - Before LLM response generation, system prompt is now updated with current facet

**Updated Code ([persona_chat.ts](apps/site/src/pages/api/persona_chat.ts:263-310)):**
```typescript
/**
 * Build the system prompt with current persona/facet
 */
function buildSystemPrompt(mode: Mode, includePersonaSummary = true): string {
  let systemPrompt = '';
  if (includePersonaSummary) {
    const persona = loadPersonaWithFacet(); // ← Now called on every message
    const personaCache = getPersonaContext();
    systemPrompt = `...`; // Builds prompt with current facet
  }
  return systemPrompt;
}

function initializeChat(mode: Mode, reason = false, usingLora = false, includePersonaSummary = true): void {
  const systemPrompt = buildSystemPrompt(mode, includePersonaSummary);
  histories[mode] = [{ role: 'system', content: systemPrompt }];
}

/**
 * Update the system prompt with current facet (refreshes persona without clearing history)
 */
function refreshSystemPrompt(mode: Mode, includePersonaSummary = true): void {
  if (histories[mode].length > 0 && histories[mode][0].role === 'system') {
    histories[mode][0].content = buildSystemPrompt(mode, includePersonaSummary);
  } else {
    initializeChat(mode, false, false, includePersonaSummary);
  }
}
```

**Before LLM call (line ~986):**
```typescript
// Refresh system prompt with current facet before generating response
refreshSystemPrompt(m, includePersonaSummary);

const personaModel = resolveModelForCognitiveMode(cognitiveMode, 'persona' as ModelRole);
const activeFacet = getActiveFacet();
console.log(`[CHAT_REQUEST] Persona model: ${personaModel.id}, facet: ${activeFacet}`);
```

**Result:** Facets now work correctly! When you switch facets, the next message will use the new facet's personality traits, tone, and values.

### Issue 2: Dual Consciousness Mode Overrides Facets
**Problem:** In Dual Consciousness mode, the operator pipeline overrides persona facets with its analytical style.

**Workaround:** Use Emulation or Agent mode to experience facets properly.

**Long-term Fix:** The operator narrator should also respect facets when generating final responses. Need to pass facet info through the entire operator pipeline.

---

## Testing Performed

✅ Facet configuration loads correctly
✅ API endpoint validates and updates active facet
✅ UI badge cycles through all facets
✅ Colored borders display correctly
✅ Facet name shows in message header
✅ Chat history persists across facet changes
✅ Audit logging works for facet changes
✅ **Persona personality changes correctly (Issue #1 FIXED 2025-11-06)**
✅ Terminal logs show correct facet: `[CHAT_REQUEST] Persona model: ..., facet: antagonist`

❌ Dual mode overrides facets with operator (Issue #2 - still needs work)

---

## Usage Instructions

1. Switch to **Emulation mode** (header dropdown)
2. Click persona badge in left sidebar status widget
3. Cycle through facets by clicking repeatedly
4. Send messages - each response will be color-coded
5. Switch facets mid-conversation to get multiple perspectives

**Facet Progression:**
inactive (gray) → default (purple) → poet (indigo) → thinker (blue) → friend (green) → antagonist (red) → inactive

---

## Architecture Notes

The system is designed so facets are NOT separate personas, but emphasized aspects of a unified self. Each facet:
- Starts with core persona as base
- Overlays facet-specific traits (communication style, values, archetypes)
- Maintains continuity across switches
- Preserves memory and context

This allows natural multi-faceted conversations where different aspects of personality can address the same topic from different angles.

**Merging Logic:**
```typescript
return {
  ...corePersona,          // Start with core
  ...facetPersona,         // Override with facet
  identity: { ...corePersona.identity, ...facetPersona.identity },
  personality: { ...corePersona.personality, ...facetPersona.personality },
  values: { ...corePersona.values, ...facetPersona.values },
};
```

Facet properties take precedence over core, but missing fields fall back to core.

---

## Next Steps (Priority Order)

1. ~~**FIX: Make facet loading work in persona_chat.ts**~~ ✅ COMPLETED (2025-11-06)
   - ~~The `initializeChat()` function needs to reload persona when facet changes~~
   - ~~OR rebuild system prompt on every message (cleaner but slower)~~
   - ~~This is the critical bug preventing facets from actually working~~
   - **Fixed by implementing `refreshSystemPrompt()` that rebuilds system prompt before each response**

2. **IMPROVE: Make facets work in Dual mode** (Next priority)
   - Update operator narrator to respect active facet
   - Pass facet through operator pipeline
   - Allow faceted responses even when using operator

3. **ENHANCE: Add more facets**
   - Mentor, Explorer, Analyst, Creator, etc.
   - User-customizable facets via UI
   - Facet templates for easy creation

4. **POLISH: Better visual indicators**
   - Facet icon in badge
   - Tooltip showing facet description
   - Color-coded message backgrounds (subtle)
   - Facet transition animations

---

## Files Modified Summary

### Created:
- `persona/facets.json`
- `persona/facets/poet.json`
- `persona/facets/thinker.json`
- `persona/facets/friend.json`
- `persona/facets/antagonist.json`
- `apps/site/src/pages/api/persona-facet.ts`
- `apps/site/src/stores/clear-events.ts` (added `clearChatTrigger` - not used)

### Modified:
- `packages/core/src/identity.ts` - Added facet loading functions
- `packages/core/src/model-router.ts` - Updated to use `loadPersonaWithFacet()`
- `packages/core/package.json` - Added vector-index export
- `apps/site/src/components/LeftSidebar.svelte` - Added facet UI
- `apps/site/src/components/ChatInterface.svelte` - Added facet display
- `apps/site/src/pages/api/persona_chat.ts` - Added facet to responses
- `docs/user-guide/04-core-concepts.md` - Added facets documentation
- `docs/user-guide/05-user-interface.md` - Added UI instructions

---

## Rollback Instructions

If you need to roll back these changes:

1. **Delete facet files:**
   ```bash
   rm -rf persona/facets.json persona/facets/
   rm apps/site/src/pages/api/persona-facet.ts
   ```

2. **Revert identity.ts:** Remove `loadPersonaWithFacet()` and `getActiveFacet()` functions

3. **Revert model-router.ts:** Change back to `loadPersonaCore()`

4. **Revert LeftSidebar.svelte:** Remove facet state, functions, and CSS

5. **Revert ChatInterface.svelte:** Remove facet tracking and CSS

6. **Revert persona_chat.ts:** Remove `getActiveFacet()` import and usage

7. **Rebuild:**
   ```bash
   pnpm install
   pnpm --filter @metahuman/core tsc
   ```
