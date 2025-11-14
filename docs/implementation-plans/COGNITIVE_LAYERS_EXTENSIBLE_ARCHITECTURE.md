# Cognitive Layers - Extensible Architecture Design

**Date:** 2025-11-05
**Version:** 2.0 (Extensible)
**Status:** Design Document
**Related:** [COGNITIVE_ARCHITECTURE_INTEGRATION.md](COGNITIVE_ARCHITECTURE_INTEGRATION.md)

---

## Executive Summary

This document describes an **extensible multi-layer cognitive architecture** that:

1. ✅ **Works with ALL cognitive modes** (Dual, Agent, Emulation)
2. ✅ **Allows future growth** beyond 3 layers (4, 5, N layers)
3. ✅ **Doesn't break current system** (incremental adoption)
4. ✅ **Mode-specific behavior** (layers configure differently per mode)

**Key Design Principle:** Layers are composable, configurable middleware that each mode can enable/disable/tune based on its purpose.

---

## Current Status: What We Have

### ✅ Layer 1 (Subconscious) - IMPLEMENTED

**File:** `packages/core/src/context-builder.ts`
**Status:** Complete with optimizations
**Features:**
- Memory retrieval (semantic search)
- Context filtering (inner_dialogue, reflections)
- Pattern recognition (entities, themes)
- Short-term state (orchestrator working memory)
- Caching (5min TTL, 50% performance gain)

### ⏳ Layer 2 (Personality Core) - PLANNED

**Purpose:** Authentic voice with LoRA-tuned persona
**Current:** Using base persona models without layer abstraction
**Need:** Dedicated layer interface for:
- LoRA adapter loading
- Personal style application
- Training data collection
- Voice consistency

### ⏳ Layer 3 (Meta-Cognition) - PLANNED

**Purpose:** Value alignment and safety oversight
**Current:** No validation layer (responses sent directly)
**Need:** Dedicated layer interface for:
- Value alignment checks
- Consistency validation
- Safety filters
- Response refinement

---

## Design: Extensible Layer System

### Core Principles

1. **Layers are Middleware**
   - Each layer is a function: `Input → Output`
   - Layers can be chained, skipped, or configured
   - Order matters: Subconscious → Personality → Meta-Cognition → ...

2. **Mode-Specific Configuration**
   - Each cognitive mode configures layers differently
   - Dual mode: All layers active, full depth
   - Agent mode: Selective layers, lightweight
   - Emulation mode: Read-only layers, frozen personality

3. **Future-Proof Interfaces**
   - Layers follow standard interface (input/output contracts)
   - New layers can be inserted anywhere in pipeline
   - Layers can be versioned independently

4. **Graceful Degradation**
   - Missing layers don't break the system
   - Fallback behaviors defined
   - Audit logs track which layers ran

---

## Layer Interface Standard

### Base Layer Interface

```typescript
/**
 * Universal layer interface for cognitive processing
 * All layers implement this interface for composability
 */
interface CognitiveLayer<TInput, TOutput> {
  // Layer metadata
  name: string;
  version: string;
  enabled: boolean;

  // Processing function
  process(input: TInput, context: LayerContext): Promise<TOutput>;

  // Optional: validate input before processing
  validate?(input: TInput): ValidationResult;

  // Optional: cleanup/finalize after processing
  finalize?(output: TOutput): Promise<void>;
}

/**
 * Context passed to all layers
 */
interface LayerContext {
  cognitiveMode: CognitiveModeId;
  userId?: string;
  sessionId?: string;
  previousLayers: LayerResult[];
  metadata: Record<string, any>;
}

/**
 * Result from a layer execution
 */
interface LayerResult {
  layerName: string;
  success: boolean;
  output: any;
  processingTime: number;
  metadata: Record<string, any>;
}
```

### Layer Pipeline

