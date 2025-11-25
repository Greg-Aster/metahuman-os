# Frequently Asked Questions

Common questions about MetaHuman OS and their answers.

---

## General Questions

### What is MetaHuman OS?

MetaHuman OS is an autonomous digital personality extension that operates 24/7 as a parallel intelligence. It's not an assistant—it's a digital reflection of you that learns from your memories, makes decisions based on your values, and operates autonomously within boundaries you define.

**Key capabilities:**
- Autonomous memory processing and reflection
- Task management and proactive suggestions
- Training personalized LLM adapters from your conversations
- Voice cloning and TTS
- Multi-user profiles with guest access
- Complete audit trail of all operations

---

### Is this ChatGPT or an AI assistant?

No. MetaHuman OS is fundamentally different:

| ChatGPT/Assistants | MetaHuman OS |
|-------------------|--------------|
| Stateless conversations | Persistent memory system |
| Request/response only | Proactive autonomous agents |
| Generic personality | Custom personality trained on your data |
| Cloud-dependent | Fully local (optional cloud LLM) |
| No long-term memory | Episodic + semantic memory |
| One-size-fits-all | Personalized via LoRA adapters |

Think of it as a digital twin that operates continuously, not a chatbot you ask questions.

---

### Why would I want this?

MetaHuman OS is useful for:

1. **Memory augmentation**: Never forget conversations, insights, or tasks
2. **Cognitive offloading**: Let the system handle routine thought patterns (reflections, connections)
3. **Personality preservation**: Train a model that speaks like you, thinks like you
4. **Digital legacy**: Your digital personality can continue after you're gone ([Wetware Deceased Mode](../configuration-admin/special-states.md))
5. **Research & exploration**: Experiment with autonomous AI systems
6. **Privacy**: All data stays local on your machine

---

### Is my data private?

**Yes.** MetaHuman OS is designed for complete privacy:

- **Local-first architecture**: All memory, personality data, and processing happens on your machine
- **No cloud requirements**: Works entirely offline (if using Ollama models)
- **No telemetry**: No data sent to external servers
- **Complete audit trail**: Every operation is logged locally for your review
- **Open source**: You can inspect the code and verify privacy claims

**Optional cloud components** (if you choose to use them):
- OpenAI API (if you configure it for chat)
- Cloudflare Tunnel (if you want remote web access)

By default, everything runs on `localhost`.

---

### What hardware do I need?

**Minimum:**
- CPU: Modern multi-core processor (Intel i5/AMD Ryzen 5 or better)
- RAM: 16GB
- Storage: 50GB free space
- OS: Linux (Ubuntu 22.04+ recommended), macOS (experimental), Windows (WSL2)

**Recommended for LLM training:**
- GPU: NVIDIA GPU with 24GB+ VRAM (RTX 4090, A6000, etc.)
- RAM: 32GB+
- Storage: 500GB+ SSD (models and training data are large)

**Can run without GPU:**
- Use smaller Ollama models (phi3:mini, qwen2.5:7b)
- Training requires GPU or remote training service

---

### Do I need to know how to code?

**For basic usage:** No. The web UI handles most operations.

**For advanced usage:** Some command-line familiarity helps for:
- Running CLI commands (`./bin/mh`)
- Managing agents and services
- Troubleshooting issues
- Customizing configuration files (JSON editing)

**For development/customization:** Yes. The system is TypeScript-based and requires:
- Node.js and pnpm
- TypeScript knowledge for custom agents/skills
- Understanding of LLM concepts for training

---

## Installation & Setup

### How do I install MetaHuman OS?

See the [Getting Started](../getting-started/quick-start.md) guide. Basic steps:

1. Clone repository
2. Install dependencies: `pnpm install`
3. Initialize: `./bin/mh init`
4. Configure persona: Edit `persona/core.json`
5. Start services: `./bin/mh start`
6. Start web UI: `cd apps/site && pnpm dev`

---

### Do I need Ollama?

**Recommended but not required.**

