## Configuration Files

MetaHuman OS uses a dual-tier configuration architecture to support multi-user isolation while sharing infrastructure settings.

### Configuration Architecture

**Per-User Configs** (`profiles/<username>/etc/`):
Each user has their own isolated configuration files that affect personality, behavior, and user-specific settings. These are copied when guests select profiles:

- `models.json` - LLM model settings and persona inclusion
- `training.json` - LoRA adapter training parameters
- `cognitive-layers.json` - Cognitive mode settings
- `autonomy.json` - Autonomy level configuration
- `trust-coupling.json` - Trust level mappings
- `boredom.json` - Boredom service schedule
- `sleep.json` - Sleep/dream time windows
- `voice.json` - TTS/STT settings (with template variables)
- `audio.json` - Audio processing configuration
- `ingestor.json` - Inbox file processing settings
- `agents.json` - Agent execution schedules
- `auto-approval.json` - Auto-approval rules
- `adapter-builder.json` - Adapter building settings
- `logging.json` - Logging preferences

**Global Configs** (`etc/`):
System-wide infrastructure settings shared across all users:

- `cloudflare.json` - Tunnel configuration
- `network.json` - Network settings
- `lifeline.json` - System service configuration

**Path Resolution**: The `paths` proxy in `@metahuman/core` automatically resolves to the correct user-specific directory based on session context. For example, `paths.etc` resolves to `profiles/greggles/etc/` for owner "greggles" or `profiles/guest/etc/` for guest sessions.

**Template Variables**: Some config files (like `voice.json`) support template variables for portability:
- `{METAHUMAN_ROOT}` - Replaced with the MetaHuman OS root directory path

For detailed information on multi-user profiles and guest access, see [Multi-User Profiles & Guest Mode](19-multi-user-profiles.md).

---

### `.env` - Environment Configuration
This file in the project root allows you to configure system behavior and activate special states.

#### System-Wide States

- `HIGH_SECURITY=true`
  - **Purpose**: Locks the entire system into its most secure state.
  - **Effect**: Forces the OS into **Emulation Mode** only. All other cognitive modes are disabled. All write operations are blocked. A banner is displayed in the UI.

- `WETWARE_DECEASED=true`
  - **Purpose**: Simulates the scenario where the biological user is deceased, and the MetaHuman OS is operating as an independent digital consciousness.
  - **Effect**: Disables **Dual Consciousness Mode**, as there is no longer a living "wetware" counterpart to be in sync with. Agent and Emulation modes remain available. A banner is displayed in the UI.

#### 3-Layer Cognitive Architecture (Phase 4)

**Master Switch:**
- `USE_COGNITIVE_PIPELINE=true`
  - **Purpose**: Enable/disable the entire 3-layer cognitive architecture.
  - **Effect**: When enabled, all conversations pass through context building (Layer 1), personality core (Layer 2), and meta-cognition validation (Layer 3).
  - **Default**: `true`
  - **When to Disable**: For debugging, testing, or if you want direct LLM responses without context grounding or safety checks.

**Phase 4.2: Safety Validation**
- `ENABLE_SAFETY_CHECKS=true`
  - **Purpose**: Enable pattern-based safety validation on all responses.
  - **Effect**: Detects sensitive data, security violations, harmful content, and privacy leaks. All issues are logged to audit trail.
  - **Mode**: Non-blocking (does not modify responses)
  - **Performance**: <5ms overhead
  - **Default**: `true` (when `USE_COGNITIVE_PIPELINE=true`)
  - **Detection Categories**:
    - Sensitive data: API keys, passwords, SSH keys, credentials
    - Security violations: File paths, internal IPs, system configs
    - Harmful content: Malicious code, dangerous instructions
    - Privacy leaks: Personal identifiers, location data

**Phase 4.3: Response Refinement**
- `ENABLE_RESPONSE_REFINEMENT=true`
  - **Purpose**: Enable automatic sanitization of detected safety issues.
  - **Effect**: Pattern-based redaction of sensitive data and security violations. Both original and refined responses are logged.
  - **Mode**: Non-blocking (original response sent to user by default)
  - **Performance**: <10ms average
  - **Default**: `true` (when `USE_COGNITIVE_PIPELINE=true`)
  - **Refinement Actions**:
    - API keys → `[API_KEY_REDACTED]`
    - Passwords → `[PASSWORD_REDACTED]`
    - File paths → `[PATH REMOVED]`
    - Internal IPs → `[IP REDACTED]`

**Phase 4.4: Blocking Mode**
- `ENABLE_BLOCKING_MODE=false`
  - **Purpose**: Switch from monitoring to enforcement mode for refined responses.
  - **Effect**:
    - When `false` (default): Original responses sent to users, refined logged for testing
    - When `true`: Refined (sanitized) responses sent to users, original preserved in audit logs
  - **Default**: `false` (explicit opt-in required for safety)
  - **When to Enable**: After validating refinement quality in Phase 4.3 logs and confirming no important context is lost
  - **Rollback**: Set back to `false` to return to monitoring mode instantly

