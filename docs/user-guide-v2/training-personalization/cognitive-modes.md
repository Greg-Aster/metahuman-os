# Cognitive Modes

MetaHuman OS operates in three distinct cognitive modes that control memory recording, operator behavior, proactive agents, and training pipelines. Each mode serves different use cases and trust levels.

## Overview

**Cognitive modes** define how MetaHuman processes your interactions:
- **Memory writes**: What gets saved to episodic memory
- **Operator routing**: When the ReAct operator pipeline is used
- **Proactive agents**: Whether background agents run automatically
- **Training pipeline**: How AI models learn from your interactions

**Three Modes:**
1. **Dual Consciousness** (Default) - Full system capabilities with dual-adapter training
2. **Agent** - Lightweight assistant mode with selective operator use
3. **Emulation** - Read-only demonstration mode with stable personality

## Mode Comparison

| Feature | Dual Consciousness | Agent | Emulation |
|---------|-------------------|-------|-----------|
| **Memory Writes** | Full (all interactions) | Command-only (explicit saves) | Read-only (no writes) |
| **Operator Usage** | Always | Heuristic (smart detection) | Never |
| **Proactive Agents** | Enabled | Disabled | Disabled |
| **Training Pipeline** | Dual-trigger (monthly + manual) | Disabled | Disabled |
| **Recording** | All conversations | Only explicit captures | None |
| **Use Case** | Primary operational mode | Lightweight assistant | Demo/testing |

## Dual Consciousness Mode

**Default operational mode** with full system capabilities.

### Key Behaviors

**Memory Recording:**
- All chat messages saved to episodic memory
- Memories tagged with `metadata.cognitiveMode: "dual"`
- Used for LoRA training to personalize AI responses

**Operator Routing:**
- **Always routes** through ReAct operator pipeline
- Every message goes: planner → skills → narrator
- Mandatory memory grounding via semantic search
- Fallback to persona if no relevant memories

**Proactive Agents:**
- Reflector: Generates internal reflections
- Boredom Maintenance: Triggers reflections after inactivity
- Curiosity Service: Asks user-facing questions
- Inner Curiosity: Self-directed internal questions
- Sleep Service: Manages dream generation

**Training Pipeline:**
- **Dual-trigger**: Monthly automatic + manual training
- Builds dual-adapter system:
  - Historical adapter: All-time consolidated memory
  - Recent adapter: Last 30 days (default)
- Curator agent builds training datasets
- Auto-approval with quality thresholds

### When to Use

- **Primary mode**: Day-to-day interaction with full capabilities
- **Personality evolution**: When you want AI to learn from conversations
- **Proactive assistance**: When you want background agents active
- **Memory building**: When building long-term episodic memory

### Example Workflow

1. User sends message: "What tasks are due today?"
2. **Planner** analyzes intent → routes to task_list skill
3. **Skill** executes: reads active tasks, filters by due date
4. **Narrator** synthesizes: "You have 3 tasks due today: ..."
5. **Memory**: Saves conversation with `cognitiveMode: "dual"`
6. **Training**: Conversation included in next training cycle

## Agent Mode

**Lightweight assistant mode** with selective operator use.

### Key Behaviors

**Memory Recording:**
- Only explicit captures saved (e.g., `mh capture`)
- Chat messages NOT automatically saved
- Memories tagged with `metadata.cognitiveMode: "agent"`

**Operator Routing:**
- **Heuristic-based detection**
- Simple queries → direct chat (no operator)
- Action-oriented messages → operator pipeline
- Examples:
  - "What's the weather?" → Chat only (fast)
  - "Create a task for tomorrow" → Operator + task_create skill
  - "Tell me about yourself" → Chat only

**Detection Heuristics:**
```
Action keywords: create, add, update, delete, find, search, list, show
Intent patterns: imperative verbs, specific requests
Context clues: mentions of tasks, memories, files, agents
```

**Proactive Agents:**
- Disabled (no reflections, curiosity, dreams)

**Training Pipeline:**
- Disabled (no automatic training)
- Stable personality snapshot

### When to Use

- **Reduced cognitive load**: When you don't want full operator overhead
- **Faster responses**: Simple queries bypass operator pipeline
- **Privacy mode**: When you don't want conversations saved
- **Testing**: Experimenting without affecting training data
- **Demonstration**: Showing features without memory writes

### Example Workflow

