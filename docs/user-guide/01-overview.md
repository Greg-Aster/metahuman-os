# MetaHuman OS — Complete User Guide & Documentation

## Table of Contents
1. [Overview](#overview)
2. [Quick Start](#quick-start)
3. [Project Structure](#project-structure)
4. [Core Concepts](#core-concepts)
5. [User Interface](#user-interface)
6. [Command Line Interface](#command-line-interface)
7. [Memory System](#memory-system)
8. [Autonomous Agents](#autonomous-agents)
9. [Skills System](#skills-system)
10. [Security & Trust Model](#security--trust-model)
11. [Special Features](#special-features)
12. [Troubleshooting](#troubleshooting)
13. [Advanced Usage](#advanced-usage)

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
- **Autonomous by Design**: A progressive trust model and autonomous agents (Organizer, Reflector, Dreamer, Ingestor, etc.) that iterate across every registered user.
- **Advanced Memory System**: Episodic, reflection, task, curated, AI ingestor, audio, and dream streams are all browsable in the web UI—each scoped to the active profile.
- **Cognitive Modes**: Switch between `Dual Consciousness`, `Agent`, and `Emulation` to control system behaviour, learning, and memory capture. High-security and “wetware deceased” states restrict modes automatically.
- **Local-First & Privacy-Focused**: All data, reasoning, and AI processing (via Ollama and local STT/TTS pipelines) happens on your infrastructure. Audit logs keep every action accountable.
- **Voice & Audio Tooling**: Each user may collect training samples while referencing a shared library of Piper voices. Voice settings now live in `profiles/<username>/etc/voice.json`.
- **Comprehensive CLI & Web UI**: Interact through a powerful CLI (`./bin/mh`) or modern web interface featuring chat, dashboards, memory tools, voice controls, and system configuration.
- **Unified Security Policy**: Centralized trust enforcement, per-user isolation, and strict anonymous-mode protections ensure guest browsing never leaks private data.

---
