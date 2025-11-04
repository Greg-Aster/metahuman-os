# Dual Consciousness AI Architecture — Notes

**Date:** 2025-11-04  
**Author:** Codex (with greggles)  
**Scope:** Captures the current thinking on how to structure the AI stack so that a digital persona can co-exist with an operator/orchestrator, yielding the “dual consciousness” behaviour we’re targeting.

---

## 1. High-Level Goals

- Build a system where a digital mind mirrors a real person’s voice, memories, and working style without constant prompt reminders.
- Maintain an autonomous operator that can read/write files, manage tasks, and execute skills as naturally as a human acts on intent.
- Keep latency manageable and the implementation maintainable: small, reliable components making decisions; heavier components focusing on persona fidelity and deep reasoning.

---

## 2. Recommended Separation of Responsibilities

| Tier | Role | Characteristics | Example Implementation |
|------|------|-----------------|------------------------|
| **Orchestrator** | Executive function, intent routing, tool selection, safety checks | Lightweight model (or scripted agent) with a stable prompt; always available; minimal context; aware of available skills and policies | Could be a smaller Frontier/Qwen variant or even GPT‑4o‑mini; runs locally; uses deterministic heuristics (like the current operator router) |
| **Persona Brain** | Conversational voice, introspection, long-form reasoning anchored to the individual | Heavier base model + LoRA tuned on the person’s corpus; receives semantic retrieval snippets; no direct tool execution; outputs natural replies and reflections | Keep running on a capable GPU; loaded with persona LoRA; given episodic/context documents at inference time |
| **Specialists (Optional)** | Focused tasks (coding assistant, summariser, planner) or scripted skills | Either small fine-tuned models or pure code; invoked selectively by the orchestrator when the persona or orchestrator needs results | E.g., code interpreter, summarisation micro-model, or the existing operator skills |

---

## 3. Why Split the Stack?

- **Performance & UX:** Orchestrator stay nimble (fast yes/no/tool decisions) while persona focuses on empathy and voice. Keeps the chat interface responsive.
- **Prompt Hygiene:** Tool syntax, JSON, and policies stay isolated from the persona LoRA training data, so the persona never “learns” to talk like a planner.
- **Modularity:** Each layer evolves independently. You can swap the persona LoRA, upgrade the orchestrator prompt, or add new skills without retraining everything.
- **Safety & Reliability:** The orchestrator can enforce guardrails even if the persona drifts to creative territory.

---

## 4. Persona LoRA Training Strategy

1. **Data Prep**
   - Use only identity-rich data: journal entries, conversations, essays, personal reflections.
   - Remove tool syntax, JSON logs, or operator transcripts.
   - Break into conversational-style pairs so the LoRA learns how to respond in context without extra instructions.

2. **Training Focus**
   - Aim for voice, tone, pacing, preferred reasoning style.
   - Include examples of self-reflection and meta-thinking so the digital persona can narrate internal state.
   - Keep evaluation sets (held-out conversations) to test drift and persona fidelity.

3. **Inference Flow**
   - Orchestrator retrieves relevant memories (persona core traits, recent events, active tasks).
   - Persona model receives: system preamble (e.g., “You are Greg’s digital self…”), retrieved context, user turn.
   - Persona responds; orchestrator decides whether to display directly or initiate a follow-up action.

---

## 5. Operator / Tooling Integration

- Orchestrator owns tool execution. It analyses user intent + recent dialogue and decides:
  1. Reply directly (persona).
  2. Execute a skill plan (current operator/Planner-Executor-Critic loop).
  3. Fetch data / run a specialist (e.g., summariser).
- Persona can narrate intent (“Let me read that file for you”) but does not call the skills directly; the orchestrator translates narrative intent into actual actions.
- Maintain short-term caches (e.g., last file path, recent fs_list results) so follow-up prompts like “read hotdog” map to concrete steps without more prompting.

---

## 6. Model Footprint Options

