# Migration Plan: persona_chat.ts Refactoring

**Status**: Phases 1-4 Complete
**Created**: 2025-11-26
**Updated**: 2025-11-27 (Implementation complete)
**Priority**: Medium (Refactoring, not migration)
**Complexity**: Medium Refactor (not Large)

## Executive Summary

**UPDATED AFTER ANALYSIS**: The original assumption that `persona_chat.ts` bypasses cognitive graphs was **incorrect**.

The file **already uses cognitive graphs** via `streamGraphExecutionWithProgress()`. The actual problem is:
1. The file is 2429 lines with mixed responsibilities
2. There's duplicate conversation history management (API file + graph nodes)
3. `buildSystemPrompt()` adds persona to buffers, while graphs also handle persona
4. The streaming graph execution code should be extracted to a shared module

This is a **refactoring/simplification** project, not a migration.

## Phase 1 Analysis Findings

### What Works (Keep)

1. **Graph Execution**: `streamGraphExecutionWithProgress()` (line 271) already:
   - Loads cognitive graphs via `loadGraphForMode(graphKey)`
   - Streams progress events via `ReadableStream` + `text/event-stream`
   - Supports cognitive mode switching (dual/agent/emulation)
   - Has timeout handling, cancellation support, and progress reporting

2. **Graph Nodes**: Cognitive graphs already have:
   - `cognitive/conversation_history` node - loads from `state/conversation-buffer-{mode}.json`
   - `cognitive/persona_loader` and `cognitive/persona_formatter` nodes
   - Full persona handling in the graph pipeline

### What's Redundant (Remove)

1. **`buildSystemPrompt()`** (line 1217): Duplicates persona injection that graphs already handle
2. **`initializeChat()`** (line 1265): Manual buffer initialization
3. **`ensureSystemPrompt()`** (line 1274): Redundant system prompt management
4. **`refreshSystemPrompt()`**: More duplicate persona handling

### Current Architecture

```
User Message → /api/persona_chat → streamGraphExecutionWithProgress()
                      ↓                         ↓
              Buffer Management         Graph Execution
              (buildSystemPrompt)       (persona nodes)
                      ↓                         ↓
              [REDUNDANT]              [WORKS CORRECTLY]
```

## Revised Refactoring Plan

### Goal

Reduce `persona_chat.ts` from 2429 lines to ~500 lines by:
1. Extracting streaming graph execution to `packages/core/src/graph-streaming.ts`
2. Removing redundant persona/buffer management code
3. Letting cognitive graph nodes handle all persona and history concerns

### Phase 1: Analysis (COMPLETED)

- [x] Found graph execution: `streamGraphExecutionWithProgress()` already uses cognitive graphs
- [x] Found streaming: Uses `ReadableStream` + `text/event-stream`
- [x] Found history management: Graph's `conversation_history` node loads from buffer files
- [x] Found duplicate code: `buildSystemPrompt()` duplicates graph persona handling

### Phase 2: Extract Graph Streaming Module (COMPLETED)

**Created**: `packages/core/src/graph-streaming.ts`

Extracted from `persona_chat.ts`:
- `streamGraphExecution()` function - streaming graph execution with SSE
- `loadGraphForMode()` function - graph loading with caching
- `requestCancellation()`, `checkCancellation()`, `clearCancellation()` - cancellation management
- `clearGraphCache()` - cache management
- Types: `GraphStreamingParams`, `StreamEvent`, `LoadedGraph`

**Benefits**:
- ✅ Reusable for other endpoints (not just chat)
- ✅ Testable in isolation
- ✅ Cleaner separation of concerns

### Phase 3: Remove Duplicate Code (COMPLETED)

**Removed from persona_chat.ts**:
- `graphCache` and `GraphCacheEntry` type
- `readGraphFromFile()` function
- `loadGraphForMode()` function (now imported from core)
- `requestCancellation()`, `checkCancellation()`, `clearCancellation()` (now imported from core)

