## User Interface

### Web UI (Recommended)
Modern ChatGPT-style interface with real-time updates:
```bash
cd apps/site && pnpm dev
# Open http://localhost:4321
```

**Note:** The header bar will be updated to display the currently active cognitive mode (e.g., `MetaHuman OS - Dual Consciousness`).

**Features:**
- 💬 Chat - Conversation with your digital personality extension
- 📊 Dashboard - System status and overview
- ✓ Tasks - Task management
- ✋ Approvals - Skill execution queue
- 🧩 Memory - Browse episodic events with specialized tabs:
  - **Episodic** - All captured observations and events
  - **Reflections** - AI-generated reflections from the reflector agent
  - **Tasks** - Task files from memory/tasks/
  - **Curated** - Hand-picked memories from memory/curated/
  - **AI Ingestor** - Memories created by the ingestor agent from inbox files
  - **Audio** - Memories from transcribed audio recordings
  - **Dreams** - Dream narratives from the dreamer agent
- 🌙 Learnings - Overnight insights and preferences
- 🎙️ Audio - Upload and transcribe audio recordings
- 🎤 Voice Training - Voice cloning progress
- 🧠 Adaptation - LoRA dataset management
- 🔥 Training - Real-time LoRA training monitor
- 🎭 Persona - Identity and personality settings
- 🆘 Lifeline Protocol - Emergency scaffold
- ⌨️ Terminal - Embedded CLI interface

**Developer Tools (Right Sidebar):**
- Live audit stream
- Agent monitor with statistics
- Boredom control (reflection frequency)
- Model selector (switch Ollama models)

**Code Approval UI:**
A special UI component for the **Self-Healing Coder Agent** appears directly above the chat input box when a code change is ready for your review.

- **Collapsible Box**: Expands automatically when a new code approval is pending.
- **Diff Viewer**: Shows the exact changes (additions and deletions) with syntax highlighting.
- **Explanation**: Displays the Coder Agent's explanation for why the change is needed.
- **Approve/Reject**: Buttons to apply the patch to your local files or discard it.
- **Test Commands**: Shows any commands the agent recommends running to verify the change.

### Three Ways to Interact
1. **Web UI (Recommended)** - Interactive interface with real-time updates
2. **CLI (`mh` command)** - Command-line interface for quick operations
3. **Direct File Access** - All data is stored as human-readable JSON files for direct manipulation

---

