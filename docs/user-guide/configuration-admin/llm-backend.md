# LLM Backend Configuration

MetaHuman OS requires a local LLM backend for AI capabilities. This guide covers setup, configuration, and switching between backends.

---

## Supported Backends

| Backend | Best For | Requirements |
|---------|----------|--------------|
| **Ollama** | Most users, models up to ~14B | 8GB+ RAM |
| **vLLM** | Large models (30B+), high throughput | NVIDIA GPU with CUDA |
| **Remote** | No local resources | Network connection |

---

## Ollama Setup

Ollama is the recommended backend for most users. It's simple to set up and handles model management automatically.

### Installation

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

### Starting Ollama

Ollama runs as a background service. Start it with:

```bash
ollama serve
```

For auto-start on boot (systemd):
```bash
sudo systemctl enable ollama
sudo systemctl start ollama
```

### Verify Installation

```bash
# Check if Ollama is running
curl http://localhost:11434

# Or use MetaHuman CLI
./bin/mh ollama status
```

### Managing Models

```bash
# List installed models
./bin/mh ollama list

# Pull a model
./bin/mh ollama pull qwen2.5:7b

# Delete a model
./bin/mh ollama delete phi3:mini

# Show model details
./bin/mh ollama info qwen2.5:7b
```

### Recommended Models

| Model | Size | Use Case |
|-------|------|----------|
| `qwen2.5:7b` | ~4GB | General purpose, good balance |
| `llama3.2:3b` | ~2GB | Limited hardware |
| `qwen2.5-coder:14b` | ~8GB | Code and reasoning |
| `phi3:mini` | ~2GB | Fast, lightweight tasks |
| `nomic-embed-text` | ~300MB | Semantic search (required) |

---

## vLLM Setup

vLLM offers higher throughput for large models using PagedAttention. Requires NVIDIA GPU with CUDA.

### Installation

```bash
# Create Python virtual environment
python3 -m venv venv
source venv/bin/activate

# Install vLLM
pip install vllm
```

### Starting vLLM

vLLM loads ONE model at a time. Specify the model when starting:

```bash
vllm serve Qwen/Qwen2.5-7B-Instruct --port 8000
```

For large models, configure GPU memory:
```bash
vllm serve Qwen/Qwen2.5-30B-Instruct \
  --port 8000 \
  --gpu-memory-utilization 0.9 \
  --tensor-parallel-size 2
```

### Configure MetaHuman

Edit `etc/llm-backend.json`:

```json
{
  "active": "vllm",
  "vllm": {
    "baseUrl": "http://localhost:8000",
    "model": "Qwen/Qwen2.5-7B-Instruct",
    "gpuMemoryUtilization": 0.9,
    "tensorParallelSize": 1
  }
}
```

---

## Remote Backend

If connecting to a remote MetaHuman server or external LLM API, configure in Settings after login.

Edit `etc/llm-backend.json`:

```json
{
  "active": "remote",
  "remote": {
    "baseUrl": "https://your-server.com/api",
    "apiKey": "your-api-key"
  }
}
```

---

## Switching Backends

### Via Web UI

1. Open **Settings** (gear icon in right sidebar)
2. Navigate to **LLM Backend**
3. Select your backend and configure

### Via API

```bash
curl -X POST http://localhost:4321/api/llm-backend \
  -H "Content-Type: application/json" \
  -d '{"active": "ollama"}'
```

### Via Configuration File

Edit `etc/llm-backend.json` directly and restart the server.

---

## Configuration Reference

The `etc/llm-backend.json` file controls all backend settings:

```json
{
  "active": "ollama",
  "ollama": {
    "baseUrl": "http://localhost:11434",
    "defaultModel": "qwen2.5:7b"
  },
  "vllm": {
    "baseUrl": "http://localhost:8000",
    "model": "Qwen/Qwen2.5-7B-Instruct",
    "gpuMemoryUtilization": 0.9,
    "tensorParallelSize": 1,
    "enableThinking": false
  },
  "remote": {
    "baseUrl": "",
    "apiKey": ""
  }
}
```

---

## Troubleshooting

### Ollama Not Running

```bash
# Check status
curl http://localhost:11434

# Start manually
ollama serve &

# Check logs
journalctl -u ollama -f
```

### Model Not Found

```bash
# List available models
./bin/mh ollama list

# Pull the model
./bin/mh ollama pull <model-name>
```

### vLLM Out of Memory

Reduce GPU memory utilization:
```bash
vllm serve <model> --gpu-memory-utilization 0.7
```

Or use a smaller model.

### Connection Refused

Ensure the backend is running on the expected port:
- Ollama: `localhost:11434`
- vLLM: `localhost:8000`

Check firewall settings if accessing remotely.

---

## Next Steps

- [Download a Model](../getting-started/03-setup-and-login.md#download-a-model-local-installs-only) - Get started with your first model
- [Configuration Files](configuration-files.md) - Other system configuration options