**Result**: Reduced file from 2429 to 2318 lines (~111 lines removed)

### Phase 4: Document Legacy Path (COMPLETED)

**Decision**: Keep legacy fallback as safety mechanism

The legacy code path (buildSystemPrompt, etc.) is kept but comprehensively documented as deprecated:
- Added detailed deprecation comments explaining why it exists
- Listed all functions that become obsolete when legacy path is removed
- Documented the removal process (2+ weeks of stability, then delete)

**Why not removed**:
- Legacy fallback allows disabling graph pipeline via `USE_NODE_PIPELINE=false`
- Safety mechanism for production issues
- Can be removed after extended stability period

**Future work**: After 2+ weeks of stable graph execution, delete legacy code path (~600 lines)

### Timeline

| Phase | Duration | Status |
|-------|----------|--------|
| 1. Analysis | 1 day | ✅ COMPLETE |
| 2. Extract streaming module | 1 day | ✅ COMPLETE |
| 3. Remove duplicate code | 1 day | ✅ COMPLETE |
| 4. Document legacy path | 1 day | ✅ COMPLETE |
| 5. Remove legacy fallback | Future | ⏳ After 2 weeks stability |

**Total completed**: 4 days
**Future work**: Remove legacy fallback after stability period

---

## Original Migration Strategy (DEPRECATED)

> **Note**: The following sections contain the original plan that was based on incorrect assumptions. Kept for reference.

### Phase 1: Analysis & Design (2-3 days) - SUPERSEDED

#### 1.1 Identify Cognitive Graph API Endpoint - COMPLETED

**Findings**:
- Graph execution exists in `packages/core/src/graph-executor.ts`
- `/api/execute-graph.ts` provides REST endpoint (no streaming)
- `persona_chat.ts` has streaming via `streamGraphExecutionWithProgress()`

#### 1.2 Map Feature Parity - COMPLETED

**All features already work via cognitive graphs**:
- ✅ Streaming responses (EventSource)
- ✅ Conversation history management
- ✅ Session management
- ✅ Inner dialogue mode vs conversation mode
- ✅ Persona facet switching
- [ ] Reply-to specific messages
- [ ] Context building with semantic search
- [ ] Memory grounding

**Deliverable**: Feature mapping table (what exists, what needs building)

#### 1.3 Design New Architecture

**Key Decisions**:
- [ ] How to trigger graph execution from ChatInterface
- [ ] How to pass conversation history to graph
- [ ] How to handle streaming from graph execution
- [ ] How to manage session state
- [ ] How to switch between cognitive modes (dual/agent/Big Brother)

**Deliverable**: Architecture diagram and API contract

---

### Phase 2: Infrastructure (3-5 days)

#### 2.1 Create Cognitive Graph Chat API

**New File**: `apps/site/src/pages/api/cognitive-graph-chat.ts`

**Requirements**:
- Accept user message, session ID, cognitive mode, conversation mode (conversation/inner)
- Load appropriate cognitive graph based on mode
- Inject conversation history into graph context
- Execute graph with user message
- Stream response back via EventSource
- Save conversation turn to history

**API Contract**:
```typescript
GET /api/cognitive-graph-chat?message=...&mode=conversation&sessionId=...&cognitiveMode=dual

Response: EventSource stream
Events:
  - data: { type: 'token', content: '...' }
  - data: { type: 'done', metadata: {...} }
  - data: { type: 'error', error: '...' }
```

**Tasks**:
- [ ] Create API endpoint file
- [ ] Implement graph selection logic (dual-mode.json vs agent-mode.json vs dual-mode-bigbrother.json)
- [ ] Implement conversation history loading
- [ ] Implement graph execution with context injection
- [ ] Implement streaming response handling
- [ ] Implement history persistence
- [ ] Add error handling

#### 2.2 Create Conversation History Node

**Option A**: Add new node type `cognitive/conversation_history_loader`

