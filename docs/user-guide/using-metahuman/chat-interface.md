# Chat

Chat is the main conversational surface in MetaHuman OS. It combines profile-scoped conversation, optional inner and system feeds, voice input, queued work, and explicit operator controls without treating those different channels as one history.

## Open Chat

Start MetaHuman OS, sign in, and select **Chat** in the left sidebar. If the page reports that no model backend is available, check the configured backend before troubleshooting the conversation itself:

```bash
./bin/mh status
./bin/mh backend status
```

## Choose What You Read

The buttons above the message list are independent filters. More than one can be enabled at once.

- **Conversation** shows user and assistant messages from the conversation buffer.
- **Inner Dialogue** shows persisted private thoughts, reflections, dreams, and related inner records.
- **System** merges chronological System and Robot buffer records.
- **Terminal** opens the terminal control surface. It is not another message buffer.

Changing these filters does not change where a new message will be written. Use the compose-target buttons beside the input to choose **Conversation** or **Unvoiced thought**.

## Send a Message

1. Select the intended compose target.
2. Enter a message.
3. Press **Send**.

If another chat request is already running, the new request may enter the shared queue instead of starting immediately. The **Queue** tab in the right sidebar shows admitted work and its state.

Select an existing message before sending to include it as focused reply context. Ordinary replies stay in the active conversation workflow. Curiosity questions and Agency cards that can change Desire state use the dedicated response pipeline; passive Agency notices do not. In Environment mode, ordinary selected-message replies therefore remain in the Environment workflow so the same LLM decision can respond or select an environment action. Clear the selection when it is no longer relevant.

## Stop and Clear

- **Stop** cancels the current chat request.
- Interrupting speech stops browser TTS playback; it does not by itself cancel model work.
- **Clear** clears only the explicit compose target's server buffer. The visible read-filter combination never decides what is deleted.

Clearing Conversation therefore does not clear Inner Dialogue, System, audit logs, memories, or unrelated runtime data.

## Thinking, Big Brother, and Active Operator

These controls change execution behavior and should be used deliberately:

- **Thinking mode** changes the chat reasoning behavior exposed by the current model path.
- **Big Brother** can escalate selected work to its configured terminal provider. A normal click enables escalation mode; right-click enables full delegation. The provider must be configured and available.
- **Active Operator** cycles through its supported operating modes. Higher-autonomy modes can admit bounded work from configured triggers and policy.

A UI status message proves that a request was submitted or progressed only as far as the displayed state. For terminal work, inspect the Terminal view and final work result before treating it as complete.

## Use the Microphone

- Tap the microphone for one recording. The transcript is placed in the input so you can review it before sending.
- Long-press or right-click the microphone to toggle conversation listening mode. In that mode completed transcripts can be sent automatically.
- Tap while speech is playing to interrupt playback and return to listening.

On the Site, the voice path is browser microphone → managed Whisper
transcription → normal chat request → TTS queue → browser playback. The
maintained React Native shell may use device-native speech recognition instead.
Check each stage separately when diagnosing a failure. See
[Voice Features](/user-guide#voice-features).

## Speech Output

The speaker control enables or disables conversational speech. Generated audio is delivered through the TTS queue and played by the authenticated browser consumer. A healthy synthesis provider or completed audio file does not prove that the browser played it audibly; browser permission, the active output device, and the queue consumer also matter.

## Privacy and Persistence

Conversation, inner-dialogue, system, and robot histories are server-owned, profile-resolved buffers. They are not interchangeable with durable episodic memory. Use explicit memory capture when something must be retained as a memory rather than relying on the current chat view.

Guest sessions are authenticated, read-only sessions with limited profile access. Private profiles are not available to guests.

## Related Guides

- [Memory](/user-guide#memory-system)
- [Dashboard and Monitoring](/user-guide#dashboard-monitoring)
- [Tasks and Projects](/user-guide#task-management)
- [Voice Features](/user-guide#voice-features)
- [Cognitive Modes](/user-guide#cognitive-modes)
