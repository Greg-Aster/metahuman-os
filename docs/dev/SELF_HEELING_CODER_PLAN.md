# Self-Healing Coder Agent – Design & Implementation Plan

**Date:** 2025-11-04  
**Author:** Codex (for greggles)  
**Status:** Draft for implementation  
**Related:** `docs/dev/MULTI_MODEL_IMPLEMENTATION_PLAN.md`, `docs/dev/DUAL_CONSCIOUSNESS_MODELING_NOTES.md`, `etc/models.json`

---

## 1. Goals

- Give MetaHuman OS the same “prompt → patch” coding capability as tools like Codex, Claude Code, or Qwen Coder, but execute changes inside the app rather than a terminal.
- Let the agent read _all_ project code, but prevent it from modifying or deleting anything under `memory/` (read-only memories).
- Support self-healing: when the coder detects errors/tests failing, it can propose edits and apply them after human approval.
- Maintain full auditability: every change is suggested, reviewed (optional auto-approve), and logged.
- Integrate with the new multi-model router so the dedicated `coder` role handles code generation while orchestrator/persona stay focused on their specialties.

---

## 2. Architecture Overview

```
User Request → Orchestrator (role: orchestrator)
   ↳ Intent = Coding? Yes → Planner builds plan with code steps
       ↳ coder role called for code generation / diffs
       ↳ Skills apply patches (fs_write, apply_patch) to code directories
       ↳ Approval gate before committing changes (UI pop-up)
   ↳ Persona role narrates results back to user
```

Roles:
- **Orchestrator:** determines whether a request needs code edits/tests.
- **Coder:** Qwen3 Coder 30B (via `models.json` role) generates diffs, explanations, test commands.
- **Persona:** Continues to provide conversational context in the user’s voice.
- **Curator (optional):** Summaries for commit messages or release notes.

---

## 3. Permissions & Guardrails

1. **Readable directories**  
   - Allow `fs_read`, `fs_list`, `summarize_file` for: `apps/`, `packages/`, `brain/`, `docs/`, `etc/`, `out/`, `tests/`, `memory/` (read-only).
2. **Writable directories**  
   - Allow `fs_write`, `json_update`, `apply_patch` for: `apps/`, `packages/`, `brain/`, `docs/`, `etc/`, `out/`, `tests/`.  
   - Explicitly _deny_ `memory/`, `persona/`, `logs/` unless the user overrides via approval.
3. **Deletes**  
   - Keep `fs_delete` disabled by default; require explicit manual approval for each delete (UI modal).
4. **Approvals**  
   - Extend `/api/approvals` queue so every code edit arrives with:  
     - Generated diff or file content preview  
     - Explanation from coder role  
     - Buttons: `Approve`, `Reject`, `Approve & Auto-apply similar` (optional future feature)
5. **Audit logging**  
   - Add events: `code_change_proposed`, `code_change_applied`, `code_change_rejected` with details `{ files, diffHash, modelRole: 'coder' }`.

---

## 4. Workflow Details

1. **Planner update (brain/agents/operator.ts):**
   - Identify coding intents (`fix bug`, `add function`, `update tests`, `run tests`, etc.).
   - Inject new plan steps: `code.plan`, `code.generate`, `code.apply`, `tests.run`.
   - `code.generate` calls `callLLM({ role: 'coder', ... })`.
   - `code.apply` writes results to temporary files and queues them for approval.

2. **Code execution helpers (packages/core/skills or new module):**
   - `code_generate` skill:
     ```ts
     inputs: { filePath, instructions, surroundingCode }
     outputs: { patch, explanation }
     ```
     Calls coder LLM with a prompt including file context and instructions.
   - `code_apply_patch` skill:
     - Takes patch (Unified diff or list of edits).
     - Stages it in `/out/code-drafts/` and pushes to approval queue.
   - `tests_run` skill (optional):
     - Runs `pnpm test` or targeted commands via `shell_safe`.

