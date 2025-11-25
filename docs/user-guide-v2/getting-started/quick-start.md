# Quick Start Guide

Your first 5 minutes with MetaHuman OS.

---

## 1. Start the System (1 minute)

```bash
# Start web UI with agents
cd apps/site && pnpm dev
```

Open http://localhost:4321 and log in.

---

## 2. Capture Your First Memory (1 minute)

**Via Web UI:**
1. Click **Chat** in left sidebar
2. Type a message: "This is my first interaction with MetaHuman"
3. The system responds and saves the conversation

**Via CLI:**
```bash
./bin/mh capture "Met with Sarah about the ML project this morning"
```

---

## 3. Browse Your Memories (1 minute)

**Web UI:**
1. Click **Memory Browser** in left sidebar
2. Browse by tab:
   - **Conversations**: Chat history
   - **Observations**: Manual captures
   - **All Memories**: Complete timeline

**CLI:**
```bash
./bin/mh remember "Sarah"
```

---

## 4. Create a Task (1 minute)

```bash
./bin/mh task add "Review LoRA training documentation"
./bin/mh task
```

Or use the **Tasks** tab in the web UI.

---

## 5. Explore Autonomous Agents (1 minute)

Watch the **Agent Monitor** (right sidebar):
- **Organizer**: Enriches memories with tags/entities
- **Reflector**: Generates internal thoughts
- **Curator**: Prepares training data

```bash
# View agent status
./bin/mh agent status
```

---

## What Just Happened?

1. **Memory Captured**: Your observations and conversations are stored as structured JSON
2. **Automatic Enrichment**: The organizer agent extracts tags and entities
3. **Reflection**: The system generates internal thoughts about your activities
4. **Training Data**: Curator prepares conversations for LoRA adapter training

---

## Next Steps

### Learn the Interface
→ [Chat Interface](../using-metahuman/chat-interface.md) - Conversation modes and features

### Personalize Your System
→ [Persona Generator](../training-personalization/persona-generator.md) - Create your personality profile

### Train Your Voice
→ [Voice Training](../training-personalization/voice-training.md) - Clone your voice

### Deep Dive
→ [Core Concepts](core-concepts.md) - Understand how it all works
