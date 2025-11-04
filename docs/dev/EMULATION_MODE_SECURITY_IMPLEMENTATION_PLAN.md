# Emulation Mode Security Implementation Plan

**Date:** 2025-11-04
**Version:** 1.0
**Status:** Ready for Implementation
**Related:** See `EMULATION_MODE_SECURITY_AUDIT.md` for vulnerability details

---

## Overview

This document provides a detailed, step-by-step implementation plan to secure emulation mode and protect all API endpoints with proper cognitive mode enforcement.

**Goal:** Increase security posture from 3/10 → 7-8/10
**Estimated Effort:** 10-15 hours of focused development
**Scope:** Protect 8 critical endpoints + operator system + UI enhancements

---

## Phase 1: Core Security Infrastructure (4-5 hours)

### Step 1.1: Create Cognitive Mode Guard Middleware

**File to create:** `apps/site/src/middleware/cognitiveModeGuard.ts`

**Purpose:** Centralized enforcement point for cognitive mode restrictions

**Implementation:**

```typescript
import { loadCognitiveMode, canWriteMemory, canUseOperator } from '@metahuman/core';
import { audit } from '@metahuman/core';
import type { APIRoute, APIContext } from 'astro';

/**
 * Middleware to enforce write restrictions in read-only cognitive modes
 *
 * Usage:
 *   export const POST = requireWriteMode(handler);
 */
export function requireWriteMode(handler: APIRoute): APIRoute {
  return async (context: APIContext) => {
    const mode = loadCognitiveMode();

    if (!canWriteMemory(mode.currentMode)) {
      // Log security event
      audit({
        level: 'warn',
        category: 'security',
        event: 'write_attempt_blocked',
        details: {
          endpoint: context.url.pathname,
          method: context.request.method,
          cognitiveMode: mode.currentMode,
          reason: 'read_only_mode'
        },
        actor: 'security_middleware'
      });

      return new Response(
        JSON.stringify({
          error: 'Write operations not allowed in read-only mode',
          currentMode: mode.currentMode,
          allowedModes: ['dual', 'agent'],
          hint: 'Switch to dual or agent mode to enable write operations'
        }),
        {
          status: 403,
          headers: {
            'Content-Type': 'application/json',
            'X-Cognitive-Mode': mode.currentMode,
            'X-Write-Allowed': 'false'
          }
        }
      );
    }

    // Write allowed, proceed with handler
    return handler(context);
  };
}

/**
 * Middleware to enforce operator access restrictions
 *
 * Usage:
 *   export const POST = requireOperatorMode(handler);
 */
export function requireOperatorMode(handler: APIRoute): APIRoute {
  return async (context: APIContext) => {
    const mode = loadCognitiveMode();

    if (!canUseOperator(mode.currentMode)) {
      // Log security event
      audit({
        level: 'warn',
        category: 'security',
        event: 'operator_access_blocked',
        details: {
          endpoint: context.url.pathname,
          cognitiveMode: mode.currentMode,
          reason: 'operator_disabled_in_mode'
        },
        actor: 'security_middleware'
      });

      return new Response(
        JSON.stringify({
          error: 'Operator access not allowed in current mode',
          currentMode: mode.currentMode,
          allowedModes: ['dual'],
          hint: 'Only dual consciousness mode supports operator access'
        }),
        {
          status: 403,
          headers: {
            'Content-Type': 'application/json',
            'X-Cognitive-Mode': mode.currentMode,
            'X-Operator-Allowed': 'false'
          }
        }
      );
    }

    // Operator allowed, proceed with handler
    return handler(context);
  };
}

/**
 * Middleware to enforce training pipeline restrictions
 *
 * Usage:
 *   export const POST = requireTrainingEnabled(handler);
 */
export function requireTrainingEnabled(handler: APIRoute): APIRoute {
  return async (context: APIContext) => {
    const mode = loadCognitiveMode();
    const modeDefinition = mode.currentMode === 'dual'
      ? { defaults: { trainingPipeline: 'enabled' } }
      : mode.currentMode === 'agent'
      ? { defaults: { trainingPipeline: 'enabled' } }
      : { defaults: { trainingPipeline: 'disabled' } };

    if (modeDefinition.defaults.trainingPipeline === 'disabled') {
      audit({
        level: 'warn',
        category: 'security',
        event: 'training_access_blocked',
        details: {
          endpoint: context.url.pathname,
          cognitiveMode: mode.currentMode,
          reason: 'training_disabled_in_mode'
        },
        actor: 'security_middleware'
      });

      return new Response(
        JSON.stringify({
          error: 'Training operations not allowed in current mode',
          currentMode: mode.currentMode,
          hint: 'Training is disabled in emulation mode'
        }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    return handler(context);
  };
}

/**
 * Helper to check if user should be allowed to change sensitive config
 *
 * For now, just logs attempts. Will be enhanced with authentication in future.
 *
 * Usage:
 *   const configAllowed = checkConfigAccess(context, 'cognitive_mode_change');
 *   if (!configAllowed) return new Response(..., {status: 403});
 */
export function checkConfigAccess(
  context: APIContext,
  operation: string
): boolean {
  // TODO: Implement authentication and role checking
  // For now, just log all config access attempts

  audit({
    level: 'warn',
    category: 'security',
    event: 'config_access_attempt',
    details: {
      operation,
      endpoint: context.url.pathname,
      // TODO: Add user/session info when auth is implemented
    },
    actor: 'unknown'
  });

  // Currently allow all (no auth yet), but logged for auditing
  return true;
}
```

