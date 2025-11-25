# Model Architecture: Multi-Model System

MetaHuman OS uses a sophisticated "multi-model" architecture, sometimes called a "dual consciousness" model. Instead of relying on a single monolithic AI, the system delegates tasks to specialized models, each with a distinct role—like having a team of experts working together.

---

## Overview

### Why Multi-Model?

A single AI model trying to do everything leads to:
- **Compromised quality**: Jack of all trades, master of none
- **Slow responses**: Large models needed for complex tasks slow down simple ones
- **Training conflicts**: Different data types (chat vs. code vs. curation) mixed together
- **Limited flexibility**: Can't swap components independently

The multi-model architecture solves this by **separation of responsibilities**.

---

## Model Roles

MetaHuman OS defines four primary roles:

| Role | Purpose | Characteristics | Example Models |
|------|---------|-----------------|----------------|
| **Orchestrator** | Executive function, routing, safety | Lightweight, fast, always-on, decides *what* to do | llama3.2:3b, phi3:mini |
| **Persona** | Conversational voice & introspection | Heavy, fine-tuned, provides personality | qwen3-coder:30b, llama3:70b |
| **Curator** | Memory curation & training prep | Summarization-focused, data librarian | mistral:7b, gemma2:9b |
| **Coder** | Code generation and analysis | Specialized for programming tasks | qwen3-coder:30b, deepseek-coder |

### Additional Roles (Configurable)

- **Fallback**: Generic model when specific role unavailable
- **Narrator**: Synthesizes operator outputs into natural responses
- **Planner**: Analyzes user intent and creates execution plans
- **Embeddings**: Generates vector embeddings for semantic search

---

## How It Works

### Request Flow

```
User Message
  ↓
1. Orchestrator (Intent Classification)
   ├─ Simple Chat → Persona Model
   ├─ Code Task → Coder Model
   ├─ Memory Curation → Curator Model
   └─ Complex Task → Operator (uses multiple models)
  ↓
2. Model Router (Role Resolution)
   - Looks up role in etc/models.json
   - Resolves to specific model
   - Checks cognitive mode context
   - Applies fallback if needed
  ↓
3. LLM Adapter (Execution)
   - Connects to Ollama/OpenAI/etc.
   - Executes generation
   - Returns result
  ↓
4. Response
```

### Example: Simple Chat

```
User: "How are you feeling today?"
  ↓
Orchestrator: "Simple conversational query"
  ↓
Model Router: role='persona' → qwen3-coder:30b
  ↓
LLM Adapter: Generate with persona model
  ↓
Response: "I'm doing well! ..."
```

### Example: Code Task

```
User: "Write a function to parse JSON"
  ↓
Orchestrator: "Code generation task"
  ↓
Model Router: role='coder' → qwen3-coder:30b
  ↓
LLM Adapter: Generate with coder model
  ↓
Response: "def parse_json(data): ..."
```

### Example: Complex Task

```
User: "Create a task to review documentation"
  ↓
Orchestrator: "Action-oriented request"
  ↓
Operator: ReAct loop with multiple roles
   - Planner: role='orchestrator' → llama3.2:3b
   - Executor: role='persona' → qwen3-coder:30b
   - Narrator: role='persona' → qwen3-coder:30b
  ↓
Response: "I've created a task..."
```

---

## Configuration

### Model Registry (`etc/models.json`)

The model registry defines all available models and their role mappings:

```json
{
  "registry": {
    "qwen3-coder:30b": {
      "provider": "ollama",
      "roles": ["persona", "coder", "narrator"],
      "cognitiveModeMappings": {
        "dual": { "priority": 1 },
        "agent": { "priority": 1 },
        "emulation": { "priority": 1 }
      }
    },
    "llama3.2:3b": {
      "provider": "ollama",
      "roles": ["orchestrator", "fallback"]
    },
    "mistral:7b": {
      "provider": "ollama",
      "roles": ["curator"]
    }
  },
  "fallbackModel": "llama3.2:3b"
}
```

### Role Configuration