**Why**: The existing `conversation_history` node (id 7 in dual-mode.json) may not load from persistent storage.

**Tasks**:
- [ ] Check if existing `conversation_history` node loads from disk
- [ ] If not, create new `conversationHistoryLoaderExecutor` in `context-executors.ts`
- [ ] Load messages from session file (format: `state/chat-sessions/{mode}/{sessionId}.json`)
- [ ] Return formatted message array

**Option B**: Use existing conversation_history node

**Tasks**:
- [ ] Verify existing node loads from persistent storage
- [ ] Document expected input/output format
- [ ] Test with session IDs

#### 2.3 Add Session Context to Graph Execution

**Problem**: Graphs need to know which session to load history from.

**Solution**: Pass session ID in graph execution context.

**Tasks**:
- [ ] Modify graph executor to accept `sessionId` in context
- [ ] Modify `conversation_history` node to read from `context.sessionId`
- [ ] Update all graph execution calls to include session context

---

### Phase 3: Implementation (5-7 days)

#### 3.1 Update ChatInterface Component

**File**: `apps/site/src/components/ChatInterface.svelte`

**Changes**:
1. **Replace API Endpoint** (line 493):
   ```diff
   - chatResponseStream = new EventSource(`/api/persona_chat?${params.toString()}`);
   + chatResponseStream = new EventSource(`/api/cognitive-graph-chat?${params.toString()}`);
   ```

2. **Update Request Parameters**:
   ```typescript
   const params = new URLSearchParams({
     message: userMessage,
     mode: currentMode,          // conversation | inner
     sessionId: sessionId,
     cognitiveMode: activeCognitiveMode  // dual | agent | emulation
   });
   ```

3. **Handle Response Format Changes**:
   - Verify token streaming format matches
   - Update metadata handling
   - Update error handling

**Tasks**:
- [ ] Update API endpoint URL
- [ ] Add cognitiveMode parameter
- [ ] Update response event handlers
- [ ] Test streaming behavior
- [ ] Test error handling
- [ ] Test conversation/inner mode switching

#### 3.2 Migrate History Management

**Current**: persona_chat.ts manages history in `conversationBuffer` and `innerBuffer`

**New**: Cognitive graph system loads/saves history via nodes

**Tasks**:
- [ ] Verify graph system persists conversation history
- [ ] Ensure history format is compatible
- [ ] Migrate existing session files if needed
- [ ] Test history continuity across sessions

#### 3.3 Handle Cognitive Mode Switching

**Requirement**: User can switch between dual/agent/Big Brother modes

**Implementation**:
1. ChatInterface reads active cognitive mode from store/API
2. Passes `cognitiveMode` parameter to `/api/cognitive-graph-chat`
3. API selects correct graph file:
   - `dual` → `dual-mode.json`
   - `agent` → `agent-mode.json`
   - `dual` + Big Brother delegation → `dual-mode-bigbrother.json`
   - `emulation` → `emulation-mode.json`

**Tasks**:
- [ ] Add cognitive mode selector to ChatInterface UI (if not exists)
- [ ] Read active mode from settings/store
- [ ] Pass mode in API request
- [ ] Implement graph selection logic in API
- [ ] Test mode switching during conversation

---

### Phase 4: Feature Parity (3-5 days)

#### 4.1 Implement Missing Features

**Feature Checklist**:
- [ ] **Streaming Responses**: Verify tokens stream correctly
- [ ] **Conversation History**: Load/save history per session
- [ ] **Inner Dialogue Mode**: Support inner vs conversation modes
- [ ] **Persona Facet Switching**: Respect `inactive` facet
- [ ] **Reply-to Messages**: Support replying to specific messages
- [ ] **Context Building**: Ensure semantic search works
- [ ] **Memory Grounding**: Verify memories are retrieved
- [ ] **Session Management**: Support multiple concurrent sessions
- [ ] **Error Recovery**: Handle graph execution failures gracefully

