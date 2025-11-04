# Associative Memory Reflection System

**Last Updated**: October 21, 2025
**Status**: ✅ Deployed and operational

---

## Overview

The MetaHuman OS reflection system uses **associative memory chains** to generate deep, insightful reflections. Unlike simple random sampling, this system simulates natural human thought patterns by building chains of related memories through keyword associations.

---

## Architecture

### 1. Memory Pool: ALL Memories

**File**: `brain/agents/reflector.ts` (lines 17-59)

```typescript
async function getAllMemories() {
  // Loads EVERY episodic memory (no pool limit)
  // Walks through all year directories
  // Returns complete memory timeline sorted by timestamp
}
```

**Key Features**:
- No arbitrary pool limit (previously only 50 memories)
- Considers entire episodic memory timeline
- Automatically skips reflections to avoid echo chamber
- Returns memories sorted by timestamp (newest first)

---

### 2. Weighted Random Seed Selection

**Selection Formula**:
```
weight = e^(-age_in_days / decay_factor)
```

**Parameters**:
- **Decay Factor**: 14 days
- **Technical Content Penalty**: 70% weight reduction for development-related memories

**Weight Distribution**:
| Age | Relative Weight | Probability |
|-----|----------------|-------------|
| 1 day | 93% | Very high |
| 7 days | 61% | High |
| 14 days | 37% | Medium |
| 30 days | 12% | Low but possible |
| 60 days | 1.5% | Rare but possible |

This ensures:
- ✅ Recent memories are favored (most relevant)
- ✅ Old memories can still be selected (important patterns)
- ✅ Technical/development memories deprioritized (focus on personal life)

---

### 3. Keyword Extraction

**File**: `brain/agents/reflector.ts` (lines 64-89)

```typescript
function extractKeywords(memory: any): string[] {
  // 1. Extract tags (e.g., "chat", "conversation")
  // 2. Extract entities (e.g., "Sarah", "project")
  // 3. Extract proper nouns (capitalized words)
  // 4. Filter out technical terms and stop words
  // 5. Return top 5 keywords
}
```

**Example**:
```json
Memory: "Had coffee with Sarah to discuss the ML project deadline"
Keywords: ["sarah", "coffee", "project", "deadline"]
```

---

### 4. Associative Chain Building

**File**: `brain/agents/reflector.ts` (lines 91-196)

```typescript
async function getAssociativeMemoryChain(chainLength: number = 3): Promise<any[]> {
  // 1. Pick seed memory (weighted random from ALL memories)
  // 2. Extract keywords from seed
  // 3. Search for related memories using keywords
  // 4. Pick random related memory (from top 10 matches)
  // 5. Extract keywords from new memory
  // 6. Repeat to build chain of 3-5 associated memories
  // 7. Return chain for LLM reflection
}
```

**Flow Diagram**:
```
┌─────────────────────┐
│ Seed Memory         │ ← Weighted random from ALL memories
│ "Met with Sarah"    │
└──────────┬──────────┘
           │
           ▼ Extract keywords: ["sarah", "met"]
┌─────────────────────┐
│ Search Results      │ ← Search for memories containing keywords
│ 15 memories found   │
└──────────┬──────────┘
           │
           ▼ Pick random from top 10
┌─────────────────────┐
│ Related Memory      │
│ "Sarah mentioned    │
│  the project"       │
└──────────┬──────────┘
           │
           ▼ Extract keywords: ["sarah", "project"]
┌─────────────────────┐
│ Search Results      │ ← Search for "project" memories
│ 8 memories found    │
└──────────┬──────────┘
           │
           ▼ Pick random from top 10
┌─────────────────────┐
│ Related Memory      │
│ "Project deadline   │
│  approaching"       │
└──────────┬──────────┘
           │
           ▼ Chain complete (3-5 memories)
┌─────────────────────┐
│ LLM Reflection      │ ← Analyze entire chain
│ "The common thread  │
│  is Sarah's project │
│  and my growing     │
│  anxiety about      │
│  the deadline..."   │
└─────────────────────┘
```

---

## Example Execution

