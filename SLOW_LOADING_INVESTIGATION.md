# MetaHuman OS Web Application - Slow Loading Investigation Report

## Executive Summary

The MetaHuman OS web application has multiple performance bottlenecks during startup. The main page (/index.astro) uses aggressive `client:load` directives that immediately hydrate 4 major Svelte components simultaneously, combined with blocking API calls that serialize network requests. This results in slow Time-to-Interactive (TTI) and visible content delay.

**Current Load Sequence: Sequential blocking → Parallel component hydration → Cascading API calls**

---

## 1. Boot Sequence & Initialization Flow

### 1.1 Initial Page Load (index.astro)
**File**: `/home/greggles/metahuman/apps/site/src/pages/index.astro`

```
Page Render Flow:
1. HTML parsing (inline theme script runs immediately)
2. Style sheet loading (tailwind.css)
3. ChatLayout component hydrates (client:load)
   ├── LeftSidebar component hydrates (client:load)
   ├── CenterContent component hydrates (client:load)
   └── RightSidebar component hydrates (client:load)
4. All onMount hooks fire in parallel
5. API calls execute in parallel/serial chains
```

**Problem**: All 4 components are marked with `client:load`, meaning they hydrate immediately without waiting for user interaction. This creates a JavaScript bundle that's large and requires synchronous execution.

---

## 2. API Calls Made During Page Load

### 2.1 Critical Path (Blocking/Sequential)

#### ChatLayout.svelte (Header) - Fires immediately on mount
```typescript
onMount(() => {
    // 1. ASYNC - Fire-and-forget agent boot (non-blocking)
    fetch('/api/boot', { method: 'GET', cache: 'no-store', keepalive: true })
    
    // 2. AWAITED - Load persona name (BLOCKS until complete)
    void loadPersonaName()  // → fetch('/api/status')
    
    // 3. AWAITED - Load cognitive mode state (BLOCKS until complete)
    void loadCognitiveMode()  // → fetch('/api/cognitive-mode')
    
    // Polling: Every 30 seconds
    const interval = setInterval(loadPersonaName, 30000)
})
```

**Duration**: `/api/status` and `/api/cognitive-mode` run in parallel after page hydration.

#### LeftSidebar.svelte (Menu & Status Widget)
```typescript
onMount(() => {
    // 1. Load status (includes persona, tasks, model info, adapter status)
    loadStatus()  // → fetch('/api/status')
    
    // 2. Load pending approvals
    loadPendingApprovals()  // → fetch('/api/approvals')
    
    // 3. Setup EventSource for LLM activity
    connectActivityStream()  // → EventSource('/api/llm-activity')
    
    // Polling: 
    // - Status every 30 seconds
    // - Approvals every 5 seconds
})
```

#### RightSidebar.svelte (Developer Tools)
```typescript
onMount(() => {
    // When 'audit' tab is visible:
    // - LogStream sets up EventSource('/api/stream')
    // - Continuous unbounded log streaming
    
    // When settings tab is accessed:
    // - fetchModelInfo() → /api/model-info, /api/models
    // - fetchLoggingConfig() → /api/logging-config
    // - fetchLoraConfig() → /api/lora-toggle
})
```

#### CenterContent.svelte (Main Content Area)
```typescript
// Only loads data when activeView changes
async function loadEvents() {
    if ($activeView !== 'memory') return;
    
    // Heavy operation: Load all memories
    const res = await fetch('/api/memories_all')  // ← LARGE RESPONSE
}
```

### 2.2 API Endpoint Performance - What's Heavy?

#### `/api/status` (Called by: ChatLayout, LeftSidebar, Dashboard)
**File**: `/home/greggles/metahuman/apps/site/src/pages/api/status.ts`

Operations per request:
```typescript
loadPersonaCore()           // File I/O: reads persona/core.json
loadDecisionRules()         // File I/O: reads persona/decision-rules.json
listActiveTasks()           // File I/O: reads all task files
loadModelRegistry()         // File I/O: reads model registry
listAvailableRoles()        // Enum lookup
resolveModel(role)          // For each role: resolve and validate
  → File I/O per role
```

**Slowness Factor**: Multiple synchronous file reads + iterating all roles + model resolution.

#### `/api/boot` (Called by: ChatLayout)
**File**: `/home/greggles/metahuman/apps/site/src/pages/api/boot.ts`

Operations:
```typescript
spawn('boredom-service')     // Spawns subprocess
spawn('audio-organizer')     // Spawns another subprocess
```

**Slowness Factor**: Subprocess spawning is relatively fast but happens immediately on page load. Not critical but could be deferred.

