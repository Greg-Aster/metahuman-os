# Skills System

## Overview

Skills are the executable capabilities of the MetaHuman OS operator model. They provide controlled, audited interfaces for the AI to interact with the file system, run agents, execute commands, and search memory.

## Design Principles

1. **Sandboxed Execution**: All skills run in a controlled environment with strict permission boundaries
2. **Trust-Aware**: Skill availability and auto-execution depends on the current trust level
3. **Fully Audited**: Every skill invocation is logged with inputs, outputs, and results
4. **Risk-Based Approval**: High-risk operations require explicit user approval before execution
5. **Declarative Manifest**: Each skill declares its inputs, outputs, cost, and risk level

## Skill Manifest Format

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

## Core Skills

### 1. `fs_read` - Read Files

**Purpose:** Safely read files from the local file system

**Manifest:**
```typescript
{
  id: 'fs_read',
  name: 'Read File',
  description: 'Read the contents of a file from the file system',
  category: 'fs',
  inputs: {
    path: {
      type: 'string',
      required: true,
      description: 'Absolute path to the file to read',
      validation: (path) => isWithinAllowedDirectory(path)
    }
  },
  outputs: {
    content: { type: 'string', description: 'File contents' },
    size: { type: 'number', description: 'File size in bytes' },
    modified: { type: 'string', description: 'Last modified timestamp' }
  },
  risk: 'low',
  cost: 'cheap',
  minTrustLevel: 'observe',
  requiresApproval: false,
  allowedDirectories: ['memory/', 'persona/', 'logs/', 'out/', 'etc/', 'docs/']
}
```

**Example Invocation:**
```typescript
const result = await executeSkill('fs_read', { path: '/home/user/metahuman/memory/episodic/2025/evt-20251020.json' });
// Returns: { success: true, content: '...', size: 1234, modified: '2025-10-20T...' }
```

---

### 2. `fs_write` - Write Files

**Purpose:** Safely write files to allowed directories

**Manifest:**
```typescript
{
  id: 'fs_write',
  name: 'Write File',
  description: 'Write content to a file in allowed directories',
  category: 'fs',
  inputs: {
    path: {
      type: 'string',
      required: true,
      description: 'Absolute path where file should be written',
      validation: (path) => isWriteAllowed(path)
    },
    content: {
      type: 'string',
      required: true,
      description: 'Content to write to the file'
    },
    overwrite: {
      type: 'boolean',
      required: false,
      description: 'Whether to overwrite existing file (default: false)'
    }
  },
  outputs: {
    path: { type: 'string', description: 'Path where file was written' },
    size: { type: 'number', description: 'Bytes written' }
  },
  risk: 'high',
  cost: 'cheap',
  minTrustLevel: 'supervised_auto',
  requiresApproval: true,
  allowedDirectories: ['memory/', 'out/', 'logs/']
}
```

**Restrictions:**
- Cannot write to `persona/` (identity kernel is protected)
- Cannot write to `brain/` (code execution risk)
- Cannot overwrite existing files without explicit approval

---

### 3. `search_index` - Search Memory Index

**Purpose:** Perform semantic search over the memory index

**Manifest:**
```typescript
{
  id: 'search_index',
  name: 'Search Memory Index',
  description: 'Semantic search across episodic memory using vector embeddings',
  category: 'memory',
  inputs: {
    query: {
      type: 'string',
      required: true,
      description: 'Search query text'
    },
    limit: {
      type: 'number',
      required: false,
      description: 'Max number of results (default: 10)'
    },
    minSimilarity: {
      type: 'number',
      required: false,
      description: 'Minimum similarity threshold 0-1 (default: 0.5)'
    }
  },
  outputs: {
    results: {
      type: 'array',
      description: 'Array of matching memories with similarity scores'
    },
    count: { type: 'number', description: 'Number of results returned' }
  },
  risk: 'low',
  cost: 'expensive',  // Vector search can be computationally expensive
  minTrustLevel: 'observe',
  requiresApproval: false
}
```

---

### 4. `run_agent` - Trigger Agents

**Purpose:** Trigger other agents to run

**Manifest:**
```typescript
{
  id: 'run_agent',
  name: 'Run Agent',
  description: 'Trigger another agent to execute',
  category: 'agent',
  inputs: {
    agentName: {
      type: 'string',
      required: true,
      description: 'Name of the agent to run (e.g., "organizer", "reflector")',
      validation: (name) => isValidAgent(name)
    },
    wait: {
      type: 'boolean',
      required: false,
      description: 'Whether to wait for agent to complete (default: false)'
    }
  },
  outputs: {
    pid: { type: 'number', description: 'Process ID of spawned agent' },
    exitCode: { type: 'number', description: 'Exit code (if wait=true)' }
  },
  risk: 'medium',
  cost: 'expensive',
  minTrustLevel: 'supervised_auto',
  requiresApproval: true
}
```