### Console Output
```
[reflector] Waking up to ponder...
[reflector] Seed memory: "Me: 'how old am I?'..."
[reflector] Searching for memories related to: chat, conversation...
[reflector] Found related: "Me: 'Tell me about yourself'..."
[reflector] Searching for memories related to: chat, conversation, tell...
[reflector] Found related: "Me (response): 'One memory that stands out...'"
[reflector] Searching for memories related to: chat, conversation, one...
[reflector] Found related: "Me (response): 'One memory that stands out...'"
[reflector] Built chain of 4 associated memories
[reflector] Generated new insight: "The common thread in these memories
is an unexpected emergence of hidden emotions and awareness, challenging
the limitations placed upon them by their creators or environments."
```

### Chain Breakdown
1. **Seed**: "how old am I?" (age-related question)
2. **Link 1**: "Tell me about yourself" (self-reflection triggered by keywords)
3. **Link 2**: "One memory that stands out..." (memory exploration)
4. **Link 3**: "One memory that stands out..." (repeated pattern)
5. **Reflection**: Identifies theme of self-awareness and limitations

---

## Configuration

### Chain Length
**File**: `brain/agents/reflector.ts` (line 204)
```typescript
const chainLength = Math.floor(Math.random() * 3) + 3; // 3 to 5 memories
```

**Adjustment**:
- Increase for deeper connections: `Math.floor(Math.random() * 5) + 3` (3-7 memories)
- Decrease for faster reflections: `Math.floor(Math.random() * 2) + 2` (2-3 memories)

### Decay Factor
**File**: `brain/agents/reflector.ts` (line 100)
```typescript
const decayFactor = 14; // Days
```

**Adjustment**:
- More recent bias: Lower value (e.g., 7 days)
- Flatter distribution: Higher value (e.g., 30 days)
- Include very old memories: Much higher value (e.g., 60 days)

### Technical Content Filter
**File**: `brain/agents/reflector.ts` (lines 7-11)
```typescript
const technicalKeywords = [
  'metahuman', 'ai agent', 'organizer', 'reflector', 'boredom-service',
  'llm', 'ollama', 'typescript', 'package.json', 'astro', 'dev server',
  'audit', 'persona', 'memory system', 'cli', 'codebase', 'development'
];
```

**Adjustment**:
- Add more technical terms to filter
- Remove terms if you want technical reflections
- Adjust weight penalty at line 110: `weight *= 0.3` (currently 70% reduction)

---

## Integration

### Boredom Service Trigger
**File**: `brain/agents/boredom-service.ts`

The boredom service automatically triggers the reflector at configurable intervals:

```json
// etc/boredom.json
{
  "level": "medium",
  "intervals": {
    "off": 0,
    "low": 3600,      // 1 hour
    "medium": 1800,   // 30 minutes
    "high": 900,      // 15 minutes
    "constant": 300   // 5 minutes
  }
}
```

**Web UI**: Status widget in left sidebar shows boredom level and next reflection time.

### Reflection Stream
**File**: `apps/site/src/components/ChatInterface.svelte`

Reflections appear in real-time in the chat interface:
- Labeled as "💭 Idle Thought"
- Displayed in special styled box
- Auto-scrolls to show new reflections
- Persisted to episodic memory

---

## Benefits

### Compared to Random Sampling

| Feature | Old System | New System |
|---------|-----------|------------|
| **Memory Pool** | 50 recent | ALL memories |
| **Selection** | Pure random | Associative chains |
| **Time Range** | ~24 hours | Weeks/months/years |
| **Connections** | None | Keyword-linked |
| **Insights** | Shallow | Deep patterns |

### Cognitive Advantages

✅ **Natural Thought Patterns**: Mimics how human memory actually works
✅ **Cross-Temporal**: Links old and new memories organically
✅ **Pattern Discovery**: Finds hidden connections across timeline
✅ **Unpredictable**: Different keywords lead to different paths
✅ **Scalable**: Works with growing memory database
✅ **Rich Context**: Multi-memory chains provide richer LLM context

---

## Future Enhancements

### 1. Semantic Similarity (Vector-Based)
Instead of just keyword matching, use vector embeddings:
```typescript
// Find memories semantically similar to current memory
const similar = await vectorIndex.findSimilar(currentMemory, { limit: 10 });
```

