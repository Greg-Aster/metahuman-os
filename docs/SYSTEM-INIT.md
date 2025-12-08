# SYSTEM-INIT.md - MetaHuman OS Technical Architecture

This document serves as the comprehensive technical reference for the MetaHuman OS codebase.
It is used by the System Coder agent to understand the architecture when generating fixes.

**Last Updated**: 2025-12-08
**Auto-Generated Sections**: Directory structure, package exports, API endpoints

### Related Documents

| Document | Purpose |
|----------|---------|
| **[CODER-AGENT-PLAYBOOK.md](CODER-AGENT-PLAYBOOK.md)** | Design intent, maintenance tasks, feature registry |
| **[user-guide/index.md](user-guide/index.md)** | Source of truth for feature specifications |
| **[CLAUDE.md](../CLAUDE.md)** | Codebase conventions for AI assistants |
| **[technical/ARCHITECTURE.md](technical/ARCHITECTURE.md)** | Detailed architecture documentation |
| **[technical/ROADMAP.md](technical/ROADMAP.md)** | Development roadmap and phases |

---

## Table of Contents

1. [System Architecture](#system-architecture)
2. [Directory Structure](#directory-structure)
3. [Core Packages](#core-packages)
4. [Key Subsystems](#key-subsystems)
5. [Code Conventions](#code-conventions)
6. [API Endpoints](#api-endpoints)
7. [Common Issues & Solutions](#common-issues--solutions)
8. [Error Patterns](#error-patterns)
9. [Debug Strategies](#debug-strategies)

---

## System Architecture

### Overview

MetaHuman OS is an autonomous digital personality extension operating system. It runs on:
- **Backend**: Node.js 18+ with TypeScript
- **Frontend**: Astro + Svelte
- **LLM**: Ollama (local) or vLLM (GPU inference)
- **Storage**: File-based JSON with profile directories

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                      Web UI (Astro + Svelte)                │
│  ┌──────────┐  ┌──────────────┐  ┌────────────────────┐    │
│  │ ChatLayout│  │CenterContent │  │  LeftSidebar       │    │
│  └──────────┘  └──────────────┘  └────────────────────┘    │
├─────────────────────────────────────────────────────────────┤
│                    API Layer (Astro Endpoints)              │
│  /api/auth/*  /api/chat/*  /api/system-coder/*  ...        │
├─────────────────────────────────────────────────────────────┤
│                    Core Library (@metahuman/core)           │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌──────────┐ │
│  │ Memory │ │Identity│ │  LLM   │ │ Audit  │ │ Operator │ │
│  └────────┘ └────────┘ └────────┘ └────────┘ └──────────┘ │
├─────────────────────────────────────────────────────────────┤
│                    Agent Layer (brain/agents/)              │
│  ┌────────────┐ ┌───────────┐ ┌────────────────┐           │
│  │  Reflector │ │  Dreamer  │ │ System Coder   │           │
│  └────────────┘ └───────────┘ └────────────────┘           │
├─────────────────────────────────────────────────────────────┤
│                    Storage Layer                            │
│  profiles/{user}/persona/  profiles/{user}/memory/  etc/   │
└─────────────────────────────────────────────────────────────┘
```

### Request Flow

1. User sends message in ChatInterface.svelte
2. Frontend calls `/api/persona_chat` endpoint
3. API resolves user from session cookie
4. Operator system processes message (if enabled)
5. LLM generates response via model router
6. Memory is captured with cognitive mode metadata
7. Response streams back to frontend

---

## Directory Structure

```
metahuman/
├── apps/
│   ├── site/                    # Astro web application
│   │   ├── src/
│   │   │   ├── components/      # Svelte components
│   │   │   ├── lib/             # Client & server utilities
│   │   │   │   ├── client/      # Browser-side code
│   │   │   │   └── server/      # Node-side code
│   │   │   ├── pages/           # Astro pages & API routes
│   │   │   │   └── api/         # REST API endpoints
│   │   │   └── stores/          # Svelte stores
│   │   ├── astro.config.mjs     # Server build config
│   │   └── astro.config.mobile.mjs # Mobile build config
│   └── mobile/                  # Capacitor mobile app
│       ├── android/             # Native Android project
│       ├── www/                 # Static build output
│       └── scripts/             # Build scripts
│
├── brain/
│   ├── agents/                  # Autonomous background agents
│   │   ├── reflector.ts         # Memory reflection
│   │   ├── dreamer.ts           # Dream generation
│   │   ├── system-coder.ts      # Code maintenance
│   │   └── ...
│   └── skills/                  # Operator skills
│
├── packages/
│   ├── core/                    # @metahuman/core library
│   │   └── src/
│   │       ├── agency/          # Desire system
│   │       ├── api/             # Unified API handlers
│   │       ├── system-coder/    # Error capture
│   │       ├── audit.ts         # Audit logging
│   │       ├── big-brother.ts   # Claude CLI escalation
│   │       ├── cognitive-mode.ts
│   │       ├── config.ts        # Configuration types
│   │       ├── identity.ts      # Persona management
│   │       ├── llm.ts           # LLM adapter
│   │       ├── locks.ts         # Process locks
│   │       ├── memory.ts        # Memory operations
│   │       ├── model-router.ts  # Model selection
│   │       ├── users.ts         # User management
│   │       └── index.ts         # Public exports
│   └── cli/                     # CLI package
│
├── profiles/                    # User data (gitignored)
│   └── {username}/
│       ├── persona/             # Identity files
│       │   ├── core.json        # Personality
│       │   └── desires/         # Agency desires
│       ├── memory/
│       │   ├── episodic/        # Event memories
│       │   ├── tasks/           # Task lists
│       │   └── index/           # Vector embeddings
│       ├── etc/                 # Profile config
│       ├── state/               # Runtime state
│       │   └── system-coder/    # Error capture state
│       └── out/                 # Generated outputs
│
├── etc/                         # System configuration
│   ├── agents.json              # Agent scheduler config
│   ├── operator.json            # Operator config
│   ├── system-coder.json        # System Coder config
│   ├── cognitive-layers.json    # Pipeline config
│   └── models.json              # Model registry
│
├── logs/
│   ├── audit/                   # Audit trail (YYYY-MM-DD.ndjson)
│   └── run/
│       ├── agents/              # Agent PID files
│       └── locks/               # Process lock files
│
└── docs/                        # Documentation
    ├── user-guide/              # User documentation
    └── SYSTEM-INIT.md           # This file
```

---

## Core Packages

### @metahuman/core

The central library used by all components.

#### Key Exports

```typescript
// User & Authentication
export { getAuthenticatedUser, getUserOrAnonymous, listUsers, withUserContext }

// Path Resolution
export { getProfilePaths, systemPaths, ROOT }

// Memory System
export { captureEvent, searchMemory, listActiveTasks, createTask, updateTaskStatus }

// LLM & Models
export { llm, callLLM, callLLMText, resolveModel }

// Audit & Logging
export { audit, initGlobalLogger }

// Locks
export { acquireLock, releaseLock, isLocked }

// System Coder
export { captureError, listErrors, getError, updateErrorStatus, getErrorStats }

// Agency
export { loadDesire, saveDesire, listDesires, updateDesireStatus }
```

#### Profile Paths

```typescript
import { getProfilePaths, systemPaths } from '@metahuman/core';

// System-wide paths
systemPaths.root          // /home/greggles/metahuman
systemPaths.brain         // brain/
systemPaths.agents        // brain/agents/
systemPaths.etc           // etc/

// User-specific paths
const p = getProfilePaths('username');
p.root                    // profiles/username/
p.persona                 // profiles/username/persona/
p.personaCore             // profiles/username/persona/core.json
p.episodic                // profiles/username/memory/episodic/
p.state                   // profiles/username/state/
p.etc                     // profiles/username/etc/
```

---

## Key Subsystems

### Memory System

Memories are stored as JSON files in `profiles/{user}/memory/episodic/YYYY/`.

```typescript
interface EpisodicMemory {
  id: string;
  type: 'conversation' | 'observation' | 'inner_dialogue' | 'dream';
  timestamp: string;
  content: string;
  metadata: {
    cognitiveMode?: 'dual' | 'agent' | 'emulation';
    processed?: boolean;
    tags?: string[];
    entities?: Array<{ text: string; type: string }>;
  };
}
```

### Operator System (ReAct)

The operator uses a ReAct loop with skills:

1. **Plan**: Analyze goal, determine next action
2. **Act**: Execute skill (e.g., `memory_search`, `task_create`)
3. **Observe**: Record result
4. **Repeat** or **Respond**

Configuration: `etc/operator.json`

### Big Brother Mode

Escalates stuck operator states to Claude CLI for guidance.

```typescript
import { escalateToBigBrother } from '@metahuman/core';

const response = await escalateToBigBrother({
  goal: 'Fix the database connection error',
  stuckReason: 'Connection timeout after 3 retries',
  errorType: 'repeated_failures',
  scratchpad: [...],
  context: { ... },
  suggestions: ['Check network', 'Verify credentials']
}, operatorConfig);
```

### System Coder

Autonomous error capture and fix generation:

1. **Capture**: Web errors → `/api/system-coder/capture-error`
2. **Store**: Errors saved to `state/system-coder/errors/`
3. **Process**: Agent generates fix via Big Brother
4. **Review**: User approves/rejects in UI
5. **Apply**: Approved fixes applied to codebase

---

## Code Conventions

### TypeScript Patterns

```typescript
// Use explicit return types
function processError(id: string): Promise<boolean> { ... }

// Use interfaces over types for extensibility
interface ErrorContext {
  file?: string;
  line?: number;
}

// Use const assertions for literal types
const AGENT_NAME = 'system-coder' as const;
```

### API Endpoint Pattern

```typescript
// apps/site/src/pages/api/example.ts
import type { APIRoute } from 'astro';
import { getAuthenticatedUser, getProfilePaths, audit } from '@metahuman/core';

export const GET: APIRoute = async ({ cookies }) => {
  const user = getAuthenticatedUser(cookies); // Throws 401 if not auth'd
  const paths = getProfilePaths(user.username);

  // ... implementation

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
};
```

### Svelte Component Pattern

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { apiFetch } from '../lib/client/api-config';

  let data: SomeType[] = [];
  let loading = true;
  let error: string | null = null;

  onMount(async () => {
    try {
      const res = await apiFetch('/api/endpoint');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  });
</script>

{#if loading}
  <div class="loading">Loading...</div>
{:else if error}
  <div class="error">{error}</div>
{:else}
  <!-- content -->
{/if}
```

### Error Handling

```typescript
// Always use typed errors
try {
  await operation();
} catch (error) {
  const message = (error as Error).message;
  audit({
    level: 'error',
    category: 'action',
    event: 'operation_failed',
    details: { error: message },
    actor: 'component-name'
  });
}
```

---

## API Endpoints

### Authentication
- `GET /api/auth/me` - Current user info
- `POST /api/auth/login` - Login
- `POST /api/auth/logout` - Logout

### Chat
- `POST /api/persona_chat` - Send message to persona
- `GET /api/chat/history` - Get conversation history

### System Coder
- `POST /api/system-coder/capture-error` - Capture an error
- `GET /api/system-coder/errors` - List captured errors
- `GET /api/system-coder/status` - Get health status
- `POST /api/system-coder/errors/{id}/ignore` - Mark error ignored
- `POST /api/system-coder/errors/{id}/fix` - Request fix generation

### Memory
- `GET /api/memories_all` - List all memories
- `GET /api/memory-content` - Get memory content
- `POST /api/memories/validate` - Validate memory

### System
- `GET /api/status` - System status
- `GET /api/cognitive-mode` - Current cognitive mode
- `POST /api/cognitive-mode` - Change mode

---

## Common Issues & Solutions

### "Another instance is already running"

**Cause**: Stale lock file in `logs/run/locks/`

**Solution**:
```bash
# Check if process is actually running
ps -p $(cat logs/run/locks/agent-name.lock | jq -r '.pid')

# If not running, remove lock
rm logs/run/locks/agent-name.lock
```

### "Failed to connect to Ollama"

**Cause**: Ollama service not running

**Solution**:
```bash
# Start Ollama
ollama serve

# Verify
./bin/mh ollama status
```

### "User not authenticated"

**Cause**: Session cookie missing or expired

**Solution**:
- Clear cookies and re-login
- For development, use `pnpm tsx scripts/dev-session.ts --username=user`

### Build errors after changing cognitive-layers.json

**Cause**: JSON syntax error or missing required fields

**Solution**:
```bash
# Validate JSON
npx jsonlint etc/cognitive-layers.json

# Check for required fields: layers[].id, layers[].name
```

---

## Error Patterns

### Common Error Messages

| Error | Likely Cause | Fix Location |
|-------|--------------|--------------|
| `ENOENT: no such file or directory` | Missing profile directory | Check `getProfilePaths()` usage |
| `Cannot read properties of undefined` | Null reference | Add null checks |
| `401 Unauthorized` | Missing auth | Use `getAuthenticatedUser()` |
| `500 Internal Server Error` | Server-side exception | Check API endpoint logs |

### Stack Trace Analysis

```
at processError (/home/greggles/metahuman/packages/core/src/system-coder/error-capture.ts:45:10)
   ↑ function name      ↑ file path                                                      ↑ line:col
```

Key files to check based on stack:
- `packages/core/src/*.ts` - Core logic errors
- `apps/site/src/pages/api/*.ts` - API endpoint errors
- `apps/site/src/components/*.svelte` - UI component errors
- `brain/agents/*.ts` - Agent execution errors

---

## Debug Strategies

### Enable Verbose Logging

```bash
# Set debug environment
DEBUG=* pnpm dev

# Or for specific component
DEBUG=metahuman:audit pnpm dev
```

### Check Audit Logs

```bash
# View today's audit log
tail -f logs/audit/$(date +%Y-%m-%d).ndjson | jq .

# Filter by category
cat logs/audit/*.ndjson | jq 'select(.category == "error")'
```

### Test API Endpoints

```bash
# With authentication
curl -H "Cookie: mh_session=YOUR_SESSION_ID" http://localhost:4321/api/status

# Check system coder status
curl http://localhost:4321/api/system-coder/status
```

### Verify Agent Execution

```bash
# Run agent manually
./bin/mh agent run system-coder

# Check for running agents
./bin/mh agent ps

# View agent stats
./bin/mh agent status
```

---

## Changelog

### 2025-12-08
- Initial SYSTEM-INIT.md created
- Added System Coder agent documentation
- Documented error capture flow

---

*This document is maintained by the System Coder agent and should be updated when significant architectural changes occur.*
