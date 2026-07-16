# Installation

Install MetaHuman OS on your Linux server.

> **Note:** If you're connecting to an existing server (remote or mobile), skip to [Setup & Login](03-setup-and-login.md).

---

## Prerequisites

### Required
- **Node.js 22.3+ (22.x)** — JavaScript runtime (the repository includes an `.nvmrc`)
- **pnpm** — Package manager (`npm install -g pnpm`)
- **Python 3** — Required by `./start.sh` (creates a virtual env and installs deps)
- **Git** — Version control

### Required for AI Features
- **Ollama** or **vLLM** — Local LLM backend (choose one)
- At least 8GB RAM (16GB+ recommended for larger models)

### Optional (for Training & Voice)
- **NVIDIA GPU** — Required for local training (or use RunPod cloud)

---

## 1. Clone the Repository

```bash
git clone https://github.com/Greg-Aster/metahuman-os.git
cd metahuman-os
```

---

## 2. Install an LLM Backend (Optional but Recommended)

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
- Sets up the Python virtual environment (`venv/`)
- Installs Python dependencies (`requirements.txt`)
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
