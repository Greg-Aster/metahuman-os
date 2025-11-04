# MetaHuman OS Slow Loading - Quick Fix Checklist

## Overview
This document provides actionable steps to fix the slow loading issue. Full details are in the investigation reports.

---

## Critical (Do First - 1 Day)

### 1. Add Loading Splash Screen
**File**: `apps/site/src/pages/index.astro`

Add before the main ChatLayout component:
```html
<style is:inline>
  .splash {
    position: fixed; inset: 0;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    display: flex; align-items: center; justify-content: center;
    z-index: 9999; color: white; font-family: system-ui;
  }
  .spinner {
    width: 50px; height: 50px; border: 3px solid rgba(255,255,255,0.3);
    border-top: 3px solid white; border-radius: 50%;
    animation: spin 1s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  html.ready .splash { opacity: 0; pointer-events: none; transition: opacity 0.3s; }
</style>

<div class="splash" id="splash">
  <div style="text-align: center;">
    <div class="spinner"></div>
    <h1>MetaHuman OS</h1>
    <p>Initializing your digital personality...</p>
  </div>
</div>
```

Then hide splash in ChatLayout.svelte onMount():
```typescript
onMount(() => {
  setTimeout(() => {
    document.documentElement.classList.add('ready')
  }, 200)
  // ... rest of onMount
})
```

**Impact**: Users see a splash immediately instead of blank page for 600ms.

---

### 2. Share `/api/status` Response
**Problem**: ChatLayout and LeftSidebar both call `/api/status` simultaneously (redundant)

**Solution**: Create a shared store
**File**: `apps/site/src/stores/navigation.ts`

Add:
```typescript
import { writable } from 'svelte/store'

export const statusStore = writable(null)
```

**Update ChatLayout.svelte**:
```typescript
import { statusStore } from '../stores/navigation'

async function loadPersonaName() {
  try {
    const res = await fetch('/api/status', { cache: 'no-store' })
    const data = await res.json()
    statusStore.set(data)  // ← Store it
    if (data?.identity?.name) {
      personaName = data.identity.name
    }
  } catch (error) {
    console.warn('Failed to load persona name:', error)
  } finally {
    personaLoading = false
  }
}
```

**Update LeftSidebar.svelte**:
```typescript
import { statusStore } from '../stores/navigation'

let status = $statusStore  // Subscribe to store

onMount(() => {
  // Don't call /api/status again, just load other data
  if (!$statusStore) {
    loadStatus()  // Only if store is empty
  }
  loadPendingApprovals()
  connectActivityStream()
  // ...
})
```

**Impact**: One fewer 300-600ms API call on page load. Saves 25-50% of initial load time.

---

### 3. Defer EventSource Connections
**Problem**: EventSource connections open immediately and stay open forever (memory leak)

**Files to Update**:
- `apps/site/src/components/LeftSidebar.svelte` (line 135)
- `apps/site/src/components/RightSidebar.svelte` (indirect via LogStream)

**LeftSidebar.svelte**: Only connect when component is visible
```typescript
let eventSource: EventSource | null = null

function connectActivityStream() {
  if (eventSource) return
  eventSource = new EventSource('/api/llm-activity')
  // ... rest of connection logic
}

function disconnectActivityStream() {
  if (eventSource) {
    eventSource.close()
    eventSource = null
  }
}

onMount(() => {
  // Don't auto-connect
  // connectActivityStream()  // ← Comment out or remove
  
  // Conditionally connect based on visibility or user interaction
  const handleVisibilityChange = () => {
    if (document.hidden) {
      disconnectActivityStream()
    } else {
      connectActivityStream()
    }
  }
  
  document.addEventListener('visibilitychange', handleVisibilityChange)
  
  return () => {
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    disconnectActivityStream()
  }
})
```

**LogStream.svelte**: Add log rotation to prevent unbounded growth
```typescript
const MAX_LOGS = 500

eventSource.onmessage = (event) => {
  try {
    const newLog = JSON.parse(event.data)
    if (newLog.type === 'connected') {
      logs = [...logs, { /* ... */ }]
    } else {
      logs = [...logs, newLog]
    }
    
    // Rotate logs if too many
    if (logs.length > MAX_LOGS) {
      logs = logs.slice(-MAX_LOGS)
    }
  } catch (e) {
    console.error('Failed to parse log event:', e)
  }
}
```

**Impact**: Prevents memory leaks, defers non-critical connections, saves 50-100ms on boot.

---

### 4. Cache `/api/status` Response (Server-side)
**File**: `apps/site/src/pages/api/status.ts`

Add at top of file:
```typescript
const statusCache = { data: null, timestamp: 0 }
const CACHE_TTL = 5000  // 5 seconds

export const GET: APIRoute = async () => {
  try {
    const now = Date.now()
    
    // Return cached if fresh
    if (statusCache.data && now - statusCache.timestamp < CACHE_TTL) {
      return new Response(
        JSON.stringify(statusCache.data),
        { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
      )
    }
    
    // ... existing code to compute status ...
    
    // Cache the response
    const responseData = { identity, tasks, values, goals, lastUpdated, model, modelRoles, registryVersion }
    statusCache.data = responseData
    statusCache.timestamp = now
    
    return new Response(JSON.stringify(responseData), /* ... */)
  } catch (error) {
    // ... existing error handling ...
  }
}
```

