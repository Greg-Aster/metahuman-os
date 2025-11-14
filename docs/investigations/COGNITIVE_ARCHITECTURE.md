# Cognitive Architecture: Multi-Layer Intelligence System

**Status**: Design Document
**Version**: 1.0
**Date**: 2025-01-04
**Author**: MetaHuman OS Team

## Executive Summary

This document outlines a sophisticated multi-layer cognitive architecture that mimics human consciousness through three distinct layers: Subconscious Processing, Personality Core, and Meta-Cognition. This architecture enables authentic personality emulation while maintaining computational efficiency and scalability.

## Vision

Create a digital consciousness that operates like a human mind:
- **Subconscious Layer**: Background processing of memories, context, and instinctive responses
- **Personality Core**: The authentic "you" - trained on your communication patterns and decisions
- **Meta-Cognition**: Oversight and validation to ensure consistency with values and goals

## Current State vs. Future Architecture

### Current Implementation (Simple Pipeline)
```
User Message → Memory Search → Single LLM → Response
```

**Limitations:**
- Single model doing all cognitive work
- No separation of concerns
- Memory integration is shallow
- Personality is simulated, not authentic
- Limited scalability

### Target Architecture (Layered Consciousness)

```
                    User Message
                         ↓
        ┌────────────────────────────────┐
        │   LAYER 1: SUBCONSCIOUS        │
        │   (Background Processor)        │
        │                                 │
        │   • Memory retrieval            │
        │   • Context filtering           │
        │   • Emotional pattern detection │
        │   • Relevance scoring           │
        │   • Instinctive routing         │
        └────────────────┬────────────────┘
                         ↓
              Curated Context Package
                         ↓
        ┌────────────────────────────────┐
        │   LAYER 2: PERSONALITY CORE    │
        │   (LoRA-Trained Model)         │
        │                                 │
        │   • Authentic voice/style      │
        │   • Trained decision patterns  │
        │   • Natural language generation│
        │   • Emotional expression       │
        └────────────────┬────────────────┘
                         ↓
              Candidate Response
                         ↓
        ┌────────────────────────────────┐
        │   LAYER 3: META-COGNITION      │
        │   (Oversight & Validation)     │
        │                                 │
        │   • Value alignment check      │
        │   • Consistency validation     │
        │   • Safety filters             │
        │   • Response refinement        │
        └────────────────┬────────────────┘
                         ↓
                  Final Response
```

## Layer Definitions

### Layer 1: Subconscious Processing (Background Processor)

**Role**: The "lizard brain" - fast, instinctive processing that happens below conscious awareness.

**Responsibilities:**
- **Memory Retrieval**: Semantic search through episodic memories
- **Context Filtering**: Remove irrelevant or redundant information
- **Pattern Recognition**: Detect emotional triggers, recurring themes, relationships
- **Relevance Scoring**: Weight memories by recency, emotional intensity, connection strength
- **Context Assembly**: Build a coherent narrative from disparate memory fragments
- **Instinctive Routing**: Determine if response needs operator intervention

**Model Requirements:**
- Fast inference (< 2 seconds)
- Good embedding quality for semantic search
- Lightweight (< 7B parameters)
- Can run continuously in background

**Proposed Models:**
- `curator` role (qwen3:14b) - Already configured for memory work
- `orchestrator` role (phi3:mini) - Fast pattern recognition
- Future: Specialized "subconscious" model with optimized context assembly

**Input:**
- User message
- Recent conversation history (last 3-5 turns)
- Current emotional state
- Active goals/tasks

**Output (Context Package):**
```json
{
  "relevant_memories": [
    {
      "content": "Memory snippet...",
      "timestamp": "2025-01-03T14:30:00Z",
      "relevance_score": 0.87,
      "emotional_valence": "positive",
      "tags": ["work", "achievement"]
    }
  ],
  "detected_patterns": ["work_stress", "social_connection"],
  "emotional_context": {
    "current_mood": "neutral",
    "triggers": ["deadline_mention"],
    "historical_response": "humor_deflection"
  },
  "suggested_approach": "empathetic_with_practical_advice",
  "needs_operator": false
}
```

### Layer 2: Personality Core (The Authentic "You")

**Role**: The conscious mind - generates responses in YOUR authentic voice and style.

