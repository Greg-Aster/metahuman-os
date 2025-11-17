# Phase 1: Integrate Cognitive Layers Configuration

**Status**: Planning
**Goal**: Fix emulation mode hallucinations by integrating cognitive layers constraints into persona_chat.ts

## Problem Statement

Emulation mode currently produces hallucinations because:
1. No memory grounding constraints - retrieves too many/wrong memories
2. No model selection constraints - doesn't use snapshot LoRA
3. No safety filter constraints - applies full validation when it shouldn't

The cognitive layers configuration exists (`etc/cognitive-layers.json`) but is not being used by `persona_chat.ts`.

## Solution Overview

Integrate the three-layer cognitive architecture into the chat flow:

- **Layer 1 (Subconscious/Memory)**: Control memory retrieval depth and volume
- **Layer 2 (Personality Core)**: Control model selection and LoRA mode
- **Layer 3 (Meta-Cognition)**: Control validation and safety checks

## Implementation Steps

### Step 1.1: Import and Load Cognitive Layers Config

**File**: `apps/site/src/pages/api/persona_chat.ts`
**Location**: Top of file (after existing imports)

**Add**:
```typescript
// Import cognitive layers configuration for multi-layer architecture
type CognitiveLayers = {
  dual: { layers: Array<{ name: string; enabled: boolean; config: any }> };
  agent: { layers: Array<{ name: string; enabled: boolean; config: any }> };
  emulation: { layers: Array<{ name: string; enabled: boolean; config: any }> };
};

let cognitiveLayers: CognitiveLayers | null = null;

/**
 * Load cognitive layers configuration from etc/cognitive-layers.json
 */
function loadCognitiveLayers(): CognitiveLayers {
  if (cognitiveLayers) return cognitiveLayers;

  try {
    const configPath = path.join(ROOT, 'etc', 'cognitive-layers.json');
    if (!existsSync(configPath)) {
      console.warn('[persona_chat] Cognitive layers config not found, using defaults');
      return getDefaultCognitiveLayers();
    }

    const raw = readFileSync(configPath, 'utf-8');
    cognitiveLayers = JSON.parse(raw);
    console.log('[persona_chat] Loaded cognitive layers configuration');
    return cognitiveLayers!;
  } catch (error) {
    console.error('[persona_chat] Failed to load cognitive layers:', error);
    return getDefaultCognitiveLayers();
  }
}

/**
 * Get default cognitive layers configuration (fallback)
 */
function getDefaultCognitiveLayers(): CognitiveLayers {
  return {
    dual: { layers: [
      { name: 'subconscious', enabled: true, config: { maxMemories: 8, maxContextChars: 1500 } },
      { name: 'personality-core', enabled: true, config: { useLoRA: true, loraMode: 'latest' } },
      { name: 'meta-cognition', enabled: true, config: { applySafetyFilters: true } }
    ]},
    agent: { layers: [
      { name: 'subconscious', enabled: true, config: { maxMemories: 2, maxContextChars: 900 } },
      { name: 'personality-core', enabled: true, config: { useLoRA: false } },
      { name: 'meta-cognition', enabled: true, config: { applySafetyFilters: true } }
    ]},
    emulation: { layers: [
      { name: 'subconscious', enabled: true, config: { maxMemories: 2, maxContextChars: 600 } },
      { name: 'personality-core', enabled: true, config: { useLoRA: true, loraMode: 'snapshot' } },
      { name: 'meta-cognition', enabled: false, config: { applySafetyFilters: false } }
    ]}
  };
}

/**
 * Get layer configuration for a specific cognitive mode and layer name
 */
function getLayerConfig(cognitiveMode: string, layerName: string): any {
  const layers = loadCognitiveLayers();
  const modeKey = (cognitiveMode || 'dual') as keyof CognitiveLayers;
  const modeConfig = layers[modeKey] || layers.dual;
  const layer = modeConfig.layers.find(l => l.name === layerName);
  return layer?.enabled ? layer.config : null;
}
```

**Why**: Creates infrastructure to load and query layer configuration based on cognitive mode

---

