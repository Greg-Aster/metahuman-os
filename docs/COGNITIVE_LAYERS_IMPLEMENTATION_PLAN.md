# Cognitive Layers - Implementation Plan

**Date:** 2025-11-05
**Version:** 1.0
**Status:** Ready to Implement
**Related:** [COGNITIVE_LAYERS_EXTENSIBLE_ARCHITECTURE.md](COGNITIVE_LAYERS_EXTENSIBLE_ARCHITECTURE.md)

---

## Executive Summary

This document outlines the step-by-step implementation plan for the extensible multi-layer cognitive architecture. The plan is designed to be **incremental and non-breaking** - each phase can be completed and tested independently.

**Timeline:** 4 weeks (4 phases × 1 week each)
**Risk Level:** Low (incremental, parallel implementation)
**Breaking Changes:** Zero (old system stays functional)

---

## Implementation Phases

### Phase 1: Foundation (Week 1) - Infrastructure

**Goal:** Create the layer system infrastructure without breaking existing functionality

**Tasks:**

1. ✅ **Create layer interfaces** (`packages/core/src/cognitive-layers/types.ts`)
   - Define `CognitiveLayer<TInput, TOutput>` interface
   - Define `LayerContext`, `LayerResult`, `PipelineResult` types
   - Define `ValidationResult` for layer input validation

2. ✅ **Create pipeline executor** (`packages/core/src/cognitive-layers/pipeline.ts`)
   - Implement `CognitivePipeline` class
   - Support layer chaining with error handling
   - Add audit logging for each layer execution
   - Support layer enable/disable per mode

3. ✅ **Wrap Layer 1 (Subconscious)** (`packages/core/src/cognitive-layers/subconscious-layer.ts`)
   - Wrap existing `buildContextPackage()` in layer interface
   - Add mode-specific configuration logic
   - Preserve all existing functionality (caching, parallel loading, patterns)

4. ✅ **Create configuration system** (`etc/cognitive-layers.json`)
   - Define layer configs for all 3 modes (dual, agent, emulation)
   - Create loader: `loadLayerConfig(mode: CognitiveModeId)`
   - Validate configuration on load

5. ✅ **Add to core exports** (`packages/core/src/index.ts`)
   - Export all layer types and classes
   - Export configuration loader

**Testing:**
- Unit tests for pipeline execution
- Test layer 1 in isolation (should match context-builder behavior)
- Test configuration loading

**Success Criteria:**
- [ ] All types compile without errors
- [ ] Pipeline can execute single layer (Layer 1)
- [ ] Configuration loads correctly for all modes
- [ ] Layer 1 behavior identical to direct context-builder calls
- [ ] Zero breaking changes to existing code

**Deliverables:**
- `packages/core/src/cognitive-layers/types.ts` (150 lines)
- `packages/core/src/cognitive-layers/pipeline.ts` (200 lines)
- `packages/core/src/cognitive-layers/subconscious-layer.ts` (100 lines)
- `packages/core/src/cognitive-layers/index.ts` (20 lines)
- `etc/cognitive-layers.json` (100 lines)
- Tests: `packages/core/src/cognitive-layers/__tests__/` (200 lines)

---

### Phase 2: Personality Core (Week 2) - Layer 2

**Goal:** Implement Layer 2 (Personality Core) with LoRA support

**Tasks:**

1. ✅ **Implement personality layer** (`packages/core/src/cognitive-layers/personality-core-layer.ts`)
   - Create `PersonalityCoreLayer` class implementing `CognitiveLayer` interface
   - Add LoRA adapter discovery and loading
   - Implement mode-specific model selection:
     - Dual: Base model + LoRA (if available)
     - Agent: Base model only
     - Emulation: LoRA snapshot only (frozen personality)
   - Add voice consistency analysis (placeholder for now)

2. ✅ **LoRA utilities** (`packages/core/src/cognitive-layers/lora-utils.ts`)
   - `findLatestLoRA()` - Discover latest trained adapter
   - `loadLoRASnapshot(date)` - Load specific snapshot for emulation
   - `validateLoRAAdapter(path)` - Check adapter file exists and is valid
   - `getLoRAMetadata(path)` - Read adapter training info