Each role can specify:
- **Model**: Which model to use
- **Provider**: Ollama, OpenAI, Mock
- **Priority**: Which model to prefer if multiple available
- **Cognitive mode mappings**: Different models per mode
- **Temperature**: Generation randomness (0.0-1.0)
- **Max tokens**: Maximum response length

### Example Role Configurations

```json
{
  "roles": {
    "persona": {
      "defaultModel": "qwen3-coder:30b",
      "provider": "ollama",
      "temperature": 0.7,
      "maxTokens": 2048
    },
    "orchestrator": {
      "defaultModel": "llama3.2:3b",
      "provider": "ollama",
      "temperature": 0.3,
      "maxTokens": 512
    },
    "curator": {
      "defaultModel": "mistral:7b",
      "provider": "ollama",
      "temperature": 0.5,
      "maxTokens": 1024
    },
    "coder": {
      "defaultModel": "qwen3-coder:30b",
      "provider": "ollama",
      "temperature": 0.2,
      "maxTokens": 4096
    }
  }
}
```

---

## Model Router

The Model Router (`packages/core/src/model-router.ts`) is the central dispatcher that resolves roles to models and executes generations.

### Core Functions

**`callLLM({ role, messages, cognitiveMode, options })`**
- Primary interface for all LLM calls
- Resolves role to model
- Applies cognitive mode context
- Handles fallbacks
- Logs to audit trail

**`resolveModel(role)`**
- Looks up role in registry
- Returns model name
- Applies fallback if role not found

**`resolveModelForCognitiveMode(mode, role)`**
- Mode-aware model resolution
- Checks `cognitiveModeMappings` in registry
- Returns model optimized for specific mode

### Usage Example

```typescript
import { callLLM } from '@metahuman/core/model-router';

// Simple call
const response = await callLLM({
  role: 'persona',
  messages: [
    { role: 'user', content: 'Hello!' }
  ]
});

// With cognitive mode
const response = await callLLM({
  role: 'orchestrator',
  messages: [
    { role: 'system', content: 'You are an intent classifier' },
    { role: 'user', content: 'Create a task' }
  ],
  cognitiveMode: 'dual'
});

// With options
const response = await callLLM({
  role: 'coder',
  messages: [
    { role: 'user', content: 'Write a function to sort an array' }
  ],
  options: {
    temperature: 0.1,  // More deterministic for code
    maxTokens: 8192    // Longer code output
  }
});
```

---

## Benefits

### 1. Higher Quality Conversations

The Persona model is trained **only** on identity-rich data (conversations, reflections), so it doesn't "learn" to talk like a machine. Its voice remains natural and true to your personality.

**Before multi-model** (single model for everything):
```
User: How are you?
AI: I am functioning within normal parameters. All systems nominal.
```

**After multi-model** (specialized persona model):
```
User: How are you?
Greg: I'm doing well! Been thinking a lot about that ML project we discussed.
```

### 2. Faster, More Responsive UI

The lightweight **Orchestrator** handles intent routing and tool selection instantly (3B params vs. 30B), so the system feels nimble and quick for most interactions.

**Performance comparison**:
- Orchestrator (intent): ~200ms
- Full persona model: ~2000ms

**Result**: 10x faster routing decisions

### 3. Increased Reliability and Safety

The Orchestrator acts as a stable guardrail, enforcing policies and ensuring that the correct tools are used, even as the Persona model creatively explores ideas.

**Example safety check**:
```typescript
// Orchestrator validates intent before execution
if (intent === 'delete_all_memories') {
  if (trustLevel < 'bounded_auto') {
    return requestApproval();
  }
}
```

### 4. Modularity

Each component can be upgraded independently, allowing the system to evolve without major rewrites.

**Upgrade scenarios**:
- Swap persona model to newer version without touching orchestrator
- Upgrade coder model for better code generation
- Add new specialized model for specific domain

---

## LoRA Adapter Integration

The multi-model architecture supports LoRA (Low-Rank Adaptation) adapters for personalizing specific models.

### Adapter Loading

**Dual-Adapter Mode**:
- **Historical adapter**: Consolidated lifetime memories
- **Recent adapter**: Last 14 days of training
- Both loaded simultaneously into persona model