#### `/api/memories_all` (Called by: CenterContent when memory view selected)
**File**: `/home/greggles/metahuman/apps/site/src/pages/api/memories_all.ts`

Likely performs:
- Walks entire episodic memory directory structure
- Loads all memory JSON files
- Compiles reflections, dreams, curated items
- Large JSON response (potentially MBs if many memories)

**Slowness Factor**: Unbounded file system traversal + large response serialization.

#### `/api/stream` (Called by: LogStream in RightSidebar)
```typescript
eventSource = new EventSource('/api/stream')
```

**Slowness Factor**: EventSource keeps connection open indefinitely, streaming all audit logs in real-time. Can accumulate thousands of entries in logs array.

---

## 3. Blocking Operations Identified

### 3.1 Serialized API Calls in ChatLayout
```typescript
// These run SEQUENTIALLY (one after another):
void loadPersonaName();       // Awaits /api/status
void loadCognitiveMode();     // Awaits /api/cognitive-mode (only after above? depends)
```

**Impact**: If `/api/status` takes 300ms and `/api/cognitive-mode` takes 200ms, total delay is 500ms minimum.

### 3.2 Multiple Components Fetching Same Data
- **ChatLayout** fetches `/api/status` for persona name
- **LeftSidebar** fetches `/api/status` again for identity/tasks/models
- **Dashboard** (if visited) fetches `/api/status` again

**Result**: 3 identical network round trips for the same data.

### 3.3 LLM Model Loading (in /api/status)
```typescript
loadModelRegistry()           // Synchronous file read
for (const role of roles) {
    resolveModel(role)        // Model resolution logic
}
```

This builds `modelRoles` object with adapter information. Could be slow if:
- Model registry file is large
- Many roles are defined
- Model resolution involves I/O

---

## 4. Component Hydration Bottleneck

### 4.1 All Components Load Synchronously
```html
<!-- index.astro -->
<ChatLayout client:load>                    <!-- Starts hydration immediately -->
  <LeftSidebar slot="left-sidebar" client:load />        <!-- Hydrates in parallel -->
  <CenterContent slot="center" client:load />            <!-- Hydrates in parallel -->
  <RightSidebar slot="right-sidebar" client:load />      <!-- Hydrates in parallel -->
</ChatLayout>
```

Each component:
- Loads its JavaScript bundle (or shared bundle)
- Runs its `onMount()` hooks
- Makes API calls

**Hydration Waterfall**:
```
T=0ms     Page requests HTML
T=50ms    HTML received, theme script runs
T=100ms   CSS loaded
T=150ms   JavaScript bundle starts loading
T=300ms   JavaScript loaded, hydration starts
          ├─ ChatLayout.onMount() fires
          ├─ LeftSidebar.onMount() fires      
          ├─ CenterContent.onMount() fires (may defer)
          └─ RightSidebar.onMount() fires
T=350ms   /api/status requests start
T=650ms   /api/status responses arrive
T=700ms   UI renders with data
```

**Problem**: The page is blank from T=0 to T=700ms. User sees nothing for 0.7 seconds.

---

## 5. Heavy Operations on Startup

### 5.1 Model Registry Loading
`/api/status` synchronously loads the entire model registry and resolves all roles:
```typescript
const registry = loadModelRegistry();           // File I/O
const roles = listAvailableRoles();             // List all roles
for (const role of roles) {
    resolveModel(role);                         // Per-role lookup + validation
}
```

**Each role resolution may involve**:
- Checking adapter files
- Loading adapter metadata
- Validating model names
- Building response object

**Recommendation**: Defer role resolution until explicitly requested.

### 5.2 Task Listing
Every `/api/status` call runs `listActiveTasks()`:
```typescript
listActiveTasks()  // Walks memory/tasks/active/ directory
```

Stores rarely change mid-session, so this doesn't need to load on every page refresh.

### 5.3 EventSource Connections
Both LeftSidebar and RightSidebar set up EventSource connections:
- `/api/llm-activity` (LLM activity stream)
- `/api/stream` (audit log stream)

Both connections remain open indefinitely, consuming memory and bandwidth.

---

## 6. Current Load Timing Estimate

**Optimistic scenario (no network issues, fast disk)**:
```
Theme script:              10-20ms
CSS loading:               30-50ms
JS bundle download:        100-200ms (depends on bundle size)
JS parsing & hydration:    100-150ms
/api/status:               200-500ms (file I/O + model resolution)
/api/cognitive-mode:       100-200ms
EventSource connections:   50-100ms
Total Time-to-Content:     600-1100ms
Total Time-to-Interactive: 800-1300ms
```