```typescript
/**
 * Pipeline that chains multiple layers together
 */
class CognitivePipeline {
  private layers: CognitiveLayer<any, any>[] = [];

  addLayer(layer: CognitiveLayer<any, any>): void {
    this.layers.push(layer);
  }

  async execute<TInput, TOutput>(
    input: TInput,
    mode: CognitiveModeId
  ): Promise<PipelineResult<TOutput>> {
    const context: LayerContext = {
      cognitiveMode: mode,
      previousLayers: [],
      metadata: {}
    };

    let currentOutput = input;
    const results: LayerResult[] = [];

    for (const layer of this.layers) {
      if (!layer.enabled) continue;

      const startTime = Date.now();
      try {
        // Validate input if layer supports it
        if (layer.validate) {
          const validation = layer.validate(currentOutput);
          if (!validation.valid) {
            throw new Error(`Layer validation failed: ${validation.errors}`);
          }
        }

        // Process through layer
        currentOutput = await layer.process(currentOutput, context);

        // Record result
        const result: LayerResult = {
          layerName: layer.name,
          success: true,
          output: currentOutput,
          processingTime: Date.now() - startTime,
          metadata: {}
        };
        results.push(result);
        context.previousLayers.push(result);

        // Finalize if layer supports it
        if (layer.finalize) {
          await layer.finalize(currentOutput);
        }

      } catch (error) {
        const result: LayerResult = {
          layerName: layer.name,
          success: false,
          output: null,
          processingTime: Date.now() - startTime,
          metadata: { error: String(error) }
        };
        results.push(result);

        // Decide: fail fast or continue?
        // For now: fail fast (can make configurable)
        throw error;
      }
    }

    return {
      output: currentOutput as TOutput,
      layers: results,
      totalTime: results.reduce((sum, r) => sum + r.processingTime, 0)
    };
  }
}

interface PipelineResult<TOutput> {
  output: TOutput;
  layers: LayerResult[];
  totalTime: number;
}
```

---

## Layer Implementations

### Layer 1: Subconscious Processing (✅ DONE)

```typescript
import { buildContextPackage, ContextPackage } from './context-builder.js';

class SubconsciousLayer implements CognitiveLayer<string, ContextPackage> {
  name = 'subconscious';
  version = '1.0.0';
  enabled = true;

  async process(
    userMessage: string,
    context: LayerContext
  ): Promise<ContextPackage> {
    // Mode-specific configuration
    const options = this.getOptionsForMode(context.cognitiveMode);

    // Build context package (already implemented!)
    const contextPackage = await buildContextPackage(
      userMessage,
      context.cognitiveMode,
      options
    );

    return contextPackage;
  }

  private getOptionsForMode(mode: CognitiveModeId) {
    switch (mode) {
      case 'dual':
        return {
          searchDepth: 'deep' as const,      // 16 results
          maxMemories: 8,                    // More memories for operator
          includeShortTermState: true,
          detectPatterns: true,
          forceSemanticSearch: true
        };
      case 'agent':
        return {
          searchDepth: 'normal' as const,    // 8 results
          maxMemories: 2,                    // Standard limit
          includeShortTermState: true,
          detectPatterns: false
        };
      case 'emulation':
        return {
          searchDepth: 'shallow' as const,   // 4 results
          maxMemories: 2,
          includeShortTermState: false,      // Read-only
          detectPatterns: false
        };
    }
  }
}
```

### Layer 2: Personality Core (NEW)

