# Security Policy Architecture (Revised)

**Date:** 2025-11-04
**Version:** 2.0 (Revised based on peer review)
**Status:** Design Document
**Supersedes:** Initial approach in EMULATION_MODE_SECURITY_IMPLEMENTATION_PLAN.md

---

## Overview

This document describes the unified security policy architecture for MetaHuman OS. Instead of scattering permission checks across individual endpoints and middleware, we centralize all security decisions in a **single policy layer** that considers both **cognitive mode** and **user role/session**.

## Problems with Initial Approach

The original implementation plan had several issues:

1. **No per-user awareness** - Only checked global cognitive mode, not who was making the request
2. **Boilerplate multiplication** - Required manually wrapping every endpoint with guards
3. **Performance inefficiency** - Multiple disk reads per request to load cognitive mode
4. **Incomplete enforcement** - Only protected HTTP layer, not skill execution layer
5. **Authentication gap** - Built security without the auth system to support it

## Unified Policy Layer Design

### Core Concept

**All security decisions flow through a single policy object that knows both WHO (role) and WHAT MODE (cognitive state).**

```typescript
interface SecurityPolicy {
  // Core permissions
  canWriteMemory: boolean;
  canUseOperator: boolean;
  canChangeMode: boolean;
  canChangeTrust: boolean;
  canAccessTraining: boolean;
  canFactoryReset: boolean;

  // Context
  role: 'owner' | 'guest' | 'anonymous';
  mode: CognitiveModeId;
  sessionId?: string;

  // Helper methods
  requireWrite(): void;         // Throws if !canWriteMemory
  requireOperator(): void;      // Throws if !canUseOperator
  requireOwner(): void;         // Throws if role !== 'owner'
}
```

### Policy Resolution

```typescript
function getSecurityPolicy(context?: APIContext): SecurityPolicy {
  // Load cognitive mode (cached per request)
  const cogMode = loadCognitiveMode();

  // Extract session/role (from auth system when available)
  const session = extractSession(context);
  const role = session?.role ?? 'anonymous';

  // Combine mode restrictions + role restrictions
  return {
    // Memory writes: dual/agent mode AND not a guest
    canWriteMemory: canWriteMemory(cogMode.currentMode) && role !== 'guest',

    // Operator: dual mode only AND owner only
    canUseOperator: canUseOperator(cogMode.currentMode) && role === 'owner',

    // Mode changes: owner only (regardless of current mode)
    canChangeMode: role === 'owner',

    // Trust changes: owner only
    canChangeTrust: role === 'owner',

    // Training: not emulation AND owner only
    canAccessTraining: cogMode.currentMode !== 'emulation' && role === 'owner',

    // Factory reset: owner only + explicit confirmation
    canFactoryReset: role === 'owner',

    // Context
    role,
    mode: cogMode.currentMode,
    sessionId: session?.id,

    // Helpers
    requireWrite() {
      if (!this.canWriteMemory) {
        throw new SecurityError('Write operations not allowed', {
          reason: role === 'guest' ? 'guest_user' : 'read_only_mode',
          currentMode: this.mode,
          role: this.role
        });
      }
    },

    requireOperator() {
      if (!this.canUseOperator) {
        throw new SecurityError('Operator access not allowed', {
          reason: role !== 'owner' ? 'insufficient_role' : 'operator_disabled_in_mode',
          currentMode: this.mode,
          role: this.role
        });
      }
    },

    requireOwner() {
      if (this.role !== 'owner') {
        throw new SecurityError('Owner role required', {
          role: this.role
        });
      }
    }
  };
}
```

---

## Implementation Layers

### Layer 1: Core Policy Module

**File:** `packages/core/src/security-policy.ts`

**Responsibilities:**
- Define `SecurityPolicy` interface
- Implement `getSecurityPolicy()` function
- Define `SecurityError` class
- Cache policy per-request
- No HTTP dependencies (pure logic)

**Benefits:**
- Testable in isolation
- Reusable across HTTP, CLI, agent contexts
- Single source of truth

---

### Layer 2: HTTP Middleware

**File:** `apps/site/src/middleware/securityMiddleware.ts`

**Responsibilities:**
- Extract policy from request context
- Attach to `context.locals.policy`
- Handle `SecurityError` exceptions
- Audit blocked attempts
- Return proper HTTP error responses