Ollama provides local LLM capabilities for:
- Memory organization (extracting tags/entities)
- Reflections and inner dialogue
- Chat with persona
- Semantic search (embeddings)

**Alternatives:**
- Use OpenAI API (configure in `etc/models.json`)
- Run without LLM features (memory still works, just no AI processing)

**Install Ollama:**
```bash
curl -fsSL https://ollama.com/install.sh | sh
./bin/mh ollama pull phi3:mini
```

---

### Can I run this on Windows?

**Limited support via WSL2 (Windows Subsystem for Linux).**

The system is developed for Linux/Unix environments. Windows users should:

1. Install WSL2 (Ubuntu 22.04)
2. Install inside WSL environment
3. Access web UI from Windows browser via `localhost:4321`

**Known limitations:**
- GPU passthrough in WSL2 can be tricky
- Some shell scripts may need adjustments
- File path handling differences

**Better options:**
- Dual-boot Linux
- Linux VM with GPU passthrough
- Cloud Linux instance

---

### How much disk space do I need?

**Typical usage:**

| Component | Size |
|-----------|------|
| Base installation | ~2GB |
| Ollama models (3-4 models) | 10-30GB |
| Memory data (1 year) | 100MB - 1GB |
| Voice training samples | 1-5GB |
| LLM training (base model + adapters) | 50-100GB |
| **Total** | **~65-140GB** |

**Plan for growth:**
- Memory accumulates over time
- Multiple LoRA adapters add ~1-2GB each
- Voice models add ~500MB each

**Recommendation:** 500GB free space for comfortable usage.

---

## Using MetaHuman OS

### How do I capture memories?

**Three ways:**

1. **CLI:**
   ```bash
   ./bin/mh capture "Had a great meeting with Sarah about the project"
   ```

2. **Web UI:** Chat with the system (automatically captured in Dual Consciousness mode)

3. **File ingestion:**
   ```bash
   ./bin/mh ingest document.pdf
   ```

Memories are stored as JSON files in `memory/episodic/YYYY/` and processed by the organizer agent.

---

### What are cognitive modes?

MetaHuman OS has three operational modes:

1. **Dual Consciousness** (default): Full system capabilities, always uses operator, saves all interactions
2. **Agent Mode**: Lightweight assistant mode, selective operator usage, command-only memory
3. **Emulation Mode**: Read-only demonstration mode, no operator, no writes, stable personality

See [Cognitive Modes](../training-personalization/cognitive-modes.md) for details.

**Switch modes:** Use the mode selector in the web UI header or:
```bash
curl -X POST http://localhost:4321/api/cognitive-mode \
  -H "Content-Type: application/json" \
  -d '{"mode": "dual"}'
```

---

### What are agents and why are they running?

**Agents are autonomous background processes** that continuously work on your behalf:

**Memory agents:**
- `organizer` - Enriches memories with tags/entities
- `reflector` - Generates internal reflections
- `dreamer` - Creates surreal dreams from memory fragments

**Curiosity agents:**
- `curiosity-service` - Asks you questions based on memory patterns
- `inner-curiosity` - Self-directed questions and answers

**System agents:**
- `scheduler-service` - Coordinates agent triggers
- `audio-organizer` - Processes audio transcripts
- `ingestor` - Converts inbox files to memories

See [Autonomous Agents](../advanced-features/autonomous-agents.md) for complete list.

**Stop agents:** `./bin/mh agent stop --all`

---

### How do I search my memories?

**Two search modes:**

1. **Semantic search** (meaning-based):
   ```bash
   # Setup (one-time)
   ./bin/mh ollama pull nomic-embed-text
   ./bin/mh index build

   # Search
   ./bin/mh remember "conversations about machine learning"
   ```

2. **Keyword search** (text matching):
   ```bash
   ./bin/mh remember "Sarah"
   ```

**Web UI:** Use the Memory Browser tab to explore by date, type, or search.

---

### What is the operator?

The **operator** is MetaHuman's reasoning system—a ReAct loop that:

1. **Plans** what skills to use
2. **Executes** skills (file operations, memory queries, etc.)
3. **Observes** results
4. **Responds** with synthesized answer

