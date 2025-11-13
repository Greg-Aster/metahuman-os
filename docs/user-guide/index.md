# MetaHuman OS User Guide

Welcome to the MetaHuman OS User Guide. This guide is organized into the following chapters, providing a comprehensive overview of the system's functionality, architecture, and usage.

1.  **[Overview](01-overview.md)**
    *   **Introduction and Core Principles**: Understand the vision behind MetaHuman OS as an autonomous digital personality extension, mirroring your identity, memories, goals, and personality. Learn about its role as a parallel intelligence augmenting your cognitive abilities 24/7.

2.  **[Quick Start](02-quick-start.md)**
    *   **Installation and Initial Setup**: Get up and running with MetaHuman OS. This section covers the necessary steps for installation, initial configuration, and how to start both the web UI and the command-line interface.

3.  **[Project Structure](03-project-structure.md)**
    *   **Understanding the Directory Layout**: Explore the `pnpm` monorepo structure, including the `apps/`, `packages/`, `brain/`, `memory/`, and `persona/` directories. Learn where different components of the MetaHuman OS reside.

4.  **[Core Concepts](04-core-concepts.md)**
    *   **Identity, Memory, Agents, and Decision Engine**: Dive into the fundamental building blocks of MetaHuman OS. This chapter explains the Identity Kernel, Memory Manager, Process Scheduler, Decision Engine, and Sync Engine, and how they interact to form the core logic of your digital personality.
    *   **[Cognitive Modes](04-core-concepts.md#8-cognitive-modes-upcoming-feature)**: Learn about the upcoming cognitive modes that will allow you to switch between different operational paradigms.

5.  **[User Interface](05-user-interface.md)**
    *   **Web UI and Interaction Methods**: Discover the web dashboard built with Astro and Tailwind CSS. Learn how to visualize the state of your digital personality extension and interact with the system through a modern web interface.

6.  **[CLI Reference](06-cli-reference.md)**
    *   **Command-Line Interface Guide**: A comprehensive guide to interacting with MetaHuman OS via the command line. This section details key commands such as `mh init`, `mh status`, `mh capture "<observation>"`, `mh task add "<task>"`, and `mh remember "<query>"`.

7.  **[Memory System](07-memory-system.md)**
    *   **Working with Episodic, Semantic, and Procedural Memory**: Understand how MetaHuman OS stores and retrieves information. This chapter explains the different types of memory and the mechanisms used for data storage, including JSON files, Markdown files, and SQLite.

8.  **[Autonomous Agents](08-autonomous-agents.md)**
    *   **Background Processes and Automation**: Learn about the autonomous agents that operate continuously to augment your cognitive abilities. This section covers how these agents function in the background to manage tasks, process information, and drive the system's proactive behavior.

9.  **[Audit Stream Enhancements](05-user-interface.md#developer-sidebar-audit-stream-enhanced)**
    *   **Grouped Live Auditing**: Understand the new grouped + expandable audit stream UI for reviewing system activity at a glance.

10.  **[Skills System](09-skills-system.md)**
    *   **Executable Capabilities**: Explore the skills system, which defines the executable capabilities of MetaHuman OS. Understand how the system plans and executes these skills to ingest, organize, and act within defined trust boundaries.

10. **[Security & Trust Model](10-security-trust.md)**
    *   **Progressive Trust and Safety**: Delve into the security measures and trust model implemented in MetaHuman OS. Learn about auditability, reversibility, trust levels, and policies that ensure safe and controlled operations.

11. **[Special Features](11-special-features.md)**
    *   **Audio Processing, LoRA Adapters, Vector Search**: Discover advanced functionalities such as local transcription (ASR) and text-to-speech (TTS) services, the use of LoRA adapters for model customization, and vector search for efficient memory retrieval.

12. **[Troubleshooting](12-troubleshooting.md)**
    *   **Common Issues and Solutions**: Find solutions to common problems and issues you might encounter while using MetaHuman OS.

13. **[Advanced Usage](13-advanced-usage.md)**
    *   **Advanced Workflows and Customization**: For experienced users, this section provides insights into advanced workflows, customization options, and how to leverage the full potential of MetaHuman OS.

14. **[Configuration Files](14-configuration-files.md)**
    *   **Reference for All Config Files**: A detailed reference for all configuration files located in the `etc/` directory, explaining their purpose and how to modify them.

15. **[Known Issues & Experimental Features](15-known-issues.md)**
    *   **Important Notes on Features in Development**: Stay informed about known issues and features that are currently under development or are considered experimental.

16. **[What's Next](16-whats-next.md)**
    *   **Roadmap and Future Features**: Get a glimpse into the future of MetaHuman OS by reviewing the project roadmap and upcoming features.

17. **[Support](17-support.md)**
    *   **Getting Help**: Information on how to get support, report issues, and contribute to the MetaHuman OS project.

18. **[Special States & Protocols](18-special-states.md)**
    *   **Easter Eggs & Emergency Features**: Learn about special modes like "Wetware Deceased", "Lifeline Protocol", and the "Kill Switch".

19. **[Multi-User Profiles & Guest Mode](19-multi-user-profiles.md)**
    *   **Independent User Configurations**: Understand how MetaHuman OS supports multiple users with isolated profiles, guest access to public personas, persona facets, and the special "Mutant Super Intelligence" merged consciousness feature.

20. **[Headless Runtime Mode](20-headless-runtime-mode.md)**
    *   **Remote Access Without Conflicts**: Learn how to enable headless mode to pause local agents while keeping the web server and tunnel running. Perfect for dedicated remote access from mobile devices or multiple locations without resource conflicts.

21. **[Terms of Service](21-terms-of-service.md)**
    *   **Privacy Commitment & Liability**: Understand the privacy-first approach of MetaHuman OS, including data security responsibilities, local-first infrastructure, and limitation of liability. Learn about your responsibilities when using the system.

22. **[Ethical Use Policy](22-ethical-use-policy.md)**
    *   **Responsible AI Usage Guidelines**: Learn about prohibited uses (impersonation without consent, malicious AI systems), ethical principles (authenticity, consent, autonomy), and your commitment to responsible use of MetaHuman OS. Remember: Don't make Skynet!

23. **[Voice System (Text-to-Speech)](23-voice-system.md)**
    *   **Local Voice Cloning & TTS**: Comprehensive guide to MetaHuman's three TTS providers: Piper (fast synthetic voices), GPT-SoVITS (instant voice cloning with 5-10 second samples), and RVC (highest quality trained voice conversion). Includes training workflows, configurable parameters, troubleshooting, and best practices for voice quality.