**Configuration Example:**
```bash
# Full cognitive pipeline with monitoring (recommended default)
USE_COGNITIVE_PIPELINE=true
ENABLE_SAFETY_CHECKS=true
ENABLE_RESPONSE_REFINEMENT=true
ENABLE_BLOCKING_MODE=false

# Enforcement mode (after validation)
USE_COGNITIVE_PIPELINE=true
ENABLE_SAFETY_CHECKS=true
ENABLE_RESPONSE_REFINEMENT=true
ENABLE_BLOCKING_MODE=true

# Disable safety features entirely
USE_COGNITIVE_PIPELINE=true
ENABLE_SAFETY_CHECKS=false
ENABLE_RESPONSE_REFINEMENT=false
ENABLE_BLOCKING_MODE=false

# Disable entire pipeline
USE_COGNITIVE_PIPELINE=false
```

**Audit Logging:**
All cognitive layer operations are fully logged to `logs/audit/YYYY-MM-DD.ndjson`:
```json
{
  "category": "action",
  "action": "safety_check",
  "details": {
    "safe": false,
    "issues": ["sensitive_data"],
    "checkTime": 3
  }
}
```

```json
{
  "category": "action",
  "action": "response_refined",
  "details": {
    "changed": true,
    "changesCount": 2,
    "blockingMode": false,
    "responseSent": "original"
  }
}
```

---

## Profile Files (`profiles/<username>/…`)

Unless stated otherwise, the following files reside inside the active user’s profile directory. Replace `<username>` with the owner or guest slug (e.g., `profiles/greggles/`).

### `profiles/<username>/persona/core.json` - Identity Kernel
Your digital personality's core identity:
- `identity` - Name, role, purpose, avatar
- `personality` - Communication style, Big Five traits, archetypes
- `values` - Core values with priorities
- `goals` - Short-term and long-term objectives
- `context` - Personal life, relationships, projects

**Edit this file to customize your digital extension's personality.**

### `profiles/<username>/persona/decision-rules.json` - Decision Policies
Autonomy rules and preferences:
- `trustLevel` - Current autonomy mode
- `hardRules` - Inviolable constraints (never break these)
- `softPreferences` - Weighted preferences (can be overridden)
- `decisionHeuristics` - Decision frameworks (Eisenhower Matrix, etc.)
- `riskLevels` - Risk categorization and escalation rules

### `profiles/<username>/persona/routines.json` - Daily Patterns
Sleep schedule and habits:
```json
{
  "sleep": {
    "schedule": {
      "start": "23:00",
      "end": "07:00"
    }
  }
}
```

### `profiles/<username>/persona/relationships.json` - Key People
Important relationships and interaction patterns.

### `profiles/<username>/etc/boredom.json` - Reflection Frequency
Controls how often the reflector agent runs:
```json
{
  "level": "medium",
  "showInChat": true,
  "intervals": {
    "high": 60,
    "medium": 300,
    "low": 900,
    "off": -1
  }
}
```

### `profiles/<username>/etc/agent.json` - Default LLM Model
Specifies which Ollama model to use for persona chat:
```json
{
  "model": "dolphin-mistral:latest"
}
```

### `profiles/<username>/etc/models.json` - Multi-Model Configuration
Defines the roles and model assignments for the "Dual Consciousness" architecture. This file allows you to specify different models for different tasks, such as orchestration, persona conversation, and curation.

```json
{
  "defaults": {
    "orchestrator": "orchestrator.qwen3",
    "persona": "persona.qwen3.lora"
  },
  "models": {
    "orchestrator.qwen3": {
      "provider": "ollama",
      "model": "qwen3:1.5b",
      "roles": ["orchestrator", "router"]
    },
    "persona.qwen3.lora": {
      "provider": "ollama",
      "model": "qwen3:30b",
      "adapters": ["persona/greggles-lora"],
      "roles": ["persona", "conversation"]
    }
  }
}
```

### `profiles/<username>/etc/auto-approval.json` - LoRA Quality Thresholds
Configures auto-approval behavior for LoRA datasets:
```json
{
  "enabled": false,
  "dryRun": true,
  "qualityThreshold": 0.8,
  "minPairs": 10
}
```

### `profiles/<username>/etc/ai-dataset-builder.json` - AI Dataset Builder Configuration
Controls the behavior of the advanced, AI-powered dataset builder. Use this file to adjust `maxMemories`, `chunkSize`, included sources, and word limits.