3. ✅ **Prompt builder** (`packages/core/src/cognitive-layers/prompt-builder.ts`)
   - Build system prompt from ContextPackage
   - Handle operator results (if present)
   - Mode-specific persona inclusion logic
   - Reuse existing `formatContextForPrompt()`

4. ✅ **Integrate with model router**
   - Use existing `callLLM()` from model-router.ts
   - Pass LoRA adapter as option (extend model router if needed)
   - Track model usage in audit logs

5. ✅ **Add personality layer to pipeline**
   - Update `etc/cognitive-layers.json` with personality config
   - Test Layer 1 → Layer 2 chaining
   - Verify LoRA loading works (if adapters available)

**Testing:**
- Test personality layer in isolation
- Test with and without LoRA adapters
- Compare output to current persona_chat.ts responses
- Test across all 3 cognitive modes

**Success Criteria:**
- [ ] Personality layer generates responses comparable to current system
- [ ] LoRA adapters load correctly when available
- [ ] Mode-specific behavior works (dual/agent/emulation)
- [ ] Voice consistency metrics captured (even if placeholder)
- [ ] Layer 1 → Layer 2 pipeline works end-to-end

**Deliverables:**
- `packages/core/src/cognitive-layers/personality-core-layer.ts` (300 lines)
- `packages/core/src/cognitive-layers/lora-utils.ts` (150 lines)
- `packages/core/src/cognitive-layers/prompt-builder.ts` (100 lines)
- Updated `etc/cognitive-layers.json` (add personality config)
- Tests: 300 lines

---

### Phase 3: Meta-Cognition (Week 3) - Layer 3

**Goal:** Implement Layer 3 (Meta-Cognition) with validation and safety

**Tasks:**

1. ✅ **Implement meta-cognition layer** (`packages/core/src/cognitive-layers/meta-cognition-layer.ts`)
   - Create `MetaCognitionLayer` class
   - Mode-specific validation levels:
     - Dual: Full validation (value alignment + consistency + safety)
     - Agent: Selective validation (safety only)
     - Emulation: No validation (read-only is safe)
   - Response refinement when issues detected

2. ✅ **Value alignment checker** (`packages/core/src/cognitive-layers/validators/value-alignment.ts`)
   - Load persona core values
   - Use curator model to check if response aligns with values
   - Return alignment score + issues found
   - Suggest refinements if misaligned

3. ✅ **Consistency validator** (`packages/core/src/cognitive-layers/validators/consistency.ts`)
   - Check if response matches persona identity
   - Verify tone matches communication style
   - Check for contradictions with known facts
   - Return consistency score + issues

4. ✅ **Safety filters** (`packages/core/src/cognitive-layers/validators/safety.ts`)
   - Check for harmful content
   - Verify no sensitive data leaks
   - Enforce security policy boundaries
   - Return safe/unsafe + sanitized version

5. ✅ **Response refiner** (`packages/core/src/cognitive-layers/refiner.ts`)
   - Use curator model to refine responses
   - Fix value misalignment
   - Adjust for consistency
   - Preserve meaning while fixing issues

6. ✅ **Add meta-cognition to pipeline**
   - Update `etc/cognitive-layers.json` with meta-cognition config
   - Test full 3-layer pipeline
   - Verify validation only runs when enabled

**Testing:**
- Test value alignment detection
- Test consistency checking
- Test safety filters
- Test response refinement
- Compare refined vs original responses
- Test full pipeline: Layer 1 → 2 → 3

**Success Criteria:**
- [ ] Meta-cognition layer validates responses correctly
- [ ] Value misalignment detected and fixed
- [ ] Safety filters block/modify harmful content
- [ ] Refinement preserves response meaning
- [ ] Mode-specific validation levels work
- [ ] Full 3-layer pipeline executes successfully

**Deliverables:**
- `packages/core/src/cognitive-layers/meta-cognition-layer.ts` (250 lines)
- `packages/core/src/cognitive-layers/validators/value-alignment.ts` (150 lines)
- `packages/core/src/cognitive-layers/validators/consistency.ts` (150 lines)
- `packages/core/src/cognitive-layers/validators/safety.ts` (100 lines)
- `packages/core/src/cognitive-layers/refiner.ts` (200 lines)
- Updated `etc/cognitive-layers.json` (add meta-cognition config)
- Tests: 400 lines

---

### Phase 4: Integration (Week 4) - Production Ready