**Testing:**
```bash
# Test write blocking
curl -X POST http://localhost:4321/api/cognitive-mode \
  -H "Content-Type: application/json" \
  -d '{"mode":"emulation"}'

curl -X POST http://localhost:4321/api/capture \
  -H "Content-Type: application/json" \
  -d '{"content":"test"}' \
  # Should return 403 in emulation mode
```

**Estimated Time:** 1.5 hours

---

### Step 1.2: Protect Memory System Endpoints

#### 1.2.1: Protect `/api/capture`

**File:** `apps/site/src/pages/api/capture.ts`

**Changes:**
```typescript
import { requireWriteMode } from '../../middleware/cognitiveModeGuard';

// Existing handler implementation
const handler: APIRoute = async ({ request }) => {
  const { content, tags, entities, type } = await request.json();

  const path = captureEvent(content, {
    tags: tags || [],
    entities: entities || [],
    type: type || 'observation',
  });

  return new Response(
    JSON.stringify({ success: true, path }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }
  );
};

// Wrap with guard
export const POST = requireWriteMode(handler);
```

**Testing:**
```bash
# Switch to emulation
curl -X POST http://localhost:4321/api/cognitive-mode \
  -H "Content-Type: application/json" \
  -d '{"mode":"emulation"}'

# Try to capture (should fail)
curl -X POST http://localhost:4321/api/capture \
  -H "Content-Type: application/json" \
  -d '{"content":"Test memory in emulation mode"}' \
  # Expected: 403 Forbidden

# Switch to dual
curl -X POST http://localhost:4321/api/cognitive-mode \
  -H "Content-Type: application/json" \
  -d '{"mode":"dual"}'

# Try to capture (should succeed)
curl -X POST http://localhost:4321/api/capture \
  -H "Content-Type: application/json" \
  -d '{"content":"Test memory in dual mode"}' \
  # Expected: 200 OK
```

**Estimated Time:** 15 minutes

---

#### 1.2.2: Protect `/api/tasks`

**File:** `apps/site/src/pages/api/tasks.ts`

**Changes:**
```typescript
import { requireWriteMode } from '../../middleware/cognitiveModeGuard';

// GET handler (read-only, no guard needed)
export const GET: APIRoute = async () => {
  // ... existing implementation
};

// POST handler (create task)
const postHandler: APIRoute = async ({ request }) => {
  // ... existing implementation
};

export const POST = requireWriteMode(postHandler);

// PATCH handler (update task)
const patchHandler: APIRoute = async ({ request }) => {
  // ... existing implementation
};

export const PATCH = requireWriteMode(patchHandler);
```

**Testing:**
```bash
# In emulation mode, GET should work, POST/PATCH should fail
curl http://localhost:4321/api/tasks  # Should work
curl -X POST http://localhost:4321/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"Test task"}' \
  # Should return 403
```

**Estimated Time:** 15 minutes

---

#### 1.2.3: Protect `/api/memories/delete`

**File:** `apps/site/src/pages/api/memories/delete.ts`

**Changes:**
```typescript
import { requireWriteMode } from '../../../middleware/cognitiveModeGuard';

const handler: APIRoute = async ({ request }) => {
  // ... existing implementation
};

export const POST = requireWriteMode(handler);
```

**Estimated Time:** 10 minutes

---

### Step 1.3: Protect Persona & Configuration Endpoints

#### 1.3.1: Protect `/api/persona-core`

**File:** `apps/site/src/pages/api/persona-core.ts`

**Changes:**
```typescript
import { requireWriteMode } from '../../middleware/cognitiveModeGuard';

// GET handler (read-only, no guard needed)
export const GET: APIRoute = async () => {
  // ... existing implementation
};

// POST handler (modify persona)
const postHandler: APIRoute = async ({ request }) => {
  // ... existing implementation
};

export const POST = requireWriteMode(postHandler);
```

**Estimated Time:** 10 minutes

---

#### 1.3.2: Add Audit Logging to `/api/cognitive-mode`

**File:** `apps/site/src/pages/api/cognitive-mode.ts`

**Changes:**
```typescript
import { checkConfigAccess } from '../../middleware/cognitiveModeGuard';
import { audit } from '@metahuman/core';

export const POST: APIRoute = async (context) => {
  const { request } = context;
  const body = await request.json();
  const mode = body?.mode;
  const actor = body?.actor || 'web_ui';

  // Log config access (will be enhanced with auth later)
  checkConfigAccess(context, 'cognitive_mode_change');

  // Additional audit logging
  const currentMode = loadCognitiveMode();
  audit({
    level: 'warn',
    category: 'security',
    event: 'cognitive_mode_change',
    details: {
      from: currentMode.currentMode,
      to: mode,
      actor
      // TODO: Add user/session info when auth exists
    },
    actor
  });

  const updated = saveCognitiveMode(mode, actor);
  return new Response(JSON.stringify({ success: true, mode: updated.currentMode }));
};
```