**Implementation:**

```typescript
export const onRequest: MiddlewareHandler = async (context, next) => {
  try {
    // Compute policy for this request
    const policy = getSecurityPolicy(context);

    // Attach to context for route handlers
    context.locals.policy = policy;

    // Continue to route handler
    return await next();

  } catch (error) {
    if (error instanceof SecurityError) {
      // Audit the blocked attempt
      audit({
        level: 'warn',
        category: 'security',
        event: 'security_violation',
        details: error.details,
        actor: context.locals.policy?.sessionId ?? 'anonymous'
      });

      return new Response(
        JSON.stringify({
          error: error.message,
          ...error.details
        }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // Re-throw other errors
    throw error;
  }
};
```

---

### Layer 3: Route Handlers

**How routes use the policy:**

```typescript
// Option A: Declarative guards (preferred)
export const POST: APIRoute = async ({ locals }) => {
  const { policy } = locals;

  // Throws SecurityError if not allowed
  policy.requireWrite();

  // Proceed with business logic
  const result = createTask(...);
  return Response.json({ success: true, result });
};

// Option B: Conditional checks
export const POST: APIRoute = async ({ locals }) => {
  const { policy } = locals;

  if (!policy.canWriteMemory) {
    return Response.json(
      { error: 'Write not allowed' },
      { status: 403 }
    );
  }

  // Business logic...
};

// Option C: Configuration endpoint pattern
export const POST: APIRoute = async ({ locals }) => {
  const { policy } = locals;

  policy.requireOwner(); // Only owners can change config

  // Change cognitive mode
  saveCognitiveMode(newMode);
  return Response.json({ success: true });
};
```

---

### Layer 4: Operator & Skills

**Update operator agent to receive policy:**

```typescript
// brain/agents/operator.ts
export async function runTask(
  params: { goal: string; context?: string },
  depth: number,
  options: {
    policy: SecurityPolicy;  // NEW: Pass policy through
    autoApprove?: boolean;
    mode?: 'strict' | 'yolo';
  }
): Promise<TaskResult> {
  const { policy, autoApprove, mode } = options;

  // Check operator permission up front
  policy.requireOperator();

  // Pass policy to skill execution
  const skillContext = {
    policy,
    autoApprove,
    mode
  };

  // Execute plan with policy context
  const result = await planner.execute(goal, skillContext);
  return result;
}
```

**Update skills to check policy:**

```typescript
// brain/skills/fs_write.ts
export async function executeSkill(
  params: { path: string; content: string },
  context: { policy: SecurityPolicy }
): Promise<SkillResult> {
  const { policy } = context;

  // Check if memory writes are allowed
  if (params.path.startsWith('memory/') && !policy.canWriteMemory) {
    return {
      success: false,
      error: 'Memory writes blocked by security policy',
      skipped: true
    };
  }

  // Proceed with file write
  writeFileSync(params.path, params.content);
  return { success: true };
}
```

---

### Layer 5: UI Integration

**Inject policy via Svelte context:**

```svelte
<!-- ChatLayout.svelte -->
<script lang="ts">
  import { setContext, onMount } from 'svelte';
  import { writable } from 'svelte/store';

  const policyStore = writable<SecurityPolicy | null>(null);

  onMount(async () => {
    // Fetch current policy
    const res = await fetch('/api/security/policy');
    const policy = await res.json();
    policyStore.set(policy);
  });

  // Share with all child components
  setContext('policy', policyStore);
</script>

<!-- Components automatically react to policy -->
{#if $policyStore && !$policyStore.canWriteMemory}
  <div class="demo-banner">
    🔒 Read-Only Mode
  </div>
{/if}
```

**Components read from context:**

```svelte
<!-- TaskManager.svelte -->
<script lang="ts">
  import { getContext } from 'svelte';

  const policyStore = getContext('policy');
  $: canCreateTask = $policyStore?.canWriteMemory ?? false;
</script>

<button disabled={!canCreateTask}>
  {#if !canCreateTask}🔒{/if}
  Create Task
</button>
```

---

## Migration Path

### Phase 1: Build Foundation (Now)

