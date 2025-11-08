# Conversation Thinking Indicator Plan

## Goal
- Surface the operator/LLM telemetry that already streams through the audit feed directly inside the chat transcript while the assistant is formulating a reply.

## Scope
- ChatInterface UI state and rendering.
- Thinking component reuse (no new UI widget).
- `/api/stream` audit feed (read-only) filtered by the current `conversationSessionId`.

## Implementation Outline
1. When a message is sent, ensure the chat subscribes to `/api/stream` (if not already) and flip the `thinkingActive` flag.
2. Filter incoming audit events so only items whose `details.sessionId`/`conversationId` match the current session show up in the trace.
3. Format each event into a human-readable line (timestamp + event label + actor/category) plus concise detail fields (`goal`, `action`, `skill`, `model`, `latencyMs`, etc.), truncating long payloads.
4. Feed the formatted lines into `<Thinking>` while `loading` is true and no explicit reasoning stream is rendering; clear everything once a `reasoning` packet, final answer, or error arrives.

## Testing / Validation
1. Conversation mode, reasoning OFF:
   - Send a prompt that triggers filesystem/tool usage (e.g., "Summarize docs/README.md").
   - Observe the thinking block populate with entries such as `Planning Started goal: …` or `React Executing Skill skill: fs_read` showing only the relevant key/value pairs.
   - Confirm entries disappear once the assistant reply renders.
2. Conversation mode, reasoning ON:
   - Send another prompt.
   - Verify the audit-backed thinking entries appear first; once the dedicated reasoning stream begins, the placeholder stops and the standard reasoning cards take over.
3. Error/interrupt path:
   - Force `/api/persona_chat` to fail (e.g., stop the backend) and send a prompt.
   - Confirm any in-flight trace entries clear immediately when the error bubble shows so no stale activity lingers.
