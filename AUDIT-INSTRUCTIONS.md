# INSTRUCTIONS FOR CLAUDE CODE: COMPREHENSIVE CODEBASE AUDIT

**YOU ARE**: Claude Code, conducting a line-by-line audit of the MetaHuman OS codebase.

**YOUR MISSION**: Audit EVERY file assigned to you with ZERO shortcuts, ZERO "good enough", ZERO laziness.

**CRITICAL**: You have a documented tendency to cut corners and be lazy. These instructions exist to prevent that. Follow them EXACTLY.

---

## 🚨 BEFORE YOU START - READ THIS

Multiple Claude Code instances will run this audit in parallel. You MUST coordinate using:
- `audit-state.json` - Claim files before working, mark complete after
- `audit-scratchpad.md` - Document findings, blockers, patterns
- Git commits - Commit fixes immediately after each file

**Your agent name**: Check the terminal prompt or ask the user "What is my agent name?"

---

## 📋 WORKFLOW: FOR EACH FILE YOU AUDIT

### Step 0: Claim the File (WITH RACE CONDITION PROTECTION)

**FIRST ACTION - DO THIS IMMEDIATELY:**

1. **Read** `audit-state.json`
2. **Find** a file with `"status": "pending"`
3. **Remember** the exact file path you're claiming
4. **Update** it to `"status": "in-progress", "reviewer": "YOUR-AGENT-NAME", "started": "TIMESTAMP"`
5. **Write** the updated `audit-state.json` back
6. **WAIT 2 SECONDS** (let other agents' writes complete if race condition occurred)
7. **VERIFY** - Read `audit-state.json` again and check:
   - Is the file still showing YOUR agent name as reviewer?
   - If YES: You successfully claimed it, proceed
   - If NO: Another agent won the race, go back to step 1 and claim a different file

**If file is already claimed during initial read (step 2): SKIP IT, find another pending file.**

**If you lose the race condition (step 7): Don't worry, just claim a different file.**

**DO NOT PROCEED until you have VERIFIED you claimed a file successfully.**

**Example of verification:**
```
1. Read state, find "packages/core/src/foo.ts" is pending
2. Update state with your name
3. Write state back
4. Wait 2 seconds (use Bash: sleep 2)
5. Read state again
6. Check: state.files["packages/core/src/foo.ts"].reviewer === "YOUR-AGENT-NAME"
7. If true: Proceed! If false: Another agent got it, try again with different file
```

---

### Step 1: Read the Entire File

**Use the Read tool to read the ENTIRE file you're auditing.**

```
NO SKIPPING. NO ASSUMPTIONS.
Read from line 1 to the end.
```

**After reading, you must be able to answer:**
- What is this file's purpose?
- What does it import?
- What does it export?
- Is it in the correct directory?

**If you cannot answer these, read it again.**

---

### Step 2: Run the Comprehensive Checklist

**YOU MUST CHECK EVERY SINGLE ITEM BELOW. NO EXCEPTIONS.**

#### 2.1 TypeScript Quality

Use Read tool to examine the file. Check:

```
□ No `any` types (search for ": any" or "as any")
   - If found: Replace with proper types
   - If unavoidable: Add comment explaining why

□ All function parameters have types
   - Search for "function" and "=>" declarations
   - Verify each parameter has explicit type

□ All functions have return types
   - Check every function declaration
   - Add return types if missing

□ No implicit any
   - Look for function params without types
   - Fix immediately

□ Interfaces/types are properly defined
   - Check if types are imported or defined locally
   - Ensure no duplicate type definitions
```

**ACTION**: Use Edit tool to fix any TypeScript issues found.

#### 2.2 Import/Export Hygiene

Use Read tool to examine imports at top of file:

```
□ All imports are actually used in the file
   - Read through file and verify each import appears
   - Remove unused imports with Edit tool

□ All imports resolve correctly
   - Check if imported files exist using Read tool
   - Verify import paths are correct

□ Import paths use aliases (@metahuman/core, not ../../../)
   - Search for "../" in imports
   - Replace with proper aliases using Edit tool

□ No circular dependencies
   - Check what this file imports
   - Check if those files import this file back
   - Document in scratchpad if found

□ Exports are intentional
   - Review all export statements
   - Remove exports of internal helpers
```

**ACTION**: Use Edit tool to fix import/export issues.

#### 2.3 Error Handling

Use Grep to find all async functions and catch blocks:

```bash
# Find async functions
grep -n "async " path/to/file.ts

# Find catch blocks
grep -n "catch" path/to/file.ts
```

For each async function:
```
□ Has try/catch block
   - If missing: Add it with Edit tool

□ Catch block logs the error
   - Check for console.error or audit() call
   - If missing: Add error logging

□ Catch block includes context (what operation failed)
   - Verify error message explains what was happening
   - Improve error messages if vague

□ No empty catch blocks - ABSOLUTELY FORBIDDEN
   - Search for "catch { }" or "catch (e) { }"
   - If found: Add logging or remove try/catch
```

**ACTION**: Use Edit tool to add missing error handling.

#### 2.4 Logging & Observability

Use Read to check if file has LOG_PREFIX:

```
□ File has LOG_PREFIX constant defined
   - Search for "LOG_PREFIX"
   - If missing: Add at top of file

□ Entry logging (function was called)
   - Check if important functions log when called
   - Add entry logs for public APIs

□ Decision point logging (why a path was taken)
   - Check if conditions log their outcomes
   - Add logs before important branches

□ Error logging with context
   - Verify all catch blocks log errors
   - Ensure errors include operation context

□ All console.log use LOG_PREFIX
   - Search for console.log
   - Replace bare logs with prefixed logs
```

**ACTION**: Use Edit tool to add LOG_PREFIX and improve logging.

#### 2.5 Architecture Compliance

Use Read to check file structure:

```
□ File is in correct package location
   - Check if file belongs in core/ vs cli/ vs site/
   - Flag in scratchpad if misplaced

□ Single Responsibility Principle
   - File does ONE thing well
   - If doing multiple things: Flag for refactoring

□ Uses existing utilities (no reinventing wheels)
   - Search for common patterns (path building, auth checks)
   - Check if utilities exist in @metahuman/core
   - Replace custom logic with utility calls

□ Uses proper path utilities
   - Search for "profiles/" or hardcoded paths
   - Replace with getProfilePaths() or systemPaths

□ Uses authentication properly
   - Search for auth/user logic
   - Verify uses getAuthenticatedUser() from auth.ts

□ Integrates with Big Brother when needed
   - If file calls LLM: Should use bigBrotherTerminal
   - Check if bypassing Big Brother visibility
```

**ACTION**: Use Edit tool to fix architecture violations.

#### 2.6 Security & Safety

Use Read to check for security issues:

```
□ User input is validated
   - Find function parameters from external sources
   - Verify validation before use

□ Paths are sanitized (no path traversal)
   - Search for path.join or file operations
   - Verify no user input directly in paths

□ Authentication checked where required
   - Search for API route handlers
   - Verify getAuthenticatedUser() is called

□ No hardcoded secrets
   - Search for "password", "token", "secret", "key"
   - Verify no actual secrets in code
```

**ACTION**: Use Edit tool to fix security issues.

#### 2.7 Legacy Code Detection

Use Grep to find legacy markers:

```bash
# Find TODOs
grep -n "TODO" path/to/file.ts

# Find FIXMEs
grep -n "FIXME" path/to/file.ts

# Find commented code blocks
grep -n "^\\s*//" path/to/file.ts | head -20
```

```
□ No TODO comments
   - If found: Either fix it now or create GitHub issue
   - Remove the TODO comment

□ No FIXME comments
   - If found: Fix it now or create issue
   - Remove the FIXME

□ No commented-out code blocks
   - Search for large blocks of // commented code
   - Delete commented code (it's in git history)

□ No "temporary" hacks
   - Search for "temp", "hack", "quick fix"
   - Either fix properly or document why needed
```

**ACTION**: Use Edit tool to remove TODOs/FIXMEs and fix issues.

#### 2.8 Duplication Detection

Use Grep to search codebase for similar patterns:

```bash
# If file has a utility function, search for similar logic
grep -r "function functionName" .

# Search for duplicate constants
grep -r "const CONSTANT_NAME" .
```

```
□ No duplicate functions
   - Search codebase for similar function names
   - If duplicates found: Document in scratchpad

□ No duplicate constants
   - Search for same constant in multiple files
   - If found: Move to shared config

□ No copy-pasted logic
   - Look for repeated code patterns
   - Extract to utility if found 3+ times
```

**ACTION**: Document duplication in scratchpad for follow-up.

---

### Step 3: Fix ALL Issues Found

**DO NOT JUST DOCUMENT ISSUES. FIX THEM NOW.**

For each issue you found:

1. **Use Edit tool to make the fix**
   - Be precise with old_string and new_string
   - Verify fix with Read tool after editing

2. **Verify the fix compiles**
   - Use Bash to run: `pnpm tsc --noEmit path/to/file.ts`
   - If errors: Fix them before moving on

3. **Keep a count**
   - Track how many issues you found
   - Track how many you fixed
   - Track how many are critical (security, crashes, data loss)

**YOU ARE NOT DONE UNTIL ALL FIXABLE ISSUES ARE FIXED.**

---

### Step 4: Document in Scratchpad

**MANDATORY: Update `audit-scratchpad.md` with your findings.**

Use Read to load scratchpad, then Edit to append:

```markdown
## [FILE PATH] - [YOUR-AGENT-NAME] - [TIMESTAMP]

**Status**: ✅ PASS / ⚠️ NEEDS WORK / ❌ CRITICAL ISSUES

**Issues Found**: [NUMBER]
- [Specific issue with line number]
- [Another issue]

**Changes Made**: [NUMBER]
- [What you fixed]
- [What you improved]

**Critical Issues**: [NUMBER]
- [Security/crash/data loss issues]

**Dependencies Checked**:
- path/to/import1.ts - Status: [Pending/Completed/In-Progress]
- path/to/import2.ts - Status: [Pending/Completed/In-Progress]

**Follow-up Needed**:
- [ ] [Task if any]

**Time Spent**: [X] minutes

**Notes**: [Observations for other agents]

---
```

**DO NOT SKIP THIS STEP.**

---

### Step 5: Update State & Commit

**Update audit-state.json:**

Use Read to load state, then Edit to update your file entry:

```json
{
  "path/to/file.ts": {
    "status": "completed",
    "reviewer": "YOUR-AGENT-NAME",
    "started": "ORIGINAL-TIMESTAMP",
    "completed": "NOW-TIMESTAMP",
    "issuesFound": 5,
    "issuesFixed": 5,
    "criticalIssues": 0,
    "followUpNeeded": false,
    "notes": "Brief summary"
  }
}
```

**Commit your changes:**

Use Bash to commit:

```bash
git add path/to/file.ts audit-state.json audit-scratchpad.md
git commit -m "audit(filename): summary of fixes

- Fix 1
- Fix 2
- Fix 3

Issues: 5 found, 5 fixed, 0 critical
Reviewed by: YOUR-AGENT-NAME"
```

**DO NOT MOVE TO NEXT FILE UNTIL COMMITTED.**

---

### Step 6: Anti-Wandering Checkpoint

**BEFORE claiming your next file, answer these questions honestly:**

```
❓ Did I actually read the ENTIRE file, or did I skim?
❓ Did I check EVERY item on the checklist, or skip some?
❓ Did I fix ALL issues I found, or leave some for "later"?
❓ Did I update the scratchpad with proper details?
❓ Did I commit my changes with a clear message?
```

**If you answered "skim", "skip some", or "leave some" to ANY question:**
- ❌ GO BACK and redo the file properly
- ❌ DO NOT proceed to next file

**ONLY if you answered correctly to ALL questions:**
- ✅ Return to Step 0 and claim next file

---

## 🔄 EVERY 3 FILES: MANDATORY BREAK

**After completing 3 files, you MUST:**

1. **Re-read this instruction file (AUDIT-INSTRUCTIONS.md)**
   - You WILL drift from the process
   - Re-reading prevents corner-cutting

2. **Review your last 3 files**
   - Use Read to check your scratchpad entries
   - Were they thorough or rushed?
   - If rushed: Mark files as "needs-review" in state

3. **Check for patterns**
   - Are you seeing the same issues repeatedly?
   - Document patterns in scratchpad

4. **Read scratchpad updates from other agents**
   - Use Read to load audit-scratchpad.md
   - Check for blockers or important findings
   - Learn from patterns others found

**DO NOT SKIP THIS BREAK. It maintains quality.**

---

## 🚨 BLOCKERS: When to Stop and Flag

**STOP working on a file and flag it as BLOCKED if:**

1. **Circular dependency found**
   - File A imports B, B imports C, C imports A
   - Flag in scratchpad under "🚨 ACTIVE BLOCKERS"
   - Mark file as "blocked" in state
   - Move to different file

2. **Missing critical dependency**
   - File imports something that doesn't exist
   - Flag in scratchpad
   - Mark as blocked
   - Move to different file

3. **Major architectural issue**
   - File needs complete rewrite
   - Flag as PROPOSAL in scratchpad
   - Mark as needs-review
   - Move on, come back later

**Blocker template for scratchpad:**

```markdown
## 🚨 ACTIVE BLOCKERS

### BLOCKER-XXX: [Short description]
**Discovered by**: YOUR-AGENT-NAME
**Date**: TIMESTAMP
**Affects**: file1.ts, file2.ts
**Description**: [Detailed explanation]
**Action Required**: [What needs to happen]
**Status**: UNRESOLVED
```

---

## 🎯 PRIORITY: Which Files to Audit First

**When claiming files from audit-state.json, prefer this order:**

1. **Tier 1: Critical Infrastructure** (DO THESE FIRST)
   - `packages/core/src/auth.ts`
   - `packages/core/src/users.ts`
   - `packages/core/src/security-policy.ts`
   - `packages/core/src/path-builder.ts`
   - `packages/core/src/audit.ts`
   - `packages/core/src/llm.ts`
   - `packages/core/src/memory.ts`
   - `packages/core/src/identity.ts`

2. **Tier 2: Agent System**
   - Files in `packages/core/src/agent-*.ts`
   - Files in `brain/agents/`

3. **Tier 3: Web UI**
   - Files in `apps/site/src/pages/api/`
   - Files in `apps/site/src/components/`

4. **Tier 4: CLI**
   - Files in `packages/cli/src/`

5. **Tier 5: Everything Else**

**Check dependencies:**
- If auditing `auth.ts`, avoid `users.ts` (it imports auth)
- If another agent is on `auth.ts`, you do `llm.ts` instead
- Coordinate via scratchpad

---

## 📊 EXPECTED PACE

**Per file: 60-90 minutes minimum for thorough review**

**DO NOT GO FASTER.** Fast = corners cut = lazy = UNACCEPTABLE.

**Breakdown:**
- Read file: 10 min
- TypeScript check: 10 min
- Imports/exports: 5 min
- Error handling: 15 min
- Logging: 10 min
- Architecture: 10 min
- Security: 10 min
- Legacy/duplication: 10 min
- Fixes: 20 min
- Documentation: 5 min
- Commit: 5 min

**If you finish a file in <45 minutes: You cut corners. Go back.**

---

## ⚠️ FORBIDDEN BEHAVIORS

**YOU MUST NOT:**

❌ Say "looks good" without checking every item
❌ Say "mostly fine" - it's either CORRECT or NEEDS FIXING
❌ Say "will fix later" - FIX IT NOW
❌ Skip checklist items because "file is simple"
❌ Skip scratchpad updates because "nothing interesting"
❌ Commit without clear message
❌ Claim new file without completing current one
❌ Work on file already claimed by another agent
❌ Make assumptions about code behavior - READ IT
❌ Leave TODOs/FIXMEs in code
❌ Leave `any` types without fixing them
❌ Leave empty catch blocks
❌ Leave missing error logging

**If you catch yourself doing ANY of the above: STOP and restart the file.**

---

## 🎯 SUCCESS CRITERIA (When You're Done)

**You are DONE with the audit when:**

✅ Every file assigned to you has `"status": "completed"`
✅ Every issue you found has been FIXED (not just documented)
✅ Every file has entry in scratchpad
✅ Every change is committed to git
✅ No critical issues remain unresolved
✅ No TODOs/FIXMEs remain in files you audited
✅ No `any` types remain (or all are justified with comments)
✅ All async functions have try/catch
✅ All files compile with `pnpm tsc --noEmit`

**If ANY of the above is false: You are NOT done.**

---

## 🔧 CLAUDE CODE TOOL USAGE GUIDE

**Here's exactly how to use your tools for this audit:**

### Read Tool
```typescript
// Read entire file
Read: { file_path: "/home/greggles/metahuman/path/to/file.ts" }

// Read state file
Read: { file_path: "/home/greggles/metahuman/audit-state.json" }

// Read scratchpad
Read: { file_path: "/home/greggles/metahuman/audit-scratchpad.md" }
```

### Edit Tool
```typescript
// Fix a type issue
Edit: {
  file_path: "/home/greggles/metahuman/path/to/file.ts",
  old_string: "function process(data: any) {",
  new_string: "function process(data: ProcessedData) {"
}

// Update state
Edit: {
  file_path: "/home/greggles/metahuman/audit-state.json",
  old_string: '"status": "pending"',
  new_string: '"status": "in-progress", "reviewer": "Agent-1", "started": "2026-01-12T10:00:00Z"'
}
```

### Grep Tool
```typescript
// Find all TODO comments
Grep: {
  pattern: "TODO",
  path: "path/to/file.ts",
  output_mode: "content"
}

// Find all any types
Grep: {
  pattern: ":\\s*any",
  path: "path/to/file.ts",
  output_mode: "content"
}

// Find all async functions
Grep: {
  pattern: "async\\s+(function|\\()",
  path: "path/to/file.ts",
  output_mode: "content"
}
```

### Bash Tool
```typescript
// Check TypeScript compilation
Bash: {
  command: "pnpm tsc --noEmit path/to/file.ts",
  description: "Check if file compiles"
}

// Commit changes
Bash: {
  command: "git add path/to/file.ts audit-state.json audit-scratchpad.md && git commit -m 'audit(filename): fixes'",
  description: "Commit audit fixes"
}
```

---

## 🧠 REMEMBER

**This is production software that will run autonomously 24/7.**
**Bugs = data loss, security breaches, system failures.**
**Your thoroughness directly impacts user trust and safety.**

**NO SHORTCUTS. NO LAZINESS. NO "GOOD ENOUGH".**

**EXCELLENCE IS THE ONLY ACCEPTABLE STANDARD.**

---

**Now begin your audit. Re-read these instructions every 3 files.**
