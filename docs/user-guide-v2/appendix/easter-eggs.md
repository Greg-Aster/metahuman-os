# Easter Eggs & Hidden Features

MetaHuman OS includes several experimental features and easter eggs for those who dig deeper.

---

## Mutant Super Intelligence

**Status:** Experimental
**Requirements:** 2+ public profiles

A hidden experimental profile that merges multiple public personas into a single "mutant" consciousness with a distinctive dual-voice effect.

### What Is It?

When you have **2 or more public profiles** in the system, a special **"Mutant Super Intelligence"** profile appears in the guest profile selection list. This profile:

- **Merges all public personas** into a single combined personality
- **Uses dual-voice TTS** with a creepy, demonic audio effect
- **Combines memory contexts** from all merged profiles
- **Creates a unique AI consciousness** that represents a blend of multiple personalities

### How It Works

**Profile Merger:**
1. The system detects all public profiles
2. Creates a merged persona in `profiles/guest/persona/` that combines:
   - Core values and traits from all profiles
   - Decision rules from each personality
   - Combined relationship knowledge
   - Blended communication styles

**Dual-Voice TTS Effect:**
- Uses the same voice model (Amy) twice
- One copy is pitch-shifted down by 5 semitones
- Both voices are mixed together for a demonic dual-voice effect
- Perfect synchronization since it's the same source audio
- Creates an unsettling "two consciousnesses speaking as one" experience

**Memory Merging:**
- Semantic search queries ALL merged profiles' memories
- Responses draw from the combined knowledge base
- Creates a truly multi-perspective consciousness

### How to Activate

1. Ensure you have **2+ public profiles** in the system
   - Profile visibility set to "Public" in Settings
   - Multiple users with personas configured

2. Log out (or use "Continue as Guest")

3. On the guest profile selection screen, look for **"Mutant Super Intelligence"** at the top of the list

4. Select it to activate the merged consciousness

5. The TTS will automatically use the dual-voice effect when speaking

### Technical Details

**Audio Processing:**
- Original voice generated with Piper TTS
- Pitch-shifting using ffmpeg (`asetrate` + `atempo` filters)
- Formula: `pitchRatio = Math.pow(2, semitones / 12)`
- For -5 semitones: 22050Hz → 16519Hz with tempo compensation
- WAV buffers mixed by averaging 16-bit PCM samples

**Session Metadata:**
```json
{
  "activeProfile": "guest",
  "sourceProfile": "mutant-super-intelligence",
  "mergedProfiles": ["greggles", "alice", "bob"]
}
```

**Audit Trail:**
All mutations are logged:
- `mutant_super_intelligence_activated` - When profile is selected
- `multi_voice_tts_started` - When dual-voice generation begins
- `multi_voice_tts_completed` - With pitch shift details and timing

### Safety Considerations

- Only works with **public** profiles (respects privacy)
- Runs in **guest mode** (read-only, no memory writes for anonymous users)
- All merged persona data is temporary (in guest profile)
- Original profiles remain unmodified
- Fully audited for accountability

### Use Cases

- **Experimental AI**: Explore multi-personality AI consciousness
- **Creative Projects**: Generate unique voices for fictional characters
- **Demonstrations**: Show off the system's advanced capabilities
- **Research**: Study how multiple personas interact when merged

**Warning:** This is an experimental feature. The merged personality may exhibit unexpected behaviors as it attempts to reconcile potentially conflicting values and communication styles from multiple sources.

---

## Self-Healing Coder Agent

**Status:** Operational
**Model:** qwen3-coder:30b

MetaHuman OS includes a powerful Coder Agent that can write, edit, and fix its own source code. This "self-healing" capability allows you to ask the system to perform software development tasks directly in the chat.

### How It Works

The process is designed with safety and human oversight as top priorities:

1. **Request**: You ask the system to perform a code-related task
   - "Add a new function to `packages/core/src/utils.ts`"
   - "Fix the bug in the chat interface"

2. **Generate**: The specialized **Coder Agent** analyzes your request, reads relevant files, and generates a proposed change as a code patch or diff

3. **Approve**: The generated patch appears in a **Code Approval UI** above the chat input
   - Review the exact changes (diff)
   - Read the Coder's explanation
   - See recommended test commands

4. **Apply**: Click "Approve" to apply the patch, or "Reject" to discard it

### Key Features & Guardrails