1. Create `packages/core/src/security-policy.ts`
2. Implement `getSecurityPolicy()` with mode-only checks (no auth yet)
3. Create middleware to attach policy to `context.locals`
4. Add `/api/security/policy` endpoint for UI

**Result:** Centralized policy system, ready for auth integration

---

### Phase 2: Update Endpoints (Now)

1. Replace manual `requireWriteMode()` wraps with `policy.requireWrite()`
2. Update `/api/cognitive-mode` to use `policy.requireOwner()`
3. Update `/api/operator` to pass policy through
4. Add policy checks to remaining endpoints

**Result:** All HTTP routes use unified policy

---

### Phase 3: Skills Layer (Now)

1. Update `runTask()` signature to accept policy
2. Update operator API to pass policy
3. Add policy checks to file system skills
4. Add policy checks to memory skills

**Result:** Security enforced at skill execution layer

---

### Phase 4: UI Integration (Now)

1. Fetch policy in `ChatLayout`
2. Share via Svelte context
3. Update components to use policy
4. Add read-only indicators

**Result:** UI reflects security state automatically

---

### Phase 5: Add Authentication (Later)

1. Implement session management (JWT or cookies)
2. Add login/logout endpoints
3. Update `extractSession()` in policy layer
4. Test with multiple users

**Result:** Multi-user security with roles

---

## Performance Optimizations

### Request-Scoped Caching

```typescript
// Cache policy computation per request
const REQUEST_POLICY_CACHE = new WeakMap<APIContext, SecurityPolicy>();

export function getSecurityPolicy(context?: APIContext): SecurityPolicy {
  if (!context) {
    // No context (CLI, agent) - compute fresh
    return computePolicy(null);
  }

  // Check cache
  if (REQUEST_POLICY_CACHE.has(context)) {
    return REQUEST_POLICY_CACHE.get(context)!;
  }

  // Compute and cache
  const policy = computePolicy(context);
  REQUEST_POLICY_CACHE.set(context, policy);
  return policy;
}
```

**Benefit:** Each request loads cognitive mode once, reuses everywhere

---

### In-Memory Mode Cache

```typescript
// Cache cognitive mode in memory, invalidate on file change
let cachedMode: CognitiveMode | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL = 1000; // 1 second

export function loadCognitiveMode(): CognitiveMode {
  const now = Date.now();

  if (cachedMode && (now - cacheTimestamp < CACHE_TTL)) {
    return cachedMode;
  }

  // Reload from disk
  cachedMode = readCognitiveModeFromDisk();
  cacheTimestamp = now;
  return cachedMode;
}

// Or use file watcher (better)
fs.watch(COGNITIVE_MODE_PATH, () => {
  cachedMode = null; // Invalidate cache
});
```

**Benefit:** Reduce disk I/O, faster policy resolution

---

## Testing Strategy

### Unit Tests (Policy Logic)

```typescript
describe('SecurityPolicy', () => {
  test('emulation mode blocks writes', () => {
    const policy = getSecurityPolicy({
      mode: 'emulation',
      role: 'anonymous'
    });

    expect(policy.canWriteMemory).toBe(false);
    expect(() => policy.requireWrite()).toThrow(SecurityError);
  });

  test('guest in dual mode cannot write', () => {
    const policy = getSecurityPolicy({
      mode: 'dual',
      role: 'guest'
    });

    expect(policy.canWriteMemory).toBe(false);
  });

  test('owner in dual mode can write', () => {
    const policy = getSecurityPolicy({
      mode: 'dual',
      role: 'owner'
    });

    expect(policy.canWriteMemory).toBe(true);
  });

  test('only owner can change mode', () => {
    const guestPolicy = getSecurityPolicy({
      mode: 'dual',
      role: 'guest'
    });
    expect(guestPolicy.canChangeMode).toBe(false);

    const ownerPolicy = getSecurityPolicy({
      mode: 'dual',
      role: 'owner'
    });
    expect(ownerPolicy.canChangeMode).toBe(true);
  });
});
```

---

### Integration Tests (HTTP Layer)

```typescript
describe('Security Middleware', () => {
  test('blocks write in emulation mode', async () => {
    // Set mode to emulation
    await setMode('emulation');

    // Try to capture memory
    const response = await fetch('/api/capture', {
      method: 'POST',
      body: JSON.stringify({ content: 'test' })
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: 'Write operations not allowed',
      currentMode: 'emulation'
    });
  });

  test('allows write in dual mode', async () => {
    await setMode('dual');

    const response = await fetch('/api/capture', {
      method: 'POST',
      body: JSON.stringify({ content: 'test' })
    });

    expect(response.status).toBe(200);
  });
});
```