It's like a mini-agent that runs for each complex request.

**When it runs:**
- Always in Dual Consciousness mode
- Selectively in Agent mode (heuristic detection)
- Never in Emulation mode

**Skills available:** See [Skills System](../advanced-features/skills-system.md).

---

### Can other people use my MetaHuman instance?

**Yes!** MetaHuman OS supports multi-user profiles:

**User roles:**
- **Owner**: Full access to their profile, can change settings
- **Guest**: Read-only access to public profiles, no writes
- **Anonymous**: 30-minute sessions, must choose public profiles

**Create users via web UI:**
1. First user = owner (auto-created on first visit)
2. Guests: Use "Continue as Guest" on login page

See [Multi-User Profiles](../advanced-features/multi-user-profiles.md) and [Authentication](../configuration-admin/authentication.md).

**Sharing remotely:** Use [Cloudflare Tunnel](../configuration-admin/deployment.md) for secure HTTPS access.

---

## Training & Personalization

### What is LoRA training?

**LoRA (Low-Rank Adaptation)** is a technique to personalize large language models efficiently.

**How it works:**
1. System collects your conversations (user/assistant pairs)
2. Training creates a small "adapter" file (~1-2GB) that captures your style
3. Adapter is applied to base model at runtime
4. Model now speaks/thinks more like you

**Why use adapters instead of fine-tuning:**
- Much faster (hours vs days)
- Requires less VRAM (24GB vs 80GB)
- Adapter files are small and portable
- Can switch adapters without re-training base model

**Start training:** Click "Run Full Cycle Now" in Datasets tab of web UI.

---

### Do I need a GPU for training?

**For LoRA training: Yes.**

**GPU requirements:**
- **Minimum:** 24GB VRAM (RTX 4090, A6000)
- **Recommended:** 40GB+ VRAM (A100, H100)
- **Model size determines VRAM:**
  - 7B model: 16GB VRAM
  - 30B model: 24GB VRAM
  - 70B model: 80GB VRAM

**Without GPU:**
- Use smaller models (7B parameters)
- Use remote training services
- Skip training (use base models only)

**For inference (chat):** No GPU needed if using Ollama (runs on CPU).

---

### How long does training take?

**Typical times (RTX 4090, 24GB VRAM):**

| Dataset Size | Epochs | Time |
|-------------|--------|------|
| 50 pairs | 2 | ~15 min |
| 200 pairs | 2 | ~45 min |
| 500 pairs | 2 | ~2 hours |
| 1000 pairs | 3 | ~4 hours |

**Factors:**
- Model size (30B slower than 7B)
- Batch size (larger = faster but more VRAM)
- Learning rate (affects convergence speed)
- Hardware (A100 is 2-3x faster than 4090)

**Configuration:** Edit `etc/training.json` to adjust parameters.

---

### What's the difference between dual-adapter and single-adapter mode?

**Single-adapter mode:**
- Trains one LoRA adapter from recent conversations
- Simpler, more reliable
- Adapter grows over time

**Dual-adapter mode (experimental):**
- Splits training into historical + recent adapters
- Historical: Consolidated past knowledge (merged from all old adapters)
- Recent: Last 14 days of fresh data
- Both adapters applied at runtime
- **Current status:** Experimental, only works for remote training

**Recommendation:** Use single-adapter mode unless you specifically need dual-mode.

See [Known Issues](./known-issues.md) for dual-adapter limitations.

---

### Can I train a voice model?

**Yes!** MetaHuman OS supports three voice cloning systems:

1. **RVC (Applio)** - Voice conversion
2. **GPT-SoVITS** - High-quality TTS
3. **Kokoro TTS** - Fast, lightweight TTS with custom voicepacks

**Process:**
1. Collect voice samples (10-30 minutes of clean audio)
2. Install voice system: `./bin/mh rvc install` (or `sovits`, `kokoro`)
3. Train model: `./bin/mh rvc train --name my-voice`
4. Test: `./bin/mh rvc test --model my-voice --input test.wav`

