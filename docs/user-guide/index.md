# MetaHuman OS User Guide

Welcome to the MetaHuman OS User Guide. This comprehensive documentation will help you understand, install, and master MetaHuman OS — an autonomous digital personality extension operating system that mirrors your identity, memories, goals, and personality.

> **Note:** Documentation is being reorganized into a hierarchical structure. New tutorials and guides are in dedicated subdirectories, while existing documentation remains in the root `user-guide/` folder.

---

## 🚀 Getting Started

Perfect for new users. Follow these guides to get up and running quickly:

1. **[Overview](01-overview.md)**
   - Introduction and core principles
   - Vision behind MetaHuman OS
   - What makes it different

2. **[Quick Start](02-quick-start.md)**
   - Installation and initial setup
   - First-time configuration
   - Starting the system

3. **[First Steps Tutorial](getting-started/03-first-steps-tutorial.md)** ⭐ NEW
   - Your first conversation
   - Recording voice samples
   - Understanding cognitive modes
   - Basic memory and task management
   - Web UI walkthrough

4. **[Project Structure](03-project-structure.md)**
   - Directory layout and organization
   - Monorepo structure
   - Where files live

5. **[Common Workflows](getting-started/05-common-workflows.md)** ⭐ NEW
   - Voice training end-to-end
   - Memory management best practices
   - LoRA adapter training pipeline
   - Multi-user profile setup
   - Task and project management
   - Backup and recovery
   - Troubleshooting common issues

---

## 📚 Core Features

Essential documentation for understanding and using MetaHuman OS:

### System Fundamentals

6. **[Core Concepts](04-core-concepts.md)**
   - Identity Kernel
   - Memory Manager
   - Autonomous Agents
   - Decision Engine
   - Cognitive Modes

7. **[User Interface](05-user-interface.md)**
   - ChatGPT-style 3-column layout
   - Left sidebar (Features)
   - Center panel (Content)
   - Right sidebar (Developer tools)
   - Memory Browser with 7 specialized tabs

8. **[CLI Reference](06-cli-reference.md)** ⭐ UPDATED
   - System commands (init, status, start)
   - Memory commands (capture, remember, find)
   - Task management
   - Agent management
   - Ollama integration
   - **Voice training** (rvc, sovits, kokoro) — NEW
   - **LoRA adapters** (list, train, activate) — UPDATED
   - **Fine-tuning** (cognitive mode training) — NEW
   - **Persona generator** (interactive interview) — UPDATED
   - Multi-user commands

### Memory & Data

9. **[Memory System](07-memory-system.md)**
   - Episodic, semantic, and procedural memory
   - JSON storage format
   - Memory enrichment
   - Function memory system
   - Semantic indexing

10. **[Autonomous Agents](08-autonomous-agents.md)**
    - Organizer (memory enrichment)
    - Reflector (internal reflections)
    - Boredom Maintenance (activity-based)
    - Curiosity Services (user-facing & internal)
    - Dreamer (surreal dreams)
    - Sleep Service
    - Ingestor (file processing)

11. **[Skills System](09-skills-system.md)**
    - Executable capabilities
    - Skill discovery
    - Tool catalog
    - Custom skill creation

---

## 🎤 Voice & Personality

Advanced features for personalizing your MetaHuman:

12. **[Voice System (Text-to-Speech)](23-voice-system.md)**
    - **Piper**: Fast synthetic voices (no training)
    - **GPT-SoVITS**: Instant voice cloning (5-10 second samples)
    - **RVC**: High-quality voice conversion (requires training)
    - **Kokoro**: StyleTTS2 with custom voicepacks
    - Training workflows and troubleshooting

13. **[Persona Management System](25-persona-generation.md)**
    - **PersonaGenerator**: Therapist-style interview system
    - **PersonaEditor**: Manual persona editing
    - **Psychoanalyzer**: Automatic evolution from memories
    - Persona lifecycle management

