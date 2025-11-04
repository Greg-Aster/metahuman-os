# MetaHuman Operator - Quick Start Guide

## What is the Operator?

The Operator is your autonomous task execution system. It can:
- Read and write files
- Search the web
- Run git commands
- Execute agents
- Search your memories
- And more...

## How to Use

Simply ask in natural language using "operator mode" or by being specific about actions:

**Examples:**
```
"Search for TypeScript files in the brain directory"
"Read the README.md file and summarize it"
"Create a test file in out/hello.txt with Hello World"
"What's the git status?"
"Search my memories for conversations about coffee"
```

## Available Skills (13 total)

### 🟢 Read-Only Operations (No approval needed)

#### File System
- **fs_list** - List/search for files
  - "Find all markdown files in docs/"
  - "Search for files named test"

- **fs_read** - Read file contents
  - "Read persona/core.json"
  - "Show me the package.json"

- **summarize_file** - Summarize documents
  - "Summarize the ARCHITECTURE.md file"
  - "Give me a summary of docs/DESIGN.md"

#### Git
- **git_status** - Check repository status
  - "What's the git status?"
  - "Show me what files have changed"

#### Search
- **search_index** - Semantic memory search
  - "Search my memories for work projects"
  - "Find conversations about AI"

### 🟡 Write Operations (Supervised auto-approve)

#### File System
- **fs_write** - Create/write files
  - Allowed: memory/, out/, logs/
  - "Create out/test.txt with Hello World"

- **fs_delete** - Delete files (has dry-run)
  - Allowed: memory/, out/, logs/
  - "Delete out/test.txt"

- **json_update** - Update JSON files
  - Allowed: memory/, out/, logs/, etc/
  - "Update etc/test.json to set status: active"

#### Git
- **git_commit** - Commit changes
  - "Commit changes with message: Update skills"

#### Network
- **http_get** - Fetch web content
  - "Get the content from https://example.com"

- **web_search** - Search the web
  - "Search for TypeScript best practices 2025"

#### System
- **run_agent** - Execute agents
  - "Run the organizer agent"
  - "Execute the reflector"

### 🔴 High-Risk Operations (Requires bounded_auto)

- **shell_safe** - Run whitelisted shell commands
  - Currently requires higher trust level

## Your Current Trust Level

```json
{
  "trustLevel": "supervised_auto"
}
```

This gives you access to **12 out of 13 skills**. Only `shell_safe` requires higher trust.

## Fixed Issues ✅

1. **fs_list** - Now has access to entire project root (added `'.'` to allowedDirectories)
2. **fs_read** - Same fix, can read from anywhere in project
3. **summarize_file** - Can now summarize files across the entire codebase

## Common Patterns

### Read → Process → Write
```
"Read docs/DESIGN.md, summarize it, and save the summary to out/design-summary.txt"
```

### Search → Analyze
```
"Search for all TypeScript files in brain/, read the first 3, and tell me what they do"
```

### Git Workflow
```
"Check git status, then commit changes with message: Fixed operator skills"
```

## Troubleshooting

### "Base path not allowed"
The skill can't access that directory. Check the skill's `allowedDirectories` in `brain/skills/[skill-name].ts`

### "Trust level insufficient"
You need a higher trust level. Edit `persona/decision-rules.json` to increase your `trustLevel`.

### "Skill not found"
Restart the dev server to reload skill manifests:
```bash
pkill -f "astro dev"
cd apps/site && pnpm dev
```

### Operator keeps retrying with same error
The planner isn't learning from the error. This is a known issue - try rephrasing your request or being more specific about the path/approach.

## Testing All Skills

Try this comprehensive test sequence:

1. **Test file listing:**
   ```
   "List all markdown files in docs/"
   ```

2. **Test reading:**
   ```
   "Read the README.md file"
   ```

3. **Test writing:**
   ```
   "Create a file out/test.txt containing 'MetaHuman Operator Test'"
   ```

4. **Test deletion:**
   ```
   "Delete out/test.txt"
   ```

5. **Test git:**
   ```
   "Show me the git status"
   ```

6. **Test memory search:**
   ```
   "Search my memories for the word 'operator'"
   ```

7. **Test web search:**
   ```
   "Search the web for AI agent architectures"
   ```

8. **Test multi-step:**
   ```
   "List markdown files in docs/, read the first one, and create a summary in out/doc-summary.txt"
   ```

## Next Steps

1. ✅ Skills are configured and ready
2. 🔄 Test each skill to verify operation
3. 📈 Increase trust level to `bounded_auto` if you want shell access
4. 🎯 Build more complex workflows combining multiple skills

---

**Pro tip:** The operator learns from the context of your request. Be specific about file paths, desired output format, and any constraints.