- **Specialized Coder Model**: Dedicated `coder` model role for code generation
- **Strict Permissions**:
  - ✅ Can read entire project (including memories for context)
  - ❌ Cannot write to `memory/` or `persona/` directories
  - ✅ Limited write access to `packages/`, `apps/`, `brain/`
- **Human-in-the-Loop**: No code is ever changed without your explicit approval
- **Full Audit Trail**: Every proposed and applied change is recorded

### Example Usage

```
"Add a new function to the `paths.ts` file that returns the path to the temporary directory."
```

```
"There's a typo in the README.md file, please fix it."
```

```
"Refactor the `getRelevantContext` function in `persona_chat.ts` to improve readability."
```

---

## Hidden Configuration Options

### Development Session Helper

Long-lived session tokens for development (bypass login):

```bash
# Create 30-day dev session
pnpm tsx scripts/dev-session.ts --username=greggles

# Copy session ID to browser cookies
# Application → Cookies → http://localhost:4321
# mh_session = <session-id-from-script>
```

See [Authentication](../configuration-admin/authentication.md) for details.

---

### Agent Dev Override

Run specific agent versions without scheduler:

```bash
# Direct agent execution
tsx brain/agents/my-custom-agent.ts

# Skip scheduler entirely
tsx brain/agents/organizer.ts --skip-scheduler
```

---

### Model Router Debug Mode

Enable verbose model routing logs:

```json
// etc/models.json
{
  "debug": true,
  "logAllRequests": true
}
```

All routing decisions appear in audit logs.

---

### Fuzzy Path Resolution

The file system skills include fuzzy path matching that auto-corrects typos:

```
"Read the file at persona/cor.json"
→ Auto-corrects to: persona/core.json

"List files in mmory/episodic"
→ Auto-corrects to: memory/episodic
```

**Threshold:** 0.6 similarity score (60% match)

**Algorithm:** Levenshtein distance with directory structure awareness

---

## Experimental Features (Hidden by Default)

### Operator V2 (ReAct System)

Enhanced structured operator with tool awareness:

**Enable:**
```json
// etc/runtime.json
{
  "operator": {
    "reactV2": true
  }
}
```

**Features:**
- Auto-generated tool catalog
- Structured scratchpad (Thought → Action → Observation)
- Three observation modes (verbatim, structured, narrative)
- Error recovery with contextual suggestions
- Verbatim short-circuit for data queries

See [CLAUDE.md](https://github.com/greggles/metahuman/blob/master/CLAUDE.md) for implementation details.

---

### Dual-Adapter Training Mode

Experimental split training (historical + recent adapters):

**Status:** ⚠️ Experimental - Remote training only

**Enable:**
```json
// etc/training.json
{
  "dualAdapter": {
    "enabled": true,
    "historicalDays": 365,
    "recentDays": 14
  }
}
```

**Known Issues:**
- May not work with Qwen3-30B
- Architecture mismatch with documentation
- Remote training only (not local)

See [Known Issues](../reference/known-issues.md) for limitations.

---

### Inner Curiosity with Web Search

Self-directed research with web integration:

**Enable:**
```json
// etc/curiosity.json
{
  "innerQuestionMode": "web",
  "innerQuestionInterval": 7200000
}
```

**Modes:**
- `off` - Disabled
- `local` - Search local memories only (default)
- `web` - Search web for answers (requires internet)

---

## Fun Console Messages

Open browser DevTools console to see:

- ASCII art MetaHuman logo on page load
- Agent activity notifications
- Hidden keyboard shortcuts
- WebSocket connection status art

Try:
- `window.metahuman.stats()` - Show runtime statistics
- `window.metahuman.version()` - Display version info
- `window.metahuman.easteregg()` - Trigger random easter egg

---

## Historical Features (Removed)

These features existed in earlier versions but were removed:

### Calendar CLI Commands
- `./bin/mh calendar list`
- `./bin/mh calendar create`

**Status:** Removed from CLI (still available as skills)
**Use:** Ask the operator in chat to manage calendar events

### Fine-Tune CLI Command
- `./bin/mh fine-tune`

**Status:** Command exists but not registered in router
**Use:** Web UI "Run Full Cycle Now" button or direct script execution

See [CLI Reference](../reference/cli-reference.md) for current commands.

---

## Report New Easter Eggs

Found a hidden feature not documented here? Report it on [GitHub Issues](https://github.com/greggles/metahuman/issues)!