#### 4.2 Optimize Performance

**Current Issues**:
- persona_chat.ts has ~50s delay on first request (executor loading)
- Need to pre-warm graph executors

**Tasks**:
- [ ] Verify graph executors are pre-warmed at boot
- [ ] Add caching for graph definitions
- [ ] Optimize context loading
- [ ] Test cold-start performance
- [ ] Test warm-path performance

---

### Phase 5: Testing (3-4 days)

#### 5.1 Unit Tests

**Test Coverage**:
- [ ] API endpoint request/response handling
- [ ] Graph selection logic
- [ ] History loading/saving
- [ ] Streaming response format
- [ ] Error handling

#### 5.2 Integration Tests

**Test Scenarios**:
- [ ] Send message → receive response → history saved
- [ ] Switch cognitive modes mid-conversation
- [ ] Switch facets (active → inactive → poet)
- [ ] Reply to specific message
- [ ] Inner dialogue vs conversation mode
- [ ] Concurrent sessions (multiple users)
- [ ] Session persistence (reload page, history intact)

#### 5.3 Manual Testing

**Test Cases**:
1. **Basic Chat**:
   - Send message, verify persona voice in response
   - Check graph editor shows persona nodes active

2. **Cognitive Mode Switching**:
   - Start in dual mode
   - Switch to agent mode
   - Switch to Big Brother mode
   - Verify response style changes appropriately

3. **Facet Switching**:
   - Change facet via status widget
   - Send message
   - Verify persona changes

4. **History Continuity**:
   - Have conversation
   - Reload page
   - Verify history intact

5. **Error Handling**:
   - Kill Ollama
   - Send message
   - Verify graceful error message

#### 5.4 Performance Testing

**Metrics**:
- [ ] First message latency (cold start)
- [ ] Subsequent message latency (warm)
- [ ] Streaming token rate
- [ ] Memory usage
- [ ] CPU usage during graph execution

**Targets**:
- Cold start: < 5 seconds
- Warm path: < 2 seconds for first token
- Token rate: > 20 tokens/sec
- Memory: < 500MB increase per session

---

### Phase 6: Migration & Cutover (2-3 days)

#### 6.1 Feature Flag

**Implementation**:
Add feature flag to `etc/runtime.json`:
```json
{
  "chat": {
    "useGraphAPI": false  // true = new graph API, false = legacy persona_chat
  }
}
```

**Tasks**:
- [ ] Add runtime config flag
- [ ] Update ChatInterface to check flag
- [ ] Test flag toggling
- [ ] Document flag usage

#### 6.2 Gradual Rollout

**Phases**:
1. **Internal Testing** (1-2 days):
   - Enable flag for single user
   - Test all features
   - Fix bugs

2. **Beta Testing** (2-3 days):
   - Enable for 25% of users
   - Monitor errors
   - Gather feedback

3. **Full Rollout** (1 day):
   - Enable for 100% of users
   - Monitor stability
   - Be ready to rollback

#### 6.3 Deprecate Legacy System

**After 2 weeks of stable operation**:

**Tasks**:
- [ ] Remove feature flag (always use graph API)
- [ ] Delete `buildSystemPrompt()` function (line 1384-1430)
- [ ] Delete `initializeChat()` function (line 1432)
- [ ] Delete `ensureSystemPrompt()` function (line 1441)
- [ ] Delete `refreshSystemPrompt()` function (line 1460)
- [ ] Delete conversation/inner buffer management code
- [ ] Delete `persona_chat.ts` file entirely
- [ ] Update ChatInterface to remove flag check
- [ ] Remove `PersonaChat.svelte` if deprecated

---

## Risk Assessment

### High Risks

1. **Breaking Chat Functionality**:
   - **Mitigation**: Feature flag allows instant rollback
   - **Mitigation**: Thorough testing before rollout