1. User: "What's 2+2?" → **Chat only** (simple query)
   - Fast response, no operator
   - Not saved to memory

2. User: "Create a task to buy groceries" → **Operator used**
   - Detected: "create" + "task"
   - Routes to operator → task_create skill
   - Task created, but conversation not saved

## Emulation Mode

**Read-only demonstration mode** with stable personality.

### Key Behaviors

**Memory Recording:**
- No writes (read-only)
- Can read existing memories
- Ideal for sharing/demo without modification

**Operator Routing:**
- Never uses operator
- All messages handled by chat only
- Fast, lightweight responses

**Proactive Agents:**
- Disabled

**Training Pipeline:**
- Disabled
- Uses last trained model (frozen personality)

### When to Use

- **Demonstration**: Showing MetaHuman to others
- **Testing**: Experimenting without side effects
- **Snapshot mode**: Using a stable personality version
- **Public sharing**: Safe read-only access
- **Development**: Testing features without affecting data

### Example Workflow

1. User: "What tasks do I have?"
2. Chat reads existing tasks (read-only)
3. Returns list without saving conversation
4. No operator overhead
5. No memory writes

## Switching Modes

### Via Web UI

1. Click **mode dropdown** in header (top-right)
2. Select mode: Dual Consciousness | Agent | Emulation
3. Confirmation: "Switched to [mode] mode"
4. All future interactions use new mode

### Via API

**Endpoint:** `POST /api/cognitive-mode`

**Request Body:**
```json
{
  "mode": "dual"  // or "agent" or "emulation"
}
```

**Response:**
```json
{
  "success": true,
  "mode": "dual",
  "previousMode": "agent",
  "timestamp": "2025-11-25T14:30:22Z"
}
```

### Via CLI

**Check current mode:**
```bash
cat persona/cognitive-mode.json
```

**Manual mode file edit:**
```json
{
  "mode": "dual",
  "history": [
    {
      "mode": "agent",
      "timestamp": "2025-11-25T12:00:00Z",
      "actor": "greggles",
      "reason": "Testing lightweight mode"
    }
  ]
}
```

**Note:** Mode changes require write access (not available to anonymous users).

## Mode Locking

**Special States:**

Some modes are locked for safety or operational reasons:

### High Security Mode
- Locks to emulation or agent mode
- Prevents dual mode (no training on sensitive data)
- Use case: Handling confidential information

### Wetware Deceased
- Locks all modes (read-only memorial)
- Preserves final personality state
- Use case: Digital legacy/memorial mode

**Configuration:** `persona/cognitive-mode.json`
```json
{
  "mode": "emulation",
  "locked": true,
  "lockReason": "high_security_mode",
  "lockedAt": "2025-11-25T14:30:00Z",
  "lockedBy": "system"
}
```

**Unlocking:** Requires owner authentication and explicit unlock action.

## Mode History Tracking

All mode changes are logged with full context:

**Storage:** `persona/cognitive-mode.json`

**History Entry:**
```json
{
  "mode": "agent",
  "timestamp": "2025-11-25T14:30:22Z",
  "actor": "greggles",
  "reason": "Switching to lightweight mode for quick queries",
  "previousMode": "dual"
}
```

**Fields:**
- `mode`: New mode activated
- `timestamp`: When the change occurred
- `actor`: Who made the change (username or 'system')
- `reason`: Optional explanation
- `previousMode`: Mode before switch

**Use Cases:**
- Audit trail for mode switching
- Understanding personality evolution context
- Debugging training data composition
- LoRA training dataset filtering

## Memory Metadata by Mode

Every memory includes `metadata.cognitiveMode` field:

**Example Memory:**
```json
{
  "id": "evt_abc123",
  "type": "conversation",
  "timestamp": "2025-11-25T14:30:00Z",
  "content": {
    "userMessage": "What tasks are due?",
    "assistantMessage": "You have 3 tasks due today..."
  },
  "metadata": {
    "cognitiveMode": "dual",
    "usedOperator": true,
    "processed": true
  }
}
```

**Training Dataset Filtering:**

When building LoRA training datasets, the curator agent can filter by mode:
- Include only `dual` mode memories (full context)
- Exclude `agent` mode (command-only snippets)
- Exclude `emulation` mode (no writes anyway)

**Dataset Quality:**

Dual mode provides highest-quality training data:
- Complete conversations with full context
- Natural interaction patterns
- Operator reasoning included
- Memory-grounded responses

## Best Practices