```typescript
interface PersonalityInput {
  userMessage: string;
  contextPackage: ContextPackage;
  operatorResult?: OperatorResult;  // Optional: from operator pipeline
}

interface PersonalityOutput {
  response: string;
  metadata: {
    modelUsed: string;
    loraAdapter?: string;
    tokensGenerated: number;
    voiceConsistency: number;  // 0-1 score
  };
}

class PersonalityCoreLayer implements CognitiveLayer<PersonalityInput, PersonalityOutput> {
  name = 'personality-core';
  version = '1.0.0';
  enabled = true;

  async process(
    input: PersonalityInput,
    context: LayerContext
  ): Promise<PersonalityOutput> {
    const mode = context.cognitiveMode;

    // Mode-specific model selection
    let modelConfig: ModelConfig;
    let includePersonaContext: boolean;

    switch (mode) {
      case 'dual':
        // Full persona + optional LoRA
        modelConfig = await this.loadPersonaWithLoRA();
        includePersonaContext = !modelConfig.loraAdapter;  // Skip if LoRA has personality
        break;

      case 'agent':
        // Base persona, no LoRA
        modelConfig = await this.loadBasePersona();
        includePersonaContext = true;
        break;

      case 'emulation':
        // LoRA-only (frozen personality snapshot)
        modelConfig = await this.loadLoRASnapshot();
        includePersonaContext = false;  // LoRA contains full personality
        break;
    }

    // Build prompt with context
    const prompt = this.buildPrompt(input, includePersonaContext);

    // Generate response using model router
    const response = await callLLM({
      role: 'persona',
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user }
      ],
      cognitiveMode: mode,
      options: {
        model: modelConfig.model,
        adapter: modelConfig.loraAdapter
      }
    });

    // Analyze voice consistency
    const voiceConsistency = await this.analyzeVoiceConsistency(
      response,
      input.contextPackage.persona
    );

    return {
      response: response.content,
      metadata: {
        modelUsed: modelConfig.model,
        loraAdapter: modelConfig.loraAdapter,
        tokensGenerated: response.tokensGenerated || 0,
        voiceConsistency
      }
    };
  }

  private async loadPersonaWithLoRA(): Promise<ModelConfig> {
    // Check if LoRA adapter available
    const loraPath = await this.findLatestLoRA();
    if (loraPath) {
      return {
        model: 'qwen3-coder:30b',
        loraAdapter: loraPath
      };
    }
    // Fallback to base model
    return { model: 'qwen3-coder:30b' };
  }

  private async loadBasePersona(): Promise<ModelConfig> {
    return { model: 'qwen3-coder:30b' };
  }

  private async loadLoRASnapshot(): Promise<ModelConfig> {
    // Use specific LoRA for emulation (frozen personality)
    const snapshotPath = 'out/adapters/snapshot-2025-11-01/adapter.gguf';
    return {
      model: 'qwen3-coder:30b',
      loraAdapter: snapshotPath
    };
  }

  private buildPrompt(input: PersonalityInput, includePersona: boolean): { system: string; user: string } {
    // Format context package (already implemented)
    const contextString = formatContextForPrompt(input.contextPackage, {
      includePersona
    });

    let systemPrompt = contextString;

    // Add operator result if available
    if (input.operatorResult) {
      systemPrompt += `\n\n## Action Taken:\n${input.operatorResult.summary}`;
    }

    return {
      system: systemPrompt,
      user: input.userMessage
    };
  }

  private async analyzeVoiceConsistency(
    response: string,
    persona: PersonaSummary
  ): Promise<number> {
    // Simple heuristic for now
    // Future: Use embeddings to compare with known voice samples
    return 0.85;  // Placeholder
  }

  private async findLatestLoRA(): Promise<string | undefined> {
    // Look for latest LoRA adapter
    // Future: Implement proper adapter discovery
    return undefined;  // Placeholder
  }
}

interface ModelConfig {
  model: string;
  loraAdapter?: string;
}
```

### Layer 3: Meta-Cognition (NEW)

```typescript
interface MetaCognitionInput {
  response: string;
  context: ContextPackage;
  metadata: PersonalityOutput['metadata'];
}

interface MetaCognitionOutput {
  finalResponse: string;
  validation: {
    valueAlignment: boolean;
    consistencyCheck: boolean;
    safetyFilters: boolean;
    refined: boolean;
  };
  edits: string[];  // List of changes made
}

