---
layout: ../layouts/Base.astro
title: User Guide
---

# MetaHuman OS — User Guide

This guide explains what’s in the repo, how to use it day‑to‑day, and where to extend it.

## What This Is
- A local‑first digital persona (“MetaHuman”) that plans, remembers, and acts with consent.
- Stores memory primarily as JSON using schemas in `memory/schema.json` (transparent and machine‑readable).
- Provides three entry points:
  - CLI (`mh`) via `packages/cli` for daily operations.
  - Astro Dashboard (`apps/site`) for a local UI with dark mode.
  - Auditor (`bin/audit`) to track structural changes and risks.

## Daily Workflow
- Initialize once: `mh init`
- Status: `mh status` (identity summary, active tasks)
- Capture an event/observation: `mh capture "Met with Sarah about ML project"`
- Search memory: `mh remember "Sarah"`
- Tasks:
  - List: `mh task`
  - Add: `mh task add "Draft weekly brief"`
  - Start: `mh task start <task-id>`
  - Done: `mh task done <task-id>`
  - Task files are JSON under `memory/tasks/active/` and move to `completed/` when done.

## Understanding and Building Memory

The memory system is the core of the persona. It's designed like a human brain, with different lobes for different kinds of information, all stored transparently in the `memory/` directory.

### Types of Memory

*   **Episodic Memory (`memory/episodic/`):** This is the most important one for day-to-day use. It's a timeline of events, observations, thoughts, and conversations. Every time you `capture` something, it goes here. Think of it as the AI's journal or diary.
*   **Task Memory (`memory/tasks/`):** This is where the AI's to-do list lives. When you use the `mh task add` command, you are creating a task memory.
*   **Semantic Memory (`memory/semantic/`):** This is for storing structured facts and knowledge, like a personal encyclopedia. For example, "Project X's deadline is December 15th." (This is a more advanced feature).

All these memories are stored as simple, human-readable JSON files. This is intentional, so you can always see and even edit what the AI knows.

### How to Give the AI New Memories

The primary way you add a new memory is with the **`capture`** command. This is designed for recording observations, thoughts, or events as they happen.

**To add a new memory, use this command in the terminal:**

```bash
mh capture "I had a productive meeting with the design team today and we decided on the new color palette."
```

This creates a new JSON file in the `memory/episodic/` directory containing your text and a timestamp. This new memory is now part of the AI's "short-term memory."

This is the first step. Later, you can run the `mh agent run organizer` command. The organizer agent will find this new, unprocessed memory and use the AI model (`phi3:mini`) to analyze it, automatically adding tags and entities to make the memory "smarter" and easier to find later.

## CLI Commands (mh)
- `mh init` — Initialize directory structure and persona schema files
- `mh status` — Show system status and identity summary
- `mh capture "text"` — Capture an observation/event
- `mh remember <query>` — Search across memory
- `mh task [list]` — List active tasks
- `mh task add "title"` — Create a new task
- `mh task start <id>` — Mark a task as in progress
- `mh task done <id>` — Mark a task complete
- `mh trust [level]` — Show or set trust level (`observe|suggest|supervised_auto|bounded_auto`)
- `mh agent run <name>` — Run a background agent
- `mh help` — Command reference

Tip: Set `EDITOR` (e.g., `export EDITOR=code -w`) so `mh` opens files where you can edit and return.

## Autonomous Agents

MetaHuman OS uses autonomous agents to perform background processing and analysis, simulating a continuous thought process. These agents can organize memories, generate insights, and prepare reports without direct supervision.

### The Organizer Agent

The primary agent available now is the `organizer`. Its main job is to scan your memories (observations, notes, etc.) and use a local AI model (via Ollama) to automatically extract key tags and entities. This enriches your memory data, making it more searchable and interconnected.

There are two ways to run the organizer agent:

**1. From the Command Line (CLI):**

To trigger the agent manually from your terminal, use the `agent run` command:

```bash
mh agent run organizer
```

You will see the agent's progress logged directly in your terminal.

**2. From the Web Interface:**

For easier access, you can run the agent from the web UI.

1.  Open the web interface at http://localhost:4321
2.  Click the **Tasks** menu item in the left sidebar
3.  Click the **"Run Organizer Agent"** button at the top of the page
4.  A confirmation message will appear, and the agent will begin processing in the background
5.  Monitor progress in the **Agent Monitor** tab in the right sidebar (Developer Tools)


