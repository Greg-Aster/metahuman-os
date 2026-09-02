# Overview

MetaHuman OS is a local-first application for persistent AI conversation,
profile-scoped memory, persona configuration, tasks, cognitive workflows,
background agents, voice, model routing, training, and optional external
environment control.

It is not one continuously running autonomous mind and it is not limited to one
LLM provider. Features run only when their owner is configured, admitted, and
available. Local data can be sent to a configured remote model, sync server,
cloud training provider, tunnel, or environment adapter when you enable that
path.

## What you can do

- Talk through the Chat interface using an editable cognitive graph.
- Keep conversation, inner-dialogue, system, and robot activity in separate
  buffers.
- Capture, browse, edit, search, ingest, organize, and semantically index
  profile-scoped memories.
- Create projects and tasks and inspect their lifecycle.
- Edit a persona directly or build one through the guided Persona Generator.
- Review and control desires, plans, approvals, and outcome reviews through
  Agency.
- Configure Ollama, vLLM, the local-model service, or a supported remote model
  path.
- Use speech-to-text, text-to-speech, voice conversion, and voice-training
  workflows when their providers are installed.
- Inspect queued work, finite agents, persistent services, triggers, approvals,
  sleep stages, and Active Operator mode.
- Edit cognitive graphs and inspect execution traces.
- Connect one configured Environment Bridge to a game, simulator, robot, or
  another adapter.

## Main application areas

The left sidebar is the primary navigation:

- **Chat** contains conversation and buffer views.
- **Dashboard** contains Overview, Tasks, Approvals, Active Operator, Sleep,
  Agent Catalog, and Trigger Manager.
- **Projects** contains the project and task workspace.
- **Agency** contains desires, planning, execution, and outcome review.
- **Persona** contains the Persona Editor, memory views, and Persona Generator.
- **Voice** contains voice-clone training and voice settings.
- **AI Training** contains the training wizard, history, and monitor.
- **System** contains chat settings, general settings, backend controls,
  security, storage, network, addons, Agent Catalog, and Trigger Manager.

The right sidebar contains the shared work Queue, owner-visible Agent Monitor,
and Server Status. It does not create separate execution or service owners.

## Accounts and data boundaries

Every request runs in an authenticated profile context.

- The first registered account becomes the installation owner.
- Standard accounts can work within their own profile.
- A guest session is authenticated, temporary, and read-only.
- Profile paths are resolved by the storage owner and may use the default
  profile directory or configured encrypted/custom storage.
- Memories, persona data, tasks, buffers, credentials, logs, model artifacts,
  and generated output are installation data, not application source.

Do not edit profile paths by hand or copy one user's files into another profile.
Use the web controls, CLI, or profile-sync workflow described in this guide.

## Models and optional services

Conversation and agent features require an available configured LLM backend.
MetaHuman supports multiple backend families; Ollama is not mandatory.

Other features have separate dependencies:

- Semantic search requires the maintained embedding service and a compatible
  per-profile index.
- Site speech recognition requires the managed Whisper service. The maintained
  React Native shell may instead use device-native speech recognition when the
  platform provides it.
- Speech playback requires a configured TTS provider and an active delivery
  consumer.
- Voice cloning and AI training require their own tools, models, storage, and
  often substantial GPU resources.
- Remote access requires an explicitly configured exposure mode, allowed hosts,
  origins, and authentication.
- Environment actions require an authenticated external adapter and truthful
  capability advertisement.

A green source or build check does not establish that these runtime dependencies
are healthy.

## Cognitive and autonomy modes

Conversation mode and autonomy mode are separate controls.

Cognitive modes select the graph used for a turn:

- **Dual** supports the full conversation and memory-oriented workflow.
- **Agent** favors direct task-oriented assistance.
- **Emulation** uses the configured persona without writing new long-term
  memory.
- **Environment** adds observation and bounded semantic-action handling.

Active Operator modes control automatic work admission:

- **Reactive** responds to user, system, approval, and environment events.
- **Semi** also permits configured scheduled and idle work.
- **Full** adds bounded policy proposals without bypassing the shared queue.

See [Cognitive Modes](/user-guide#cognitive-modes) and
[Autonomous Work](/user-guide#autonomous-agents) before enabling
broader automation.

## Recommended first journey

1. Install and start the server.
2. Create the owner account and save the recovery codes.
3. Complete or deliberately skip onboarding.
4. Confirm one LLM backend and its selected models are available.
5. Send a chat turn and inspect its visible result.
6. Capture one explicit memory and verify it under Persona → Memory.
7. Create one task under **Dashboard → Tasks** and, if useful, create a project
   under **Projects**.
8. Inspect the Queue and Server Status before enabling scheduled work.
9. Configure optional voice, training, remote access, or environment features
   only when needed.

Continue to [Installation](/user-guide#02-installation).