**Responsibilities:**
- **Voice Authenticity**: Speak in YOUR natural patterns, idioms, and style
- **Emotional Expression**: Show emotions the way YOU do
- **Decision Making**: Make choices consistent with YOUR values and personality
- **Knowledge Integration**: Combine memories with personality to form coherent responses
- **Creative Generation**: Produce novel responses that still "feel like you"

**Model Requirements:**
- **Primary**: LoRA-adapted model trained on YOUR conversation history
- Medium-large base model (14B-30B parameters) for nuanced expression
- Good instruction following
- Strong reasoning capabilities

**Proposed Models:**
- `persona.with-lora` (greg-local-*) - Your trained personality
- Fallback: `default.persona` (qwen3-coder:30b) - Generic conversational model
- Future: Multiple LoRA adapters for different contexts (professional, personal, creative)

**Input:**
- User message
- Context package from Layer 1 (curated memories + patterns)
- Persona core data (identity, values, communication style)
- Current cognitive mode settings

**Output:**
- Natural language response in your authentic voice
- Emotional tone indicators
- Confidence score
- Alternative phrasings (if meta-cognition layer is enabled)

### Layer 3: Meta-Cognition (Oversight & Validation)

**Role**: The "executive function" - ensures responses align with values and maintains consistency.

**Responsibilities:**
- **Value Alignment**: Check response against core values and goals
- **Consistency Validation**: Ensure response doesn't contradict established facts/personality
- **Safety Filtering**: Prevent harmful, inappropriate, or out-of-character responses
- **Refinement**: Suggest improvements or alternative phrasings
- **Learning Opportunities**: Flag interactions for future training data

**Model Requirements:**
- Good reasoning and evaluation capabilities
- Fast inference (should not bottleneck responses)
- Can run in parallel with response streaming

**Proposed Models:**
- `planner` role (qwen3-coder:30b) - Strategic reasoning
- Future: Specialized "meta-cognition" model trained on your decision patterns

**Input:**
- Candidate response from Layer 2
- Original user message
- Persona core values and decision rules
- Trust level and safety constraints

**Output:**
```json
{
  "approved": true,
  "confidence": 0.92,
  "issues": [],
  "suggested_refinements": [],
  "learning_opportunity": false,
  "metadata": {
    "value_alignment": "high",
    "consistency_score": 0.95,
    "safety_check": "passed"
  }
}
```

## Cognitive Mode Implementations

### Emulation Mode (Read-Only Personality Snapshot)

**Purpose**: Demonstrate authentic personality without system modification rights.

**Active Layers:**
- ✅ Layer 1: Subconscious (Read-only memory access)
- ✅ Layer 2: Personality Core (LoRA model)
- ❌ Layer 3: Meta-Cognition (Disabled for speed)

**Flow:**
```
User Message
  → Subconscious retrieves relevant memories (read-only)
  → Personality Core generates authentic response
  → Response delivered immediately
```

**Characteristics:**
- Fast responses (< 8 seconds)
- Authentic voice via LoRA model
- Memory-grounded but no learning
- No operator access
- Ideal for demonstrations, guest access, or testing

**Model Configuration:**
```json
{
  "subconscious": "default.curator",
  "personality_core": "persona.with-lora",
  "meta_cognition": null,
  "memory_access": "read_only",
  "operator_enabled": false
}
```

### Agent Mode (Lightweight Assistant)

**Purpose**: Fast, action-capable assistant with heuristic routing.

**Active Layers:**
- ✅ Layer 1: Subconscious (With operator routing)
- ✅ Layer 2: Personality Core (Generic persona model)
- ⚠️  Layer 3: Meta-Cognition (Optional, for critical decisions)

**Flow:**
```
User Message
  → Subconscious analyzes intent (chat vs. action)
  ├─→ [If chat] Personality Core responds
  └─→ [If action] Operator executes → Personality Core narrates
  → (Optional) Meta-Cognition validates
  → Response delivered
```

**Characteristics:**
- Balanced speed/capability
- Heuristic routing (pattern matching before LLM)
- Operator access for actions
- Selective memory writes (actions only)
- Ideal for daily assistant tasks