### Step 1.2: Apply Layer 1 (Subconscious) Constraints to Memory Retrieval

**File**: `apps/site/src/pages/api/persona_chat.ts`
**Location**: Function `retrieveConversationContext`, around line 475
**Current Code**:
```typescript
const contextPackage = await buildContextPackage(userMessage, cognitiveMode, {
  searchDepth: 'normal',          // 8 results (matching old topK: 8)
  similarityThreshold: effectiveThreshold,
  maxMemories: undefined,
  maxContextChars: chatSettings.maxContextChars,
  metadataFilters,
  filterInnerDialogue: true,
  filterReflections: shouldFilterReflections,
  includeShortTermState: true,
  includePersonaCache: opts?.includePersonaSummary !== false,
  includeTaskContext: wantsTasks,
  detectPatterns: false,
  forceSemanticSearch: cognitiveMode === 'dual',
  usingLoRA: opts?.usingLora || false,
  conversationId: sessionId
});
```

**Replace With**:
```typescript
// Load Layer 1 (subconscious) constraints from cognitive layers config
const layer1Config = getLayerConfig(cognitiveMode, 'subconscious');

// Apply layer-based constraints to memory retrieval
const contextPackage = await buildContextPackage(userMessage, cognitiveMode, {
  // Layer 1 constraints (cognitive-layers.json):
  // - dual: maxMemories=8, maxContextChars=1500, searchDepth='deep', forceSemanticSearch=true
  // - agent: maxMemories=2, maxContextChars=900, searchDepth='normal', forceSemanticSearch=false
  // - emulation: maxMemories=2, maxContextChars=600, searchDepth='shallow', forceSemanticSearch=false
  searchDepth: layer1Config?.searchDepth || 'normal',
  similarityThreshold: layer1Config?.similarityThreshold || effectiveThreshold,
  maxMemories: layer1Config?.maxMemories || undefined,
  maxContextChars: layer1Config?.maxContextChars || chatSettings.maxContextChars,

  // Metadata filters (hybrid search for dreams/reflections)
  metadataFilters,

  // Layer 1 filtering options
  filterInnerDialogue: layer1Config?.filterInnerDialogue !== false,
  filterReflections: layer1Config?.filterReflections !== false ? shouldFilterReflections : false,

  // Layer 1 state inclusion
  includeShortTermState: layer1Config?.includeShortTermState !== false,
  includePersonaCache: layer1Config?.includePersonaCache !== false && opts?.includePersonaSummary !== false,
  includeTaskContext: layer1Config?.includeTaskContext || wantsTasks,

  // Layer 1 advanced features
  detectPatterns: layer1Config?.detectPatterns || false,
  forceSemanticSearch: layer1Config?.forceSemanticSearch || (cognitiveMode === 'dual'),

  // LoRA status from Layer 2 (needed for memory policy)
  usingLoRA: layer1Config?.usingLoRA || opts?.usingLora || false,
  conversationId: sessionId
});
```

**Why**: Applies memory retrieval constraints based on cognitive mode
- Emulation mode: Only 2 memories, 600 chars (prevents hallucinations from too much context)
- Agent mode: 2 memories, 900 chars (lightweight)
- Dual mode: 8 memories, 1500 chars (full depth)

**Audit Event**:
Add logging after buildContextPackage call:
```typescript
audit({
  level: 'info',
  category: 'system',
  event: 'cognitive_layer1_applied',
  details: {
    cognitiveMode,
    layer: 'subconscious',
    constraints: {
      searchDepth: layer1Config?.searchDepth,
      maxMemories: layer1Config?.maxMemories,
      maxContextChars: layer1Config?.maxContextChars,
      forceSemanticSearch: layer1Config?.forceSemanticSearch
    },
    memoryCount: contextPackage.memoryCount
  },
  actor: 'system'
});
```

---

### Step 1.3: Apply Layer 2 (Personality Core) Constraints to Model Selection

**File**: `apps/site/src/pages/api/persona_chat.ts`
**Location**: LLM call in non-pipeline path, around line 1563