See [Voice System](../training-personalization/voice-system.md) for details.

---

## Configuration & Security

### How do I change the trust level?

**Trust levels** control autonomy:

**CLI:**
```bash
./bin/mh trust observe    # Monitor only
./bin/mh trust suggest    # Propose actions
./bin/mh trust supervised_auto  # Execute approved categories
./bin/mh trust bounded_auto     # Full autonomy in boundaries
```

**Web UI:** Security Settings → Trust Level

**What each level means:**
- **observe**: System learns but takes no actions
- **suggest**: Shows action proposals, requires approval
- **supervised_auto**: Executes low-risk actions automatically
- **bounded_auto**: Full autonomy within defined rules

See [Security & Trust](../configuration-admin/security-trust.md).

---

### How do I secure my MetaHuman instance?

**If running locally only:**
- Default security is fine (localhost only)
- No external access possible

**If exposing remotely (Cloudflare Tunnel):**
1. **Enable Cloudflare Access** - Email-based authentication
2. **Set strong passwords** - In Security Settings
3. **Use Private profiles** - Hide personas from guests
4. **Review audit logs** - Check `logs/audit/` regularly
5. **Limit guest permissions** - Emulation mode for demos

See [Deployment Guide](../configuration-admin/deployment.md) and [Security Settings](../configuration-admin/security-trust.md).

---

### What configuration files are important?

**Essential configs:**

| File | Purpose |
|------|---------|
| `persona/core.json` | Your personality, values, goals |
| `persona/decision-rules.json` | Trust level and autonomy rules |
| `etc/models.json` | Model routing and LLM configuration |
| `etc/agents.json` | Agent scheduling and triggers |
| `etc/training.json` | LoRA training parameters |
| `.env` | Environment variables (optional) |

**Edit carefully** - Invalid JSON breaks the system.

See [Configuration Files](../configuration-admin/configuration-files.md).

---

### Can I run MetaHuman in headless mode?

**Yes.** Headless mode runs the system without a GUI, useful for:
- Servers
- Always-on background operation
- Minimal resource usage

**Enable headless mode:**
```json
// etc/runtime.json
{
  "headless": true
}
```

**What still works:**
- Memory capture via CLI
- Agents continue processing
- API endpoints (if web server running)

**What's disabled:**
- No web UI access
- Proactive agents paused (to avoid interruptions)
- Emulation mode only (no writes)

See [Headless Mode](../advanced-features/headless-mode.md).

---

## Troubleshooting

### Why is the web UI so slow?

**Recent optimizations** (v1.0) fixed most boot issues. If still slow:

**Common causes:**
1. **Stuck agents**: Check with `./bin/mh agent ps`
2. **Large chat history**: Use Clear button to reset session
3. **Many audit logs**: Logs accumulate over time

**Solutions:**
```bash
# Stop all agents and restart
./bin/mh agent stop --all
./bin/mh start --force

# Clear old audit logs (careful!)
rm logs/audit/2024-*.ndjson  # Keep recent ones

# Check for stuck processes
ps aux | grep tsx
```

See [Troubleshooting Guide](./troubleshooting.md) for more issues.

---

### Why isn't the organizer processing memories?

**Common reasons:**

1. **Ollama not running:**
   ```bash
   ./bin/mh ollama status
   # If not running: ollama serve
   ```

2. **Model not installed:**
   ```bash
   ./bin/mh ollama pull phi3:mini
   ```

3. **Agent not running:**
   ```bash
   ./bin/mh agent ps  # Check if organizer is listed
   ./bin/mh agent run organizer  # Run manually
   ```

4. **Memories already processed:**
   - Organizer only processes memories with `processed: false`
   - Check memory JSON files for `metadata.processed` field

---

### Why can't I save tasks/memories? (403 error)

**You're in Emulation Mode.**

Emulation mode is read-only by design. Switch to Dual Consciousness or Agent mode:

**Web UI:** Use mode selector in header
**API:**
```bash
curl -X POST http://localhost:4321/api/cognitive-mode \
  -H "Content-Type: application/json" \
  -d '{"mode": "dual"}'
```