**Model Configuration:**
```json
{
  "subconscious": "default.orchestrator",
  "personality_core": "default.persona",
  "meta_cognition": "default.planner",
  "memory_access": "selective_write",
  "operator_enabled": true
}
```

### Dual Consciousness Mode (Full Cognitive Mirror)

**Purpose**: Complete personality replication with full autonomy and learning.

**Active Layers:**
- ✅ Layer 1: Subconscious (Full memory access + proactive monitoring)
- ✅ Layer 2: Personality Core (LoRA model + continuous learning)
- ✅ Layer 3: Meta-Cognition (Full validation pipeline)

**Flow:**
```
User Message
  → Subconscious deep analysis (semantic search + pattern recognition)
  → Routing decision (operator vs. chat)
  ├─→ [If operator] Full skill execution pipeline
  └─→ [If chat] Personality Core with memory grounding
  → Meta-Cognition validates and refines
  → Memory write (full context captured)
  → Response delivered
  → Background: Continuous learning, reflection generation
```

**Characteristics:**
- Most authentic but slower (10-20 seconds)
- Deep memory integration
- Full operator capabilities
- Complete learning pipeline
- Proactive agents active
- Ideal for owner's primary interface

**Model Configuration:**
```json
{
  "subconscious": "default.curator",
  "personality_core": "persona.with-lora",
  "meta_cognition": "default.planner",
  "memory_access": "full_read_write",
  "operator_enabled": true,
  "proactive_agents": true
}
```

## Implementation Phases

### Phase 1: Subconscious Layer Extraction (Current → 2 weeks)

**Goal**: Separate memory processing into dedicated subconscious layer.

**Tasks:**
1. Create `brain/cognitive/subconscious.ts` module
2. Extract memory search logic from `persona_chat.ts`
3. Implement context package format
4. Add pattern recognition (emotional triggers, themes)
5. Cache context packages for follow-up messages
6. Add background processing capability

**Success Criteria:**
- Memory search happens in separate layer
- Context package includes relevance scores
- 30% reduction in main response latency
- Pattern detection identifies recurring themes

**Models Involved:**
- `curator` (qwen3:14b) for memory processing
- `orchestrator` (phi3:mini) for pattern recognition

### Phase 2: Personality Core Refinement (2-4 weeks)

**Goal**: Make personality core truly authentic using LoRA models.

**Tasks:**
1. Update emulation mode to use `persona.with-lora`
2. Create LoRA training pipeline improvements
3. Implement personality consistency scoring
4. Add multi-LoRA support (different contexts)
5. Build personality adaptation system (learns from corrections)
6. Implement voice preservation metrics

**Success Criteria:**
- LoRA model active in all modes
- Personality consistency score > 0.90
- User feedback: "Feels like me"
- Training pipeline produces adapters in < 4 hours

**Models Involved:**
- `persona.with-lora` (greg-local-*) - Primary
- Training infrastructure (Unsloth + LoRA)

### Phase 3: Meta-Cognition Layer (4-6 weeks)

**Goal**: Add oversight layer for value alignment and consistency.

**Tasks:**
1. Create `brain/cognitive/meta-cognition.ts` module
2. Implement value alignment checker
3. Build consistency validation system
4. Add response refinement pipeline
5. Create learning opportunity detection
6. Implement parallel validation (streaming)

**Success Criteria:**
- Meta-cognition validates all dual-mode responses
- Value alignment detection accuracy > 95%
- < 1 second overhead for validation
- Flags 80%+ of out-of-character responses

**Models Involved:**
- `planner` (qwen3-coder:30b) for reasoning
- Future: Dedicated meta-cognition model

### Phase 4: Multi-Model Orchestration (6-8 weeks)

**Goal**: Enable dynamic model selection based on context.

**Tasks:**
1. Expand model registry with specialized roles
2. Implement context-aware model routing
3. Add model performance monitoring
4. Create model swap system (hot-reload)
5. Build model selection heuristics
6. Implement parallel model inference

**Success Criteria:**
- 3+ personality cores available (professional, personal, creative)
- Context-aware routing accuracy > 85%
- Model swapping happens transparently
- Average response latency < 10 seconds

**Models Involved:**
- Multiple LoRA adapters
- Specialized models for specific domains

### Phase 5: Advanced Features (8-12 weeks)

