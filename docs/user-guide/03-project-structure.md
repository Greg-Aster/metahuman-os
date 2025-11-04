## Project Structure

```
metahuman/
├── packages/
│   ├── core/            # TypeScript core (ESM). Identity, memory, audit, paths, LLM utils
│   └── cli/             # CLI entry (mh) via tsx. Commands and routing
├── brain/
│   └── agents/          # Long‑running/background agents (e.g., organizer.ts)
├── apps/
│   └── site/            # Astro + Svelte Web UI (dev/build/preview)
├── persona/             # Identity data (user‑owned content)
├── memory/              # Runtime memory stores (episodic/semantic/tasks, etc.)
├── logs/                # Audit and run logs (NDJSON)
├── out/                 # Generated artifacts and reports
├── bin/                 # Helper scripts (mh, audit, whisper, piper)
├── etc/                 # Configuration files
├── docker/              # Docker-related files
├── scripts/             # Miscellaneous scripts
└── docs/                # Documentation
```

### Core Directories
- `persona/` - Your identity and personality data
- `memory/episodic/` - Timeline of events and memories
- `memory/tasks/` - Task management files
- `logs/audit/` - Complete audit trail
- `brain/agents/` - Autonomous background processes
- `brain/skills/` - Executable capabilities for the operator model

---