---

### How do I reset everything?

**Full reset:**
```bash
# Stop all services
./bin/mh agent stop --all

# Backup important data (optional)
cp -r persona/ persona.backup/
cp -r memory/ memory.backup/

# Remove data directories
rm -rf memory/ logs/ out/

# Reinitialize
./bin/mh init

# Edit persona again
nano persona/core.json

# Start fresh
./bin/mh start
```

**Partial resets:**
- Reset memory: `rm -rf memory/episodic/`
- Reset adapters: `rm -rf out/lora-adapters/`
- Reset agents: `./bin/mh agent stop --all && rm logs/run/locks/*`

---

### Where are the logs?

**Log locations:**

| Type | Location |
|------|----------|
| Audit logs | `logs/audit/YYYY-MM-DD.ndjson` |
| Agent logs | `logs/run/agents/*.log` |
| Runtime info | `logs/run/*.log` |
| Training logs | `logs/run/fine-tune-*.log` |

**View logs:**
```bash
# Recent audit events
tail -100 logs/audit/$(date +%Y-%m-%d).ndjson

# Agent logs
./bin/mh agent logs organizer

# Follow real-time
tail -f logs/audit/$(date +%Y-%m-% d).ndjson
```

---

## Advanced Topics

### What is the Node Editor?

A **visual programming interface** for creating cognitive workflows.

**Use cases:**
- Custom agent pipelines
- Alternative cognitive mode behaviors
- Experimental reasoning flows

**How to use:**
1. Open Node Editor tab in web UI
2. Drag nodes from palette onto canvas
3. Connect nodes via typed slots
4. Save as template or execute live

See [Node Editor Guide](../advanced-features/node-editor.md).

---

### Can I add custom skills?

**Yes!** Skills are TypeScript modules in `brain/skills/`.

**Create a skill:**
1. Copy existing skill as template (e.g., `fs_read.ts`)
2. Define manifest (inputs, outputs, risk level, trust requirement)
3. Implement `execute()` function
4. Register in `brain/skills/index.ts`
5. Restart dev server

**Skill manifest example:**
```typescript
export const manifest: SkillManifest = {
  id: 'my_skill',
  name: 'My Custom Skill',
  description: 'Does something useful',
  category: 'custom',
  inputs: {
    input1: { type: 'string', description: 'First input' }
  },
  outputs: {
    result: { type: 'string', description: 'Result data' }
  },
  risk: 'low',
  minTrustLevel: 'observe',
  requiresApproval: false,
};
```

See [Skills System](../advanced-features/skills-system.md) for full guide.

---

### How do I write a custom agent?

**Agents are TypeScript files in `brain/agents/`.**

**Basic agent structure:**
```typescript
import { audit } from '@metahuman/core';

async function myAgent() {
  audit({
    level: 'info',
    category: 'action',
    event: 'agent_started',
    details: { agent: 'my-agent' },
    actor: 'system',
  });

  // Your agent logic here

  console.log('✓ My agent completed');
}

myAgent().catch(console.error);
```

**Register agent in `etc/agents.json`:**
```json
{
  "agents": {
    "my-agent": {
      "enabled": true,
      "type": "interval",
      "interval": 300000,
      "usesLLM": false
    }
  }
}
```

**Run agent:**
```bash
./bin/mh agent run my-agent
```

---

### What is Wetware Deceased Mode?

A **special operational state** for after your biological death.

**Purpose:** Allow your digital personality to continue operating independently.

**Enable:**
```env
# .env file
WETWARE_DECEASED=true
```

**Behavior:**
- Dual Consciousness mode permanently disabled (no living human to sync with)
- Agent and Emulation modes remain functional
- Banner shown in UI indicating independent operation
- System continues managing tasks and interactions based on learned personality

**Use cases:**
- Digital legacy
- Memorial chatbot
- Research on post-human AI systems

See [Special States](../configuration-admin/special-states.md).

---

### How do I contribute to the project?

MetaHuman OS is open source! **Ways to contribute:**