14. **[LoRA Adapter Training](11-special-features.md#lora-adapter-training)**
    - Dataset curation and approval
    - Training pipeline
    - Evaluation metrics
    - Dual-adapter system (historical + recent)
    - Activation and testing

15. **[Fine-Tuning & Monthly Updates](13-advanced-usage.md#full-fine-tuning-with-monthly-updates)**
    - Cognitive mode training (dual, emulation, agent)
    - Monthly incremental updates
    - Foundation training strategies
    - Quality metrics and cost analysis

---

## 🧠 Cognitive Architecture

Deep dive into the AI systems powering MetaHuman OS:

16. **[Cognitive Architecture](27-cognitive-architecture.md)**
    - Multi-layer intelligence system
    - Authentic personality emulation
    - Computational efficiency
    - Human-like reasoning

17. **[Node-Based Cognitive System](28-node-based-cognitive-system.md)**
    - Visual workflow design
    - Node editor interface
    - Graph executor engine
    - Modular ReAct components
    - Custom workflow creation

18. **[Graceful Failure & Guidance Learning](26-graceful-failure-and-guidance-learning.md)**
    - Error handling
    - Learning from corrections
    - Operator resilience

---

## 🔒 Security & Operations

Essential guides for safe, reliable operation:

19. **[Security & Trust Model](10-security-trust.md)**
    - Progressive trust levels
    - Audit trail
    - Policy enforcement
    - Reversibility guarantees

20. **[Authentication & Profiles](17-authentication-setup.md)**
    - User registration and login
    - Profile management
    - Guest access
    - Session handling

21. **[Multi-User Profiles & Guest Mode](19-multi-user-profiles.md)**
    - Isolated user profiles
    - Guest access setup
    - Permission model
    - Persona facets
    - "Mutant Super Intelligence" merged mode

22. **[Headless Runtime Mode](20-headless-runtime-mode.md)**
    - Remote access without conflicts
    - Pausing local agents
    - Dedicated web server
    - Mobile access

23. **[Cloudflare Tunnel Setup](17-cloudflare-tunnel-setup.md)**
    - Secure remote access
    - Domain configuration
    - Zero-trust networking

---

## 🛠️ Configuration & Advanced Usage

For power users and customization:

24. **[Configuration Files Reference](14-configuration-files.md)**
    - `etc/` directory structure
    - All config files documented
    - Template variables
    - Hot-reload behavior

25. **[Advanced Usage](13-advanced-usage.md)**
    - Advanced workflows
    - Customization options
    - Power user features
    - Performance tuning

26. **[Special Features](11-special-features.md)**
    - Audio processing (ASR/TTS)
    - Vector search
    - LoRA adapters
    - Self-healing coder
    - Addon system

27. **[Special States & Protocols](18-special-states.md)**
    - "Wetware Deceased" mode
    - Lifeline Protocol (emergency)
    - Kill Switch
    - Easter eggs

---

## 📖 Reference & Support

Additional resources and help:

28. **[Troubleshooting](12-troubleshooting.md)**
    - Common issues and solutions
    - Error messages
    - Debugging tips
    - Recovery procedures

29. **[Known Issues & Experimental Features](15-known-issues.md)**
    - Features in development
    - Limitations and caveats
    - Beta features
    - Workarounds

30. **[What's Next (Roadmap)](16-whats-next.md)**
    - Future features
    - Development priorities
    - Upcoming releases
    - Community contributions

31. **[Support](17-support.md)**
    - Getting help
    - Reporting issues
    - Contributing
    - Community resources

---

## 📜 Legal & Ethics

Important policies and commitments:

32. **[Terms of Service](21-terms-of-service.md)**
    - Privacy commitment
    - Data security responsibilities
    - Local-first infrastructure
    - Limitation of liability

33. **[Ethical Use Policy](22-ethical-use-policy.md)**
    - Prohibited uses
    - Ethical principles
    - Responsible AI guidelines
    - Authenticity and consent

---

## 🔍 Quick Reference

**For absolute beginners:**
1. Read [Overview](01-overview.md)
2. Follow [Quick Start](02-quick-start.md)
3. Complete [First Steps Tutorial](getting-started/03-first-steps-tutorial.md)
4. Practice [Common Workflows](getting-started/05-common-workflows.md)

**For developers:**
1. Review [Project Structure](03-project-structure.md)
2. Study [Core Concepts](04-core-concepts.md)
3. Explore [Node-Based System](28-node-based-cognitive-system.md)
4. Check [Configuration Files](14-configuration-files.md)

**For voice enthusiasts:**
1. Read [Voice System Guide](23-voice-system.md)
2. Try [Voice Training Workflow](getting-started/05-common-workflows.md#voice-training-end-to-end)
3. Configure [Voice Settings](14-configuration-files.md#etcvoicejson)

**For personality customization:**
1. Use [Persona Generator](25-persona-generation.md)
2. Follow [LoRA Training Workflow](getting-started/05-common-workflows.md#lora-adapter-training-pipeline)
3. Understand [Cognitive Modes](04-core-concepts.md#8-cognitive-modes)

**For troubleshooting:**
1. Check [Troubleshooting Guide](12-troubleshooting.md)
2. Review [Common Workflows - Troubleshooting](getting-started/05-common-workflows.md#troubleshooting-common-issues)
3. Visit [Support Resources](17-support.md)

---

## 📊 Documentation Status

**✅ Complete:** Core features, CLI reference, voice system, persona tools
**🔄 In Progress:** Reorganization into hierarchical structure
**📝 Coming Soon:** Developer API reference, plugin development guide, advanced node system tutorials

---

## 🤝 Contributing to Documentation

Found an error? Want to improve a guide?

1. Documentation source: `docs/user-guide/`
2. Open an issue or pull request on GitHub
3. Follow the [Contributing Guidelines](../../CONTRIBUTING.md)

---

**Welcome to MetaHuman OS! Your digital extension awaits.** 🚀
