# Coder Agent Playbook

This document provides the System Coder agent with design intent, maintenance tasks, and verification checklists. The **user guide** (`docs/user-guide/`) serves as the canonical source of truth for what features SHOULD exist and how they SHOULD work.

**Last Updated**: 2025-12-08
**Agent**: `brain/agents/system-coder.ts`
**Config**: `etc/system-coder.json`

---

## Table of Contents

1. [Mission & Core Principles](#mission--core-principles)
2. [Source of Truth: User Guide](#source-of-truth-user-guide)
3. [Feature Registry](#feature-registry)
4. [Maintenance Tasks](#maintenance-tasks)
5. [Technical Debt Registry](#technical-debt-registry)
6. [Verification Checklists](#verification-checklists)
7. [Refactoring Opportunities](#refactoring-opportunities)
8. [Code Patterns & Anti-Patterns](#code-patterns--anti-patterns)

---

## Mission & Core Principles

### Agent Mission

The System Coder agent exists to:
1. **Maintain code health** - Fix errors, reduce technical debt, improve quality
2. **Keep documentation in sync** - Ensure user-guide accurately reflects implementation
3. **Complete unfinished features** - Identify and finish partially implemented functionality
4. **Remove bloat** - Delete dead code, legacy patterns, unused files
5. **Improve architecture** - Suggest and implement refactoring opportunities

### Core Principles

From `docs/user-guide/getting-started/01-overview.md`:

| Principle | Meaning for Coder Agent |
|-----------|------------------------|
| **Local-first** | Never add cloud dependencies; all processing on user's machine |
| **Transparent & Auditable** | All changes must be logged; no silent modifications |
| **Modular & Extensible** | Keep components decoupled; prefer composition over inheritance |
| **Persona-Driven** | Respect persona files as source of truth for personality |
| **Schema-Based Memory** | Keep JSON human-readable and machine-processable |

### Design Philosophy

1. **Simplicity over complexity** - Avoid over-engineering; minimum code for the task
2. **Explicit over implicit** - Clear function signatures, typed interfaces
3. **Fail gracefully** - Handle errors with fallbacks, not crashes
4. **User approval required** - All significant changes need human review

---

## Source of Truth: User Guide

The user guide (`docs/user-guide/`) defines what the system SHOULD do. When there's a discrepancy between docs and code:
- If the code is correct → Update the documentation
- If the docs are correct → Fix the code
- If unclear → Flag for human review

### Key Documentation Files

| User Guide Section | Implementation Location | Verification Notes |
|--------------------|------------------------|-------------------|
| `01-overview.md` | Project-wide | Core vision |
| `04-core-concepts.md` | `packages/core/src/` | Identity, Memory, Agents |
| `05-user-interface.md` | `apps/site/src/components/` | UI layout and features |
| `06-cli-reference.md` | `packages/cli/src/commands/` | CLI commands |
| `07-memory-system.md` | `packages/core/src/memory.ts` | Memory operations |
| `08-autonomous-agents.md` | `brain/agents/` | All agent implementations |
| `09-skills-system.md` | `brain/skills/`, `packages/core/src/skills.ts` | Skill registry |
| `24-agency-system.md` | `packages/core/src/agency/` | Desire system |
| `23-voice-system.md` | TTS providers, `packages/core/src/tts.ts` | Voice features |
| `25-persona-generation.md` | `packages/core/src/persona/` | Persona tools |
| `14-configuration-files.md` | `etc/*.json` | All config files |

### Documentation Sync Tasks

When running maintenance, verify:

```
FOR each section in user-guide/index.md:
  1. Does the documented feature exist in code?
  2. Does the API/CLI match what's documented?
  3. Are all config options documented?
  4. Are examples accurate and runnable?
```

---

## Feature Registry

### Fully Implemented (Verify docs match)

| Feature | User Guide | Implementation | Status |
|---------|-----------|----------------|--------|
| Memory System | `07-memory-system.md` | `packages/core/src/memory.ts` | ✅ Verify |
| Episodic Storage | `07-memory-system.md` | `profiles/*/memory/episodic/` | ✅ Verify |
| Task Management | `06-cli-reference.md` | `packages/core/src/memory.ts` | ✅ Verify |
| Organizer Agent | `08-autonomous-agents.md` | `brain/agents/organizer.ts` | ✅ Verify |
| Reflector Agent | `08-autonomous-agents.md` | `brain/agents/reflector.ts` | ✅ Verify |
| Dreamer Agent | `08-autonomous-agents.md` | `brain/agents/dreamer.ts` | ✅ Verify |
| Curiosity Service | `08-autonomous-agents.md` | `brain/agents/curiosity-service.ts` | ✅ Verify |
| Inner Curiosity | `08-autonomous-agents.md` | `brain/agents/inner-curiosity.ts` | ✅ Verify |
| Cognitive Modes | `04b-cognitive-modes.md` | `packages/core/src/cognitive-mode.ts` | ✅ Verify |
| Agency System | `24-agency-system.md` | `packages/core/src/agency/` | ✅ Verify |
| Persona Generator | `25-persona-generation.md` | `packages/core/src/persona/` | ✅ Verify |
| Authentication | `17-authentication-setup.md` | `packages/core/src/users.ts` | ✅ Verify |
| Audit System | `10-security-trust.md` | `packages/core/src/audit.ts` | ✅ Verify |
| Web UI 3-Column | `05-user-interface.md` | `apps/site/src/components/ChatLayout.svelte` | ✅ Verify |
| Node Editor | `28-node-based-cognitive-system.md` | `apps/site/src/components/NodeEditorLayout.svelte` | ✅ Verify |
| System Coder | `29-system-coder.md` | `brain/agents/system-coder.ts` | ✅ New |

### Partially Implemented (Needs completion)

| Feature | User Guide | Status | Missing |
|---------|-----------|--------|---------|
| Skills System | `09-skills-system.md` | 🔶 Partial | Limited skills implemented |
| Voice Training | `23-voice-system.md` | 🔶 Partial | RVC/SoVITS integration varies |
| Semantic Memory | `07-memory-system.md` | 🔶 Partial | Basic vector search only |
| Procedural Memory | `07-memory-system.md` | 🔶 Partial | Not fully implemented |
| Trust Levels | `10-security-trust.md` | 🔶 Partial | Limited to cognitive modes |
| LoRA Training | `11-special-features.md` | 🔶 Partial | Dual-adapter system works |

### Documented but Not Implemented

| Feature | User Guide | Priority | Notes |
|---------|-----------|----------|-------|
| Kill Switch | `18-special-states.md` | High | Safety feature |
| Undo Buffer | `10-security-trust.md` | Medium | Rollback capability |
| Rate Limits | `10-security-trust.md` | Low | Action throttling |
| Dry-Run Mode | `10-security-trust.md` | Medium | Preview changes |

### Implemented but Not Documented

| Feature | Implementation | Action |
|---------|---------------|--------|
| Drift Monitor | `brain/agents/drift-monitor.ts` | Add to user guide |
| Psychoanalyzer | `brain/agents/psychoanalyzer.ts` | Verify docs complete |
| Mobile Build | `apps/mobile/` | Add deployment guide |

### Recently Documented

| Feature | Implementation | Documentation |
|---------|---------------|---------------|
| System Coder | `brain/agents/system-coder.ts` | `user-guide/advanced-features/29-system-coder.md` |

---

## Maintenance Tasks

### Daily Tasks (Automated)

1. **Error Processing**
   - Process captured errors from web console
   - Generate fix proposals for new errors
   - Update error status based on resolutions

2. **Health Check**
   - Verify core services running
   - Check for stale lock files
   - Monitor disk space for logs/memories

### Weekly Tasks (On-Demand)

1. **Documentation Sync**
   ```
   Task: Verify user-guide/06-cli-reference.md
   Method: Parse CLI help output, compare to documented commands
   Action: Flag discrepancies for human review
   ```

2. **Dead Code Detection**
   ```
   Task: Find unused exports in packages/core/src/
   Method: Static analysis of import/export graph
   Action: Flag candidates for removal
   ```

3. **Type Coverage Check**
   ```
   Task: Run tsc --noEmit across workspace
   Method: pnpm exec tsc --noEmit
   Action: Capture and categorize type errors
   ```

### Monthly Tasks (Scheduled)

1. **Architecture Review**
   - Check for circular dependencies
   - Identify overly complex components (>500 lines)
   - Review API endpoint patterns

2. **Security Audit**
   - Check for hardcoded secrets
   - Review authentication patterns
   - Audit file permission handling

3. **Performance Review**
   - Identify slow API endpoints
   - Check for memory leaks in long-running agents
   - Review bundle size

---

## Technical Debt Registry

### High Priority

| Issue | Location | Impact | Suggested Fix |
|-------|----------|--------|---------------|
| API endpoints in pages/api | `apps/site/src/pages/api/` | Mobile build issues | Migrate to unified API layer |
| withUserContext wrapper | Various API files | Code complexity | Complete migration to explicit auth |
| Stale lock files | `logs/run/locks/` | Agent startup failures | Add automatic cleanup |

### Medium Priority

| Issue | Location | Impact | Suggested Fix |
|-------|----------|--------|---------------|
| Large component files | `CenterContent.svelte` (2000+ lines) | Maintainability | Split into sub-components |
| Duplicate type definitions | Various | Inconsistency | Consolidate in packages/core |
| Console.log statements | Throughout codebase | Noise in production | Replace with audit() calls |

### Low Priority

| Issue | Location | Impact | Suggested Fix |
|-------|----------|--------|---------------|
| Inconsistent error handling | Various | UX issues | Standardize error responses |
| Missing JSDoc comments | packages/core/src/ | Developer experience | Add documentation |
| Test coverage gaps | All packages | Reliability | Add unit tests |

---

## Verification Checklists

### Pre-Fix Checklist

Before proposing a fix:

- [ ] Read the relevant user-guide section
- [ ] Understand the design intent
- [ ] Check for related code in other files
- [ ] Verify the fix doesn't break existing tests
- [ ] Consider edge cases and error handling

### Documentation Sync Checklist

When verifying docs match code:

- [ ] CLI commands in `06-cli-reference.md` exist in `packages/cli/`
- [ ] Config options in `14-configuration-files.md` match actual JSON schemas
- [ ] UI features in `05-user-interface.md` exist in components
- [ ] Agent descriptions in `08-autonomous-agents.md` match implementations
- [ ] API endpoints documented match actual routes

### Code Quality Checklist

When reviewing code:

- [ ] TypeScript types are explicit (no `any` without reason)
- [ ] Functions have single responsibility
- [ ] Error handling uses try/catch with typed errors
- [ ] Async operations handle failures gracefully
- [ ] No hardcoded paths (use `getProfilePaths()`, `systemPaths`)
- [ ] All mutations are audited

---

## Refactoring Opportunities

### Architectural Improvements

| Area | Current State | Proposed State | Effort |
|------|--------------|----------------|--------|
| API Layer | 150+ endpoint files | Unified handler system | Large |
| Component Size | Giant Svelte files | Smaller, focused components | Medium |
| Type Sharing | Duplicated interfaces | Single source in core | Medium |
| Config Loading | Per-file loading | Centralized config service | Small |

### Code Consolidation

| Pattern | Instances | Consolidation Target |
|---------|-----------|---------------------|
| `apiFetch()` calls | 50+ components | Create typed API client |
| Error response format | Inconsistent | Standardize `{ success, data?, error? }` |
| Audit logging | Manual in each file | Decorator/middleware pattern |
| Path resolution | Mixed approaches | Always use core path helpers |

### Legacy Code Candidates

Files/patterns that may need modernization:

- `apps/site/src/pages/api/*.ts` → Consider unified API approach
- Inline styles in old components → Use Tailwind or component styles
- `require()` statements → Convert to ESM imports
- Callback-based APIs → Convert to async/await

---

## Code Patterns & Anti-Patterns

### Preferred Patterns

```typescript
// ✅ Explicit authentication
const user = getAuthenticatedUser(cookies);
const paths = getProfilePaths(user.username);

// ✅ Typed API responses
return new Response(JSON.stringify({ success: true, data }), {
  status: 200,
  headers: { 'Content-Type': 'application/json' }
});

// ✅ Proper error handling with audit
try {
  await operation();
} catch (error) {
  audit({ level: 'error', category: 'action', event: 'operation_failed', ... });
  return new Response(JSON.stringify({ success: false, error: message }), { status: 500 });
}

// ✅ Path resolution
const configPath = path.join(systemPaths.etc, 'config.json');
const userPath = path.join(getProfilePaths(username).state, 'data.json');
```

### Anti-Patterns to Fix

```typescript
// ❌ Hardcoded paths
const path = '/home/greggles/metahuman/etc/config.json';

// ❌ Untyped responses
return new Response(JSON.stringify(data)); // Missing content-type, status

// ❌ Silent failures
try { await operation(); } catch {} // Swallowing errors

// ❌ Using `any` type
function process(data: any) { ... } // Loses type safety

// ❌ Implicit authentication
const user = getUserOrAnonymous(cookies); // Use getAuthenticatedUser for protected ops
```

---

## Agent Configuration

The System Coder agent reads its configuration from `etc/system-coder.json`:

```json
{
  "maintenance": {
    "checks": [
      "type_errors",           // Run tsc --noEmit
      "unused_exports",        // Find dead code
      "documentation_drift",   // Compare docs to code
      "deprecated_apis",       // Find deprecated usage
      "security_vulnerabilities" // Basic security scan
    ]
  }
}
```

### Adding New Maintenance Checks

1. Add check name to `etc/system-coder.json` → `maintenance.checks[]`
2. Implement check in `brain/agents/system-coder.ts` → `runMaintenance()`
3. Document the check in this playbook
4. Add to verification checklists above

---

## Change Log

### 2025-12-08
- Initial playbook created
- Feature registry populated
- Technical debt registry started
- Verification checklists defined

---

*This playbook is maintained by the System Coder agent and should be updated whenever significant features are added, removed, or modified.*
