# Cognitive Modes: Operational Paradigms

MetaHuman OS features three distinct operational modes that control how the system processes information, routes decisions, and manages memory. You can switch between modes via the Web UI header or the API to match your current needs.

---

## Overview

### Why Cognitive Modes?

Different situations call for different levels of system engagement. Cognitive modes let you choose between:

- **Full learning and adaptation** (Dual Consciousness)
- **Lightweight assistant behavior** (Agent Mode)
- **Stable, read-only operation** (Emulation)

Each mode affects:
- How messages are routed (operator vs. direct chat)
- What gets saved to memory
- Which agents run proactively
- Whether the system learns from interactions

---

## Dual Consciousness Mode (Default)

### Purpose
Full cognitive mirror with deep learning and memory grounding.

### Behavior

**Routing**: Always uses the operator pipeline (planner → skills → narrator)
- Every message goes through the reasoning engine
- Multi-step task execution with skill usage
- Full planning and observation loops

**Memory**: Captures all interactions with `cognitiveMode: "dual"` metadata
- Every conversation saved to episodic memory
- Tagged for LoRA training differentiation
- Used in training pipeline for personality deepening

**Context**: Mandatory semantic search with persona fallback
- Semantic index search required for every response
- Fallback to persona+reflections if index unavailable
- Ensures responses are always grounded in your history

**Learning**: Proactive agents enabled, training pipeline active
- Reflector, curiosity, dreamer agents running
- Boredom maintenance triggers reflections
- Training data generation enabled

**Use Case**: Primary operational mode for maximum system capabilities

### When to Use

- ✅ Daily operation and conversations
- ✅ Building long-term personality model
- ✅ When you want the system to learn from every interaction
- ✅ Task execution with full memory integration
- ✅ Complex multi-step workflows

### Technical Details

```json
{
  "operatorRouting": "operator_only",
  "memoryWriteLevel": "read_write",
  "proactiveAgents": true,
  "trainingPipeline": "dual_trigger",
  "contextRetrieval": "semantic_required"
}
```

### Audit Tracking

All chat operations include:
```json
{
  "cognitiveMode": "dual",
  "usedOperator": true,
  "contextSources": ["semantic_search", "persona_core"]
}
```

### Performance Characteristics

- **Latency**: 2-5 seconds (includes semantic search + operator loop)
- **Token Usage**: High (context retrieval + multi-step reasoning)
- **Learning**: Maximum (every interaction contributes to training)
- **Accuracy**: Highest (grounded in personal history)

---

## Agent Mode

### Purpose
Lightweight assistant mode with smart routing.

### Behavior

**Routing**: Smart heuristics (simple chat vs. action-oriented operator routing)
- Simple queries → Direct chat response (no operator)
- Action requests → Operator pipeline
- Heuristic detection based on message content

**Memory**: Captures all interactions with `cognitiveMode: "agent"` metadata (when authenticated)
- Conversations saved to episodic memory
- Tagged with `agent` mode for training
- Anonymous users cannot save memories

**Context**: Optional semantic search (graceful degradation)
- Semantic search attempted but not required
- Falls back to chat without context if unavailable
- Faster responses at cost of less personal grounding

**Learning**: Proactive agents disabled, training pipeline disabled
- No reflections, curiosity, or dreams
- No background learning processes
- Focused on responsiveness

**Use Case**: Traditional assistant experience with reduced cognitive load

### When to Use

- ✅ Quick questions without deep processing
- ✅ When you want faster responses
- ✅ Temporary sessions where you don't need learning
- ✅ Testing or experimentation
- ✅ Casual conversations without memory grounding

### Routing Logic

```typescript
// Simple query → Chat response (no operator)
"What's the weather?" → Direct chat

// Action request → Operator pipeline
"Create a task to review documentation" → Planner + Skills

// Detection keywords:
// Action words: create, delete, update, run, execute, schedule
// File operations: read, write, save, edit
// Memory operations: remember, recall, find, search
```

### Technical Details

```json
{
  "operatorRouting": "heuristic",
  "memoryWriteLevel": "command_only",
  "proactiveAgents": false,
  "trainingPipeline": "disabled",
  "contextRetrieval": "semantic_optional"
}
```

### Audit Tracking

Logs include dynamic operator usage:
```json
{
  "cognitiveMode": "agent",
  "usedOperator": true,  // or false based on routing decision
  "routingReason": "action_keywords_detected"
}
```

### Performance Characteristics

- **Latency**: 0.5-3 seconds (variable based on routing)
- **Token Usage**: Medium (context optional, operator conditional)
- **Learning**: Limited (memory saved, no proactive agents)
- **Accuracy**: Medium (may lack personal context)

---

## Emulation Mode (Replicant)

### Purpose
Stable personality snapshot for demos and testing.

### Behavior

**Routing**: Never uses operator (chat only)
- All messages go directly to chat LLM
- No planning, no skill execution
- Pure conversational model

**Memory**: Captures interactions with `cognitiveMode: "emulation"` metadata (when authenticated)
- **Authenticated users**: Can save memories (tagged with mode)
- **Anonymous users**: Read-only access (cannot save memories)
- Existing memories accessible for conversation