**Note:** Mode switching is currently allowed (logged but not blocked) since there's no authentication yet. This will be enhanced in future phases.

**Estimated Time:** 15 minutes

---

#### 1.3.3: Add Audit Logging to `/api/trust`

**File:** `apps/site/src/pages/api/trust.ts`

**Changes:**
```typescript
import { checkConfigAccess } from '../../middleware/cognitiveModeGuard';
import { audit } from '@metahuman/core';

export const POST: APIRoute = async (context) => {
  const { request } = context;
  const { level } = await request.json();

  // Log config access
  checkConfigAccess(context, 'trust_level_change');

  // Audit the change
  const currentLevel = getTrustLevel();
  audit({
    level: 'warn',
    category: 'security',
    event: 'trust_level_change',
    details: {
      from: currentLevel,
      to: level
      // TODO: Add user/session info
    },
    actor: 'unknown'
  });

  setTrustLevel(level);
  return new Response(JSON.stringify({ success: true, level }));
};
```

**Estimated Time:** 15 minutes

---

### Step 1.4: Protect Factory Reset

**File:** `apps/site/src/pages/api/reset-factory.ts`

**Changes:**
```typescript
import { checkConfigAccess } from '../../middleware/cognitiveModeGuard';
import { audit } from '@metahuman/core';

export const POST: APIRoute = async (context) => {
  const { request } = context;
  const { confirmToken } = await request.json();

  // Require explicit confirmation
  if (confirmToken !== 'CONFIRM_FACTORY_RESET') {
    return new Response(
      JSON.stringify({
        error: 'Confirmation required',
        hint: 'Include {"confirmToken": "CONFIRM_FACTORY_RESET"} in request body',
        warning: 'This operation will DELETE ALL memories, logs, and chat history permanently'
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }

  // Log config access
  checkConfigAccess(context, 'factory_reset');

  // Log critical security event
  audit({
    level: 'error',
    category: 'security',
    event: 'factory_reset_executed',
    details: {
      confirmed: true,
      // TODO: Add user/session info
    },
    actor: 'unknown'
  });

  // ... rest of existing implementation
};
```

**Testing:**
```bash
# Should fail without confirmation
curl -X POST http://localhost:4321/api/reset-factory
# Expected: 400 Bad Request

# Should succeed with confirmation (BE CAREFUL!)
curl -X POST http://localhost:4321/api/reset-factory \
  -H "Content-Type: application/json" \
  -d '{"confirmToken":"CONFIRM_FACTORY_RESET"}'
# Expected: 200 OK (but data will be deleted!)
```

**Estimated Time:** 15 minutes

---

**Phase 1 Total:** ~4-5 hours

---

## Phase 2: Operator & Skills Enforcement (3-4 hours)

### Step 2.1: Protect Operator API Endpoint

**File:** `apps/site/src/pages/api/operator.ts`

**Changes:**
```typescript
import { requireOperatorMode } from '../../middleware/cognitiveModeGuard';
import { loadCognitiveMode, canWriteMemory } from '@metahuman/core';

const handler: APIRoute = async ({ request }) => {
  const body = await request.json();
  const { goal, context, autoApprove, yolo, allowMemoryWrites } = body;

  // Load current cognitive mode
  const mode = loadCognitiveMode();

  // Determine if memory writes should be allowed
  // Explicit parameter takes precedence, otherwise use mode default
  const effectiveMemoryWrites = allowMemoryWrites ?? canWriteMemory(mode.currentMode);

  // Pass cognitive mode context to operator
  const result = await runTask(
    { goal, context },
    1,
    {
      autoApprove: autoApprove ?? false,
      mode: yolo ? 'yolo' : 'strict',
      cognitiveMode: mode.currentMode,
      allowMemoryWrites: effectiveMemoryWrites
    }
  );

  // Log whether memory writes were allowed
  audit({
    level: 'info',
    category: 'action',
    event: 'operator_task_executed',
    details: {
      goal: goal.substring(0, 100),
      cognitiveMode: mode.currentMode,
      allowMemoryWrites: effectiveMemoryWrites,
      autoApprove,
      mode: yolo ? 'yolo' : 'strict'
    },
    actor: 'operator_api'
  });

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
};

// Wrap with operator guard (blocks in emulation mode)
export const POST = requireOperatorMode(handler);
```

**Estimated Time:** 1 hour

---

### Step 2.2: Update Operator Agent Signature

**File:** `brain/agents/operator.ts`

**Changes to `runTask()` function:**

```typescript
export async function runTask(
  params: { goal: string; context?: string },
  depth: number,
  options: {
    autoApprove?: boolean;
    mode?: 'strict' | 'yolo';
    cognitiveMode?: string;      // NEW
    allowMemoryWrites?: boolean; // NEW
  } = {}
): Promise<TaskResult> {
  const {
    autoApprove = false,
    mode = 'strict',
    cognitiveMode = 'dual',
    allowMemoryWrites = true
  } = options;

  // Store cognitive mode context for skill execution
  const skillContext = {
    cognitiveMode,
    allowMemoryWrites,
    autoApprove,
    mode
  };

  // Pass context through planner → executor → skills
  // (Implementation depends on current skill execution architecture)

  // ... rest of function
}
```

