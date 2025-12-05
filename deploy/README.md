# MetaHuman OS Deployment Guide

This guide covers deploying MetaHuman OS in different configurations.

## Deployment Modes

MetaHuman OS supports two deployment modes:

| Mode | Use Case | GPU | Storage | Users |
|------|----------|-----|---------|-------|
| **Local** | Personal use, development | Local Ollama | Local filesystem | Single |
| **Server** | Production, multi-user | Cloud GPU (RunPod/HF) | Network volume | Multiple |

## Quick Start

### Local Mode (Default)

No configuration needed - just run:

```bash
pnpm install
./bin/mh init
pnpm dev
```

### Server Mode

1. **Configure deployment**:
   ```bash
   # Edit etc/deployment.json
   # Set "mode": "server"
   # Add RunPod/HuggingFace credentials
   ```

2. **Set environment variables**:
   ```bash
   export DEPLOYMENT_MODE=server
   export METAHUMAN_ROOT=/runpod-volume/metahuman
   export RUNPOD_API_KEY=your_api_key
   export RUNPOD_ENDPOINT_ID=your_endpoint_id
   ```

3. **Install server package**:
   ```bash
   pnpm install
   ```

4. **Start server**:
   ```bash
   pnpm build
   node dist/server/entry.mjs
   ```

## Configuration

### etc/deployment.json

```json
{
  "mode": "local",  // or "server"

  "local": {
    "llmProvider": "ollama",
    "storagePath": "${METAHUMAN_ROOT}",
    "ollamaEndpoint": "http://localhost:11434"
  },

  "server": {
    "llmProvider": "runpod_serverless",
    "storagePath": "/runpod-volume/metahuman",
    "runpod": {
      "apiKey": "${RUNPOD_API_KEY}",
      "endpointId": "${RUNPOD_ENDPOINT_ID}"
    },
    "scaling": {
      "maxConcurrentInference": 3,
      "queueTimeout": 60000,
      "coldStartWarningMs": 15000
    }
  }
}
```

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DEPLOYMENT_MODE` | Override deployment mode (`local` or `server`) | No |
| `METAHUMAN_ROOT` | Override storage root path | No |
| `RUNPOD_API_KEY` | RunPod API key | Server mode |
| `RUNPOD_ENDPOINT_ID` | RunPod serverless endpoint ID | Server mode |
| `HF_API_KEY` | HuggingFace API key | If using HF |
| `HF_ENDPOINT_URL` | HuggingFace endpoint URL | If using HF |
| `REDIS_URL` | Redis connection URL | For request queuing |

## Cloud Providers

### RunPod (Recommended)

See [runpod/gpu-instance-plan.md](runpod/gpu-instance-plan.md) for detailed setup.

**Pros:**
- Purpose-built for AI workloads
- Serverless GPU (pay per second)
- Network volumes for persistent storage
- Cost-effective

**Cons:**
- Less enterprise features than GCP/AWS

### HuggingFace Inference Endpoints

**Pros:**
- Native model hosting
- Easy setup
- Good for HF-hosted models

**Cons:**
- Higher cost than RunPod
- No built-in persistent storage

### Google Cloud / AWS

Possible but not directly supported. Would require:
- Custom GPU instance setup
- S3/GCS storage integration
- More DevOps work

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Server Deployment                         │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │              Network Volume (Persistent)                │ │
│  │  /runpod-volume/metahuman/                             │ │
│  │  ├── profiles/{username}/    # Per-user data           │ │
│  │  ├── etc/                    # System config           │ │
│  │  └── brain/                  # Agents (shared)         │ │
│  └────────────────────────────────────────────────────────┘ │
│                              │                               │
│         ┌────────────────────┴────────────────────┐         │
│         ▼                                         ▼          │
│  ┌──────────────────┐              ┌─────────────────────┐  │
│  │   Web Server     │              │  Serverless GPU     │  │
│  │   (CPU Pod)      │──────────────│  (RunPod/HF)        │  │
│  │   Astro + Node   │              │  Scales 0→N         │  │
│  └──────────────────┘              └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Scaling

### Cost Estimates

| Daily Users | Chats/Day | GPU Cost | Total |
|-------------|-----------|----------|-------|
| 5-10 (beta) | 100-500 | ~$10-50 | ~$50-80/mo |
| 50-100 | 2,500-5,000 | ~$100-300 | ~$150-350/mo |
| 500-1,000 | 25,000-50,000 | ~$800-2,000 | ~$900-2,100/mo |

### Scaling Strategies

1. **Request Queuing**: Redis-based queue for concurrent request management
2. **Model Tiering**: Route simple queries to smaller/faster models
3. **Cold Start Handling**: Keep-warm pings or accept 15-30s cold starts
4. **Response Caching**: Cache common/repeated queries

## Packages

### @metahuman/core

Shared library used by all deployment modes. Contains:
- Path resolution (supports METAHUMAN_ROOT)
- Deployment configuration
- LLM provider interface
- Memory, auth, skills, etc.

### @metahuman/server (Optional)

Server-specific components. Only needed for server mode:
- RunPod/HuggingFace providers
- Request queue (Redis)
- Cold start manager
- Metrics tracking
- Network volume storage

Install with:
```bash
pnpm add @metahuman/server
```

## Troubleshooting

### "Provider not found" error

```
Error: Provider 'runpod_serverless' not found
```

**Solution**: Ensure `@metahuman/server` is installed and credentials are configured:
```bash
pnpm add @metahuman/server
# Set RUNPOD_API_KEY and RUNPOD_ENDPOINT_ID
```

### Cold start timeout

```
Error: Model warmup timeout after 120000ms
```

**Solution**: Increase timeout or enable keep-warm pings:
```json
{
  "server": {
    "scaling": {
      "coldStartWarningMs": 30000,
      "keepWarmIntervalMs": 240000
    }
  }
}
```

### Storage path not found

```
Error: METAHUMAN_ROOT set but path does not exist
```

**Solution**: Ensure the network volume is mounted:
```bash
# Check if volume is mounted
ls /runpod-volume/metahuman

# Create directory structure if needed
mkdir -p /runpod-volume/metahuman/{profiles,etc,brain,logs}
```

## Next Steps

1. [RunPod Setup Guide](runpod/gpu-instance-plan.md)
2. [Multi-User Configuration](../docs/multi-user.md)
3. [API Reference](../docs/api.md)