**Context**: Can access existing memories for conversation
- Semantic search available for context
- No new memories created from responses
- Stable personality, no learning

**Learning**: All training and proactive agents are disabled
- No reflections, curiosity, or dreams
- No training data generation
- Frozen personality state

**Use Case**: Demos, sharing access, or testing without engaging the full cognitive pipeline

### Authentication Note

**Anonymous users**:
- Cannot save memories (read-only)
- Cannot create tasks
- Cannot modify files
- Security policy returns `403 Forbidden` for write attempts

**Authenticated users**:
- Can save memories (tagged with `emulation` mode)
- All modes save when logged in
- Operator and training still disabled

### When to Use

- ✅ Testing chat responses without operator overhead
- ✅ Showing the system to others (anonymous demo mode)
- ✅ Faster, simpler conversational interactions
- ✅ Providing a safe, interactive "guest mode"
- ✅ Debugging chat model behavior without operator complexity

### Enforced Security

The system's **Unified Security Policy** enforces authentication-based boundaries:

```typescript
// Anonymous users - read-only
if (user.role === 'anonymous' && mode === 'emulation') {
  // Can read memories, cannot write
  // Cannot create tasks
  // Returns 403 for write attempts
}

// Authenticated users - memory saving enabled
if (user.role === 'authenticated' && mode === 'emulation') {
  // Can save memories (tagged with mode)
  // Operator still disabled
  // Training still disabled
}
```

### Technical Details

```json
{
  "operatorRouting": "chat_only",
  "memoryWriteLevel": "read_only",  // for anonymous, "read_write" for authenticated
  "proactiveAgents": false,
  "trainingPipeline": "disabled",
  "contextRetrieval": "semantic_optional"
}
```

### Audit Tracking

All blocked write attempts:
```json
{
  "event": "write_attempt_blocked",
  "cognitiveMode": "emulation",
  "actor": "anonymous",
  "reason": "emulation_mode_read_only"
}
```

All successful chat operations:
```json
{
  "event": "chat_message",
  "cognitiveMode": "emulation",
  "usedOperator": false,
  "memoryWriteAttempted": false
}
```

### Performance Characteristics

- **Latency**: 0.3-1 second (fastest mode)
- **Token Usage**: Low (chat only, no operator)
- **Learning**: None (frozen personality)
- **Accuracy**: Medium (stable but not personalized)

---

## Mode Switching

### Via Web UI

1. Look at the header (top of the page)
2. Click the cognitive mode selector
3. Choose your desired mode:
   - 🧠 **Dual Consciousness** (purple glow)
   - 🛠️ **Agent Mode** (blue)
   - 🪄 **Emulation** (amber)
4. Mode switches instantly and persists across sessions

### Via API

**Get current mode:**
```bash
curl http://localhost:4321/api/cognitive-mode
```

**Set mode:**
```bash
curl -X POST http://localhost:4321/api/cognitive-mode \
  -H "Content-Type: application/json" \
  -d '{"mode": "dual"}'
```

**Response:**
```json
{
  "mode": "dual",
  "changedAt": "2025-01-15T10:30:00Z",
  "changedBy": "greggles"
}
```

### Mode Persistence

- Current mode stored in `persona/cognitive-mode.json`
- Full history of mode changes tracked
- Survives page reloads and system restarts
- Per-user configuration (isolated profiles)

**Config file structure:**
```json
{
  "currentMode": "dual",
  "history": [
    {
      "mode": "dual",
      "timestamp": "2025-01-15T10:30:00Z",
      "actor": "greggles"
    },
    {
      "mode": "agent",
      "timestamp": "2025-01-14T15:20:00Z",
      "actor": "greggles"
    }
  ]
}
```

---

## Mode Comparison Table

| Feature | Dual Consciousness | Agent Mode | Emulation |
|---------|-------------------|------------|-----------|
| **Operator Pipeline** | Always | Heuristic | Never |
| **Memory Writes** | Full | Full (auth only) | Auth only |
| **Context Grounding** | Required | Optional | Optional |
| **Proactive Agents** | Enabled | Disabled | Disabled |
| **Training Pipeline** | Active | Disabled | Disabled |
| **Use Case** | Full system | Quick assistant | Demo/testing |
| **Speed** | Slower | Faster | Fastest |
| **Learning** | Yes | Limited | No |
| **Token Usage** | High | Medium | Low |
| **Latency** | 2-5s | 0.5-3s | 0.3-1s |
| **Accuracy** | Highest | Medium | Medium |
| **Anonymous Access** | No | No | Yes (read-only) |

---

## Advanced: Fallback Context

### Dual Mode Robustness

When semantic index is unavailable, Dual Mode automatically provides fallback grounding:

1. **Core persona identity** (name, role, purpose)
2. **Communication style and values**
3. **Recent reflections** (last 2)
4. **Current goals and priorities**

This prevents empty context and ensures grounded responses even without the index.

### Warning Logged

