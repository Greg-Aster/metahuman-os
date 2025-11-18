# Chat History System (Server-First Architecture)

## Overview

MetaHuman OS uses a **server-first chat history system** that provides:
- Single source of truth on the server
- Automatic rolling window (configurable 10-100 messages, default 50)
- Strict mode isolation (conversation vs. inner dialogue)
- Support for all message types
- Proper state cleanup

## Architecture

### File Structure

```
profiles/{username}/state/
  ├── conversation-buffer-conversation.json  # Conversation mode history
  ├── conversation-buffer-inner.json         # Inner dialogue mode history
  └── chat-config.json                       # Per-user chat settings (future)
```

### Buffer File Format

```json
{
  "mode": "conversation",
  "messages": [
    {
      "role": "user",
      "content": "Hello!",
      "timestamp": 1731715200000,
      "meta": { "curiosityQuestionId": "..." }
    },
    {
      "role": "assistant",
      "content": "Hi there!",
      "timestamp": 1731715201000
    }
  ],
  "lastUpdated": "2025-11-16T00:00:00.000Z",
  "messageLimit": 50
}
```

## Message Types

The system supports all message types:

| Type | Source | Description |
|------|--------|-------------|
| `user` | User input | Messages from the user |
| `assistant` | LLM response | Assistant replies |
| `system` | System notifications | Context, summaries, warnings |
| `reflection` | Reflection agent | Inner thoughts and reflections |
| `dream` | Dreamer agent | Dream sequences |
| `reasoning` | Reasoning engine | Chain-of-thought traces |

## API Endpoints

### GET /api/conversation-buffer

Fetch conversation history for a specific mode.

**Query Parameters:**
- `mode` (required): `conversation` or `inner`

**Response:**
```json
{
  "mode": "conversation",
  "messages": [...],
  "lastUpdated": "2025-11-16T00:00:00.000Z",
  "messageLimit": 50
}
```

### POST /api/conversation-buffer

Append a new message to the buffer.

**Request Body:**
```json
{
  "mode": "conversation",
  "message": {
    "role": "user",
    "content": "Hello!",
    "timestamp": 1731715200000,
    "meta": {}
  }
}
```

**Response:**
```json
{
  "success": true,
  "messageCount": 42
}
```

### DELETE /api/conversation-buffer

Clear all messages for a specific mode.

**Query Parameters:**
- `mode` (required): `conversation` or `inner`

**Response:**
```json
{
  "success": true,
  "mode": "conversation"
}
```

## Client Integration

### Loading Messages on Mount

```typescript
onMount(async () => {
  const serverMessages = await loadMessagesFromServer();
  if (serverMessages && serverMessages.length > 0) {
    messages = serverMessages;
  }
});
```

### Saving Messages

The server now owns persistence for user/assistant turns. `pushMessage()` only updates the local UI while `/api/persona_chat` writes the canonical buffer once the request is accepted:

```typescript
function pushMessage(role, content, relPath, meta) {
  const newMessage = { role, content, timestamp: Date.now(), relPath, meta };
  messages = [...messages, newMessage];
}
```

> Tip: When troubleshooting missing history, inspect the server logs for `[persona_chat]` persistence messages instead of looking for client-side POSTs.

### Clearing History

The "Clear" button now clears **both** client and server state:

```typescript
async function clearChat() {
  messages = [];

  // Clear audit logs
  await fetch('/api/audit/clear', { method: 'DELETE' });

  // Clear server-side conversation buffer
  await clearServerBuffer();
}
```

## Rolling Window Behavior

The server automatically prunes old messages when the buffer exceeds the configured limit:

- **Default limit**: 50 messages
- **Min limit**: 10 messages
- **Max limit**: 100 messages

When a new message is added that would exceed the limit:
1. Calculate excess: `excess = messageCount - messageLimit`
2. Remove oldest messages: `messages = messages.slice(excess)`
3. Log prune event to audit trail

## Mode Isolation

The two modes are **completely isolated**:

- **Conversation mode**: Regular chat with the assistant
- **Inner dialogue mode**: Self-reflections and internal thoughts

Each mode has its own:
- Separate buffer file
- Independent message history
- Isolated message limit
- No cross-contamination

## Migration from Old System

The old system used:
- `localStorage` for client-side persistence
- `persona_chat.ts` in-memory `histories` object
- Mixed "summary markers" and messages in one file

The new system:
- Server-side buffer files as single source of truth
- No localStorage dependency (only for session ID)
- Clean separation of modes
- Proper rolling window with auto-pruning

### Cleanup Steps

1. **Backup old buffer files**:
   ```bash
   cd profiles/{username}/state
   cp conversation-buffer-conversation.json conversation-buffer-conversation.json.backup-$(date +%Y%m%d)
   ```

2. **Reset to clean state**:
   ```bash
   echo '{"mode":"conversation","messages":[],"lastUpdated":"2025-11-16T00:00:00.000Z","messageLimit":50}' > conversation-buffer-conversation.json
   echo '{"mode":"inner","messages":[],"lastUpdated":"2025-11-16T00:00:00.000Z","messageLimit":50}' > conversation-buffer-inner.json
   ```

3. **Clear browser localStorage** (optional):
   - Open browser DevTools
   - Application → Local Storage
   - Clear `chatSession:*` keys

## Troubleshooting

### Messages not loading on page refresh

Check:
1. Server buffer file exists: `profiles/{username}/state/conversation-buffer-{mode}.json`
2. API endpoint is accessible: `curl http://localhost:4321/api/conversation-buffer?mode=conversation`
3. Browser console for errors

### Messages not persisting after refresh

Check:
1. `/api/persona_chat` completes without errors (Network tab → responses)
2. No 401/403 errors (authentication required)
3. Buffer file under `profiles/{username}/state/` is writable by the server process

### Clear button not working

Check:
1. Both client and server clear functions are called
2. Server DELETE endpoint returns success
3. Buffer file is actually deleted/reset

### Mode contamination (inner messages in conversation mode)

This should be impossible with the new system. If it occurs:
1. Check which buffer file has the wrong messages
2. Verify API calls include correct `mode` parameter
3. Check for any direct file writes bypassing the API

## Future Enhancements

- **Per-user message limits**: Store in `chat-config.json`
- **Message search**: Full-text search across buffer
- **Export/import**: Download/upload conversation history
- **Archival**: Move old conversations to archive directory
- **Compression**: GZIP old buffer files to save space