---

### Attack Scenario Tests

```typescript
describe('Security Attack Scenarios', () => {
  test('cannot escalate privileges via mode switching', async () => {
    // Start in emulation
    await setMode('emulation');

    // Try to switch to dual
    const response = await fetch('/api/cognitive-mode', {
      method: 'POST',
      body: JSON.stringify({ mode: 'dual' })
    });

    // Should fail (no owner session)
    expect(response.status).toBe(403);

    // Mode should still be emulation
    const config = await loadCognitiveMode();
    expect(config.currentMode).toBe('emulation');
  });

  test('guest cannot use operator even in dual mode', async () => {
    // Guest session in dual mode
    await loginAsGuest();
    await setMode('dual');

    const response = await fetch('/api/operator', {
      method: 'POST',
      body: JSON.stringify({ goal: 'list files' })
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: 'Operator access not allowed',
      role: 'guest'
    });
  });
});
```

---

## Comparison: Old vs New Approach

| Aspect | Old Approach | New Approach |
|--------|-------------|--------------|
| **Permission logic** | Scattered across routes | Centralized in policy layer |
| **Mode + Role** | Mode only | Both considered |
| **Boilerplate** | Wrap every endpoint manually | Middleware auto-injects policy |
| **Performance** | Load mode per endpoint | Load once per request |
| **Skill layer** | Not covered | Policy passed through |
| **UI integration** | Manual checks everywhere | Reactive via context |
| **Auth readiness** | Hard to add later | Built-in support |
| **Testing** | Must test each route | Test policy logic once |
| **Maintenance** | Easy to miss new routes | Central enforcement point |

---

## File Structure

```
packages/core/src/
  security-policy.ts          # NEW: Core policy logic

apps/site/src/
  middleware/
    securityMiddleware.ts     # NEW: Attach policy to requests
    cognitiveModeGuard.ts     # DEPRECATED: Remove after migration

  pages/api/
    security/
      policy.ts               # NEW: GET current policy for UI

    capture.ts                # UPDATED: Use policy.requireWrite()
    tasks.ts                  # UPDATED: Use policy.requireWrite()
    cognitive-mode.ts         # UPDATED: Use policy.requireOwner()
    operator.ts               # UPDATED: Pass policy through

brain/agents/
  operator.ts                 # UPDATED: Accept policy param

brain/skills/
  fs_write.ts                 # UPDATED: Check policy
  memory_*.ts                 # UPDATED: Check policy

apps/site/src/components/
  ChatLayout.svelte           # UPDATED: Fetch and share policy
  TaskManager.svelte          # UPDATED: Use policy from context
```

---

## Benefits Summary

### Security
- ✅ Both mode AND role considered
- ✅ Single enforcement point (harder to bypass)
- ✅ Skills layer protected
- ✅ Configuration endpoints locked down

### Developer Experience
- ✅ Less boilerplate
- ✅ Clear, testable logic
- ✅ Hard to forget security checks
- ✅ Type-safe policy object

### Performance
- ✅ Request-scoped caching
- ✅ Optional in-memory mode cache
- ✅ Single load per request

### Maintainability
- ✅ Easy to add new permissions
- ✅ Easy to add new roles
- ✅ Policy logic separate from HTTP
- ✅ Reusable across contexts (HTTP, CLI, agents)

### Future-Proof
- ✅ Ready for authentication
- ✅ Ready for multi-tenancy
- ✅ Ready for fine-grained permissions
- ✅ Ready for audit/compliance features

---

## Next Steps

1. ✅ Implement `packages/core/src/security-policy.ts`
2. ✅ Create security middleware
3. ✅ Add `/api/security/policy` endpoint
4. ✅ Migrate existing protected endpoints
5. ✅ Update operator to use policy
6. ✅ Add skill-layer checks
7. ✅ Update UI components
8. ✅ Write tests
9. ✅ Test attack scenarios
10. 🔜 Add authentication (later phase)

---

**End of Architecture Document**
