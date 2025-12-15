# Installation

Install MetaHuman OS on your Linux server.

> **Note:** If you're connecting to an existing server (remote or mobile), skip to [Setup & Login](03-setup-and-login.md).

---

## Prerequisites

### Required
- **Node.js 18+** — JavaScript runtime
- **pnpm** — Package manager (`npm install -g pnpm`)
- **Git** — Version control

### Required for AI Features
- **Ollama** OR **vLLM** — Local LLM backend (choose one)
- At least 8GB RAM (16GB+ recommended for larger models)

### Optional (for Training & Voice)
- **Python 3.10+** — Only needed for LoRA training or audio transcription
- **NVIDIA GPU** — Required for local training (or use RunPod cloud)

---

## 1. Clone the Repository

```bash
git clone https://github.com/your-org/metahuman-os.git
cd metahuman-os
```

---

## 2. Install an LLM Backend

MetaHuman needs an LLM backend for AI capabilities. Install **Ollama** (recommended for most users):

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

Ollama runs as a background service and auto-starts on boot.

> **Alternative backends:** For large models (30B+) or high-throughput scenarios, see [LLM Backend Configuration](../configuration-admin/llm-backend.md) for vLLM setup.
>
> **Remote users:** If connecting to a remote server that already has an LLM backend, skip this step.

---

## 3. Start MetaHuman OS

The startup script handles everything automatically:
- Installs Node.js dependencies (`pnpm install`)
- Sets up Python environment (if Python 3 is available)
- Initializes the system (creates directories, config files)
- Starts all services and agents

### Option A: Simple Start (Recommended)

```bash
./start.sh
```

First run takes a few minutes to install dependencies and build the application.

### Option B: PM2 (Production)

For production deployments with auto-restart and monitoring:

```bash
./bin/start-pm2
```

PM2 provides:
- Auto-restart on crash
- Centralized logging (`pm2 logs`)
- Monitoring dashboard (`pm2 monit`)
- Zero-downtime reloads (`pm2 reload all`)

To enable auto-start on system boot:
```bash
pm2 startup
pm2 save
```

### Option C: Development Mode

For development with hot-reload:

```bash
pnpm install  # Required for dev mode
cd apps/site && pnpm dev
```

---

## 4. Verify Installation

After starting, verify everything is working:

```bash
# Check web server is running
curl http://localhost:4321

# Check Ollama connection (if using Ollama)
./bin/mh ollama status

# Check system status
./bin/mh status
```

The web interface should be accessible at **http://localhost:4321**

---

## Troubleshooting

Having issues? See [Troubleshooting](../reference/troubleshooting.md) for common problems and solutions.

---

## Next Steps

Installation complete! Continue to [Setup & Login](03-setup-and-login.md) to create your account and download a model.
