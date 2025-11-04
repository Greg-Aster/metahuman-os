## Skills System

Skills are the executable capabilities of the MetaHuman OS operator model. They provide controlled, audited interfaces for the AI to interact with the file system, run agents, execute commands, and search memory.

### Design Principles
1. **Sandboxed Execution**: All skills run in a controlled environment with strict permission boundaries
2. **Trust-Aware**: Skill availability and auto-execution depends on the current trust level
3. **Fully Audited**: Every skill invocation is logged with inputs, outputs, and results
4. **Risk-Based Approval**: High-risk operations require explicit user approval before execution
5. **Declarative Manifest**: Each skill declares its inputs, outputs, cost, and risk level

### Skill Manifest Format
Each skill is defined with a manifest that includes:
```typescript
interface SkillManifest {
  id: string;                    // Unique skill identifier (e.g., "fs_read")
  name: string;                  // Human-readable name
  description: string;           // What the skill does
  category: 'fs' | 'memory' | 'agent' | 'shell' | 'network';

  inputs: {
    [paramName: string]: {
      type: 'string' | 'number' | 'boolean' | 'object' | 'array';
      required: boolean;
      description: string;
      validation?: (value: any) => boolean;
    };
  };

  outputs: {
    [fieldName: string]: {
      type: 'string' | 'number' | 'boolean' | 'object' | 'array';
      description: string;
    };
  };

  risk: 'low' | 'medium' | 'high';
  cost: 'free' | 'cheap' | 'expensive';  // Computational/time cost

  minTrustLevel: 'observe' | 'suggest' | 'supervised_auto' | 'bounded_auto';
  requiresApproval: boolean;             // If true, always requires approval regardless of trust

  allowedDirectories?: string[];         // For fs skills
  commandWhitelist?: string[];           // For shell skills
}
```

### Skill Execution Flow
```
┌─────────────────────────────────────────────────────────────┐
│ 1. Operator requests skill execution                        │
│    executeSkill('fs_write', { path: '...', content: '...' })│
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Policy Engine checks:                                    │
│    - Is skill available at current trust level?             │
│    - Does input validation pass?                            │
│    - Is approval required?                                  │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
                    ┌────┴────┐
                    │Approval?│
                    └────┬────┘
                         │
              ┌──────────┼──────────┐
              │          │          │
              ▼          ▼          ▼
           Required   Not Req.   Denied
              │          │          │
              ▼          │          ▼
     ┌──────────────┐   │    ┌──────────┐
     │Queue approval│   │    │Return err│
     │Wait for user │   │    └──────────┘
     └──────┬───────┘   │
            │           │
            ▼           │
     User approves?     │
            │           │
       ┌────┼────┐      │
       │    │    │      │
       Yes  No   │      │
       │    │    │      │
       ▼    ▼    │      │
            │◄───┴──────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Execute skill in sandbox                                 │
│    - Validate paths/permissions                             │
│    - Run skill implementation                               │
│    - Catch errors                                           │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Audit execution                                          │
│    - Log inputs, outputs, success/failure                   │
│    - Record to audit trail                                  │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. Return result to operator                                │
│    { success: true, ...outputs } or { success: false, error }│
└─────────────────────────────────────────────────────────────┘
```

### Available Skills

Skills are now organized into domains and are namespaced (e.g., `tasks.list`).

#### Meta-Skills

- **catalog.describe** - Retrieves the available actions for a given domain.

#### Task Domain (`tasks`)

- **tasks.list** - Lists tasks with filters (status, listId, time range).
- **tasks.create** - Creates a task with an optional list, schedule, and tags.
- **tasks.update** - Changes the title, description, priority, or status of a task.
- **tasks.schedule** - Sets the start/end dates and reminders for a task.
- **tasks.listLists** - Fetches all task lists.
- **tasks.createList** - Creates a new task list.

#### Calendar Domain (`calendar`)

- **calendar.listRange** - Lists events for a given date range.
- **calendar.create** - Adds an event to the calendar, with an option to link to a task.
- **calendar.update** - Reschedules or edits an existing event.
- **calendar.delete** - Removes an event from the calendar.
- **calendar.find** - Locates an event by its title or ID.

#### Other Skills

**File System:**
- **fs_list** - List/search for files.
- **fs_read** - Read file contents.
- **summarize_file** - Summarize documents.
- **fs_write** - Create/write files (allowed: memory/, out/, logs/).
- **fs_delete** - Delete files (has dry-run) (allowed: memory/, out/, logs/).
- **json_update** - Update JSON files (allowed: memory/, out/, logs/, etc/).

**Git:**
- **git_status** - Check repository status.
- **git_commit** - Commit changes.

**Search:**
- **search_index** - Semantic memory search.

**Network:**
- **http_get** - Fetch web content.
- **web_search** - Search the web.

**System:**
- **run_agent** - Execute agents.
- **shell_safe** - Run whitelisted shell commands.

### The Operator - Autonomous Task Execution System
Simply ask in natural language using "operator mode" or by being specific about actions:

**Examples:**
```
"Search for TypeScript files in the brain directory"
"Read the README.md file and summarize it"
"Create a test file in out/hello.txt with Hello World"
"What's the git status?"
"Search my memories for conversations about coffee"
```

### Common Patterns

#### Read → Process → Write
```
"Read docs/DESIGN.md, summarize it, and save the summary to out/design-summary.txt"
```

#### Search → Analyze
```
"Search for all TypeScript files in brain/, read the first 3, and tell me what they do"
```

#### Git Workflow
```
"Check git status, then commit changes with message: Fixed operator skills"
```

---