3. **Approval UI (apps/site/src/components/RightSidebar.svelte):**
   - Extend the approvals list to show code diffs with syntax highlighting.
   - Add context: file names changed, cognitive mode, model role.
   - Buttons trigger `/api/approvals/:id/approve` and `/api/approvals/:id/reject`.

4. **Backend application (apps/site/src/pages/api/approvals.ts):**
   - On approve:
     - Apply patch to actual file (atomic write or use `apply_patch`).
     - Log success.
   - On reject:
     - Delete staged draft, log rejection.

5. **Memory preservation:**
   - Ensure `isWriteAllowed` returns `false` for any path under `memory/`.
   - Unit test to confirm coder cannot edit `memory/*.json`.

---

## 5. Implementation Steps (for coding agent)

### Step 1: Model Registry
1. Update `etc/models.json` with a `coder` role referencing `qwen3-coder:30b`.
2. Add unit test for `resolveModel('coder')`.

### Step 2: Permission Tweaks
1. In `brain/skills/fs_write.ts`, `fs_delete.ts`, ensure `allowedDirectories` excludes `memory/`, `persona/`.
2. Add read-only note for `memory/`.

### Step 3: Planning & Execution
1. Modify `operator.ts` planner heuristics to add coding plan steps.
2. Implement `code_generate` helper (could live in `packages/core/src/code-agent.ts`).
3. Implement `code_apply_patch` skill that produces approval items (instead of writing immediately).
4. Hook into approvals queue (`packages/core/src/skills.ts` → `queueForApproval`).

### Step 4: Approvals UI
1. Update `apps/site/src/components/RightSidebar.svelte` approvals panel:
   - Show file diffs, explanation.
2. Add filter to highlight “Code Changes” vs regular skill approvals.

### Step 5: Apply Approved Changes
1. Extend `/api/approvals` POST handler to detect `type: 'code-change'`.
2. On approve, apply patch using `apply_patch` helper (atomic commit).
3. On reject, remove staged file.

### Step 6: Testing
1. Add integration test scenario:
   - Prompt: “Fix lint error in `packages/core/src/model-router.ts`”.
   - Confirm coder role is used (audit log).
   - Approval queue receives diff.
   - Approving diff updates file.
2. Ensure failing tests scenario: coder can run `pnpm test` via `shell_safe` but results go to audit logs, not terminal.

---

## 6. Prompts & Safety

**Coder prompt template (rough):**
```
You are the MetaHuman OS code agent.
- Task: ${instructions}
- File: ${filePath}
- Current content (excerpt around focus area):
<<<CODE
${surroundingCode}
CODE
>>>
Restrictions:
- Never edit files under memory/ or persona/ unless explicitly instructed by user and approved.
- Produce a unified diff starting with "diff --git".
- Provide a short explanation and mention tests to run.
```

**Persona response template:** mention that a code change has been proposed and awaits approval, or that the change was applied successfully.

---

## 7. Security & Fallbacks

- **Two-person rule (optional):** require manual approval when trust level < `supervised_auto`.
- **Sandboxing:** keep `shell_safe` limited to commands deriving from `config/` allowlist. No `rm`, `curl`, etc.
- **Recovery:** if a patch fails to apply (conflict), the coder should be prompted to rebase the diff using fresh file content.
- **Audit:** every stage logs `modelRole`, `modelId`, diff hash, file paths.

---

## 8. Deliverables

- Updated `etc/models.json` with coder role.
- New/modified skills (`code_generate`, `code_apply_patch`).
- Planner/executor updates in `operator.ts`.
- Approval queue & UI improvements.
- Test scripts or manual test plan (documented in `docs/dev/COGNITIVE_MODE_TESTING.md`).
- Updated documentation pointing to this plan.

---

## 9. Future Enhancements (optional)

- Auto-run tests after approval (pipeline integration).
- “Repair mode” where coder automatically reverts if tests fail.
- Learning loop: failed approvals feed back to persona/coder for refinement.
- Multi-file edits (compose multiple diffs into one approval batch).

---

**Next Action:** hand this document to the coding agent; track progress in the multi-model implementation plan once work begins.***
