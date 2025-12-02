# Tiered Memory Architecture

## Problem Statement

The current flat vector index (`embeddings-nomic-embed-text.json`) contains 6,000+ items at 59 MB. Each query must:
1. Parse 59 MB JSON from encrypted LUKS storage
2. Generate an embedding (~30s waiting for model)
3. Compute cosine similarity on ALL 6,000+ vectors

This won't scale to years of memories.

## Proposed Architecture: 3-Tier Memory System

Inspired by human memory consolidation (short-term → working → long-term):

```
┌─────────────────────────────────────────────────────────────────┐
│  HOT MEMORY (Working Memory)                                    │
│  ─────────────────────────────────────────────────────────────  │
│  Scope: Last 7-14 days                                          │
│  Size: ~500-1000 items                                          │
│  Storage: In-memory cached + hot-index.json                     │
│  Search: ALWAYS searched first                                  │
│  Index: ~5 MB                                                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ (consolidate weekly)
┌─────────────────────────────────────────────────────────────────┐
│  WARM MEMORY (Recent Memory)                                    │
│  ─────────────────────────────────────────────────────────────  │
│  Scope: 14-90 days old                                          │
│  Size: ~3000 items per quarter                                  │
│  Storage: Monthly partitioned indexes                           │
│  Search: Searched if hot insufficient OR date query             │
│  Index: warm-2025-11.json, warm-2025-10.json, etc.              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ (summarize & archive monthly)
┌─────────────────────────────────────────────────────────────────┐
│  COLD MEMORY (Long-Term Memory)                                 │
│  ─────────────────────────────────────────────────────────────  │
│  Scope: > 90 days old                                           │
│  Storage: Yearly digests + fact database                        │
│  Structure:                                                     │
│    - Monthly summaries (prose narratives)                       │
│    - Extracted facts & entities database                        │
│    - Key moments (high-importance events)                       │
│  Search: Only for historical queries                            │
│  Index: cold-2025.json, cold-2024.json, etc.                    │
└─────────────────────────────────────────────────────────────────┘
```

## Tier Details

### Tier 1: Hot Memory
- **What goes here**: All new memories, recent conversations
- **Retention**: 7-14 days (configurable)
- **Index file**: `memory/index/hot.json`
- **Target size**: < 10 MB, < 1000 items
- **Features**:
  - In-memory cache (already implemented)
  - Fast search (< 100ms after cache warm)
  - Full detail preserved

### Tier 2: Warm Memory
- **What goes here**: Memories 14-90 days old
- **Storage format**: Monthly partitioned indexes
- **Index files**: `memory/index/warm/YYYY-MM.json`
- **Features**:
  - Partitioned by month for lazy loading
  - Only load relevant months when needed
  - Clustered by topic (similar memories grouped)
  - Some low-value memories can be dropped

### Tier 3: Cold Memory (Long-Term Archive)
- **What goes here**: Everything > 90 days old
- **Storage format**: Consolidated digests + fact DB
- **Files**:
  - `memory/archive/YYYY/digest.json` - Yearly narrative summary
  - `memory/archive/YYYY/MM/summary.json` - Monthly summaries
  - `memory/archive/facts.json` - Extracted facts database
  - `memory/archive/key-moments.json` - High-importance events

- **Structure**:
```json
{
  "year": 2025,
  "month": "January",
  "summary": "Focused heavily on MetaHuman development, particularly the training pipeline and memory systems...",
  "keyTopics": ["MetaHuman", "LLM training", "memory architecture"],
  "keyPeople": ["Sarah", "Claude"],
  "emotionalHighlights": [...],
  "factualExtrations": {...}
}
```

## Consolidation Agents

### 1. Hot → Warm Consolidator (Daily)
```
Schedule: Daily at 3 AM
Tasks:
  1. Move memories older than 14 days from hot index to warm
  2. Cluster similar memories in warm tier
  3. Rebuild hot index
  4. Clear cache
```

