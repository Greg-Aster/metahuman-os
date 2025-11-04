# Self-Healing Coder Agent - Implementation Progress

**Date**: 2025-11-04
**Status**: In Progress
**Related**: [SELF_HEELING_CODER_PLAN.md](SELF_HEELING_CODER_PLAN.md)

---

## Current Status Analysis

### ✅ Already Complete
1. **Model Registry** - `default.coder` role configured in `etc/models.json`
   - Model: `qwen3-coder:30b`
   - Temperature: 0.2 (deterministic code generation)
   - Context: 8192 tokens
   - Roles: coder, code-generation, code-review

2. **Multi-Model Infrastructure** - All routing in place
   - `callLLM()` supports role-based routing
   - Audit logging for all LLM calls
   - Cognitive mode awareness

### ⚠️ Needs Implementation

#### 1. Permission System Updates
**Current State**:
- `isWriteAllowed()` blocks: `persona/`, `brain/`, `packages/`, `apps/`, `node_modules/`, `etc/`
- BUT this means coder CANNOT write to code directories!

**Needed Changes**:
- Create separate permission function for coder agent: `isCoderWriteAllowed()`
- Allow coder to write to: `apps/`, `packages/`, `brain/`, `docs/`, `etc/`, `out/`, `tests/`
- Block coder from writing to: `memory/`, `persona/`, `logs/`
- Keep read access to everything (including `memory/` for context)

#### 2. Code Generation Skills
Need to create:
- `code_generate` - Generate code/diffs using coder LLM
- `code_apply_patch` - Stage changes for approval
- `code_test` - Run tests via shell_safe

#### 3. Approval Queue System
Need to implement:
- Approval queue data structure (`out/approvals/queue.json`)
- Queue management functions (add, approve, reject)
- Code diff preview generation

#### 4. Operator Integration
Need to update:
- Planner heuristics to detect coding intents
- Add coding skill steps to plans
- Route code generation to coder role

#### 5. UI Updates
Need to create:
- Approval panel in RightSidebar
- Diff viewer component
- Approve/Reject buttons

---

## Implementation Plan

### Phase 1: Permission System (CRITICAL)
1. Create `isCoderWriteAllowed()` function in `packages/core/src/skills.ts`
2. Add `coder` category to skill categories
3. Update `fs_write`, `fs_delete` to check actor type
4. Add unit tests for permission system

### Phase 2: Code Generation Skills
1. Create `brain/skills/code_generate.ts`
   - Input: `filePath`, `instructions`, `context`
   - Output: `patch`, `explanation`, `testCommands`
   - Uses `callLLM({ role: 'coder' })`
2. Create `brain/skills/code_apply_patch.ts`
   - Stages changes in `out/code-drafts/`
   - Adds to approval queue
3. Create `brain/skills/code_test.ts`
   - Wrapper around `shell_safe` for test commands

### Phase 3: Approval Queue
1. Create `packages/core/src/approval-queue.ts`
   - `addToQueue()`, `getQueue()`, `approve()`, `reject()`
   - Persistent storage in `out/approvals/queue.json`
2. Create API endpoint `/api/approvals`
   - GET: List pending approvals
   - POST /:id/approve: Apply changes
   - POST /:id/reject: Discard changes

### Phase 4: Operator Integration
1. Update `brain/agents/operator.ts` planner
   - Add coding intent detection
   - Add code skill steps to plan
2. Create coding workflow test

### Phase 5: UI
1. Add approval panel to `apps/site/src/components/RightSidebar.svelte`
2. Create diff viewer component
3. Add real-time updates via polling

---

## Security Guardrails

1. **Two-person rule**: All code changes require explicit approval
2. **Read-only memory**: Coder can read `memory/` for context but never write
3. **Protected persona**: `persona/` files completely off-limits to coder
4. **Audit trail**: Every code change logged with diff hash, files, model role
5. **Sandboxed tests**: Test execution limited to safe commands

---

## Testing Strategy

### Unit Tests
- Permission system: Verify coder can write to code dirs, not memory
- Code generation: Mock LLM responses
- Approval queue: Add/approve/reject operations

### Integration Tests
1. **Basic code generation**:
   - Prompt: "Add a comment to packages/core/src/paths.ts"
   - Verify: Coder role used, approval queued, change applies correctly