2. **Performance Regression**:
   - **Mitigation**: Performance testing before cutover
   - **Mitigation**: Monitor metrics post-rollout

3. **History Loss**:
   - **Mitigation**: Backup all session files before migration
   - **Mitigation**: Test history migration thoroughly

### Medium Risks

1. **Streaming Issues**:
   - **Mitigation**: Test EventSource compatibility early
   - **Mitigation**: Fallback to polling if needed

2. **Session Conflicts**:
   - **Mitigation**: Ensure session ID uniqueness
   - **Mitigation**: Test concurrent sessions

### Low Risks

1. **UI Changes Required**:
   - **Mitigation**: Keep UI changes minimal
   - **Mitigation**: Maintain same user experience

---

## Success Criteria

### Functional Requirements

- ✅ Chat works with graph-based persona injection
- ✅ No hidden persona injection (visible in graph editor)
- ✅ All cognitive modes supported (dual/agent/Big Brother)
- ✅ Conversation history persists across sessions
- ✅ Streaming responses work correctly
- ✅ Inner dialogue mode works
- ✅ Facet switching works

### Non-Functional Requirements

- ✅ Performance equal to or better than legacy system
- ✅ No data loss during migration
- ✅ Zero downtime during rollout
- ✅ Rollback capability via feature flag

### Documentation Requirements

- ✅ API documentation updated
- ✅ Architecture diagrams updated
- ✅ User-facing docs updated (if any)
- ✅ Migration completed message in CHANGELOG

---

## Timeline Estimate

| Phase | Duration | Dependencies |
|-------|----------|--------------|
| 1. Analysis & Design | 2-3 days | None |
| 2. Infrastructure | 3-5 days | Phase 1 complete |
| 3. Implementation | 5-7 days | Phase 2 complete |
| 4. Feature Parity | 3-5 days | Phase 3 complete |
| 5. Testing | 3-4 days | Phase 4 complete |
| 6. Migration & Cutover | 2-3 days | Phase 5 complete |

**Total**: 18-27 days (3.5-5.5 weeks)

**Recommended**: 4 weeks with buffer for issues

---

## Open Questions

1. **Does a cognitive graph execution API already exist?**
   - Need to search codebase for graph execution endpoints

2. **How does the graph system handle streaming responses?**
   - Need to examine graph executor streaming capabilities

3. **Where is conversation history stored in the graph system?**
   - Need to find session storage format

4. **Can we reuse existing conversation_history node or need new one?**
   - Need to examine node implementation

5. **How to handle Big Brother delegation trigger?**
   - Need to understand when to switch to dual-mode-bigbrother.json

6. **What happens to PersonaChat.svelte component?**
   - Deprecate, migrate, or delete?

---

## Next Steps

1. **Immediate** (Today):
   - [ ] Search codebase for cognitive graph execution API
   - [ ] Document API contract if exists
   - [ ] Answer open questions 1-2

2. **This Week**:
   - [ ] Complete Phase 1 (Analysis & Design)
   - [ ] Create architecture diagram
   - [ ] Get stakeholder approval on plan

3. **Next Week**:
   - [ ] Start Phase 2 (Infrastructure)
   - [ ] Create cognitive-graph-chat API endpoint
   - [ ] Implement graph execution logic

---

## References

- [CLAUDE.md](../CLAUDE.md) - Project architecture
- [Cognitive Graph System](../etc/cognitive-graphs/) - Graph definitions
- [Node Executors](../packages/core/src/node-executors/) - Node implementations
- [Current persona_chat API](../apps/site/src/pages/api/persona_chat.ts) - Legacy system
- [ChatInterface Component](../apps/site/src/components/ChatInterface.svelte) - UI component

---

## Approval

- [ ] Plan reviewed by project owner
- [ ] Timeline approved
- [ ] Resources allocated
- [ ] Ready to start Phase 1

---

**Document Version**: 1.0
**Last Updated**: 2025-11-26
**Author**: Migration Planning Team