### Option A — Two Models (Recommended Baseline)
1. **Orchestrator:** Small/local or API model. Always on, low latency.
2. **Persona:** Large base + LoRA, used only when a conversational answer is needed.

### Option B — Single Base with LoRA Swaps
1. Keep a large base in VRAM.
2. Swap adapters: Neutral (for orchestration) vs. persona (for replies).
3. Requires careful prompt separation and adapter load management; swap latency can be a concern but avoids standing up a second model.

### Option C — Multi-Specialist Cluster
1. Orchestrator
2. Persona LoRA
3. Additional LoRAs or small models (code, planning, summarisation)
4. Orchestrator brokers calls among them.

---

## 7. Implementation Notes (Near-Term)

- Tighten the current router (already in progress): pass recent dialogue to improve tool-vs-chat decisions; auto-trigger file reads/writes after confirmations.
- Continue refining `getRelevantContext()` so persona responses always include core identity snippets plus the latest memories.
- Keep repository state (operator skills, cognitive modes) and persona LoRA training pipeline separate; avoid merging raw skill instructions into persona datasets.
- Consider logging orchestrator/skill decisions separately to audit whether the persona should have answered directly or triggered a tool.

---

## 8. Open Questions / Next Steps

- **Latency budgeting:** Measure the cost of separate orchestrator + persona calls. Caching or batching may be required.
- **Memory privacy & pruning:** Decide how the orchestrator selects which memories to expose per turn; craft heuristics to avoid context overload.
- **Adaptive control:** Explore reinforcement signals (success/failure feedback) so the orchestrator learns when the persona’s response already satisfied the request vs. when to escalate to tools.
- **Hardware constraints:** If GPU memory is limited, evaluate adapter swapping vs. multi-process orchestration vs. remote inference.

---

## 9. Takeaway

Treat the system as a duet:
- **Orchestrator** keeps the beat—deciding what to do, when to act, and ensuring the right tools are used.
- **Persona LoRA** carries the melody—speaking in the individual’s voice, weaving memories, and expressing intent.

By keeping those roles distinct yet synchronized, the “dual consciousness” vision—one human, one digital twin—remains achievable, maintainable, and fast enough for day-to-day use.

---

## 10. Extending Toward Multi-Model Routing

To make the stack future-proof and allow us to swap in additional models or LoRAs without rewriting core logic, introduce a **model registry** and lightweight call-site abstractions.

### 10.1 Configuration Layer

- Add a new JSON config in `etc/` (e.g., `etc/models.json`) that declares:
  ```json
  {
    "defaults": {
      "orchestrator": "orchestrator.qwen3-1.5b",
      "persona": "persona.qwen3-30b.lora",
      "curator": "curator.mistral-7b",
      "fallback": "general.ollama-13b"
    },
    "models": {
      "orchestrator.qwen3-1.5b": {
        "provider": "ollama",
        "model": "qwen3:1.5b",
        "adapters": [],
        "roles": ["orchestrator", "router"]
      },
      "persona.qwen3-30b.lora": {
        "provider": "ollama",
        "model": "qwen3:30b",
        "adapters": ["persona/greggles-lora"],
        "roles": ["persona", "conversation"]
      },
      "curator.mistral-7b": {
        "provider": "ollama",
        "model": "mistral:7b",
        "adapters": ["curation/semantic-cleaner"],
        "roles": ["curator", "memory-prep"]
      }
    }
  }
  ```
- `agent.json` can reference the new registry via a simple pointer (`"modelRegistry": "./etc/models.json"`), keeping backward compatibility.
- Each model entry can include load hints (context window, GPU preference) and safety options.
- The orchestrator and persona modules request models by role name (`requestModel('persona')`), decoupling code from specific IDs.

### 10.2 Runtime Resolver