**Modelfile Example**:
```
FROM qwen3-coder:30b
ADAPTER /path/to/history-merged.gguf
ADAPTER /path/to/2025-01-15/adapter.gguf
```

### Active Adapter Tracking

The system tracks which adapters are active via `etc/models.json`:

```json
{
  "activeAdapter": {
    "modelName": "greg-dual-2025-01-15",
    "activatedAt": "2025-01-15T10:00:00Z",
    "adapterPath": "/path/to/adapter_model.safetensors",
    "ggufAdapterPath": "/path/to/adapter.gguf",
    "evalScore": 0.87,
    "isDualAdapter": true,
    "baseModel": "qwen3-coder:30b"
  }
}
```

### Per-Role Adaptation

Different roles can use different adapters:

```json
{
  "registry": {
    "greg-dual-2025-01-15": {
      "provider": "ollama",
      "roles": ["persona"],
      "baseModel": "qwen3-coder:30b",
      "adapters": [
        "history-merged.gguf",
        "2025-01-15/adapter.gguf"
      ]
    },
    "qwen3-coder:30b": {
      "provider": "ollama",
      "roles": ["coder", "curator", "fallback"]
    }
  }
}
```

**Result**: Persona uses adapted model, other roles use base model.

---

## Cognitive Mode Integration

The multi-model system adapts based on cognitive mode:

### Dual Consciousness Mode

- **Orchestrator**: Always used for routing
- **Persona**: Used for all responses (with memory grounding)
- **Operator models**: All roles active (planner, executor, narrator)
- **Curator**: Used for memory enrichment

### Agent Mode

- **Orchestrator**: Used for heuristic routing
- **Persona**: Used for chat responses
- **Operator models**: Conditional (only for detected actions)
- **Curator**: Disabled

### Emulation Mode

- **Orchestrator**: Not used
- **Persona**: Direct chat (no routing)
- **Operator models**: Disabled
- **Curator**: Disabled

### Mode-Specific Model Selection

```json
{
  "registry": {
    "qwen3-coder:30b": {
      "cognitiveModeMappings": {
        "dual": {
          "temperature": 0.7,
          "priority": 1
        },
        "agent": {
          "temperature": 0.5,
          "priority": 2
        },
        "emulation": {
          "temperature": 0.3,
          "priority": 1
        }
      }
    }
  }
}
```

---

## Model Providers

### Ollama (Default)

- **Local execution**: Runs on your machine
- **Privacy**: No data sent to cloud
- **Model library**: Thousands of open models
- **Free**: No API costs

**Configuration**:
```json
{
  "provider": "ollama",
  "baseUrl": "http://localhost:11434"
}
```

### OpenAI (Optional)

- **Cloud-based**: Runs on OpenAI servers
- **High quality**: GPT-4 and GPT-3.5-turbo
- **Cost**: Pay per token

**Configuration**:
```json
{
  "provider": "openai",
  "apiKey": "sk-...",
  "organizationId": "org-..."
}
```

### Mock (Development)

- **Testing**: Dummy responses for development
- **No LLM needed**: Instant responses
- **Deterministic**: Same input → same output

**Configuration**:
```json
{
  "provider": "mock",
  "responses": {
    "default": "Mock response"
  }
}
```

---

## Audit Logging

All model calls are logged to `logs/audit/YYYY-MM-DD.ndjson`:

```json
{
  "event": "llm_call",
  "timestamp": "2025-01-15T10:30:00Z",
  "role": "persona",
  "model": "qwen3-coder:30b",
  "provider": "ollama",
  "cognitiveMode": "dual",
  "messageCount": 3,
  "tokensUsed": 1523,
  "latencyMs": 2341,
  "success": true
}
```

### Metrics Tracked

- **Model used**: Which model handled the request
- **Role**: Which role was requested
- **Cognitive mode**: Operating mode context
- **Token usage**: Input + output tokens
- **Latency**: Time to generate response
- **Success/failure**: Error tracking

---

## Performance Considerations

### Token Usage

Different roles have different token budgets:

