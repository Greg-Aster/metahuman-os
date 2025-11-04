# Skills Layer

Skills are self-contained executables that perform specific actions. Each skill declares its inputs, outputs, and required permissions.

## Skill Manifest Format

Each skill is a directory with:
- `manifest.json`: Metadata and permissions
- `execute.ts` or `execute.sh`: The actual implementation
- `README.md`: Documentation

### Example: `brain/skills/notify/manifest.json`

```json
{
  "name": "notify",
  "version": "0.1.0",
  "description": "Send notifications via desktop or mobile",
  "permissions": ["notifications"],
  "riskLevel": "low",
  "inputs": {
    "title": {"type": "string", "required": true},
    "message": {"type": "string", "required": true},
    "priority": {"type": "string", "enum": ["low", "normal", "high"], "default": "normal"}
  },
  "outputs": {
    "notificationId": {"type": "string"},
    "success": {"type": "boolean"}
  },
  "examples": [
    {
      "description": "Simple notification",
      "input": {"title": "Task Complete", "message": "Your build finished successfully"},
      "expectedOutput": {"success": true}
    }
  ]
}
```

## Built-in Skills (Phase 0-1)

### Phase 0: Foundation
- `capture`: Record observation to memory
- `remember`: Query memory
- `status`: Show system status

### Phase 1: Basic Actions
- `notify`: Desktop/mobile notifications
- `task-create`: Create new task
- `task-update`: Update task status
- `calendar-read`: Read calendar events

### Phase 2: Autonomous Actions
- `email-draft`: Generate email drafts
- `calendar-schedule`: Add calendar events
- `research`: Web research and summarization
- `file-organize`: File system operations

## Permission Model

Skills must declare required permissions:

- `read:memory` - Read from memory stores
- `write:memory` - Write to memory stores
- `read:filesystem` - Read files
- `write:filesystem` - Write files
- `notifications` - Send notifications
- `calendar` - Access calendar
- `email` - Access email
- `network` - Make network requests
- `system` - Execute system commands

## Creating a New Skill

1. Create directory: `brain/skills/skill-name/`
2. Write `manifest.json` with metadata
3. Implement `execute.ts` or `execute.sh`
4. Add documentation in `README.md`
5. Test with `mh skill test skill-name`

The skill registry will automatically discover and validate new skills on startup.
