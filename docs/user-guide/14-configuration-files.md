## Configuration Files

### `persona/core.json` - Identity Kernel
Your digital personality's core identity:
- `identity` - Name, role, purpose, avatar
- `personality` - Communication style, Big Five traits, archetypes
- `values` - Core values with priorities
- `goals` - Short-term and long-term objectives
- `context` - Personal life, relationships, projects

**Edit this file to customize your digital extension's personality.**

### `persona/decision-rules.json` - Decision Policies
Autonomy rules and preferences:
- `trustLevel` - Current autonomy mode
- `hardRules` - Inviolable constraints (never break these)
- `softPreferences` - Weighted preferences (can be overridden)
- `decisionHeuristics` - Decision frameworks (Eisenhower Matrix, etc.)
- `riskLevels` - Risk categorization and escalation rules

### `persona/routines.json` - Daily Patterns
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

### `persona/relationships.json` - Key People
Important relationships and interaction patterns.

### `etc/boredom.json` - Reflection Frequency
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

### `etc/agent.json` - Default LLM Model
Specifies which Ollama model to use for persona chat:
```json
{
  "model": "dolphin-mistral:latest"
}
```

### `etc/auto-approval.json` - LoRA Quality Thresholds
Configures auto-approval behavior for LoRA datasets:
```json
{
  "enabled": false,
  "dryRun": true,
  "qualityThreshold": 0.8,
  "minPairs": 10
}
```

### `etc/ai-dataset-builder.json` - AI Dataset Builder Configuration
Controls the behavior of the advanced, AI-powered dataset builder. Use this file to adjust `maxMemories`, `chunkSize`, included sources, and word limits.

### `etc/audio.json` - Audio Processing Configuration
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

### `etc/sleep.json` - Sleep & Dreaming Configuration
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

