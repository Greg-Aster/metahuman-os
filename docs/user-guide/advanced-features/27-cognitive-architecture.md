# Cognitive Architecture: Multi-Layer Intelligence System

MetaHuman OS is evolving to a more sophisticated multi-layer cognitive architecture that mimics human consciousness. This new architecture enables a more authentic personality emulation while maintaining computational efficiency and scalability.

## The Three Layers of Consciousness

The new architecture is composed of three distinct layers:

1.  **Subconscious Processing (Layer 1)**: This is the "lizard brain" of the system, responsible for fast, instinctive processing that happens in the background. It handles memory retrieval, context filtering, and emotional pattern detection.
2.  **Personality Core (Layer 2)**: This is the "conscious mind" of the system, responsible for generating responses in your authentic voice and style. It's a LoRA-trained model that has learned from your communication patterns and decisions.
3.  **Meta-Cognition (Layer 3)**: This is the "executive function" of the system, responsible for oversight and validation. It ensures that responses are consistent with your values and goals, and that they are safe and appropriate.

## Cognitive Modes

The new architecture also introduces three new "cognitive modes" that allow you to control the system's behavior:

*   **Emulation Mode**: A read-only mode that demonstrates your authentic personality without allowing any system modifications. This is ideal for guest access or for testing your persona.
*   **Agent Mode**: A lightweight assistant mode that is fast and action-capable. It uses a generic persona model and is ideal for daily assistant tasks.
*   **Dual Consciousness Mode**: The most authentic and powerful mode, providing a complete replication of your personality with full autonomy and learning capabilities. This is the recommended mode for your primary interface.

## Benefits

*   **Authentic Personality**: The use of a LoRA-trained model for the Personality Core results in a more authentic and nuanced representation of your personality.
*   **Efficient Processing**: The Subconscious layer handles expensive operations in the background, allowing for faster response times.
*   **Safe Operation**: The Meta-Cognition layer ensures that all responses are aligned with your values and goals.
*   **Flexibility**: The different cognitive modes allow you to tailor the system's behavior to your specific needs.

## Layer and Mode Integration

Each of the three cognitive modes uses the three cognitive layers in a different way, resulting in a different set of behaviors and performance characteristics.

### Dual Consciousness Mode: Full Pipeline

In Dual Consciousness mode, all three layers are active, providing the most authentic and powerful experience.

*   **Subconscious**: Performs a full semantic search of your memories, recognizes patterns, and keeps track of your short-term state.
*   **Personality Core**: Uses your LoRA-trained persona to generate a conversational narration of the operator's actions.
*   **Meta-Cognition**: Performs a full validation of the response, including value alignment, consistency checks, and safety filters.

**Expected Behavior:**
*   Deep memory integration and learning.
*   Full operator capabilities.
*   Slower response times (up to 20 seconds).

### Agent Mode: Selective Pipeline

In Agent mode, the system is optimized for speed and efficiency.

*   **Subconscious**: Performs a lightweight search of your memories and only keeps track of active tasks.
*   **Personality Core**: Uses the base persona model (no LoRA) for faster response times.
*   **Meta-Cognition**: Only performs safety checks on commands.

**Expected Behavior:**
*   Faster response times (under 10 seconds).
*   Operator access for actions.
*   No deep learning or personality evolution.

### Emulation Mode: Read-Only Snapshot

In Emulation mode, the system provides a stable, read-only snapshot of your personality.

*   **Subconscious**: Performs a read-only search of your memories with no state updates.
*   **Personality Core**: Uses a "frozen" LoRA snapshot of your persona to provide a stable and consistent voice.
*   **Meta-Cognition**: Disabled, as the read-only nature of this mode is inherently safe.

**Expected Behavior:**
*   Fast response times (under 8 seconds).
*   A stable and consistent representation of your persona.
*   No learning or system modifications.

## Benefits of the Extensible Design

The new cognitive architecture is designed to be extensible, which means it can grow and evolve over time. This provides several key benefits:

