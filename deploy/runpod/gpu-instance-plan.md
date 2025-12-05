# GPU Instance Plan for MetaHuman OS

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         RUNPOD                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │           Network Volume (Persistent)                     │   │
│  │  /runpod-volume/                                          │   │
│  │  ├── metahuman/        # App data                         │   │
│  │  │   ├── memory/       # Episodic memories                │   │
│  │  │   ├── persona/      # Identity kernel                  │   │
│  │  │   ├── logs/         # Audit logs                       │   │
│  │  │   └── etc/          # Configuration                    │   │
│  │  └── ollama/           # Model cache                      │   │
│  │      └── models/       # Downloaded GGUF files            │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              │                                   │
│              ┌───────────────┴───────────────┐                  │
│              ▼                               ▼                  │
│  ┌─────────────────────┐       ┌─────────────────────────────┐  │
│  │   Web Server Pod    │       │   Serverless GPU Endpoint   │  │
│  │   (CPU - always on) │◄─────►│   (vLLM/Ollama)             │  │
│  │   ~$20-30/mo        │       │   Scales to 0 when idle     │  │
│  └─────────────────────┘       └─────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Cost Estimate

| Component | Specification | Cost |
|-----------|--------------|------|
| Network Volume | 50 GB | ~$3.50/mo |
| CPU Pod (Web Server) | 4 vCPU, 16GB RAM | ~$25/mo |
| Serverless GPU | RTX 4090, pay-per-use | ~$0.04/min active |
| **Total Base** | | **~$30/mo + usage** |

### Usage Examples
- Light usage (10 chats/day, 30s each): ~$0.40/day = $12/mo
- Medium usage (50 chats/day): ~$2/day = $60/mo
- Heavy usage (200 chats/day): ~$8/day = $240/mo

## Setup Instructions

### 1. Create Network Volume

1. Go to RunPod Console → Storage → Network Volumes
2. Create volume:
   - Name: `metahuman-data`
   - Size: 50 GB (expand later if needed)
   - Region: Choose closest to your users

### 2. Create Serverless GPU Endpoint

1. Go to Serverless → New Endpoint
2. Use template: `runpod/worker-vllm:stable-cuda12.1.0`
3. Configure:
   ```
   Model: your-hf-username/your-model
   GPU: RTX 4090 (24GB) or A100 (40GB)
   Max Workers: 1-3
   Idle Timeout: 5 seconds
   ```
4. Mount network volume: `/runpod-volume`
5. Save endpoint ID for later

### 3. Create Web Server Pod

1. Go to Pods → Deploy
2. Select: CPU Pod (no GPU needed)
3. Configure:
   - Template: Custom (see Dockerfile below)
   - vCPU: 4
   - RAM: 16 GB
   - Volume: Mount `metahuman-data` at `/runpod-volume`
4. Set environment variables (see below)

### 4. Environment Configuration

Create `.env.production` with:

```bash
# RunPod Configuration
RUNPOD_API_KEY=your_api_key_here
RUNPOD_ENDPOINT_ID=your_serverless_endpoint_id

# Data paths (on network volume)
METAHUMAN_ROOT=/runpod-volume/metahuman
OLLAMA_MODELS=/runpod-volume/ollama/models

# LLM Configuration
LLM_PROVIDER=runpod_serverless
LLM_MODEL=your-model-name

# Server Configuration
HOST=0.0.0.0
PORT=4321
NODE_ENV=production

# Auth (generate a secure secret)
SESSION_SECRET=generate-a-secure-random-string
```

## File Structure on Network Volume

```bash
/runpod-volume/
├── metahuman/
│   ├── memory/
│   │   ├── episodic/
│   │   │   └── 2025/
│   │   ├── semantic/
│   │   ├── tasks/
│   │   └── index/
│   ├── persona/
│   │   ├── core.json
│   │   ├── relationships.json
│   │   └── routines.json
│   ├── logs/
│   │   ├── audit/
│   │   └── run/
│   └── etc/
│       ├── models.json
│       ├── agents.json
│       └── training.json
└── ollama/
    └── models/
        └── blobs/
```