2. **Self-healing workflow**:
   - Introduce intentional syntax error
   - Prompt: "Fix the syntax error in file X"
   - Verify: Coder detects error, generates fix, applies after approval

3. **Permission enforcement**:
   - Prompt: "Edit memory/episodic/2025/test.json"
   - Verify: Request rejected, memory remains untouched

---

## Next Steps

1. Start with Phase 1: Permission system updates
2. Create approval queue infrastructure
3. Build code generation skills
4. Integrate with operator
5. Add UI components
6. End-to-end testing

---

## Progress Update (2025-11-04)

### ✅ Completed

**Phase 1: Permission System**
- Created `isCoderWriteAllowed()` function in [packages/core/src/skills.ts](../../packages/core/src/skills.ts#L385-L411)
- Coder can write to: `apps/`, `packages/`, `brain/`, `docs/`, `etc/`, `out/`, `tests/`
- Coder blocked from: `memory/`, `persona/`, `logs/`, `node_modules/`, `.git/`

**Phase 2: Code Generation Skills**
- Created [brain/skills/code_generate.ts](../../brain/skills/code_generate.ts)
  - Uses `callLLM({ role: 'coder' })` for code generation
  - Inputs: `filePath`, `instructions`, `context`
  - Outputs: `patch`, `newContent`, `explanation`, `testCommands`
  - Generates unified diffs or complete file content

- Created [brain/skills/code_apply_patch.ts](../../brain/skills/code_apply_patch.ts)
  - Stages changes in `out/code-drafts/`
  - Enforces coder write permissions
  - Creates JSON metadata and preview files
  - Includes `applyStaged()` function for post-approval application

- Registered skills in [brain/skills/index.ts](../../brain/skills/index.ts)

**Phase 3: Approval Queue & UI** ✅
- Created [apps/site/src/pages/api/code-approvals.ts](../../apps/site/src/pages/api/code-approvals.ts)
  - GET `/api/code-approvals`: Lists pending approvals from `out/code-drafts/`
  - POST `/api/code-approvals/:id/approve`: Applies code changes
  - POST `/api/code-approvals/:id/reject`: Rejects code changes
  - Auto-polling every 5 seconds for new approvals

- Created [apps/site/src/components/ApprovalBox.svelte](../../apps/site/src/components/ApprovalBox.svelte)
  - **Integrated above chat input** (Claude Code / Cursor style)
  - Collapsible UI - expands when approvals present
  - Code preview with syntax highlighting
  - Navigation between multiple approvals
  - Approve/Reject buttons
  - Test commands display
  - Dark mode support

- Integrated into [apps/site/src/components/ChatInterface.svelte](../../apps/site/src/components/ChatInterface.svelte#L1062)

**Phase 4: Operator Integration** ✅
- Updated [brain/agents/operator.ts](../../brain/agents/operator.ts#L309-L310) with coding intent detection
  - Keywords: 'fix', 'bug', 'error', 'add function', 'implement', 'refactor', 'debug', 'code', etc.
  - Auto-detects coding tasks from user goal
- Added coding-specific instructions to planner (lines 349-360)
  - Workflow guidance: fs_read → code_generate → code_apply_patch
  - Emphasis on using coder LLM instead of fs_write for code changes
  - Test command requirements
- Added coding workflow examples to system prompt (lines 405-428)
  - Example 1: Fix a bug
  - Example 2: Add a function
  - Example 3: Refactor code
- Skills catalog already includes code_generate and code_apply_patch

### ⏳ Pending

**Phase 5: Testing**

Created test file: [tests/test-coder-workflow.mjs](../../tests/test-coder-workflow.mjs)

**Test Coverage**:
- ✓ End-to-end code generation workflow
  - Run with: `node tests/test-coder-workflow.mjs`
  - Verifies: coding intent detection, code_generate usage, code_apply_patch staging
  - Creates test file, runs operator, checks staging directory
- ⏳ Permission enforcement test (manual)
  - Try to modify memory/ files - should be blocked by `isCoderWriteAllowed()`
- ⏳ Approval workflow test (manual)
  - Run test, check web UI at http://localhost:4321
  - Verify approval box appears with staged changes
  - Test approve/reject functionality

---

**Current Task**: Phase 4 complete, ready for testing