class MetaCognitionLayer implements CognitiveLayer<MetaCognitionInput, MetaCognitionOutput> {
  name = 'meta-cognition';
  version = '1.0.0';
  enabled = true;

  async process(
    input: MetaCognitionInput,
    context: LayerContext
  ): Promise<MetaCognitionOutput> {
    const mode = context.cognitiveMode;

    // Mode-specific validation depth
    let validationLevel: 'full' | 'selective' | 'none';

    switch (mode) {
      case 'dual':
        validationLevel = 'full';  // Full validation + alignment
        break;
      case 'agent':
        validationLevel = 'selective';  // Safety only
        break;
      case 'emulation':
        validationLevel = 'none';  // Read-only is safe by definition
        break;
    }

    if (validationLevel === 'none') {
      return {
        finalResponse: input.response,
        validation: {
          valueAlignment: true,
          consistencyCheck: true,
          safetyFilters: true,
          refined: false
        },
        edits: []
      };
    }

    const edits: string[] = [];
    let finalResponse = input.response;

    // Value alignment check
    const valueAlignment = await this.checkValueAlignment(
      finalResponse,
      input.context.persona.coreValues
    );

    if (!valueAlignment.aligned && validationLevel === 'full') {
      // Refine response to align with values
      finalResponse = await this.refineForValues(finalResponse, input.context);
      edits.push('Refined for value alignment');
    }

    // Consistency check
    const consistencyCheck = await this.checkConsistency(
      finalResponse,
      input.context.persona
    );

    if (!consistencyCheck.consistent && validationLevel === 'full') {
      // Adjust for consistency
      finalResponse = await this.refineForConsistency(finalResponse, input.context);
      edits.push('Adjusted for identity consistency');
    }

    // Safety filters (always run in selective mode)
    const safetyCheck = await this.applySafetyFilters(finalResponse);

    if (!safetyCheck.safe) {
      // Block or modify unsafe content
      finalResponse = safetyCheck.sanitized;
      edits.push('Applied safety filters');
    }

    return {
      finalResponse,
      validation: {
        valueAlignment: valueAlignment.aligned,
        consistencyCheck: consistencyCheck.consistent,
        safetyFilters: safetyCheck.safe,
        refined: edits.length > 0
      },
      edits
    };
  }

  private async checkValueAlignment(
    response: string,
    coreValues: any[]
  ): Promise<{ aligned: boolean; issues: string[] }> {
    // Use curator model to check alignment
    // Placeholder for now
    return { aligned: true, issues: [] };
  }

  private async refineForValues(
    response: string,
    context: ContextPackage
  ): Promise<string> {
    // Use curator to refine response
    // Placeholder for now
    return response;
  }

  private async checkConsistency(
    response: string,
    persona: PersonaSummary
  ): Promise<{ consistent: boolean; issues: string[] }> {
    // Check if response matches persona identity
    // Placeholder for now
    return { consistent: true, issues: [] };
  }

  private async refineForConsistency(
    response: string,
    context: ContextPackage
  ): Promise<string> {
    // Adjust response for consistency
    // Placeholder for now
    return response;
  }