```
[DUAL MODE] No semantic index available - memory grounding degraded
```

### Audit Event

```json
{
  "event": "dual_mode_missing_index",
  "level": "warn",
  "details": {
    "message": "Semantic index unavailable, using persona fallback",
    "fallbackSources": ["persona_core", "recent_reflections"]
  }
}
```

---

## Implementation Details

### Core Modules

**Cognitive Mode Manager**:
- `packages/core/src/cognitive-mode.ts`
- Functions: `loadCognitiveMode()`, `saveCognitiveMode()`, `getModeDefinition()`

**Config File**:
- `persona/cognitive-mode.json` (per-user)

**Chat Integration**:
- `apps/site/src/pages/api/persona_chat.ts`
- Mode-aware routing logic

**UI Controls**:
- Mode selector in `ChatLayout.svelte` header
- Visual indicators and color coding

**Node Graphs**:
- Visual workflows in `etc/cognitive-graphs/<mode>-mode.json`
- Each mode has a dedicated execution graph

### Security Integration

All mode switches are fully audited with actor tracking:

```json
{
  "event": "cognitive_mode_changed",
  "level": "info",
  "category": "action",
  "details": {
    "previousMode": "agent",
    "newMode": "dual",
    "actor": "greggles",
    "timestamp": "2025-01-15T10:30:00Z"
  }
}
```

### Mode Validation

The system validates mode transitions:
- Anonymous users cannot switch from emulation mode
- Owner-only mode changes (configurable in security policy)
- Graceful degradation if mode files are corrupted

---

## Node-Based Execution

Each cognitive mode is implemented as a **visual node graph** that defines its exact processing pipeline:

### Dual Mode Graph

```
User Message
  ↓
Semantic Search (required)
  ↓
Persona Context Builder
  ↓
Operator (ReAct loop)
  ↓
Skill Execution
  ↓
Narrator (final response)
  ↓
Memory Save (tagged: dual)
```

### Agent Mode Graph

```
User Message
  ↓
Routing Decision (heuristic)
  ├─ Simple Query → Direct Chat → Response
  └─ Action Request → Operator → Skills → Response
  ↓
Memory Save (tagged: agent)
```

### Emulation Mode Graph

```
User Message
  ↓
Optional Semantic Search
  ↓
Persona Chat (no operator)
  ↓
Response
  ↓
Memory Save (if authenticated, tagged: emulation)
```

**Graph Files**: `etc/cognitive-graphs/*.json`

---

## Best Practices

### Choosing the Right Mode

**Use Dual Mode when**:
- You're using the system daily for real work
- You want to build a deep personality model
- Tasks require multi-step reasoning
- Memory grounding is important

**Use Agent Mode when**:
- You need quick answers without overhead
- You're in a hurry and don't need learning
- Testing new features or experimenting
- You want faster responses

**Use Emulation Mode when**:
- Showing the system to guests (anonymous access)
- Testing chat behavior without complexity
- You want the fastest possible responses
- Demonstrating without engaging learning

### Training Considerations

**LoRA Training Differentiation**:
- Memories are tagged with `cognitiveMode` metadata
- Training pipeline can filter by mode
- Dual-mode memories prioritized for personality training
- Agent-mode memories used for task understanding
- Emulation-mode memories excluded from training

**Example filter**:
```bash
# Train only on dual-mode conversations
./bin/mh fine-tune --mode dual --max 3000
```

---

## Troubleshooting

### Mode Switch Doesn't Persist

**Issue**: Mode reverts after page reload

**Solution**:
1. Check write permissions on `persona/cognitive-mode.json`
2. Verify user is authenticated (anonymous users can't persist)
3. Check audit logs for `cognitive_mode_save_failed` events

### Dual Mode Always Uses Fallback

**Issue**: Warning "No semantic index available" every time

**Solution**:
1. Build semantic index: `./bin/mh index build`
2. Verify index exists: `ls -la memory/index/`
3. Check Ollama is running: `./bin/mh ollama status`

### Agent Mode Always Uses Operator

**Issue**: Even simple queries go through operator

**Solution**:
1. Check heuristic settings in `etc/runtime.json`
2. Verify message doesn't contain action keywords
3. Review audit logs for routing decisions

### Emulation Mode Allows Writes

**Issue**: Anonymous user can save memories in emulation mode

**Solution**:
1. This is a bug - anonymous should be read-only
2. Check security policy enforcement
3. Verify user role detection in authentication

---

## Related Documentation

- **[Core Concepts](04-core-concepts-new.md)** - Overview of all subsystems
- **[Reasoning Engine](04d-reasoning-engine.md)** - Operator ReAct pattern details
- **[Security & Trust](../10-security-trust.md)** - Permission enforcement
- **[Multi-User Profiles](../19-multi-user-profiles.md)** - User isolation and roles
- **[Configuration Files](../14-configuration-files.md)** - cognitive-mode.json reference
- **[Node-Based System](../28-node-based-cognitive-system.md)** - Visual workflow graphs

---

**Master cognitive modes to adapt MetaHuman OS to your needs!** 🧠