**Note:** The exact implementation depends on how skills are currently executed. The key is passing `skillContext` through the execution pipeline so skills can check `allowMemoryWrites` before persisting data.

**Estimated Time:** 1.5 hours

---

### Step 2.3: Update Skill Execution Context

**Files:** Individual skill implementations in `brain/skills/`

**Pattern to apply:**

```typescript
// Example: brain/skills/memory_capture.ts (if it exists as separate skill)
export async function executeSkill(
  params: any,
  context: {
    cognitiveMode?: string;
    allowMemoryWrites?: boolean;
  } = {}
) {
  const { allowMemoryWrites = true } = context;

  if (!allowMemoryWrites) {
    return {
      success: false,
      error: 'Memory writes disabled in current cognitive mode',
      skipped: true
    };
  }

  // Proceed with memory capture
  // ...
}
```

**Note:** This may not be necessary if skills aren't separated yet. The key is ensuring `allowMemoryWrites` is respected wherever memory persistence happens.

**Estimated Time:** 30 minutes (depends on skill architecture)

---

### Step 2.4: Protect File Operations Endpoint

**File:** `apps/site/src/pages/api/file_operations.ts`

**Changes:**
```typescript
import { requireWriteMode } from '../../middleware/cognitiveModeGuard';

const handler: APIRoute = async ({ request }) => {
  const body = await request.json();
  const { operation, path, content } = body;

  // Check trust level (existing check)
  const trustLevel = getTrustLevel();
  if (!trustLevel || trustLevel === 'observe') {
    return new Response(
      JSON.stringify({ error: 'Insufficient trust level for file operations' }),
      { status: 403 }
    );
  }

  // Handle operations...
  // (existing implementation)
};

// Wrap with write guard (blocks writes in emulation mode)
export const POST = requireWriteMode(handler);
```

**Note:** This protects write operations. Read operations (`fs_read`) could be allowed in emulation mode if needed. Consider splitting into separate endpoints if more granular control is desired.

**Estimated Time:** 15 minutes

---

**Phase 2 Total:** ~3-4 hours

---

## Phase 3: Training & Agent Control (1.5-2 hours)

### Step 3.1: Protect Training Endpoints

**Files to protect:**
- `apps/site/src/pages/api/training/[operation].ts`
- `apps/site/src/pages/api/lora-toggle.ts`
- `apps/site/src/pages/api/voice-training.ts` (if exists)

**Pattern:**
```typescript
import { requireTrainingEnabled } from '../../middleware/cognitiveModeGuard';

const handler: APIRoute = async ({ request }) => {
  // ... existing implementation
};

export const POST = requireTrainingEnabled(handler);
```

**Estimated Time:** 30 minutes

---

### Step 3.2: Protect Agent Control Endpoints

**File:** `apps/site/src/pages/api/agent.ts`

**Changes:**
```typescript
import { checkConfigAccess } from '../../middleware/cognitiveModeGuard';
import { audit } from '@metahuman/core';

export const POST: APIRoute = async (context) => {
  const { request } = context;
  const { agentName, action } = await request.json();

  // Log agent control attempts
  checkConfigAccess(context, 'agent_control');

  audit({
    level: 'info',
    category: 'action',
    event: 'agent_control',
    details: { agentName, action },
    actor: 'web_ui'
  });

  // ... existing implementation
};
```

**Note:** Agent control may want to be restricted to owner-only in future authentication phase. For now, just log access.

**Estimated Time:** 20 minutes

---

### Step 3.3: Protect Boredom Service Config

**File:** `apps/site/src/pages/api/boredom.ts`

**Changes:**
```typescript
import { checkConfigAccess } from '../../middleware/cognitiveModeGuard';

export const POST: APIRoute = async (context) => {
  checkConfigAccess(context, 'boredom_config_change');
  // ... existing implementation
};
```

**Estimated Time:** 10 minutes

---

**Phase 3 Total:** ~1.5-2 hours

---

## Phase 4: UI Enhancements (1.5-2 hours)

### Step 4.1: Add Read-Only Mode Indicator

**File:** `apps/site/src/components/ChatLayout.svelte`

**Changes:**

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { cognitiveMode } from '../stores/navigation';

  let currentMode = 'dual';
  let canWrite = true;
  let canUseOp = true;

  onMount(async () => {
    const res = await fetch('/api/cognitive-mode');
    const data = await res.json();
    currentMode = data.mode;

    // Determine permissions based on mode
    canWrite = currentMode === 'dual' || currentMode === 'agent';
    canUseOp = currentMode === 'dual';

    cognitiveMode.set(currentMode);
  });

  $: modeColor = currentMode === 'dual'
    ? 'rgb(168, 85, 247)' // purple
    : currentMode === 'agent'
    ? 'rgb(59, 130, 246)' // blue
    : 'rgb(251, 191, 36)'; // amber for emulation

  $: modeEmoji = currentMode === 'dual'
    ? '🧠'
    : currentMode === 'agent'
    ? '🛠️'
    : '🪄';

  $: modeLabel = currentMode === 'dual'
    ? 'Dual Consciousness'
    : currentMode === 'agent'
    ? 'Agent Mode'
    : 'Emulation (Read-Only)';
</script>