### For Daily Use (Dual Mode)

1. **Default mode** for primary operations
2. Let proactive agents enrich your experience
3. Build episodic memory naturally through conversation
4. Train monthly for personality evolution
5. Review reflections and curiosity questions

### For Quick Queries (Agent Mode)

1. Switch when you want **fast, lightweight responses**
2. Good for:
   - Quick information lookups
   - Simple calculations or definitions
   - Testing features without memory impact
3. Remember: Only explicit captures are saved
4. Operator used only for action-oriented requests

### For Demonstrations (Emulation Mode)

1. Use when showing MetaHuman to others
2. Safe read-only access (no accidental writes)
3. Stable personality (uses last trained model)
4. No background agents (predictable behavior)
5. Fast responses (no operator overhead)

### For Privacy

**Agent Mode:**
- Conversations not saved
- Only explicit captures recorded
- Good for sensitive topics you don't want in training data

**Emulation Mode:**
- No writes at all
- Pure read-only access
- Use for public demos or untrusted environments

## Technical Details

### Mode Definition Structure

**Source:** `packages/core/src/cognitive-mode.ts`

```typescript
const MODE_DEFINITIONS: Record<CognitiveModeId, CognitiveModeDefinition> = {
  dual: {
    defaults: {
      recordingEnabled: true,
      proactiveAgents: true,
      trainingPipeline: 'dual_trigger',
      memoryWriteLevel: 'full',
    },
  },
  agent: {
    defaults: {
      recordingEnabled: false,
      proactiveAgents: false,
      trainingPipeline: 'disabled',
      memoryWriteLevel: 'command_only',
    },
  },
  emulation: {
    defaults: {
      recordingEnabled: false,
      proactiveAgents: false,
      trainingPipeline: 'disabled',
      memoryWriteLevel: 'read_only',
    },
  },
};
```

### Memory Write Levels

- **full**: All interactions saved
- **command_only**: Only explicit captures (e.g., `mh capture`)
- **read_only**: No writes, reads allowed

### Training Pipeline Options

- **dual_trigger**: Monthly automatic + manual training
- **manual_only**: Only user-initiated training
- **disabled**: No training

### Operator Routing Logic

**Dual Mode:**
```typescript
if (cognitiveMode === 'dual') {
  // Always use operator
  return await runOperator(message);
}
```

**Agent Mode:**
```typescript
if (cognitiveMode === 'agent') {
  const isAction = detectActionIntent(message);
  if (isAction) {
    return await runOperator(message);
  }
  return await chatWithPersona(message);
}
```

**Emulation Mode:**
```typescript
if (cognitiveMode === 'emulation') {
  // Never use operator
  return await chatWithPersona(message);
}
```

## Troubleshooting

### Can't Switch Modes

**Cause:** Not authenticated or in emulation mode
**Solution:**
- Must be logged in as owner
- Emulation mode users cannot switch modes (read-only)
- Check authentication status

### Mode Switch Not Taking Effect

**Cause:** Cache or session issue
**Solution:**
1. Refresh browser page
2. Check `persona/cognitive-mode.json` for current mode
3. Verify mode change in header dropdown

### Training Not Happening in Dual Mode

**Cause:** Training pipeline configuration
**Solution:**
1. Check `etc/training.json` for `monthly_training: true`
2. Verify enough memories collected (min 100)
3. Check agent logs: `./bin/mh agent status`
4. Review `logs/audit/` for training events

### Operator Not Being Used in Agent Mode

**Cause:** Message not detected as action-oriented
**Solution:**
- Use explicit action verbs: "create", "add", "update", "list"
- Be specific: "List my tasks" instead of "What's up?"
- Check audit logs for operator usage: `usedOperator: true/false`

### Proactive Agents Running in Agent Mode

**Cause:** Mode configuration not applied to scheduler
**Solution:**
1. Check `etc/agents.json` for proactive agent status
2. Restart scheduler: `./bin/mh agent stop scheduler-service && ./bin/mh agent run scheduler-service`
3. Verify agents stopped: `./bin/mh agent ps`

## Next Steps

- Configure [AI Training](ai-training.md) for dual-adapter personality evolution
- Adjust [Persona Editor](persona-editor.md) for mode-specific behaviors
- Set up [Autonomous Agents](../advanced-features/autonomous-agents.md) for dual mode
- Review [Dashboard](../using-metahuman/dashboard-monitoring.md) for mode status
