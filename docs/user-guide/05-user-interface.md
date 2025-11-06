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

### Authentication Gate & Profile Selection

When the UI is ready the splash screen fades into the **Authentication Gate**. Owners and guests share the same entry point:

1. **Create Account** – Registers a new user directly from the browser. The first account created becomes the `owner` and receives full access.
2. **Login** – Existing owners or guests authenticate and regain access to their isolated profile.
3. **Continue as Guest** – Starts a 30‑minute anonymous session. Guests are prompted to choose from the list of **public profiles** before entering the dashboard. Private profiles are hidden, so owners can safely share the instance.

The active profile (owner or guest) is displayed in the header once authenticated. Switching users logs the current session out and returns to the gate.

### Web UI (Recommended)
Modern ChatGPT-style interface with real-time updates:
```bash
cd apps/site && pnpm dev
# Open http://localhost:4321
```

#### Header Controls
- **Profile Indicator** – Shows the active account (role, visibility badge). Owners can open the menu to log out or jump into Settings.
- **Cognitive Mode Selector** – Switch between `Dual Consciousness`, `Agent`, and `Emulation`. Locked modes display tooltips explaining why they are unavailable under the current security posture.
- **Developer Tools Toggle** – Opens the right sidebar (audit stream, agent monitor, boredom service, model selector).

#### System Status Banners
The UI will display prominent banners at the top of the screen to inform you of critical system-wide states:
- **High Security Mode**: A red banner appears when the system is locked into read-only emulation mode.
- **Wetware Deceased**: An indigo banner appears when the system is running as an independent digital consciousness, indicating that Dual Consciousness mode is unavailable.
- **Read-Only Mode**: A general banner indicating that the current cognitive mode (Emulation) does not allow for write operations.

**Features:**
- 💬 Chat - Conversation with your digital personality extension.
- 📊 Dashboard - System status and overview.
- ✓ Tasks - Task management.
- ✋ Approvals - Skill execution queue.
- 🧩 Memory - Browse events & insights with inline expansion and modal editor.
- 🎤 Voice - Audio upload, transcription, cloning, and per-user training data.
- 🧠 AI Training - LoRA adapters and training management.
- 💻 Terminal - Embedded command line.
- ⚙️ System - System settings and tools.
- 🌐 Network - Cloudflare tunnel and connectivity settings.
- 🔒 Security - User and authentication settings.

**Left Sidebar - Status Widget:**
- **Trust Level**: Click to cycle through trust progression (observe → suggest → supervised_auto → bounded_auto → adaptive_auto → YOLO)
- **Persona Facets**: Click to cycle through personality facets
  - **inactive** (Gray) - Persona disabled
  - **default** (Purple) - Balanced, authentic self
  - **poet** (Indigo) - Creative, metaphorical, expressive
  - **thinker** (Blue) - Analytical, systematic
  - **friend** (Green) - Warm, supportive, empathetic
  - **antagonist** (Red) - Critical, challenging
  - Each facet shows as a colored badge
  - Messages are color-coded with left borders matching the active facet
  - Facet name appears in message header (e.g., "MetaHuman · poet")
  - Chat history persists across changes for multi-faceted conversations

**Left Sidebar – Active Profile & Status:**
- **Profile Visibility Badge**: Owners can mark their persona as `Private` or `Public`. Guests see this badge before selecting a profile.
- **Trust Level**: Click to cycle through trust progression (observe → suggest → supervised_auto → bounded_auto → adaptive_auto → YOLO).
- **Persona Facets**: Cycle through facets; chat messages highlight the active facet.

**Developer Tools (Right Sidebar):**
- Live audit stream (real-time system events)
- Agent monitor with statistics
- Boredom control (reflection frequency)
- Model selector (switch Ollama models)

**Memory Management:**
- **Inline Expansion**: Click the expand/collapse toggle (▼/▶) next to any memory entry to view its full content inline
- **Memory Editor**: Click the blue pencil icon (✏️) to open a full-screen modal editor
  - View and edit memory JSON files directly in the browser
  - Keyboard shortcuts: Ctrl+S to save, Esc to close
  - Auto-save detection with unsaved changes warning
  - Permission-based access (requires authentication to edit)
  - All edits are audited to the audit log
- **Memory Types**: Episodic events, reflections, dreams, tasks, curated files, AI ingestions, and audio transcripts

#### Voice Workspace
The Voice tab now divides responsibilities clearly:
- **Upload & Transcribe** – Drop in local audio for Whisper transcription.
- **Voice Clone Training** – Stores per-user samples in `profiles/<username>/out/voice-training`. Progress indicators reflect only the active profile.
- **Voice Settings** – Choose from shared Piper voices (`out/voices`) while keeping personal preferences (speaking rate, cache) inside `profiles/<username>/etc/voice.json`.

System administrators can install additional `.onnx` models under `out/voices/`; they become available instantly to all users.

#### Privacy Features & Session Controls
- **Clear Button**: Located in the chat interface header, the Clear button provides complete session cleanup:
  - Clears all chat messages from the UI
  - Clears reasoning stages
  - Clears localStorage cache
  - Clears the live audit stream display
  - **Deletes all audit log files from disk** (`logs/audit/*.ndjson`)
  - Creates a new audit entry recording the clear action for accountability
- **Fresh Session Interface**: Each session starts with a clean slate - no historical chat or audit data loads automatically
- **Audit Logs**: All system events are saved to `logs/audit/YYYY-MM-DD.ndjson` for accountability, but can be cleared at any time via the Clear button

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
