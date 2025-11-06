## Project Structure

```
metahuman/
├── apps/
│   └── site/                 # Astro + Svelte Web UI (dev/build/preview)
├── bin/                      # Helper scripts (`mh`, `audit`, whisper/piper wrappers)
├── brain/                    # Long-running/background agents and supporting skills
│   ├── agents/
│   └── skills/
├── docs/                     # User & developer documentation
├── logs/
│   ├── audit/                # Daily NDJSON audit logs
│   └── run/                  # Session registry, lock files, agent PIDs
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
- `logs/audit/` – Append-only audit logs covering all operations; still system-wide, but every record notes the acting user.
- `brain/agents/` – Autonomous background processes that iterate across all registered users by establishing per-user context.
- `packages/core/` – Core runtime services (context manager, security policy, memory APIs, voice utilities, etc.).
- `apps/site/` – Front-end application (login/guest selector, dashboard, chat, memory browser, voice tooling).
- `persona/users.json` – The authentication database (hashed credentials, roles, profile metadata). Back this up alongside the `profiles/` directory.

> **Migration note:** Earlier single-user installations stored persona and memory data at the repository root. The `migrate-to-profiles.ts` script moves those directories into `profiles/<owner>/` and creates symbolic links only on demand. New deployments should treat `profiles/` as the canonical data store.

---
