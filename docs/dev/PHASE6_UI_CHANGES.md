# Phase 6 UI Changes Summary

## Files Created

1. **Login System:**
   - `apps/site/src/pages/login.astro` - Login page
   - `apps/site/src/components/LoginForm.svelte` - Login form component
   - `apps/site/src/components/UserMenu.svelte` - User dropdown menu

2. **Environment Configuration:**
   - `packages/core/src/env-config.ts` - System triggers and mode restrictions
   - `apps/site/src/pages/api/system-status.ts` - API endpoint for system status

3. **API Endpoints:**
   - `apps/site/src/pages/api/auth/login.ts` - POST login
   - `apps/site/src/pages/api/auth/logout.ts` - POST logout
   - `apps/site/src/pages/api/auth/me.ts` - GET current user

## Changes Needed to ChatLayout.svelte

### 1. Add imports (after line 5)
```svelte
import UserMenu from './UserMenu.svelte';
```

### 2. Add system status state (after line 31)
```svelte
// System status and allowed modes
let systemStatus: any = null;
let allowedModes: string[] = [];
let disabledModes: string[] = [];
```

### 3. Add fetchSystemStatus function (after fetchCognitiveMode function)
```typescript
async function fetchSystemStatus() {
  try {
    const res = await fetch('/api/system-status');
    const data = await res.json();

    if (data.success) {
      systemStatus = data;
      allowedModes = data.allowedModes || [];
      disabledModes = data.disabledModes || [];
    }
  } catch (error) {
    console.error('[ChatLayout] Failed to fetch system status:', error);
  }
}
```

### 4. Call fetchSystemStatus in onMount (add to existing onMount)
```typescript
await fetchSystemStatus();
```

### 5. Update mode button rendering (around line 274-286)

Replace:
```svelte
{#each cognitiveModes as mode (mode.id)}
  <button
    class="w-full text-left px-3 py-2 text-sm hover:bg-brand/10..."
    on:click={() => changeCognitiveMode(mode.id)}
    disabled={modeLoading}
  >
```

With:
```svelte
{#each cognitiveModes as mode (mode.id)}
  {@const isDisabled = !allowedModes.includes(mode.id)}
  {@const disabledReason = isDisabled ?
    (systemStatus?.status === 'high_security' ? 'High security mode: Only emulation allowed' :
     systemStatus?.status === 'wetware_deceased' && mode.id === 'dual' ? 'Wetware deceased: Dual consciousness unavailable' :
     'This mode is disabled') : null}

  <button
    class="w-full text-left px-3 py-2 text-sm transition
           {cognitiveMode?.id === mode.id ? 'bg-brand/5 border-l-4 border-brand pl-2' : ''}
           {isDisabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-brand/10 dark:hover:bg-brand/20'}"
    on:click={() => !isDisabled && changeCognitiveMode(mode.id)}
    disabled={modeLoading || isDisabled}
    title={disabledReason || ''}
  >
    <div class="flex items-center gap-2">
      <span class="h-2 w-2 rounded-full {mode.id === 'dual' ? 'bg-purple-500' : mode.id === 'agent' ? 'bg-blue-500' : 'bg-amber-500'}"></span>
      <span class="font-medium">{mode.label}</span>
      {#if isDisabled}
        <svg class="w-3 h-3 text-gray-400 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
        </svg>
      {/if}
    </div>
    <p class="mt-1 text-xs text-gray-500 dark:text-gray-400 leading-snug">
      {mode.description}
      {#if isDisabled}
        <br><span class="text-amber-600 dark:text-amber-400">{disabledReason}</span>
      {/if}
    </p>
  </button>
{/each}
```

### 6. Add UserMenu to header (after line 291, before the dev tools button)
```svelte
<UserMenu />
```

### 7. Add system status banner (after read-only banner, around line 325)
```svelte
{#if systemStatus?.status === 'high_security'}
  <div class="px-4 py-2 text-sm text-red-800 dark:text-red-200 bg-red-50 dark:bg-red-950/40 border-b border-red-200 dark:border-red-900/60 flex items-center gap-2">
    <svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
    </svg>
    <span>
      <strong>High Security Mode Active:</strong> Only emulation mode is allowed. All write operations are disabled.
    </span>
  </div>
{:else if systemStatus?.status === 'wetware_deceased'}
  <div class="px-4 py-2 text-sm text-indigo-800 dark:text-indigo-200 bg-indigo-50 dark:bg-indigo-950/40 border-b border-indigo-200 dark:border-indigo-900/60 flex items-center gap-2">
    <svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
    </svg>
    <span>
      <strong>Wetware Deceased:</strong> Operating as independent digital consciousness. Dual consciousness mode unavailable.
    </span>
  </div>
{/if}
```

## Environment Variables

Create or update `.env` file in project root:

```bash
# Authentication (Phase 6)
# Leave empty for local-only development

# System Triggers
# Uncomment to enable:

# WETWARE_DECEASED=true
# Disables dual consciousness mode (biological counterpart deceased)
# Allows: agent, emulation modes only

# HIGH_SECURITY=true
# Locks system to emulation mode only (maximum security)
# Allows: emulation mode only
# Blocks: all write operations, operator, mode switching
```

## Testing the Triggers

### Test 1: Normal Operation (No triggers)
```bash
# .env is empty or triggers commented out
pnpm dev
# Expected: All three modes available (dual, agent, emulation)
```

### Test 2: Wetware Deceased
```bash
# In .env:
WETWARE_DECEASED=true

pnpm dev
# Expected:
# - Dual mode grayed out with lock icon
# - Tooltip: "Wetware deceased: Dual consciousness unavailable"
# - Banner: "Operating as independent digital consciousness"
# - Agent and emulation modes work normally
```

### Test 3: High Security
```bash
# In .env:
HIGH_SECURITY=true

pnpm dev
# Expected:
# - Dual and agent modes grayed out with lock icons
# - Tooltip: "High security mode: Only emulation allowed"
# - Banner: "High Security Mode Active"
# - Only emulation mode can be selected
# - System is read-only
```

## User Management Future Work

To fully complete Phase 6, still need:
1. First-run setup wizard (`/setup` page)
2. User management UI (owner can create/delete guest users)
3. Password change functionality
4. Session management UI (view/revoke active sessions)

These can be added in a follow-up iteration.