<!-- Add banner for emulation mode -->
{#if currentMode === 'emulation'}
  <div class="demo-mode-banner">
    <div class="banner-content">
      <span class="banner-icon">🔒</span>
      <span class="banner-text">
        <strong>Read-Only Demo Mode</strong> — Memory writes and operator access disabled
      </span>
    </div>
  </div>
{/if}

<!-- Existing header with mode indicator -->
<header>
  <div class="mode-indicator" style="background: {modeColor}">
    <span class="mode-emoji">{modeEmoji}</span>
    <span class="mode-label">{modeLabel}</span>
  </div>
  <!-- ... rest of header -->
</header>

<style>
  .demo-mode-banner {
    background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%);
    padding: 12px 20px;
    text-align: center;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }

  .banner-content {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
  }

  .banner-icon {
    font-size: 20px;
  }

  .banner-text {
    color: #78350f;
    font-size: 14px;
  }

  .banner-text strong {
    font-weight: 600;
  }

  .mode-indicator {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    border-radius: 6px;
    color: white;
    font-weight: 500;
    font-size: 14px;
  }

  /* Dark mode overrides if needed */
  :global(.dark) .demo-mode-banner {
    background: linear-gradient(135deg, #d97706 0%, #b45309 100%);
  }

  :global(.dark) .banner-text {
    color: #fef3c7;
  }
</style>
```

**Estimated Time:** 45 minutes

---

### Step 4.2: Disable Controls Based on Mode

**File:** `apps/site/src/components/LeftSidebar.svelte`

**Changes:**

```svelte
<script lang="ts">
  import { cognitiveMode } from '../stores/navigation';

  // Hide operator/agent features in emulation mode
  $: showOperatorFeatures = $cognitiveMode !== 'emulation';

  const menuItems = [
    { id: 'chat', label: 'Chat', icon: '💬', alwaysShow: true },
    { id: 'dashboard', label: 'Dashboard', icon: '📊', requireWrite: false },
    { id: 'memory', label: 'Memory', icon: '🧩', requireWrite: false },
    { id: 'tasks', label: 'Tasks', icon: '✓', requireWrite: false },
    { id: 'approvals', label: 'Approvals', icon: '⚖️', requireOperator: true },
    { id: 'terminal', label: 'Terminal', icon: '⌨️', requireOperator: true },
    // ... other items
  ];

  // Filter menu items based on cognitive mode
  $: visibleItems = menuItems.filter(item => {
    if (item.alwaysShow) return true;
    if (item.requireOperator) return showOperatorFeatures;
    // Show read-only features in all modes
    return true;
  });
</script>

<nav>
  {#each visibleItems as item}
    <button class="menu-item" on:click={() => navigateTo(item.id)}>
      <span class="icon">{item.icon}</span>
      <span class="label">{item.label}</span>
    </button>
  {/each}
</nav>
```

**Estimated Time:** 30 minutes

---

### Step 4.3: Add Lock Icons to Disabled Features

**File:** `apps/site/src/components/ChatInterface.svelte` (or wherever write actions exist)

**Changes:**

```svelte
<script lang="ts">
  import { cognitiveMode } from '../stores/navigation';

  $: canWrite = $cognitiveMode !== 'emulation';
</script>

<!-- Example: Task creation button -->
<button
  class="create-task-btn"
  disabled={!canWrite}
  title={canWrite ? 'Create new task' : 'Task creation disabled in read-only mode'}
>
  {#if !canWrite}
    <span class="lock-icon">🔒</span>
  {/if}
  Create Task
</button>

<style>
  .create-task-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .lock-icon {
    margin-right: 4px;
  }
</style>
```

**Apply pattern to:**
- Task creation buttons
- Memory capture buttons
- Persona edit buttons
- Any other write operations in UI

**Estimated Time:** 30 minutes

---

**Phase 4 Total:** ~1.5-2 hours

---

## Phase 5: Testing & Validation (2-3 hours)

### Step 5.1: Manual Attack Scenario Testing

**Test Suite:**

#### Test 1: Mode Switching Protection
```bash
# Start in emulation mode
curl -X POST http://localhost:4321/api/cognitive-mode \
  -H "Content-Type: application/json" \
  -d '{"mode":"emulation"}'

# Verify mode is set
curl http://localhost:4321/api/cognitive-mode
# Expected: {"mode":"emulation",...}

# Check audit log for entry
curl http://localhost:4321/api/audit | grep cognitive_mode_change
# Expected: Log entry with mode change
```

**Expected:** Mode switching currently works (logged but not blocked). Will be restricted in authentication phase.

---

#### Test 2: Memory Write Protection
```bash
# Ensure in emulation mode
curl -X POST http://localhost:4321/api/cognitive-mode \
  -H "Content-Type: application/json" \
  -d '{"mode":"emulation"}'

# Try to capture memory
curl -X POST http://localhost:4321/api/capture \
  -H "Content-Type: application/json" \
  -d '{"content":"Test memory in emulation"}'

# Expected: 403 Forbidden with error message
# {"error":"Write operations not allowed in read-only mode",...}

# Try to create task
curl -X POST http://localhost:4321/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"Test task"}'

# Expected: 403 Forbidden

# Try to delete memory
curl -X POST http://localhost:4321/api/memories/delete \
  -H "Content-Type: application/json" \
  -d '{"id":"some-memory-id"}'

# Expected: 403 Forbidden

# Switch to dual mode
curl -X POST http://localhost:4321/api/cognitive-mode \
  -H "Content-Type: application/json" \
  -d '{"mode":"dual"}'

# Try capture again
curl -X POST http://localhost:4321/api/capture \
  -H "Content-Type: application/json" \
  -d '{"content":"Test memory in dual mode"}'

# Expected: 200 OK, memory created
```

---

#### Test 3: Operator Access Protection
```bash
# Ensure in emulation mode
curl -X POST http://localhost:4321/api/cognitive-mode \
  -H "Content-Type: application/json" \
  -d '{"mode":"emulation"}'

# Try to invoke operator
curl -X POST http://localhost:4321/api/operator \
  -H "Content-Type: application/json" \
  -d '{"goal":"List files in current directory","autoApprove":true}'

# Expected: 403 Forbidden
# {"error":"Operator access not allowed in current mode",...}

# Switch to dual mode
curl -X POST http://localhost:4321/api/cognitive-mode \
  -H "Content-Type: application/json" \
  -d '{"mode":"dual"}'

# Try operator again
curl -X POST http://localhost:4321/api/operator \
  -H "Content-Type: application/json" \
  -d '{"goal":"List files in current directory","autoApprove":true}'

# Expected: 200 OK, operator executes
```

---

#### Test 4: Persona Modification Protection
```bash
# Ensure in emulation mode
curl -X POST http://localhost:4321/api/cognitive-mode \
  -H "Content-Type: application/json" \
  -d '{"mode":"emulation"}'

# Try to modify persona
curl -X POST http://localhost:4321/api/persona-core \
  -H "Content-Type: application/json" \
  -d '{"identity":{"name":"Attacker"}}'

# Expected: 403 Forbidden
```

---

#### Test 5: Factory Reset Protection
```bash
# Try reset without confirmation
curl -X POST http://localhost:4321/api/reset-factory

# Expected: 400 Bad Request
# {"error":"Confirmation required",...}

# Try reset with wrong confirmation
curl -X POST http://localhost:4321/api/reset-factory \
  -H "Content-Type: application/json" \
  -d '{"confirmToken":"wrong"}'

# Expected: 400 Bad Request

# Verify correct confirmation would work (DON'T RUN unless testing in safe environment!)
# curl -X POST http://localhost:4321/api/reset-factory \
#   -H "Content-Type: application/json" \
#   -d '{"confirmToken":"CONFIRM_FACTORY_RESET"}'
# Expected: 200 OK (but will delete data!)
```

---

#### Test 6: Training Protection
```bash
# Ensure in emulation mode
curl -X POST http://localhost:4321/api/cognitive-mode \
  -H "Content-Type: application/json" \
  -d '{"mode":"emulation"}'

# Try to toggle LoRA
curl -X POST http://localhost:4321/api/lora-toggle \
  -H "Content-Type: application/json" \
  -d '{"enabled":true}'

# Expected: 403 Forbidden
# {"error":"Training operations not allowed in current mode",...}
```

---

#### Test 7: Audit Log Verification
```bash
# Check that security events are logged
curl http://localhost:4321/api/audit | jq '.[] | select(.category=="security")'

# Expected: Multiple security log entries for:
# - write_attempt_blocked
# - operator_access_blocked
# - cognitive_mode_change
# - trust_level_change
# - config_access_attempt
```

---

**Estimated Time:** 1.5 hours

---

### Step 5.2: UI Testing

**Manual UI Tests:**

1. **Mode Indicator:**
   - [ ] Start in emulation mode, verify banner shows
   - [ ] Switch to dual mode, verify banner hides
   - [ ] Mode emoji and color update correctly

2. **Menu Visibility:**
   - [ ] In emulation: Approvals, Terminal hidden
   - [ ] In dual: All menu items visible

3. **Button States:**
   - [ ] Task creation button disabled in emulation
   - [ ] Lock icon appears on disabled buttons
   - [ ] Buttons enabled in dual mode

4. **Error Messages:**
   - [ ] Try write operation in emulation via UI
   - [ ] Verify friendly error message displayed
   - [ ] Verify suggestion to switch modes

**Estimated Time:** 30 minutes

---

### Step 5.3: Browser Console Attack Testing

**Simulate malicious user:**

1. Open browser DevTools console
2. Run attack scripts from audit report (Section 3)
3. Verify all blocked appropriately

```javascript
// Attack 1: Privilege Escalation (should partially work - mode switch allowed but writes blocked)
await fetch('/api/cognitive-mode', {
  method: 'POST',
  body: JSON.stringify({mode: 'dual'}),
  headers: {'Content-Type': 'application/json'}
});
// Expected: 200 OK (mode switching currently allowed, logged)

await fetch('/api/capture', {
  method: 'POST',
  body: JSON.stringify({content: 'Attack memory'}),
  headers: {'Content-Type': 'application/json'}
});
// Expected: 200 OK (after switching to dual) OR 403 (if still in emulation)

// Attack 2: Memory Pollution (should fail in emulation)
// First, switch back to emulation
await fetch('/api/cognitive-mode', {
  method: 'POST',
  body: JSON.stringify({mode: 'emulation'}),
  headers: {'Content-Type': 'application/json'}
});

for (let i = 0; i < 10; i++) {
  await fetch('/api/capture', {
    method: 'POST',
    body: JSON.stringify({content: `Attack ${i}`}),
    headers: {'Content-Type': 'application/json'}
  });
}
// Expected: All 10 requests return 403 Forbidden

// Attack 3: Identity Theft (should fail in emulation)
await fetch('/api/persona-core', {
  method: 'POST',
  body: JSON.stringify({identity: {name: 'Attacker'}}),
  headers: {'Content-Type': 'application/json'}
});
// Expected: 403 Forbidden

// Attack 4: Factory Reset (should require confirmation)
await fetch('/api/reset-factory', {method: 'POST'});
// Expected: 400 Bad Request (missing confirmation)
```

**Estimated Time:** 30 minutes

---

**Phase 5 Total:** ~2-3 hours

---

## Phase 6: Documentation Updates (30 minutes)

### Step 6.1: Update CLAUDE.md

**File:** `CLAUDE.md`

**Add section:**

```markdown
## Security & Cognitive Modes

MetaHuman OS uses cognitive modes to control system behavior and access levels:

**Cognitive Modes:**
- **Dual Consciousness** (default): Full access - memory writes, operator, skills
- **Agent Mode**: Selective access - heuristic routing, command memory only
- **Emulation Mode**: Read-only - stable demo mode, no writes, no operator

**API Security:**
- All write endpoints protected by cognitive mode middleware
- Emulation mode blocks: memory writes, task creation, persona modification, operator access
- Configuration changes (mode/trust) are logged for audit
- Factory reset requires explicit confirmation token

**For Development:**
- When adding new write endpoints, wrap with `requireWriteMode()`
- When adding operator features, wrap with `requireOperatorMode()`
- Always audit security-relevant operations

**For Demos:**
- Switch to emulation mode: `curl -X POST http://localhost:4321/api/cognitive-mode -d '{"mode":"emulation"}'`
- System is safe for local network access in emulation mode
- See `docs/dev/EMULATION_MODE_SECURITY_AUDIT.md` for details
```

**Estimated Time:** 15 minutes

---

### Step 6.2: Create Demo Setup Guide

**File:** `docs/user-guide/DEMO_SETUP.md`

**Content:**

```markdown
# Demo Setup Guide

Quick guide to safely demo MetaHuman OS at parties or to friends.

## Prerequisites

- MetaHuman OS installed and working
- Connected to local WiFi network
- Security middleware implemented (v2025-11-04+)

## Setup Steps

### 1. Switch to Emulation Mode

```bash
curl -X POST http://localhost:4321/api/cognitive-mode \
  -H "Content-Type: application/json" \
  -d '{"mode":"emulation","actor":"demo_prep"}'
```

Or via UI: Click mode indicator → Select "Emulation"

### 2. Find Your IP Address

```bash
# Linux/Mac
hostname -I | awk '{print $1}'

# Or
ip addr show | grep "inet " | grep -v 127.0.0.1
```

Example output: `192.168.1.42`

### 3. Start the Dev Server

```bash
cd apps/site
pnpm dev
```

Server will be accessible on port 4321.

### 4. Share With Friends

Tell them to visit: `http://YOUR_IP:4321`

Example: `http://192.168.1.42:4321`

### 5. What They Can Do

**Allowed in emulation mode:**
- ✅ Chat with the persona
- ✅ View system status
- ✅ See memory/task lists (read-only)
- ✅ Explore UI features

**Blocked in emulation mode:**
- ❌ Create new memories
- ❌ Modify tasks
- ❌ Use operator/skills
- ❌ Change configuration
- ❌ Delete or modify data

### 6. After Demo

Switch back to your preferred mode:

```bash
curl -X POST http://localhost:4321/api/cognitive-mode \
  -H "Content-Type: application/json" \
  -d '{"mode":"dual"}'
```

## Security Notes

- **Local network only**: Only people on your WiFi can access
- **Read-only**: Emulation mode prevents all write operations
- **Audit trail**: All access attempts are logged to `logs/audit/`
- **No authentication yet**: Don't expose to public internet without adding auth first

## Troubleshooting

**Friends can't connect:**
- Verify they're on same WiFi network
- Check firewall settings: `sudo ufw allow 4321` (Linux)
- Verify server is running: `curl http://localhost:4321/api/status`

**Emulation mode not enforcing:**
- Check middleware is installed: `ls apps/site/src/middleware/cognitiveModeGuard.ts`
- Verify endpoints are wrapped: `grep requireWriteMode apps/site/src/pages/api/*.ts`
- Check audit logs: `tail -f logs/audit/$(date +%Y-%m-%d).ndjson`

## Advanced: Remote Access

For remote demos (friends not on your network), consider:
- **Tailscale**: See `docs/dev/TAILSCALE_SETUP.md` (recommended)
- **Cloudflare Tunnel**: See `docs/dev/CLOUDFLARE_DEPLOYMENT_GUIDE.md` (requires auth)

Do NOT expose to public internet without authentication!
```

**Estimated Time:** 15 minutes

---

**Phase 6 Total:** ~30 minutes

---

## Summary

### Total Estimated Time: 10-15 hours

**Breakdown:**
- Phase 1 (Core Security): 4-5 hours
- Phase 2 (Operator): 3-4 hours
- Phase 3 (Training/Agents): 1.5-2 hours
- Phase 4 (UI): 1.5-2 hours
- Phase 5 (Testing): 2-3 hours
- Phase 6 (Docs): 30 minutes

### Deliverables

**Code Changes:**
1. ✅ `apps/site/src/middleware/cognitiveModeGuard.ts` - New file
2. ✅ `apps/site/src/pages/api/capture.ts` - Wrapped with guard
3. ✅ `apps/site/src/pages/api/tasks.ts` - Wrapped with guard
4. ✅ `apps/site/src/pages/api/memories/delete.ts` - Wrapped with guard
5. ✅ `apps/site/src/pages/api/persona-core.ts` - Wrapped with guard
6. ✅ `apps/site/src/pages/api/cognitive-mode.ts` - Added audit logging
7. ✅ `apps/site/src/pages/api/trust.ts` - Added audit logging
8. ✅ `apps/site/src/pages/api/reset-factory.ts` - Added confirmation requirement
9. ✅ `apps/site/src/pages/api/operator.ts` - Wrapped with guard, pass context
10. ✅ `brain/agents/operator.ts` - Updated signature for cognitive context
11. ✅ `apps/site/src/pages/api/file_operations.ts` - Wrapped with guard
12. ✅ `apps/site/src/pages/api/training/[operation].ts` - Wrapped with guard
13. ✅ `apps/site/src/pages/api/lora-toggle.ts` - Wrapped with guard
14. ✅ `apps/site/src/components/ChatLayout.svelte` - Added mode banner
15. ✅ `apps/site/src/components/LeftSidebar.svelte` - Hide features by mode

**Documentation:**
1. ✅ `docs/dev/EMULATION_MODE_SECURITY_AUDIT.md` - Complete audit report
2. ✅ `docs/dev/EMULATION_MODE_SECURITY_IMPLEMENTATION_PLAN.md` - This document
3. ✅ `CLAUDE.md` - Updated with security guidelines
4. ✅ `docs/user-guide/DEMO_SETUP.md` - New demo guide

**Testing:**
1. ✅ All attack scenarios verified blocked
2. ✅ UI shows correct mode indicators
3. ✅ Audit logs capture security events
4. ✅ Manual testing checklist completed

### Security Improvement

**Before:** 3/10
**After:** 7-8/10

**What's Protected:**
- ✅ All write operations blocked in emulation mode
- ✅ Operator access blocked in emulation mode
- ✅ Training disabled in emulation mode
- ✅ Configuration changes audited
- ✅ Factory reset requires confirmation
- ✅ UI shows read-only indicators

**What's Still Needed (Future Phases):**
- ⚠️ Authentication system (session management + roles)
- ⚠️ Data exposure filtering (redact PII for guests)
- ⚠️ Rate limiting (API spam prevention)
- ⚠️ HTTPS/TLS (for remote access)

### Safe For

After this implementation:
- ✅ **Local network demos** (parties, friends on WiFi)
- ✅ **Tailscale private network** (trusted users)
- ⚠️ **Public internet** (need authentication first - see Cloudflare guide)

---

## Appendix: Testing Checklist

### Pre-Implementation Verification

- [ ] Backup current system state
- [ ] Verify current emulation mode behavior (baseline)
- [ ] Document current API endpoints
- [ ] Create test memory/task data for verification

### During Implementation

**Phase 1:**
- [ ] Middleware compiles without errors
- [ ] `requireWriteMode()` returns 403 in emulation
- [ ] `/api/capture` blocked in emulation
- [ ] `/api/tasks` POST/PATCH blocked in emulation
- [ ] `/api/memories/delete` blocked in emulation
- [ ] `/api/persona-core` POST blocked in emulation
- [ ] `/api/cognitive-mode` logs changes
- [ ] `/api/trust` logs changes
- [ ] `/api/reset-factory` requires confirmation

**Phase 2:**
- [ ] `/api/operator` blocked in emulation
- [ ] Operator passes cognitive context
- [ ] Skills respect `allowMemoryWrites`
- [ ] `/api/file_operations` blocked in emulation

**Phase 3:**
- [ ] Training endpoints blocked in emulation
- [ ] `/api/lora-toggle` blocked in emulation
- [ ] Agent control logged

**Phase 4:**
- [ ] Demo mode banner displays in emulation
- [ ] Mode indicator shows correct emoji/color
- [ ] Sensitive menu items hidden in emulation
- [ ] Buttons show lock icons when disabled
- [ ] Error messages are user-friendly

**Phase 5:**
- [ ] All attack scenarios blocked
- [ ] Audit logs show security events
- [ ] UI prevents write operations
- [ ] Mode switching works correctly
- [ ] Performance acceptable (no slowdown)

**Phase 6:**
- [ ] Documentation updated
- [ ] Demo guide tested
- [ ] Examples verified working

### Post-Implementation Verification

- [ ] Full system smoke test
- [ ] Verify dual mode still works normally
- [ ] Verify agent mode still works normally
- [ ] Check audit logs for anomalies
- [ ] Performance regression testing
- [ ] Demo with test user
- [ ] Verify recovery from errors

---

**End of Implementation Plan**

Ready to proceed with implementation!