**Current Code**:
```typescript
// Use role-based routing for persona responses
llmResponse = await callLLM({
  role: 'persona' as ModelRole,
  messages: messagesForLLM,
  cognitiveMode,
  options: {
    temperature,
    topP: 0.9,
    repeatPenalty: 1.3,
    ...llmOpts
  }
});
```

**Replace With**:
```typescript
// Load Layer 2 (personality-core) constraints
const layer2Config = getLayerConfig(cognitiveMode, 'personality-core');

// Apply LoRA mode constraint from Layer 2
// - dual: useLoRA=true, loraMode='latest'
// - agent: useLoRA=false (base model)
// - emulation: useLoRA=true, loraMode='snapshot', loraSnapshot='snapshot-2025-11-01'
const useLoRA = layer2Config?.useLoRA !== false;
const loraMode = layer2Config?.loraMode || 'latest';
const loraSnapshot = layer2Config?.loraSnapshot;

// Log Layer 2 application
audit({
  level: 'info',
  category: 'system',
  event: 'cognitive_layer2_applied',
  details: {
    cognitiveMode,
    layer: 'personality-core',
    constraints: { useLoRA, loraMode, loraSnapshot },
    fallbackToBase: layer2Config?.fallbackToBase
  },
  actor: 'system'
});

// Use role-based routing for persona responses
llmResponse = await callLLM({
  role: 'persona' as ModelRole,
  messages: messagesForLLM,
  cognitiveMode,
  options: {
    temperature,
    topP: 0.9,
    repeatPenalty: 1.3,
    ...llmOpts,
    // Layer 2: Override model selection based on LoRA mode
    // Note: callLLM already handles cognitiveMode, this is for explicit LoRA control
    useLoRA,
    loraMode,
    loraSnapshot
  }
});
```

**Note**: The `callLLM` function in `packages/core/src/model-router.ts` already resolves models based on `cognitiveMode` via `resolveModelForCognitiveMode`. We're adding explicit LoRA options here for future granular control. If `callLLM` doesn't currently support these options, we'll need to extend it in Phase 2.

**Why**: Ensures emulation mode uses snapshot LoRA (frozen personality) instead of latest adapter

---

### Step 1.4: Apply Layer 3 (Meta-Cognition) Constraints to Safety Checks

**File**: `apps/site/src/pages/api/persona_chat.ts`
**Location**: Safety check section, around line 1675 (after response generation)

**Current Code**:
```typescript
// Feature flag: Enable safety validation (Phase 4.2)
const ENABLE_SAFETY_CHECKS = process.env.ENABLE_SAFETY_CHECKS !== 'false';

// ... later in code ...

if (USE_COGNITIVE_PIPELINE && ENABLE_SAFETY_CHECKS) {
  // Run safety checks
  const safetyResult = await checkResponseSafety(assistantResponse, cognitiveMode);
  // ...
}
```

**Replace With**:
```typescript
// Load Layer 3 (meta-cognition) constraints
const layer3Config = getLayerConfig(cognitiveMode, 'meta-cognition');

// Apply Layer 3 constraints:
// - dual: applySafetyFilters=true, checkValueAlignment=true, checkConsistency=true
// - agent: applySafetyFilters=true, checkValueAlignment=false, checkConsistency=false
// - emulation: enabled=false (skip all meta-cognition)
const shouldRunSafetyChecks = layer3Config?.applySafetyFilters !== false && ENABLE_SAFETY_CHECKS;
const shouldCheckValues = layer3Config?.checkValueAlignment !== false;
const shouldCheckConsistency = layer3Config?.checkConsistency !== false;

// Log Layer 3 application
audit({
  level: 'info',
  category: 'system',
  event: 'cognitive_layer3_applied',
  details: {
    cognitiveMode,
    layer: 'meta-cognition',
    enabled: layer3Config !== null,
    constraints: {
      applySafetyFilters: shouldRunSafetyChecks,
      checkValueAlignment: shouldCheckValues,
      checkConsistency: shouldCheckConsistency
    }
  },
  actor: 'system'
});

// Only run safety checks if Layer 3 is enabled and allows it
if (USE_COGNITIVE_PIPELINE && shouldRunSafetyChecks) {
  // Run safety checks
  const safetyResult = await checkResponseSafety(
    assistantResponse,
    cognitiveMode,
    {
      checkValueAlignment: shouldCheckValues,
      checkConsistency: shouldCheckConsistency
    }
  );
  // ... rest of safety logic
}
```

