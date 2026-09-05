# Tasks and Projects

MetaHuman OS keeps tasks and projects in the active profile. The web interface provides project and dependency views; the CLI intentionally exposes only the narrow task operations it implements.

## Open Projects

Select **Projects** in the left sidebar. The page shows three tabs:

- **Projects** — active project cards, search, progress, priority, and project details.
- **Actionable** — incomplete tasks whose dependencies do not block them.
- **Blocked** — tasks with unresolved dependencies.

The summary row shows active projects, actionable tasks, and blocked tasks.

## Create a Project

1. Select **Projects**.
2. Choose **New Project**.
3. Enter a title and optional description.
4. Choose priority **P0**, **P1**, **P2**, or **P3**.
5. Optionally select a target date.
6. Choose **Create Project**.

Open a project card to inspect its current status, progress, and member tasks. The current project dialog is a status/detail view; it does not expose every underlying task field for editing.

## CLI Task Operations

Run from the repository root:

```bash
# List active tasks
./bin/mh task

# Create a basic task
./bin/mh task add "Review the release notes"

# Start or complete a task
./bin/mh task start TASK_ID
./bin/mh task done TASK_ID
```

The implemented CLI subcommands are `add`, `start`, and `done`; omitting the subcommand lists active tasks. Although the current error help mentions `list`, that spelling is not handled by the executable. The CLI does not currently implement project creation, dependency editing, reminders, drag-and-drop boards, comments, or arbitrary status updates.

Use explicit user context in a multi-user installation:

```bash
./bin/mh --user USERNAME task
./bin/mh --user USERNAME task add "Review the release notes"
```

## Status and Priority

Tasks can appear as `todo`, `in_progress`, `blocked`, `done`, or `cancelled` in the underlying task system. The current CLI directly moves tasks only to `in_progress` and `done`.

Project priorities are:

- **P0** — critical
- **P1** — high
- **P2** — normal default
- **P3** — low

Blocked and actionable views are derived from current status and dependencies. If a task remains blocked after a prerequisite changes, reload the Projects page and verify the saved task records before assuming the UI is stale.

## Dashboard and Memory

Dashboard Overview reports active, in-progress, and blocked task counts. **Dashboard → Tasks** opens the task-management view. **Persona → Memory → Tasks** provides the memory-facing record view.

Task data is profile-resolved runtime data. Do not edit assumed `memory/tasks` paths or commit task files to source control.

## Related Guides

- [Dashboard and Monitoring](/user-guide#dashboard-monitoring)
- [Memory](/user-guide#memory-system)
- [Agency System and Active Operator](/user-guide#agency-system)
