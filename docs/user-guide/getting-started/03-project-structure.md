## Project Structure

```
metahuman/
├── apps/
│   └── site/                 # Astro + Svelte Web UI (dev/build/preview)
├── bin/                      # Helper scripts (`mh`, `audit`, piper wrappers, run-with-agents)
├── brain/                    # Long-running/background agents and supporting skills
│   ├── agents/               # Agent implementations and bootstrap
│   └── skills/               # Executable skills for the AI operator
├── docs/                     # User & developer documentation
├── etc/                      # System-wide configuration files (deprecated by per-user configs)
├── logs/
│   ├── audit/                # Daily NDJSON audit logs
│   └── run/                  # Session registry, lock files, agent PIDs
├── memory/                   # Legacy single-user memory files (migrated to profiles/)
├── out/
│   ├── voices/               # Shared Piper voice models (system-wide)
│   └── …                     # Other generated artifacts (reports, datasets, adapters)
├── packages/
│   ├── core/                 # TypeScript core (ESM). Identity, memory, audit, paths, LLM utils
│   └── cli/                  # CLI entry (`mh`) implemented with tsx
├── profiles/
│   └── <username>/           # Isolated user profile (memories, persona, logs, config)
│       ├── etc/              # User-specific configuration (voice.json, models.json, etc.)
│       ├── memory/           # Episodic/tasks/inbox/… for that user
│       ├── persona/          # Persona core, facets, routines
│       ├── out/              # Per-user generated artifacts (voice training, adapters)
│       └── logs/             # User-scoped audit/decision/action logs
├── scripts/                  # Utilities and migrations (`migrate-to-profiles.ts`, etc.)
├── docker/                   # Containerisation assets (optional)
└── persona/users.json        # Authentication database (owner/guest records)
```

### Core Directories & Ownership
- `profiles/<username>/` – **User-owned content.** Each authenticated user (owners and guests) receives an isolated profile containing their memories (`memory/`), persona configuration (`persona/`), logs, and configuration files (`etc/`). Voice training data lives under `profiles/<username>/out/voice-training`.
- `out/voices/` – **Shared system assets.** Large text-to-speech (Piper) models are stored once and referenced by every profile.
- `logs/audit/` – Append-only audit logs covering all operations; now user-scoped with per-user context tracking.
- `brain/agents/` – Autonomous background processes that iterate across all registered users by establishing per-user context via the `_bootstrap.ts` wrapper.
- `packages/core/` – Core runtime services (context manager, security policy, memory APIs, voice utilities, etc.).
- `apps/site/` – Front-end application (login/guest selector, dashboard, chat, memory browser, voice tooling).
- `bin/run-with-agents` – Special script that starts the web UI with essential background agents (scheduler-service, audio-organizer).
- `persona/users.json` – The authentication database (hashed credentials, roles, profile metadata). Back this up alongside the `profiles/` directory.

> **Migration note:** Earlier single-user installations stored persona and memory data at the repository root. The `migrate-to-profiles.ts` script moves those directories into `profiles/<owner>/` and creates symbolic links only on demand. New deployments should treat `profiles/` as the canonical data store. The `memory/` directory now serves as legacy storage only.

---
