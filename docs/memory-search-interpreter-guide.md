# Memory Search Interpreter Node Guide

## Overview

The Memory Search Interpreter is a critical component in MetaHuman OS's cognitive pipeline that evaluates whether memory search results actually answer a user's question. It acts as a quality filter between raw search results and the AI's response generation, preventing hallucinations when no relevant information exists in memory.

## Purpose

The search interpreter serves three main purposes:

1. **Relevance Filtering**: Evaluates which memories are actually relevant to the user's query
2. **Uncertainty Expression**: Identifies what information is unknown or unclear
3. **Meta-Memory Detection**: Distinguishes between memories OF questions versus actual answers

## How It Works

### Input Processing

The node receives:
- **Search Results**: Raw memories from vector/keyword search
- **User Query**: The original question 
- **Orchestrator Intent**: Optional hints about query type

### Relevance Evaluation

Each memory is categorized into four levels:

```
high     - Directly answers the question
partial  - Contains some relevant information  
low      - Tangentially related
none     - Not relevant
```

### Processing Pipeline

```
User Query: "What's Sarah's favorite coffee?"
    ↓
[Memory Search] → 8 results mentioning "Sarah" or "coffee"
    ↓
[Search Interpreter]
    ├─ Evaluates each memory with LLM
    ├─ Filters by relevance
    └─ Generates summary
    ↓
Output: Filtered memories + confidence score
```

## Configuration

The node exposes two settings:

```typescript
{
  relevanceThreshold: 0.6,  // Min score for low-relevance inclusion
  maxResults: 5            // Max memories to return
}
```

## Examples

### Example 1: Direct Answer Found

**Query**: "What project is Sarah working on?"

**Search Results**:
```json
[
  {
    "content": "Had a meeting with Sarah about her new ML project for customer segmentation",
    "timestamp": "2025-12-20T10:30:00Z",
    "score": 0.92
  },
  {
    "content": "Sarah mentioned she's struggling with the clustering algorithm",
    "timestamp": "2025-12-19T14:15:00Z",
    "score": 0.87
  },
  {
    "content": "Lunch with Mike and Sarah at the cafeteria",
    "timestamp": "2025-12-18T12:00:00Z",
    "score": 0.65
  }
]
```

**Interpreter Output**:
```json
{
  "relevantMemories": [
    {
      "memory": { /* first memory */ },
      "relevance": "high",
      "relevanceScore": 0.95,
      "uncertainty": null
    },
    {
      "memory": { /* second memory */ },
      "relevance": "high",
      "relevanceScore": 0.90,
      "uncertainty": null
    }
  ],
  "hasRelevantResults": true,
  "hasPartialResults": false,
  "unknownSignal": false,
  "summary": "Sarah is working on an ML project for customer segmentation, specifically dealing with clustering algorithm challenges",
  "confidence": 0.92
}
```

### Example 2: No Relevant Information

**Query**: "What's Sarah's favorite coffee?"

**Search Results**:
```json
[
  {
    "content": "Met Sarah at Starbucks to discuss the project",
    "timestamp": "2025-12-15T09:00:00Z",
    "score": 0.75
  },
  {
    "content": "Sarah was late because the coffee machine broke",
    "timestamp": "2025-12-10T08:30:00Z",
    "score": 0.68
  },
  {
    "content": "I ordered a cappuccino while waiting for Sarah",
    "timestamp": "2025-12-08T10:00:00Z",
    "score": 0.62
  }
]
```

**Interpreter Output**:
```json
{
  "relevantMemories": [],
  "hasRelevantResults": false,
  "hasPartialResults": false,
  "unknownSignal": true,
  "summary": "Found memories of meetings with Sarah at coffee shops, but no specific information about her coffee preferences",
  "confidence": 0.2
}
```

### Example 3: Meta-Memory Detection

**Query**: "What's the weather like?"

**Search Results**:
```json
[
  {
    "content": "User asked: 'What's the weather like?' I don't have access to real-time weather",
    "timestamp": "2025-12-18T16:00:00Z",
    "score": 0.89
  },
  {
    "content": "Discussed plans for tomorrow depending on weather",
    "timestamp": "2025-12-17T20:00:00Z",
    "score": 0.71
  }
]
```

**Interpreter Output**:
```json
{
  "relevantMemories": [],
  "hasRelevantResults": false,
  "hasPartialResults": false,
  "unknownSignal": true,
  "summary": "Found a previous instance of asking about weather, but no actual weather information stored in memory",
  "confidence": 0.1
}
```

### Example 4: Partial Information

**Query**: "What are all of Sarah's skills?"