## Serverless GPU Handler

The serverless endpoint needs a handler that processes LLM requests:

```python
# handler.py for RunPod Serverless
import runpod
from vllm import LLM, SamplingParams

# Load model once on cold start
llm = LLM(
    model="/runpod-volume/models/your-model",
    trust_remote_code=True,
    max_model_len=4096,
)

def handler(event):
    """Process inference request."""
    input_data = event["input"]

    messages = input_data.get("messages", [])
    max_tokens = input_data.get("max_tokens", 512)
    temperature = input_data.get("temperature", 0.7)

    # Format for chat
    prompt = format_chat_prompt(messages)

    sampling_params = SamplingParams(
        temperature=temperature,
        max_tokens=max_tokens,
    )

    outputs = llm.generate([prompt], sampling_params)
    response = outputs[0].outputs[0].text

    return {"response": response}

runpod.serverless.start({"handler": handler})
```

## Adapting MetaHuman OS

### LLM Adapter Changes

Add a RunPod serverless provider to `packages/core/src/llm.ts`:

```typescript
// Add to LLMProvider type
type LLMProvider = 'ollama' | 'openai' | 'runpod_serverless' | 'mock';

// Add provider implementation
async function callRunPodServerless(messages: Message[], options: LLMOptions) {
  const response = await fetch(
    `https://api.runpod.ai/v2/${process.env.RUNPOD_ENDPOINT_ID}/runsync`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RUNPOD_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: {
          messages,
          max_tokens: options.maxTokens ?? 512,
          temperature: options.temperature ?? 0.7,
        },
      }),
    }
  );

  const data = await response.json();
  return data.output.response;
}
```

### Path Configuration

Update `packages/core/src/paths.ts` to support environment-based roots:

```typescript
const root = process.env.METAHUMAN_ROOT || '/home/greggles/metahuman';
```

## Deployment Commands

```bash
# Build for production
cd apps/site && pnpm build

# Create deployment package
tar -czvf metahuman-deploy.tar.gz \
  dist/ \
  package.json \
  node_modules/ \
  ../packages/

# Upload to RunPod pod
runpodctl send metahuman-deploy.tar.gz

# Or use rsync if SSH configured
rsync -avz ./dist/ runpod-pod:/app/dist/
```

## Scaling Considerations

### Multiple Users
- Each user gets isolated subdirectory: `/runpod-volume/metahuman/users/{username}/`
- Shared models in `/runpod-volume/ollama/models/`
- Session management via Redis (add Redis pod or use Upstash)

### High Availability
- Deploy web server pod in multiple regions
- Use RunPod's load balancing for serverless endpoints
- Consider read replicas for heavy read workloads

### Cost Optimization
- Set aggressive idle timeouts (5s) on serverless
- Use spot instances for non-critical workloads
- Implement request batching for multiple users

## Monitoring

- RunPod Dashboard: GPU usage, costs, errors
- Add custom metrics endpoint: `/api/health`
- Set up alerts for:
  - Cold start latency > 30s
  - Error rate > 5%
  - Storage > 80% full

---

## Alternative: Hugging Face Hybrid

If you prefer Hugging Face for model hosting:

```
┌─────────────────────────────────────────────────────────────┐
│  RUNPOD (Compute + Storage)                                 │
│  ├── Network Volume: memory/, persona/, logs/               │
│  └── CPU Pod: Astro web server ($20/mo)                     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  HUGGING FACE (Inference)                                   │
│  └── Inference Endpoint with your fine-tuned model          │
│      ~$0.60-1.30/hr (A10G), scales to 0 on paid tier        │
└─────────────────────────────────────────────────────────────┘
```

This works well if:
- Your models are already on HuggingFace Hub
- You want managed inference (less ops work)
- You're okay with slightly higher latency/cost