**Restrictions:**
- Cannot run arbitrary code
- Agent must exist in `brain/agents/`
- Agent list is validated against available agents

---

### 5. `shell_safe` - Execute Whitelisted Commands

**Purpose:** Execute safe, whitelisted shell commands

**Manifest:**
```typescript
{
  id: 'shell_safe',
  name: 'Safe Shell Command',
  description: 'Execute a whitelisted shell command',
  category: 'shell',
  inputs: {
    command: {
      type: 'string',
      required: true,
      description: 'Command to execute',
      validation: (cmd) => isWhitelisted(cmd)
    },
    args: {
      type: 'array',
      required: false,
      description: 'Command arguments'
    },
    cwd: {
      type: 'string',
      required: false,
      description: 'Working directory (default: metahuman root)'
    }
  },
  outputs: {
    stdout: { type: 'string', description: 'Command output' },
    stderr: { type: 'string', description: 'Error output' },
    exitCode: { type: 'number', description: 'Process exit code' }
  },
  risk: 'high',
  cost: 'expensive',
  minTrustLevel: 'bounded_auto',
  requiresApproval: true,
  commandWhitelist: ['ls', 'cat', 'grep', 'find', 'git', 'pnpm']
}
```

**Restrictions:**
- Only whitelisted commands allowed
- No shell metacharacters (pipes, redirects) unless explicitly allowed
- Working directory must be within metahuman root

---

## Skill Execution Flow

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

## Trust Levels and Skill Availability

| Trust Level       | Available Skills | Auto-Execute? | Approval Required? |
|-------------------|------------------|---------------|--------------------|
| `observe`         | fs_read, search_index | No | All skills |
| `suggest`         | fs_read, search_index, run_agent | No | All skills |
| `supervised_auto` | All except shell_safe | Yes (low risk) | High-risk only |
| `bounded_auto`    | All | Yes (all) | High-risk only |

## Sandboxing and Safety

1. **File System Boundaries:**
   - Read: `memory/`, `persona/`, `logs/`, `out/`, `etc/`, `docs/`
   - Write: `memory/`, `out/`, `logs/` only
   - Never: `brain/`, `packages/`, `apps/`, `node_modules/`

2. **Command Execution:**
   - Only whitelisted commands
   - No shell metacharacters unless explicitly allowed
   - Timeout limits (30 seconds default)
   - Working directory constrained to metahuman root

3. **Agent Execution:**
   - Validate agent exists in `brain/agents/`
   - Single-instance guards respected
   - No arbitrary code execution

4. **Memory Access:**
   - Vector index queries rate-limited
   - No direct database access
   - Results filtered by privacy settings (future)

## Audit Trail

Every skill execution is logged:

```json
{
  "timestamp": "2025-10-20T12:34:56.789Z",
  "level": "info",
  "category": "action",
  "event": "skill_executed",
  "details": {
    "skillId": "fs_write",
    "inputs": { "path": "memory/...", "content": "..." },
    "outputs": { "path": "memory/...", "size": 1234 },
    "success": true,
    "durationMs": 45,
    "approvalRequired": true,
    "approvedBy": "human",
    "trustLevel": "supervised_auto"
  },
  "actor": "operator"
}
```

## Future Skills

### Phase 2 Candidates:
- `email_send`: Send emails via configured SMTP
- `calendar_add`: Add events to calendar
- `web_fetch`: Fetch content from URLs (with whitelist)
- `llm_generate`: Direct LLM calls with custom prompts

### Phase 3 Candidates:
- `db_query`: Query external databases (with connection whitelist)
- `api_call`: Call external APIs (with endpoint whitelist)
- `file_upload`: Upload files to configured services

## Skill Development Guide

To create a new skill:

1. Define the manifest in `brain/skills/<skill-id>.json`
2. Implement the skill function in `brain/skills/<skill-id>.ts`
3. Register the skill in the skills registry
4. Add tests for validation and execution
5. Update SKILLS.md with documentation

**Example skeleton:**
```typescript
// brain/skills/my_skill.ts
import { SkillManifest, SkillResult } from '../../packages/core/src/skills.js';

export const manifest: SkillManifest = {
  id: 'my_skill',
  name: 'My Skill',
  description: 'Description of what this skill does',
  category: 'fs',
  inputs: { /* ... */ },
  outputs: { /* ... */ },
  risk: 'medium',
  cost: 'cheap',
  minTrustLevel: 'supervised_auto',
  requiresApproval: true,
};

export async function execute(inputs: any): Promise<SkillResult> {
  // Validate inputs
  // Perform action
  // Return result
  return {
    success: true,
    outputs: { /* ... */ },
  };
}
```
