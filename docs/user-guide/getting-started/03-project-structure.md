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

### Storage Router Architecture

MetaHuman OS uses a **centralized storage router** to manage all file paths throughout the system. This architecture ensures maintainability, allows path rerouting through a single location, and provides clear separation between system-level and user-specific data.

#### Path Categories

The storage router organizes paths into categories:

| Category | Description | Example Paths |
|----------|-------------|---------------|
| `memory` | User memories (episodic, semantic, tasks, inbox) | `profiles/<user>/memory/episodic/` |
| `voice` | Voice training data, samples, transcripts | `profiles/<user>/out/voice-training/` |
| `config` | User configuration files | `profiles/<user>/etc/` |
| `output` | Generated artifacts (adapters, reports) | `profiles/<user>/out/` |
| `training` | LoRA training datasets | `profiles/<user>/out/adapters/` |
| `cache` | Temporary cached data | `profiles/<user>/state/cache/` |

#### System vs User Paths

**System Paths** (`systemPaths.*`):
- Used for system-wide infrastructure that doesn't belong to any user
- Examples: `systemPaths.logs`, `systemPaths.brain`, `systemPaths.agents`
- Location: Repository root (`/home/greggles/metahuman/logs/`, etc.)

**User Paths** (via `storageClient.resolvePath()`):
- Used for user-specific data that requires profile isolation
- Automatically resolves to the correct profile directory
- Examples: episodic memories, voice training, persona files

#### Code Migration Pattern

The legacy `paths` proxy has been deprecated. Code should now use:

```typescript
// For system paths (logs, agents, etc.)
import { ROOT, systemPaths } from '@metahuman/core';
const agentPath = path.join(systemPaths.brain, 'agents', 'foo.ts');
const logsDir = systemPaths.logs;
const cwd = ROOT;

// For user-specific paths (memory, voice, config)
import { storageClient } from '@metahuman/core';
const result = storageClient.resolvePath({
  category: 'memory',
  subcategory: 'episodic'
});
if (result.success) {
  const episodicDir = result.path;  // profiles/<user>/memory/episodic/
}
```

#### Key Benefits

1. **Single Source of Truth**: All path logic centralized in `brain/services/storage-router.ts`
2. **Easy Rerouting**: Change storage locations by modifying the router, not every file
3. **Multi-User Support**: Automatic profile isolation without code changes
4. **Type Safety**: Strongly-typed category and subcategory enums
5. **Error Handling**: Explicit success/failure responses with descriptive errors

---