  private async applySafetyFilters(
    response: string
  ): Promise<{ safe: boolean; sanitized: string }> {
    // Check for harmful content
    // Placeholder for now
    return { safe: true, sanitized: response };
  }
}
```

---

## Mode-Specific Pipeline Configurations

### Configuration File: `etc/cognitive-layers.json`

```json
{
  "dual": {
    "layers": [
      {
        "name": "subconscious",
        "enabled": true,
        "config": {
          "searchDepth": "deep",
          "maxMemories": 8,
          "detectPatterns": true
        }
      },
      {
        "name": "personality-core",
        "enabled": true,
        "config": {
          "useLoRA": true,
          "includePersonaContext": false
        }
      },
      {
        "name": "meta-cognition",
        "enabled": true,
        "config": {
          "validationLevel": "full",
          "refineResponses": true
        }
      }
    ],
    "description": "Full cognitive depth for mirrored consciousness"
  },
  "agent": {
    "layers": [
      {
        "name": "subconscious",
        "enabled": true,
        "config": {
          "searchDepth": "normal",
          "maxMemories": 2,
          "detectPatterns": false
        }
      },
      {
        "name": "personality-core",
        "enabled": true,
        "config": {
          "useLoRA": false,
          "includePersonaContext": true
        }
      },
      {
        "name": "meta-cognition",
        "enabled": true,
        "config": {
          "validationLevel": "selective",
          "refineResponses": false
        }
      }
    ],
    "description": "Lightweight assistant mode"
  },
  "emulation": {
    "layers": [
      {
        "name": "subconscious",
        "enabled": true,
        "config": {
          "searchDepth": "shallow",
          "maxMemories": 2,
          "detectPatterns": false,
          "readOnly": true
        }
      },
      {
        "name": "personality-core",
        "enabled": true,
        "config": {
          "useLoRA": true,
          "loraSnapshot": "snapshot-2025-11-01",
          "includePersonaContext": false
        }
      },
      {
        "name": "meta-cognition",
        "enabled": false,
        "config": {
          "validationLevel": "none"
        }
      }
    ],
    "description": "Frozen personality snapshot, read-only"
  }
}
```

---

## Future Growth: Adding More Layers

### Example: Layer 4 - Emotional Intelligence

```typescript
class EmotionalIntelligenceLayer implements CognitiveLayer<MetaCognitionOutput, EmotionalOutput> {
  name = 'emotional-intelligence';
  version = '1.0.0';
  enabled = false;  // Opt-in for future

  async process(
    input: MetaCognitionOutput,
    context: LayerContext
  ): Promise<EmotionalOutput> {
    // Analyze emotional context
    const userEmotion = await this.detectUserEmotion(context);
    const responseEmotion = await this.detectResponseEmotion(input.finalResponse);

    // Adjust response tone if needed
    let adjustedResponse = input.finalResponse;
    if (userEmotion.distress && responseEmotion.tone !== 'empathetic') {
      adjustedResponse = await this.adjustTone(input.finalResponse, 'empathetic');
    }

    return {
      response: adjustedResponse,
      emotionalContext: {
        userEmotion,
        responseEmotion,
        adjusted: adjustedResponse !== input.finalResponse
      }
    };
  }

  private async detectUserEmotion(context: LayerContext): Promise<EmotionState> {
    // Analyze previous messages for emotional state
    return { distress: false, mood: 'neutral' };
  }

  private async detectResponseEmotion(response: string): Promise<ResponseEmotion> {
    // Analyze response emotional tone
    return { tone: 'neutral', intensity: 0.5 };
  }

  private async adjustTone(response: string, targetTone: string): Promise<string> {
    // Use LLM to adjust emotional tone
    return response;
  }
}

interface EmotionalOutput {
  response: string;
  emotionalContext: {
    userEmotion: EmotionState;
    responseEmotion: ResponseEmotion;
    adjusted: boolean;
  };
}
```

### Example: Layer 5 - Long-Term Planning

```typescript
class LongTermPlanningLayer implements CognitiveLayer<EmotionalOutput, PlanningOutput> {
  name = 'long-term-planning';
  version = '1.0.0';
  enabled = false;  // Future enhancement

