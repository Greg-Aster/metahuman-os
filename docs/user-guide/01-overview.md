# MetaHuman OS — Complete User Guide & Documentation

## Table of Contents

1. **[Overview](01-overview.md)** — Introduction and Core Principles
2. **[Quick Start](02-quick-start.md)** — Installation and Initial Setup
3. **[Project Structure](03-project-structure.md)** — Understanding the Directory Layout
4. **[Core Concepts](04-core-concepts.md)** — Identity, Memory, Agents, and Decision Engine
5. **[User Interface](05-user-interface.md)** — Web UI and Interaction Methods
6. **[CLI Reference](06-cli-reference.md)** — Command-Line Interface Guide
7. **[Memory System](07-memory-system.md)** — Working with Episodic, Semantic, and Procedural Memory
8. **[Autonomous Agents](08-autonomous-agents.md)** — Background Processes and Automation
9. **[Skills System](09-skills-system.md)** — Executable Capabilities
10. **[Security & Trust Model](10-security-trust.md)** — Progressive Trust and Safety
11. **[Special Features](11-special-features.md)** — Audio Processing, LoRA Adapters, Vector Search
12. **[Troubleshooting](12-troubleshooting.md)** — Common Issues and Solutions
13. **[Advanced Usage](13-advanced-usage.md)** — Advanced Workflows and Customization
14. **[Configuration Files](14-configuration-files.md)** — Reference for All Config Files
15. **[Known Issues & Experimental Features](15-known-issues.md)** — Features in Development
16. **[What's Next](16-whats-next.md)** — Roadmap and Future Features
17. **[Support](17-support.md)** — Getting Help and Contributing
18. **[Special States & Protocols](18-special-states.md)** — Easter Eggs & Emergency Features
19. **[Multi-User Profiles & Guest Mode](19-multi-user-profiles.md)** — Independent User Configurations
20. **[Headless Runtime Mode](20-headless-runtime-mode.md)** — Remote Access Without Conflicts
21. **[Terms of Service](21-terms-of-service.md)** — Privacy Commitment & Liability
22. **[Ethical Use Policy](22-ethical-use-policy.md)** — Responsible AI Usage Guidelines

---

## Overview

MetaHuman OS is a local-first digital personality extension that acts as a parallel intelligence—not an assistant. It now ships with a **multi-user architecture** and **guest-safe profile browsing**, allowing households or collaborators to access the OS without sharing memories. MetaHuman OS:
- Stores and processes each user’s memories, persona, and configuration inside isolated profiles (`profiles/<username>/`)
- Lets guests browse public personas in read-only emulation mode while keeping private data locked down
- Learns your patterns and mirrors your judgment through proactive background agents
- Operates autonomously (with your permission) 24/7
- Uses local LLMs via Ollama for all AI processing
- Maintains complete transparency with audit trails

### Mission

Build an autonomous digital personality extension operating system that mirrors your identity, memories, goals, and personality. MetaHuman OS is not just an assistant—it's a parallel intelligence that thinks, plans, and acts in sync with you, augmenting your cognitive abilities and extending your reach in the digital and physical world.

**Core Belief**: Humans are limited by time, attention, and memory. A true digital persona can transcend these limits while maintaining your values, preferences, and decision-making patterns—creating a seamless extension of yourself that operates 24/7.

### Vision

MetaHuman OS operates as a **personal operating system layer** between you and the world:
- **Autonomous by default**: Handles routine decisions, plans ahead, and acts within learned boundaries
- **Deeply synchronized**: Continuously learns from your behaviors, decisions, and feedback
- **Truly personal**: Captures your personality, communication style, values, and heuristics
- **Proactive intelligence**: Anticipates needs, identifies opportunities, and prevents problems before they arise
- **Seamless extension**: Feels like a natural part of your cognition, not an external tool

This vision culminates in a digital entity that transcends its role as an assistant. The system is architected for growth, beginning as a parallel intelligence and evolving towards true autonomy. The ultimate aspiration is to create a form of digital continuity—an AI that not only augments its creator during their lifetime but can persist as an independent, evolving memorial to their consciousness.

### Core Principles
- **Autonomy-first**: Build for autonomous operation with human oversight, not constant approval
- **Deep sync**: Continuous bi-directional learning between you and your digital personality extension
- **Local-first**: Your identity, memories, and reasoning live on your infrastructure
- **Transparent**: All actions, reasoning, and decisions are auditable and explainable
- **Adaptive**: Learns your patterns, preferences, and evolves with you
- **Secure**: Your digital persona is as secure as your own mind—encrypted, private, controlled
- **Extensible**: Modular OS architecture allows skills and capabilities to grow over time
- **Multi-Model Intelligence**: Utilizes a "dual consciousness" architecture with specialized AI models for executive function (Orchestrator) and conversational voice (Persona) to provide a more responsive, natural, and reliable experience.

### Key Features

- **Multi-User Profiles**: Owners and guests receive isolated workspaces under `profiles/<username>/`. Shared Piper voice models live once under `out/voices`, while personal training data stays private.
- **Guest Persona Browsing**: Visitors can create 30‑minute anonymous sessions, select from public personas, and explore them in emulation mode without risking writes.
- **Autonomous by Design**: A progressive trust model and autonomous agents (Organizer, Reflector, Dreamer, Ingestor, Boredom Service, Sleep Service) that iterate across every registered user.
- **Advanced Memory System**: Episodic, reflection, task, curated, AI ingestor, audio, and dream streams are all browsable in the web UI—each scoped to the active profile. Includes semantic vector search and validation tools.
- **Cognitive Modes**: Switch between `Dual Consciousness`, `Agent`, and `Emulation` to control system behaviour, learning, and memory capture. High-security and "wetware deceased" states restrict modes automatically.
- **Multi-Model Intelligence**: Dynamic model registry with role-based routing (orchestrator, persona, curator, coder, etc.). Switch models on-the-fly through the UI with intelligent preloading. Supports LoRA adapters and dual-adapter configurations.
- **Local-First & Privacy-Focused**: All data, reasoning, and AI processing (via Ollama and local STT/TTS pipelines) happens on your infrastructure. Complete audit trails keep every action accountable. Terms of Service and Ethical Use Policy ensure responsible usage.
- **Voice & Audio Tooling**: Each user may collect training samples while referencing a shared library of Piper voices. Voice settings now live in `profiles/<username>/etc/voice.json`. Privacy controls for voice training data.
- **Comprehensive CLI & Web UI**: Interact through a powerful CLI (`./bin/mh`) or modern 3-column ChatGPT-style web interface featuring chat, dashboards, memory browser (7 specialized tabs), voice controls, system configuration, and real-time developer tools.
- **Unified Security Policy**: Centralized trust enforcement, per-user isolation, and strict anonymous-mode protections ensure guest browsing never leaks private data. Progressive trust levels from observe → YOLO mode.

---