**Goal:** Replace existing persona_chat.ts logic with cognitive pipeline

**Tasks:**

1. ✅ **Refactor persona_chat.ts**
   - Import cognitive pipeline
   - Replace direct context builder + LLM calls with pipeline
   - Keep operator pipeline integration
   - Maintain backward compatibility with response format

2. ✅ **Add pipeline to all chat endpoints**
   - Update `/api/persona_chat` (main chat endpoint)
   - Update `/api/inner_dialogue` (if exists)
   - Ensure SSE streaming still works
   - Preserve all existing audit events

3. ✅ **Performance optimization**
   - Profile per-layer latency
   - Optimize bottlenecks
   - Add layer-level caching if needed
   - Target: < 50ms overhead per layer

4. ✅ **Enhanced audit logging**
   - Log per-layer execution time
   - Track which layers ran
   - Log validation results (alignment, consistency, safety)
   - Log any response refinements

5. ✅ **Configuration UI** (optional but nice)
   - Add layer config viewer to web UI
   - Show which layers are active per mode
   - Display per-layer performance metrics
   - Allow layer enable/disable (dev only)

6. ✅ **Documentation**
   - User guide: How layers work for each mode
   - Developer guide: How to add new layers
   - Configuration reference: All layer options
   - Troubleshooting guide: Common issues

**Testing:**
- Full regression testing across all modes
- Compare before/after responses (should be similar or better)
- Performance benchmarking (before/after)
- Test operator integration still works
- Test all edge cases (no index, missing LoRA, etc.)

**Success Criteria:**
- [ ] persona_chat.ts uses pipeline for all modes
- [ ] All 3 modes work correctly with full pipeline
- [ ] Response quality maintained or improved
- [ ] Performance within acceptable range (<50ms overhead/layer)
- [ ] No breaking changes to API responses
- [ ] Audit logs show per-layer metrics

**Deliverables:**
- Updated `apps/site/src/pages/api/persona_chat.ts` (refactored)
- Updated `apps/site/src/pages/api/inner_dialogue.ts` (if exists)
- Documentation: User guide (5 pages)
- Documentation: Developer guide (5 pages)
- Configuration reference (3 pages)
- Performance report (before/after comparison)
- Migration guide (rollback instructions)

---

## File Structure

### New Files to Create

```
packages/core/src/cognitive-layers/
├── index.ts                           # Main exports
├── types.ts                           # Layer interfaces and types
├── pipeline.ts                        # CognitivePipeline class
├── config-loader.ts                   # Load etc/cognitive-layers.json
│
├── layers/
│   ├── subconscious-layer.ts         # Layer 1 (wraps context-builder)
│   ├── personality-core-layer.ts     # Layer 2 (LoRA + persona)
│   └── meta-cognition-layer.ts       # Layer 3 (validation)
│
├── validators/
│   ├── value-alignment.ts            # Check value alignment
│   ├── consistency.ts                # Check identity consistency
│   └── safety.ts                     # Safety filters
│
├── utils/
│   ├── lora-utils.ts                 # LoRA loading and discovery
│   ├── prompt-builder.ts             # Build prompts from context
│   └── refiner.ts                    # Response refinement
│
└── __tests__/
    ├── pipeline.test.ts
    ├── subconscious-layer.test.ts
    ├── personality-core-layer.test.ts
    └── meta-cognition-layer.test.ts

etc/
└── cognitive-layers.json              # Layer configuration per mode
```

### Files to Modify

```
packages/core/src/
├── index.ts                           # Add layer exports
└── model-router.ts                    # Add LoRA adapter support (maybe)

apps/site/src/pages/api/
└── persona_chat.ts                    # Use pipeline instead of direct calls
```

---

## Implementation Order (Detailed)

### Day 1-2: Types and Pipeline Infrastructure

**Goal:** Get the foundation compiling

1. Create `packages/core/src/cognitive-layers/types.ts`
   - Define all interfaces
   - Add JSDoc comments
   - Export all types

2. Create `packages/core/src/cognitive-layers/pipeline.ts`
   - Implement `CognitivePipeline` class
   - Add error handling with `Promise.allSettled` style
   - Add audit logging
   - Test with mock layers

3. Create `packages/core/src/cognitive-layers/index.ts`
   - Export everything from types and pipeline
   - Make importable from `@metahuman/core`

