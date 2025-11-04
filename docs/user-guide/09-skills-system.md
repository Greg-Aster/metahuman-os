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

### Available Skills (13 total)

#### 🟢 Read-Only Operations (No approval needed)

**File System:**
- **fs_list** - List/search for files (trust: observe+)
  - "Find all markdown files in docs/"
  - "Search for files named test"
- **fs_read** - Read file contents (trust: observe+)  
  - "Read persona/core.json"
  - "Show me the package.json"
- **summarize_file** - Summarize documents (trust: observe+)
  - "Summarize the ARCHITECTURE.md file"
  - "Give me a summary of docs/DESIGN.md"

**Git:**
- **git_status** - Check repository status (trust: observe+)
  - "What's the git status?"
  - "Show me what files have changed"

**Search:**
- **search_index** - Semantic memory search (trust: observe+)
  - "Search my memories for work projects"
  - "Find conversations about AI"

#### 🟡 Write Operations (Supervised auto-approve)

**File System:**
- **fs_write** - Create/write files (allowed: memory/, out/, logs/) (trust: supervised_auto+)
  - "Create out/test.txt with Hello World"
- **fs_delete** - Delete files (has dry-run) (allowed: memory/, out/, logs/) (trust: supervised_auto+)
  - "Delete out/test.txt"
- **json_update** - Update JSON files (allowed: memory/, out/, logs/, etc/) (trust: supervised_auto+)
  - "Update etc/test.json to set status: active"

**Git:**
- **git_commit** - Commit changes (trust: supervised_auto+)
  - "Commit changes with message: Update skills"

**Network:**
- **http_get** - Fetch web content (trust: supervised_auto+)
  - "Get the content from https://example.com"
- **web_search** - Search the web (trust: supervised_auto+)
  - "Search for TypeScript best practices 2025"

**System:**
- **run_agent** - Execute agents (trust: suggest+)
  - "Run the organizer agent"
  - "Execute the reflector"

#### 🔴 High-Risk Operations (Requires bounded_auto)

- **shell_safe** - Run whitelisted shell commands (trust: bounded_auto+)
  - Currently requires higher trust level
  - Whitelist: ls, cat, grep, find, git, pnpm, node, tsx, pwd, whoami

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

