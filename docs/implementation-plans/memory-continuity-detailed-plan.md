# Memory Continuity Implementation Plan - Detailed Technical Specification

**Document Version:** 1.0
**Date:** 2025-11-06
**Status:** Approved for Implementation
**Estimated Timeline:** 2-3 weeks

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Phase 1: Event Capture](#phase-1-event-capture)
3. [Phase 2: Prompt Assembly](#phase-2-prompt-assembly)
4. [Phase 3: Conversation Summaries](#phase-3-conversation-summaries)
5. [Phase 4: Profile & Role Awareness](#phase-4-profile--role-awareness)
6. [Phase 5: Observability & Testing](#phase-5-observability--testing)
7. [Testing Strategy](#testing-strategy)
8. [Rollout Plan](#rollout-plan)
9. [Appendix: Code Examples](#appendix-code-examples)

---

## Architecture Overview

### Current System State

**Strengths:**
- ✅ Vector index with incremental appends (`appendEventToIndex()`)
- ✅ Multi-user isolation via `withUserContext` middleware
- ✅ Semantic memory retrieval via `buildContextPackage()`
- ✅ Comprehensive audit logging to `logs/audit/YYYY-MM-DD.ndjson`
- ✅ Chat history reconstruction from episodic + audit sources

**Gaps:**
- ❌ Tool invocations not captured as memories
- ❌ File operations not captured as memories
- ❌ Code approvals not captured as memories
- ❌ No tool output integration in prompts
- ❌ No persistent chat buffer (in-memory only)
- ❌ No conversation summarization
- ❌ No role-based context depth
- ❌ No memory coverage metrics

### Target Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      User Interaction                        │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│                   Event Capture Layer                        │
│  (Tool invocations, file ops, code approvals, chat)        │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│               Episodic Memory Storage                        │
│  profiles/<user>/memory/episodic/YYYY/*.json                │
│  + metadata: {conversationId, toolName, inputs, outputs}    │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│              Vector Index Auto-Update                        │
│  profiles/<user>/memory/index/embeddings-*.json             │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│              Context Package Builder                         │
│  - Semantic search (memories)                                │
│  - Recent tool invocations (last 5-10)                      │
│  - Conversation summary (if available)                       │
│  - Persona + values + goals                                  │
│  - Role-based depth (owner: deep, guest: shallow)           │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│                  Prompt Assembly                             │
│  System | Persona | Memory | Tools | Summary | Messages     │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│                    LLM Response                              │
└─────────────────────────────────────────────────────────────┘
```

### Mode-Aware Policy Hooks

All capture, retrieval, and summarization must respect the active cognitive mode. Introduce a central helper module (e.g., `packages/core/src/memory-policy.ts`) that exposes:

| Helper | Description | Used By |
|--------|-------------|---------|
| `canWriteMemory(mode, eventType)` | Returns true only if the current mode allows persisting the event (`dual=full`, `agent=command_only`, `emulation=read_only`). | `captureEvent`, tool/file logging helpers |
| `contextDepth(mode, role)` | Provides max retrieval counts (e.g., owner/dual=12, agent=3, guest/emulation=2). | `/api/persona_chat`, `/api/chat/history` |
| `shouldCaptureTool(mode)` | Determines when tool invocations should be logged (skip in emulation). | Tool capture tasks |
| `conversationVisibility(role)` | Controls which summaries/history slices can be returned to the UI depending on role. | `/api/chat/history`, guest UI |

> **Requirement:** Phase 1–4 tasks must call these helpers rather than inlining mode checks. This keeps behavior consistent as new modes are introduced.

**Module Skeleton (`packages/core/src/memory-policy.ts`):**

```typescript
import { getCognitiveModeConfig } from './cognitive-mode.js';

type EventType = 'conversation' | 'tool_invocation' | 'file_read' | 'file_write' | 'code_approval' | 'code_rejection' | 'summary';

export function canWriteMemory(mode: CognitiveModeId, eventType: EventType): boolean {
  const config = getCognitiveModeConfig(mode);
  if (config.memoryWriteLevel === 'read_only') return false;
  if (config.memoryWriteLevel === 'command_only') {
    return eventType === 'tool_invocation'
      || eventType === 'code_approval'
      || eventType === 'code_rejection'
      || eventType === 'summary';
  }
  return true;
}

export function shouldCaptureTool(mode: CognitiveModeId, toolName: string): boolean {
  const config = getCognitiveModeConfig(mode);
  if (config.memoryWriteLevel === 'read_only') return false;
  if (config.memoryWriteLevel === 'command_only') {
    return toolName !== 'conversational_response';
  }
  return true;
}

export function contextDepth(mode: CognitiveModeId, role: UserRole = 'owner'): number {
  const config = getCognitiveModeConfig(mode);
  if (role === 'guest') return 2;
  if (config.id === 'dual') return 12;
  if (config.id === 'agent') return 6;
  return 3; // emulation fallback
}
```

All API routes and agents referenced below should import these helpers instead of duplicating logic. Future roles (e.g., collaborator) can then be added centrally without re-touching downstream code.

---

## Phase 1: Event Capture

**Goal:** Capture every meaningful action (tool invocations, file operations, code approvals) as episodic memories with structured metadata.

> **Policy Enforcement:** Every capture call in this phase must first consult `canWriteMemory(mode, eventType)` and `shouldCaptureTool(mode)`. This guarantees that agent mode only records action results and emulation mode stays read-only.

### Task 1.1: Instrument Tool Invocations

**File:** `apps/site/src/pages/api/operator/react.ts`

**Current State:**
- Tool execution via `executeSkill()` at line ~150
- Results returned to operator pipeline
- No memory capture

**Required Changes:**

1. **Mode-aware gate:** Import `canWriteMemory` and `shouldCaptureTool` from `@metahuman/core/memory-policy`. Wrap every `captureEvent()` call with:

```typescript
if (!shouldCaptureTool(cognitiveMode) || !canWriteMemory(cognitiveMode, 'tool_invocation')) {
  return result;
}
```

This keeps agent mode selective and emulation mode read-only without duplicating logic.

1. **Add conversation session ID tracking:**

```typescript
// At the top of the file, add session tracking
import { captureEvent } from '@metahuman/core';

// Generate or retrieve session ID (store in headers or server-side state)
function getConversationSessionId(context: APIContext): string {
  const sessionId = context.locals.conversationSessionId;
  if (!sessionId) {
    const newSessionId = `conv-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    context.locals.conversationSessionId = newSessionId;
    return newSessionId;
  }
  return sessionId;
}
```

2. **Capture tool invocation after execution:**

```typescript
// After skill execution (around line 180-200)
try {
  const result = await executeSkill(skillId, inputs, {
    requireApproval: needsApproval,
    actor: 'operator',
    metadata: { mode: cognitiveMode }
  });

  // NEW: Capture tool invocation event
  const sessionId = getConversationSessionId(context);
  const toolEventId = captureEvent(
    `Tool executed: ${skillId}`,
    {
      type: 'tool_invocation',
      tags: ['tool', skillId, 'operator', cognitiveMode],
      entities: [skillId],
      importance: result.success ? 0.6 : 0.8, // Failures more important
      metadata: {
        conversationId: sessionId,
        parentEventId: userMessageEventId, // Link to triggering message
        toolName: skillId,
        toolInputs: inputs,
        toolOutputs: result.outputs,
        cognitiveMode,
        success: result.success,
        error: result.error || null,
        executionTimeMs: result.metadata?.executionTime
      }
    }
  );

  // Continue with existing logic...
  return new Response(JSON.stringify({
    success: true,
    outputs: result.outputs,
    toolEventId // NEW: Return event ID for linking
  }));
} catch (error) {
  // Also capture failed tool invocations
  captureEvent(
    `Tool failed: ${skillId} - ${(error as Error).message}`,
    {
      type: 'tool_invocation',
      tags: ['tool', skillId, 'operator', 'error'],
      entities: [skillId],
      importance: 0.9, // High importance for errors
      metadata: {
        conversationId: getConversationSessionId(context),
        toolName: skillId,
        toolInputs: inputs,
        success: false,
        error: (error as Error).message,
        stack: (error as Error).stack
      }
    }
  );
  throw error;
}
```

**Testing:**
- Execute a search query via operator → verify `tool_invocation` event created
- Check memory JSON has `metadata.toolName`, `metadata.toolInputs`, `metadata.toolOutputs`
- Verify vector index auto-updated (query for "search" should return event)

---

### Task 1.2: Instrument File Operations

**File:** `apps/site/src/pages/api/file_operations.ts`

**Current State:**
- File reads/writes via `fs_read` and `fs_write` skills
- Security policy restricts to `/out/` directory
- No memory capture

**Required Changes:**

1. **Mode-aware guard:** At the top of the module import `canWriteMemory` and skip capture blocks when the active mode forbids persistence:

```typescript
import { canWriteMemory } from '@metahuman/core/memory-policy';

if (!canWriteMemory(context.locals.cognitiveMode, 'file_read')) {
  return new Response(JSON.stringify(result));
}
```

Use `'file_write'` for write operations so emulation/guest sessions remain read-only.

```typescript
import { captureEvent } from '@metahuman/core';

// After successful file read (around line 140-150)
case 'read': {
  const result = await executeSkill('fs_read', { path: filePath });

  if (result.success) {
    // NEW: Capture file read event
    const content = result.outputs?.content || '';
    const snippet = content.substring(0, 300); // First 300 chars

    captureEvent(
      `Read file: ${filePath}`,
      {
        type: 'file_read',
        tags: ['file', 'read', path.extname(filePath).slice(1)],
        entities: [path.basename(filePath)],
        importance: 0.5,
        metadata: {
          filePath,
          fileSize: content.length,
          snippet,
          timestamp: new Date().toISOString()
        }
      }
    );
  }

  return new Response(JSON.stringify(result));
}

// After successful file write (around line 100-110)
case 'write':
case 'create': {
  const result = await executeSkill('fs_write', {
    path: filePath,
    content: data.content,
    overwrite: data.overwrite
  });

  if (result.success) {
    // NEW: Capture file write event
    const snippet = data.content.substring(0, 300);

    captureEvent(
      `Wrote file: ${filePath}`,
      {
        type: 'file_write',
        tags: ['file', 'write', path.extname(filePath).slice(1)],
        entities: [path.basename(filePath)],
        importance: 0.7, // Writes more important than reads
        metadata: {
          filePath,
          fileSize: data.content.length,
          snippet,
          overwrite: data.overwrite,
          timestamp: new Date().toISOString()
        }
      }
    );
  }

  return new Response(JSON.stringify(result));
}
```

**Testing:**
- Read a file via UI → verify `file_read` event with snippet
- Write a file via UI → verify `file_write` event with snippet
- Search for filename → verify event appears in results

---

### Task 1.3: Instrument Code Approvals

**File:** `apps/site/src/pages/api/approvals.ts`

**Current State:**
- Approvals via `approveSkillExecution()` / `rejectSkillExecution()`
- No memory capture

**Required Changes:**

1. **Policy gate:** Import `canWriteMemory` and return early when approvals are being fetched in emulation/guest contexts:

```typescript
import { canWriteMemory } from '@metahuman/core/memory-policy';

if (!canWriteMemory(context.locals.cognitiveMode, 'code_approval')) {
  return new Response(JSON.stringify(result));
}
```

Use `'code_rejection'` in the reject branch.

```typescript
import { captureEvent } from '@metahuman/core';

// After approval (around line 85-90)
case 'approve': {
  const result = await approveSkillExecution(approvalId);

  if (result.success) {
    const approval = result.approval;

    // NEW: Capture approval event
    captureEvent(
      `Approved: ${approval.skillId}`,
      {
        type: 'code_approval',
        tags: ['approval', approval.skillId, 'code'],
        entities: [approval.skillId],
        importance: 0.8,
        metadata: {
          approvalId,
          skillId: approval.skillId,
          skillInputs: approval.inputs,
          decision: 'approved',
          timestamp: new Date().toISOString()
        }
      }
    );
  }

  return new Response(JSON.stringify(result));
}

// After rejection (around line 92-97)
case 'reject': {
  const result = await rejectSkillExecution(approvalId);

  if (result.success) {
    const approval = result.approval;

    // NEW: Capture rejection event
    captureEvent(
      `Rejected: ${approval.skillId}`,
      {
        type: 'code_rejection',
        tags: ['rejection', approval.skillId, 'code'],
        entities: [approval.skillId],
        importance: 0.9, // Rejections high importance
        metadata: {
          approvalId,
          skillId: approval.skillId,
          skillInputs: approval.inputs,
          decision: 'rejected',
          timestamp: new Date().toISOString()
        }
      }
    );
  }

  return new Response(JSON.stringify(result));
}
```

**Testing:**
- Approve a code change → verify `code_approval` event
- Reject a code change → verify `code_rejection` event
- Query "approved code changes" → verify returns approval events

---

### Task 1.4: Add Conversation Session IDs

**Files:**
- `apps/site/src/components/ChatInterface.svelte`
- `apps/site/src/pages/api/persona_chat.ts`

**Current State:**
- No session tracking across messages
- Each message is independent

**Required Changes:**

**1. Client-side session generation (ChatInterface.svelte):**

```typescript
<script lang="ts">
  import { v4 as uuidv4 } from 'uuid'; // or use simpler ID generation

  // Add session ID state (around line 50)
  let conversationSessionId = $state<string>('');

  // Initialize session on mount (around line 300)
  $effect(() => {
    // Load existing session ID from localStorage or create new
    const storedSessionId = localStorage.getItem('mh_conversation_session_id');
    if (storedSessionId) {
      conversationSessionId = storedSessionId;
    } else {
      conversationSessionId = `conv-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem('mh_conversation_session_id', conversationSessionId);
    }
  });

  // Add session ID to API calls (around line 600)
  const response = await fetch('/api/persona_chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Conversation-Session-Id': conversationSessionId // NEW header
    },
    body: JSON.stringify({
      message: userMessage,
      mode: mode,
      sessionId: conversationSessionId // Also in body
    })
  });

  // Clear session ID button (add to UI)
  function startNewConversation() {
    const newSessionId = `conv-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    conversationSessionId = newSessionId;
    localStorage.setItem('mh_conversation_session_id', newSessionId);
    messages = []; // Clear messages
  }
</script>
```

**2. Server-side session tracking (persona_chat.ts):**

```typescript
// Extract session ID from request (around line 170)
const sessionId = request.headers.get('X-Conversation-Session-Id') ||
                  data.sessionId ||
                  `conv-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

// Store in locals for downstream use
context.locals.conversationSessionId = sessionId;

// Include in memory capture (around line 1261)
const userEventId = captureEvent(userMessage, {
  type: 'conversation',
  tags: ['chat', 'user', mode],
  importance: 0.6,
  metadata: {
    mode,
    cognitiveMode: mode,
    conversationId: sessionId, // NEW
    timestamp: new Date().toISOString()
  }
});

// Include in assistant response capture (around line 1266)
captureEvent(assistantResponse, {
  type: 'conversation',
  tags: ['chat', 'assistant', mode],
  importance: 0.6,
  response: userEventId,
  metadata: {
    mode,
    cognitiveMode: mode,
    conversationId: sessionId, // NEW
    parentEventId: userEventId, // Link to user message
    usedOperator: didUseOperator,
    timestamp: new Date().toISOString()
  }
});
```

**Testing:**
- Start chat → verify session ID in localStorage
- Send 3 messages → verify all have same `conversationId` in metadata
- Click "New Conversation" → verify new session ID generated
- Refresh page → verify session ID persists

---

### Task 1.5: Enhance captureEvent() Metadata Schema

**File:** `packages/core/src/memory.ts`

**Current State:**
- Generic `metadata?: Record<string, any>`
- No standard fields documented

**Required Changes:**

```typescript
// Add interface for standard metadata fields (around line 20)
export interface EpisodicEventMetadata {
  // Conversation tracking
  conversationId?: string;
  sessionId?: string;
  parentEventId?: string;

  // Tool invocation fields
  toolName?: string;
  toolInputs?: Record<string, any>;
  toolOutputs?: Record<string, any>;
  success?: boolean;
  error?: string;
  executionTimeMs?: number;

  // File operation fields
  filePath?: string;
  fileSize?: number;
  snippet?: string;
  overwrite?: boolean;

  // Code approval fields
  approvalId?: string;
  skillId?: string;
  skillInputs?: Record<string, any>;
  decision?: 'approved' | 'rejected';

  // Cognitive context
  cognitiveMode?: 'dual' | 'agent' | 'emulation';
  trustLevel?: string;
  facet?: string;

  // General
  timestamp?: string;
  [key: string]: any; // Allow additional fields
}

// Update EpisodicEvent interface (around line 35)
export interface EpisodicEvent {
  id: string;
  timestamp: string;
  content: string;
  type: 'observation' | 'conversation' | 'tool_invocation' | 'file_read' | 'file_write' | 'code_approval' | 'code_rejection' | 'dream' | 'reflection' | 'task';
  response?: string;
  entities?: string[];
  tags?: string[];
  importance?: number;
  links?: string[];
  userId?: string;
  metadata?: EpisodicEventMetadata; // NEW: Typed metadata
}
```

**Documentation:** Add JSDoc comments explaining each field.

**Testing:**
- TypeScript compilation should pass
- Existing code should continue working (backward compatible)

### Task 1.6: Queue Vector Index Writes

**Files:**
- `packages/core/src/vector-index-queue.ts` (NEW)
- `packages/core/src/memory.ts` (hook `captureEvent`)

**Problem:** Each new episodic file currently triggers `appendEventToIndex()` synchronously. When tools fire rapidly (search → read → write), the indexer thrashes disk and blocks the request thread.

**Solution:** Funnel all embedding writes through a bounded queue that batches events per user before flushing to disk.

```typescript
// packages/core/src/vector-index-queue.ts
import PQueue from 'p-queue';
import { appendEventToIndex } from './vector-index.js';
import { canWriteMemory } from './memory-policy.js';

const queues = new Map<string, PQueue>();

export function scheduleIndexUpdate(userId: string, mode: CognitiveModeId, event: EpisodicEvent) {
  if (!canWriteMemory(mode, event.type)) return;

  const queue = queues.get(userId) ?? new PQueue({ concurrency: 1, interval: 1000, intervalCap: 5 });
  queues.set(userId, queue);

  queue.add(async () => {
    await appendEventToIndex(event);
  });
}
```

Hook `captureEvent()` to call `scheduleIndexUpdate(userContext.userId, metadata.cognitiveMode ?? 'dual', event)` after the episodic file is persisted. This guarantees:
- **Batching:** Max 5 embedding writes per second per user
- **Mode awareness:** Emulation requests never enqueue writes, agent mode only queues allowed event types
- **Back-pressure:** Requests return immediately; indexing continues in background

Persist queue contents to `profiles/<user>/state/index-queue.json` before process exit (listen for `SIGTERM`) and reload on startup so long-running embeddings resume even after crashes.

**Testing:**
- Trigger 10 rapid file reads (dual mode) → verify embeddings are created but request latency stays flat
- Switch to emulation mode → confirm queue not invoked (log counter remains zero)
- Kill server mid-queue → restart → ensure queue resumes pending work (persist backlog to `profiles/<user>/state/index-queue.json`)

---

## Phase 2: Prompt Assembly

**Goal:** Integrate tool outputs and conversation history into LLM prompts for better context awareness.

### Task 2.1: Extend ContextPackage Interface

**File:** `packages/core/src/context-builder.ts`

**Required Changes:**

```typescript
// Add ToolInvocation interface (around line 20)
export interface ToolInvocation {
  id: string;
  toolName: string;
  timestamp: string;
  inputs: Record<string, any>;
  outputs: Record<string, any>;
  success: boolean;
  error?: string;
  executionTimeMs?: number;
}

// Extend ContextPackage interface (around line 80)
export interface ContextPackage {
  memories: RelevantMemory[];
  persona: PersonaSummary;
  currentFocus?: string;
  activeTasks: string[];
  recentTopics: string[];
  patterns: DetectedPattern[];
  mode: CognitiveModeId;
  indexStatus: 'available' | 'missing' | 'error';
  fallbackUsed: boolean;
  recentTools: ToolInvocation[]; // NEW: Tool invocation history
  conversationSummary?: string; // NEW: Phase 3 addition
}
```

> **Mode-aware note:** Populate `recentTools` size and `conversationSummary` availability using `contextDepth(mode, role)` from `memory-policy`. For example, dual-mode owners can surface up to 10 tools inside the package, while guest/emulation callers should be limited to 2 so prompts stay shallow.

---

### Task 2.2: Query Recent Tool Invocations

**File:** `packages/core/src/context-builder.ts`

**Required Changes:**

1. **Policy-driven limits:** Call `const toolLimit = contextDepth(mode, userRole) - 2;` (minimum 0) before querying so guests only ever retrieve a couple of tool events, while dual-mode owners can retrieve the full 10.
2. **Visibility filter:** Run `conversationVisibility(userRole)` to decide whether to include sensitive tool metadata (paths, approval ids) before returning them to the UI.

```typescript
import { searchMemory } from './memory.js';
import fs from 'node:fs';
import path from 'node:path';

// Add helper function to query tool invocations (around line 500)
async function queryRecentToolInvocations(
  conversationId: string,
  options: { limit?: number } = {}
): Promise<ToolInvocation[]> {
  const limit = options.limit || 10;
  const tools: ToolInvocation[] = [];

  try {
    const ctx = getUserContext();
    if (!ctx) return [];

    const episodicDir = path.join(ctx.profilePaths.episodic);

    // Read recent episodic files
    const today = new Date();
    const recentDays = 3; // Look back 3 days

    for (let i = 0; i < recentDays; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() - i);
      const year = date.getFullYear().toString();
      const yearDir = path.join(episodicDir, year);

      if (!fs.existsSync(yearDir)) continue;

      const files = fs.readdirSync(yearDir)
        .filter(f => f.endsWith('.json'))
        .sort()
        .reverse(); // Most recent first

      for (const file of files) {
        if (tools.length >= limit) break;

        const filepath = path.join(yearDir, file);
        const content = fs.readFileSync(filepath, 'utf-8');
        const event = JSON.parse(content);

        // Filter for tool invocations in current conversation
        if (
          event.type === 'tool_invocation' &&
          event.metadata?.conversationId === conversationId
        ) {
          tools.push({
            id: event.id,
            toolName: event.metadata.toolName,
            timestamp: event.timestamp,
            inputs: event.metadata.toolInputs || {},
            outputs: event.metadata.toolOutputs || {},
            success: event.metadata.success || false,
            error: event.metadata.error,
            executionTimeMs: event.metadata.executionTimeMs
          });
        }
      }

      if (tools.length >= limit) break;
    }
  } catch (error) {
    console.error('[context-builder] Error querying tool invocations:', error);
  }

  return tools.reverse(); // Return in chronological order
}

// Integrate into buildContextPackage (around line 200)
export async function buildContextPackage(
  userMessage: string,
  mode: CognitiveModeId,
  options: ContextBuilderOptions & { conversationId?: string } = {}
): Promise<ContextPackage> {
  // ... existing code ...

  // NEW: Query recent tool invocations
  const recentTools = options.conversationId
    ? await queryRecentToolInvocations(options.conversationId, { limit: 10 })
    : [];

  return {
    memories: relevantMemories,
    persona: personaSummary,
    currentFocus,
    activeTasks,
    recentTopics,
    patterns,
    mode,
    indexStatus,
    fallbackUsed,
    recentTools // NEW
  };
}
```

**Testing:**
- Execute 2 tool calls → query `buildContextPackage()` → verify `recentTools` contains 2 entries
- Verify tools ordered chronologically (oldest first)

---

### Task 2.3: Format Tool Context for Prompts

**File:** `packages/core/src/context-builder.ts`

**Required Changes:**

```typescript
// Add tool formatting helper (around line 600)
function formatToolsForPrompt(tools: ToolInvocation[], maxChars: number = 800): string {
  if (tools.length === 0) return '';

  const lines: string[] = [];
  lines.push('\n## Recent Tool Uses:');

  let charCount = lines[0].length;

  for (const tool of tools) {
    const status = tool.success ? '✓' : '✗';
    const timeAgo = formatTimeAgo(tool.timestamp);

    let line = `- ${status} ${tool.toolName} (${timeAgo})`;

    // Add key outputs if available and within budget
    if (tool.outputs && Object.keys(tool.outputs).length > 0) {
      const outputSummary = summarizeOutputs(tool.outputs);
      if (charCount + outputSummary.length < maxChars) {
        line += `: ${outputSummary}`;
      }
    }

    if (charCount + line.length > maxChars) break;

    lines.push(line);
    charCount += line.length;
  }

  return lines.join('\n');
}

function summarizeOutputs(outputs: Record<string, any>): string {
  // Extract key information from outputs
  const keys = Object.keys(outputs);
  if (keys.length === 0) return '';

  const summaryParts: string[] = [];

  for (const key of keys.slice(0, 3)) { // Max 3 keys
    const value = outputs[key];
    if (typeof value === 'string') {
      summaryParts.push(`${key}: ${value.substring(0, 50)}`);
    } else if (typeof value === 'number') {
      summaryParts.push(`${key}: ${value}`);
    } else if (Array.isArray(value)) {
      summaryParts.push(`${key}: [${value.length} items]`);
    }
  }

  return summaryParts.join(', ');
}

function formatTimeAgo(timestamp: string): string {
  const now = new Date();
  const then = new Date(timestamp);
  const diffMs = now.getTime() - then.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

// Update formatContextForPrompt (around line 560)
export function formatContextForPrompt(
  context: ContextPackage,
  options: { maxChars?: number; includePersona?: boolean; includeTools?: boolean } = {}
): string {
  const sections: string[] = [];
  const maxChars = options.maxChars || 2000;
  const includeTools = options.includeTools !== false; // Default true

  // ... existing persona, memories, tasks sections ...

  // NEW: Add tool invocations section
  if (includeTools && context.recentTools.length > 0) {
    const toolSection = formatToolsForPrompt(context.recentTools, 800);
    sections.push(toolSection);
  }

  return sections.join('\n\n').substring(0, maxChars);
}
```

> **Policy hook:** Set `maxChars` per section from `contextDepth(mode, role)` (e.g., deep = 1800, shallow = 600) and filter any tool entries that `conversationVisibility(role)` marks as hidden (e.g., guests never see filesystem paths).

**Testing:**
- Build context with 3 tool calls → verify tool section appears in formatted output
- Check character limits enforced
- Verify tool status icons (✓/✗) appear correctly

---

### Task 2.4: Persist Rolling Chat Buffer

**File:** `apps/site/src/pages/api/persona_chat.ts`

**Current State:**
- In-memory history (`conversationHistory`, `innerHistory`) at lines 34-39
- Lost on server restart

**Required Changes:**

```typescript
import fs from 'node:fs';
import path from 'node:path';
import { paths } from '@metahuman/core';

// Add buffer persistence helpers (around line 60)
function loadPersistedBuffer(mode: 'conversation' | 'inner'): RouterMessage[] {
  try {
    const ctx = getUserContext();
    if (!ctx) return [];

    const bufferPath = path.join(
      ctx.profilePaths.state,
      `conversation-buffer-${mode}.json`
    );

    if (!fs.existsSync(bufferPath)) return [];

    const data = fs.readFileSync(bufferPath, 'utf-8');
    const parsed = JSON.parse(data);

    // Validate structure
    if (Array.isArray(parsed.messages)) {
      return parsed.messages;
    }
  } catch (error) {
    console.warn(`[persona_chat] Failed to load buffer for ${mode}:`, error);
  }

  return [];
}

function persistBuffer(mode: 'conversation' | 'inner', messages: RouterMessage[]): void {
  try {
    const ctx = getUserContext();
    if (!ctx) return;

    const bufferPath = path.join(
      ctx.profilePaths.state,
      `conversation-buffer-${mode}.json`
    );

    // Ensure state directory exists
    fs.mkdirSync(path.dirname(bufferPath), { recursive: true });

    // Write atomically (write to temp, then rename)
    const tempPath = `${bufferPath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify({
      messages,
      lastUpdated: new Date().toISOString(),
      mode
    }, null, 2));

    fs.renameSync(tempPath, bufferPath);
  } catch (error) {
    console.error(`[persona_chat] Failed to persist buffer for ${mode}:`, error);
  }
}

// Initialize from persisted state (around line 40)
let conversationHistory: RouterMessage[] = loadPersistedBuffer('conversation');
let innerHistory: RouterMessage[] = loadPersistedBuffer('inner');

// Persist after each exchange (around line 1300)
// After adding assistant message to history
conversationHistory.push({
  role: 'assistant',
  content: finalResponse
});

// NEW: Persist to disk
persistBuffer('conversation', conversationHistory);

// Similar for inner mode
if (mode === 'inner') {
  innerHistory.push({
    role: 'assistant',
    content: finalResponse
  });
  persistBuffer('inner', innerHistory);
}
```

**Testing:**
- Send 3 messages → restart server → verify history restored
- Check `profiles/<user>/state/conversation-buffer-conversation.json` exists
- Verify atomic writes (no corrupted files)

---

### Task 2.5: Merge History Sources

**File:** `apps/site/src/pages/api/chat/history.ts`

**Required Changes:**

```typescript
// Update response to include conversation summary (around line 200)
async function loadChatHistory(
  mode: 'conversation' | 'inner',
  limit: number
): Promise<{ messages: Message[]; summary?: string }> {
  // ... existing episodic + audit log merging ...

  // NEW: Load conversation summary if available
  let summary: string | undefined;
  try {
    const ctx = getUserContext();
    if (ctx) {
      const summaryPath = path.join(
        ctx.profilePaths.summaries || path.join(ctx.profilePaths.memory, 'summaries'),
        `latest-${mode}.txt`
      );

      if (fs.existsSync(summaryPath)) {
        summary = fs.readFileSync(summaryPath, 'utf-8');
      }
    }
  } catch (error) {
    console.warn('[history] Failed to load summary:', error);
  }

  return {
    messages: deduplicatedMessages,
    summary
  };
}

// Update API response
export const GET: APIRoute = async ({ request, cookies }) => {
  // ... existing code ...

  const { messages, summary } = await loadChatHistory(mode, limit);

  return new Response(
    JSON.stringify({
      messages,
      summary, // NEW field
      mode,
      limit,
      timestamp: new Date().toISOString()
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }
  );
};
```

**Testing:**
- Query history → verify `summary` field in response
- Create summary file → verify it appears in API response

---

## Phase 3: Conversation Summaries

**Goal:** Automatically summarize long conversations to maintain context within token limits.

### Task 3.1: Create Conversation Summarizer Agent

**File:** `brain/agents/conversation-summarizer.ts` (NEW)

```typescript
/**
 * Conversation Summarizer Agent
 *
 * Automatically generates concise summaries of conversation segments
 * when the rolling buffer exceeds token/message thresholds.
 */

import { canWriteMemory, conversationVisibility } from '@metahuman/core/memory-policy';

// Before persisting summaries:
if (!canWriteMemory(mode === 'inner' ? 'dual' : cognitiveMode, 'summary')) {
  return; // Emulation stays ephemeral
}

// When returning summaries to UI:
if (!conversationVisibility(userRole).includes('summaries')) {
  summary = undefined;
}

import {
  callLLM,
  type RouterMessage,
  getUserContext,
  paths,
  audit,
  acquireLock,
  releaseLock,
  isLocked,
} from '../../packages/core/src/index.js';
import fs from 'node:fs';
import path from 'node:path';

interface ConversationSegment {
  messages: RouterMessage[];
  startIndex: number;
  endIndex: number;
  mode: 'conversation' | 'inner';
}

interface ConversationSummary {
  summary: string;
  messageRange: { start: number; end: number };
  messageCount: number;
  mode: string;
  timestamp: string;
}

/**
 * Summarize a segment of conversation messages
 */
async function summarizeSegment(segment: ConversationSegment): Promise<string> {
  const messagesText = segment.messages
    .map((msg, idx) => `[${segment.startIndex + idx}] ${msg.role}: ${msg.content}`)
    .join('\n\n');

  const systemPrompt = `You are a conversation summarizer. Your job is to create a concise 3-5 sentence summary of the conversation segment below.

Focus on:
- Main topics discussed
- Key decisions or conclusions
- Important information exchanged
- Any action items or requests

Be concise but preserve important details. Write in past tense.`;

  const userPrompt = `Summarize this conversation segment:\n\n${messagesText}`;

  try {
    const response = await callLLM({
      role: 'curator',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      options: { temperature: 0.3, max_tokens: 200 }
    });

    return response.content.trim();
  } catch (error) {
    console.error('[summarizer] LLM call failed:', error);
    // Fallback: extractive summary (first + last messages)
    const first = segment.messages[0];
    const last = segment.messages[segment.messages.length - 1];
    return `Discussed: ${first.content.substring(0, 100)}... Later: ${last.content.substring(0, 100)}...`;
  }
}

/**
 * Load conversation buffer from disk
 */
function loadConversationBuffer(mode: 'conversation' | 'inner'): RouterMessage[] {
  try {
    const ctx = getUserContext();
    if (!ctx) return [];

    const bufferPath = path.join(
      ctx.profilePaths.state,
      `conversation-buffer-${mode}.json`
    );

    if (!fs.existsSync(bufferPath)) return [];

    const data = fs.readFileSync(bufferPath, 'utf-8');
    const parsed = JSON.parse(data);

    return Array.isArray(parsed.messages) ? parsed.messages : [];
  } catch (error) {
    console.warn(`[summarizer] Failed to load buffer:`, error);
    return [];
  }
}

/**
 * Save conversation summary
 */
function saveSummary(
  mode: 'conversation' | 'inner',
  summary: ConversationSummary
): void {
  try {
    const ctx = getUserContext();
    if (!ctx) return;

    const summariesDir = path.join(ctx.profilePaths.memory, 'summaries');
    fs.mkdirSync(summariesDir, { recursive: true });

    // Save timestamped summary
    const filename = `${mode}-${new Date().toISOString().split('T')[0]}-${Date.now()}.json`;
    const filepath = path.join(summariesDir, filename);
    fs.writeFileSync(filepath, JSON.stringify(summary, null, 2));

    // Update "latest" pointer
    const latestPath = path.join(summariesDir, `latest-${mode}.txt`);
    fs.writeFileSync(latestPath, summary.summary);

    audit({
      level: 'info',
      category: 'action',
      event: 'conversation_summarized',
      details: {
        mode,
        messageCount: summary.messageCount,
        summaryLength: summary.summary.length,
        filepath: path.basename(filepath)
      },
      actor: 'conversation-summarizer'
    });
  } catch (error) {
    console.error('[summarizer] Failed to save summary:', error);
  }
}

/**
 * Check if summarization is needed
 */
function needsSummarization(
  messages: RouterMessage[],
  thresholds: { maxMessages: number; maxTokens: number }
): boolean {
  if (messages.length < thresholds.maxMessages) return false;

  // Estimate token count (rough: 4 chars per token)
  const totalChars = messages.reduce((sum, msg) => sum + msg.content.length, 0);
  const estimatedTokens = Math.floor(totalChars / 4);

  return estimatedTokens > thresholds.maxTokens;
}

/**
 * Main summarization function
 */
async function summarizeConversation(
  mode: 'conversation' | 'inner' = 'conversation'
): Promise<void> {
  const messages = loadConversationBuffer(mode);

  if (messages.length === 0) {
    console.log(`[summarizer] No messages to summarize for ${mode}`);
    return;
  }

  const thresholds = {
    maxMessages: 20,
    maxTokens: 8000
  };

  if (!needsSummarization(messages, thresholds)) {
    console.log(`[summarizer] No summarization needed (${messages.length} messages)`);
    return;
  }

  console.log(`[summarizer] Summarizing ${messages.length} messages for ${mode}...`);

  // Summarize older half of conversation (keep recent messages intact)
  const splitPoint = Math.floor(messages.length / 2);
  const segmentToSummarize = messages.slice(0, splitPoint);
  const messagesToKeep = messages.slice(splitPoint);

  const summary = await summarizeSegment({
    messages: segmentToSummarize,
    startIndex: 0,
    endIndex: splitPoint - 1,
    mode
  });

  const summaryObj: ConversationSummary = {
    summary,
    messageRange: { start: 0, end: splitPoint - 1 },
    messageCount: segmentToSummarize.length,
    mode,
    timestamp: new Date().toISOString()
  };

  saveSummary(mode, summaryObj);

  console.log(`[summarizer] Summary generated: ${summary.substring(0, 100)}...`);

  // TODO: Update conversation buffer to replace summarized messages with summary marker
  // This would require modifying persona_chat.ts to handle summary markers
}

/**
 * Main entry point
 */
async function run() {
  // Single-instance guard
  if (isLocked('agent-conversation-summarizer')) {
    console.log('[summarizer] Another instance running. Exiting.');
    return;
  }

  const lock = acquireLock('agent-conversation-summarizer');

  try {
    console.log('[summarizer] Starting conversation summarization...');

    // Summarize both modes
    await summarizeConversation('conversation');
    await summarizeConversation('inner');

    console.log('[summarizer] Summarization complete.');
  } catch (error) {
    console.error('[summarizer] Error:', error);
    audit({
      level: 'error',
      category: 'action',
      event: 'summarization_failed',
      details: { error: (error as Error).message },
      actor: 'conversation-summarizer'
    });
  } finally {
    releaseLock(lock);
  }
}

run().catch(console.error);
```

**Testing:**
- Create conversation buffer with 25 messages
- Run agent: `tsx brain/agents/conversation-summarizer.ts`
- Verify summary file created in `memory/summaries/`
- Verify `latest-conversation.txt` updated

---

### Task 3.2: Store Conversation Summaries

**Covered in Task 3.1** - Summaries saved to `profiles/<user>/memory/summaries/`

---

### Task 3.3: Integrate Summaries into Prompts

**File:** `apps/site/src/pages/api/persona_chat.ts`

**Required Changes:**

1. **Visibility filter:** Before pushing a summary into `systemMessages`, call `conversationVisibility(ctx?.role)` from `memory-policy`. If the returned capabilities array does not include `'summaries'`, skip injecting the block entirely (guests shouldn't see private owner history).

```typescript
// Load conversation summary before building context (around line 200)
async function loadConversationSummary(mode: 'conversation' | 'inner'): Promise<string | undefined> {
  try {
    const ctx = getUserContext();
    if (!ctx) return undefined;

    const summaryPath = path.join(
      ctx.profilePaths.memory,
      'summaries',
      `latest-${mode}.txt`
    );

    if (fs.existsSync(summaryPath)) {
      return fs.readFileSync(summaryPath, 'utf-8');
    }
  } catch (error) {
    console.warn('[persona_chat] Failed to load summary:', error);
  }

  return undefined;
}

// Include in prompt assembly (around line 270)
const conversationSummary = await loadConversationSummary(mode);

// Add to system prompt or as separate message
if (conversationSummary) {
  systemMessages.push({
    role: 'system',
    content: `## Conversation Summary (earlier messages):\n${conversationSummary}`
  });
}

// Then add recent messages as usual
```

**Testing:**
- Create summary file
- Send message → verify summary appears in LLM prompt
- Check assistant can reference earlier conversation topics from summary

---

### Task 3.4: Trigger Summarization Automatically

**File:** `apps/site/src/pages/api/persona_chat.ts`

**Required Changes:**

> **Policy hook:** Guard `triggerSummarization()` with `if (!canWriteMemory(currentMode, 'summary')) return;` so emulation mode never spawns the agent. When summarization is allowed, pass the mode into the spawned process so it can apply the correct retention policy (dual = episodic, agent = action-focused).

```typescript
import { spawn } from 'node:child_process';

// After pruning history (around line 50)
function pruneHistory(messages: RouterMessage[], maxMessages = 20): RouterMessage[] {
  if (messages.length <= maxMessages) return messages;

  const pruned = messages.slice(-maxMessages);

  // NEW: Trigger summarization if we just pruned
  triggerSummarization();

  return pruned;
}

// Background summarization trigger
function triggerSummarization(): void {
  try {
    // Spawn summarizer agent in background (fire-and-forget)
    const agentPath = path.join(paths.root, 'brain', 'agents', 'conversation-summarizer.ts');

    const child = spawn('tsx', [agentPath], {
      detached: true,
      stdio: 'ignore'
    });

    child.unref(); // Allow parent to exit

    console.log('[persona_chat] Triggered background summarization');
  } catch (error) {
    console.warn('[persona_chat] Failed to trigger summarization:', error);
  }
}
```

**Testing:**
- Send 25 messages → verify pruning triggers summarization
- Check `logs/audit/` for `conversation_summarized` event
- Verify summary appears in next message's prompt

---

## Phase 4: Profile & Role Awareness

**Goal:** Adjust context depth and prompt content based on user role (owner vs guest).

### Task 4.1: Role-Based Context Depth

**File:** `packages/core/src/context-builder.ts`

**Required Changes:**

```typescript
// Update buildContextPackage to include role-based depth (around line 150)
export async function buildContextPackage(
  userMessage: string,
  mode: CognitiveModeId,
  options: ContextBuilderOptions = {}
): Promise<ContextPackage> {
  const ctx = getUserContext();

  // NEW: Adjust search depth by role
  let searchDepth = options.searchDepth || 'normal';

  if (ctx) {
    if (ctx.role === 'owner') {
      searchDepth = 'deep'; // 12 results
    } else if (ctx.role === 'member') {
      searchDepth = 'normal'; // 8 results
    } else if (ctx.role === 'guest' || ctx.role === 'anonymous') {
      searchDepth = 'shallow'; // 3 results
    }
  }

  const searchOptions: VectorSearchOptions = {
    limit: searchDepth === 'deep' ? 12 : searchDepth === 'shallow' ? 3 : 8,
    similarityThreshold: options.similarityThreshold || 0.62,
    filters: options.metadataFilters
  };

  // ... rest of function ...
}
```

> **Policy hook:** Replace the manual `if (ctx.role === ...)` block with `const depth = contextDepth(mode, ctx?.role ?? 'guest')` from `memory-policy` so future roles inherit the right defaults without touching this file again.

**Testing:**
- Login as owner → send message → verify 12 memory results
- Login as guest → send message → verify 3 memory results
- Check audit logs show different search depths

---

### Task 4.2: Inject Role Context into Prompts

**File:** `apps/site/src/pages/api/persona_chat.ts`

**Required Changes:**

```typescript
// Add role context to system prompt (around line 280)
const ctx = getUserContext();
const roleContext = ctx
  ? `You are operating in [${mode}] mode with [${trustLevel}] trust for [${ctx.role}] user "${ctx.username}".`
  : '';

const systemPrompt = `${personaIdentity}\n\n${roleContext}\n\n${additionalInstructions}`;
```

**Testing:**
- Send message as guest → verify prompt includes "guest user"
- Send message as owner → verify prompt includes "owner user"

---

### Task 4.3: Profile Selection Metadata

**File:** `packages/core/src/context-builder.ts`

**Current State:** Already partially implemented via guest profile selection

**Testing:** Verify guest users with public profiles get correct persona loaded

---

## Phase 5: Observability & Testing

**Goal:** Monitor memory coverage, detect failures, and validate the pipeline.

### Task 5.1: Memory Coverage Metrics

**File:** `apps/site/src/pages/api/memory-metrics.ts` (NEW)

```typescript
import type { APIRoute } from 'astro';
import { getUserContext } from '@metahuman/core/context';
import { getIndexStatus } from '@metahuman/core/vector-index';
import { withUserContext } from '../../middleware/userContext';
import fs from 'node:fs';
import path from 'node:path';

interface MemoryMetrics {
  totalMemories: number;
  memoriesByType: Record<string, number>;
  vectorIndexCoverage: number; // Percentage of memories with embeddings
  lastCaptureTimestamp: string;
  conversationSummaries: number;
  recentToolInvocations: number;
  recentFileOperations: number;
  memoryGrowthRate: number; // Memories per day (last 7 days)
}

async function calculateMetrics(): Promise<MemoryMetrics> {
  const ctx = getUserContext();
  if (!ctx) {
    throw new Error('No user context');
  }

  const episodicDir = ctx.profilePaths.episodic;
  const indexStatus = getIndexStatus();

  let totalMemories = 0;
  const memoriesByType: Record<string, number> = {};
  let lastCaptureTimestamp = '';
  let recentToolInvocations = 0;
  let recentFileOperations = 0;
  const memoryTimestamps: string[] = [];

  // Scan episodic directory
  if (fs.existsSync(episodicDir)) {
    const yearDirs = fs.readdirSync(episodicDir);

    for (const year of yearDirs) {
      const yearPath = path.join(episodicDir, year);
      const stats = fs.statSync(yearPath);

      if (!stats.isDirectory()) continue;

      const files = fs.readdirSync(yearPath).filter(f => f.endsWith('.json'));

      for (const file of files) {
        const filepath = path.join(yearPath, file);
        try {
          const content = fs.readFileSync(filepath, 'utf-8');
          const event = JSON.parse(content);

          totalMemories++;

          // Count by type
          const type = event.type || 'unknown';
          memoriesByType[type] = (memoriesByType[type] || 0) + 1;

          // Track timestamps
          memoryTimestamps.push(event.timestamp);

          // Recent tool invocations (last 24 hours)
          const ageMs = Date.now() - new Date(event.timestamp).getTime();
          if (type === 'tool_invocation' && ageMs < 86400000) {
            recentToolInvocations++;
          }

          // Recent file operations (last 24 hours)
          if ((type === 'file_read' || type === 'file_write') && ageMs < 86400000) {
            recentFileOperations++;
          }

          // Update last capture
          if (!lastCaptureTimestamp || event.timestamp > lastCaptureTimestamp) {
            lastCaptureTimestamp = event.timestamp;
          }
        } catch {
          // Skip malformed files
        }
      }
    }
  }

  // Calculate vector index coverage
  const vectorIndexCoverage = indexStatus.exists && totalMemories > 0
    ? Math.round((indexStatus.count / totalMemories) * 100)
    : 0;

  // Count summaries
  let conversationSummaries = 0;
  const summariesDir = path.join(ctx.profilePaths.memory, 'summaries');
  if (fs.existsSync(summariesDir)) {
    conversationSummaries = fs.readdirSync(summariesDir).filter(f => f.endsWith('.json')).length;
  }

  // Calculate memory growth rate (last 7 days)
  const sevenDaysAgo = Date.now() - (7 * 86400000);
  const recentMemories = memoryTimestamps.filter(ts => new Date(ts).getTime() > sevenDaysAgo);
  const memoryGrowthRate = Math.round(recentMemories.length / 7 * 10) / 10; // Per day

  return {
    totalMemories,
    memoriesByType,
    vectorIndexCoverage,
    lastCaptureTimestamp,
    conversationSummaries,
    recentToolInvocations,
    recentFileOperations,
    memoryGrowthRate
  };
}

const handler: APIRoute = async () => {
  try {
    const metrics = await calculateMetrics();

    return new Response(
      JSON.stringify(metrics),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache'
        }
      }
    );
  } catch (error) {
    console.error('[memory-metrics] Error:', error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
};

export const GET = withUserContext(handler);
```

**Testing:**
- Query `/api/memory-metrics` → verify returns JSON with all fields
- Create memories → refresh → verify counts increase

---

### Task 5.2: Memory Miss Detection

**File:** `apps/site/src/pages/api/persona_chat.ts`

**Required Changes:**

```typescript
import { appendFileSync } from 'node:fs';

// After semantic search (around line 250)
const contextPackage = await buildContextPackage(userMessage, cognitiveMode, options);

// NEW: Log memory misses
if (contextPackage.memories.length === 0 && userMessage.length > 20) {
  const missLogPath = path.join(paths.logs, 'memory-misses.ndjson');

  try {
    const missEntry = JSON.stringify({
      timestamp: new Date().toISOString(),
      query: userMessage.substring(0, 200),
      mode: cognitiveMode,
      totalMemories: 0, // Could query total count if needed
      indexStatus: contextPackage.indexStatus,
      username: ctx?.username || 'anonymous'
    });

    appendFileSync(missLogPath, missEntry + '\n');
  } catch (error) {
    console.warn('[persona_chat] Failed to log memory miss:', error);
  }
}
```

**Testing:**
- Send message with empty memory store → verify logged to `logs/memory-misses.ndjson`
- Check log file has valid NDJSON format

---

### Task 5.3: Regression Test Suite

**File:** `tests/memory-continuity.test.ts` (NEW)

```typescript
/**
 * Memory Continuity Regression Test Suite
 *
 * Validates that the memory capture pipeline works end-to-end:
 * 1. Events are captured correctly
 * 2. Vector index is updated
 * 3. Prompts include relevant context
 * 4. Summaries are generated
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { captureEvent, searchMemory } from '../packages/core/src/memory.js';
import { buildContextPackage } from '../packages/core/src/context-builder.js';
import { withUserContext } from '../packages/core/src/context.js';
import fs from 'node:fs';
import path from 'node:path';

describe('Memory Continuity Pipeline', () => {
  beforeAll(async () => {
    // Set up test user context
    await withUserContext(
      { userId: 'test-user-1', username: 'testuser', role: 'owner' },
      async () => {
        // Clear test data
        const episodicDir = path.join(process.cwd(), 'profiles', 'testuser', 'memory', 'episodic');
        if (fs.existsSync(episodicDir)) {
          fs.rmSync(episodicDir, { recursive: true });
        }
      }
    );
  });

  it('should capture user message as episodic event', async () => {
    await withUserContext(
      { userId: 'test-user-1', username: 'testuser', role: 'owner' },
      async () => {
        const message = 'This is a test message about machine learning';

        const eventId = captureEvent(message, {
          type: 'conversation',
          tags: ['chat', 'test'],
          metadata: {
            conversationId: 'test-conv-1'
          }
        });

        expect(eventId).toBeDefined();
        expect(fs.existsSync(eventId)).toBe(true);

        const event = JSON.parse(fs.readFileSync(eventId, 'utf-8'));
        expect(event.content).toBe(message);
        expect(event.metadata.conversationId).toBe('test-conv-1');
      }
    );
  });

  it('should capture tool invocation with structured metadata', async () => {
    await withUserContext(
      { userId: 'test-user-1', username: 'testuser', role: 'owner' },
      async () => {
        const eventId = captureEvent('Tool executed: search', {
          type: 'tool_invocation',
          tags: ['tool', 'search'],
          metadata: {
            toolName: 'search',
            toolInputs: { query: 'test' },
            toolOutputs: { results: ['item1', 'item2'] },
            success: true
          }
        });

        const event = JSON.parse(fs.readFileSync(eventId, 'utf-8'));
        expect(event.metadata.toolName).toBe('search');
        expect(event.metadata.success).toBe(true);
      }
    );
  });

  it('should include tool invocations in context package', async () => {
    await withUserContext(
      { userId: 'test-user-1', username: 'testuser', role: 'owner' },
      async () => {
        // Create tool invocation
        captureEvent('Tool: fs_read', {
          type: 'tool_invocation',
          tags: ['tool'],
          metadata: {
            conversationId: 'test-conv-2',
            toolName: 'fs_read',
            toolInputs: { path: '/test.txt' },
            toolOutputs: { content: 'file content' },
            success: true
          }
        });

        // Build context
        const context = await buildContextPackage(
          'What did I just read?',
          'dual',
          { conversationId: 'test-conv-2' }
        );

        expect(context.recentTools.length).toBeGreaterThan(0);
        expect(context.recentTools[0].toolName).toBe('fs_read');
      }
    );
  });

  // Add more tests for:
  // - File operations capture
  // - Code approvals capture
  // - Summary generation
  // - Memory retrieval accuracy
});
```

**Testing:**
- Run: `pnpm test tests/memory-continuity.test.ts`
- Verify all tests pass

---

### Task 5.4: Metrics Dashboard Widget

**File:** `apps/site/src/components/MemoryMetrics.svelte` (NEW)

```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  interface Metrics {
    totalMemories: number;
    memoriesByType: Record<string, number>;
    vectorIndexCoverage: number;
    lastCaptureTimestamp: string;
    conversationSummaries: number;
    recentToolInvocations: number;
    recentFileOperations: number;
    memoryGrowthRate: number;
  }

  let metrics = $state<Metrics | null>(null);
  let error = $state<string | null>(null);
  let loading = $state<boolean>(true);
  let interval: number;

  async function fetchMetrics() {
    try {
      const response = await fetch('/api/memory-metrics');
      if (!response.ok) throw new Error('Failed to fetch metrics');

      metrics = await response.json();
      error = null;
    } catch (err) {
      error = (err as Error).message;
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    fetchMetrics();
    interval = setInterval(fetchMetrics, 30000); // Refresh every 30s
  });

  onDestroy(() => {
    if (interval) clearInterval(interval);
  });

  function formatTimestamp(ts: string): string {
    const date = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  }
</script>

<div class="memory-metrics">
  <h3>Memory Coverage</h3>

  {#if loading}
    <p class="loading">Loading metrics...</p>
  {:else if error}
    <p class="error">Error: {error}</p>
  {:else if metrics}
    <div class="metrics-grid">
      <div class="metric">
        <span class="label">Total Memories:</span>
        <span class="value">{metrics.totalMemories.toLocaleString()}</span>
      </div>

      <div class="metric">
        <span class="label">Vector Index:</span>
        <span class="value">{metrics.vectorIndexCoverage}%</span>
      </div>

      <div class="metric">
        <span class="label">Last Capture:</span>
        <span class="value">{formatTimestamp(metrics.lastCaptureTimestamp)}</span>
      </div>

      <div class="metric">
        <span class="label">Growth Rate:</span>
        <span class="value">{metrics.memoryGrowthRate}/day</span>
      </div>

      <div class="metric">
        <span class="label">Recent Tools:</span>
        <span class="value">{metrics.recentToolInvocations}</span>
      </div>

      <div class="metric">
        <span class="label">File Ops:</span>
        <span class="value">{metrics.recentFileOperations}</span>
      </div>

      <div class="metric">
        <span class="label">Summaries:</span>
        <span class="value">{metrics.conversationSummaries}</span>
      </div>
    </div>

    <details class="type-breakdown">
      <summary>Memory Types</summary>
      <ul>
        {#each Object.entries(metrics.memoriesByType).sort((a, b) => b[1] - a[1]) as [type, count]}
          <li>
            <span class="type">{type}:</span>
            <span class="count">{count}</span>
          </li>
        {/each}
      </ul>
    </details>
  {/if}
</div>

<style>
  .memory-metrics {
    padding: 1rem;
    background: var(--bg-secondary);
    border-radius: 8px;
    margin-bottom: 1rem;
  }

  h3 {
    margin: 0 0 0.75rem 0;
    font-size: 0.95rem;
    color: var(--text-primary);
  }

  .metrics-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }

  .metric {
    display: flex;
    justify-content: space-between;
    padding: 0.25rem 0;
    font-size: 0.85rem;
  }

  .label {
    color: var(--text-secondary);
  }

  .value {
    font-weight: 500;
    color: var(--text-primary);
  }

  .type-breakdown {
    font-size: 0.85rem;
    margin-top: 0.75rem;
  }

  summary {
    cursor: pointer;
    color: var(--text-secondary);
  }

  ul {
    margin: 0.5rem 0 0 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    justify-content: space-between;
    padding: 0.25rem 0;
  }

  .type {
    color: var(--text-secondary);
  }

  .count {
    color: var(--text-primary);
    font-weight: 500;
  }

  .loading,
  .error {
    font-size: 0.85rem;
    color: var(--text-secondary);
    font-style: italic;
  }

  .error {
    color: var(--color-error);
  }
</style>
```

**Integration:** Add to `RightSidebar.svelte` in Developer Tools section.

**Testing:**
- Open dev tools sidebar → verify metrics widget appears
- Create memories → verify metrics update (30s refresh)

---

## Testing Strategy

### Unit Tests

**Location:** `tests/memory-continuity.test.ts`

**Coverage:**
- `captureEvent()` creates files correctly
- Metadata fields are preserved
- Vector index auto-updates
- Context builder includes tool invocations
- Summary generation produces valid output

### Integration Tests

**Scenarios:**
1. **Full Conversation Flow:**
   - User sends message → chat event captured
   - Assistant responds → response captured
   - Tool invoked → tool event captured
   - Context package includes all events

2. **File Operation Flow:**
   - Read file → file_read event captured
   - Write file → file_write event captured
   - Search for filename → file events appear

3. **Summarization Flow:**
   - Send 25 messages → buffer pruned
   - Summarizer agent triggered
   - Summary file created
   - Next message includes summary in prompt

### Manual Testing Checklist

- [ ] Send chat message → verify event in `memory/episodic/`
- [ ] Execute tool via operator → verify tool_invocation event
- [ ] Read file → verify file_read event with snippet
- [ ] Write file → verify file_write event with snippet
- [ ] Approve code change → verify code_approval event
- [ ] Reject code change → verify code_rejection event
- [ ] Query semantic search → verify tool events appear
- [ ] Send 25 messages → verify summary generated
- [ ] Restart server → verify history restored
- [ ] Check `/api/memory-metrics` → verify accurate counts
- [ ] Open dev tools → verify metrics widget displays

---

## Rollout Plan

### Week 1: Foundation (Phase 1 Partial)

**Monday-Tuesday:**
- Task 1.1: Instrument tool invocations
- Task 1.5: Enhance metadata schema
- Deploy and test on staging

**Wednesday-Thursday:**
- Task 1.4: Add conversation session IDs
- Task 2.1: Extend ContextPackage interface
- Deploy and test

**Friday:**
- Integration testing
- Bug fixes
- Documentation updates

### Week 2: Instrumentation Complete (Phase 1 + 2)

**Monday-Tuesday:**
- Task 1.2: Instrument file operations
- Task 1.3: Instrument code approvals
- Deploy and test

**Wednesday-Thursday:**
- Task 2.2: Query tool invocations
- Task 2.3: Format tool context
- Task 2.4: Persist rolling buffer
- Deploy and test

**Friday:**
- Task 2.5: Merge history sources
- Integration testing
- Performance monitoring

### Week 3: Advanced Features (Phase 3, 4, 5)

**Monday-Tuesday:**
- Task 3.1: Build summarizer agent
- Task 3.2: Save summaries
- Test summarization quality

**Wednesday:**
- Task 3.3: Integrate summaries in prompts
- Task 3.4: Auto-trigger summarization
- Task 4.1: Role-based context depth

**Thursday:**
- Task 4.2: Inject role context
- Task 5.1: Memory metrics API
- Task 5.4: Metrics dashboard widget

**Friday:**
- Task 5.2: Memory miss detection
- Task 5.3: Regression test suite
- Final integration testing
- Deploy to production

---

## Success Metrics

**Phase 1 Success:**
- ✅ 100% of tool invocations captured as memories
- ✅ 100% of file operations captured
- ✅ 100% of code approvals/rejections captured
- ✅ All memories include conversation session IDs
- ✅ Vector index coverage > 95%

**Phase 2 Success:**
- ✅ Prompts include tool context section
- ✅ Rolling buffer persists across restarts
- ✅ Chat history API returns summaries
- ✅ Tool outputs visible in semantic search

**Phase 3 Success:**
- ✅ Conversations auto-summarize at 20 message threshold
- ✅ Summaries appear in prompts
- ✅ Long sessions remain coherent (no token limit errors)

**Phase 4 Success:**
- ✅ Guests receive shallower context (3 results vs 12 for owners)
- ✅ Prompts include role metadata
- ✅ Public profile selection works correctly

**Phase 5 Success:**
- ✅ Memory metrics dashboard shows real-time stats
- ✅ Memory miss log helps debug retrieval failures
- ✅ Regression tests pass (100% coverage)

---

## Appendix: Code Examples

### Example: Tool Invocation Event

```json
{
  "id": "evt-20251106123456-abcd1234",
  "timestamp": "2025-11-06T12:34:56.789Z",
  "content": "Tool executed: search",
  "type": "tool_invocation",
  "entities": ["search"],
  "tags": ["tool", "search", "operator", "dual"],
  "importance": 0.6,
  "userId": "user-12345",
  "metadata": {
    "conversationId": "conv-1730901234-xyz",
    "parentEventId": "evt-20251106123450-user-msg",
    "toolName": "search",
    "toolInputs": {
      "query": "machine learning",
      "limit": 10
    },
    "toolOutputs": {
      "results": [
        { "title": "Intro to ML", "url": "..." },
        { "title": "Deep Learning", "url": "..." }
      ],
      "count": 10
    },
    "success": true,
    "executionTimeMs": 234,
    "cognitiveMode": "dual"
  }
}
```

### Example: Formatted Tool Context

```
## Recent Tool Uses:
- ✓ search (2m ago): results: [10 items]
- ✓ fs_read (5m ago): content: package.json
- ✗ fs_write (8m ago): error: Permission denied
```

### Example: Conversation Summary

```
The user asked about implementing a search feature. I explained how to use
vector embeddings and suggested using the nomic-embed-text model. We discussed
storing embeddings in a JSON file and performing semantic search. The user
approved the approach and asked for code examples.
```

---

## References

- Original Memory Continuity Plan: `docs/implementation-plans/memory-continuity-plan.md`
- Core Memory Module: `packages/core/src/memory.ts`
- Context Builder: `packages/core/src/context-builder.ts`
- Vector Index: `packages/core/src/vector-index.ts`
- Persona Chat API: `apps/site/src/pages/api/persona_chat.ts`

---

**End of Detailed Implementation Plan**
