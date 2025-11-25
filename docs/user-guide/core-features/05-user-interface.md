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

Modern ChatGPT-style 3-column interface with real-time updates:
```bash
cd apps/site && pnpm dev
# Open http://localhost:4321
```

#### Layout Architecture

The web interface uses a three-column ChatGPT-style layout:

```
┌─────────────────────────────────────────────────────────┐
│ Header (Authentication, Cognitive Mode, Settings)       │
├─────────┬─────────────────────────────┬─────────────────┤
│ Left    │ Center                      │ Right           │
│ Sidebar │ Content                     │ Sidebar         │
│         │                             │ (Collapsible)   │
│ Feature │ ChatInterface /             │ Developer       │
│ Menu    │ Dashboard /                 │ Tools           │
│         │ Memory Browser /            │                 │
│         │ TaskManager /               │                 │
│         │ Terminal / etc.             │                 │
└─────────┴─────────────────────────────┴─────────────────┘
```

**Key Components:**
- **ChatLayout.svelte** - 3-column grid container with collapsible sidebars
- **LeftSidebar.svelte** - Feature navigation menu with status widget
- **RightSidebar.svelte** - Developer tools (audit stream, agent monitor, settings)
- **CenterContent.svelte** - View router that switches content based on selection
- **stores/navigation.ts** - Svelte store for shared navigation state

**Navigation Flow:**
1. User clicks menu item in LeftSidebar
2. Updates `activeView` store (e.g., 'chat', 'dashboard', 'tasks')
3. CenterContent reactively switches displayed component
4. Sidebar state persisted to localStorage

#### Header Controls
- **Profile Indicator** – Shows the active account (role, visibility badge). Owners can open the menu to log out or jump into Settings.
- **Cognitive Mode Selector** – Switch between `Dual Consciousness`, `Agent`, and `Emulation`. Locked modes display tooltips explaining why they are unavailable under the current security posture.
- **Developer Tools Toggle** – Opens the right sidebar (audit stream, agent monitor, boredom service, model selector).

##### Developer Sidebar: Audit Stream (Enhanced)
- **Task Grouping** – Live audit events now collapse into high-level task cards (ReAct iterations, summarizer cycles, approvals, etc.) so you can glance at the flow without drowning in raw JSON.
- **Expandable Detail** – Clicking a card reveals the chronological sub-events, each with timestamp, severity badge, actor, and summary.
- **Detail Drawer** – A "View JSON" action opens a slide-out panel with the full payload plus copy-to-clipboard, keeping the main list uncluttered while preserving raw access.
- **Filtering & Search** – Filter chips (info/warn/error, category, actor) and a search bar let you zero in on the events you care about.
- **Performance** – Only the most recent groups stay in memory by default; older ones can be reloaded on demand so the stream stays responsive even in heavy sessions.


#### System Status Banners
The UI will display prominent banners at the top of the screen to inform you of critical system-wide states:
- **High Security Mode**: A red banner appears when the system is locked into read-only emulation mode.
- **Wetware Deceased**: An indigo banner appears when the system is running as an independent digital consciousness, indicating that Dual Consciousness mode is unavailable.
- **Read-Only Mode**: A general banner indicating that the current cognitive mode (Emulation) does not allow for write operations.

**Features:**
- 💬 **Chat** - Conversation with your digital personality extension
- 📊 **Dashboard** - System status and overview
- ✓ **Tasks** - Task management with project organization
- ✋ **Approvals** - Skill execution queue for trust-based operations
- 🧩 **Memory Browser** - Browse events & insights with 7 specialized tabs (see below)
- 🎤 **Voice** - Audio upload, transcription, cloning, and per-user training data
- 🧠 **AI Training** - LoRA adapters, training monitor, dataset management, and history
- 🔗 **Node Editor** - Visual workflow designer for cognitive graphs
- 👤 **Persona Editor** - Manual persona editing interface
- 🎭 **Persona Generator** - Therapist-style interview system
- 📊 **Training Wizard** - AI-assisted training configuration
- 📦 **Dataset Management** - Training dataset curation and review
- 📈 **Adapter Dashboard** - LoRA adapter management and activation
- 🔌 **Addons Manager** - Install and manage system addons
- 📊 **GPU Monitor** - GPU resource monitoring and VRAM usage
- 💻 **Terminal** - Embedded command line
- ⚙️ **System** - System settings and tools
- 🌐 **Network** - Cloudflare tunnel and connectivity settings
- 🔒 **Security** - User and authentication settings

#### Memory Browser (7 Specialized Tabs)

The Memory Browser provides comprehensive access to your episodic memories with seven specialized views:

**1. Conversations Tab**
- Shows only `type: 'conversation'` memories
- User-assistant dialogue exchanges
- Filterable by date, cognitive mode, participant
- Inline expansion and full-screen editor

**2. Observations Tab**
- Shows only `type: 'observation'` memories
- Manual captures via `mh capture` command
- Personal notes and event recordings
- Tagged and entity-enriched by organizer agent