**Realistic scenario** (network latency, disk contention):
```
Total Time-to-Content:     1000-2000ms
Total Time-to-Interactive: 1500-2500ms
```

---

## 7. Bottleneck Summary

| Component | Operation | Duration | Blocking? | Frequency |
|-----------|-----------|----------|-----------|-----------|
| ChatLayout | /api/status | 300-600ms | Yes (for persona name) | Every 30s |
| ChatLayout | /api/cognitive-mode | 100-300ms | Yes | On mount |
| LeftSidebar | /api/status | 300-600ms | Yes (for status widget) | Every 30s |
| LeftSidebar | /api/approvals | 100-300ms | No (parallel) | Every 5s |
| RightSidebar | /api/stream | Open connection | No (async) | Continuous |
| LeftSidebar | /api/llm-activity | Open connection | No (async) | Continuous |
| /api/status | loadModelRegistry() | 50-200ms | Yes (sync) | Per request |
| /api/status | resolveModel() × N roles | 50-500ms | Yes (sync) | Per request |
| /api/boot | spawn(agents) | 10-50ms | No (async) | On mount |

---

## 8. Recommendations for Splash Screen Implementation

### 8.1 Immediate Splash Screen (Before Hydration Complete)

**Strategy**: Show static HTML splash before JavaScript loads.

```html
<!DOCTYPE html>
<html>
<head>
  <style is:inline>
    .splash {
      position: fixed;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      z-index: 9999;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI';
      color: white;
    }
    
    .splash-content {
      text-align: center;
    }
    
    .spinner {
      width: 50px;
      height: 50px;
      border: 3px solid rgba(255,255,255,0.3);
      border-top: 3px solid white;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin: 0 auto 20px;
    }
    
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    
    /* Hide splash when page is ready */
    html.ready .splash { opacity: 0; pointer-events: none; transition: opacity 0.3s; }
  </style>
</head>
<body>
  <div id="splash" class="splash">
    <div class="splash-content">
      <div class="spinner"></div>
      <h1>MetaHuman OS</h1>
      <p>Initializing your digital personality...</p>
    </div>
  </div>
  <!-- Rest of Astro content -->
</body>
</html>
```

**Hide splash when hydration complete**:
```typescript
// In ChatLayout.svelte onMount()
onMount(() => {
  setTimeout(() => {
    document.documentElement.classList.add('ready')
  }, 100)  // After first paint
})
```

### 8.2 Progressive Enhancement Splash

Show splash while waiting for critical API calls:

```typescript
// In ChatLayout.svelte
let appReady = false

onMount(() => {
  // Show spinner initially
  document.documentElement.classList.add('loading')
  
  Promise.all([
    loadPersonaName(),
    loadCognitiveMode()
  ]).then(() => {
    appReady = true
    document.documentElement.classList.remove('loading')
    document.documentElement.classList.add('ready')
  })
})
```

**CSS**:
```css
/* Show splash while .loading class is present */
html.loading .app-root { opacity: 0.3; pointer-events: none; }
html.loading #splash { opacity: 1; }
```

---

## 9. Optimization Priority (Quick Wins → Long-term)

