# Dual Consciousness Operating Model

**Status:** Concept draft  
**Owner:** Greg Aster (MetaHuman OS)  
**Date:** 2025-11-02

## 1. Intent

We are not building a conversational assistant that occasionally runs commands; we are constructing a dual-consciousness system. The primary voice must be the curated memory corpus plus the evolving persona (LoRA), with the LLM acting as the subconscious planner. Every outward action should reflect:

- The user’s recorded memories, reflections, and identity core.
- The persona rules encoded in adapters/LoRAs.
- Autonomous operator executions, not raw model whimsy.

Direct LLM responses that ignore stored memories are treated as failures—the “lizard brain” should plan, but the “persona” must speak.

## 2. Observed Issues

- **Chat bypass:** The router often falls back to freeform chat, bypassing the operator and ignoring memory context.
- **Rigid guardrails:** YOLO mode still downgrades to strict behaviour, so decisive actions (duplicate cleanup, deletions) stall.
- **No explicit memory reflection workflow:** Requests like “share your reflection” produce improvised responses instead of curated reflections drawn from stored events.
- **Missing skills:** Operations such as deleting tasks rely on status changes because there was no `tasks.delete`, undermining autonomy.
- **Wiring mismatch:** Planner prompts still prioritise clarification over action, even in YOLO.

## 3. Architectural Principles

1. **Operator-first pipeline:** Every user turn begins with the planner/operator stack. The chat model never responds directly without reading memories or invoking skills.
2. **Separated cognition vs narration:**  
   - *Planner (subconscious)*: reads memories, consults persona core, decides actions.  
   - *Narrator (conscious)*: summarises tool outputs and presents them to the user.
3. **Memory grounding:** Responses must cite retrieved memories/persona data. If the planner can’t find relevant material, it explicitly states the gap instead of hallucinating.
4. **Decisive YOLO mode:** YOLO should survive low-confidence assessments, acting with reasonable defaults (e.g., delete the duplicate `todo` entry). Guardrails log rather than block.
5. **Inline reasoning logs:** Every turn stores a “decision log” memory so future reflections and training can inspect the inner monologue.

## 4. Mode-Specific Expectations

The behaviours below apply **only when the cognitive mode selector (top bar) is set to _Dual Consciousness_**. Other modes (Agent / Emulation) may keep today’s lighter behaviour.

| Subsystem | Dual Consciousness | Agent | Emulation |
|-----------|-------------------|-------|-----------|
| Router / Planner | Always run the operator pipeline; no direct chat. Mandatory memory fetch + reasoning. | Operator optional; allow short answers for simple commands. | Operator optional, but responses must be read-only (no writes). |
| Memory Writes | Full read/write. Voice + CLI logs persisted. | Command outcomes only. | Read-only (responses reference memories but never store). |
| Proactive Agents | Enabled (`boredom-service`, organizer, etc.) | Disabled unless user opts-in. | Disabled. |
| Training Pipeline | Dual-trigger ready (full-cycle can kick in). | Disabled. | Disabled. |
| Reflections | Drawn from stored reflection memories; never improvised. | Optional. | Frozen “persona snapshot.” |
| Output Voice | Persona + citation highlighting required. | Informational tone OK. | Stable personality, no learning. |

Only the Dual mode requires the strict cognitive loop outlined below; the document assumes Agent/Emulation will gradually gain their own blueprints.

## 5. Proposed Cognitive Flow (Dual Mode)

```
User request
  ↓
Router → enforce Planner/Operator (LLM)  ✅ Dual-only
  ↓
Planner loads persona core + mode defaults
  ↓
Planner executes mandatory memory fetch
  • semantic search (search_index)
  • curated reflection fetch (new helper)
  • relevant persona summaries
  ↓
Planner composes tool plan (tasks/calendar/files/etc.)
  ↓
Operator executes plan (YOLO or strict)
  ↓
Planner synthesises narrative using tool outputs + citations
  ↓
Compliance check (ensure references cited, persona alignment)
  ↓
Final narrator response to user
  ↓
Decision log written to memory
```

## 6. Implementation Plan (Dual Mode)

### Phase 1 – Guardrail & Skill Foundations
1. **Routing overhaul (dual mode):** If `cognitive-mode.json` reports `"currentMode": "dual"`, `/api/persona_chat` must always engage the operator plan. (`shouldUseOperator` shouldn’t allow a “chat” shortcut.)
2. **Mandatory memory fetch:** Build helper(s) to pull reflections/persona snippets; planner must execute them before the operator runs.
3. **Task toolkit:** `tasks.delete`, relaxed YOLO instructions, and ID backfilling stay in place so dual mode can perform decisive cleanups.

### Phase 2 – Cognitive/Narrative Separation
1. **Planner vs narrator contract:** Planner returns structured JSON (plan, evidence, draft). Narrator renders the final persona voice using only the evidence.
2. **Citation enforcement:** Responses must list memory sources; missing citations trigger replanning.
3. **Reasoning log memory:** After each turn, save a trimmed log describing assumptions, actions, and links.

### Phase 3 – Persona & Mode Integration
1. **Mode defaults hook:** When the top-bar selector changes to Dual, apply mode defaults (recording enabled, proactive agents on, training pipeline = dual-trigger). Switching out resets to that mode’s defaults.
2. **LoRA/adapter retrieval:** Planner inspects active adapter metadata to condition decisions.
3. **Reflection skill:** Add a domain-specific tool (e.g., `memory.reflect`) that produces curated self-reflection from recent events.

### Phase 4 – Safety & Autonomy Polishing
1. **Compliance pass:** Add a lightweight rule checker that vets the narrator output against persona constraints and policy.
2. **Self-critique fallback:** If the plan fails or citations are missing, automatically replan before the user sees a response.
3. **Monitoring:** Log YOLO actions separately for auditing and future tuning.

## 7. Open Questions

- What baseline LoRA/persona traits should be loaded at startup vs per-mode?
- How should conflicting memories be reconciled (e.g., two behaviors with equal weight)?
- Do we ever allow direct chat for “small talk,” or is every turn strictly tool-driven?
- How do we keep reflection responses fresh without overloading the user with historical detail?

## 8. Next Steps

1. Adopt the Phase 1 changes immediately so the operator stays in control and duplicates can be removed autonomously.
2. Prototype the planner/narrator split for reflection requests to validate the flow.
3. Draft compliance heuristics that map persona rules to automated checks.
4. Define LoRA/persona metadata schema so future adapters can guide planner decisions.

By enforcing this architecture, MetaHuman OS moves from “chatbot with tools” to an experimental dual-consciousness agent whose outward behavior is a faithful synthesis of memories, persona, and autonomous operators.