- Implement a `model-resolver` helper in `packages/core`:
  ```ts
  type ModelRole = 'orchestrator' | 'persona' | 'curator' | 'fallback';
  function resolveModel(role: ModelRole, overrides?: Partial<RequestOptions>): ResolvedModel;
  ```
- The helper reads the registry, merges runtime overrides, and returns the provider + model ID + adapter stack.
- Allow hot-swapping at runtime by updating the JSON and reloading (or caching last-known-good configs to avoid downtime).

### 10.3 Call-Site Abstractions

- Replace raw `ollama.chat(...)` calls with wrappers:
  ```ts
  import { callLLM } from '@metahuman/core/model-router';
  const reply = await callLLM({ role: 'persona', messages, options });
  ```
- The wrapper handles:
  - Adapter loading/unloading (LoRA swaps).
  - Provider differences (Ollama vs. OpenAI vs. local gguf).
  - Telemetry/audit logging so we know which model was used per request.
- This design lets us add new roles (e.g., `dreaming`, `planner`, `critic`) without chasing code references.

---

## 11. Memory Curation / Curator Role

Persona training needs curated input rather than raw logs. Introduce a **curator** component responsible for:

1. **Pre-flight Cleaning:** Runs periodically to summarise raw transcripts into persona-friendly notes, flagging sensitive data.
2. **Training Dataset Prep:** Converts curated memories into LoRA-ready format (dialogue pairs, reflection snippets).
3. **Real-time Filtering:** When orchestrator retrieves memories, the curator can refine or redact before handing them to the persona.

Implementation sketch:

- `brain/agents/curator.ts` driven by the orchestrator or scheduled agent.
- Uses the `curator` model role for summarisation and tagging tasks.
- Writes outputs into `memory/curated/` so LoRA trainers and runtime retrieval share a consistent source.

---

## 12. Conscious vs. Unconscious Modes (Future)

To emulate dual consciousness more faithfully:

- **Conscious Layer (short-term goals):** The orchestrator keeps a rolling cache (e.g., `out/state/short-term.json`) with immediate objectives, active tasks, and guardrails. Persona can query this state to stay grounded (“We’re focusing on project X today”).
- **Unconscious Layer (long-term drift):** Periodic curator jobs digest episodic memories into themes, biases, or evolving values. These influence the next LoRA training cycle or adjust baseline prompts.
- **Persona Cache:** Maintain a lightweight `persona/cache.json` with frequently referenced facts (quirks, catchphrases) so we don’t hammer the embedding search for trivial reminders.

---

## 13. Loading & Switching Models

+ Keep the existing Ollama runtime (or any other providers) but hide direct model names behind a `callLLM({ role, ... })` helper in `packages/core`.
+ The helper resolves roles via `etc/models.json`, then dispatches to the appropriate client (Ollama, OpenAI, etc.) under the hood; swapping models is just a config change.
+ For LoRAs, register adapters that Ollama can load on demand. The resolver can list adapters in the request options, or point to pre-merged modelfiles.
+ All orchestrator, persona, curator, and specialist calls go through the helper (`callLLM({ role: 'persona', messages })`), so later we can reassign roles to new models without editing call sites.
+ Bonus: add audit logging to record which role/model handled each request; helps debug future model swaps.

---

## 14. Incremental Adoption Plan

1. **Phase 1:** Introduce the model registry + resolver. Update orchestrator/persona code paths to use role-based calls while still running the same models.
2. **Phase 2:** Stand up the curator agent using an existing mid-size model. Begin generating curated summaries for future LoRA fine-tuning.
3. **Phase 3:** Experiment with swapping in a lightweight orchestrator model. Measure latency and reliability. Add automated fallbacks.
4. **Phase 4:** Train/refine persona LoRA with the curated dataset. Plug into runtime via the role resolver.
5. **Phase 5:** Layer on conscious/unconscious state caches, giving the persona and orchestrator richer shared context.

This staged approach keeps the system functional at every step while progressively unlocking the multi-model, dual-consciousness behaviour we’re aiming for.