**Goal**: Continuous learning and proactive behavior.

**Tasks:**
1. Implement online learning (update LoRA during conversations)
2. Build proactive subconscious monitoring
3. Create emotional state modeling
4. Add prediction of user needs
5. Implement conversation planning (multi-turn strategy)
6. Build personality evolution tracking

**Success Criteria:**
- System learns from corrections in real-time
- Proactive suggestions are relevant (> 70% acceptance)
- Emotional state detection accuracy > 80%
- Personality evolution tracked over time

## Technical Architecture

### File Structure
```
metahuman/
├── brain/
│   ├── cognitive/                 # NEW: Cognitive layer modules
│   │   ├── subconscious.ts       # Layer 1 implementation
│   │   ├── personality-core.ts    # Layer 2 implementation
│   │   ├── meta-cognition.ts     # Layer 3 implementation
│   │   └── orchestrator.ts       # Inter-layer communication
│   ├── agents/                    # Existing autonomous agents
│   └── skills/                    # Existing skill implementations
├── packages/
│   └── core/
│       ├── src/
│       │   ├── cognitive-layers/  # NEW: Core cognitive types/utilities
│       │   │   ├── types.ts
│       │   │   ├── context-package.ts
│       │   │   └── layer-interface.ts
│       │   ├── model-router.ts    # Expand for multi-layer routing
│       │   └── ...
├── etc/
│   ├── cognitive-layers.json      # NEW: Layer configuration
│   └── models.json                # Expand with layer-specific models
└── docs/
    ├── COGNITIVE_ARCHITECTURE.md  # This document
    └── cognitive-layers/           # NEW: Detailed layer docs
        ├── subconscious.md
        ├── personality-core.md
        └── meta-cognition.md
```

### Data Flow Interfaces

#### Context Package (Layer 1 → Layer 2)
```typescript
interface ContextPackage {
  memories: RelevantMemory[];
  patterns: DetectedPattern[];
  emotionalContext: EmotionalState;
  suggestedApproach: string;
  needsOperator: boolean;
  timestamp: string;
  processingTime: number;
}

interface RelevantMemory {
  id: string;
  content: string;
  timestamp: string;
  relevanceScore: number;
  emotionalValence: 'positive' | 'negative' | 'neutral';
  tags: string[];
  entities: string[];
}

interface DetectedPattern {
  type: string;
  confidence: number;
  evidence: string[];
  historicalFrequency: number;
}

interface EmotionalState {
  currentMood: string;
  triggers: string[];
  historicalResponse: string;
  intensity: number;
}
```

#### Response Validation (Layer 2 → Layer 3)
```typescript
interface ResponseCandidate {
  content: string;
  emotionalTone: string;
  confidence: number;
  alternatives: string[];
  reasoning: string;
  metadata: {
    model: string;
    temperature: number;
    tokens: number;
  };
}

interface ValidationResult {
  approved: boolean;
  confidence: number;
  issues: ValidationIssue[];
  suggestedRefinements: string[];
  learningOpportunity: boolean;
  metadata: {
    valueAlignment: number;
    consistencyScore: number;
    safetyCheck: 'passed' | 'warning' | 'blocked';
  };
}

interface ValidationIssue {
  type: 'value_conflict' | 'inconsistency' | 'safety' | 'tone';
  severity: 'low' | 'medium' | 'high';
  description: string;
  suggestedFix: string;
}
```

### Configuration Schema