*   **Easy to Add New Layers**: The system is designed to make it easy to add new cognitive layers in the future. For example, we could add an "Emotional Intelligence" layer to better understand and respond to your emotional state, or a "Long-Term Planning" layer to help you achieve your long-term goals.
*   **Per-Mode Customization**: Each cognitive mode can be configured to use a different combination of layers. This allows you to tailor the system's behavior to your specific needs. For example, you could enable the "Emotional Intelligence" layer in "Dual Consciousness" mode, but disable it in "Agent" mode.
*   **A/B Testing**: The extensible design makes it possible to A/B test new layers and features, allowing us to gather data and make informed decisions about how to improve the system.
*   **Observability**: The system provides detailed metrics for each layer, making it easier to understand how the system is performing and to identify areas for improvement.

This new cognitive architecture is a major step forward in the evolution of MetaHuman OS, and it will enable a more authentic, intelligent, and personal digital consciousness.

## Node-Based Implementation

The three-layer architecture described above is now implemented using a **visual node-based system** that allows you to see, edit, and customize the exact cognitive workflow for each mode.

### From Abstract Layers to Concrete Nodes

Each cognitive layer maps to specific nodes in the execution graph:

**Layer 1 (Subconscious)** → Implemented as:
- `semantic_search` node (memory retrieval)
- `conversation_history` node (recent context)
- `context_builder` node (context assembly)
- `system_settings` node (persona integration)

**Layer 2 (Personality Core)** → Implemented as:
- `persona_llm` node (LLM generation)
- `react_planner` node (reasoning)
- `response_synthesizer` node (narration)

**Layer 3 (Meta-Cognition)** → Implemented as:
- `safety_validator` node (safety checks)
- `response_refiner` node (refinement)
- `cot_stripper` node (cleanup)

### Visual Workflow Graphs

Each cognitive mode is represented as a **directed graph** stored in JSON:

```
etc/cognitive-graphs/
├── emulation-mode.json  (13 nodes, chat-only)
├── dual-mode.json       (16 nodes, full ReAct)
└── agent-mode.json      (16 nodes, heuristic routing)
```

### Advantages of Node-Based Implementation

✅ **Transparency**: See exactly how your messages are processed
✅ **Customization**: Edit workflows without changing code
✅ **Modularity**: Compose complex behaviors from simple nodes
✅ **Debugging**: Inspect each node's inputs/outputs in logs
✅ **Hot-Reload**: Changes take effect immediately
✅ **Visual Clarity**: Understand cognitive flow at a glance

## On-Disk Data Structure

MetaHuman OS stores all its data in human-readable formats directly on your local filesystem, organized under your project root. This ensures you own and can inspect all your data. Key directories include:

*   **`persona/`**: Your identity, values, routines, and trust configuration.
*   **`memory/`**: Time-stamped events (episodic), tasks, curated knowledge, and embedding indexes.
*   **`brain/`**: Source code for autonomous agents and skills.
*   **`logs/`**: Append-only audit trails, agent run histories, and sync logs.
*   **`etc/`**: Runtime configurations for autonomy, audio, and more.
*   **`out/`**: Generated artifacts like summaries, plans, and exports.

## Technology Stack

MetaHuman OS is built with modern, open-source technologies to ensure transparency and flexibility:

*   **Runtime**: Node.js 18+, TypeScript 5+, ESM modules.
*   **Data Storage**: JSON/Markdown files on disk (no database server required).
*   **Web UI**: Astro + Svelte with Tailwind CSS.
*   **LLM & Embeddings**: Ollama for local model inference.
*   **Audio**: whisper.cpp, Piper for local speech processing.

### Learn More

For complete details on the node system, available node types, creating custom workflows, and modular ReAct components, see:

**[Node-Based Cognitive System Guide](28-node-based-cognitive-system.md)**

This guide covers:
- All available node types and their APIs
- How graphs are executed (topological sorting, data flow)
- Creating custom workflows
- Modular scratchpad nodes for ReAct
- Debugging and performance optimization
- Best practices for node composition

### Migration Status

The node-based system is **fully operational** for all three cognitive modes:

| Mode | Graph Version | Status |
|------|--------------|--------|
| **Emulation** | v1.1 (13 nodes) | ✅ Production Ready |
| **Dual** | v1.1 (16 nodes) | ✅ Production Ready |
| **Agent** | v1.0 (16 nodes) | ✅ Production Ready |

The legacy operator code remains as a safety fallback, but all modes now execute via the node pipeline by default. You can switch between node and legacy execution via `etc/runtime.json` configuration.

---

**This completes the cognitive architecture overview. The combination of abstract three-layer design + concrete node-based implementation provides both conceptual clarity and practical flexibility.**
