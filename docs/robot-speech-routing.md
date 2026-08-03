# Robot Speech Routing

## Required behavior

- The existing standard `tts-out` node is the only speech admission point.
- MetaHuman's existing configured Kokoro stream synthesizes each utterance once.
- Voice Settings selects exactly one renderer: `local` or `robot`.
- The chat header speaker button remains the independent speech enable/disable control.
- `local` keeps the existing browser playback path unchanged.
- `robot` is accepted only for speech admitted by the Environment Mode `tts-out` node.
- Robot audio travels through the existing Environment action queue and Environment Bridge.
- Ainekio converts no text and runs no Kokoro client. It only receives bounded 16 kHz mono PCM, paces it through the existing gateway speaker path, and reports the terminal result.
- There is no robot TTS node, second TTS request, second synthesis provider, parallel speech queue, or persisted `both` mode.

## Ownership

- Admission: `packages/core/src/nodes/output/tts.node.ts`
- Synthesis and renderer selection: `packages/core/src/api/handlers/tts-stream.ts`
- Destination setting: Voice Settings
- Robot action admission: existing Environment action queue
- Robot transport: `brain/agents/environment-bridge`
- Robot playback: Ainekio gateway and body speaker path
- Enable/disable: existing ChatInterface header speaker button

## Progress

- [x] Rolled back the earlier duplicate/unfinished speech implementation.
- [x] Confirmed the standard `tts-out`, current Kokoro stream, Environment Bridge, and Ainekio speaker path are the maintained owners.
- [ ] Add the `local` / `robot` destination setting without changing the header button.
- [ ] Fan the existing Kokoro result to the selected renderer.
- [ ] Send robot PCM through the existing Environment action stream and Environment Bridge.
- [ ] Play and pace the PCM through Ainekio's existing speaker path.
- [ ] Remove the unused direct Ainekio Kokoro client.
- [ ] Pass ownership, architecture, focused integration, and no-duplicate checks.