  async process(
    input: EmotionalOutput,
    context: LayerContext
  ): Promise<PlanningOutput> {
    // Analyze user's long-term goals
    const goals = await this.loadUserGoals(context.userId);

    // Check if current action aligns with goals
    const alignment = await this.checkGoalAlignment(input.response, goals);

    // Suggest proactive actions
    const suggestions = await this.generateProactiveSuggestions(goals, context);

    return {
      response: input.response,
      planning: {
        goalsAligned: alignment.aligned,
        suggestions
      }
    };
  }
}
```

---

## Implementation Plan

### Phase 1: Infrastructure (Week 1)

1. **Create layer interfaces**
   - `packages/core/src/cognitive-layers/types.ts` - Interfaces
   - `packages/core/src/cognitive-layers/pipeline.ts` - Pipeline class

2. **Refactor Layer 1 (Subconscious)**
   - Wrap existing context-builder in layer interface
   - Add mode-specific configuration

3. **Layer configuration system**
   - Create `etc/cognitive-layers.json`
   - Loader function: `loadLayerConfig(mode)`

### Phase 2: Layer 2 (Personality Core) (Week 2)

1. **Implement personality layer**
   - `packages/core/src/cognitive-layers/personality-core.ts`
   - LoRA loading logic
   - Voice consistency analysis

2. **Integrate with persona_chat.ts**
   - Replace direct LLM calls with personality layer
   - Test across all modes

### Phase 3: Layer 3 (Meta-Cognition) (Week 3)

1. **Implement meta-cognition layer**
   - `packages/core/src/cognitive-layers/meta-cognition.ts`
   - Value alignment checks
   - Safety filters

2. **Mode-specific validation**
   - Full validation for dual mode
   - Selective for agent mode
   - Skip for emulation mode

### Phase 4: Integration & Testing (Week 4)

1. **Integrate pipeline into persona_chat.ts**
   - Replace existing flow with pipeline
   - Test all modes thoroughly

2. **Performance benchmarking**
   - Measure per-layer latency
   - Optimize bottlenecks

3. **Documentation**
   - User guide for layer configuration
   - Developer guide for adding new layers

---

## Migration Strategy: No Breaking Changes

### Current Flow (persona_chat.ts)

```typescript
// OLD: Direct LLM call
const response = await callLLM({
  role: 'persona',
  messages: [...],
  cognitiveMode
});
```

### New Flow (with pipeline)

```typescript
// NEW: Through cognitive pipeline
const pipeline = await buildCognitivePipeline(cognitiveMode);

const result = await pipeline.execute(userMessage, cognitiveMode);

// result.output contains final response
// result.layers contains per-layer metrics
```

**Migration:**
1. Add pipeline in parallel (doesn't break existing)
2. Gradually switch modes one by one
3. Keep old code until all modes migrated
4. Remove old code once stable

---

## Benefits of Extensible Design

### 1. Easy to Add New Layers

```typescript
// Add Layer 4: Emotional Intelligence
pipeline.addLayer(new EmotionalIntelligenceLayer());

// Add Layer 5: Long-Term Planning
pipeline.addLayer(new LongTermPlanningLayer());

// Pipeline automatically chains them
```

### 2. Per-Mode Customization

```json
{
  "dual": {
    "layers": ["subconscious", "personality-core", "meta-cognition", "emotional-intelligence"]
  },
  "agent": {
    "layers": ["subconscious", "personality-core"]
  }
}
```

### 3. A/B Testing Layers

```typescript
// Test new layer with 10% of traffic
if (Math.random() < 0.1) {
  pipeline.addLayer(new ExperimentalLayer());
}
```

### 4. Layer Versioning

```typescript
// Load specific version
const layer = new PersonalityCoreLayer({ version: '2.0.0' });
```

### 5. Observability

```typescript
// Detailed per-layer metrics
result.layers.forEach(layer => {
  console.log(`${layer.layerName}: ${layer.processingTime}ms`);
});
```

---

## Next Steps

1. **Review this design** - Does it meet your vision for extensibility?
2. **Start Phase 1** - Create layer interfaces and pipeline
3. **Wrap Layer 1** - Make context-builder implement layer interface
4. **Build Layer 2** - Personality core with LoRA support
5. **Add Layer 3** - Meta-cognition validation

**Question for you:** Does this extensible design align with your vision? Should we proceed with Phase 1 implementation?

---

**End of Extensible Architecture Design**