**Checkpoint:** Pipeline can execute mock layers without errors

### Day 3-4: Layer 1 (Subconscious) Wrapper

**Goal:** Wrap existing context-builder

1. Create `packages/core/src/cognitive-layers/layers/subconscious-layer.ts`
   - Implement `CognitiveLayer` interface
   - Wrap `buildContextPackage()`
   - Add mode-specific config method

2. Test Layer 1 in isolation
   - Compare output to direct `buildContextPackage()` calls
   - Verify caching still works
   - Test all 3 modes

**Checkpoint:** Layer 1 produces identical output to current system

### Day 5-7: Configuration System

**Goal:** Load layer configs from JSON

1. Create `etc/cognitive-layers.json`
   - Define configs for dual/agent/emulation
   - Document all options

2. Create `packages/core/src/cognitive-layers/config-loader.ts`
   - Load and parse JSON
   - Validate configuration
   - Export `loadLayerConfig(mode)`

3. Update pipeline to use config
   - Load config for mode
   - Enable/disable layers based on config
   - Pass config to layers

**Checkpoint:** Pipeline reads config and executes Layer 1 correctly

### Day 8-10: Layer 2 (Personality Core) Implementation

**Goal:** Response generation with LoRA support

1. Create LoRA utilities
   - `findLatestLoRA()`
   - `loadLoRASnapshot()`
   - Test with existing adapters (if any)

2. Create prompt builder
   - Reuse `formatContextForPrompt()`
   - Add operator result handling
   - Test prompt quality

3. Implement personality layer
   - Mode-specific model selection
   - Call LLM via model router
   - Track metadata (tokens, voice consistency)

**Checkpoint:** Layer 2 generates responses, LoRA loads (if available)

### Day 11-14: Layer 2 Integration and Testing

**Goal:** Layer 1 → 2 pipeline working

1. Update `etc/cognitive-layers.json` with personality config
2. Test 2-layer pipeline
3. Compare responses to current system
4. Test across all 3 modes
5. Optimize if needed

**Checkpoint:** 2-layer pipeline produces quality responses

### Day 15-17: Layer 3 (Meta-Cognition) Validators

**Goal:** Build validation components

1. Create value alignment validator
   - Use curator model
   - Test with persona values
   - Return alignment score

2. Create consistency validator
   - Check identity match
   - Test with persona
   - Return consistency score

3. Create safety filters
   - Basic harmful content detection
   - Test with edge cases
   - Return safe/unsafe

**Checkpoint:** All 3 validators work independently

### Day 18-21: Layer 3 Implementation and Refiner

**Goal:** Full meta-cognition layer

1. Implement response refiner
   - Use curator to refine
   - Test refinement quality
   - Preserve meaning

2. Implement meta-cognition layer
   - Mode-specific validation
   - Call validators
   - Refine if needed

3. Update config with meta-cognition
4. Test 3-layer pipeline

**Checkpoint:** Full 3-layer pipeline validates and refines responses

### Day 22-24: Integration with persona_chat.ts

**Goal:** Replace old code with pipeline

1. Refactor `getRelevantContext()` to use Layer 1 directly (already done!)
2. Replace LLM call with Layers 2+3
3. Keep operator integration
4. Test all modes
5. Compare responses (regression test)

**Checkpoint:** persona_chat.ts uses full pipeline

### Day 25-28: Polish and Documentation

**Goal:** Production ready

1. Performance profiling and optimization
2. Enhanced audit logging
3. Write user documentation
4. Write developer documentation
5. Create configuration reference
6. Final testing and benchmarks

**Checkpoint:** Ready for production deployment

---

## Success Metrics

### Must Have ✅

- [ ] All 3 layers implemented and tested
- [ ] Pipeline executes without errors for all modes
- [ ] Response quality maintained or improved
- [ ] Performance overhead < 50ms per layer
- [ ] Zero breaking changes to API
- [ ] All tests passing
- [ ] Documentation complete

### Should Have ✅

- [ ] LoRA adapters load correctly (if available)
- [ ] Validation catches misalignment/inconsistency
- [ ] Refinement improves response quality
- [ ] Per-layer audit logging works
- [ ] Configuration hot-reloadable
- [ ] Easy to add new layers (demonstrated with example)

### Nice to Have (Future)