## Memory Formats (JSON)
- Tasks: `memory/tasks/active/task-YYYYMMDD-HHMMSS.json`
  {
    "id": "task-20251019-143000",
    "title": "Example task",
    "status": "todo",
    "priority": "P2",
    "tags": ["planning"],
    "created": "2025-10-19T14:30:00Z",
    "updated": "2025-10-19T14:30:00Z"
  }
- Events: `memory/episodic/YYYY/evt-YYYYMMDDHHMMSS*.json`
  {
    "id": "evt-20251019-143000",
    "timestamp": "2025-10-19T14:30:00Z",
    "content": "Met with Sarah about ML project",
    "type": "observation",
    "tags": ["meeting"]
  }
Schema reference: `memory/schema.json`.

## Web Interface (apps/site)
- Install and run: `cd apps/site && pnpm install && pnpm dev`. Open http://localhost:4321
- **New ChatGPT-style interface** with three main areas:
  - **Left Sidebar (Features)**: Navigation menu with Chat, Dashboard, Tasks, Memory, Persona, and Terminal
  - **Center Panel**: Primary chat interface or selected feature view
  - **Right Sidebar (Dev Tools)**: Live audit stream, agent monitor, and settings
- **Key Features**:
  - 💬 **Chat**: Conversation interface with your digital personality extension (conversation or inner dialogue mode)
  - 📊 **Dashboard**: System status, active tasks, core values, and current goals
  - ✓ **Tasks**: Create, manage, and track tasks with status filtering
  - 🧩 **Memory**: Browse episodic events and observations
  - 🎭 **Persona**: View and manage identity settings
  - ⌨️ **Terminal**: Embedded CLI interface for running commands
  - 📋 **Audit Stream**: Real-time log of all system operations
  - 🤖 **Agent Monitor**: View agent statistics and trigger agent runs
- **UI Features**:
  - Collapsible sidebars (preferences saved to browser localStorage)
  - Full dark mode support with theme toggle
  - Mobile responsive design
  - Real-time updates via Server-Sent Events
  - Keyboard shortcuts (Enter to send messages, Shift+Enter for newlines)

## TypeScript CLI (packages/cli)
- Install and run: `cd packages/cli && pnpm install && pnpm dev` (or `npx tsx src/mh.ts --help`)
- Commands mirror Bash CLI with extras planned (frontmatter parsing, indexing, weekly aggregation).

## Auditor (bin/audit)
- Purpose: Track structural changes, flag risks, and keep the project aligned.
- Commands:
  - `bin/audit snapshot` — Create/update baseline checksums
  - `bin/audit diff` — Show added/removed/modified since baseline
  - `bin/audit check` — Run policy checks (structure, size, network refs, secrets)
  - `bin/audit all` — Diff + check; writes a report to `logs/audit/`
- Notes: In restricted environments, writing may fail; generate reports manually if needed.

## Configuration (etc/config)
- `METAHUMAN_NAME` — Persona display name
- `MH_ID` — Unique identifier (slug)
- `MH_AUTONOMY_MODE` — `observe|suggest|approve|limited-auto`
- `MH_TIMEZONE` — Defaults to system `TZ` or UTC
- `NTFY_TOPIC` — Optional for `mh nudge`

## Safety & Consent
- Default: observe/suggest (no external actions without explicit approval).
- Skills must be allowlisted and support dry‑run where feasible.
- Logs live under `logs/`; progress summaries under `out/progress/`.

## Common Recipes
- Add a task and include in today’s plan:
  - `bin/mh memory add task "Draft proposal" && bin/mh plan`
- Search across memory and journals:
  - `bin/mh memory search "proposal"`
- Weekly close‑out:
  - `bin/mh weekly` then review and promote next week’s big rocks.
- Update persona tone/goals:
  - `bin/mh persona` and edit `persona/profile.md`.

## Troubleshooting
- Astro build errors with CSS in frontmatter: keep CSS imports in `<head>` via `Astro.resolve`.
- Sandbox write failures: run the CLI outside restricted sandboxes or write files manually.
- Task list empty: add at least one `.md` file under `memory/tasks/YYYY/` with `status: todo`.

## Next Extensions
- TS CLI: add frontmatter parser and task queries by status/due/priority.
- Astro: render Markdown/MDX for persona and task detail pages; add filters.
- Skills: define manifest + runner with approval logs.