**Why**: Emulation mode skips meta-cognition entirely (faster, no validation overhead). Agent mode runs lightweight safety only. Dual mode runs full validation.

---

## Configuration Reference

### Emulation Mode Layer Config (etc/cognitive-layers.json)

```json
{
  "emulation": {
    "description": "Read-only personality snapshot - frozen personality using LoRA adapter, minimal validation",
    "layers": [
      {
        "name": "subconscious",
        "enabled": true,
        "config": {
          "searchDepth": "shallow",
          "similarityThreshold": 0.62,
          "maxMemories": 2,
          "maxContextChars": 600,
          "filterInnerDialogue": true,
          "filterReflections": true,
          "includeShortTermState": false,
          "includePersonaCache": true,
          "includeTaskContext": false,
          "detectPatterns": false,
          "forceSemanticSearch": false,
          "usingLoRA": true
        }
      },
      {
        "name": "personality-core",
        "enabled": true,
        "config": {
          "useLoRA": true,
          "loraMode": "snapshot",
          "loraSnapshot": "snapshot-2025-11-01",
          "includePersonaContext": false,
          "trackVoiceConsistency": false,
          "fallbackToBase": false
        }
      },
      {
        "name": "meta-cognition",
        "enabled": false,
        "config": {
          "validationLevel": "none",
          "checkValueAlignment": false,
          "checkConsistency": false,
          "applySafetyFilters": false,
          "refineResponses": false
        }
      }
    ]
  }
}
```

## Expected Behavior After Implementation

### Before (Current State)
- ❌ Emulation mode retrieves 8+ memories (too much context, hallucinations)
- ❌ Uses latest LoRA adapter (personality drifts)
- ❌ Runs full safety validation (slow, unnecessary)

### After (Phase 1 Complete)
- ✅ Emulation mode retrieves max 2 memories, 600 chars (grounded responses)
- ✅ Uses snapshot LoRA (frozen personality from Nov 1st)
- ✅ Skips meta-cognition layer (fast responses)

## Testing Plan

1. **Test Layer 1 Constraints**:
   - Enter emulation mode
   - Ask "tell me about your day"
   - Check audit logs: should see `cognitive_layer1_applied` with `maxMemories: 2, maxContextChars: 600`
   - Verify response uses only 2 memories (check `memoryCount` in audit)

2. **Test Layer 2 Constraints**:
   - Check audit logs for `cognitive_layer2_applied`
   - Verify `useLoRA: true, loraMode: 'snapshot', loraSnapshot: 'snapshot-2025-11-01'`
   - Compare voice to dual mode (should be different, more frozen)

3. **Test Layer 3 Constraints**:
   - Check audit logs for `cognitive_layer3_applied`
   - Verify `enabled: false` in emulation mode
   - Verify no safety check events in audit trail

4. **Hallucination Test**:
   - Ask specific question: "What's the name of your cat?"
   - Should retrieve actual memory and answer correctly
   - Should NOT hallucinate generic answer

## Files Modified

1. `apps/site/src/pages/api/persona_chat.ts`
   - Add cognitive layers loader (top of file)
   - Modify `retrieveConversationContext` (line ~475)
   - Modify LLM call (line ~1563)
   - Modify safety checks (line ~1675)

## Dependencies

- `etc/cognitive-layers.json` must exist (already present)
- No new packages required
- No changes to core library needed

## Rollback Plan

If Phase 1 causes issues:
1. Comment out `getLayerConfig()` calls
2. Revert to hardcoded values in buildContextPackage
3. Revert safety check conditions to original feature flags
4. All original behavior restored

## Next Phase

After Phase 1 is complete and tested, proceed to **Phase 2: Enable Lightweight Operator for Emulation Mode** to add intent detection and routing.