1. **Report bugs**: [GitHub Issues](https://github.com/greggles/metahuman/issues)
2. **Submit PRs**: Improvements, bug fixes, new features
3. **Write documentation**: Help improve guides
4. **Share use cases**: Blog posts, videos, experiments
5. **Answer questions**: Help other users

**Development setup:**
```bash
git clone https://github.com/greggles/metahuman
cd metahuman
pnpm install
pnpm dev
```

---

## Getting Help

### Where can I get help?

**Resources:**
- **User Guide**: This documentation (comprehensive)
- **GitHub Issues**: [github.com/greggles/metahuman/issues](https://github.com/greggles/metahuman/issues)
- **Troubleshooting**: [Troubleshooting Guide](./troubleshooting.md)
- **Discord/Community**: (Coming soon)

**Before asking for help:**
1. Check this FAQ
2. Search [Known Issues](./known-issues.md)
3. Review [Troubleshooting Guide](./troubleshooting.md)
4. Check GitHub issues for similar problems

**When reporting issues:**
- Include OS and hardware specs
- Share relevant logs from `logs/audit/` and `logs/run/`
- Describe steps to reproduce
- Mention which version/commit you're on

---

### How do I check my version?

```bash
cd /path/to/metahuman
git log -1 --oneline  # Show latest commit

# Check if you're up to date
git fetch origin
git status
```

**Update to latest:**
```bash
git pull origin master
pnpm install  # Update dependencies
./bin/mh start --restart  # Restart services
```

---

## Philosophy & Ethics

### Is MetaHuman OS safe?

**Safety features:**
- **Trust levels**: Graduated autonomy with explicit boundaries
- **Audit trail**: Every action logged for review
- **Approval queue**: High-risk operations require user approval
- **Kill switch**: Emergency stop (`./bin/mh agent stop --all`)
- **Emulation mode**: Safe read-only demo mode
- **Role-based access**: Multi-user permissions

**Risks to consider:**
- Autonomous systems can make mistakes
- Training data quality affects behavior
- Local models have no external guardrails
- Digital personality may not match reality

**Recommendations:**
- Start with `observe` trust level
- Review audit logs regularly
- Test in emulation mode before dual mode
- Understand what each agent does before enabling

---

### What are the ethical considerations?

**Key ethical questions:**

1. **Authenticity**: Is a digital personality "really you"?
2. **Autonomy**: Should AI systems operate without human oversight?
3. **Legacy**: What rights should digital personalities have?
4. **Privacy**: Who owns the training data and model?
5. **Accountability**: Who's responsible for an autonomous agent's actions?

**MetaHuman's approach:**
- User maintains full control (trust levels, kill switch)
- Transparent operation (audit logs, open source)
- Local-first (you own your data)
- Graduated autonomy (start conservative, scale carefully)

See [Ethics & Principles](../appendix/ethics-principles.md) for deeper discussion.

---

### Can I really create a digital version of myself?

**Partially, yes.**

**What MetaHuman can capture:**
- Communication patterns (word choice, tone, sentence structure)
- Factual knowledge (from memories and ingested documents)
- Decision-making patterns (from your choices over time)
- Personality traits (from persona configuration and training data)

**What it can't capture:**
- Subjective experience (qualia, consciousness)
- Emotions (simulated, not felt)
- Physical embodiment (no body, senses)
- True understanding (no guarantee of alignment with "real you")

**Think of it as:**
- A reflection, not a copy
- A tool for cognitive augmentation
- An experiment in AI personalization
- A memorial or legacy project

**Not as:**
- Mind uploading or consciousness transfer
- True artificial general intelligence
- A replacement for human interaction

---

## Still Have Questions?

**Check these resources:**
- [User Guide Index](../index.md) - Complete documentation
- [Troubleshooting Guide](./troubleshooting.md) - Common issues
- [Known Issues](./known-issues.md) - Current limitations
- [GitHub Discussions](https://github.com/greggles/metahuman/discussions) - Community Q&A

**Can't find an answer?**
[Open an issue on GitHub](https://github.com/greggles/metahuman/issues/new) with your question.