**3. Inner Dialogue Tab**
- Shows only `type: 'inner_dialogue'` memories
- Reflections generated by reflector agent
- Internal questions from inner curiosity agent
- Associative memory chains (3-5 linked memories)
- Never shown in main chat (internal thoughts only)

**4. Dreams Tab**
- Shows only `type: 'dream'` memories
- Surreal narratives from dreamer agent
- Generated from lifetime memory fragments
- Reflective exponential decay weighting
- Runs during sleep cycle

**5. Tasks Tab**
- Shows only `type: 'task'` memories
- Active, completed, and archived tasks
- Project organization and hierarchies
- Due dates and priority levels

**6. All Memories Tab**
- Unified view of all memory types
- Filterable by type, date, tags, entities
- Search across all fields
- Bulk operations and export

**7. Search Tab**
- Advanced search with multiple filters:
  - Date range picker
  - Memory type selector
  - Tag filtering
  - Entity search
  - Full-text search
  - Cognitive mode filter
- Results grouped by relevance
- Semantic search integration (if index built)

**Memory Editor Features:**
- Full-screen modal (80vh height, 1200px width)
- Keyboard shortcuts: Ctrl+S to save, Esc to close
- Auto-save detection with unsaved changes warning
- Permission-based editing (requires authentication)
- Read-only in emulation mode for anonymous users
- All edits logged to audit trail with timestamp and actor
- JSON auto-formatting for readability
- Accessed via blue pencil icon (✏️) on memory cards

#### AI Training Components

**Training Wizard** (`TrainingWizard.svelte`)
- AI-assisted configuration interface
- Helps users set optimal training parameters
- Guides through dataset selection
- Validates configuration before training
- Real-time cost estimation

**Training Monitor** (`TrainingMonitor.svelte`)
- Real-time training progress display
- Epoch/step tracking with progress bars
- Loss curves and metrics visualization
- GPU utilization graphs
- ETA and completion estimates
- Support for multiple providers (local, RunPod, etc.)

**Training History** (`TrainingHistory.svelte`)
- Historical training runs
- Success/failure status
- Training metrics and evaluation scores
- Adapter activation status
- Export/import training configs

**Dataset Management** (`DatasetManagement.svelte`)
- Training dataset curation interface
- Review conversation pairs before training
- Quality metrics and composition analysis
- Approve/reject datasets
- Manual dataset editing
- Export to JSONL format

**Adapter Dashboard** (`AdapterDashboard.svelte`)
- List all trained LoRA adapters
- Activation status (active/inactive)
- Evaluation scores and quality metrics
- Dual-adapter system management
- Historical adapter merging
- Adapter comparison tools

#### Persona Management Components

**Persona Editor** (`PersonaEditor.svelte`)
- Manual editing of `persona/core.json`
- Live preview of personality changes
- Facet configuration interface
- Decision rules management
- Relationship and routine editing
- Version history and backup

**Persona Generator** (`PersonaGenerator.svelte`)
- Therapist-style interview interface
- 8 category coverage tracking:
  - Core Identity
  - Values & Ethics
  - Communication Style
  - Relationships
  - Goals & Aspirations
  - Daily Life & Habits
  - Knowledge & Interests
  - Emotional Patterns
- Progress visualization
- Session save/resume
- Diff viewer for proposed changes
- Merge strategy selection (replace, merge, append)

#### Node Editor Components

**Node Editor** (`NodeEditor.svelte`, `NodePalette.svelte`, `NodeEditorLayout.svelte`)
- Visual workflow editor for cognitive graphs
- Drag-and-drop node placement
- Node palette with all available node types:
  - Memory Search
  - LLM Prompt
  - Task Query
  - Conditional branches
  - Output display
  - And 20+ more node types
- Connection drawing between nodes
- Parameter configuration per node
- Workflow save/load
- Test execution with live results
- Graph validation and error checking

See [Node-Based Cognitive System](28-node-based-cognitive-system.md) for complete details.

#### System Management Components

**Addons Manager** (`AddonsManager.svelte`)
- Browse available system addons
- Install/uninstall addons
- Enable/disable installed addons
- Addon configuration interface
- Dependency management
- Update notifications

**GPU Monitor** (`GPUMonitor.svelte`)
- Real-time GPU utilization graphs
- VRAM usage tracking
- Temperature monitoring
- Process-specific GPU usage
- Multi-GPU support
- Historical metrics

**Onboarding Wizard** (`OnboardingWizard.svelte`)
- First-run setup flow
- Account creation guidance
- Initial persona configuration
- Model installation help
- Voice setup tutorial
- Welcome tour of features