**Impact**: Reduces /api/status response time from 300-600ms to <10ms for cached responses.

---

## High Priority (2-3 Days)

### 5. Lazy-Load RightSidebar Component
**File**: `apps/site/src/pages/index.astro`

Change:
```html
<RightSidebar slot="right-sidebar" client:load />
```

To:
```html
<RightSidebar slot="right-sidebar" client:idle />
```

**Impact**: RightSidebar won't hydrate until the browser is idle, saving 100-200ms on critical path.

---

### 6. Split `/api/status` Endpoint
Create two endpoints:

**Create**: `apps/site/src/pages/api/status/identity.ts`
```typescript
// Fast endpoint: just persona + icon
// Returns in 30-100ms instead of 300-600ms
```

**Rename existing** to `status/full.ts` or create new endpoint

Update component calls:
```typescript
// ChatLayout - only needs identity
const res = await fetch('/api/status/identity')

// LeftSidebar - needs full status
const res = await fetch('/api/status/full')
```

**Impact**: Header renders in 100ms instead of 600ms. 500ms improvement to visual load.

---

### 7. Optimize `/api/status` Endpoint
**File**: `apps/site/src/pages/api/status.ts`

Identify slowest operations:
```typescript
// SLOW: Iterates all roles
for (const role of roles) {
  try {
    const resolved = resolveModel(role)
    // ...
  }
}

// FIX: Defer model role resolution to separate endpoint
```

Move model role resolution to separate endpoint (`/api/status/models`) that can be cached longer.

---

## Medium Priority (1 Week)

### 8. Implement Response Caching Layer
Create `packages/core/src/cache.ts`:
```typescript
export class ResponseCache {
  private cache = new Map<string, { data: any; timestamp: number }>()
  
  set(key: string, data: any, ttlMs = 5000) {
    this.cache.set(key, { data, timestamp: Date.now() })
    setTimeout(() => this.cache.delete(key), ttlMs)
  }
  
  get(key: string) {
    return this.cache.get(key)?.data ?? null
  }
}
```

Use in all API endpoints for commonly accessed data.

---

### 9. Implement IndexedDB Caching
**File**: `apps/site/src/stores/cache.ts`

Cache persona data locally:
```typescript
// On first load
const cached = await db.get('persona')
if (cached) {
  statusStore.set(cached)
}

// On fresh fetch
await db.put('persona', freshData)
statusStore.set(freshData)
```

Allows instant loads on repeat visits.

---

### 10. Code-Split ChatInterface
Move ChatInterface to lazy-load on first interaction instead of bundling with initial page.

---

## Measurement & Validation

After implementing fixes, measure:

### 1. First Contentful Paint (FCP)
```javascript
// In browser console
performance.getEntriesByType('paint')
// Should show FCP ~200-300ms (splash screen)
```

### 2. Largest Contentful Paint (LCP)
```javascript
new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    console.log('LCP:', entry.renderTime || entry.loadTime);
  }
}).observe({entryTypes: ['largest-contentful-paint']})
// Target: <1000ms
```

### 3. Time-to-Interactive (TTI)
```javascript
import { getTTFB, getCLS, getFID, getLCP } from 'web-vitals'
getLCP(console.log)  // Target: <1200ms
```

### 4. Chrome DevTools Network Tab
1. Open DevTools
2. Go to Network tab
3. Reload page
4. Check timeline:
   - HTML load: <100ms
   - CSS load: <100ms
   - JS load: <300ms
   - API calls: should be parallel, not serial

### 5. Lighthouse
1. Open DevTools
2. Go to Lighthouse
3. Run performance audit
4. Check "Performance" score (target: 80+)

---

## Testing Checklist

After each fix:
- [ ] Page loads without errors
- [ ] Chat interface works
- [ ] Persona name displays
- [ ] Sidebars toggle correctly
- [ ] Network tab shows parallel requests
- [ ] No console errors
- [ ] No memory leaks (DevTools → Memory → Heap snapshot)
- [ ] Dark/light mode still works

---

## Before/After Metrics

**Before Optimization**:
- Time to Splash: 600ms
- Time to Content: 700ms
- Time to Interactive: 1200-1500ms
- Network requests: Sequential + duplicates
- Memory growth: Unbounded (EventSource)

**After Quick Fixes**:
- Time to Splash: 150ms (splash appears immediately)
- Time to Content: 400ms (from cached status)
- Time to Interactive: 600ms (shared store + caching)
- Network requests: Parallel, deduplicated
- Memory: Stable (EventSource disconnects)

**Expected Savings**: 300-900ms (40-75% improvement)

---

## Rollback Plan

If any fix causes issues:
1. Comment out the change
2. Clear browser cache (`Ctrl+Shift+Del`)
3. Hard reload (`Ctrl+Shift+R`)
4. Verify behavior returns to baseline

---

## Questions?

Refer to full investigation:
- **Detailed Analysis**: `/home/greggles/metahuman/SLOW_LOADING_INVESTIGATION.md`
- **Timeline Diagram**: `/home/greggles/metahuman/BOOT_SEQUENCE_DIAGRAM.txt`
- **Summary**: `/home/greggles/metahuman/PERFORMANCE_SUMMARY.txt`

