# Task Management

MetaHuman OS includes a structured task management system for organizing your work, projects, and goals. Tasks are stored as JSON files and can be managed via CLI or web UI.

## Overview

The task system provides:
- **Hierarchical organization**: Projects and subtasks
- **Status tracking**: todo, in_progress, blocked, done, cancelled
- **Priorities**: P1 (urgent), P2 (normal), P3 (low)
- **Due dates and scheduling**: ISO timestamps
- **Dependencies**: Link related tasks
- **Tags and categories**: Flexible organization
- **Web UI integration**: Visual task board

## Task Structure

Tasks are stored in `memory/tasks/` as JSON files:

```json
{
  "id": "task-20251019143000",
  "title": "Draft proposal",
  "status": "todo",
  "priority": "P2",
  "tags": ["writing", "work"],
  "listId": "list-work-projects",
  "due": "2025-11-10T18:00:00.000Z",
  "created": "2025-10-19T14:30:00.000Z",
  "updated": "2025-10-19T14:30:00.000Z",
  "description": "Draft Q4 project proposal for review",
  "dependencies": [],
  "reminders": []
}
```

**Key Fields:**
- **id**: Unique identifier
- **title**: Short description of the task
- **status**: Current state (todo, in_progress, blocked, done, cancelled)
- **priority**: P1 (urgent), P2 (normal), P3 (low)
- **tags**: Keywords for filtering
- **listId**: Project or category this task belongs to
- **due**: Deadline (ISO 8601 timestamp)
- **description**: Detailed notes
- **dependencies**: IDs of tasks that must complete first
- **reminders**: Notification configurations

## Creating Tasks

### Via CLI

```bash
# Simple task
./bin/mh task add "Review pull request #123"

# Task with priority and tags (via web UI recommended)
# CLI supports basic creation only
```

### Via Web UI

1. Navigate to **Tasks** in the left sidebar
2. Click **"New Task"** button
3. Fill in task details:
   - Title (required)
   - Description
   - Priority (P1/P2/P3)
   - Due date
   - Tags
   - Project/list
4. Click **"Create"**

**Web UI advantages**:
- Rich text descriptions
- Date picker for due dates
- Tag auto-completion
- Project selection dropdown
- Dependency linking

## Managing Tasks

### List Tasks

```bash
# List all active tasks
./bin/mh task

# List tasks for specific user (multi-user setups)
./bin/mh -u alice task list
```

### Update Task Status

```bash
# Start working on a task
./bin/mh task start <task-id>

# Mark task as done
./bin/mh task done <task-id>

# Mark as blocked (via web UI)
# Mark as cancelled (via web UI)
```

### Task Lifecycle

1. **todo** → Initial state, awaiting action
2. **in_progress** → Actively working on it
3. **blocked** → Waiting on dependency or external factor
4. **done** → Completed successfully
5. **cancelled** → No longer relevant

## Web UI Features

The Tasks page provides:

### Task Board View
- **Column layout**: Grouped by status (todo, in_progress, blocked, done)
- **Drag-and-drop**: Move tasks between columns
- **Priority badges**: Color-coded P1/P2/P3 indicators
- **Due date warnings**: Highlight overdue and approaching deadlines
- **Quick filters**: Show/hide by priority, project, tags

### Task Details Panel
- **Full task information**: All fields editable
- **Subtask creation**: Break down complex tasks
- **Dependency visualization**: See task relationships
- **Activity log**: Track status changes and updates
- **Comments**: Collaborate and add notes

### Project Organization
- **Create projects**: Group related tasks
- **Project progress**: Visual completion percentage
- **Milestones**: Track key deliverables
- **Archive completed**: Move finished projects out of active view

## Task Priorities

### P1 - Urgent
- Time-sensitive, critical tasks
- Highlighted in red
- Auto-sorted to top of lists
- Recommended for: deadlines, emergencies, blockers

### P2 - Normal (Default)
- Standard priority tasks
- Most daily work falls here
- Neutral styling
- Recommended for: regular work items, maintenance

### P3 - Low
- Nice-to-have tasks
- Can be deferred if needed
- Subtle styling
- Recommended for: ideas, future improvements, low-impact items

## Task Dependencies

Link tasks to create workflows:

```json
{
  "id": "task-002",
  "title": "Deploy to production",
  "dependencies": ["task-001"],
  "status": "blocked"
}
```

**Behavior**:
- Dependent tasks show as "blocked" until prerequisites complete
- Web UI visualizes dependency chains
- Completing a task auto-checks dependents

## Storage Structure

Tasks are organized in directories:

```
memory/tasks/
├── active/              # Current tasks
│   ├── task-001.json
│   ├── task-002.json
│   └── task-003.json
├── completed/           # Finished tasks
│   └── task-000.json
└── projects/            # Project definitions
    ├── project-work.json
    └── project-personal.json
```

## Integration with Memory System

Tasks are a special type of memory:
- **Type**: `memory.type === "task"`
- **Searchable**: Appear in memory search results
- **Referenced**: Can be linked from conversations and observations
- **Training data**: Task completion patterns can inform AI behavior

## Task Reminders

Configure notifications for tasks:

```json
{
  "reminders": [
    {
      "type": "due_date",
      "offset": "-1d",
      "message": "Task due tomorrow"
    },
    {
      "type": "recurring",
      "frequency": "weekly",
      "day": "monday"
    }
  ]
}
```

**Reminder Types**:
- **due_date**: Alert before deadline (e.g., "-1d" = 1 day before)
- **recurring**: Periodic notifications
- **custom**: Specific datetime

## Task Archiving

Keep your workspace clean:

```bash
# Archive completed tasks (via web UI recommended)
# Moves tasks from active/ to completed/

# Review and prune old tasks
./bin/mh task  # List active
./bin/mh task done <id>  # Complete as needed
```

**Web UI archiving**:
1. Go to **Tasks** page
2. Select completed tasks
3. Click **"Archive"** button
4. Tasks move to `completed/` directory

## Multi-User Task Management

In multi-user setups, each user has isolated tasks:

```bash
# View alice's tasks
./bin/mh -u alice task list

# Create task for specific user
./bin/mh -u alice task add "Review docs"
```

**Storage**:
```
profiles/
├── alice/
│   └── memory/tasks/
│       └── active/
│           └── task-001.json
└── bob/
    └── memory/tasks/
        └── active/
            └── task-002.json
```

## Best Practices

### Effective Task Management

1. **Use descriptive titles**: "Review PR #123" > "Review stuff"
2. **Set realistic due dates**: Don't over-commit
3. **Break down large tasks**: Create subtasks for complex work
4. **Use tags consistently**: Establish a tagging convention
5. **Review regularly**: Archive completed, update blocked
6. **Link dependencies**: Make workflows explicit

### Task Organization

- **Personal tasks**: Tag with `personal`, set low priority
- **Work tasks**: Organize by project, set due dates
- **Ideas**: Use P3 priority, tag with `idea` or `future`
- **Recurring tasks**: Create templates, clone as needed

## Next Steps

- Integrate tasks with [Memory System](memory-system.md) for context
- Use [Chat Interface](chat-interface.md) to discuss task progress
- Set up [Dashboard](dashboard-monitoring.md) to monitor active tasks
- Explore [Autonomous Agents](../advanced-features/autonomous-agents.md) for automated task suggestions
