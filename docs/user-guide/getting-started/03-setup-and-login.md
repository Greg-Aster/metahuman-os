# Setup & First Login

Create your account and configure MetaHuman OS for first use.

> **Note:** If you installed MetaHuman locally, make sure the web UI is running (`cd apps/site && pnpm dev`).

---

## Connect to MetaHuman

Open your MetaHuman server in a browser:
- **Local install:** http://localhost:4321
- **Remote server:** Use the URL provided by your server admin
- **Mobile app:** The app connects automatically or prompts for server URL

---

## Create Your Account

1. Click **Create Account** on the login screen
2. Choose a username and password
3. The first account automatically becomes the **owner** with full privileges

Additional users can be created later as guests or standard users.

---

## Initial Persona Setup

On first login, you'll configure your persona:

- **Core Identity**: Name, traits, and personality characteristics
- **Communication Style**: How the system should speak (formal, casual, technical)
- **Goals & Values**: What matters to you
- **Daily Routines**: Your typical schedule and habits

You can skip this and configure later via **Settings > Persona**.

---

## Download a Model (Local Installs Only)

If you installed a local LLM backend, you need to download at least one model:

### For Ollama Users

```bash
# Recommended starter model
./bin/mh ollama pull qwen2.5:7b

# Or a lighter model for limited hardware
./bin/mh ollama pull llama3.2:3b

# For advanced reasoning
./bin/mh ollama pull qwen2.5-coder:14b
```

### For vLLM Users

Models are downloaded automatically when you start the vLLM server. Specify the model in the serve command:

```bash
vllm serve Qwen/Qwen2.5-7B-Instruct --port 8000
```

### For Remote/Mobile Users

Skip this section — the server you're connecting to already has models configured.

---

## Your First 5 Minutes

### 1. Capture Your First Memory

**Via Chat:**
1. Click **Chat** in the left sidebar
2. Type a message: "This is my first interaction with MetaHuman"
3. The system responds and saves the conversation automatically

**Via CLI:**
```bash
./bin/mh capture "Starting my MetaHuman journey today"
```

### 2. Browse Your Memories

Click **Memory Browser** in the left sidebar to see your timeline:
- **Conversations**: Chat history
- **Observations**: Manual captures
- **All Memories**: Complete timeline

Or via CLI:
```bash
./bin/mh remember "first"
```

### 3. Create a Task

```bash
./bin/mh task add "Explore MetaHuman features"
./bin/mh task
```

Or use the **Tasks** tab in the web UI.

### 4. Watch the Agents Work

Open the **Agent Monitor** (right sidebar) to see autonomous agents:
- **Organizer**: Enriches memories with tags and entities
- **Reflector**: Generates internal thoughts
- **Curator**: Prepares training data

```bash
./bin/mh agent status
```

---

## What's Happening Behind the Scenes

When you interact with MetaHuman:

1. **Memory Captured**: Conversations and observations are stored as structured JSON
2. **Automatic Enrichment**: The organizer agent extracts tags and entities
3. **Reflection**: The system generates internal thoughts about your activities
4. **Training Data**: Curator prepares conversations for future LoRA adapter training

---

## Optional: Voice Setup

### Install Kokoro TTS

```bash
./bin/mh kokoro install
./bin/mh kokoro serve start
```

### Start Voice Services

```bash
./bin/start-voice-server
```

This starts text-to-speech and speech-to-text services based on your voice configuration.

---

## Optional: GPU Setup (for Training)

### NVIDIA GPU (Local Training)

```bash
# Install CUDA toolkit
sudo apt install nvidia-cuda-toolkit

# Verify GPU access
nvidia-smi
```

### RunPod (Cloud Training)

1. Sign up at https://runpod.io
2. Get API key
3. Configure: `echo "RUNPOD_API_KEY=your-key" > .env`

---

## Next Steps

Now that you're set up, explore:

- [Chat Interface](../using-metahuman/chat-interface.md) - Learn conversation modes and features
- [Persona Generator](../training-personalization/persona-generator.md) - Create a detailed personality profile
- [Voice Training](../training-personalization/voice-training.md) - Clone your voice