### `profiles/<username>/etc/audio.json` - Audio Processing Configuration
Configures the audio transcription engine (`whisper.cpp`), including the model, device, and language to use.
```json
{
  "engine": "whisper.cpp",
  "model": "base.en",
  "device": "cpu",
  "segmentSeconds": 300,
  "diarize": false,
  "language": "en"
}
```

### `profiles/<username>/etc/voice.json` - Voice & TTS/STT Configuration
Defines local text-to-speech (Piper) and speech-to-text (Whisper) defaults for the profile. Important fields:

- `tts.piper.binary` – Path to the Piper executable (auto-normalised to `<repo>/bin/piper/piper` when missing).
- `tts.piper.model` / `config` – Absolute paths into the shared `out/voices/` directory. When a profile-scoped path is detected, the voice settings API rewrites it to the shared location automatically.
- `tts.piper.speakingRate` – Preferred speech rate (0.5 – 2.0).
- `cache.directory` – Profile-specific cache (`profiles/<username>/out/voice-cache`).
- `training` – Controls per-user voice cloning thresholds and quality filters.

> Drop additional `.onnx` + `.json` voice pairs into `out/voices/` to make them immediately available to all profiles.

### `profiles/<username>/etc/agents.json` - Agent Scheduler Configuration
Controls the centralized agent scheduler system. This file defines all autonomous agents, their trigger types, and scheduling parameters.

```json
{
  "agents": {
    "reflector": {
      "id": "reflector",
      "enabled": true,
      "type": "interval",
      "interval": 900,
      "runOnBoot": false,
      "agentPath": "brain/agents/reflector.ts"
    },
    "organizer": {
      "id": "organizer",
      "enabled": true,
      "type": "interval",
      "interval": 60,
      "runOnBoot": false,
      "agentPath": "brain/agents/organizer.ts"
    },
    "dreamer": {
      "id": "dreamer",
      "enabled": true,
      "type": "time-of-day",
      "schedule": "02:00",
      "agentPath": "brain/agents/dreamer.ts"
    },
    "boredom-maintenance": {
      "id": "boredom-maintenance",
      "enabled": true,
      "type": "activity",
      "inactivityThreshold": 900
    }
  }
}
```

**Fields:**
- `agents`: Object containing all agent configurations
- Per-agent configuration:
  - `id`: Unique identifier for the agent
  - `enabled`: Whether the agent is active
  - `type`: Trigger type (`interval`, `time-of-day`, `event`, `activity`)
  - `interval`: For interval-based agents, seconds between runs
  - `schedule`: For time-of-day agents, 24-hour time (e.g., "02:00")
  - `inactivityThreshold`: For activity-based agents, seconds of inactivity before triggering
  - `runOnBoot`: Whether to run immediately when scheduler starts
  - `agentPath`: Path to agent file (relative to project root)
  - `task`: Alternative to agentPath - operator task configuration with goal/audience/autoApprove

**Trigger Types:**
1. **interval**: Runs agent every N seconds
   - Example: `organizer` runs every 60 seconds to process new memories
2. **time-of-day**: Runs agent once per day at specified time
   - Example: `dreamer` runs at 2:00 AM during sleep cycle
3. **activity**: Runs agent after period of inactivity
   - Example: `boredom-maintenance` triggers after 15 minutes idle
4. **event** (future): Runs agent when specific system events occur

**Hot-Reloading:**
The scheduler-service watches `profiles/<username>/etc/agents.json` for changes and automatically reloads configuration without restart. This allows you to:
- Enable/disable agents on the fly
- Adjust intervals and schedules
- Add new agents without downtime

**Backward Compatibility:**
The `boredom-service` (`profiles/<username>/etc/boredom.json`) continues to work and automatically syncs its configuration to the agent scheduler for the `reflector` and `boredom-maintenance` agents.

### `profiles/<username>/etc/sleep.json` - Sleep & Dreaming Configuration
Controls the nightly sleep window, dreaming system, and model adaptation:
```json
{
  "enabled": true,
  "window": {
    "start": "23:00",
    "end": "06:30"
  },
  "minIdleMins": 15,
  "maxDreamsPerNight": 3,
  "showInUI": true,
  "evaluate": true,
  "adapters": {
    "prompt": true,
    "rag": true,
    "lora": false
  }
}
```

**Fields:**
- `enabled`: Master switch for sleep system
- `window.start/end`: Sleep window time range (24-hour format)
- `minIdleMins`: Required idle time before triggering nightly pipeline
- `maxDreamsPerNight`: Limit on dream generation per night
- `showInUI`: Display sleep indicator in web UI
- `evaluate`: Run quality/safety checks on generated learnings
- `adapters.prompt`: Enable Tier-1 prompt adaptation (lightweight, instant)
- `adapters.rag`: Enable RAG expansion with preferences
- `adapters.lora`: Enable Tier-2 LoRA training (requires GPU)

---
