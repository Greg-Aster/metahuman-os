## User Interface

### Startup Splash Screen

When you first launch the MetaHuman OS web interface, you will be greeted by a professional splash screen. This screen is designed to provide immediate feedback and improve the perceived loading time of the application.

**Features:**
- **Instant Feedback**: An animated logo and loading indicator appear instantly, so you know the system is working.
- **Progressive Loading**: A list of boot steps (e.g., "Initializing," "Loading persona," "Connecting to models") updates in real-time with status indicators.
- **Persona Display**: Once loaded, the screen displays your persona's name, role, and purpose.
- **Quick Links**: Provides convenient buttons to access the User Guide and the project's GitHub repository.
- **System Info**: The active model and system version are displayed at the bottom.

The splash screen smoothly fades out once all initialization steps are complete, transitioning you to the main chat interface.

### Web UI (Recommended)
Modern ChatGPT-style interface with real-time updates:
```bash
cd apps/site && pnpm dev
# Open http://localhost:4321
```

Upon starting the UI, you will now be directed to a **Login page**. For local development, you can typically proceed without credentials.

The UI header contains several key interactive elements:

- **Cognitive Mode Selector**: A dropdown menu to switch between `Dual Consciousness`, `Agent`, and `Emulation` modes. This menu is now dynamic; modes may be disabled (grayed out with a lock icon) based on the current system state (e.g., "High Security" or "Wetware Deceased"). Hovering over a disabled mode will show a tooltip explaining why it's unavailable.
- **User Menu**: A new dropdown menu that provides options for user-related actions like "Logout".
- **Developer Tools**: The right-sidebar toggle for live audit streams and agent monitoring.

#### System Status Banners
The UI will display prominent banners at the top of the screen to inform you of critical system-wide states:
- **High Security Mode**: A red banner appears when the system is locked into read-only emulation mode.
- **Wetware Deceased**: An indigo banner appears when the system is running as an independent digital consciousness, indicating that Dual Consciousness mode is unavailable.
- **Read-Only Mode**: A general banner indicating that the current cognitive mode (Emulation) does not allow for write operations.

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

