# Operator Skills Test Suite

Test each skill systematically through the operator interface.

## File System Operations (Read-Only)

### 1. fs_list - List Files
**Trust Level**: observe
**Test Commands**:
```
Search for all TypeScript files in the brain directory
Find files named "test" in the project
List all JSON files in the memory directory
```

### 2. fs_read - Read File Contents
**Trust Level**: observe
**Test Commands**:
```
Read the contents of persona/core.json
Show me the README.md file
Read the package.json file
```

### 3. summarize_file - Summarize File
**Trust Level**: observe
**Test Commands**:
```
Summarize the ARCHITECTURE.md file
Give me a summary of docs/DESIGN.md
```

## File System Operations (Write/Modify)

### 4. fs_write - Write Files
**Trust Level**: supervised_auto
**Test Commands**:
```
Create a test file in out/test.txt with the content "Hello World"
Write a note to memory/notes.txt saying "This is a test"
```

### 5. fs_delete - Delete Files
**Trust Level**: supervised_auto
**Test Commands**:
```
Delete the file out/test.txt
Remove the temporary file logs/temp.log
```

### 6. json_update - Update JSON Files
**Trust Level**: supervised_auto
**Test Commands**:
```
Update etc/test-config.json to set { "test": true }
Add a new field to out/test.json with key "status" and value "active"
```

## Git Operations

### 7. git_status - Check Git Status
**Trust Level**: observe
**Test Commands**:
```
What's the git status?
Show me what files have changed
```

### 8. git_commit - Commit Changes
**Trust Level**: supervised_auto
**Test Commands**:
```
Commit the changes with message "Test commit from operator"
Stage and commit all changes
```

## Search & Query

### 9. search_index - Semantic Memory Search
**Trust Level**: observe
**Test Commands**:
```
Search my memories for conversations about coffee
Find memories related to work projects
```

## Network Operations

### 10. http_get - Fetch Web Content
**Trust Level**: supervised_auto
**Test Commands**:
```
Fetch the content from https://example.com
Get the HTML from https://anthropic.com
```

### 11. web_search - Search the Web
**Trust Level**: supervised_auto
**Test Commands**:
```
Search the web for "TypeScript best practices 2025"
Find recent articles about AI agents
```

## System Operations

### 12. shell_safe - Run Shell Commands
**Trust Level**: bounded_auto
**Test Commands**:
```
Run "ls -la" to list files
Execute "pwd" to show current directory
Run "node --version"
```

### 13. run_agent - Execute Agents
**Trust Level**: supervised_auto
**Test Commands**:
```
Run the organizer agent
Execute the reflector agent
```

---

## Expected Results

### Working Skills (Trust Level: supervised_auto)
- ✅ fs_list
- ✅ fs_read
- ✅ fs_write
- ✅ fs_delete
- ✅ json_update
- ✅ summarize_file
- ✅ git_status
- ✅ git_commit
- ✅ search_index
- ✅ http_get
- ✅ web_search
- ✅ run_agent

### Requires Higher Trust (bounded_auto)
- ⚠️ shell_safe - Needs bounded_auto trust level

## Common Issues & Solutions

### Issue 1: "Base path not allowed"
**Solution**: Check `allowedDirectories` in skill manifest. For read-only operations, ensure `'.'` is included.

### Issue 2: "Trust level insufficient"
**Solution**: Check your trust level in `persona/decision-rules.json`. Increase if needed:
```json
{
  "trustLevel": "supervised_auto"
}
```

### Issue 3: Skills not found
**Solution**: Restart the dev server to reload skill manifests:
```bash
pkill -f "astro dev"
cd apps/site && pnpm dev
```

### Issue 4: Operator keeps retrying with same error
**Solution**: The planner isn't learning from failures. This needs improvement in the operator loop logic.

## Quick Test Command

Try this comprehensive test:
```
I need you to:
1. List all markdown files in docs/
2. Read the first one you find
3. Summarize it
4. Create a note in out/test-summary.txt with your summary
```

This tests: fs_list → fs_read → summarize_file → fs_write in sequence.