| Role | Typical Tokens | Reason |
|------|---------------|--------|
| Orchestrator | 100-300 | Simple routing decisions |
| Persona | 500-2000 | Full conversations with context |
| Curator | 300-800 | Memory summarization |
| Coder | 1000-4000 | Code generation with examples |

### Latency

Model size affects response time:

| Model Size | Latency (avg) | Use Case |
|-----------|--------------|----------|
| 3B params | 200-500ms | Fast routing (orchestrator) |
| 7B params | 500-1500ms | Medium tasks (curator) |
| 13B params | 1000-3000ms | Heavy conversations |
| 30B params | 2000-5000ms | Deep reasoning (persona) |

**Optimization**: Use smallest effective model for each role.

### Memory Usage

Model memory footprint (VRAM):

| Model Size | VRAM (Q4) | VRAM (Q8) | VRAM (FP16) |
|-----------|-----------|-----------|-------------|
| 3B | ~2GB | ~3GB | ~6GB |
| 7B | ~4GB | ~7GB | ~14GB |
| 13B | ~7GB | ~13GB | ~26GB |
| 30B | ~16GB | ~30GB | ~60GB |

**Tip**: Use quantized models (Q4/Q8) to reduce memory usage.

---

## Troubleshooting

### Model Not Found

**Issue**: "Model 'qwen3-coder:30b' not found in registry"

**Solution**:
1. Check model is installed: `./bin/mh ollama list`
2. Add to registry in `etc/models.json`
3. Verify model name spelling

### Role Resolution Failed

**Issue**: "No model found for role 'persona'"

**Solution**:
1. Check `etc/models.json` has role mapping
2. Verify model assigned to role exists
3. Check fallback model is configured

### Slow Responses

**Issue**: Every response takes 5+ seconds

**Solution**:
1. Check model size for role (use smaller models)
2. Verify GPU is being used (not CPU fallback)
3. Monitor VRAM usage: `nvidia-smi`
4. Consider quantized models (Q4 instead of Q8)

### Adapter Not Loading

**Issue**: Responses don't reflect personality training

**Solution**:
1. Check adapter is activated: `./bin/mh adapter list`
2. Verify Modelfile includes adapter: `cat out/adapters/*/Modelfile`
3. Reload Ollama model: `ollama create <model> -f <Modelfile>`
4. Check active adapter in `etc/models.json`

---

## Best Practices

### Role Assignment

**Do**:
- ✅ Use orchestrator for intent classification
- ✅ Use persona for conversational responses
- ✅ Use coder for code generation
- ✅ Use curator for memory summarization

**Don't**:
- ❌ Use persona model for intent classification (too slow)
- ❌ Use orchestrator for complex responses (too simple)
- ❌ Mix training data across roles

### Model Selection

**For orchestrator**: Small, fast models (3B-7B)
- llama3.2:3b
- phi3:mini

**For persona**: Large, capable models (13B-30B+)
- qwen3-coder:30b
- llama3:70b
- mistral-nemo:12b

**For curator**: Medium models with good summarization (7B-13B)
- mistral:7b
- gemma2:9b

**For coder**: Code-specialized models
- qwen3-coder:30b
- deepseek-coder:33b
- codellama:34b

### Configuration Management

1. **Version control**: Track `etc/models.json` in git
2. **Backup adapters**: Keep copies of trained adapters
3. **Test changes**: Use mock provider for testing
4. **Monitor metrics**: Watch audit logs for performance
5. **Gradual upgrades**: Test new models in single role first

---

## Related Documentation

- **[Core Concepts](04-core-concepts-new.md)** - Overview of all subsystems
- **[Cognitive Modes](04b-cognitive-modes.md)** - Mode-specific model usage
- **[Reasoning Engine](04d-reasoning-engine.md)** - Operator multi-model usage
- **[Configuration Files](../14-configuration-files.md)** - models.json reference
- **[LoRA Training](../11-special-features.md#lora-adapter-training)** - Adapter creation
- **[CLI Reference](../06-cli-reference.md)** - Adapter management commands

---

**Master the multi-model architecture for optimal performance!** 🚀
