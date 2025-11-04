# Tasks & Calendar Architecture Blueprint

Last updated: 2025-11-02  
Status: Proposal

## Goals

- Move beyond ad-hoc skill additions toward a cohesive “work management” domain that covers task lists, scheduling, and reminders.
- Keep the operator and chat experiences in sync by introducing shared capability descriptions and a unified state API.
- Make it easy to extend the system (e.g., add sub-lists, recurring events, integrations) without rewriting prompts or brittle route logic.

## High-Level Concepts

### 1. Domain-Centric Capabilities

- Treat each functional area (tasks, calendar, notes, etc.) as a **domain**.
- Each domain exposes a small set of primitives (e.g., `list`, `create`, `update`, `search`, `schedule`).
- Skills become namespaced via `<domain>.<action>` (e.g., `tasks.list`, `tasks.create`, `calendar.create`).
- The planner/LLM queries a **capability catalog** instead of hard-coded prompts to learn about available actions at runtime.

### 2. Shared Capability Briefs

- Store concise “how to use this domain” docs in `persona/capabilities/*.md`.
- When the user intent hits a domain, the operator loads the relevant brief and injects it into planning context.
- Briefs include:
  - Data model fields & required inputs.
  - Example prompts → skill sequences.
  - Trust-level or safety considerations.
- Benefits: versionable instructions, easier updates, reusable across chat + operator.

### 3. Unified State API

- Introduce a typed service layer (e.g., `packages/core/src/state/tasks.ts`, `state/calendar.ts`).
- All interfaces (UI, CLI, skills) go through these methods (`createTask`, `listTasks`, `createEvent`, etc.).
- Internally, keep existing JSON storage for now; the abstraction lets us move to SQLite or remote services later.

### 4. Event Bus Sync with LLM

- Whenever state changes (task created, event updated), emit a structured event (`state_changed`) that includes domain + delta.
- Chat personas subscribe: new events become episodic memory entries or short summaries injected into context.
- Ensures verbal responses stay consistent with actual data without manual prompt tweaks.

## Task Domain Extensions

### Data Model Changes

- Add optional fields to Task:
  - `listId` (string): references a task list.
  - `category` or `labels`: assist with filtering.
  - `due`, `start`, `end`: ISO timestamps.
  - `reminders`: array of reminder configs.
- Introduce `TaskList` entity:
  - `id`, `name`, `description`, `created`, `updated`.
  - Optional `color`, `owner`, `defaultStatus`.

### API Endpoints & State Layer

- `listTaskLists()`, `createTaskList()`, `assignTaskToList(taskId, listId)`.
- Extend `/api/tasks`:
  - Filters: `list=`, `status=`, `range=` (for due dates).
  - Optionally include list metadata in responses.
- Provide `/api/task-lists` for CRUD operations.

### Skill Modules

- `tasks.list` → lists tasks with filters (status, listId, time range).
- `tasks.create` → create task with optional list, schedule, tags.
- `tasks.update` → change title, description, priority, status.
- `tasks.schedule` → set `start/end` and reminders.
- `tasks.listLists` → fetch task lists; planner uses before creating new lists.
- `tasks.createList` → create new task lists.

### Planner Workflow

1. Intent detection (existing router): classify request into `tasks`.
2. Planner calls `catalog.describe('tasks')` skill to retrieve available actions.
3. Loads `persona/capabilities/tasks.md` for extra context.
4. Plans steps: e.g., `tasks.list` with filters → `tasks.update`.
5. Execution uses placeholder resolution (already added) to pass IDs from one step to the next.

## Calendar Domain

### Data Model

- `Event` structure:
  - `id`, `title`, `description`.
  - `start`, `end`, `allDay`.
  - `location`, `attendees`.
  - `linkedTasks`: references Task IDs.
  - `reminders`: e.g., `{ type: 'email', offset: '-PT30M' }`.
- Keep events under `memory/calendar/` initially via JSON; plan to migrate to structured storage later.

### State Layer & API