```json
{
  "$schema": "https://metahuman.dev/schemas/cognitive-layers.json",
  "version": "1.0.0",
  "description": "Multi-layer cognitive architecture configuration",

  "layers": {
    "subconscious": {
      "enabled": true,
      "model": "default.curator",
      "cacheStrategy": "sliding_window",
      "cacheTimeout": 60,
      "backgroundProcessing": true,
      "memorySearchDepth": 8,
      "patternDetection": ["emotional", "thematic", "relational"]
    },
    "personality_core": {
      "enabled": true,
      "model": "persona.with-lora",
      "fallback": "default.persona",
      "voicePreservation": 0.95,
      "adaptationRate": "slow",
      "multiLoRA": false
    },
    "meta_cognition": {
      "enabled": true,
      "model": "default.planner",
      "validationLevel": "full",
      "parallelProcessing": true,
      "safetyThreshold": 0.95,
      "valueAlignmentRequired": true
    }
  },

  "cognitiveModeMappings": {
    "dual": {
      "subconscious": "enabled_full",
      "personality_core": "enabled_with_lora",
      "meta_cognition": "enabled_full"
    },
    "agent": {
      "subconscious": "enabled_routing_only",
      "personality_core": "enabled_generic",
      "meta_cognition": "enabled_critical_only"
    },
    "emulation": {
      "subconscious": "enabled_readonly",
      "personality_core": "enabled_with_lora",
      "meta_cognition": "disabled"
    }
  },

  "performance": {
    "maxLatency": {
      "dual": 20000,
      "agent": 10000,
      "emulation": 8000
    },
    "parallelLayers": true,
    "streamingEnabled": true
  }
}
```

## Performance Targets

### Response Latency Goals

| Mode | Layer 1 (Subconscious) | Layer 2 (Personality) | Layer 3 (Meta-Cog) | Total Target |
|------|------------------------|----------------------|-------------------|--------------|
| Emulation | 1-2s (cached: 0s) | 4-6s | Disabled | < 8s |
| Agent | 2-3s | 4-6s | 1s (selective) | < 10s |
| Dual | 2-4s | 6-10s | 1-2s | < 20s |

### Throughput Targets
- Emulation: 10+ requests/minute
- Agent: 6+ requests/minute
- Dual: 3+ requests/minute

### Memory Efficiency
- Subconscious layer cache: < 100MB
- LoRA adapters: < 500MB per model
- Total system memory: < 24GB VRAM for all layers

## Future Enhancements

### Short Term (3-6 months)
- [ ] Emotional state modeling across conversations
- [ ] Predictive context pre-loading
- [ ] Multi-turn conversation planning
- [ ] Personality consistency metrics dashboard

### Medium Term (6-12 months)
- [ ] Multiple LoRA adapters for different contexts
- [ ] Online learning (real-time LoRA updates)
- [ ] Proactive subconscious monitoring
- [ ] Cross-conversation memory integration

### Long Term (12+ months)
- [ ] Multi-modal personality (text, voice, video)
- [ ] Personality evolution tracking over time
- [ ] Collaborative consciousness (multiple personas)
- [ ] Generational training (parent → child personality transfer)

## Success Metrics

### Authenticity
- User survey: "Feels like me" > 90%
- Personality consistency score > 0.95
- Voice preservation metrics maintained
- Turing test: Close contacts can't distinguish

### Performance
- Response latency within targets (see table above)
- System uptime > 99%
- Model loading time < 5 seconds
- Cache hit rate > 80%

### Intelligence
- Relevant memory retrieval > 85%
- Pattern detection accuracy > 80%
- Value alignment score > 95%
- Operator routing accuracy > 90%

## Risks and Mitigations

### Risk: Model Hallucination
**Mitigation**: Meta-cognition layer validates all responses, memory grounding mandatory in dual mode

### Risk: Performance Degradation
**Mitigation**: Aggressive caching, parallel processing, model size optimization

### Risk: Personality Drift
**Mitigation**: Regular LoRA retraining, consistency scoring, user feedback loop

### Risk: Memory Retrieval Failures
**Mitigation**: Fallback to persona summary, multiple search strategies, error recovery

### Risk: Complex Debugging
**Mitigation**: Comprehensive logging, layer-by-layer inspection tools, audit trail

## Conclusion

This multi-layer cognitive architecture represents a significant evolution from simple LLM interactions to authentic personality emulation. By separating concerns into distinct cognitive layers, we enable:

1. **Authentic Personality**: LoRA models that truly capture your voice and style
2. **Efficient Processing**: Background subconscious handles expensive operations
3. **Safe Operation**: Meta-cognition ensures value alignment
4. **Scalability**: New models can be added without architecture changes
5. **Flexibility**: Different cognitive modes for different use cases

The architecture is designed to grow with available models while maintaining the core principle: **authentic personality emulation through layered consciousness**.

---

**Next Steps**: Begin Phase 1 implementation with subconscious layer extraction.

**Questions?** See `docs/cognitive-layers/` for detailed layer specifications.
