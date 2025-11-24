# ChatInterface Store Usage Fixes

## Problem
After refactoring to use composables, `messages`, `selectedMessage`, `selectedMessageIndex`, and `conversationSessionId` are now **Svelte stores** (writable objects), but the code is treating them as regular variables.

## Key Rules for Svelte Stores

1. **In template (HTML)**: Use `$` prefix to auto-subscribe: `$messages`, `$selectedMessage`
2. **In script (reading)**: Use `get()` function: `get(messages)` or `$messages` in reactive statements
3. **In script (writing)**: Use `.set()` or `.update()` methods
4. **DON'T** try to reassign stores directly: `messages = [...]` ❌

## Required Changes

### 1. Template - Add `$` prefix

Search for these in the template section and add `$` prefix:
- `messages.length` → `$messages.length`
- `{#each messages as` → `{#each $messages as`
- `selectedMessage` → `$selectedMessage`
- `selectedMessageIndex` → `$selectedMessageIndex`

### 2. Script - Use store methods

**Reading:**
```javascript
// WRONG:
const isDuplicate = messages.some(msg => ...)

// RIGHT:
const isDuplicate = get(messages).some(msg => ...)
```

**Writing:**
```javascript
// WRONG:
messages = [...messages, newMessage];
conversationSessionId = 'new-id';

// RIGHT:
messages.update(msgs => [...msgs, newMessage]);
conversationSessionId.set('new-id');
```

### 3. Use composable methods instead of direct manipulation

Replace these functions (they're already in useMessages):
- `pushMessage()` → `messagesApi.pushMessage()`
- `loadMessagesFromServer()` → Already in composable, use `messagesApi.loadMessagesFromServer()`
- `clearServerBuffer()` → `messagesApi.clearServerBuffer()`
- `loadHistoryForMode()` → `messagesApi.loadHistoryForMode()`
- `formatTime()` → `messagesApi.formatTime()`
- `formatReasoningLabel()` → `messagesApi.formatReasoningLabel()`
- Delete handling → `messagesApi.deleteMessage()`
- Selection → `messagesApi.selectMessage()`, `messagesApi.clearSelection()`, `messagesApi.getReplyToMetadata()`

### 4. Quick Find & Replace

Run these find/replace operations (in order):

1. Find: `{#if messages.length`
   Replace: `{#if $messages.length`

2. Find: `{#each messages as`
   Replace: `{#each $messages as`

3. Find: `messages = [`
   Replace: `messages.update(msgs => [`
   (Then manually add `)` at the end of the array)

4. Find: `conversationSessionId =`
   Replace: `conversationSessionId.set(`
   (Then manually add `)` and adjust syntax)

5. Find: `messages.some(`
   Replace: `get(messages).some(`

6. Find: `pushMessage('`
   Replace: `messagesApi.pushMessage('`

7. Find: `formatTime(`
   Replace: `messagesApi.formatTime(`

8. Find: `formatReasoningLabel(`
   Replace: `messagesApi.formatReasoningLabel(`

9. Find: `selectedMessage?.`
   Replace: `$selectedMessage?.`

10. Find: `selectedMessageIndex ===`
    Replace: `$selectedMessageIndex ===`

## Test After Fixing

After making these changes, test:
1. Type in the input box - send button should enable
2. Send a message - should work normally
3. Clear chat - should clear messages
4. Switch modes - should load history