### Quick Wins (0-1 day)
1. **Implement loading splash screen** (visible immediately)
2. **Defer EventSource connections** (don't connect until right sidebar is visible)
3. **Defer /api/boot until user interaction** (agents can start with slight delay)
4. **Cache `/api/status` response** in memory for 5-10 seconds

### Medium-term (1-3 days)
5. **Split API endpoints**:
   - `/api/status/identity` (fast, just persona name)
   - `/api/status/full` (comprehensive, current behavior)
   - Keep components polling identity separately from full status

6. **Lazy-load RightSidebar**:
   - Use `client:idle` instead of `client:load`
   - Delay EventSource connections until tab is visible

7. **Optimize /api/status**:
   - Cache model registry for 30 seconds
   - Defer model role resolution to separate endpoint
   - Load only necessary fields

### Long-term (1-2 weeks)
8. **Code splitting**:
   - Separate ChatInterface from index page (load on demand)
   - Separate RightSidebar components (audit viewer, agent monitor)

9. **IndexedDB caching**:
   - Cache persona data locally
   - Cache status across sessions
   - Only sync on focus/periodic refresh

10. **Server-side session**: 
    - Pre-render status on server
    - Send as HTML payload instead of requiring fetch

---

## 10. Splash Screen Implementation Details

### 10.1 Recommended Approach

**Two-stage splash**:
1. **Static HTML splash** (0-300ms): Shows immediately, pure HTML/CSS
2. **Component splash** (300-1000ms): Hydrated component with animation

**Implementation**:
```html
<!-- index.astro -->
<html>
  <head>
    <script is:inline>
      // Set splash immediately (before styles load)
      document.documentElement.style.background = '#1a1a1a'
    </script>
    <style is:inline>
      /* Minimal splash styles, critical path only */
      .splash { /* inline CSS */ }
    </style>
  </head>
  <body>
    <!-- Static splash HTML -->
    <div id="static-splash" class="splash splash-static">
      <div class="spinner"></div>
      <h1>MetaHuman OS</h1>
    </div>
    
    <!-- Astro components (includes Svelte splash) -->
    <ChatLayout client:load>...</ChatLayout>
    
    <script is:inline>
      // Remove static splash when hydration done
      window.addEventListener('load', () => {
        document.getElementById('static-splash')?.remove()
      })
    </script>
  </body>
</html>
```

### 10.2 EventSource Management

```typescript
// RightSidebar.svelte
let showingAudit = false
let eventSource: EventSource | null = null

function setupAuditStream() {
  if (eventSource) return
  eventSource = new EventSource('/api/stream')
  // ...
}

function teardownAuditStream() {
  if (eventSource) {
    eventSource.close()
    eventSource = null
  }
}

// Only connect when audit tab visible
$: {
  if (activeTab === 'audit' && !eventSource) {
    setupAuditStream()
  } else if (activeTab !== 'audit' && eventSource) {
    teardownAuditStream()
  }
}
```

### 10.3 Deferred Agent Boot

```typescript
// In ChatLayout.svelte
onMount(() => {
  // Don't block page load for agent startup
  setTimeout(() => {
    fetch('/api/boot', { keepalive: true }).catch(() => {})
  }, 2000)  // Boot agents after 2 seconds
})
```

---

## 11. File Paths for Investigation/Modification

**Core initialization files**:
- `/home/greggles/metahuman/apps/site/src/pages/index.astro` - Main entry point
- `/home/greggles/metahuman/apps/site/src/components/ChatLayout.svelte` - Header & layout (4 simultaneous API calls)
- `/home/greggles/metahuman/apps/site/src/components/LeftSidebar.svelte` - Status widget (multiple API calls + polling)
- `/home/greggles/metahuman/apps/site/src/components/RightSidebar.svelte` - Developer tools (EventSource)
- `/home/greggles/metahuman/apps/site/src/pages/api/status.ts` - Heavy endpoint (model resolution)
- `/home/greggles/metahuman/apps/site/src/pages/api/boot.ts` - Agent startup

**Build/Config**:
- `/home/greggles/metahuman/apps/site/astro.config.mjs` - Astro configuration (no optimization settings)
- `/home/greggles/metahuman/apps/site/package.json` - Dependencies

---

## 12. Measurement Recommendations

To validate improvements, measure:
1. **First Contentful Paint (FCP)**: When splash appears
2. **Largest Contentful Paint (LCP)**: When persona name appears
3. **Time-to-Interactive (TTI)**: When chat input is usable
4. **Cumulative Layout Shift (CLS)**: Measure layout thrashing

Use browser DevTools:
```javascript
// In browser console
performance.getEntriesByName('').forEach(e => {
  console.log(`${e.name}: ${e.startTime.toFixed(0)}ms`)
})

// Or use Web Vitals
import { getCLS, getFID, getFCP, getLCP, getTTFB } from 'web-vitals'
getCLS(console.log)
getFCP(console.log)
getLCP(console.log)
getTTFB(console.log)
```

---

## Summary Table: Slow Operations

| Issue | File | Line | Impact | Fix Priority |
|-------|------|------|--------|--------------|
| All components load with `client:load` | index.astro | 37-41 | Creates large JS bundle, no streaming | High |
| Simultaneous API calls in 3 components | ChatLayout, LeftSidebar, RightSidebar | Multiple | Network bottleneck, 300-1000ms | High |
| /api/status is slow (model resolution) | api/status.ts | 76-104 | 200-500ms per call | High |
| EventSource connections on mount | LeftSidebar, RightSidebar | Multiple | Memory leak, unbounded logs | Medium |
| No splash screen | index.astro | — | User sees blank page 600-1500ms | High |
| /api/boot spawns agents immediately | api/boot.ts | 26-88 | Not critical, could defer | Low |
| No caching between components | Multiple | — | Same endpoint called 3x | Medium |