- `createEvent(eventInput)`, `listEvents({ range, tags, taskId })`, `updateEvent`, `deleteEvent`.
- REST endpoints:
  - `GET /api/calendar?range=2025-11-02..2025-11-09`
  - `POST /api/calendar`
  - `PATCH /api/calendar/:id`
- Provide ICS export or calendar UI feed once base operations work.

### Skills

- `calendar.listRange` → list events for a date range.
- `calendar.create` → add event; optionally link to task.
- `calendar.update` → reschedule or edit.
- `calendar.delete` → remove.
- `calendar.find` → locate event by title/ID.

### Planner Usage

1. Router spots “schedule”, “calendar”, etc. → domain `calendar`.
2. Planner fetches `catalog.describe('calendar')` and loads `persona/capabilities/calendar.md`.
3. Example workflow: `calendar.find` → `calendar.update` to reschedule.
4. Post-execution, state event is emitted so chat memory logs the change.

## Capability Catalog Skill

Implement a meta-skill `catalog.describe`:

- Inputs: `domain` string.
- Outputs: array of available skills with input schemas and descriptions.
- Implementation: read manifests (e.g., from `brain/skills/tasks`) and return sanitized metadata.
- Operator planner always calls this first; ensures plan stays in sync with registered skills.

## UI Roadmap

1. **Tasks**
   - Add sidebar for Task Lists.
   - Filter by list/category, show counts.
   - Timeline view using due/start dates.
   - Drag tasks between lists (future).
2. **Calendar**
   - Minimal calendar view (agenda/list).
   - Option to create events from tasks.
   - Visual indicator in tasks when linked to calendar events.

UI and API should consume the unified state layer to avoid duplication.

## Integration with Chat & Operator

- Update `apps/site/src/pages/api/persona_chat.ts`:
  - After routing, determine domains involved (tasks/calendar).
  - Load relevant capability briefs into context (`## Capabilities` block).
  - Provide summary of recent state events (from event bus) under `## Recent Updates`.
- Operator:
  - Add domain heuristics so `shouldUseOperator` recognizes calendar and task-intent keywords.
  - Planner automatically includes `catalog.describe` and capability briefs before planning domain actions.

## Trust & Safety

- Maintain trust levels per domain:
  - Low-risk tasks operations allowed at `supervised_auto`.
  - Calendar manipulations (especially deletions) may require confirmation.
- Capability briefs should include constraints (“Never delete events older than X without confirmation”).
- Logging:
  - Extend audit trail to include domain & action.
  - State service writes to `logs/audit/` automatically.

## Implementation Phases

1. **Infrastructure Prep**
   - Create capability briefs for tasks & calendar.
   - Build capability catalog skill.
   - Introduce state services for tasks (refactor existing code) and calendar stub.
2. **Task Lists & Scheduling**
   - Extend data model, state API, skills, UI.
   - Test end-to-end (UI, CLI, operator) with scenario scripts.
3. **Calendar MVP**
   - Define event storage.
   - Implement CRUD skills and UI agenda view.
   - Hook into operator + chat.
4. **Event Bus & Memory Sync**
   - Emit `state_changed` events.
   - Subscribe in chat/agents to keep responses up to date.
5. **Polish & Recurring/Reminders**
   - Add recurring events, cross-links between tasks/events.
   - Expand capability briefs accordingly.

## Testing & Validation

- Update `out/validate-skills.ts`:
  - Add scenarios like “create list → add tasks → schedule event → mark done”.
- Provide fixtures for capability briefs.
- Consider a lightweight integration test harness that simulates operator plans using recorded transcripts.

## Open Questions

- Storage migration: stick with JSON for now or introduce SQLite for faster querying?
- External integrations: future adapters for Google Calendar or Todoist should plug into the same state layer.
- Permissioning: how to handle multi-user or shared lists when persona expands?

---

This blueprint should give the follow-on agent enough structure to begin implementing the domain approach while keeping MetaHuman OS flexible for future features. Update this doc as decisions are made or architecture evolves.