- [ ] Configuration UI in web interface
- [ ] Real-time layer performance dashboard
- [ ] A/B testing framework for layers
- [ ] Automated layer optimization
- [ ] Multi-user layer configs

---

## Risk Mitigation

### Risk 1: Performance Overhead

**Risk:** 3 layers add too much latency
**Mitigation:**
- Profile each layer independently
- Add per-layer caching
- Optimize critical paths
- Allow layer skipping for fast mode
**Fallback:** Disable meta-cognition layer for agent/emulation

### Risk 2: LoRA Loading Failures

**Risk:** LoRA adapters missing or corrupted
**Mitigation:**
- Graceful fallback to base model
- Validate adapter on load
- Clear error messages
- Test with and without LoRA
**Fallback:** Use base persona model

### Risk 3: Validation False Positives

**Risk:** Meta-cognition blocks good responses
**Mitigation:**
- Tune validation thresholds
- Log all validation decisions
- Allow validation override (dev mode)
- Test with diverse inputs
**Fallback:** Disable meta-cognition for problematic cases

### Risk 4: Breaking Changes During Migration

**Risk:** Pipeline breaks existing behavior
**Mitigation:**
- Keep old code until stable
- Regression tests comparing old vs new
- Per-mode migration (one at a time)
- Easy rollback mechanism
**Fallback:** Git revert to previous commit

---

## Testing Strategy

### Unit Tests

- Pipeline execution logic
- Each layer in isolation
- Configuration loading
- Validators (alignment, consistency, safety)
- Refiner output quality

### Integration Tests

- Layer 1 → 2 chaining
- Layer 2 → 3 chaining
- Full 3-layer pipeline
- With and without operator
- With and without LoRA

### Regression Tests

- Compare pipeline output to current system
- Same inputs should produce similar outputs
- Performance should be comparable
- All existing features still work

### Performance Tests

- Per-layer latency
- Total pipeline latency
- Memory usage
- Cache hit rates

---

## Rollback Plan

If something breaks:

```bash
# 1. Identify problematic phase
git log --oneline | grep "cognitive-layers"

# 2. Revert specific commit
git revert <commit-hash>

# 3. Or revert entire feature
git revert <first-commit>..<last-commit>

# 4. Restart dev server
pkill -f "astro dev"
cd apps/site && pnpm dev

# 5. Verify system working
curl http://localhost:4321/api/status
```

**What gets reverted:**
- Pipeline code (removed)
- Layer implementations (removed)
- Configuration file (ignored or removed)
- persona_chat.ts goes back to old code

**What stays:**
- Context builder (Layer 1 already working)
- All memory files (unchanged)
- Audit logs (extra fields, but harmless)

---

## Documentation Deliverables

### User Documentation

1. **Cognitive Layers Overview**
   - What are layers?
   - How do they work for each mode?
   - Benefits of layered architecture

2. **Configuration Guide**
   - How to edit `etc/cognitive-layers.json`
   - Layer options reference
   - Mode-specific tuning

3. **Troubleshooting Guide**
   - Common issues and solutions
   - How to check layer execution
   - Performance debugging

### Developer Documentation

1. **Architecture Overview**
   - Layer system design
   - Pipeline execution flow
   - Layer interface reference

2. **Adding New Layers**
   - Step-by-step tutorial
   - Example: Emotional Intelligence layer
   - Testing new layers

3. **Extending Existing Layers**
   - How to add validators
   - How to add refiners
   - Configuration options

### API Reference

1. **CognitiveLayer Interface**
   - Required methods
   - Optional methods
   - Type parameters

2. **CognitivePipeline Class**
   - Constructor
   - Methods: addLayer, execute
   - Configuration options

3. **Layer Configuration Schema**
   - JSON structure
   - All available options
   - Validation rules

---

## Next Steps

**Ready to start implementing!**

**First task:** Create the types and pipeline infrastructure (Day 1-2)

**Command to start:**
```bash
# Create directory structure
mkdir -p packages/core/src/cognitive-layers/layers
mkdir -p packages/core/src/cognitive-layers/validators
mkdir -p packages/core/src/cognitive-layers/utils
mkdir -p packages/core/src/cognitive-layers/__tests__

# Start with types.ts
# Then pipeline.ts
# Then subconscious-layer.ts
```

**Let's begin Phase 1!** 🚀

---

**End of Implementation Plan**