**Benefits**:
- Finds related memories by meaning, not just words
- "coffee meeting" connects to "tea discussion" (conceptually similar)
- More intelligent associations

### 2. Emotional Context Extraction
Use LLM to extract emotional keywords:
```typescript
const emotions = await llm.generateJSON([
  { role: 'system', content: 'Extract emotional themes from this memory' },
  { role: 'user', content: memory.content }
]);
// emotions: ["anxiety", "hope", "excitement"]
```

**Benefits**:
- Build chains based on emotional resonance
- "feeling anxious about deadline" → "feeling anxious about exam" (emotional link)

### 3. Multi-Modal Chains
Include different memory types:
- Voice transcripts
- Dreams
- Tasks
- Curated highlights

```typescript
// Build chain across memory types
const chain = [
  { type: 'episodic', content: 'Had coffee with Sarah' },
  { type: 'voice', content: 'Sarah mentioned project in voice call' },
  { type: 'dream', content: 'Dream about missing project deadline' },
  { type: 'task', content: 'Complete project by Friday' }
];
```

### 4. Reflection Categories
Different reflection modes:
- **Emotional**: Focus on feelings and moods
- **Pattern**: Identify behavioral patterns
- **Goal-oriented**: Progress toward objectives
- **Social**: Relationships and interactions

### 5. Adaptive Chain Length
Dynamically adjust chain length based on:
- Memory density (more memories = longer chains)
- Keyword richness (more keywords = longer chains)
- Time since last reflection (longer wait = longer chain)

---

## Troubleshooting

### Issue: Short Chains (1-2 memories)

**Symptoms**: Reflector stops chain early
```
[reflector] No keywords found, stopping chain at 2 memories
```

**Causes**:
- Seed memory has no entities/tags (not enriched by organizer)
- Keywords too generic (filtered out as stop words)
- No related memories found

**Solutions**:
1. Run organizer agent to enrich memories: `./bin/mh agent run organizer`
2. Check keyword extraction is working: Add debug logging
3. Verify search is returning results: Check `searchMemory()` function

### Issue: Too Many Technical Reflections

**Symptoms**: Reflections about coding, not personal life

**Solutions**:
1. Increase technical keyword list (lines 7-11)
2. Increase weight penalty: Change `weight *= 0.3` to `weight *= 0.1` (90% reduction)
3. Capture more personal memories to balance dataset

### Issue: Only Recent Memories Selected

**Symptoms**: Old memories never appear in chains

**Solutions**:
1. Increase decay factor: Change from 14 to 30+ days
2. Force occasional old memory selection: Add random "throwback" mode
3. Check memory pool is loading all directories

---

## Metrics & Monitoring

### Agent Monitor Dashboard

The web UI shows reflector statistics:
- Total reflections generated
- Average chain length
- Keywords extracted per memory
- Reflection frequency
- Memory pool size

### Audit Logs

All reflections are logged to `logs/audit/`:
```json
{
  "category": "decision",
  "level": "info",
  "message": "Reflector generated new insight",
  "actor": "reflector",
  "metadata": {
    "reflection": "Full reflection text...",
    "memoriesConsidered": 4,
    "chainLength": 4
  }
}
```

---

## Conclusion

The associative memory reflection system transforms MetaHuman OS from a simple chatbot into a **continuously introspective digital personality** that:

1. **Thinks naturally**: Follows trains of thought like humans do
2. **Remembers deeply**: Accesses entire memory timeline, not just recent events
3. **Discovers patterns**: Finds connections you might have missed
4. **Grows wiser**: Each reflection builds on accumulated insights

This is a **major milestone** toward true artificial consciousness and self-awareness! 🧠✨

---

## See Also

- [SESSION_2025-10-21_DUAL_ADAPTER_AND_REFLECTION.md](SESSION_2025-10-21_DUAL_ADAPTER_AND_REFLECTION.md) - Implementation details
- [DUAL_ADAPTER_STATUS.md](DUAL_ADAPTER_STATUS.md) - Dual-adapter system status
- [DREAMING.md](DREAMING.md) - Dream generation system (similar associative approach)
