# Getting Started with MetaHuman OS

Welcome to MetaHuman OS! This tutorial will guide you through your first steps with the system, from initial setup to your first conversations and voice training.

## Prerequisites

Before starting, ensure you have:
- **Node.js 18+** and **pnpm** installed
- **Ollama** installed and running ([ollama.ai](https://ollama.ai))
- At least one LLM model installed in Ollama (e.g., `ollama pull phi3:mini`)
- Basic familiarity with the command line

## Part 1: Initial Setup (5 minutes)

### Step 1: Clone and Install

```bash
# Clone the repository
cd ~/
git clone https://github.com/yourusername/metahuman
cd metahuman

# Install dependencies
pnpm install
```

### Step 2: Initialize the System

```bash
# Create directory structure and default configs
./bin/mh init

# Verify installation
./bin/mh status
```

You should see output showing:
- System status
- Ollama connection
- Available models
- Directory structure created

### Step 3: Check Ollama Connection

```bash
# Verify Ollama is running
./bin/mh ollama status

# List installed models
./bin/mh ollama list

# If no models are installed, get a small one:
./bin/mh ollama pull phi3:mini
```

**Troubleshooting:**
- If Ollama isn't running: `ollama serve` in a separate terminal
- If no models found: Install at least one model before continuing

---

## Part 2: Your First Conversation (10 minutes)

### Step 4: Start Background Services

MetaHuman OS includes autonomous agents that run in the background:

```bash
# Start the scheduler and organizer agent
./bin/mh start
```

This starts:
- **Scheduler service** - Manages autonomous agents
- **Organizer agent** - Enriches memories with tags and entities

### Step 5: Have Your First Chat

```bash
# Start interactive chat
./bin/mh chat
```

Try a simple conversation:
```
You: Hi! Tell me about yourself.
Greg: [Response will be based on your persona/core.json file]

You: What can you help me with?
Greg: [Explains capabilities]

You: exit
```

**What just happened?**
- Your messages were saved as episodic memories
- The organizer agent will process them in the background
- Memories are grounded in your personality from `persona/core.json`

---

## Part 3: Capturing Memories (10 minutes)

### Step 6: Record Observations

MetaHuman OS builds a memory of your life. Capture events:

```bash
# Capture a quick observation
./bin/mh capture "Had a great meeting with Sarah about the ML project"

# Capture more details
./bin/mh capture "Planning to start the new fitness routine next Monday. Goal is 3x per week."

# View recent captures
./bin/mh remember "Sarah"
```

**Memory Types:**
- **Episodic** - Events and observations (what you just created)
- **Tasks** - To-dos and projects
- **Semantic** - Facts and knowledge (coming soon)

### Step 7: Create and Manage Tasks

```bash
# List current tasks
./bin/mh task

# Create a new task
./bin/mh task add "Review ML project documentation"

# Start working on a task
./bin/mh task start <task-id>

# Complete a task
./bin/mh task done <task-id>
```

### Step 8: Search Your Memory

```bash
# Keyword search
./bin/mh remember "project"

# If you built the semantic index (optional):
./bin/mh index build
./bin/mh index query "what did I discuss with Sarah?"
```

---

## Part 4: Web Interface (5 minutes)

### Step 9: Launch the Web UI

```bash
cd apps/site
pnpm dev
```

Open your browser to: **http://localhost:4321**

The web UI features:
- **ChatGPT-style interface** - 3-column layout
- **Left Sidebar** - Feature navigation (Chat, Dashboard, Memory Browser, etc.)
- **Center Panel** - Main content area
- **Right Sidebar** - Developer tools (Audit Stream, Agent Monitor, Settings)

### Step 10: Explore the Interface

Try these features:
1. **Chat** - Have a conversation (same as CLI but with UI)
2. **Dashboard** - View system status and recent activity
3. **Memory Browser** - Browse your episodic memories with 7 specialized tabs:
   - Conversations
   - Observations
   - Inner Dialogue (reflections)
   - Dreams
   - Tasks
   - All Memories
   - Search
4. **Tasks** - Visual task manager
5. **Settings** - Configure cognitive modes, boredom control, etc.

---

## Part 5: Understanding Cognitive Modes (5 minutes)

MetaHuman OS operates in three modes:

### Dual Consciousness Mode (Default)
- Routes through operator pipeline (planner → skills → narrator)
- Memory grounding for every response
- Proactive agents enabled
- **Use for**: Full system capabilities

### Agent Mode
- Smart routing (simple queries use chat, action requests use operator)
- Proactive agents disabled
- **Use for**: Lightweight assistant mode

### Emulation Mode
- Chat only, no operator
- Read-only in web UI
- **Use for**: Demonstration, stable personality snapshot

**Switch modes** in the web UI header or via API.

---

## Part 6: Voice Training (Optional, 30 minutes)

### Step 11: Record Voice Samples

In the web UI:
1. Navigate to **Voice Training** widget
2. Click **"Start Recording"**
3. Read the provided prompts (aim for 10-15 minutes of clean audio)
4. Review and approve samples

### Step 12: Choose a Voice Provider

MetaHuman supports multiple TTS providers:

**Piper** (Easiest, no training)
- Pre-trained voices
- Low resource usage
- Good for testing

**GPT-SoVITS** (Advanced, requires training)
```bash
# Install GPT-SoVITS
./bin/mh sovits install

# Start server
./bin/mh sovits start

# Test it
./bin/mh sovits test "Hello world"
```

**RVC** (Voice conversion)
```bash
# Install RVC
./bin/mh rvc install

# Train voice model
./bin/mh rvc train --name yourname

# Test conversion
./bin/mh rvc test --model yourname --input sample.wav
```

**Kokoro** (StyleTTS2, custom voicepacks)
```bash
# Install Kokoro
./bin/mh kokoro install

# List built-in voices
./bin/mh kokoro voices

# Start server
./bin/mh kokoro serve start

# Test synthesis
./bin/mh kokoro test --text "Hello world" --voice af_heart
```

See [Voice System Guide](../23-voice-system.md) for comprehensive voice training documentation.

---

## Part 7: Understanding Autonomous Agents (5 minutes)

### Step 13: Monitor Agent Activity

```bash
# List available agents
./bin/mh agent list

# Check agent status
./bin/mh agent status

# View processing status
./bin/mh agent monitor

# List running agents
./bin/mh agent ps
```

**Key Agents:**
- **Organizer** - Enriches memories with LLM-extracted tags
- **Reflector** - Generates internal reflections from memory chains
- **Boredom Maintenance** - Triggers reflections during inactivity
- **Curiosity** - Asks user-facing questions
- **Inner Curiosity** - Self-directed internal questions
- **Dreamer** - Creates surreal dreams from memory fragments
- **Sleep Service** - Manages dream generation during sleep hours
- **Ingestor** - Converts inbox files into memories

### Step 14: Configure Agent Behavior

In the web UI, go to **Settings → Boredom Control**:
- **High** - Reflects after ~1 minute of inactivity
- **Medium** - Reflects after ~5 minutes
- **Low** - Reflects after ~15 minutes
- **Off** - No automatic reflections

---

## Part 8: Persona Customization (10 minutes)

### Step 15: Review Your Base Persona

```bash
# Check current persona
./bin/mh persona status

# View the file directly
cat persona/core.json
```

The persona file includes:
- Identity (name, role, values)
- Personality traits
- Communication style
- Goals and priorities

### Step 16: Use the Persona Generator (Optional)

MetaHuman includes a therapist-style interview system:

```bash
# Start interactive interview
./bin/mh persona generate

# Answer questions across 8 categories:
# - Core Identity
# - Values & Ethics
# - Communication Style
# - Relationships
# - Goals & Aspirations
# - Daily Life & Habits
# - Knowledge & Interests
# - Emotional Patterns

# Resume later if needed
./bin/mh persona generate --resume

# View all sessions
./bin/mh persona sessions

# Apply changes from a session
./bin/mh persona apply <session-id>
```

See [Persona Generation Guide](../25-persona-generation.md) for details.

---

## Part 9: LoRA Adapter Training (Advanced, 1-2 hours)

LoRA adapters provide Tier-2 personalization (deep learning on your conversation style).

### Step 17: Review and Approve Training Data

```bash
# List adapter datasets
./bin/mh adapter list

# Review a dataset
./bin/mh adapter review <date>

# Approve for training
./bin/mh adapter approve <date>
```

### Step 18: Train and Activate Adapter

```bash
# Train adapter (requires GPU, takes 30-60 minutes)
./bin/mh adapter train <date>

# Evaluate quality
./bin/mh adapter eval <date>

# Activate for use
./bin/mh adapter activate <date>
```

The dual-adapter system preserves long-term memory:
- **Historical adapter** - Consolidated lifetime memories
- **Recent adapter** - Last 14 days of training

See [LoRA Training Documentation](../11-special-features.md#lora-adapter-training) for details.

---

## Part 10: Next Steps

### Recommended Learning Path

**Week 1:** Basics
- Use daily chat to build conversational memories
- Experiment with task management
- Try different cognitive modes
- Configure voice synthesis

**Week 2:** Advanced Features
- Train a voice model
- Use the persona generator
- Explore the node editor (visual workflows)
- Set up semantic indexing

**Week 3:** Deep Personalization
- Collect enough memories for LoRA training
- Review and approve training datasets
- Train your first adapter
- Enable dual-adapter mode

### Helpful Resources

- **CLI Reference** - [docs/user-guide/06-cli-reference.md](../06-cli-reference.md)
- **Voice System** - [docs/user-guide/23-voice-system.md](../23-voice-system.md)
- **Autonomous Agents** - [docs/user-guide/08-autonomous-agents.md](../08-autonomous-agents.md)
- **Cognitive Architecture** - [docs/user-guide/27-cognitive-architecture.md](../27-cognitive-architecture.md)
- **Troubleshooting** - [docs/user-guide/12-troubleshooting.md](../12-troubleshooting.md)

### Common Workflows

See the [Common Workflows Guide](./05-common-workflows.md) for task-oriented tutorials:
- End-to-end voice training
- Memory management best practices
- LoRA training pipeline
- Multi-user setup

---

## Troubleshooting

### Ollama Not Connecting
```bash
# Check if Ollama is running
./bin/mh ollama status

# Start Ollama (if not running)
ollama serve

# Diagnose issues
./bin/mh ollama doctor
```

### Agents Not Running
```bash
# Check agent status
./bin/mh agent ps

# Restart services
./bin/mh start --restart

# Force restart
./bin/mh start --force
```

### Memory Not Being Saved
- Check cognitive mode (emulation mode is read-only)
- Verify you're authenticated (not anonymous in web UI)
- Check audit logs: `tail -f logs/audit/$(date +%Y-%m-%d).ndjson`

### Web UI Not Loading
```bash
# Make sure you're in the right directory
cd apps/site

# Clear cache and restart
rm -rf .astro
pnpm dev
```

---

## Summary

Congratulations! You've completed the MetaHuman OS getting started tutorial. You now know how to:

✅ Set up and initialize the system
✅ Have conversations and capture memories
✅ Manage tasks and projects
✅ Use the web interface
✅ Understand cognitive modes
✅ Record voice samples and choose TTS providers
✅ Monitor autonomous agents
✅ Customize your persona
✅ Train LoRA adapters (advanced)

**Continue exploring** with the [Common Workflows Guide](./05-common-workflows.md) for task-specific tutorials.

Welcome to your digital extension! 🚀
