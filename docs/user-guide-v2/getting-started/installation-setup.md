# Installation & Setup

Get MetaHuman OS up and running on your system.

---

## Prerequisites

### System Requirements
- **OS**: Linux (Ubuntu 22.04+), macOS, or WSL2
- **RAM**: 8GB minimum, 16GB+ recommended
- **Disk**: 50GB+ free space
- **CPU**: Modern multi-core processor
- **GPU**: Optional (NVIDIA for local training)

### Required Software
- **Node.js**: Version 20.x or higher
- **pnpm**: Package manager (`npm install -g pnpm`)
- **Ollama**: Local LLM runtime
- **Git**: For cloning the repository

---

## Installation Steps

### 1. Clone the Repository

```bash
git clone https://github.com/your-org/metahuman-os.git
cd metahuman-os
```

### 2. Install Dependencies

```bash
pnpm install
```

This installs all Node.js dependencies across the monorepo.

### 3. Initialize the System

```bash
./bin/mh init
```

This creates the directory structure:
- `persona/` - Identity and personality configuration
- `memory/` - Episodic memory storage
- `logs/` - Audit trails and agent logs
- `etc/` - System configuration files
- `out/` - Generated outputs

### 4. Install Ollama

**Linux/WSL:**
```bash
curl -fsSL https://ollama.com/install.sh | sh
```

**macOS:**
```bash
brew install ollama
```

Start Ollama:
```bash
ollama serve
```

### 5. Pull a Model

```bash
./bin/mh ollama pull qwen2.5:7b
```

Recommended models:
- `qwen2.5:7b` - Fast, good quality
- `llama3.2:3b` - Lightweight
- `qwen2.5-coder:14b` - Advanced reasoning

---

## First Run

### Start the Web UI

```bash
cd apps/site
pnpm dev
```

Open http://localhost:4321 in your browser.

### Create Your Account

1. Click **Create Account**
2. Choose a username and password
3. The first account becomes the **owner** with full privileges

### Configure Your Persona

On first login, you'll be guided through initial persona setup:
- Core identity traits
- Communication style preferences
- Goals and values
- Daily routines

---

## Optional: Voice Setup

### Install Kokoro TTS

```bash
./bin/mh kokoro install
./bin/mh kokoro serve start
```

### Install Whisper STT

```bash
./bin/mh whisper install
./bin/mh whisper serve start
```

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

## Verify Installation

```bash
# Check system status
./bin/mh status

# Test CLI
./bin/mh capture "Installation complete!"

# Test memory retrieval
./bin/mh remember "installation"
```

---

## Troubleshooting

### Ollama Not Found
```bash
# Check if Ollama is running
curl http://localhost:11434

# Start Ollama manually
ollama serve &
```

### Permission Errors
```bash
# Make bin/mh executable
chmod +x bin/mh

# Fix directory permissions
sudo chown -R $USER:$USER .
```

### Port Conflicts
```bash
# Change web UI port
cd apps/site
pnpm dev --port 4322
```

---

## Next Steps

Installation complete! Continue to [Quick Start Guide](quick-start.md) for your first 5 minutes with MetaHuman.