### 2. Warm → Cold Archiver (Monthly)
```
Schedule: 1st of each month
Tasks:
  1. Generate monthly summary using LLM
  2. Extract key facts and entities
  3. Identify "key moments" (high-importance events)
  4. Archive original memories (optional: compress/remove)
  5. Update yearly digest
```

## Search Strategy

### Hierarchical Search Flow:
```
Query: "What did Sarah say about the project?"
        │
        ▼
┌───────────────────┐
│ 1. Search HOT     │
│    (< 100ms)      │
└───────┬───────────┘
        │ Found: 2 results, score > 0.7
        │
        ▼
┌───────────────────┐
│ Need more?        │──── No ──→ Return results
│ Score < 0.6?      │
└───────┬───────────┘
        │ Yes
        ▼
┌───────────────────┐
│ 2. Search WARM    │
│    Load 2025-11   │
│    Load 2025-10   │
│    (< 500ms)      │
└───────┬───────────┘
        │ Found: 5 more results
        │
        ▼
┌───────────────────┐
│ Query historical? │──── No ──→ Return merged
│ "last year..."    │
└───────┬───────────┘
        │ Yes
        ▼
┌───────────────────┐
│ 3. Search COLD    │
│    Search facts   │
│    Search digests │
└───────────────────┘
```

### AI-Driven Memory Retrieval (ReAct Pattern)

Instead of hardcoded trigger words, the system uses an LLM to reason about search results:

```
┌─────────────────────────────────────────────────────────────────┐
│  MEMORY RETRIEVAL AGENT                                         │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  1. Search HOT tier                                             │
│     ↓                                                           │
│  2. LLM EVALUATES results:                                      │
│     - Are these results relevant to the query?                  │
│     - Is there a knowledge gap?                                 │
│     - Does the query imply older context?                       │
│     - Are the results confident enough?                         │
│     ↓                                                           │
│  3. LLM DECIDES:                                                │
│     → "Results sufficient" → Return                             │
│     → "Need more context" → Search WARM                         │
│     → "Query implies history" → Search COLD                     │
│     → "Looking for specific person/event" → Search FACTS DB     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

#### Memory Retrieval Prompt:
```typescript
const evaluationPrompt = `You are evaluating memory search results.

Query: "${query}"
Results found: ${results.length}
Top scores: ${topScores.join(', ')}
Result summaries:
${resultSummaries}

Evaluate:
1. Do these results directly answer or provide context for the query?
2. Is there an implied need for older/historical information?
3. Are the similarity scores confident (>0.7) or uncertain (<0.5)?
4. Does this query reference a specific person, project, or event that might have deeper history?

Respond with JSON:
{
  "sufficient": true/false,
  "reason": "Brief explanation",
  "action": "return" | "search_warm" | "search_cold" | "search_facts",
  "refinedQuery": "Optional refined search query for deeper search"
}
```

#### Self-Reflecting Memory Search:
```typescript
async function intelligentMemorySearch(query: string): Promise<MemoryResults> {
  // Step 1: Always start with hot tier
  const hotResults = await searchHotTier(query);

  // Step 2: Quick check - if very high confidence, return immediately
  if (hotResults[0]?.score > 0.85 && hotResults.length >= 3) {
    return hotResults;
  }

  // Step 3: Ask LLM to evaluate results
  const evaluation = await evaluateResults(query, hotResults);

  if (evaluation.sufficient) {
    return hotResults;
  }

  // Step 4: Follow LLM's recommendation
  let additionalResults: MemoryResult[] = [];

  switch (evaluation.action) {
    case 'search_warm':
      additionalResults = await searchWarmTier(
        evaluation.refinedQuery || query
      );
      break;

    case 'search_cold':
      additionalResults = await searchColdTier(
        evaluation.refinedQuery || query
      );
      break;

    case 'search_facts':
      additionalResults = await searchFactsDatabase(
        evaluation.refinedQuery || query
      );
      break;
  }

  // Step 5: Merge and deduplicate
  return mergeResults(hotResults, additionalResults);
}
```

