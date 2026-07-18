# Setup & First Login

Create your account and configure MetaHuman OS for first use.

> **Note:** If you installed MetaHuman locally, make sure the server is running (`./start.sh`).

---

## Connect to MetaHuman

Open your MetaHuman server in a browser:
- **Local install:** http://localhost:4321
- **Remote server:** Use the URL provided by your server admin
- **Mobile app:** The app connects automatically or prompts for server URL

You'll see the welcome screen with options to log in or create an account. All users must authenticate to access the system.

---

## Create Your Account

1. Click **Create Account** on the welcome screen
2. Fill in your details:
   - **Username** (required) — Letters, numbers, underscore, and hyphen only
   - **Display Name** (optional) — How the system refers to you
   - **Email** (optional) — For future features
   - **Password** (required) — Minimum 6 characters
   - **Confirm Password** (required)
3. Check the required agreements:
   - ✅ Terms of Service
   - ✅ Ethical Use Policy (no impersonation without consent, no malicious AI)
4. Click **Create Account**

> **First User = Owner:** The first account created automatically becomes the system **owner** with full system access. See [Accounts & Security](../configuration-admin/accounts-security.md) for details on account types.

---

## Setup Wizard (Optional)

After registration, you'll choose between:

### Option 1: Setup Wizard (Recommended)

A guided process (about 10-15 minutes) that walks through identity, personality, context, and goals.

1. **Welcome** — Overview of what you'll set up
2. **Identity** — Your name, traits, and core identity
3. **Personality** — Communication style and characteristics
4. **Context** — Import documents, journals, or files for memory
5. **Goals** — Set up tasks and objectives
6. **Complete** — Review and finish

The wizard helps MetaHuman understand you better for more accurate emulation.

### Option 2: Skip and Explore

Jump directly into the app. You can add data later through:
- **Chat Interface** — Conversations are automatically saved
- **Memory Capture** — CLI: `./bin/mh capture "text"`
- **File Ingestion** — CLI: `./bin/mh ingest <file-or-directory>`
- **Persona Editor** — Settings → Persona to edit directly

---

## Logging In

For returning users:

1. Click **Login** on the welcome screen
2. Enter your username and password
3. Click **Sign In**

### Sync from Server (Multi-Device)

If you created your account on another device and get a "User not found" error:

1. Click **Sync from Server** (or the link below the login form)
2. Enter the **Server URL** of your existing account (e.g., `https://mh.example.com`)
3. Enter your username and password
4. Click **Sync Profile**

This downloads your persona, config, conversation buffer, and recent memories to the current device. For more details on multi-device sync, see [Accounts & Security](../configuration-admin/accounts-security.md).

### Forgot Password?

1. Click **Forgot password?** on the login screen
2. Enter your username
3. Enter one of your recovery codes
4. Set a new password

> **Finding Recovery Codes:** Your recovery codes are available in **Settings → Security** after logging in. Each code can only be used once.

---

## Guest Access

**⚠️ Important: All users must authenticate** — there are no anonymous sessions.

Guest accounts provide read-only access to public profiles:

1. **Authentication Required**: Guest accounts must be created by the owner or use existing credentials
2. Log in with guest credentials
3. Select a public profile to view from the profile selector
4. Browse memories, chat history, and settings in **read-only mode**

Guest sessions:
- Require authentication (owner-created account or existing credentials)
- Last 1 hour
- Cannot create memories or modify data
- Cannot access owner-only settings
- Always forced into emulation mode (read-only)
- Useful for demonstrations or showing your digital twin to others

**Creating Guest Accounts**: Owners can create guest accounts through the owner interface (future UI) or via API. See [Authentication](../configuration-admin/authentication.md) for details.

---

## Download a Model (Local Installs Only)

If you installed a local LLM backend, you need to download at least one model.

### Required: Embedding Model

For semantic memory search, you need an embedding model:

```bash
./bin/mh ollama pull nomic-embed-text
```

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

Models are downloaded automatically when you start the vLLM server. Specify the model in the CLI command:

```bash
./bin/mh vllm start --model Qwen/Qwen2.5-7B-Instruct
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

Open the **Agent Monitor** to see autonomous agents:
- **Organizer**: Enriches memories with tags and entities
- **Reflector**: Generates internal thoughts
- **Curator**: Prepares training data

```bash
./bin/mh agent status
```

---

## What's Happening Behind the Scenes

When you interact with MetaHuman, several autonomous agents work in the background:

1. **Memory Captured**: Conversations and observations are stored as structured JSON files
2. **Automatic Enrichment**: The **Organizer** agent extracts tags, entities, and metadata
3. **Inner Dialogue**: The **Reflector** agent generates internal thoughts and connections
4. **Memory Indexing**: Vector embeddings enable semantic search across your memories
5. **Training Preparation**: The **Curator** prepares data for future LoRA adapter training

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

- [Chat Interface](../using-metahuman/chat-interface.md) — Learn conversation modes and features
- [Accounts & Security](../configuration-admin/accounts-security.md) — Multi-device sync, encryption, and security tips
- [Persona Generator](../training-personalization/persona-generator.md) — Create a detailed personality profile
- [Voice Training](../training-personalization/voice-training.md) — Clone your voice