**Search Results**:
```json
[
  {
    "content": "Sarah demonstrated excellent Python skills during code review",
    "timestamp": "2025-12-19T11:00:00Z",
    "score": 0.88
  },
  {
    "content": "Sarah mentioned she's learning React",
    "timestamp": "2025-12-16T15:30:00Z",
    "score": 0.82
  },
  {
    "content": "Team meeting notes: Sarah, Mike, and John attending",
    "timestamp": "2025-12-14T10:00:00Z",
    "score": 0.55
  }
]
```

**Interpreter Output**:
```json
{
  "relevantMemories": [
    {
      "memory": { /* Python skills memory */ },
      "relevance": "partial",
      "relevanceScore": 0.85,
      "uncertainty": "This shows some of Sarah's skills but likely not comprehensive"
    },
    {
      "memory": { /* React learning memory */ },
      "relevance": "partial", 
      "relevanceScore": 0.80,
      "uncertainty": "Learning status, not confirmed skill"
    }
  ],
  "hasRelevantResults": false,
  "hasPartialResults": true,
  "unknownSignal": false,
  "summary": "Found evidence of Python skills and React learning, but this is likely an incomplete picture of all Sarah's skills",
  "confidence": 0.6
}
```

## Integration Points

### 1. Memory Router Connection

The search interpreter receives results from the memory router, which performs:
- **Semantic search**: Vector similarity using embeddings
- **Keyword fallback**: When semantic index unavailable
- **Tiered results**: shallow(4), normal(8), deep(12), exhaustive(20)

### 2. Downstream Usage

The interpreter's output feeds into:

**Context Builder Node**:
- Uses `unknownSignal` to trigger "I don't know" responses
- Incorporates relevant memories into context

**Response Synthesizer**:
- Uses `summary` field to express uncertainty
- Adjusts confidence based on interpreter results

**Quality Scorer**:
- May penalize responses when `confidence` is low

## Best Practices

### 1. Relevance Threshold Tuning

```typescript
// Strict filtering - only high confidence
node.config.relevanceThreshold = 0.8;

// Permissive - include more tangential results  
node.config.relevanceThreshold = 0.4;
```

### 2. Handling Unknown Signals

```typescript
if (interpretation.unknownSignal) {
  // Generate "I don't know" response
  // Avoid hallucination
} else if (interpretation.hasPartialResults) {
  // Express uncertainty
  // "Based on what I remember..."
} else if (interpretation.hasRelevantResults) {
  // Confident response with grounding
}
```

### 3. Memory Tier Selection

For different query types:
- **Specific facts**: Use `shallow` tier (4 results)
- **General topics**: Use `normal` tier (8 results)  
- **Comprehensive search**: Use `deep` tier (12 results)
- **Research queries**: Use `exhaustive` tier (20 results)

## Common Patterns

### Pattern 1: Fact Checking
```
Query: "What did I tell Sarah about the deadline?"
→ Search: Keywords ["Sarah", "deadline", "told"]
→ Interpret: High relevance only
→ Response: Grounded in specific memory
```

### Pattern 2: Exploratory Questions
```
Query: "What do I know about Sarah?"
→ Search: Semantic embedding of "Sarah"
→ Interpret: Include partial relevance
→ Response: Comprehensive summary
```

### Pattern 3: Negative Knowledge
```
Query: "Have I met Sarah's manager?"
→ Search: ["Sarah", "manager", "met"]
→ Interpret: No relevant results
→ Response: "I don't have any memories of meeting Sarah's manager"
```

## Troubleshooting

### Issue: Too Many False Positives
**Solution**: Increase `relevanceThreshold` to 0.7-0.8

### Issue: Missing Relevant Results  
**Solution**: Decrease `relevanceThreshold` to 0.4-0.5

### Issue: Slow Processing
**Solution**: Reduce `maxResults` or use smaller memory tier

### Issue: Hallucinations Despite unknownSignal
**Check**: Ensure downstream nodes respect the signal

## Advanced Usage

### Custom Relevance Logic

The node can be extended with custom relevance evaluators:

```typescript
// Add domain-specific relevance rules
if (memory.type === 'calendar_event' && query.includes('meeting')) {
  relevanceScore *= 1.2; // Boost calendar results for meeting queries
}
```

### Confidence Calibration

Fine-tune confidence calculation:

```typescript
// Higher confidence for recent memories
const recencyBoost = getRecencyScore(memory.timestamp);
confidence = baseConfidence * (1 + recencyBoost * 0.2);
```

## Summary

The Memory Search Interpreter is essential for:
- Preventing hallucinations through relevance filtering
- Expressing appropriate uncertainty
- Distinguishing memories OF questions from actual answers
- Providing grounded, confidence-calibrated responses

By properly configuring and understanding this node, you can ensure MetaHuman OS provides accurate, memory-grounded responses while appropriately expressing uncertainty when information is not available.