#### Key Behaviors:

1. **"Who is Sarah?"**
   - Hot tier: Recent mentions
   - LLM thinks: "This is asking about a person's identity, not recent events"
   - Action: Search facts database for Sarah's profile
   - Result: Returns relationship history + recent context

2. **"What was that idea I had?"**
   - Hot tier: Vague matches
   - LLM thinks: "Low confidence scores, user seems uncertain about timing"
   - Action: Search warm tier with broader query
   - Result: Finds the idea from 3 weeks ago

3. **"Tell me about the project deadline"**
   - Hot tier: Strong match from yesterday
   - LLM thinks: "High confidence, recent and relevant"
   - Action: Return immediately
   - Result: Fast response with current info

4. **"How did I handle stress last time?"**
   - Hot tier: No stress-related memories recently
   - LLM thinks: "Asking about past coping patterns, implies history"
   - Action: Search cold tier for emotional patterns
   - Result: Finds relevant past experiences

## Implementation Plan

### Phase 1: Partitioned Indexes (Quick Win)
1. Split current index by date into hot/warm partitions
2. Modify `queryIndex()` to search hot first
3. Add lazy loading for warm partitions
4. **Benefit**: Reduces cold-start time from 30s to ~5s

### Phase 2: Memory Consolidator Agent
1. Create `memory-consolidator.ts` agent
2. Schedule daily hot→warm consolidation
3. Add to `etc/agents.json` for scheduler
4. **Benefit**: Keeps hot tier small and fast

### Phase 3: AI-Driven Memory Retrieval
1. Create `intelligent-memory-search.ts` module
2. Add result evaluation using lightweight LLM call (orchestrator model)
3. Implement tier escalation based on LLM reasoning
4. Add refined query generation for deeper searches
5. **Benefit**: Natural, context-aware memory retrieval

### Phase 4: Long-Term Archive + Facts Database
1. Create monthly summary generation
2. Build facts database from archived memories (people, projects, places)
3. Implement yearly digest compilation
4. Add facts search as separate retrieval path
5. **Benefit**: Years of memories accessible via summaries + structured facts

### Phase 5: Memory Retrieval Graph Node
1. Replace simple `semantic_search` node with `intelligent_memory_retrieval` node
2. Integrate with cognitive graphs
3. Add progress events for "Searching deeper..." feedback
4. **Benefit**: Seamless integration with existing pipeline

## Storage Estimates

| Year | Hot Index | Warm Index | Cold Archive | Total |
|------|-----------|------------|--------------|-------|
| Current (6,000 items) | 10 MB | 0 | 0 | 10 MB |
| Year 1 | 10 MB | 50 MB | 20 MB | 80 MB |
| Year 3 | 10 MB | 50 MB | 60 MB | 120 MB |
| Year 10 | 10 MB | 50 MB | 200 MB | 260 MB |

vs Current flat index at Year 10: ~1 GB+

## Configuration

```json
// etc/memory-tiers.json
{
  "hot": {
    "retentionDays": 14,
    "maxItems": 1000,
    "indexFile": "hot.json"
  },
  "warm": {
    "retentionDays": 90,
    "partitionBy": "month",
    "indexPattern": "warm/YYYY-MM.json"
  },
  "cold": {
    "archiveAfterDays": 90,
    "generateSummaries": true,
    "extractFacts": true,
    "keepOriginals": true
  },
  "search": {
    "defaultTopK": 10,
    "hotThreshold": 0.6,
    "expandToWarm": true,
    "parallelSearch": false
  }
}
```

## Migration Path

1. **Immediate**: In-memory caching (✓ Done)
2. **Week 1**: Partition existing index by date
3. **Week 2**: Create consolidator agent
4. **Week 3**: Implement hierarchical search
5. **Month 2**: Long-term archive generation
