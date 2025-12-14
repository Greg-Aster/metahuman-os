# Installation

Install MetaHuman OS on your Linux server.

> **Note:** If you're connecting to an existing server (remote or mobile), skip to [Setup & Login](03-setup-and-login.md).

---

## 1. Clone the Repository

```bash
git clone https://github.com/your-org/metahuman-os.git
cd metahuman-os
```

---

## 2. Install Dependencies

```bash
pnpm install
```

This installs all Node.js packages across the monorepo. If you don't have pnpm:

```bash
npm install -g pnpm
```

---

## 3. Initialize the System

```bash
./bin/mh init
```

This creates the directory structure:
- `profiles/` — User profile directories
- `logs/` — Audit trails and agent logs
- `etc/` — System configuration files

---

## 4. Install an LLM Backend

MetaHuman needs an LLM backend for AI capabilities. Choose one:

### Option A: Ollama (Recommended for Most Users)

Ollama is simpler to set up and works well for models up to ~14B parameters.

```bash
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Start the Ollama service
ollama serve
```

Verify it's running:
```bash
./bin/mh ollama status
```

### Option B: vLLM (For Large Models / High Performance)

vLLM offers better performance for large models (30B+) and high-throughput scenarios. Requires NVIDIA GPU with CUDA.

```bash
# Create Python virtual environment
python3 -m venv venv
source venv/bin/activate

# Install vLLM
pip install vllm

# Start vLLM server (example with Qwen model)
vllm serve Qwen/Qwen2.5-7B-Instruct --port 8000
```

Configure MetaHuman to use vLLM:
```bash
# Edit etc/llm-backend.json and set "active": "vllm"
```

### Option C: Remote LLM (No Local Backend)

If you're connecting to a remote server that already has an LLM backend, you can skip this step entirely. Configure the remote server URL in Settings after login.

---

## 5. Start the Web UI

```bash
cd apps/site
pnpm dev
```

The server starts at http://localhost:4321

---

## Next Steps

Installation complete! Continue to [Setup & Login](03-setup-and-login.md) to create your account and configure your first model.