**Left Sidebar - Status Widget:**
- **Trust Level**: Click to cycle through trust progression (observe → suggest → supervised_auto → bounded_auto → adaptive_auto → YOLO)
- **Persona Facets**: Click to cycle through personality facets (see [Persona Facets](11-special-features.md#persona-facets) for details)
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
  - **Public Profiles**: Visible to all guests; can be selected for guest sessions
  - **Private Profiles**: Hidden from guest selection; owner-only access
  - **Special Profile**: When 2+ public profiles exist, the [Mutant Super Intelligence](11-special-features.md#mutant-super-intelligence-easter-egg) easter egg appears
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

#### Chat Interface Modes

The chat interface has three distinct modes accessible via toggle buttons above the message area:

**Conversation Mode** (Default)
- **Purpose**: Active back-and-forth dialog between you and MetaHuman
- **What appears**:
  - ✅ Your messages (user)
  - ✅ MetaHuman's responses (assistant)
  - ✅ System notifications
  - ✅ Live reasoning stages (while thinking)
- **What's hidden**:
  - ❌ Reflections (💭 Idle Thought)
  - ❌ Dreams (🌙 Dream)
  - ❌ Completed reasoning (ephemeral - disappears after thinking finishes)
- **Reasoning behavior**: Reasoning stages display in real-time during thinking to provide transparency, but disappear once the response is complete to keep the conversation clean

**Inner Dialogue Mode**
- **Purpose**: Observe MetaHuman's autonomous consciousness stream
- **What appears**:
  - ✅ Reflections (💭 Idle Thought) - Generated by reflector agent using associative memory chains
  - ✅ Dreams (🌙 Dream) - Generated by dreamer agent during sleep from lifetime memories
  - ✅ Reasoning stages (🤔 Reasoning) - Permanent record of thinking processes
- **What's hidden**:
  - ❌ User messages
  - ❌ Assistant responses
  - ❌ System messages
- **Memory Access**: Both reflections and dreams access your entire memory lifetime (like the human mind), weighted by recency:
  - Recent memories appear most frequently
  - 1-year-old memories retain ~20% probability (reflective weighting)
  - Older memories surface meaningfully, not just as rare exceptions
  - Exponential decay formula (227-day constant) allows contemplative exploration of your past
- **Train of Thought**: Reflections use associative chain-building to follow semantic links between memories, creating connected thought sequences

**Voice Mode**
- **Purpose**: Voice-driven interaction with audio input/output
- Real-time speech-to-text and text-to-speech
- See Voice Workspace section below for details

**Dialog Type Separation: Thoughts vs. Words**

The strict separation ensures clarity:
- **Conversation** = Spoken words (bidirectional communication)
- **Inner Dialogue** = Silent thoughts (autonomous consciousness)
- **Reasoning** = Ephemeral in conversation (live feedback only), permanent in inner dialogue (thought record)

This architecture allows you to:
- Have clean conversations without thought clutter
- Observe the MetaHuman's autonomous mental processes separately
- See reasoning live during conversation without it polluting history
- Review complete thinking processes in inner dialogue mode

#### Voice Features & TTS Controls

**Text-to-Speech (TTS) Integration**

MetaHuman OS includes comprehensive Piper TTS integration with fine-grained control over voice playback:

**Chat Input Controls** (located next to the message input box):
- **Stop Button** (🛑) - Appears when audio is playing
  - Click to immediately interrupt and stop TTS playback
  - Cancels both active audio and any pending TTS generation
  - Works on desktop and mobile (inline layout for space efficiency)
- **Microphone Button** (🎤) - Also triggers stop when audio is playing
  - Dual purpose: Start voice input OR stop active audio
  - Provides tactile interrupt control during long responses

**Per-Message Replay** (inside each text bubble):
- Small microphone icon (🎤) positioned at bottom-right of each message
- Click to replay any message on demand
- Works for both user and assistant messages
- Allows listening to responses multiple times
- Useful for accessibility and comprehension

**Inner Dialogue TTS** (Inner Dialogue mode):
- Toggle "Enable TTS for inner dialogue" in settings
- Automatically reads reflections and dreams aloud as they occur
- Creates an auditory consciousness stream
- Dreams read with the same voice as reflections
- Can be combined with per-message replay for re-listening

**Mobile Optimization**:
- All voice controls appear inline on a single row (not stacked)
- Compact button sizing for touch interfaces
- Stop button appears inline with send button and mic button
- Saves vertical screen space on mobile devices

#### Voice Workspace
The Voice tab divides responsibilities clearly:
- **Upload & Transcribe** – Drop in local audio for Whisper transcription.
- **Voice Clone Training** – Stores per-user samples in `profiles/<username>/out/voice-training`. Progress indicators reflect only the active profile.
- **Voice Settings** – Choose from shared Piper voices (`out/voices`) while keeping personal preferences (speaking rate, cache) inside `profiles/<username>/etc/voice.json`.
- **Special TTS Effects** – The [Mutant Super Intelligence](11-special-features.md#mutant-super-intelligence-easter-egg) profile automatically uses a dual-voice effect with pitch-shifted audio mixing for a unique sound.

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
- **Audit Logs**: All system events are saved to `logs/audit/YYYY-MM-DD.ndjson` for accountability, but can be cleared at any time via the Clear button. The live sidebar stream mirrors the same data, just organized into expandable groups.

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
